import assert from 'node:assert/strict';

export const SOURCE_WORKFLOW_ID = 'ftvmrEHoMbPOAqZG';
export const SOURCE_VERSION_ID = '91c17313-a593-4fb9-9072-79320a958dd7';
export const SOURCE_ACTIVE_VERSION_ID =
  '01ff5e9d-30d2-4530-b2ff-4513224e9056';
export const ANALYSIS_RUN_ID = '3caa7a89-b137-4cf6-b23d-941fb465c8f9';
export const RUNNER_CONTRACT_VERSION = 'tender_aggregator_e2e_pin_runner_v1';
export const REPORT_POLICY_VERSION = 'one_report_per_runner_execution_v1';
export const TARGETED_RECHECK_WORKFLOW_ID = 'nI47FcgzYwGzwGqy';
export const TARGETED_RECHECK_VERSION_ID =
  '13b3c124-4fef-4a6f-9d5f-8befa3725bc1';
export const TARGETED_RECHECK_ACTIVE_VERSION_ID =
  '13b3c124-4fef-4a6f-9d5f-8befa3725bc1';
export const FINALIZATION_WORKFLOW_ID = 'cSsh9yjpS7t5p0OO';
export const FINALIZATION_VERSION_ID =
  '742051fe-a58a-4e03-afa6-6233c0177247';
export const REPORT_WORKFLOW_ID = 'ckPnP3hRhKu4Mf9u';
export const REPORT_VERSION_ID = '9d095af6-b60d-4ad9-8061-432201ec0e8e';
export const BODY_WORKFLOW_NAME =
  '[TEST CODEX] TENDER — Aggregator E2E PIN body';
export const CONTROLLER_WORKFLOW_NAME =
  '[TEST CODEX] TENDER — Aggregator E2E PIN controller';
export const REPLAY_REPORT_WORKFLOW_NAME =
  '[TEST CODEX] TENDER — Report replay after exact 27-of-27 barrier';

export const TRIGGER_PIN_ITEM = {
  json: {
    analysis_run_id: ANALYSIS_RUN_ID,
    previous_run_status: 'processing',
    run_status: 'processing',
    documents_total: 12,
    registered_documents_count: 12,
    completed_documents_count: 1,
    pending_documents_count: 0,
    processing_documents_count: 11,
    failed_documents_count: 0,
    skipped_documents_count: 0,
    ready_at: null,
    should_start_aggregation: false,
    readiness_reason: 'documents_still_processing',
  },
  pairedItem: { item: 0 },
};

export const CLAIM_PIN_ITEM = {
  json: {
    analysis_run_id: ANALYSIS_RUN_ID,
    run_status: 'aggregating',
    documents_total: 12,
    ready_at: '2026-08-30T12:27:12.040Z',
    aggregation_started_at: '2026-08-30T12:34:26.499Z',
    aggregation_claimed: true,
  },
  pairedItem: { item: 0 },
};

const POSTGRES_CREDENTIAL = {
  id: 'RFpUr3McElcwyoxy',
  name: 'KITATEH Tenders',
};

const EXPECTED_FIELDS = [
  [1, 'procurement_subject'],
  [2, 'nm_price_with_vat'],
  [3, 'platform'],
  [4, 'procedure_type'],
  [5, 'application_deadline'],
  [6, 'application_review_date'],
  [7, 'results_date'],
  [8, 'customer'],
  [9, 'customer_contacts'],
  [10, 'participation_cost'],
  [11, 'participation_guarantee'],
  [12, 'evaluation_criteria'],
  [13, 'delivery_term'],
  [14, 'payment_terms'],
  [15, 'special_account_or_treasury'],
  [16, 'bank_support'],
  [17, 'government_contract'],
  [18, 'rebidding'],
  [19, 'national_regime'],
  [20, 'advance_contract_guarantee'],
  [21, 'warranty_obligations_guarantee'],
  [22, 'licenses_certificates'],
  [23, 'required_official_certificates'],
  [24, 'similar_supply_experience'],
  [25, 'analog_allowed'],
  [26, 'analog_definition'],
  [27, 'application_documents'],
];

const clone = (value) => structuredClone(value);

function expectedRequest() {
  return {
    runner_contract_version: RUNNER_CONTRACT_VERSION,
    report_policy_version: REPORT_POLICY_VERSION,
    analysis_run_id: ANALYSIS_RUN_ID,
    source_workflow_id: SOURCE_WORKFLOW_ID,
    source_workflow_version_id: SOURCE_VERSION_ID,
    trigger_pin_node: 'When Executed by Another Workflow',
    claim_pin_node: 'Захватить run для агрегации',
    trigger_pin_payload: TRIGGER_PIN_ITEM,
    claim_pin_payload: CLAIM_PIN_ITEM,
  };
}

