import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  ANALYSIS_RUN_ID,
  BODY_WORKFLOW_NAME,
  CLAIM_PIN_ITEM,
  CONTROLLER_WORKFLOW_NAME,
  FINALIZATION_WORKFLOW_ID,
  REPORT_WORKFLOW_ID,
  REPORT_VERSION_ID,
  REPLAY_REPORT_WORKFLOW_NAME,
  RUNNER_CONTRACT_VERSION,
  SOURCE_ACTIVE_VERSION_ID,
  SOURCE_VERSION_ID,
  SOURCE_WORKFLOW_ID,
  TRIGGER_PIN_ITEM,
  assertBodyParity,
  buildBodyWorkflow,
  buildControllerWorkflow,
  buildReplayReportWorkflow,
  assertReplayReportParity,
  evaluateReportDispatch,
  exactRunnerRequest,
  scanWorkflowForSecrets,
} from './helpers/aggregator-e2e-runner-builder.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..');
const sourcePath = path.join(
  repositoryRoot,
  'workflows',
  'n8n-exports',
  'beta',
  `[TEST CODEX] TENDER — Агрегация закупки.live-${SOURCE_VERSION_ID}.json`,
);
const reportSourcePath = path.join(
  repositoryRoot,
  'workflows',
  'n8n-exports',
  'beta',
  `[TEST CODEX] TENDER — Генерация отчета.live-${REPORT_VERSION_ID}.json`,
);

function loadSource() {
  return JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
}

function loadReportSource() {
  return JSON.parse(fs.readFileSync(reportSourcePath, 'utf8'));
}

function runCodeNode(jsCode, { items, nodeData = {} }) {
  return vm.runInNewContext(`(() => { ${jsCode} })()`, {
    $input: { all: () => structuredClone(items) },
    $: (name) => ({ first: () => ({ json: structuredClone(nodeData[name]) }) }),
  });
}

test('source snapshot pins the exact trigger and atomic-claim outputs', () => {
  const source = loadSource();

  assert.equal(source.id, SOURCE_WORKFLOW_ID);
  assert.equal(source.versionId, SOURCE_VERSION_ID);
  assert.equal(source.activeVersionId, SOURCE_ACTIVE_VERSION_ID);
  assert.deepEqual(
    source.pinData['When Executed by Another Workflow'],
    [TRIGGER_PIN_ITEM],
  );
  assert.deepEqual(
    source.pinData['Захватить run для агрегации'],
    [CLAIM_PIN_ITEM],
  );
});

test('body replaces only trigger and claim while preserving every downstream node and edge', () => {
  const source = loadSource();
  const body = buildBodyWorkflow(source);

  assert.equal(body.name, BODY_WORKFLOW_NAME);
  assert.equal(
    body.nodes.some(({ name }) => name === 'Захватить run для агрегации'),
    false,
  );
  assert.equal(
    body.nodes.some(
      ({ name }) => name === 'When Executed by Another Workflow',
    ),
    false,
  );
  assert.equal(
    body.connections['Validate runner contract and inject claim PIN']
      .main[0][0].node,
    'Продолжать агрегацию?',
  );
  assert.doesNotThrow(() => assertBodyParity(source, body));
});

test('body contract is fail-closed and injects the exact saved claim item', () => {
  const source = loadSource();
  const body = buildBodyWorkflow(source);
  const guard = body.nodes.find(
    ({ name }) => name === 'Validate runner contract and inject claim PIN',
  );

  assert.ok(guard);
  assert.match(guard.parameters.jsCode, new RegExp(RUNNER_CONTRACT_VERSION));
  assert.match(guard.parameters.jsCode, new RegExp(ANALYSIS_RUN_ID));
  assert.match(guard.parameters.jsCode, new RegExp(SOURCE_WORKFLOW_ID));
  assert.match(guard.parameters.jsCode, new RegExp(SOURCE_VERSION_ID));
  assert.match(guard.parameters.jsCode, /RUNNER_CONTRACT_MISMATCH/u);
  assert.match(
    guard.parameters.jsCode,
    /return \[\{ json: CLAIM_PIN\.json, pairedItem: CLAIM_PIN\.pairedItem \}\]/u,
  );
});

