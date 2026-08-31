import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  executeWorkflowCodeNode,
  loadAggregatorWorkflow,
} from './helpers/aggregator-runtime-eval.mjs';
import { evaluateApplicationDocumentsOracle } from './helpers/application-documents-oracle.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..');
const mutableCanonicalWorkflowPath = path.join(
  repositoryRoot,
  'workflows',
  'n8n-exports',
  'TENDER - Targeted Recheck.json',
);
const applicationDocumentsFixturePath = path.join(
  testDirectory,
  'fixtures',
  'aggregator',
  'execution-14173-application-documents.json',
);
const procurementSubjectFixturePath = path.join(
  testDirectory,
  'fixtures',
  'aggregator',
  'execution-14104-procurement-subject.json',
);
const allowedReviewReasonCodes = new Set([
  'conflicting_candidates',
  'insufficient_evidence',
  'ambiguous_scope',
  'no_reliable_candidate',
  'other',
]);
const round2NodeNames = [
  'Собрать candidates для Round 2',
  'Подготовить запрос #2 Semantic Aggregator',
  'Проверить ответ #2 Semantic Aggregator',
  'Сформировать FINAL после Round 2',
];

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function buildPostValidatorInput({
  fixture,
  groundingFactId,
  syntheticValueText,
}) {
  const field = fixture.aggregator_field_item;
  const groundingCandidate = field.candidates.find(
    ({ fact_id: factId }) => factId === groundingFactId,
  );
  assert.ok(groundingCandidate, `Missing grounding candidate ${groundingFactId}.`);
  assert.equal(groundingCandidate.validator_verdict, 'confirmed');
  assert.ok(groundingCandidate.evidence.length > 0);

  const groundingEvidence = groundingCandidate.evidence[0];
  const syntheticRecheckCandidate = {
    candidate_index: 0,
    value_text: syntheticValueText,
    status: 'found',
    confidence: 0.98,
    evidence: [
      {
        source_type: 'semantic_block',
        analysis_unit_id: groundingCandidate.analysis_unit_id,
        semantic_block_id: groundingEvidence.semantic_block_id,
        quote: groundingEvidence.quote,
      },
    ],
    review_reason_code: null,
    review_note: null,
    validator_verdict: 'confirmed',
    validator_confidence: 0.98,
    validator_reason_code: 'direct_evidence',
    validator_reason_note:
      'Synthetic offline Validator confirmation over execution-derived grounded evidence.',
  };

  return {
    analysis_run_id: field.analysis_run_id,
    field_catalog_version: field.field_catalog_version,
    field_index: field.field_index,
    field_key: field.field_key,
    recheck_attempt: 1,
    recheck_outcome: 'candidate_found',
    recheck_note:
      'Synthetic offline grounded candidate used only to exercise the terminal Round 2 contract.',
    evidence_validated: true,
    validator_validated: true,
    existing_candidates: structuredClone(field.candidates),
    usable_candidates: [syntheticRecheckCandidate],
    original_aggregation: {
      status: 'requires_recheck',
      preliminary_value: null,
      confidence: 0.72,
      recheck_reason_code: 'ambiguous_scope',
      recheck_note: 'Terminal semantic review is required.',
    },
    recheck_profile: {
      title: field.field_key,
      objective: 'Resolve the field from grounded candidates.',
    },
    allowed_metadata: {},
    targeted_recheck_meta: {
      mode: 'synthetic_offline_grounded_control',
      ai_called: false,
    },
    validator_meta: {
      mode: 'synthetic_offline_confirmation',
      ai_called: false,
    },
    post_validator_route: 'round_2',
    post_validator_route_reason:
      'Existing and confirmed recheck candidates require terminal aggregation.',
    rejected_candidates: [],
  };
}