function contractGuardCode({ webhook }) {
  const envelopeExpression = webhook
    ? "const received = items[0]?.json?.body;"
    : 'const received = items[0]?.json;';

  return `const items = $input.all();
if (items.length !== 1) {
  throw new Error('[E2E PIN runner] RUNNER_CONTRACT_MISMATCH: expected exactly one item');
}
${envelopeExpression}
const EXPECTED = ${JSON.stringify(expectedRequest(), null, 2)};
const CLAIM_PIN = ${JSON.stringify(CLAIM_PIN_ITEM, null, 2)};${webhook ? '' : `
const controllerExecutionId = received?.controller_execution_id;
if (typeof controllerExecutionId !== 'string' || !/^\\d+$/.test(controllerExecutionId)) {
  throw new Error('[E2E PIN runner] RUNNER_CONTRACT_MISMATCH: controller_execution_id');
}
const EXPECTED_BODY = {
  ...EXPECTED,
  controller_execution_id: controllerExecutionId,
  contract_validated: true,
};`}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

if (JSON.stringify(stable(received)) !== JSON.stringify(stable(${webhook ? 'EXPECTED' : 'EXPECTED_BODY'}))) {
  throw new Error(
    '[E2E PIN runner] RUNNER_CONTRACT_MISMATCH: request must equal the audited exact PIN contract',
  );
}

${webhook ? `return [{
  json: {
    ...EXPECTED,
    controller_execution_id: $execution.id,
    contract_validated: true,
  },
}];` : 'return [{ json: CLAIM_PIN.json, pairedItem: CLAIM_PIN.pairedItem }];'}`;
}

function workflowInputSchema() {
  return [
    { name: 'runner_contract_version', type: 'string' },
    { name: 'report_policy_version', type: 'string' },
    { name: 'analysis_run_id', type: 'string' },
    { name: 'source_workflow_id', type: 'string' },
    { name: 'source_workflow_version_id', type: 'string' },
    { name: 'trigger_pin_node', type: 'string' },
    { name: 'claim_pin_node', type: 'string' },
    { name: 'trigger_pin_payload', type: 'object' },
    { name: 'claim_pin_payload', type: 'object' },
    { name: 'controller_execution_id', type: 'string' },
    { name: 'contract_validated', type: 'boolean' },
  ];
}

function validateSource(source) {
  assert.equal(source.id, SOURCE_WORKFLOW_ID, 'unexpected source workflow');
  assert.equal(source.versionId, SOURCE_VERSION_ID, 'unexpected source version');
  assert.deepEqual(
    source.pinData?.['When Executed by Another Workflow'],
    [TRIGGER_PIN_ITEM],
    'trigger PIN drift',
  );
  assert.deepEqual(
    source.pinData?.['Захватить run для агрегации'],
    [CLAIM_PIN_ITEM],
    'claim PIN drift',
  );
}

export function buildBodyWorkflow(source) {
  validateSource(source);
  const removed = new Set([
    'When Executed by Another Workflow',
    'Захватить run для агрегации',
  ]);
  const downstreamNodes = source.nodes
    .filter(({ name }) => !removed.has(name))
    .map(clone);
  const downstreamConnections = Object.fromEntries(
    Object.entries(source.connections)
      .filter(([name]) => !removed.has(name))
      .map(([name, value]) => [name, clone(value)]),
  );

  const triggerNode = {
    id: 'e2e-pin-body-trigger',
    name: 'E2E Controller Input',
    type: 'n8n-nodes-base.executeWorkflowTrigger',
    typeVersion: 1.2,
    position: [-464, -272],
    parameters: {
      inputSource: 'workflowInputs',
      workflowInputs: { values: workflowInputSchema() },
    },
    notes:
      `TEST-ONLY input. Exact source ${SOURCE_WORKFLOW_ID}@${SOURCE_VERSION_ID}; ` +
      'payload originated from saved trigger and claim PIN data.',
  };
  const injectNode = {
    id: 'e2e-pin-body-inject-claim',
    name: 'Validate runner contract and inject claim PIN',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-240, -272],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: contractGuardCode({ webhook: false }),
    },
    notes:
      'Fail-closed exact contract check. Returns the saved claim PIN output and never executes the atomic claim SQL.',
  };

  return {
    name: BODY_WORKFLOW_NAME,
    description:
      `TEST-ONLY body for run ${ANALYSIS_RUN_ID}; source ${SOURCE_WORKFLOW_ID}@${SOURCE_VERSION_ID}. ` +
      'Exact saved claim PIN is injected; all nodes and edges after claim are unchanged.',
    active: false,
    nodes: [triggerNode, injectNode, ...downstreamNodes],
    connections: {
      'E2E Controller Input': {
        main: [[{ node: injectNode.name, type: 'main', index: 0 }]],
      },
      [injectNode.name]: {
        main: [[{ node: 'Продолжать агрегацию?', type: 'main', index: 0 }]],
      },
      ...downstreamConnections,
    },
    pinData: {},
    settings: {
      executionOrder: 'v1',
      binaryMode: 'separate',
      availableInMCP: true,
    },
    meta: {
      testOnly: true,
      audit: {
        analysis_run_id: ANALYSIS_RUN_ID,
        source_workflow_id: SOURCE_WORKFLOW_ID,
        source_version_id: SOURCE_VERSION_ID,
        trigger_pin_node: 'When Executed by Another Workflow',
        claim_pin_node: 'Захватить run для агрегации',
        runner_contract_version: RUNNER_CONTRACT_VERSION,
      },
    },
  };
}

