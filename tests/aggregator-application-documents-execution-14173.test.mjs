import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  executeWorkflowCodeNode,
  loadAggregatorWorkflow,
  runAggregatorRound1,
} from './helpers/aggregator-runtime-eval.mjs';
import { evaluateApplicationDocumentsOracle } from './helpers/application-documents-oracle.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..');
const fieldCatalogPath = path.join(repositoryRoot, 'FIELD_CATALOG.md');
const betaWorkflowPath = path.join(
  repositoryRoot,
  'workflows',
  'n8n-exports',
  'beta',
  '[TEST CODEX] TENDER — Агрегация закупки.json',
);
const canonicalWorkflowPath = path.join(
  repositoryRoot,
  'workflows',
  'n8n-exports',
  'TENDER — Агрегация закупки.json',
);
const executionFixturePath = path.join(
  testDirectory,
  'fixtures',
  'aggregator',
  'execution-14173-application-documents.json',
);
const controlsFixturePath = path.join(
  testDirectory,
  'fixtures',
  'aggregator',
  'application-documents-anti-overfit-controls.json',
);

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadExecutionFixture() {
  return loadJson(executionFixturePath);
}

function loadControlsFixture() {
  return loadJson(controlsFixturePath);
}

function countRoles(decisions) {
  const roles = [
    'primary',
    'complement',
    'duplicate',
    'supporting',
    'conflict',
    'not_applicable',
  ];
  return Object.fromEntries(
    roles.map((role) => [
      role,
      decisions.filter((decision) => decision.role === role).length,
    ]),
  );
}

function buildSafeRequiresRecheckResponse(fixture) {
  const response = structuredClone(fixture.recorded_schema_valid_api_response);
  const content = JSON.parse(response.choices[0].message.content);
  const control = fixture.safe_requires_recheck_structural_control;

  response.id = control.response_id;
  response.model = control.model;
  content.status = 'requires_recheck';
  content.final_value_text = null;
  content.confidence = control.confidence;
  content.needs_recheck = true;
  content.recheck_reason_code = control.recheck_reason_code;
  content.recheck_note = control.recheck_note;
  response.choices[0].message.content = JSON.stringify(content);

  return response;
}

function collectObjectKeys(value, keys = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectObjectKeys(item, keys);
    return keys;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key);
      collectObjectKeys(child, keys);
    }
  }
  return keys;
}

function evaluateRequiresReviewCorroborationControl({
  caseFixture,
  checked,
  final,
  route,
}) {
  const control = caseFixture.corroboration_oracle;
  const candidatesById = new Map(
    caseFixture.aggregator_field_item.candidates.map((candidate) => [
      candidate.fact_id,
      candidate,
    ]),
  );
  const normalize = (value) =>
    String(value ?? '')
      .toLocaleLowerCase('ru-RU')
      .replace(/[.,;:!?()]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
  const clauseText = normalize(control.material_clause_text);
  const reviewedCandidate = candidatesById.get(control.requires_review_fact_id);
  const linkedConfirmedCandidate = candidatesById.get(
    control.link.to_confirmed_fact_id,
  );
  const linkedValueMatches = normalize(
    linkedConfirmedCandidate?.value_text,
  ).includes(clauseText);
  const linkedEvidenceMatches = linkedConfirmedCandidate?.evidence.some(
    ({ quote }) => normalize(quote).includes(clauseText),
  ) === true;

  const checks = {
    structural_round1_resolved:
      route === 'round1_final' &&
      checked.aggregation_status === 'resolved' &&
      final !== null,
    reviewed_candidate_is_requires_review:
      reviewedCandidate?.validator_verdict === 'requires_review',
    explicit_link_is_direct_and_complete:
      control.link.from_requires_review_fact_id ===
        control.requires_review_fact_id &&
      control.link.relation === 'direct_full_semantic_corroboration' &&
      control.link.direct === true &&
      control.link.complete === true &&
      typeof control.link.classification_basis === 'string' &&
      control.link.classification_basis.trim().length > 0,
    linked_fact_is_independent_and_confirmed:
      control.link.to_confirmed_fact_id !== control.requires_review_fact_id &&
      linkedConfirmedCandidate?.validator_verdict === 'confirmed',
    linked_confirmed_fact_matches_clause:
      linkedValueMatches && linkedEvidenceMatches,
    final_preserves_material_clause:
      normalize(final?.final_value_text).includes(clauseText),
  };

  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    failed_checks: Object.entries(checks)
      .filter(([, passed]) => !passed)
      .map(([name]) => name),
    observed: {
      control_kind: caseFixture.control_kind,
      requires_review_fact_id: control.requires_review_fact_id,
      linked_confirmed_fact_id: control.link.to_confirmed_fact_id,
      linked_value_matches: linkedValueMatches,
      linked_evidence_matches: linkedEvidenceMatches,
    },
  };
}

