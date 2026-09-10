import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createJobStore, resolveJobPath } from '../deploy/codex-runner/src/job-store.mjs';
import { createAgentResultValidator } from '../deploy/codex-runner/src/result-validator.mjs';
import {
  createManifestRouteHandler,
  createServer,
  createSingleProcessQueue,
  initializeJobStore,
} from '../deploy/codex-runner/src/server.mjs';
import { createHeaderAuthenticator } from '../deploy/codex-runner/src/http-auth.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..');
const manifestFixturePath = path.join(
  testDirectory,
  'fixtures',
  'agentic',
  'manifest-12-documents.json',
);
const resultFixturePath = path.join(
  testDirectory,
  'fixtures',
  'agentic',
  'results',
  'valid-27.json',
);
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
  return (async function* stream() { yield buffer; }());
}

async function loadJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function setupReadyJob(t, { now, faultInjector } = {}) {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), 'agentic-lifecycle-'));
  t.after(() => rm(rootDirectory, { recursive: true, force: true }));
  const manifest = await loadJson(manifestFixturePath);
  const store = createJobStore({
    rootDirectory,
    fieldCatalogPath: catalogPath,
    expectedCatalogSha256,
    now,
    faultInjector,
  });
  await store.createJob(manifest);
  for (const document of manifest.documents) {
    await store.uploadDocument({
      jobId: manifest.job_id,
      artifactKey: document.artifact_key,
      bodyStream: asStream(bytesFor(document.artifact_key)),
    });
  }
  const sealed = await store.sealJob(manifest.job_id);
  const result = await loadJson(resultFixturePath);
  result.input_manifest_sha256 = sealed.input_manifest_sha256;
  result.inspected_documents[0].artifact_key = manifest.documents[0].artifact_key;
  for (const field of result.fields) {
    for (const evidence of field.evidence) {
      evidence.artifact_key = manifest.documents[0].artifact_key;
    }
  }
  return { rootDirectory, manifest, store, result };
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function waitForStatus(store, jobId, expected, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await store.getJob(jobId);
    if (current.status === expected) return current;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`job did not reach ${expected}`);
}

function successExecution(rawResult, attempt) {
  return {
    ok: true,
    code: 'CODEX_COMPLETED',
    exit_code: 0,
    timed_out: false,
    valid_json_result: true,
    raw_result: Buffer.from(`${JSON.stringify(rawResult)}\n`, 'utf8'),
    events: {
      thread_id: `thread-${attempt}`,
      terminal_event: 'turn.completed',
      event_count: 2,
      usage: {
        input_tokens: 100,
        cached_input_tokens: 80,
        output_tokens: 20,
        reasoning_output_tokens: 5,
      },
    },
    artifacts: {
      events: `codex-events.attempt-${attempt}.jsonl`,
      stderr: `codex-stderr.attempt-${attempt}.log`,
      status: `codex-status.attempt-${attempt}.json`,
    },
  };
}

test('HTTP lifecycle is asynchronous and idempotent from ready through completed', async (t) => {
  const fixture = await setupReadyJob(t);
  const validator = await createAgentResultValidator({ jobStore: fixture.store });
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let executions = 0;
  const executeAttempt = async ({ attempt }) => {
    executions += 1;
    await blocked;
    return successExecution(fixture.result, attempt);
  };
  const queue = createSingleProcessQueue({ maxQueuedJobs: 2 });
  const handler = createManifestRouteHandler({
    jobStore: fixture.store,
    executeAttempt,
    resultValidator: validator,
  });
  const secret = 'l'.repeat(32);
  const server = createServer({
    authenticator: createHeaderAuthenticator(secret),
    executionBoundary: { verify: async () => ({ verified: true }) },
    healthProvider: async () => ({ schema_version: 'test', status: 'ready' }),
    queue,
    v1Handler: handler,
  });
  t.after(() => close(server));
  const base = await listen(server);
  const headers = { 'x-tender-codex-token': secret };
  const startUrl = `${base}/v1/jobs/${fixture.manifest.job_id}/start`;

  const first = await fetch(startUrl, { method: 'POST', headers });
  assert.equal(first.status, 202);
  assert.equal((await first.json()).status, 'running');
  const repeated = await fetch(startUrl, { method: 'POST', headers });
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json()).idempotent, true);
  assert.equal(executions, 1);

  release();
  const completed = await waitForStatus(fixture.store, fixture.manifest.job_id, 'completed');
  assert.equal(completed.attempt, 1);
  assert.equal(executions, 1);

  const completedStart = await fetch(startUrl, { method: 'POST', headers });
  assert.equal(completedStart.status, 200);
  assert.equal((await completedStart.json()).status, 'completed');
  assert.equal(executions, 1);

  const resultResponse = await fetch(
    `${base}/v1/jobs/${fixture.manifest.job_id}/result`,
    { headers },
  );
  assert.equal(resultResponse.status, 200);
  const body = await resultResponse.json();
  assert.equal(body.result.fields.length, 27);
  assert.equal(body.validation.schema_version, 'tender_agent_validation_v1');
});

