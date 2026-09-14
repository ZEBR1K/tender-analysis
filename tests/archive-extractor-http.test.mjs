import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ArchiveError } from '../deploy/archive-extractor/src/errors.mjs';
import { createServer } from '../deploy/archive-extractor/src/server.mjs';
import { createSourceUploader } from '../deploy/archive-extractor/src/source-upload.mjs';
import { createStore } from '../deploy/archive-extractor/src/store.mjs';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = `${RUN_ID}--source-000001`;
const ARTIFACT_ID = 'a'.repeat(64);

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function postUrl(base, overrides = {}) {
  const query = new URLSearchParams({
    run_id: overrides.runId ?? RUN_ID,
    source_attachment_index: String(overrides.sourceAttachmentIndex ?? 1),
    declared_extension: overrides.declaredExtension ?? 'zip',
    deadline_epoch_ms: String(overrides.deadlineEpochMs ?? Date.now() + 300_000),
  });
  return `${base}/v1/extractions/${overrides.jobId ?? JOB_ID}?${query}`;
}

test('HTTP service exposes health and a successful extraction manifest without binary', async (t) => {
  const calls = [];
  const server = createServer({
    publicBaseUrl: 'http://tender-archive-extractor:8080',
    extractJob: async (input) => {
      let body = '';
      for await (const chunk of input.inputStream) body += chunk.toString('utf8');
      calls.push({ ...input, inputStream: undefined, body });
      return {
        schema_version: 'tender_archive_extraction_v1',
        success: true,
        job_id: JOB_ID,
        analysis_run_id: RUN_ID,
        source_attachment_index: 1,
        source: { declared_extension: 'zip', detected_format: 'zip', size_bytes: 3, sha256: 'b'.repeat(64) },
        stats: { entry_count: 1, unpacked_total_bytes: 3, archive_count: 1, duration_ms: 1 },
        entries: [{
          kind: 'file', logical_path: 'a.pdf', file_name: 'a.pdf', file_extension: 'pdf',
          archive_depth: 1, archive_chain: [], mime_type: 'application/pdf', size_bytes: 3,
          sha256: 'c'.repeat(64), artifact_id: ARTIFACT_ID,
        }],
      };
    },
    store: { cleanupExpiredRuns: async () => [] },
  });
  t.after(() => close(server));
  const base = await listen(server);

  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok', schema_version: 'tender_archive_extractor_health_v1' });

  const response = await fetch(postUrl(base), {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: Buffer.from('zip'),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^application\/json/u);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const result = await response.json();
  assert.equal(result.success, true);
  assert.equal(result.entries[0].download_url, `http://tender-archive-extractor:8080/v1/artifacts/${RUN_ID}/${ARTIFACT_ID}`);
  assert.equal(JSON.stringify(result).includes('emlw'), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body, 'zip');
});

test('HTTP service accepts one manual source file and decorates its artifact URL', async (t) => {
  const calls = [];
  const sourceUploader = {
    uploadSource: async (input) => {
      let body = '';
      for await (const chunk of input.inputStream) body += chunk.toString('utf8');
      calls.push({ ...input, inputStream: undefined, body });
      return {
        schema_version: 'tender_manual_source_upload_v1',
        success: true,
        job_id: `${RUN_ID}--upload-000001`,
        analysis_run_id: RUN_ID,
        source_attachment_index: 1,
        entries: [{
          kind: 'file', logical_path: 'report.pdf', file_name: 'report.pdf', file_extension: 'pdf',
          archive_depth: 0, archive_chain: [], mime_type: 'application/pdf', size_bytes: 3,
          sha256: ARTIFACT_ID, artifact_id: ARTIFACT_ID,
        }],
      };
    },
  };
  const server = createServer({
    sourceUploader,
    extractJob: async () => assert.fail('not expected'),
    store: { cleanupExpiredRuns: async () => [] },
    publicBaseUrl: 'http://tender-archive-extractor:8080',
  });
  t.after(() => close(server));
  const base = await listen(server);
  const query = new URLSearchParams({
    run_id: RUN_ID,
    source_attachment_index: '1',
    declared_extension: 'pdf',
    file_name: 'report.pdf',
    mime_type: 'application/pdf',
  });

  const response = await fetch(`${base}/v1/source-files/${RUN_ID}--upload-000001?${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/pdf' },
    body: Buffer.from('pdf'),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.entries[0].download_url, `http://tender-archive-extractor:8080/v1/artifacts/${RUN_ID}/${ARTIFACT_ID}`);
  assert.equal(calls[0].fileName, 'report.pdf');
  assert.equal(calls[0].mimeType, 'application/pdf');
  assert.equal(calls[0].body, 'pdf');
});

test('HTTP service rejects a manual source body whose media type disagrees with metadata', async (t) => {
  const server = createServer({
    sourceUploader: { uploadSource: async () => assert.fail('not expected') },
    extractJob: async () => assert.fail('not expected'),
    store: { cleanupExpiredRuns: async () => [] },
  });
  t.after(() => close(server));
  const base = await listen(server);
  const query = new URLSearchParams({
    run_id: RUN_ID,
    source_attachment_index: '1',
    declared_extension: 'pdf',
    file_name: 'report.pdf',
    mime_type: 'application/pdf',
  });

  const response = await fetch(`${base}/v1/source-files/${RUN_ID}--upload-000001?${query}`, {
    method: 'POST',
    headers: { 'content-type': 'image/png' },
    body: Buffer.from('not a pdf'),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'INGESTION_CONTRACT_INVALID');
});

test('HTTP service returns typed 413 when a manual source exceeds its per-file limit', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'archive-source-limit-http-'));
  const store = createStore({ rootDirectory: root, ttlHours: 72 });
  const sourceUploader = createSourceUploader({
    store,
    limits: { maxDocumentBytes: 4, maxArchiveBytes: 8 },
  });
  const server = createServer({
    sourceUploader,
    extractJob: async () => assert.fail('not expected'),
    store,
  });
  t.after(() => close(server));
  const base = await listen(server);
  const query = new URLSearchParams({
    run_id: RUN_ID,
    source_attachment_index: '1',
    declared_extension: 'pdf',
    file_name: 'report.pdf',
    mime_type: 'application/pdf',
  });

  const response = await fetch(`${base}/v1/source-files/${RUN_ID}--upload-000001?${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/pdf' },
    body: Buffer.from('12345'),
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, 'SOURCE_FILE_TOO_LARGE');
});

test('HTTP service returns typed 4xx errors and rejects invalid routes and identifiers', async (t) => {
  const server = createServer({
    extractJob: async () => {
      throw new ArchiveError('ARCHIVE_CORRUPT', 'Archive cannot be read', 422, { safe: true });
    },
    store: { cleanupExpiredRuns: async () => [] },
  });
  t.after(() => close(server));
  const base = await listen(server);

  const corrupt = await fetch(postUrl(base), {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: Buffer.from('bad'),
  });
  assert.equal(corrupt.status, 422);
  assert.deepEqual(await corrupt.json(), {
    success: false,
    error: { code: 'ARCHIVE_CORRUPT', message: 'Archive cannot be read', details: { safe: true } },
  });

  const invalid = await fetch(`${base}/v1/artifacts/not-a-uuid/${ARTIFACT_ID}`);
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, 'INGESTION_CONTRACT_INVALID');

  const method = await fetch(`${base}/health`, { method: 'POST', body: 'x' });
  assert.equal(method.status, 405);
  assert.equal((await method.json()).error.code, 'INGESTION_CONTRACT_INVALID');

  const missing = await fetch(`${base}/does-not-exist`);
  assert.equal(missing.status, 404);
});

test('HTTP service streams an exact artifact and deletes only an exact run', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'archive-http-'));
  const artifactPath = path.join(root, 'artifact.bin');
  await writeFile(artifactPath, 'pdf bytes');
  const deleted = [];
  const store = {
    cleanupExpiredRuns: async () => [],
    resolveArtifact: async ({ analysisRunId, artifactId }) => {
      assert.equal(analysisRunId, RUN_ID);
      assert.equal(artifactId, ARTIFACT_ID);
      return { path: artifactPath, artifact: { file_name: 'quote " report.pdf', mime_type: 'application/pdf' } };
    },
    deleteRun: async (analysisRunId) => deleted.push(analysisRunId),
  };
  const server = createServer({ extractJob: async () => assert.fail('not expected'), store });
  t.after(() => close(server));
  const base = await listen(server);

  const artifact = await fetch(`${base}/v1/artifacts/${RUN_ID}/${ARTIFACT_ID}`);
  assert.equal(artifact.status, 200);
  assert.equal(await artifact.text(), 'pdf bytes');
  assert.equal(artifact.headers.get('content-type'), 'application/pdf');
  assert.equal(
    artifact.headers.get('content-disposition'),
    `attachment; filename="artifact-${ARTIFACT_ID.slice(0, 12)}.pdf"; filename*=UTF-8''quote%20_%20report.pdf`,
  );

  const deletion = await fetch(`${base}/v1/runs/${RUN_ID}`, { method: 'DELETE' });
  assert.equal(deletion.status, 200);
  assert.deepEqual(await deletion.json(), { success: true, analysis_run_id: RUN_ID, deleted: true });
  assert.deepEqual(deleted, [RUN_ID]);
});

test('HTTP service downloads an exact artifact with a Cyrillic artifact filename', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'archive-http-cyrillic-'));
  const artifactPath = path.join(root, 'artifact.bin');
  const expectedBody = Buffer.from('byte-identical Cyrillic artifact body', 'utf8');
  await writeFile(artifactPath, expectedBody);
  const store = {
    cleanupExpiredRuns: async () => [],
    resolveArtifact: async () => ({
      path: artifactPath,
      artifact: { file_name: '0_Общая_часть_зо.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    }),
  };
  const server = createServer({ extractJob: async () => assert.fail('not expected'), store });
  t.after(() => close(server));
  const base = await listen(server);

  const artifact = await fetch(`${base}/v1/artifacts/${RUN_ID}/${ARTIFACT_ID}`);
  const actualBody = Buffer.from(await artifact.arrayBuffer());

  assert.equal(artifact.status, 200);
  assert.deepEqual(actualBody, expectedBody);
  assert.equal(
    createHash('sha256').update(actualBody).digest('hex'),
    createHash('sha256').update(expectedBody).digest('hex'),
  );
  assert.equal(
    artifact.headers.get('content-disposition'),
    `attachment; filename="artifact-${ARTIFACT_ID.slice(0, 12)}.docx"; filename*=UTF-8''0_%D0%9E%D0%B1%D1%89%D0%B0%D1%8F_%D1%87%D0%B0%D1%81%D1%82%D1%8C_%D0%B7%D0%BE.docx`,
  );
});

test('HTTP service admits one extraction and returns EXTRACTOR_BUSY to a concurrent POST', async (t) => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let enteredResolve;
  const entered = new Promise((resolve) => { enteredResolve = resolve; });
  const server = createServer({
    extractJob: async ({ inputStream }) => {
      for await (const _chunk of inputStream) { /* drain */ }
      enteredResolve();
      await blocked;
      return {
        schema_version: 'tender_archive_extraction_v1', success: true, job_id: JOB_ID,
        analysis_run_id: RUN_ID, source_attachment_index: 1,
        source: { declared_extension: 'zip', detected_format: 'zip', size_bytes: 1, sha256: 'b'.repeat(64) },
        stats: { entry_count: 0, unpacked_total_bytes: 0, archive_count: 1, duration_ms: 1 }, entries: [],
      };
    },
    store: { cleanupExpiredRuns: async () => [] },
  });
  t.after(() => close(server));
  const base = await listen(server);

  const first = fetch(postUrl(base), {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.from('a'),
  });
  await entered;
  const second = await fetch(postUrl(base, { sourceAttachmentIndex: 2, jobId: `${RUN_ID}--source-000002` }), {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.from('b'),
  });
  assert.equal(second.status, 503);
  assert.equal((await second.json()).error.code, 'EXTRACTOR_BUSY');
  release();
  assert.equal((await first).status, 200);
});

test('HTTP service calls TTL cleanup without blocking requests', async (t) => {
  let cleanupCalls = 0;
  const server = createServer({
    extractJob: async () => assert.fail('not expected'),
    store: { cleanupExpiredRuns: async () => { cleanupCalls += 1; return []; } },
    cleanupIntervalMs: 10,
  });
  t.after(() => close(server));
  const base = await listen(server);
  await new Promise((resolve) => setTimeout(resolve, 35));
  const response = await fetch(`${base}/health`);
  assert.equal(response.status, 200);
  assert.ok(cleanupCalls >= 1);
});
