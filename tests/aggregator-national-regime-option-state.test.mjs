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
  routeCheckedAggregation,
} from './helpers/aggregator-runtime-eval.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(
  testDirectory,
  'fixtures',
  'aggregator',
  'national-regime-option-state-controls.json',
), 'utf8'));
const workflowPaths = [aggregatorWorkflowPath, betaAggregatorWorkflowPath];

function buildFieldItem(caseFixture) {
  return {
    analysis_run_id: '00000000-0000-4000-8000-000000000011',
    field_catalog_version: 'tender_fields_v1',
    field_index: caseFixture.field_key === 'national_regime' ? 19 : 1,
    field_key: caseFixture.field_key,
    has_candidates: true,
    candidates_count: 1,
    confirmed_count: caseFixture.candidate.validator_verdict === 'confirmed' ? 1 : 0,
    requires_review_count:
      caseFixture.candidate.validator_verdict === 'requires_review' ? 1 : 0,
    source_documents_count: 1,
    source_documents: [],
    candidates: [caseFixture.candidate],
  };
}

function buildResponse(caseFixture) {
  const requiresRecheck = caseFixture.reported_status === 'requires_recheck';
  return {
    id: `fixture-${caseFixture.id}`,
    model: 'fixture-model',
    choices: [{
      finish_reason: 'stop',
      message: {
        content: JSON.stringify({
          field_key: caseFixture.field_key,
          status: caseFixture.reported_status,
          final_value_text:
            caseFixture.reported_final_value_text ?? caseFixture.candidate.value_text,
          confidence: 0.94,
          candidate_decisions: [{
            fact_id: caseFixture.candidate.fact_id,
            role: 'primary',
            reason: 'Fixture primary candidate.',
          }],
          supporting_fact_ids: [],
          conflict_fact_ids: [],
          needs_recheck: requiresRecheck,
          recheck_reason_code: requiresRecheck ? 'insufficient_evidence' : null,
          recheck_note: requiresRecheck ? 'Source response already requires review.' : null,
        }),
      },
    }],
    usage: {},
  };
}

async function runCase(workflowPath, caseFixture) {
  const workflow = loadAggregatorWorkflow(workflowPath);
  const prepared = await executeWorkflowCodeNode({
    workflow,
    nodeName: 'Подготовить запрос Semantic Aggregator',
    inputJson: buildFieldItem(caseFixture),
  });
  const checked = await executeWorkflowCodeNode({
    workflow,
    nodeName: 'Проверить ответ Semantic Aggregator',
    inputJson: buildResponse(caseFixture),
    sourceJsonByNode: { 'Подготовить запрос Semantic Aggregator': prepared },
  });
  return { workflow, prepared, checked };
}

test('fixture is sanitized and covers the required anti-overfit matrix', () => {
  assert.equal(fixture.contract_version, 'national_regime_option_state_controls_v1');
  assert.equal(fixture.provenance.tender_or_run_literals_included, false);
  assert.equal(fixture.cases.length, 7);
  assert.deepEqual(
    fixture.cases.map(({ id }) => id),
    [
      'generic_policy_only',
      'selected_negative_with_provenance',
      'explicit_current_procurement_measure',
      'option_labels_without_state',
      'ambiguous_option_state',
      'raw_requires_recheck_preserved',
      'unrelated_field_resolved',
    ],
  );
});

for (const workflowPath of workflowPaths) {
  const workflowLabel = path.basename(workflowPath);
  for (const caseFixture of fixture.cases) {
    test(`${workflowLabel}: ${caseFixture.id} follows fail-closed applicability`, async () => {
      const { workflow, prepared, checked } = await runCase(workflowPath, caseFixture);
      assert.equal(checked.aggregation_status, caseFixture.expected_status);
      assert.equal(
        checked.semantic_aggregator_meta.applicability_proof_kind ?? null,
        caseFixture.expected_proof_kind,
      );
      assert.deepEqual(
        prepared.aggregation_input.candidates[0].option_state ?? null,
        caseFixture.candidate.option_state ?? null,
      );
      assert.deepEqual(
        prepared.aggregation_input.candidates[0].applicability_proof ?? null,
        caseFixture.candidate.applicability_proof ?? null,
      );

      const routed = await routeCheckedAggregation({ workflow, checked });
      assert.equal(
        routed.route,
        caseFixture.expected_status === 'resolved' ? 'round1_final' : 'targeted_recheck',
      );
      if (
        caseFixture.field_key === 'national_regime' &&
        caseFixture.reported_status === 'resolved' &&
        caseFixture.expected_status === 'requires_recheck'
      ) {
        const reportedResult = JSON.parse(
          buildResponse(caseFixture).choices[0].message.content,
        );
        assert.equal(checked.needs_recheck, true);
        assert.equal(checked.recheck_reason_code, 'insufficient_evidence');
        assert.equal(checked.final_value_text, reportedResult.final_value_text);
        assert.equal(checked.confidence, reportedResult.confidence);
        assert.deepEqual(checked.candidate_decisions, reportedResult.candidate_decisions);
        assert.deepEqual(checked.aggregation_input, prepared.aggregation_input);
        assert.deepEqual(checked.semantic_aggregator_meta.reported_result, reportedResult);
        assert.equal(checked.semantic_aggregator_meta.reported_status, 'resolved');
        assert.equal(checked.semantic_aggregator_meta.containment_applied, true);
        assert.equal(
          checked.semantic_aggregator_meta.containment_policy,
          'national_regime_round1_applicability_v1',
        );
      }
    });
  }
}