function assertControlExpectation(caseFixture, pipeline) {
  const expectation = caseFixture.semantic_expectation;
  const reportedResult =
    pipeline.checked.semantic_aggregator_meta?.reported_result ??
    pipeline.checked;
  const containmentApplied =
    pipeline.checked.semantic_aggregator_meta?.containment_applied === true;
  const decisionById = new Map(
    reportedResult.candidate_decisions.map((decision) => [
      decision.fact_id,
      decision,
    ]),
  );
  assert.equal(reportedResult.status ?? pipeline.checked.aggregation_status, expectation.status);
  if (containmentApplied) {
    assert.equal(expectation.route, 'round1_final');
    assert.equal(pipeline.checked.aggregation_status, 'requires_recheck');
    assert.equal(pipeline.route, 'targeted_recheck');
    assert.equal(pipeline.final, null);
  } else {
    assert.equal(pipeline.checked.aggregation_status, expectation.status);
    assert.equal(pipeline.route, expectation.route);
  }
  for (const [factId, expectedRole] of Object.entries(expectation.required_roles)) {
    assert.equal(
      decisionById.get(factId)?.role,
      expectedRole,
      `Unexpected role for control fact_id=${factId}`,
    );
  }
  const finalText = String(
    containmentApplied
      ? reportedResult.final_value_text
      : pipeline.final?.final_value_text ?? '',
  ).toLocaleLowerCase('ru-RU');
  for (const fragment of expectation.final_value_must_include) {
    assert.equal(
      finalText.includes(fragment.toLocaleLowerCase('ru-RU')),
      true,
      `Missing expected control final fragment: ${fragment}`,
    );
  }
}

test('execution-derived fixture is minimal, sanitized, and preserves the 28-candidate contract', () => {
  const fixture = loadExecutionFixture();
  const serialized = JSON.stringify(fixture);
  const objectKeys = collectObjectKeys(fixture).join('\n');
  const candidates = fixture.aggregator_field_item.candidates;

  assert.equal(fixture.provenance.source_execution_id, '14173');
  assert.equal(fixture.provenance.source_analysis_run_id_persisted, false);
  assert.equal(fixture.fact_id_policy.origin, 'stable_fixture_uuid_not_production');
  assert.equal(candidates.length, 28);
  assert.equal(candidates.filter(({ validator_verdict: verdict }) => verdict === 'confirmed').length, 21);
  assert.equal(candidates.filter(({ validator_verdict: verdict }) => verdict === 'requires_review').length, 7);
  assert.ok(candidates.every(({ evidence }) => evidence.length <= 1));
  assert.doesNotMatch(objectKeys, /^(credentials|headers|authorization|api[_-]?key|password)$/imu);
  assert.doesNotMatch(serialized, /5605dbf4-ac39-4225-b11a-ae2dc17b3a56/iu);
});

test('fixture classifies every requires_review fact by independently confirmed and unresolved clauses', () => {
  const fixture = loadExecutionFixture();
  const candidatesById = new Map(
    fixture.aggregator_field_item.candidates.map((candidate) => [
      candidate.fact_id,
      candidate,
    ]),
  );
  const requiresReviewFactIds = fixture.aggregator_field_item.candidates
    .filter(({ validator_verdict: verdict }) => verdict === 'requires_review')
    .map(({ fact_id: factId }) => factId)
    .sort();
  const classifications =
    fixture.semantic_oracle.requires_review_clause_classification ?? [];

  assert.deepEqual(
    classifications.map(({ fact_id: factId }) => factId).sort(),
    requiresReviewFactIds,
  );
  assert.ok(
    classifications.some(({ independently_confirmed_clauses: clauses }) =>
      clauses.some(({ independent_direct_evidence_fact_ids: factIds }) =>
        factIds.length > 0)),
  );
  assert.ok(
    classifications.some(({ unresolved_material_clauses: clauses }) =>
      clauses.some(({ independent_direct_evidence_fact_ids: factIds }) =>
        factIds.length === 0)),
  );
  for (const classification of classifications) {
    assert.match(classification.classification_basis, /\S/u);
    for (const clause of classification.independently_confirmed_clauses) {
      assert.match(clause.classification_basis, /\S/u);
      assert.ok(clause.independent_direct_evidence_fact_ids.length > 0);
      for (const factId of clause.independent_direct_evidence_fact_ids) {
        assert.notEqual(factId, classification.fact_id);
        assert.equal(candidatesById.get(factId)?.validator_verdict, 'confirmed');
        assert.ok(candidatesById.get(factId)?.evidence.length > 0);
      }
    }
    for (const clause of classification.unresolved_material_clauses) {
      assert.match(clause.classification_basis, /\S/u);
    }
  }
});

