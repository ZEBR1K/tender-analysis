#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, stat } from 'node:fs/promises';
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
const fieldPolicyPath = path.join(
  repositoryRoot,
  'deploy',
  'codex-runner',
  'policies',
  'tender-fields-v1.json',
);
const allowedStatuses = new Set([
  'resolved',
  'requires_review',
  'not_found',
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

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

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
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

function evaluateFields(parsed, baseline, { semanticAdjudication = true } = {}) {
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

    const statusAgreement = semanticAdjudication
      ? uniqueMapping && baselineAtIndex.accepted_statuses.includes(field.status)
      : null;
    if (
      semanticAdjudication &&
      exactMapping &&
      allowedStatuses.has(field.status) &&
      !baselineAtIndex.accepted_statuses.includes(field.status)
    ) {
      issues.push('STATUS_DISAGREEMENT');
    }
    if (
      semanticAdjudication &&
      field.status === 'resolved' &&
      policyField?.accepted_statuses.includes('requires_review')
    ) {
      issues.push('CRITICAL_FALSE_RESOLVED');
    }
    if (semanticAdjudication && policyField && hasForbiddenValue(field, policyField)) {
      issues.push('FORBIDDEN_CONCLUSION');
      if (field.status === 'resolved') issues.push('CRITICAL_FALSE_RESOLVED');
    }
    if (
      semanticAdjudication &&
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
        semanticAdjudication
          ? policyField?.accepted_statuses ?? baselineAtIndex?.accepted_statuses ?? []
          : [],
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
        accepted_statuses: semanticAdjudication ? baselineField.accepted_statuses : [],
        status_agreement: semanticAdjudication ? false : null,
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
  const matchedFields = semanticAdjudication
    ? fieldDiffs.filter(({ status_agreement: matches }) => matches).length
    : null;

  return {
    ok: true,
    baseline_version: semanticAdjudication ? baseline.baseline_version : null,
    input_format: parsed.inputFormat,
    structural_pass: structuralPass,
    structural_issues: parsed.structuralIssues,
    field_count: parsed.fields.length,
    status_agreement: semanticAdjudication
      ? {
          matched_fields: matchedFields,
          total_fields: baseline.fields.length,
          rate: matchedFields / baseline.fields.length,
        }
      : null,
    critical_false_resolved_count: semanticAdjudication
      ? fieldDiffs.filter(({ issues }) => issues.includes('CRITICAL_FALSE_RESOLVED')).length
      : null,
    unsupported_negative_count: semanticAdjudication
      ? fieldDiffs.filter(({ issues }) => issues.includes('UNSUPPORTED_NEGATIVE')).length
      : null,
    evidence_verification_rate: null,
    field_diffs: fieldDiffs,
    baseline_limitations: semanticAdjudication ? baseline.limitations : [],
  };
}

function assertRelativeArtifactPath(root, relativePath, label) {
  if (typeof relativePath !== 'string' || !relativePath.trim() || path.isAbsolute(relativePath)) {
    throw new TypedEvaluationError(
      'invalid-evaluation-index',
      'EVALUATION_INDEX_INVALID',
      `${label} must be a nonblank relative path.`,
    );
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new TypedEvaluationError(
      'invalid-evaluation-index',
      'EVALUATION_INDEX_INVALID',
      `${label} escapes the evaluation root.`,
    );
  }
  return resolved;
}

function normalizeEvaluationIndex(value) {
  if (
    !isRecord(value)
    || value.schema_version !== 'agentic_shadow_evaluation_index_v1'
    || typeof value.batch_id !== 'string'
    || !value.batch_id.trim()
    || !Array.isArray(value.cases)
    || value.cases.length === 0
  ) {
    throw new TypedEvaluationError(
      'invalid-evaluation-index',
      'EVALUATION_INDEX_INVALID',
      'evaluation-index.json violates agentic_shadow_evaluation_index_v1.',
    );
  }
  const caseIds = new Set();
  const normalizedCases = value.cases.map((entry) => {
    if (
      !isRecord(entry)
      || typeof entry.case_id !== 'string'
      || !/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(entry.case_id)
      || typeof entry.procurement_key !== 'string'
      || !entry.procurement_key.trim()
      || (entry.adjudication !== null && typeof entry.adjudication !== 'string')
      || !Array.isArray(entry.replicates)
      || entry.replicates.length === 0
      || caseIds.has(entry.case_id)
    ) {
      throw new TypedEvaluationError(
        'invalid-evaluation-index',
        'EVALUATION_INDEX_INVALID',
        'Each evaluation case must have unique identity and at least one replicate.',
      );
    }
    caseIds.add(entry.case_id);
    const replicateIndexes = new Set();
    const replicates = entry.replicates.map((replicate) => {
      const terminalStatus = replicate?.terminal_status;
      if (
        !isRecord(replicate)
        || !Number.isSafeInteger(replicate.replicate_index)
        || replicate.replicate_index < 1
        || !['completed', 'failed', 'canceled'].includes(terminalStatus)
        || (terminalStatus === 'completed' && typeof replicate.result !== 'string')
        || (terminalStatus !== 'completed' && replicate.result !== null)
        || typeof replicate.job_id !== 'string'
        || !UUID_PATTERN.test(replicate.job_id)
        || replicateIndexes.has(replicate.replicate_index)
      ) {
        throw new TypedEvaluationError(
          'invalid-evaluation-index',
          'EVALUATION_INDEX_INVALID',
          'Replicates require a job id, terminal status, unique positive index and valid result path.',
        );
      }
      replicateIndexes.add(replicate.replicate_index);
      return {
        replicate_index: replicate.replicate_index,
        job_id: replicate.job_id,
        terminal_status: terminalStatus,
        result: replicate.result,
      };
    });
    return {
      case_id: entry.case_id,
      procurement_key: entry.procurement_key,
      adjudication: entry.adjudication,
      replicates: replicates.sort((left, right) => left.replicate_index - right.replicate_index),
    };
  });
  return {
    schema_version: value.schema_version,
    batch_id: value.batch_id,
    cases: normalizedCases,
  };
}

function structuralContractFromPolicy(policy) {
  if (
    !isRecord(policy)
    || policy.policy_version !== 'tender_fields_v1'
    || !isRecord(policy.fields)
  ) {
    throw new TypedEvaluationError(
      'evaluation-error',
      'FIELD_POLICY_INVALID',
      'Pinned tender field policy is invalid.',
    );
  }
  const fields = Object.entries(policy.fields)
    .map(([fieldKey, entry]) => ({
      field_index: entry?.field_index,
      field_key: fieldKey,
      accepted_statuses: [],
      machine_checks: {},
    }))
    .sort((left, right) => left.field_index - right.field_index);
  return { baseline_version: null, limitations: [], fields };
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex').toUpperCase();
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

async function inventoryArchiveFiles(root) {
  const files = [];
  async function walk(directory) {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const filePath = path.join(directory, entry.name);
      const metadata = await lstat(filePath);
      if (metadata.isSymbolicLink()) throw new Error('archive symlink');
      if (metadata.isDirectory()) await walk(filePath);
      else if (metadata.isFile()) {
        files.push({
          path: path.relative(root, filePath).split(path.sep).join('/'),
          byte_size: metadata.size,
          sha256: await sha256File(filePath),
        });
      } else throw new Error('archive special file');
    }
  }
  await walk(root);
  return files;
}

async function evaluateArtifactIntegrity({
  resultPath,
  caseEntry,
  replicate,
}) {
  if (!replicate.job_id) return [];
  const issues = [];
  const replicateDirectory = path.dirname(resultPath);
  try {
    const [metadata, terminal, validation, inventory, archivedState] = await Promise.all([
      readFile(path.join(replicateDirectory, 'run-metadata.json'), 'utf8').then(JSON.parse),
      readFile(path.join(replicateDirectory, 'terminal-status.json'), 'utf8').then(JSON.parse),
      readFile(path.join(replicateDirectory, 'validation.json'), 'utf8').then(JSON.parse),
      readFile(path.join(replicateDirectory, 'archive-sha256.json'), 'utf8').then(JSON.parse),
      readFile(path.join(replicateDirectory, 'job', 'state.json'), 'utf8').then(JSON.parse),
    ]);
    if (
      metadata?.job_id !== replicate.job_id
      || metadata?.case_id !== caseEntry.case_id
      || metadata?.procurement_key !== caseEntry.procurement_key
      || metadata?.replicate_index !== replicate.replicate_index
      || terminal?.job_id !== replicate.job_id
      || terminal?.status !== replicate.terminal_status
      || archivedState?.manifest?.job_id !== replicate.job_id
      || archivedState?.manifest?.analysis_run_id !== metadata?.analysis_run_id
      || archivedState?.status !== replicate.terminal_status
    ) {
      issues.push('RUN_ARTIFACT_IDENTITY_MISMATCH');
    }
    if (
      validation?.schema_version !== 'tender_agent_validation_v1'
      || validation?.job_id !== replicate.job_id
      || validation?.valid !== true
    ) {
      issues.push('VALIDATION_IDENTITY_MISMATCH');
    }
    const resultObject = JSON.parse(await readFile(resultPath, 'utf8'));
    if (
      resultObject?.field_catalog_version !== metadata?.controls?.field_catalog_version
        && resultObject?.field_catalog_version !== 'tender_fields_v1'
      || String(resultObject?.field_catalog_sha256 ?? '').toUpperCase()
        !== String(metadata?.controls?.field_catalog_sha256 ?? '').toUpperCase()
      || String(resultObject?.input_manifest_sha256 ?? '').toUpperCase()
        !== String(metadata?.input_manifest_sha256 ?? '').toUpperCase()
    ) {
      issues.push('RESULT_CONTRACT_IDENTITY_MISMATCH');
    }
    const validatedResultSha256 = createHash('sha256')
      .update(canonicalJson(resultObject), 'utf8')
      .digest('hex')
      .toUpperCase();
    const attempt = terminal?.attempt;
    const archivedResultPath = Number.isSafeInteger(attempt) && attempt > 0
      ? path.join(
          replicateDirectory,
          'job',
          'audit',
          `validated-result.attempt-${attempt}.json`,
        )
      : null;
    const archivedValidationPath = Number.isSafeInteger(attempt) && attempt > 0
      ? path.join(
          replicateDirectory,
          'job',
          'audit',
          `validation.attempt-${attempt}.json`,
        )
      : null;
    if (
      typeof validation?.validated_result_sha256 !== 'string'
      || validation.validated_result_sha256.toUpperCase() !== validatedResultSha256
      || !archivedResultPath
      || typeof validation?.raw_result_sha256 !== 'string'
      || validation.raw_result_sha256.toUpperCase() !== await sha256File(archivedResultPath)
    ) {
      issues.push('RESULT_VALIDATION_HASH_MISMATCH');
    }
    if (archivedResultPath && archivedValidationPath) {
      const [archivedResultBytes, archivedValidationBytes] = await Promise.all([
        readFile(archivedResultPath),
        readFile(archivedValidationPath),
      ]);
      const archivedResult = JSON.parse(archivedResultBytes.toString('utf8'));
      const archivedValidation = JSON.parse(archivedValidationBytes.toString('utf8'));
      const archivedRawSha256 = sha256Bytes(archivedResultBytes);
      const archivedValidatedSha256 = sha256Bytes(
        Buffer.from(canonicalJson(archivedResult), 'utf8'),
      );
      const archivedValidationSha256 = sha256Bytes(archivedValidationBytes);
      const canonicalValidationBytes = Buffer.from(
        `${canonicalJson(archivedValidation)}\n`,
        'utf8',
      );
      if (
        !archivedValidationBytes.equals(canonicalValidationBytes)
        || canonicalJson(validation) !== canonicalJson(archivedValidation)
        || archivedValidation?.job_id !== replicate.job_id
        || archivedValidation?.raw_result_sha256 !== archivedRawSha256
        || archivedValidation?.validated_result_sha256 !== archivedValidatedSha256
        || archivedState?.result?.attempt !== attempt
        || archivedState?.result?.raw_result_sha256 !== archivedRawSha256
        || archivedState?.result?.validated_result_sha256 !== archivedValidatedSha256
        || archivedState?.result?.validation_file_sha256 !== archivedValidationSha256
      ) {
        issues.push('ARCHIVED_RESULT_CHAIN_MISMATCH');
      }
    } else {
      issues.push('ARCHIVED_RESULT_CHAIN_MISMATCH');
    }
    const actualFiles = await inventoryArchiveFiles(path.join(replicateDirectory, 'job'));
    if (
      inventory?.schema_version !== 'agentic_shadow_archive_inventory_v1'
      || inventory?.job_id !== replicate.job_id
      || inventory?.file_count !== actualFiles.length
      || JSON.stringify(inventory?.files) !== JSON.stringify(actualFiles)
    ) {
      issues.push('ARCHIVE_FILE_INTEGRITY_MISMATCH');
    }
  } catch {
    issues.push('RUN_ARTIFACT_SET_INVALID');
  }
  return unique(issues);
}

export async function evaluateAgenticEvaluationRoot(inputRoot) {
  const resolvedRoot = path.resolve(inputRoot);
  const [indexContent, policyContent] = await Promise.all([
    readFile(path.join(resolvedRoot, 'evaluation-index.json'), 'utf8'),
    readFile(fieldPolicyPath, 'utf8'),
  ]);
  const index = normalizeEvaluationIndex(JSON.parse(indexContent));
  const structuralContract = structuralContractFromPolicy(JSON.parse(policyContent));
  const cases = [];
  for (const caseEntry of index.cases) {
    const adjudication = caseEntry.adjudication === null
      ? null
      : JSON.parse(await readFile(
          assertRelativeArtifactPath(resolvedRoot, caseEntry.adjudication, 'adjudication'),
          'utf8',
        ));
    const contract = adjudication ?? structuralContract;
    const replicates = [];
    for (const replicate of caseEntry.replicates) {
      if (replicate.terminal_status !== 'completed') {
        replicates.push({
          replicate_index: replicate.replicate_index,
          job_id: replicate.job_id,
          terminal_status: replicate.terminal_status,
          result: null,
          evaluation: {
            ok: false,
            structural_pass: false,
            error: {
              type: 'terminal-run-failure',
              code: 'REPLICATE_NOT_COMPLETED',
              message: `Replicate ended with terminal status ${replicate.terminal_status}.`,
            },
          },
        });
        continue;
      }
      const resultPath = assertRelativeArtifactPath(
        resolvedRoot,
        replicate.result,
        'replicate result',
      );
      const parsed = parseInput(await readFile(resultPath, 'utf8'));
      const artifactIssues = await evaluateArtifactIntegrity({
        resultPath,
        caseEntry,
        replicate,
      });
      const evaluation = evaluateFields(parsed, contract, {
        semanticAdjudication: adjudication !== null,
      });
      evaluation.structural_issues = unique([
        ...evaluation.structural_issues,
        ...artifactIssues,
      ]);
      evaluation.structural_pass = evaluation.structural_pass && artifactIssues.length === 0;
      replicates.push({
        replicate_index: replicate.replicate_index,
        job_id: replicate.job_id,
        terminal_status: replicate.terminal_status,
        result: path.relative(resolvedRoot, resultPath).split(path.sep).join('/'),
        evaluation,
      });
    }
    cases.push({
      case_id: caseEntry.case_id,
      procurement_key: caseEntry.procurement_key,
      adjudication_version: adjudication?.baseline_version ?? null,
      replicate_count: replicates.length,
      replicates,
    });
  }
  const replicateEvaluations = cases.flatMap((entry) =>
    entry.replicates.map(({ evaluation }) => evaluation));
  return {
    ok: true,
    evaluation_format: index.schema_version,
    batch_id: index.batch_id,
    case_count: cases.length,
    replicate_count: replicateEvaluations.length,
    all_structural_pass: replicateEvaluations.every(({ structural_pass: pass }) => pass),
    all_cases_adjudicated: cases.every(({ adjudication_version: version }) => version !== null),
    cases,
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

export async function evaluateAgenticPath(inputPath) {
  const resolved = path.resolve(inputPath);
  const inputStat = await stat(resolved);
  return inputStat.isDirectory()
    ? evaluateAgenticEvaluationRoot(resolved)
    : evaluateAgenticResult(resolved);
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new TypedEvaluationError(
      'invalid-invocation',
      'INPUT_PATH_REQUIRED',
      'Usage: node scripts/evaluate-agentic-result.mjs <result.md|result.json|evaluation-root>',
    );
  }
  const result = await evaluateAgenticPath(path.resolve(inputPath));
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