test('execution 14257 regression: predecessor projects exactly the 11 body fields and body guard accepts them', () => {
  const source = loadSource();
  const body = buildBodyWorkflow(source);
  const controller = buildControllerWorkflow({
    bodyWorkflowId: '__BODY_WORKFLOW_ID__',
    replayReportWorkflowId: '__REPLAY_REPORT_WORKFLOW_ID__',
  });
  const exactControllerContract = {
    ...exactRunnerRequest(),
    controller_execution_id: '14257',
    contract_validated: true,
  };
  const preRunState = {
    analysis_run_id: ANALYSIS_RUN_ID,
    run_exists: true,
    run_status: 'aggregating',
    pre_run_barrier_ready: false,
  };
  const preRunGuard = controller.nodes.find(
    ({ name }) => name === 'Validate pre-run lifecycle',
  );
  const projected = runCodeNode(preRunGuard.parameters.jsCode, {
    items: [{ json: preRunState }],
    nodeData: { 'Validate exact E2E request': exactControllerContract },
  });
  const declaredBodyFields = body.nodes
    .find(({ name }) => name === 'E2E Controller Input')
    .parameters.workflowInputs.values.map(({ name }) => name);

  assert.deepEqual(
    Object.keys(projected[0].json).sort(),
    [...declaredBodyFields].sort(),
  );
  assert.equal(Object.hasOwn(projected[0].json, 'pre_run_status'), false);
  assert.equal(Object.hasOwn(projected[0].json, 'pre_run_barrier_ready'), false);

  const bodyGuard = body.nodes.find(
    ({ name }) => name === 'Validate runner contract and inject claim PIN',
  );
  assert.doesNotThrow(() =>
    runCodeNode(bodyGuard.parameters.jsCode, {
      items: projected,
      nodeData: {},
    }),
  );
  assert.throws(
    () =>
      runCodeNode(bodyGuard.parameters.jsCode, {
        items: [{ json: { ...projected[0].json, unknown_runtime_field: true } }],
        nodeData: {},
      }),
    /RUNNER_CONTRACT_MISMATCH/u,
  );
  assert.throws(
    () =>
      runCodeNode(bodyGuard.parameters.jsCode, {
        items: [{ json: { ...projected[0].json, controller_execution_id: '' } }],
        nodeData: {},
      }),
    /RUNNER_CONTRACT_MISMATCH/u,
  );

  const collapse = controller.nodes.find(
    ({ name }) => name === 'Collapse body completion to one item',
  );
  const postGuard = controller.nodes.find(
    ({ name }) => name === 'Validate post-run lifecycle and select report owner',
  );
  assert.match(collapse.parameters.jsCode, /Load pre-run lifecycle and barrier/u);
  assert.match(postGuard.parameters.jsCode, /Load pre-run lifecycle and barrier/u);
});

