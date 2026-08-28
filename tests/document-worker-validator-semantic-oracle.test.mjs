import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..');
const workflowPath = path.join(
  repositoryRoot,
  'workflows',
  'n8n-exports',
  'TENDER — Обработать документ.json',
);
const oraclePath = path.join(
  testDirectory,
  'fixtures',
  'document-worker-validator-runtime-eval.json',
);

function loadWorkflow() {
  return JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
}

function loadOracle() {
  return JSON.parse(fs.readFileSync(oraclePath, 'utf8'));
}

function oracleCases(oracle) {
  return oracle.units.flatMap((unitCase) =>
    unitCase.expectations.map((expectation) => ({
      ...expectation,
      source_execution_id: unitCase.source_execution_id,
      analysis_unit_id: unitCase.analysis_unit_id,
      fact: unitCase.validator_input.verified_facts.find(
        ({ fact_index: factIndex }) => factIndex === expectation.fact_index,
      ),
    })),
  );
}

function findNode(workflow, name) {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(node, `Workflow node not found: ${name}`);
  return node;
}

function validatorBody(workflow) {
  return findNode(workflow, 'AI Validator v1').parameters.jsonBody;
}

function systemPrompt(workflow) {
  const match = validatorBody(workflow).match(
    /role:\s*'system',\s*content:\s*`([\s\S]*?)`\s*\n\s*},/,
  );
  assert.ok(match, 'AI Validator system prompt not found');
  return match[1];
}

test('semantic oracle covers every required execution, semantic axis, and positive control', () => {
  const oracle = loadOracle();
  assert.equal(
    oracle.schema_version,
    'document_worker_ai_validator_runtime_eval_v1',
  );
  assert.deepEqual(oracle.source_execution_ids, [14094, 14096, 14097, 14102]);

  const cases = oracleCases(oracle);
  const negativeCases = cases.filter(
    ({ case_type: caseType }) => caseType === 'negative_boundary',
  );
  const positiveCases = cases.filter(
    ({ case_type: caseType }) => caseType === 'positive_control',
  );
  assert.deepEqual(
    [...new Set(negativeCases.map(({ source_execution_id: id }) => id))].sort(),
    [14094, 14096, 14097, 14102],
  );
  assert.deepEqual(
    [...new Set(negativeCases.map(({ semantic_axis: axis }) => axis))].sort(),
    [
      'actor',
      'assertion_type',
      'current_scope',
      'fact_local_evidence_coverage',
      'process_stage',
      'semantic_object',
    ],
  );
  assert.deepEqual(
    [...new Set(positiveCases.map(({ field_key: fieldKey }) => fieldKey))].sort(),
    [
      'advance_contract_guarantee',
      'customer',
      'delivery_term',
      'procurement_subject',
      'special_account_or_treasury',
    ],
  );
});

test('every oracle case links verdict boundaries to an exact execution-derived fact and FIELD_CATALOG basis', () => {
  const cases = oracleCases(loadOracle());
  const allowedVerdicts = new Set(['confirmed', 'requires_review', 'rejected']);

  for (const oracleCase of cases) {
    assert.match(oracleCase.analysis_unit_id, /^doc_\d+_au_\d+$/);
    assert.ok(Number.isInteger(oracleCase.fact_index));
    assert.ok(oracleCase.field_key.length > 0);
    assert.ok(oracleCase.fact, `Missing exact fact for ${oracleCase.case_id}`);
    assert.equal(oracleCase.fact.field_key, oracleCase.field_key);
    assert.ok(oracleCase.fact.value_text.length > 0);
    assert.ok(oracleCase.fact.evidence.length > 0);
    assert.ok(oracleCase.field_catalog_basis.startsWith('FIELD_CATALOG.md '));
    assert.ok(oracleCase.expected_allowed_verdicts.length > 0);
    assert.ok(oracleCase.forbidden_verdicts.length > 0);
    assert.equal(
      new Set([
        ...oracleCase.expected_allowed_verdicts,
        ...oracleCase.forbidden_verdicts,
      ]).size,
      allowedVerdicts.size,
    );
    for (const verdict of [
      ...oracleCase.expected_allowed_verdicts,
      ...oracleCase.forbidden_verdicts,
    ]) {
      assert.ok(allowedVerdicts.has(verdict));
    }
  }
});

test('wrong scope, actor, stage, object, and partial coverage cannot become confirmed', () => {
  const cases = oracleCases(loadOracle());
  const requiredAxes = [
    'current_scope',
    'actor',
    'process_stage',
    'semantic_object',
    'fact_local_evidence_coverage',
  ];

  for (const axis of requiredAxes) {
    const matchingCases = cases.filter(
      (oracleCase) => oracleCase.semantic_axis === axis,
    );
    assert.ok(matchingCases.length > 0, `Missing semantic oracle axis: ${axis}`);
    for (const oracleCase of matchingCases) {
      assert.ok(oracleCase.forbidden_verdicts.includes('confirmed'));
      assert.ok(!oracleCase.expected_allowed_verdicts.includes('confirmed'));
    }
  }
});

