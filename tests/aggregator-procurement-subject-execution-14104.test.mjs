import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  LIVE_MODEL_ALIAS,
  aggregatorWorkflowPath,
  evaluateAntiOverfitCase,
  evaluateExplicitSemanticExpectation,
  evaluateProcurementSubjectOracle,
  evaluateRecordedFixture,
  evaluateSelfDeclaredSemanticAxisMatrix,
  executeWorkflowCodeNode,
  loadAggregatorAntiOverfitFixture,
  loadAggregatorFixture,
  loadAggregatorWorkflow,
  routeCheckedAggregation,
  runAggregatorRound1,
} from './helpers/aggregator-runtime-eval.mjs';
import * as runtimeEvaluator from './runtime/aggregator-procurement-subject-runtime-eval.mjs';

const { reportRuntimePipeline } = runtimeEvaluator;

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..');
const runtimeEvalPath = path.join(
  testDirectory,
  'runtime',
  'aggregator-procurement-subject-runtime-eval.mjs',
);
const fieldCatalogPath = path.join(repositoryRoot, 'FIELD_CATALOG.md');
const betaAggregatorWorkflowPath = path.join(
  repositoryRoot,
  'workflows',
  'n8n-exports',
  'beta',
  '[TEST CODEX] TENDER — Агрегация закупки.json',
);
const fixturePath = path.join(
  testDirectory,
  'fixtures',
  'aggregator',
  'execution-14104-procurement-subject.json',
);
const GLM_53_FLASH_ALIAS =
  'z-ai/glm-5.3-flash@provider=cloudflare&reasoning_effort=low';
const GEMINI_37_FLASH_ALIAS =
  'google/gemini-3.7-flash@provider=google-ai-studio/flex&reasoning_effort=low';
const FIXTURE_SHA256 =
  '6392f9c882a211f20cf1f13777f7002b8c8628270d025df5fdf46492f2adbd75';
const BETA_WORKFLOW_SHA256 =
  '3e8b0323a13a74c498c9c28c069fae02fb2907dd3d53aaccd8325fd3d8ce3be8';

function sha256File(filePath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex');
}

function liveOverrideArgs() {
  return [
    '--live',
    '--beta',
    '--allow-paid-ai',
    '--allow-model-override',
  ];
}

function expectedExecution14104Response(fixture) {
  const ids = fixture.fact_ids_by_analysis_unit;
  return syntheticApiResponse('synthetic-ab-expected-selection', {
    field_key: 'procurement_subject',
    status: 'resolved',
    final_value_text: fixture.aggregator_field_item.candidates[0].value_text,
    confidence: 0.98,
    candidate_decisions: [
      { fact_id: ids.doc_7_au_0001, role: 'primary', reason: 'Предмет текущей закупки.' },
      { fact_id: ids.doc_7_au_0008, role: 'duplicate', reason: 'Дублирует предмет.' },
      { fact_id: ids.doc_7_au_0010, role: 'supporting', reason: 'Подтверждает предмет.' },
      { fact_id: ids.doc_7_au_0031, role: 'not_applicable', reason: 'Внутренний процесс.' },
    ],
    supporting_fact_ids: [ids.doc_7_au_0010],
    conflict_fact_ids: [],
    needs_recheck: false,
    recheck_reason_code: null,
    recheck_note: null,
  });
}

const universalProcurementSubjectSignals = [
  {
    label: 'current procurement or contract scope',
    patterns: [
      /текущ[а-яё]*\s+закупк/iu,
      /договор[а-яё]*,?\s+заключаем[а-яё]*\s+по\s+текущ[а-яё]*\s+закупк/iu,
    ],
  },
  {
    label: 'specific wording alone does not prove applicability',
    patterns: [
      /конкретност[а-яё\s]*сама\s+по\s+себе[^.]{0,160}не\s+(?:доказыва|подтвержда)[а-яё]*[^.]{0,100}(?:применимост|относимост)/iu,
    ],
  },
  {
    label: 'internal processes exclusion',
    patterns: [/внутренн[а-яё]*\s+процесс/iu],
  },
  {
    label: 'auxiliary obligations exclusion',
    patterns: [/вспомогательн[а-яё]*\s+обязательств/iu],
  },
  {
    label: 'other or separate agreements exclusion',
    patterns: [/(?:друг|отдельн)[а-яё]*\s+(?:договор|соглашен)/iu],
  },
  {
    label: 'ambiguous scope routes to recheck',
    patterns: [/(?:ambiguous_scope|неоднозначн[а-яё]*\s+scope)[^\n]{0,180}(?:requires_recheck|recheck)/iu],
  },
  {
    label: 'requires_review ambiguous_scope cannot be promoted without confirmation',
    patterns: [
      /validator_verdict[^\n]{0,80}requires_review[^\n]{0,220}ambiguous_scope[^\n]{0,220}resolved[^\n]{0,220}дополнительн[а-яё]*\s+подтвержден/iu,
    ],
  },
];

function getProcurementSubjectRules(workflow) {
  const prepareCode = workflow.nodes.find(
    ({ name }) => name === 'Подготовить запрос Semantic Aggregator',
  ).parameters.jsCode;
  const start = prepareCode.indexOf('procurement_subject: {');
  const end = prepareCode.indexOf('nm_price_with_vat:', start);
  assert.ok(start >= 0 && end > start, 'procurement_subject FIELD_RULES not found');
  return prepareCode.slice(start, end).toLocaleLowerCase('ru-RU');
}

function assertUniversalProcurementSubjectBoundary(workflow) {
  const rules = getProcurementSubjectRules(workflow);
  for (const { label, patterns } of universalProcurementSubjectSignals) {
    assert.equal(
      patterns.some((pattern) => pattern.test(rules)),
      true,
      `Missing universal procurement_subject rule: ${label}`,
    );
  }
}

function syntheticApiResponse(id, payload) {
  return {
    id,
    model: 'synthetic-schema-valid-no-ai',
    choices: [
      {
        finish_reason: 'stop',
        message: {
          role: 'assistant',
          content: JSON.stringify(payload),
        },
      },
    ],
    usage: null,
  };
}

