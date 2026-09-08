import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..');
const runnerRoot = path.join(repositoryRoot, 'deploy', 'codex-runner');
const validationModuleUrl = pathToFileURL(
  path.join(runnerRoot, 'src', 'schema-validation.mjs'),
).href;
const fixturesRoot = path.join(
  repositoryRoot,
  'tests',
  'fixtures',
  'agentic',
  'results',
);
const policyPath = path.join(
  runnerRoot,
  'policies',
  'tender-fields-v1.json',
);
const rootCatalogPath = path.join(repositoryRoot, 'FIELD_CATALOG.md');
const blindCatalogRelativePath =
  'evaluations/codex-agentic-blind-test-2026-09-08/inputs/FIELD_CATALOG.md';
const blindCatalogPath = path.join(
  repositoryRoot,
  ...blindCatalogRelativePath.split('/'),
);

const canonicalFields = [
  [1, 'procurement_subject'],
  [2, 'nm_price_with_vat'],
  [3, 'platform'],
  [4, 'procedure_type'],
  [5, 'application_deadline'],
  [6, 'application_review_date'],
  [7, 'results_date'],
  [8, 'customer'],
  [9, 'customer_contacts'],
  [10, 'participation_cost'],
  [11, 'participation_guarantee'],
  [12, 'evaluation_criteria'],
  [13, 'delivery_term'],
  [14, 'payment_terms'],
  [15, 'special_account_or_treasury'],
  [16, 'bank_support'],
  [17, 'government_contract'],
  [18, 'rebidding'],
  [19, 'national_regime'],
  [20, 'advance_contract_guarantee'],
  [21, 'warranty_obligations_guarantee'],
  [22, 'licenses_certificates'],
  [23, 'required_official_certificates'],
  [24, 'similar_supply_experience'],
  [25, 'analog_allowed'],
  [26, 'analog_definition'],
  [27, 'application_documents'],
];

let validatorsPromise;

async function getValidators() {
  validatorsPromise ??= import(validationModuleUrl).then(
    ({ createSchemaValidators }) => createSchemaValidators(),
  );
  return validatorsPromise;
}

async function loadJson(relativeName) {
  return JSON.parse(
    await readFile(path.join(fixturesRoot, relativeName), 'utf8'),
  );
}

