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
const fixturePath = path.join(
  repositoryRoot,
  'tests',
  'fixtures',
  'agentic',
  'results',
  'valid-27.json',
);
const policyPath = path.join(
  runnerRoot,
  'policies',
  'tender-fields-v1.json',
);
const schemaPaths = [
  path.join(runnerRoot, 'schemas', 'tender-agent-result-v1.schema.json'),
  path.join(runnerRoot, 'schemas', 'tender-agent-validation-v1.schema.json'),
];
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

const retainedIssueCodes = [
  'SCHEMA_INVALID',
  'FIELD_SET_MISMATCH',
  'DUPLICATE_FIELD',
  'STATUS_INVALID',
  'CATALOG_HASH_MISMATCH',
  'MANIFEST_HASH_MISMATCH',
  'SOURCE_UNKNOWN',
  'LOCATOR_INVALID',
  'FILE_INTEGRITY_MISMATCH',
];

let validatorsPromise;

async function getValidators() {
  validatorsPromise ??= import(validationModuleUrl).then(
    ({ createSchemaValidators }) => createSchemaValidators(),
  );
  return validatorsPromise;
}

async function loadResult() {
  return JSON.parse(await readFile(fixturePath, 'utf8'));
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
      status: field.status,
      value_text: field.value_text,
      issues: [],
    })),
    raw_result_sha256: 'c'.repeat(64),
    validated_result_sha256: 'd'.repeat(64),
  };
}

function issueCodes(validation) {
  return validation.issues.map(({ code }) => code);
}

test('strict Ajv boundary accepts the closed agent-led result and audit envelope', async () => {
  const [validators, result] = await Promise.all([
    getValidators(),
    loadResult(),
  ]);

  assert.equal(validators.draft, '2020-12');
  assert.equal(validators.strict, true);
  assert.deepEqual(validators.validateResult(result), {
    valid: true,
    schema_valid: true,
    issues: [],
  });
  assert.deepEqual(
    validators.validateValidationEnvelope(buildValidationEnvelope(result)),
    { valid: true, schema_valid: true, issues: [] },
  );
});

test('every controlled schema enum contains unique values', async () => {
  for (const schemaPath of schemaPaths) {
    const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
    const visit = (node, pointer = '#') => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node.enum)) {
        assert.equal(
          new Set(node.enum.map((value) => JSON.stringify(value))).size,
          node.enum.length,
          `${path.basename(schemaPath)} ${pointer}/enum contains duplicates`,
        );
      }
      for (const [key, value] of Object.entries(node)) {
        visit(value, `${pointer}/${key}`);
      }
    };
    visit(schema);
  }
});

