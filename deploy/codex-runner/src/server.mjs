import { execFile } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import http from 'node:http';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

import packageMetadata from '../package.json' with { type: 'json' };
import { BODY_LIMITS, config } from './config.mjs';
import { normalizeRunnerError, RunnerError, toSafeError } from './errors.mjs';
import { createHeaderAuthenticator } from './http-auth.mjs';
import { createJobStore } from './job-store.mjs';
import { permissionBoundaryContractReady } from './permissions.mjs';
import { runCodexAttempt, shouldRetryCodexAttempt } from './codex-command.mjs';
import { createAgentResultValidator } from './result-validator.mjs';

const execFileAsync = promisify(execFile);
const DOCUMENT_STREAM_LIFECYCLE = Symbol('documentStreamLifecycle');
const JOB_START_ROUTE = /^\/v1\/jobs\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/start$/iu;
const HANDLER_REDACTED_HEADERS = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'x-tender-codex-token',
]);

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
  const normalizedType = String(request.headers['content-type'] || '').split(';', 1)[0]
    .trim().toLowerCase();
  if (normalizedType !== 'application/json') {
    throw new RunnerError(
      'RUNNER_CONTENT_TYPE_INVALID',
      'Buffered request bodies must be application/json',
      415,
    );
  }
  const limit = limits.maxJsonBytes;
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

export function createBoundedDocumentStream(request, limits = BODY_LIMITS) {
  const limit = contentTypeLimit(request.headers['content-type'], limits);
  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    request.resume();
    throw new RunnerError('RUNNER_BODY_TOO_LARGE', `Request body exceeds ${limit} bytes`, 413);
  }

  const source = request[Symbol.asyncIterator]();
  let total = 0;
  let complete = false;
  let limitError = null;

  async function readNext() {
    if (limitError) throw limitError;
    if (complete) return { done: true, value: undefined };
    const item = await source.next();
    if (item.done) {
      complete = true;
      return { done: true, value: undefined };
    }
    const value = Buffer.isBuffer(item.value) ? item.value : Buffer.from(item.value);
    total += value.length;
    if (total > limit) {
      limitError = new RunnerError(
        'RUNNER_BODY_TOO_LARGE',
        `Request body exceeds ${limit} bytes`,
        413,
      );
      try {
        while (!(await source.next()).done) { /* drain without retaining further bytes */ }
      } catch {
        // A peer abort also terminates ownership of this request body.
      }
      complete = true;
      throw limitError;
    }
    return { done: false, value };
  }

  const bodyStream = {
    next: readNext,
    async return() {
      return { done: true, value: undefined };
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
  Object.defineProperty(bodyStream, DOCUMENT_STREAM_LIFECYCLE, {
    value: Object.freeze({
      isComplete: () => complete,
      async finish() {
        try {
          while (!complete && !limitError) await readNext();
        } catch (error) {
          if (!limitError) throw error;
        }
        if (limitError) {
          throw limitError;
        }
      },
    }),
  });
  return Object.freeze(bodyStream);
}

async function handleDocumentRequest({ bodyStream, handler }) {
  const lifecycle = bodyStream[DOCUMENT_STREAM_LIFECYCLE];
  let result;
  let handlerError;
  try {
    result = await handler();
  } catch (error) {
    handlerError = error;
  }

  const consumedByHandler = lifecycle.isComplete();
  await lifecycle.finish();
  if (handlerError) throw handlerError;
  if (!consumedByHandler) {
    throw new RunnerError(
      'RUNNER_REQUEST_INVALID',
      'Document upload handler did not consume the complete request body',
      422,
    );
  }
  return result;
}

export function buildV1RouteMetadata(request, url) {
  return Object.freeze({
    requiresExecutionBoundary: request.method === 'POST' && JOB_START_ROUTE.test(url.pathname),
  });
}

function buildHandlerRequestMetadata(request) {
  const headers = Object.fromEntries(Object.entries(request.headers)
    .filter(([name]) => !HANDLER_REDACTED_HEADERS.has(name.toLowerCase()))
    .map(([name, value]) => [
      name,
      Array.isArray(value) ? Object.freeze([...value]) : value,
    ]));
  return Object.freeze({
    method: request.method || null,
    headers: Object.freeze(headers),
  });
}

export function createUploadGate({ maxConcurrentUploads = 1 } = {}) {
  if (!Number.isSafeInteger(maxConcurrentUploads) || maxConcurrentUploads <= 0) {
    throw new Error('maxConcurrentUploads must be a positive integer');
  }
  let active = 0;
  return Object.freeze({
    async run(task) {
      if (typeof task !== 'function') throw new TypeError('task must be a function');
      if (active >= maxConcurrentUploads) {
        throw new RunnerError(
          'RUNNER_UPLOAD_BUSY',
          'Runner has reached its concurrent upload limit',
          503,
        );
      }
      active += 1;
      try {
        return await task();
      } finally {
        active -= 1;
      }
    },
    snapshot() {
      return { active, max_concurrent: maxConcurrentUploads };
    },
  });
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
        throw new RunnerError(
          'RUNNER_QUEUE_FULL',
          'Runner queue has reached its configured limit',
          503,
        );
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
  isolationReady = false,
  codexAuthReady = false,
  isolationCanaryVerified = false,
  queue,
}) {
  const toolsReady = requiredToolsReady(toolVersions);
  const ready = Boolean(authReady && storeReady && toolsReady && isolationReady && codexAuthReady);
  const executeReady = Boolean(ready && isolationCanaryVerified);
  return {
    schema_version: 'tender_codex_runner_health_v1',
    status: ready ? 'ready' : 'not_ready',
    service_version: serviceVersion,
    tools: toolVersions,
    readiness: {
      auth: Boolean(authReady),
      store: Boolean(storeReady),
      tools: toolsReady,
      isolation: Boolean(isolationReady),
      codex_auth: Boolean(codexAuthReady),
      isolation_canary: Boolean(isolationCanaryVerified),
      execute: executeReady,
    },
    queue,
  };
}