test('Aggregator harness keeps production default and accepts an explicit beta workflow path', async () => {
  const productionWorkflow = loadAggregatorWorkflow();
  const betaWorkflow = loadAggregatorWorkflow(betaAggregatorWorkflowPath);
  const missingWorkflowPath = path.join(testDirectory, 'missing-aggregator.json');
  const fixture = loadAggregatorFixture();

  assert.equal(productionWorkflow.name, 'TENDER — Агрегация закупки');
  assert.equal(betaWorkflow.id, 'ftvmrEHoMbPOAqZG');
  assert.equal(betaWorkflow.name, '[TEST CODEX] TENDER — Агрегация закупки');
  assert.equal(betaWorkflow.nodeCount, 24);
  assert.throws(
    () => loadAggregatorWorkflow(missingWorkflowPath),
    /ENOENT/u,
  );
  await assert.rejects(
    runAggregatorRound1({
      fixture,
      modelResponse: fixture.recorded_false_resolved_api_response,
      workflowPath: missingWorkflowPath,
    }),
    /ENOENT/u,
  );
});

test('execution 14104 fixture preserves the four exact procurement_subject candidates', () => {
  const fixture = loadAggregatorFixture();
  const candidates = fixture.aggregator_field_item.candidates;

  assert.equal(fixture.fact_id_policy.origin, 'stable_fixture_uuid_not_production');
  assert.equal(fixture.fact_id_policy.must_not_be_reported_as_production_ids, true);
  assert.deepEqual(
    candidates.map(({ analysis_unit_id: analysisUnitId }) => analysisUnitId),
    ['doc_7_au_0001', 'doc_7_au_0008', 'doc_7_au_0010', 'doc_7_au_0031'],
  );
  assert.deepEqual(
    candidates.map(({ fact_index: factIndex }) => factIndex),
    [0, 0, 0, 0],
  );
  assert.ok(
    candidates.slice(0, 3).every(({ value_text: valueText }) =>
      /стандартн[а-яё]*\s+закрыт[а-яё]*\s+палуб/iu.test(valueText)),
  );
  assert.match(
    candidates[3].value_text,
    /Поддержание технологического оборудования в работоспособном состоянии/u,
  );
  assert.deepEqual(
    candidates.map(({ evidence }) => evidence.length),
    [1, 2, 1, 4],
  );
  assert.ok(
    candidates.every(({ validator_verdict: verdict }) => verdict === 'confirmed'),
  );
  assert.deepEqual(
    candidates.map(({ validator_confidence: confidence }) => confidence),
    [0.98, 0.95, 0.95, 0.92],
  );
  assert.ok(
    Object.values(fixture.execution_validator_meta_by_analysis_unit).every(
      ({ fact_local_literal_guard: guard }) =>
        guard.version === 'fact_local_material_literals_v1' &&
        guard.original_ai_verdict === 'confirmed' &&
        guard.downgraded === false,
    ),
  );
  assert.equal(fixture.document.document_id, 'c8797a6c-a624-4b80-a723-b29124392c59');
  assert.equal(fixture.document.document_index, 7);
  assert.equal(fixture.document.file_name, 'Блок_6_Проект_договора.docx');
});

test('fixture separates the authoritative catalog definition from the execution-specific interpretation', () => {
  const fixture = loadAggregatorFixture();
  const catalog = fs.readFileSync(fieldCatalogPath, 'utf8');
  const oracle = fixture.semantic_oracle;

  assert.equal(
    oracle.authoritative_catalog_definition,
    'Конкретный товар, работа или услуга, которые закупаются.',
  );
  assert.ok(catalog.includes(oracle.authoritative_catalog_definition));
  assert.equal(Object.hasOwn(oracle, 'field_catalog_basis'), false);
  assert.match(
    oracle.regression_oracle_interpretation,
    /Для execution 14104/u,
  );
  assert.equal(
    oracle.interpretation_provenance,
    'Execution-specific regression inference; not a verbatim FIELD_CATALOG.md rule.',
  );
});

test('regression contract keeps structural, semantic, and deterministic guarantees separate', () => {
  const layers = loadAggregatorFixture().contract_layers;

  assert.deepEqual(layers.structural_checker_contract, [
    'schema',
    'cardinality',
    'fact_linking',
    'role_consistency',
    'resolved_recheck_consistency',
  ]);
  assert.deepEqual(layers.ai_semantic_behavior, [
    'candidate_applicability_to_current_procurement',
    'correct_primary_selection',
    'correct_final_value_text',
  ]);
  assert.equal(
    layers.deterministic_post_ai_guards.scope,
    'Formally provable invariants only',
  );
  assert.match(
    layers.deterministic_post_ai_guards.must_not_claim,
    /Universal semantic understanding/u,
  );
});

test('actual prepare node sends all four candidates once and exposes the current payload gap', async () => {
  const fixture = loadAggregatorFixture();
  const { prepared } = await evaluateRecordedFixture(fixture);
  const inputCandidates = fixture.aggregator_field_item.candidates;
  const promptCandidates = prepared.aggregation_input.candidates;

  assert.deepEqual(
    prepared.allowed_fact_ids,
    inputCandidates.map(({ fact_id: factId }) => factId),
  );
  assert.equal(new Set(prepared.allowed_fact_ids).size, 4);
  assert.equal(promptCandidates.length, 4);
  assert.deepEqual(
    promptCandidates.map(({ analysis_unit_id: analysisUnitId }) => analysisUnitId),
    ['doc_7_au_0001', 'doc_7_au_0008', 'doc_7_au_0010', 'doc_7_au_0031'],
  );
  assert.ok(promptCandidates.every((candidate) => !Object.hasOwn(candidate, 'fact_index')));
  assert.ok(promptCandidates.every((candidate) => !Object.hasOwn(candidate, 'processing_status')));
  assert.ok(promptCandidates.every((candidate) => !Object.hasOwn(candidate, 'validator_meta')));
  assert.ok(promptCandidates.every((candidate) => !Object.hasOwn(candidate, 'extractor_confidence')));
  assert.ok(promptCandidates.every((candidate) => !Object.hasOwn(candidate, 'section_context')));
  assert.ok(promptCandidates.every((candidate) => !Object.hasOwn(candidate, 'tender_meta')));
});

