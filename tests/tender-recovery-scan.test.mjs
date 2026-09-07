import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const workflowExportPath = path.resolve(
  testDirectory,
  '..',
  'workflows',
  'n8n-exports',
  'TENDER — Recovery Scan.json',
);

const expectedQuery = `SELECT DISTINCT run.id AS analysis_run_id
FROM tender_analysis_runs AS run
LEFT JOIN tender_analysis_documents AS document
  ON document.analysis_run_id = run.id
WHERE run.status <> 'completed'
  AND (
    document.status = 'pending'
    OR (document.status = 'failed' AND document.attempts < 2)
    OR (
      document.status = 'processing'
      AND document.started_at <= now() - interval '1 hour'
    )
    OR run.status IN ('ready_for_aggregation', 'aggregating')
    OR (
      run.status = 'processing'
      AND EXISTS (
        SELECT 1
        FROM tender_analysis_documents AS any_document
        WHERE any_document.analysis_run_id = run.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM tender_analysis_documents AS nonterminal_document
        WHERE nonterminal_document.analysis_run_id = run.id
          AND nonterminal_document.status NOT IN ('completed', 'skipped')
      )
    )
  );`;

function requireNode(workflow, name) {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(node, `missing node: ${name}`);
  return node;
}

test('recovery scan selects retryable runs and delegates each run to Intake Resume', () => {
  assert.ok(
    fs.existsSync(workflowExportPath),
    'TENDER — Recovery Scan workflow export is absent',
  );

  const workflow = JSON.parse(fs.readFileSync(workflowExportPath, 'utf8'));
  assert.equal(workflow.name, 'TENDER — Recovery Scan');
  assert.equal(workflow.active, false);
  assert.equal(workflow.settings?.executionOrder, 'v1');
  assert.equal(workflow.settings?.availableInMCP, false);
  assert.equal(
    Object.hasOwn(workflow.settings ?? {}, 'errorWorkflow'),
    false,
    'repository export must not hardcode a live error workflow ID',
  );

  const scheduleNodes = workflow.nodes.filter(
    (node) => node.type === 'n8n-nodes-base.scheduleTrigger',
  );
  assert.equal(scheduleNodes.length, 1);
  const schedule = scheduleNodes[0];
  assert.equal(schedule.typeVersion, 1.3);
  assert.deepEqual(schedule.parameters, {
    rule: {
      interval: [{ field: 'minutes', minutesInterval: 10 }],
    },
  });

  const postgresNodes = workflow.nodes.filter(
    (node) => node.type === 'n8n-nodes-base.postgres',
  );
  assert.equal(postgresNodes.length, 1);
  const candidates = requireNode(workflow, 'Select Recovery Candidates');
  assert.equal(candidates.typeVersion, 2.6);
  assert.equal(candidates.parameters.operation, 'executeQuery');
  assert.equal(candidates.parameters.query.trim(), expectedQuery);
  assert.deepEqual(candidates.parameters.options, {});
  assert.deepEqual(candidates.credentials, {
    postgres: {
      id: 'RFpUr3McElcwyoxy',
      name: 'KITATEH Tenders',
    },
  });

  const sql = candidates.parameters.query;
  assert.doesNotMatch(
    sql,
    /\b(?:insert|update|delete|truncate|alter|create|drop)\b/iu,
    'Recovery Scan candidate query must remain read-only',
  );
  assert.match(sql, /run\.status <> 'completed'/u);
  assert.match(sql, /document\.status = 'pending'/u);
  assert.match(sql, /document\.status = 'failed' AND document\.attempts < 2/u);
  assert.match(sql, /document\.started_at <= now\(\) - interval '1 hour'/u);
  assert.match(sql, /run\.status IN \('ready_for_aggregation', 'aggregating'\)/u);
  assert.match(sql, /NOT EXISTS \([\s\S]*status NOT IN \('completed', 'skipped'\)/u);

  const dispatcherNodes = workflow.nodes.filter(
    (node) => node.type === 'n8n-nodes-base.executeWorkflow',
  );
  assert.equal(dispatcherNodes.length, 1);
  const dispatcher = requireNode(workflow, 'Execute TENDER — Intake Resume');
  assert.equal(dispatcher.typeVersion, 1.3);
  assert.equal(dispatcher.parameters.mode, 'each');
  assert.equal(dispatcher.parameters.source, 'database');
  assert.deepEqual(dispatcher.parameters.workflowId, {
    __rl: true,
    value: '',
    mode: 'list',
    cachedResultName: 'TENDER — Intake Resume',
  });
  assert.equal(dispatcher.parameters.options.waitForSubWorkflow, false);
  assert.deepEqual(
    Object.keys(dispatcher.parameters.workflowInputs.value).sort(),
    ['analysis_run_id', 'manual_override', 'source_event_key', 'trigger_kind'],
  );
  assert.equal(
    dispatcher.parameters.workflowInputs.value.analysis_run_id,
    '={{ $json.analysis_run_id }}',
  );
  assert.equal(
    dispatcher.parameters.workflowInputs.value.trigger_kind,
    'recovery_scan',
  );
  assert.equal(
    dispatcher.parameters.workflowInputs.value.manual_override,
    false,
  );
  const sourceEventKey = dispatcher.parameters.workflowInputs.value.source_event_key;
  assert.equal(
    sourceEventKey,
    "={{ 'recovery:' + $execution.id + ':' + $json.analysis_run_id }}",
  );

  assert.deepEqual(workflow.connections, {
    [schedule.name]: {
      main: [[{
        node: candidates.name,
        type: 'main',
        index: 0,
      }]],
    },
    [candidates.name]: {
      main: [[{
        node: dispatcher.name,
        type: 'main',
        index: 0,
      }]],
    },
  });

  const prohibitedTargets = /Orchestrator|Обработать документ|Агрегац|Финализац/iu;
  const executableNodeNames = workflow.nodes
    .filter((node) => node.type !== 'n8n-nodes-base.stickyNote')
    .map((node) => node.name)
    .join('\n');
  assert.doesNotMatch(executableNodeNames, prohibitedTargets);

  const packagingNotes = workflow.nodes
    .filter((node) => node.type === 'n8n-nodes-base.stickyNote')
    .map((node) => node.parameters?.content ?? '')
    .join('\n');
  assert.match(packagingNotes, /PACKAGING REQUIRED/u);
  assert.match(packagingNotes, /TENDER — Ошибка Intake Resume/u);
  assert.match(packagingNotes, /settings\.errorWorkflow/u);
  assert.match(packagingNotes, /inactive/u);
});
