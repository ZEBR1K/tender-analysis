import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL(
  '../deploy/postgres/migrations/2026-09-08-add-agentic-shadow-analysis.sql',
  import.meta.url,
);
const planUrl = new URL(
  '../docs/superpowers/plans/2026-09-08-agentic-analysis-stages-3-5.md',
  import.meta.url,
);

const canonicalTables = [
  'tender_analysis_runs',
  'tender_analysis_documents',
  'tender_analysis_units',
  'tender_analysis_facts',
  'tender_analysis_field_results',
];

const shadowTables = [
  'tender_agentic_jobs',
  'tender_agentic_documents',
  'tender_agentic_field_results',
];

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\r\n]*/g, ' ');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getDoBlock(sql, tag) {
  const escaped = escapeRegExp(tag);
  const match = new RegExp(`\\bDO\\s+\\$${escaped}\\$([\\s\\S]*?)\\$${escaped}\\$\\s*;`, 'i').exec(sql);
  assert.ok(match, `missing $${tag}$ DO block`);
  return match[1];
}

function getCreateTable(sql, tableName) {
  const match = new RegExp(
    `CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+public\\.${escapeRegExp(tableName)}\\s*\\(([\\s\\S]*?)\\n\\);`,
    'i',
  ).exec(sql);
  assert.ok(match, `missing CREATE TABLE for ${tableName}`);
  return match[1];
}

function assertColumn(tableBody, name, definition) {
  assert.match(
    tableBody,
    new RegExp(`(?:^|\\n)\\s*${escapeRegExp(name)}\\s+${definition}\\s*(?:,|$)`, 'i'),
    `missing or incompatible ${name}`,
  );
}

function assertNamedConstraint(tableBody, name, definition) {
  assert.match(
    tableBody,
    new RegExp(`CONSTRAINT\\s+${escapeRegExp(name)}\\s+${definition}`, 'i'),
    `missing or incompatible constraint ${name}`,
  );
}

test('migration source is present and wrapped in one ordered transaction', async () => {
  const sql = stripSqlComments(await readFile(migrationUrl, 'utf8')).trim();

  assert.match(sql, /^BEGIN\s*;/i);
  assert.match(sql, /SET\s+LOCAL\s+lock_timeout\s*=\s*'5s'\s*;/i);
  assert.match(sql, /SET\s+LOCAL\s+statement_timeout\s*=\s*'60s'\s*;/i);
  assert.equal((sql.match(/\bBEGIN\s*;/gi) || []).length, 1);
  assert.equal((sql.match(/\bCOMMIT\s*;/gi) || []).length, 1);
  assert.match(sql, /COMMIT\s*;\s*$/i);

  const preconditions = getDoBlock(sql, 'canonical_preconditions');
  const postconditions = getDoBlock(sql, 'agentic_postconditions');
  assert.ok(sql.indexOf('$canonical_preconditions$') < sql.indexOf('CREATE TABLE'));
  assert.ok(sql.lastIndexOf('$agentic_postconditions$') > sql.lastIndexOf('CREATE INDEX'));
  assert.match(preconditions, /RAISE\s+EXCEPTION/i);
  assert.match(postconditions, /RAISE\s+EXCEPTION/i);
});

test('migration blocks concurrent canonical and shadow schema changes in a fixed order', async () => {
  const sql = stripSqlComments(await readFile(migrationUrl, 'utf8'));
  const canonicalPreconditionIndex = sql.indexOf('DO $canonical_preconditions$');
  assert.ok(canonicalPreconditionIndex > 0, 'missing canonical precondition boundary');

  let priorLockIndex = -1;
  for (const table of canonicalTables) {
    const match = new RegExp(`LOCK\\s+TABLE\\s+public\\.${table}\\s+IN\\s+SHARE\\s+UPDATE\\s+EXCLUSIVE\\s+MODE\\s*;`, 'i').exec(sql);
    assert.ok(match, `missing SHARE UPDATE EXCLUSIVE lock for ${table}`);
    assert.ok(match.index > priorLockIndex, `canonical lock order is unstable at ${table}`);
    assert.ok(match.index < canonicalPreconditionIndex, `${table} lock must precede catalog inspection`);
    priorLockIndex = match.index;
  }

  const shadowLocks = getDoBlock(sql, 'shadow_locks');
  assert.ok(sql.indexOf('DO $shadow_locks$') < canonicalPreconditionIndex);
  for (const table of shadowTables) assert.match(shadowLocks, new RegExp(`'${table}'`, 'i'));
  assert.match(shadowLocks, /existing_object_kind\s*<>\s*'r'/i);
  assert.match(shadowLocks, /format\s*\(\s*'LOCK TABLE %I\.%I IN SHARE UPDATE EXCLUSIVE MODE'/i);
  assert.doesNotMatch(sql, /LOCK\s+TABLE[\s\S]*?IN\s+ACCESS\s+SHARE\s+MODE/i);
});

test('migration fail-closes on canonical parent schema drift without mutating canonical tables', async () => {
  const sql = stripSqlComments(await readFile(migrationUrl, 'utf8'));
  const preconditions = getDoBlock(sql, 'canonical_preconditions');

  for (const table of canonicalTables) {
    assert.match(preconditions, new RegExp(`'${escapeRegExp(table)}'`, 'i'));
  }
  for (const catalog of [
    'pg_catalog.pg_class',
    'pg_catalog.pg_namespace',
    'pg_catalog.pg_attribute',
    'pg_catalog.pg_constraint',
    'pg_catalog.pg_index',
    'pg_catalog.pg_get_constraintdef',
    'pg_catalog.pg_get_indexdef',
    'information_schema.columns',
  ]) {
    assert.match(preconditions, new RegExp(escapeRegExp(catalog), 'i'));
  }
  assert.match(preconditions, /relkind\s*=\s*'r'/i, 'canonical parents must remain ordinary tables');
  assert.match(preconditions, /relpersistence\s*=\s*'p'/i);
  assert.match(preconditions, /EXCEPT/i, 'column inventory must reject missing or extra columns');
  assert.doesNotMatch(
    preconditions,
    /\)\s*\(SELECT \* FROM expected EXCEPT SELECT \* FROM actual\)/i,
    'catalog difference CTEs need an explicit SELECT wrapper accepted by PostgreSQL runtime planning',
  );
  assert.ok(
    (preconditions.match(/FULL\s+(?:OUTER\s+)?JOIN/gi) || []).length >= 4,
    'catalog contract inventories must use PostgreSQL-safe symmetric joins',
  );
  assert.match(preconditions, /PRIMARY\s+KEY/i, 'parent primary-key identities must be checked');
  assert.match(preconditions, /column_default/i, 'canonical defaults must be checked');
  assert.match(preconditions, /UNIQUE/i, 'canonical unique-key identities must be checked');
  assert.match(preconditions, /FOREIGN\s+KEY/i, 'canonical foreign-key identities must be checked');
  assert.match(preconditions, /CHECK/i, 'canonical check semantics must be checked');
  assert.match(preconditions, /constraint_row\.confupdtype::text\s+AS\s+update_action/i);
  assert.match(preconditions, /constraint_row\.confdeltype::text\s+AS\s+delete_action/i);
  assert.match(preconditions, /constraint_row\.confmatchtype::text\s+AS\s+match_type/i);
  assert.match(preconditions, /'a'::text\s*,\s*'c'::text\s*,\s*'s'::text/i);
  assert.match(preconditions, /convalidated/i);
  assert.match(preconditions, /NOT\s+constraint_row\.condeferrable/i);
  assert.match(preconditions, /NOT\s+constraint_row\.condeferred/i);
  assert.match(preconditions, /NOT\s+constraint_row\.connoinherit/i);
  assert.match(
    preconditions,
    /repeat\s*\(\s*','\s*,\s*array_length\s*\(\s*expected_values\s*,\s*1\s*\)\s*-\s*1\s*\)/i,
    'enum checks must enforce the exact simple-column predicate shape, not only the quoted values',
  );

  for (const guardedContract of [
    'canonical default contract',
    'canonical unique contract',
    'canonical foreign key contract',
    'canonical check contract',
    'canonical index contract',
  ]) {
    assert.match(preconditions, new RegExp(guardedContract, 'i'));
  }
  for (const representative of [
    'tender_fields_v1',
    'application_documents',
    'idx_tender_analysis_facts_run_field',
    'idx_tender_analysis_documents_run_status',
    'tender_analysis_documents',
    'tender_analysis_runs',
  ]) {
    assert.match(preconditions, new RegExp(representative, 'i'));
  }

  for (const table of canonicalTables) {
    assert.doesNotMatch(sql, new RegExp(`ALTER\\s+TABLE\\s+public\\.${escapeRegExp(table)}`, 'i'));
  }
  assert.doesNotMatch(
    sql,
    /\b(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?|DROP\s+(?:TABLE|INDEX|SCHEMA|CONSTRAINT))\b/i,
  );
});

