import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testsDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testsDirectory, '..');
const migrationPath = path.join(
  repositoryRoot,
  'database',
  'migrations',
  '20260920_create_tender_analysis_deliveries.sql',
);

function sql() {
  return fs.readFileSync(migrationPath, 'utf8');
}

test('delivery migration creates the journal with the approved statuses', () => {
  const source = sql();
  assert.match(source, /CREATE TABLE public[.]tender_analysis_deliveries/u);
  for (const status of [
    'pending',
    'sending',
    'retry_wait',
    'sent',
    'failed',
    'unknown',
  ]) {
    assert.match(source, new RegExp("'" + status + "'", 'u'));
  }
});

test('delivery identity is unique per run, channel, and dialog', () => {
  assert.match(
    sql(),
    /UNIQUE [(]analysis_run_id, channel, dialog_id[)]/u,
  );
});

test('delivery migration preserves fail-closed and success invariants', () => {
  const source = sql();
  assert.match(source, /n8n_execution_id text/u);
  assert.match(source, /status <> 'sent'[\s\S]+message_id IS NOT NULL[\s\S]+file_id IS NOT NULL/u);
  assert.match(source, /status <> 'retry_wait'[\s\S]+next_attempt_at IS NOT NULL/u);
  assert.match(source, /status = 'retry_wait'[\s\S]+next_attempt_at IS NULL/u);
  assert.match(source, /attempt_count BETWEEN 0 AND 4/u);
  assert.match(source, /file_size BETWEEN 6 AND 104857600/u);
});

test('delivery migration indexes only the scheduled retry queue', () => {
  assert.match(
    sql(),
    /CREATE INDEX idx_tender_analysis_deliveries_due_retry[\s\S]+WHERE status = 'retry_wait'/u,
  );
});