export function assertBodyParity(source, body) {
  validateSource(source);
  const excluded = new Set([
    'When Executed by Another Workflow',
    'Захватить run для агрегации',
  ]);
  const expectedNodes = source.nodes.filter(({ name }) => !excluded.has(name));

  for (const expectedNode of expectedNodes) {
    const actualNode = body.nodes.find(({ name }) => name === expectedNode.name);
    assert.ok(actualNode, `missing downstream node: ${expectedNode.name}`);
    assert.deepEqual(actualNode, expectedNode, `node drift: ${expectedNode.name}`);
  }

  for (const [sourceName, expectedConnection] of Object.entries(
    source.connections,
  )) {
    if (excluded.has(sourceName)) continue;
    assert.deepEqual(
      body.connections[sourceName],
      expectedConnection,
      `connection drift: ${sourceName}`,
    );
  }

  assert.equal(
    body.nodes.length,
    expectedNodes.length + 2,
    'only trigger and injection may be added',
  );
}

function replayReportGuardCode() {
  return `const items = $input.all();
if (items.length !== 1) {
  throw new Error('[TEST Report Replay] REPORT_REPLAY_CONTRACT_INVALID: expected one item');
}
const input = items[0].json;
if (!input.analysis_run_id || input.analysis_run_id !== '${ANALYSIS_RUN_ID}') {
  throw new Error('[TEST Report Replay] REPORT_REPLAY_CONTRACT_INVALID: analysis_run_id');
}
if (input.report_replay_authorized !== true) {
  throw new Error('[TEST Report Replay] REPORT_REPLAY_NOT_AUTHORIZED');
}
if (input.completion_claimed !== false) {
  throw new Error('[TEST Report Replay] REPORT_REPLAY_CONTRACT_INVALID: completion_claimed must remain false');
}
if (input.finalization_state !== 'already_completed' || input.run_status !== 'completed') {
  throw new Error('[TEST Report Replay] REPORT_REPLAY_CONTRACT_INVALID: truthful lifecycle state required');
}
if (
  input.barrier_ready !== true ||
  input.final_count !== 27 ||
  input.valid_status_count !== 27 ||
  input.valid_catalog_count !== 27 ||
  input.valid_contract_count !== 27 ||
  !Array.isArray(input.missing_keys) || input.missing_keys.length !== 0 ||
  !Array.isArray(input.unexpected_keys) || input.unexpected_keys.length !== 0
) {
  throw new Error('[TEST Report Replay] REPORT_REPLAY_BARRIER_INVALID: exact 27/27 proof required');
}
if (
  input.runner_contract_version !== '${RUNNER_CONTRACT_VERSION}' ||
  input.report_policy_version !== '${REPORT_POLICY_VERSION}' ||
  input.source_workflow_id !== '${SOURCE_WORKFLOW_ID}' ||
  input.source_workflow_version_id !== '${SOURCE_VERSION_ID}' ||
  input.production_report_workflow_id !== '${REPORT_WORKFLOW_ID}' ||
  input.production_report_version_id !== '${REPORT_VERSION_ID}' ||
  input.report_dispatch_owner !== 'test_controller_replay'
) {
  throw new Error('[TEST Report Replay] REPORT_REPLAY_AUDIT_INVALID');
}

return [{
  json: {
    analysis_run_id: input.analysis_run_id,
    final_count: input.final_count,
    finalization_state: input.finalization_state,
    report_generation_started: true,
  },
}];`;
}

