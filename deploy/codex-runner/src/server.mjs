import { execFile } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access } from 'node:fs/promises';
import http from 'node:http';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

import packageMetadata from '../package.json' with { type: 'json' };
import { BODY_LIMITS, config } from './config.mjs';
import { normalizeRunnerError, RunnerError, toSafeError } from './errors.mjs';
import { createHeaderAuthenticator } from './http-auth.mjs';

const execFileAsync = promisify(execFile);

function writeJson(response, statusCode, body) {
  const payload = Buffer.from(`${JSON.stringify(body)}\n`, 'utf8');
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(payload);
}

function methodNotAllowed(response) {
  writeJson(response, 405, toSafeError(new RunnerError(
    'RUNNER_METHOD_NOT_ALLOWED',
    'HTTP method is not allowed for this route',
    405,
  )));
}

function contentTypeLimit(contentType, limits) {
  const normalized = String(contentType || '').split(';', 1)[0].trim().toLowerCase();
  if (normalized === 'application/json') return limits.maxJsonBytes;
  if (normalized === 'application/octet-stream') return limits.maxDocumentBytes;
  throw new RunnerError(
    'RUNNER_CONTENT_TYPE_INVALID',
    'Content-Type must be application/json or application/octet-stream',
    415,
  );
}

function requestHasBody(request) {
  return request.headers['transfer-encoding'] !== undefined
    || Number(request.headers['content-length'] || 0) > 0;
}

export async function readBoundedRequestBody(request, limits = BODY_LIMITS) {
  if (!requestHasBody(request)) return Buffer.alloc(0);
  const limit = contentTypeLimit(request.headers['content-type'], limits);
  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    request.resume();
    throw new RunnerError('RUNNER_BODY_TOO_LARGE', `Request body exceeds ${limit} bytes`, 413);
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += value.length;
    if (total > limit) {
      request.resume();
      throw new RunnerError('RUNNER_BODY_TOO_LARGE', `Request body exceeds ${limit} bytes`, 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

export function createSingleProcessQueue({ maxQueuedJobs }) {
  if (!Number.isSafeInteger(maxQueuedJobs) || maxQueuedJobs <= 0) {
    throw new Error('maxQueuedJobs must be a positive integer');
  }

  let active = 0;
  const pending = [];

  function pump() {
    if (active !== 0 || pending.length === 0) return;
    const entry = pending.shift();
    active = 1;
    Promise.resolve()
      .then(entry.task)
      .then(entry.resolve, entry.reject)
      .finally(() => {
        active = 0;
        pump();
      });
  }

  return Object.freeze({
    run(task) {
      if (typeof task !== 'function') return Promise.reject(new TypeError('task must be a function'));
      if (active !== 0 && pending.length >= maxQueuedJobs) {
        return Promise.reject(new RunnerError(
          'RUNNER_QUEUE_FULL',
          'Runner queue has reached its configured limit',
          503,
        ));
      }
      return new Promise((resolve, reject) => {
        pending.push({ task, resolve, reject });
        pump();
      });
    },
    snapshot() {
      return {
        active,
        queued: pending.length,
        max_concurrent: 1,
        max_queued: maxQueuedJobs,
      };
    },
  });
}

function requiredToolsReady(tools) {
  return ['node', 'codex', 'poppler', 'libreoffice', 'tesseract']
    .every((key) => typeof tools?.[key] === 'string' && tools[key].length > 0)
    && ['eng', 'rus'].every((language) => tools?.ocr_languages?.includes(language));
}

export function buildHealthReport({
  serviceVersion,
  authReady,
  storeReady,
  toolVersions,
  queue,
}) {
  const toolsReady = requiredToolsReady(toolVersions);
  const ready = Boolean(authReady && storeReady && toolsReady);
  return {
    schema_version: 'tender_codex_runner_health_v1',
    status: ready ? 'ready' : 'not_ready',
    service_version: serviceVersion,
    tools: toolVersions,
    readiness: {
      auth: Boolean(authReady),
      store: Boolean(storeReady),
      tools: toolsReady,
    },
    queue,
  };
}

function firstLine(value) {
  const line = String(value || '').split(/\r?\n/u).find((entry) => entry.trim()) || '';
  return line.trim().slice(0, 200) || null;
}

async function commandVersion(command, args) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 256 * 1024,
      env: process.env,
    });
    return firstLine(stdout) || firstLine(stderr);
  } catch (error) {
    return firstLine(error?.stdout) || firstLine(error?.stderr);
  }
}

export async function probeToolVersions() {
  const [codex, poppler, libreoffice, tesseract, languages] = await Promise.all([
    commandVersion('codex', ['--version']),
    commandVersion('pdftotext', ['-v']),
    commandVersion('libreoffice', ['--version']),
    commandVersion('tesseract', ['--version']),
    execFileAsync('tesseract', ['--list-langs'], {
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 256 * 1024,
      env: process.env,
    }).then(({ stdout }) => String(stdout).split(/\r?\n/u).map((line) => line.trim()))
      .catch(() => []),
  ]);
  return {
    node: process.version,
    codex,
    poppler,
    libreoffice,
    tesseract,
    ocr_languages: ['eng', 'rus'].filter((language) => languages.includes(language)),
  };
}

function createDefaultHealthProvider({ authenticator, queue, rootDirectory }) {
  const toolVersions = probeToolVersions();
  return async () => {
    let storeReady = false;
    try {
      await access(rootDirectory, fsConstants.R_OK | fsConstants.W_OK);
      storeReady = true;
    } catch {
      storeReady = false;
    }
    return buildHealthReport({
      serviceVersion: packageMetadata.version,
      authReady: authenticator.ready,
      storeReady,
      toolVersions: await toolVersions,
      queue: queue.snapshot(),
    });
  };
}

async function defaultV1Handler() {
  throw new RunnerError('RUNNER_ROUTE_NOT_FOUND', 'Route was not found', 404);
}

export function createServer({
  authenticator = createHeaderAuthenticator(config.authToken),
  bodyLimits = config.bodyLimits,
  queue = createSingleProcessQueue({ maxQueuedJobs: config.maxQueuedJobs }),
  healthProvider = createDefaultHealthProvider({
    authenticator,
    queue,
    rootDirectory: config.rootDirectory,
  }),
  v1Handler = defaultV1Handler,
} = {}) {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://tender-codex-runner.invalid');
      if (url.pathname === '/health') {
        if (request.method !== 'GET') return methodNotAllowed(response);
        const report = await healthProvider();
        return writeJson(response, report.status === 'ready' ? 200 : 503, report);
      }

      if (url.pathname.startsWith('/v1/')) {
        authenticator.assertAuthorized(request.headers);
        const rawBody = await readBoundedRequestBody(request, bodyLimits);
        const result = await v1Handler({ request, url, rawBody, queue });
        return writeJson(response, result?.statusCode || 200, result?.body ?? result ?? { success: true });
      }

      throw new RunnerError('RUNNER_ROUTE_NOT_FOUND', 'Route was not found', 404);
    } catch (error) {
      const typed = normalizeRunnerError(error);
      if (!response.headersSent) writeJson(response, typed.httpStatus, toSafeError(typed));
      else response.destroy();
    }
  });
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const server = createServer();
  server.listen(config.port, config.host);
}
