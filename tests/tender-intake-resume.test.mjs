import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { evaluateIntakeResumeDecision } from './helpers/intake-resume-model.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(
  testDirectory,
  'fixtures',
  'intake-resume',
  'run-states.json',
), 'utf8'));
const automaticIntents = [
  { triggerKind: 'tenderplan_mark', manualOverride: false },
  { triggerKind: 'recovery_scan', manualOverride: false },
];
const manualIntent = { triggerKind: 'manual', manualOverride: true };
const workflowExportPath = path.resolve(
  testDirectory,
  '..',
  'workflows',
  'n8n-exports',
  'TENDER — Intake Resume.json',
);
const workerExportPath = path.resolve(
  testDirectory,
  '..',
  'workflows',
  'n8n-exports',
  'TENDER — Обработать документ.json',
);
const finalizationExportPath = path.resolve(
  testDirectory,
  '..',
  'workflows',
  'n8n-exports',
  'TENDER — Финализация анализа.json',
);
const expectedFieldKeys = [
  'procurement_subject',
  'nm_price_with_vat',
  'platform',
  'procedure_type',
  'application_deadline',
  'application_review_date',
  'results_date',
  'customer',
  'customer_contacts',
  'participation_cost',
  'participation_guarantee',
  'evaluation_criteria',
  'delivery_term',
  'payment_terms',
  'special_account_or_treasury',
  'bank_support',
  'government_contract',
  'rebidding',
  'national_regime',
  'advance_contract_guarantee',
  'warranty_obligations_guarantee',
  'licenses_certificates',
  'required_official_certificates',
  'similar_supply_experience',
  'analog_allowed',
  'analog_definition',
  'application_documents',
];

function normalizeSql(sql) {
  return String(sql).replace(/\s+/gu, ' ').trim().toLowerCase();
}

function requireNode(workflow, name) {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(node, `missing node: ${name}`);
  return node;
}

function directTargets(workflow, name, outputIndex = 0) {
  return (workflow.connections[name]?.main?.[outputIndex] ?? [])
    .map((connection) => connection.node);
}

function canReach(workflow, startName, targetName) {
  const visited = new Set();
  const queue = [startName];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === targetName) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const outputs = workflow.connections[current]?.main ?? [];
    for (const output of outputs) {
      for (const connection of output ?? []) queue.push(connection.node);
    }
  }
  return false;
}

function reachableFromOutput(workflow, startName, outputIndex, blockedNames = []) {
  const blocked = new Set(blockedNames);
  const visited = new Set();
  const queue = [...directTargets(workflow, startName, outputIndex)];
  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current) || blocked.has(current)) continue;
    visited.add(current);
    for (const output of workflow.connections[current]?.main ?? []) {
      for (const connection of output ?? []) queue.push(connection.node);
    }
  }
  return visited;
}