function validateReportSource(source) {
  assert.equal(source.id, REPORT_WORKFLOW_ID, 'unexpected report source workflow');
  assert.equal(source.versionId, REPORT_VERSION_ID, 'unexpected report source version');
  assert.ok(
    source.nodes.some(({ name }) => name === 'Проверить результат финализации5'),
    'production report input guard missing',
  );
}

export function buildReplayReportWorkflow(source) {
  validateReportSource(source);
  const nodes = source.nodes.map((item) => {
    const copied = clone(item);
    if (copied.name === 'Проверить результат финализации5') {
      copied.parameters = {
        ...copied.parameters,
        jsCode: replayReportGuardCode(),
      };
      copied.notes =
        'TEST-ONLY truthful replay guard: completed + already_completed + completion_claimed=false + exact 27/27 proof.';
    }
    return copied;
  });
  return {
    name: REPLAY_REPORT_WORKFLOW_NAME,
    description:
      `TEST-ONLY report replay for run ${ANALYSIS_RUN_ID}; production Report source ${REPORT_WORKFLOW_ID}@${REPORT_VERSION_ID}. ` +
      'Only the entry guard differs; snapshot/model/HTML nodes and edges are exact clones.',
    active: false,
    nodes,
    connections: clone(source.connections),
    pinData: {},
    settings: {
      ...clone(source.settings ?? {}),
      availableInMCP: false,
    },
    meta: {
      testOnly: true,
      audit: {
        analysis_run_id: ANALYSIS_RUN_ID,
        source_report_workflow_id: REPORT_WORKFLOW_ID,
        source_report_version_id: REPORT_VERSION_ID,
        changed_node: 'Проверить результат финализации5',
        runner_contract_version: RUNNER_CONTRACT_VERSION,
        report_policy_version: REPORT_POLICY_VERSION,
      },
    },
  };
}

export function assertReplayReportParity(source, replay) {
  validateReportSource(source);
  const guardName = 'Проверить результат финализации5';
  const sourceByName = new Map(source.nodes.map((item) => [item.name, item]));
  const replayByName = new Map(replay.nodes.map((item) => [item.name, item]));
  assert.deepEqual(
    [...replayByName.keys()].sort(),
    [...sourceByName.keys()].sort(),
    'report node set drift',
  );
  for (const [name, sourceNode] of sourceByName) {
    const replayNode = replayByName.get(name);
    if (name === guardName) {
      const { parameters: sourceParameters, notes: sourceNotes, ...sourceRest } = sourceNode;
      const { parameters: replayParameters, notes: replayNotes, ...replayRest } = replayNode;
      assert.deepEqual(replayRest, sourceRest, 'report entry guard structure drift');
      assert.deepEqual(
        { ...replayParameters, jsCode: sourceParameters.jsCode },
        sourceParameters,
        'only entry guard jsCode may differ',
      );
      assert.equal(typeof replayNotes, 'string');
      continue;
    }
    assert.deepEqual(replayNode, sourceNode, `report downstream node drift: ${name}`);
  }
  assert.deepEqual(replay.connections, source.connections, 'report edge drift');
}

