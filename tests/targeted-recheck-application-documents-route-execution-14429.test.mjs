import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  executeWorkflowCodeNode,
  loadAggregatorWorkflow,
} from './helpers/aggregator-runtime-eval.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const workflowPath = path.join(
  testDirectory,
  '..',
  'workflows',
  'n8n-exports',
  'TENDER - Targeted Recheck.json',
);
const fixturePath = path.join(
  testDirectory,
  'fixtures',
  'targeted-recheck',
  'execution-14429-application-documents-route.json',
);
const routeNodeName = 'Определить путь после Validator';
const directRouteNodeName = 'Можно завершить без Round 2?';
const round2CollectorNodeName = 'Собрать candidates для Round 2';
const round2HttpNodeName = 'Semantic Aggregator1';
const terminalReviewNodeName = 'Сформировать requires_review — Round 2 запрещён';
const terminalReviewNormalizerNodeName = 'Нормализовать FINAL поле8';
const terminalReviewSaveNodeName = 'Сохранить FINAL результат поля в БД8';
const terminalReviewFinalizerInputNodeName = 'Подготовить вызов Finalizer8';
const terminalReviewFinalizerNodeName = "Call 'TENDER — Финализация анализа'8";
const sharedExistingCandidateNormalizerNodeName = 'Нормализовать FINAL поле5';
const allowedRound2FieldKeys = [
  'procurement_subject',
  'nm_price_with_vat',
  'delivery_term',
  'warranty_obligations_guarantee',
];
const allFieldKeys = [
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
const forbiddenRound2FieldKeys = allFieldKeys.filter(
  (fieldKey) => !allowedRound2FieldKeys.includes(fieldKey),
);
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

function nextNodes(workflow, nodeName, outputIndex = 0) {
  return (workflow.connections[nodeName]?.main?.[outputIndex] ?? []).map(
    ({ node }) => node,
  );
}

function evaluateIfOutput(node, inputJson) {
  const conditions = node.parameters?.conditions?.conditions;
  assert.equal(conditions?.length, 1, `${node.name} must have one condition.`);
  const expression = conditions[0].leftValue;
  assert.match(expression, /^=\{\{[\s\S]*\}\}$/u);
  const source = expression.slice(3, -2).trim();
  const result = new vm.Script(`(${source})`).runInNewContext({
    $json: structuredClone(inputJson),
  });
  assert.equal(typeof result, 'boolean');
  return result ? 0 : 1;
}

async function tracePostValidatorGraph({ workflow, inputJson }) {
  const executedNodes = [];
  let currentName = routeNodeName;
  let currentJson = structuredClone(inputJson);

  for (let step = 0; step < 12; step += 1) {
    const node = workflow.nodes.find(({ name }) => name === currentName);
    assert.ok(node, `Missing workflow node ${currentName}.`);
    executedNodes.push(currentName);

    if (node.type === 'n8n-nodes-base.httpRequest') {
      return { executedNodes, output: currentJson, stoppedAt: currentName };
    }

    let outputIndex = 0;
    if (node.type === 'n8n-nodes-base.code') {
      currentJson = await executeWorkflowCodeNode({
        workflow,
        nodeName: currentName,
        inputJson: currentJson,
      });
    } else if (node.type === 'n8n-nodes-base.if') {
      outputIndex = evaluateIfOutput(node, currentJson);
    } else {
      return { executedNodes, output: currentJson, stoppedAt: currentName };
    }

    const successors = nextNodes(workflow, currentName, outputIndex);
    assert.equal(
      successors.length,
      1,
      `${currentName} output ${outputIndex} must have exactly one successor.`,
    );
    [currentName] = successors;
  }

  throw new Error('Post-Validator trace exceeded its bounded step count.');
}

function buildRouteInput(fieldKey) {
  return {
    ...structuredClone(fixture.route_input),
    field_key: fieldKey,
    field_index: allFieldKeys.indexOf(fieldKey) + 1,
  };
}

function buildNoInitialCandidatesNonDirectInput(fieldKey = 'application_documents') {
  const input = buildRouteInput(fieldKey);
  input.existing_candidates = [];
  input.original_aggregation = {
    ...input.original_aggregation,
    status: 'no_initial_candidates',
    preliminary_value: null,
    confidence: null,
  };
  input.candidates = input.candidates.map((candidate) => ({
    ...candidate,
    validator_verdict: 'requires_review',
    validator_confidence: 0.7,
    validator_reason_code: 'unsupported_inference',
    validator_reason_note: 'Candidate remains non-direct and needs review.',
  }));
  input.confirmed_count = 0;
  input.requires_review_count = 1;
  return input;
}

test('execution 14429 fixture retains the authoritative observed route symptom', () => {
  assert.equal(fixture.provenance.source_execution_id, '14429');
  assert.equal(
    fixture.provenance.analysis_run_id,
    '535461ec-8969-4e15-ad69-a87c3b9e4747',
  );
  assert.equal(fixture.route_input.field_key, 'application_documents');
  assert.equal(fixture.route_input.recheck_outcome, 'candidate_found');
  assert.equal(fixture.route_input.evidence_validated, true);
  assert.equal(fixture.route_input.validator_validated, true);
  assert.equal(fixture.route_input.existing_candidates.length, 1);
  assert.equal(fixture.route_input.candidates.length, 1);
  assert.match(fixture.provenance.sanitization, /synthetic/iu);
});

test('RED execution 14429 route: application_documents terminates requires_review without reaching common Round 2', async () => {
  const workflow = loadAggregatorWorkflow(workflowPath);
  const route = await executeWorkflowCodeNode({
    workflow,
    nodeName: routeNodeName,
    inputJson: fixture.route_input,
  });
  const trace = await tracePostValidatorGraph({
    workflow,
    inputJson: fixture.route_input,
  });

  assert.equal(route.post_validator_route, 'terminal_requires_review');
  assert.equal(route.post_validator_route_reason, 'field_catalog_round_2_not_allowed');
  assert.ok(trace.executedNodes.includes(terminalReviewNodeName));
  assert.ok(!trace.executedNodes.includes(round2CollectorNodeName));
  assert.ok(!trace.executedNodes.includes(round2HttpNodeName));
  assert.equal(trace.output.status, 'requires_review');
  assert.equal(trace.output.requires_human_review, true);
  assert.equal(trace.output.audit.targeted_recheck_result.route_guard_applied, true);
  assert.equal(
    trace.output.audit.targeted_recheck_result.route_guard_reason,
    'field_catalog_round_2_not_allowed',
  );
  assert.equal(
    trace.output.audit.targeted_recheck_result.usable_candidates.length,
    1,
  );
  assert.equal(
    trace.output.audit.targeted_recheck_result.existing_candidates.length,
    1,
  );
  assert.deepEqual(
    trace.output.audit.targeted_recheck_result.targeted_recheck_meta,
    fixture.route_input.targeted_recheck_meta,
  );
  assert.deepEqual(
    trace.output.audit.targeted_recheck_result.validator_meta,
    fixture.route_input.validator_meta,
  );
  assert.equal(
    trace.output.audit.aggregation_round,
    1,
    'requires_recheck originates from the completed Round 1 aggregation.',
  );
});

for (const fieldKey of allowedRound2FieldKeys) {
  test(`${fieldKey} retains the common Round 2 route when direct-final is unavailable`, async () => {
    const workflow = loadAggregatorWorkflow(workflowPath);
    const route = await executeWorkflowCodeNode({
      workflow,
      nodeName: routeNodeName,
      inputJson: buildRouteInput(fieldKey),
    });
    const trace = await tracePostValidatorGraph({
      workflow,
      inputJson: buildRouteInput(fieldKey),
    });

    assert.equal(route.post_validator_route, 'round_2');
    assert.ok(trace.executedNodes.includes(round2CollectorNodeName));
    assert.equal(trace.stoppedAt, round2HttpNodeName);
  });
}

test('all 23 Round 2 forbidden field keys terminate before common Round 2', async () => {
  const workflow = loadAggregatorWorkflow(workflowPath);
  assert.equal(forbiddenRound2FieldKeys.length, 23);

  for (const fieldKey of forbiddenRound2FieldKeys) {
    const trace = await tracePostValidatorGraph({
      workflow,
      inputJson: buildRouteInput(fieldKey),
    });
    assert.ok(
      trace.executedNodes.includes(terminalReviewNodeName),
      `${fieldKey} did not take the terminal review route.`,
    );
    assert.ok(
      !trace.executedNodes.includes(round2CollectorNodeName),
      `${fieldKey} reached ${round2CollectorNodeName}.`,
    );
    assert.ok(
      !trace.executedNodes.includes(round2HttpNodeName),
      `${fieldKey} reached ${round2HttpNodeName}.`,
    );
    assert.equal(trace.output.status, 'requires_review');
  }
});

test('defense-in-depth: Round 2 collector rejects a forged forbidden route', async () => {
  const workflow = loadAggregatorWorkflow(workflowPath);
  const routed = await executeWorkflowCodeNode({
    workflow,
    nodeName: routeNodeName,
    inputJson: fixture.route_input,
  });

  await assert.rejects(
    executeWorkflowCodeNode({
      workflow,
      nodeName: round2CollectorNodeName,
      inputJson: {
        ...routed,
        post_validator_route: 'round_2',
      },
    }),
    /Round 2 запрещён.*application_documents/iu,
  );
});

test('application_documents keeps the existing direct-final contract when its preconditions are met', async () => {
  const workflow = loadAggregatorWorkflow(workflowPath);
  const input = buildRouteInput('application_documents');
  input.existing_candidates = [];
  input.original_aggregation = {
    ...input.original_aggregation,
    status: 'no_initial_candidates',
    preliminary_value: null,
  };
  const route = await executeWorkflowCodeNode({
    workflow,
    nodeName: routeNodeName,
    inputJson: input,
  });

  assert.equal(route.post_validator_route, 'direct_final');
  assert.equal(
    route.post_validator_route_reason,
    'no_initial_candidates_single_confirmed_recheck_candidate',
  );
});

test('post-Validator graph retains a dedicated guard between direct-final and Round 2 collection', () => {
  const workflow = loadAggregatorWorkflow(workflowPath);
  assert.deepEqual(nextNodes(workflow, routeNodeName), [directRouteNodeName]);
  assert.ok(workflow.nodes.some(({ name }) => name === terminalReviewNodeName));
  assert.notDeepEqual(nextNodes(workflow, directRouteNodeName, 1), [round2CollectorNodeName]);
});

test('terminal requires_review owns a dedicated duplicated normalizer, UPSERT, and Finalizer chain', () => {
  const workflow = loadAggregatorWorkflow(workflowPath);
  const nodesByName = new Map(workflow.nodes.map((node) => [node.name, node]));
  const nodeNames = new Set(nodesByName.keys());

  for (const nodeName of [
    terminalReviewNormalizerNodeName,
    terminalReviewSaveNodeName,
    terminalReviewFinalizerInputNodeName,
    terminalReviewFinalizerNodeName,
  ]) {
    assert.ok(nodeNames.has(nodeName), `Missing dedicated terminal node ${nodeName}.`);
  }

  const duplicatePairs = [
    ['Нормализовать FINAL поле5', terminalReviewNormalizerNodeName],
    ['Сохранить FINAL результат поля в БД5', terminalReviewSaveNodeName],
    ['Подготовить вызов Finalizer2', terminalReviewFinalizerInputNodeName],
    ["Call 'TENDER — Финализация анализа'2", terminalReviewFinalizerNodeName],
  ];
  for (const [sourceName, duplicateName] of duplicatePairs) {
    const source = structuredClone(nodesByName.get(sourceName));
    const duplicate = structuredClone(nodesByName.get(duplicateName));
    assert.ok(source, `Missing source contract node ${sourceName}.`);
    assert.ok(duplicate, `Missing duplicated contract node ${duplicateName}.`);
    assert.notEqual(duplicate.id, source.id, `${duplicateName} must own a unique stable ID.`);
    for (const node of [source, duplicate]) {
      delete node.id;
      delete node.name;
      delete node.position;
    }
    assert.deepEqual(
      duplicate,
      source,
      `${duplicateName} must preserve the exact ${sourceName} node contract.`,
    );
  }

  assert.deepEqual(nextNodes(workflow, terminalReviewNodeName), [
    terminalReviewNormalizerNodeName,
  ]);
  assert.notDeepEqual(nextNodes(workflow, terminalReviewNodeName), [
    sharedExistingCandidateNormalizerNodeName,
  ]);
  assert.deepEqual(nextNodes(workflow, terminalReviewNormalizerNodeName), [
    terminalReviewSaveNodeName,
  ]);
  assert.deepEqual(nextNodes(workflow, terminalReviewSaveNodeName), [
    terminalReviewFinalizerInputNodeName,
  ]);
  assert.deepEqual(nextNodes(workflow, terminalReviewFinalizerInputNodeName), [
    terminalReviewFinalizerNodeName,
  ]);
  assert.deepEqual(nextNodes(workflow, terminalReviewFinalizerNodeName), []);
});

test('no_initial_candidates non-direct terminal route normalizes without fabricated Round 1 audit provenance', async () => {
  const workflow = loadAggregatorWorkflow(workflowPath);
  const input = buildNoInitialCandidatesNonDirectInput();
  const routed = await executeWorkflowCodeNode({
    workflow,
    nodeName: routeNodeName,
    inputJson: input,
  });
  assert.equal(routed.post_validator_route, 'terminal_requires_review');

  const terminal = await executeWorkflowCodeNode({
    workflow,
    nodeName: terminalReviewNodeName,
    inputJson: routed,
  });
  assert.equal(
    terminal.aggregation_round,
    null,
    'no_initial_candidates must not claim that Round 1 aggregation ran.',
  );

  const normalized = await executeWorkflowCodeNode({
    workflow,
    nodeName: terminalReviewNormalizerNodeName,
    inputJson: terminal,
  });
  assert.equal(normalized.result_contract_version, 'tender_field_final_v1');
  assert.equal(normalized.status, 'requires_review');
  assert.equal(normalized.audit.aggregation_round, null);
});