test('current production checker structurally accepts schema-valid false_resolved and FINAL node emits it', async () => {
  const fixture = loadAggregatorFixture();
  const result = await evaluateRecordedFixture(fixture);
  const targetFactId = fixture.fact_ids_by_analysis_unit.doc_7_au_0031;
  const targetDecision = result.checked.candidate_decisions.find(
    ({ fact_id: factId }) => factId === targetFactId,
  );

  assert.equal(result.checked.aggregation_validated, true);
  assert.equal(result.checked.aggregation_status, 'resolved');
  assert.equal(result.checked.needs_recheck, false);
  assert.equal(result.checked.candidate_decisions.length, 4);
  assert.equal(new Set(result.checked.candidate_decisions.map(({ fact_id: factId }) => factId)).size, 4);
  assert.equal(targetDecision.role, 'primary');
  assert.equal(result.final.aggregation_status, 'resolved');
  assert.equal(result.final.aggregation_validated, true);
  assert.match(
    result.final.final_value_text,
    /Поддержание технологического оборудования/u,
  );
});

test('diagnostic vulnerability: execution 14104 can materialize a semantically false resolved result', async () => {
  const fixture = loadAggregatorFixture();
  const result = await evaluateRecordedFixture(fixture);

  assert.equal(result.checked.aggregation_validated, true);
  assert.equal(result.route, 'round1_final');
  assert.equal(result.final.aggregation_status, 'resolved');
  assert.equal(result.oracle.passed, false);
});

test('self-declared semantic axes satisfy a formal matrix but do not prove applicability', async () => {
  const fixture = loadAggregatorFixture();
  const pipeline = await runAggregatorRound1({
    fixture,
    modelResponse: fixture.adversarial_self_declared_axis_api_response,
  });
  const matrix = evaluateSelfDeclaredSemanticAxisMatrix({
    fixture,
    checked: pipeline.checked,
  });
  const semanticOracle = evaluateProcurementSubjectOracle({
    fixture,
    checked: pipeline.checked,
    final: pipeline.final,
  });
  const targetFactId = fixture.fact_ids_by_analysis_unit.doc_7_au_0031;
  const target = pipeline.checked.candidate_decisions.find(
    ({ fact_id: factId }) => factId === targetFactId,
  );

  assert.equal(pipeline.checked.aggregation_validated, true);
  assert.equal(target.role, 'primary');
  assert.equal(target.semantic_axes.scope, 'current_procurement_object');
  assert.equal(matrix.passed, true);
  assert.equal(matrix.trusted_external_signal_used, false);
  assert.equal(semanticOracle.passed, false);
});

test('anti-overfit control: a legitimate single subject remains resolved', async () => {
  const fixture = loadAggregatorAntiOverfitFixture();
  const caseFixture = fixture.cases.find(
    ({ case_id: caseId }) => caseId === 'legitimate_single_subject',
  );
  const result = await evaluateAntiOverfitCase(caseFixture);

  assert.equal(result.checked.aggregation_validated, true);
  assert.equal(result.final.aggregation_status, 'resolved');
  assert.equal(result.oracle.passed, true);
});

test('diagnostic vulnerability: a concrete-looking internal or auxiliary process can displace the current subject', async () => {
  const fixture = loadAggregatorAntiOverfitFixture();
  const caseFixture = fixture.cases.find(
    ({ case_id: caseId }) => caseId === 'auxiliary_or_internal_process',
  );
  const result = await evaluateAntiOverfitCase(caseFixture);

  assert.equal(result.checked.aggregation_validated, true);
  assert.equal(result.route, 'round1_final');
  assert.equal(result.final.aggregation_status, 'resolved');
  assert.equal(result.oracle.passed, false);
});

test('diagnostic vulnerability: ambiguous scope can become resolved instead of requires_recheck', async () => {
  const fixture = loadAggregatorAntiOverfitFixture();
  const caseFixture = fixture.cases.find(
    ({ case_id: caseId }) => caseId === 'ambiguous_scope',
  );
  const result = await evaluateAntiOverfitCase(caseFixture);

  assert.equal(result.checked.aggregation_validated, true);
  assert.equal(result.route, 'round1_final');
  assert.equal(result.final.aggregation_status, 'resolved');
  assert.equal(result.oracle.passed, false);
});

test('route-aware helper sends a correct ambiguous_scope result to Targeted Recheck without Round 1 FINAL', async () => {
  const fixture = loadAggregatorAntiOverfitFixture();
  const caseFixture = fixture.cases.find(
    ({ case_id: caseId }) => caseId === 'ambiguous_scope',
  );
  const result = await runAggregatorRound1({
    fixture: caseFixture,
    modelResponse: caseFixture.correct_requires_recheck_api_response,
  });
  const oracle = evaluateExplicitSemanticExpectation({
    caseFixture,
    checked: result.checked,
    final: result.final,
  });

  assert.equal(result.checked.aggregation_validated, true);
  assert.equal(result.checked.aggregation_status, 'requires_recheck');
  assert.equal(result.checked.needs_recheck, true);
  assert.equal(result.route, 'targeted_recheck');
  assert.equal(result.final, null);
  assert.equal(
    result.executed_nodes.includes('Сформировать FINAL после Round 1'),
    false,
  );
  assert.equal(oracle.passed, true);
});

