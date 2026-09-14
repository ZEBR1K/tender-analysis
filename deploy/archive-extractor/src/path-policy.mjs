import path from 'node:path';

import { ArchiveError } from './errors.mjs';

const DRIVE_PREFIX = /^[a-zA-Z]:/;
const URI_PREFIX = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

function unsafe(rawPath, reason) {
  throw new ArchiveError('ARCHIVE_PATH_UNSAFE', 'Archive contains an unsafe logical path', 422, {
    path: String(rawPath).slice(0, 300),
    reason,
  });
}

export function normalizeLogicalPath(rawPath) {
  if (typeof rawPath !== 'string' || rawPath.length === 0) unsafe(rawPath, 'empty');
  if (CONTROL_CHARACTERS.test(rawPath)) unsafe(rawPath, 'control_character');
  if (/^[\\/]/u.test(rawPath)) unsafe(rawPath, 'absolute');
  if (DRIVE_PREFIX.test(rawPath)) unsafe(rawPath, 'drive_prefix');
  if (URI_PREFIX.test(rawPath)) unsafe(rawPath, 'uri_prefix');

  const normalized = rawPath.replaceAll('\\', '/').replace(/\/+$/u, '').normalize('NFC');
  if (!normalized) unsafe(rawPath, 'empty');
  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    unsafe(rawPath, 'dot_or_empty_segment');
  }
  return segments.join('/');
}

export function assertSafeLogicalPath(rawPath) {
  return normalizeLogicalPath(rawPath);
}

export function collisionKey(rawPath) {
  return normalizeLogicalPath(rawPath).toLocaleLowerCase('en-US');
}

export function logicalBasename(rawPath) {
  return path.posix.basename(normalizeLogicalPath(rawPath));
}