test('jobs table has the exact lifecycle, audit and ownership columns', async () => {
  const body = getCreateTable(stripSqlComments(await readFile(migrationUrl, 'utf8')), 'tender_agentic_jobs');

  const columns = {
    id: 'uuid\\s+NOT\\s+NULL\\s+DEFAULT\\s+pg_catalog\\.gen_random_uuid\\(\\)',
    analysis_run_id: 'uuid\\s+NOT\\s+NULL',
    pipeline_version: 'text\\s+NOT\\s+NULL',
    replicate_index: 'smallint\\s+NOT\\s+NULL\\s+DEFAULT\\s+1',
    status: "text\\s+NOT\\s+NULL\\s+DEFAULT\\s+'created'",
    model: 'text\\s+NOT\\s+NULL',
    reasoning_effort: 'text\\s+NOT\\s+NULL',
    field_catalog_version: 'text\\s+NOT\\s+NULL',
    field_catalog_sha256: 'text\\s+NOT\\s+NULL',
    input_manifest_sha256: 'text',
    expected_documents: 'integer\\s+NOT\\s+NULL',
    staged_documents: 'integer\\s+NOT\\s+NULL\\s+DEFAULT\\s+0',
    attempts: 'smallint\\s+NOT\\s+NULL\\s+DEFAULT\\s+0',
    dispatch_execution_id: 'text',
    poll_owner_execution_id: 'text',
    poll_claimed_at: 'timestamptz',
    runner_started_at: 'timestamptz',
    heartbeat_at: 'timestamptz',
    completed_at: 'timestamptz',
    input_tokens: 'bigint',
    cached_input_tokens: 'bigint',
    output_tokens: 'bigint',
    reasoning_output_tokens: 'bigint',
    artifacts: "jsonb\\s+NOT\\s+NULL\\s+DEFAULT\\s+'\\{\\}'::jsonb",
    validation_summary: "jsonb\\s+NOT\\s+NULL\\s+DEFAULT\\s+'\\{\\}'::jsonb",
    error_code: 'text',
    error_message: 'text',
    created_at: 'timestamptz\\s+NOT\\s+NULL\\s+DEFAULT\\s+now\\(\\)',
    updated_at: 'timestamptz\\s+NOT\\s+NULL\\s+DEFAULT\\s+now\\(\\)',
  };
  for (const [name, definition] of Object.entries(columns)) assertColumn(body, name, definition);

  assertNamedConstraint(body, 'tender_agentic_jobs_pkey', 'PRIMARY\\s+KEY\\s*\\(\\s*id\\s*\\)');
  assertNamedConstraint(
    body,
    'tender_agentic_jobs_analysis_run_fk',
    'FOREIGN\\s+KEY\\s*\\(\\s*analysis_run_id\\s*\\)\\s+REFERENCES\\s+public\\.tender_analysis_runs\\s*\\(\\s*id\\s*\\)\\s+ON\\s+DELETE\\s+CASCADE',
  );
  assertNamedConstraint(
    body,
    'tender_agentic_jobs_run_pipeline_replicate_key',
    'UNIQUE\\s*\\(\\s*analysis_run_id\\s*,\\s*pipeline_version\\s*,\\s*replicate_index\\s*\\)',
  );
  assertNamedConstraint(
    body,
    'tender_agentic_jobs_id_run_key',
    'UNIQUE\\s*\\(\\s*id\\s*,\\s*analysis_run_id\\s*\\)',
  );
  assertNamedConstraint(
    body,
    'tender_agentic_jobs_id_run_catalog_key',
    'UNIQUE\\s*\\(\\s*id\\s*,\\s*analysis_run_id\\s*,\\s*field_catalog_version\\s*\\)',
  );
  assertNamedConstraint(body, 'tender_agentic_jobs_replicate_index_check', 'CHECK\\s*\\(\\s*replicate_index\\s*>=\\s*1\\s*\\)');
  assertNamedConstraint(body, 'tender_agentic_jobs_expected_documents_check', 'CHECK\\s*\\(\\s*expected_documents\\s*>=\\s*0\\s*\\)');
  assertNamedConstraint(body, 'tender_agentic_jobs_staged_documents_check', 'CHECK\\s*\\(\\s*staged_documents\\s*>=\\s*0\\s*\\)');
  assertNamedConstraint(body, 'tender_agentic_jobs_attempts_check', 'CHECK\\s*\\(\\s*attempts\\s+BETWEEN\\s+0\\s+AND\\s+2\\s*\\)');
  for (const status of ['created', 'staging', 'ready', 'running', 'validating', 'completed', 'failed', 'canceled']) {
    assert.match(body, new RegExp(`'${status}'`, 'i'));
  }
});

test('documents table has the staging barrier keys and bounded status contract', async () => {
  const body = getCreateTable(stripSqlComments(await readFile(migrationUrl, 'utf8')), 'tender_agentic_documents');
  const columns = {
    job_id: 'uuid\\s+NOT\\s+NULL',
    analysis_run_id: 'uuid\\s+NOT\\s+NULL',
    source_document_id: 'uuid\\s+NOT\\s+NULL',
    artifact_key: 'text\\s+NOT\\s+NULL',
    document_index: 'integer\\s+NOT\\s+NULL',
    file_name: 'text',
    mime_type: 'text',
    source_sha256: 'text',
    staged_sha256: 'text',
    byte_size: 'bigint',
    status: "text\\s+NOT\\s+NULL\\s+DEFAULT\\s+'pending'",
    runner_storage_key: 'text',
    error_code: 'text',
    error_message: 'text',
    created_at: 'timestamptz\\s+NOT\\s+NULL\\s+DEFAULT\\s+now\\(\\)',
    updated_at: 'timestamptz\\s+NOT\\s+NULL\\s+DEFAULT\\s+now\\(\\)',
  };
  for (const [name, definition] of Object.entries(columns)) assertColumn(body, name, definition);

  assertNamedConstraint(body, 'tender_agentic_documents_pkey', 'PRIMARY\\s+KEY\\s*\\(\\s*job_id\\s*,\\s*source_document_id\\s*\\)');
  assertNamedConstraint(
    body,
    'tender_agentic_documents_job_run_fk',
    'FOREIGN\\s+KEY\\s*\\(\\s*job_id\\s*,\\s*analysis_run_id\\s*\\)\\s+REFERENCES\\s+public\\.tender_agentic_jobs\\s*\\(\\s*id\\s*,\\s*analysis_run_id\\s*\\)\\s+ON\\s+DELETE\\s+CASCADE',
  );
  assertNamedConstraint(
    body,
    'tender_agentic_documents_source_document_run_fk',
    'FOREIGN\\s+KEY\\s*\\(\\s*source_document_id\\s*,\\s*analysis_run_id\\s*\\)\\s+REFERENCES\\s+public\\.tender_analysis_documents\\s*\\(\\s*id\\s*,\\s*analysis_run_id\\s*\\)\\s+ON\\s+DELETE\\s+CASCADE',
  );
  assertNamedConstraint(body, 'tender_agentic_documents_artifact_key_key', 'UNIQUE\\s*\\(\\s*job_id\\s*,\\s*artifact_key\\s*\\)');
  assertNamedConstraint(body, 'tender_agentic_documents_document_index_key', 'UNIQUE\\s*\\(\\s*job_id\\s*,\\s*document_index\\s*\\)');
  for (const status of ['pending', 'uploading', 'staged', 'failed']) {
    assert.match(body, new RegExp(`'${status}'`, 'i'));
  }
});