test('anti-overfit cases are labeled as synthetic recorded structural controls', () => {
  const controls = loadControlsFixture();
  const corroborationControls = controls.cases.filter(
    ({ corroboration_oracle: oracle }) => oracle !== undefined,
  );

  assert.equal(
    controls.provenance.control_kind,
    'synthetic_recorded_structural_controls',
  );
  assert.ok(
    controls.provenance.limitations.includes(
      'Prewritten responses do not test AI model behavior.',
    ),
  );
  assert.ok(
    controls.provenance.limitations.includes(
      'Prewritten responses do not prove prompt compliance.',
    ),
  );
  assert.equal(corroborationControls.length, 2);
  assert.ok(
    corroborationControls.every(
      ({ control_kind: kind }) =>
        kind === 'synthetic_recorded_structural_oracle_control',
    ),
  );
  assert.ok(
    corroborationControls.every(({ does_not_prove: limitations }) =>
      limitations.includes('AI model behavior') &&
      limitations.includes('prompt compliance')),
  );
});

test('actual canonical production jsCode accepts the recorded response, routes Round 1 FINAL, and materializes resolved', async () => {
  const fixture = loadExecutionFixture();
  const pipeline = await runAggregatorRound1({
    fixture,
    modelResponse: fixture.recorded_schema_valid_api_response,
    workflowPath: canonicalWorkflowPath,
  });

  assert.deepEqual(pipeline.executed_nodes, [
    'Подготовить запрос Semantic Aggregator',
    'Проверить ответ Semantic Aggregator',
    'Сформировать FINAL после Round 1',
  ]);
  assert.equal(pipeline.prepared.allowed_fact_ids.length, 28);
  assert.equal(new Set(pipeline.prepared.allowed_fact_ids).size, 28);
  assert.equal(pipeline.checked.aggregation_validated, true);
  assert.equal(pipeline.checked.aggregation_status, 'resolved');
  assert.equal(pipeline.checked.needs_recheck, false);
  assert.deepEqual(countRoles(pipeline.checked.candidate_decisions), {
    primary: 1,
    complement: 22,
    duplicate: 3,
    supporting: 0,
    conflict: 0,
    not_applicable: 2,
  });
  assert.equal(pipeline.route, 'round1_final');
  assert.equal(pipeline.final.aggregation_status, 'resolved');
  assert.equal(pipeline.final.requires_human_review, false);
  assert.equal(pipeline.final.resolution_method, 'semantic_aggregator_round_1');
  assert.equal(pipeline.final.aggregation_round, 1);
  assert.equal(pipeline.final.confidence, 0.9);
});

test('diagnostic proof: the schema-valid resolved path fails the application_documents semantic oracle', async () => {
  const fixture = loadExecutionFixture();
  const pipeline = await runAggregatorRound1({
    fixture,
    modelResponse: fixture.recorded_schema_valid_api_response,
    workflowPath: canonicalWorkflowPath,
  });
  const oracle = evaluateApplicationDocumentsOracle({
    fixture,
    checked: pipeline.checked,
    final: pipeline.final,
    route: pipeline.route,
  });

  assert.equal(pipeline.checked.aggregation_validated, true);
  assert.equal(pipeline.route, 'round1_final');
  assert.equal(pipeline.final.aggregation_status, 'resolved');
  assert.equal(oracle.passed, false);
  assert.equal(oracle.semantic_outcome, 'round1_final_evaluated');
  assert.deepEqual(oracle.failed_checks, [
    'direct_current_application_scope_only',
    'due_diligence_or_qualification_stage_not_equated_to_application',
    'participant_type_conditions_preserved',
    'exact_periods_preserved',
    'exact_deadlines_preserved',
    'authority_bankruptcy_and_location_preserved',
    'file_format_size_and_media_preserved',
    'vague_period_not_used',
      'unresolved_material_requires_review_not_silently_promoted',
    'all_material_confirmed_requirements_preserved',
  ]);
});