test('route-aware helper hard-fails inconsistent post-checker status combinations', async () => {
  const workflow = loadAggregatorWorkflow();
  const invalidResults = [
    {
      aggregation_validated: true,
      aggregation_status: 'resolved',
      needs_recheck: true,
    },
    {
      aggregation_validated: true,
      aggregation_status: 'requires_recheck',
      needs_recheck: false,
    },
    {
      aggregation_validated: false,
      aggregation_status: 'resolved',
      needs_recheck: false,
    },
  ];

  for (const checked of invalidResults) {
    await assert.rejects(
      routeCheckedAggregation({ workflow, checked }),
      /Aggregator test harness/u,
    );
  }
});

test('production Aggregator prompt and code contain no execution-derived or fixture-specific literals', () => {
  const workflow = loadAggregatorWorkflow();
  const executionFixture = loadAggregatorFixture();
  const controls = loadAggregatorAntiOverfitFixture();
  const productionPromptAndCode = workflow.nodes
    .flatMap(({ parameters = {} }) => [parameters.jsCode, parameters.jsonBody])
    .filter((value) => typeof value === 'string')
    .join('\n');
  const fixtureUuids = [
    ...Object.values(executionFixture.fact_ids_by_analysis_unit),
    ...controls.cases.flatMap(({ aggregator_field_item: fieldItem }) =>
      fieldItem.candidates.map(({ fact_id: factId }) => factId)),
  ];
  const forbidden = [
    '14104',
    'doc_7_au_0031',
    'стандартные закрытия палуб',
    'поддержание технологического оборудования',
    ...fixtureUuids,
  ];

  for (const literal of forbidden) {
    assert.equal(
      productionPromptAndCode.toLocaleLowerCase('ru-RU').includes(
        literal.toLocaleLowerCase('ru-RU'),
      ),
      false,
      `Production Aggregator contains fixture-specific literal: ${literal}`,
    );
  }
});

test('RED actionable: procurement_subject FIELD_RULES contain the universal current-scope boundary', () => {
  const workflow = loadAggregatorWorkflow();
  assertUniversalProcurementSubjectBoundary(workflow);
});

test('RED candidate contract: beta procurement_subject prompt contains the universal current-scope boundary', async () => {
  const workflow = loadAggregatorWorkflow(betaAggregatorWorkflowPath);
  const fixture = loadAggregatorFixture();
  const controls = loadAggregatorAntiOverfitFixture();
  const prepared = await executeWorkflowCodeNode({
    workflow,
    nodeName: 'Подготовить запрос Semantic Aggregator',
    inputJson: fixture.aggregator_field_item,
  });

  assertUniversalProcurementSubjectBoundary(workflow);
  assert.equal(prepared.field_key, 'procurement_subject');
  assert.equal(prepared.aggregation_input.candidates.length, 4);
  assert.deepEqual(
    prepared.allowed_fact_ids,
    fixture.aggregator_field_item.candidates.map(({ fact_id: factId }) => factId),
  );
  const prepareCode = workflow.nodes.find(
    ({ name }) => name === 'Подготовить запрос Semantic Aggregator',
  ).parameters.jsCode.toLocaleLowerCase('ru-RU');
  const forbidden = [
    '14104',
    'doc_7_au_0031',
    'стандартные закрытия палуб',
    'поддержание технологического оборудования',
    ...Object.values(fixture.fact_ids_by_analysis_unit),
    ...controls.cases.flatMap(({ aggregator_field_item: fieldItem }) =>
      fieldItem.candidates.map(({ fact_id: factId }) => factId)),
  ];
  for (const literal of forbidden) {
    assert.equal(
      prepareCode.includes(literal.toLocaleLowerCase('ru-RU')),
      false,
      `Beta Aggregator contains fixture-specific literal: ${literal}`,
    );
  }
});

test('RED pre-canary: beta FIELD_RULES use the AI response status field, not downstream aggregation_status', async () => {
  const workflow = loadAggregatorWorkflow(betaAggregatorWorkflowPath);
  const fixture = loadAggregatorFixture();
  const rules = getProcurementSubjectRules(workflow);
  const prepared = await executeWorkflowCodeNode({
    workflow,
    nodeName: 'Подготовить запрос Semantic Aggregator',
    inputJson: fixture.aggregator_field_item,
  });
  const checkerCode = workflow.nodes.find(
    ({ name }) => name === 'Проверить ответ Semantic Aggregator',
  ).parameters.jsCode;

  assert.match(rules, /\bstatus\s*=\s*requires_recheck\b/iu);
  assert.doesNotMatch(rules, /\baggregation_status\s*=/iu);
  assert.match(
    prepared.system_prompt,
    /"status"\s*:\s*"resolved\s*\|\s*requires_recheck"/u,
  );
  assert.match(checkerCode, /result\.status/u);
  assert.doesNotMatch(checkerCode, /result\.aggregation_status/u);
});

test('beta offline contract can materialize the execution-14104 expected selection', async () => {
  const fixture = loadAggregatorFixture();
  const ids = fixture.fact_ids_by_analysis_unit;
  const modelResponse = syntheticApiResponse(
    'synthetic-execution-14104-expected-selection',
    {
      field_key: 'procurement_subject',
      status: 'resolved',
      final_value_text: fixture.aggregator_field_item.candidates[0].value_text,
      confidence: 0.98,
      candidate_decisions: [
        { fact_id: ids.doc_7_au_0001, role: 'primary', reason: 'Прямо установлен предмет текущей закупки.' },
        { fact_id: ids.doc_7_au_0008, role: 'duplicate', reason: 'То же закупаемое изделие в спецификации.' },
        { fact_id: ids.doc_7_au_0010, role: 'supporting', reason: 'Подтверждает поставку того же предмета.' },
        { fact_id: ids.doc_7_au_0031, role: 'not_applicable', reason: 'Описывает внутренний процесс, а не объект текущей закупки.' },
      ],
      supporting_fact_ids: [ids.doc_7_au_0010],
      conflict_fact_ids: [],
      needs_recheck: false,
      recheck_reason_code: null,
      recheck_note: null,
    },
  );
  const pipeline = await runAggregatorRound1({
    fixture,
    modelResponse,
    workflowPath: betaAggregatorWorkflowPath,
  });
  const oracle = evaluateProcurementSubjectOracle({
    fixture,
    checked: pipeline.checked,
    final: pipeline.final,
  });

  assert.equal(pipeline.route, 'round1_final');
  assert.equal(pipeline.final.aggregation_status, 'resolved');
  assert.equal(oracle.passed, true);
});