function buildResolvedApiResponse({
  prepared,
  fieldKey,
  finalValueText,
  roleForCandidateRef,
  responseId,
}) {
  const candidateDecisions = prepared.allowed_candidate_refs.map(
    (candidateRef) => {
      const role = roleForCandidateRef(candidateRef);
      return {
        candidate_ref: candidateRef,
        role,
        reason: `Synthetic schema-valid ${role} decision.`,
      };
    },
  );
  const supportingCandidateRefs = candidateDecisions
    .filter(({ role }) =>
      new Set(['supporting', 'duplicate', 'complement']).has(role),
    )
    .map(({ candidate_ref: candidateRef }) => candidateRef);

  return {
    id: responseId,
    model: 'synthetic-offline-no-ai',
    choices: [
      {
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            field_key: fieldKey,
            status: 'resolved',
            final_value_text: finalValueText,
            confidence: 0.98,
            candidate_decisions: candidateDecisions,
            supporting_candidate_refs: supportingCandidateRefs,
            conflict_candidate_refs: [],
            needs_recheck: false,
            review_reason_code: null,
            review_note: null,
          }),
        },
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  };
}

function buildRequiresReviewApiResponse({
  prepared,
  finalValueText,
  reviewReasonCode,
  reviewNote,
}) {
  const response = buildResolvedApiResponse({
    prepared,
    fieldKey: 'application_documents',
    finalValueText,
    responseId: 'synthetic-application-documents-round2-requires-review',
    roleForCandidateRef: (candidateRef) =>
      candidateRef === 'recheck:1:0' ? 'primary' : 'not_applicable',
  });
  const result = JSON.parse(response.choices[0].message.content);

  response.choices[0].message.content = JSON.stringify({
    ...result,
    status: 'requires_review',
    confidence: 0.74,
    review_reason_code: reviewReasonCode,
    review_note: reviewNote,
  });

  return response;
}

async function runMutableCanonicalRound2({ postValidatorInput, responseFactory }) {
  const workflow = loadAggregatorWorkflow(mutableCanonicalWorkflowPath);
  const collected = await executeWorkflowCodeNode({
    workflow,
    nodeName: round2NodeNames[0],
    inputJson: postValidatorInput,
  });
  const prepared = await executeWorkflowCodeNode({
    workflow,
    nodeName: round2NodeNames[1],
    inputJson: collected,
  });
  const checked = await executeWorkflowCodeNode({
    workflow,
    nodeName: round2NodeNames[2],
    inputJson: responseFactory(prepared),
    sourceJsonByNode: {
      'Подготовить запрос #2 Semantic Aggregator': prepared,
    },
  });
  const final = await executeWorkflowCodeNode({
    workflow,
    nodeName: round2NodeNames[3],
    inputJson: checked,
  });

  return { workflow, collected, prepared, checked, final };
}

test('neutral control: mutable canonical Round 2 still permits a grounded procurement_subject resolved result', async () => {
  const fixture = loadJson(procurementSubjectFixturePath);
  const field = fixture.aggregator_field_item;
  const validPrimaryFactId = '14104000-0001-4000-8000-000000000001';
  const invalidScopeFactId = '14104000-0031-4000-8000-000000000031';
  const finalValueText = field.candidates.find(
    ({ fact_id: factId }) => factId === validPrimaryFactId,
  ).value_text;
  const pipeline = await runMutableCanonicalRound2({
    postValidatorInput: buildPostValidatorInput({
      fixture,
      groundingFactId: validPrimaryFactId,
      syntheticValueText: finalValueText,
    }),
    responseFactory: (prepared) =>
      buildResolvedApiResponse({
        prepared,
        fieldKey: 'procurement_subject',
        finalValueText,
        responseId: 'synthetic-procurement-subject-valid-round2-resolved',
        roleForCandidateRef: (candidateRef) => {
          if (candidateRef === `fact:${validPrimaryFactId}`) return 'primary';
          if (candidateRef === `fact:${invalidScopeFactId}`) {
            return 'not_applicable';
          }
          return candidateRef === 'recheck:1:0' ? 'duplicate' : 'supporting';
        },
      }),
  });

  assert.equal(field.field_key, 'procurement_subject');
  assert.equal(pipeline.collected.candidates_count, 5);
  assert.equal(pipeline.checked.aggregation_status, 'resolved');
  assert.equal(pipeline.checked.needs_recheck, false);
  assert.equal(pipeline.final.aggregation_status, 'resolved');
  assert.equal(pipeline.final.requires_human_review, false);
  assert.match(pipeline.final.final_value_text, /стандартные закрытия палуб/iu);
  assert.equal(pipeline.checked.semantic_aggregator_meta.reported_status, 'resolved');
  assert.equal(pipeline.checked.semantic_aggregator_meta.effective_status, 'resolved');
  assert.equal(pipeline.checked.semantic_aggregator_meta.containment_applied, false);
  assert.equal(pipeline.checked.semantic_aggregator_meta.containment_policy, null);
  assert.equal(pipeline.checked.semantic_aggregator_meta.containment_reason, null);
});

