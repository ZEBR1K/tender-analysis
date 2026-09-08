import { createHash } from 'node:crypto';

import { canonicalJson } from './manifest.mjs';
import { createSchemaValidators } from './schema-validation.mjs';

const INTEGRITY_ERROR_CODES = new Set([
  'RUNNER_CATALOG_MISMATCH',
  'RUNNER_DOCUMENT_MISMATCH',
  'RUNNER_MANIFEST_MISMATCH',
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

function issue(code, message, path, extra = {}) {
  return {
    code,
    message,
    path,
    ...extra,
  };
}

function rawBytes(value) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  throw new TypeError('rawResult must be a Buffer or string');
}

function parseRawResult(bytes) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    return null;
  }
}

function manifestIdentityIssues(result, manifest) {
  if (
    typeof result?.input_manifest_sha256 === 'string'
    && /^[0-9a-f]{64}$/iu.test(result.input_manifest_sha256)
    && result.input_manifest_sha256.toUpperCase() !== manifest.input_manifest_sha256
  ) {
    return [issue(
      'MANIFEST_HASH_MISMATCH',
      'input_manifest_sha256 does not match the sealed input manifest.',
      '/input_manifest_sha256',
    )];
  }
  return [];
}

function sourceMembershipIssues(result, manifest) {
  const known = new Set(manifest.documents.map((document) => document.artifact_key));
  const issues = [];

  if (Array.isArray(result?.inspected_documents)) {
    result.inspected_documents.forEach((document, index) => {
      if (typeof document?.artifact_key === 'string' && !known.has(document.artifact_key)) {
        issues.push(issue(
          'SOURCE_UNKNOWN',
          'inspected document does not belong to the sealed manifest.',
          `/inspected_documents/${index}/artifact_key`,
          { artifact_key: document.artifact_key },
        ));
      }
    });
  }

  if (Array.isArray(result?.fields)) {
    result.fields.forEach((field, fieldPosition) => {
      if (!Array.isArray(field?.evidence)) return;
      field.evidence.forEach((evidence, evidenceIndex) => {
        if (typeof evidence?.artifact_key !== 'string' || known.has(evidence.artifact_key)) {
          return;
        }
        issues.push(issue(
          'SOURCE_UNKNOWN',
          'evidence source does not belong to the sealed manifest.',
          `/fields/${fieldPosition}/evidence/${evidenceIndex}/artifact_key`,
          {
            field_index: field.field_index,
            field_key: field.field_key,
            evidence_index: evidenceIndex,
            artifact_key: evidence.artifact_key,
          },
        ));
      });
    });
  }

  return issues;
}

function createEnvelope({ jobId, result, rawHash, validatedHash, issues }) {
  const fieldIssues = new Map();
  const jobIssues = [];
  for (const currentIssue of issues) {
    const pathMatch = /^\/fields\/(\d+)(?:\/|$)/u.exec(currentIssue.path);
    const fieldPosition = pathMatch ? Number(pathMatch[1]) : -1;
    if (Number.isSafeInteger(fieldPosition) && fieldPosition >= 0) {
      const existing = fieldIssues.get(fieldPosition) ?? [];
      existing.push(currentIssue);
      fieldIssues.set(fieldPosition, existing);
    } else {
      jobIssues.push(currentIssue);
    }
  }
  return {
    schema_version: 'tender_agent_validation_v1',
    job_id: jobId,
    valid: issues.length === 0,
    job_issues: jobIssues,
    fields: result.fields.map((field, index) => ({
      field_index: field.field_index,
      field_key: field.field_key,
      status: field.status,
      value_text: field.value_text,
      issues: fieldIssues.get(index) ?? [],
    })),
    raw_result_sha256: rawHash,
    validated_result_sha256: validatedHash,
  };
}

function buildSchemaValidEnvelope({
  validators,
  jobId,
  result,
  bytes,
  issues,
}) {
  if (!Array.isArray(result?.fields)) return null;
  const envelope = createEnvelope({
    jobId: String(jobId || '').toLowerCase(),
    result,
    issues,
    rawHash: sha256(bytes),
    validatedHash: sha256(Buffer.from(canonicalJson(result), 'utf8')),
  });
  return validators.validateValidationEnvelope(envelope).valid ? envelope : null;
}

export async function createAgentResultValidator({
  jobStore,
  schemaValidators,
} = {}) {
  if (!jobStore || typeof jobStore.readVerifiedInputManifest !== 'function') {
    throw new TypeError('jobStore.readVerifiedInputManifest is required');
  }
  const validators = schemaValidators ?? await createSchemaValidators();

  return Object.freeze({
    async validate({ jobId, rawResult } = {}) {
      const bytes = rawBytes(rawResult);
      const result = parseRawResult(bytes);
      if (result === null) {
        return {
          valid: false,
          issues: [issue('SCHEMA_INVALID', 'Result is not valid JSON.', '')],
          envelope: null,
          result: null,
        };
      }

      let manifest;
      try {
        manifest = await jobStore.readVerifiedInputManifest(jobId);
      } catch (error) {
        if (!INTEGRITY_ERROR_CODES.has(error?.code)) throw error;
        const issues = [issue(
          'FILE_INTEGRITY_MISMATCH',
          'Sealed input files no longer match their recorded identities.',
          '/input',
        )];
        return {
          valid: false,
          issues,
          envelope: buildSchemaValidEnvelope({
            validators,
            jobId,
            result,
            bytes,
            issues,
          }),
          result,
        };
      }

      const contract = validators.validateResult(result);
      const issues = [
        ...contract.issues,
        ...manifestIdentityIssues(result, manifest),
        ...sourceMembershipIssues(result, manifest),
      ];
      if (!contract.valid || issues.length > 0) {
        return {
          valid: false,
          issues,
          envelope: buildSchemaValidEnvelope({
            validators,
            jobId: manifest.job_id,
            result,
            bytes,
            issues,
          }),
          result,
        };
      }

      const envelope = createEnvelope({
        jobId: manifest.job_id,
        result,
        issues,
        rawHash: sha256(bytes),
        validatedHash: sha256(Buffer.from(canonicalJson(result), 'utf8')),
      });
      const envelopeContract = validators.validateValidationEnvelope(envelope);
      if (!envelopeContract.valid) {
        throw new Error(
          `Generated validation envelope violates its schema: ${JSON.stringify(envelopeContract.issues)}`,
        );
      }

      return {
        valid: true,
        issues: [],
        envelope,
        result,
      };
    },
  });
}
