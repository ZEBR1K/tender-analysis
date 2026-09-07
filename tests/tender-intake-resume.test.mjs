import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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

test('workflow export implements the complete typed Intake Resume dispatcher contract', () => {
  assert.equal(
    fs.existsSync(workflowExportPath),
    true,
    `planned export is absent: ${workflowExportPath}`,
  );

  const exportText = fs.readFileSync(workflowExportPath, 'utf8');
  const workflow = JSON.parse(exportText);
  const worker = JSON.parse(fs.readFileSync(workerExportPath, 'utf8'));
  const finalization = JSON.parse(fs.readFileSync(finalizationExportPath, 'utf8'));

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
  const validatorCode = validator.parameters.jsCode;
  for (const literal of [
    'tenderplan_mark',
    'recovery_scan',
    'manual',
    'source_event_key',
    'tender_id',
    'analysis_run_id',
    'manual_override',
    'observed_at',
  ]) assert.match(validatorCode, new RegExp(literal));
  assert.match(validatorCode, /source_event_key[^\n]{0,160}(?:non-empty|required|trim)/iu);
  assert.match(validatorCode, /source_event_key[^\n]{0,220}(?:512|bounded)/iu);
  assert.match(validatorCode, /tenderplan_mark[\s\S]*tender_id[\s\S]*analysis_run_id/iu);
  assert.match(validatorCode, /recovery_scan[\s\S]*analysis_run_id/iu);
  assert.match(validatorCode, /manual[\s\S]*manual_override/iu);
  assert.match(validatorCode, /manual_override\s*!==?\s*(?:true|false)|typeof\s+.*manual_override/iu);
  assert.match(validatorCode, /Date\.parse|toISO|fromISO/iu);
  assert.match(validatorCode, /(?:Z|timezone|offset|[+-]\\d\{2\})/u);
  assert.ok(
    validatorCode.lastIndexOf('new Date') > validatorCode.indexOf('trigger_kind'),
    'current-time observed_at default must occur only after input validation logic starts',
  );

  assert.deepEqual(
    directTargets(workflow, 'Is Run-authoritative Invocation?', 0),
    ['Load Authoritative Run'],
  );
  assert.deepEqual(
    directTargets(workflow, 'Is Run-authoritative Invocation?', 1),
    ['Prepare Event Identity'],
  );
  assert.ok(canReach(workflow, 'Load Authoritative Run', 'Claim New or Failed Intake Event'));
  assert.ok(canReach(workflow, 'Bind Authoritative Run Identity', 'Claim New or Failed Intake Event'));
  assert.ok(canReach(workflow, 'Claim New or Failed Intake Event', 'Resolve TenderPlan Runs'));
  assert.equal(
    canReach(workflow, 'Resolve TenderPlan Runs', 'Claim New or Failed Intake Event'),
    false,
    'TenderPlan event claim must precede run resolution',
  );

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
  const classifyEventCode = requireNode(workflow, 'Classify Intake Event').parameters.jsCode;
  assert.match(classifyEventCode, /completed[\s\S]*processed_at[\s\S]*duplicate_event/iu);
  assert.match(classifyEventCode, /processing[\s\S]*(?:fresh|owned|already_active)/iu);
  assert.match(classifyEventCode, /(?:60\s*\*\s*60\s*\*\s*1000|one.hour)/iu);

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
  assert.ok(canReach(workflow, 'Classify Intake Event Owner Execution', 'Return Event No-op'));

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

  const documentDecisionCode = requireNode(
    workflow,
    'Decide Document and Stage Action',
  ).parameters.jsCode;
  assert.match(documentDecisionCode, /completed[\s\S]*(?:skip|skipped)/iu);
  assert.match(documentDecisionCode, /skipped[\s\S]*(?:preserve|skip)/iu);
  assert.match(documentDecisionCode, /pending[\s\S]*failed[\s\S]*attempts\s*<\s*2/iu);
  assert.match(documentDecisionCode, /manual[\s\S]*manual_override/iu);
  assert.match(documentDecisionCode, /tenderplan_mark[\s\S]*(?:automatic|attempts)/iu);
  assert.match(documentDecisionCode, /execution_status_unavailable/iu);
  assert.match(documentDecisionCode, /automatic_attempts_exhausted/iu);
  assert.doesNotMatch(documentDecisionCode, /attempts\s*(?:\+\+|\+=|=\s*[^=;]+\+\s*1)/u);

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

  const observationCode = requireNode(
    workflow,
    'Classify Document Execution Observations',
  ).parameters.jsCode;
  assert.match(observationCode, /statusCode/iu);
  assert.match(observationCode, /\.body|body\s*=/iu);
  assert.match(observationCode, /finished/iu);
  for (const state of ['new', 'running', 'waiting', 'success', 'error', 'canceled', 'crashed']) {
    assert.match(observationCode, new RegExp(`['"]${state}['"]`, 'u'));
  }
  assert.match(observationCode, /404[\s\S]*not_found/iu);
  assert.match(observationCode, /(?:network|credential|invalid|unavailable)/iu);
  assert.doesNotMatch(
    observationCode,
    /\.data(?:\?\.|\.)status|\.data\[['"]status['"]\]/u,
  );

  const reclaimDecision = requireNode(workflow, 'Any Reclaimable Documents?');
  assert.equal(reclaimDecision.type, 'n8n-nodes-base.if');
  assert.ok(canReach(workflow, 'Read Document Owner Execution', 'CAS Stale Document to Failed'));
  const reclaimTrueTargets = directTargets(workflow, reclaimDecision.name, 0);
  const reclaimFalseTargets = directTargets(workflow, reclaimDecision.name, 1);
  assert.ok(reclaimTrueTargets.some((name) => canReach(workflow, name, 'CAS Stale Document to Failed')));
  assert.ok(reclaimFalseTargets.length > 0);
  assert.equal(
    reclaimFalseTargets.some((name) => canReach(workflow, name, 'CAS Stale Document to Failed')),
    false,
    'API-unavailable/invalid/owned route must bypass stale CAS',
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
  for (const field of [
    'document_id',
    'document_index',
    'file_name',
    'file_extension',
    'display_name',
    'download_url',
    'publication_at',
    'source_size',
    'mime_type',
    'file_size',
    'status',
  ]) assert.match(documentDecisionCode, new RegExp(field, 'u'));

  const workerCall = requireNode(workflow, 'Dispatch Document Workers');
  assert.equal(workerCall.type, 'n8n-nodes-base.executeWorkflow');
  assert.equal(workerCall.typeVersion, 1.3);
  assert.equal(workerCall.parameters.workflowId.value, '1Pw61ZY3HgBSvcUr');
  assert.equal(workerCall.parameters.mode, 'each');
  assert.equal(workerCall.parameters.options.waitForSubWorkflow, false);
  assert.deepEqual(workerCall.parameters.workflowInputs.value, {});

  const aggregatorCall = requireNode(workflow, 'Call Aggregator');
  assert.equal(aggregatorCall.parameters.workflowId.value, 'ftvmrEHoMbPOAqZG');
  assert.equal(aggregatorCall.parameters.options.waitForSubWorkflow, false);
  const finalizationCall = requireNode(workflow, 'Call Finalization');
  assert.equal(finalizationCall.parameters.workflowId.value, 'cSsh9yjpS7t5p0OO');
  assert.equal(finalizationCall.parameters.options.waitForSubWorkflow, false);
  assert.ok(canReach(workflow, 'Decide Document and Stage Action', 'Apply Worker Readiness'));
  assert.ok(canReach(workflow, 'Decide Document and Stage Action', 'Call Aggregator'));
  assert.ok(canReach(workflow, 'Decide Document and Stage Action', 'Call Finalization'));

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
  assert.match(completeEvent.parameters.options.queryReplacement, /\$execution\.id/u);

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

  const dispatchBranchTargets = directTargets(workflow, 'Has Documents to Dispatch?', 0);
  assert.ok(dispatchBranchTargets.includes('Split Dispatch Documents'));
  assert.ok(dispatchBranchTargets.includes('Complete Intake Event'));
  const aggregatorBranchTargets = directTargets(workflow, 'Should Start Aggregator?', 0);
  assert.ok(aggregatorBranchTargets.includes('Call Aggregator'));
  assert.ok(aggregatorBranchTargets.includes('Complete Intake Event'));
  const finalizationBranchTargets = directTargets(workflow, 'Should Start Finalization?', 0);
  assert.ok(finalizationBranchTargets.includes('Call Finalization'));
  assert.ok(finalizationBranchTargets.includes('Complete Intake Event'));
  assert.ok(canReach(workflow, 'Complete Intake Event', 'Return Structured Outcome'));
  assert.ok(canReach(workflow, 'Classify Intake Event', 'Return Event No-op'));

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