function barrierSql(prefix) {
  const values = EXPECTED_FIELDS.map(
    ([index, key]) => `        (${index}, '${key}')`,
  ).join(',\n');
  return `WITH expected_fields(field_index, field_key) AS (
    VALUES
${values}
),
run_state AS (
    SELECT id, status
    FROM tender_analysis_runs
    WHERE id = $1::uuid
),
actual_fields AS (
    SELECT field_index, field_key, field_catalog_version,
           result_contract_version, status
    FROM tender_analysis_field_results
    WHERE analysis_run_id = $1::uuid
),
stats AS (
    SELECT
        COUNT(*)::int AS final_count,
        COUNT(*) FILTER (WHERE status IN ('resolved','requires_review','not_found'))::int AS valid_status_count,
        COUNT(*) FILTER (WHERE field_catalog_version = 'tender_fields_v1')::int AS valid_catalog_count,
        COUNT(*) FILTER (WHERE result_contract_version = 'tender_field_final_v1')::int AS valid_contract_count
    FROM actual_fields
),
missing_fields AS (
    SELECT ARRAY_AGG(e.field_key ORDER BY e.field_index) AS keys
    FROM expected_fields e
    LEFT JOIN actual_fields a
      ON a.field_index = e.field_index AND a.field_key = e.field_key
    WHERE a.field_key IS NULL
),
unexpected_fields AS (
    SELECT ARRAY_AGG(a.field_key ORDER BY a.field_index) AS keys
    FROM actual_fields a
    LEFT JOIN expected_fields e
      ON e.field_index = a.field_index AND e.field_key = a.field_key
    WHERE e.field_key IS NULL
)
SELECT
    $1::uuid AS analysis_run_id,
    EXISTS (SELECT 1 FROM run_state) AS run_exists,
    (SELECT status FROM run_state LIMIT 1) AS run_status,
    s.final_count,
    s.valid_status_count,
    s.valid_catalog_count,
    s.valid_contract_count,
    COALESCE(m.keys, ARRAY[]::text[]) AS missing_keys,
    COALESCE(u.keys, ARRAY[]::text[]) AS unexpected_keys,
    (
      s.final_count = 27
      AND s.valid_status_count = 27
      AND s.valid_catalog_count = 27
      AND s.valid_contract_count = 27
      AND COALESCE(cardinality(m.keys), 0) = 0
      AND COALESCE(cardinality(u.keys), 0) = 0
    ) AS ${prefix}_barrier_ready
FROM stats s
CROSS JOIN missing_fields m
CROSS JOIN unexpected_fields u;`;
}

function preRunGuardCode() {
  return `const items = $input.all();
if (items.length !== 1) {
  throw new Error('[E2E PIN controller] RUNNER_LIFECYCLE_MISMATCH: pre-run query must return one row');
}
const state = items[0].json;
const request = $('Validate exact E2E request').first().json;
if (state.analysis_run_id !== request.analysis_run_id || state.run_exists !== true) {
  throw new Error('[E2E PIN controller] RUNNER_LIFECYCLE_MISMATCH: run missing or ID drift');
}
if (!['aggregating', 'completed'].includes(state.run_status)) {
  throw new Error(
    '[E2E PIN controller] RUNNER_LIFECYCLE_MISMATCH: expected aggregating or completed, got ' + state.run_status,
  );
}
if (state.run_status === 'completed' && state.pre_run_barrier_ready !== true) {
  throw new Error('[E2E PIN controller] RUNNER_LIFECYCLE_MISMATCH: completed replay requires exact 27/27 before start');
}
return [{
  json: request,
}];`;
}

function collapseCode() {
  return `const bodyItems = $input.all();
const request = $('Validate exact E2E request').first().json;
const preRunState = $('Load pre-run lifecycle and barrier').first().json;
return [{ json: {
    ...request,
    pre_run_status: preRunState.run_status,
    pre_run_barrier_ready: preRunState.pre_run_barrier_ready,
    body_completed: true,
    body_output_items: bodyItems.length,
  } }];`;
}

function postRunGuardCode() {
  return `const items = $input.all();
if (items.length !== 1) {
  throw new Error('[E2E PIN controller] RUNNER_POST_BARRIER_MISMATCH: expected one barrier row');
}
const state = items[0].json;
const request = $('Validate exact E2E request').first().json;
const preRunState = $('Load pre-run lifecycle and barrier').first().json;
if (
  state.analysis_run_id !== request.analysis_run_id ||
  state.run_exists !== true ||
  state.run_status !== 'completed' ||
  state.post_run_barrier_ready !== true ||
  state.final_count !== 27
) {
  throw new Error(
    '[E2E PIN controller] RUNNER_POST_BARRIER_MISMATCH: ' + JSON.stringify(state),
  );
}
const controllerReportRequired = preRunState.run_status === 'completed';
const common = {
  analysis_run_id: state.analysis_run_id,
  run_status_before: preRunState.run_status,
  run_status: state.run_status,
  final_count: state.final_count,
  valid_status_count: state.valid_status_count,
  valid_catalog_count: state.valid_catalog_count,
  valid_contract_count: state.valid_contract_count,
  missing_keys: state.missing_keys,
  unexpected_keys: state.unexpected_keys,
  barrier_ready: true,
  controller_report_required: controllerReportRequired,
  runner_contract_version: '${RUNNER_CONTRACT_VERSION}',
  report_policy_version: '${REPORT_POLICY_VERSION}',
  source_workflow_id: '${SOURCE_WORKFLOW_ID}',
  source_workflow_version_id: '${SOURCE_VERSION_ID}',
};
return [{
  json: controllerReportRequired ? {
    ...common,
    completion_claimed: false,
    finalization_state: 'already_completed',
    report_replay_authorized: true,
    report_dispatch_owner: 'test_controller_replay',
    production_report_workflow_id: '${REPORT_WORKFLOW_ID}',
    production_report_version_id: '${REPORT_VERSION_ID}',
    runner_audit: {
      controller_execution_id: request.controller_execution_id,
      finalization_workflow_id: '${FINALIZATION_WORKFLOW_ID}',
      finalization_version_id: '${FINALIZATION_VERSION_ID}',
    },
  } : {
    ...common,
    report_dispatch_owner: 'production_finalization',
    expected_report_count: 1,
  },
}];`;
}

