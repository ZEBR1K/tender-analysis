const PUBLIC_CODES = new Set([
  'INGESTION_CONTRACT_INVALID',
  'JOB_INPUT_MISMATCH',
  'ARCHIVE_TOO_LARGE',
  'ARCHIVE_FORMAT_MISMATCH',
  'ARCHIVE_ENCRYPTED',
  'ARCHIVE_CORRUPT',
  'ARCHIVE_PATH_UNSAFE',
  'ARCHIVE_ENTRY_LIMIT',
  'ARCHIVE_FILE_TOO_LARGE',
  'ARCHIVE_TOTAL_TOO_LARGE',
  'ARCHIVE_DEPTH_EXCEEDED',
  'ARCHIVE_TIMEOUT',
  'ARTIFACT_NOT_FOUND',
  'ARTIFACT_STORE_ERROR',
  'EXTRACTOR_BUSY',
]);

export class ArchiveError extends Error {
  constructor(code, message, httpStatus = 422, details = {}) {
    super(message);
    this.name = 'ArchiveError';
    this.code = PUBLIC_CODES.has(code) ? code : 'ARTIFACT_STORE_ERROR';
    this.httpStatus = Number.isInteger(httpStatus) ? httpStatus : 500;
    this.details = details && typeof details === 'object' && !Array.isArray(details) ? details : {};
  }
}

export function toSafeError(error) {
  const typed = error instanceof ArchiveError
    ? error
    : new ArchiveError('ARTIFACT_STORE_ERROR', 'Archive extractor failed', 500);
  return {
    success: false,
    error: {
      code: typed.code,
      message: String(typed.message || 'Archive extractor failed').slice(0, 500),
      details: typed.details,
    },
  };
}

export function asArchiveError(error, fallbackCode = 'ARTIFACT_STORE_ERROR') {
  if (error instanceof ArchiveError) return error;
  const httpStatus = fallbackCode.startsWith('ARCHIVE_') ? 422 : 500;
  return new ArchiveError(fallbackCode, 'Archive extractor failed', httpStatus);
}
