import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  aggregatorWorkflowPath,
  betaAggregatorWorkflowPath,
  executeWorkflowCodeNode,
  loadAggregatorWorkflow,
} from './helpers/aggregator-runtime-eval.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(
  testDirectory,
  'fixtures',
  'aggregator',
  'execution-14398-evaluation-criteria-omission.json',
);
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const workflowPaths = [aggregatorWorkflowPath, betaAggregatorWorkflowPath];
const prepareNodeName = 'Подготовить запрос Semantic Aggregator';
const classifyNodeName = 'Классифицировать omission Semantic Aggregator';
const retryIfNodeName = 'Нужен retry Semantic Aggregator?';
const retryPrepareNodeName = 'Подготовить retry Semantic Aggregator';
const retryHttpNodeName = 'Retry Semantic Aggregator';
const retryCheckerNodeName = 'Проверить retry Semantic Aggregator';
const fallbackNodeName = 'Сформировать technical requires_review Semantic Aggregator';
const checkerNodeName = 'Проверить ответ Semantic Aggregator';

function buildApiResponse(result, id = 'sanitized-execution-14398-response') {
  return {
    id,
    model: 'sanitized-model-id',
    choices: [{
      finish_reason: 'stop',
      message: { content: JSON.stringify(result) },
    }],
    usage: { completion_tokens: 1029 },
  };
}

async function prepare(workflow) {
  return executeWorkflowCodeNode({
    workflow,
    nodeName: prepareNodeName,
    inputJson: fixture.field_item,
  });
}

async function classify(workflow, response, prepared) {
  return executeWorkflowCodeNode({
    workflow,
    nodeName: classifyNodeName,
    inputJson: response,
    sourceJsonByNode: { [prepareNodeName]: prepared },
  });
}

test('execution 14398 fixture is sanitized and preserves the exact 10-to-9 omission class', () => {
  assert.equal(fixture.provenance.source_execution_id, '14398');
  assert.equal(fixture.provenance.field_key, 'evaluation_criteria');
  assert.equal(fixture.provenance.sanitized_execution_derived, true);
  assert.equal(fixture.provenance.client_text_included, false);
  assert.equal(fixture.provenance.run_uuid_included, false);
  assert.equal(fixture.provenance.provider_reasoning_included, false);
  assert.equal(fixture.provenance.credentials_or_secrets_included, false);
  assert.equal(fixture.field_item.candidates.length, 10);
  assert.equal(fixture.initial_result.candidate_decisions.length, 9);
  const allowed = new Set(fixture.field_item.candidates.map(({ fact_id }) => fact_id));
  const reported = fixture.initial_result.candidate_decisions.map(({ fact_id }) => fact_id);
  assert.equal(new Set(reported).size, 9);
  assert.equal(reported.every((factId) => allowed.has(factId)), true);
  assert.deepEqual(
    [...allowed].filter((factId) => !reported.includes(factId)),
    ['14398000-0010-4000-8000-000000000010'],
  );
});

