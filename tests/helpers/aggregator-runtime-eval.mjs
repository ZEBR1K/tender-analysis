import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const helperDirectory = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(helperDirectory, '..', '..');
export const aggregatorWorkflowPath = path.join(
  repositoryRoot,
  'workflows',
  'n8n-exports',
  'TENDER — Агрегация закупки.json',
);
export const aggregatorFixturePath = path.join(
  repositoryRoot,
  'tests',
  'fixtures',
  'aggregator',
  'execution-14104-procurement-subject.json',
);
export const aggregatorAntiOverfitFixturePath = path.join(
  repositoryRoot,
  'tests',
  'fixtures',
  'aggregator',
  'procurement-subject-anti-overfit-controls.json',
);

export const LIVE_MODEL_ALIAS =
  'deepseek/deepseek-v4-pro-0813@provider=deepseek&reasoning_effort=low';

export function loadAggregatorWorkflow() {
  return JSON.parse(fs.readFileSync(aggregatorWorkflowPath, 'utf8'));
}

export function loadAggregatorFixture() {
  return JSON.parse(fs.readFileSync(aggregatorFixturePath, 'utf8'));
}

export function loadAggregatorAntiOverfitFixture() {
  return JSON.parse(fs.readFileSync(aggregatorAntiOverfitFixturePath, 'utf8'));
}

function findNode(workflow, nodeName) {
  const node = workflow.nodes.find(({ name }) => name === nodeName);
  if (!node) throw new Error(`Workflow node not found: ${nodeName}`);
  if (typeof node.parameters?.jsCode !== 'string') {
    throw new Error(`Workflow node does not contain jsCode: ${nodeName}`);
  }
  return node;
}

export async function executeWorkflowCodeNode({
  workflow,
  nodeName,
  inputJson,
  sourceJsonByNode = {},
}) {
  const node = findNode(workflow, nodeName);
  const inputItem = { json: structuredClone(inputJson) };
  const sources = Object.fromEntries(
    Object.entries(sourceJsonByNode).map(([name, json]) => [
      name,
      { json: structuredClone(json) },
    ]),
  );
  const context = vm.createContext({
    console,
    structuredClone,
    $json: inputItem.json,
    $input: {
      all: () => [inputItem],
      first: () => inputItem,
      item: inputItem,
    },
    $: (sourceNodeName) => {
      const sourceItem = sources[sourceNodeName];
      if (!sourceItem) {
        throw new Error(`Unknown workflow source node: ${sourceNodeName}`);
      }
      return {
        all: () => [sourceItem],
        first: () => sourceItem,
        itemMatching: () => sourceItem,
        item: sourceItem,
      };
    },
  });
  const result = await new vm.Script(
    `(async () => { ${node.parameters.jsCode}\n })()`,
  ).runInContext(context);
  const item = Array.isArray(result) ? result[0] : result;
  if (!item?.json) throw new Error(`${nodeName} returned no json item`);
  return JSON.parse(JSON.stringify(item.json));
}

export async function routeCheckedAggregation({ workflow, checked }) {
  if (checked.aggregation_validated !== true) {
    throw new Error(
      '[Aggregator test harness] Cannot route an unvalidated aggregation result.',
    );
  }
  if (
    checked.aggregation_status === 'resolved' &&
    checked.needs_recheck === false
  ) {
    const final = await executeWorkflowCodeNode({
      workflow,
      nodeName: 'Сформировать FINAL после Round 1',
      inputJson: checked,
    });
    return {
      route: 'round1_final',
      final,
      executed_nodes: ['Сформировать FINAL после Round 1'],
    };
  }
  if (
    checked.aggregation_status === 'requires_recheck' &&
    checked.needs_recheck === true
  ) {
    return {
      route: 'targeted_recheck',
      final: null,
      executed_nodes: [],
    };
  }
  throw new Error(
    `[Aggregator test harness] Inconsistent aggregation route contract: status=${checked.aggregation_status}, needs_recheck=${checked.needs_recheck}`,
  );
}

export async function runAggregatorRound1({ fixture, modelResponse }) {
  const workflow = loadAggregatorWorkflow();
  const prepared = await executeWorkflowCodeNode({
    workflow,
    nodeName: 'Подготовить запрос Semantic Aggregator',
    inputJson: fixture.aggregator_field_item,
  });
  const checked = await executeWorkflowCodeNode({
    workflow,
    nodeName: 'Проверить ответ Semantic Aggregator',
    inputJson: modelResponse,
    sourceJsonByNode: {
      'Подготовить запрос Semantic Aggregator': prepared,
    },
  });
  const routed = await routeCheckedAggregation({
    workflow,
    checked,
  });
  return {
    prepared,
    checked,
    route: routed.route,
    final: routed.final,
    executed_nodes: [
      'Подготовить запрос Semantic Aggregator',
      'Проверить ответ Semantic Aggregator',
      ...routed.executed_nodes,
    ],
  };
}