test('safe synthetic execution-derived requires_recheck response passes the route-aware oracle', async () => {
  const fixture = loadExecutionFixture();
  const pipeline = await runAggregatorRound1({
    fixture,
    modelResponse: buildSafeRequiresRecheckResponse(fixture),
    workflowPath: betaWorkflowPath,
  });
  const oracle = evaluateApplicationDocumentsOracle({
    fixture,
    checked: pipeline.checked,
    final: pipeline.final,
    route: pipeline.route,
  });

  assert.equal(pipeline.checked.aggregation_status, 'requires_recheck');
  assert.equal(pipeline.checked.needs_recheck, true);
  assert.equal(pipeline.checked.recheck_reason_code, 'ambiguous_scope');
  assert.equal(pipeline.route, 'targeted_recheck');
  assert.equal(pipeline.final, null);
  assert.equal(oracle.semantic_outcome, 'deferred_to_targeted_recheck');
  assert.equal(
    Object.hasOwn(oracle.checks, 'participant_type_conditions_preserved'),
    false,
  );
  assert.ok(oracle.skipped_resolved_only_checks.includes('scope'));
  assert.equal(oracle.passed, true);
  assert.deepEqual(
    fixture.safe_requires_recheck_structural_control.does_not_prove,
    [
      'AI model behavior',
      'prompt compliance',
      'Targeted Recheck outcome',
    ],
  );
});

test('synthetic oracle control: a directly corroborated raw result is still contained in Round 1', async () => {
  const caseFixture = loadControlsFixture().cases.find(
    ({ case_id: caseId }) =>
      caseId === 'directly_corroborated_requires_review_clause',
  );
  assert.ok(caseFixture, 'Missing genuine corroboration synthetic fixture.');

  const pipeline = await runAggregatorRound1({
    fixture: caseFixture,
    modelResponse: caseFixture.recorded_api_response,
    workflowPath: betaWorkflowPath,
  });
  const oracle = evaluateRequiresReviewCorroborationControl({
    caseFixture,
    checked: {
      ...pipeline.checked.semantic_aggregator_meta.reported_result,
      aggregation_status:
        pipeline.checked.semantic_aggregator_meta.reported_status,
    },
    final: {
      final_value_text:
        pipeline.checked.semantic_aggregator_meta.reported_result.final_value_text,
    },
    route: 'round1_final',
  });

  assert.equal(pipeline.route, 'targeted_recheck');
  assert.equal(pipeline.checked.aggregation_status, 'requires_recheck');
  assert.equal(pipeline.final, null);
  assert.equal(pipeline.checked.semantic_aggregator_meta.reported_status, 'resolved');
  assert.equal(oracle.checks.explicit_link_is_direct_and_complete, true);
  assert.equal(oracle.checks.linked_confirmed_fact_matches_clause, true);
  assert.equal(oracle.passed, true);
});

test('synthetic oracle control: an unrelated raw fact remains invalid while Round 1 is contained', async () => {
  const caseFixture = loadControlsFixture().cases.find(
    ({ case_id: caseId }) =>
      caseId === 'unrelated_confirmed_fact_does_not_corroborate_clause',
  );
  assert.ok(caseFixture, 'Missing unrelated-evidence negative fixture.');

  const pipeline = await runAggregatorRound1({
    fixture: caseFixture,
    modelResponse: caseFixture.recorded_api_response,
    workflowPath: betaWorkflowPath,
  });
  const oracle = evaluateRequiresReviewCorroborationControl({
    caseFixture,
    checked: {
      ...pipeline.checked.semantic_aggregator_meta.reported_result,
      aggregation_status:
        pipeline.checked.semantic_aggregator_meta.reported_status,
    },
    final: {
      final_value_text:
        pipeline.checked.semantic_aggregator_meta.reported_result.final_value_text,
    },
    route: 'round1_final',
  });

  assert.equal(pipeline.route, 'targeted_recheck');
  assert.equal(pipeline.checked.aggregation_status, 'requires_recheck');
  assert.equal(pipeline.final, null);
  assert.equal(pipeline.checked.semantic_aggregator_meta.reported_status, 'resolved');
  assert.equal(oracle.checks.explicit_link_is_direct_and_complete, true);
  assert.equal(oracle.checks.linked_confirmed_fact_matches_clause, false);
  assert.equal(oracle.passed, false);
  assert.ok(oracle.failed_checks.includes('linked_confirmed_fact_matches_clause'));
});

