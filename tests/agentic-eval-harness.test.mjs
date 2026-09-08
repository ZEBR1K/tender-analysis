import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
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
    inspection_coverage: [],
    fields: adjudication.fields.map((field) => ({
      field_index: field.field_index,
      field_key: field.field_key,
      status: field.accepted_statuses[0],
      value_text: field.accepted_statuses[0] === 'not_found' ? null : 'fixture',
      claim_basis: 'explicit_positive',
      evidence: [],
      conflicts: [],
      rationale: 'Evaluator adapter fixture only.',
    })),
  };
}

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
  const resultJson = {
    schema_version: 'tender_agent_result_v1',
    fields: adjudication.fields.map((field) => ({
      field_index: field.field_index,
      field_key: field.field_key,
      status: field.accepted_statuses[0],
      value_text:
        field.field_key === 'procurement_subject'
          ? 'Один комплект, включающий 12 крышек шести позиций.'
          : field.accepted_statuses[0] === 'not_found'
            ? null
            : 'fixture',
      claim_basis: 'explicit_positive',
      evidence: [],
      conflicts: [],
      rationale: 'Evaluator derived quantity fixture.',
    })),
  };

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
  resultJson.inspection_coverage = {};
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
      'INSPECTION_COVERAGE_INVALID',
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