export function evaluateProcurementSubjectOracle({ fixture, checked, final }) {
  const ids = fixture.fact_ids_by_analysis_unit;
  const expectedCandidateIds = Object.values(ids);
  const decisionIds = checked.candidate_decisions.map(({ fact_id: factId }) => factId);
  const decisionCounts = Object.fromEntries(
    expectedCandidateIds.map((factId) => [
      factId,
      decisionIds.filter((candidateId) => candidateId === factId).length,
    ]),
  );
  const decisionById = new Map(
    checked.candidate_decisions.map((decision) => [decision.fact_id, decision]),
  );
  const primaryIds = checked.candidate_decisions
    .filter(({ role }) => role === 'primary')
    .map(({ fact_id: factId }) => factId);
  const allowedPrimaryIds = [
    ids.doc_7_au_0001,
    ids.doc_7_au_0008,
    ids.doc_7_au_0010,
  ];
  const forbiddenRoles = new Set([
    'primary',
    'supporting',
    'duplicate',
    'complement',
  ]);
  const finalText = String(final?.final_value_text ?? '');
  const targetDecision = decisionById.get(ids.doc_7_au_0031);

  const checks = {
    target_role_is_not_applicable:
      targetDecision?.role === 'not_applicable',
    target_has_no_forbidden_role:
      !forbiddenRoles.has(targetDecision?.role),
    primary_is_from_valid_subject_candidates:
      primaryIds.length === 1 && allowedPrimaryIds.includes(primaryIds[0]),
    final_describes_standard_deck_closures:
      /стандартн[а-яё]*\s+закрыт[а-яё]*\s+палуб/iu.test(finalText),
    final_excludes_equipment_maintenance:
      !/поддержан[а-яё]*\s+технологическ[а-яё]*\s+оборудован/iu.test(finalText),
    all_candidate_ids_present_exactly_once:
      decisionIds.length === expectedCandidateIds.length &&
      expectedCandidateIds.every((factId) => decisionCounts[factId] === 1),
  };

  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    observed: {
      target_role: targetDecision?.role ?? null,
      primary_ids: primaryIds,
      final_value_text: final?.final_value_text ?? null,
      decision_counts: decisionCounts,
    },
  };
}

export function evaluateExplicitSemanticExpectation({ caseFixture, checked, final }) {
  const expectation = caseFixture.semantic_expectation;
  const decisionById = new Map(
    checked.candidate_decisions.map((decision) => [decision.fact_id, decision]),
  );
  const primaryIds = checked.candidate_decisions
    .filter(({ role }) => role === 'primary')
    .map(({ fact_id: factId }) => factId);
  const finalText = String(final?.final_value_text ?? '').toLocaleLowerCase('ru-RU');
  const requiredRoleChecks = Object.fromEntries(
    Object.entries(expectation.required_roles).map(([factId, expectedRole]) => [
      factId,
      decisionById.get(factId)?.role === expectedRole,
    ]),
  );
  const checks = {
    expected_status: checked.aggregation_status === expectation.status,
    required_roles: Object.values(requiredRoleChecks).every(Boolean),
    primary_is_allowed:
      expectation.status !== 'resolved' ||
      (primaryIds.length === 1 &&
        expectation.allowed_primary_fact_ids.includes(primaryIds[0])),
    final_contains_expected_text:
      expectation.final_value_must_include.every((text) =>
        finalText.includes(text.toLocaleLowerCase('ru-RU'))),
    final_excludes_forbidden_text:
      expectation.final_value_must_exclude.every((text) =>
        !finalText.includes(text.toLocaleLowerCase('ru-RU'))),
  };
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    required_role_checks: requiredRoleChecks,
    observed: {
      status: checked.aggregation_status,
      primary_ids: primaryIds,
      final_value_text: final?.final_value_text ?? null,
    },
  };
}

export function evaluateSelfDeclaredSemanticAxisMatrix({ fixture, checked }) {
  const matrix = fixture.proposed_semantic_axis_contract.formal_primary_matrix;
  const primaryDecisions = checked.candidate_decisions.filter(
    ({ role }) => role === 'primary',
  );
  const roleAxisConsistency = checked.candidate_decisions.every((decision) => {
    const applicability = decision.semantic_axes?.applicability;
    return decision.role === 'not_applicable'
      ? applicability === 'not_applicable'
      : applicability === 'applicable';
  });
  const primary = primaryDecisions[0];
  const checks = {
    exactly_one_primary: primaryDecisions.length === 1,
    roles_match_self_declared_applicability: roleAxisConsistency,
    primary_self_declares_current_scope:
      primary?.semantic_axes?.scope === matrix.scope,
    primary_self_declares_expected_object:
      primary?.semantic_axes?.semantic_object === matrix.semantic_object,
    primary_self_declares_applicable:
      primary?.semantic_axes?.applicability === matrix.applicability,
  };
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    observed_primary: primary ?? null,
    trusted_external_signal_used: false,
  };
}

export async function evaluateRecordedFixture(fixture = loadAggregatorFixture()) {
  const pipeline = await runAggregatorRound1({
    fixture,
    modelResponse: fixture.recorded_false_resolved_api_response,
  });
  return {
    ...pipeline,
    oracle: evaluateProcurementSubjectOracle({
      fixture,
      checked: pipeline.checked,
      final: pipeline.final,
    }),
  };
}

export async function evaluateAntiOverfitCase(caseFixture) {
  const pipeline = await runAggregatorRound1({
    fixture: caseFixture,
    modelResponse: caseFixture.recorded_api_response,
  });
  return {
    ...pipeline,
    oracle: evaluateExplicitSemanticExpectation({
      caseFixture,
      checked: pipeline.checked,
      final: pipeline.final,
    }),
  };
}