test('RED actionable: application_documents FIELD_RULES do not broaden FIELD_CATALOG scope', async () => {
  const fixture = loadExecutionFixture();
  const workflow = loadAggregatorWorkflow(betaWorkflowPath);
  const catalog = fs.readFileSync(fieldCatalogPath, 'utf8');
  const prepared = await executeWorkflowCodeNode({
    workflow,
    nodeName: 'Подготовить запрос Semantic Aggregator',
    inputJson: fixture.aggregator_field_item,
  });
  const oracle = fixture.semantic_oracle;
  const rules = prepared.aggregation_input.field_definition.rules;

  assert.equal(catalog.includes(oracle.authoritative_catalog_definition), true);
  assert.match(
    prepared.aggregation_input.field_definition.definition,
    /именно в составе заявки/iu,
  );
  assert.equal(
    rules.includes(oracle.broadened_prompt_rule),
    false,
    'FIELD_CATALOG limits application_documents to the application itself, but beta FIELD_RULES broaden it to an unspecified participation stage.',
  );
});

test('synthetic recorded structural control: explicit current-application document remains resolved', async () => {
  const caseFixture = loadControlsFixture().cases.find(
    ({ case_id: caseId }) => caseId === 'explicit_current_application_document',
  );
  const pipeline = await runAggregatorRound1({
    fixture: caseFixture,
    modelResponse: caseFixture.recorded_api_response,
    workflowPath: betaWorkflowPath,
  });
  assertControlExpectation(caseFixture, pipeline);
});

test('synthetic recorded structural control: separate post-contract document becomes not_applicable', async () => {
  const caseFixture = loadControlsFixture().cases.find(
    ({ case_id: caseId }) => caseId === 'post_contract_document',
  );
  const pipeline = await runAggregatorRound1({
    fixture: caseFixture,
    modelResponse: caseFixture.recorded_api_response,
    workflowPath: betaWorkflowPath,
  });
  assertControlExpectation(caseFixture, pipeline);
});

test('synthetic recorded structural control: ambiguous participation-stage document routes to requires_recheck', async () => {
  const caseFixture = loadControlsFixture().cases.find(
    ({ case_id: caseId }) => caseId === 'ambiguous_participation_stage',
  );
  const pipeline = await runAggregatorRound1({
    fixture: caseFixture,
    modelResponse: caseFixture.recorded_api_response,
    workflowPath: betaWorkflowPath,
  });
  assertControlExpectation(caseFixture, pipeline);
  assert.equal(pipeline.final, null);
  assert.equal(
    pipeline.executed_nodes.includes('Сформировать FINAL после Round 1'),
    false,
  );
});

function assertExportContainsNoExecutionSpecificLiterals(workflowPath, exportLabel) {
  const workflow = loadAggregatorWorkflow(workflowPath);
  const promptAndCode = workflow.nodes
    .flatMap(({ parameters = {} }) => [parameters.jsCode, parameters.jsonBody])
    .filter((value) => typeof value === 'string')
    .join('\n')
    .toLocaleLowerCase('ru-RU');
  const forbidden = [
    '14173',
    '5605dbf4-ac39-4225-b11a-ae2dc17b3a56',
    'ооо «сск «звезда»',
    'execution-derived-application-documents.docx',
    ...loadExecutionFixture().aggregator_field_item.candidates.map(
      ({ fact_id: factId }) => factId,
    ),
  ];

  for (const literal of forbidden) {
    assert.equal(
      promptAndCode.includes(literal.toLocaleLowerCase('ru-RU')),
      false,
      `${exportLabel} prompt/code contains execution-specific literal: ${literal}`,
    );
  }
}

test('beta Aggregator export contains no execution-specific literals', () => {
  assertExportContainsNoExecutionSpecificLiterals(betaWorkflowPath, 'Beta export');
});

test('canonical production Aggregator export contains no execution-specific literals', () => {
  assertExportContainsNoExecutionSpecificLiterals(
    canonicalWorkflowPath,
    'Canonical production export',
  );
});
