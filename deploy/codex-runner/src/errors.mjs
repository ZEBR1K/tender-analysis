const PUBLIC_CODES = new Set([
  'RUNNER_AUTH_NOT_READY',
  'RUNNER_AUTH_REQUIRED',
  'RUNNER_BODY_TOO_LARGE',
  'RUNNER_CONTENT_TYPE_INVALID',
  'RUNNER_METHOD_NOT_ALLOWED',
  'RUNNER_QUEUE_FULL',
  'RUNNER_REQUEST_INVALID',
  'RUNNER_ROUTE_NOT_FOUND',
  'RUNNER_UPLOAD_BUSY',
  'RUNNER_INTERNAL',
  'RUNNER_ISOLATION_NOT_READY',
  'RUNNER_CATALOG_MISMATCH',
  'RUNNER_DOCUMENT_CONFLICT',
  'RUNNER_DOCUMENT_MISMATCH',
  'RUNNER_DOCUMENT_NOT_FOUND',
  'RUNNER_JOB_EXISTS_CONFLICT',
  'RUNNER_JOB_ID_INVALID',
  'RUNNER_JOB_NOT_FOUND',
  'RUNNER_JOB_SEALED',
  'RUNNER_MANIFEST_INCOMPLETE',
  'RUNNER_MANIFEST_INVALID',
]);

export const MAX_SAFE_ERROR_MESSAGE_LENGTH = 500;

function safeMessage(value, fallback) {
  const normalized = String(value || fallback)
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .trim();
  return (normalized || fallback).slice(0, MAX_SAFE_ERROR_MESSAGE_LENGTH);
}

export class RunnerError extends Error {
  constructor(code, message, httpStatus = 422) {
    const isPublicCode = PUBLIC_CODES.has(code);
    super(isPublicCode ? message : 'Runner request failed');
    this.name = 'RunnerError';
    this.code = isPublicCode ? code : 'RUNNER_INTERNAL';
    this.httpStatus = isPublicCode
      && Number.isInteger(httpStatus)
      && httpStatus >= 400
      && httpStatus <= 599
      ? httpStatus : 500;
  }
}

export function normalizeRunnerError(error) {
  return error instanceof RunnerError
    ? error
    : new RunnerError('RUNNER_INTERNAL', 'Runner request failed', 500);
}

export function toSafeError(error) {
  const typed = normalizeRunnerError(error);
  return {
    success: false,
    error: {
      code: typed.code,
      message: safeMessage(typed.message, 'Runner request failed'),
    },
  };
}
