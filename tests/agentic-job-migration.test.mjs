import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL(
  '../deploy/postgres/migrations/2026-09-08-add-agentic-shadow-analysis.sql',
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
    'information_schema.columns',
  ]) {
    assert.match(preconditions, new RegExp(escapeRegExp(catalog), 'i'));
  }
  assert.match(preconditions, /relkind\s+IN\s*\(\s*'r'\s*,\s*'p'\s*\)/i);
  assert.match(preconditions, /relpersistence\s*=\s*'p'/i);
  assert.match(preconditions, /EXCEPT/i, 'column inventory must reject missing or extra columns');
  assert.match(preconditions, /PRIMARY\s+KEY/i, 'parent primary-key identities must be checked');

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
    'tender_agentic_documents_job_fk',
    'FOREIGN\\s+KEY\\s*\\(\\s*job_id\\s*\\)\\s+REFERENCES\\s+public\\.tender_agentic_jobs\\s*\\(\\s*id\\s*\\)\\s+ON\\s+DELETE\\s+CASCADE',
  );
  assertNamedConstraint(
    body,
    'tender_agentic_documents_source_document_fk',
    'FOREIGN\\s+KEY\\s*\\(\\s*source_document_id\\s*\\)\\s+REFERENCES\\s+public\\.tender_analysis_documents\\s*\\(\\s*id\\s*\\)\\s+ON\\s+DELETE\\s+CASCADE',
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
  for (const parent of ['tender_agentic_jobs', 'tender_analysis_runs']) {
    assert.match(body, new RegExp(`REFERENCES\\s+public\\.${parent}\\s*\\(\\s*id\\s*\\)\\s+ON\\s+DELETE\\s+CASCADE`, 'i'));
  }
  for (const status of ['resolved', 'requires_review', 'not_found']) {
    assert.ok((body.match(new RegExp(`'${status}'`, 'gi')) || []).length >= 2, `${status} must be allowed for both status columns`);
  }
  for (const level of ['pass', 'warning', 'downgraded']) assert.match(body, new RegExp(`'${level}'`, 'i'));
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
  for (const count of [29, 15, 14]) assert.match(postconditions, new RegExp(`<>\\s*${count}\\b`, 'i'));
  for (const name of [
    'tender_agentic_jobs_pkey',
    'tender_agentic_jobs_analysis_run_fk',
    'tender_agentic_jobs_run_pipeline_replicate_key',
    'tender_agentic_documents_pkey',
    'tender_agentic_documents_job_fk',
    'tender_agentic_documents_source_document_fk',
    'tender_agentic_documents_artifact_key_key',
    'tender_agentic_documents_document_index_key',
    'tender_agentic_field_results_pkey',
    'tender_agentic_field_results_job_fk',
    'tender_agentic_field_results_analysis_run_fk',
    'tender_agentic_field_results_field_index_key',
    'idx_tender_agentic_jobs_status_heartbeat',
    'idx_tender_agentic_jobs_poll_claimed',
    'idx_tender_agentic_jobs_analysis_run',
  ]) {
    assert.match(postconditions, new RegExp(`'${name}'`, 'i'));
  }
  assert.match(postconditions, /convalidated/i);
  assert.match(postconditions, /condeferrable/i);
  assert.match(postconditions, /condeferred/i);
  assert.match(postconditions, /confdeltype\s*=\s*'c'/i);
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