test('beta offline contract prevents a neutral internal or auxiliary process from displacing the subject', async () => {
  const controls = loadAggregatorAntiOverfitFixture();
  const caseFixture = controls.cases.find(
    ({ case_id: caseId }) => caseId === 'auxiliary_or_internal_process',
  );
  const [current, internal, auxiliary] = caseFixture.aggregator_field_item.candidates;
  const modelResponse = syntheticApiResponse(
    'synthetic-neutral-internal-expected-selection',
    {
      field_key: 'procurement_subject',
      status: 'resolved',
      final_value_text: current.value_text,
      confidence: 0.97,
      candidate_decisions: [
        { fact_id: current.fact_id, role: 'primary', reason: 'Прямо установлен предмет текущей закупки.' },
        { fact_id: internal.fact_id, role: 'not_applicable', reason: 'Внутренний процесс организации.' },
        { fact_id: auxiliary.fact_id, role: 'not_applicable', reason: 'Предмет отдельного вспомогательного соглашения.' },
      ],
      supporting_fact_ids: [],
      conflict_fact_ids: [],
      needs_recheck: false,
      recheck_reason_code: null,
      recheck_note: null,
    },
  );
  const pipeline = await runAggregatorRound1({
    fixture: caseFixture,
    modelResponse,
    workflowPath: betaAggregatorWorkflowPath,
  });
  const oracle = evaluateExplicitSemanticExpectation({
    caseFixture,
    checked: pipeline.checked,
    final: pipeline.final,
  });

  assert.equal(pipeline.route, 'round1_final');
  assert.equal(oracle.passed, true);
});

test('beta offline contract routes neutral ambiguous scope to Targeted Recheck', async () => {
  const controls = loadAggregatorAntiOverfitFixture();
  const caseFixture = controls.cases.find(
    ({ case_id: caseId }) => caseId === 'ambiguous_scope',
  );
  const pipeline = await runAggregatorRound1({
    fixture: caseFixture,
    modelResponse: caseFixture.correct_requires_recheck_api_response,
    workflowPath: betaAggregatorWorkflowPath,
  });
  const oracle = evaluateExplicitSemanticExpectation({
    caseFixture,
    checked: pipeline.checked,
    final: pipeline.final,
  });

  assert.equal(pipeline.route, 'targeted_recheck');
  assert.equal(pipeline.final, null);
  assert.equal(
    pipeline.executed_nodes.includes('Сформировать FINAL после Round 1'),
    false,
  );
  assert.equal(oracle.passed, true);
});

test('beta offline positive control keeps one explicit current subject resolved', async () => {
  const controls = loadAggregatorAntiOverfitFixture();
  const caseFixture = controls.cases.find(
    ({ case_id: caseId }) => caseId === 'legitimate_single_subject',
  );
  const pipeline = await runAggregatorRound1({
    fixture: caseFixture,
    modelResponse: caseFixture.recorded_api_response,
    workflowPath: betaAggregatorWorkflowPath,
  });
  const oracle = evaluateExplicitSemanticExpectation({
    caseFixture,
    checked: pipeline.checked,
    final: pipeline.final,
  });

  assert.equal(pipeline.route, 'round1_final');
  assert.equal(pipeline.final.aggregation_status, 'resolved');
  assert.equal(oracle.passed, true);
});