function firstLine(value) {
  const line = String(value || '').split(/\r?\n/u).find((entry) => entry.trim()) || '';
  return line.trim().slice(0, 200) || null;
}

function probeDiagnostic(error) {
  const output = firstLine(error?.stderr) || firstLine(error?.stdout);
  return output || firstLine(`tool probe failed (${firstLine(error?.code) || 'unknown'})`);
}

export async function probeCommandVersion(command, args, { execute = execFileAsync } = {}) {
  try {
    const result = await execute(command, args, {
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 256 * 1024,
      env: process.env,
    });
    const exitCode = result?.exitCode ?? result?.code ?? 0;
    if (exitCode !== 0) {
      return {
        version: null,
        diagnostic: probeDiagnostic(result),
      };
    }
    const version = firstLine(result?.stdout) || firstLine(result?.stderr);
    return {
      version,
      diagnostic: version ? null : 'tool probe returned no version',
    };
  } catch (error) {
    return {
      version: null,
      diagnostic: probeDiagnostic(error),
    };
  }
}

export async function probeToolVersions() {
  const [codex, poppler, libreoffice, tesseract, languagesResult] = await Promise.all([
    probeCommandVersion('codex', ['--version']),
    probeCommandVersion('pdftotext', ['-v']),
    probeCommandVersion('libreoffice', ['--version']),
    probeCommandVersion('tesseract', ['--version']),
    execFileAsync('tesseract', ['--list-langs'], {
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 256 * 1024,
      env: process.env,
    }).then(({ stdout }) => ({
      languages: String(stdout).split(/\r?\n/u).map((line) => line.trim()),
      diagnostic: null,
    })).catch((error) => ({
      languages: [],
      diagnostic: probeDiagnostic(error),
    })),
  ]);
  return {
    versions: {
      node: process.version,
      codex: codex.version,
      poppler: poppler.version,
      libreoffice: libreoffice.version,
      tesseract: tesseract.version,
      ocr_languages: ['eng', 'rus'].filter((language) => languagesResult.languages.includes(language)),
    },
    diagnostics: {
      codex: codex.diagnostic,
      poppler: poppler.diagnostic,
      libreoffice: libreoffice.diagnostic,
      tesseract: tesseract.diagnostic,
      ocr_languages: languagesResult.diagnostic,
    },
  };
}