test('positive controls remain confirmed and cannot collapse into blanket requires_review', () => {
  const positiveCases = oracleCases(loadOracle()).filter(
    ({ case_type: caseType }) => caseType === 'positive_control',
  );
  assert.equal(positiveCases.length, 5);
  for (const oracleCase of positiveCases) {
    assert.deepEqual(oracleCase.expected_allowed_verdicts, ['confirmed']);
    assert.ok(oracleCase.forbidden_verdicts.includes('requires_review'));
    assert.ok(oracleCase.forbidden_verdicts.includes('rejected'));
  }
});

test('AI Validator uses Gemini 3.7 Flash and contains universal semantic axes and decision rules', () => {
  const workflow = loadWorkflow();
  const body = validatorBody(workflow);
  const prompt = systemPrompt(workflow);

  assert.match(
    body,
    /model:\s*'google\/gemini-3\.7-flash@provider=google-ai-studio\/flex&reasoning_effort=low'/,
  );
  for (const heading of [
    'CURRENT SCOPE',
    'ACTOR',
    'PROCESS STAGE',
    'SEMANTIC OBJECT',
    'ASSERTION TYPE',
    'FACT-LOCAL EVIDENCE COVERAGE',
    'UNIVERSAL DECISION RULE',
  ]) {
    assert.ok(prompt.includes(heading), `Missing prompt section: ${heading}`);
  }
  assert.match(prompt, /confirmed разрешен только если одновременно/i);
  assert.match(prompt, /Не используй requires_review для очевидно неправильной классификации/i);
  assert.match(prompt, /Не используй rejected только из-за незначительного форматирования/i);
});

test('AI Validator catalog includes the five universal field boundaries', () => {
  const profilesSource = findNode(
    loadWorkflow(),
    'Развернуть units для AI Validator',
  ).parameters.jsCode;
  const boundaries = {
    government_contract: /связанный или упомянутый договор/i,
    procurement_subject: /внутренние процессы организации/i,
    delivery_term: /графики передачи технической.*документации/i,
    application_documents: /документы гаранта или банка/i,
    special_account_or_treasury: /банковские реквизиты.*сами по себе/i,
  };

  for (const [fieldKey, boundaryPattern] of Object.entries(boundaries)) {
    const fieldStart = profilesSource.indexOf(
      `  ${fieldKey}: Object.freeze({`,
    );
    assert.notEqual(fieldStart, -1, `Missing field profile: ${fieldKey}`);
    const fieldText = profilesSource.slice(fieldStart, fieldStart + 2200);
    assert.match(fieldText, boundaryPattern, `Missing boundary for ${fieldKey}`);
  }
});

test('execution-derived identifiers and tender-specific literals remain fixture-only', () => {
  const prompt = systemPrompt(loadWorkflow());
  const oracle = loadOracle();

  for (const literal of oracle.production_prompt_forbidden_literals) {
    assert.ok(
      !prompt.includes(literal),
      `Execution-derived literal leaked into production prompt: ${literal}`,
    );
  }
  assert.doesNotMatch(prompt, /doc_\d+_au_\d+/);
  assert.doesNotMatch(prompt, /если встретил(?:ась|ось)? конкретн\w* фраз/i);
  assert.ok(!prompt.includes('"аванс предусмотрен"'));
  assert.ok(!prompt.includes('"в случаях, предусмотренных законодательством'));
});

test('validation cardinality and fact linking contracts remain unchanged', () => {
  const workflow = loadWorkflow();
  const body = validatorBody(workflow);
  const checker = findNode(workflow, 'Проверить ответ AI Validator');
  const targets = workflow.connections['AI Validator v1'].main[0].map(
    ({ node }) => node,
  );

  assert.deepEqual(targets, ['Проверить ответ AI Validator']);
  assert.match(body, /fact_index:\s*fact\.fact_index/);
  assert.match(body, /field_key:\s*fact\.field_key/);
  assert.match(body, /Верни ровно один validation для каждого переданного fact\./);
  assert.match(
    checker.parameters.jsCode,
    /parsed\.validations\.length\s*!==\s*sourceFacts\.length/,
  );
  assert.match(checker.parameters.jsCode, /validation\.fact_index/);
  assert.match(
    checker.parameters.jsCode,
    /validation\.field_key\s*!==\s*originalFact\.field_key/,
  );
  assert.equal(loadOracle().linking_regression.observed_expected_validations, 3);
  assert.equal(loadOracle().linking_regression.observed_received_validations, 2);
});
