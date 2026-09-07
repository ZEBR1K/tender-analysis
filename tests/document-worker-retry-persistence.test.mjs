import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const persistenceNodeName = 'Сохранить факты документа';
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const workflowPaths = [
  path.join(
    testDirectory,
    '..',
    'workflows',
    'n8n-exports',
    'TENDER — Обработать документ.json',
  ),
  path.join(
    testDirectory,
    '..',
    'workflows',
    'n8n-exports',
    'beta',
    '[DW-23 TEST CODEX] TENDER — Обработать документ.json',
  ),
];

function loadPersistenceNode(workflowPath) {
  const { nodes } = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
  const matches = nodes.filter(({ name }) => name === persistenceNodeName);
  assert.equal(
    matches.length,
    1,
    `Expected exactly one ${persistenceNodeName} node in ${path.basename(workflowPath)}`,
  );
  return matches[0];
}

function cteBody(sql, cteName) {
  const match = sql.match(
    new RegExp(`${cteName}\\s+AS\\s*\\(([\\s\\S]*?)\\n\\)`, 'u'),
  );
  assert.ok(match, `Missing ${cteName} CTE`);
  return match[1];
}

function assertRunAndDocumentScope(deleteBody, alias, description) {
  assert.match(
    deleteBody,
    new RegExp(`${alias}\\.analysis_run_id\\s*=\\s*\\$1::uuid`, 'iu'),
  );
  assert.match(
    deleteBody,
    new RegExp(`${alias}\\.document_id\\s*=\\s*\\$2::uuid`, 'iu'),
    `${description} must be scoped by document_id and reject a broad run-only DELETE`,
  );
}

test('Document Worker retry persistence removes only facts and units stale for the current document', () => {
  const persistenceNodes = workflowPaths.map(loadPersistenceNode);
  assert.deepEqual(
    persistenceNodes.map(({ name }) => name),
    [persistenceNodeName, persistenceNodeName],
    'This feature test inspects only the named persistence node and prescribes no workflow topology',
  );

  const [canonicalSql, betaSql] = persistenceNodes.map(
    ({ parameters }) => parameters.query,
  );
  assert.equal(canonicalSql, betaSql, 'Canonical and beta persistence SQL must match');

  const currentUnitIds = cteBody(canonicalSql, 'current_unit_ids');
  assert.match(
    currentUnitIds,
    /SELECT\s+jsonb_array_elements_text\s*\(\s*COALESCE\s*\(\s*\$6::jsonb\s*->\s*'analysis_unit_ids'\s*,\s*'\[\]'::jsonb\s*\)\s*\)\s+AS\s+analysis_unit_id/iu,
  );

  const deletedStaleFacts = cteBody(canonicalSql, 'deleted_stale_facts');
  assert.match(
    deletedStaleFacts,
    /DELETE\s+FROM\s+tender_analysis_facts\s+AS\s+f/iu,
  );
  assertRunAndDocumentScope(deletedStaleFacts, 'f', 'Stale-fact DELETE');
  assert.match(
    deletedStaleFacts,
    /EXISTS\s*\([\s\S]*?FROM\s+current_unit_ids\s+AS\s+c[\s\S]*?c\.analysis_unit_id\s*=\s*f\.analysis_unit_id[\s\S]*?\)/iu,
  );
  assert.match(
    deletedStaleFacts,
    /NOT\s+EXISTS\s*\([\s\S]*?FROM\s+input_facts\s+AS\s+i[\s\S]*?i\.analysis_unit_id\s*=\s*f\.analysis_unit_id[\s\S]*?i\.fact_index\s*=\s*f\.fact_index[\s\S]*?\)/iu,
  );

  const deletedStaleUnits = cteBody(canonicalSql, 'deleted_stale_units');
  assert.match(
    deletedStaleUnits,
    /DELETE\s+FROM\s+tender_analysis_units\s+AS\s+u/iu,
  );
  assertRunAndDocumentScope(deletedStaleUnits, 'u', 'Stale-unit DELETE');
  assert.match(
    deletedStaleUnits,
    /NOT\s+EXISTS\s*\([\s\S]*?FROM\s+current_unit_ids\s+AS\s+c[\s\S]*?c\.analysis_unit_id\s*=\s*u\.analysis_unit_id[\s\S]*?\)/iu,
  );

  const finalSelectStart = canonicalSql.lastIndexOf('\nSELECT');
  assert.notEqual(finalSelectStart, -1, 'Missing final SELECT');
  const finalSelect = canonicalSql.slice(finalSelectStart);
  assert.match(
    finalSelect,
    /\(\s*SELECT\s+count\(\*\)::integer\s+FROM\s+deleted_stale_units\s*\)\s+AS\s+deleted_stale_units_count/iu,
  );

  const inputFacts = cteBody(canonicalSql, 'input_facts');
  assert.match(
    inputFacts,
    /FROM\s+jsonb_array_elements\s*\(\s*\$3::jsonb\s*\)\s+AS\s+f/iu,
  );
  assert.doesNotMatch(
    inputFacts,
    /\bWHERE\b[\s\S]*?(?:extractor_status|validator_verdict)/iu,
    'input_facts must preserve all statuses from $3::jsonb for audit',
  );

  const savedFacts = cteBody(canonicalSql, 'saved_facts');
  assert.match(savedFacts, /INSERT\s+INTO\s+tender_analysis_facts/iu);
  assert.match(savedFacts, /FROM\s+input_facts/iu);
  assert.match(
    savedFacts,
    /ON\s+CONFLICT\s*\(\s*document_id\s*,\s*analysis_unit_id\s*,\s*fact_index\s*\)\s*DO\s+UPDATE\s+SET/iu,
  );
});
