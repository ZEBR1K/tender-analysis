import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  betaAggregatorWorkflowPath,
  executeWorkflowCodeNode,
  loadAggregatorWorkflow,
  runAggregatorRound1,
} from './helpers/aggregator-runtime-eval.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..');
const fixturePath = path.join(
  testDirectory,
  'fixtures',
  'aggregator',
  'execution-14260-semantic-containment.json',
);
const procurementSubjectFixturePath = path.join(
  testDirectory,
  'fixtures',
  'aggregator',
  'execution-14104-procurement-subject.json',
);
const targetedRecheckWorkflowPath = path.join(
  repositoryRoot,
  'workflows',
  'n8n-exports',
  'TENDER - Targeted Recheck.json',
);
const immutablePreRouteGuardWorkflowPath = path.join(
  repositoryRoot,
  'workflows',
  'n8n-exports',
  'beta',
  'TENDER - Targeted Recheck.live-4e0858c9-6ca2-42c7-969b-e74a2f91b8c6.json',
);

const round2NodeNames = [
  'Собрать candidates для Round 2',
  'Подготовить запрос #2 Semantic Aggregator',
  'Проверить ответ #2 Semantic Aggregator',
  'Сформировать FINAL после Round 2',
];

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadFixture() {
  return loadJson(fixturePath);
}

function buildRequiresRecheckResponse(caseFixture) {
  const response = structuredClone(caseFixture.recorded_schema_valid_api_response);
  const result = JSON.parse(response.choices[0].message.content);
  response.choices[0].message.content = JSON.stringify({
    ...result,
    status: 'requires_recheck',
    final_value_text: result.final_value_text,
    confidence: 0.73,
    needs_recheck: true,
    recheck_reason_code: 'ambiguous_scope',
    recheck_note: 'Raw model response already requests Targeted Recheck.',
  });
  return response;
}

function buildPostValidatorInput(caseFixture) {
  const field = caseFixture.aggregator_field_item;
  const groundingCandidate = field.candidates[0];
  return {
    analysis_run_id: field.analysis_run_id,
    field_catalog_version: field.field_catalog_version,
    field_index: field.field_index,
    field_key: field.field_key,
    recheck_attempt: 1,
    recheck_outcome: 'candidate_found',
    recheck_note: 'Execution-derived offline terminal containment regression.',
    evidence_validated: true,
    validator_validated: true,
    existing_candidates: structuredClone(field.candidates),
    usable_candidates: [
      {
        candidate_index: 0,
        value_text: JSON.parse(
          caseFixture.recorded_schema_valid_api_response.choices[0].message.content,
        ).final_value_text,
        status: 'found',
        confidence: 0.92,
        evidence: [
          {
            source_type: 'semantic_block',
            analysis_unit_id: groundingCandidate.analysis_unit_id,
            semantic_block_id: groundingCandidate.evidence[0].semantic_block_id,
            quote: groundingCandidate.evidence[0].quote,
          },
        ],
        review_reason_code: null,
        review_note: null,
        validator_verdict: 'confirmed',
        validator_confidence: 0.95,
        validator_reason_code: 'direct_evidence',
        validator_reason_note: 'Synthetic grounded terminal control.',
      },
    ],
    original_aggregation: {
      status: 'requires_recheck',
      preliminary_value: JSON.parse(
        caseFixture.recorded_schema_valid_api_response.choices[0].message.content,
      ).final_value_text,
      confidence: 0.73,
      recheck_reason_code: 'insufficient_evidence',
      recheck_note: 'Round 1 deterministic containment.',
    },
    recheck_profile: {
      title: field.field_key,
      objective: 'Establish applicability and material completeness.',
    },
    allowed_metadata: {},
    targeted_recheck_meta: {
      mode: 'execution_derived_offline_control',
      ai_called: false,
    },
    validator_meta: {
      mode: 'synthetic_grounded_confirmation',
      ai_called: false,
    },
    post_validator_route: 'round_2',
    post_validator_route_reason: 'Terminal semantic aggregation required.',
    rejected_candidates: [],
  };
}

