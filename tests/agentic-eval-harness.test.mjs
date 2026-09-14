import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..');
const archiveRoot = path.join(
  repositoryRoot,
  'evaluations',
  'codex-agentic-blind-test-2026-09-08',
);
const baselineRoot = path.join(
  repositoryRoot,
  'evaluations',
  'agentic-baseline-v0',
);
const adjudicationPath = path.join(baselineRoot, 'adjudication.json');
const manifestPath = path.join(baselineRoot, 'source-manifest.sha256');
const readmePath = path.join(baselineRoot, 'README.md');
const blindGateRoot = path.join(
  repositoryRoot,
  'evaluations',
  'agentic-blind-tests-v1',
);
const blindGateReadmePath = path.join(blindGateRoot, 'README.md');
const blindGateCasesPath = path.join(blindGateRoot, 'cases.json');
const evaluatorPath = path.join(
  repositoryRoot,
  'scripts',
  'evaluate-agentic-result.mjs',
);

const catalogKeys = [
  'procurement_subject',
  'nm_price_with_vat',
  'platform',
  'procedure_type',
  'application_deadline',
  'application_review_date',
  'results_date',
  'customer',
  'customer_contacts',
  'participation_cost',
  'participation_guarantee',
  'evaluation_criteria',
  'delivery_term',
  'payment_terms',
  'special_account_or_treasury',
  'bank_support',
  'government_contract',
  'rebidding',
  'national_regime',
  'advance_contract_guarantee',
  'warranty_obligations_guarantee',
  'licenses_certificates',
  'required_official_certificates',
  'similar_supply_experience',
  'analog_allowed',
  'analog_definition',
  'application_documents',
];

const archivedRuns = [
  {
    id: 'run_1',
    path: path.join(archiveRoot, 'raw', 'run-1', 'codex-result.md'),
    criticalFalseResolved: 3,
  },
  {
    id: 'run_2',
    path: path.join(archiveRoot, 'raw', 'run-2', 'codex-result.md'),
    criticalFalseResolved: 1,
  },
  {
    id: 'run_3',
    path: path.join(archiveRoot, 'raw', 'run-3', 'codex-result.md'),
    criticalFalseResolved: 3,
  },
  {
    id: 'exec',
    path: path.join(archiveRoot, 'raw', 'exec', 'codex-result.md'),
    criticalFalseResolved: 2,
  },
];

async function loadAdjudication() {
  await stat(adjudicationPath);
  return JSON.parse(await readFile(adjudicationPath, 'utf8'));
}