test('field result table isolates raw and effective exact-27 projections', async () => {
  const body = getCreateTable(stripSqlComments(await readFile(migrationUrl, 'utf8')), 'tender_agentic_field_results');
  const columns = {
    job_id: 'uuid\\s+NOT\\s+NULL',
    analysis_run_id: 'uuid\\s+NOT\\s+NULL',
    field_catalog_version: 'text\\s+NOT\\s+NULL',
    field_index: 'smallint\\s+NOT\\s+NULL',
    field_key: 'text\\s+NOT\\s+NULL',
    reported_status: 'text\\s+NOT\\s+NULL',
    effective_status: 'text\\s+NOT\\s+NULL',
    reported_value_text: 'text',
    effective_value_text: 'text',
    requires_human_review: 'boolean\\s+NOT\\s+NULL',
    validation_level: 'text\\s+NOT\\s+NULL',
    result_json: 'jsonb\\s+NOT\\s+NULL',
    created_at: 'timestamptz\\s+NOT\\s+NULL\\s+DEFAULT\\s+now\\(\\)',
    updated_at: 'timestamptz\\s+NOT\\s+NULL\\s+DEFAULT\\s+now\\(\\)',
  };
  for (const [name, definition] of Object.entries(columns)) assertColumn(body, name, definition);

  assertNamedConstraint(body, 'tender_agentic_field_results_pkey', 'PRIMARY\\s+KEY\\s*\\(\\s*job_id\\s*,\\s*field_key\\s*\\)');
  assertNamedConstraint(body, 'tender_agentic_field_results_field_index_key', 'UNIQUE\\s*\\(\\s*job_id\\s*,\\s*field_index\\s*\\)');
  assertNamedConstraint(body, 'tender_agentic_field_results_field_index_check', 'CHECK\\s*\\(\\s*field_index\\s+BETWEEN\\s+1\\s+AND\\s+27\\s*\\)');
  assertNamedConstraint(
    body,
    'tender_agentic_field_results_job_run_catalog_fk',
    'FOREIGN\\s+KEY\\s*\\(\\s*job_id\\s*,\\s*analysis_run_id\\s*,\\s*field_catalog_version\\s*\\)\\s+REFERENCES\\s+public\\.tender_agentic_jobs\\s*\\(\\s*id\\s*,\\s*analysis_run_id\\s*,\\s*field_catalog_version\\s*\\)\\s+ON\\s+DELETE\\s+CASCADE',
  );
  assertNamedConstraint(
    body,
    'tender_agentic_field_results_analysis_run_fk',
    'FOREIGN\\s+KEY\\s*\\(\\s*analysis_run_id\\s*\\)\\s+REFERENCES\\s+public\\.tender_analysis_runs\\s*\\(\\s*id\\s*\\)\\s+ON\\s+DELETE\\s+CASCADE',
  );
  for (const status of ['resolved', 'requires_review', 'not_found']) {
    assert.ok((body.match(new RegExp(`'${status}'`, 'gi')) || []).length >= 2, `${status} must be allowed for both status columns`);
  }
  for (const level of ['pass', 'warning', 'downgraded']) assert.match(body, new RegExp(`'${level}'`, 'i'));
});

test('implementation plan records same-run and field-catalog database ownership', async () => {
  const plan = await readFile(planUrl, 'utf8');
  assert.match(plan, /fixed-order `SHARE UPDATE EXCLUSIVE` locks/i);
  assert.match(plan, /tender_agentic_documents[\s\S]*?analysis_run_id uuid NOT NULL/i);
  assert.match(plan, /UNIQUE \(id, analysis_run_id\)/i);
  assert.match(plan, /UNIQUE \(id, analysis_run_id, field_catalog_version\)/i);
  assert.match(plan, /FOREIGN KEY \(job_id, analysis_run_id\)[\s\S]*?tender_agentic_jobs\(id, analysis_run_id\)/i);
  assert.match(plan, /FOREIGN KEY \(source_document_id, analysis_run_id\)[\s\S]*?tender_analysis_documents\(id, analysis_run_id\)/i);
  assert.match(plan, /FOREIGN KEY \(job_id, analysis_run_id, field_catalog_version\)[\s\S]*?tender_agentic_jobs\(id, analysis_run_id, field_catalog_version\)/i);
});

test('migration creates the three monitor indexes idempotently', async () => {
  const sql = stripSqlComments(await readFile(migrationUrl, 'utf8'));
  const expected = [
    ['idx_tender_agentic_jobs_status_heartbeat', 'tender_agentic_jobs', 'status\\s*,\\s*heartbeat_at'],
    ['idx_tender_agentic_jobs_poll_claimed', 'tender_agentic_jobs', 'poll_claimed_at'],
    ['idx_tender_agentic_jobs_analysis_run', 'tender_agentic_jobs', 'analysis_run_id'],
  ];
  for (const [name, table, columns] of expected) {
    assert.match(
      sql,
      new RegExp(`CREATE\\s+INDEX\\s+IF\\s+NOT\\s+EXISTS\\s+${name}\\s+ON\\s+public\\.${table}\\s*\\(\\s*${columns}\\s*\\)\\s*;`, 'i'),
    );
  }
});

test('postconditions validate exact shadow columns, constraints, FKs and indexes', async () => {
  const sql = stripSqlComments(await readFile(migrationUrl, 'utf8'));
  const postconditions = getDoBlock(sql, 'agentic_postconditions');

  for (const table of shadowTables) assert.match(postconditions, new RegExp(`'${table}'`, 'i'));
  for (const catalog of [
    'pg_catalog.pg_class',
    'pg_catalog.pg_namespace',
    'pg_catalog.pg_attribute',
    'pg_catalog.pg_constraint',
    'pg_catalog.pg_index',
    'pg_catalog.pg_get_constraintdef',
    'pg_catalog.pg_get_indexdef',
    'information_schema.columns',
  ]) {
    assert.match(postconditions, new RegExp(escapeRegExp(catalog), 'i'));
  }
  assert.match(postconditions, /relkind\s*<>\s*'r'/i, 'shadow objects must remain ordinary tables');
  for (const count of [29, 16, 14]) assert.match(postconditions, new RegExp(`<>\\s*${count}\\b`, 'i'));
  for (const name of [
    'tender_agentic_jobs_pkey',
    'tender_agentic_jobs_analysis_run_fk',
    'tender_agentic_jobs_run_pipeline_replicate_key',
    'tender_agentic_jobs_id_run_key',
    'tender_agentic_jobs_id_run_catalog_key',
    'tender_agentic_documents_pkey',
    'tender_agentic_documents_job_run_fk',
    'tender_agentic_documents_source_document_run_fk',
    'tender_agentic_documents_artifact_key_key',
    'tender_agentic_documents_document_index_key',
    'tender_agentic_field_results_pkey',
    'tender_agentic_field_results_job_run_catalog_fk',
    'tender_agentic_field_results_analysis_run_fk',
    'tender_agentic_field_results_field_index_key',
    'idx_tender_agentic_jobs_status_heartbeat',
    'idx_tender_agentic_jobs_poll_claimed',
    'idx_tender_agentic_jobs_analysis_run',
  ]) {
    assert.match(postconditions, new RegExp(`'${name}'`, 'i'));
  }
  assert.match(postconditions, /convalidated/i);
  assert.doesNotMatch(
    postconditions,
    /\)\s*\(SELECT \* FROM expected EXCEPT SELECT \* FROM actual\)/i,
    'shadow inventory CTE needs an explicit SELECT wrapper accepted by PostgreSQL runtime planning',
  );
  assert.match(postconditions, /FULL\s+(?:OUTER\s+)?JOIN/i);
  assert.match(postconditions, /condeferrable/i);
  assert.match(postconditions, /condeferred/i);
  assert.match(postconditions, /connoinherit/i);
  assert.match(postconditions, /confdeltype\s*=\s*'c'/i);
  assert.match(
    postconditions,
    /repeat\s*\(\s*','\s*,\s*array_length\s*\(\s*status_contract\.expected_values\s*,\s*1\s*\)\s*-\s*1\s*\)/i,
    'shadow enum postconditions must validate the exact simple-column predicate shape',
  );
  assert.match(postconditions, /indisvalid/i);
  assert.match(postconditions, /indisready/i);
});

