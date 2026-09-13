import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { startFakeCanaryRunner } from './runtime/agentic-fake-runner-canary.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const resultFile = path.join(testDirectory, 'fixtures', 'agentic', 'results', 'valid-27.json');

test('fake canary runner stays authenticated and returns one deterministic exact-27 result', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentic-fake-canary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const token = 'fake-canary-token-that-is-long-enough';
  const tokenFile = path.join(root, 'token');
  await writeFile(tokenFile, token, 'utf8');
  const runner = await startFakeCanaryRunner({ host: '127.0.0.1', port: 0, tokenFile, resultFile });
  t.after(() => runner.close());
  const address = runner.server.address();
  const base = `http://127.0.0.1:${address.port}`;
  const auth = { 'x-tender-codex-token': token };

  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await fetch(`${base}/v1/jobs/example`)).status, 401);

  const manifest = {
    manifest_version: 'tender_source_manifest_v1',
    job_id: '11111111-1111-4111-8111-111111111111',
    analysis_run_id: '22222222-2222-4222-8222-222222222222',
    pipeline_version: 'tender_agentic_pipeline_v1',
    field_catalog_version: 'tender_fields_v1',
    field_catalog_sha256: 'A'.repeat(64),
    expected_documents: 1,
    documents: [],
  };
  const created = await fetch(`${base}/v1/jobs`, {
    method: 'PUT',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify(manifest),
  });
  assert.equal(created.status, 201);

  const document = Buffer.from('fake document bytes', 'utf8');
  const documentHash = createHash('sha256').update(document).digest('hex').toUpperCase();
  const uploaded = await fetch(`${base}/v1/jobs/${manifest.job_id}/documents/document-1`, {
    method: 'PUT',
    headers: { ...auth, 'x-content-sha256': documentHash },
    body: document,
  });
  assert.equal(uploaded.status, 200);
  assert.equal((await uploaded.json()).sha256, documentHash);

  const sealed = await fetch(`${base}/v1/jobs/${manifest.job_id}/seal`, { method: 'POST', headers: auth });
  assert.equal(sealed.status, 200);
  assert.match((await sealed.json()).input_manifest_sha256, /^[0-9a-f]{64}$/u);
  assert.equal((await fetch(`${base}/v1/jobs/${manifest.job_id}/start`, { method: 'POST', headers: auth })).status, 202);
  assert.equal((await (await fetch(`${base}/v1/jobs/${manifest.job_id}`, { headers: auth })).json()).status, 'completed');
  const envelope = await (await fetch(`${base}/v1/jobs/${manifest.job_id}/result`, { headers: auth })).json();
  assert.equal(envelope.validation.valid, true);
  assert.equal(envelope.result.fields.length, 27);
  assert.equal(envelope.result.field_catalog_sha256, manifest.field_catalog_sha256);
});