function runEvaluator(inputPath) {
  const result = spawnSync(process.execPath, [evaluatorPath, inputPath], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
  let output;
  try {
    output = JSON.parse(result.stdout);
  } catch (error) {
    assert.fail(
      `evaluator stdout must be JSON; exit=${result.status}; stdout=${result.stdout}; stderr=${result.stderr}; parse=${error.message}`,
    );
  }
  return { ...result, output };
}

function buildFutureJson(adjudication) {
  return {
    schema_version: 'tender_agent_result_v1',
    field_catalog_version: 'tender_fields_v1',
    field_catalog_sha256: 'a'.repeat(64),
    input_manifest_sha256: 'b'.repeat(64),
    inspected_documents: [
      {
        artifact_key: 'doc-0001',
        inspected_parts: ['fixture document'],
        methods: ['fixture read'],
        notes: 'Offline evaluator adapter fixture only.',
      },
    ],
    limitations: [],
    constraints: ['Offline evaluator fixture; no source truth is implied.'],
    fields: adjudication.fields.map((field) => ({
      field_index: field.field_index,
      field_key: field.field_key,
      status: field.accepted_statuses[0],
      value_text: field.accepted_statuses[0] === 'not_found' ? null : 'fixture',
      evidence: [],
      rationale: 'Evaluator adapter fixture only.',
    })),
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fixtureUuid(identity) {
  const bytes = createHash('sha256').update(identity, 'utf8').digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

async function writeEvaluationReplicate({
  replicateDirectory,
  result,
  batchId,
  caseId,
  procurementKey,
  replicateIndex,
}) {
  const jobId = fixtureUuid(`${batchId}:${caseId}:${replicateIndex}:job`);
  const analysisRunId = fixtureUuid(`${batchId}:${caseId}:${replicateIndex}:run`);
  const rawResultBytes = Buffer.from(`${JSON.stringify(result)}\n`, 'utf8');
  const validation = {
    schema_version: 'tender_agent_validation_v1',
    job_id: jobId,
    valid: true,
    job_issues: [],
    fields: result.fields.map((field) => ({
      field_index: field.field_index,
      field_key: field.field_key,
      status: field.status,
      value_text: field.value_text,
      issues: [],
    })),
    raw_result_sha256: sha256Bytes(rawResultBytes),
    validated_result_sha256: sha256Bytes(Buffer.from(canonicalJson(result), 'utf8')),
  };
  const validationBytes = Buffer.from(`${canonicalJson(validation)}\n`, 'utf8');
  const stateBytes = Buffer.from(`${JSON.stringify({
    manifest: {
      job_id: jobId,
      analysis_run_id: analysisRunId,
    },
    status: 'completed',
    result: {
      attempt: 1,
      raw_result_sha256: validation.raw_result_sha256,
      validated_result_sha256: validation.validated_result_sha256,
      validation_file_sha256: sha256Bytes(validationBytes),
    },
  })}\n`, 'utf8');
  const eventsBytes = Buffer.from('{"type":"fixture"}\n', 'utf8');
  const auditDirectory = path.join(replicateDirectory, 'job', 'audit');
  await mkdir(auditDirectory, { recursive: true });
  const archivedFiles = [
    ['audit/codex-events.attempt-1.jsonl', eventsBytes],
    ['audit/validated-result.attempt-1.json', rawResultBytes],
    ['audit/validation.attempt-1.json', validationBytes],
    ['job-state.json', stateBytes],
  ];
  for (const [relativePath, bytes] of archivedFiles) {
    await writeFile(path.join(replicateDirectory, 'job', ...relativePath.split('/')), bytes);
  }
  await writeFile(path.join(replicateDirectory, 'result.json'), rawResultBytes);
  await writeFile(
    path.join(replicateDirectory, 'validation.json'),
    `${JSON.stringify(validation)}\n`,
    'utf8',
  );
  await writeFile(
    path.join(replicateDirectory, 'terminal-status.json'),
    `${JSON.stringify({
      job_id: jobId,
      status: 'completed',
      attempt: 1,
      input_manifest_sha256: result.input_manifest_sha256,
    })}\n`,
    'utf8',
  );
  await writeFile(
    path.join(replicateDirectory, 'run-metadata.json'),
    `${JSON.stringify({
      schema_version: 'agentic_shadow_run_metadata_v1',
      batch_id: batchId,
      case_id: caseId,
      procurement_key: procurementKey,
      replicate_index: replicateIndex,
      job_id: jobId,
      analysis_run_id: analysisRunId,
      pipeline_version: 'tender_agentic_pipeline_v1',
      input_manifest_sha256: result.input_manifest_sha256,
      controls: {
        field_catalog_sha256: result.field_catalog_sha256,
      },
      terminal_status: 'completed',
    })}\n`,
    'utf8',
  );
  const files = archivedFiles
    .map(([relativePath, bytes]) => ({
      path: relativePath,
      byte_size: bytes.length,
      sha256: sha256Bytes(bytes),
    }))
    .sort((left, right) => left.path.localeCompare(right.path, 'en'));
  await writeFile(
    path.join(replicateDirectory, 'archive-sha256.json'),
    `${JSON.stringify({
      schema_version: 'agentic_shadow_archive_inventory_v1',
      job_id: jobId,
      file_count: files.length,
      files,
    })}\n`,
    'utf8',
  );
  return jobId;
}

test('multi-procurement blind gate is explicit, immutable and nonblocking', async () => {
  const [readme, casesSource] = await Promise.all([
    readFile(blindGateReadmePath, 'utf8'),
    readFile(blindGateCasesPath, 'utf8'),
  ]);
  const gate = JSON.parse(casesSource);

  assert.equal(gate.schema_version, 'agentic_blind_test_cases_v1');
  assert.equal(gate.runtime_blocking, false);
  assert.equal(gate.runtime_semantic_rules_allowed, false);
  assert.equal(gate.minimum_distinct_procurements, 2);
  assert.equal(gate.current_distinct_procurements, 1);
  assert.equal(gate.status, 'awaiting_additional_procurements');
  assert.equal(gate.cases.length, 1);
  const distinctProcurements = new Set(
    gate.cases.map(({ procurement_key }) => procurement_key),
  ).size;
  assert.equal(distinctProcurements, gate.current_distinct_procurements);
  assert.ok(distinctProcurements < gate.minimum_distinct_procurements);

  const available = gate.cases[0];
  assert.equal(available.case_id, 'blind-2026-09-08');
  assert.equal(available.replicates.length, 4);
  assert.equal(available.source_manifest, 'evaluations/agentic-baseline-v0/source-manifest.sha256');
  assert.equal(available.adjudication, 'evaluations/agentic-baseline-v0/adjudication.json');
  assert.equal(available.source_grounded_gold, false);
  assert.equal(available.runtime_rule_eligible, false);
  for (const relativePath of [
    available.input_root,
    available.source_manifest,
    available.adjudication,
    ...available.replicates,
  ]) {
    await stat(path.join(repositoryRoot, ...relativePath.split('/')));
  }

  for (const forbiddenKey of [
    'source_index',
    'parsed_pages',
    'ooxml_parts',
    'xlsx_sheets',
    'expected_pages',
    'inspected_pages',
  ]) {
    assert.equal(casesSource.includes(`\"${forbiddenKey}\"`), false, forbiddenKey);
  }

  assert.match(readme, /skill[- ]first/iu);
  assert.match(readme, /does not block|не блокирует/iu);
  assert.match(readme, /procurement-02[\s\S]{0,120}procurement-03/iu);
  assert.match(readme, /outside Git|вне Git/iu);
  assert.match(readme, /not an authoritative[\s-]+semantic gold set|не является[^\n]+эталон/iu);
  assert.match(readme, /Do not promote|не перенос/iu);
});

test('blind gate requires repeated cross-procurement evidence before a runtime semantic rule', async () => {
  const gate = JSON.parse(await readFile(blindGateCasesPath, 'utf8'));
  assert.deepEqual(gate.rule_admission_criteria, [
    'reproduced_across_distinct_procurements',
    'survives_skill_only_remediation',
    'does_not_duplicate_codex_reasoning',
    'protects_security_file_integrity_or_json_contract',
  ]);
  assert.deepEqual(gate.repeatability_controls, [
    'same_model',
    'same_reasoning_effort',
    'same_prompt',
    'same_skill',
    'same_schema',
    'same_original_file_hashes',
  ]);
});

test('provisional baseline v0 declares its limits and exact 27-field catalog contract', async () => {
  const [readme, adjudication] = await Promise.all([
    readFile(readmePath, 'utf8'),
    loadAdjudication(),
  ]);

  assert.match(readme, /provisional/iu);
  assert.match(readme, /four|четыр/u);
  assert.match(readme, /comparison\.md/iu);
  assert.match(readme, /not (?:a )?gold|не является (?:gold|полной)/iu);
  assert.match(readme, /production acceptance gate/iu);

  assert.equal(adjudication.baseline_version, 'agentic_baseline_v0');
  assert.equal(adjudication.production_acceptance_gate, false);
  assert.equal(adjudication.fields.length, 27);
  assert.deepEqual(
    adjudication.fields.map(({ field_index: index }) => index),
    Array.from({ length: 27 }, (_, index) => index + 1),
  );
  assert.deepEqual(
    adjudication.fields.map(({ field_key: key }) => key),
    catalogKeys,
  );

  for (const field of adjudication.fields) {
    assert.deepEqual(Object.keys(field.reported_statuses).sort(), [
      'exec',
      'run_1',
      'run_2',
      'run_3',
    ]);
    assert.ok(field.accepted_statuses.length >= 1);
    assert.ok(
      ['source_checked', 'cross_run_consensus', 'known_disagreement'].includes(
        field.confidence,
      ),
    );
    assert.ok(
      ['comparison_spot_checked', 'not_source_verified'].includes(
        field.source_check_status,
      ),
    );
    assert.ok(Array.isArray(field.mandatory_material_facts));
    assert.ok(Array.isArray(field.forbidden_conclusions));
    assert.ok(Array.isArray(field.source_anchors));
    assert.equal(typeof field.notes, 'string');
    if (field.source_check_status === 'not_source_verified') {
      assert.deepEqual(field.source_anchors, []);
    }
  }

  assert.equal(
    adjudication.fields.filter(({ confidence }) => confidence === 'known_disagreement')
      .length,
    5,
  );
  assert.equal(
    adjudication.fields.filter(({ confidence }) => confidence === 'cross_run_consensus')
      .length,
    20,
  );
});

test('baseline v0 preserves all required comparison spot-check decisions', async () => {
  const adjudication = await loadAdjudication();
  const byKey = new Map(adjudication.fields.map((field) => [field.field_key, field]));

  assert.deepEqual(byKey.get('customer_contacts').accepted_statuses, ['resolved']);
  assert.deepEqual(byKey.get('participation_cost').accepted_statuses, ['not_found']);
  assert.deepEqual(byKey.get('national_regime').accepted_statuses, [
    'requires_review',
  ]);
  assert.ok(
    byKey
      .get('national_regime')
      .forbidden_conclusions.some((item) => /resolved/iu.test(item.conclusion)),
  );
  assert.deepEqual(byKey.get('similar_supply_experience').accepted_statuses, [
    'requires_review',
  ]);
  assert.deepEqual(byKey.get('application_documents').accepted_statuses, [
    'requires_review',
  ]);

  const subject = byKey.get('procurement_subject');
  assert.ok(
    subject.mandatory_material_facts.some((item) => /11/iu.test(item.fact)),
  );
  assert.ok(
    subject.forbidden_conclusions.some((item) => /10/iu.test(item.conclusion)),
  );

  const licenses = byKey.get('licenses_certificates');
  for (const forbidden of [
    /разреш/iu,
    /свидетель/iu,
    /паспорт/iu,
    /банка-гаранта/iu,
  ]) {
    assert.ok(
      licenses.forbidden_conclusions.some((item) =>
        forbidden.test(item.conclusion),
      ),
    );
  }
});

test('source manifest pins the archived catalog and all 12 source documents', async () => {
  const lines = (await readFile(manifestPath, 'utf8'))
    .split(/\r?\n/u)
    .filter(Boolean);

  assert.equal(lines.length, 13);
  const parsed = lines.map((line) => {
    const match = /^(?<hash>[a-f0-9]{64}) {2}(?<file>.+)$/u.exec(line);
    assert.ok(match, `invalid sha256 manifest line: ${line}`);
    return match.groups;
  });
  assert.equal(
    parsed.filter(({ file }) => file.includes('/inputs/documents/')).length,
    12,
  );
  assert.equal(
    parsed.filter(({ file }) => file.endsWith('/inputs/FIELD_CATALOG.md')).length,
    1,
  );

  for (const { hash, file } of parsed) {
    const bytes = await readFile(path.join(repositoryRoot, ...file.split('/')));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, file);
  }
});

test('typed legacy adapter evaluates all four immutable Markdown variants', async () => {
  for (const archivedRun of archivedRuns) {
    const result = runEvaluator(archivedRun.path);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output.ok, true);
    assert.equal(result.output.input_format, 'legacy_markdown_v0');
    assert.equal(result.output.structural_pass, true);
    assert.equal(result.output.field_count, 27);
    assert.equal(result.output.field_diffs.length, 27);
    assert.equal(
      result.output.critical_false_resolved_count,
      archivedRun.criticalFalseResolved,
      archivedRun.id,
    );
    assert.equal(result.output.unsupported_negative_count, 0);
    assert.equal(result.output.evidence_verification_rate, null);
    assert.ok(result.output.baseline_limitations.length >= 3);
  }
});

test('legacy evaluation exposes the known status disagreements and critical errors', () => {
  const outputs = Object.fromEntries(
    archivedRuns.map(({ id, path: inputPath }) => [id, runEvaluator(inputPath).output]),
  );
  const diff = (runId, fieldKey) =>
    outputs[runId].field_diffs.find(({ field_key: key }) => key === fieldKey);

  assert.equal(diff('exec', 'customer_contacts').status_agreement, false);
  assert.equal(diff('run_2', 'participation_cost').status_agreement, false);
  assert.ok(diff('run_1', 'procurement_subject').issues.includes('FORBIDDEN_CONCLUSION'));
  assert.ok(diff('run_1', 'similar_supply_experience').issues.includes('CRITICAL_FALSE_RESOLVED'));
  assert.ok(diff('run_3', 'national_regime').issues.includes('CRITICAL_FALSE_RESOLVED'));
  assert.ok(diff('run_3', 'application_documents').issues.includes('CRITICAL_FALSE_RESOLVED'));
  for (const runId of ['run_1', 'run_2', 'run_3', 'exec']) {
    assert.ok(
      diff(runId, 'licenses_certificates').issues.includes('FORBIDDEN_CONCLUSION'),
      runId,
    );
  }
});

test('future tender_agent_result_v1 JSON uses an explicit typed adapter', async () => {
  const adjudication = await loadAdjudication();
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'agentic-evaluator-'),
  );
  const inputPath = path.join(temporaryDirectory, 'result.json');
  const resultJson = buildFutureJson(adjudication);

  try {
    await writeFile(inputPath, `${JSON.stringify(resultJson)}\n`, 'utf8');
    const result = runEvaluator(inputPath);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output.ok, true);
    assert.equal(result.output.input_format, 'tender_agent_result_v1_json');
    assert.equal(result.output.structural_pass, true);
    assert.equal(result.output.field_count, 27);
    assert.equal(result.output.status_agreement.matched_fields, 27);
    assert.equal(result.output.critical_false_resolved_count, 0);
    assert.equal(result.output.evidence_verification_rate, null);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('derived procurement lid quantity is checked exactly when JSON reports it', async () => {
  const adjudication = await loadAdjudication();
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'agentic-evaluator-'),
  );
  const inputPath = path.join(temporaryDirectory, 'wrong-derived-quantity.json');
  const resultJson = buildFutureJson(adjudication);
  resultJson.fields.find(({ field_key: key }) => key === 'procurement_subject').value_text =
    'Один комплект, включающий 12 крышек шести позиций.';

  try {
    await writeFile(inputPath, `${JSON.stringify(resultJson)}\n`, 'utf8');
    const result = runEvaluator(inputPath);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output.critical_false_resolved_count, 1);
    const subject = result.output.field_diffs.find(
      ({ field_key: key }) => key === 'procurement_subject',
    );
    assert.ok(subject.issues.includes('FORBIDDEN_CONCLUSION'));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('status agreement requires the exact baseline field index and key mapping', async () => {
  const adjudication = await loadAdjudication();
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'agentic-evaluator-'),
  );
  const inputPath = path.join(temporaryDirectory, 'mismatched-key.json');
  const resultJson = buildFutureJson(adjudication);
  resultJson.fields[0].field_key = 'unexpected_subject_key';

  try {
    await writeFile(inputPath, `${JSON.stringify(resultJson)}\n`, 'utf8');
    const result = runEvaluator(inputPath);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output.structural_pass, false);
    assert.equal(result.output.status_agreement.matched_fields, 26);
    const malformed = result.output.field_diffs.find(
      ({ field_key: key }) => key === 'unexpected_subject_key',
    );
    assert.ok(malformed);
    assert.equal(malformed.status_agreement, false);
    assert.ok(malformed.issues.includes('FIELD_KEY_MISMATCH'));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('every duplicate index occurrence is reported and contributes critical diagnostics', async () => {
  const adjudication = await loadAdjudication();
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'agentic-evaluator-'),
  );
  const inputPath = path.join(temporaryDirectory, 'duplicate-index.json');
  const resultJson = buildFutureJson(adjudication);
  const nationalRegimeIndex = resultJson.fields.findIndex(
    ({ field_key: key }) => key === 'national_regime',
  );
  resultJson.fields.splice(nationalRegimeIndex, 0, {
    ...structuredClone(resultJson.fields[nationalRegimeIndex]),
    status: 'resolved',
    value_text: 'Не применяется.',
  });

  try {
    await writeFile(inputPath, `${JSON.stringify(resultJson)}\n`, 'utf8');
    const result = runEvaluator(inputPath);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output.structural_pass, false);
    assert.equal(result.output.field_count, 28);
    assert.equal(result.output.field_diffs.length, 28);
    const duplicates = result.output.field_diffs.filter(
      ({ field_key: key }) => key === 'national_regime',
    );
    assert.equal(duplicates.length, 2);
    assert.ok(duplicates.every(({ status_agreement: agreement }) => !agreement));
    assert.ok(
      duplicates.every(({ issues }) => issues.includes('DUPLICATE_FIELD_INDEX')),
    );
    assert.ok(
      duplicates.every(({ issues }) => issues.includes('DUPLICATE_FIELD_KEY')),
    );
    assert.equal(result.output.critical_false_resolved_count, 1);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('malformed controlled JSON identity and field entries fail structurally without a generic crash', async () => {
  const adjudication = await loadAdjudication();
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'agentic-evaluator-'),
  );
  const inputPath = path.join(temporaryDirectory, 'malformed-result.json');
  const resultJson = buildFutureJson(adjudication);
  resultJson.field_catalog_version = 42;
  resultJson.field_catalog_sha256 = 'not-a-sha';
  resultJson.input_manifest_sha256 = null;
  resultJson.inspected_documents = {};
  resultJson.limitations = null;
  resultJson.constraints = {};
  resultJson.fields[0] = {
    field_index: {},
    field_key: [],
    status: null,
    value_text: {},
  };

  try {
    await writeFile(inputPath, `${JSON.stringify(resultJson)}\n`, 'utf8');
    const result = runEvaluator(inputPath);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output.ok, true);
    assert.equal(result.output.input_format, 'tender_agent_result_v1_json');
    assert.equal(result.output.structural_pass, false);
    assert.deepEqual(result.output.structural_issues, [
      'FIELD_CATALOG_VERSION_INVALID',
      'FIELD_CATALOG_SHA256_INVALID',
      'INPUT_MANIFEST_SHA256_INVALID',
      'INSPECTED_DOCUMENTS_INVALID',
      'LIMITATIONS_INVALID',
      'CONSTRAINTS_INVALID',
      'FIELD_ENTRY_INVALID',
    ]);
    assert.ok(
      result.output.field_diffs.some(({ issues }) =>
        issues.includes('FIELD_ENTRY_INVALID'),
      ),
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('unexpected input returns a typed unsupported-format error and nonzero exit', async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'agentic-evaluator-'),
  );
  const inputPath = path.join(temporaryDirectory, 'unexpected.txt');

  try {
    await writeFile(inputPath, 'not a tender result\n', 'utf8');
    const result = runEvaluator(inputPath);
    assert.notEqual(result.status, 0);
    assert.deepEqual(result.output, {
      ok: false,
      error: {
        type: 'unsupported-format',
        code: 'UNSUPPORTED_FORMAT',
        message: 'Input is neither tender_agent_result_v1 JSON nor supported legacy Markdown.',
      },
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('evaluation root supports multiple procurements, independent adjudications and replicates', async () => {
  const baseline = await loadAdjudication();
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'agentic-evaluation-root-'),
  );
  const cases = [
    { caseId: 'procurement-02', replicateCount: 2, acceptedSubjectStatus: 'resolved' },
    { caseId: 'procurement-03', replicateCount: 3, acceptedSubjectStatus: 'requires_review' },
  ];

  try {
    const index = {
      schema_version: 'agentic_shadow_evaluation_index_v1',
      batch_id: 'offline-multi-case-fixture',
      cases: [],
    };
    for (const item of cases) {
      const caseDirectory = path.join(temporaryDirectory, 'cases', item.caseId);
      await mkdir(caseDirectory, { recursive: true });
      const adjudication = structuredClone(baseline);
      adjudication.baseline_version = `${item.caseId}-manual-v1`;
      adjudication.fields[0].accepted_statuses = [item.acceptedSubjectStatus];
      await writeFile(
        path.join(caseDirectory, 'adjudication.json'),
        `${JSON.stringify(adjudication)}\n`,
        'utf8',
      );
      const replicates = [];
      for (let replicateIndex = 1; replicateIndex <= item.replicateCount; replicateIndex += 1) {
        const replicateDirectory = path.join(
          caseDirectory,
          `replicate-${String(replicateIndex).padStart(2, '0')}`,
        );
        await mkdir(replicateDirectory, { recursive: true });
        const result = buildFutureJson(adjudication);
        result.fields[0].status = item.acceptedSubjectStatus;
        result.fields[0].value_text = 'fixture';
        const jobId = await writeEvaluationReplicate({
          replicateDirectory,
          result,
          batchId: index.batch_id,
          caseId: item.caseId,
          procurementKey: item.caseId,
          replicateIndex,
        });
        replicates.push({
          replicate_index: replicateIndex,
          job_id: jobId,
          terminal_status: 'completed',
          result: `cases/${item.caseId}/replicate-${String(replicateIndex).padStart(2, '0')}/result.json`,
        });
      }
      index.cases.push({
        case_id: item.caseId,
        procurement_key: item.caseId,
        adjudication: `cases/${item.caseId}/adjudication.json`,
        replicates,
      });
    }
    await writeFile(
      path.join(temporaryDirectory, 'evaluation-index.json'),
      `${JSON.stringify(index)}\n`,
      'utf8',
    );

    const evaluated = runEvaluator(temporaryDirectory);
    assert.equal(evaluated.status, 0, evaluated.stderr);
    assert.equal(evaluated.output.ok, true);
    assert.equal(
      evaluated.output.evaluation_format,
      'agentic_shadow_evaluation_index_v1',
    );
    assert.equal(evaluated.output.case_count, 2);
    assert.equal(evaluated.output.replicate_count, 5);
    assert.equal(evaluated.output.all_structural_pass, true);
    assert.equal(evaluated.output.all_cases_adjudicated, true);
    assert.deepEqual(
      evaluated.output.cases.map(({ case_id: caseId, replicate_count: count }) => [caseId, count]),
      [['procurement-02', 2], ['procurement-03', 3]],
    );
    assert.deepEqual(
      evaluated.output.cases.map(({ adjudication_version: version }) => version),
      ['procurement-02-manual-v1', 'procurement-03-manual-v1'],
    );
    assert.ok(
      evaluated.output.cases.every(({ replicates }) =>
        replicates.every(({ evaluation }) => evaluation.status_agreement.matched_fields === 27)),
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('evaluation root never substitutes baseline v0 when a case has no adjudication', async () => {
  const baseline = await loadAdjudication();
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'agentic-evaluation-unadjudicated-'),
  );

  try {
    const resultDirectory = path.join(temporaryDirectory, 'cases', 'new-case', 'replicate-01');
    await mkdir(resultDirectory, { recursive: true });
    const jobId = await writeEvaluationReplicate({
      replicateDirectory: resultDirectory,
      result: buildFutureJson(baseline),
      batchId: 'unadjudicated-fixture',
      caseId: 'new-case',
      procurementKey: 'new-procurement',
      replicateIndex: 1,
    });
    await writeFile(
      path.join(temporaryDirectory, 'evaluation-index.json'),
      `${JSON.stringify({
        schema_version: 'agentic_shadow_evaluation_index_v1',
        batch_id: 'unadjudicated-fixture',
        cases: [{
          case_id: 'new-case',
          procurement_key: 'new-procurement',
          adjudication: null,
          replicates: [{
            replicate_index: 1,
            job_id: jobId,
            terminal_status: 'completed',
            result: 'cases/new-case/replicate-01/result.json',
          }],
        }],
      })}\n`,
      'utf8',
    );

    const evaluated = runEvaluator(temporaryDirectory);
    assert.equal(evaluated.status, 0, evaluated.stderr);
    assert.equal(evaluated.output.all_structural_pass, true);
    assert.equal(evaluated.output.all_cases_adjudicated, false);
    const caseResult = evaluated.output.cases[0];
    assert.equal(caseResult.adjudication_version, null);
    assert.equal(caseResult.replicates[0].evaluation.baseline_version, null);
    assert.equal(caseResult.replicates[0].evaluation.status_agreement, null);
    assert.equal(caseResult.replicates[0].evaluation.critical_false_resolved_count, null);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('evaluation index requires an explicit job identity for every replicate', async () => {
  const baseline = await loadAdjudication();
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'agentic-evaluation-job-id-'));
  try {
    const resultDirectory = path.join(temporaryDirectory, 'cases', 'missing-job', 'replicate-01');
    await mkdir(resultDirectory, { recursive: true });
    await writeFile(
      path.join(resultDirectory, 'result.json'),
      `${JSON.stringify(buildFutureJson(baseline))}\n`,
      'utf8',
    );
    await writeFile(
      path.join(temporaryDirectory, 'evaluation-index.json'),
      `${JSON.stringify({
        schema_version: 'agentic_shadow_evaluation_index_v1',
        batch_id: 'missing-job-fixture',
        cases: [{
          case_id: 'missing-job',
          procurement_key: 'missing-job',
          adjudication: null,
          replicates: [{
            replicate_index: 1,
            terminal_status: 'completed',
            result: 'cases/missing-job/replicate-01/result.json',
          }],
        }],
      })}\n`,
      'utf8',
    );

    const evaluated = runEvaluator(temporaryDirectory);
    assert.notEqual(evaluated.status, 0);
    assert.equal(evaluated.output.error.code, 'EVALUATION_INDEX_INVALID');
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
