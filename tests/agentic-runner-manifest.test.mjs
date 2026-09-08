import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  canonicalJson,
  computeManifestSha256,
  normalizeSourceManifest,
} from '../deploy/codex-runner/src/manifest.mjs';
import {
  createJobStore,
  documentPhysicalName,
  resolveJobPath,
} from '../deploy/codex-runner/src/job-store.mjs';
import { RunnerError } from '../deploy/codex-runner/src/errors.mjs';
import { createHeaderAuthenticator } from '../deploy/codex-runner/src/http-auth.mjs';
import { createManifestRouteHandler, createServer } from '../deploy/codex-runner/src/server.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..');
const fixturePath = path.join(testDirectory, 'fixtures', 'agentic', 'manifest-12-documents.json');
const catalogPath = path.join(
  repositoryRoot,
  'deploy',
  'codex-runner',
  'field-catalog',
  'FIELD_CATALOG.md',
);
const expectedCatalogSha256 = 'ABCBEA68911CE9FFAD9D436C9EABE708E12DBC4F04F7D5591CAFE4C58359B843';

async function loadFixture() {
  return JSON.parse(await readFile(fixturePath, 'utf8'));
}

function clone(value) {
  return structuredClone(value);
}

function bytesFor(artifactKey) {
  return Buffer.from(`synthetic bytes for ${artifactKey}\n`, 'utf8');
}

function asStream(buffer, splitAt = buffer.length) {
  return (async function* stream() {
    yield buffer.subarray(0, splitAt);
    if (splitAt < buffer.length) yield buffer.subarray(splitAt);
  }());
}

async function createFixtureStore(t) {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), 'agentic-manifest-'));
  t.after(() => rm(rootDirectory, { recursive: true, force: true }));
  return {
    rootDirectory,
    store: createJobStore({ rootDirectory, fieldCatalogPath: catalogPath, expectedCatalogSha256 }),
  };
}

function assertRunnerError(error, code) {
  assert.ok(error instanceof RunnerError);
  assert.equal(error.code, code);
  return true;
}

async function stageAll(store, manifest) {
  for (const document of manifest.documents) {
    await store.uploadDocument({
      jobId: manifest.job_id,
      artifactKey: document.artifact_key,
      bodyStream: asStream(bytesFor(document.artifact_key), 7),
    });
  }
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

test('manifest normalization is closed and rejects unsafe identities and duplicates', async () => {
  const base = await loadFixture();
  const mutations = [
    { code: 'RUNNER_JOB_ID_INVALID', apply: (value) => { value.job_id = '../outside'; } },
    { code: 'RUNNER_JOB_ID_INVALID', apply: (value) => { value.job_id = 'not-a-uuid'; } },
    { code: 'RUNNER_MANIFEST_INVALID', apply: (value) => { value.unknown = true; } },
    { code: 'RUNNER_MANIFEST_INVALID', apply: (value) => { value.documents[0].unknown = true; } },
    { code: 'RUNNER_MANIFEST_INVALID', apply: (value) => { value.documents[1].artifact_key = value.documents[0].artifact_key; } },
    { code: 'RUNNER_MANIFEST_INVALID', apply: (value) => { value.documents[1].document_index = value.documents[0].document_index; } },
    { code: 'RUNNER_MANIFEST_INVALID', apply: (value) => { value.documents[1].source_document_id = value.documents[0].source_document_id; } },
    { code: 'RUNNER_MANIFEST_INVALID', apply: (value) => { value.documents[0].artifact_key = '../outside'; } },
    { code: 'RUNNER_MANIFEST_INVALID', apply: (value) => { value.expected_documents = 11; } },
  ];

  for (const { code, apply } of mutations) {
    const manifest = clone(base);
    apply(manifest);
    assert.throws(() => normalizeSourceManifest(manifest, { expectedCatalogSha256 }), (error) => (
      assertRunnerError(error, code)
    ));
  }
});

test('canonical manifest hash is independent of object key order but binds all source metadata', async () => {
  const manifest = normalizeSourceManifest(await loadFixture(), { expectedCatalogSha256 });
  const reordered = Object.fromEntries(Object.entries(manifest).reverse());
  assert.equal(canonicalJson(manifest), canonicalJson(reordered));
  assert.equal(computeManifestSha256(manifest), computeManifestSha256(reordered));

  const changed = clone(manifest);
  changed.documents[0].file_name = 'different.pdf';
  assert.notEqual(computeManifestSha256(changed), computeManifestSha256(manifest));
});

test('job paths accept only UUIDs and never resolve outside the configured root', async (t) => {
  const { rootDirectory } = await createFixtureStore(t);
  const jobId = '11111111-1111-4111-8111-111111111111';
  assert.equal(resolveJobPath(rootDirectory, jobId), path.join(path.resolve(rootDirectory), jobId));
  for (const unsafe of ['../outside', '..%2foutside', 'not-a-uuid', `${jobId}/outside`]) {
    assert.throws(() => resolveJobPath(rootDirectory, unsafe), (error) => (
      assertRunnerError(error, 'RUNNER_JOB_ID_INVALID')
    ));
  }
});

test('job creation remains retryable when a crash is injected after mkdir but before state', async (t) => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), 'agentic-manifest-create-fault-'));
  t.after(() => rm(rootDirectory, { recursive: true, force: true }));
  const manifest = await loadFixture();
  const faultedStore = createJobStore({
    rootDirectory,
    fieldCatalogPath: catalogPath,
    expectedCatalogSha256,
    faultInjector(phase) {
      if (phase === 'after-create-job-directory') throw new Error('simulated create crash');
    },
  });

  await assert.rejects(faultedStore.createJob(manifest), /simulated create crash/u);
  await assert.rejects(
    stat(resolveJobPath(rootDirectory, manifest.job_id)),
    (error) => error?.code === 'ENOENT',
  );

  const recoveredStore = createJobStore({
    rootDirectory,
    fieldCatalogPath: catalogPath,
    expectedCatalogSha256,
  });
  const recovered = await recoveredStore.createJob(manifest);
  assert.equal(recovered.status, 'staging');
  assert.equal(recovered.idempotent, false);
  assert.deepEqual(await readdir(rootDirectory), [manifest.job_id]);
});