test('source-level empty and populated fixture model remains idempotent and leaves canonical rows byte-identical', async () => {
  const sql = stripSqlComments(await readFile(migrationUrl, 'utf8'));
  const canonicalFixture = Object.fromEntries(canonicalTables.map((name) => [name, { definition: `fixture:${name}` }]));
  const populatedRows = JSON.stringify({
    tender_analysis_runs: [{ id: 'run-1', status: 'processing' }],
    tender_analysis_documents: [{ id: 'document-1', analysis_run_id: 'run-1' }],
    tender_analysis_units: [{ id: 'unit-1', analysis_run_id: 'run-1' }],
    tender_analysis_facts: [{ id: 'fact-1', analysis_run_id: 'run-1' }],
    tender_analysis_field_results: [{ analysis_run_id: 'run-1', field_key: 'customer' }],
  });

  function applyCreateIfMissing(schema) {
    const next = structuredClone(schema);
    for (const table of shadowTables) {
      assert.match(sql, new RegExp(`CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+public\\.${table}`, 'i'));
      next[table] ??= { definition: getCreateTable(sql, table) };
    }
    return next;
  }

  const emptyFirst = applyCreateIfMissing(canonicalFixture);
  const emptySecond = applyCreateIfMissing(emptyFirst);
  assert.deepEqual(emptySecond, emptyFirst, 'second source-level application must be a no-op');
  assert.deepEqual(
    Object.fromEntries(canonicalTables.map((name) => [name, emptySecond[name]])),
    canonicalFixture,
    'canonical fixture definitions must remain byte-identical',
  );

  const beforeRows = populatedRows;
  applyCreateIfMissing(canonicalFixture);
  assert.equal(populatedRows, beforeRows, 'migration source must not update populated canonical fixture rows');
});

const canonicalFixtureSql = String.raw`
CREATE TABLE public.tender_analysis_runs (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  source text NOT NULL DEFAULT 'tenderplan',
  tender_id text NOT NULL,
  tender_number text,
  tender_external_id text,
  status text NOT NULL DEFAULT 'created',
  documents_total integer NOT NULL DEFAULT 0,
  tender_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  aggregation_started_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT tender_analysis_runs_pkey PRIMARY KEY (id),
  CONSTRAINT tender_analysis_runs_documents_total_check CHECK (documents_total >= 0),
  CONSTRAINT tender_analysis_runs_status_check CHECK (
    status IN ('created', 'processing', 'ready_for_aggregation', 'aggregating', 'completed', 'failed')
  )
);
CREATE INDEX idx_tender_analysis_runs_status ON public.tender_analysis_runs (status);
CREATE INDEX idx_tender_analysis_runs_tender_id ON public.tender_analysis_runs (tender_id);
CREATE INDEX idx_tender_analysis_runs_tender_status ON public.tender_analysis_runs (tender_id, status);

CREATE TABLE public.tender_analysis_documents (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  analysis_run_id uuid NOT NULL,
  document_index integer NOT NULL,
  file_name text,
  file_extension text,
  display_name text,
  download_url text,
  publication_at timestamptz,
  source_size bigint,
  mime_type text,
  file_size bigint,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  n8n_execution_id text,
  units_total integer,
  facts_count integer,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT tender_analysis_documents_pkey PRIMARY KEY (id),
  CONSTRAINT tender_analysis_documents_analysis_run_fk
    FOREIGN KEY (analysis_run_id) REFERENCES public.tender_analysis_runs (id) ON DELETE CASCADE,
  CONSTRAINT tender_analysis_documents_run_index_key UNIQUE (analysis_run_id, document_index),
  CONSTRAINT tender_analysis_documents_id_run_key UNIQUE (id, analysis_run_id),
  CONSTRAINT tender_analysis_documents_document_index_check CHECK (document_index > 0),
  CONSTRAINT tender_analysis_documents_attempts_check CHECK (attempts >= 0),
  CONSTRAINT tender_analysis_documents_units_total_check CHECK (units_total IS NULL OR units_total >= 0),
  CONSTRAINT tender_analysis_documents_facts_count_check CHECK (facts_count IS NULL OR facts_count >= 0),
  CONSTRAINT tender_analysis_documents_status_check CHECK (
    status IN ('pending', 'processing', 'completed', 'failed', 'skipped')
  )
);
CREATE INDEX idx_tender_analysis_documents_execution ON public.tender_analysis_documents (n8n_execution_id);
CREATE INDEX idx_tender_analysis_documents_run ON public.tender_analysis_documents (analysis_run_id);
CREATE INDEX idx_tender_analysis_documents_run_status ON public.tender_analysis_documents (analysis_run_id, status);

CREATE TABLE public.tender_analysis_units (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  analysis_run_id uuid NOT NULL,
  document_id uuid NOT NULL,
  analysis_unit_id text NOT NULL,
  unit_index integer,
  units_total integer,
  section_id text,
  section_title text,
  section_kind text,
  part_index integer,
  parts_total integer,
  source_pages jsonb NOT NULL DEFAULT '[]'::jsonb,
  analysis_unit jsonb NOT NULL DEFAULT '{}'::jsonb,
  ai_segments jsonb NOT NULL DEFAULT '[]'::jsonb,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tender_analysis_units_pkey PRIMARY KEY (id),
  CONSTRAINT tender_analysis_units_run_fk
    FOREIGN KEY (analysis_run_id) REFERENCES public.tender_analysis_runs (id) ON DELETE CASCADE,
  CONSTRAINT tender_analysis_units_document_run_fk
    FOREIGN KEY (document_id, analysis_run_id)
    REFERENCES public.tender_analysis_documents (id, analysis_run_id) ON DELETE CASCADE,
  CONSTRAINT tender_analysis_units_document_unit_key UNIQUE (document_id, analysis_unit_id),
  CONSTRAINT tender_analysis_units_document_unit_run_key
    UNIQUE (document_id, analysis_unit_id, analysis_run_id),
  CONSTRAINT tender_analysis_units_unit_index_check CHECK (unit_index IS NULL OR unit_index > 0),
  CONSTRAINT tender_analysis_units_units_total_check CHECK (units_total IS NULL OR units_total >= 0),
  CONSTRAINT tender_analysis_units_part_index_check CHECK (part_index IS NULL OR part_index > 0),
  CONSTRAINT tender_analysis_units_parts_total_check CHECK (parts_total IS NULL OR parts_total > 0)
);
CREATE INDEX idx_tender_analysis_units_analysis_unit_id ON public.tender_analysis_units (analysis_unit_id);
CREATE INDEX idx_tender_analysis_units_document ON public.tender_analysis_units (document_id);
CREATE INDEX idx_tender_analysis_units_run ON public.tender_analysis_units (analysis_run_id);

CREATE TABLE public.tender_analysis_facts (
  id uuid NOT NULL DEFAULT pg_catalog.gen_random_uuid(),
  analysis_run_id uuid NOT NULL,
  document_id uuid NOT NULL,
  analysis_unit_id text NOT NULL,
  fact_index integer NOT NULL,
  field_catalog_version text NOT NULL DEFAULT 'tender_fields_v1',
  field_key text NOT NULL,
  value_text text NOT NULL,
  extractor_status text NOT NULL,
  extractor_confidence double precision NOT NULL,
  extractor_review_reason_code text,
  extractor_review_note text,
  validator_verdict text NOT NULL,
  validator_confidence double precision NOT NULL,
  validator_reason_code text,
  validator_reason_note text,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  extractor_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  validator_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tender_analysis_facts_pkey PRIMARY KEY (id),
  CONSTRAINT tender_analysis_facts_run_fk
    FOREIGN KEY (analysis_run_id) REFERENCES public.tender_analysis_runs (id) ON DELETE CASCADE,
  CONSTRAINT tender_analysis_facts_unit_run_fk
    FOREIGN KEY (document_id, analysis_unit_id, analysis_run_id)
    REFERENCES public.tender_analysis_units (document_id, analysis_unit_id, analysis_run_id)
    ON DELETE CASCADE,
  CONSTRAINT tender_analysis_facts_unit_fact_key UNIQUE (document_id, analysis_unit_id, fact_index),
  CONSTRAINT tender_analysis_facts_fact_index_check CHECK (fact_index >= 0),
  CONSTRAINT tender_analysis_facts_extractor_confidence_check CHECK (
    extractor_confidence >= 0 AND extractor_confidence <= 1
  ),
  CONSTRAINT tender_analysis_facts_validator_confidence_check CHECK (
    validator_confidence >= 0 AND validator_confidence <= 1
  ),
  CONSTRAINT tender_analysis_facts_extractor_status_check CHECK (
    extractor_status IN ('found', 'requires_review')
  ),
  CONSTRAINT tender_analysis_facts_validator_verdict_check CHECK (
    validator_verdict IN ('confirmed', 'requires_review', 'rejected')
  ),
  CONSTRAINT tender_analysis_facts_field_key_check CHECK (
    field_key IN (
      'procurement_subject', 'nm_price_with_vat', 'platform', 'procedure_type',
      'application_deadline', 'application_review_date', 'results_date', 'customer',
      'customer_contacts', 'participation_cost', 'participation_guarantee',
      'evaluation_criteria', 'delivery_term', 'payment_terms',
      'special_account_or_treasury', 'bank_support', 'government_contract', 'rebidding',
      'national_regime', 'advance_contract_guarantee', 'warranty_obligations_guarantee',
      'licenses_certificates', 'required_official_certificates',
      'similar_supply_experience', 'analog_allowed', 'analog_definition',
      'application_documents'
    )
  )
);
CREATE INDEX idx_tender_analysis_facts_document ON public.tender_analysis_facts (document_id);
CREATE INDEX idx_tender_analysis_facts_run_field ON public.tender_analysis_facts (analysis_run_id, field_key);
CREATE INDEX idx_tender_analysis_facts_unit ON public.tender_analysis_facts (document_id, analysis_unit_id);
CREATE INDEX idx_tender_analysis_facts_verdict ON public.tender_analysis_facts (analysis_run_id, validator_verdict);

CREATE TABLE public.tender_analysis_field_results (
  analysis_run_id uuid NOT NULL,
  field_catalog_version text NOT NULL,
  result_contract_version text NOT NULL,
  field_index smallint NOT NULL,
  field_key text NOT NULL,
  status text NOT NULL,
  value_text text,
  confidence numeric,
  requires_human_review boolean NOT NULL DEFAULT false,
  resolution_method text NOT NULL,
  result_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tender_analysis_field_results_pkey PRIMARY KEY (analysis_run_id, field_key),
  CONSTRAINT tender_analysis_field_results_run_index_key UNIQUE (analysis_run_id, field_index),
  CONSTRAINT tender_analysis_field_results_field_index_check CHECK (field_index BETWEEN 1 AND 27),
  CONSTRAINT tender_analysis_field_results_confidence_check CHECK (
    confidence IS NULL OR (confidence >= 0 AND confidence <= 1)
  ),
  CONSTRAINT tender_analysis_field_results_status_check CHECK (
    status IN ('resolved', 'not_found', 'requires_review')
  )
);
CREATE UNIQUE INDEX tender_analysis_field_results_unique
  ON public.tender_analysis_field_results (analysis_run_id, field_key);
`;