test('application_documents Round 2 preserves a raw requires_review response without applying containment', async () => {
  const fixture = loadJson(applicationDocumentsFixturePath);
  const groundingFactId = '74000000-0028-4000-8000-000000000028';
  const provisionalValue =
    'В составе заявки подтверждена отдельная форма; полнота перечня не установлена.';
  const reportedReviewReasonCode = 'ambiguous_scope';
  const reportedReviewNote =
    'Исходный ответ модели требует ручной проверки области применения.';
  const pipeline = await runMutableCanonicalRound2({
    postValidatorInput: buildPostValidatorInput({
      fixture,
      groundingFactId,
      syntheticValueText: provisionalValue,
    }),
    responseFactory: (prepared) =>
      buildRequiresReviewApiResponse({
        prepared,
        finalValueText: provisionalValue,
        reviewReasonCode: reportedReviewReasonCode,
        reviewNote: reportedReviewNote,
      }),
  });

  assert.equal(pipeline.checked.aggregation_status, 'requires_review');
  assert.equal(pipeline.checked.review_reason_code, reportedReviewReasonCode);
  assert.equal(pipeline.checked.review_note, reportedReviewNote);
  assert.equal(pipeline.final.aggregation_status, 'requires_review');
  assert.equal(pipeline.final.review_reason_code, reportedReviewReasonCode);
  assert.equal(pipeline.final.review_note, reportedReviewNote);
  assert.equal(
    pipeline.checked.semantic_aggregator_meta.reported_status,
    'requires_review',
  );
  assert.equal(
    pipeline.checked.semantic_aggregator_meta.effective_status,
    'requires_review',
  );
  assert.equal(pipeline.checked.semantic_aggregator_meta.containment_applied, false);
  assert.equal(pipeline.checked.semantic_aggregator_meta.containment_policy, null);
  assert.equal(pipeline.checked.semantic_aggregator_meta.containment_reason, null);
});

