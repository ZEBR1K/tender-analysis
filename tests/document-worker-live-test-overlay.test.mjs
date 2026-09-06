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

const canonicalAggregatorName = "Call 'TENDER — Агрегация закупки'";
const betaAggregatorName = "Call '[TEST CODEX] TENDER — Агрегация закупки'";
const canonicalExtractorModel = 'z-ai/glm-5.3-flash@provider=cloudflare&reasoning_effort=low';
const betaExtractorModel = 'z-ai/glm-5.3-flash@provider=novita/fp8&reasoning_effort=low';

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

function validateConnections(candidateWorkflow) {
  const nodeNames = new Set(candidateWorkflow.nodes.map(({ name }) => name));
  for (const [source, connection] of Object.entries(candidateWorkflow.connections)) {
    assert.ok(nodeNames.has(source), `Unknown connection source: ${source}`);
    assert.ok(connection && typeof connection === 'object', `Invalid connection object: ${source}`);
    for (const outputsByType of Object.values(connection)) {
      assert.ok(Array.isArray(outputsByType), `Invalid connection outputs: ${source}`);
      for (const branch of outputsByType) {
        if (branch == null) continue;
        assert.ok(Array.isArray(branch), `Invalid connection branch: ${source}`);
        for (const edge of branch) {
          assert.ok(edge && typeof edge === 'object', `Invalid connection edge: ${source}`);
          assert.ok(nodeNames.has(edge.node), `Unknown connection target: ${source} -> ${edge.node}`);
        }
      }
    }
  }
}

function comparableCodeNode(candidate) {
  const copy = structuredClone(candidate);
  delete copy.id;
  delete copy.position;
  copy.settings ??= {};
  copy.disabled = copy.disabled === true;
  return copy;
}

function renameConnectionTargets(connections, oldName, newName) {
  for (const connection of Object.values(connections)) {
    if (!connection || typeof connection !== 'object') continue;
    for (const outputsByType of Object.values(connection)) {
      if (!Array.isArray(outputsByType)) continue;
      for (const branch of outputsByType) {
        if (!Array.isArray(branch)) continue;
        for (const edge of branch) {
          if (edge && typeof edge === 'object' && edge.node === oldName) edge.node = newName;
        }
      }
    }
  }
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
    canonicalWorkflow.nodes.some(({ name }) => name === canonicalAggregatorName),
    true,
  );
  validateConnections(canonicalWorkflow);
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
    errorWorkflow: 'jYzQ8RtNmnTM2PGz',
  });
  for (const setting of ['timeSavedMode', 'callerPolicy']) {
    if (Object.hasOwn(canonicalWorkflow.settings, setting)) {
      assert.deepEqual(workflow.settings[setting], canonicalWorkflow.settings[setting]);
    } else {
      assert.equal(Object.hasOwn(workflow.settings, setting), false);
    }
  }

  const aggregatorCalls = workflow.nodes.filter(
    (candidate) => candidate.type === 'n8n-nodes-base.executeWorkflow',
  );
  const testAggregator = node(betaAggregatorName);
  assert.equal(testAggregator.parameters.workflowId.value, 'ftvmrEHoMbPOAqZG');
  assert.equal(testAggregator.parameters.workflowId.cachedResultName, '[TEST CODEX] TENDER — Агрегация закупки');
  assert.equal(testAggregator.parameters.workflowId.cachedResultUrl, '/workflow/ftvmrEHoMbPOAqZG');
  assert.equal(Object.hasOwn(workflow.connections, testAggregator.name), false);
  assert.equal(
    aggregatorCalls.some((candidate) => candidate.name === canonicalAggregatorName),
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
  validateConnections(workflow);
});

test('canonical and beta packages differ only by the approved operational overlay', () => {
  const canonicalNames = new Set(canonicalWorkflow.nodes.map(({ name }) => name));
  const betaNames = new Set(workflow.nodes.map(({ name }) => name));
  assert.deepEqual(
    [...canonicalNames].filter((name) => !betaNames.has(name)).sort(),
    [canonicalAggregatorName],
  );
  assert.deepEqual(
    [...betaNames].filter((name) => !canonicalNames.has(name)).sort(),
    [betaAggregatorName, 'Wait'].sort(),
  );

  const canonicalCodeNodes = canonicalWorkflow.nodes
    .filter(({ type }) => type === 'n8n-nodes-base.code')
    .sort((left, right) => left.name.localeCompare(right.name));
  const betaCodeNodes = workflow.nodes
    .filter(({ type }) => type === 'n8n-nodes-base.code')
    .sort((left, right) => left.name.localeCompare(right.name));
  assert.equal(canonicalCodeNodes.length, betaCodeNodes.length);
  assert.deepEqual(
    betaCodeNodes.map(comparableCodeNode),
    canonicalCodeNodes.map(comparableCodeNode),
  );

  const normalizedCanonical = structuredClone(canonicalWorkflow);
  const normalizedBeta = structuredClone(workflow);
  delete normalizedBeta.id;
  normalizedBeta.name = normalizedCanonical.name;
  normalizedBeta.active = normalizedCanonical.active;
  delete normalizedBeta.settings.errorWorkflow;
  assert.deepEqual(normalizedBeta.settings, normalizedCanonical.settings);

  normalizedBeta.nodes = normalizedBeta.nodes.filter(({ name }) => name !== 'Wait');
  const betaAggregator = normalizedBeta.nodes.find(({ name }) => name === betaAggregatorName);
  const canonicalAggregator = normalizedCanonical.nodes.find(({ name }) => name === canonicalAggregatorName);
  assert.ok(betaAggregator);
  assert.ok(canonicalAggregator);
  betaAggregator.name = canonicalAggregatorName;
  betaAggregator.parameters = structuredClone(canonicalAggregator.parameters);

  const betaExtractor = normalizedBeta.nodes.find(({ name }) => name === 'AI Extractor v1.0');
  assert.ok(betaExtractor.parameters.jsonBody.includes(betaExtractorModel));
  betaExtractor.parameters.jsonBody = betaExtractor.parameters.jsonBody.replace(
    betaExtractorModel,
    canonicalExtractorModel,
  );

  delete normalizedBeta.connections.Wait;
  normalizedBeta.connections['Обработать evidence units по одной'].main[1] = [
    { node: 'Primary Extractor accepted?', type: 'main', index: 0 },
  ];
  renameConnectionTargets(normalizedBeta.connections, betaAggregatorName, canonicalAggregatorName);
  assert.equal(Object.hasOwn(normalizedBeta.connections, betaAggregatorName), false);

  assert.deepEqual(normalizedBeta, normalizedCanonical);
});
