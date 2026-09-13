import { createHash } from 'node:crypto';

import { RunnerError } from './errors.mjs';

export const SOURCE_MANIFEST_VERSION = 'tender_source_manifest_v1';
export const AGENTIC_PIPELINE_VERSION = 'tender_agentic_pipeline_v1';
export const FIELD_CATALOG_VERSION = 'tender_fields_v1';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[0-9a-f]{64}$/iu;
const ARTIFACT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/iu;
const TENDER_METADATA_ARTIFACT_KEY = 'tenderplan-metadata';
const TENDER_METADATA_SOURCE_TYPE = 'tender_metadata';
const MAX_TENDER_METADATA_BYTES = 2 * 1024 * 1024;
const MANIFEST_KEYS = Object.freeze([
  'analysis_run_id',
  'documents',
  'expected_documents',
  'field_catalog_sha256',
  'field_catalog_version',
  'job_id',
  'manifest_version',
  'pipeline_version',
]);
const MANIFEST_KEYS_WITH_TENDER_METADATA = Object.freeze([
  ...MANIFEST_KEYS,
  'tender_metadata',
].sort());
const DOCUMENT_KEYS = Object.freeze([
  'artifact_key',
  'byte_size',
  'document_index',
  'file_name',
  'mime_type',
  'source_document_id',
  'source_sha256',
]);
const TENDER_METADATA_KEYS = Object.freeze([
  'artifact_key',
  'data',
  'source_name',
  'source_type',
]);

