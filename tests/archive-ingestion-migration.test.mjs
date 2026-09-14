import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL(
  '../deploy/postgres/migrations/2026-09-07-add-document-ingestion-metadata.sql',
  import.meta.url,
);

test('archive ingestion migration is additive, bounded and transactional', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /^BEGIN;/mu);
  assert.match(sql, /SET LOCAL lock_timeout\s*=\s*'5s';/u);
  assert.match(sql, /SET LOCAL statement_timeout\s*=\s*'60s';/u);
  assert.match(
    sql,
    /ALTER TABLE public\.tender_analysis_documents\s+ADD COLUMN IF NOT EXISTS ingestion_metadata jsonb NOT NULL DEFAULT '\{\}'::jsonb;/su,
  );
  assert.match(sql, /COMMIT;\s*$/u);
  assert.doesNotMatch(sql, /\b(?:DROP|DELETE|TRUNCATE|UPDATE)\b/iu);
  assert.equal((sql.match(/\bALTER TABLE\b/giu) || []).length, 1);
});
