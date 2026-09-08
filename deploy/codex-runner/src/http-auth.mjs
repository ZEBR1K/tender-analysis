import { createHash, timingSafeEqual } from 'node:crypto';

import { RunnerError } from './errors.mjs';

export const AUTH_HEADER_NAME = 'x-tender-codex-token';

function digest(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest();
}

export function createHeaderAuthenticator(expectedToken) {
  const configuredToken = String(expectedToken || '');
  const ready = configuredToken.length >= 32;
  const expectedDigest = digest(configuredToken);

  return Object.freeze({
    ready,
    isAuthorized(headers = {}) {
      const raw = headers[AUTH_HEADER_NAME];
      const candidate = Array.isArray(raw) ? raw.join(',') : raw;
      const candidateDigest = digest(candidate);
      return ready && timingSafeEqual(expectedDigest, candidateDigest);
    },
    assertAuthorized(headers = {}) {
      if (!ready) {
        throw new RunnerError('RUNNER_AUTH_NOT_READY', 'Runner authentication is not configured', 503);
      }
      if (!this.isAuthorized(headers)) {
        throw new RunnerError('RUNNER_AUTH_REQUIRED', 'Runner authentication failed', 401);
      }
    },
  });
}