function fail(message, code = 'RUNNER_MANIFEST_INVALID') {
  throw new RunnerError(code, message, code === 'RUNNER_JOB_ID_INVALID' ? 400 : 422);
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function assertExactKeys(value, expected, label) {
  if (!isPlainObject(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} contains missing or unknown properties`);
  }
}

function nonBlankString(value, label, maxLength) {
  if (typeof value !== 'string' || value.length > maxLength || !/\S/u.test(value)) {
    fail(`${label} must be a nonblank string no longer than ${maxLength} characters`);
  }
  if (value.includes('\u0000')) fail(`${label} must not contain NUL`);
  return value;
}

export function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function assertJobId(value) {
  if (!isUuid(value)) fail('job_id must be a UUID', 'RUNNER_JOB_ID_INVALID');
  return value.toLowerCase();
}

export function assertArtifactKey(value) {
  if (typeof value !== 'string' || !ARTIFACT_KEY_PATTERN.test(value)) {
    fail('artifact_key must be a path-free stable identifier');
  }
  return value;
}

function sha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    fail(`${label} must be a 64-character SHA-256 value`);
  }
  return value.toUpperCase();
}

function normalizeDocument(value, expectedDocuments) {
  assertExactKeys(value, DOCUMENT_KEYS, 'manifest document');
  const documentIndex = value.document_index;
  if (!Number.isSafeInteger(documentIndex) || documentIndex < 1 || documentIndex > expectedDocuments) {
    fail(`document_index must be an integer from 1 to ${expectedDocuments}`);
  }
  if (!isUuid(value.source_document_id)) fail('source_document_id must be a UUID');
  if (!Number.isSafeInteger(value.byte_size) || value.byte_size < 0 || value.byte_size > 50 * 1024 * 1024) {
    fail('byte_size must be an integer from 0 to 52428800');
  }
  return {
    artifact_key: assertArtifactKey(value.artifact_key),
    document_index: documentIndex,
    source_document_id: value.source_document_id.toLowerCase(),
    file_name: nonBlankString(value.file_name, 'file_name', 1024),
    mime_type: nonBlankString(value.mime_type, 'mime_type', 255),
    byte_size: value.byte_size,
    source_sha256: sha256(value.source_sha256, 'source_sha256'),
  };
}

function assertUnique(documents, property) {
  const values = new Set();
  for (const document of documents) {
    if (values.has(document[property])) fail(`documents contain duplicate ${property}`);
    values.add(document[property]);
  }
}

function normalizeTenderMetadata(value) {
  assertExactKeys(value, TENDER_METADATA_KEYS, 'tender_metadata');
  if (value.artifact_key !== TENDER_METADATA_ARTIFACT_KEY) {
    fail(`tender_metadata.artifact_key must be ${TENDER_METADATA_ARTIFACT_KEY}`);
  }
  if (value.source_type !== TENDER_METADATA_SOURCE_TYPE) {
    fail(`tender_metadata.source_type must be ${TENDER_METADATA_SOURCE_TYPE}`);
  }
  const sourceName = nonBlankString(value.source_name, 'tender_metadata.source_name', 255);
  if (!isPlainObject(value.data)) fail('tender_metadata.data must be an object');

  let canonicalData;
  try {
    canonicalData = canonicalJson(value.data);
  } catch {
    fail('tender_metadata.data must be valid JSON data');
  }
  if (Buffer.byteLength(canonicalData, 'utf8') > MAX_TENDER_METADATA_BYTES) {
    fail(`tender_metadata.data must not exceed ${MAX_TENDER_METADATA_BYTES} canonical JSON bytes`);
  }

  return {
    artifact_key: TENDER_METADATA_ARTIFACT_KEY,
    source_type: TENDER_METADATA_SOURCE_TYPE,
    source_name: sourceName,
    data: JSON.parse(canonicalData),
  };
}

export function normalizeSourceManifest(value, { expectedCatalogSha256 } = {}) {
  const manifestKeys = isPlainObject(value) && Object.hasOwn(value, 'tender_metadata')
    ? MANIFEST_KEYS_WITH_TENDER_METADATA
    : MANIFEST_KEYS;
  assertExactKeys(value, manifestKeys, 'source manifest');
  const jobId = assertJobId(value.job_id);
  if (!isUuid(value.analysis_run_id)) fail('analysis_run_id must be a UUID');
  if (value.manifest_version !== SOURCE_MANIFEST_VERSION) {
    fail(`manifest_version must be ${SOURCE_MANIFEST_VERSION}`);
  }
  if (value.pipeline_version !== AGENTIC_PIPELINE_VERSION) {
    fail(`pipeline_version must be ${AGENTIC_PIPELINE_VERSION}`);
  }
  if (value.field_catalog_version !== FIELD_CATALOG_VERSION) {
    fail(`field_catalog_version must be ${FIELD_CATALOG_VERSION}`);
  }
  const catalogSha256 = sha256(value.field_catalog_sha256, 'field_catalog_sha256');
  if (expectedCatalogSha256 && catalogSha256 !== sha256(expectedCatalogSha256, 'expected catalog SHA-256')) {
    fail('field_catalog_sha256 does not match the runner catalog', 'RUNNER_CATALOG_MISMATCH');
  }
  if (!Number.isSafeInteger(value.expected_documents)
    || value.expected_documents < 1
    || value.expected_documents > 1000) {
    fail('expected_documents must be an integer from 1 to 1000');
  }
  if (!Array.isArray(value.documents) || value.documents.length !== value.expected_documents) {
    fail('documents length must equal expected_documents');
  }

  const documents = value.documents
    .map((document) => normalizeDocument(document, value.expected_documents))
    .sort((left, right) => left.document_index - right.document_index);
  assertUnique(documents, 'artifact_key');
  assertUnique(documents, 'document_index');
  assertUnique(documents, 'source_document_id');

  const tenderMetadata = Object.hasOwn(value, 'tender_metadata')
    ? normalizeTenderMetadata(value.tender_metadata)
    : null;
  if (tenderMetadata && documents.some(
    (document) => document.artifact_key === tenderMetadata.artifact_key,
  )) {
    fail('tender_metadata artifact_key collides with a document artifact_key');
  }

  const manifest = {
    manifest_version: SOURCE_MANIFEST_VERSION,
    job_id: jobId,
    analysis_run_id: value.analysis_run_id.toLowerCase(),
    pipeline_version: AGENTIC_PIPELINE_VERSION,
    field_catalog_version: FIELD_CATALOG_VERSION,
    field_catalog_sha256: catalogSha256,
    expected_documents: value.expected_documents,
    documents,
  };
  if (tenderMetadata) manifest.tender_metadata = tenderMetadata;
  return manifest;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalValue(value[key])]),
  );
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function computeManifestSha256(value) {
  if (!isPlainObject(value)) fail('manifest hash input must be an object');
  const withoutSelfHash = { ...value };
  delete withoutSelfHash.input_manifest_sha256;
  return createHash('sha256')
    .update(canonicalJson(withoutSelfHash), 'utf8')
    .digest('hex')
    .toUpperCase();
}