const populatedCanonicalFixtureSql = String.raw`
INSERT INTO public.tender_analysis_runs (
  id, tender_id, tender_number, status, documents_total, tender_meta,
  created_at, started_at, updated_at
) VALUES (
  '10000000-0000-4000-8000-000000000001', 'fixture-tender', 'fixture-number',
  'processing', 1, '{"fixture":true}'::jsonb,
  '2026-01-01T00:00:00Z', '2026-01-01T00:00:01Z', '2026-01-01T00:00:02Z'
);
INSERT INTO public.tender_analysis_documents (
  id, analysis_run_id, document_index, file_name, status, attempts,
  created_at, updated_at
) VALUES (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001', 1, 'fixture.pdf', 'completed', 1,
  '2026-01-01T00:01:00Z', '2026-01-01T00:01:01Z'
);
INSERT INTO public.tender_analysis_units (
  id, analysis_run_id, document_id, analysis_unit_id, unit_index, units_total,
  created_at, updated_at
) VALUES (
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001', 'fixture-unit', 1, 1,
  '2026-01-01T00:02:00Z', '2026-01-01T00:02:01Z'
);
INSERT INTO public.tender_analysis_facts (
  id, analysis_run_id, document_id, analysis_unit_id, fact_index, field_key,
  value_text, extractor_status, extractor_confidence, validator_verdict,
  validator_confidence, created_at, updated_at
) VALUES (
  '40000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001', 'fixture-unit', 0, 'customer',
  'Fixture customer', 'found', 1, 'confirmed', 1,
  '2026-01-01T00:03:00Z', '2026-01-01T00:03:01Z'
);
INSERT INTO public.tender_analysis_field_results (
  analysis_run_id, field_catalog_version, result_contract_version, field_index,
  field_key, status, value_text, confidence, requires_human_review,
  resolution_method, result_json, created_at, updated_at
) VALUES (
  '10000000-0000-4000-8000-000000000001', 'tender_fields_v1',
  'tender_field_final_v1', 8, 'customer', 'resolved', 'Fixture customer', 1,
  false, 'fixture', '{"fixture":true}'::jsonb,
  '2026-01-01T00:04:00Z', '2026-01-01T00:04:01Z'
);
`;

const documentedCanonicalVariantsSql = String.raw`
ALTER TABLE public.tender_analysis_runs
  ADD COLUMN superseded_at timestamptz,
  ADD COLUMN superseded_reason text;
ALTER TABLE public.tender_analysis_runs
  DROP CONSTRAINT tender_analysis_runs_status_check;
ALTER TABLE public.tender_analysis_runs
  ADD CONSTRAINT tender_analysis_runs_status_check CHECK (
    status IN (
      'created', 'processing', 'ready_for_aggregation', 'aggregating',
      'completed', 'failed', 'superseded'
    )
  );
CREATE UNIQUE INDEX uq_tender_analysis_runs_one_unfinished
  ON public.tender_analysis_runs (source, tender_id)
  WHERE status NOT IN ('completed', 'superseded');
ALTER TABLE public.tender_analysis_documents
  ADD COLUMN ingestion_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
`;

const canonicalCatalogSnapshotSql = String.raw`
SELECT jsonb_build_object(
  'columns', (
    SELECT jsonb_agg(
      jsonb_build_array(table_name, column_name, udt_name, is_nullable, column_default)
      ORDER BY table_name, ordinal_position
    )
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN (
        'tender_analysis_runs', 'tender_analysis_documents', 'tender_analysis_units',
        'tender_analysis_facts', 'tender_analysis_field_results'
      )
  ),
  'constraints', (
    SELECT jsonb_agg(
      jsonb_build_array(table_class.relname, constraint_row.contype,
        pg_catalog.pg_get_constraintdef(constraint_row.oid, true))
      ORDER BY table_class.relname, constraint_row.contype,
        pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
    )
    FROM pg_catalog.pg_constraint AS constraint_row
    JOIN pg_catalog.pg_class AS table_class ON table_class.oid = constraint_row.conrelid
    JOIN pg_catalog.pg_namespace AS table_namespace ON table_namespace.oid = table_class.relnamespace
    WHERE table_namespace.nspname = 'public'
      AND table_class.relname IN (
        'tender_analysis_runs', 'tender_analysis_documents', 'tender_analysis_units',
        'tender_analysis_facts', 'tender_analysis_field_results'
      )
  ),
  'indexes', (
    SELECT jsonb_agg(jsonb_build_array(tablename, indexname, indexdef) ORDER BY tablename, indexname)
    FROM pg_catalog.pg_indexes
    WHERE schemaname = 'public'
      AND tablename IN (
        'tender_analysis_runs', 'tender_analysis_documents', 'tender_analysis_units',
        'tender_analysis_facts', 'tender_analysis_field_results'
      )
  )
)::text;
`;

