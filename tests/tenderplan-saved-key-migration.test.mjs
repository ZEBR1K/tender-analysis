import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL(
  '../migrations/2026-09-13_tenderplan_saved_key_intake.sql',
  import.meta.url,
), 'utf8');
const normalized = sql.replace(/\s+/gu, ' ').toLowerCase();

test('migration changes only the existing trigger_kind CHECK and fails closed', () => {
  assert.match(normalized, /begin;/u);
  assert.match(normalized, /commit;/u);
  assert.match(normalized, /pg_constraint/u);
  assert.match(normalized, /pg_get_constraintdef/u);
  assert.match(normalized, /raise exception/u);
  assert.match(normalized, /drop constraint/u);
  assert.match(normalized, /add constraint/u);
  for (const value of ['manual', 'recovery_scan', 'tenderplan_mark', 'tenderplan_key']) {
    assert.match(normalized, new RegExp(`'${value}'`, 'u'));
  }
  assert.doesNotMatch(normalized, /create table|drop table|add column|drop column/u);
});