function createDefaultHealthProvider({
  authenticator,
  queue,
  rootDirectory,
  codexAuthFile,
  isolationCanaryVerified,
}) {
  const toolProbe = probeToolVersions();
  return async () => {
    let storeReady = false;
    let codexAuthReady = false;
    try {
      await access(rootDirectory, fsConstants.R_OK | fsConstants.W_OK);
      storeReady = true;
    } catch {
      storeReady = false;
    }
    try {
      await access(codexAuthFile, fsConstants.R_OK);
      codexAuthReady = true;
    } catch {
      codexAuthReady = false;
    }
    return buildHealthReport({
      serviceVersion: packageMetadata.version,
      authReady: authenticator.ready,
      storeReady,
      toolVersions: (await toolProbe).versions,
      isolationReady: permissionBoundaryContractReady(),
      codexAuthReady,
      isolationCanaryVerified,
      queue: queue.snapshot(),
    });
  };
}

async function defaultV1Handler() {
  throw new RunnerError('RUNNER_ROUTE_NOT_FOUND', 'Route was not found', 404);
}

function parseJson(rawBody) {
  try {
    return JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new RunnerError('RUNNER_REQUEST_INVALID', 'Request body must contain valid JSON', 400);
  }
}

function routeMethod(requestMetadata, expected) {
  if (requestMetadata.method !== expected) {
    throw new RunnerError('RUNNER_METHOD_NOT_ALLOWED', 'HTTP method is not allowed for this route', 405);
  }
}

function decodeRoutePart(value, label) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new RunnerError('RUNNER_REQUEST_INVALID', `${label} is not valid URL encoding`, 400);
  }
}

async function executionResultBytes(execution) {
  if (Buffer.isBuffer(execution?.raw_result)) return execution.raw_result;
  if (typeof execution?.raw_result === 'string') {
    return Buffer.from(execution.raw_result, 'utf8');
  }
  if (typeof execution?.artifacts?.result === 'string') {
    return readFile(execution.artifacts.result);
  }
  throw new RunnerError('RUNNER_INTERNAL', 'Codex result artifact is unavailable', 500);
}

function transportFailure(error) {
  return {
    ok: false,
    code: 'CODEX_TRANSPORT_ERROR',
    valid_json_result: false,
    events: { usage: {} },
    artifacts: {},
    internal_error: error,
  };
}

export async function executeAgentJobLifecycle({
  jobStore,
  resultValidator,
  executeAttempt,
  jobId,
  initialAttempt,
} = {}) {
  let attempt = initialAttempt;
  while (attempt <= 2) {
    let execution;
    try {
      execution = await executeAttempt({ jobId, attempt });
    } catch (error) {
      execution = transportFailure(error);
    }

    if (!execution?.ok) {
      if (attempt === 1 && shouldRetryCodexAttempt(execution)) {
        const retry = await jobStore.beginAutomaticRetry(jobId, { attempt, execution });
        attempt = retry.attempt;
        continue;
      }
      return jobStore.failAttempt(jobId, {
        attempt,
        code: execution?.code ?? 'CODEX_TRANSPORT_ERROR',
        retryable: false,
        execution,
      });
    }

    await jobStore.markValidating(jobId, { attempt, execution });
    let rawResult;
    try {
      rawResult = await executionResultBytes(execution);
    } catch {
      return jobStore.failAttempt(jobId, {
        attempt,
        code: 'CODEX_RESULT_INVALID',
        retryable: false,
        execution,
      });
    }
    const validation = await resultValidator.validate({ jobId, rawResult });
    if (!validation.valid) {
      return jobStore.failAttempt(jobId, {
        attempt,
        code: 'CODEX_CONTRACT_INVALID',
        retryable: false,
        execution,
        validationEnvelope: validation.envelope,
        validationIssues: validation.issues,
      });
    }
    return jobStore.completeAttempt(jobId, {
      attempt,
      execution,
      rawResult,
      validationEnvelope: validation.envelope,
    });
  }
  throw new RunnerError('RUNNER_INTERNAL', 'Codex attempt bound was exceeded', 500);
}

