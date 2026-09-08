import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL(
  '../migrations/2026-09-07_tender_intake_resume.sql',
  import.meta.url,
);

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\r\n]*/g, ' ');
}

function findRequired(sql, pattern, label) {
  const match = pattern.exec(sql);
  assert.ok(match, `missing ${label}`);
  return match;
}

function getDoBlocks(sql) {
  const pattern = /\bDO\s+(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)([\s\S]*?)\1\s*;/gi;
  return [...sql.matchAll(pattern)].map((match) => ({
    body: match[2],
    index: match.index,
    tag: match[1],
  }));
}

function getPostconditions(sql) {
  const postconditions = getDoBlocks(sql).find(
    (block) => block.tag.toLowerCase() === '$postconditions$',
  );
  assert.ok(postconditions, 'missing postcondition validation DO block');
  return postconditions.body;
}

function getConditionForException(postconditions, exceptionFragment) {
  const exceptionIndex = postconditions.indexOf(exceptionFragment);
  assert.notEqual(exceptionIndex, -1, `missing exception: ${exceptionFragment}`);

  const conditionIndex = postconditions.lastIndexOf('  IF ', exceptionIndex);
  assert.notEqual(conditionIndex, -1, `missing condition for: ${exceptionFragment}`);
  return postconditions.slice(conditionIndex, exceptionIndex);
}

test('SQL comment stripping removes statement decoys', () => {
  const stripped = stripSqlComments(`
    -- BEGIN;
    /* CREATE UNIQUE INDEX fake_index ON fake_table (fake_column); */
    SELECT 1;
    -- COMMIT;
  `);

  assert.doesNotMatch(stripped, /\bBEGIN\b/i);
  assert.doesNotMatch(stripped, /\bCREATE\s+UNIQUE\s+INDEX\b/i);
  assert.doesNotMatch(stripped, /\bCOMMIT\b/i);
});

test('migration has ordered transaction and validation boundaries', async () => {
  const sql = stripSqlComments(await readFile(migrationUrl, 'utf8')).trim();
  const doBlocks = getDoBlocks(sql);

  const begin = findRequired(sql, /^BEGIN\s*;/i, 'leading BEGIN');
  const indexUpgrade = doBlocks.find(
    (block) => block.tag.toLowerCase() === '$active_run_index_upgrade$',
  );
  assert.ok(indexUpgrade, 'missing active-run index upgrade DO block');
  const reconciliation = doBlocks.find(
    (block) => block.tag.toLowerCase() === '$legacy_reconciliation$',
  );
  assert.ok(reconciliation, 'missing bounded legacy reconciliation DO block');
  const preflight = doBlocks.find(
    (block) => block.tag.toLowerCase() === '$duplicate_preflight$',
  );
  assert.ok(preflight, 'missing duplicate preflight DO block');

  const uniqueIndex = findRequired(
    sql,
    /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+uq_tender_analysis_runs_one_unfinished\s+ON\s+public\.tender_analysis_runs\s*\(\s*source\s*,\s*tender_id\s*\)\s+WHERE\s+status\s+NOT\s+IN\s*\(\s*'completed'\s*,\s*'superseded'\s*\)\s*;/i,
    'unfinished-run unique index statement',
  );
  const ledger = findRequired(
    sql,
    /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.tender_analysis_intake_events\s*\(/i,
    'intake ledger statement',
  );
  const postconditions = doBlocks.find(
    (block) => block.tag.toLowerCase() === '$postconditions$',
  );
  assert.ok(postconditions, 'missing postcondition validation DO block');
  const commit = findRequired(sql, /COMMIT\s*;\s*$/i, 'trailing COMMIT');

  assert.ok(begin.index < indexUpgrade.index, 'BEGIN must precede index upgrade');
  assert.ok(
    indexUpgrade.index < reconciliation.index,
    'legacy index replacement must precede superseded reconciliation',
  );
  assert.ok(
    reconciliation.index < preflight.index,
    'reconciliation must precede duplicate preflight',
  );
  assert.ok(preflight.index < uniqueIndex.index, 'preflight must precede unique index');
  assert.ok(uniqueIndex.index < ledger.index, 'unique index must precede ledger creation');
  assert.ok(ledger.index < postconditions.index, 'ledger creation must precede postconditions');
  assert.ok(postconditions.index < commit.index, 'postconditions must precede COMMIT');
});

test('migration rejects duplicate unfinished runs before adding uniqueness', async () => {
  const sql = stripSqlComments(await readFile(migrationUrl, 'utf8'));
  const preflight = getDoBlocks(sql).find(
    (block) => block.tag.toLowerCase() === '$duplicate_preflight$',
  );
  assert.ok(preflight, 'missing duplicate preflight DO block');

  assert.match(
    preflight.body,
    /IF\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.tender_analysis_runs\s+WHERE\s+status\s+NOT\s+IN\s*\(\s*'completed'\s*,\s*'superseded'\s*\)[\s\S]*?GROUP\s+BY\s+source\s*,\s*tender_id\s+HAVING\s+count\(\*\)\s*>\s*1\s*\)\s+THEN[\s\S]*?RAISE\s+EXCEPTION/i,
  );
});