function executeWorkflowParameters(workflowId, name) {
  return {
    mode: 'once',
    source: 'database',
    workflowId: {
      __rl: true,
      value: workflowId,
      mode: 'id',
      cachedResultUrl: `/workflow/${workflowId}`,
      cachedResultName: name,
    },
    options: { waitForSubWorkflow: true },
  };
}

export function buildControllerWorkflow({ bodyWorkflowId, replayReportWorkflowId }) {
  assert.equal(typeof bodyWorkflowId, 'string');
  assert.ok(bodyWorkflowId.length > 0);
  assert.equal(typeof replayReportWorkflowId, 'string');
  assert.ok(replayReportWorkflowId.length > 0);

  const webhookNode = {
    id: 'e2e-pin-controller-webhook',
    name: 'Run exact Aggregator E2E PIN fixture',
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2.1,
    position: [-720, -128],
    webhookId: 'e2e-pin-3caa7a89-b137-4cf6-b23d-941fb465c8f9',
    parameters: {
      httpMethod: 'POST',
      path: 'test-codex-tender-aggregator-e2e-3caa7a89',
      authentication: 'none',
      responseMode: 'onReceived',
      options: {},
    },
    notes:
      'TEST-ONLY MCP entry point. The next node rejects every body except the exact audited fixture contract.',
  };
  const validateRequest = {
    id: 'e2e-pin-controller-validate-request',
    name: 'Validate exact E2E request',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-496, -128],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: contractGuardCode({ webhook: true }),
    },
    notes:
      `Fail-closed contract ${RUNNER_CONTRACT_VERSION}; exact run/source/PIN payload only.`,
  };
  const loadPreRun = {
    id: 'e2e-pin-controller-pre-run-state',
    name: 'Load pre-run lifecycle and barrier',
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2.7,
    position: [-272, -128],
    parameters: {
      operation: 'executeQuery',
      query: barrierSql('pre_run'),
      options: {
        queryReplacement:
          "={{ [ $('Validate exact E2E request').item.json.analysis_run_id ] }}",
      },
    },
    credentials: { postgres: clone(POSTGRES_CREDENTIAL) },
  };
  const validatePreRun = {
    id: 'e2e-pin-controller-validate-pre-run',
    name: 'Validate pre-run lifecycle',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-48, -128],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: preRunGuardCode(),
    },
  };
  const runBody = {
    id: 'e2e-pin-controller-run-body',
    name: 'Run pinned Aggregator body',
    type: 'n8n-nodes-base.executeWorkflow',
    typeVersion: 1.3,
    position: [176, -128],
    alwaysOutputData: true,
    parameters: {
      ...executeWorkflowParameters(bodyWorkflowId, BODY_WORKFLOW_NAME),
      workflowInputs: {
        mappingMode: 'defineBelow',
        value: Object.fromEntries(
          workflowInputSchema().map(({ name }) => [name, `={{ $json.${name} }}`]),
        ),
        matchingColumns: [],
        schema: workflowInputSchema().map(({ name, type }) => ({
          id: name,
          displayName: name,
          required: false,
          defaultMatch: false,
          display: true,
          canBeUsedToMatch: true,
          type,
        })),
        attemptToConvertTypes: false,
        convertFieldsToString: true,
      },
    },
    notes:
      'Waits for every unchanged Aggregator branch, including test Targeted Recheck and production Finalization calls.',
  };
  const collapse = {
    id: 'e2e-pin-controller-collapse',
    name: 'Collapse body completion to one item',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [400, -128],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: collapseCode(),
    },
    notes:
      'Critical one-report guard: fan-out output is collapsed before the single post-run barrier query.',
  };
  const verifyPostRun = {
    id: 'e2e-pin-controller-post-run-barrier',
    name: 'Verify post-run 27/27 barrier',
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2.7,
    position: [624, -128],
    executeOnce: true,
    parameters: {
      operation: 'executeQuery',
      query: barrierSql('post_run'),
      options: {
        queryReplacement:
          "={{ [ $('Collapse body completion to one item').item.json.analysis_run_id ] }}",
      },
    },
    credentials: { postgres: clone(POSTGRES_CREDENTIAL) },
  };
  const validatePostRun = {
    id: 'e2e-pin-controller-validate-post-run',
    name: 'Validate post-run lifecycle and select report owner',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [848, -128],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode: postRunGuardCode(),
    },
  };
  const reportGate = {
    id: 'e2e-pin-controller-report-gate',
    name: 'Replay report for already completed run?',
    type: 'n8n-nodes-base.if',
    typeVersion: 2.3,
    position: [1072, -128],
    parameters: {
      conditions: {
        options: {
          caseSensitive: true,
          leftValue: '',
          typeValidation: 'strict',
          version: 3,
        },
        conditions: [
          {
            id: 'e2e-pin-report-required',
            leftValue: '={{ $json.controller_report_required === true }}',
            rightValue: '',
            operator: {
              type: 'boolean',
              operation: 'true',
              singleValue: true,
            },
          },
        ],
        combinator: 'and',
      },
      options: {},
    },
  };
  const callReport = {
    id: 'e2e-pin-controller-call-report',
    name: 'Call test-only replay report once',
    type: 'n8n-nodes-base.executeWorkflow',
    typeVersion: 1.3,
    position: [1296, -240],
    executeOnce: true,
    parameters: executeWorkflowParameters(
      replayReportWorkflowId,
      REPLAY_REPORT_WORKFLOW_NAME,
    ),
    notes:
      'TEST-ONLY already_completed replay. Calls the isolated truthful replay contract, never production Report directly.',
  };
  const returnAudit = {
    id: 'e2e-pin-controller-return-audit',
    name: 'Return production-finalization report audit',
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [1296, 0],
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "return [{ json: { ...$input.first().json, report_dispatch_owner: 'production_finalization', expected_report_count: 1 } }];",
    },
  };

  return {
    name: CONTROLLER_WORKFLOW_NAME,
    description:
      `TEST-ONLY E2E controller for run ${ANALYSIS_RUN_ID}; source ${SOURCE_WORKFLOW_ID}@${SOURCE_VERSION_ID}. ` +
      'Exact PIN contract; DB 27/27 gate; exactly one report per accepted execution.',
    active: false,
    nodes: [
      webhookNode,
      validateRequest,
      loadPreRun,
      validatePreRun,
      runBody,
      collapse,
      verifyPostRun,
      validatePostRun,
      reportGate,
      callReport,
      returnAudit,
    ],
    connections: {
      [webhookNode.name]: {
        main: [[{ node: validateRequest.name, type: 'main', index: 0 }]],
      },
      [validateRequest.name]: {
        main: [[{ node: loadPreRun.name, type: 'main', index: 0 }]],
      },
      [loadPreRun.name]: {
        main: [[{ node: validatePreRun.name, type: 'main', index: 0 }]],
      },
      [validatePreRun.name]: {
        main: [[{ node: runBody.name, type: 'main', index: 0 }]],
      },
      [runBody.name]: {
        main: [[{ node: collapse.name, type: 'main', index: 0 }]],
      },
      [collapse.name]: {
        main: [[{ node: verifyPostRun.name, type: 'main', index: 0 }]],
      },
      [verifyPostRun.name]: {
        main: [[{ node: validatePostRun.name, type: 'main', index: 0 }]],
      },
      [validatePostRun.name]: {
        main: [[{ node: reportGate.name, type: 'main', index: 0 }]],
      },
      [reportGate.name]: {
        main: [
          [{ node: callReport.name, type: 'main', index: 0 }],
          [{ node: returnAudit.name, type: 'main', index: 0 }],
        ],
      },
    },
    pinData: {},
    settings: {
      executionOrder: 'v1',
      binaryMode: 'separate',
      availableInMCP: true,
    },
    meta: {
      testOnly: true,
      audit: {
        analysis_run_id: ANALYSIS_RUN_ID,
        source_workflow_id: SOURCE_WORKFLOW_ID,
        source_version_id: SOURCE_VERSION_ID,
        targeted_recheck_workflow_id: TARGETED_RECHECK_WORKFLOW_ID,
        targeted_recheck_version_id: TARGETED_RECHECK_VERSION_ID,
        finalization_workflow_id: FINALIZATION_WORKFLOW_ID,
        finalization_version_id: FINALIZATION_VERSION_ID,
        report_workflow_id: REPORT_WORKFLOW_ID,
        report_version_id: REPORT_VERSION_ID,
        runner_contract_version: RUNNER_CONTRACT_VERSION,
        report_policy_version: REPORT_POLICY_VERSION,
      },
    },
  };
}