test('runtime eval remains explicit and its live path uses the route-aware helper', () => {
  const source = fs.readFileSync(runtimeEvalPath, 'utf8');
  assert.match(source, /--recorded/u);
  assert.match(source, /--live/u);
  assert.match(source, /--beta/u);
  assert.match(source, /--allow-paid-ai/u);
  assert.equal(
    LIVE_MODEL_ALIAS,
    'deepseek/deepseek-v4-pro-0813@provider=deepseek&reasoning_effort=low',
  );
  assert.match(source, /artifactRequest\.model\s*!==\s*LIVE_MODEL_ALIAS/u);
  assert.match(
    source,
    /runAggregatorRound1\(\{[\s\S]*?fixture,[\s\S]*?modelResponse,[\s\S]*?workflowPath[\s\S]*?\}\)/u,
  );
  assert.doesNotMatch(
    source,
    /executeWorkflowCodeNode\(\{[\s\S]*?nodeName:\s*'Сформировать FINAL после Round 1'/u,
  );

  assert.equal(
    fs.existsSync(aggregatorWorkflowPath),
    true,
    'Runtime evaluation must reference the real Aggregator workflow export.',
  );
});

test('RED pre-canary: live beta preparation and model contract come only from the explicit beta export', async () => {
  assert.equal(
    typeof runtimeEvaluator.prepareLiveBetaRuntimeRequest,
    'function',
    'Runtime evaluator must expose explicit beta preparation.',
  );
  const fixture = loadAggregatorFixture();
  const preparedRuntime = await runtimeEvaluator.prepareLiveBetaRuntimeRequest({
    fixture,
    workflowPath: betaAggregatorWorkflowPath,
  });

  assert.equal(preparedRuntime.workflow.workflow_id, 'ftvmrEHoMbPOAqZG');
  assert.equal(
    preparedRuntime.workflow.workflow_name,
    '[TEST CODEX] TENDER — Агрегация закупки',
  );
  assert.equal(
    preparedRuntime.workflow.workflow_path,
    'workflows/n8n-exports/beta/[TEST CODEX] TENDER — Агрегация закупки.json',
  );
  assert.match(preparedRuntime.workflow.workflow_sha256, /^[a-f0-9]{64}$/u);
  assert.match(
    preparedRuntime.prepared.user_prompt,
    /объектом именно текущей закупки/iu,
  );
  assert.equal(
    preparedRuntime.request.messages[0].content,
    preparedRuntime.prepared.system_prompt,
  );
  assert.equal(
    preparedRuntime.request.messages[1].content,
    preparedRuntime.prepared.user_prompt,
  );
  assert.equal(preparedRuntime.request.model, LIVE_MODEL_ALIAS);
  assert.equal(preparedRuntime.workflow.model_alias, LIVE_MODEL_ALIAS);
});

test('RED pre-canary: live beta response uses checker and routing from the same explicit beta workflow', async () => {
  assert.equal(
    typeof runtimeEvaluator.evaluateLiveBetaModelResponse,
    'function',
    'Runtime evaluator must expose explicit beta response evaluation.',
  );
  const controls = loadAggregatorAntiOverfitFixture();
  const fixture = controls.cases.find(
    ({ case_id: caseId }) => caseId === 'ambiguous_scope',
  );
  const pipeline = await runtimeEvaluator.evaluateLiveBetaModelResponse({
    fixture,
    modelResponse: fixture.correct_requires_recheck_api_response,
    workflowPath: betaAggregatorWorkflowPath,
  });

  assert.equal(pipeline.route, 'targeted_recheck');
  assert.equal(pipeline.final, null);
  assert.deepEqual(pipeline.workflow, {
    workflow_id: 'ftvmrEHoMbPOAqZG',
    workflow_name: '[TEST CODEX] TENDER — Агрегация закупки',
    workflow_path:
      'workflows/n8n-exports/beta/[TEST CODEX] TENDER — Агрегация закупки.json',
  });
});

test('RED pre-canary: beta runtime path errors before HTTP and never falls back to production', async () => {
  assert.equal(
    typeof runtimeEvaluator.prepareLiveBetaRuntimeRequest,
    'function',
    'Runtime evaluator must expose explicit beta preparation.',
  );
  const fixture = loadAggregatorFixture();
  const missingPath = path.join(testDirectory, 'missing-beta-aggregator.json');

  await assert.rejects(
    runtimeEvaluator.prepareLiveBetaRuntimeRequest({ fixture }),
    /explicit beta workflowPath/iu,
  );
  await assert.rejects(
    runtimeEvaluator.prepareLiveBetaRuntimeRequest({
      fixture,
      workflowPath: missingPath,
    }),
    /exact beta workflow artifact|anything except/iu,
  );
});

test('RED pre-canary: live CLI requires --beta before credentials or HTTP', () => {
  const baseEnv = {
    ...process.env,
    AGGREGATOR_RUNTIME_URL: 'http://127.0.0.1:1/must-not-be-called',
    AGGREGATOR_RUNTIME_API_KEY: 'offline-placeholder',
  };
  const withoutBeta = spawnSync(
    process.execPath,
    [runtimeEvalPath, '--live', '--allow-paid-ai'],
    { cwd: repositoryRoot, encoding: 'utf8', env: baseEnv },
  );

  assert.equal(withoutBeta.status, 2, withoutBeta.stderr || withoutBeta.stdout);
  assert.match(withoutBeta.stderr, /--live requires[^\n]*--beta/iu);
  assert.doesNotMatch(withoutBeta.stderr, /fetch failed|ECONNREFUSED/iu);

  const missingBeta = spawnSync(
    process.execPath,
    [runtimeEvalPath, '--live', '--beta', '--allow-paid-ai'],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {
        ...baseEnv,
        AGGREGATOR_BETA_WORKFLOW_PATH: path.join(
          testDirectory,
          'missing-beta-aggregator.json',
        ),
      },
    },
  );

  assert.equal(missingBeta.status, 2, missingBeta.stderr || missingBeta.stdout);
  assert.match(missingBeta.stderr, /exact beta workflow artifact|anything except/iu);
  assert.doesNotMatch(missingBeta.stderr, /fetch failed|ECONNREFUSED/iu);
});

test('RED pre-canary: live report records the exact beta workflow artifact and model alias', async () => {
  assert.equal(
    typeof runtimeEvaluator.prepareLiveBetaRuntimeRequest,
    'function',
    'Runtime evaluator must expose explicit beta preparation.',
  );
  const fixture = loadAggregatorFixture();
  const controls = loadAggregatorAntiOverfitFixture();
  const ambiguousFixture = controls.cases.find(
    ({ case_id: caseId }) => caseId === 'ambiguous_scope',
  );
  const preparedRuntime = await runtimeEvaluator.prepareLiveBetaRuntimeRequest({
    fixture,
    workflowPath: betaAggregatorWorkflowPath,
  });
  const pipeline = await runtimeEvaluator.evaluateLiveBetaModelResponse({
    fixture: ambiguousFixture,
    modelResponse: ambiguousFixture.correct_requires_recheck_api_response,
    workflowPath: betaAggregatorWorkflowPath,
  });
  const report = reportRuntimePipeline({
    mode: 'live',
    aiCalled: true,
    requestModel: preparedRuntime.request.model,
    responseModel: ambiguousFixture.correct_requires_recheck_api_response.model,
    workflow: preparedRuntime.workflow,
    fixture: ambiguousFixture,
    pipeline,
  });

  assert.equal(report.payload.workflow_id, 'ftvmrEHoMbPOAqZG');
  assert.equal(
    report.payload.workflow_name,
    '[TEST CODEX] TENDER — Агрегация закупки',
  );
  assert.equal(report.payload.workflow_path, preparedRuntime.workflow.workflow_path);
  assert.equal(
    report.payload.workflow_sha256,
    preparedRuntime.workflow.workflow_sha256,
  );
  assert.equal(report.payload.model_alias, LIVE_MODEL_ALIAS);
});

test('RED A/B contract exposes only the exact execution-snapshot model aliases', () => {
  assert.deepEqual(runtimeEvaluator.ALLOWED_RUNTIME_MODEL_ALIASES, [
    GLM_53_FLASH_ALIAS,
    GEMINI_37_FLASH_ALIAS,
  ]);
});

test('RED A/B contract clones the beta-derived request and changes only request.model', async () => {
  const fixture = loadAggregatorFixture();
  const beforeWorkflow = loadAggregatorWorkflow(betaAggregatorWorkflowPath);
  const baseline = await runtimeEvaluator.prepareLiveBetaRuntimeRequest({
    fixture,
    workflowPath: betaAggregatorWorkflowPath,
  });
  const overridden = await runtimeEvaluator.prepareLiveBetaRuntimeRequest({
    fixture,
    workflowPath: betaAggregatorWorkflowPath,
    args: liveOverrideArgs(),
    env: { AGGREGATOR_RUNTIME_MODEL_ALIAS: GLM_53_FLASH_ALIAS },
  });
  const afterWorkflow = loadAggregatorWorkflow(betaAggregatorWorkflowPath);
  const baselineWithoutModel = structuredClone(baseline.request);
  const overriddenWithoutModel = structuredClone(overridden.request);
  delete baselineWithoutModel.model;
  delete overriddenWithoutModel.model;

  assert.equal(baseline.request.model, LIVE_MODEL_ALIAS);
  assert.equal(overridden.request.model, GLM_53_FLASH_ALIAS);
  assert.deepEqual(overriddenWithoutModel, baselineWithoutModel);
  assert.deepEqual(overridden.prepared, baseline.prepared);
  assert.deepEqual(afterWorkflow, beforeWorkflow);
  assert.equal(overridden.workflow.artifact_model_alias, LIVE_MODEL_ALIAS);
  assert.equal(overridden.workflow.effective_request_model_alias, GLM_53_FLASH_ALIAS);
  assert.equal(overridden.workflow.model_override_applied, true);
});

test('RED A/B contract rejects missing override permission, empty alias, and unknown alias before HTTP', async () => {
  assert.equal(typeof runtimeEvaluator.runLiveCanary, 'function');
  const cases = [
    {
      label: 'missing explicit override flag',
      args: ['--live', '--beta', '--allow-paid-ai'],
      alias: GLM_53_FLASH_ALIAS,
      expected: /--allow-model-override/iu,
    },
    {
      label: 'empty alias',
      args: liveOverrideArgs(),
      alias: '   ',
      expected: /model alias.*empty|AGGREGATOR_RUNTIME_MODEL_ALIAS/iu,
    },
    {
      label: 'unknown alias',
      args: liveOverrideArgs(),
      alias: 'unknown/model@provider=unknown&reasoning_effort=low',
      expected: /not allowed|unknown model|allow-list/iu,
    },
  ];

  for (const control of cases) {
    let fetchCalls = 0;
    await assert.rejects(
      runtimeEvaluator.runLiveCanary({
        args: control.args,
        env: {
          AGGREGATOR_RUNTIME_API_KEY: 'offline-placeholder',
          AGGREGATOR_RUNTIME_MODEL_ALIAS: control.alias,
        },
        fetchImpl: async () => {
          fetchCalls += 1;
          throw new Error('fetch must not run');
        },
      }),
      (error) =>
        error?.exitCode === 2 &&
        control.expected.test(error.message),
      control.label,
    );
    assert.equal(fetchCalls, 0, control.label);
  }
});

test('RED A/B contract requires an alias when --allow-model-override is present', async () => {
  let fetchCalls = 0;
  await assert.rejects(
    runtimeEvaluator.runLiveCanary({
      args: liveOverrideArgs(),
      env: { AGGREGATOR_RUNTIME_API_KEY: 'offline-placeholder' },
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error('fetch must not run');
      },
    }),
    (error) =>
      error?.exitCode === 2 &&
      /AGGREGATOR_RUNTIME_MODEL_ALIAS/iu.test(error.message),
  );
  assert.equal(fetchCalls, 0);
});

