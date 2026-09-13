import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { executeCodeNode } from './helpers/n8n-code-node-runner.mjs';

const workflow = JSON.parse(readFileSync(new URL(
  '../workflows/n8n-exports/beta/[INACTIVE] TENDER — TenderPlan Saved Key Intake.json',
  import.meta.url,
), 'utf8').replace(/^\uFEFF/u, ''));
const fixture = JSON.parse(readFileSync(new URL(
  './fixtures/tenderplan-saved-key-intake/pages.json',
  import.meta.url,
), 'utf8'));
const nodesByName = new Map(workflow.nodes.map((node) => [node.name, node]));

function requireNode(currentWorkflow, name) {
  const node = currentWorkflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(node, `missing ${name}`);
  return node;
}

function directTargets(currentWorkflow, name, outputIndex = 0) {
  return (currentWorkflow.connections?.[name]?.main?.[outputIndex] ?? [])
    .map((connection) => connection.node);
}

function canReach(currentWorkflow, startName, targetName) {
  const queue = [startName];
  const visited = new Set();
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === targetName) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const output of currentWorkflow.connections?.[current]?.main ?? []) {
      for (const connection of output ?? []) queue.push(connection.node);
    }
  }
  return false;
}

test('workflow contains the bounded sequential polling topology', () => {
  const requiredNodes = [
    'Manual Trigger',
    'Every 10 Minutes',
    'Define Saved Keys',
    'Loop Over Saved Keys',
    'Load Baseline State',
    'Validate Baseline State',
    'Get Complete Saved Key Pages',
    'Normalize Complete Page Set',
    'Initialize Baseline',
    'Load Existing Event States',
    'Build Dispatch Queue',
    'Execute TENDER — Intake Resume',
    'Assert Poll Completed',
  ];
  for (const name of requiredNodes) assert.ok(nodesByName.has(name), `missing ${name}`);
  assert.equal(nodesByName.get('Every 10 Minutes').parameters.rule.interval[0].minutesInterval, 10);
  assert.equal(nodesByName.get('Loop Over Saved Keys').parameters.batchSize, 1);
  assert.equal(nodesByName.get('Execute TENDER — Intake Resume').parameters.options.waitForSubWorkflow, false);
  assert.equal(workflow.settings.executionOrder, 'v1');
  assert.equal(workflow.settings.timezone, 'Europe/Moscow');
  assert.equal(workflow.settings.errorWorkflow, 'kff8KIrSHzo5Mmt1');
});

test('complete page set is deduplicated and requires a final empty page', async () => {
  const node = requireNode(workflow, 'Normalize Complete Page Set');
  const key = {
    saved_key_id: fixture.keys[0].saved_key_id,
    saved_key_name: fixture.keys[0].name,
    baseline_exists: true,
  };
  const globals = {
    $: (name) => {
      assert.equal(name, 'Validate Baseline State');
      return { first: () => ({ json: structuredClone(key) }) };
    },
  };
  const result = await executeCodeNode(node, fixture.completePages, globals);
  assert.deepEqual(result[0].json.tender_ids, fixture.expectedTenderIds);
  assert.equal(result[0].json.page_count, fixture.completePages.length);

  await assert.rejects(
    executeCodeNode(node, fixture.completePages.slice(0, -1), globals),
    /TENDERPLAN_PAGINATION_INCOMPLETE/u,
  );
  const malformed = structuredClone(fixture.completePages);
  malformed[0].tenders[0]._id = 'invalid';
  await assert.rejects(
    executeCodeNode(node, malformed, globals),
    /TENDERPLAN_TENDER_ID_INVALID/u,
  );
});

test('queue suppresses processing/completed and dispatches failed/missing', async () => {
  const node = requireNode(workflow, 'Build Dispatch Queue');
  const result = await executeCodeNode(node, [{
    saved_key_id: fixture.keys[0].saved_key_id,
    saved_key_name: fixture.keys[0].name,
    observed_at: '2026-09-13T10:00:00.000Z',
    event_states: fixture.existingStates,
  }]);
  const dispatched = result.map((item) => item.json.tender_id);
  assert.deepEqual(dispatched, fixture.expectedDispatchTenderIds);
  for (const item of result) {
    assert.equal(item.json.trigger_kind, 'tenderplan_key');
    assert.equal(item.json.manual_override, false);
    assert.equal(item.json.analysis_run_id, '');
    assert.match(
      item.json.source_event_key,
      new RegExp(`^tenderplan:key:${fixture.keys[0].saved_key_id}:tender:`, 'u'),
    );
  }
});

test('the same tender under two keys receives distinct event keys', async () => {
  const node = requireNode(workflow, 'Build Dispatch Queue');
  const outputs = [];
  for (const key of fixture.keys) {
    const result = await executeCodeNode(node, [{
      saved_key_id: key.saved_key_id,
      saved_key_name: key.name,
      observed_at: '2026-09-13T10:00:00.000Z',
      event_states: [{ tender_id: fixture.expectedTenderIds[0], existing_status: null }],
    }]);
    outputs.push(result[0].json.source_event_key);
  }
  assert.equal(new Set(outputs).size, 2);
});