test('streamed upload verifies declared size and SHA-256 and leaves no partial file', async (t) => {
  const { rootDirectory, store } = await createFixtureStore(t);
  const manifest = await loadFixture();
  await store.createJob(manifest);

  await assert.rejects(
    store.uploadDocument({
      jobId: manifest.job_id,
      artifactKey: manifest.documents[0].artifact_key,
      bodyStream: asStream(Buffer.from('wrong bytes')),
    }),
    (error) => assertRunnerError(error, 'RUNNER_DOCUMENT_MISMATCH'),
  );
  const jobPath = resolveJobPath(rootDirectory, manifest.job_id);
  const documentsDirectory = path.join(jobPath, 'input', 'documents');
  assert.deepEqual(await readdir(documentsDirectory), []);

  const result = await store.uploadDocument({
    jobId: manifest.job_id,
    artifactKey: manifest.documents[0].artifact_key,
    bodyStream: asStream(bytesFor(manifest.documents[0].artifact_key), 5),
  });
  assert.equal(result.sha256, manifest.documents[0].source_sha256);
  assert.equal(result.byte_size, manifest.documents[0].byte_size);
  assert.equal(result.idempotent, false);
  assert.deepEqual(await readdir(documentsDirectory), [
    documentPhysicalName(manifest.documents[0]),
  ]);
});

test('an identical repeated upload is idempotent and a conflicting repeated upload fails', async (t) => {
  const { store } = await createFixtureStore(t);
  const manifest = await loadFixture();
  await store.createJob(manifest);
  const upload = {
    jobId: manifest.job_id,
    artifactKey: manifest.documents[0].artifact_key,
  };
  const first = await store.uploadDocument({ ...upload, bodyStream: asStream(bytesFor('doc-001')) });
  const repeated = await store.uploadDocument({ ...upload, bodyStream: asStream(bytesFor('doc-001')) });
  assert.equal(first.idempotent, false);
  assert.equal(repeated.idempotent, true);

  await assert.rejects(
    store.uploadDocument({ ...upload, bodyStream: asStream(Buffer.from('different')) }),
    (error) => assertRunnerError(error, 'RUNNER_DOCUMENT_CONFLICT'),
  );
});

test('seal fails before every declared document is staged and rejects every later mutation', async (t) => {
  const { store } = await createFixtureStore(t);
  const manifest = await loadFixture();
  await store.createJob(manifest);
  await store.uploadDocument({
    jobId: manifest.job_id,
    artifactKey: manifest.documents[0].artifact_key,
    bodyStream: asStream(bytesFor('doc-001')),
  });
  await assert.rejects(
    store.sealJob(manifest.job_id),
    (error) => assertRunnerError(error, 'RUNNER_MANIFEST_INCOMPLETE'),
  );

  await stageAll(store, manifest);
  const sealed = await store.sealJob(manifest.job_id);
  assert.equal(sealed.status, 'ready');
  assert.equal(sealed.expected_documents, 12);
  assert.equal(sealed.staged_documents, 12);
  assert.match(sealed.input_manifest_sha256, /^[A-F0-9]{64}$/u);

  await assert.rejects(
    store.uploadDocument({
      jobId: manifest.job_id,
      artifactKey: 'doc-001',
      bodyStream: asStream(bytesFor('doc-001')),
    }),
    (error) => assertRunnerError(error, 'RUNNER_JOB_SEALED'),
  );
  await assert.rejects(
    store.createJob(manifest),
    (error) => assertRunnerError(error, 'RUNNER_JOB_SEALED'),
  );
});

