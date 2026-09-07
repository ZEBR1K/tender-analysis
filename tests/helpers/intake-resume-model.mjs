const ONE_HOUR_MS = 60 * 60 * 1000;
const AUTOMATIC_TRIGGER_KINDS = new Set([
  'tenderplan_mark',
  'recovery_scan',
]);
const RECLAIMABLE_EXECUTION_STATES = new Set([
  'success',
  'error',
  'canceled',
  'crashed',
  'not_found',
]);
const OWNED_EXECUTION_STATES = new Set(['new', 'running', 'waiting']);
const UNAVAILABLE_EXECUTION_STATES = new Set([
  null,
  'invalid',
  'unavailable',
  'network_error',
  'credential_error',
]);

function fail(message) {
  throw new Error(`Invalid intake resume state: ${message}`);
}

function parseInstant(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${fieldName} must be a non-empty ISO timestamp`);
  }
  if (!/(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) {
    fail(`${fieldName} must include an explicit timezone`);
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    fail(`${fieldName} must be a valid ISO timestamp`);
  }
  return timestamp;
}

function classifyIntent(triggerKind, manualOverride) {
  if (typeof manualOverride !== 'boolean') {
    fail('manualOverride must be boolean');
  }
  if (triggerKind === 'manual' && manualOverride === true) {
    return 'manual';
  }
  if (AUTOMATIC_TRIGGER_KINDS.has(triggerKind) && manualOverride === false) {
    return 'automatic';
  }
  fail('triggerKind and manualOverride do not form an approved intent');
}

function classifyStage(runStatus, finalCount, finalBarrierValid, intent) {
  switch (runStatus) {
    case 'processing':
      return 'continue_document_stage';
    case 'ready_for_aggregation':
      return 'call_aggregator';
    case 'aggregating':
      return finalCount === 27 && finalBarrierValid === true
        ? 'call_finalization'
        : 'manual_attention_required';
    case 'completed':
      return 'no_op';
    case 'failed':
      return intent === 'manual'
        ? 'reopen_failed_run'
        : 'automatic_attempts_exhausted';
    default:
      fail(`unknown runStatus ${String(runStatus)}`);
  }
}

function directClaimAction(document, intent) {
  if (intent === 'manual' || document.attempts < 2) {
    return { id: document.id, action: 'dispatch' };
  }
  return { id: document.id, action: 'exhausted' };
}

function classifyDocument(document, intent, now) {
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    fail('each document must be an object');
  }
  if (typeof document.id !== 'string' || document.id.trim() === '') {
    fail('document id must be a non-empty string');
  }
  if (!Number.isInteger(document.attempts) || document.attempts < 0) {
    fail(`document ${document.id} attempts must be a non-negative integer`);
  }

  if (document.status === 'completed') {
    return { id: document.id, action: 'skip' };
  }
  if (document.status === 'skipped') {
    return { id: document.id, action: 'preserve_skip' };
  }
  if (document.status === 'pending' || document.status === 'failed') {
    return directClaimAction(document, intent);
  }
  if (document.status !== 'processing') {
    fail(`document ${document.id} has unknown status ${String(document.status)}`);
  }

  if (typeof document.analysisRunId !== 'string' || document.analysisRunId.trim() === '') {
    fail(`document ${document.id} analysisRunId must be a non-empty string`);
  }
  if (typeof document.executionId !== 'string' || document.executionId.trim() === '') {
    fail(`document ${document.id} executionId must be a non-empty string`);
  }

  const startedAt = parseInstant(document.startedAt, `document ${document.id} startedAt`);
  const observedAt = parseInstant(now, 'now');
  if (startedAt > observedAt) {
    fail(`document ${document.id} startedAt is later than now`);
  }
  if (observedAt - startedAt < ONE_HOUR_MS) {
    return { id: document.id, action: 'leave_owned' };
  }

  if (OWNED_EXECUTION_STATES.has(document.executionState)) {
    return { id: document.id, action: 'leave_owned' };
  }
  if (UNAVAILABLE_EXECUTION_STATES.has(document.executionState)) {
    return { id: document.id, action: 'execution_status_unavailable' };
  }
  if (!RECLAIMABLE_EXECUTION_STATES.has(document.executionState)) {
    fail(`document ${document.id} has unknown execution observation`);
  }

  const cutoff = new Date(observedAt - ONE_HOUR_MS).toISOString();

  return {
    id: document.id,
    action: 'cas_to_failed',
    onApplied: intent === 'manual' || document.attempts < 2
      ? 'dispatch'
      : 'exhausted',
    onNotApplied: 'benign_race',
    compareAndSet: {
      id: document.id,
      analysisRunId: document.analysisRunId,
      status: 'processing',
      executionId: document.executionId,
      startedAt: document.startedAt,
      cutoff,
    },
  };
}

export function evaluateIntakeResumeDecision(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    fail('input must be an object');
  }

  const intent = classifyIntent(input.triggerKind, input.manualOverride);
  if (!Number.isInteger(input.finalCount) || input.finalCount < 0 || input.finalCount > 27) {
    fail('finalCount must be an integer from 0 through 27');
  }
  if (typeof input.finalBarrierValid !== 'boolean') {
    fail('finalBarrierValid must be boolean');
  }
  if (!Array.isArray(input.documents)) {
    fail('documents must be an array');
  }

  const documentActions = input.documents.map((document) =>
    classifyDocument(document, intent, input.now));
  const documentIds = documentActions.map(({ id }) => id);
  if (new Set(documentIds).size !== documentIds.length) {
    fail('document ids must be unique');
  }

  return {
    documentActions,
    stageAction: classifyStage(
      input.runStatus,
      input.finalCount,
      input.finalBarrierValid,
      intent,
    ),
  };
}