function unwrapN8nExpression(value) {
  assert.equal(typeof value, 'string');
  const withoutMarker = value.trim().replace(/^=/u, '').trim();
  const match = /^\{\{([\s\S]*)\}\}$/u.exec(withoutMarker);
  assert.ok(match, `expected n8n expression, got ${value}`);
  return match[1].trim().replace(/\s+/gu, '');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function assertIfGateCondition(gate, { field, equals }) {
  assert.equal(gate.type, 'n8n-nodes-base.if');
  const conditions = gate.parameters?.conditions;
  assert.equal(conditions?.combinator, 'and', `${gate.name} must use AND conditions`);
  const fieldExpression = `$json.${field}`;
  const configuredConditions = conditions?.conditions ?? [];
  assert.ok(configuredConditions.length > 0, `${gate.name} must have conditions`);
  const targetConditions = configuredConditions.filter((condition) => {
    const expression = unwrapN8nExpression(condition.leftValue);
    return expression === fieldExpression ||
      expression.startsWith(`${fieldExpression}===`) ||
      expression.startsWith(`${fieldExpression}!==`);
  });
  assert.equal(
    targetConditions.length,
    1,
    `${gate.name} must have exactly one auditable ${field} predicate`,
  );
  const condition = targetConditions[0];
  const expression = unwrapN8nExpression(condition.leftValue);
  const operator = condition.operator ?? {};

  if (expression === fieldExpression) {
    if (typeof equals === 'boolean') {
      assert.equal(operator.type, 'boolean', `${gate.name} must use a boolean predicate`);
      assert.equal(
        operator.operation,
        equals ? 'true' : 'false',
        `${gate.name} has reversed boolean polarity`,
      );
      assert.equal(operator.singleValue, true, `${gate.name} must use a unary boolean operator`);
    } else {
      assert.equal(operator.type, 'string', `${gate.name} must compare an action string`);
      assert.equal(operator.operation, 'equals', `${gate.name} must use exact string equality`);
      assert.equal(condition.rightValue, equals, `${gate.name} compares the wrong action`);
    }
    return;
  }

  const literal = typeof equals === 'boolean'
    ? String(equals)
    : `(['"])${escapeRegExp(equals)}\\1`;
  assert.match(
    expression,
    new RegExp(`^\\$json\\.${escapeRegExp(field)}===${literal}$`, 'u'),
    `${gate.name} must compare only $json.${field} to ${String(equals)}`,
  );
  assert.equal(operator.type, 'boolean', `${gate.name} comparison must yield boolean`);
  assert.equal(operator.operation, 'true', `${gate.name} comparison has reversed output polarity`);
  assert.equal(operator.singleValue, true, `${gate.name} must use a unary boolean operator`);
}

function normalizeCodeNodeResult(rawResult, nodeName) {
  assert.notEqual(rawResult, undefined, `${nodeName} returned no data`);
  const rawItems = Array.isArray(rawResult) ? rawResult : [rawResult];
  return rawItems.map((item) =>
    (item && typeof item === 'object' && Object.hasOwn(item, 'json'))
      ? item
      : { json: item });
}

async function executeCodeNode(node, inputJson, globals = {}) {
  assert.equal(node.type, 'n8n-nodes-base.code', `${node.name} must be a Code node`);
  const inputItems = inputJson.map((json) => ({ json: structuredClone(json) }));
  // Canonical exports omit `mode` on all-items Code nodes, matching n8n's default.
  const mode = node.parameters.mode ?? 'runOnceForAllItems';
  if (!['runOnceForAllItems', 'runOnceForEachItem'].includes(mode)) {
    throw new Error(`unknown Code node mode: ${String(mode)}`);
  }

  const executeOnce = async (currentItem) => {
    const cloneItems = () => structuredClone(inputItems);
    const context = vm.createContext({
      $input: {
        all: cloneItems,
        first: () => structuredClone(inputItems[0]),
        item: structuredClone(currentItem),
      },
      $json: structuredClone(currentItem?.json ?? {}),
      $execution: { id: 'structural-contract-test-execution' },
      structuredClone,
      console,
      ...globals,
    });
    const script = new vm.Script(
      `(async () => {\n${node.parameters.jsCode}\n})()`,
      { filename: `${node.name}.code-node.js` },
    );
    const rawResult = await script.runInContext(context, { timeout: 1_000 });
    return normalizeCodeNodeResult(rawResult, node.name);
  };

  if (mode === 'runOnceForAllItems') {
    return structuredClone(await executeOnce(inputItems[0]));
  }

  const normalized = [];
  for (const inputItem of inputItems) {
    normalized.push(...await executeOnce(inputItem));
  }
  return structuredClone(normalized);
}

async function executeSingleCodeJson(node, inputJson, globals) {
  const items = await executeCodeNode(node, [inputJson], globals);
  assert.equal(items.length, 1, `${node.name} must emit exactly one normalized item`);
  assert.ok(items[0]?.json && typeof items[0].json === 'object');
  return items[0].json;
}

function evaluate({
  intent,
  document,
  runStatus = 'processing',
  finalCount = 0,
  finalBarrierValid = false,
}) {
  return evaluateIntakeResumeDecision({
    ...intent,
    runStatus,
    finalCount,
    finalBarrierValid,
    documents: document === undefined ? [] : [structuredClone(document)],
    now: fixture.now,
  });
}

function expectedDocumentAction(document, expected) {
  const action = { id: document.id, ...expected };
  if (expected.action === 'cas_to_failed') {
    action.compareAndSet = {
      id: document.id,
      analysisRunId: document.analysisRunId,
      status: 'processing',
      executionId: document.executionId,
      startedAt: document.startedAt,
      cutoff: '2026-09-07T11:00:00.000Z',
    };
  }
  return action;
}

test('decision model: every approved document row applies to both automatic triggers and manual intent', () => {
  for (const scenario of fixture.documentCases) {
    for (const intent of automaticIntents) {
      const result = evaluate({ intent, document: scenario.document });
      assert.deepEqual(
        result.documentActions,
        [expectedDocumentAction(scenario.document, scenario.automatic)],
        `${scenario.name}: ${intent.triggerKind}`,
      );
      assert.equal(result.stageAction, 'continue_document_stage');
    }

    const manualResult = evaluate({
      intent: manualIntent,
      document: scenario.document,
    });
    assert.deepEqual(
      manualResult.documentActions,
      [expectedDocumentAction(scenario.document, scenario.manual)],
      `${scenario.name}: manual`,
    );
    assert.equal(manualResult.stageAction, 'continue_document_stage');
  }
});

test('decision model: automatic Worker dispatch stops after two total claims while manual intent may continue', () => {
  for (const status of ['pending', 'failed']) {
    const document = {
      id: `doc-${status}-budget`,
      status,
      attempts: 2,
      startedAt: null,
      executionState: null,
    };

    for (const intent of automaticIntents) {
      assert.equal(
        evaluate({ intent, document }).documentActions[0].action,
        'exhausted',
      );
    }
    assert.equal(
      evaluate({ intent: manualIntent, document }).documentActions[0].action,
      'dispatch',
    );
  }
});

test('decision model: unavailable stale execution observation is explicit and cannot mutate the document', () => {
  const staleWithoutObservation = {
    id: 'doc-stale-unobserved',
    analysisRunId: 'run-1',
    status: 'processing',
    attempts: 1,
    startedAt: '2026-09-07T10:00:00.000Z',
    executionId: 'execution-unobserved',
    executionState: null,
  };

  assert.deepEqual(
    evaluate({
      intent: automaticIntents[0],
      document: staleWithoutObservation,
    }).documentActions,
    [{ id: staleWithoutObservation.id, action: 'execution_status_unavailable' }],
  );
});

test('decision model: stale compare-and-set carries the observed snapshot and treats a newer Worker claim as a benign race', () => {
  const race = fixture.staleCasRace;
  const action = evaluate({
    intent: automaticIntents[1],
    document: race.observed,
  }).documentActions[0];

  assert.deepEqual(action.compareAndSet, {
    id: race.observed.id,
    analysisRunId: race.observed.analysisRunId,
    status: race.observed.status,
    executionId: race.observed.executionId,
    startedAt: race.observed.startedAt,
    cutoff: '2026-09-07T11:00:00.000Z',
  });
  assert.notEqual(action.compareAndSet.startedAt, race.currentAtCas.startedAt);
  assert.notEqual(action.compareAndSet.executionId, race.currentAtCas.executionId);
  assert.equal(action.onNotApplied, race.expectedOnMiss);
});

test('decision model: exact execution states distinguish ownership, reclaim, and unavailable no-op', () => {
  const base = {
    id: 'doc-execution-state',
    analysisRunId: 'run-1',
    status: 'processing',
    attempts: 1,
    startedAt: '2026-09-07T10:00:00.000Z',
    executionId: 'execution-state',
  };

  for (const executionState of ['new', 'running', 'waiting']) {
    assert.equal(
      evaluate({
        intent: automaticIntents[0],
        document: { ...base, executionState },
      }).documentActions[0].action,
      'leave_owned',
      executionState,
    );
  }

  for (const executionState of ['success', 'error', 'canceled', 'crashed', 'not_found']) {
    assert.equal(
      evaluate({
        intent: automaticIntents[0],
        document: { ...base, executionState },
      }).documentActions[0].action,
      'cas_to_failed',
      executionState,
    );
  }

  for (const executionState of [
    null,
    'invalid',
    'unavailable',
    'network_error',
    'credential_error',
  ]) {
    assert.equal(
      evaluate({
        intent: automaticIntents[0],
        document: { ...base, executionState },
      }).documentActions[0].action,
      'execution_status_unavailable',
      String(executionState),
    );
  }

  assert.throws(
    () => evaluate({
      intent: automaticIntents[0],
      document: { ...base, executionState: 'terminal' },
    }),
    /unknown execution observation/iu,
  );
});

test('decision model: exactly one hour is stale and carries the inclusive cutoff', () => {
  const boundary = fixture.documentCases.find((scenario) =>
    scenario.name.includes('exactly one hour'));
  assert.ok(boundary);

  const action = evaluate({
    intent: automaticIntents[0],
    document: boundary.document,
  }).documentActions[0];

  assert.equal(action.action, 'cas_to_failed');
  assert.equal(action.compareAndSet.startedAt, action.compareAndSet.cutoff);

  const validOffsetAction = evaluate({
    intent: automaticIntents[0],
    document: {
      id: 'doc-valid-offset-time',
      analysisRunId: 'run-1',
      status: 'processing',
      attempts: 1,
      startedAt: '2026-09-07T14:30:00.000+03:00',
      executionId: 'execution-valid-offset',
      executionState: null,
    },
  }).documentActions[0];
  assert.equal(validOffsetAction.action, 'leave_owned');
});

test('decision model: stage routing follows the approved ready, aggregating, and completed table', () => {
  for (const scenario of fixture.stageCases) {
    for (const intent of [...automaticIntents, manualIntent]) {
      const result = evaluate({
        intent,
        runStatus: scenario.runStatus,
        finalCount: scenario.finalCount,
        finalBarrierValid: scenario.finalBarrierValid,
      });
      assert.deepEqual(result.documentActions, [], scenario.name);
      assert.equal(result.stageAction, scenario.expected, scenario.name);
    }
  }
});

test('decision model: failed runs reopen only for explicit manual intent', () => {
  for (const intent of automaticIntents) {
    assert.equal(
      evaluate({ intent, runStatus: 'failed' }).stageAction,
      'automatic_attempts_exhausted',
      intent.triggerKind,
    );
  }

  assert.equal(
    evaluate({ intent: manualIntent, runStatus: 'failed' }).stageAction,
    'reopen_failed_run',
  );
});

test('decision model: completed runs suppress document dispatch and stage mutation', () => {
  const result = evaluate({
    intent: automaticIntents[0],
    runStatus: 'completed',
    finalCount: 27,
    finalBarrierValid: true,
    document: {
      id: 'doc-pending-under-completed-run',
      status: 'pending',
      attempts: 0,
      startedAt: null,
      executionState: null,
    },
  });

  assert.deepEqual(result.documentActions, [{
    id: 'doc-pending-under-completed-run',
    action: 'skip_run_completed',
  }]);
  assert.equal(result.stageAction, 'no_op');
});

test('decision model: raw count 27 is insufficient without the full FINAL barrier', () => {
  assert.equal(
    evaluate({
      intent: automaticIntents[0],
      runStatus: 'aggregating',
      finalCount: 27,
      finalBarrierValid: false,
    }).stageAction,
    'manual_attention_required',
  );
});

test('decision model: malformed intent, state, attempts, counts, and timestamps fail closed', () => {
  const validDocument = {
    id: 'doc-valid',
    status: 'pending',
    attempts: 0,
    startedAt: null,
    executionState: null,
  };
  const invalidCases = [
    {
      name: 'automatic trigger with override',
      input: { intent: { triggerKind: 'tenderplan_mark', manualOverride: true }, document: validDocument },
    },
    {
      name: 'manual trigger without override',
      input: { intent: { triggerKind: 'manual', manualOverride: false }, document: validDocument },
    },
    {
      name: 'unknown trigger',
      input: { intent: { triggerKind: 'unknown', manualOverride: false }, document: validDocument },
    },
    {
      name: 'unknown document state',
      input: { intent: automaticIntents[0], document: { ...validDocument, status: 'mystery' } },
    },
    {
      name: 'negative attempts',
      input: { intent: automaticIntents[0], document: { ...validDocument, attempts: -1 } },
    },
    {
      name: 'unknown run state',
      input: { intent: automaticIntents[0], document: validDocument, runStatus: 'mystery' },
    },
    {
      name: 'too many FINAL rows',
      input: { intent: automaticIntents[0], runStatus: 'aggregating', finalCount: 28 },
    },
    {
      name: 'invalid processing timestamp',
      input: {
        intent: automaticIntents[0],
        document: {
          ...validDocument,
          analysisRunId: 'run-1',
          status: 'processing',
          startedAt: 'not-a-timestamp',
          executionId: 'execution-invalid-timestamp',
          executionState: 'running',
        },
      },
    },
    {
      name: 'impossible normalized calendar date',
      input: {
        intent: automaticIntents[0],
        document: {
          ...validDocument,
          analysisRunId: 'run-1',
          status: 'processing',
          startedAt: '2026-02-30T10:00:00.000Z',
          executionId: 'execution-impossible-date',
          executionState: 'running',
        },
      },
    },
  ];

  for (const scenario of invalidCases) {
    assert.throws(() => evaluate(scenario.input), undefined, scenario.name);
  }

  assert.throws(
    () => evaluateIntakeResumeDecision({
      ...automaticIntents[0],
      runStatus: 'processing',
      finalCount: 0,
      documents: [],
      now: fixture.now,
    }),
    /finalBarrierValid must be boolean/u,
    'missing FINAL barrier validity',
  );
});

test('test harness: Code execution honors all-items, each-item, default, and unknown modes', async () => {
  const inputs = [{ id: 'one' }, { id: 'two' }, { id: 'three' }];
  const allItemsNode = {
    name: 'All Items Probe',
    type: 'n8n-nodes-base.code',
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode: 'return [{ json: { count: $input.all().length } }];',
    },
  };
  assert.deepEqual(await executeCodeNode(allItemsNode, inputs), [
    { json: { count: 3 } },
  ]);

  const eachItemNode = {
    name: 'Each Item Probe',
    type: 'n8n-nodes-base.code',
    parameters: {
      mode: 'runOnceForEachItem',
      jsCode: 'return { json: { json_id: $json.id, item_id: $input.item.json.id } };',
    },
  };
  assert.deepEqual(await executeCodeNode(eachItemNode, inputs), [
    { json: { json_id: 'one', item_id: 'one' } },
    { json: { json_id: 'two', item_id: 'two' } },
    { json: { json_id: 'three', item_id: 'three' } },
  ]);

  const worker = JSON.parse(fs.readFileSync(workerExportPath, 'utf8'));
  assert.ok(worker.nodes.some((node) =>
    node.type === 'n8n-nodes-base.code' &&
    !Object.hasOwn(node.parameters, 'mode') &&
    /\$input\.all\(\)/u.test(node.parameters.jsCode ?? '')),
  'canonical export evidence must continue to justify omitted mode as all-items');
  const defaultModeNode = {
    ...allItemsNode,
    name: 'Default All Items Probe',
    parameters: { jsCode: allItemsNode.parameters.jsCode },
  };
  assert.deepEqual(await executeCodeNode(defaultModeNode, inputs), [
    { json: { count: 3 } },
  ]);

  await assert.rejects(
    () => executeCodeNode({
      ...allItemsNode,
      name: 'Unknown Mode Probe',
      parameters: { ...allItemsNode.parameters, mode: 'sometimes' },
    }, inputs),
    /unknown Code node mode/u,
  );
});