test('contract failure is terminal and never triggers a paid retry', async (t) => {
  const fixture = await setupReadyJob(t);
  const validator = await createAgentResultValidator({ jobStore: fixture.store });
  const invalid = structuredClone(fixture.result);
  invalid.fields[0].evidence[0].locator = '   ';
  let executions = 0;
  const handler = createManifestRouteHandler({
    jobStore: fixture.store,
    resultValidator: validator,
    executeAttempt: async ({ attempt }) => {
      executions += 1;
      return successExecution(invalid, attempt);
    },
  });
  await handler({
    requestMetadata: { method: 'POST', headers: {} },
    url: new URL(`http://runner/v1/jobs/${fixture.manifest.job_id}/start`),
    bodyKind: 'none',
    rawBody: Buffer.alloc(0),
    bodyStream: null,
    queue: createSingleProcessQueue({ maxQueuedJobs: 1 }),
  });
  const failed = await waitForStatus(fixture.store, fixture.manifest.job_id, 'failed');
  assert.equal(failed.failure.code, 'CODEX_CONTRACT_INVALID');
  assert.equal(failed.failure.retryable, false);
  assert.equal(executions, 1);
  assert.equal(failed.failure.validation.envelope_available, true);
  const validationAudit = await loadJson(path.join(
    resolveJobPath(fixture.rootDirectory, fixture.manifest.job_id),
    'audit',
    failed.failure.validation.artifact,
  ));
  assert.equal(validationAudit.valid, false);
  assert.equal(
    validationAudit.fields.flatMap((field) => field.issues)
      .some((issue) => issue.code === 'LOCATOR_INVALID'),
    true,
  );
});

test('one process failure without valid JSON receives exactly one automatic second attempt', async (t) => {
  const fixture = await setupReadyJob(t);
  const validator = await createAgentResultValidator({ jobStore: fixture.store });
  const attempts = [];
  const handler = createManifestRouteHandler({
    jobStore: fixture.store,
    resultValidator: validator,
    executeAttempt: async ({ attempt }) => {
      attempts.push(attempt);
      if (attempt === 1) {
        return {
          ok: false,
          code: 'CODEX_PROCESS_FAILED',
          valid_json_result: false,
          events: {
            thread_id: 'failed-thread-1',
            usage: {
              input_tokens: 123,
              cached_input_tokens: 100,
              output_tokens: 23,
              reasoning_output_tokens: 7,
            },
          },
          artifacts: { status: 'attempt-1-status.json' },
        };
      }
      return successExecution(fixture.result, attempt);
    },
  });
  await handler({
    requestMetadata: { method: 'POST', headers: {} },
    url: new URL(`http://runner/v1/jobs/${fixture.manifest.job_id}/start`),
    bodyKind: 'none',
    rawBody: Buffer.alloc(0),
    bodyStream: null,
    queue: createSingleProcessQueue({ maxQueuedJobs: 1 }),
  });
  const completed = await waitForStatus(fixture.store, fixture.manifest.job_id, 'completed');
  assert.deepEqual(attempts, [1, 2]);
  assert.equal(completed.attempt, 2);
  assert.equal(completed.prior_attempts.length, 1);
  assert.equal(completed.prior_attempts[0].code, 'CODEX_PROCESS_FAILED');
  assert.equal(completed.prior_attempts[0].execution.thread_id, 'failed-thread-1');
  assert.equal(completed.prior_attempts[0].execution.usage.cached_input_tokens, 100);
  assert.equal(completed.prior_attempts[0].execution.artifacts.status, 'attempt-1-status.json');
});

