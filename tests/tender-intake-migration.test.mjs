import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL(
  '../migrations/2026-09-07_tender_intake_resume.sql',
  import.meta.url,
);

test('migration rejects duplicate unfinished runs before adding uniqueness', async () => {
  const sql = await readFile(migrationUrl, 'utf8');

  assert.match(sql, /FROM\s+public\.tender_analysis_runs/i);
  assert.match(sql, /WHERE\s+status\s*<>\s*'completed'/i);
  assert.match(sql, /GROUP BY\s+source\s*,\s*tender_id/i);
  assert.match(sql, /HAVING\s+count\(\*\)\s*>\s*1/i);
  assert.match(sql, /RAISE EXCEPTION/i);
});

test('migration enforces one unfinished run', async () => {
  const sql = await readFile(migrationUrl, 'utf8');

  assert.match(
    sql,
    /CREATE UNIQUE INDEX[\s\S]+ON\s+public\.tender_analysis_runs\s*\(\s*source\s*,\s*tender_id\s*\)[\s\S]+WHERE\s+status\s*<>\s*'completed'/i,
  );
});

test('migration creates the durable intake event ledger', async () => {
  const sql = await readFile(migrationUrl, 'utf8');

  assert.match(
    sql,
    /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+public\.tender_analysis_intake_events/i,
  );

  for (const column of [
    'event_key',
    'analysis_run_id',
    'status',
    'attempts',
    'n8n_execution_id',
    'processing_started_at',
  ]) {
    assert.match(sql, new RegExp(`\\b${column}\\b`, 'i'));
  }

  assert.match(sql, /UNIQUE\s*\(\s*source\s*,\s*event_key\s*\)/i);
});
