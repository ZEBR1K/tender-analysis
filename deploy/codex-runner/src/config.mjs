import path from 'node:path';

export const BODY_LIMITS = Object.freeze({
  maxJsonBytes: 2 * 1024 * 1024,
  maxDocumentBytes: 50 * 1024 * 1024,
});

function positiveInteger(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function createConfig(env = process.env) {
  return Object.freeze({
    host: env.TENDER_CODEX_RUNNER_HOST || '127.0.0.1',
    port: positiveInteger(env, 'TENDER_CODEX_RUNNER_PORT', 8080),
    rootDirectory: path.resolve(env.TENDER_CODEX_RUNNER_ROOT || path.join(process.cwd(), '.codex-runner')),
    authToken: String(env.TENDER_CODEX_RUNNER_AUTH_TOKEN || ''),
    maxConcurrentCodex: 1,
    maxQueuedJobs: positiveInteger(env, 'TENDER_CODEX_RUNNER_MAX_QUEUED_JOBS', 2),
    bodyLimits: BODY_LIMITS,
  });
}

export const config = createConfig();
