const PUBLIC_CODES = new Set([
  'RUNNER_AUTH_NOT_READY',
  'RUNNER_AUTH_REQUIRED',
  'RUNNER_BODY_TOO_LARGE',
  'RUNNER_CONTENT_TYPE_INVALID',
  'RUNNER_METHOD_NOT_ALLOWED',
  'RUNNER_QUEUE_FULL',
  'RUNNER_REQUEST_INVALID',
  'RUNNER_ROUTE_NOT_FOUND',
  'RUNNER_INTERNAL',
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
    super(message);
    this.name = 'RunnerError';
    this.code = PUBLIC_CODES.has(code) ? code : 'RUNNER_INTERNAL';
    this.httpStatus = Number.isInteger(httpStatus) && httpStatus >= 400 && httpStatus <= 599
      ? httpStatus
      : 500;
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