function buildRound2Response({ prepared, caseFixture, status = 'resolved' }) {
  const recorded = JSON.parse(
    caseFixture.recorded_schema_valid_api_response.choices[0].message.content,
  );
  const candidateDecisions = prepared.allowed_candidate_refs.map(
    (candidateRef) => ({
      candidate_ref: candidateRef,
      role: candidateRef === 'recheck:1:0' ? 'primary' : 'not_applicable',
      reason: 'Synthetic schema-valid terminal decision.',
    }),
  );
  const result = {
    field_key: caseFixture.field_key,
    status,
    final_value_text: recorded.final_value_text,
    confidence: status === 'resolved' ? recorded.confidence : 0.71,
    candidate_decisions: candidateDecisions,
    supporting_candidate_refs: [],
    conflict_candidate_refs: [],
    needs_recheck: false,
    review_reason_code: status === 'requires_review' ? 'ambiguous_scope' : null,
    review_note:
      status === 'requires_review'
        ? 'Raw terminal response already requires human review.'
        : null,
  };
  return {
    id: `execution-14260-${caseFixture.field_key}-round2-${status}`,
    model: 'synthetic-offline-no-ai',
    choices: [
      {
        finish_reason: 'stop',
        message: { content: JSON.stringify(result) },
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

async function runRound2({ caseFixture, status = 'resolved', mutateResponse }) {
  const workflow = loadAggregatorWorkflow(targetedRecheckWorkflowPath);
  const immutablePreRouteGuardWorkflow = loadAggregatorWorkflow(
    immutablePreRouteGuardWorkflowPath,
  );
  // The current collector intentionally rejects these containment-only fields.
  // Build its historical input with the immutable snapshot, then keep testing
  // the current downstream checker as a defense-in-depth contract.
  const collected = await executeWorkflowCodeNode({
    workflow: immutablePreRouteGuardWorkflow,
    nodeName: round2NodeNames[0],
    inputJson: buildPostValidatorInput(caseFixture),
  });
  const prepared = await executeWorkflowCodeNode({
    workflow,
    nodeName: round2NodeNames[1],
    inputJson: collected,
  });
  let response = buildRound2Response({ prepared, caseFixture, status });
  if (mutateResponse) response = mutateResponse(response, prepared);
  const checked = await executeWorkflowCodeNode({
    workflow,
    nodeName: round2NodeNames[2],
    inputJson: response,
    sourceJsonByNode: {
      'Подготовить запрос #2 Semantic Aggregator': prepared,
    },
  });
  const final = await executeWorkflowCodeNode({
    workflow,
    nodeName: round2NodeNames[3],
    inputJson: checked,
  });
  return { collected, prepared, checked, final };
}

test('execution 14260 fixture preserves both false-resolved cases and cross-field official-document evidence', () => {
  const fixture = loadFixture();
  assert.equal(fixture.provenance.source_execution_id, '14260');
  assert.equal(
    fixture.provenance.source_analysis_run_id,
    '3caa7a89-b137-4cf6-b23d-941fb465c8f9',
  );
  assert.deepEqual(
    fixture.cases.map(({ field_key: fieldKey }) => fieldKey),
    ['participation_guarantee', 'required_official_certificates'],
  );

  const guarantee = fixture.cases[0];
  assert.equal(guarantee.aggregator_field_item.confirmed_count, 5);
  assert.equal(guarantee.aggregator_field_item.requires_review_count, 1);
  assert.ok(
    guarantee.aggregator_field_item.candidates.some(
      ({ validator_verdict: verdict, validator_reason_code: reason }) =>
        verdict === 'requires_review' && reason === 'template_or_placeholder',
    ),
  );
  const guaranteeResolved = JSON.parse(
    guarantee.recorded_schema_valid_api_response.choices[0].message.content,
  );
  assert.equal(guaranteeResolved.status, 'resolved');
  assert.equal(guaranteeResolved.confidence, 0.92);
  assert.match(guaranteeResolved.final_value_text, /если предусмотрено/iu);
  assert.doesNotMatch(guaranteeResolved.final_value_text, /\b\d+(?:[.,]\d+)?\s*%/iu);

  const certificates = fixture.cases[1];
  const certificateResolved = JSON.parse(
    certificates.recorded_schema_valid_api_response.choices[0].message.content,
  );
  assert.equal(certificateResolved.status, 'resolved');
  assert.equal(certificateResolved.confidence, 0.95);
  assert.match(certificateResolved.final_value_text, /налогоплательщик/iu);
  assert.doesNotMatch(certificateResolved.final_value_text, /ЕГРЮЛ|ЕГРИП|МСП/iu);
  assert.equal(fixture.cross_field_material_evidence.length, 4);
  assert.ok(
    fixture.cross_field_material_evidence.some(({ value_text: value }) =>
      /ЕГРЮЛ/iu.test(value)),
  );
  assert.ok(
    fixture.cross_field_material_evidence.some(({ value_text: value }) =>
      /ЕГРИП/iu.test(value)),
  );
  assert.ok(
    fixture.cross_field_material_evidence.some(({ value_text: value }) =>
      /реестр.*малого и среднего/iu.test(value)),
  );
});

for (const caseFixture of loadFixture().cases) {
  test(`RED Round 1: ${caseFixture.field_key} resolved is routed to Targeted Recheck with raw audit preserved`, async () => {
    const pipeline = await runAggregatorRound1({
      fixture: caseFixture,
      modelResponse: caseFixture.recorded_schema_valid_api_response,
      workflowPath: betaAggregatorWorkflowPath,
    });
    const reported = JSON.parse(
      caseFixture.recorded_schema_valid_api_response.choices[0].message.content,
    );

    assert.equal(pipeline.checked.aggregation_status, 'requires_recheck');
    assert.equal(pipeline.checked.needs_recheck, true);
    assert.equal(pipeline.checked.recheck_reason_code, 'insufficient_evidence');
    assert.match(
      pipeline.checked.recheck_note,
      new RegExp(caseFixture.expected_reason_pattern, 'iu'),
    );
    assert.equal(pipeline.route, 'targeted_recheck');
    assert.equal(pipeline.final, null);
    assert.equal(
      pipeline.checked.semantic_aggregator_meta.reported_status,
      'resolved',
    );
    assert.equal(
      pipeline.checked.semantic_aggregator_meta.effective_status,
      'requires_recheck',
    );
    assert.equal(
      pipeline.checked.semantic_aggregator_meta.containment_policy,
      caseFixture.expected_policy,
    );
    assert.match(
      pipeline.checked.semantic_aggregator_meta.containment_reason,
      new RegExp(caseFixture.expected_reason_pattern, 'iu'),
    );
    assert.deepEqual(
      pipeline.checked.semantic_aggregator_meta.reported_result,
      reported,
    );
    assert.deepEqual(pipeline.checked.candidate_decisions, reported.candidate_decisions);
    assert.deepEqual(
      pipeline.checked.aggregation_input.candidates,
      pipeline.prepared.aggregation_input.candidates,
    );
    assert.equal(pipeline.checked.final_value_text, reported.final_value_text);
  });

  test(`anti-overfit Round 1: raw ${caseFixture.field_key} requires_recheck remains unchanged`, async () => {
    const pipeline = await runAggregatorRound1({
      fixture: caseFixture,
      modelResponse: buildRequiresRecheckResponse(caseFixture),
      workflowPath: betaAggregatorWorkflowPath,
    });
    assert.equal(pipeline.checked.aggregation_status, 'requires_recheck');
    assert.equal(pipeline.checked.recheck_reason_code, 'ambiguous_scope');
    assert.equal(
      pipeline.checked.recheck_note,
      'Raw model response already requests Targeted Recheck.',
    );
    assert.equal(pipeline.checked.semantic_aggregator_meta.containment_applied, false);
    assert.equal(pipeline.checked.semantic_aggregator_meta.containment_policy, null);
    assert.equal(pipeline.route, 'targeted_recheck');
  });

  test(`RED Round 2: ${caseFixture.field_key} partial resolved becomes terminal requires_review with provisional data`, async () => {
    const pipeline = await runRound2({ caseFixture });
    const reported = JSON.parse(
      caseFixture.recorded_schema_valid_api_response.choices[0].message.content,
    );

    assert.equal(pipeline.checked.aggregation_status, 'requires_review');
    assert.equal(pipeline.checked.needs_recheck, false);
    assert.equal(pipeline.checked.review_reason_code, 'insufficient_evidence');
    assert.match(
      pipeline.checked.review_note,
      new RegExp(caseFixture.expected_reason_pattern, 'iu'),
    );
    assert.equal(pipeline.final.aggregation_status, 'requires_review');
    assert.equal(pipeline.final.requires_human_review, true);
    assert.equal(pipeline.final.needs_recheck, false);
    assert.equal(pipeline.final.final_value_text, reported.final_value_text);
    assert.equal(pipeline.final.confidence, reported.confidence);
    assert.deepEqual(pipeline.final.candidate_decisions, pipeline.checked.candidate_decisions);
    assert.ok(pipeline.final.evidence.length > 0);
    assert.deepEqual(
      pipeline.final.semantic_aggregator_meta,
      pipeline.checked.semantic_aggregator_meta,
    );
    assert.equal(
      pipeline.checked.semantic_aggregator_meta.reported_status,
      'resolved',
    );
    assert.equal(
      pipeline.checked.semantic_aggregator_meta.effective_status,
      'requires_review',
    );
    assert.equal(
      pipeline.checked.semantic_aggregator_meta.containment_policy,
      caseFixture.expected_terminal_policy,
    );
    assert.match(
      pipeline.checked.semantic_aggregator_meta.containment_reason,
      new RegExp(caseFixture.expected_reason_pattern, 'iu'),
    );
    assert.deepEqual(
      pipeline.final.original_aggregation,
      pipeline.checked.original_aggregation,
    );
    assert.deepEqual(pipeline.final.recheck_profile, pipeline.checked.recheck_profile);
    assert.equal(
      pipeline.final.targeted_recheck_result.post_validator_route,
      'round_2',
    );
  });

  test(`anti-overfit Round 2: raw ${caseFixture.field_key} requires_review remains unchanged`, async () => {
    const pipeline = await runRound2({ caseFixture, status: 'requires_review' });
    assert.equal(pipeline.checked.aggregation_status, 'requires_review');
    assert.equal(pipeline.checked.review_reason_code, 'ambiguous_scope');
    assert.equal(
      pipeline.checked.review_note,
      'Raw terminal response already requires human review.',
    );
    assert.equal(pipeline.checked.semantic_aggregator_meta.containment_applied, false);
    assert.equal(pipeline.checked.semantic_aggregator_meta.containment_policy, null);
    assert.equal(pipeline.final.aggregation_status, 'requires_review');
    assert.equal(pipeline.final.requires_human_review, true);
  });
}

test('anti-overfit: unrelated procurement_subject resolved remains unchanged', async () => {
  const fixture = loadJson(procurementSubjectFixturePath);
  const pipeline = await runAggregatorRound1({
    fixture,
    modelResponse: fixture.recorded_false_resolved_api_response,
    workflowPath: betaAggregatorWorkflowPath,
  });
  assert.equal(pipeline.checked.aggregation_status, 'resolved');
  assert.equal(pipeline.checked.needs_recheck, false);
  assert.equal(pipeline.checked.semantic_aggregator_meta.containment_applied, false);
  assert.equal(pipeline.checked.semantic_aggregator_meta.containment_policy, null);
  assert.equal(pipeline.route, 'round1_final');
  assert.equal(pipeline.final.aggregation_status, 'resolved');
});

test('anti-overfit: Round 1 malformed, linking, and cardinality guards remain fail-closed', async () => {
  const caseFixture = loadFixture().cases[0];
  const workflow = loadAggregatorWorkflow(betaAggregatorWorkflowPath);
  const prepared = await executeWorkflowCodeNode({
    workflow,
    nodeName: 'Подготовить запрос Semantic Aggregator',
    inputJson: caseFixture.aggregator_field_item,
  });
  const runChecker = (response) =>
    executeWorkflowCodeNode({
      workflow,
      nodeName: 'Проверить ответ Semantic Aggregator',
      inputJson: response,
      sourceJsonByNode: { 'Подготовить запрос Semantic Aggregator': prepared },
    });

  const malformed = structuredClone(caseFixture.recorded_schema_valid_api_response);
  malformed.choices[0].message.content = '{';
  await assert.rejects(runChecker(malformed), /невалидный JSON/iu);

  const unknown = structuredClone(caseFixture.recorded_schema_valid_api_response);
  const unknownResult = JSON.parse(unknown.choices[0].message.content);
  unknownResult.candidate_decisions[0].fact_id = 'unknown-fact';
  unknown.choices[0].message.content = JSON.stringify(unknownResult);
  await assert.rejects(runChecker(unknown), /неизвестный fact_id/iu);

  const cardinality = structuredClone(caseFixture.recorded_schema_valid_api_response);
  const cardinalityResult = JSON.parse(cardinality.choices[0].message.content);
  cardinalityResult.candidate_decisions[1].role = 'primary';
  cardinality.choices[0].message.content = JSON.stringify(cardinalityResult);
  await assert.rejects(runChecker(cardinality), /ровно один primary/iu);
});

test('anti-overfit: Round 2 malformed, linking, and cardinality guards remain fail-closed', async () => {
  const caseFixture = loadFixture().cases[1];
  await assert.rejects(
    runRound2({
      caseFixture,
      mutateResponse: (response) => {
        response.choices[0].message.content = '{';
        return response;
      },
    }),
    /невалидный JSON/iu,
  );
  await assert.rejects(
    runRound2({
      caseFixture,
      mutateResponse: (response) => {
        const result = JSON.parse(response.choices[0].message.content);
        result.candidate_decisions[0].candidate_ref = 'unknown:candidate';
        response.choices[0].message.content = JSON.stringify(result);
        return response;
      },
    }),
    /неизвестный candidate_ref/iu,
  );
  await assert.rejects(
    runRound2({
      caseFixture,
      mutateResponse: (response) => {
        const result = JSON.parse(response.choices[0].message.content);
        result.candidate_decisions[1].role = 'primary';
        response.choices[0].message.content = JSON.stringify(result);
        return response;
      },
    }),
    /ровно один primary/iu,
  );
});