const malformedProofCases = [
  {
    id: 'selected proof with audit warning',
    mutate(candidate) {
      candidate.option_state.warnings = [{ code: 'source_quality_issue', message: 'fixture' }];
    },
  },
  {
    id: 'selected proof with mismatched exact label',
    mutate(candidate) {
      candidate.option_state.evidence[0].exact_label = 'Unrelated fixture label';
    },
  },
  {
    id: 'selected proof whose value matches but evidence quote does not',
    mutate(candidate) {
      candidate.evidence[0].quote = 'Generic policy clause without the selected label.';
    },
  },
  {
    id: 'selected proof from the wrong semantic block',
    mutate(candidate) {
      candidate.option_state.evidence[0].semantic_block_id = 'sb_unrelated_option';
    },
  },
  {
    id: 'explicit proof from an untrusted source',
    mutate(candidate) {
      candidate.applicability_proof.source = 'model_output';
    },
    sourceCaseId: 'explicit_current_procurement_measure',
  },
];

for (const workflowPath of workflowPaths) {
  const workflowLabel = path.basename(workflowPath);
  for (const malformed of malformedProofCases) {
    test(`${workflowLabel}: ${malformed.id} cannot authorize resolved`, async () => {
      const sourceCase = fixture.cases.find(
        ({ id }) => id === (malformed.sourceCaseId ?? 'selected_negative_with_provenance'),
      );
      const caseFixture = structuredClone(sourceCase);
      malformed.mutate(caseFixture.candidate);
      caseFixture.expected_status = 'requires_recheck';
      caseFixture.expected_proof_kind = null;
      const { checked } = await runCase(workflowPath, caseFixture);
      assert.equal(checked.aggregation_status, 'requires_recheck');
      assert.equal(checked.needs_recheck, true);
      assert.equal(checked.recheck_reason_code, 'insufficient_evidence');
      assert.equal(checked.semantic_aggregator_meta.applicability_proof_kind, null);
      assert.equal(checked.semantic_aggregator_meta.containment_applied, true);
    });
  }
}

for (const workflowPath of workflowPaths) {
  const workflowLabel = path.basename(workflowPath);
  for (const sourceCaseId of [
    'selected_negative_with_provenance',
    'explicit_current_procurement_measure',
  ]) {
    test(`${workflowLabel}: ${sourceCaseId} proof cannot authorize a different FINAL value`, async () => {
      const caseFixture = structuredClone(
        fixture.cases.find(({ id }) => id === sourceCaseId),
      );
      caseFixture.reported_final_value_text = 'A different unsupported final value.';
      const { checked } = await runCase(workflowPath, caseFixture);
      assert.equal(checked.aggregation_status, 'requires_recheck');
      assert.equal(checked.needs_recheck, true);
      assert.equal(checked.recheck_reason_code, 'insufficient_evidence');
      assert.equal(checked.semantic_aggregator_meta.applicability_proof_kind, null);
      assert.equal(checked.semantic_aggregator_meta.containment_applied, true);
    });
  }
}

test('candidate SQL exposes only structured applicability audit needed by AG-11', () => {
  for (const workflowPath of workflowPaths) {
    const workflow = loadAggregatorWorkflow(workflowPath);
    const query = workflow.nodes.find(({ name }) => name === 'Загрузить факты закупки')
      .parameters.query;
    assert.match(query, /'option_state'\s*,\s*f\.validator_meta\s*->\s*'option_state'/iu);
    assert.match(
      query,
      /'applicability_proof'\s*,\s*f\.validator_meta\s*->\s*'applicability_proof'/iu,
    );
  }
});

test('production guard has no option-label, control-name, tender, or execution literals', () => {
  for (const workflowPath of workflowPaths) {
    const workflow = loadAggregatorWorkflow(workflowPath);
    const checker = workflow.nodes.find(
      ({ name }) => name === 'Проверить ответ Semantic Aggregator',
    ).parameters.jsCode;
    assert.doesNotMatch(checker, /Не применимо|Применяется|activeX\d+|CommonSupplier|14336/iu);
    assert.match(checker, /docx_option_state_fact_audit_v1/u);
    assert.match(checker, /current_procurement_applicability_v1/u);
  }
});