export function createManifestRouteHandler({
  jobStore,
  executeAttempt,
  resultValidator,
} = {}) {
  if (!jobStore) throw new TypeError('jobStore is required');
  return async ({
    requestMetadata,
    url,
    bodyKind,
    rawBody,
    bodyStream,
    queue,
  }) => {
    if (url.pathname === '/v1/jobs') {
      routeMethod(requestMetadata, 'PUT');
      if (bodyKind !== 'json') {
        throw new RunnerError('RUNNER_REQUEST_INVALID', 'Job manifest requires a JSON body', 400);
      }
      const result = await jobStore.createJob(parseJson(rawBody));
      return { statusCode: result.idempotent ? 200 : 201, body: result };
    }

    const documentRoute = url.pathname.match(/^\/v1\/jobs\/([^/]+)\/documents\/([^/]+)$/u);
    if (documentRoute) {
      routeMethod(requestMetadata, 'PUT');
      if (bodyKind !== 'document') {
        throw new RunnerError('RUNNER_REQUEST_INVALID', 'Document upload requires an octet-stream body', 400);
      }
      return {
        statusCode: 200,
        body: await jobStore.uploadDocument({
          jobId: decodeRoutePart(documentRoute[1], 'job_id'),
          artifactKey: decodeRoutePart(documentRoute[2], 'artifact_key'),
          bodyStream,
        }),
      };
    }

    const sealRoute = url.pathname.match(/^\/v1\/jobs\/([^/]+)\/seal$/u);
    if (sealRoute) {
      routeMethod(requestMetadata, 'POST');
      if (bodyKind !== 'none') {
        throw new RunnerError('RUNNER_REQUEST_INVALID', 'Seal does not accept a request body', 400);
      }
      return {
        statusCode: 200,
        body: await jobStore.sealJob(decodeRoutePart(sealRoute[1], 'job_id')),
      };
    }

    const startRoute = url.pathname.match(/^\/v1\/jobs\/([^/]+)\/start$/u);
    if (startRoute) {
      routeMethod(requestMetadata, 'POST');
      if (bodyKind !== 'none') {
        throw new RunnerError('RUNNER_REQUEST_INVALID', 'Start does not accept a request body', 400);
      }
      if (
        typeof executeAttempt !== 'function'
        || typeof resultValidator?.validate !== 'function'
        || typeof queue?.run !== 'function'
      ) {
        throw new RunnerError('RUNNER_INTERNAL', 'Runner execution lifecycle is unavailable', 500);
      }
      const jobId = decodeRoutePart(startRoute[1], 'job_id');
      const claim = await jobStore.claimStart(jobId);
      const { should_execute: shouldExecute, ...body } = claim;
      if (shouldExecute) {
        let scheduled;
        try {
          scheduled = queue.run(() => executeAgentJobLifecycle({
            jobStore,
            resultValidator,
            executeAttempt,
            jobId,
            initialAttempt: claim.attempt,
          }));
        } catch (error) {
          await jobStore.releaseUnstartedClaim(jobId, { attempt: claim.attempt });
          throw error;
        }
        void scheduled.catch(async () => {
          const current = await jobStore.getJob(jobId).catch(() => null);
          if (!current || !['running', 'validating'].includes(current.status)) return;
          await jobStore.failAttempt(jobId, {
            attempt: current.attempt,
            code: 'CODEX_TRANSPORT_ERROR',
            retryable: false,
          }).catch(() => {});
        });
      }
      return { statusCode: shouldExecute ? 202 : 200, body };
    }

    const resultRoute = url.pathname.match(/^\/v1\/jobs\/([^/]+)\/result$/u);
    if (resultRoute) {
      routeMethod(requestMetadata, 'GET');
      if (bodyKind !== 'none') {
        throw new RunnerError('RUNNER_REQUEST_INVALID', 'Result does not accept a request body', 400);
      }
      return {
        statusCode: 200,
        body: await jobStore.getResult(decodeRoutePart(resultRoute[1], 'job_id')),
      };
    }

    const statusRoute = url.pathname.match(/^\/v1\/jobs\/([^/]+)$/u);
    if (statusRoute) {
      routeMethod(requestMetadata, 'GET');
      if (bodyKind !== 'none') {
        throw new RunnerError('RUNNER_REQUEST_INVALID', 'Job status does not accept a request body', 400);
      }
      return {
        statusCode: 200,
        body: await jobStore.getJob(decodeRoutePart(statusRoute[1], 'job_id')),
      };
    }

    return defaultV1Handler();
  };
}