test('test harness: IF gate audit allows defenses but rejects target predicate ambiguity or reversal', () => {
  const condition = ({ field, operation = 'true' }) => ({
    leftValue: `={{ $json.${field} }}`,
    rightValue: '',
    operator: { type: 'boolean', operation, singleValue: true },
  });
  const gate = (conditions) => ({
    name: 'Gate Probe',
    type: 'n8n-nodes-base.if',
    parameters: {
      conditions: { combinator: 'and', conditions },
    },
  });

  assert.doesNotThrow(() => assertIfGateCondition(gate([
    condition({ field: 'reclaimable' }),
    condition({ field: 'contract_valid' }),
  ]), { field: 'reclaimable', equals: true }));
  assert.throws(() => assertIfGateCondition(gate([
    condition({ field: 'reclaimable', operation: 'false' }),
    condition({ field: 'contract_valid' }),
  ]), { field: 'reclaimable', equals: true }), /polarity/u);
  assert.throws(() => assertIfGateCondition(gate([
    condition({ field: 'reclaimable' }),
    condition({ field: 'reclaimable', operation: 'false' }),
  ]), { field: 'reclaimable', equals: true }), /exactly one/u);
});

test('workflow export implements the complete typed Intake Resume dispatcher contract', async () => {
  assert.equal(
    fs.existsSync(workflowExportPath),
    true,
    `planned export is absent: ${workflowExportPath}`,
  );

  const exportText = fs.readFileSync(workflowExportPath, 'utf8');
  const workflow = JSON.parse(exportText);
  const worker = JSON.parse(fs.readFileSync(workerExportPath, 'utf8'));
  const finalization = JSON.parse(fs.readFileSync(finalizationExportPath, 'utf8'));

  for (const node of workflow.nodes) {
    if (node.type === 'n8n-nodes-base.if') {
      for (const condition of node.parameters?.conditions?.conditions ?? []) {
        assert.match(condition.leftValue, /^=\{\{/u, `${node.name} IF expression is not executable`);
      }
    }
    if (node.type === 'n8n-nodes-base.postgres') {
      assert.match(
        node.parameters?.options?.queryReplacement ?? '',
        /^=\{\{/u,
        `${node.name} queryReplacement is not executable`,
      );
    }
    if (node.type === 'n8n-nodes-base.httpRequest') {
      assert.match(node.parameters.url, /^=\{\{/u, `${node.name} URL is not executable`);
    }
    if (node.type === 'n8n-nodes-base.executeWorkflow') {
      for (const value of Object.values(node.parameters?.workflowInputs?.value ?? {})) {
        if (typeof value === 'string' && value.includes('{{')) {
          assert.match(value, /^=\{\{/u, `${node.name} input expression is not executable`);
        }
      }
    }
  }

  assert.equal(workflow.name, 'TENDER — Intake Resume');
  assert.equal(workflow.active, false);
  assert.equal(workflow.settings?.availableInMCP, false);
  assert.equal(
    Object.hasOwn(workflow.settings ?? {}, 'errorWorkflow'),
    false,
    'repository export must omit errorWorkflow until controlled packaging binds the real imported ID',
  );

  const trigger = requireNode(workflow, 'When Executed by Another Workflow');
  assert.equal(trigger.type, 'n8n-nodes-base.executeWorkflowTrigger');
  assert.equal(trigger.typeVersion, 1.2);
  assert.equal(trigger.parameters.inputSource, 'workflowInputs');
  assert.deepEqual(trigger.parameters.workflowInputs.values, [
    { name: 'trigger_kind', type: 'string' },
    { name: 'source_event_key', type: 'string' },
    { name: 'tender_id', type: 'string' },
    { name: 'analysis_run_id', type: 'string' },
    { name: 'manual_override', type: 'boolean' },
    { name: 'observed_at', type: 'string' },
  ]);

  const validator = requireNode(workflow, 'Validate Intake Input');
  assert.equal(validator.type, 'n8n-nodes-base.code');
  const validInvocationCases = [
    {
      input: {
        trigger_kind: 'tenderplan_mark',
        source_event_key: 'tenderplan:event:123',
        tender_id: '123',
        manual_override: false,
        observed_at: fixture.now,
      },
      expected: { intent: 'automatic', run_authoritative: false },
    },
    {
      input: {
        trigger_kind: 'recovery_scan',
        source_event_key: 'recovery:run-1:execution-1',
        analysis_run_id: '11111111-1111-4111-8111-111111111111',
        manual_override: false,
        observed_at: fixture.now,
      },
      expected: { intent: 'automatic', run_authoritative: true },
    },
    {
      input: {
        trigger_kind: 'manual',
        source_event_key: 'manual:run-1:execution-1',
        analysis_run_id: '11111111-1111-4111-8111-111111111111',
        manual_override: true,
        observed_at: fixture.now,
      },
      expected: { intent: 'manual', run_authoritative: true },
    },
  ];
  for (const scenario of validInvocationCases) {
    const normalized = await executeSingleCodeJson(validator, scenario.input);
    assert.equal(normalized.trigger_kind, scenario.input.trigger_kind);
    assert.equal(normalized.source_event_key, scenario.input.source_event_key);
    assert.equal(normalized.observed_at, fixture.now);
    assert.equal(normalized.intent, scenario.expected.intent);
    assert.equal(normalized.run_authoritative, scenario.expected.run_authoritative);
  }

  const invalidInvocationCases = [
    {
      trigger_kind: 'tenderplan_mark',
      source_event_key: 'event',
      tender_id: '123',
      analysis_run_id: '11111111-1111-4111-8111-111111111111',
      manual_override: false,
    },
    {
      trigger_kind: 'tenderplan_mark',
      source_event_key: 'event',
      tender_id: '123',
      manual_override: true,
    },
    {
      trigger_kind: 'recovery_scan',
      source_event_key: 'event',
      manual_override: false,
    },
    {
      trigger_kind: 'recovery_scan',
      source_event_key: 'event',
      analysis_run_id: '11111111-1111-4111-8111-111111111111',
      manual_override: true,
    },
    {
      trigger_kind: 'manual',
      source_event_key: 'event',
      analysis_run_id: '11111111-1111-4111-8111-111111111111',
      manual_override: false,
    },
    {
      trigger_kind: 'unknown',
      source_event_key: 'event',
      manual_override: false,
    },
  ];
  let invalidClockReads = 0;
  class InvalidInputDate extends Date {
    constructor(...args) {
      if (args.length === 0) invalidClockReads += 1;
      super(...args);
    }

    static now() {
      invalidClockReads += 1;
      return Date.parse(fixture.now);
    }
  }
  for (const input of invalidInvocationCases) {
    await assert.rejects(
      () => executeSingleCodeJson(validator, input, { Date: InvalidInputDate }),
      /invalid|requires|must|unknown|conflict|forbidden/iu,
    );
  }
  assert.equal(invalidClockReads, 0, 'malformed input must fail before reading the current clock');

  let defaultClockReads = 0;
  class FixedDate extends Date {
    constructor(...args) {
      if (args.length === 0) {
        defaultClockReads += 1;
        super(fixture.now);
      } else {
        super(...args);
      }
    }

    static now() {
      defaultClockReads += 1;
      return Date.parse(fixture.now);
    }
  }
  const defaultedObservation = await executeSingleCodeJson(validator, {
    trigger_kind: 'tenderplan_mark',
    source_event_key: 'tenderplan:event:default-clock',
    tender_id: '123',
    manual_override: false,
  }, { Date: FixedDate });
  assert.equal(defaultedObservation.observed_at, fixture.now);
  assert.ok(defaultClockReads > 0, 'valid input without observed_at must read the clock');

  const runEntryGate = requireNode(workflow, 'Is Run-authoritative Invocation?');
  assert.equal(runEntryGate.type, 'n8n-nodes-base.if');
  assertIfGateCondition(runEntryGate, { field: 'run_authoritative', equals: true });
  assert.deepEqual(
    directTargets(workflow, runEntryGate.name, 0),
    ['Load Authoritative Run'],
  );
  assert.deepEqual(
    directTargets(workflow, runEntryGate.name, 1),
    ['Prepare Event Identity'],
  );
  assert.ok(reachableFromOutput(workflow, runEntryGate.name, 0)
    .has('Claim New or Failed Intake Event'));
  const tenderplanEntryPath = reachableFromOutput(workflow, runEntryGate.name, 1);
  assert.ok(tenderplanEntryPath.has('Claim New or Failed Intake Event'));
  assert.ok(tenderplanEntryPath.has('Resolve TenderPlan Runs'));
  assert.equal(
    reachableFromOutput(
      workflow,
      runEntryGate.name,
      1,
      ['Claim New or Failed Intake Event'],
    ).has('Resolve TenderPlan Runs'),
    false,
    'TenderPlan run resolution must not be reachable without first passing the event claim',
  );

  const runResolutionGate = requireNode(workflow, 'Route Run Resolution');
  assert.equal(runResolutionGate.type, 'n8n-nodes-base.if');
  assertIfGateCondition(runResolutionGate, { field: 'run_authoritative', equals: true });
  assert.deepEqual(
    directTargets(workflow, runResolutionGate.name, 0),
    ['Apply Run Entry Policy'],
  );
  assert.deepEqual(
    directTargets(workflow, runResolutionGate.name, 1),
    ['Resolve TenderPlan Runs'],
  );
  const authoritativeResolutionPath = reachableFromOutput(
    workflow,
    runResolutionGate.name,
    0,
  );
  assert.equal(authoritativeResolutionPath.has('Resolve TenderPlan Runs'), false);
  assert.equal(authoritativeResolutionPath.has('Call Orchestrator'), false);
  assert.ok(reachableFromOutput(workflow, runResolutionGate.name, 1)
    .has('Resolve TenderPlan Runs'));

  const authoritativeQuery = normalizeSql(
    requireNode(workflow, 'Load Authoritative Run').parameters.query,
  );
  assert.match(authoritativeQuery, /from (?:public\.)?tender_analysis_runs/iu);
  assert.match(authoritativeQuery, /where .*id\s*=\s*\$1::uuid/iu);
  assert.match(authoritativeQuery, /count\(\*\)|count\(.*id.*\)/iu);
  const authoritativeCode = requireNode(
    workflow,
    'Bind Authoritative Run Identity',
  ).parameters.jsCode;
  assert.match(authoritativeCode, /(?:count|rows|matches)[\s\S]*!==?\s*1/iu);
  assert.match(authoritativeCode, /tender_id[\s\S]*(?:conflict|mismatch|does not match)/iu);
  assert.match(authoritativeCode, /analysis_run_id/iu);

  const claimNode = requireNode(workflow, 'Claim New or Failed Intake Event');
  const claimSql = normalizeSql(claimNode.parameters.query);
  assert.match(claimSql, /insert into (?:public\.)?tender_analysis_intake_events/iu);
  assert.match(claimSql, /on conflict\s*\(\s*source\s*,\s*event_key\s*\)/iu);
  assert.match(claimSql, /status\s*=\s*'failed'/iu);
  assert.match(claimSql, /attempts\s*=\s*[^,]+attempts\s*\+\s*1/iu);
  assert.match(claimSql, /n8n_execution_id/iu);
  assert.match(claimSql, /processing_started_at\s*=\s*(?:now\(\)|current_timestamp)/iu);
  assert.match(claimNode.parameters.options.queryReplacement, /\$execution\.id/u);

  const loadEventSql = normalizeSql(requireNode(workflow, 'Load Intake Event').parameters.query);
  assert.match(loadEventSql, /where .*source\s*=\s*\$1/iu);
  assert.match(loadEventSql, /event_key\s*=\s*\$2/iu);
  for (const contextField of [
    'run_authoritative',
    'manual_override',
    'trigger_kind',
    'source_event_key',
    'analysis_run_id',
  ]) assert.match(loadEventSql, new RegExp(contextField, 'u'));
  const classifyEvent = requireNode(workflow, 'Classify Intake Event');
  assert.match(classifyEvent.parameters.jsCode, /current_at/iu);
  const duplicateEvent = await executeSingleCodeJson(classifyEvent, {
    source: 'tenderplan',
    event_key: 'event-completed',
    status: 'completed',
    processed_at: '2026-09-07T11:30:00.000Z',
    processing_started_at: '2026-09-07T11:00:00.000Z',
    n8n_execution_id: 'prior-event-owner',
    observed_at: fixture.now,
  });
  assert.equal(duplicateEvent.action, 'duplicate_event');
  assert.equal(duplicateEvent.event_route, 'no_op');
  assert.equal(duplicateEvent.reclaimable, false);

  const freshOwnedEvent = await executeSingleCodeJson(classifyEvent, {
    source: 'tenderplan',
    event_key: 'event-fresh-owned',
    status: 'processing',
    processed_at: null,
    processing_started_at: '2026-09-07T11:30:00.000Z',
    n8n_execution_id: 'active-event-owner',
    observed_at: fixture.now,
  });
  assert.equal(freshOwnedEvent.action, 'already_active');
  assert.equal(freshOwnedEvent.event_route, 'no_op');
  assert.equal(freshOwnedEvent.reclaimable, false);

  const eventNoopGate = requireNode(workflow, 'Event Outcome Is No-op?');
  assert.equal(eventNoopGate.type, 'n8n-nodes-base.if');
  assertIfGateCondition(eventNoopGate, { field: 'event_route', equals: 'no_op' });
  assert.deepEqual(
    directTargets(workflow, eventNoopGate.name, 0),
    ['Return Event No-op'],
  );
  assert.deepEqual(
    directTargets(workflow, eventNoopGate.name, 1),
    ['Route Event Continuation'],
  );
  const eventContinuePath = reachableFromOutput(workflow, eventNoopGate.name, 1);
  assert.ok(eventContinuePath.has('Read Intake Event Owner Execution'));
  assert.ok(eventContinuePath.has('Route Run Resolution'));
  const eventNoopReachable = reachableFromOutput(workflow, eventNoopGate.name, 0);
  assert.deepEqual([...eventNoopReachable], ['Return Event No-op']);
  for (const forbiddenNode of [
    'Resolve TenderPlan Runs',
    'Call Orchestrator',
    'Apply Run Entry Policy',
    'Reclaim Stale Intake Event',
    'Load Run Snapshot',
    'Apply Worker Readiness',
    'Guard Exhausted Run Failure',
    'Dispatch Document Workers',
    'Call Aggregator',
    'Call Finalization',
  ]) {
    assert.equal(eventNoopReachable.has(forbiddenNode), false, `${forbiddenNode} follows event no-op`);
  }

  const eventReclaim = requireNode(workflow, 'Reclaim Stale Intake Event');
  const eventReclaimSql = normalizeSql(eventReclaim.parameters.query);
  assert.match(eventReclaimSql, /update (?:public\.)?tender_analysis_intake_events/iu);
  assert.match(eventReclaimSql, /status\s*=\s*'processing'/iu);
  assert.match(eventReclaimSql, /n8n_execution_id\s*=\s*\$\d+/iu);
  assert.match(eventReclaimSql, /processing_started_at\s*=\s*\$\d+::timestamptz/iu);
  assert.match(eventReclaimSql, /processing_started_at\s*<=\s*\$\d+::timestamptz/iu);
  assert.match(eventReclaimSql, /attempts\s*=\s*[^,]+attempts\s*\+\s*1/iu);
  assert.match(eventReclaim.parameters.options.queryReplacement, /\$execution\.id/u);
  assert.ok(canReach(workflow, 'Read Intake Event Owner Execution', 'Reclaim Stale Intake Event'));
  const eventReclaimGate = requireNode(workflow, 'Is Intake Event Owner Reclaimable?');
  assert.equal(eventReclaimGate.type, 'n8n-nodes-base.if');
  assertIfGateCondition(eventReclaimGate, { field: 'reclaimable', equals: true });
  const eventReclaimTruePath = reachableFromOutput(workflow, eventReclaimGate.name, 0);
  const eventReclaimFalsePath = reachableFromOutput(workflow, eventReclaimGate.name, 1);
  assert.ok(eventReclaimTruePath.has('Reclaim Stale Intake Event'));
  assert.equal(eventReclaimFalsePath.has('Reclaim Stale Intake Event'), false);
  assert.ok(eventReclaimFalsePath.has('Return Event No-op'));

  const tenderRunQuery = normalizeSql(requireNode(workflow, 'Resolve TenderPlan Runs').parameters.query);
  assert.match(tenderRunQuery, /from (?:public\.)?tender_analysis_runs/iu);
  assert.match(tenderRunQuery, /source\s*=\s*'tenderplan'/iu);
  assert.match(tenderRunQuery, /tender_id\s*=\s*\$1/iu);
  assert.match(tenderRunQuery, /status\s*<>\s*'completed'|status\s*!=\s*'completed'/iu);
  const runResolutionCode = requireNode(
    workflow,
    'Classify TenderPlan Run Resolution',
  ).parameters.jsCode;
  assert.match(runResolutionCode, /unfinished[\s\S]*>\s*1[\s\S]*throw/iu);
  assert.match(runResolutionCode, /already_completed/iu);
  assert.match(runResolutionCode, /reuse|existing/iu);
  assert.match(runResolutionCode, /orchestrator|create/iu);

  const orchestrator = requireNode(workflow, 'Call Orchestrator');
  assert.equal(orchestrator.type, 'n8n-nodes-base.executeWorkflow');
  assert.equal(orchestrator.parameters.workflowId.value, 'Q1RWSrB0jaTA6Dmx');
  assert.equal(orchestrator.parameters.options.waitForSubWorkflow, true);
  assert.deepEqual(
    Object.keys(orchestrator.parameters.workflowInputs.value).sort(),
    ['source', 'source_event_key', 'tender_id', 'trigger_kind'].sort(),
  );
  const orchestratorResultCode = requireNode(
    workflow,
    'Validate Orchestrator Result',
  ).parameters.jsCode;
  assert.match(orchestratorResultCode, /created_new_run/iu);
  assert.match(orchestratorResultCode, /analysis_run_id/iu);
  assert.match(orchestratorResultCode, /identity|source[\s\S]*tender_id/iu);
  assert.deepEqual(
    directTargets(workflow, 'Orchestrator Created Run?', 0),
    ['Complete Intake Event'],
  );
  assert.deepEqual(
    directTargets(workflow, 'Orchestrator Created Run?', 1),
    ['Apply Run Entry Policy'],
  );
  assert.equal(
    canReach(workflow, 'Complete Intake Event', 'Dispatch Document Workers'),
    false,
    'created_new_run=true must not register or dispatch documents a second time',
  );

  const runPolicy = requireNode(workflow, 'Apply Run Entry Policy');
  const runPolicySql = normalizeSql(runPolicy.parameters.query);
  assert.match(runPolicySql, /update (?:public\.)?tender_analysis_runs/iu);
  assert.match(runPolicySql, /set status\s*=\s*'processing'/iu);
  assert.match(runPolicySql, /where .*status\s*=\s*'failed'/iu);
  assert.match(runPolicySql, /manual_override|\$\d+::boolean/iu);
  assert.match(runPolicySql, /trigger_kind|\$\d+\s*=\s*'manual'/iu);
  assert.match(runPolicySql, /select[\s\S]*from (?:public\.)?tender_analysis_runs/iu);
  assert.match(runPolicySql, /not exists|left join|coalesce/iu);
  const runPolicyCode = requireNode(workflow, 'Classify Run Entry Policy').parameters.jsCode;
  assert.match(runPolicyCode, /failed[\s\S]*manual[\s\S]*processing/iu);
  assert.match(runPolicyCode, /automatic_attempts_exhausted/iu);
  assert.match(runPolicyCode, /completed[\s\S]*already_completed/iu);

  const postgresNodes = workflow.nodes.filter((node) =>
    node.type === 'n8n-nodes-base.postgres');
  assert.ok(postgresNodes.length > 0);
  for (const node of postgresNodes) {
    assert.deepEqual(node.credentials?.postgres, {
      id: 'RFpUr3McElcwyoxy',
      name: 'KITATEH Tenders',
    }, `PostgreSQL credential drift in ${node.name}`);
  }
  const forbiddenAfterEventNoop = postgresNodes.filter((node) => {
    const sql = normalizeSql(node.parameters.query ?? '');
    return /tender_analysis_documents|tender_analysis_field_results/iu.test(sql) ||
      (/tender_analysis_runs/iu.test(sql) && /\b(?:insert|update|delete)\b/iu.test(sql));
  });
  for (const node of forbiddenAfterEventNoop) {
    assert.equal(
      eventNoopReachable.has(node.name),
      false,
      `${node.name} database work follows a duplicate/fresh-owned event no-op`,
    );
  }

  const snapshotNodes = postgresNodes.filter((node) =>
    /tender_analysis_documents/iu.test(node.parameters.query ?? '') &&
    /tender_analysis_field_results/iu.test(node.parameters.query ?? ''));
  assert.ok(snapshotNodes.length >= 1, 'run snapshot must load documents and FINAL barrier state');
  const snapshotSql = normalizeSql(snapshotNodes.map((node) => node.parameters.query).join('\n'));
  for (const fieldKey of expectedFieldKeys) assert.match(snapshotSql, new RegExp(`'${fieldKey}'`, 'u'));
  assert.match(snapshotSql, /count\s*\(\s*distinct\s+field_key\s*\)/iu);
  assert.match(snapshotSql, /status\s+in\s*\(\s*'resolved'\s*,\s*'requires_review'\s*,\s*'not_found'/iu);
  assert.match(snapshotSql, /field_catalog_version\s*=\s*'tender_fields_v1'/iu);
  assert.match(snapshotSql, /result_contract_version\s*=\s*'tender_field_final_v1'/iu);
  assert.match(snapshotSql, /missing_(?:fields|keys)|unexpected_(?:fields|keys)/iu);
  assert.match(snapshotSql, /(?:final_count|valid_final_count)\s*=\s*27/iu);

  const finalizationBarrierSql = normalizeSql(requireNode(
    finalization,
    'Проверить 27 FINAL и завершить run',
  ).parameters.query);
  for (const token of [
    'tender_fields_v1',
    'tender_field_final_v1',
    'resolved',
    'requires_review',
    'not_found',
  ]) {
    assert.ok(snapshotSql.includes(token) && finalizationBarrierSql.includes(token));
  }

  const documentDecision = requireNode(
    workflow,
    'Decide Document and Stage Action',
  );
  const analysisRunId = '11111111-1111-4111-8111-111111111111';
  const baseDocument = {
    id: '22222222-2222-4222-8222-222222222222',
    analysis_run_id: analysisRunId,
    document_index: 3,
    file_name: 'terms.pdf',
    file_extension: 'pdf',
    display_name: 'Terms',
    download_url: 'https://files.invalid/terms.pdf',
    publication_at: '2026-09-07T09:00:00.000Z',
    source_size: 1234,
    mime_type: 'application/pdf',
    file_size: 1234,
    status: 'pending',
    attempts: 0,
    started_at: null,
    n8n_execution_id: null,
  };
  const decisionInput = (overrides = {}) => ({
    trigger_kind: 'tenderplan_mark',
    manual_override: false,
    analysis_run_id: analysisRunId,
    run_status: 'processing',
    final_count: 0,
    final_barrier_valid: false,
    documents: [],
    ...overrides,
  });
  const expectedAttachment = {
    document_id: baseDocument.id,
    document_index: baseDocument.document_index,
    file_name: baseDocument.file_name,
    file_extension: baseDocument.file_extension,
    display_name: baseDocument.display_name,
    download_url: baseDocument.download_url,
    publication_at: baseDocument.publication_at,
    source_size: baseDocument.source_size,
    mime_type: baseDocument.mime_type,
    file_size: baseDocument.file_size,
    status: baseDocument.status,
  };

  const mixedDocumentDecision = await executeSingleCodeJson(documentDecision, decisionInput({
    documents: [
      { ...baseDocument, id: '33333333-3333-4333-8333-333333333333', status: 'completed' },
      { ...baseDocument, id: '44444444-4444-4444-8444-444444444444', status: 'skipped' },
      baseDocument,
    ],
  }));
  assert.deepEqual(mixedDocumentDecision.attachments, [expectedAttachment]);
  assert.equal(mixedDocumentDecision.has_documents_to_dispatch, true);
  assert.deepEqual(
    mixedDocumentDecision.document_actions.map(({ id, action }) => ({ id, action })),
    [
      { id: '33333333-3333-4333-8333-333333333333', action: 'skip' },
      { id: '44444444-4444-4444-8444-444444444444', action: 'preserve_skip' },
      { id: baseDocument.id, action: 'dispatch' },
    ],
  );

  const exhaustedAutomatic = await executeSingleCodeJson(documentDecision, decisionInput({
    documents: [{ ...baseDocument, status: 'failed', attempts: 2 }],
  }));
  assert.deepEqual(exhaustedAutomatic.attachments, []);
  assert.equal(exhaustedAutomatic.has_documents_to_dispatch, false);
  assert.equal(exhaustedAutomatic.document_actions[0].action, 'exhausted');
  const exhaustedManual = await executeSingleCodeJson(documentDecision, decisionInput({
    trigger_kind: 'manual',
    manual_override: true,
    documents: [{ ...baseDocument, status: 'failed', attempts: 2 }],
  }));
  assert.deepEqual(exhaustedManual.attachments, [
    { ...expectedAttachment, status: 'failed' },
  ]);
  assert.equal(exhaustedManual.has_documents_to_dispatch, true);
  assert.equal(exhaustedManual.document_actions[0].action, 'dispatch');

  const completedRunDecision = await executeSingleCodeJson(documentDecision, decisionInput({
    run_status: 'completed',
    final_count: 27,
    final_barrier_valid: true,
    documents: [baseDocument],
  }));
  assert.deepEqual(completedRunDecision.attachments, []);
  assert.equal(completedRunDecision.has_documents_to_dispatch, false);
  assert.equal(completedRunDecision.document_actions[0].action, 'skip_run_completed');
  assert.equal(completedRunDecision.stage_action, 'already_completed');

  const invalidFinalBarrierDecision = await executeSingleCodeJson(documentDecision, decisionInput({
    run_status: 'aggregating',
    final_count: 27,
    final_barrier_valid: false,
  }));
  assert.equal(invalidFinalBarrierDecision.final_count, 27);
  assert.equal(invalidFinalBarrierDecision.final_barrier_valid, false);
  assert.equal(invalidFinalBarrierDecision.should_start_finalization, false);
  assert.equal(invalidFinalBarrierDecision.stage_action, 'manual_attention_required');
  const validFinalBarrierDecision = await executeSingleCodeJson(documentDecision, decisionInput({
    run_status: 'aggregating',
    final_count: 27,
    final_barrier_valid: true,
  }));
  assert.equal(validFinalBarrierDecision.final_barrier_valid, true);
  assert.equal(validFinalBarrierDecision.should_start_finalization, true);
  assert.equal(validFinalBarrierDecision.stage_action, 'call_finalization');

  assert.doesNotMatch(
    documentDecision.parameters.jsCode,
    /attempts\s*(?:\+\+|\+=|=\s*[^=;]+\+\s*1)/u,
  );

  const documentExecutionHttp = requireNode(workflow, 'Read Document Owner Execution');
  const eventExecutionHttp = requireNode(workflow, 'Read Intake Event Owner Execution');
  for (const node of [eventExecutionHttp, documentExecutionHttp]) {
    assert.equal(node.type, 'n8n-nodes-base.httpRequest');
    assert.equal(node.typeVersion, 4.4);
    assert.equal(node.parameters.authentication, 'genericCredentialType');
    assert.equal(node.parameters.genericAuthType, 'httpHeaderAuth');
    assert.equal(Object.hasOwn(node, 'credentials'), false, `${node.name} must remain unbound in repository packaging`);
    assert.match(node.parameters.url, /\$vars\.N8N_TENDER_BASE_URL/u);
    assert.match(node.parameters.url, /\/api\/v1\/executions\//u);
    assert.match(node.parameters.url, /includeData=false/u);
    assert.doesNotMatch(node.parameters.url, /\$env\./u);
    assert.doesNotMatch(node.parameters.url, /https?:\/\/[a-z0-9]/iu);
    assert.equal(node.parameters.options.response.response.fullResponse, true);
    assert.equal(node.parameters.options.response.response.neverError, true);
    assert.equal(node.parameters.options.response.response.responseFormat, 'json');
    assert.equal(node.onError, 'continueRegularOutput');
  }

  const eventObservationNormalizer = requireNode(
    workflow,
    'Classify Intake Event Owner Execution',
  );
  const documentObservationNormalizer = requireNode(
    workflow,
    'Classify Document Execution Observations',
  );
  const executionObservationCases = [
    ...['new', 'running', 'waiting'].map((status) => ({
      name: status,
      input: {
        owner_id: `owner-${status}`,
        statusCode: 200,
        body: { id: `execution-${status}`, status, finished: false },
      },
      expected: { execution_state: status, execution_observation: 'owned', reclaimable: false },
    })),
    ...['success', 'error', 'canceled', 'crashed'].map((status) => ({
      name: status,
      input: {
        owner_id: `owner-${status}`,
        statusCode: 200,
        body: { id: `execution-${status}`, status, finished: true },
      },
      expected: { execution_state: status, execution_observation: 'reclaimable', reclaimable: true },
    })),
    {
      name: 'confirmed HTTP 404',
      input: {
        owner_id: 'owner-not-found',
        statusCode: 404,
        body: { message: 'execution not found' },
      },
      expected: {
        execution_state: 'not_found',
        execution_observation: 'reclaimable',
        reclaimable: true,
      },
    },
    {
      name: 'API unavailable',
      input: {
        owner_id: 'owner-api-unavailable',
        statusCode: 503,
        body: { message: 'service unavailable' },
      },
      expected: { execution_observation: 'unavailable', reclaimable: false },
    },
    {
      name: 'network failure',
      input: {
        owner_id: 'owner-network-failure',
        error: { message: 'ECONNREFUSED' },
      },
      expected: { execution_observation: 'unavailable', reclaimable: false },
    },
    {
      name: 'credential failure',
      input: {
        owner_id: 'owner-credential-failure',
        statusCode: 401,
        body: { message: 'unauthorized' },
      },
      expected: { execution_observation: 'unavailable', reclaimable: false },
    },
    {
      name: 'invalid response',
      input: {
        owner_id: 'owner-invalid-response',
        statusCode: 200,
        body: { id: 123, status: 'success', finished: 'true' },
      },
      expected: { execution_observation: 'unavailable', reclaimable: false },
    },
  ];
  const unknownExecutionStatus = {
    owner_id: 'owner-unknown-status',
    statusCode: 200,
    body: { id: 'execution-unknown', status: 'mystery', finished: true },
  };
  for (const normalizer of [eventObservationNormalizer, documentObservationNormalizer]) {
    assert.match(normalizer.parameters.jsCode, /\$\(['"]/u);
    assert.doesNotMatch(normalizer.parameters.jsCode, /\.body(?:\?\.|\.)data|\.body\[['"]data['"]\]/u);
    for (const scenario of executionObservationCases) {
      const normalized = await executeSingleCodeJson(normalizer, scenario.input);
      assert.equal(normalized.owner_id, scenario.input.owner_id, `${normalizer.name}: ${scenario.name}`);
      assert.equal(
        normalized.execution_observation,
        scenario.expected.execution_observation,
        `${normalizer.name}: ${scenario.name}`,
      );
      assert.equal(
        normalized.reclaimable,
        scenario.expected.reclaimable,
        `${normalizer.name}: ${scenario.name}`,
      );
      if (scenario.expected.execution_state !== undefined) {
        assert.equal(
          normalized.execution_state,
          scenario.expected.execution_state,
          `${normalizer.name}: ${scenario.name}`,
        );
      }
    }
    await assert.rejects(
      () => executeSingleCodeJson(normalizer, unknownExecutionStatus),
      /unknown execution (?:status|observation)/iu,
      `${normalizer.name}: syntactically valid unknown status must fail closed`,
    );
  }

  const reclaimDecision = requireNode(workflow, 'Any Reclaimable Documents?');
  const recoveryLoop = workflow.nodes.find((node) =>
    node.type === 'n8n-nodes-base.splitInBatches' && node.parameters.batchSize === 1);
  assert.ok(recoveryLoop, 'stale document recovery must use a bounded one-item loop');
  assert.equal(reclaimDecision.type, 'n8n-nodes-base.if');
  assertIfGateCondition(reclaimDecision, { field: 'reclaimable', equals: true });
  assert.ok(canReach(workflow, 'Read Document Owner Execution', 'CAS Stale Document to Failed'));
  const reclaimTruePath = reachableFromOutput(workflow, reclaimDecision.name, 0);
  const reclaimFalsePath = reachableFromOutput(
    workflow,
    reclaimDecision.name,
    1,
    [recoveryLoop.name],
  );
  assert.ok(reclaimTruePath.has('CAS Stale Document to Failed'));
  assert.equal(
    reclaimFalsePath.has('CAS Stale Document to Failed'),
    false,
    'API-unavailable/invalid/owned route must bypass stale CAS',
  );
  assert.deepEqual(directTargets(workflow, reclaimDecision.name, 1), [recoveryLoop.name]);

  const loopOutputs = workflow.connections[recoveryLoop.name]?.main ?? [];
  assert.equal(loopOutputs.length, 2);
  assert.ok(loopOutputs[0]?.some(({ node }) => /snapshot/i.test(node)));
  const reloadAfterRecovery = requireNode(workflow, 'Reload Run Snapshot After Recovery');
  assert.equal(reloadAfterRecovery.executeOnce, true);
  assert.ok(canReach(workflow, recoveryLoop.name, 'Read Document Owner Execution'));
  assert.ok(canReach(workflow, 'CAS Stale Document to Failed', recoveryLoop.name));
  assert.ok(canReach(workflow, reclaimDecision.name, recoveryLoop.name));
  assert.ok(canReach(workflow, recoveryLoop.name, 'Decide Document and Stage Action'));
  const recoveryQueueCode = requireNode(
    workflow,
    'Prepare Document Recovery Queue',
  ).parameters.jsCode;
  assert.match(recoveryQueueCode, /run_status\s*===\s*['"]completed['"]/u);
  assert.match(recoveryQueueCode, /Malformed processing document owner snapshot/u);
  assert.ok(canReach(workflow, 'CAS Stale Document to Failed', 'Classify Document CAS Result'));
  assert.match(
    requireNode(workflow, 'Classify Document CAS Result').parameters.jsCode,
    /benign_race/u,
  );

  const documentCas = requireNode(workflow, 'CAS Stale Document to Failed');
  const documentCasSql = normalizeSql(documentCas.parameters.query);
  assert.match(documentCasSql, /update (?:public\.)?tender_analysis_documents/iu);
  assert.match(documentCasSql, /set status\s*=\s*'failed'/iu);
  assert.match(documentCasSql, /where .*id\s*=\s*\$\d+::uuid/iu);
  assert.match(documentCasSql, /analysis_run_id\s*=\s*\$\d+::uuid/iu);
  assert.match(documentCasSql, /status\s*=\s*'processing'/iu);
  assert.match(documentCasSql, /n8n_execution_id\s*=\s*\$\d+/iu);
  assert.match(documentCasSql, /started_at\s*=\s*\$\d+::timestamptz/iu);
  assert.match(documentCasSql, /started_at\s*<=\s*\$\d+::timestamptz/iu);
  assert.match(documentCasSql, /returning/iu);
  assert.doesNotMatch(documentCasSql, /attempts\s*=/iu);
  const documentCasParameters = documentCas.parameters.options.queryReplacement;
  for (const field of [
    'id',
    'analysis_run_id',
    'n8n_execution_id',
    'started_at',
    'stale_cutoff',
  ]) assert.match(documentCasParameters, new RegExp(field, 'u'));

  const workerReadinessSql = normalizeSql(requireNode(
    worker,
    'Проверить готовность к агрегации',
  ).parameters.query);
  const dispatcherReadinessSql = normalizeSql(requireNode(
    workflow,
    'Apply Worker Readiness',
  ).parameters.query);
  assert.equal(
    dispatcherReadinessSql,
    workerReadinessSql,
    'dispatcher readiness SQL must remain byte-semantically equivalent to canonical Worker readiness',
  );
  assert.match(dispatcherReadinessSql, /documents_total\s*>\s*0/iu);
  assert.match(dispatcherReadinessSql, /registered_documents_count\s*=\s*s\.documents_total/iu);
  assert.match(dispatcherReadinessSql, /completed_documents_count\s*=\s*s\.documents_total/iu);
  assert.match(dispatcherReadinessSql, /status\s*=\s*'ready_for_aggregation'/iu);

  const splitDispatch = requireNode(workflow, 'Split Dispatch Documents');
  assert.equal(splitDispatch.type, 'n8n-nodes-base.splitOut');
  assert.equal(splitDispatch.parameters.fieldToSplitOut, 'attachments');
  assert.match(splitDispatch.parameters.fieldsToInclude, /analysis_run_id/u);

  const workerCall = requireNode(workflow, 'Dispatch Document Workers');
  assert.equal(workerCall.type, 'n8n-nodes-base.executeWorkflow');
  assert.equal(workerCall.typeVersion, 1.3);
  assert.equal(workerCall.parameters.workflowId.value, '1Pw61ZY3HgBSvcUr');
  assert.equal(workerCall.parameters.mode, 'each');
  assert.equal(workerCall.parameters.options.waitForSubWorkflow, false);
  assert.deepEqual(workerCall.parameters.workflowInputs.value, {});
  assert.ok(canReach(workflow, splitDispatch.name, workerCall.name));

  const dispatchGate = requireNode(workflow, 'Has Documents to Dispatch?');
  assert.equal(dispatchGate.type, 'n8n-nodes-base.if');
  assertIfGateCondition(dispatchGate, {
    field: 'has_documents_to_dispatch',
    equals: true,
  });
  const dispatchTruePath = reachableFromOutput(workflow, dispatchGate.name, 0);
  const dispatchFalsePath = reachableFromOutput(workflow, dispatchGate.name, 1);
  assert.ok(dispatchTruePath.has(splitDispatch.name));
  assert.ok(dispatchTruePath.has(workerCall.name));
  assert.equal(dispatchFalsePath.has(splitDispatch.name), false);
  assert.equal(dispatchFalsePath.has(workerCall.name), false);
  assert.ok(
    dispatchFalsePath.has('Apply Worker Readiness') ||
      dispatchFalsePath.has('Should Start Aggregator?'),
    'false dispatch output must continue into DB-backed stage routing',
  );

  const aggregatorCall = requireNode(workflow, 'Call Aggregator');
  assert.equal(aggregatorCall.parameters.workflowId.value, 'ftvmrEHoMbPOAqZG');
  assert.equal(aggregatorCall.parameters.options.waitForSubWorkflow, false);
  const finalizationCall = requireNode(workflow, 'Call Finalization');
  assert.equal(finalizationCall.parameters.workflowId.value, 'cSsh9yjpS7t5p0OO');
  assert.equal(finalizationCall.parameters.options.waitForSubWorkflow, false);

  const completedRunGate = requireNode(workflow, 'Is Run Already Completed?');
  assert.equal(completedRunGate.type, 'n8n-nodes-base.if');
  assertIfGateCondition(completedRunGate, {
    field: 'stage_action',
    equals: 'already_completed',
  });
  assert.ok(canReach(workflow, documentDecision.name, completedRunGate.name));
  assert.deepEqual(
    directTargets(workflow, completedRunGate.name, 0),
    ['Complete Intake Event'],
  );
  const completedRunPath = reachableFromOutput(workflow, completedRunGate.name, 0);
  const nonCompletedRunPath = reachableFromOutput(workflow, completedRunGate.name, 1);
  assert.ok(nonCompletedRunPath.has(dispatchGate.name));
  assert.equal(completedRunPath.has(dispatchGate.name), false);
  for (const forbiddenNode of [
    'Apply Worker Readiness',
    'Guard Exhausted Run Failure',
    splitDispatch.name,
    workerCall.name,
    aggregatorCall.name,
    finalizationCall.name,
  ]) {
    assert.equal(completedRunPath.has(forbiddenNode), false, `${forbiddenNode} follows completed run`);
  }

  const finalizationGate = requireNode(workflow, 'Should Start Finalization?');
  assert.equal(finalizationGate.type, 'n8n-nodes-base.if');
  assertIfGateCondition(finalizationGate, {
    field: 'should_start_finalization',
    equals: true,
  });
  const finalizationTruePath = reachableFromOutput(workflow, finalizationGate.name, 0);
  const finalizationFalsePath = reachableFromOutput(workflow, finalizationGate.name, 1);
  assert.ok(finalizationTruePath.has(finalizationCall.name));
  assert.ok(finalizationFalsePath.has('Complete Intake Event'));
  assert.equal(
    finalizationFalsePath.has(finalizationCall.name),
    false,
    '27 raw rows with an invalid FINAL barrier must not reach Finalization',
  );

  const runFailureSql = normalizeSql(requireNode(
    workflow,
    'Guard Exhausted Run Failure',
  ).parameters.query);
  assert.match(runFailureSql, /update (?:public\.)?tender_analysis_runs/iu);
  assert.match(runFailureSql, /set status\s*=\s*'failed'/iu);
  assert.match(runFailureSql, /status\s*=\s*'processing'/iu);
  assert.match(runFailureSql, /not exists[\s\S]*status\s*=\s*'pending'/iu);
  assert.match(runFailureSql, /not exists[\s\S]*status\s*=\s*'processing'/iu);
  assert.match(runFailureSql, /exists[\s\S]*status\s*=\s*'failed'[\s\S]*attempts\s*>=\s*2/iu);

  const completeEvent = requireNode(workflow, 'Complete Intake Event');
  const completeEventSql = normalizeSql(completeEvent.parameters.query);
  assert.match(completeEventSql, /update (?:public\.)?tender_analysis_intake_events/iu);
  assert.match(completeEventSql, /set status\s*=\s*'completed'/iu);
  assert.match(completeEventSql, /processed_at\s*=\s*(?:now\(\)|current_timestamp)/iu);
  assert.match(completeEventSql, /action\s*=\s*left\s*\(/iu);
  assert.match(completeEventSql, /error_message\s*=\s*left\s*\(/iu);
  assert.match(completeEventSql, /n8n_execution_id\s*=\s*\$\d+/iu);
  assert.match(completeEventSql, /analysis_run_id\s*=\s*coalesce/iu);
  assert.match(completeEventSql, /completion_applied/iu);
  assert.match(completeEvent.parameters.options.queryReplacement, /\$execution\.id/u);

  const structuredOutcomeCode = requireNode(
    workflow,
    'Return Structured Outcome',
  ).parameters.jsCode;
  assert.match(structuredOutcomeCode, /completion_applied[\s\S]*throw new Error/iu);
  assert.match(structuredOutcomeCode, /allowed\.includes\([^)]+\)[\s\S]*throw new Error/iu);
  assert.match(completeEventSql, /documents_dispatched/iu);
  assert.match(completeEventSql, /run_status/iu);
  assert.ok(canReach(workflow, 'Guard Exhausted Run Failure', 'Preserve Outcome After Run Guard'));
  assert.ok(canReach(workflow, 'Preserve Outcome After Run Guard', 'Complete Intake Event'));

  const reloadSnapshotSql = normalizeSql(requireNode(
    workflow,
    'Reload Run Snapshot After Recovery',
  ).parameters.query);
  assert.match(reloadSnapshotSql, /expected\s*\(\s*field_index\s*,\s*field_key\s*\)/iu);
  for (const [index, fieldKey] of expectedFieldKeys.entries()) {
    assert.match(reloadSnapshotSql, new RegExp(`\\(${index + 1},\\s*'${fieldKey}'\\)`, 'u'));
  }
  assert.ok(canReach(workflow, 'Apply Worker Readiness', 'Classify Post-Readiness Stage'));
  assert.ok(canReach(workflow, 'Classify Post-Readiness Stage', 'Should Start Aggregator?'));

  const outcomeCode = workflow.nodes
    .filter((node) => node.type === 'n8n-nodes-base.code')
    .map((node) => node.parameters.jsCode ?? '')
    .join('\n');
  for (const action of [
    'created_new_run',
    'resumed_documents',
    'waiting_for_workers',
    'aggregation_started',
    'finalization_started',
    'already_completed',
    'duplicate_event',
    'manual_attention_required',
    'automatic_attempts_exhausted',
    'execution_status_unavailable',
  ]) assert.match(outcomeCode, new RegExp(`['"]${action}['"]`, 'u'));
  assert.match(outcomeCode, /throw new Error/iu);

  const packagingNotes = workflow.nodes
    .filter((node) => node.type === 'n8n-nodes-base.stickyNote')
    .map((node) => node.parameters.content ?? '')
    .join('\n');
  assert.match(packagingNotes, /PACKAGING REQUIRED/u);
  assert.match(packagingNotes, /httpHeaderAuth|Header Auth/u);
  assert.match(packagingNotes, /X-N8N-API-KEY/u);
  assert.match(packagingNotes, /N8N_TENDER_BASE_URL/u);
  assert.match(packagingNotes, /TENDER — Ошибка Intake Resume/u);
  assert.match(packagingNotes, /read back|real ID|actual ID/iu);
  assert.match(packagingNotes, /settings\.errorWorkflow/u);
  assert.match(packagingNotes, /inactive|active=false/iu);

  assert.doesNotMatch(exportText, /\$env\./u);
  assert.doesNotMatch(exportText, /N8N_TENDER_READONLY_API_KEY/u);
  assert.doesNotMatch(exportText, /SUPABASE_TENDER_READONLY_(?:PASSWORD|HOST|USER)/u);
  assert.doesNotMatch(exportText, /Bearer\s+[A-Za-z0-9._-]{8,}/u);
  assert.doesNotMatch(exportText, /(?:api[_-]?key|password)\s*[:=]\s*['"][^'"]+['"]/iu);
  assert.equal(
    workflow.nodes.some((node) => node.type === 'n8n-nodes-base.merge'),
    false,
    'PostgreSQL, not Merge, is the durable barrier',
  );

  for (const node of workflow.nodes.filter((candidate) =>
    candidate.type === 'n8n-nodes-base.if')) {
    const outputs = workflow.connections[node.name]?.main ?? [];
    assert.equal(outputs.length, 2, `${node.name} must expose true and false routes`);
    assert.ok(outputs[0]?.length > 0, `${node.name} true route silently drops items`);
    assert.ok(outputs[1]?.length > 0, `${node.name} false route silently drops items`);
  }
  for (const node of workflow.nodes.filter((candidate) =>
    candidate.type === 'n8n-nodes-base.switch')) {
    assert.equal(node.parameters.options?.fallbackOutput, 'extra', `${node.name} needs a fallback route`);
    for (const [index, output] of (workflow.connections[node.name]?.main ?? []).entries()) {
      assert.ok(output.length > 0, `${node.name} output ${index} silently drops items`);
    }
  }

  assert.ok(directTargets(workflow, dispatchGate.name, 0).includes('Complete Intake Event'));
  const aggregatorGate = requireNode(workflow, 'Should Start Aggregator?');
  assertIfGateCondition(aggregatorGate, {
    field: 'stage_action',
    equals: 'call_aggregator',
  });
  const aggregatorTruePath = reachableFromOutput(workflow, aggregatorGate.name, 0);
  const aggregatorFalsePath = reachableFromOutput(workflow, aggregatorGate.name, 1);
  assert.ok(aggregatorTruePath.has('Call Aggregator'));
  assert.ok(aggregatorTruePath.has('Complete Intake Event'));
  assert.equal(aggregatorFalsePath.has('Call Aggregator'), false);
  assert.ok(directTargets(workflow, finalizationGate.name, 0).includes('Call Finalization'));
  assert.ok(directTargets(workflow, finalizationGate.name, 0).includes('Complete Intake Event'));
  assert.ok(canReach(workflow, 'Complete Intake Event', 'Return Structured Outcome'));
  assert.ok(canReach(workflow, classifyEvent.name, 'Return Event No-op'));

  const nonStickyNodes = workflow.nodes.filter((node) =>
    node.type !== 'n8n-nodes-base.stickyNote');
  const leafNames = nonStickyNodes
    .filter((node) => (workflow.connections[node.name]?.main ?? [])
      .every((output) => (output ?? []).length === 0))
    .map((node) => node.name);
  const allowedLeaves = new Set([
    'Dispatch Document Workers',
    'Call Aggregator',
    'Call Finalization',
    'Return Structured Outcome',
    'Return Event No-op',
  ]);
  for (const leafName of leafNames) {
    assert.ok(allowedLeaves.has(leafName), `unexpected silent terminal node: ${leafName}`);
  }
});