test('malformed TenderPlan page shapes fail closed before dispatch', async () => {
  const node = requireNode(workflow, 'Normalize Complete Page Set');
  const key = {
    saved_key_id: fixture.keys[0].saved_key_id,
    saved_key_name: fixture.keys[0].name,
    baseline_exists: true,
  };
  const globals = {
    $: () => ({ first: () => ({ json: structuredClone(key) }) }),
  };

  await assert.rejects(
    executeCodeNode(node, [{ tenders: {} }], globals),
    /TENDERPLAN_TENDERS_INVALID/u,
  );
  await assert.rejects(
    executeCodeNode(node, [null], globals),
    /TENDERPLAN_RESPONSE_INVALID/u,
  );
});

test('queue emits one no-dispatch summary and rejects unknown ledger statuses', async () => {
  const node = requireNode(workflow, 'Build Dispatch Queue');
  const common = {
    saved_key_id: fixture.keys[0].saved_key_id,
    saved_key_name: fixture.keys[0].name,
    observed_at: '2026-09-13T10:00:00.000Z',
  };
  const suppressed = await executeCodeNode(node, [{
    ...common,
    event_states: [
      { tender_id: fixture.expectedTenderIds[0], existing_status: 'completed' },
      { tender_id: fixture.expectedTenderIds[1], existing_status: 'processing' },
    ],
  }]);
  assert.equal(suppressed.length, 1);
  assert.equal(suppressed[0].json.should_dispatch, false);
  assert.equal(suppressed[0].json.suppressed_count, 2);

  await assert.rejects(
    executeCodeNode(node, [{
      ...common,
      event_states: [{ tender_id: fixture.expectedTenderIds[0], existing_status: 'mystery' }],
    }]),
    /INTAKE_EVENT_STATUS_INVALID/u,
  );
});

test('baseline validator accepts only zero markers or one exact valid marker', async () => {
  const node = requireNode(workflow, 'Validate Baseline State');
  const base = {
    saved_key_id: fixture.keys[0].saved_key_id,
    saved_key_name: fixture.keys[0].name,
  };
  const absent = await executeCodeNode(node, [{ ...base, marker_count: 0, valid_marker_count: 0 }]);
  const present = await executeCodeNode(node, [{ ...base, marker_count: 1, valid_marker_count: 1 }]);
  assert.equal(absent[0].json.baseline_exists, false);
  assert.equal(present[0].json.baseline_exists, true);
  await assert.rejects(
    executeCodeNode(node, [{ ...base, marker_count: 1, valid_marker_count: 0 }]),
    /BASELINE_MARKER_INVALID/u,
  );
  await assert.rejects(
    executeCodeNode(node, [{ ...base, marker_count: 2, valid_marker_count: 1 }]),
    /BASELINE_STATE_INVALID/u,
  );
});

test('baseline rows and marker are persisted by one atomic SQL statement', () => {
  const node = requireNode(workflow, 'Initialize Baseline');
  const sql = node.parameters.query;
  const normalized = sql.replace(/\s+/gu, ' ').toLowerCase();
  assert.equal((sql.match(/;/gu) ?? []).length, 1);
  assert.match(normalized, /with input_rows as/u);
  assert.match(normalized, /baseline_events as \( insert into public\.tender_analysis_intake_events/u);
  assert.match(normalized, /baseline_marker as \( insert into public\.tender_analysis_intake_events/u);
  assert.ok(normalized.indexOf('baseline_events as') < normalized.indexOf('baseline_marker as'));
  assert.match(normalized, /key_match_baseline/u);
  assert.match(normalized, /key_baseline_completed/u);
  assert.match(normalized, /baseline_existing_skipped/u);
  assert.match(normalized, /baseline_initialized/u);
  assert.match(normalized, /on conflict \(source, event_key\) do nothing/u);
  assert.doesNotMatch(normalized, /create table|drop table|add column|parser|validator|field_key/u);
});

test('existing event states are loaded by one parameterized batch query', () => {
  const node = requireNode(workflow, 'Load Existing Event States');
  const normalized = node.parameters.query.replace(/\s+/gu, ' ').toLowerCase();
  assert.match(normalized, /jsonb_array_elements_text\(\$3::jsonb\)/u);
  assert.match(normalized, /left join public\.tender_analysis_intake_events/u);
  assert.match(normalized, /event_key = 'tenderplan:key:' \|\| \$1::text \|\| ':tender:' \|\| requested\.tender_id/u);
  assert.equal((node.parameters.query.match(/;/gu) ?? []).length, 1);
});

test('pagination is bounded, rate-limited, retried, and stopped by an empty tenders page', () => {
  const node = requireNode(workflow, 'Get Complete Saved Key Pages');
  const pagination = node.parameters.options.pagination.pagination;
  assert.equal(pagination.paginationMode, 'updateAParameterInEachRequest');
  assert.deepEqual(pagination.parameters.parameters, [{
    type: 'qs',
    name: 'page',
    value: '={{ $pageCount + 1 }}',
  }]);
  assert.equal(pagination.paginationCompleteWhen, 'other');
  assert.match(pagination.completeExpression, /tenders\.length === 0/u);
  assert.equal(pagination.limitPagesFetched, true);
  assert.equal(pagination.maxRequests, 100);
  assert.equal(pagination.requestInterval, 1100);
  assert.equal(node.retryOnFail, true);
  assert.equal(node.maxTries, 3);
  assert.equal(node.waitBetweenTries, 5000);
});