test('restart recovery marks orphaned work as typed retryable failure', async (t) => {
  const fixture = await setupReadyJob(t);
  const claimed = await fixture.store.claimStart(fixture.manifest.job_id);
  assert.equal(claimed.status, 'running');
  assert.equal(claimed.should_execute, true);

  const restarted = createJobStore({
    rootDirectory: fixture.rootDirectory,
    fieldCatalogPath: catalogPath,
    expectedCatalogSha256,
  });
  const recovery = await restarted.recoverOrphanedJobs();
  assert.deepEqual(recovery, {
    recovered_jobs: 1,
    job_ids: [fixture.manifest.job_id],
  });
  const failed = await restarted.getJob(fixture.manifest.job_id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.failure.code, 'RUNNER_ORPHANED_EXECUTION');
  assert.equal(failed.failure.retryable, true);
  const retry = await restarted.claimStart(fixture.manifest.job_id);
  assert.equal(retry.attempt, 2);
  assert.equal(retry.should_execute, true);
  assert.deepEqual(retry.prior_attempts.map(({ attempt, code, retryable }) => ({
    attempt,
    code,
    retryable,
  })), [{
    attempt: 1,
    code: 'RUNNER_ORPHANED_EXECUTION',
    retryable: true,
  }]);
});

test('restart commits a fully journaled success after a crash before state update', async (t) => {
  let injectCrash = true;
  const fixture = await setupReadyJob(t, {
    faultInjector: async (phase) => {
      if (injectCrash && phase === 'after-terminal-validation-artifact') {
        injectCrash = false;
        throw new Error('simulated crash after terminal journal');
      }
    },
  });
  const validator = await createAgentResultValidator({ jobStore: fixture.store });
  const claim = await fixture.store.claimStart(fixture.manifest.job_id);
  const execution = successExecution(fixture.result, claim.attempt);
  await fixture.store.markValidating(fixture.manifest.job_id, {
    attempt: claim.attempt,
    execution,
  });
  const validation = await validator.validate({
    jobId: fixture.manifest.job_id,
    rawResult: execution.raw_result,
  });
  await assert.rejects(
    fixture.store.completeAttempt(fixture.manifest.job_id, {
      attempt: claim.attempt,
      execution,
      rawResult: execution.raw_result,
      validationEnvelope: validation.envelope,
    }),
    /simulated crash/iu,
  );

  const restarted = createJobStore({
    rootDirectory: fixture.rootDirectory,
    fieldCatalogPath: catalogPath,
    expectedCatalogSha256,
  });
  await restarted.recoverOrphanedJobs();
  const completed = await restarted.getJob(fixture.manifest.job_id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.attempt, 1);
  assert.equal((await restarted.getResult(fixture.manifest.job_id)).result.fields.length, 27);
});

test('partial attempt-1 success journal does not block distinct attempt-2 artifacts', async (t) => {
  let injectCrash = true;
  const fixture = await setupReadyJob(t, {
    faultInjector: async (phase) => {
      if (injectCrash && phase === 'after-terminal-result-artifact') {
        injectCrash = false;
        throw new Error('simulated crash after partial terminal journal');
      }
    },
  });
  const validator = await createAgentResultValidator({ jobStore: fixture.store });
  const firstClaim = await fixture.store.claimStart(fixture.manifest.job_id);
  const firstExecution = successExecution(fixture.result, firstClaim.attempt);
  await fixture.store.markValidating(fixture.manifest.job_id, {
    attempt: firstClaim.attempt,
    execution: firstExecution,
  });
  const firstValidation = await validator.validate({
    jobId: fixture.manifest.job_id,
    rawResult: firstExecution.raw_result,
  });
  await assert.rejects(
    fixture.store.completeAttempt(fixture.manifest.job_id, {
      attempt: firstClaim.attempt,
      execution: firstExecution,
      rawResult: firstExecution.raw_result,
      validationEnvelope: firstValidation.envelope,
    }),
    /simulated crash/iu,
  );

  const restarted = createJobStore({
    rootDirectory: fixture.rootDirectory,
    fieldCatalogPath: catalogPath,
    expectedCatalogSha256,
  });
  await restarted.recoverOrphanedJobs();
  const orphaned = await restarted.getJob(fixture.manifest.job_id);
  assert.equal(orphaned.failure.code, 'RUNNER_ORPHANED_EXECUTION');
  assert.equal(orphaned.failure.retryable, true);

  const secondClaim = await restarted.claimStart(fixture.manifest.job_id);
  const changedResult = structuredClone(fixture.result);
  changedResult.limitations = ['completed on attempt two'];
  const secondExecution = successExecution(changedResult, secondClaim.attempt);
  await restarted.markValidating(fixture.manifest.job_id, {
    attempt: secondClaim.attempt,
    execution: secondExecution,
  });
  const restartedValidator = await createAgentResultValidator({ jobStore: restarted });
  const secondValidation = await restartedValidator.validate({
    jobId: fixture.manifest.job_id,
    rawResult: secondExecution.raw_result,
  });
  await restarted.completeAttempt(fixture.manifest.job_id, {
    attempt: secondClaim.attempt,
    execution: secondExecution,
    rawResult: secondExecution.raw_result,
    validationEnvelope: secondValidation.envelope,
  });
  const released = await restarted.getResult(fixture.manifest.job_id);
  assert.deepEqual(released.result.limitations, ['completed on attempt two']);
  assert.equal((await restarted.getJob(fixture.manifest.job_id)).attempt, 2);
});

