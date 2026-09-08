import assert from 'node:assert/strict';
import test from 'node:test';

import { BODY_LIMITS, createConfig } from '../deploy/codex-runner/src/config.mjs';
import { RunnerError } from '../deploy/codex-runner/src/errors.mjs';
import { createHeaderAuthenticator } from '../deploy/codex-runner/src/http-auth.mjs';
import {
  buildHealthReport,
  createServer,
  createSingleProcessQueue,
} from '../deploy/codex-runner/src/server.mjs';

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

test('configuration fixes one Codex process and exact JSON/document request limits', () => {
  assert.deepEqual(BODY_LIMITS, {
    maxJsonBytes: 2 * 1024 * 1024,
    maxDocumentBytes: 50 * 1024 * 1024,
  });

  const config = createConfig({
    TENDER_CODEX_RUNNER_AUTH_TOKEN: 'a'.repeat(32),
    TENDER_CODEX_RUNNER_MAX_QUEUED_JOBS: '3',
  });
  assert.equal(config.maxConcurrentCodex, 1);
  assert.equal(config.maxQueuedJobs, 3);
});

test('GET /health exposes readiness and tool versions without secrets', async (t) => {
  const secret = 'runner-secret-that-must-never-leak';
  const queue = createSingleProcessQueue({ maxQueuedJobs: 2 });
  const health = buildHealthReport({
    serviceVersion: '0.1.0',
    authReady: true,
    storeReady: true,
    toolVersions: {
      node: 'v24.18.0',
      codex: 'codex-cli 0.153.4',
      poppler: '22.12.0',
      libreoffice: '7.4.7.2',
      tesseract: '5.3.0',
      ocr_languages: ['eng', 'rus'],
    },
    queue: queue.snapshot(),
  });
  const server = createServer({
    authenticator: createHeaderAuthenticator(secret),
    healthProvider: async () => health,
  });
  t.after(() => close(server));
  const base = await listen(server);

  const response = await fetch(`${base}/health`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.deepEqual(body, {
    schema_version: 'tender_codex_runner_health_v1',
    status: 'ready',
    service_version: '0.1.0',
    tools: {
      node: 'v24.18.0',
      codex: 'codex-cli 0.153.4',
      poppler: '22.12.0',
      libreoffice: '7.4.7.2',
      tesseract: '5.3.0',
      ocr_languages: ['eng', 'rus'],
    },
    readiness: { auth: true, store: true, tools: true },
    queue: { active: 0, queued: 0, max_concurrent: 1, max_queued: 2 },
  });
  assert.equal(JSON.stringify(body).includes(secret), false);
});

test('/v1/* rejects missing and wrong Header Auth but accepts the exact token', async (t) => {
  const secret = 'b'.repeat(32);
  const server = createServer({
    authenticator: createHeaderAuthenticator(secret),
    healthProvider: async () => ({ schema_version: 'tender_codex_runner_health_v1', status: 'ready' }),
    v1Handler: async ({ rawBody }) => ({ statusCode: 200, body: { success: true, bytes: rawBody.length } }),
  });
  t.after(() => close(server));
  const base = await listen(server);

  for (const headers of [{}, { 'x-tender-codex-token': 'wrong-token' }]) {
    const response = await fetch(`${base}/v1/jobs`, { headers });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      success: false,
      error: { code: 'RUNNER_AUTH_REQUIRED', message: 'Runner authentication failed' },
    });
  }

  const accepted = await fetch(`${base}/v1/jobs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-tender-codex-token': secret,
    },
    body: '{}',
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { success: true, bytes: 2 });
});

test('protected requests enforce bounded JSON and document bodies', async (t) => {
  const secret = 'c'.repeat(32);
  const server = createServer({
    authenticator: createHeaderAuthenticator(secret),
    bodyLimits: { maxJsonBytes: 16, maxDocumentBytes: 32 },
    healthProvider: async () => ({ schema_version: 'tender_codex_runner_health_v1', status: 'ready' }),
    v1Handler: async ({ rawBody }) => ({ statusCode: 200, body: { bytes: rawBody.length } }),
  });
  t.after(() => close(server));
  const base = await listen(server);
  const auth = { 'x-tender-codex-token': secret };

  const oversizedJson = await fetch(`${base}/v1/jobs`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ value: 'x'.repeat(32) }),
  });
  assert.equal(oversizedJson.status, 413);
  assert.equal((await oversizedJson.json()).error.code, 'RUNNER_BODY_TOO_LARGE');

  const oversizedDocument = await fetch(`${base}/v1/jobs/id/documents/1`, {
    method: 'PUT',
    headers: { ...auth, 'content-type': 'application/octet-stream' },
    body: Buffer.alloc(33),
  });
  assert.equal(oversizedDocument.status, 413);
  assert.equal((await oversizedDocument.json()).error.code, 'RUNNER_BODY_TOO_LARGE');

  const unsupported = await fetch(`${base}/v1/jobs`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'text/plain' },
    body: 'hello',
  });
  assert.equal(unsupported.status, 415);
  assert.equal((await unsupported.json()).error.code, 'RUNNER_CONTENT_TYPE_INVALID');
});

test('typed and unexpected errors expose only bounded safe messages', async (t) => {
  const secret = 'd'.repeat(32);
  let unexpected = false;
  const server = createServer({
    authenticator: createHeaderAuthenticator(secret),
    healthProvider: async () => ({ schema_version: 'tender_codex_runner_health_v1', status: 'ready' }),
    v1Handler: async () => {
      if (unexpected) throw new Error('private-token=must-not-leak');
      throw new RunnerError('RUNNER_REQUEST_INVALID', `${'x'.repeat(600)}\r\ninjected`, 422);
    },
  });
  t.after(() => close(server));
  const base = await listen(server);
  const headers = { 'x-tender-codex-token': secret };

  const typed = await fetch(`${base}/v1/jobs`, { headers });
  assert.equal(typed.status, 422);
  const typedBody = await typed.json();
  assert.equal(typedBody.error.code, 'RUNNER_REQUEST_INVALID');
  assert.ok(typedBody.error.message.length <= 500);
  assert.doesNotMatch(typedBody.error.message, /[\r\n]/u);

  unexpected = true;
  const internal = await fetch(`${base}/v1/jobs`, { headers });
  assert.equal(internal.status, 500);
  const internalText = await internal.text();
  assert.equal(internalText.includes('private-token'), false);
  assert.equal(JSON.parse(internalText).error.code, 'RUNNER_INTERNAL');
});

test('single-process queue never overlaps work and rejects beyond its bound', async () => {
  const queue = createSingleProcessQueue({ maxQueuedJobs: 1 });
  let releaseFirst;
  const firstBlocked = new Promise((resolve) => { releaseFirst = resolve; });
  let enteredFirst;
  const firstEntered = new Promise((resolve) => { enteredFirst = resolve; });
  let active = 0;
  let peak = 0;

  const task = (blocked = false) => queue.run(async () => {
    active += 1;
    peak = Math.max(peak, active);
    if (blocked) {
      enteredFirst();
      await firstBlocked;
    }
    active -= 1;
    return 'done';
  });

  const first = task(true);
  await firstEntered;
  const queued = task();
  await assert.rejects(
    task(),
    (error) => error instanceof RunnerError && error.code === 'RUNNER_QUEUE_FULL',
  );
  assert.deepEqual(queue.snapshot(), { active: 1, queued: 1, max_concurrent: 1, max_queued: 1 });

  releaseFirst();
  assert.deepEqual(await Promise.all([first, queued]), ['done', 'done']);
  assert.equal(peak, 1);
  assert.deepEqual(queue.snapshot(), { active: 0, queued: 0, max_concurrent: 1, max_queued: 1 });
});
