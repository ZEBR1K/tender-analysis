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
    };
  });

  return { inputFormat: 'legacy_markdown_v0', fields };
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

  return {
    inputFormat: 'tender_agent_result_v1_json',
    fields: value.fields.map((field) => ({
      field_index: field.field_index,
      field_key: field.field_key,
      status: field.status,
      value_text: field.value_text ?? null,
      claim_basis: field.claim_basis ?? null,
      evidence: Array.isArray(field.evidence) ? field.evidence : null,
      raw_section: null,
    })),
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
  const byIndex = new Map(
    parsed.fields.map((field) => [field.field_index, field]),
  );

  const fieldDiffs = baseline.fields.map((baselineField) => {
    const field = byIndex.get(baselineField.field_index);
    const issues = [];

    if (!field) {
      issues.push('MISSING_FIELD');
      return {
        field_index: baselineField.field_index,
        field_key: baselineField.field_key,
        reported_status: null,
        accepted_statuses: baselineField.accepted_statuses,
        status_agreement: false,
        issues,
      };
    }
    if (field.field_key !== baselineField.field_key) {
      issues.push('FIELD_KEY_MISMATCH');
    }
    if (!allowedStatuses.has(field.status)) issues.push('STATUS_INVALID');

    const statusAgreement = baselineField.accepted_statuses.includes(field.status);
    if (!statusAgreement) issues.push('STATUS_DISAGREEMENT');
    if (
      field.status === 'resolved' &&
      baselineField.accepted_statuses.includes('requires_review')
    ) {
      issues.push('CRITICAL_FALSE_RESOLVED');
    }
    if (hasForbiddenValue(field, baselineField)) {
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
      field_index: baselineField.field_index,
      field_key: baselineField.field_key,
      reported_status: field.status,
      accepted_statuses: baselineField.accepted_statuses,
      status_agreement: statusAgreement,
      issues: unique(issues),
    };
  });

  const exactCatalogMapping = baseline.fields.every((baselineField) => {
    const field = byIndex.get(baselineField.field_index);
    return field?.field_key === baselineField.field_key;
  });
  const structuralPass =
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