test('restart preserves a journaled contract failure without a paid retry', async (t) => {
  let injectCrash = true;
  const fixture = await setupReadyJob(t, {
    faultInjector: async (phase) => {
      if (injectCrash && phase === 'after-failure-validation-artifact') {
        injectCrash = false;
        throw new Error('simulated crash after contract failure journal');
      }
    },
  });
  const validator = await createAgentResultValidator({ jobStore: fixture.store });
  const invalid = structuredClone(fixture.result);
  invalid.fields[0].evidence[0].locator = '   ';
  const claim = await fixture.store.claimStart(fixture.manifest.job_id);
  const execution = successExecution(invalid, claim.attempt);
  await fixture.store.markValidating(fixture.manifest.job_id, {
    attempt: claim.attempt,
    execution,
  });
  const validation = await validator.validate({
    jobId: fixture.manifest.job_id,
    rawResult: execution.raw_result,
  });
  assert.equal(validation.valid, false);
  await assert.rejects(
    fixture.store.failAttempt(fixture.manifest.job_id, {
      attempt: claim.attempt,
      code: 'CODEX_CONTRACT_INVALID',
      retryable: false,
      execution,
      validationEnvelope: validation.envelope,
      validationIssues: validation.issues,
    }),
    /simulated crash/iu,
  );

  const restarted = createJobStore({
    rootDirectory: fixture.rootDirectory,
    fieldCatalogPath: catalogPath,
    expectedCatalogSha256,
  });
  await restarted.recoverOrphanedJobs();
  const failed = await restarted.getJob(fixture.manifest.job_id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.failure.code, 'CODEX_CONTRACT_INVALID');
  assert.equal(failed.failure.retryable, false);
  assert.equal(failed.failure.validation.envelope_available, true);
  const repeated = await restarted.claimStart(fixture.manifest.job_id);
  assert.equal(repeated.should_execute, false);
  assert.equal(repeated.attempt, 1);
});

test('TTL cleanup removes only exact old terminal jobs and never active jobs', async (t) => {
  let currentTime = new Date('2026-09-01T00:00:00.000Z');
  const fixture = await setupReadyJob(t, { now: () => currentTime });
  const firstClaim = await fixture.store.claimStart(fixture.manifest.job_id);
  await fixture.store.failAttempt(fixture.manifest.job_id, {
    attempt: firstClaim.attempt,
    code: 'CODEX_PROCESS_FAILED',
    retryable: false,
  });

  const activeManifest = structuredClone(fixture.manifest);
  activeManifest.job_id = '22222222-2222-4222-8222-222222222222';
  activeManifest.analysis_run_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  await fixture.store.createJob(activeManifest);

  currentTime = new Date('2026-09-09T00:00:01.000Z');
  const cleanup = await fixture.store.cleanupExpiredJobs();
  assert.deepEqual(cleanup.deleted_job_ids, [fixture.manifest.job_id]);
  await assert.rejects(stat(resolveJobPath(fixture.rootDirectory, fixture.manifest.job_id)));
  assert.equal((await fixture.store.getJob(activeManifest.job_id)).status, 'staging');
});

test('completed artifacts are rechecked against their persisted hashes before release', async (t) => {
  const fixture = await setupReadyJob(t);
  const validator = await createAgentResultValidator({ jobStore: fixture.store });
  const claim = await fixture.store.claimStart(fixture.manifest.job_id);
  const execution = successExecution(fixture.result, claim.attempt);
  await fixture.store.markValidating(fixture.manifest.job_id, {
    attempt: claim.attempt,
    execution,
  });
  const validation = await validator.validate({
    jobId: fixture.manifest.job_id,
    rawResult: execution.raw_result,
  });
  await fixture.store.completeAttempt(fixture.manifest.job_id, {
    attempt: claim.attempt,
    execution,
    rawResult: execution.raw_result,
    validationEnvelope: validation.envelope,
  });

  const resultPath = path.join(
    resolveJobPath(fixture.rootDirectory, fixture.manifest.job_id),
    'audit',
    `validated-result.attempt-${claim.attempt}.json`,
  );
  const changed = structuredClone(fixture.result);
  changed.limitations = ['tampered after completion'];
  await writeFile(resultPath, `${JSON.stringify(changed)}\n`, 'utf8');
  await assert.rejects(
    fixture.store.getResult(fixture.manifest.job_id),
    /integrity|hash|changed/iu,
  );
});

