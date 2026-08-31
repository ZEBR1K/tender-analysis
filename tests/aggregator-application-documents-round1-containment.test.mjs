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
const workflowPath = path.join(
  testDirectory,
  '..',
  'workflows',
  'n8n-exports',
  'beta',
  '[TEST CODEX] TENDER — Агрегация закупки.json',
);
const checkerNodeName = 'Проверить ответ Semantic Aggregator';
const sourceNodeName = 'Подготовить запрос Semantic Aggregator';
const containmentNote =
  'Полнота составного перечня документов заявки не доказана детерминированно; требуется Targeted Recheck.';

function fixtureFactId(index) {
  return `14252000-${String(index + 1).padStart(4, '0')}-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

function buildExecution14252Shape(fieldKey = 'application_documents') {
  const materialFragments = Array.from(
    { length: 17 },
    (_, index) => `Материальный фрагмент ${index + 1}`,
  );
  const candidates = Array.from({ length: 124 }, (_, index) => ({
    fact_id: fixtureFactId(index),
    field_key: fieldKey,
    value_text: materialFragments[index % materialFragments.length],
    validator_verdict: 'confirmed',
    evidence: [
      {
        analysis_unit_id: `doc_2_au_${String(index + 1).padStart(4, '0')}`,
        semantic_block_id: `sb_${String(index + 1).padStart(4, '0')}`,
        quote: materialFragments[index % materialFragments.length],
        provenance: {
          source_execution_id: '14252',
          fixture_only: true,
        },
      },
    ],
  }));
  const allowedFactIds = candidates.map(({ fact_id: factId }) => factId);

  return {
    provenance: {
      source_execution_id: '14252',
      observed_candidate_decisions: 124,
      observed_material_fragments: 17,
      observed_final_material_fragments: 1,
      sanitized_offline_shape: true,
    },
    materialFragments,
    source: {
      analysis_run_id: '00000000-0000-4000-8000-000000014252',
      field_catalog_version: 'tender_fields_v1',
      field_index: fieldKey === 'application_documents' ? 27 : 1,
      field_key: fieldKey,
      candidates_count: candidates.length,
      allowed_fact_ids: allowedFactIds,
      aggregation_input: {
        field_key: fieldKey,
        candidates,
        execution_shape: {
          source_execution_id: '14252',
          candidate_count: 124,
        },
      },
    },
    rawResolvedResult: {
      field_key: fieldKey,
      status: 'resolved',
      final_value_text: materialFragments[0],
      confidence: 0.96,
      candidate_decisions: allowedFactIds.map((factId, index) => ({
        fact_id: factId,
        role: index === 0 ? 'primary' : 'complement',
        reason: `Execution-derived structural decision ${index + 1}.`,
      })),
      supporting_fact_ids: [],
      conflict_fact_ids: [],
      needs_recheck: false,
      recheck_reason_code: null,
      recheck_note: null,
    },
  };
}

function buildApiResponse(result) {
  return {
    id: 'execution-14252-offline-response',
    model: 'google/gemini-3.7-flash',
    choices: [
      {
        finish_reason: 'stop',
        message: {
          content: JSON.stringify(result),
        },
      },
    ],
    usage: {
      prompt_tokens: 111,
      completion_tokens: 222,
      total_tokens: 333,
    },
    provider: 'offline-fixture',
  };
}

async function runChecker({ source, result, responseOverride }) {
  const workflow = loadAggregatorWorkflow(workflowPath);
  const checked = await executeWorkflowCodeNode({
    workflow,
    nodeName: checkerNodeName,
    inputJson: responseOverride ?? buildApiResponse(result),
    sourceJsonByNode: {
      [sourceNodeName]: source,
    },
  });
  return { workflow, checked };
}

test('execution 14252 application_documents raw resolved is contained and routed to Targeted Recheck', async () => {
  const fixture = buildExecution14252Shape();
  const { workflow, checked } = await runChecker({
    source: fixture.source,
    result: fixture.rawResolvedResult,
  });
  const routed = await routeCheckedAggregation({ workflow, checked });

  assert.equal(fixture.rawResolvedResult.candidate_decisions.length, 124);
  assert.equal(checked.aggregation_status, 'requires_recheck');
  assert.equal(checked.needs_recheck, true);
  assert.equal(checked.recheck_reason_code, 'insufficient_evidence');
  assert.equal(checked.recheck_note, containmentNote);
  assert.equal(routed.route, 'targeted_recheck');
  assert.equal(routed.final, null);
  assert.deepEqual(routed.executed_nodes, []);
  assert.equal(
    fixture.materialFragments.filter((fragment) =>
      checked.final_value_text.includes(fragment)).length,
    1,
  );
});

test('execution 14252 containment preserves the complete raw and audit payload', async () => {
  const fixture = buildExecution14252Shape();
  const { checked } = await runChecker({
    source: fixture.source,
    result: fixture.rawResolvedResult,
  });

  assert.equal(checked.final_value_text, fixture.rawResolvedResult.final_value_text);
  assert.equal(checked.confidence, 0.96);
  assert.deepEqual(
    checked.candidate_decisions,
    fixture.rawResolvedResult.candidate_decisions,
  );
  assert.deepEqual(checked.supporting_fact_ids, []);
  assert.deepEqual(checked.conflict_fact_ids, []);
  assert.deepEqual(checked.aggregation_input, fixture.source.aggregation_input);
  assert.deepEqual(
    checked.semantic_aggregator_meta.usage,
    buildApiResponse(fixture.rawResolvedResult).usage,
  );
  assert.deepEqual(
    checked.semantic_aggregator_meta.reported_result,
    fixture.rawResolvedResult,
  );
  assert.equal(checked.semantic_aggregator_meta.reported_status, 'resolved');
  assert.equal(
    checked.semantic_aggregator_meta.effective_status,
    'requires_recheck',
  );
  assert.equal(checked.semantic_aggregator_meta.containment_applied, true);
  assert.equal(
    checked.semantic_aggregator_meta.containment_policy,
    'application_documents_round1_requires_recheck_v1',
  );
});

test('application_documents raw requires_recheck preserves reason and is not marked as containment', async () => {
  const fixture = buildExecution14252Shape();
  const result = {
    ...fixture.rawResolvedResult,
    status: 'requires_recheck',
    final_value_text: null,
    confidence: 0.7,
    needs_recheck: true,
    recheck_reason_code: 'ambiguous_scope',
    recheck_note: 'Исходная модель уже запросила Targeted Recheck.',
  };
  const { checked } = await runChecker({ source: fixture.source, result });

  assert.equal(checked.aggregation_status, 'requires_recheck');
  assert.equal(checked.needs_recheck, true);
  assert.equal(checked.recheck_reason_code, result.recheck_reason_code);
  assert.equal(checked.recheck_note, result.recheck_note);
  assert.equal(checked.semantic_aggregator_meta.reported_status, result.status);
  assert.equal(checked.semantic_aggregator_meta.effective_status, result.status);
  assert.equal(checked.semantic_aggregator_meta.containment_applied, false);
  assert.equal(checked.semantic_aggregator_meta.containment_policy, null);
});

test('procurement_subject raw resolved remains resolved without containment', async () => {
  const fixture = buildExecution14252Shape('procurement_subject');
  const { workflow, checked } = await runChecker({
    source: fixture.source,
    result: fixture.rawResolvedResult,
  });
  const routed = await routeCheckedAggregation({ workflow, checked });

  assert.equal(checked.aggregation_status, 'resolved');
  assert.equal(checked.needs_recheck, false);
  assert.equal(checked.recheck_reason_code, null);
  assert.equal(checked.recheck_note, null);
  assert.equal(checked.semantic_aggregator_meta.reported_status, 'resolved');
  assert.equal(checked.semantic_aggregator_meta.effective_status, 'resolved');
  assert.equal(checked.semantic_aggregator_meta.containment_applied, false);
  assert.equal(checked.semantic_aggregator_meta.containment_policy, null);
  assert.equal(routed.route, 'round1_final');
});

test('malformed response remains a hard failure', async () => {
  const fixture = buildExecution14252Shape();
  const malformedResponse = buildApiResponse(fixture.rawResolvedResult);
  malformedResponse.choices[0].message.content = '{not-json';
  await assert.rejects(
    runChecker({
      source: fixture.source,
      responseOverride: malformedResponse,
    }),
    /невалидный JSON/iu,
  );
});

test('unknown candidate decision remains a hard failure', async () => {
  const fixture = buildExecution14252Shape();
  const result = structuredClone(fixture.rawResolvedResult);
  result.candidate_decisions[123].fact_id =
    'ffffffff-ffff-4fff-8fff-ffffffffffff';

  await assert.rejects(
    runChecker({ source: fixture.source, result }),
    /неизвестный fact_id/iu,
  );
});

test('duplicate candidate decision remains a hard failure', async () => {
  const fixture = buildExecution14252Shape();
  const result = structuredClone(fixture.rawResolvedResult);
  result.candidate_decisions[123].fact_id = result.candidate_decisions[0].fact_id;

  await assert.rejects(
    runChecker({ source: fixture.source, result }),
    /fact_id повторяется/iu,
  );
});

test('missing candidate decision remains a hard failure', async () => {
  const fixture = buildExecution14252Shape();
  const result = structuredClone(fixture.rawResolvedResult);
  result.candidate_decisions.pop();

  await assert.rejects(
    runChecker({ source: fixture.source, result }),
    /Ожидалось 124 candidate_decisions, получено 123/iu,
  );
});