test('seal copies the pinned catalog and emits a deterministic source-only manifest', async (t) => {
  const { rootDirectory, store } = await createFixtureStore(t);
  const manifest = await loadFixture();
  await store.createJob(manifest);
  await stageAll(store, manifest);
  const first = await store.sealJob(manifest.job_id);
  const second = await store.sealJob(manifest.job_id);
  assert.deepEqual(second, { ...first, idempotent: true });

  const inputDirectory = path.join(resolveJobPath(rootDirectory, manifest.job_id), 'input');
  const persisted = JSON.parse(await readFile(path.join(inputDirectory, 'manifest.json'), 'utf8'));
  const persistedCatalog = await readFile(path.join(inputDirectory, 'FIELD_CATALOG.md'));
  assert.equal(createHash('sha256').update(persistedCatalog).digest('hex').toUpperCase(), expectedCatalogSha256);
  assert.equal(persisted.input_manifest_sha256, first.input_manifest_sha256);
  assert.equal(computeManifestSha256(persisted), first.input_manifest_sha256);
  assert.equal(persisted.staged_documents, persisted.expected_documents);
  assert.deepEqual(Object.keys(persisted.documents[0]).sort(), [
    'artifact_key',
    'byte_size',
    'document_index',
    'file_name',
    'mime_type',
    'source_document_id',
    'source_sha256',
  ]);
  const manifestKeys = new Set([
    ...Object.keys(persisted),
    ...persisted.documents.flatMap((document) => Object.keys(document)),
  ]);
  for (const forbidden of ['page', 'pages', 'sheet', 'sheets', 'ooxml', 'parts', 'source_index']) {
    assert.equal(manifestKeys.has(forbidden), false);
  }
});

test('original file names stay metadata and never become filesystem paths', async (t) => {
  const { rootDirectory, store } = await createFixtureStore(t);
  const manifest = await loadFixture();
  manifest.documents[0].file_name = '../../outside.pdf';
  await store.createJob(manifest);
  await store.uploadDocument({
    jobId: manifest.job_id,
    artifactKey: manifest.documents[0].artifact_key,
    bodyStream: asStream(bytesFor('doc-001')),
  });

  const expectedPath = path.join(
    resolveJobPath(rootDirectory, manifest.job_id),
    'input',
    'documents',
    documentPhysicalName(manifest.documents[0]),
  );
  assert.equal((await stat(expectedPath)).isFile(), true);
  await assert.rejects(stat(path.join(rootDirectory, 'outside.pdf')));
});

test('catalog identity mismatch and external source mutation fail closed', async (t) => {
  const { rootDirectory, store } = await createFixtureStore(t);
  const manifest = await loadFixture();
  const wrongCatalog = clone(manifest);
  wrongCatalog.field_catalog_sha256 = 'F'.repeat(64);
  await assert.rejects(
    store.createJob(wrongCatalog),
    (error) => assertRunnerError(error, 'RUNNER_CATALOG_MISMATCH'),
  );

  await store.createJob(manifest);
  await stageAll(store, manifest);
  const target = path.join(
    resolveJobPath(rootDirectory, manifest.job_id),
    'input',
    'documents',
    documentPhysicalName(manifest.documents[0]),
  );
  await writeFile(target, 'externally changed');
  await assert.rejects(
    store.sealJob(manifest.job_id),
    (error) => assertRunnerError(error, 'RUNNER_DOCUMENT_MISMATCH'),
  );
});

test('known crash residue is cleaned without touching unrelated files', async (t) => {
  const { rootDirectory, store } = await createFixtureStore(t);
  const manifest = await loadFixture();
  await store.createJob(manifest);
  const jobPath = resolveJobPath(rootDirectory, manifest.job_id);
  const temporaryDirectory = path.join(jobPath, 'input', '.upload-tmp');
  await mkdir(temporaryDirectory, { recursive: true });
  await writeFile(path.join(temporaryDirectory, '.upload-11111111-1111-4111-8111-111111111111.tmp'), 'residue');
  await writeFile(path.join(temporaryDirectory, 'keep.txt'), 'unrelated');

  await store.uploadDocument({
    jobId: manifest.job_id,
    artifactKey: 'doc-001',
    bodyStream: asStream(bytesFor('doc-001')),
  });
  assert.deepEqual(await readdir(temporaryDirectory), ['keep.txt']);
});

