import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const canonicalWorkflowPath = path.join(
  testDirectory,
  '..',
  'workflows',
  'n8n-exports',
  'TENDER — Обработать документ.json',
);
const betaWorkflowPath = path.join(
  testDirectory,
  '..',
  'workflows',
  'n8n-exports',
  'beta',
  '[DW-23 TEST CODEX] TENDER — Обработать документ.json',
);
const canonicalWorkflow = JSON.parse(fs.readFileSync(canonicalWorkflowPath, 'utf8'));
const workflow = JSON.parse(fs.readFileSync(betaWorkflowPath, 'utf8'));

function node(name) {
  const found = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(found, `Workflow node not found: ${name}`);
  return found;
}

function outputs(name, index = 0) {
  return (workflow.connections[name]?.main?.[index] ?? []).map(
    ({ node: target, type, index: targetIndex }) => ({ node: target, type, index: targetIndex }),
  );
}

test('canonical Worker retains neutral packaging', () => {
  assert.equal(Object.hasOwn(canonicalWorkflow, 'id'), false);
  assert.equal(Object.hasOwn(canonicalWorkflow, 'versionId'), false);
  assert.equal(Object.hasOwn(canonicalWorkflow, 'meta'), false);
  assert.equal(canonicalWorkflow.name, 'TENDER — Обработать документ');
  assert.equal(canonicalWorkflow.active, false);
  assert.deepEqual(canonicalWorkflow.pinData, {});
  assert.equal(canonicalWorkflow.nodes.length, 85);
  assert.equal(new Set(canonicalWorkflow.nodes.map(({ name }) => name)).size, 85);
  assert.deepEqual(canonicalWorkflow.settings, {
    executionOrder: 'v1',
    binaryMode: 'separate',
    availableInMCP: false,
  });
  assert.equal(canonicalWorkflow.nodes.some(({ name }) => name === 'Wait'), false);
  assert.equal(
    canonicalWorkflow.nodes.some(({ name }) => name === "Call 'TENDER — Агрегация закупки'"),
    true,
  );
});

test('beta Worker carries the approved live test operational overlay', () => {
  assert.equal(workflow.id, 'URFdslUfULtOLv9B');
  assert.equal(Object.hasOwn(workflow, 'versionId'), false);
  assert.equal(Object.hasOwn(workflow, 'meta'), false);
  assert.equal(workflow.name, '[DW-23 TEST CODEX] TENDER — Обработать документ');
  assert.equal(workflow.active, true);
  assert.deepEqual(workflow.pinData, {});
  assert.equal(workflow.nodes.length, 86);
  assert.equal(new Set(workflow.nodes.map(({ name }) => name)).size, 86);
  assert.deepEqual(workflow.settings, {
    executionOrder: 'v1',
    binaryMode: 'separate',
    availableInMCP: false,
    timeSavedMode: 'fixed',
    errorWorkflow: 'jYzQ8RtNmnTM2PGz',
    callerPolicy: 'workflowsFromSameOwner',
  });

  const aggregatorCalls = workflow.nodes.filter(
    (candidate) => candidate.type === 'n8n-nodes-base.executeWorkflow',
  );
  const testAggregator = node("Call '[TEST CODEX] TENDER — Агрегация закупки'");
  assert.equal(testAggregator.parameters.workflowId.value, 'ftvmrEHoMbPOAqZG');
  assert.equal(testAggregator.parameters.workflowId.cachedResultName, '[TEST CODEX] TENDER — Агрегация закупки');
  assert.equal(testAggregator.parameters.workflowId.cachedResultUrl, '/workflow/ftvmrEHoMbPOAqZG');
  assert.equal(Object.hasOwn(workflow.connections, testAggregator.name), false);
  assert.equal(
    aggregatorCalls.some((candidate) => candidate.name === "Call 'TENDER — Агрегация закупки'"),
    false,
  );

  assert.match(
    node('AI Extractor v1.0').parameters.jsonBody,
    /z-ai\/glm-5\.3-flash@provider=novita\/fp8&reasoning_effort=low/u,
  );

  assert.deepEqual(node('Wait'), {
    parameters: { amount: 2 },
    type: 'n8n-nodes-base.wait',
    typeVersion: 1.1,
    position: [4688, 1312],
    id: '28370d0b-84d6-4488-a4c9-2b3d2e63fcd5',
    name: 'Wait',
    webhookId: 'd989853c-4672-4ab4-bc1f-d8f040f7b1a1',
  });
  assert.deepEqual(outputs('Обработать evidence units по одной', 1), [
    { node: 'Wait', type: 'main', index: 0 },
  ]);
  assert.deepEqual(outputs('Wait'), [
    { node: 'Primary Extractor accepted?', type: 'main', index: 0 },
  ]);
});