test('result catalog hash must match the policy-pinned catalog identity', async () => {
  const validators = await getValidators();
  const result = await loadResult();
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

test('missing and duplicate fields fail the exact 27-key contract', async () => {
  const validators = await getValidators();
  const missing = await loadResult();
  missing.fields.pop();
  assert.ok(
    issueCodes(validators.validateResult(missing)).includes('FIELD_SET_MISMATCH'),
  );

  const duplicate = await loadResult();
  duplicate.fields[26] = clone(duplicate.fields[0]);
  const duplicateValidation = validators.validateResult(duplicate);
  assert.equal(duplicateValidation.schema_valid, true);
  assert.equal(duplicateValidation.valid, false);
  assert.deepEqual(
    duplicateValidation.issues
      .filter(({ code }) => code === 'DUPLICATE_FIELD')
      .map(({ dimension }) => dimension)
      .sort(),
    ['field_index', 'field_key'],
  );
});

test('unknown status is rejected as a syntactic contract error', async () => {
  const validators = await getValidators();
  const result = await loadResult();
  result.fields[0].status = 'maybe';
  const validation = validators.validateResult(result);
  assert.equal(validation.valid, false);
  assert.ok(issueCodes(validation).includes('STATUS_INVALID'));
});

test('resolved and requires_review require evidence with a nonblank human locator', async () => {
  const validators = await getValidators();
  const noEvidence = await loadResult();
  noEvidence.fields[0].evidence = [];
  assert.ok(
    issueCodes(validators.validateResult(noEvidence)).includes('LOCATOR_INVALID'),
  );

  const blankLocator = await loadResult();
  blankLocator.fields[1].evidence[0].locator = '   ';
  assert.ok(
    issueCodes(validators.validateResult(blankLocator)).includes(
      'LOCATOR_INVALID',
    ),
  );
});

test('not_found requires no evidence and status/value meaning is not reinterpreted', async () => {
  const validators = await getValidators();
  const result = await loadResult();
  result.fields[2].value_text = 'Agent-reported provisional wording';
  assert.deepEqual(validators.validateResult(result), {
    valid: true,
    schema_valid: true,
    issues: [],
  });
});

test('agent chooses inspection methods and reports parts, limitations and constraints', async () => {
  const validators = await getValidators();
  const result = await loadResult();
  result.inspected_documents[0].methods.push(
    'custom OOXML inspection chosen by the agent',
  );
  result.limitations.push('One appendix was visually dense.');
  result.constraints.push('Read-only original files.');
  assert.equal(validators.validateResult(result).valid, true);
});

test('removed parser and semantic-verifier machinery is prohibited by the closed schema', async () => {
  const validators = await getValidators();
  const mutations = [
    (value) => {
      value.inspection_coverage = [];
    },
    (value) => {
      value.inspected_documents[0].expected_pages = 2;
    },
    (value) => {
      value.inspected_documents[0].inspection_status = 'complete';
    },
    (value) => {
      value.fields[0].claim_basis = 'explicit_positive';
    },
    (value) => {
      value.fields[0].conflicts = [];
    },
    (value) => {
      value.fields[0].evidence[0].quote_mode = 'exact';
    },
    (value) => {
      value.fields[0].evidence[0].fragments = [];
    },
    (value) => {
      value.fields[0].evidence[0].location = { kind: 'pdf_page', page: 1 };
    },
  ];

  for (const mutate of mutations) {
    const result = await loadResult();
    mutate(result);
    assert.equal(validators.validateResult(result).schema_valid, false);
  }
});

test('additional properties are rejected at every retained controlled object level', async () => {
  const validators = await getValidators();
  const resultMutations = [
    (value) => {
      value.unexpected = true;
    },
    (value) => {
      value.inspected_documents[0].unexpected = true;
    },
    (value) => {
      value.fields[0].unexpected = true;
    },
    (value) => {
      value.fields[0].evidence[0].unexpected = true;
    },
  ];
  for (const mutate of resultMutations) {
    const result = await loadResult();
    mutate(result);
    assert.equal(validators.validateResult(result).schema_valid, false);
  }

  const baseResult = await loadResult();
  const envelope = buildValidationEnvelope(baseResult);
  envelope.fields[0].issues.push({
    code: 'SOURCE_UNKNOWN',
    message: 'Unknown artifact key.',
    path: '/fields/0/evidence/0/artifact_key',
  });
  const envelopeMutations = [
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
  for (const mutate of envelopeMutations) {
    const candidate = clone(envelope);
    mutate(candidate);
    assert.equal(
      validators.validateValidationEnvelope(candidate).schema_valid,
      false,
    );
  }
});

test('policy is only the canonical key/index mapping plus catalog identity', async () => {
  const policy = JSON.parse(await readFile(policyPath, 'utf8'));
  assert.deepEqual(Object.keys(policy).sort(), [
    'catalog_snapshot_source',
    'expected_catalog_sha256',
    'field_catalog_version',
    'fields',
    'policy_version',
    'root_catalog_reconciliation_required',
    'root_catalog_sha256_observed',
    'root_catalog_source',
  ]);
  assert.equal(Object.keys(policy.fields).length, 27);
  for (const field of Object.values(policy.fields)) {
    assert.deepEqual(Object.keys(field), ['field_index']);
  }
  assert.deepEqual(
    Object.entries(policy.fields)
      .map(([fieldKey, field]) => [field.field_index, fieldKey])
      .sort(([left], [right]) => left - right),
    canonicalFields,
  );
});

test('policy mirrors both catalogs and exposes the acknowledged hash conflict', async () => {
  const [policySource, rootCatalog, blindCatalog] = await Promise.all([
    readFile(policyPath, 'utf8'),
    readFile(rootCatalogPath, 'utf8'),
    readFile(blindCatalogPath, 'utf8'),
  ]);
  const policy = JSON.parse(policySource);
  assert.deepEqual(parseCatalogMatrix(rootCatalog), canonicalFields);
  assert.deepEqual(parseCatalogMatrix(blindCatalog), canonicalFields);
  const blindHash = sha256(blindCatalog);
  const rootHash = sha256(rootCatalog);
  assert.notEqual(rootHash, blindHash);
  assert.equal(policy.expected_catalog_sha256, blindHash);
  assert.equal(policy.catalog_snapshot_source, blindCatalogRelativePath);
  assert.equal(policy.root_catalog_sha256_observed, rootHash);
  assert.equal(policy.root_catalog_reconciliation_required, true);
});

test('validation issue codes are limited to contract, identity, source and file integrity', async () => {
  const validationSchema = JSON.parse(
    await readFile(schemaPaths[1], 'utf8'),
  );
  assert.deepEqual(validationSchema.$defs.issueCode.enum, retainedIssueCodes);
  const serialized = JSON.stringify(validationSchema);
  for (const forbidden of [
    'QUOTE_NOT_VERIFIED',
    'ELLIPSIS_FRAGMENT_MISMATCH',
    'ELLIPSIS_MATERIAL_GAP',
    'CONFLICT_BLOCKS_RESOLVED',
    'NEGATIVE_BASIS_MISSING',
    'NOT_FOUND_WITH_INCOMPLETE_COVERAGE',
    'COMPLETENESS_PROOF_MISSING',
    'ARITHMETIC_MISMATCH',
    'validation_level',
    'reported_status',
    'effective_status',
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test('retained source, locator and file-integrity issues round-trip through the envelope', async () => {
  const validators = await getValidators();
  const result = await loadResult();
  const envelope = buildValidationEnvelope(result);
  envelope.valid = false;
  envelope.job_issues = [
    {
      code: 'SOURCE_UNKNOWN',
      message: 'Unknown artifact key.',
      path: '/fields/0/evidence/0/artifact_key',
    },
    {
      code: 'LOCATOR_INVALID',
      message: 'Locator is blank.',
      path: '/fields/0/evidence/0/locator',
    },
    {
      code: 'FILE_INTEGRITY_MISMATCH',
      message: 'Staged bytes do not match the sealed manifest.',
      path: '/manifest/documents/0/file_sha256',
    },
  ];
  assert.equal(
    validators.validateValidationEnvelope(envelope).schema_valid,
    true,
  );
});

test('validation envelope also enforces the exact unique 27-field mapping', async () => {
  const validators = await getValidators();
  const result = await loadResult();
  const envelope = buildValidationEnvelope(result);
  envelope.fields[26] = clone(envelope.fields[0]);
  const validation = validators.validateValidationEnvelope(envelope);
  assert.equal(validation.schema_valid, true);
  assert.equal(validation.valid, false);
  assert.ok(issueCodes(validation).includes('DUPLICATE_FIELD'));
  assert.ok(issueCodes(validation).includes('FIELD_SET_MISMATCH'));
});