for (const workflowPath of workflowPaths) {
  const label = path.basename(workflowPath);

  test(`${label}: exact-one omission is eligible for one field-local retry`, async () => {
    const workflow = loadAggregatorWorkflow(workflowPath);
    const prepared = await prepare(workflow);
    const initialResponse = buildApiResponse(fixture.initial_result);
    const classified = await classify(workflow, initialResponse, prepared);

    assert.equal(classified.semantic_aggregator_retry_required, true);
    assert.equal(classified.semantic_aggregator_retry_attempt, 1);
    assert.deepEqual(classified.missing_fact_ids, [prepared.allowed_fact_ids[9]]);
    assert.deepEqual(classified.original_ai_response, initialResponse);

    const retryRequest = await executeWorkflowCodeNode({
      workflow,
      nodeName: retryPrepareNodeName,
      inputJson: classified,
      sourceJsonByNode: { [prepareNodeName]: prepared },
    });
    assert.equal(retryRequest.semantic_aggregator_retry_attempt, 2);
    assert.deepEqual(retryRequest.missing_fact_ids, [prepared.allowed_fact_ids[9]]);
    assert.deepEqual(retryRequest.allowed_fact_ids, prepared.allowed_fact_ids);
    assert.deepEqual(retryRequest.aggregation_input, prepared.aggregation_input);
    assert.match(retryRequest.repair_instruction, new RegExp(prepared.allowed_fact_ids[9], 'u'));
    assert.match(retryRequest.repair_instruction, /полный новый JSON/iu);
    assert.match(retryRequest.repair_instruction, /не назначай роль .* автоматически/iu);
  });

  test(`${label}: recovery graph is bounded and converges through the unchanged strict checker`, () => {
    const workflow = loadAggregatorWorkflow(workflowPath);
    const nodeByName = new Map(workflow.nodes.map((node) => [node.name, node]));
    for (const nodeName of [
      classifyNodeName,
      retryIfNodeName,
      retryPrepareNodeName,
      retryHttpNodeName,
      retryCheckerNodeName,
      fallbackNodeName,
    ]) {
      assert.ok(nodeByName.has(nodeName), `Missing recovery node ${nodeName}`);
    }
    assert.deepEqual(
      workflow.connections['Semantic Aggregator'].main[0].map(({ node }) => node),
      [classifyNodeName],
    );
    assert.deepEqual(
      workflow.connections[classifyNodeName].main[0].map(({ node }) => node),
      [retryIfNodeName],
    );
    assert.deepEqual(
      workflow.connections[retryIfNodeName].main.map((branch) => branch.map(({ node }) => node)),
      [[retryPrepareNodeName], [checkerNodeName]],
    );
    assert.deepEqual(
      workflow.connections[retryPrepareNodeName].main[0].map(({ node }) => node),
      [retryHttpNodeName],
    );
    assert.deepEqual(
      workflow.connections[retryHttpNodeName].main[0].map(({ node }) => node),
      [retryCheckerNodeName],
    );
    assert.deepEqual(
      workflow.connections[retryCheckerNodeName].main.map((branch) => branch.map(({ node }) => node)),
      [['Нужен Targeted Recheck?'], [fallbackNodeName]],
    );
    assert.deepEqual(
      workflow.connections[fallbackNodeName].main[0].map(({ node }) => node),
      ['Нормализовать FINAL поле1'],
    );
    assert.deepEqual(
      workflow.connections['Нормализовать FINAL поле1'].main[0].map(({ node }) => node),
      ['Сохранить FINAL результат поля в БД1'],
    );
    assert.equal(
      nodeByName.get(retryCheckerNodeName).parameters.jsCode,
      nodeByName.get(checkerNodeName).parameters.jsCode,
    );
    assert.equal(nodeByName.get(retryCheckerNodeName).onError, 'continueErrorOutput');
    assert.equal(
      nodeByName.get(retryHttpNodeName).parameters.jsonBody,
      nodeByName.get('Semantic Aggregator').parameters.jsonBody,
    );
    assert.deepEqual(
      nodeByName.get(retryHttpNodeName).credentials,
      nodeByName.get('Semantic Aggregator').credentials,
    );
    assert.notEqual(nodeByName.get(retryHttpNodeName).retryOnFail, true);
  });
}

test('all malformed, unknown, duplicate, and role-inconsistent initial paths remain ineligible and strict', async () => {
  const workflow = loadAggregatorWorkflow(betaAggregatorWorkflowPath);
  const prepared = await prepare(workflow);
  const cases = [
    ['malformed', { choices: [{ finish_reason: 'stop', message: { content: '{' } }] }],
    ['unknown', (() => {
      const result = structuredClone(fixture.initial_result);
      result.candidate_decisions[8].fact_id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
      return buildApiResponse(result);
    })()],
    ['duplicate', (() => {
      const result = structuredClone(fixture.initial_result);
      result.candidate_decisions[8].fact_id = result.candidate_decisions[7].fact_id;
      return buildApiResponse(result);
    })()],
    ['role inconsistency', (() => {
      const result = structuredClone(fixture.initial_result);
      result.candidate_decisions[8].role = 'conflict';
      return buildApiResponse(result);
    })()],
  ];

  for (const [caseName, response] of cases) {
    const classified = await classify(workflow, response, prepared);
    assert.equal(classified.semantic_aggregator_retry_required, false, caseName);
    await assert.rejects(
      executeWorkflowCodeNode({
        workflow,
        nodeName: checkerNodeName,
        inputJson: response,
        sourceJsonByNode: { [prepareNodeName]: prepared },
      }),
      undefined,
      caseName,
    );
  }
});