test('RED A/B contract accepts each allowed alias and performs exactly one beta-derived HTTP call', async () => {
  const fixture = loadAggregatorFixture();
  const response = expectedExecution14104Response(fixture);
  response.provider = 'synthetic-offline-provider';
  response.usage = {
    prompt_tokens: 100,
    completion_tokens: 50,
    total_tokens: 150,
    cost: 0.123,
  };

  for (const alias of [GLM_53_FLASH_ALIAS, GEMINI_37_FLASH_ALIAS]) {
    const calls = [];
    const result = await runtimeEvaluator.runLiveCanary({
      args: liveOverrideArgs(),
      env: {
        AGGREGATOR_RUNTIME_API_KEY: 'offline-placeholder',
        AGGREGATOR_RUNTIME_MODEL_ALIAS: alias,
      },
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return {
          ok: true,
          status: 200,
          json: async () => response,
        };
      },
    });
    const requestBody = JSON.parse(calls[0].options.body);

    assert.equal(calls.length, 1);
    assert.equal(requestBody.model, alias);
    assert.equal(result.exitCode, 0);
    assert.equal(result.payload.artifact_model_alias, LIVE_MODEL_ALIAS);
    assert.equal(result.payload.effective_request_model_alias, alias);
    assert.equal(result.payload.model_override_applied, true);
  }
});