test('a crash after atomic rename is recovered from exact staged bytes', async (t) => {
  const { rootDirectory, store } = await createFixtureStore(t);
  const manifest = await loadFixture();
  await store.createJob(manifest);
  const document = manifest.documents[0];
  const orphanedTarget = path.join(
    resolveJobPath(rootDirectory, manifest.job_id),
    'input',
    'documents',
    documentPhysicalName(document),
  );
  await writeFile(orphanedTarget, bytesFor(document.artifact_key));

  const recovered = await store.uploadDocument({
    jobId: manifest.job_id,
    artifactKey: document.artifact_key,
    bodyStream: asStream(bytesFor(document.artifact_key)),
  });
  assert.equal(recovered.idempotent, true);
  assert.equal(recovered.staged_documents, 1);
  assert.equal((await store.getJob(manifest.job_id)).staged_documents, 1);
});

test('authenticated HTTP routes create, stream, seal and report one exact job', async (t) => {
  const { store } = await createFixtureStore(t);
  const manifest = await loadFixture();
  const secret = 'm'.repeat(32);
  const server = createServer({
    authenticator: createHeaderAuthenticator(secret),
    healthProvider: async () => ({ schema_version: 'tender_codex_runner_health_v1', status: 'ready' }),
    v1Handler: createManifestRouteHandler({ jobStore: store }),
  });
  t.after(() => close(server));
  const base = await listen(server);
  const auth = { 'x-tender-codex-token': secret };

  const created = await fetch(`${base}/v1/jobs`, {
    method: 'PUT',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify(manifest),
  });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).status, 'staging');

  for (const document of manifest.documents) {
    const uploaded = await fetch(
      `${base}/v1/jobs/${manifest.job_id}/documents/${document.artifact_key}`,
      {
        method: 'PUT',
        headers: { ...auth, 'content-type': 'application/octet-stream' },
        body: bytesFor(document.artifact_key),
      },
    );
    assert.equal(uploaded.status, 200);
  }

  const sealed = await fetch(`${base}/v1/jobs/${manifest.job_id}/seal`, {
    method: 'POST',
    headers: auth,
  });
  assert.equal(sealed.status, 200);
  assert.equal((await sealed.json()).status, 'ready');

  const status = await fetch(`${base}/v1/jobs/${manifest.job_id}`, { headers: auth });
  assert.equal(status.status, 200);
  const statusBody = await status.json();
  assert.deepEqual({ ...statusBody, input_manifest_sha256: '<sha256>' }, {
    job_id: manifest.job_id,
    analysis_run_id: manifest.analysis_run_id,
    manifest_version: manifest.manifest_version,
    pipeline_version: manifest.pipeline_version,
    field_catalog_version: manifest.field_catalog_version,
    field_catalog_sha256: manifest.field_catalog_sha256,
    status: 'ready',
    expected_documents: 12,
    staged_documents: 12,
    input_manifest_sha256: '<sha256>',
  });
  assert.match(statusBody.input_manifest_sha256, /^[A-F0-9]{64}$/u);
});

test('GET job status rejects a request body instead of silently ignoring it', async (t) => {
  const { store } = await createFixtureStore(t);
  const manifest = await loadFixture();
  await store.createJob(manifest);
  const secret = 'b'.repeat(32);
  const server = createServer({
    authenticator: createHeaderAuthenticator(secret),
    healthProvider: async () => ({ schema_version: 'tender_codex_runner_health_v1', status: 'ready' }),
    v1Handler: createManifestRouteHandler({ jobStore: store }),
  });
  t.after(() => close(server));
  const base = await listen(server);

  const response = await new Promise((resolve, reject) => {
    const request = http.request(`${base}/v1/jobs/${manifest.job_id}`, {
      method: 'GET',
      headers: {
        'content-type': 'application/json',
        'content-length': '2',
        'x-tender-codex-token': secret,
      },
    }, (incoming) => {
      const chunks = [];
      incoming.on('data', (chunk) => chunks.push(chunk));
      incoming.on('end', () => resolve({
        statusCode: incoming.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    request.on('error', reject);
    request.end('{}');
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.error.code, 'RUNNER_REQUEST_INVALID');
});
