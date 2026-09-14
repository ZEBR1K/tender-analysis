import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  createJobStore,
  documentPhysicalName,
  resolveJobPath,
} from '../deploy/codex-runner/src/job-store.mjs';
import { createAgentResultValidator } from '../deploy/codex-runner/src/result-validator.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..');
const manifestPath = path.join(testDirectory, 'fixtures', 'agentic', 'manifest-12-documents.json');
const resultPath = path.join(testDirectory, 'fixtures', 'agentic', 'results', 'valid-27.json');
const catalogPath = path.join(
  repositoryRoot,
  'deploy',
  'codex-runner',
  'field-catalog',
  'FIELD_CATALOG.md',
);
const expectedCatalogSha256 = 'ABCBEA68911CE9FFAD9D436C9EABE708E12DBC4F04F7D5591CAFE4C58359B843';

function bytesFor(artifactKey) {
  return Buffer.from(`synthetic bytes for ${artifactKey}\n`, 'utf8');
}

function asStream(buffer) {
  return (async function* stream() {
    yield buffer;
  }());
}

async function loadJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function buildSealedFixture(t, { tenderMetadata = false } = {}) {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), 'agentic-result-validator-'));
  t.after(() => rm(rootDirectory, { recursive: true, force: true }));
  const manifest = await loadJson(manifestPath);
  if (tenderMetadata) {
    manifest.tender_metadata = {
      artifact_key: 'tenderplan-metadata',
      source_type: 'tender_metadata',
      source_name: 'TenderPlan — карточка закупки',
      data: {
        tender: {
          _id: '6aa2c2ad5b7165804b8c4ff7',
          maxPrice: 1250000,
        },
      },
    };
  }
  const jobStore = createJobStore({
    rootDirectory,
    fieldCatalogPath: catalogPath,
    expectedCatalogSha256,
  });
  await jobStore.createJob(manifest);
  for (const document of manifest.documents) {
    await jobStore.uploadDocument({
      jobId: manifest.job_id,
      artifactKey: document.artifact_key,
      bodyStream: asStream(bytesFor(document.artifact_key)),
    });
  }
  const sealed = await jobStore.sealJob(manifest.job_id);
  const result = await loadJson(resultPath);
  result.input_manifest_sha256 = sealed.input_manifest_sha256;
  result.inspected_documents[0].artifact_key = manifest.documents[0].artifact_key;
  for (const field of result.fields) {
    for (const evidence of field.evidence) {
      evidence.artifact_key = manifest.documents[0].artifact_key;
    }
  }
  return {
    rootDirectory,
    manifest,
    jobStore,
    validator: await createAgentResultValidator({ jobStore }),
    result,
  };
}

function codes(report) {
  return report.issues.map((issue) => issue.code);
}

test('valid result is tied to the sealed manifest and preserves agent status/value unchanged', async (t) => {
  const fixture = await buildSealedFixture(t);
  fixture.result.fields[0].value_text = 'Agent value even if a quote says something else';
  fixture.result.fields[0].evidence[0].quote = '...short excerpt...';
  fixture.result.fields[2].value_text = 'Agent provisional wording for not_found';

  const report = await fixture.validator.validate({
    jobId: fixture.manifest.job_id,
    rawResult: `${JSON.stringify(fixture.result)}\n`,
  });

  assert.equal(report.valid, true);
  assert.deepEqual(report.issues, []);
  assert.equal(report.envelope.valid, true);
  assert.equal(report.envelope.fields[0].status, 'resolved');
  assert.equal(
    report.envelope.fields[0].value_text,
    'Agent value even if a quote says something else',
  );
  assert.equal(
    report.envelope.fields[2].value_text,
    'Agent provisional wording for not_found',
  );
  assert.match(report.envelope.raw_result_sha256, /^[A-F0-9]{64}$/u);
  assert.match(report.envelope.validated_result_sha256, /^[A-F0-9]{64}$/u);
});

test('manifest/catalog identity and exact field contract fail with retained issue codes', async (t) => {
  const fixture = await buildSealedFixture(t);
  const cases = [
    {
      code: 'MANIFEST_HASH_MISMATCH',
      mutate: (result) => { result.input_manifest_sha256 = 'F'.repeat(64); },
    },
    {
      code: 'CATALOG_HASH_MISMATCH',
      mutate: (result) => { result.field_catalog_sha256 = 'F'.repeat(64); },
    },
    {
      code: 'DUPLICATE_FIELD',
      mutate: (result) => { result.fields[26] = structuredClone(result.fields[0]); },
    },
    {
      code: 'FIELD_SET_MISMATCH',
      mutate: (result) => { result.fields.pop(); },
    },
    {
      code: 'STATUS_INVALID',
      mutate: (result) => { result.fields[0].status = 'maybe'; },
    },
    {
      code: 'LOCATOR_INVALID',
      mutate: (result) => { result.fields[0].evidence[0].locator = '   '; },
    },
  ];

  for (const item of cases) {
    const result = structuredClone(fixture.result);
    item.mutate(result);
    const report = await fixture.validator.validate({
      jobId: fixture.manifest.job_id,
      rawResult: JSON.stringify(result),
    });
    assert.equal(report.valid, false, item.code);
    assert.ok(codes(report).includes(item.code), `${item.code}: ${JSON.stringify(report.issues)}`);
    const cannotPreserveFieldContract = ['DUPLICATE_FIELD', 'FIELD_SET_MISMATCH', 'STATUS_INVALID']
      .includes(item.code);
    if (cannotPreserveFieldContract) {
      assert.equal(report.envelope, null, item.code);
    } else {
      assert.equal(report.envelope.valid, false, item.code);
    }
  }
});

