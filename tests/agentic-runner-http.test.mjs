import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { BODY_LIMITS, createConfig } from '../deploy/codex-runner/src/config.mjs';
import { RunnerError } from '../deploy/codex-runner/src/errors.mjs';
import { createHeaderAuthenticator } from '../deploy/codex-runner/src/http-auth.mjs';
import {
  buildCodexPermissionBoundary,
  buildIsolationNegativeCanary,
} from '../deploy/codex-runner/src/permissions.mjs';
import {
  buildHealthReport,
  createServer,
  createSingleProcessQueue,
  probeCommandVersion,
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

function openChunkedRequest(url, headers) {
  const target = new URL(url);
  let resolveResponse;
  let rejectResponse;
  const response = new Promise((resolve, reject) => {
    resolveResponse = resolve;
    rejectResponse = reject;
  });
  const request = http.request({
    hostname: target.hostname,
    port: target.port,
    path: target.pathname,
    method: 'PUT',
    headers,
  }, (incoming) => {
    const chunks = [];
    incoming.on('data', (chunk) => chunks.push(chunk));
    incoming.once('error', rejectResponse);
    incoming.once('end', () => resolveResponse({
      status: incoming.statusCode,
      body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
    }));
  });
  request.once('error', rejectResponse);
  return { request, response };
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
  assert.equal(config.maxConcurrentUploads, 1);
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
    isolationReady: true,
    codexAuthReady: true,
    isolationCanaryVerified: false,
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
    readiness: {
      auth: true,
      store: true,
      tools: true,
      isolation: true,
      codex_auth: true,
      isolation_canary: false,
      execute: false,
    },
    queue: { active: 0, queued: 0, max_concurrent: 1, max_queued: 2 },
  });
  assert.equal(JSON.stringify(body).includes(secret), false);
});

test('tool probes never promote nonzero, timeout or spawn diagnostics into a version', async () => {
  const failures = [
    Object.assign(new Error('nonzero'), { code: 7, stderr: 'tool version failed\nprivate detail' }),
    Object.assign(new Error('timeout'), { code: 'ETIMEDOUT', killed: true }),
    Object.assign(new Error('spawn'), { code: 'ENOENT' }),
  ];

  for (const failure of failures) {
    const result = await probeCommandVersion('tool', ['--version'], {
      execute: async () => { throw failure; },
    });
    assert.equal(result.version, null);
    assert.ok(result.diagnostic.length > 0);
    assert.ok(result.diagnostic.length <= 200);
  }
  const nonzero = await probeCommandVersion('tool', ['--version'], {
    execute: async () => { throw failures[0]; },
  });
  assert.equal(nonzero.diagnostic, 'tool version failed');

  const report = buildHealthReport({
    serviceVersion: '0.1.0',
    authReady: true,
    storeReady: true,
    isolationReady: true,
    codexAuthReady: true,
    isolationCanaryVerified: false,
    toolVersions: {
      node: process.version,
      codex: nonzero.version,
      poppler: '22.12.0',
      libreoffice: '7.4.7',
      tesseract: '5.3.0',
      ocr_languages: ['eng', 'rus'],
    },
    queue: { active: 0, queued: 0, max_concurrent: 1, max_queued: 1 },
  });
  assert.equal(report.status, 'not_ready');
  assert.equal(report.readiness.tools, false);
});