const canonicalRowsSnapshotSql = String.raw`
SELECT jsonb_build_object(
  'runs', (SELECT coalesce(jsonb_agg(to_jsonb(row_value) ORDER BY id), '[]'::jsonb) FROM public.tender_analysis_runs AS row_value),
  'documents', (SELECT coalesce(jsonb_agg(to_jsonb(row_value) ORDER BY id), '[]'::jsonb) FROM public.tender_analysis_documents AS row_value),
  'units', (SELECT coalesce(jsonb_agg(to_jsonb(row_value) ORDER BY id), '[]'::jsonb) FROM public.tender_analysis_units AS row_value),
  'facts', (SELECT coalesce(jsonb_agg(to_jsonb(row_value) ORDER BY id), '[]'::jsonb) FROM public.tender_analysis_facts AS row_value),
  'field_results', (SELECT coalesce(jsonb_agg(to_jsonb(row_value) ORDER BY analysis_run_id, field_key), '[]'::jsonb) FROM public.tender_analysis_field_results AS row_value)
)::text;
`;

function runProcess(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    timeout: options.timeout ?? 120_000,
    input: options.input,
    env: options.env ?? process.env,
    windowsHide: true,
  });
}

function dockerIsAvailable() {
  const result = runProcess('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 10_000 });
  return result.status === 0;
}

function psqlIsAvailable() {
  const result = runProcess('psql', ['--version'], { timeout: 10_000 });
  return result.status === 0;
}

const DESTRUCTIVE_RESET_SENTINEL = 'DROP_PUBLIC_SCHEMA_FOR_AGENTIC_SHADOW_TEST_ONLY';

const PUBLIC_OBJECT_COUNTERS = [
  'tables',
  'partitionedTables',
  'views',
  'materializedViews',
  'sequences',
  'indexes',
  'partitionedIndexes',
  'foreignTables',
  'otherRelations',
  'routines',
  'types',
  'extensions',
  'extensionDependencies',
  'namespaceDependencies',
  'defaultPrivileges',
  'operators',
  'collations',
  'conversions',
  'textSearchObjects',
  'accessMethodObjects',
  'statistics',
];

function assertSafeExternalResetTarget(identity, environment) {
  if (environment.AGENTIC_TEST_ALLOW_DESTRUCTIVE_RESET !== DESTRUCTIVE_RESET_SENTINEL) {
    throw new Error('External PostgreSQL fixture requires the explicit destructive-reset sentinel');
  }

  const databaseName = String(identity?.databaseName ?? '');
  if (/(?:prod|production|stage|staging|live)/i.test(databaseName)) {
    throw new Error('External PostgreSQL fixture database name is production-like');
  }
  if (!/^agentic_shadow_test_[0-9a-f]{8,64}$/.test(databaseName)) {
    throw new Error('External PostgreSQL fixture database name does not match the strict disposable allowlist');
  }
  if (identity?.readOnly !== 'off') {
    throw new Error('External PostgreSQL fixture must be write-capable');
  }

  const publicObjects = identity?.publicObjects;
  const actualCounters = publicObjects && typeof publicObjects === 'object' && !Array.isArray(publicObjects)
    ? Object.keys(publicObjects).sort()
    : [];
  const expectedCounters = [...PUBLIC_OBJECT_COUNTERS].sort();
  if (actualCounters.length !== expectedCounters.length
      || actualCounters.some((counter, index) => counter !== expectedCounters[index])
      || PUBLIC_OBJECT_COUNTERS.some((key) => !Number.isSafeInteger(publicObjects[key]) || publicObjects[key] < 0)) {
    throw new Error('External PostgreSQL fixture public namespace inventory is invalid');
  }
  if (PUBLIC_OBJECT_COUNTERS.some((key) => publicObjects[key] !== 0)) {
    throw new Error('External PostgreSQL fixture public namespace must be empty before destructive reset');
  }
}

function assertRuntimeProviderAvailability(requiredValue, available) {
  const normalized = String(requiredValue ?? '').trim();
  if (!['', '0', '1'].includes(normalized)) {
    throw new Error('AGENTIC_REQUIRE_POSTGRES_RUNTIME must be unset, 0 or 1');
  }
  if (normalized === '1' && !available) {
    throw new Error('Required PostgreSQL runtime is unavailable');
  }
}

test('external fixture reset requires sentinel, strict disposable name and an empty public namespace', () => {
  const safeIdentity = {
    databaseName: 'agentic_shadow_test_deadbeef',
    readOnly: 'off',
    publicObjects: {
      tables: 0,
      partitionedTables: 0,
      views: 0,
      materializedViews: 0,
      sequences: 0,
      indexes: 0,
      partitionedIndexes: 0,
      foreignTables: 0,
      otherRelations: 0,
      routines: 0,
      types: 0,
      extensions: 0,
      extensionDependencies: 0,
      namespaceDependencies: 0,
      defaultPrivileges: 0,
      operators: 0,
      collations: 0,
      conversions: 0,
      textSearchObjects: 0,
      accessMethodObjects: 0,
      statistics: 0,
    },
  };
  const allowedEnvironment = { AGENTIC_TEST_ALLOW_DESTRUCTIVE_RESET: DESTRUCTIVE_RESET_SENTINEL };

  assert.throws(
    () => assertSafeExternalResetTarget(safeIdentity, {}),
    /destructive-reset sentinel/i,
  );
  for (const databaseName of [
    'agentic_shadow_test_production',
    'agentic_shadow_test_stage_deadbeef',
    'agentic_shadow_test_live_deadbeef',
    'production',
    'agentic_test',
  ]) {
    assert.throws(
      () => assertSafeExternalResetTarget({ ...safeIdentity, databaseName }, allowedEnvironment),
      /database name|production-like/i,
      databaseName,
    );
  }

  for (const [label, publicObjects] of [
    ['only view', { ...safeIdentity.publicObjects, views: 1 }],
    ['only sequence', { ...safeIdentity.publicObjects, sequences: 1 }],
    ['only public function', { ...safeIdentity.publicObjects, routines: 1 }],
  ]) {
    assert.throws(
      () => assertSafeExternalResetTarget({ ...safeIdentity, publicObjects }, allowedEnvironment),
      /public namespace.*empty/i,
      label,
    );
  }

  assert.doesNotThrow(() => assertSafeExternalResetTarget(safeIdentity, allowedEnvironment));

  const harnessSource = createDisposablePostgres.toString();
  for (const catalog of [
    'pg_catalog.pg_class',
    'pg_catalog.pg_proc',
    'pg_catalog.pg_type',
    'pg_catalog.pg_extension',
    'pg_catalog.pg_default_acl',
    'pg_catalog.pg_operator',
    'pg_catalog.pg_collation',
    'pg_catalog.pg_conversion',
    'pg_catalog.pg_ts_config',
    'pg_catalog.pg_opclass',
    'pg_catalog.pg_statistic_ext',
  ]) {
    assert.match(harnessSource, new RegExp(escapeRegExp(catalog)), `${catalog} must be covered before reset`);
  }
  assert.match(assertSafeExternalResetTarget.toString(), /AGENTIC_TEST_ALLOW_DESTRUCTIVE_RESET/);
});

test('required PostgreSQL runtime mode fails instead of silently skipping', () => {
  assert.throws(
    () => assertRuntimeProviderAvailability('1', false),
    /required.*PostgreSQL runtime.*unavailable/i,
  );
  assert.doesNotThrow(() => assertRuntimeProviderAvailability('1', true));
  assert.doesNotThrow(() => assertRuntimeProviderAvailability('0', false));
  assert.throws(() => assertRuntimeProviderAvailability('yes', false), /AGENTIC_REQUIRE_POSTGRES_RUNTIME/i);
  assert.match(createDisposablePostgres.toString(), /AGENTIC_REQUIRE_POSTGRES_RUNTIME/);
});

function assertProcessOk(result, label) {
  assert.equal(
    result.status,
    0,
    `${label} failed (exit ${result.status}): ${String(result.stderr || result.stdout).trim()}`,
  );
  return String(result.stdout).trim();
}

async function createDisposablePostgres(t) {
  const suppliedUrl = process.env.AGENTIC_TEST_POSTGRES_URL?.trim();
  const requiredRuntime = process.env.AGENTIC_REQUIRE_POSTGRES_RUNTIME;
  assertRuntimeProviderAvailability(requiredRuntime, true);

  if (suppliedUrl) {
    const hasPsql = psqlIsAvailable();
    assertRuntimeProviderAvailability(requiredRuntime, hasPsql);
    assert.ok(hasPsql, 'AGENTIC_TEST_POSTGRES_URL was supplied, but psql is unavailable');
    const env = { ...process.env, PGDATABASE: suppliedUrl, PGCONNECT_TIMEOUT: '10' };
    const identityParts = assertProcessOk(
      runProcess('psql', ['--no-psqlrc', '-v', 'ON_ERROR_STOP=1', '-At', '-c',
        String.raw`
          WITH public_namespace AS (
            SELECT namespace_row.oid
            FROM pg_catalog.pg_namespace AS namespace_row
            WHERE namespace_row.nspname = 'public'
          )
          SELECT
            current_database(),
            current_setting('transaction_read_only'),
            pg_catalog.jsonb_build_object(
              'tables', (SELECT count(*) FROM pg_catalog.pg_class AS object_row WHERE object_row.relnamespace = public_namespace.oid AND object_row.relkind = 'r'),
              'partitionedTables', (SELECT count(*) FROM pg_catalog.pg_class AS object_row WHERE object_row.relnamespace = public_namespace.oid AND object_row.relkind = 'p'),
              'views', (SELECT count(*) FROM pg_catalog.pg_class AS object_row WHERE object_row.relnamespace = public_namespace.oid AND object_row.relkind = 'v'),
              'materializedViews', (SELECT count(*) FROM pg_catalog.pg_class AS object_row WHERE object_row.relnamespace = public_namespace.oid AND object_row.relkind = 'm'),
              'sequences', (SELECT count(*) FROM pg_catalog.pg_class AS object_row WHERE object_row.relnamespace = public_namespace.oid AND object_row.relkind = 'S'),
              'indexes', (SELECT count(*) FROM pg_catalog.pg_class AS object_row WHERE object_row.relnamespace = public_namespace.oid AND object_row.relkind = 'i'),
              'partitionedIndexes', (SELECT count(*) FROM pg_catalog.pg_class AS object_row WHERE object_row.relnamespace = public_namespace.oid AND object_row.relkind = 'I'),
              'foreignTables', (SELECT count(*) FROM pg_catalog.pg_class AS object_row WHERE object_row.relnamespace = public_namespace.oid AND object_row.relkind = 'f'),
              'otherRelations', (SELECT count(*) FROM pg_catalog.pg_class AS object_row WHERE object_row.relnamespace = public_namespace.oid AND object_row.relkind NOT IN ('r', 'p', 'v', 'm', 'S', 'i', 'I', 'f')),
              'routines', (SELECT count(*) FROM pg_catalog.pg_proc AS object_row WHERE object_row.pronamespace = public_namespace.oid),
              'types', (SELECT count(*) FROM pg_catalog.pg_type AS object_row WHERE object_row.typnamespace = public_namespace.oid),
              'extensions', (SELECT count(*) FROM pg_catalog.pg_extension AS object_row WHERE object_row.extnamespace = public_namespace.oid),
              'extensionDependencies', (
                SELECT count(*)
                FROM pg_catalog.pg_depend AS dependency_row
                JOIN pg_catalog.pg_extension AS extension_row
                  ON extension_row.oid = dependency_row.refobjid
                 AND dependency_row.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
                 AND dependency_row.deptype = 'e'
                WHERE extension_row.extnamespace = public_namespace.oid
              ),
              'namespaceDependencies', (
                SELECT count(*)
                FROM pg_catalog.pg_depend AS dependency_row
                WHERE dependency_row.refclassid = 'pg_catalog.pg_namespace'::pg_catalog.regclass
                  AND dependency_row.refobjid = public_namespace.oid
              ),
              'defaultPrivileges', (SELECT count(*) FROM pg_catalog.pg_default_acl AS object_row WHERE object_row.defaclnamespace = public_namespace.oid),
              'operators', (SELECT count(*) FROM pg_catalog.pg_operator AS object_row WHERE object_row.oprnamespace = public_namespace.oid),
              'collations', (SELECT count(*) FROM pg_catalog.pg_collation AS object_row WHERE object_row.collnamespace = public_namespace.oid),
              'conversions', (SELECT count(*) FROM pg_catalog.pg_conversion AS object_row WHERE object_row.connamespace = public_namespace.oid),
              'textSearchObjects',
                (SELECT count(*) FROM pg_catalog.pg_ts_config AS object_row WHERE object_row.cfgnamespace = public_namespace.oid)
                + (SELECT count(*) FROM pg_catalog.pg_ts_dict AS object_row WHERE object_row.dictnamespace = public_namespace.oid)
                + (SELECT count(*) FROM pg_catalog.pg_ts_parser AS object_row WHERE object_row.prsnamespace = public_namespace.oid)
                + (SELECT count(*) FROM pg_catalog.pg_ts_template AS object_row WHERE object_row.tmplnamespace = public_namespace.oid),
              'accessMethodObjects',
                (SELECT count(*) FROM pg_catalog.pg_opclass AS object_row WHERE object_row.opcnamespace = public_namespace.oid)
                + (SELECT count(*) FROM pg_catalog.pg_opfamily AS object_row WHERE object_row.opfnamespace = public_namespace.oid),
              'statistics', (SELECT count(*) FROM pg_catalog.pg_statistic_ext AS object_row WHERE object_row.stxnamespace = public_namespace.oid)
            )::text
          FROM public_namespace;
        `], { env }),
      'disposable PostgreSQL identity preflight',
    ).split('|');
    if (identityParts.length !== 3) throw new Error('Disposable PostgreSQL identity preflight returned an invalid shape');
    let publicObjects;
    try {
      publicObjects = JSON.parse(identityParts[2]);
    } catch {
      throw new Error('Disposable PostgreSQL identity preflight returned an invalid object inventory');
    }
    assertSafeExternalResetTarget({
      databaseName: identityParts[0],
      readOnly: identityParts[1],
      publicObjects,
    }, process.env);
    return {
      runSql(sql, { expectFailure = false } = {}) {
        const result = runProcess(
          'psql', ['--no-psqlrc', '-v', 'ON_ERROR_STOP=1', '-At', '-X', '-q'],
          { env, input: sql },
        );
        if (!expectFailure) assertProcessOk(result, 'psql fixture command');
        return result;
      },
      reset() {
        assertProcessOk(
          runProcess('psql', ['--no-psqlrc', '-v', 'ON_ERROR_STOP=1', '-At', '-X', '-q'], {
            env,
            input: 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;\n',
          }),
          'reset disposable PostgreSQL schema',
        );
      },
      close() {},
    };
  }

  if (!dockerIsAvailable()) {
    assertRuntimeProviderAvailability(requiredRuntime, false);
    t.skip('PostgreSQL runtime SKIP: set AGENTIC_TEST_POSTGRES_URL with psql, or start Docker');
    return null;
  }
  assertRuntimeProviderAvailability(requiredRuntime, true);

  const containerName = `agentic-migration-${randomUUID()}`;
  const start = runProcess('docker', [
    'run', '--detach', '--rm', '--name', containerName, '--network', 'none',
    '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', '--env', 'POSTGRES_DB=agentic_test',
    'postgres:17-alpine',
  ], { timeout: 180_000 });
  assertProcessOk(start, 'start disposable PostgreSQL container');

  const dockerSql = (sql, { expectFailure = false } = {}) => {
    const result = runProcess(
      'docker', ['exec', '--interactive', containerName, 'psql', '--no-psqlrc',
        '-v', 'ON_ERROR_STOP=1', '-At', '-X', '-q', '-U', 'postgres', '-d', 'agentic_test'],
      { input: sql },
    );
    if (!expectFailure) assertProcessOk(result, 'Docker PostgreSQL fixture command');
    return result;
  };

  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = runProcess('docker', [
      'exec', containerName, 'pg_isready', '-U', 'postgres', '-d', 'agentic_test',
    ], { timeout: 5_000 });
    if (result.status === 0) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) {
    runProcess('docker', ['rm', '--force', containerName], { timeout: 30_000 });
    assert.fail('disposable PostgreSQL container did not become ready');
  }

  return {
    runSql: dockerSql,
    reset() {
      dockerSql('DROP SCHEMA public CASCADE; CREATE SCHEMA public;\n');
    },
    close() {
      runProcess('docker', ['rm', '--force', containerName], { timeout: 30_000 });
    },
  };
}