test('a complete retry response passes the byte-identical strict validator with exact ID cardinality', async () => {
  const workflow = loadAggregatorWorkflow(betaAggregatorWorkflowPath);
  const prepared = await prepare(workflow);
  const completeResult = structuredClone(fixture.initial_result);
  completeResult.candidate_decisions.push({
    fact_id: prepared.allowed_fact_ids[9],
    role: 'complement',
    reason: 'Synthetic retry decision inferred from the candidate.',
  });
  const checked = await executeWorkflowCodeNode({
    workflow,
    nodeName: retryCheckerNodeName,
    inputJson: buildApiResponse(completeResult, 'sanitized-retry-response'),
    sourceJsonByNode: { [prepareNodeName]: prepared },
  });
  assert.equal(checked.aggregation_validated, true);
  assert.equal(checked.candidate_decisions.length, 10);
  assert.deepEqual(
    new Set(checked.candidate_decisions.map(({ fact_id }) => fact_id)),
    new Set(prepared.allowed_fact_ids),
  );
});

test('a second invalid response becomes terminal technical requires_review without accepting its decisions', async () => {
  const workflow = loadAggregatorWorkflow(betaAggregatorWorkflowPath);
  const prepared = await prepare(workflow);
  const classified = await classify(
    workflow,
    buildApiResponse(fixture.initial_result),
    prepared,
  );
  const fallback = await executeWorkflowCodeNode({
    workflow,
    nodeName: fallbackNodeName,
    inputJson: {
      ...buildApiResponse(fixture.initial_result, 'sanitized-invalid-retry-response'),
      error: {
        message: '[Semantic Aggregator Validator] Ожидалось 10 candidate_decisions, получено 9',
      },
    },
    sourceJsonByNode: {
      [prepareNodeName]: prepared,
      [classifyNodeName]: classified,
    },
  });

  assert.equal(fallback.aggregation_status, 'requires_review');
  assert.equal(fallback.needs_recheck, false);
  assert.equal(fallback.aggregation_validated, true);
  assert.equal(fallback.final_value_text, null);
  assert.equal(fallback.confidence, null);
  assert.deepEqual(fallback.candidate_decisions, []);
  assert.deepEqual(fallback.supporting_fact_ids, []);
  assert.deepEqual(fallback.conflict_fact_ids, []);
  assert.equal(fallback.review_reason_code, 'semantic_aggregator_model_validation_failed');
  assert.equal(fallback.semantic_aggregator_meta.technical_fallback_required, true);
  assert.equal(fallback.semantic_aggregator_meta.retry_attempts, 1);
  assert.deepEqual(fallback.semantic_aggregator_meta.missing_fact_ids, prepared.allowed_fact_ids.slice(9));
  assert.deepEqual(fallback.semantic_aggregator_meta.original_ai_response, classified.original_ai_response);
  assert.equal(
    fallback.semantic_aggregator_meta.retry_ai_response.id,
    'sanitized-invalid-retry-response',
  );
  assert.match(fallback.semantic_aggregator_meta.retry_validation_error.message, /Ожидалось 10/iu);

  const normalized = await executeWorkflowCodeNode({
    workflow,
    nodeName: 'Нормализовать FINAL поле1',
    inputJson: fallback,
  });
  assert.equal(normalized.status, 'requires_review');
  assert.equal(normalized.value_text, null);
  assert.equal(normalized.requires_human_review, true);
  assert.equal(normalized.resolution_method, 'semantic_aggregator_technical_fallback');
  assert.deepEqual(normalized.audit.candidate_decisions, []);
  assert.equal(normalized.audit.semantic_aggregator_meta.accepted_model_decisions, false);
});