export function evaluateReportDispatch(preRunStatus) {
  if (preRunStatus === 'aggregating') {
    return {
      productionFinalizationReports: 1,
      controllerReplayReports: 0,
      totalReports: 1,
    };
  }
  if (preRunStatus === 'completed') {
    return {
      productionFinalizationReports: 0,
      controllerReplayReports: 1,
      totalReports: 1,
    };
  }
  throw new Error(
    `[E2E PIN runner] RUNNER_LIFECYCLE_MISMATCH: ${preRunStatus}`,
  );
}

export function scanWorkflowForSecrets(workflow) {
  const text = JSON.stringify(workflow);
  const patterns = [
    /\bsk-[A-Za-z0-9_-]{16,}\b/g,
    /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*\b/g,
    /postgres(?:ql)?:\/\/[^:\s/]+:[^@\s]+@/gi,
    /"(?:api[_-]?key|password|secret|token)"\s*:\s*"(?!\*\*\*)[^"\s]{8,}"/gi,
  ];
  return patterns.flatMap((pattern) => text.match(pattern) ?? []);
}

function sdkValue(value) {
  if (
    typeof value === 'string' &&
    value.startsWith('={{') &&
    value.endsWith('}}')
  ) {
    return `expr(${JSON.stringify(value.slice(1))})`;
  }
  if (Array.isArray(value)) {
    return `[${value.map(sdkValue).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .map(([key, nested]) => `${JSON.stringify(key)}:${sdkValue(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sdkCredentials(credentials) {
  if (!credentials) return '';
  const values = Object.entries(credentials)
    .map(
      ([type, credential]) =>
        `${JSON.stringify(type)}:newCredential(${JSON.stringify(credential.name)},${JSON.stringify(credential.id)})`,
    )
    .join(',');
  return `,credentials:{${values}}`;
}

export function workflowToSdkCode(workflow, workflowKey) {
  const variables = new Map(
    workflow.nodes.map((item, index) => [item.name, `n${index}`]),
  );
  const declarations = workflow.nodes.map((item, index) => {
    const factory =
      item.type === 'n8n-nodes-base.webhook' ||
      item.type.endsWith('Trigger')
        ? 'trigger'
        : 'node';
    const configFields = [
      `name:${JSON.stringify(item.name)}`,
      `parameters:${sdkValue(item.parameters ?? {})}`,
    ];
    for (const key of [
      'notes',
      'disabled',
      'alwaysOutputData',
      'executeOnce',
      'retryOnFail',
      'maxTries',
      'waitBetweenTries',
      'onError',
    ]) {
      if (Object.hasOwn(item, key)) {
        configFields.push(`${key}:${sdkValue(item[key])}`);
      }
    }
    return `const n${index}=${factory}({type:${JSON.stringify(item.type)},version:${item.typeVersion},config:{${configFields.join(',')}${sdkCredentials(item.credentials)}},output:[{}]});`;
  });
  const connections = [];
  for (const [sourceName, byType] of Object.entries(workflow.connections)) {
    const sourceVariable = variables.get(sourceName);
    assert.ok(sourceVariable, `connection source not found: ${sourceName}`);
    for (const [connectionType, outputs] of Object.entries(byType)) {
      assert.equal(connectionType, 'main', 'only main connections are supported');
      outputs.forEach((targets, sourceIndex) => {
        for (const target of targets ?? []) {
          const targetVariable = variables.get(target.node);
          assert.ok(targetVariable, `connection target not found: ${target.node}`);
          const sourceExpression =
            sourceIndex === 0
              ? sourceVariable
              : `${sourceVariable}.output(${sourceIndex})`;
          const targetExpression =
            target.index === 0
              ? targetVariable
              : `${targetVariable}.input(${target.index})`;
          connections.push(`.add(${sourceExpression}.to(${targetExpression}))`);
        }
      });
    }
  }
  return [
    "import { workflow, node, trigger, newCredential, expr } from '@n8n/workflow-sdk';",
    ...declarations,
    `export default workflow(${JSON.stringify(workflowKey)},${JSON.stringify(workflow.name)})${connections.join('')};`,
  ].join('\n');
}

export function exactRunnerRequest() {
  return clone(expectedRequest());
}
