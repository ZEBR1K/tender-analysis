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
