import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  executeWorkflowCodeNode,
  loadAggregatorWorkflow,
  routeCheckedAggregation,
} from './helpers/aggregator-runtime-eval.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..');
const aggregatorWorkflowPath = path.join(
  repositoryRoot,
  'workflows',
  'n8n-exports',
  'beta',
  '[TEST CODEX] TENDER — Агрегация закупки.json',
);
const targetedRecheckWorkflowPath = path.join(
  repositoryRoot,
  'workflows',
  'n8n-exports',
  'TENDER - Targeted Recheck.json',
);
const checkerNodeName = 'Проверить ответ Semantic Aggregator';
const prepareNodeName = 'Подготовить запрос Semantic Aggregator';
const targetedRecheckAdapterNodeName =
  'Подготовить #2 Targeted Recheck Request';
const containmentNote =
  'Полнота составного перечня документов заявки не доказана детерминированно; требуется Targeted Recheck.';
const primaryCountError =
  /\[Semantic Aggregator Validator\] Для resolved ожидается ровно один primary, получено 3/iu;

function factId(index) {
  return `14254000-${String(index + 1).padStart(4, '0')}-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

function buildExecution14254Fixture(fieldKey = 'application_documents') {
  const primaryParts = [
    'Квалификационная часть заявки',
    'Техническая часть заявки',
    'Коммерческая часть заявки',
  ];
  const candidates = Array.from({ length: 124 }, (_, index) => ({
    fact_id: factId(index),
    field_key: fieldKey,
    value_text:
      primaryParts[index] ?? `Подтверждённый документ заявки ${index + 1}`,
    validator_verdict: 'confirmed',
    validator_confidence: 0.98,
    evidence: [
      {
        semantic_block_id: `sb_${String(index + 1).padStart(4, '0')}`,
        quote: primaryParts[index] ?? `Документ заявки ${index + 1}`,
      },
    ],
  }));
  const allowedFactIds = candidates.map(({ fact_id: id }) => id);
  const candidateDecisions = allowedFactIds.map((id, index) => ({
    fact_id: id,
    role: index < 3 ? 'primary' : 'supporting',
    reason:
      index < 3
        ? `${primaryParts[index]} объявлена моделью primary.`
        : 'Поддерживающий документ заявки.',
  }));

  return {
    provenance: {
      source_execution_id: '14254',
      source_workflow_id: 'ftvmrEHoMbPOAqZG',
      source_version_id: '2a0f8aff-a899-4665-a464-0508face767f',
      checker_sha256:
        '32206eb14888b0d4c64ec8d1e3892adda709e960b95636b30ca7269843552ea0',
      model: 'google/gemini-3.7-flash',
      sanitized_offline_shape: true,
    },
    source: {
      analysis_run_id: '00000000-0000-4000-8000-000000014254',
      field_catalog_version: 'tender_fields_v1',
      field_index: fieldKey === 'application_documents' ? 27 : 1,
      field_key: fieldKey,
      candidates_count: 124,
      allowed_fact_ids: allowedFactIds,
      aggregation_input: {
        field_key: fieldKey,
        candidates,
      },
    },
    rawResult: {
      field_key: fieldKey,
      status: 'resolved',
      final_value_text:
        'Квалификационная, техническая и коммерческая части заявки.',
      confidence: 0.98,
      candidate_decisions: candidateDecisions,
      supporting_fact_ids: allowedFactIds.slice(3),
      conflict_fact_ids: [],
      needs_recheck: false,
      recheck_reason_code: null,
      recheck_note: null,
    },
  };
}

function buildApiResponse(result) {
  return {
    id: 'execution-14254-offline-response',
    model: 'google/gemini-3.7-flash',
    choices: [
      {
        finish_reason: 'stop',
        message: { content: JSON.stringify(result) },
      },
    ],
  };
}

async function runChecker(fixture, result = fixture.rawResult) {
  const workflow = loadAggregatorWorkflow(aggregatorWorkflowPath);
  const checked = await executeWorkflowCodeNode({
    workflow,
    nodeName: checkerNodeName,
    inputJson: buildApiResponse(result),
    sourceJsonByNode: {
      [prepareNodeName]: fixture.source,
    },
  });
  return { workflow, checked };
}

test('execution 14254 fixture preserves 124 unique decisions and three observed primary parts', () => {
  const fixture = buildExecution14254Fixture();
  const decisions = fixture.rawResult.candidate_decisions;

  assert.equal(fixture.provenance.source_execution_id, '14254');
  assert.equal(fixture.provenance.model, 'google/gemini-3.7-flash');
  assert.equal(fixture.source.allowed_fact_ids.length, 124);
  assert.equal(new Set(fixture.source.allowed_fact_ids).size, 124);
  assert.equal(decisions.length, 124);
  assert.equal(new Set(decisions.map(({ fact_id: id }) => id)).size, 124);
  assert.equal(decisions.filter(({ role }) => role === 'primary').length, 3);
  assert.match(fixture.rawResult.final_value_text, /квалификацион/iu);
  assert.match(fixture.rawResult.final_value_text, /техническ/iu);
  assert.match(fixture.rawResult.final_value_text, /коммерческ/iu);
  assert.equal(fixture.rawResult.conflict_fact_ids.length, 0);
  assert.equal(fixture.rawResult.status, 'resolved');
  assert.equal(fixture.rawResult.needs_recheck, false);
});

test('execution 14254 application_documents is contained before resolved primary cardinality failure', async () => {
  const fixture = buildExecution14254Fixture();
  const { workflow, checked } = await runChecker(fixture);
  const routed = await routeCheckedAggregation({ workflow, checked });

  assert.equal(checked.aggregation_status, 'requires_recheck');
  assert.equal(checked.needs_recheck, true);
  assert.equal(checked.recheck_reason_code, 'insufficient_evidence');
  assert.equal(checked.recheck_note, containmentNote);
  assert.equal(checked.aggregation_validated, true);
  assert.deepEqual(checked.candidate_decisions, []);
  assert.deepEqual(checked.supporting_fact_ids, []);
  assert.deepEqual(checked.conflict_fact_ids, []);
  assert.deepEqual(
    checked.semantic_aggregator_meta.reported_result,
    fixture.rawResult,
  );
  assert.equal(checked.semantic_aggregator_meta.reported_status, 'resolved');
  assert.equal(
    checked.semantic_aggregator_meta.effective_status,
    'requires_recheck',
  );
  assert.equal(checked.semantic_aggregator_meta.containment_applied, true);
  assert.equal(checked.semantic_aggregator_meta.primary_count, 3);
  assert.equal(
    checked.semantic_aggregator_meta.raw_validation_issue,
    'resolved_primary_count_must_equal_1',
  );
  assert.equal(
    checked.semantic_aggregator_meta.containment_policy,
    'application_documents_round1_requires_recheck_v2',
  );
  assert.equal(routed.route, 'targeted_recheck');
  assert.equal(routed.final, null);
  assert.deepEqual(routed.executed_nodes, []);
  assert.equal(
    workflow.connections['Нужен Targeted Recheck?'].main[0][0].node,
    "Вызов #2 'TENDER - Targeted Recheck'1",
  );
  assert.equal(
    workflow.connections['Нужен Targeted Recheck?'].main[1][0].node,
    'Сформировать FINAL после Round 1',
  );
});

test('Targeted Recheck adapter receives all 124 candidates from aggregation_input', async () => {
  const fixture = buildExecution14254Fixture();
  const { checked } = await runChecker(fixture);
  const targetedRecheckWorkflow = loadAggregatorWorkflow(
    targetedRecheckWorkflowPath,
  );
  const adapted = await executeWorkflowCodeNode({
    workflow: targetedRecheckWorkflow,
    nodeName: targetedRecheckAdapterNodeName,
    inputJson: {
      original_input: checked,
      tender_meta: {},
    },
  });

  assert.equal(adapted.recheck_trigger, 'aggregation_recheck');
  assert.equal(checked.candidate_decisions.length, 0);
  assert.equal(checked.aggregation_input.candidates.length, 124);
  assert.equal(adapted.existing_candidates.length, 124);
  assert.deepEqual(
    adapted.existing_candidates.map(({ fact_id: id }) => id),
    checked.aggregation_input.candidates.map(({ fact_id: id }) => id),
  );
});

test('neutral control: procurement_subject resolved with three primary remains a hard failure', async () => {
  const fixture = buildExecution14254Fixture('procurement_subject');
  await assert.rejects(runChecker(fixture), primaryCountError);
});

test('unknown candidate ID remains a hard failure before containment', async () => {
  const fixture = buildExecution14254Fixture();
  const result = structuredClone(fixture.rawResult);
  result.candidate_decisions[123].fact_id =
    'ffffffff-ffff-4fff-8fff-ffffffffffff';
  await assert.rejects(runChecker(fixture, result), /неизвестный fact_id/iu);
});

test('duplicate candidate ID remains a hard failure before containment', async () => {
  const fixture = buildExecution14254Fixture();
  const result = structuredClone(fixture.rawResult);
  result.candidate_decisions[123].fact_id = result.candidate_decisions[0].fact_id;
  await assert.rejects(runChecker(fixture, result), /fact_id повторяется/iu);
});

test('missing candidate ID remains a hard failure before containment', async () => {
  const fixture = buildExecution14254Fixture();
  const result = structuredClone(fixture.rawResult);
  result.candidate_decisions.pop();
  await assert.rejects(
    runChecker(fixture, result),
    /Ожидалось 124 candidate_decisions, получено 123/iu,
  );
});

test('system prompt explicitly requires exactly one primary for resolved', async () => {
  const workflow = loadAggregatorWorkflow(aggregatorWorkflowPath);
  const fixture = buildExecution14254Fixture();
  const prepared = await executeWorkflowCodeNode({
    workflow,
    nodeName: prepareNodeName,
    inputJson: {
      ...fixture.source,
      candidates: fixture.source.aggregation_input.candidates,
    },
  });

  assert.match(
    prepared.system_prompt,
    /status="resolved"[^]*ровно один[^]*role=primary[^]*все остальные[^]*не primary/iu,
  );
});