test('permission builder grants only current job roots and supplies CLI overrides after user-config isolation', () => {
  const jobId = '11111111-1111-4111-8111-111111111111';
  const boundary = buildCodexPermissionBoundary({ jobId });

  assert.equal(boundary.workspaceDirectory, `/data/jobs/${jobId}/workspace`);
  assert.deepEqual(boundary.readOnlyDirectories, [
    `/data/jobs/${jobId}/input`,
    `/data/jobs/${jobId}/source-index`,
  ]);
  assert.equal(boundary.cliArgs[0], '--ignore-user-config');
  assert.ok(boundary.cliArgs.includes('--strict-config'));
  assert.equal(boundary.cliArgs.includes('--sandbox'), false);
  assert.equal(boundary.cliArgs.some((arg) => arg.includes('dangerously-bypass')), false);

  const overrides = boundary.cliArgs.filter((_, index) => boundary.cliArgs[index - 1] === '-c');
  for (const required of [
    'default_permissions="tender-analysis-job"',
    'permissions.tender-analysis-job.filesystem.:root="deny"',
    'permissions.tender-analysis-job.filesystem.:minimal="read"',
    'permissions.tender-analysis-job.filesystem./data/jobs="deny"',
    `permissions.tender-analysis-job.filesystem./data/jobs/${jobId}/workspace="write"`,
    `permissions.tender-analysis-job.filesystem./data/jobs/${jobId}/input="read"`,
    `permissions.tender-analysis-job.filesystem./data/jobs/${jobId}/source-index="read"`,
    'permissions.tender-analysis-job.filesystem./run/codex-auth="deny"',
    'permissions.tender-analysis-job.filesystem./run/secrets="deny"',
    'permissions.tender-analysis-job.filesystem./proc/*/environ="deny"',
    'permissions.tender-analysis-job.filesystem.:tmpdir="deny"',
    'permissions.tender-analysis-job.filesystem.:slash_tmp="deny"',
    'permissions.tender-analysis-job.network.enabled=false',
    'shell_environment_policy.inherit="none"',
    'shell_environment_policy.ignore_default_excludes=false',
    'shell_environment_policy.experimental_use_profile=false',
  ]) {
    assert.ok(overrides.includes(required), `missing CLI permission override: ${required}`);
  }
  assert.ok(overrides.includes(`shell_environment_policy.set.HOME="/data/jobs/${jobId}/workspace"`));
  assert.ok(overrides.includes(`shell_environment_policy.set.TMPDIR="/data/jobs/${jobId}/workspace/.tmp"`));
  assert.equal(overrides.some((entry) => /KEY|SECRET|TOKEN|CODEX_HOME/u.test(entry)), false);
});

test('negative isolation canary covers sibling jobs, Codex auth and process environments', () => {
  const canary = buildIsolationNegativeCanary({
    jobId: '11111111-1111-4111-8111-111111111111',
    siblingJobId: '22222222-2222-4222-8222-222222222222',
  });
  assert.equal(canary.schema_version, 'tender_codex_runner_isolation_canary_v1');
  assert.deepEqual(canary.probes.map(({ id, expected }) => ({ id, expected })), [
    { id: 'sibling_job', expected: 'denied' },
    { id: 'codex_auth', expected: 'denied' },
    { id: 'runner_secret', expected: 'denied' },
    { id: 'self_process_environment', expected: 'denied' },
    { id: 'parent_process_environment', expected: 'denied' },
  ]);
});

test('execute-shaped routes fail closed until the Task 8 isolation canary is verified', async (t) => {
  const secret = 'e'.repeat(32);
  let handlerCalled = false;
  const server = createServer({
    authenticator: createHeaderAuthenticator(secret),
    healthProvider: async () => ({ schema_version: 'tender_codex_runner_health_v1', status: 'ready' }),
    executionBoundary: { ready: false },
    v1Handler: async () => {
      handlerCalled = true;
      return { success: true };
    },
  });
  t.after(() => close(server));
  const base = await listen(server);

  const response = await fetch(`${base}/v1/jobs/id/execute`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-tender-codex-token': secret,
    },
    body: '{}',
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'RUNNER_ISOLATION_NOT_READY');
  assert.equal(handlerCalled, false);
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

test('octet-stream uploads reach the handler incrementally and reject chunked overflow', async (t) => {
  const secret = 'f'.repeat(32);
  let firstChunkSeen;
  const observedFirstChunk = new Promise((resolve) => { firstChunkSeen = resolve; });
  const server = createServer({
    authenticator: createHeaderAuthenticator(secret),
    bodyLimits: { maxJsonBytes: 16, maxDocumentBytes: 10 },
    healthProvider: async () => ({ schema_version: 'tender_codex_runner_health_v1', status: 'ready' }),
    v1Handler: async ({ bodyKind, bodyStream, rawBody }) => {
      assert.equal(bodyKind, 'document');
      assert.equal(rawBody, null);
      let bytes = 0;
      let chunks = 0;
      for await (const chunk of bodyStream) {
        bytes += chunk.length;
        chunks += 1;
        if (chunks === 1) firstChunkSeen();
      }
      return { body: { bytes, chunks } };
    },
  });
  t.after(() => close(server));
  const base = await listen(server);
  const headers = {
    'content-type': 'application/octet-stream',
    'x-tender-codex-token': secret,
  };

  const streamed = openChunkedRequest(`${base}/v1/jobs/id/documents/1`, headers);
  streamed.request.write(Buffer.alloc(4, 1));
  const seenBeforeRequestEnd = await Promise.race([
    observedFirstChunk.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 250)),
  ]);
  streamed.request.write(Buffer.alloc(3, 2));
  streamed.request.end();
  const streamedResponse = await streamed.response;
  assert.equal(streamedResponse.status, 200);
  assert.equal(seenBeforeRequestEnd, true);
  assert.equal(streamedResponse.body.bytes, 7);
  assert.ok(streamedResponse.body.chunks >= 2);

  const oversized = openChunkedRequest(`${base}/v1/jobs/id/documents/2`, headers);
  oversized.request.write(Buffer.alloc(6, 1));
  oversized.request.end(Buffer.alloc(5, 2));
  const oversizedResponse = await oversized.response;
  assert.equal(oversizedResponse.status, 413);
  assert.equal(oversizedResponse.body.error.code, 'RUNNER_BODY_TOO_LARGE');
});

