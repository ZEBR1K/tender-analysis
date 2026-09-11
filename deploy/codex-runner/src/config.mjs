import path from 'node:path';
import { readFileSync } from 'node:fs';

export const BODY_LIMITS = Object.freeze({
  maxJsonBytes: 16 * 1024 * 1024,
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

function readSecretFile(filePath) {
  if (!filePath) return '';
  try {
    return readFileSync(filePath, 'utf8').trim();
  } catch {
    return '';
  }
}

export function createConfig(env = process.env) {
  const authTokenFile = String(env.TENDER_CODEX_RUNNER_AUTH_TOKEN_FILE || '');
  return Object.freeze({
    host: env.TENDER_CODEX_RUNNER_HOST || '127.0.0.1',
    port: positiveInteger(env, 'TENDER_CODEX_RUNNER_PORT', 8080),
    rootDirectory: path.resolve(env.TENDER_CODEX_RUNNER_ROOT || path.join(process.cwd(), '.codex-runner')),
    fieldCatalogPath: path.resolve(
      env.TENDER_CODEX_RUNNER_FIELD_CATALOG_PATH
        || path.join(process.cwd(), 'field-catalog', 'FIELD_CATALOG.md'),
    ),
    authToken: String(env.TENDER_CODEX_RUNNER_AUTH_TOKEN || readSecretFile(authTokenFile)),
    authTokenFile,
    codexAuthFile: path.resolve(
      env.TENDER_CODEX_RUNNER_CODEX_AUTH_FILE || '/run/codex-auth/auth.json',
    ),
    maxConcurrentCodex: 1,
    maxConcurrentUploads: 1,
    maxQueuedJobs: positiveInteger(env, 'TENDER_CODEX_RUNNER_MAX_QUEUED_JOBS', 2),
    bodyLimits: BODY_LIMITS,
  });
}

export const config = createConfig();
