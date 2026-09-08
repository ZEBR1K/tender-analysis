import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultSchemaDirectory = path.resolve(moduleDirectory, '..', 'schemas');
const defaultPolicyPath = path.resolve(
  moduleDirectory,
  '..',
  'policies',
  'tender-fields-v1.json',
);

const resultSchemaName = 'tender-agent-result-v1.schema.json';
const validationSchemaName = 'tender-agent-validation-v1.schema.json';

function parseJson(source, sourcePath) {
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid JSON in ${sourcePath}: ${error.message}`, {
      cause: error,
    });
  }
}

function schemaIssueCode(error) {
  const location = `${error.instancePath} ${error.schemaPath} ${JSON.stringify(error.params)}`;

  if (/\/(?:reported_|effective_)?status\b|missingProperty":"(?:reported_|effective_)?status"/u.test(location)) {
    return 'STATUS_INVALID';
  }
  if (/location|Location|cell_range|sheet|page(?:_to)?/u.test(location)) {
    return 'LOCATOR_INVALID';
  }
  if (/fragments|quote_mode|evidence\/allOf/u.test(location)) {
    return 'ELLIPSIS_FRAGMENT_MISMATCH';
  }
  if (/value_text|\/evidence(?:\b|\/)|missingProperty":"(?:reported_|effective_)?value_text"/u.test(location)) {
    return 'VALUE_REQUIRED';
  }
  if (error.instancePath === '/fields' && ['minItems', 'maxItems'].includes(error.keyword)) {
    return 'FIELD_SET_MISMATCH';
  }
  return 'SCHEMA_INVALID';
}

function normalizeSchemaIssues(errors = []) {
  return errors.map((error) => ({
    code: schemaIssueCode(error),
    message: error.message ?? 'JSON Schema validation failed.',
    path: error.instancePath,
    keyword: error.keyword,
    schema_path: error.schemaPath,
  }));
}

function countBy(items, selector) {
  const counts = new Map();
  for (const item of items) {
    const value = selector(item);
    if (value === undefined) {
      continue;
    }
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function fieldSetIssues(fields, expectedFields) {
  if (!Array.isArray(fields)) {
    return [];
  }

  const issues = [];
  const indexCounts = countBy(fields, (field) => field?.field_index);
  const keyCounts = countBy(fields, (field) => field?.field_key);

  for (const [fieldIndex, count] of indexCounts) {
    if (count > 1) {
      issues.push({
        code: 'DUPLICATE_FIELD',
        message: `field_index ${fieldIndex} appears ${count} times.`,
        path: '/fields',
        dimension: 'field_index',
      });
    }
  }
  for (const [fieldKey, count] of keyCounts) {
    if (count > 1) {
      issues.push({
        code: 'DUPLICATE_FIELD',
        message: `field_key ${fieldKey} appears ${count} times.`,
        path: '/fields',
        dimension: 'field_key',
      });
    }
  }

  const exactMapping =
    fields.length === expectedFields.length &&
    indexCounts.size === expectedFields.length &&
    keyCounts.size === expectedFields.length &&
    fields.every(
      (field) =>
        Number.isInteger(field?.field_index) &&
        expectedFields[field.field_index - 1]?.field_key === field?.field_key,
    );

  if (!exactMapping) {
    issues.push({
      code: 'FIELD_SET_MISMATCH',
      message: 'fields must contain the exact canonical field_index/field_key mapping 1..27.',
      path: '/fields',
    });
  }

  return issues;
}

function catalogHashIssues(value, expectedCatalogHash) {
  const reportedCatalogHash = value?.field_catalog_sha256;
  if (
    typeof reportedCatalogHash !== 'string' ||
    !/^[A-Fa-f0-9]{64}$/u.test(reportedCatalogHash)
  ) {
    return [];
  }
  if (reportedCatalogHash.toUpperCase() === expectedCatalogHash) {
    return [];
  }
  return [
    {
      code: 'CATALOG_HASH_MISMATCH',
      message: 'field_catalog_sha256 does not match the policy-pinned catalog.',
      path: '/field_catalog_sha256',
    },
  ];
}

function loadExpectedFields(policy) {
  if (policy?.field_catalog_version !== 'tender_fields_v1') {
    throw new Error('Field policy must declare field_catalog_version=tender_fields_v1.');
  }
  if (!policy.fields || typeof policy.fields !== 'object' || Array.isArray(policy.fields)) {
    throw new Error('Field policy must contain a fields object.');
  }

  const expectedFields = Object.entries(policy.fields)
    .map(([fieldKey, field]) => ({
      field_index: field?.field_index,
      field_key: fieldKey,
    }))
    .sort((left, right) => left.field_index - right.field_index);

  const exactIndexes = expectedFields.every(
    (field, index) =>
      field.field_index === index + 1 && typeof field.field_key === 'string',
  );
  if (expectedFields.length !== 27 || !exactIndexes) {
    throw new Error('Field policy must contain exactly one canonical field for each index 1..27.');
  }
  return expectedFields;
}

function assertSchemaPolicyParity(schema, expectedFields, schemaName) {
  const schemaKeys = schema?.$defs?.fieldKey?.enum;
  const expectedKeys = expectedFields.map(({ field_key: fieldKey }) => fieldKey);
  if (JSON.stringify(schemaKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error(`${schemaName} field_key enum does not match the field policy.`);
  }
}

function createContractValidator(
  schemaValidator,
  expectedFields,
  { expectedCatalogHash } = {},
) {
  return (value) => {
    const schemaValid = schemaValidator(value);
    const schemaIssues = normalizeSchemaIssues(schemaValidator.errors ?? []);
    const semanticIssues = fieldSetIssues(value?.fields, expectedFields);
    const identityIssues = expectedCatalogHash
      ? catalogHashIssues(value, expectedCatalogHash)
      : [];
    const issues = [...schemaIssues, ...semanticIssues, ...identityIssues];

    return {
      valid:
        schemaValid &&
        semanticIssues.length === 0 &&
        identityIssues.length === 0,
      schema_valid: schemaValid,
      issues,
    };
  };
}

export async function createSchemaValidators({
  schemaDirectory = defaultSchemaDirectory,
  policyPath = defaultPolicyPath,
} = {}) {
  const resultSchemaPath = path.join(schemaDirectory, resultSchemaName);
  const validationSchemaPath = path.join(
    schemaDirectory,
    validationSchemaName,
  );
  const [resultSource, validationSource, policySource] = await Promise.all([
    readFile(resultSchemaPath, 'utf8'),
    readFile(validationSchemaPath, 'utf8'),
    readFile(policyPath, 'utf8'),
  ]);
  const resultSchema = parseJson(resultSource, resultSchemaPath);
  const validationSchema = parseJson(validationSource, validationSchemaPath);
  const policy = parseJson(policySource, policyPath);
  const expectedFields = loadExpectedFields(policy);
  const expectedCatalogHash = policy.expected_catalog_sha256;
  if (!/^[A-Fa-f0-9]{64}$/u.test(expectedCatalogHash ?? '')) {
    throw new Error('Field policy must declare a 64-hex expected_catalog_sha256.');
  }

  assertSchemaPolicyParity(resultSchema, expectedFields, resultSchemaName);
  assertSchemaPolicyParity(validationSchema, expectedFields, validationSchemaName);

  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    validateFormats: true,
  });
  addFormats(ajv);

  const resultValidator = ajv.compile(resultSchema);
  const validationEnvelopeValidator = ajv.compile(validationSchema);

  return Object.freeze({
    draft: '2020-12',
    strict: true,
    validateResult: createContractValidator(resultValidator, expectedFields, {
      expectedCatalogHash: expectedCatalogHash.toUpperCase(),
    }),
    validateValidationEnvelope: createContractValidator(
      validationEnvelopeValidator,
      expectedFields,
    ),
  });
}