test('startup recovery completes before exact-job TTL cleanup begins', async () => {
  const calls = [];
  const result = await initializeJobStore({
    async recoverOrphanedJobs() {
      calls.push('recover:start');
      await new Promise((resolve) => setTimeout(resolve, 10));
      calls.push('recover:end');
      return { recovered_jobs: 1 };
    },
    async cleanupExpiredJobs() {
      calls.push('cleanup');
      return { deleted_jobs: 1 };
    },
  });
  assert.deepEqual(calls, ['recover:start', 'recover:end', 'cleanup']);
  assert.deepEqual(result, {
    recovery: { recovered_jobs: 1 },
    cleanup: { deleted_jobs: 1 },
  });
});

test('attempt-2 queue rollback restores prior failure and execution audit', async (t) => {
  const fixture = await setupReadyJob(t);
  const claim = await fixture.store.claimStart(fixture.manifest.job_id);
  const execution = successExecution(fixture.result, claim.attempt);
  execution.events.thread_id = 'orphaned-validating-thread';
  await fixture.store.markValidating(fixture.manifest.job_id, {
    attempt: claim.attempt,
    execution,
  });
  await fixture.store.recoverOrphanedJobs();
  const before = await fixture.store.getJob(fixture.manifest.job_id);
  assert.equal(before.usage.input_tokens, 100);

  const retry = await fixture.store.claimStart(fixture.manifest.job_id);
  assert.equal(retry.attempt, 2);
  await fixture.store.releaseUnstartedClaim(fixture.manifest.job_id, { attempt: 2 });
  const restored = await fixture.store.getJob(fixture.manifest.job_id);
  assert.equal(restored.status, 'failed');
  assert.equal(restored.failure.code, 'RUNNER_ORPHANED_EXECUTION');
  assert.equal(restored.usage.input_tokens, 100);
  assert.equal(restored.prior_attempts, undefined);
});

test('invalid lifecycle transitions fail closed without changing the job', async (t) => {
  const fixture = await setupReadyJob(t);
  await assert.rejects(
    fixture.store.markValidating(fixture.manifest.job_id, { attempt: 1, execution: {} }),
    (error) => error?.code === 'RUNNER_JOB_STATE_INVALID',
  );
  assert.equal((await fixture.store.getJob(fixture.manifest.job_id)).status, 'ready');

  const claim = await fixture.store.claimStart(fixture.manifest.job_id);
  await assert.rejects(
    fixture.store.completeAttempt(fixture.manifest.job_id, {
      attempt: claim.attempt,
      rawResult: '{}',
      validationEnvelope: { valid: true, job_id: fixture.manifest.job_id },
    }),
    (error) => error?.code === 'RUNNER_JOB_STATE_INVALID',
  );
  assert.equal((await fixture.store.getJob(fixture.manifest.job_id)).status, 'running');
});

test('queue rejection restores an unstarted job to ready', async (t) => {
  const fixture = await setupReadyJob(t);
  const validator = await createAgentResultValidator({ jobStore: fixture.store });
  const queue = createSingleProcessQueue({ maxQueuedJobs: 1 });
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const active = queue.run(() => blocked);
  const queued = queue.run(async () => {});
  const handler = createManifestRouteHandler({
    jobStore: fixture.store,
    resultValidator: validator,
    executeAttempt: async () => successExecution(fixture.result, 1),
  });

  await assert.rejects(
    handler({
      requestMetadata: { method: 'POST', headers: {} },
      url: new URL(`http://runner/v1/jobs/${fixture.manifest.job_id}/start`),
      bodyKind: 'none',
      rawBody: Buffer.alloc(0),
      bodyStream: null,
      queue,
    }),
    (error) => error?.code === 'RUNNER_QUEUE_FULL',
  );
  const restored = await fixture.store.getJob(fixture.manifest.job_id);
  assert.equal(restored.status, 'ready');
  assert.equal(restored.attempt, undefined);

  release();
  await Promise.all([active, queued]);
});
