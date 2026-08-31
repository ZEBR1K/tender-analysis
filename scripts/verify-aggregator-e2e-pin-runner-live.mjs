import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BODY_WORKFLOW_NAME,
  CONTROLLER_WORKFLOW_NAME,
  REPORT_VERSION_ID,
  REPORT_WORKFLOW_ID,
  SOURCE_VERSION_ID,
  SOURCE_WORKFLOW_ID,
  TARGETED_RECHECK_VERSION_ID,
  TARGETED_RECHECK_WORKFLOW_ID,
} from '../tests/helpers/aggregator-e2e-runner-builder.mjs';

const BODY_VERSION_ID = '7566262e-4c7a-4483-a5cd-9bdfd81a95aa';
const BODY_ACTIVE_VERSION_ID = BODY_VERSION_ID;
const CONTROLLER_VERSION_ID = '03ac36e0-c4f8-44ea-bd52-bf41d5425012';
const CONTROLLER_ACTIVE_VERSION_ID = null;

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const betaDirectory = path.join(repositoryRoot, 'workflows', 'n8n-exports', 'beta');
const ids = {
  body: process.argv[2] ?? 'gsoPfP4PSjcJjPfa',
  replayReport: process.argv[3] ?? 'b4Ga1PoFmlS5ep6Y',
  controller: process.argv[4] ?? 'U0S3Oyq5pYfiWVDE',
};
const baseUrl = process.env.N8N_TENDER_BASE_URL?.replace(/\/$/u, '');
const apiKey = process.env.N8N_TENDER_READONLY_API_KEY;
if (!baseUrl || !apiKey) throw new Error('Missing read-only n8n environment variables');

async function fetchWorkflow(id) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/v1/workflows/${id}`, {
        headers: { 'X-N8N-API-KEY': apiKey },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Read-only workflow fetch failed after retries: ${id}`, { cause: lastError });
}

async function readArtifact(name) {
  return JSON.parse(await fs.readFile(path.join(betaDirectory, name), 'utf8'));
}

function behavior(node) {
  const copied = structuredClone(node);
  delete copied.id;
  delete copied.position;
  delete copied.webhookId;
  delete copied.notes;
  return copied;
}