test('controller keeps report dispatch mutually exclusive and one-item', () => {
  const controller = buildControllerWorkflow({
    bodyWorkflowId: '__BODY_WORKFLOW_ID__',
    replayReportWorkflowId: '__REPLAY_REPORT_WORKFLOW_ID__',
  });

  assert.equal(controller.name, CONTROLLER_WORKFLOW_NAME);
  assert.equal(
    controller.nodes.filter(
      ({ type }) => type === 'n8n-nodes-base.webhook',
    ).length,
    1,
  );
  assert.equal(
    controller.nodes.filter(
      ({ name }) => name === 'Call test-only replay report once',
    ).length,
    1,
  );
  assert.equal(
    controller.nodes.find(
      ({ name }) => name === 'Call test-only replay report once',
    ).parameters.workflowId.value,
    '__REPLAY_REPORT_WORKFLOW_ID__',
  );
  assert.equal(
    controller.nodes.find(
      ({ name }) => name === 'Run pinned Aggregator body',
    ).parameters.workflowId.value,
    '__BODY_WORKFLOW_ID__',
  );

  const collapse = controller.nodes.find(
    ({ name }) => name === 'Collapse body completion to one item',
  );
  assert.match(collapse.parameters.jsCode, /return \[\{ json:/u);

  const barrier = controller.nodes.find(
    ({ name }) => name === 'Verify post-run 27\/27 barrier',
  );
  assert.match(barrier.parameters.query, /WITH expected_fields/u);
  assert.match(barrier.parameters.query, /final_count = 27/u);
  assert.match(barrier.parameters.query, /s\.valid_status_count/u);
  assert.match(barrier.parameters.query, /s\.valid_catalog_count/u);
  assert.match(barrier.parameters.query, /s\.valid_contract_count/u);
  assert.match(barrier.parameters.query, /result_contract_version = 'tender_field_final_v1'/u);
  assert.doesNotMatch(
    barrier.parameters.query,
    /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP)\b/iu,
  );

  const postGuard = controller.nodes.find(
    ({ name }) => name === 'Validate post-run lifecycle and select report owner',
  ).parameters.jsCode;
  assert.doesNotMatch(postGuard, /completion_claimed:\s*true/u);
  assert.match(postGuard, /completion_claimed:\s*false/u);
  assert.match(postGuard, /finalization_state:\s*'already_completed'/u);
  assert.match(postGuard, /report_replay_authorized:\s*true/u);

  const directProductionReportCalls = controller.nodes.filter(
    ({ type, parameters }) =>
      type === 'n8n-nodes-base.executeWorkflow' &&
      parameters.workflowId?.value === REPORT_WORKFLOW_ID,
  );
  assert.equal(directProductionReportCalls.length, 0);
});

test('test-only replay report changes only the entry guard and preserves all downstream report nodes and edges', () => {
  const source = loadReportSource();
  const replay = buildReplayReportWorkflow(source);

  assert.equal(replay.name, REPLAY_REPORT_WORKFLOW_NAME);
  assert.doesNotThrow(() => assertReplayReportParity(source, replay));
  const guard = replay.nodes.find(
    ({ name }) => name === 'Проверить результат финализации5',
  );
  assert.match(guard.parameters.jsCode, /report_replay_authorized/u);
  assert.match(guard.parameters.jsCode, /completion_claimed !== false/u);
  assert.match(guard.parameters.jsCode, /finalization_state !== 'already_completed'/u);
  assert.match(guard.parameters.jsCode, /run_status !== 'completed'/u);
  assert.match(guard.parameters.jsCode, /valid_contract_count !== 27/u);
});

test('execution 14278 regression: replay audit accepts only the published Aggregator source version', () => {
  const replay = buildReplayReportWorkflow(loadReportSource());
  const guard = replay.nodes.find(
    ({ name }) => name === 'Проверить результат финализации5',
  );
  const input = {
    analysis_run_id: ANALYSIS_RUN_ID,
    run_status: 'completed',
    final_count: 27,
    valid_status_count: 27,
    valid_catalog_count: 27,
    valid_contract_count: 27,
    missing_keys: [],
    unexpected_keys: [],
    barrier_ready: true,
    runner_contract_version: RUNNER_CONTRACT_VERSION,
    report_policy_version: 'one_report_per_runner_execution_v1',
    source_workflow_id: SOURCE_WORKFLOW_ID,
    source_workflow_version_id: SOURCE_VERSION_ID,
    completion_claimed: false,
    finalization_state: 'already_completed',
    report_replay_authorized: true,
    report_dispatch_owner: 'test_controller_replay',
    production_report_workflow_id: REPORT_WORKFLOW_ID,
    production_report_version_id: REPORT_VERSION_ID,
  };

  assert.doesNotThrow(() =>
    runCodeNode(guard.parameters.jsCode, {
      items: [{ json: input }],
      nodeData: {},
    }),
  );
  assert.throws(
    () =>
      runCodeNode(guard.parameters.jsCode, {
        items: [{ json: { ...input, source_workflow_version_id: SOURCE_ACTIVE_VERSION_ID } }],
        nodeData: {},
      }),
    /REPORT_REPLAY_AUDIT_INVALID/u,
  );
});

test('one-report-per-run policy covers first completion and completed replay', () => {
  assert.deepEqual(evaluateReportDispatch('aggregating'), {
    productionFinalizationReports: 1,
    controllerReplayReports: 0,
    totalReports: 1,
  });
  assert.deepEqual(evaluateReportDispatch('completed'), {
    productionFinalizationReports: 0,
    controllerReplayReports: 1,
    totalReports: 1,
  });
  assert.throws(
    () => evaluateReportDispatch('ready_for_aggregation'),
    /RUNNER_LIFECYCLE_MISMATCH/u,
  );
});

test('post-run ownership reads pre-run DB state directly for aggregating and completed paths', () => {
  const controller = buildControllerWorkflow({
    bodyWorkflowId: '__BODY_WORKFLOW_ID__',
    replayReportWorkflowId: '__REPLAY_REPORT_WORKFLOW_ID__',
  });
  const guard = controller.nodes.find(
    ({ name }) => name === 'Validate post-run lifecycle and select report owner',
  );
  const request = {
    ...exactRunnerRequest(),
    controller_execution_id: '14257',
    contract_validated: true,
  };
  const postRunProof = {
    analysis_run_id: ANALYSIS_RUN_ID,
    run_exists: true,
    run_status: 'completed',
    post_run_barrier_ready: true,
    final_count: 27,
    valid_status_count: 27,
    valid_catalog_count: 27,
    valid_contract_count: 27,
    missing_keys: [],
    unexpected_keys: [],
  };

  const firstRun = runCodeNode(guard.parameters.jsCode, {
    items: [{ json: postRunProof }],
    nodeData: {
      'Validate exact E2E request': request,
      'Load pre-run lifecycle and barrier': { run_status: 'aggregating' },
    },
  })[0].json;
  assert.equal(firstRun.controller_report_required, false);
  assert.equal(firstRun.report_dispatch_owner, 'production_finalization');
  assert.equal(Object.hasOwn(firstRun, 'completion_claimed'), false);

  const replay = runCodeNode(guard.parameters.jsCode, {
    items: [{ json: postRunProof }],
    nodeData: {
      'Validate exact E2E request': request,
      'Load pre-run lifecycle and barrier': { run_status: 'completed' },
    },
  })[0].json;
  assert.equal(replay.controller_report_required, true);
  assert.equal(replay.report_dispatch_owner, 'test_controller_replay');
  assert.equal(replay.completion_claimed, false);
  assert.equal(replay.finalization_state, 'already_completed');
  assert.equal(replay.report_replay_authorized, true);
});

test('body keeps production Finalization fan-out and test Targeted Recheck references', () => {
  const body = buildBodyWorkflow(loadSource());
  const executeNodes = body.nodes.filter(
    ({ type }) => type === 'n8n-nodes-base.executeWorkflow',
  );

  assert.equal(
    executeNodes.filter(
      ({ parameters }) => parameters.workflowId?.value === FINALIZATION_WORKFLOW_ID,
    ).length,
    2,
  );
  assert.equal(
    executeNodes.filter(
      ({ parameters }) => parameters.workflowId?.value === 'nI47FcgzYwGzwGqy',
    ).length,
    2,
  );
});

test('runner artifacts contain no embedded secret values', () => {
  const body = buildBodyWorkflow(loadSource());
  const controller = buildControllerWorkflow({
    bodyWorkflowId: '__BODY_WORKFLOW_ID__',
    replayReportWorkflowId: '__REPLAY_REPORT_WORKFLOW_ID__',
  });
  const replay = buildReplayReportWorkflow(loadReportSource());

  assert.deepEqual(scanWorkflowForSecrets(body), []);
  assert.deepEqual(scanWorkflowForSecrets(controller), []);
  assert.deepEqual(scanWorkflowForSecrets(replay), []);
});
