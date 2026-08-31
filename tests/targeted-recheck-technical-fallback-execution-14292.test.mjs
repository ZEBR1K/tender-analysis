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
  'execution-14292-seven-items.json',
);
const checkerNodeName = 'Проверить #2 evidence Targeted Recheck';
const sourceNodeName = 'Подготовить запрос #2 AI Targeted Recheck';
const technicalRouteNodeName = 'Технический fallback после Targeted Recheck?';
const finalizerNodeName = 'Сформировать requires_review после неудачного Targeted Recheck';
const notFoundNodeName = 'Сформировать not_found после Targeted Recheck1';
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

test('execution 14292 fixture is focused and omits repeated context and usage', () => {
  assert.equal(fixture.items.length, 7);
  assert.ok(fs.statSync(fixturePath).size < 150_000);
  assert.deepEqual(
    fixture.items.map(({ source }) => source.allowed_semantic_blocks.length),
    [0, 4, 6, 0, 0, 0, 0],
  );
  for (const item of fixture.items) {
    assert.equal(Object.hasOwn(item.response, 'usage'), false);
    assert.equal(Object.hasOwn(item.source, 'recheck_context'), false);
    assert.equal(Object.hasOwn(item.source, 'system_prompt'), false);
    assert.equal(Object.hasOwn(item.source, 'user_prompt'), false);
    assert.ok(item.source.existing_candidates.length <= 1);
  }
});

function getItem(fieldKey) {
  const item = fixture.items.find(({ field_key: value }) => value === fieldKey);
  assert.ok(item, `Missing execution 14292 fixture item for ${fieldKey}`);
  return structuredClone(item);
}

async function check(item) {
  const workflow = loadAggregatorWorkflow(workflowPath);
  return executeWorkflowCodeNode({
    workflow,
    nodeName: checkerNodeName,
    inputJson: item.response,
    sourceJsonByNode: { [sourceNodeName]: item.source },
  });
}

async function executeDirectCodeNode({ workflow, nodeName, inputJson }) {
  const node = workflow.nodes.find(({ name }) => name === nodeName);
  assert.ok(node?.parameters?.jsCode, `Missing Code node ${nodeName}`);
  const context = vm.createContext({
    $json: structuredClone(inputJson),
    $input: {
      all: () => [{ json: structuredClone(inputJson) }],
      first: () => ({ json: structuredClone(inputJson) }),
      item: { json: structuredClone(inputJson) },
    },
  });
  const result = await new vm.Script(
    `(async () => { ${node.parameters.jsCode}\n })()`,
  ).runInContext(context);
  return JSON.parse(JSON.stringify(result?.json ?? result));
}

const validCases = [
  ['application_deadline', 'insufficient_evidence', 0],
  ['application_review_date', 'candidate_found', 1],
  ['participation_cost', 'insufficient_evidence', 0],
];

for (const [fieldKey, outcome, candidateCount] of validCases) {
  test(`execution 14292 ${fieldKey} remains strictly valid`, async () => {
    const item = getItem(fieldKey);
    const checked = await check(item);

    assert.equal(checked.field_key, fieldKey);
    assert.equal(checked.recheck_outcome, outcome);
    assert.equal(checked.candidates.length, candidateCount);
    assert.equal(checked.evidence_validated, true);
    assert.notEqual(checked.technical_fallback_required, true);
  });
}

const fallbackCases = [
  ['results_date', 'evidence_validation'],
  ['participation_guarantee', 'model_response_contract'],
  ['required_official_certificates', 'model_response_contract'],
  ['application_documents', 'model_response_contract'],
];

for (const [fieldKey, stage] of fallbackCases) {
  test(`execution 14292 ${fieldKey} becomes an audited technical fallback`, async () => {
    const item = getItem(fieldKey);
    const rawContent = item.response.choices[0].message.content;
    const checked = await check(item);

    assert.equal(checked.field_key, fieldKey);
    assert.equal(checked.technical_fallback_required, true);
    assert.equal(checked.technical_fallback_reason_code, 'targeted_recheck_model_validation_failed');
    assert.equal(checked.technical_fallback_stage, stage);
    assert.equal(checked.evidence_validated, false);
    assert.deepEqual(checked.candidates, []);
    assert.equal(checked.targeted_recheck_meta.raw_ai_content, rawContent);
    assert.deepEqual(checked.targeted_recheck_meta.raw_ai_response, item.response);
    assert.match(checked.technical_fallback_error.message, /Targeted Recheck Evidence Validator/u);
    assert.deepEqual(checked.existing_candidates, item.source.existing_candidates);
    assert.deepEqual(checked.original_aggregation, item.source.original_aggregation);
  });
}