test('all reported source identities must belong to this procurement manifest', async (t) => {
  const fixture = await buildSealedFixture(t, { tenderMetadata: true });

  const metadataEvidence = structuredClone(fixture.result);
  metadataEvidence.fields[0].evidence[0] = {
    artifact_key: 'tenderplan-metadata',
    locator: '$.tender.maxPrice',
    quote: null,
  };
  const metadataEvidenceReport = await fixture.validator.validate({
    jobId: fixture.manifest.job_id,
    rawResult: JSON.stringify(metadataEvidence),
  });
  assert.equal(metadataEvidenceReport.valid, true);
  assert.deepEqual(metadataEvidenceReport.issues, []);

  const metadataInspection = structuredClone(fixture.result);
  metadataInspection.inspected_documents[0].artifact_key = 'tenderplan-metadata';
  const metadataInspectionReport = await fixture.validator.validate({
    jobId: fixture.manifest.job_id,
    rawResult: JSON.stringify(metadataInspection),
  });
  assert.equal(metadataInspectionReport.valid, false);
  assert.ok(codes(metadataInspectionReport).includes('SOURCE_UNKNOWN'));
  assert.equal(metadataInspectionReport.envelope.valid, false);

  const unknownEvidence = structuredClone(fixture.result);
  unknownEvidence.fields[0].evidence[0].artifact_key = 'foreign-doc';
  const evidenceReport = await fixture.validator.validate({
    jobId: fixture.manifest.job_id,
    rawResult: JSON.stringify(unknownEvidence),
  });
  assert.ok(codes(evidenceReport).includes('SOURCE_UNKNOWN'));
  assert.equal(evidenceReport.envelope.valid, false);

  const unknownInspection = structuredClone(fixture.result);
  unknownInspection.inspected_documents[0].artifact_key = 'foreign-doc';
  const inspectionReport = await fixture.validator.validate({
    jobId: fixture.manifest.job_id,
    rawResult: JSON.stringify(unknownInspection),
  });
  assert.ok(codes(inspectionReport).includes('SOURCE_UNKNOWN'));
  assert.equal(inspectionReport.envelope.valid, false);
});

test('source-file mutation becomes FILE_INTEGRITY_MISMATCH before persistence', async (t) => {
  const fixture = await buildSealedFixture(t);
  const sourcePath = path.join(
    resolveJobPath(fixture.rootDirectory, fixture.manifest.job_id),
    'input',
    'documents',
    documentPhysicalName(fixture.manifest.documents[0]),
  );
  await writeFile(sourcePath, 'tampered source bytes');

  const report = await fixture.validator.validate({
    jobId: fixture.manifest.job_id,
    rawResult: JSON.stringify(fixture.result),
  });
  assert.equal(report.valid, false);
  assert.equal(report.envelope.valid, false);
  assert.deepEqual(codes(report), ['FILE_INTEGRITY_MISMATCH']);
});

test('sealed input remains verifiable while the lifecycle is validating', async (t) => {
  const fixture = await buildSealedFixture(t);
  const statePath = path.join(
    resolveJobPath(fixture.rootDirectory, fixture.manifest.job_id),
    'job-state.json',
  );
  const state = await loadJson(statePath);
  state.status = 'validating';
  await writeFile(statePath, `${JSON.stringify(state)}\n`, 'utf8');

  const report = await fixture.validator.validate({
    jobId: fixture.manifest.job_id,
    rawResult: JSON.stringify(fixture.result),
  });
  assert.equal(report.valid, true);
});

test('undeclared agent-visible files fail integrity without being deleted', async (t) => {
  const fixture = await buildSealedFixture(t);
  const foreignPath = path.join(
    resolveJobPath(fixture.rootDirectory, fixture.manifest.job_id),
    'input',
    'documents',
    '9999-foreign.source',
  );
  await writeFile(foreignPath, 'foreign bytes');

  const report = await fixture.validator.validate({
    jobId: fixture.manifest.job_id,
    rawResult: JSON.stringify(fixture.result),
  });
  assert.equal(report.valid, false);
  assert.equal(report.envelope.valid, false);
  assert.deepEqual(codes(report), ['FILE_INTEGRITY_MISMATCH']);
  assert.equal((await readFile(foreignPath, 'utf8')), 'foreign bytes');
});

test('not_found needs no invented evidence and semantic content is never runtime-scored', async (t) => {
  const fixture = await buildSealedFixture(t);
  const notFound = fixture.result.fields[2];
  assert.equal(notFound.status, 'not_found');
  assert.deepEqual(notFound.evidence, []);

  fixture.result.fields[0].value_text = 'PRICE NEGATIVE VAT CONFLICT';
  fixture.result.fields[0].evidence[0].quote = 'unrelated abbreviated text...';
  fixture.result.fields[0].rationale = 'The agent owns this semantic decision.';
  const report = await fixture.validator.validate({
    jobId: fixture.manifest.job_id,
    rawResult: JSON.stringify(fixture.result),
  });

  assert.equal(report.valid, true);
  assert.deepEqual(report.issues, []);
  assert.equal(report.envelope.fields[0].value_text, 'PRICE NEGATIVE VAT CONFLICT');
  assert.equal(
    report.issues.some(({ code }) => /PRICE|VAT|NEGATIVE|CONFLICT/iu.test(code)),
    false,
  );
});

test('invalid JSON is a schema failure and never produces a validation envelope', async (t) => {
  const fixture = await buildSealedFixture(t);
  const report = await fixture.validator.validate({
    jobId: fixture.manifest.job_id,
    rawResult: '{not-json',
  });
  assert.equal(report.valid, false);
  assert.equal(report.envelope, null);
  assert.deepEqual(codes(report), ['SCHEMA_INVALID']);
});
