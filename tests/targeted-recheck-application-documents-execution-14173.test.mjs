import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
const liveVersionId = '4e0858c9-6ca2-42c7-969b-e74a2f91b8c6';
const liveSnapshotSha256 =
  '4617015788116a8378c388f35565d6dd82bcda47141e85caf1743115a75aefe1';
const liveWorkflowPath = path.join(
  repositoryRoot,
  'workflows',
  'n8n-exports',
  'beta',
  `TENDER - Targeted Recheck.live-${liveVersionId}.json`,
);
const executionFixturePath = path.join(
  testDirectory,
  'fixtures',
  'aggregator',
  'execution-14173-application-documents.json',
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

function buildPostValidatorInput(fixture) {
  const field = fixture.aggregator_field_item;
  const groundingCandidate = field.candidates.find(
    ({ fact_id: factId }) => factId === '74000000-0028-4000-8000-000000000028',
  );
  assert.ok(groundingCandidate, 'Missing fixture grounding candidate 0028.');
  assert.equal(groundingCandidate.validator_verdict, 'confirmed');
  assert.equal(groundingCandidate.evidence.length, 1);

  const groundingEvidence = groundingCandidate.evidence[0];
  const syntheticRecheckCandidate = {
    candidate_index: 0,
    value_text:
      'В состав заявки входит форма согласия на обработку персональных данных.',
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
      'Synthetic offline Validator confirmation over an execution-derived grounded quote.',
  };

  return {
    analysis_run_id: field.analysis_run_id,
    field_catalog_version: field.field_catalog_version,
    field_index: field.field_index,
    field_key: field.field_key,
    recheck_attempt: 1,
    recheck_outcome: 'candidate_found',
    recheck_note:
      'Synthetic offline grounded candidate used only to reproduce the terminal Round 2 contract.',
    evidence_validated: true,
    validator_validated: true,
    existing_candidates: structuredClone(field.candidates),
    usable_candidates: [syntheticRecheckCandidate],
    original_aggregation: {
      status: 'requires_recheck',
      preliminary_value: null,
      confidence: 0.72,
      recheck_reason_code: 'ambiguous_scope',
      recheck_note:
        'The composite application document set requires terminal completeness review.',
    },
    recheck_profile: {
      title: 'Документы в составе заявки',
      objective:
        'Установить документы, формы и сведения, предоставляемые именно в составе заявки.',
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

function buildPartialResolvedApiResponse(prepared) {
  const primaryRef = 'recheck:1:0';
  const candidateDecisions = prepared.allowed_candidate_refs.map(
    (candidateRef) => ({
      candidate_ref: candidateRef,
      role: candidateRef === primaryRef ? 'primary' : 'not_applicable',
      reason:
        candidateRef === primaryRef
          ? 'The grounded recheck candidate is selected as the only primary.'
          : 'Excluded by the synthetic structural response without a completeness proof.',
    }),
  );

  return {
    id: 'synthetic-targeted-recheck-round2-partial-resolved',
    model: 'synthetic-offline-no-ai',
    choices: [
      {
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            field_key: 'application_documents',
            status: 'resolved',
            final_value_text:
              'В состав заявки входит форма согласия на обработку персональных данных.',
            confidence: 0.98,
            candidate_decisions: candidateDecisions,
            supporting_candidate_refs: [],
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

async function runLiveRound2Contract(fixture) {
  const workflow = loadAggregatorWorkflow(liveWorkflowPath);
  const collected = await executeWorkflowCodeNode({
    workflow,
    nodeName: round2NodeNames[0],
    inputJson: buildPostValidatorInput(fixture),
  });
  const prepared = await executeWorkflowCodeNode({
    workflow,
    nodeName: round2NodeNames[1],
    inputJson: collected,
  });
  const checked = await executeWorkflowCodeNode({
    workflow,
    nodeName: round2NodeNames[2],
    inputJson: buildPartialResolvedApiResponse(prepared),
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

test('saved read-only snapshot pins the exact active live Targeted Recheck contract', () => {
  const snapshotBytes = fs.readFileSync(liveWorkflowPath);
  const workflow = loadAggregatorWorkflow(liveWorkflowPath);
  const coreNodes = round2NodeNames.map((name) =>
    workflow.nodes.find((node) => node.name === name));

  assert.equal(workflow.id, '9uDOU31DGo30fGXX');
  assert.equal(workflow.active, true);
  assert.equal(workflow.versionId, liveVersionId);
  assert.equal(workflow.activeVersionId, liveVersionId);
  assert.equal(workflow.nodes.length, 64);
  assert.equal(
    crypto.createHash('sha256').update(snapshotBytes).digest('hex'),
    liveSnapshotSha256,
  );
  assert.ok(coreNodes.every(Boolean));
  assert.ok(
    coreNodes.every(
      (node) =>
        node.type === 'n8n-nodes-base.code' &&
        typeof node.parameters?.jsCode === 'string',
    ),
  );
});

test('RED terminal regression: exact live Round 2 accepts and materializes a partial application_documents resolved result', async () => {
  const fixture = loadJson(executionFixturePath);
  const pipeline = await runLiveRound2Contract(fixture);
  const oracle = evaluateApplicationDocumentsOracle({
    fixture,
    checked: pipeline.checked,
    final: pipeline.final,
    route: 'round2_final',
  });
  const unresolvedIpCandidate = fixture.aggregator_field_item.candidates.find(
    ({ fact_id: factId }) => factId === '74000000-0016-4000-8000-000000000016',
  );
  const groundingCandidate = fixture.aggregator_field_item.candidates.find(
    ({ fact_id: factId }) => factId === '74000000-0028-4000-8000-000000000028',
  );

  assert.equal(fixture.provenance.source_execution_id, '14173');
  assert.equal(fixture.aggregator_field_item.candidates.length, 28);
  assert.equal(pipeline.collected.candidates_count, 29);
  assert.deepEqual(pipeline.collected.candidate_stats, {
    confirmed: 22,
    requires_review: 7,
    initial: 28,
    targeted_recheck: 1,
  });
  assert.equal(pipeline.prepared.aggregation_round, 2);
  assert.equal(pipeline.prepared.candidate_id_key, 'candidate_ref');
  assert.equal(pipeline.prepared.allowed_candidate_refs.length, 29);
  assert.equal(new Set(pipeline.prepared.allowed_candidate_refs).size, 29);
  assert.equal(pipeline.checked.aggregation_validated, true);
  assert.equal(pipeline.checked.aggregation_status, 'resolved');
  assert.equal(pipeline.checked.needs_recheck, false);
  assert.equal(
    pipeline.checked.candidate_decisions.filter(({ role }) => role === 'primary')
      .length,
    1,
  );
  assert.equal(
    pipeline.checked.candidate_decisions.find(
      ({ role }) => role === 'primary')?.candidate_ref,
    'recheck:1:0',
  );
  assert.equal(pipeline.final.aggregation_status, 'resolved');
  assert.equal(pipeline.final.resolution_method, 'semantic_aggregator_round_2');
  assert.equal(pipeline.final.aggregation_round, 2);
  assert.equal(pipeline.final.requires_human_review, false);
  assert.equal(pipeline.final.evidence.length, 1);
  assert.equal(pipeline.final.evidence[0].candidate_ref, 'recheck:1:0');
  assert.equal(pipeline.final.evidence[0].candidate_origin, 'targeted_recheck');
  assert.equal(
    pipeline.final.evidence[0].analysis_unit_id,
    groundingCandidate.analysis_unit_id,
  );
  assert.equal(
    pipeline.final.evidence[0].semantic_block_id,
    groundingCandidate.evidence[0].semantic_block_id,
  );
  assert.equal(
    pipeline.final.evidence[0].quote,
    groundingCandidate.evidence[0].quote,
  );

  assert.equal(unresolvedIpCandidate.validator_verdict, 'requires_review');
  assert.match(unresolvedIpCandidate.value_text, /ЕГРИП.*не позднее 6 месяцев/iu);
  assert.doesNotMatch(pipeline.final.final_value_text, /ЕГРИП|6 месяцев/iu);

  assert.equal(oracle.passed, false);
  assert.equal(oracle.semantic_outcome, 'round2_final_evaluated');
  assert.ok(oracle.failed_checks.includes('participant_type_conditions_preserved'));
  assert.ok(
    oracle.failed_checks.includes('all_material_confirmed_requirements_preserved'),
  );
});
