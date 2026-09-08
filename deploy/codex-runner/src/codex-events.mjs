const TERMINAL_EVENTS = new Set(['turn.completed', 'turn.failed', 'error']);
const USAGE_KEYS = [
  'input_tokens',
  'cached_input_tokens',
  'output_tokens',
  'reasoning_output_tokens',
];

function eventStreamError(message) {
  const error = new Error(`CODEX_EVENT_STREAM_INVALID: ${message}`);
  error.code = 'CODEX_EVENT_STREAM_INVALID';
  return error;
}

export function parseCodexEventLine(line) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    throw eventStreamError('stdout contained a non-JSON line');
  }
  if (event === null || typeof event !== 'object' || Array.isArray(event)) {
    throw eventStreamError('event must be a JSON object');
  }
  if (typeof event.type !== 'string' || event.type.length === 0) {
    throw eventStreamError('event.type must be a non-empty string');
  }
  return event;
}

function tokenCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function createCodexEventAccumulator() {
  let threadId = null;
  let terminalEvent = null;
  let eventCount = 0;
  const usage = Object.fromEntries(USAGE_KEYS.map((key) => [key, 0]));

  return Object.freeze({
    accept(event) {
      if (event === null || typeof event !== 'object' || Array.isArray(event)) {
        throw eventStreamError('event must be a JSON object');
      }
      eventCount += 1;
      if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
        threadId = event.thread_id;
      }
      if (TERMINAL_EVENTS.has(event.type)) terminalEvent = event.type;
      if (event.type === 'turn.completed' && event.usage && typeof event.usage === 'object') {
        for (const key of USAGE_KEYS) usage[key] += tokenCount(event.usage[key]);
      }
    },
    snapshot() {
      return {
        thread_id: threadId,
        terminal_event: terminalEvent,
        event_count: eventCount,
        usage: { ...usage },
      };
    },
  });
}