function byName(nodes) {
  return new Map(nodes.map((node) => [node.name, behavior(node)]));
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

const localBody = await readArtifact(`${BODY_WORKFLOW_NAME}.json`);
const localController = await readArtifact(`${CONTROLLER_WORKFLOW_NAME}.json`);
const source = await fetchWorkflow(SOURCE_WORKFLOW_ID);
const targetedRecheck = await fetchWorkflow(TARGETED_RECHECK_WORKFLOW_ID);
const reportSource = await fetchWorkflow(REPORT_WORKFLOW_ID);
const liveBody = await fetchWorkflow(ids.body);
const liveReplay = await fetchWorkflow(ids.replayReport);
const liveController = await fetchWorkflow(ids.controller);

assert.equal(source.versionId, SOURCE_VERSION_ID);
assert.equal(source.activeVersionId, SOURCE_VERSION_ID);
assert.equal(targetedRecheck.versionId, TARGETED_RECHECK_VERSION_ID);
assert.equal(targetedRecheck.activeVersionId, TARGETED_RECHECK_VERSION_ID);
assert.equal(reportSource.versionId, REPORT_VERSION_ID);
assert.equal(liveBody.name, BODY_WORKFLOW_NAME);
assert.equal(liveBody.versionId, BODY_VERSION_ID);
assert.equal(liveBody.activeVersionId, BODY_ACTIVE_VERSION_ID);
assert.equal(liveController.name, CONTROLLER_WORKFLOW_NAME);
assert.equal(liveController.versionId, CONTROLLER_VERSION_ID);
assert.equal(liveController.activeVersionId, CONTROLLER_ACTIVE_VERSION_ID);

const removed = new Set(['When Executed by Another Workflow', 'Захватить run для агрегации']);
const sourceDownstreamNodes = byName(source.nodes.filter(({ name }) => !removed.has(name)));
const liveBodyNodes = byName(liveBody.nodes);
const localBodyNodes = byName(localBody.nodes);
for (const name of ['E2E Controller Input', 'Validate runner contract and inject claim PIN']) {
  assert.deepEqual(liveBodyNodes.get(name), localBodyNodes.get(name), `live body harness drift: ${name}`);
}
for (const [name, sourceNode] of sourceDownstreamNodes) {
  assert.deepEqual(liveBodyNodes.get(name), sourceNode, `live body node drift: ${name}`);
}
assert.equal(sourceDownstreamNodes.size, 22);
const sourceDownstreamConnections = Object.fromEntries(
  Object.entries(source.connections).filter(([name]) => !removed.has(name)),
);
const liveBodyDownstreamConnections = Object.fromEntries(
  Object.entries(liveBody.connections).filter(
    ([name]) => !['E2E Controller Input', 'Validate runner contract and inject claim PIN'].includes(name),
  ),
);
assert.deepEqual(liveBodyDownstreamConnections, sourceDownstreamConnections);

const reportGuard = 'Проверить результат финализации5';
const reportNodes = byName(reportSource.nodes);
const replayNodes = byName(liveReplay.nodes);
for (const [name, sourceNode] of reportNodes) {
  const replayNode = replayNodes.get(name);
  if (name === reportGuard) {
    const expected = structuredClone(sourceNode);
    const actual = structuredClone(replayNode);
    actual.parameters.jsCode = expected.parameters.jsCode;
    delete actual.notes;
    delete expected.notes;
    assert.deepEqual(actual, expected, 'live replay report entry structure drift');
  } else {
    assert.deepEqual(replayNode, sourceNode, `live replay report downstream drift: ${name}`);
  }
}
assert.deepEqual(liveReplay.connections, reportSource.connections);
const replayGuardCode = replayNodes.get(reportGuard).parameters.jsCode;
assert.match(replayGuardCode, new RegExp(SOURCE_VERSION_ID, 'u'));
assert.doesNotMatch(replayGuardCode, /01ff5e9d-30d2-4530-b2ff-4513224e9056/u);

const localControllerNodes = byName(localController.nodes);
const liveControllerNodes = byName(liveController.nodes);
assert.deepEqual(liveControllerNodes, localControllerNodes, 'live controller node behavior drift');
assert.deepEqual(liveController.connections, localController.connections);
const controllerText = JSON.stringify(liveController);
assert.doesNotMatch(controllerText, /completion_claimed:\s*true/u);
assert.equal(
  liveController.nodes.filter(
    ({ type, parameters }) =>
      type === 'n8n-nodes-base.executeWorkflow' &&
      parameters.workflowId?.value === REPORT_WORKFLOW_ID,
  ).length,
  0,
);
assert.equal(
  liveController.nodes.filter(({ name }) => name === 'Call test-only replay report once').length,
  1,
);

console.log(JSON.stringify({
  body: {
    id: liveBody.id,
    versionId: liveBody.versionId,
    activeVersionId: liveBody.activeVersionId ?? null,
    active: liveBody.active,
    downstreamNodeCount: sourceDownstreamNodes.size,
    paritySha256: hash([...sourceDownstreamNodes]),
    harnessParitySha256: hash(
      ['E2E Controller Input', 'Validate runner contract and inject claim PIN']
        .map((name) => [name, liveBodyNodes.get(name)]),
    ),
    mutationScope: 'parameters-only; notes intentionally unchanged',
  },
  replayReport: {
    id: liveReplay.id,
    versionId: liveReplay.versionId,
    activeVersionId: liveReplay.activeVersionId ?? null,
    active: liveReplay.active,
    unchangedDownstreamNodeCount: reportNodes.size - 1,
    paritySha256: hash([...reportNodes].filter(([name]) => name !== reportGuard)),
  },
  controller: {
    id: liveController.id,
    versionId: liveController.versionId,
    activeVersionId: liveController.activeVersionId ?? null,
    active: liveController.active,
    directProductionReportCalls: 0,
    testReplayReportCalls: 1,
    paritySha256: hash([...liveControllerNodes]),
    mutationScope: 'parameters-only; notes intentionally unchanged',
  },
  source: {
    id: source.id,
    versionId: source.versionId,
    activeVersionId: source.activeVersionId,
  },
  targetedRecheck: {
    id: targetedRecheck.id,
    versionId: targetedRecheck.versionId,
    activeVersionId: targetedRecheck.activeVersionId,
  },
}, null, 2));
