import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
  loadAggregatorAntiOverfitFixture,
  loadAggregatorFixture,
  loadAggregatorWorkflow,
  routeCheckedAggregation,
  runAggregatorRound1,
} from './helpers/aggregator-runtime-eval.mjs';
import { reportRuntimePipeline } from './runtime/aggregator-procurement-subject-runtime-eval.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..');
const runtimeEvalPath = path.join(
  testDirectory,
  'runtime',
  'aggregator-procurement-subject-runtime-eval.mjs',
);
const fieldCatalogPath = path.join(repositoryRoot, 'FIELD_CATALOG.md');

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
  const prepareCode = workflow.nodes.find(
    ({ name }) => name === 'Подготовить запрос Semantic Aggregator',
  ).parameters.jsCode;
  const start = prepareCode.indexOf('procurement_subject: {');
  const end = prepareCode.indexOf('nm_price_with_vat:', start);
  assert.ok(start >= 0 && end > start, 'procurement_subject FIELD_RULES not found');
  const rules = prepareCode.slice(start, end).toLocaleLowerCase('ru-RU');
  const requiredSignals = [
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

  for (const { label, patterns } of requiredSignals) {
    assert.equal(
      patterns.some((pattern) => pattern.test(rules)),
      true,
      `Missing universal procurement_subject rule: ${label}`,
    );
  }
});

test('runtime eval remains explicit and its live path uses the route-aware helper', () => {
  const source = fs.readFileSync(runtimeEvalPath, 'utf8');
  assert.match(source, /--recorded/u);
  assert.match(source, /--live/u);
  assert.match(source, /--allow-paid-ai/u);
  assert.equal(
    LIVE_MODEL_ALIAS,
    'deepseek/deepseek-v4-pro-0813@provider=deepseek&reasoning_effort=low',
  );
  assert.match(source, /model:\s*LIVE_MODEL_ALIAS/u);
  assert.match(source, /runAggregatorRound1\(\{\s*fixture,\s*modelResponse\s*\}\)/u);
  assert.doesNotMatch(source, /Сформировать FINAL после Round 1/u);

  assert.equal(
    fs.existsSync(aggregatorWorkflowPath),
    true,
    'Runtime evaluation must reference the real Aggregator workflow export.',
  );
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
  assert.equal(Object.hasOwn(output, 'semantic_oracle_passed'), false);
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