test('execution 14292 preserves the exact bad quote and both reported and unique trusted pairs', () => {
  const item = getItem('results_date');
  const parsed = JSON.parse(item.response.choices[0].message.content);
  const evidence = parsed.candidates[0].evidence[4];
  const expected = fixture.provenance.trusted_coordinate_fact;

  assert.deepEqual(
    {
      analysis_unit_id: evidence.analysis_unit_id,
      semantic_block_id: evidence.semantic_block_id,
    },
    expected.reported_pair,
  );
  assert.equal(
    evidence.quote,
    'Строка R33:\n[C2] Место подведения итогов\n\nСтрока R34:\n[C2] Дата и время подведения итогов',
  );
  const exactMatches = item.source.allowed_semantic_blocks.filter(({ text }) =>
    text.replace(/\s+/gu, ' ').trim().includes(evidence.quote.replace(/\s+/gu, ' ').trim()));
  assert.deepEqual(
    exactMatches.map(({ analysis_unit_id, semantic_block_id }) => ({
      analysis_unit_id,
      semantic_block_id,
    })),
    [expected.exact_unique_pair],
  );
});

test('technical fallback finalizes requires_review even when no initial candidate exists', async () => {
  const workflow = loadAggregatorWorkflow(workflowPath);
  const item = getItem('application_documents');
  item.source.existing_candidates = [];
  item.source.recorded_existing_candidate_count = 0;
  item.source.original_aggregation = {
    ...item.source.original_aggregation,
    status: 'no_initial_candidates',
    preliminary_value: null,
  };

  const checked = await check(item);
  const finalized = await executeDirectCodeNode({
    workflow,
    nodeName: finalizerNodeName,
    inputJson: checked,
  });

  assert.equal(finalized.aggregation_status, 'requires_review');
  assert.equal(finalized.final_value_text, null);
  assert.deepEqual(finalized.evidence, []);
  assert.equal(finalized.needs_recheck, false);
  assert.equal(finalized.requires_human_review, true);
  assert.equal(finalized.targeted_recheck_result.evidence_validated, false);
  assert.equal(finalized.targeted_recheck_result.technical_fallback_required, true);
});

test('technical fallback preserves provisional value and evidence when an initial candidate exists', async () => {
  const workflow = loadAggregatorWorkflow(workflowPath);
  const item = getItem('results_date');
  const checked = await check(item);
  const finalized = await executeDirectCodeNode({
    workflow,
    nodeName: finalizerNodeName,
    inputJson: checked,
  });
  const expectedCandidate = item.source.existing_candidates[0];

  assert.equal(finalized.aggregation_status, 'requires_review');
  assert.equal(
    finalized.final_value_text,
    item.source.original_aggregation.preliminary_value ?? expectedCandidate.value_text,
  );
  assert.equal(finalized.selected_candidate.fact_id, expectedCandidate.fact_id);
  assert.deepEqual(finalized.existing_candidates, item.source.existing_candidates);
  assert.deepEqual(
    finalized.evidence.map(({ quote }) => quote),
    expectedCandidate.evidence.map(({ quote }) => quote),
  );
  assert.equal(finalized.targeted_recheck_result.evidence_validated, false);
  assert.equal(finalized.targeted_recheck_result.raw_ai_response.id, item.response.id);
});

test('technical fallback rejects source states outside the two explicit contracts', async () => {
  const workflow = loadAggregatorWorkflow(workflowPath);
  const item = getItem('application_documents');
  item.source.existing_candidates = [];
  item.source.original_aggregation = {
    ...item.source.original_aggregation,
    status: 'resolved',
    preliminary_value: null,
  };
  const checked = await check(item);

  await assert.rejects(
    executeDirectCodeNode({
      workflow,
      nodeName: finalizerNodeName,
      inputJson: checked,
    }),
    /Недопустимый original_aggregation\.status/iu,
  );
});

test('valid fully processed insufficient_evidence retains the existing safe not_found contract', async () => {
  const workflow = loadAggregatorWorkflow(workflowPath);
  const item = getItem('application_deadline');
  item.source.existing_candidates = [];
  item.source.original_aggregation = {
    ...item.source.original_aggregation,
    status: 'no_initial_candidates',
    preliminary_value: null,
  };

  const checked = await check(item);
  assert.equal(checked.recheck_outcome, 'insufficient_evidence');
  assert.equal(checked.evidence_validated, true);
  assert.notEqual(checked.technical_fallback_required, true);

  const finalized = await executeWorkflowCodeNode({
    workflow,
    nodeName: notFoundNodeName,
    inputJson: checked,
  });
  assert.equal(finalized.aggregation_status, 'not_found');
  assert.equal(finalized.final_value_text, null);
});

test('missing upstream source invariants still throw and are not normalized as model fallback', async () => {
  const item = getItem('application_documents');
  delete item.source.field_index;

  await assert.rejects(
    check(item),
    /Нарушен upstream source invariant/iu,
  );
});

test('technical fallback has a dedicated graph route before candidate/not_found branching', () => {
  const workflow = loadAggregatorWorkflow(workflowPath);
  const route = workflow.nodes.find(({ name }) => name === technicalRouteNodeName);
  assert.ok(route, `Missing ${technicalRouteNodeName}`);
  const checkerNext = workflow.connections[checkerNodeName]?.main?.[0]?.[0]?.node;
  assert.equal(checkerNext, technicalRouteNodeName);
  assert.equal(workflow.connections[technicalRouteNodeName].main[0][0].node, finalizerNodeName);
  assert.equal(
    workflow.connections[technicalRouteNodeName].main[1][0].node,
    'Есть candidate после Targeted Recheck?',
  );
});