test('real PostgreSQL applies empty, populated and documented-variant fixtures twice and rejects representative drift', { timeout: 300_000 }, async (t) => {
  const postgres = await createDisposablePostgres(t);
  if (!postgres) return;

  const migrationSql = await readFile(migrationUrl, 'utf8');
  try {
    for (const fixture of [
      { name: 'empty', seed: '' },
      { name: 'populated', seed: populatedCanonicalFixtureSql },
      { name: 'documented intake/archive variants', seed: documentedCanonicalVariantsSql },
    ]) {
      postgres.reset();
      postgres.runSql(canonicalFixtureSql);
      if (fixture.seed) postgres.runSql(fixture.seed);
      const catalogBefore = assertProcessOk(postgres.runSql(canonicalCatalogSnapshotSql), `${fixture.name} catalog before`);
      const rowsBefore = assertProcessOk(postgres.runSql(canonicalRowsSnapshotSql), `${fixture.name} rows before`);

      postgres.runSql(migrationSql);
      postgres.runSql(migrationSql);

      const catalogAfter = assertProcessOk(postgres.runSql(canonicalCatalogSnapshotSql), `${fixture.name} catalog after`);
      const rowsAfter = assertProcessOk(postgres.runSql(canonicalRowsSnapshotSql), `${fixture.name} rows after`);
      assert.equal(catalogAfter, catalogBefore, `${fixture.name}: canonical catalog changed`);
      assert.equal(rowsAfter, rowsBefore, `${fixture.name}: canonical rows changed`);
      assert.equal(
        assertProcessOk(postgres.runSql(String.raw`
          SELECT
            (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='tender_agentic_jobs'),
            (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='tender_agentic_documents'),
            (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='tender_agentic_field_results'),
            (SELECT count(*) FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_class t ON t.oid=c.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname='tender_agentic_jobs'),
            (SELECT count(*) FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_class t ON t.oid=c.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname='tender_agentic_documents'),
            (SELECT count(*) FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_class t ON t.oid=c.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname='tender_agentic_field_results'),
            (SELECT count(*) FROM pg_catalog.pg_indexes WHERE schemaname='public' AND indexname LIKE 'idx_tender_agentic_jobs_%');
        `)),
        '29|16|14|10|6|8|3',
        `${fixture.name}: shadow catalog counts differ`,
      );
    }

    postgres.reset();
    postgres.runSql(canonicalFixtureSql);
    postgres.runSql(populatedCanonicalFixtureSql);
    postgres.runSql(String.raw`
      INSERT INTO public.tender_analysis_runs (id, tender_id)
      VALUES ('10000000-0000-4000-8000-000000000002', 'fixture-tender-2');
      INSERT INTO public.tender_analysis_documents (id, analysis_run_id, document_index)
      VALUES (
        '20000000-0000-4000-8000-000000000002',
        '10000000-0000-4000-8000-000000000002',
        1
      );
    `);
    postgres.runSql(migrationSql);
    postgres.runSql(String.raw`
      INSERT INTO public.tender_agentic_jobs (
        id, analysis_run_id, pipeline_version, model, reasoning_effort,
        field_catalog_version, field_catalog_sha256, expected_documents
      ) VALUES (
        '50000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',
        'tender_agentic_pipeline_v1', 'fixture-model', 'high',
        'tender_fields_v1', 'fixture-catalog-hash', 1
      );
    `);

    for (const ownershipViolation of [
      {
        name: 'document source from a different canonical run',
        sql: String.raw`
          INSERT INTO public.tender_agentic_documents (
            job_id, analysis_run_id, source_document_id, artifact_key, document_index
          ) VALUES (
            '50000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001',
            '20000000-0000-4000-8000-000000000002', 'cross-source-run', 1
          );
        `,
        constraint: /tender_agentic_documents_source_document_run_fk/i,
      },
      {
        name: 'document job from a different analysis run',
        sql: String.raw`
          INSERT INTO public.tender_agentic_documents (
            job_id, analysis_run_id, source_document_id, artifact_key, document_index
          ) VALUES (
            '50000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000002',
            '20000000-0000-4000-8000-000000000002', 'cross-job-run', 1
          );
        `,
        constraint: /tender_agentic_documents_job_run_fk/i,
      },
      {
        name: 'field result from a different analysis run',
        sql: String.raw`
          INSERT INTO public.tender_agentic_field_results (
            job_id, analysis_run_id, field_catalog_version, field_index, field_key,
            reported_status, effective_status, requires_human_review,
            validation_level, result_json
          ) VALUES (
            '50000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000002', 'tender_fields_v1',
            1, 'procurement_subject', 'not_found', 'not_found', false, 'pass', '{}'::jsonb
          );
        `,
        constraint: /tender_agentic_field_results_job_run_catalog_fk/i,
      },
      {
        name: 'field result from a different field catalog',
        sql: String.raw`
          INSERT INTO public.tender_agentic_field_results (
            job_id, analysis_run_id, field_catalog_version, field_index, field_key,
            reported_status, effective_status, requires_human_review,
            validation_level, result_json
          ) VALUES (
            '50000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001', 'tender_fields_v2',
            1, 'procurement_subject', 'not_found', 'not_found', false, 'pass', '{}'::jsonb
          );
        `,
        constraint: /tender_agentic_field_results_job_run_catalog_fk/i,
      },
    ]) {
      const rejected = postgres.runSql(ownershipViolation.sql, { expectFailure: true });
      assert.notEqual(rejected.status, 0, `${ownershipViolation.name}: insert unexpectedly succeeded`);
      assert.match(String(rejected.stderr), ownershipViolation.constraint, `${ownershipViolation.name}: wrong FK rejection`);
    }

    for (const drift of [
      {
        name: 'altered default',
        sql: "ALTER TABLE public.tender_analysis_runs ALTER COLUMN status SET DEFAULT 'processing';",
        error: /canonical default contract/i,
      },
      {
        name: 'removed facts 27-key CHECK',
        sql: 'ALTER TABLE public.tender_analysis_facts DROP CONSTRAINT tender_analysis_facts_field_key_check;',
        error: /canonical check contract/i,
      },
      {
        name: 'changed documents to runs FK action',
        sql: String.raw`
          ALTER TABLE public.tender_analysis_documents DROP CONSTRAINT tender_analysis_documents_analysis_run_fk;
          ALTER TABLE public.tender_analysis_documents ADD CONSTRAINT tender_analysis_documents_analysis_run_fk
            FOREIGN KEY (analysis_run_id) REFERENCES public.tender_analysis_runs (id) ON DELETE SET NULL;
        `,
        error: /canonical foreign key contract/i,
      },
      {
        name: 'removed document unique key',
        sql: 'ALTER TABLE public.tender_analysis_documents DROP CONSTRAINT tender_analysis_documents_run_index_key;',
        error: /canonical unique contract/i,
      },
      {
        name: 'removed expected facts index',
        sql: 'DROP INDEX public.idx_tender_analysis_facts_run_field;',
        error: /canonical index contract/i,
      },
    ]) {
      postgres.reset();
      postgres.runSql(canonicalFixtureSql);
      postgres.runSql(drift.sql);
      const failed = postgres.runSql(migrationSql, { expectFailure: true });
      assert.notEqual(failed.status, 0, `${drift.name}: migration unexpectedly succeeded`);
      assert.match(String(failed.stderr), drift.error, `${drift.name}: wrong fail-closed reason`);
      assert.equal(
        assertProcessOk(postgres.runSql(String.raw`
          SELECT count(*) FROM pg_catalog.pg_class AS table_class
          JOIN pg_catalog.pg_namespace AS table_namespace ON table_namespace.oid=table_class.relnamespace
          WHERE table_namespace.nspname='public'
            AND table_class.relname IN ('tender_agentic_jobs','tender_agentic_documents','tender_agentic_field_results');
        `)),
        '0',
        `${drift.name}: failed migration left a shadow table behind`,
      );
    }
  } finally {
    try {
      postgres.reset();
    } finally {
      postgres.close();
    }
  }
});