test('migration enforces one unfinished run', async () => {
  const sql = stripSqlComments(await readFile(migrationUrl, 'utf8'));

  assert.match(
    sql,
    /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+uq_tender_analysis_runs_one_unfinished\s+ON\s+public\.tender_analysis_runs\s*\(\s*source\s*,\s*tender_id\s*\)\s+WHERE\s+status\s+NOT\s+IN\s*\(\s*'completed'\s*,\s*'superseded'\s*\)\s*;/i,
  );
});

test('migration safely upgrades only the exact known legacy active-run index', async () => {
  const sql = stripSqlComments(await readFile(migrationUrl, 'utf8'));
  const upgrade = getDoBlocks(sql).find(
    (block) => block.tag.toLowerCase() === '$active_run_index_upgrade$',
  );
  assert.ok(upgrade, 'missing active-run index upgrade DO block');

  for (const catalogContract of [
    /pg_catalog\.pg_class/i,
    /pg_catalog\.pg_namespace/i,
    /pg_catalog\.pg_index/i,
    /pg_catalog\.pg_attribute/i,
    /pg_catalog\.pg_get_expr/i,
    /pg_catalog\.pg_get_indexdef/i,
  ]) {
    assert.match(upgrade.body, catalogContract);
  }

  assert.match(upgrade.body, /uq_tender_analysis_runs_one_unfinished/i);
  assert.match(upgrade.body, /index_metadata\.indrelid\s*=\s*runs_oid/i);
  assert.match(upgrade.body, /index_metadata\.indisunique/i);
  assert.match(upgrade.body, /NOT\s+index_metadata\.indisprimary/i);
  assert.match(upgrade.body, /index_metadata\.indisvalid/i);
  assert.match(upgrade.body, /index_metadata\.indisready/i);
  assert.match(upgrade.body, /index_metadata\.indnkeyatts\s*=\s*2/i);
  assert.match(upgrade.body, /index_metadata\.indnatts\s*=\s*2/i);
  assert.match(upgrade.body, /first_key\.attname\s*=\s*'source'/i);
  assert.match(upgrade.body, /second_key\.attname\s*=\s*'tender_id'/i);
  assert.match(upgrade.body, /status<>''completed''/i);
  assert.match(upgrade.body, /status<>allarray\[''completed'',''superseded''\]/i);
  assert.match(
    upgrade.body,
    /IF\s+index_definition_kind\s*=\s*'legacy'\s+THEN[\s\S]*?EXECUTE\s+format\s*\(\s*'DROP\s+INDEX\s+%I\.%I'/i,
  );
  assert.match(
    upgrade.body,
    /ELSE[\s\S]*?RAISE\s+EXCEPTION[\s\S]*?incompatible definition/i,
    'unknown same-name objects or index definitions must fail closed',
  );
  assert.doesNotMatch(
    upgrade.body,
    /DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?public\.uq_tender_analysis_runs_one_unfinished/i,
    'same-name index must never be dropped without catalog validation',
  );
});

test('migration adds auditable superseded run state through a validated status contract', async () => {
  const sql = stripSqlComments(await readFile(migrationUrl, 'utf8'));
  const statusContract = getDoBlocks(sql).find(
    (block) => block.tag.toLowerCase() === '$run_status_contract$',
  );
  assert.ok(statusContract, 'missing run status contract migration block');

  assert.match(
    sql,
    /ALTER\s+TABLE\s+public\.tender_analysis_runs\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+superseded_at\s+timestamptz\s*;/i,
  );
  assert.match(
    sql,
    /ALTER\s+TABLE\s+public\.tender_analysis_runs\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+superseded_reason\s+text\s*;/i,
  );
  assert.match(statusContract.body, /pg_catalog\.pg_constraint/i);
  assert.match(statusContract.body, /pg_catalog\.pg_get_constraintdef/i);
  assert.match(statusContract.body, /pg_catalog\.pg_attribute/i);
  assert.match(statusContract.body, /conkey/i);
  assert.match(statusContract.body, /convalidated/i);
  assert.match(statusContract.body, /created/i);
  assert.match(statusContract.body, /ready_for_aggregation/i);
  assert.match(statusContract.body, /superseded/i);
  assert.match(statusContract.body, /DROP\s+CONSTRAINT/i);
  assert.match(statusContract.body, /ADD\s+CONSTRAINT/i);
  assert.match(statusContract.body, /format\s*\(/i);
  assert.doesNotMatch(
    statusContract.body,
    /DROP\s+CONSTRAINT\s+tender_analysis_runs_status_check/i,
    'status CHECK replacement must use the discovered authoritative constraint, not a guessed name',
  );
});

test('migration reconciles only the approved 86 legacy runs and is a no-op without active duplicates', async () => {
  const sql = stripSqlComments(await readFile(migrationUrl, 'utf8'));
  const reconciliation = getDoBlocks(sql).find(
    (block) => block.tag.toLowerCase() === '$legacy_reconciliation$',
  );
  assert.ok(reconciliation, 'missing bounded legacy reconciliation block');

  for (const [source, tenderId, count, cutoff] of [
    ['manual_test', 'manual-calibration-167-26-ZO', 24, '2026-09-07T05:59:14.629399+00:00'],
    ['tenderplan', '6a7af04c3951804ff31b66a6', 50, '2026-08-17T18:50:41.678699+00:00'],
    ['tenderplan', '6a7ef6ac3951804ff32da751', 12, '2026-08-23T16:29:52.779826+00:00'],
  ]) {
    assert.match(reconciliation.body, new RegExp(source, 'i'));
    assert.match(reconciliation.body, new RegExp(tenderId, 'i'));
    assert.match(reconciliation.body, new RegExp(String(count), 'i'));
    assert.match(reconciliation.body, new RegExp(cutoff.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }

  assert.match(reconciliation.body, /status\s+NOT\s+IN\s*\(\s*'completed'\s*,\s*'superseded'\s*\)/i);
  assert.match(reconciliation.body, /IF\s+EXISTS\s*\([\s\S]*?HAVING\s+count\(\*\)\s*>\s*1[\s\S]*?THEN/i);
  assert.match(reconciliation.body, /CROSS\s+JOIN\s+LATERAL/i);
  assert.match(reconciliation.body, /created_at\s*<=\s*approved\.cutoff/i);
  assert.match(reconciliation.body, /UPDATE\s+public\.tender_analysis_runs/i);
  assert.match(reconciliation.body, /status\s*=\s*'superseded'/i);
  assert.match(reconciliation.body, /superseded_at\s*=\s*NOW\(\)/i);
  assert.match(reconciliation.body, /superseded_reason\s*=/i);
  assert.match(reconciliation.body, /updated_at\s*=\s*NOW\(\)/i);
  assert.match(reconciliation.body, /GET\s+DIAGNOSTICS[\s\S]*ROW_COUNT/i);
  assert.match(reconciliation.body, /<>\s*86/i);
  assert.doesNotMatch(reconciliation.body, /error_message\s*=/i);

  const duplicatePreflight = getDoBlocks(sql).find(
    (block) => block.tag.toLowerCase() === '$duplicate_preflight$',
  );
  assert.ok(duplicatePreflight, 'missing final duplicate preflight');
  assert.ok(
    reconciliation.index < duplicatePreflight.index,
    'bounded update must precede the final fail-closed duplicate preflight',
  );
});

test('migration creates the durable intake event ledger', async () => {
  const sql = stripSqlComments(await readFile(migrationUrl, 'utf8'));
  const table = findRequired(
    sql,
    /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.tender_analysis_intake_events\s*\([\s\S]*?\n\s*\);/i,
    'bounded intake ledger definition',
  )[0];

  for (const column of [
    'event_key',
    'analysis_run_id',
    'status',
    'attempts',
    'n8n_execution_id',
    'processing_started_at',
  ]) {
    assert.match(table, new RegExp(`\\b${column}\\b`, 'i'));
  }

  assert.match(table, /UNIQUE\s*\(\s*source\s*,\s*event_key\s*\)/i);
});

test('migration validates created or pre-existing schema objects fail closed', async () => {
  const sql = stripSqlComments(await readFile(migrationUrl, 'utf8'));
  const postconditions = getPostconditions(sql);

  for (const catalogContract of [
    /pg_catalog\.pg_class/i,
    /pg_catalog\.pg_namespace/i,
    /pg_catalog\.pg_index/i,
    /pg_catalog\.pg_attribute/i,
    /pg_catalog\.pg_constraint/i,
    /information_schema\.columns/i,
    /pg_catalog\.pg_get_indexdef/i,
    /pg_catalog\.pg_get_expr/i,
    /pg_catalog\.pg_get_constraintdef/i,
    /\bindisunique\b/i,
    /\bindnkeyatts\b/i,
    /\brelkind\b/i,
    /\brelpersistence\b/i,
    /\bconkey\b/i,
    /\bconfkey\b/i,
    /\bconfdeltype\b/i,
  ]) {
    assert.match(postconditions, catalogContract);
  }

  for (const objectName of [
    'uq_tender_analysis_runs_one_unfinished',
    'tender_analysis_intake_events',
    'idx_tender_analysis_intake_events_run',
    'idx_tender_analysis_intake_events_status_started',
  ]) {
    assert.match(postconditions, new RegExp(`\\b${objectName}\\b`, 'i'));
  }

  for (const checkLiteral of [
    'tenderplan_mark',
    'recovery_scan',
    'manual',
    'processing',
    'completed',
    'superseded',
    'failed',
  ]) {
    assert.match(postconditions, new RegExp(`'${checkLiteral}'`, 'i'));
  }

  assert.match(postconditions, /count\(\*\)[\s\S]*?<>\s*17/i);
  assert.match(postconditions, /attempts[\s\S]*?>=\s*0/i);
  assert.match(postconditions, /RAISE\s+EXCEPTION/i);
});

test('constraint postconditions require validated immediate semantics', async () => {
  const sql = stripSqlComments(await readFile(migrationUrl, 'utf8'));
  const postconditions = getPostconditions(sql);

  for (const exceptionFragment of [
    'primary key must be (id)',
    'unique key must be (source, event_key)',
  ]) {
    const condition = getConditionForException(postconditions, exceptionFragment);
    assert.match(condition, /constraint_row\.convalidated/i);
    assert.match(condition, /NOT\s+constraint_row\.condeferrable/i);
    assert.match(condition, /NOT\s+constraint_row\.condeferred/i);
  }

  const foreignKey = getConditionForException(
    postconditions,
    'analysis_run_id FK must reference',
  );
  assert.match(foreignKey, /constraint_row\.convalidated/i);
  assert.match(foreignKey, /NOT\s+constraint_row\.condeferrable/i);
  assert.match(foreignKey, /NOT\s+constraint_row\.condeferred/i);
  assert.match(foreignKey, /constraint_row\.confupdtype\s*=\s*'a'/i);
  assert.match(foreignKey, /constraint_row\.confdeltype\s*=\s*'n'/i);
  assert.match(foreignKey, /constraint_row\.confmatchtype\s*=\s*'s'/i);

  for (const exceptionFragment of [
    'trigger_kind CHECK values are incompatible',
    'status CHECK values are incompatible',
    'attempts CHECK must enforce attempts >= 0',
  ]) {
    const condition = getConditionForException(postconditions, exceptionFragment);
    assert.match(condition, /constraint_row\.convalidated/i);
  }
});

test('FK and CHECK enforcement checks are portable across PostgreSQL versions', async () => {
  const sql = stripSqlComments(await readFile(migrationUrl, 'utf8'));
  const postconditions = getPostconditions(sql);
  const requiredEnforcement = /AND\s+COALESCE\s*\(\s*\(\s*pg_catalog\.to_jsonb\s*\(\s*constraint_row\s*\)\s*->>\s*'conenforced'\s*\)\s*::boolean\s*,\s*true\s*\)/i;

  for (const exceptionFragment of [
    'analysis_run_id FK must reference',
    'trigger_kind CHECK values are incompatible',
    'status CHECK values are incompatible',
    'attempts CHECK must enforce attempts >= 0',
  ]) {
    const condition = getConditionForException(postconditions, exceptionFragment);
    assert.match(condition, requiredEnforcement);
    assert.doesNotMatch(condition, /constraint_row\.conenforced/i);
  }
});

test('UUID default creation and validation allow only pg_catalog semantics', async () => {
  const sql = stripSqlComments(await readFile(migrationUrl, 'utf8'));
  const table = findRequired(
    sql,
    /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.tender_analysis_intake_events\s*\([\s\S]*?\n\s*\);/i,
    'bounded intake ledger definition',
  )[0];
  const postconditions = getPostconditions(sql);

  assert.match(
    table,
    /\bid\s+uuid\s+PRIMARY\s+KEY\s+DEFAULT\s+pg_catalog\.gen_random_uuid\(\)/i,
  );
  assert.match(
    postconditions,
    /actual\.normalized_default\s+NOT\s+IN\s*\(\s*'gen_random_uuid\(\)'\s*,\s*'pg_catalog\.gen_random_uuid\(\)'\s*\)/i,
  );
  assert.doesNotMatch(
    postconditions,
    /\(\^\|\[\.\]\)gen_random_uuid/i,
  );
});
