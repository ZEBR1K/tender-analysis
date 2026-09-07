import path from 'node:path';

function positiveInteger(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export const LIMITS = Object.freeze({
  maxArchiveBytes: 100 * 1024 * 1024,
  maxFileBytes: 50 * 1024 * 1024,
  maxTotalBytes: 300 * 1024 * 1024,
  maxEntries: 500,
  maxArchiveDepth: 3,
  maxDurationMs: 5 * 60 * 1000,
});

export const SUPPORTED_DOCUMENT_EXTENSIONS = new Set(['pdf', 'docx', 'xlsx']);
export const SUPPORTED_ARCHIVE_EXTENSIONS = new Set([
  'zip',
  '7z',
  'rar',
  'tar',
  'gz',
  'tar.gz',
  'tgz',
]);

export const config = Object.freeze({
  host: process.env.ARCHIVE_EXTRACTOR_HOST || '127.0.0.1',
  port: positiveInteger('ARCHIVE_EXTRACTOR_PORT', 8080),
  rootDirectory: path.resolve(
    process.env.ARCHIVE_EXTRACTOR_ROOT || path.join(process.cwd(), '.archive-extractor'),
  ),
  ttlHours: positiveInteger('ARCHIVE_EXTRACTOR_TTL_HOURS', 72),
  cleanupIntervalMinutes: positiveInteger('ARCHIVE_EXTRACTOR_CLEANUP_INTERVAL_MINUTES', 15),
  limits: LIMITS,
});
