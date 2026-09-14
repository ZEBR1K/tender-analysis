#!/usr/bin/env node

// Deliberately tiny, in-memory runner used only by the Task 16 inactive n8n
// canary. It never invokes Codex and refuses to start without an explicit
// canary flag. Do not use it as a production runner.

import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex').toUpperCase();

async function collectBody(request, limit = 256 * 1024 * 1024) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw Object.assign(new Error('request too large'), { statusCode: 413 });
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function hashBody(request, limit = 2 * 1024 * 1024 * 1024) {
  const hash = createHash('sha256');
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw Object.assign(new Error('request too large'), { statusCode: 413 });
    hash.update(chunk);
  }
  return { length, digest: hash.digest('hex').toUpperCase() };
}

function sendJson(response, statusCode, value) {
  const body = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
  response.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': body.length,
    'cache-control': 'no-store',
  });
  response.end(body);
}

function equalToken(actual, expected) {
  const left = Buffer.from(String(actual ?? ''), 'utf8');
  const right = Buffer.from(expected, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function publicState(job, extra = {}) {
  return {
    job_id: job.manifest.job_id,
    analysis_run_id: job.manifest.analysis_run_id,
    manifest_version: job.manifest.manifest_version,
    pipeline_version: job.manifest.pipeline_version,
    field_catalog_version: job.manifest.field_catalog_version,
    field_catalog_sha256: job.manifest.field_catalog_sha256,
    expected_documents: job.manifest.expected_documents,
    staged_documents: job.uploads.size,
    input_manifest_sha256: job.inputManifestSha256 ?? null,
    status: job.status,
    ...extra,
  };
}

function buildResult(job, fixture) {
  const result = structuredClone(fixture);
  result.field_catalog_version = job.manifest.field_catalog_version;
  result.field_catalog_sha256 = job.manifest.field_catalog_sha256;
  result.input_manifest_sha256 = job.inputManifestSha256;
  const rawBytes = Buffer.from(`${JSON.stringify(result)}\n`, 'utf8');
  const rawHash = sha256(rawBytes);
  const validatedHash = sha256(Buffer.from(JSON.stringify(result), 'utf8'));
  return {
    job_id: job.manifest.job_id,
    result,
    validation: {
      schema_version: 'tender_agent_validation_v1',
      job_id: job.manifest.job_id,
      valid: true,
      job_issues: [],
      fields: result.fields.map((field) => ({
        field_index: field.field_index,
        field_key: field.field_key,
        status: field.status,
        value_text: field.value_text,
        issues: [],
      })),
      raw_result_sha256: rawHash,
      validated_result_sha256: validatedHash,
    },
  };
}

export async function startFakeCanaryRunner({
  host = '0.0.0.0',
  port = 8080,
  tokenFile,
  resultFile,
} = {}) {
  if (!tokenFile || !resultFile) throw new Error('tokenFile and resultFile are required');
  const token = (await readFile(tokenFile, 'utf8')).trim();
  if (token.length < 32) throw new Error('canary token is invalid');
  const resultFixture = JSON.parse(await readFile(resultFile, 'utf8'));
  if (!Array.isArray(resultFixture.fields) || resultFixture.fields.length !== 27) {
    throw new Error('canary result fixture must contain exactly 27 fields');
  }
  const jobs = new Map();
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://fake-runner.invalid');
      if (request.method === 'GET' && url.pathname === '/health') {
        return sendJson(response, 200, {
          schema_version: 'tender_fake_runner_canary_v1',
          status: 'ready',
          paid_execution: false,
        });
      }
      if (!equalToken(request.headers['x-tender-codex-token'], token)) {
        return sendJson(response, 401, { error: { code: 'RUNNER_AUTH_REQUIRED' } });
      }
      if (request.method === 'PUT' && url.pathname === '/v1/jobs') {
        const manifest = JSON.parse((await collectBody(request, 2 * 1024 * 1024)).toString('utf8'));
        const existing = jobs.get(manifest.job_id);
        if (existing) return sendJson(response, 200, publicState(existing));
        const job = { manifest, uploads: new Map(), status: 'staging', inputManifestSha256: null };
        jobs.set(manifest.job_id, job);
        return sendJson(response, 201, publicState(job));
      }
      const documentMatch = /^\/v1\/jobs\/([^/]+)\/documents\/([^/]+)$/u.exec(url.pathname);
      if (request.method === 'PUT' && documentMatch) {
        const job = jobs.get(documentMatch[1]);
        if (!job) return sendJson(response, 404, { error: { code: 'RUNNER_JOB_NOT_FOUND' } });
        const body = await hashBody(request);
        const digest = body.digest;
        const expected = String(request.headers['x-content-sha256'] ?? '').toUpperCase();
        if (digest !== expected) {
          return sendJson(response, 409, { error: { code: 'RUNNER_DOCUMENT_HASH_MISMATCH' } });
        }
        job.uploads.set(documentMatch[2], digest);
        return sendJson(response, 200, {
          job_id: job.manifest.job_id,
          artifact_key: documentMatch[2],
          byte_size: body.length,
          sha256: digest,
        });
      }
      const actionMatch = /^\/v1\/jobs\/([^/]+)\/(seal|start|result)$/u.exec(url.pathname);
      if (request.method === 'POST' && actionMatch?.[2] === 'seal') {
        const job = jobs.get(actionMatch[1]);
        if (!job) return sendJson(response, 404, { error: { code: 'RUNNER_JOB_NOT_FOUND' } });
        if (job.uploads.size !== Number(job.manifest.expected_documents)) {
          return sendJson(response, 409, { error: { code: 'RUNNER_STAGING_INCOMPLETE' } });
        }
        job.inputManifestSha256 = sha256(Buffer.from(JSON.stringify([...job.uploads].sort()), 'utf8')).toLowerCase();
        job.status = 'ready';
        return sendJson(response, 200, publicState(job));
      }
      if (request.method === 'POST' && actionMatch?.[2] === 'start') {
        const job = jobs.get(actionMatch[1]);
        if (!job) return sendJson(response, 404, { error: { code: 'RUNNER_JOB_NOT_FOUND' } });
        job.status = 'running';
        return sendJson(response, 202, publicState(job, { attempt: 1 }));
      }
      const statusMatch = /^\/v1\/jobs\/([^/]+)$/u.exec(url.pathname);
      if (request.method === 'GET' && statusMatch) {
        const job = jobs.get(statusMatch[1]);
        if (!job) return sendJson(response, 404, { error: { code: 'RUNNER_JOB_NOT_FOUND' } });
        job.status = 'completed';
        return sendJson(response, 200, publicState(job, {
          attempt: 1,
          usage: { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 },
        }));
      }
      if (request.method === 'GET' && actionMatch?.[2] === 'result') {
        const job = jobs.get(actionMatch[1]);
        if (!job) return sendJson(response, 404, { error: { code: 'RUNNER_JOB_NOT_FOUND' } });
        return sendJson(response, 200, buildResult(job, resultFixture));
      }
      return sendJson(response, 404, { error: { code: 'RUNNER_ROUTE_NOT_FOUND' } });
    } catch (error) {
      return sendJson(response, error?.statusCode ?? 500, {
        error: { code: 'FAKE_CANARY_ERROR', message: String(error?.message ?? error).slice(0, 200) },
      });
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  return {
    server,
    jobs,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.env.TENDER_FAKE_RUNNER_CANARY !== '1') {
    throw new Error('TENDER_FAKE_RUNNER_CANARY=1 is required');
  }
  const runner = await startFakeCanaryRunner({
    host: process.env.TENDER_FAKE_RUNNER_HOST ?? '0.0.0.0',
    port: Number(process.env.TENDER_FAKE_RUNNER_PORT ?? 8080),
    tokenFile: process.env.TENDER_FAKE_RUNNER_TOKEN_FILE,
    resultFile: process.env.TENDER_FAKE_RUNNER_RESULT_FILE,
  });
  const shutdown = async () => {
    await runner.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