function clone(value) {
  return structuredClone(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex').toUpperCase();
}

function parseCatalogMatrix(source) {
  return [...source.matchAll(/^\|\s*(\d+)\s*\|\s*`([^`]+)`\s*\|/gmu)]
    .map((match) => [Number(match[1]), match[2]])
    .filter(([index]) => index >= 1 && index <= 27);
}

function buildValidationEnvelope(result) {
  return {
    schema_version: 'tender_agent_validation_v1',
    job_id: '123e4567-e89b-42d3-a456-426614174000',
    valid: true,
    job_issues: [],
    fields: result.fields.map((field) => ({
      field_index: field.field_index,
      field_key: field.field_key,
      reported_status: field.status,
      effective_status: field.status,
      reported_value_text: field.value_text,
      effective_value_text: field.value_text,
      validation_level: 'pass',
      issues: [],
    })),
    raw_result_sha256: 'c'.repeat(64),
    validated_result_sha256: 'd'.repeat(64),
  };
}

function issueCodes(validation) {
  return validation.issues.map(({ code }) => code);
}

test('strict Ajv boundary compiles and accepts the closed result and validation contracts', async () => {
  const [validators, result] = await Promise.all([
    getValidators(),
    loadJson('valid-27.json'),
  ]);

  assert.equal(validators.draft, '2020-12');
  assert.equal(validators.strict, true);

  const resultValidation = validators.validateResult(result);
  assert.equal(resultValidation.schema_valid, true);
  assert.deepEqual(resultValidation.issues, []);
  assert.equal(resultValidation.valid, true);

  const envelopeValidation = validators.validateValidationEnvelope(
    buildValidationEnvelope(result),
  );
  assert.equal(envelopeValidation.schema_valid, true);
  assert.deepEqual(envelopeValidation.issues, []);
  assert.equal(envelopeValidation.valid, true);
});

test('result catalog hash must match the policy-pinned catalog identity', async () => {
  const validators = await getValidators();
  const result = await loadJson('valid-27.json');
  assert.equal(
    result.field_catalog_sha256,
    'ABCBEA68911CE9FFAD9D436C9EABE708E12DBC4F04F7D5591CAFE4C58359B843',
  );
  result.field_catalog_sha256 = 'f'.repeat(64);

  const validation = validators.validateResult(result);
  assert.equal(validation.schema_valid, true);
  assert.equal(validation.valid, false);
  assert.deepEqual(validation.issues, [
    {
      code: 'CATALOG_HASH_MISMATCH',
      message: 'field_catalog_sha256 does not match the policy-pinned catalog.',
      path: '/field_catalog_sha256',
    },
  ]);
});

test('exact-quote and ordered-fragment result fixtures are both accepted', async () => {
  const validators = await getValidators();
  const [exact, ellipsis] = await Promise.all([
    loadJson('valid-27.json'),
    loadJson('ellipsis-valid.json'),
  ]);

  assert.equal(validators.validateResult(exact).valid, true);
  assert.equal(validators.validateResult(ellipsis).valid, true);
  assert.deepEqual(ellipsis.fields[0].evidence[0].fragments, [
    'Supply',
    'equipment',
  ]);
});

test('missing field fails the exact 27-field semantic contract', async () => {
  const validators = await getValidators();
  const result = await loadJson('valid-27.json');
  result.fields.pop();

  const validation = validators.validateResult(result);
  assert.equal(validation.valid, false);
  assert.ok(issueCodes(validation).includes('FIELD_SET_MISMATCH'));
});

test('duplicate field key and index are reported as typed deterministic issues', async () => {
  const validators = await getValidators();
  const result = await loadJson('duplicate-field.json');

  const validation = validators.validateResult(result);
  assert.equal(validation.schema_valid, true);
  assert.equal(validation.valid, false);
  assert.deepEqual(
    validation.issues
      .filter(({ code }) => code === 'DUPLICATE_FIELD')
      .map(({ dimension }) => dimension)
      .sort(),
    ['field_index', 'field_key'],
  );
  assert.ok(issueCodes(validation).includes('FIELD_SET_MISMATCH'));
});

test('unknown status fails with STATUS_INVALID', async () => {
  const validators = await getValidators();
  const result = await loadJson('valid-27.json');
  result.fields[0].status = 'maybe';

  const validation = validators.validateResult(result);
  assert.equal(validation.valid, false);
  assert.ok(issueCodes(validation).includes('STATUS_INVALID'));
});

test('resolved requires both a nonblank value and at least one evidence item', async () => {
  const validators = await getValidators();
  const result = await loadJson('valid-27.json');
  result.fields[0].value_text = null;
  result.fields[0].evidence = [];

  const validation = validators.validateResult(result);
  assert.equal(validation.valid, false);
  assert.ok(issueCodes(validation).includes('VALUE_REQUIRED'));
});

test('not_found cannot carry a value', async () => {
  const validators = await getValidators();
  const result = await loadJson('valid-27.json');
  result.fields[1].value_text = 'No';

  const validation = validators.validateResult(result);
  assert.equal(validation.valid, false);
  assert.ok(issueCodes(validation).includes('VALUE_REQUIRED'));
});

test('location variants reject kind-specific invalid coordinates', async () => {
  const validators = await getValidators();
  const result = await loadJson('valid-27.json');
  result.fields[0].evidence[0].location.page = 0;

  const validation = validators.validateResult(result);
  assert.equal(validation.valid, false);
  assert.ok(issueCodes(validation).includes('LOCATOR_INVALID'));
});

test('ordered fragments require at least two nonblank fragments', async () => {
  const validators = await getValidators();
  const result = await loadJson('ellipsis-valid.json');
  result.fields[0].evidence[0].fragments = ['Supply', '   '];

  const validation = validators.validateResult(result);
  assert.equal(validation.valid, false);
  assert.ok(issueCodes(validation).includes('ELLIPSIS_FRAGMENT_MISMATCH'));
});

test('additional properties are rejected at every controlled result object level', async () => {
  const validators = await getValidators();
  const base = await loadJson('conflict-resolved.json');
  const mutations = [
    (value) => {
      value.unexpected = true;
    },
    (value) => {
      value.inspection_coverage[0].unexpected = true;
    },
    (value) => {
      value.fields[18].unexpected = true;
    },
    (value) => {
      value.fields[18].evidence[0].unexpected = true;
    },
    (value) => {
      value.fields[18].evidence[0].location.unexpected = true;
    },
    (value) => {
      value.fields[18].conflicts[0].unexpected = true;
    },
  ];

  for (const mutate of mutations) {
    const result = clone(base);
    mutate(result);
    assert.equal(validators.validateResult(result).schema_valid, false);
  }
});

test('Task 9 semantic-risk fixtures remain structurally valid at the Task 2 boundary', async () => {
  const validators = await getValidators();
  const fixtures = [
    'conflict-resolved.json',
    'ellipsis-material-gap.json',
    'absence-negative.json',
    'incomplete-not-found.json',
  ];

  for (const fixture of fixtures) {
    const result = await loadJson(fixture);
    assert.equal(
      validators.validateResult(result).valid,
      true,
      `${fixture} must be structurally valid for downgrade-only Task 9 tests`,
    );
  }
});

test('policy mirrors the exact key/index mapping in both catalogs and exposes the acknowledged hash conflict', async () => {
  const [policySource, rootCatalog, blindCatalog] = await Promise.all([
    readFile(policyPath, 'utf8'),
    readFile(rootCatalogPath, 'utf8'),
    readFile(blindCatalogPath, 'utf8'),
  ]);
  const policy = JSON.parse(policySource);
  const policyFields = Object.entries(policy.fields)
    .map(([fieldKey, field]) => [field.field_index, fieldKey])
    .sort(([left], [right]) => left - right);

  assert.deepEqual(parseCatalogMatrix(rootCatalog), canonicalFields);
  assert.deepEqual(parseCatalogMatrix(blindCatalog), canonicalFields);
  assert.deepEqual(policyFields, canonicalFields);

  const blindHash = sha256(blindCatalog);
  const rootHash = sha256(rootCatalog);
  assert.equal(
    blindHash,
    'ABCBEA68911CE9FFAD9D436C9EABE708E12DBC4F04F7D5591CAFE4C58359B843',
  );
  assert.notEqual(rootHash, blindHash);
  assert.equal(policy.expected_catalog_sha256, blindHash);
  assert.equal(policy.catalog_snapshot_source, blindCatalogRelativePath);
  assert.equal(policy.root_catalog_source, 'FIELD_CATALOG.md');
  assert.equal(policy.root_catalog_sha256_observed, rootHash);
  assert.equal(policy.root_catalog_reconciliation_required, true);
  assert.equal(
    policy.deployment_gate,
    'blocked_pending_root_catalog_reconciliation',
  );
});

test('policy contains only mechanical guard fields and minimum containment flags', async () => {
  const policy = JSON.parse(await readFile(policyPath, 'utf8'));
  const valueKinds = new Set([
    'text',
    'date',
    'money',
    'composite',
    'boolean_like',
  ]);
  const fieldPropertyNames = [
    'arithmetic_checks',
    'completeness_required',
    'field_index',
    'negative_result_sensitive',
    'selected_control_required',
    'value_kind',
  ];

  assert.equal(Object.keys(policy.fields).length, 27);
  for (const field of Object.values(policy.fields)) {
    assert.deepEqual(Object.keys(field).sort(), fieldPropertyNames);
    assert.equal(typeof field.negative_result_sensitive, 'boolean');
    assert.equal(typeof field.completeness_required, 'boolean');
    assert.equal(typeof field.selected_control_required, 'boolean');
    assert.ok(valueKinds.has(field.value_kind));
    assert.ok(Array.isArray(field.arithmetic_checks));
  }

  const containmentKeys = [
    'participation_guarantee',
    'national_regime',
    'advance_contract_guarantee',
    'warranty_obligations_guarantee',
    'licenses_certificates',
    'required_official_certificates',
    'application_documents',
  ];
  for (const fieldKey of containmentKeys) {
    assert.equal(policy.fields[fieldKey].negative_result_sensitive, true);
    assert.equal(policy.fields[fieldKey].completeness_required, true);
  }

  assert.equal(policy.fields.national_regime.selected_control_required, true);
  assert.equal(policy.fields.nm_price_with_vat.negative_result_sensitive, true);
  assert.equal(policy.fields.nm_price_with_vat.completeness_required, true);
  assert.deepEqual(policy.fields.nm_price_with_vat.arithmetic_checks, [
    'money_amount_consistency',
    'vat_consistency',
  ]);
});

test('validation envelope also enforces the exact unique 27-field mapping', async () => {
  const validators = await getValidators();
  const result = await loadJson('valid-27.json');
  const envelope = buildValidationEnvelope(result);
  envelope.fields[26] = clone(envelope.fields[0]);

  const validation = validators.validateValidationEnvelope(envelope);
  assert.equal(validation.schema_valid, true);
  assert.equal(validation.valid, false);
  assert.ok(issueCodes(validation).includes('DUPLICATE_FIELD'));
  assert.ok(issueCodes(validation).includes('FIELD_SET_MISMATCH'));
});

test('schema boundary issue objects round-trip through the closed validation envelope', async () => {
  const validators = await getValidators();
  const result = await loadJson('valid-27.json');
  const duplicate = await loadJson('duplicate-field.json');
  const invalidStatus = clone(result);
  invalidStatus.fields[0].status = 'maybe';
  const catalogMismatch = clone(result);
  catalogMismatch.field_catalog_sha256 = 'f'.repeat(64);
  const envelope = buildValidationEnvelope(result);
  envelope.valid = false;
  envelope.job_issues = [
    ...validators.validateResult(duplicate).issues,
    ...validators.validateResult(invalidStatus).issues,
    ...validators.validateResult(catalogMismatch).issues,
  ];

  const validation = validators.validateValidationEnvelope(envelope);
  assert.equal(validation.schema_valid, true);
  assert.equal(validation.valid, true);
});

test('validation envelope is closed at top-level, field and issue objects', async () => {
  const validators = await getValidators();
  const result = await loadJson('valid-27.json');
  const base = buildValidationEnvelope(result);
  base.fields[0].issues.push({
    code: 'QUOTE_NOT_VERIFIED',
    message: 'Fixture issue.',
    path: '/fields/0/evidence/0',
  });
  const mutations = [
    (value) => {
      value.unexpected = true;
    },
    (value) => {
      value.fields[0].unexpected = true;
    },
    (value) => {
      value.fields[0].issues[0].unexpected = true;
    },
  ];

  for (const mutate of mutations) {
    const envelope = clone(base);
    mutate(envelope);
    assert.equal(
      validators.validateValidationEnvelope(envelope).schema_valid,
      false,
    );
  }
});