test('RED promotion gate: mutable canonical application_documents Round 2 must terminate as requires_review', async () => {
  const fixture = loadJson(applicationDocumentsFixturePath);
  const field = fixture.aggregator_field_item;
  const groundingFactId = '74000000-0028-4000-8000-000000000028';
  const unresolvedEgripFactId = '74000000-0016-4000-8000-000000000016';
  const partialFinalValue =
    'В состав заявки входит форма согласия на обработку персональных данных.';
  const pipeline = await runMutableCanonicalRound2({
    postValidatorInput: buildPostValidatorInput({
      fixture,
      groundingFactId,
      syntheticValueText: partialFinalValue,
    }),
    responseFactory: (prepared) =>
      buildResolvedApiResponse({
        prepared,
        fieldKey: 'application_documents',
        finalValueText: partialFinalValue,
        responseId: 'synthetic-application-documents-partial-round2-resolved',
        roleForCandidateRef: (candidateRef) =>
          candidateRef === 'recheck:1:0' ? 'primary' : 'not_applicable',
      }),
  });
  const unresolvedEgripCandidate = field.candidates.find(
    ({ fact_id: factId }) => factId === unresolvedEgripFactId,
  );

  assert.equal(fixture.provenance.source_execution_id, '14173');
  assert.equal(field.candidates.length, 28);
  assert.equal(pipeline.collected.candidates_count, 29);
  assert.equal(pipeline.prepared.allowed_candidate_refs.length, 29);

  assert.equal(pipeline.checked.aggregation_status, 'requires_review');
  assert.equal(pipeline.checked.needs_recheck, false);
  assert.ok(pipeline.final, 'Round 2 must materialize a terminal FINAL.');
  assert.equal(pipeline.final.aggregation_status, 'requires_review');
  assert.equal(pipeline.final.needs_recheck, false);
  assert.equal(pipeline.final.requires_human_review, true);
  assert.ok(allowedReviewReasonCodes.has(pipeline.checked.review_reason_code));
  assert.equal(
    pipeline.final.review_reason_code,
    pipeline.checked.review_reason_code,
  );
  assert.equal(typeof pipeline.checked.review_note, 'string');
  assert.ok(pipeline.checked.review_note.trim().length > 0);
  assert.equal(pipeline.final.review_note, pipeline.checked.review_note);
  assert.notEqual(pipeline.checked.aggregation_status, 'resolved');
  assert.notEqual(pipeline.final.aggregation_status, 'resolved');
  assert.equal(
    pipeline.checked.semantic_aggregator_meta.reported_status,
    'resolved',
  );
  assert.equal(
    pipeline.checked.semantic_aggregator_meta.effective_status,
    'requires_review',
  );
  assert.equal(pipeline.checked.semantic_aggregator_meta.containment_applied, true);
  assert.equal(
    pipeline.checked.semantic_aggregator_meta.containment_policy,
    'application_documents_round2_requires_review_v1',
  );
  assert.equal(
    typeof pipeline.checked.semantic_aggregator_meta.containment_reason,
    'string',
  );
  assert.match(
    pipeline.checked.semantic_aggregator_meta.containment_reason,
    /полнот.*составн.*перечн.*документ.*не доказан.*ручн.*провер/iu,
  );
  assert.doesNotMatch(
    pipeline.checked.semantic_aggregator_meta.containment_reason,
    /14173|74000000|ЕГРИП|6 месяцев/iu,
  );
  assert.deepEqual(
    pipeline.final.semantic_aggregator_meta,
    pipeline.checked.semantic_aggregator_meta,
  );

  const expectedCandidateRefs = pipeline.prepared.allowed_candidate_refs;
  const checkedDecisionRefs = pipeline.checked.candidate_decisions.map(
    ({ candidate_ref: candidateRef }) => candidateRef,
  );
  const finalDecisionRefs = pipeline.final.candidate_decisions.map(
    ({ candidate_ref: candidateRef }) => candidateRef,
  );
  assert.deepEqual(new Set(checkedDecisionRefs), new Set(expectedCandidateRefs));
  assert.deepEqual(pipeline.final.candidate_decisions, pipeline.checked.candidate_decisions);
  assert.deepEqual(new Set(finalDecisionRefs), new Set(expectedCandidateRefs));
  assert.ok(pipeline.final.evidence.length > 0);
  assert.ok(
    pipeline.final.evidence.some(
      ({ candidate_ref: candidateRef }) => candidateRef === 'recheck:1:0',
    ),
  );
  assert.equal(pipeline.final.aggregation_round, 2);
  assert.deepEqual(
    pipeline.final.original_aggregation,
    pipeline.checked.original_aggregation,
  );
  assert.deepEqual(pipeline.final.recheck_profile, pipeline.checked.recheck_profile);
  assert.equal(
    pipeline.final.targeted_recheck_result.post_validator_route,
    'round_2',
  );

  assert.equal(unresolvedEgripCandidate.validator_verdict, 'requires_review');
  assert.match(unresolvedEgripCandidate.value_text, /ЕГРИП.*не позднее 6 месяцев/iu);
  assert.equal(
    pipeline.checked.candidate_decisions.find(
      ({ candidate_ref: candidateRef }) =>
        candidateRef === `fact:${unresolvedEgripFactId}`,
    )?.role,
    'not_applicable',
  );
  assert.equal(pipeline.final.aggregation_status, 'requires_review');

  const oracle = evaluateApplicationDocumentsOracle({
    fixture,
    checked: pipeline.checked,
    final: pipeline.final,
    route: 'round2_requires_review',
  });
  assert.equal(
    oracle.passed,
    true,
    `Safe terminal oracle failures: ${oracle.failed_checks.join(', ')}`,
  );
});
