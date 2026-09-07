import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const workflowExportPath = path.resolve(
  testDirectory,
  '..',
  'workflows',
  'n8n-exports',
  'TENDER — Manual Resume.json',
);

function requireNode(workflow, name) {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(node, `missing node: ${name}`);
  return node;
}

function directTargets(workflow, name) {
  return (workflow.connections[name]?.main?.[0] ?? [])
    .map((connection) => connection.node);
}

async function executePreparation(node, analysisRunId, executionId) {
  assert.equal(node.type, 'n8n-nodes-base.code');
  const defaultDeclaration = /const ANALYSIS_RUN_ID = '';/u;
  assert.match(node.parameters.jsCode, defaultDeclaration);
  const jsCode = node.parameters.jsCode.replace(
    defaultDeclaration,
    `const ANALYSIS_RUN_ID = ${JSON.stringify(analysisRunId)};`,
  );
  const context = vm.createContext({
    $execution: { id: executionId },
  });
  const script = new vm.Script(
    `(async () => {\n${jsCode}\n})()`,
    { filename: `${node.name}.code-node.js` },
  );
  return structuredClone(await script.runInContext(context, { timeout: 1_000 }));
}

test('manual resume is a strict three-node adapter to Intake Resume', async () => {
  assert.ok(
    fs.existsSync(workflowExportPath),
    'TENDER — Manual Resume workflow export is absent',
  );
  const exportText = fs.readFileSync(workflowExportPath, 'utf8');
  const workflow = JSON.parse(exportText);

  assert.equal(workflow.name, 'TENDER — Manual Resume');
  assert.equal(workflow.active, false);
  assert.equal(workflow.settings?.executionOrder, 'v1');
  assert.equal(workflow.settings?.availableInMCP, false);
  assert.equal(workflow.nodes.length, 3);

  const manualTriggers = workflow.nodes.filter((node) =>
    node.type === 'n8n-nodes-base.manualTrigger');
  assert.equal(manualTriggers.length, 1, 'entry must be exactly one Manual Trigger');
  const trigger = manualTriggers[0];
  assert.deepEqual(trigger.parameters, {});

  const preparation = requireNode(workflow, 'Set and Validate analysis_run_id');
  assert.equal(preparation.type, 'n8n-nodes-base.code');
  assert.equal(preparation.typeVersion, 2);
  assert.match(preparation.parameters.jsCode, /const ANALYSIS_RUN_ID = '';/u);
  assert.doesNotMatch(
    preparation.parameters.jsCode,
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu,
    'analysis_run_id must not have a hardcoded production default',
  );
  assert.doesNotMatch(
    preparation.parameters.jsCode,
    /\btender_id\b/u,
    'manual adapter must not accept tender_id or create a new run',
  );
  assert.match(preparation.parameters.jsCode, /\$execution\.id/u);

  await assert.rejects(
    executePreparation(preparation, '', 'manual-execution-empty'),
    /analysis_run_id.*non-empty UUID.*edit/iu,
  );
  await assert.rejects(
    executePreparation(preparation, 'not-a-uuid', 'manual-execution-invalid'),
    /analysis_run_id.*non-empty UUID.*edit/iu,
  );
  await assert.rejects(
    executePreparation(preparation, '   ', 'manual-execution-whitespace'),
    /analysis_run_id.*non-empty UUID.*edit/iu,
  );

  const analysisRunId = '11111111-1111-4111-8111-111111111111';
  const executionId = 'manual-execution-42';
  const preparedItems = await executePreparation(
    preparation,
    analysisRunId,
    executionId,
  );
  assert.deepEqual(preparedItems, [{
    json: {
      analysis_run_id: analysisRunId,
      source_event_key: `manual:${analysisRunId}:${executionId}`,
    },
  }]);
  assert.equal(Object.hasOwn(preparedItems[0].json, 'tender_id'), false);

  const dispatcherCalls = workflow.nodes.filter((node) =>
    node.type === 'n8n-nodes-base.executeWorkflow');
  assert.equal(dispatcherCalls.length, 1, 'adapter must call exactly one workflow');
  const dispatcher = dispatcherCalls[0];
  assert.equal(dispatcher.name, 'Execute TENDER — Intake Resume');
  assert.equal(dispatcher.typeVersion, 1.3);
  assert.equal(
    dispatcher.parameters.workflowId.cachedResultName,
    'TENDER — Intake Resume',
  );
  assert.equal(dispatcher.parameters.options.waitForSubWorkflow, true);
  assert.deepEqual(
    Object.keys(dispatcher.parameters.workflowInputs.value).sort(),
    [
      'analysis_run_id',
      'manual_override',
      'source_event_key',
      'trigger_kind',
    ],
  );
  assert.equal(
    dispatcher.parameters.workflowInputs.value.analysis_run_id,
    "={{ $('Set and Validate analysis_run_id').first().json.analysis_run_id }}",
  );
  assert.equal(
    dispatcher.parameters.workflowInputs.value.trigger_kind,
    'manual',
  );
  assert.equal(
    dispatcher.parameters.workflowInputs.value.manual_override,
    true,
  );
  assert.equal(
    dispatcher.parameters.workflowInputs.value.source_event_key,
    "={{ $('Set and Validate analysis_run_id').first().json.source_event_key }}",
  );
  assert.doesNotMatch(
    JSON.stringify(dispatcher.parameters.workflowInputs.value),
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu,
    'dispatcher inputs must not hardcode an analysis run ID',
  );
  assert.equal(
    Object.hasOwn(dispatcher.parameters.workflowInputs.value, 'tender_id'),
    false,
  );

  assert.deepEqual(directTargets(workflow, trigger.name), [preparation.name]);
  assert.deepEqual(directTargets(workflow, preparation.name), [dispatcher.name]);
  assert.deepEqual(directTargets(workflow, dispatcher.name), []);
  assert.deepEqual(
    workflow.nodes.map((node) => node.type),
    [
      'n8n-nodes-base.manualTrigger',
      'n8n-nodes-base.code',
      'n8n-nodes-base.executeWorkflow',
    ],
  );
});