export async function initializeJobStore(jobStore) {
  if (
    typeof jobStore?.recoverOrphanedJobs !== 'function'
    || typeof jobStore?.cleanupExpiredJobs !== 'function'
  ) {
    throw new TypeError('jobStore recovery and cleanup methods are required');
  }
  const recovery = await jobStore.recoverOrphanedJobs();
  const cleanup = await jobStore.cleanupExpiredJobs();
  return { recovery, cleanup };
}

function createDefaultV1Handler() {
  const jobStore = createJobStore({
    rootDirectory: config.rootDirectory,
    fieldCatalogPath: config.fieldCatalogPath,
  });
  const startup = initializeJobStore(jobStore);
  const validatorPromise = createAgentResultValidator({ jobStore });
  const handler = createManifestRouteHandler({
    jobStore,
    resultValidator: {
      validate: async (request) => (await validatorPromise).validate(request),
    },
    executeAttempt: ({ jobId, attempt }) => runCodexAttempt({
      jobId,
      attempt,
      jobsRoot: config.rootDirectory,
      runnerRoot: '/app',
      secretValues: [config.authToken],
    }),
  });
  return async (request) => {
    await startup;
    return handler(request);
  };
}

export function createServer({
  authenticator = createHeaderAuthenticator(config.authToken),
  bodyLimits = config.bodyLimits,
  queue = createSingleProcessQueue({ maxQueuedJobs: config.maxQueuedJobs }),
  uploadGate = createUploadGate({ maxConcurrentUploads: config.maxConcurrentUploads }),
  healthProvider = createDefaultHealthProvider({
    authenticator,
    queue,
    rootDirectory: config.rootDirectory,
    codexAuthFile: config.codexAuthFile,
    isolationCanaryVerified: config.isolationCanaryVerified,
  }),
  executionBoundary = { ready: config.isolationCanaryVerified },
  v1Handler,
} = {}) {
  const resolvedV1Handler = v1Handler ?? createDefaultV1Handler();
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
        const routeMetadata = buildV1RouteMetadata(request, url);
        const requestMetadata = buildHandlerRequestMetadata(request);
        if (routeMetadata.requiresExecutionBoundary && executionBoundary.ready !== true) {
          request.resume();
          throw new RunnerError(
            'RUNNER_ISOLATION_NOT_READY',
            'Runner execution isolation has not passed its runtime canary',
            503,
          );
        }
        let result;
        if (!requestHasBody(request)) {
          result = await resolvedV1Handler({
            requestMetadata,
            url,
            bodyKind: 'none',
            rawBody: Buffer.alloc(0),
            bodyStream: null,
            queue,
            routeMetadata,
          });
        } else {
          const contentType = String(request.headers['content-type'] || '').split(';', 1)[0]
            .trim().toLowerCase();
          if (contentType === 'application/octet-stream') {
            const bodyStream = createBoundedDocumentStream(request, bodyLimits);
            result = await uploadGate.run(() => handleDocumentRequest({
              bodyStream,
              handler: () => resolvedV1Handler({
                requestMetadata,
                url,
                bodyKind: 'document',
                rawBody: null,
                bodyStream,
                queue,
                routeMetadata,
              }),
            })).catch((error) => {
              if (error instanceof RunnerError && error.code === 'RUNNER_UPLOAD_BUSY') request.resume();
              throw error;
            });
          } else {
            const rawBody = await readBoundedRequestBody(request, bodyLimits);
            result = await resolvedV1Handler({
              requestMetadata,
              url,
              bodyKind: 'json',
              rawBody,
              bodyStream: null,
              queue,
              routeMetadata,
            });
          }
        }
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