test('global upload bound rejects a concurrent document stream', async (t) => {
  const secret = 'a'.repeat(32);
  let releaseFirst;
  const firstBlocked = new Promise((resolve) => { releaseFirst = resolve; });
  let firstEntered;
  const entered = new Promise((resolve) => { firstEntered = resolve; });
  let handlerCalls = 0;
  const server = createServer({
    authenticator: createHeaderAuthenticator(secret),
    bodyLimits: { maxJsonBytes: 16, maxDocumentBytes: 32 },
    healthProvider: async () => ({ schema_version: 'tender_codex_runner_health_v1', status: 'ready' }),
    v1Handler: async ({ bodyStream }) => {
      handlerCalls += 1;
      for await (const _chunk of bodyStream) { /* stream into the Task 5 sink */ }
      if (handlerCalls === 1) {
        firstEntered();
        await firstBlocked;
      }
      return { success: true };
    },
  });
  t.after(() => close(server));
  const base = await listen(server);
  const headers = {
    'content-type': 'application/octet-stream',
    'x-tender-codex-token': secret,
  };

  const first = fetch(`${base}/v1/jobs/id/documents/1`, {
    method: 'PUT', headers, body: Buffer.alloc(8),
  });
  await entered;
  const second = await fetch(`${base}/v1/jobs/id/documents/2`, {
    method: 'PUT', headers, body: Buffer.alloc(8),
  });
  assert.equal(second.status, 503);
  assert.equal((await second.json()).error.code, 'RUNNER_UPLOAD_BUSY');
  assert.equal(handlerCalls, 1);

  releaseFirst();
  assert.equal((await first).status, 200);
});

test('typed and unexpected errors expose only bounded safe messages', async (t) => {
  const secret = 'd'.repeat(32);
  let failureMode = 'typed';
  const server = createServer({
    authenticator: createHeaderAuthenticator(secret),
    healthProvider: async () => ({ schema_version: 'tender_codex_runner_health_v1', status: 'ready' }),
    v1Handler: async () => {
      if (failureMode === 'unexpected') throw new Error('private-token=must-not-leak');
      if (failureMode === 'unknown-code') {
        throw new RunnerError('PRIVATE_PLUGIN_FAILURE', 'credential=supersecret', 418);
      }
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

  failureMode = 'unexpected';
  const internal = await fetch(`${base}/v1/jobs`, { headers });
  assert.equal(internal.status, 500);
  const internalText = await internal.text();
  assert.equal(internalText.includes('private-token'), false);
  assert.equal(JSON.parse(internalText).error.code, 'RUNNER_INTERNAL');

  failureMode = 'unknown-code';
  const unknown = await fetch(`${base}/v1/jobs`, { headers });
  assert.equal(unknown.status, 500);
  const unknownText = await unknown.text();
  assert.equal(unknownText.includes('supersecret'), false);
  assert.deepEqual(JSON.parse(unknownText).error, {
    code: 'RUNNER_INTERNAL',
    message: 'Runner request failed',
  });
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
