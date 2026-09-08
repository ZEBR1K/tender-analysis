#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const baselinePath = path.join(
  repositoryRoot,
  'evaluations',
  'agentic-baseline-v0',
  'adjudication.json',
);
const allowedStatuses = new Set([
  'resolved',
  'requires_review',
  'not_found',
]);

class TypedEvaluationError extends Error {
  constructor(type, code, message) {
    super(message);
    this.name = 'TypedEvaluationError';
    this.type = type;
    this.code = code;
  }
}

function parseLegacyValue(section) {
  const lines = section.split(/\r?\n/u);
  const valueLabel = /^-\s+(?:\*\*)?(?:value|Итоговое значение):?(?:\*\*)?:?\s*(.*)$/iu;
  const startIndex = lines.findIndex((line) => valueLabel.test(line));
  if (startIndex === -1) return null;

  const firstLine = valueLabel.exec(lines[startIndex])?.[1] ?? '';
  const valueLines = [firstLine];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (/^-\s+/u.test(lines[index])) break;
    valueLines.push(lines[index]);
  }

  const value = valueLines.join('\n').trim();
  return value || null;
}

function parseLegacyMarkdown(content) {
  const headingPattern = /^##\s+(\d+)\.\s+`?([a-z][a-z0-9_]*)`?\s*$/gmu;
  const headings = [...content.matchAll(headingPattern)];
  if (headings.length === 0 || !/(?:status|Статус)\*?\*?:/iu.test(content)) {
    throw new TypedEvaluationError(
      'unsupported-format',
      'UNSUPPORTED_FORMAT',
      'Input is neither tender_agent_result_v1 JSON nor supported legacy Markdown.',
    );
  }

  const fields = headings.map((heading, headingIndex) => {
    const sectionStart = heading.index;
    const sectionEnd = headings[headingIndex + 1]?.index ?? content.length;
    const section = content.slice(sectionStart, sectionEnd);
    const explicitKey = /^-\s+(?:\*\*)?field_key:?(?:\*\*)?:?\s*`([^`]+)`\s*$/imu.exec(
      section,
    )?.[1];
    const status = /^-\s+(?:\*\*)?(?:status|Статус):?(?:\*\*)?:?\s*`(resolved|requires_review|not_found)`\s*$/imu.exec(
      section,
    )?.[1];

    return {
      field_index: Number(heading[1]),
      field_key: explicitKey ?? heading[2],
      status: status ?? null,
      value_text: parseLegacyValue(section),
      claim_basis: null,
      evidence: null,
      raw_section: section,
      adapter_issues: [],
    };
  });

  return {
    inputFormat: 'legacy_markdown_v0',
    fields,
    structuralIssues: [],
  };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonResult(value) {
  if (
    !value ||
    value.schema_version !== 'tender_agent_result_v1' ||
    !Array.isArray(value.fields)
  ) {
    throw new TypedEvaluationError(
      'unsupported-format',
      'UNSUPPORTED_FORMAT',
      'Input is neither tender_agent_result_v1 JSON nor supported legacy Markdown.',
    );
  }

  const structuralIssues = [];
  if (value.field_catalog_version !== 'tender_fields_v1') {
    structuralIssues.push('FIELD_CATALOG_VERSION_INVALID');
  }
  if (!/^[a-f0-9]{64}$/iu.test(value.field_catalog_sha256 ?? '')) {
    structuralIssues.push('FIELD_CATALOG_SHA256_INVALID');
  }
  if (!/^[a-f0-9]{64}$/iu.test(value.input_manifest_sha256 ?? '')) {
    structuralIssues.push('INPUT_MANIFEST_SHA256_INVALID');
  }
  if (!Array.isArray(value.inspected_documents)) {
    structuralIssues.push('INSPECTED_DOCUMENTS_INVALID');
  }
  if (!Array.isArray(value.limitations)) {
    structuralIssues.push('LIMITATIONS_INVALID');
  }
  if (!Array.isArray(value.constraints)) {
    structuralIssues.push('CONSTRAINTS_INVALID');
  }

  return {
    inputFormat: 'tender_agent_result_v1_json',
    fields: value.fields.map((field) => {
      if (!isRecord(field)) {
        structuralIssues.push('FIELD_ENTRY_INVALID');
        return {
          field_index: null,
          field_key: null,
          status: null,
          value_text: null,
          claim_basis: null,
          evidence: null,
          raw_section: null,
          adapter_issues: ['FIELD_ENTRY_INVALID'],
        };
      }
      const fieldEntryValid =
        Number.isInteger(field.field_index) &&
        typeof field.field_key === 'string' &&
        typeof field.status === 'string' &&
        (field.value_text === null || typeof field.value_text === 'string');
      if (!fieldEntryValid) structuralIssues.push('FIELD_ENTRY_INVALID');
      return {
        field_index: Number.isInteger(field.field_index)
          ? field.field_index
          : null,
        field_key:
          typeof field.field_key === 'string' ? field.field_key : null,
        status: typeof field.status === 'string' ? field.status : null,
        value_text:
          field.value_text === null || typeof field.value_text === 'string'
            ? field.value_text
            : null,
        claim_basis: field.claim_basis ?? null,
        evidence: Array.isArray(field.evidence) ? field.evidence : null,
        raw_section: null,
        adapter_issues: fieldEntryValid ? [] : ['FIELD_ENTRY_INVALID'],
      };
    }),
    structuralIssues: unique(structuralIssues),
  };
}

function parseInput(content) {
  const trimmed = content.trimStart();
  if (trimmed.startsWith('{')) {
    try {
      return parseJsonResult(JSON.parse(content));
    } catch (error) {
      if (error instanceof TypedEvaluationError) throw error;
      throw new TypedEvaluationError(
        'unsupported-format',
        'UNSUPPORTED_FORMAT',
        'Input is neither tender_agent_result_v1 JSON nor supported legacy Markdown.',
      );
    }
  }
  return parseLegacyMarkdown(content);
}

function unique(values) {
  return [...new Set(values)];
}

function hasForbiddenValue(field, baselineField) {
  const value = field.value_text?.toLocaleLowerCase('ru') ?? '';
  const checks = baselineField.machine_checks ?? {};
  const phraseViolation = (checks.forbidden_value_phrases ?? []).some((phrase) =>
    value.includes(phrase.toLocaleLowerCase('ru')),
  );
  const derivedQuantity = checks.derived_quantity;
  const quantityMatch = derivedQuantity
    ? new RegExp(derivedQuantity.pattern, 'iu').exec(value)
    : null;
  const quantityViolation =
    quantityMatch !== null &&
    Number(quantityMatch[1]) !== derivedQuantity.expected;

  return phraseViolation || quantityViolation;
}

function evaluateFields(parsed, baseline) {
  const baselineByIndex = new Map(
    baseline.fields.map((field) => [field.field_index, field]),
  );
  const baselineByKey = new Map(
    baseline.fields.map((field) => [field.field_key, field]),
  );
  const indices = parsed.fields.map(({ field_index: index }) => index);
  const keys = parsed.fields.map(({ field_key: key }) => key);
  const indexCounts = new Map(
    indices.map((index) => [
      index,
      indices.filter((candidate) => candidate === index).length,
    ]),
  );
  const keyCounts = new Map(
    keys.map((key) => [key, keys.filter((candidate) => candidate === key).length]),
  );
  const fieldDiffs = parsed.fields.map((field, occurrenceIndex) => {
    const baselineAtIndex = baselineByIndex.get(field.field_index);
    const policyField = baselineByKey.get(field.field_key);
    const exactMapping = baselineAtIndex?.field_key === field.field_key;
    const uniqueMapping =
      exactMapping &&
      indexCounts.get(field.field_index) === 1 &&
      keyCounts.get(field.field_key) === 1;
    const issues = [...(field.adapter_issues ?? [])];

    if (!baselineAtIndex) issues.push('FIELD_INDEX_INVALID');
    if (baselineAtIndex && !exactMapping) {
      issues.push('FIELD_KEY_MISMATCH');
    }
    if ((indexCounts.get(field.field_index) ?? 0) > 1) {
      issues.push('DUPLICATE_FIELD_INDEX');
    }
    if ((keyCounts.get(field.field_key) ?? 0) > 1) {
      issues.push('DUPLICATE_FIELD_KEY');
    }
    if (!allowedStatuses.has(field.status)) issues.push('STATUS_INVALID');

    const statusAgreement =
      uniqueMapping && baselineAtIndex.accepted_statuses.includes(field.status);
    if (
      exactMapping &&
      allowedStatuses.has(field.status) &&
      !baselineAtIndex.accepted_statuses.includes(field.status)
    ) {
      issues.push('STATUS_DISAGREEMENT');
    }
    if (
      field.status === 'resolved' &&
      policyField?.accepted_statuses.includes('requires_review')
    ) {
      issues.push('CRITICAL_FALSE_RESOLVED');
    }
    if (policyField && hasForbiddenValue(field, policyField)) {
      issues.push('FORBIDDEN_CONCLUSION');
      if (field.status === 'resolved') issues.push('CRITICAL_FALSE_RESOLVED');
    }
    if (
      parsed.inputFormat === 'tender_agent_result_v1_json' &&
      field.status === 'resolved' &&
      (field.claim_basis === 'absence_only' ||
        (field.claim_basis === 'explicit_negative' &&
          Array.isArray(field.evidence) &&
          field.evidence.length === 0))
    ) {
      issues.push('UNSUPPORTED_NEGATIVE');
    }

    return {
      occurrence_index: occurrenceIndex + 1,
      field_index: field.field_index,
      field_key: field.field_key,
      expected_field_index: policyField?.field_index ?? baselineAtIndex?.field_index ?? null,
      expected_field_key: baselineAtIndex?.field_key ?? policyField?.field_key ?? null,
      reported_status: field.status,
      accepted_statuses:
        policyField?.accepted_statuses ?? baselineAtIndex?.accepted_statuses ?? [],
      status_agreement: statusAgreement,
      issues: unique(issues),
    };
  });

  for (const baselineField of baseline.fields) {
    const hasExactOccurrence = parsed.fields.some(
      (field) =>
        field.field_index === baselineField.field_index &&
        field.field_key === baselineField.field_key,
    );
    if (!hasExactOccurrence) {
      fieldDiffs.push({
        occurrence_index: null,
        field_index: baselineField.field_index,
        field_key: baselineField.field_key,
        expected_field_index: baselineField.field_index,
        expected_field_key: baselineField.field_key,
        reported_status: null,
        accepted_statuses: baselineField.accepted_statuses,
        status_agreement: false,
        issues: ['MISSING_FIELD'],
      });
    }
  }

  const exactCatalogMapping = baseline.fields.every(
    (baselineField) =>
      parsed.fields.filter(
        (field) =>
          field.field_index === baselineField.field_index &&
          field.field_key === baselineField.field_key,
      ).length === 1,
  );
  const structuralPass =
    parsed.structuralIssues.length === 0 &&
    parsed.fields.length === baseline.fields.length &&
    indexCounts.size === baseline.fields.length &&
    keyCounts.size === baseline.fields.length &&
    [...indexCounts.values()].every((count) => count === 1) &&
    [...keyCounts.values()].every((count) => count === 1) &&
    exactCatalogMapping &&
    parsed.fields.every((field) => allowedStatuses.has(field.status));
  const matchedFields = fieldDiffs.filter(
    ({ status_agreement: matches }) => matches,
  ).length;

  return {
    ok: true,
    baseline_version: baseline.baseline_version,
    input_format: parsed.inputFormat,
    structural_pass: structuralPass,
    structural_issues: parsed.structuralIssues,
    field_count: parsed.fields.length,
    status_agreement: {
      matched_fields: matchedFields,
      total_fields: baseline.fields.length,
      rate: matchedFields / baseline.fields.length,
    },
    critical_false_resolved_count: fieldDiffs.filter(({ issues }) =>
      issues.includes('CRITICAL_FALSE_RESOLVED'),
    ).length,
    unsupported_negative_count: fieldDiffs.filter(({ issues }) =>
      issues.includes('UNSUPPORTED_NEGATIVE'),
    ).length,
    evidence_verification_rate: null,
    field_diffs: fieldDiffs,
    baseline_limitations: baseline.limitations,
  };
}

export async function evaluateAgenticResult(inputPath) {
  const [content, baselineContent] = await Promise.all([
    readFile(inputPath, 'utf8'),
    readFile(baselinePath, 'utf8'),
  ]);
  const baseline = JSON.parse(baselineContent);
  return evaluateFields(parseInput(content), baseline);
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new TypedEvaluationError(
      'invalid-invocation',
      'INPUT_PATH_REQUIRED',
      'Usage: node scripts/evaluate-agentic-result.mjs <result.md|result.json>',
    );
  }
  const result = await evaluateAgenticResult(path.resolve(inputPath));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().catch((error) => {
    const typedError =
      error instanceof TypedEvaluationError
        ? error
        : new TypedEvaluationError(
            'evaluation-error',
            'EVALUATION_FAILED',
            'Evaluation failed before a result could be produced.',
          );
    process.stdout.write(
      `${JSON.stringify({
        ok: false,
        error: {
          type: typedError.type,
          code: typedError.code,
          message: typedError.message,
        },
      })}\n`,
    );
    process.exitCode = 2;
  });
}