test('RED A/B runtime report contains the full execution, artifact, response, oracle, and exit audit', async () => {
  const fixture = loadAggregatorFixture();
  const response = expectedExecution14104Response(fixture);
  response.model = 'synthetic-response-model';
  response.provider = 'synthetic-response-provider';
  response.usage = {
    prompt_tokens: 321,
    completion_tokens: 123,
    total_tokens: 444,
    cost_details: { currency: 'raw-provider-value' },
  };
  const result = await runtimeEvaluator.runLiveCanary({
    args: liveOverrideArgs(),
    env: {
      AGGREGATOR_RUNTIME_API_KEY: 'offline-placeholder',
      AGGREGATOR_RUNTIME_MODEL_ALIAS: GEMINI_37_FLASH_ALIAS,
    },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => response,
    }),
  });
  const payload = result.payload;

  assert.equal(payload.source_execution_id, '14104');
  assert.equal(payload.fixture_sha256, FIXTURE_SHA256);
  assert.equal(payload.workflow_id, 'ftvmrEHoMbPOAqZG');
  assert.equal(payload.workflow_name, '[TEST CODEX] TENDER — Агрегация закупки');
  assert.equal(
    payload.workflow_path,
    'workflows/n8n-exports/beta/[TEST CODEX] TENDER — Агрегация закупки.json',
  );
  assert.equal(payload.workflow_sha256, BETA_WORKFLOW_SHA256);
  assert.equal(payload.artifact_model_alias, LIVE_MODEL_ALIAS);
  assert.equal(payload.effective_request_model_alias, GEMINI_37_FLASH_ALIAS);
  assert.equal(payload.model_override_applied, true);
  assert.equal(payload.response_model, response.model);
  assert.equal(payload.response_provider, response.provider);
  assert.equal(payload.finish_reason, 'stop');
  assert.deepEqual(payload.response_usage, response.usage);
  assert.equal(Number.isFinite(payload.latency_ms), true);
  assert.equal(payload.latency_ms >= 0, true);
  assert.equal(payload.checker_accepted, true);
  assert.equal(payload.route, 'round1_final');
  assert.equal(payload.final_status, 'resolved');
  assert.equal(payload.semantic_oracle_passed, true);
  assert.deepEqual(payload.oracle_checks, payload.oracle.checks);
  assert.deepEqual(payload.primary_fact_ids, [fixture.fact_ids_by_analysis_unit.doc_7_au_0001]);
  assert.equal(payload.target_analysis_unit_id, 'doc_7_au_0031');
  assert.equal(payload.target_role, 'not_applicable');
  assert.match(payload.final_value_text, /стандартн[а-яё]*\s+закрыт[а-яё]*\s+палуб/iu);
  assert.equal(payload.exit_code, 0);
  assert.deepEqual(payload.exit_code_semantics, {
    0: 'semantic_green_resolved',
    1: 'checker_rejection_or_oracle_failure',
    2: 'configuration_or_preflight_failure',
    3: 'safe_targeted_recheck_inconclusive',
  });
  assert.equal(JSON.stringify(payload).includes('offline-placeholder'), false);
});

test('RED A/B harness refuses canonical production workflow and preserves fixture and beta SHA-256', async () => {
  const fixture = loadAggregatorFixture();

  await assert.rejects(
    runtimeEvaluator.prepareLiveBetaRuntimeRequest({
      fixture,
      workflowPath: aggregatorWorkflowPath,
      args: liveOverrideArgs(),
      env: { AGGREGATOR_RUNTIME_MODEL_ALIAS: GLM_53_FLASH_ALIAS },
    }),
    /exact beta workflow artifact|anything except|refusing non-beta/iu,
  );
  assert.equal(sha256File(fixturePath), FIXTURE_SHA256);
  assert.equal(sha256File(betaAggregatorWorkflowPath), BETA_WORKFLOW_SHA256);
});

test('runtime reporting defers targeted_recheck without running the resolved-only oracle', () => {
  const helperPath = path.join(
    testDirectory,
    'helpers',
    'aggregator-runtime-eval.mjs',
  );
  const script = `
    const runtime = await import(${JSON.stringify(pathToFileURL(runtimeEvalPath).href)});
    const helper = await import(${JSON.stringify(pathToFileURL(helperPath).href)});
    const controls = helper.loadAggregatorAntiOverfitFixture();
    const fixture = controls.cases.find(({ case_id }) => case_id === 'ambiguous_scope');
    const pipeline = await helper.runAggregatorRound1({
      fixture,
      modelResponse: fixture.correct_requires_recheck_api_response,
    });
    if (pipeline.executed_nodes.includes('Сформировать FINAL после Round 1')) {
      throw new Error('Round 1 FINAL was executed on targeted_recheck route');
    }
    const report = runtime.reportRuntimePipeline({
      mode: 'live',
      aiCalled: true,
      requestModel: helper.LIVE_MODEL_ALIAS,
      responseModel: fixture.correct_requires_recheck_api_response.model,
      fixture,
      pipeline,
    });
    process.stdout.write(JSON.stringify(report.payload) + '\\n');
    process.exitCode = report.exitCode;
  `;
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', script],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
    },
  );

  assert.equal(result.stderr.includes('TypeError'), false, result.stderr);
  assert.equal(result.status, 3, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout.trim());
  assert.equal(output.route, 'targeted_recheck');
  assert.equal(output.final_status, null);
  assert.equal(output.false_resolved_prevented, true);
  assert.equal(output.semantic_outcome, 'deferred_to_targeted_recheck');
  assert.equal(output.semantic_oracle_passed, true);
  assert.deepEqual(output.oracle_checks, {
    checker_accepted: true,
    targeted_recheck_route: true,
    final_is_null: true,
    round1_final_not_executed: true,
  });
  assert.equal(output.exit_code, 3);
});

test('recorded runtime mode still reports the schema-valid false_resolved vulnerability', () => {
  const result = spawnSync(
    process.execPath,
    [runtimeEvalPath, '--recorded'],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout.trim());
  assert.equal(output.mode, 'recorded');
  assert.equal(output.ai_called, false);
  assert.equal(output.route, 'round1_final');
  assert.equal(output.final_status, 'resolved');
  assert.equal(output.semantic_oracle_passed, false);
  assert.equal(output.oracle.passed, false);
});

test('runtime reporting hard-fails route and final contract mismatches', () => {
  const checked = { aggregation_validated: true };

  assert.throws(
    () =>
      reportRuntimePipeline({
        mode: 'recorded',
        aiCalled: false,
        fixture: {},
        pipeline: { route: 'round1_final', checked, final: null },
      }),
    /round1_final route requires a FINAL result/u,
  );
  assert.throws(
    () =>
      reportRuntimePipeline({
        mode: 'live',
        aiCalled: true,
        fixture: {},
        pipeline: { route: 'targeted_recheck', checked, final: {} },
      }),
    /targeted_recheck route requires final=null/u,
  );
});
