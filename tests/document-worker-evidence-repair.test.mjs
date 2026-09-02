import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..');
const workflowPath = path.join(
  repositoryRoot,
  'workflows',
  'n8n-exports',
  'TENDER — Обработать документ.json',
);
const betaWorkflowPath = path.join(
  repositoryRoot,
  'workflows',
  'n8n-exports',
  'beta',
  '[3 TEST] TENDER — Обработать документ.json',
);
const aggregatorWorkflowPath = path.join(
  repositoryRoot,
  'workflows',
  'n8n-exports',
  'TENDER — Агрегация закупки.json',
);
const manifestPath = path.join(
  testDirectory,
  'fixtures',
  'document-worker-evidence',
  'execution-manifest.json',
);
const productionCasesPath = path.join(
  testDirectory,
  'fixtures',
  'document-worker-evidence',
  'production-cases.json',
);
const coordinateTableFixturePath = path.join(
  testDirectory,
  'fixtures',
  'document-worker-evidence',
  'execution-14059-doc-11-au-0005.json',
);
const overlapOnlyFixturePath = path.join(
  testDirectory,
  'fixtures',
  'document-worker-evidence',
  'execution-14061-overlap-only-units.json',
);
const validatorDispatchFixturePath = path.join(
  testDirectory,
  'fixtures',
  'document-worker-evidence',
  'execution-14061-validator-dispatch.json',
);
const execution14075FixturePath = path.join(
  testDirectory,
  'fixtures',
  'document-worker-evidence',
  'execution-14075-doc-11-au-0002.json',
);
const synthetic14371ReferenceOnlyFixturePath = path.join(
  testDirectory,
  'fixtures',
  'document-worker-evidence',
  'synthetic-14371-reference-only-structure.json',
);

function loadWorkflow() {
  return JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
}

function loadBetaWorkflow() {
  return JSON.parse(fs.readFileSync(betaWorkflowPath, 'utf8'));
}

function workflowConnectionEdges(workflow) {
  const edges = [];

  for (const [sourceNode, connectionTypes] of Object.entries(workflow.connections)) {
    for (const [connectionType, outputs] of Object.entries(connectionTypes)) {
      outputs.forEach((targets, outputIndex) => {
        for (const target of targets ?? []) {
          edges.push([
            sourceNode,
            connectionType,
            outputIndex,
            target.node,
            target.type,
            target.index,
          ].join('|'));
        }
      });
    }
  }

  return edges.sort();
}

function nodeRuntimeSettings(node) {
  const {
    id,
    webhookId,
    name,
    position,
    parameters,
    credentials,
    type,
    typeVersion,
    ...settings
  } = node;
  return settings;
}

function findNode(workflow, name) {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(node, `Workflow node not found: ${name}`);
  return node;
}

function connectedTargets(workflow, sourceName, outputIndex = 0) {
  return (workflow.connections[sourceName]?.main?.[outputIndex] ?? []).map(
    (connection) => connection.node,
  );
}

function hasPathAvoidingNodeTypes(
  workflow,
  sourceName,
  targetName,
  blockedNodeTypes,
) {
  const nodesByName = new Map(
    workflow.nodes.map((node) => [node.name, node]),
  );
  const pending = [sourceName];
  const visited = new Set();

  while (pending.length > 0) {
    const currentName = pending.pop();
    if (visited.has(currentName)) continue;
    visited.add(currentName);
    if (currentName === targetName) return true;

    const outputs = workflow.connections[currentName]?.main ?? [];
    for (const output of outputs) {
      for (const connection of output ?? []) {
        const targetNode = nodesByName.get(connection.node);
        if (!targetNode || blockedNodeTypes.has(targetNode.type)) continue;
        pending.push(connection.node);
      }
    }
  }

  return false;
}

async function runCodeNodeItemsWithSources(
  workflow,
  nodeName,
  inputJsons,
  sourceJsonsByNode,
) {
  const node = findNode(workflow, nodeName);
  const effectiveInputJsons = nodeName === 'Проверить и привязать evidence'
    ? inputJsons.map((providerResponse, index) => {
        const sources = sourceJsonsByNode['Подготовить запрос для AI'];
        const source = sources?.[index] ?? sources?.[0];
        assert.ok(source, 'Primary Extractor validator fixture requires explicit source.');
        return {
          attempt_transport: {
            version: 'ai_extractor_attempt_transport_v1',
            attempt: 'primary',
            analysis_unit_id: source.analysis_unit_meta?.analysis_unit_id ?? null,
            model_alias: 'z-ai/glm-5.3-flash@provider=cloudflare&reasoning_effort=low',
            transport_status: 'succeeded',
            source: structuredClone(source),
            provider_response: structuredClone(providerResponse),
            failure_class: null,
            failure_code: null,
          },
        };
      })
    : inputJsons;
  const inputItems = effectiveInputJsons.map((inputJson) => ({
    json: structuredClone(inputJson),
  }));
  const sourceItemsByNode = Object.fromEntries(
    Object.entries(sourceJsonsByNode).map(([sourceNodeName, sourceJsons]) => [
      sourceNodeName,
      sourceJsons.map((sourceJson) => ({ json: structuredClone(sourceJson) })),
    ]),
  );
  const context = vm.createContext({
    console,
    structuredClone,
    $json: inputItems[0].json,
    $input: {
      all: () => inputItems,
      first: () => inputItems[0],
      item: inputItems[0],
    },
    $: (sourceNodeName) => {
      if (!Object.hasOwn(sourceItemsByNode, sourceNodeName)) {
        throw new Error(`Unknown workflow source node: ${sourceNodeName}`);
      }
      const sourceItems = sourceItemsByNode[sourceNodeName];
      return {
        all: () => sourceItems,
        first: () => sourceItems[0],
        itemMatching: (index) => sourceItems[index] ?? sourceItems[0],
        item: sourceItems[0],
      };
    },
  });
  const result = await new vm.Script(
    `(async () => { ${node.parameters.jsCode}\n })()`,
  ).runInContext(context);
  const resultItems = Array.isArray(result) ? result : [result];
  return resultItems.map((item) => {
    const output = JSON.parse(JSON.stringify(item.json));
    return nodeName === 'Проверить и привязать evidence' && output.validated_unit
      ? output.validated_unit
      : output;
  });
}

async function runCodeNodeItems(workflow, nodeName, inputJsons, sourceJsons) {
  return runCodeNodeItemsWithSources(
    workflow,
    nodeName,
    inputJsons,
    Object.fromEntries(
      workflow.nodes.map(({ name }) => [name, sourceJsons]),
    ),
  );
}

async function runCodeNode(workflow, nodeName, inputJson, sourceJson) {
  const [result] = await runCodeNodeItems(
    workflow,
    nodeName,
    [inputJson],
    [sourceJson],
  );
  return result;
}

async function classifyRetry(workflow, invalidResult) {
  return runCodeNode(
    workflow,
    'Классифицировать bounded retry',
    invalidResult,
    invalidResult,
  );
}

async function prepareEvidenceRepair(workflow, invalidResult) {
  const classified = await classifyRetry(workflow, invalidResult);
  assert.equal(classified.retry_decision.route, 'evidence_repair');
  return runCodeNode(
    workflow,
    'Подготовить Evidence Repair',
    classified,
    classified,
  );
}

function buildSource(segments, analysisUnitId = 'fixture-unit') {
  return {
    tender: { tender_id: 'fixture' },
    document: { document_id: 'fixture-document' },
    analysis_batch: { units_total: 1 },
    analysis_unit_meta: { analysis_unit_id: analysisUnitId },
    ai_segments: segments,
    provenance: {
      index: Object.fromEntries(
        segments.map((segment) => [
          segment.semantic_block_id,
          {
            scope: segment.scope,
            source_block_ids: [],
            sources: [],
          },
        ]),
      ),
    },
    ai_request: {
      prompt_version: 'fixture',
      schema_version: 'ai_extractor_v1',
      field_catalog_version: 'tender_fields_v1',
    },
  };
}

function buildExtractorResponse(facts, analysisUnitId = 'fixture-unit') {
  return {
    id: 'fixture-response',
    model: 'fixture-model',
    choices: [
      {
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            schema_version: 'ai_extractor_v1',
            field_catalog_version: 'tender_fields_v1',
            analysis_unit_id: analysisUnitId,
            facts,
          }),
        },
      },
    ],
    usage: {},
  };
}

function buildRepairResponse(repairs, overrides = {}) {
  return {
    id: 'fixture-repair-response',
    model: 'fixture-model',
    choices: [
      {
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            schema_version: 'ai_evidence_repair_v2',
            field_catalog_version: 'tender_fields_v1',
            analysis_unit_id: 'fixture-unit',
            repairs,
            ...overrides,
          }),
        },
      },
    ],
    usage: {},
  };
}

function catalogRef(prepared, semanticBlockId, canonicalQuote = null) {
  const candidates = prepared.repair_request.evidence_catalog.filter(
    (candidate) => candidate.semantic_block_id === semanticBlockId &&
      (canonicalQuote === null || candidate.canonical_quote === canonicalQuote),
  );
  assert.equal(
    candidates.length,
    1,
    `Expected exactly one catalog candidate for ${semanticBlockId}`,
  );
  return candidates[0].evidence_ref;
}

function firstCatalogRef(prepared, semanticBlockId) {
  const candidate = prepared.repair_request.evidence_catalog.find(
    (entry) => entry.semantic_block_id === semanticBlockId,
  );
  assert.ok(candidate, `Catalog candidate not found for ${semanticBlockId}`);
  return candidate.evidence_ref;
}

function buildReferenceRepair(prepared, factIndex, semanticBlockIds, violationCodes = []) {
  return {
    fact_index: factIndex,
    violation_codes: violationCodes,
    selected_evidence_refs: semanticBlockIds.map(
      (semanticBlockId) => firstCatalogRef(prepared, semanticBlockId),
    ),
  };
}

function recalculatePreparedCatalogContract(prepared) {
  const catalog = prepared.repair_request.evidence_catalog;
  prepared.repair_request.evidence_catalog_contract.candidates_count = catalog.length;
  prepared.repair_request.evidence_catalog_contract.total_chars = catalog.reduce(
    (sum, candidate) => sum + candidate.canonical_quote.length +
      (candidate.context_before?.length ?? 0) +
      (candidate.context_after?.length ?? 0),
    0,
  );
  return prepared;
}

function workflowWithAttemptTwoMutation(workflow, search, replacement) {
  const mutated = structuredClone(workflow);
  const node = findNode(mutated, 'Проверить evidence — попытка 2');
  assert.ok(node.parameters.jsCode.includes(search), 'Attempt-2 mutation anchor missing.');
  node.parameters.jsCode = node.parameters.jsCode.replace(search, replacement);
  return mutated;
}

async function buildCatalogParityFixture(workflow, unitId = 'catalog-parity-unit') {
  const source = buildSource([
    {
      semantic_block_id: 'sb_parity_a', scope: 'primary', type: 'text', role: 'body',
      text: 'Первое самостоятельное предложение. Второе противоположное предложение.',
    },
    {
      semantic_block_id: 'sb_parity_b', scope: 'overlap', type: 'text', role: 'heading',
      text: 'Отдельный overlap fragment.',
    },
    {
      semantic_block_id: 'sb_parity_c', scope: 'primary', type: 'table', role: 'body',
      text: '[C1] Отдельный table fragment.',
    },
  ], unitId);
  const first = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    buildExtractorResponse([buildFact([{
      semantic_block_id: 'sb_parity_a', quote: 'Отсутствующая цитата',
    }])], unitId),
    source,
  );
  const prepared = await prepareEvidenceRepair(workflow, first);
  const response = buildRepairResponse([{
    fact_index: 0,
    violation_codes: [],
    selected_evidence_refs: ['er2:sb_parity_a:0001'],
  }], { analysis_unit_id: unitId });
  return { source, first, prepared, response };
}

function buildPartitionResponse(partitions, analysisUnitId = 'fixture-unit') {
  return {
    id: 'fixture-partition-response',
    model: 'fixture-model',
    choices: [
      {
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            schema_version: 'ai_fact_partition_v1',
            field_catalog_version: 'tender_fields_v1',
            analysis_unit_id: analysisUnitId,
            partitions,
          }),
        },
      },
    ],
    usage: {},
  };
}

function buildFact(evidence, overrides = {}) {
  return {
    field_key: 'application_documents',
    value_text: 'Требуется комплект документов',
    status: 'found',
    confidence: 0.9,
    evidence,
    review_reason_code: null,
    review_note: null,
    ...overrides,
  };
}

function buildResourceOverflowUnit({
  analysisUnitId = 'partition-unit',
  evidenceCount = 26,
  quoteLength = null,
} = {}) {
  const safeUnitId = analysisUnitId.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const segments = Array.from({ length: evidenceCount }, (_, index) => {
    const prefix = `Фрагмент ${String(index + 1).padStart(2, '0')} `;
    const text = quoteLength === null
      ? `${prefix}точный текст`
      : prefix + 'А'.repeat(Math.max(0, quoteLength - prefix.length));
    return {
      semantic_block_id: `sb_${safeUnitId}_${String(index + 1).padStart(4, '0')}`,
      scope: 'primary',
      type: 'text',
      role: 'body',
      text,
    };
  });
  const evidence = segments.map((segment) => ({
    semantic_block_id: segment.semantic_block_id,
    quote: segment.text,
  }));
  const valueText = 'Первая самостоятельная часть | Вторая самостоятельная часть';
  const source = buildSource(segments, analysisUnitId);
  const fact = buildFact(evidence, { value_text: valueText });
  return {
    analysisUnitId,
    source,
    fact,
    valueText,
    evidence,
    extractorResponse: buildExtractorResponse([fact], analysisUnitId),
  };
}

function buildLosslessReplacementFacts(fact, evidenceSizes) {
  assert.equal(
    evidenceSizes.reduce((sum, size) => sum + size, 0),
    fact.evidence.length,
  );
  let evidenceOffset = 0;
  return evidenceSizes.map((size, index) => {
    const valueStart = Math.floor(fact.value_text.length * index / evidenceSizes.length);
    const valueEnd = Math.floor(
      fact.value_text.length * (index + 1) / evidenceSizes.length,
    );
    const replacement = {
      value_text: fact.value_text.slice(valueStart, valueEnd),
      evidence: structuredClone(
        fact.evidence.slice(evidenceOffset, evidenceOffset + size),
      ),
    };
    evidenceOffset += size;
    return replacement;
  });
}

async function prepareFactPartition(workflow, unit) {
  const first = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    unit.extractorResponse,
    unit.source,
  );
  const classified = await classifyRetry(workflow, first);
  assert.equal(classified.retry_decision.route, 'fact_partition');
  const prepared = await runCodeNode(
    workflow,
    'Подготовить Lossless Fact Partition',
    classified,
    classified,
  );
  return { first, classified, prepared };
}

async function validateFactPartition(
  workflow,
  unit,
  prepared,
  replacementFacts,
) {
  return runCodeNode(
    workflow,
    'Проверить Lossless Fact Partition',
    buildPartitionResponse([
      {
        source_fact_index: 0,
        violation_codes: prepared.violations.map(({ code }) => code),
        replacement_facts: replacementFacts,
      },
    ], unit.analysisUnitId),
    prepared,
  );
}

function evidenceMultiset(evidence) {
  return evidence
    .map(({ semantic_block_id, quote }) => `${semantic_block_id}\u0000${quote}`)
    .sort();
}

function buildConvergenceUnit(unitId, valid) {
  const exactQuote = `Точная цитата для ${unitId}`;
  const source = buildSource([
    {
      semantic_block_id: `sb_${unitId.toLowerCase()}`,
      scope: 'primary',
      type: 'text',
      role: 'body',
      text: exactQuote,
    },
  ], unitId);
  const evidence = [{
    semantic_block_id: `sb_${unitId.toLowerCase()}`,
    quote: valid ? exactQuote : `Невалидная цитата для ${unitId}`,
  }];
  return {
    unitId,
    exactQuote,
    source,
    extractorResponse: buildExtractorResponse([buildFact(evidence)], unitId),
  };
}

function loadProductionCase(executionId) {
  const fixture = JSON.parse(fs.readFileSync(productionCasesPath, 'utf8'));
  const productionCase = fixture.cases.find(
    (candidate) => candidate.execution_id === executionId,
  );
  assert.ok(productionCase, `production fixture ${executionId} not found`);
  const segments = productionCase.ai_segments.map(
    ({ segment_text_is_excerpt: _marker, ...segment }) => segment,
  );
  return {
    ...productionCase,
    source: buildSource(segments, productionCase.analysis_unit_id),
    response: buildExtractorResponse(
      productionCase.facts,
      productionCase.analysis_unit_id,
    ),
  };
}

function loadCoordinateTableFixture() {
  return JSON.parse(fs.readFileSync(coordinateTableFixturePath, 'utf8'));
}

function loadOverlapOnlyFixture() {
  return JSON.parse(fs.readFileSync(overlapOnlyFixturePath, 'utf8'));
}

function loadValidatorDispatchFixture() {
  return JSON.parse(fs.readFileSync(validatorDispatchFixturePath, 'utf8'));
}

function loadExecution14075Fixture() {
  return JSON.parse(fs.readFileSync(execution14075FixturePath, 'utf8'));
}

function buildDispatchReadyUnit(
  analysisUnitId,
  {
    unitsTotal = 1,
    verifiedFactIndexes = [],
    deterministicallyRejectedFacts = [],
  } = {},
) {
  const verifiedFacts = verifiedFactIndexes.map((factIndex) => ({
    fact_index: factIndex,
    field_key: 'application_documents',
    value_text: `Execution-derived fact ${analysisUnitId}/${factIndex}`,
    status: 'found',
    confidence: 0.9,
    review_reason_code: null,
    review_note: null,
    evidence: [{
      semantic_block_id: `sb_${analysisUnitId.replace(/[^A-Za-z0-9_-]/g, '_')}_${factIndex}`,
      quote: `Exact fixture quote ${analysisUnitId}/${factIndex}`,
      scope: 'primary',
      type: 'text',
      role: 'body',
      source_block_ids: [`#/texts/${factIndex}`],
      page_from: 1,
      page_to: 1,
      sheet_name: null,
      sources: [{ source_block_id: `#/texts/${factIndex}` }],
    }],
  }));
  return {
    tender: { tender_id: 'manual-calibration-167-26-ZO' },
    document: { document_id: 'execution-14061-document' },
    analysis_batch: { units_total: unitsTotal },
    analysis_unit_meta: { analysis_unit_id: analysisUnitId },
    validation_attempt: 1,
    validation_passed: true,
    violations: [],
    resolved_violations: [],
    verified_facts: verifiedFacts,
    deterministically_rejected_facts: structuredClone(
      deterministicallyRejectedFacts,
    ),
    evidence_context: Object.fromEntries(
      verifiedFacts.flatMap((fact) => fact.evidence.map((evidence) => [
        evidence.semantic_block_id,
        {
          semantic_block_id: evidence.semantic_block_id,
          scope: evidence.scope,
          type: evidence.type,
          role: evidence.role,
          text: evidence.quote,
          provenance: { scope: evidence.scope },
        },
      ])),
    ),
    extractor: {
      field_catalog_version: 'tender_fields_v1',
      repair: { attempted: false, requests_count: 0 },
    },
    evidence_validation: {
      version: 'evidence_validator_v2',
      attempt: 1,
      passed: true,
      resource_metrics: {
        evidence_count: verifiedFacts.length,
        total_quote_chars: verifiedFacts.reduce(
          (sum, fact) => sum + fact.evidence[0].quote.length,
          0,
        ),
      },
    },
  };
}

function buildValidatorApiResponse(unit, overrides = {}) {
  const validations = unit.verified_facts.map((fact) => ({
    fact_index: fact.fact_index,
    field_key: fact.field_key,
    verdict: 'confirmed',
    confidence: 0.98,
    reason_code: null,
    reason_note: null,
  }));
  return {
    id: `validator-${unit.analysis_unit_meta.analysis_unit_id}`,
    model: 'fixture-validator',
    choices: [{
      finish_reason: 'stop',
      message: {
        content: JSON.stringify({
          schema_version: 'ai_validator_v1',
          analysis_unit_id: unit.analysis_unit_meta.analysis_unit_id,
          validations,
          ...overrides,
        }),
      },
    }],
    usage: {},
  };
}

function buildOverlapRejectedCandidate(
  analysisUnitId,
  factIndex = 0,
  overrides = {},
) {
  return {
    fact_index: factIndex,
    field_key: 'payment_terms',
    value_text: `Overlap-only value ${analysisUnitId}/${factIndex}`,
    status: 'found',
    confidence: 0.91,
    review_reason_code: null,
    review_note: null,
    evidence: [{
      semantic_block_id: `sb_overlap_${factIndex}`,
      quote: `Exact overlap quote ${analysisUnitId}/${factIndex}`,
      scope: 'overlap',
      type: 'text',
      role: 'body',
      source_block_ids: [`#/texts/overlap-${factIndex}`],
      page_from: 1,
      page_to: 1,
      sheet_name: null,
      sources: [{ source_block_id: `#/texts/overlap-${factIndex}` }],
    }],
    original_violations: [{
      code: 'overlap_only',
      fact_index: factIndex,
      evidence_index: null,
      details: { grounded_evidence_count: 1 },
    }],
    deterministic_rejection: {
      version: 'deterministic_overlap_rejection_v1',
      validation_attempt: 1,
      reason_code: 'overlap_only_context_only',
      grounding: 'exact',
      evidence_scope: 'overlap_only',
    },
    ...overrides,
  };
}

async function buildExecution14061PostOverlapUnits(workflow) {
  const summary = loadValidatorDispatchFixture();
  const overlapFixture = loadOverlapOnlyFixture();
  const overlapById = new Map(
    overlapFixture.cases.map((fixtureCase) => [
      fixtureCase.analysis_unit_id,
      fixtureCase,
    ]),
  );
  const units = [];

  for (const unitSummary of summary.units) {
    const overlapCase = overlapById.get(unitSummary.analysis_unit_id);
    if (overlapCase) {
      units.push(await runCodeNode(
        workflow,
        'Проверить и привязать evidence',
        overlapCase.response,
        overlapCase.source,
      ));
      continue;
    }
    units.push(buildDispatchReadyUnit(unitSummary.analysis_unit_id, {
      unitsTotal: summary.expected.units_total,
      verifiedFactIndexes: unitSummary.verified_fact_indexes,
    }));
  }
  return units;
}

async function convergeUnits(workflow, units) {
  const converged = [];
  const repairUnitIds = [];
  const failed = [];

  for (const unit of units) {
    const first = await runCodeNode(
      workflow,
      'Проверить и привязать evidence',
      unit.extractorResponse,
      unit.source,
    );
    if (first.validation_passed) {
      converged.push(first);
      continue;
    }

    repairUnitIds.push(unit.unitId);
    const prepared = await prepareEvidenceRepair(workflow, first);
    const selectedEvidenceRefs = [firstCatalogRef(
      prepared,
      unit.source.ai_segments[0].semantic_block_id,
    )];
    const second = await runCodeNode(
      workflow,
      'Проверить evidence — попытка 2',
      buildRepairResponse(
        [{ fact_index: 0, violation_codes: [], selected_evidence_refs: selectedEvidenceRefs }],
        { analysis_unit_id: unit.unitId },
      ),
      prepared,
    );
    if (second.validation_passed) converged.push(second);
    else failed.push(second);
  }

  return { converged, repairUnitIds, failed };
}

test('production execution manifest covers fixtures 14006 through 14017', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.deepEqual(
    manifest.execution_ids,
    Array.from({ length: 12 }, (_, index) => 14006 + index),
  );
});

test('execution-derived fixtures 14006 through 14017 reproduce attempt 1 outcomes', async () => {
  const workflow = loadWorkflow();
  const fixture = JSON.parse(fs.readFileSync(productionCasesPath, 'utf8'));
  assert.equal(fixture.schema_version, 'document_worker_evidence_regression_v1');
  assert.deepEqual(
    fixture.cases.map(({ execution_id }) => execution_id),
    Array.from({ length: 12 }, (_, index) => 14006 + index),
  );

  for (const productionCase of fixture.cases) {
    const segments = productionCase.ai_segments.map(
      ({ segment_text_is_excerpt: _marker, ...segment }) => segment,
    );
    const result = await runCodeNode(
      workflow,
      'Проверить и привязать evidence',
      buildExtractorResponse(productionCase.facts, productionCase.analysis_unit_id),
      buildSource(segments, productionCase.analysis_unit_id),
    );
    const actualCodes = [...new Set(
      result.violations.map(({ code }) => code),
    )].sort();
    const pureOverlapFixture = productionCase.execution_id === 14012;
    const expectedCodes = pureOverlapFixture
      ? []
      : [...productionCase.expected_attempt_1.violation_codes].sort();

    assert.equal(
      result.validation_passed,
      pureOverlapFixture
        ? true
        : productionCase.expected_attempt_1.validation_passed,
      `execution ${productionCase.execution_id}`,
    );
    assert.deepEqual(actualCodes, expectedCodes, `execution ${productionCase.execution_id}`);
    if (pureOverlapFixture) {
      assert.deepEqual(
        result.resolved_violations.map(({ code }) => code),
        ['overlap_only'],
      );
    }
  }
});

test('large-document baseline is retained for the required latency comparison', () => {
  const fixture = JSON.parse(fs.readFileSync(productionCasesPath, 'utf8'));
  const baseline = fixture.performance_baseline.find(
    ({ execution_id }) => execution_id === 14012,
  );

  assert.deepEqual(baseline, {
    execution_id: 14012,
    status: 'error',
    units: 66,
    total_execution_ms: 119717,
    prepare_request_ms: 601,
    extractor_node_ms: 40573,
    evidence_validator_ms: 3843,
  });
});

test('14010 and 14016 pass attempt 1 without repair under max evidence 25', async () => {
  const workflow = loadWorkflow();
  for (const executionId of [14010, 14016]) {
    const fixture = loadProductionCase(executionId);
    const result = await runCodeNode(
      workflow,
      'Проверить и привязать evidence',
      fixture.response,
      fixture.source,
    );
    assert.equal(result.validation_passed, true, `execution ${executionId}`);
    assert.equal(result.extractor.repair.requests_count, 0);
    assert.ok(result.verified_facts[0].evidence.length > 5);
  }
});

test('14008 wrong block ID passes attempt 2 only after exact ID repair', async () => {
  const workflow = loadWorkflow();
  const fixture = loadProductionCase(14008);
  const first = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    fixture.response,
    fixture.source,
  );
  const wrongId = first.violations.find(
    ({ code }) => code === 'wrong_semantic_block_id',
  );
  assert.ok(wrongId);
  const prepared = await prepareEvidenceRepair(workflow, first);
  const repairedBlockId = wrongId.details.exact_match_candidate_ids[0];
  const second = await runCodeNode(
    workflow,
    'Проверить evidence — попытка 2',
    buildRepairResponse(
      [buildReferenceRepair(prepared, 0, [repairedBlockId])],
      { analysis_unit_id: fixture.analysis_unit_id },
    ),
    prepared,
  );
  assert.equal(second.validation_passed, true);
});

test('14009 ellipsis quote is repaired only through allow-listed source refs', async () => {
  const workflow = loadWorkflow();
  const fixture = loadProductionCase(14009);
  const first = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    fixture.response,
    fixture.source,
  );
  assert.ok(first.violations.some(({ code }) => code === 'quote_not_found'));
  const prepared = await prepareEvidenceRepair(workflow, first);
  const repairedBlockIds = [...new Set(first.violations
    .filter(({ evidence_index }) => Number.isInteger(evidence_index))
    .map(({ evidence_index }) => fixture.facts[0].evidence[evidence_index].semantic_block_id))];
  const exact = await runCodeNode(
    workflow,
    'Проверить evidence — попытка 2',
    buildRepairResponse(
      [buildReferenceRepair(prepared, 0, repairedBlockIds)],
      { analysis_unit_id: fixture.analysis_unit_id },
    ),
    prepared,
  );
  assert.equal(
    exact.validation_passed,
    true,
    JSON.stringify(exact.violations),
  );
});

test('14012 pure overlap-only is rejected deterministically while 14014 OCR paraphrase remains ungrounded', async () => {
  const workflow = loadWorkflow();
  const overlap = loadProductionCase(14012);
  const overlapResult = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    overlap.response,
    overlap.source,
  );
  assert.equal(overlapResult.validation_passed, true);
  assert.equal(overlapResult.verified_facts.length, 0);
  assert.equal(overlapResult.deterministically_rejected_facts.length, 1);
  assert.deepEqual(overlapResult.violations, []);
  assert.deepEqual(
    overlapResult.resolved_violations.map(({ code }) => code),
    ['overlap_only'],
  );

  const ocr = loadProductionCase(14014);
  const first = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    ocr.response,
    ocr.source,
  );
  assert.equal(first.validation_passed, false);
  const quoteViolation = first.violations.find(
    ({ code }) => code === 'quote_not_found',
  );
  assert.deepEqual(quoteViolation.details.exact_match_candidate_ids, []);
});

test('Extractor prompt targets remain below the deterministic hard evidence limits', () => {
  const workflow = loadWorkflow();
  const prepareCode = findNode(workflow, 'Подготовить запрос для AI').parameters.jsCode;
  const prepareRepairCode = findNode(
    workflow,
    'Подготовить Evidence Repair',
  ).parameters.jsCode;
  const validatorCode = findNode(
    workflow,
    'Проверить и привязать evidence',
  ).parameters.jsCode;

  for (const code of [prepareCode, validatorCode]) {
    assert.match(code, /maxEvidencePerFact:\s*25/);
    assert.match(code, /maxQuoteLength:\s*1500/);
    assert.match(code, /maxTotalQuoteCharsPerFact:\s*5000/);
  }

  assert.match(prepareCode, /maxItems:\s*CONFIG\.maxEvidencePerFact/);
  assert.match(prepareCode, /uniqueItems:\s*true/);
  assert.match(prepareCode, /не более 20 evidence/i);
  assert.match(prepareCode, /не должна превышать 1200 символов/i);
  assert.match(prepareCode, /не должна превышать 4500 символов/i);
  assert.match(prepareRepairCode, /maxCandidates:\s*256/);
  assert.match(prepareRepairCode, /maxTotalChars:\s*250000/);
  assert.match(prepareRepairCode, /maxQuoteLength:\s*1500/);
  assert.match(prepareRepairCode, /maxItems:\s*25/);
  assert.match(prepareRepairCode, /selected_evidence_refs/);
  assert.doesNotMatch(prepareRepairCode, /required:\s*\['semantic_block_id', 'quote'\]/);
});

test('execution 14061 fixtures reproduce pure overlap_only while retaining every other verified fact', async () => {
  const workflow = loadWorkflow();
  const fixture = loadOverlapOnlyFixture();

  assert.equal(fixture.source_execution_id, 14061);
  assert.equal(fixture.document_file_name, 'Блок_6_Проект_договора.docx');
  assert.equal(fixture.units_total, 66);

  for (const fixtureCase of fixture.cases) {
    const result = await runCodeNode(
      workflow,
      'Проверить и привязать evidence',
      fixtureCase.response,
      fixtureCase.source,
    );
    const facts = JSON.parse(
      fixtureCase.response.choices[0].message.content,
    ).facts;
    const overlapFact = facts[fixtureCase.problem_fact_index];
    const overlapEvidence = overlapFact.evidence[0];
    const segment = fixtureCase.source.ai_segments.find(
      ({ semantic_block_id }) => (
        semantic_block_id === overlapEvidence.semantic_block_id
      ),
    );

    assert.equal(result.validation_passed, true);
    assert.deepEqual(result.violations, []);
    assert.deepEqual(
      result.resolved_violations.map(({ code, fact_index }) => ({ code, fact_index })),
      [{ code: 'overlap_only', fact_index: fixtureCase.problem_fact_index }],
    );
    assert.deepEqual(
      result.verified_facts.map(({ fact_index }) => fact_index),
      fixtureCase.expected.verified_fact_indexes,
    );
    assert.equal(segment.scope, 'overlap');
    assert.ok(segment.text.includes(overlapEvidence.quote));
    assert.equal(
      fixtureCase.source.provenance.index[overlapEvidence.semantic_block_id].scope,
      'overlap',
    );
  }
});

test('RED: a pure exact-grounded overlap_only fact becomes an audited deterministic rejection without repair', async () => {
  const workflow = loadWorkflow();
  const fixtureCase = loadOverlapOnlyFixture().cases.find(
    ({ analysis_unit_id }) => analysis_unit_id === 'doc_7_au_0002',
  );
  const original = JSON.parse(fixtureCase.response.choices[0].message.content);
  const overlapFact = structuredClone(
    original.facts[fixtureCase.problem_fact_index],
  );
  const response = buildExtractorResponse(
    [overlapFact],
    fixtureCase.analysis_unit_id,
  );
  const result = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    response,
    fixtureCase.source,
  );

  assert.equal(result.validation_passed, true);
  assert.deepEqual(result.violations, []);
  assert.equal(result.verified_facts.length, 0);
  assert.equal(result.deterministically_rejected_facts.length, 1);

  const [rejected] = result.deterministically_rejected_facts;
  assert.equal(rejected.fact_index, 0);
  assert.equal(rejected.field_key, overlapFact.field_key);
  assert.equal(rejected.value_text, overlapFact.value_text);
  assert.deepEqual(
    rejected.evidence.map(({ semantic_block_id, quote }) => ({
      semantic_block_id,
      quote,
    })),
    overlapFact.evidence,
  );
  assert.equal(rejected.validator_verdict, 'rejected');
  assert.equal(rejected.validator_confidence, 1.0);
  assert.equal(rejected.validator_reason_code, 'overlap_only_context_only');
  assert.equal(rejected.accepted_for_normalization, false);
  assert.equal(rejected.validator_meta.origin, 'deterministic_evidence_layer');
  assert.equal(rejected.validator_meta.ai_validator_called_for_fact, false);
  assert.equal(rejected.validator_meta.grounding, 'exact');
  assert.equal(rejected.validator_meta.evidence_scope, 'overlap_only');
  assert.equal(rejected.validator_meta.analysis_unit_id, fixtureCase.analysis_unit_id);
  assert.equal(rejected.validator_meta.fact_index, 0);
  assert.equal(rejected.validator_meta.validation_attempt, 1);
  assert.deepEqual(
    result.resolved_violations.map(({ code, fact_index }) => ({ code, fact_index })),
    [{ code: 'overlap_only', fact_index: 0 }],
  );
  assert.equal(result.extractor.repair.requests_count, 0);
});

test('RED: an empty verified_facts unit has a local path to document facts without an HTTP AI Validator call', () => {
  const workflow = loadWorkflow();
  assert.equal(
    hasPathAvoidingNodeTypes(
      workflow,
      'Собрать units после evidence validation',
      'Собрать факты документа1',
      new Set(['n8n-nodes-base.httpRequest']),
    ),
    true,
    'verified_facts=[] still has only the unconditional HTTP AI Validator path',
  );
});

test('attempt 2 converts newly exact-grounded overlap-only evidence into deterministic rejection', async () => {
  const workflow = loadWorkflow();
  const unitId = 'attempt-2-overlap-only';
  const exactQuote = 'Точный контекст только из overlap блока';
  const source = buildSource([{
    semantic_block_id: 'sb_overlap_attempt_2',
    scope: 'overlap',
    type: 'text',
    role: 'body',
    text: exactQuote,
  }], unitId);
  const first = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    buildExtractorResponse([
      buildFact([{
        semantic_block_id: 'sb_overlap_attempt_2',
        quote: 'Неточная исходная цитата',
      }]),
    ], unitId),
    source,
  );
  const prepared = await prepareEvidenceRepair(workflow, first);
  const second = await runCodeNode(
    workflow,
    'Проверить evidence — попытка 2',
    buildRepairResponse([{
      fact_index: 0,
      violation_codes: [],
      selected_evidence_refs: [firstCatalogRef(prepared, 'sb_overlap_attempt_2')],
    }], { analysis_unit_id: unitId }),
    prepared,
  );

  assert.equal(second.validation_passed, true);
  assert.deepEqual(second.violations, []);
  assert.equal(second.verified_facts.length, 0);
  assert.equal(second.deterministically_rejected_facts.length, 1);
  assert.equal(
    second.deterministically_rejected_facts[0].deterministic_rejection
      .validation_attempt,
    2,
  );
  assert.match(prepared.repair_request.system_prompt, /overlap-only.*deterministic/i);
});

test('multiple exact-grounded overlap-only facts are all retained as deterministic rejections', async () => {
  const workflow = loadWorkflow();
  const unitId = 'multiple-overlap-only';
  const segments = [0, 1].map((index) => ({
    semantic_block_id: `sb_multiple_overlap_${index}`,
    scope: 'overlap',
    type: 'text',
    role: 'body',
    text: `Exact overlap source ${index}`,
  }));
  const source = buildSource(segments, unitId);
  const facts = segments.map((segment, factIndex) => buildFact([{
    semantic_block_id: segment.semantic_block_id,
    quote: segment.text,
  }], {
    field_key: factIndex === 0 ? 'payment_terms' : 'delivery_term',
    value_text: `Overlap fact ${factIndex}`,
  }));
  const result = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    buildExtractorResponse(facts, unitId),
    source,
  );

  assert.equal(result.validation_passed, true);
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.verified_facts, []);
  assert.deepEqual(
    result.deterministically_rejected_facts.map(({ fact_index }) => fact_index),
    [0, 1],
  );
  assert.deepEqual(
    result.deterministically_rejected_facts.map(({ value_text }) => value_text),
    facts.map(({ value_text }) => value_text),
  );
});

test('overlap evidence plus another violation in the same fact is not auto-rejected', async () => {
  const workflow = loadWorkflow();
  const unitId = 'overlap-plus-semantic-violation';
  const overlapSegment = {
    semantic_block_id: 'sb_overlap_exact',
    scope: 'overlap',
    type: 'text',
    role: 'body',
    text: 'Exact overlap context',
  };
  const primarySegment = {
    semantic_block_id: 'sb_primary_wrong_quote',
    scope: 'primary',
    type: 'text',
    role: 'body',
    text: 'Actual primary text',
  };
  const source = buildSource([overlapSegment, primarySegment], unitId);

  for (const invalidEvidence of [
    {
      semantic_block_id: primarySegment.semantic_block_id,
      quote: 'Quote absent from primary source',
      expectedCode: 'quote_not_found',
    },
    {
      semantic_block_id: 'sb_unknown',
      quote: 'Unknown block quote',
      expectedCode: 'unknown_semantic_block_id',
    },
  ]) {
    const result = await runCodeNode(
      workflow,
      'Проверить и привязать evidence',
      buildExtractorResponse([buildFact([
        {
          semantic_block_id: overlapSegment.semantic_block_id,
          quote: overlapSegment.text,
        },
        {
          semantic_block_id: invalidEvidence.semantic_block_id,
          quote: invalidEvidence.quote,
        },
      ])], unitId),
      source,
    );

    assert.equal(result.validation_passed, false);
    assert.equal(result.deterministically_rejected_facts.length, 0);
    assert.ok(result.violations.some(({ code }) => code === invalidEvidence.expectedCode));
    assert.ok(result.violations.some(({ code }) => code === 'missing_primary_evidence'));
  }
});

test('a pure overlap fact and a repairable fact in one unit converge without loss', async () => {
  const workflow = loadWorkflow();
  const unitId = 'overlap-and-repairable';
  const overlapSegment = {
    semantic_block_id: 'sb_overlap_and_repairable_overlap',
    scope: 'overlap',
    type: 'text',
    role: 'body',
    text: 'Exact overlap-only text',
  };
  const primarySegment = {
    semantic_block_id: 'sb_overlap_and_repairable_primary',
    scope: 'primary',
    type: 'text',
    role: 'body',
    text: 'Exact repaired primary text',
  };
  const source = buildSource([overlapSegment, primarySegment], unitId);
  const facts = [
    buildFact([{
      semantic_block_id: overlapSegment.semantic_block_id,
      quote: overlapSegment.text,
    }], { field_key: 'payment_terms', value_text: 'Overlap candidate' }),
    buildFact([{
      semantic_block_id: primarySegment.semantic_block_id,
      quote: 'Initial invalid primary quote',
    }], { field_key: 'delivery_term', value_text: 'Primary candidate' }),
  ];
  const first = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    buildExtractorResponse(facts, unitId),
    source,
  );

  assert.equal(first.validation_passed, false);
  assert.deepEqual(
    first.deterministically_rejected_facts.map(({ fact_index }) => fact_index),
    [0],
  );
  const prepared = await prepareEvidenceRepair(workflow, first);
  const second = await runCodeNode(
    workflow,
    'Проверить evidence — попытка 2',
    buildRepairResponse([{
      fact_index: 1,
      violation_codes: prepared.violations
        .filter(({ fact_index }) => fact_index === 1)
        .map(({ code }) => code),
      selected_evidence_refs: [firstCatalogRef(prepared, primarySegment.semantic_block_id)],
    }], { analysis_unit_id: unitId }),
    prepared,
  );

  assert.equal(second.validation_passed, true);
  assert.deepEqual(second.violations, []);
  assert.deepEqual(second.verified_facts.map(({ fact_index }) => fact_index), [1]);
  assert.deepEqual(
    second.deterministically_rejected_facts.map(({ fact_index }) => fact_index),
    [0],
  );
  assert.equal(second.verified_facts[0].value_text, facts[1].value_text);
  assert.equal(
    second.deterministically_rejected_facts[0].value_text,
    facts[0].value_text,
  );
});

test('overlap_only combined with a resource violation is never auto-rejected', async () => {
  const workflow = loadWorkflow();
  const unitId = 'overlap-plus-resource';
  const segments = Array.from({ length: 26 }, (_, index) => ({
    semantic_block_id: `sb_overlap_resource_${index}`,
    scope: 'overlap',
    type: 'text',
    role: 'body',
    text: `Точная overlap цитата ${index}`,
  }));
  const evidence = segments.map((segment) => ({
    semantic_block_id: segment.semantic_block_id,
    quote: segment.text,
  }));
  const result = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    buildExtractorResponse([buildFact(evidence)], unitId),
    buildSource(segments, unitId),
  );

  assert.equal(result.validation_passed, false);
  assert.equal(result.deterministically_rejected_facts.length, 0);
  assert.deepEqual(
    new Set(result.violations.map(({ code }) => code)),
    new Set(['evidence_limit_exceeded', 'overlap_only']),
  );
  const classified = await classifyRetry(workflow, result);
  assert.equal(classified.retry_decision.route, 'hard_error');
});

test('validator dispatch always emits one exhaustive document envelope', async () => {
  const workflow = loadWorkflow();
  const units = [
    buildDispatchReadyUnit('dispatch-ai', { verifiedFactIndexes: [0] }),
    buildDispatchReadyUnit('dispatch-zero'),
    buildDispatchReadyUnit('dispatch-rejected', {
      deterministicallyRejectedFacts: [
        buildOverlapRejectedCandidate('dispatch-rejected'),
      ],
    }),
    buildDispatchReadyUnit('dispatch-mixed', {
      verifiedFactIndexes: [0],
      deterministicallyRejectedFacts: [
        buildOverlapRejectedCandidate('dispatch-mixed', 1),
      ],
    }),
  ].map((unit) => ({
    ...unit,
    analysis_batch: { units_total: 4 },
  }));
  const [dispatch] = await runCodeNodeItems(
    workflow,
    'Подготовить dispatch AI Validator',
    units,
    units,
  );

  assert.equal(dispatch.dispatch_version, 'ai_validator_dispatch_v1');
  assert.equal(dispatch.expected_units_total, 4);
  assert.deepEqual(dispatch.expected_analysis_unit_ids, [
    'dispatch-ai',
    'dispatch-zero',
    'dispatch-rejected',
    'dispatch-mixed',
  ]);
  assert.deepEqual(
    dispatch.units_for_ai.map((unit) => unit.analysis_unit_meta.analysis_unit_id),
    ['dispatch-ai', 'dispatch-mixed'],
  );
  assert.deepEqual(
    dispatch.units_without_ai.map((unit) => unit.analysis_unit_meta.analysis_unit_id),
    ['dispatch-zero', 'dispatch-rejected'],
  );
  assert.equal(dispatch.counts.units_for_ai, 2);
  assert.equal(dispatch.counts.units_without_ai, 2);
  assert.equal(dispatch.counts.http_ai_validator_items, 2);
});

test('validator dispatch hard-fails unresolved, duplicate, or unclassified units', async () => {
  const workflow = loadWorkflow();
  const valid = buildDispatchReadyUnit('dispatch-valid');
  const unresolved = {
    ...buildDispatchReadyUnit('dispatch-unresolved'),
    validation_passed: false,
    violations: [{ code: 'quote_not_found', fact_index: 0 }],
    evidence_validation: { passed: false },
  };
  await assert.rejects(
    runCodeNodeItems(
      workflow,
      'Подготовить dispatch AI Validator',
      [valid, unresolved].map((unit) => ({
        ...unit,
        analysis_batch: { units_total: 2 },
      })),
      [],
    ),
    /did not pass|unresolved/i,
  );
  await assert.rejects(
    runCodeNodeItems(
      workflow,
      'Подготовить dispatch AI Validator',
      [valid, structuredClone(valid)].map((unit) => ({
        ...unit,
        analysis_batch: { units_total: 2 },
      })),
      [],
    ),
    /duplicate analysis_unit_id/i,
  );
});

test('units_without_ai locally preserves zero-fact and deterministic-rejection-only units', async () => {
  const workflow = loadWorkflow();
  const units = [
    buildDispatchReadyUnit('zero-fact-unit'),
    buildDispatchReadyUnit('rejected-only-unit', {
      deterministicallyRejectedFacts: [
        buildOverlapRejectedCandidate('rejected-only-unit', 4),
      ],
    }),
  ].map((unit) => ({
    ...unit,
    analysis_batch: { units_total: 2 },
  }));
  const [dispatch] = await runCodeNodeItems(
    workflow,
    'Подготовить dispatch AI Validator',
    units,
    [],
  );
  const results = await runCodeNodeItems(
    workflow,
    'Сформировать units without AI Validator',
    [dispatch],
    [dispatch],
  );

  assert.deepEqual(
    results.map((unit) => unit.analysis_unit_meta.analysis_unit_id),
    ['zero-fact-unit', 'rejected-only-unit'],
  );
  assert.deepEqual(results[0].validated_facts, []);
  assert.equal(results[0].ai_validator, null);
  assert.equal(results[0].ai_validator_response_check.skipped, true);
  assert.equal(
    results[0].ai_validator_response_check.skip_reason,
    'no_verified_facts',
  );
  assert.equal(results[1].validated_facts.length, 1);
  assert.equal(
    results[1].ai_validator_response_check.skip_reason,
    'deterministic_rejections_only',
  );
  assert.equal(results[1].validated_facts[0].ai_validation.verdict, 'rejected');
  assert.equal(
    results[1].validated_facts[0].validator_meta.origin,
    'deterministic_evidence_layer',
  );
});

test('a fully zero-fact document produces complete units and no synthetic facts or AI items', async () => {
  const workflow = loadWorkflow();
  const units = ['zero-a', 'zero-b', 'zero-c'].map((analysisUnitId) => ({
    ...buildDispatchReadyUnit(analysisUnitId),
    analysis_batch: { units_total: 3 },
  }));
  const [dispatch] = await runCodeNodeItems(
    workflow,
    'Подготовить dispatch AI Validator',
    units,
    [],
  );
  assert.equal(dispatch.units_for_ai.length, 0);
  assert.equal(dispatch.units_without_ai.length, 3);
  assert.equal(dispatch.counts.http_ai_validator_items, 0);
  const results = await runCodeNodeItems(
    workflow,
    'Сформировать units without AI Validator',
    [dispatch],
    [],
  );
  assert.equal(results.length, 3);
  assert.ok(results.every((unit) => unit.validated_facts.length === 0));
  assert.ok(results.every((unit) => unit.ai_validator === null));
});

test('mixed unit sends only verified facts to AI and appends fact-local deterministic rejection', async () => {
  const workflow = loadWorkflow();
  const mixed = buildDispatchReadyUnit('mixed-validator-unit', {
    verifiedFactIndexes: [0, 2],
    deterministicallyRejectedFacts: [
      buildOverlapRejectedCandidate('mixed-validator-unit', 1),
    ],
  });
  const [dispatch] = await runCodeNodeItems(
    workflow,
    'Подготовить dispatch AI Validator',
    [mixed],
    [],
  );
  const [expanded] = await runCodeNodeItems(
    workflow,
    'Развернуть units для AI Validator',
    [dispatch],
    [],
  );
  const response = buildValidatorApiResponse(expanded);
  const [result] = await runCodeNodeItemsWithSources(
    workflow,
    'Проверить ответ AI Validator',
    [response],
    { 'Развернуть units для AI Validator': [expanded] },
  );

  assert.equal(result.ai_validator_response_check.expected_facts_count, 2);
  assert.equal(result.ai_validator_response_check.received_validations_count, 2);
  assert.deepEqual(
    result.validated_facts.map(({ fact_index }) => fact_index),
    [0, 1, 2],
  );
  const rejected = result.validated_facts.find(({ fact_index }) => fact_index === 1);
  assert.equal(rejected.ai_validation.verdict, 'rejected');
  assert.equal(rejected.ai_validation.confidence, 1.0);
  assert.equal(rejected.accepted_for_normalization, false);
  assert.equal(rejected.validator_meta.origin, 'deterministic_evidence_layer');
  assert.equal(rejected.validator_meta.ai_validator_called_for_fact, false);
  assert.equal(rejected.validator_meta.analysis_unit_id, 'mixed-validator-unit');
  assert.equal(rejected.validator_meta.fact_index, 1);
  assert.notDeepEqual(rejected.validator_meta, result.ai_validator);
});

test('TRUE reassembly restores exact unit set and hard-fails missing, duplicate, unknown, or crossed IDs', async () => {
  const workflow = loadWorkflow();
  const units = [
    buildDispatchReadyUnit('ai-a', { verifiedFactIndexes: [0] }),
    buildDispatchReadyUnit('without-ai'),
    buildDispatchReadyUnit('ai-b', { verifiedFactIndexes: [0] }),
  ].map((unit) => ({ ...unit, analysis_batch: { units_total: 3 } }));
  const [dispatch] = await runCodeNodeItems(
    workflow,
    'Подготовить dispatch AI Validator',
    units,
    [],
  );
  const expanded = await runCodeNodeItems(
    workflow,
    'Развернуть units для AI Validator',
    [dispatch],
    [],
  );
  const responses = expanded.map((unit) => buildValidatorApiResponse(unit));

  await assert.rejects(
    runCodeNodeItemsWithSources(
      workflow,
      'Проверить ответ AI Validator',
      [responses[1], responses[0]],
      { 'Развернуть units для AI Validator': expanded },
    ),
    /analysis_unit_id не совпадает/i,
    'crossed provider responses must not bind to another analysis unit source',
  );

  const checked = await runCodeNodeItemsWithSources(
    workflow,
    'Проверить ответ AI Validator',
    responses,
    { 'Развернуть units для AI Validator': expanded },
  );
  const converged = await runCodeNodeItemsWithSources(
    workflow,
    'Свести AI и units without AI',
    checked,
    { 'Подготовить dispatch AI Validator': [dispatch] },
  );
  assert.deepEqual(
    converged.map((unit) => unit.analysis_unit_meta.analysis_unit_id),
    dispatch.expected_analysis_unit_ids,
  );

  await assert.rejects(
    runCodeNodeItemsWithSources(
      workflow,
      'Свести AI и units without AI',
      checked.slice(0, 1),
      { 'Подготовить dispatch AI Validator': [dispatch] },
    ),
    /missing/i,
  );
  await assert.rejects(
    runCodeNodeItemsWithSources(
      workflow,
      'Свести AI и units without AI',
      [checked[0], structuredClone(checked[0])],
      { 'Подготовить dispatch AI Validator': [dispatch] },
    ),
    /duplicate/i,
  );
  const unknown = structuredClone(checked);
  unknown[0].analysis_unit_meta.analysis_unit_id = 'unknown-unit';
  await assert.rejects(
    runCodeNodeItemsWithSources(
      workflow,
      'Свести AI и units without AI',
      unknown,
      { 'Подготовить dispatch AI Validator': [dispatch] },
    ),
    /unknown/i,
  );
});

test('execution 14061 converges 16 AI items plus 50 units_without_ai into all 66 units', async () => {
  const workflow = loadWorkflow();
  const fixture = loadValidatorDispatchFixture();
  const units = await buildExecution14061PostOverlapUnits(workflow);
  const [dispatch] = await runCodeNodeItems(
    workflow,
    'Подготовить dispatch AI Validator',
    units,
    [],
  );
  assert.equal(dispatch.expected_units_total, fixture.expected.units_total);
  assert.equal(dispatch.units_for_ai.length, fixture.expected.target_units_for_ai);
  assert.equal(
    dispatch.units_without_ai.length,
    fixture.expected.target_units_without_ai,
  );
  const expanded = await runCodeNodeItems(
    workflow,
    'Развернуть units для AI Validator',
    [dispatch],
    [],
  );
  assert.equal(expanded.length, fixture.expected.target_http_ai_validator_items);
  const checked = await runCodeNodeItemsWithSources(
    workflow,
    'Проверить ответ AI Validator',
    expanded.map((unit) => buildValidatorApiResponse(unit)),
    { 'Развернуть units для AI Validator': expanded },
  );
  const converged = await runCodeNodeItemsWithSources(
    workflow,
    'Свести AI и units without AI',
    checked,
    { 'Подготовить dispatch AI Validator': [dispatch] },
  );
  assert.equal(converged.length, fixture.expected.target_unit_results);
  assert.deepEqual(
    converged.map((unit) => unit.analysis_unit_meta.analysis_unit_id),
    fixture.units.map((unit) => unit.analysis_unit_id),
  );
  for (const overlapCase of loadOverlapOnlyFixture().cases) {
    const result = converged.find(
      (unit) => unit.analysis_unit_meta.analysis_unit_id
        === overlapCase.analysis_unit_id,
    );
    const originalFacts = JSON.parse(
      overlapCase.response.choices[0].message.content,
    ).facts;
    assert.equal(result.validated_facts.length, originalFacts.length);
    assert.deepEqual(
      result.validated_facts.map(({ fact_index }) => fact_index),
      originalFacts.map((_, factIndex) => factIndex),
    );
  }
});

test('document facts preserve deterministic audit metadata and zero-fact units without candidates', async () => {
  const workflow = loadWorkflow();
  const units = [
    buildDispatchReadyUnit('collector-zero'),
    buildDispatchReadyUnit('collector-rejected', {
      deterministicallyRejectedFacts: [
        buildOverlapRejectedCandidate('collector-rejected', 3),
      ],
    }),
  ].map((unit) => ({ ...unit, analysis_batch: { units_total: 2 } }));
  const [dispatch] = await runCodeNodeItems(
    workflow,
    'Подготовить dispatch AI Validator',
    units,
    [],
  );
  const localResults = await runCodeNodeItems(
    workflow,
    'Сформировать units without AI Validator',
    [dispatch],
    [],
  );
  const savedUnits = units.map((unit, index) => ({
    analysis_run_id: 'run-14061',
    tender: unit.tender,
    document: unit.document,
    analysis_batch: unit.analysis_batch,
    analysis_unit_id: unit.analysis_unit_meta.analysis_unit_id,
    analysis_unit: {
      analysis_unit_id: unit.analysis_unit_meta.analysis_unit_id,
    },
    unit_db_id: `unit-db-${index}`,
  }));
  const [documentResult] = await runCodeNodeItemsWithSources(
    workflow,
    'Собрать факты документа1',
    localResults,
    { 'Сохранить analysis unit': savedUnits },
  );

  assert.equal(documentResult.analysis_summary.units_received, 2);
  assert.equal(documentResult.analysis_summary.facts_count, 1);
  assert.equal(documentResult.analysis_summary.rejected_count, 1);
  assert.equal(documentResult.facts.length, 1);
  assert.equal(documentResult.facts[0].validator_verdict, undefined);
  assert.equal(documentResult.facts[0].ai_validation.verdict, 'rejected');
  assert.equal(
    documentResult.facts[0].validator_meta.origin,
    'deterministic_evidence_layer',
  );
  assert.equal(
    documentResult.facts[0].validator_meta.ai_validator_called_for_fact,
    false,
  );
  const sourceRejected = units[1].deterministically_rejected_facts[0];
  const storedRejected = documentResult.facts[0];
  assert.equal(storedRejected.fact_index, sourceRejected.fact_index);
  assert.equal(storedRejected.field_key, sourceRejected.field_key);
  assert.equal(storedRejected.value_text, sourceRejected.value_text);
  assert.equal(storedRejected.extractor.status, sourceRejected.status);
  assert.equal(storedRejected.extractor.confidence, sourceRejected.confidence);
  assert.equal(
    storedRejected.extractor.review_reason_code,
    sourceRejected.review_reason_code,
  );
  assert.equal(storedRejected.extractor.review_note, sourceRejected.review_note);
  assert.deepEqual(storedRejected.evidence, sourceRejected.evidence);
  assert.ok(!documentResult.facts.some(
    ({ analysis_unit_id }) => analysis_unit_id === 'collector-zero',
  ));
});

test('Aggregator candidate SQL still excludes deterministic rejected facts', () => {
  const aggregator = JSON.parse(fs.readFileSync(aggregatorWorkflowPath, 'utf8'));
  const candidateQuery = aggregator.nodes
    .filter((node) => node.type === 'n8n-nodes-base.postgres')
    .map((node) => node.parameters?.query ?? '')
    .find((query) => query.includes('candidate_facts_json'));

  assert.ok(candidateQuery, 'Aggregator candidate query was not found');
  assert.match(
    candidateQuery,
    /f\.validator_verdict\s+IN\s*\(\s*'confirmed'\s*,\s*'requires_review'\s*\)/i,
  );
  assert.doesNotMatch(
    candidateQuery.match(/candidate_facts_json[\s\S]*?fact_stats/i)?.[0] ?? '',
    /f\.validator_verdict\s*=\s*'rejected'/i,
  );
});

test('Document persistence counts and stores every validated fact including rejected audit facts', () => {
  const workflow = loadWorkflow();
  const query = findNode(workflow, 'Сохранить факты документа').parameters.query;

  assert.match(query, /FROM\s+jsonb_array_elements\(\$3::jsonb\)\s+AS\s+f/i);
  assert.match(query, /f->'ai_validation'->>'verdict'\s+AS\s+validator_verdict/i);
  assert.match(query, /f->'validator_meta'/i);
  assert.doesNotMatch(
    query.match(/input_facts\s+AS\s*\([\s\S]*?\),\s*saved_facts/i)?.[0] ?? '',
    /WHERE\s+.*validator_verdict/i,
  );
  assert.match(query, /COUNT\(\*\)::integer\s+AS\s+saved_facts_count\s+FROM\s+input_facts/i);
  assert.match(query, /SET\s+facts_count\s*=\s*\(\s*SELECT\s+saved_facts_count/i);
  assert.match(query, /s\.saved_facts_count/);
  assert.match(query, /d\.facts_count\s+AS\s+database_facts_count/);
});

test('dispatch topology has no Merge or new Loop and both document branches feed the collector', () => {
  const workflow = loadWorkflow();
  for (const nodeName of [
    'Подготовить dispatch AI Validator',
    'Есть units для AI Validator?',
    'Развернуть units для AI Validator',
    'Свести AI и units without AI',
    'Сформировать units without AI Validator',
  ]) {
    findNode(workflow, nodeName);
  }
  assert.deepEqual(
    connectedTargets(workflow, 'Собрать units после evidence validation'),
    ['Подготовить dispatch AI Validator'],
  );
  assert.deepEqual(
    connectedTargets(workflow, 'Подготовить dispatch AI Validator'),
    ['Есть units для AI Validator?'],
  );
  assert.deepEqual(
    connectedTargets(workflow, 'Есть units для AI Validator?', 0),
    ['Развернуть units для AI Validator'],
  );
  assert.deepEqual(
    connectedTargets(workflow, 'Есть units для AI Validator?', 1),
    ['Сформировать units without AI Validator'],
  );
  assert.deepEqual(
    connectedTargets(workflow, 'Свести AI и units without AI'),
    ['Собрать факты документа1'],
  );
  assert.deepEqual(
    connectedTargets(workflow, 'Сформировать units without AI Validator'),
    ['Собрать факты документа1'],
  );
  assert.deepEqual(
    workflow.nodes
      .filter(({ type }) => type === 'n8n-nodes-base.merge')
      .map(({ name }) => name)
      .sort(),
    [
      'Вернуть DOCX binary для Docling',
      'Привязать parsed XML к части',
      'Собрать DOCX parts для parser',
    ].sort(),
  );
  assert.deepEqual(
    workflow.nodes
      .filter(({ type }) => type === 'n8n-nodes-base.splitInBatches')
      .map(({ name }) => name),
    ['Обработать evidence units по одной'],
  );
});

test('workflow contains one bounded evidence-only repair path and no withdrawal action', () => {
  const workflow = loadWorkflow();
  const serialized = JSON.stringify(workflow);

  for (const nodeName of [
    'Обработать evidence units по одной',
    'Evidence validation passed?',
    'Классифицировать bounded retry',
    'Выбрать bounded retry route',
    'Подготовить Evidence Repair',
    'AI Evidence Repair v1',
    'Проверить evidence — попытка 2',
    'Evidence repair passed?',
    'Подготовить Lossless Fact Partition',
    'AI Lossless Fact Partition v1',
    'Проверить Lossless Fact Partition',
    'Fact partition passed?',
    'Завершить unit: retry route unavailable',
    'Завершить unit: evidence validation failed',
    'Собрать units после evidence validation',
  ]) {
    findNode(workflow, nodeName);
  }

  assert.doesNotMatch(serialized, /withdraw_unverifiable/);
  assert.doesNotMatch(serialized, /slice\s*\(\s*0\s*,\s*25\s*\)/);
  assert.doesNotMatch(serialized, /fuzzy/i);
  assert.doesNotMatch(serialized, /auto.?rebind/i);
});

test('workflow JSON has unique nodes and all connections resolve', () => {
  const workflow = loadWorkflow();
  const names = workflow.nodes.map(({ name }) => name);
  const ids = workflow.nodes.map(({ id }) => id);
  assert.equal(new Set(names).size, names.length);
  assert.equal(new Set(ids).size, ids.length);

  const nameSet = new Set(names);
  for (const [sourceName, connectionTypes] of Object.entries(workflow.connections)) {
    assert.ok(nameSet.has(sourceName), `unknown connection source ${sourceName}`);
    for (const outputs of Object.values(connectionTypes)) {
      for (const output of outputs) {
        for (const connection of output) {
          assert.ok(
            nameSet.has(connection.node),
            `unknown connection target ${connection.node}`,
          );
        }
      }
    }
  }
});

test('repair topology cannot bypass validation attempt 2 or the completeness barrier', () => {
  const workflow = loadWorkflow();

  assert.deepEqual(
    connectedTargets(workflow, 'Подготовить запрос для AI'),
    ['AI Extractor v1.0'],
  );
  assert.deepEqual(
    connectedTargets(workflow, 'Обработать evidence units по одной', 1),
    ['Primary Extractor accepted?'],
  );
  assert.deepEqual(
    connectedTargets(workflow, 'AI Extractor v1.0'),
    ['Связать primary Extractor response с source'],
  );
  assert.deepEqual(
    connectedTargets(workflow, 'Связать primary Extractor response с source'),
    ['Проверить и привязать evidence'],
  );
  assert.deepEqual(
    connectedTargets(workflow, 'Проверить и привязать evidence'),
    ['Обработать evidence units по одной'],
  );
  assert.deepEqual(
    connectedTargets(workflow, 'Обработать evidence units по одной', 0),
    ['Проверить полноту Extractor recovery'],
  );
  assert.deepEqual(
    connectedTargets(workflow, 'Проверить полноту Extractor recovery'),
    ['Собрать units после evidence validation'],
  );
  assert.deepEqual(
    connectedTargets(workflow, 'Evidence validation passed?', 1),
    ['Классифицировать bounded retry'],
  );
  assert.deepEqual(
    connectedTargets(workflow, 'Классифицировать bounded retry'),
    ['Выбрать bounded retry route'],
  );
  assert.deepEqual(
    connectedTargets(workflow, 'Выбрать bounded retry route', 0),
    ['Подготовить Evidence Repair'],
  );
  assert.deepEqual(
    connectedTargets(workflow, 'Выбрать bounded retry route', 1),
    ['Подготовить Lossless Fact Partition'],
  );
  assert.deepEqual(
    connectedTargets(workflow, 'Выбрать bounded retry route', 2),
    ['Завершить unit: retry route unavailable'],
  );
  assert.deepEqual(
    connectedTargets(workflow, 'Подготовить Evidence Repair'),
    ['AI Evidence Repair v1'],
  );
  assert.deepEqual(
    connectedTargets(workflow, 'AI Evidence Repair v1'),
    ['Проверить evidence — попытка 2'],
  );
  assert.deepEqual(
    connectedTargets(workflow, 'Проверить evidence — попытка 2'),
    ['Evidence repair passed?'],
  );
  assert.deepEqual(
    connectedTargets(workflow, 'Evidence repair passed?', 1),
    ['Завершить unit: evidence validation failed'],
  );
  assert.deepEqual(
    connectedTargets(workflow, 'Подготовить Lossless Fact Partition'),
    ['AI Lossless Fact Partition v1'],
  );
  assert.deepEqual(
    connectedTargets(workflow, 'AI Lossless Fact Partition v1'),
    ['Проверить Lossless Fact Partition'],
  );
  assert.deepEqual(
    connectedTargets(workflow, 'Проверить Lossless Fact Partition'),
    ['Fact partition passed?'],
  );
  assert.deepEqual(
    connectedTargets(workflow, 'Fact partition passed?', 1),
    ['Завершить unit: evidence validation failed'],
  );
  assert.deepEqual(
    connectedTargets(workflow, 'Собрать units после evidence validation'),
    ['Подготовить dispatch AI Validator'],
  );
});

test('per-item validators use linked items, never a fixed positional item 0', () => {
  const workflow = loadWorkflow();
  const primaryWrapper = findNode(
    workflow,
    'Связать primary Extractor response с source',
  ).parameters.jsCode;
  const attemptOne = findNode(
    workflow,
    'Проверить и привязать evidence',
  ).parameters.jsCode;
  const prepareRepair = findNode(
    workflow,
    'Подготовить Evidence Repair',
  ).parameters.jsCode;
  const attemptTwo = findNode(
    workflow,
    'Проверить evidence — попытка 2',
  ).parameters.jsCode;
  const preparePartition = findNode(
    workflow,
    'Подготовить Lossless Fact Partition',
  ).parameters.jsCode;
  const validatePartition = findNode(
    workflow,
    'Проверить Lossless Fact Partition',
  ).parameters.jsCode;
  const validateAiResponse = findNode(
    workflow,
    'Проверить ответ AI Validator',
  ).parameters.jsCode;

  assert.match(primaryWrapper, /\$\('Подготовить запрос для AI'\)\.item\.json/);
  assert.match(attemptOne, /attempt_transport/);
  assert.doesNotMatch(attemptOne, /\$\([^)]*\)\.(?:item|itemMatching)\b/);
  assert.match(attemptTwo, /\$\('Подготовить Evidence Repair'\)\.item\.json/);
  assert.match(
    validatePartition,
    /\$\('Подготовить Lossless Fact Partition'\)\.item\.json/,
  );
  assert.match(
    validateAiResponse,
    /\$\(CONFIG\.sourceNodeName\)[\s\S]*\.itemMatching\(itemIndex\)/,
  );
  assert.doesNotMatch(
    validateAiResponse,
    /sourceItems\[itemIndex\]\?\.json/,
  );
  for (const code of [
    attemptOne,
    prepareRepair,
    attemptTwo,
    preparePartition,
    validatePartition,
  ]) {
    assert.doesNotMatch(code, /itemMatching\(0\)/);
    assert.doesNotMatch(code, /pairedItem:\s*\{\s*item:\s*0\s*\}/);
  }
});

test('application-side enforcement remains active for the current Polza model', () => {
  const workflow = loadWorkflow();
  const extractor = findNode(workflow, 'AI Extractor v1.0');
  const repair = findNode(workflow, 'AI Evidence Repair v1');
  const partition = findNode(workflow, 'AI Lossless Fact Partition v1');

  assert.match(extractor.parameters.jsonBody, /type:\s*'json_object'/);
  assert.match(repair.parameters.jsonBody, /type:\s*'json_object'/);
  assert.match(partition.parameters.jsonBody, /type:\s*'json_object'/);
  assert.doesNotMatch(extractor.parameters.jsonBody, /type:\s*'json_schema'/);
  assert.equal(extractor.onError, undefined);
  assert.equal(repair.onError, undefined);
  assert.equal(repair.retryOnFail, undefined);
  assert.equal(partition.onError, undefined);
  assert.equal(partition.retryOnFail, undefined);
});

test('attempt 1 accepts more than five exact primary evidence within the resource budget', async () => {
  const workflow = loadWorkflow();
  const segments = Array.from({ length: 8 }, (_, index) => ({
    semantic_block_id: `sb_${String(index + 1).padStart(4, '0')}`,
    scope: 'primary',
    type: 'text',
    role: 'body',
    text: `Точный фрагмент ${index + 1}`,
  }));
  const fact = buildFact(
    segments.map((segment) => ({
      semantic_block_id: segment.semantic_block_id,
      quote: segment.text,
    })),
  );

  const result = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    buildExtractorResponse([fact]),
    buildSource(segments),
  );

  assert.equal(result.validation_passed, true);
  assert.deepEqual(result.violations, []);
  assert.equal(result.verified_facts[0].evidence.length, 8);
  assert.equal(
    result.extractor.evidence_diagnostics.resource_metrics.evidence_count,
    8,
  );
});

test('attempt 1 reports all evidence violations in one analysis unit', async () => {
  const workflow = loadWorkflow();
  const segments = [
    {
      semantic_block_id: 'sb_0001',
      scope: 'primary',
      type: 'text',
      role: 'body',
      text: 'Правильная непрерывная цитата',
    },
    {
      semantic_block_id: 'sb_0002',
      scope: 'primary',
      type: 'text',
      role: 'body',
      text: 'Цитата находится в другом блоке',
    },
    {
      semantic_block_id: 'sb_0003',
      scope: 'overlap',
      type: 'text',
      role: 'body',
      text: 'Только overlap evidence',
    },
  ];
  const facts = [
    buildFact([
      {
        semantic_block_id: 'sb_0001',
        quote: 'Цитата находится в другом блоке',
      },
    ]),
    buildFact([
      {
        semantic_block_id: 'sb_0001',
        quote: 'Цитата ... которой нет',
      },
    ]),
    buildFact([
      {
        semantic_block_id: 'sb_0003',
        quote: 'Только overlap evidence',
      },
    ]),
    buildFact([
      {
        semantic_block_id: 'sb_9999',
        quote: 'Правильная непрерывная цитата',
      },
    ]),
  ];

  const result = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    buildExtractorResponse(facts),
    buildSource(segments),
  );
  const codes = result.violations.map((violation) => violation.code);
  const resolvedCodes = result.resolved_violations.map(
    (violation) => violation.code,
  );

  assert.equal(result.validation_passed, false);
  assert.ok(codes.includes('wrong_semantic_block_id'));
  assert.ok(codes.includes('quote_not_found'));
  assert.ok(!codes.includes('overlap_only'));
  assert.ok(resolvedCodes.includes('overlap_only'));
  assert.ok(codes.includes('unknown_semantic_block_id'));
  assert.ok(codes.includes('missing_primary_evidence'));
  assert.equal(result.verified_facts.length, 0);
  assert.equal(result.deterministically_rejected_facts.length, 1);
});

test('non-evidence model contract violations become one typed fallback decision', async () => {
  const workflow = loadWorkflow();
  const segments = [
    {
      semantic_block_id: 'sb_0001',
      scope: 'primary',
      type: 'text',
      role: 'body',
      text: 'Точная цитата',
    },
  ];
  const response = buildExtractorResponse([
    buildFact(
      [{ semantic_block_id: 'sb_0001', quote: 'Точная цитата' }],
      { field_key: 'invented_field' },
    ),
  ]);

  const result = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    response,
    buildSource(segments),
  );
  assert.deepEqual(
    result.extractor_recovery_decision,
    {
      version: 'ai_extractor_primary_decision_v1',
      analysis_unit_id: 'fixture-unit',
      decision: 'fallback_required',
      primary_failure_class: 'contract',
      primary_failure_code: 'invalid_fact_contract',
    },
  );
});

test('attempt 1 reports bounded resource violations without truncating evidence', async () => {
  const workflow = loadWorkflow();
  const segments = [{
    semantic_block_id: 'sb_0001',
    scope: 'primary',
    type: 'text',
    role: 'body',
    text: 'А'.repeat(1500),
  }];
  const evidence = Array.from({ length: 26 }, (_, index) => ({
    semantic_block_id: 'sb_0001',
    quote: `${'А'.repeat(190)} ${index}`,
  }));

  const result = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    buildExtractorResponse([buildFact(evidence)]),
    buildSource(segments),
  );
  const codes = new Set(result.violations.map((violation) => violation.code));

  assert.equal(result.validation_passed, false);
  assert.equal(result.evidence_validation.resource_metrics.evidence_count, 26);
  assert.ok(codes.has('evidence_limit_exceeded'));
  assert.ok(codes.has('evidence_total_quote_chars_exceeded'));
  assert.equal(result.repair_context.original_extractor_response.facts[0].evidence.length, 26);
});

test('attempt 1 detects exact duplicate ID and quote pairs', async () => {
  const workflow = loadWorkflow();
  const segments = [{
    semantic_block_id: 'sb_0001',
    scope: 'primary',
    type: 'text',
    role: 'body',
    text: 'Точная цитата',
  }];
  const duplicate = { semantic_block_id: 'sb_0001', quote: 'Точная цитата' };

  const result = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    buildExtractorResponse([buildFact([duplicate, duplicate])]),
    buildSource(segments),
  );

  assert.ok(result.violations.some(({ code }) => code === 'duplicate_evidence'));
});

test('pure exact-grounded resource overflow routes to fact_partition', async () => {
  const workflow = loadWorkflow();
  const unit = buildResourceOverflowUnit();
  const first = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    unit.extractorResponse,
    unit.source,
  );
  const classified = await classifyRetry(workflow, first);

  assert.equal(first.validation_passed, false);
  assert.deepEqual(
    [...new Set(first.violations.map(({ code }) => code))],
    ['evidence_limit_exceeded'],
  );
  assert.equal(classified.retry_decision.route, 'fact_partition');
  assert.equal(
    classified.retry_decision.all_partition_evidence_exact_grounded,
    true,
  );
  await assert.rejects(
    runCodeNode(
      workflow,
      'Подготовить Evidence Repair',
      classified,
      classified,
    ),
    /Invalid retry route/,
  );
});

test('resource overflow mixed with an evidence violation routes to hard_error', async () => {
  const workflow = loadWorkflow();
  const unit = buildResourceOverflowUnit();
  unit.fact.evidence[0].quote = 'Цитаты нет в исходном semantic block';
  unit.extractorResponse = buildExtractorResponse(
    [unit.fact],
    unit.analysisUnitId,
  );
  const first = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    unit.extractorResponse,
    unit.source,
  );
  const classified = await classifyRetry(workflow, first);
  const codes = new Set(first.violations.map(({ code }) => code));

  assert.ok(codes.has('evidence_limit_exceeded'));
  assert.ok(codes.has('quote_not_found'));
  assert.equal(classified.retry_decision.route, 'hard_error');
  assert.deepEqual(
    connectedTargets(workflow, 'Выбрать bounded retry route', 2),
    ['Завершить unit: retry route unavailable'],
  );
});

test('lossless partition preserves value_text byte-for-byte', async () => {
  const workflow = loadWorkflow();
  const unit = buildResourceOverflowUnit();
  const { prepared } = await prepareFactPartition(workflow, unit);
  const replacementFacts = buildLosslessReplacementFacts(unit.fact, [13, 13]);
  const result = await validateFactPartition(
    workflow,
    unit,
    prepared,
    replacementFacts,
  );

  assert.equal(result.validation_passed, true, JSON.stringify(result.violations));
  assert.equal(
    result.verified_facts.map(({ value_text }) => value_text).join(''),
    unit.valueText,
  );
  assert.equal(result.extractor.partition.value_text_lossless, true);
  assert.equal(
    result.extractor.partition.original_invalid_facts[0].fact.value_text,
    unit.valueText,
  );
});

test('lossless partition preserves the complete evidence multiset', async () => {
  const workflow = loadWorkflow();
  const unit = buildResourceOverflowUnit();
  const { prepared } = await prepareFactPartition(workflow, unit);
  const result = await validateFactPartition(
    workflow,
    unit,
    prepared,
    buildLosslessReplacementFacts(unit.fact, [13, 13]),
  );
  const rebuiltEvidence = result.verified_facts.flatMap(({ evidence }) => evidence);

  assert.equal(result.validation_passed, true, JSON.stringify(result.violations));
  assert.deepEqual(evidenceMultiset(rebuiltEvidence), evidenceMultiset(unit.evidence));
  assert.equal(result.extractor.partition.evidence_multiset_lossless, true);
});

test('lossless partition rejects evidence drop, duplication, and mutation', async () => {
  const workflow = loadWorkflow();
  const unit = buildResourceOverflowUnit();
  const { prepared } = await prepareFactPartition(workflow, unit);

  const dropped = buildLosslessReplacementFacts(unit.fact, [13, 13]);
  dropped[1].evidence.pop();
  const droppedResult = await validateFactPartition(
    workflow,
    unit,
    prepared,
    dropped,
  );
  assert.equal(droppedResult.validation_passed, false);
  assert.ok(droppedResult.violations.some(
    ({ code }) => code === 'partition_dropped_evidence',
  ));

  const duplicated = buildLosslessReplacementFacts(unit.fact, [13, 13]);
  duplicated[1].evidence[12] = structuredClone(duplicated[0].evidence[0]);
  const duplicatedResult = await validateFactPartition(
    workflow,
    unit,
    prepared,
    duplicated,
  );
  assert.equal(duplicatedResult.validation_passed, false);
  assert.ok(duplicatedResult.violations.some(
    ({ code }) => code === 'partition_duplicate_evidence',
  ));
  assert.ok(duplicatedResult.violations.some(
    ({ code }) => code === 'partition_dropped_evidence',
  ));

  const mutated = buildLosslessReplacementFacts(unit.fact, [13, 13]);
  mutated[0].evidence[0].quote += ' изменено';
  const mutatedResult = await validateFactPartition(
    workflow,
    unit,
    prepared,
    mutated,
  );
  assert.equal(mutatedResult.validation_passed, false);
  assert.ok(mutatedResult.violations.some(
    ({ code }) => code === 'partition_added_evidence',
  ));
  assert.ok(mutatedResult.violations.some(
    ({ code }) => code === 'partition_dropped_evidence',
  ));
});

test('lossless partition repeats exact grounding after reconstruction', async () => {
  const workflow = loadWorkflow();
  const unit = buildResourceOverflowUnit();
  const { prepared } = await prepareFactPartition(workflow, unit);
  const replacementFacts = buildLosslessReplacementFacts(unit.fact, [13, 13]);
  replacementFacts[0].evidence[0].quote = 'Текст, которого нет в блоке';
  const result = await validateFactPartition(
    workflow,
    unit,
    prepared,
    replacementFacts,
  );

  assert.equal(result.validation_passed, false);
  assert.deepEqual(result.verified_facts, []);
  assert.ok(result.violations.some(({ code }) => code === 'quote_not_found'));
});

test('lossless partition enforces per-fact evidence resource limits', async () => {
  const workflow = loadWorkflow();
  const countOverflow = buildResourceOverflowUnit({ evidenceCount: 27 });
  const countPrepared = await prepareFactPartition(workflow, countOverflow);
  const countResult = await validateFactPartition(
    workflow,
    countOverflow,
    countPrepared.prepared,
    buildLosslessReplacementFacts(countOverflow.fact, [26, 1]),
  );
  assert.equal(countResult.validation_passed, false);
  assert.ok(countResult.violations.some(
    ({ code }) => code === 'evidence_limit_exceeded',
  ));

  const quoteCharsOverflow = buildResourceOverflowUnit({
    analysisUnitId: 'quote-chars-unit',
    evidenceCount: 26,
    quoteLength: 201,
  });
  const quoteCharsPrepared = await prepareFactPartition(
    workflow,
    quoteCharsOverflow,
  );
  const quoteCharsResult = await validateFactPartition(
    workflow,
    quoteCharsOverflow,
    quoteCharsPrepared.prepared,
    buildLosslessReplacementFacts(quoteCharsOverflow.fact, [25, 1]),
  );
  assert.equal(quoteCharsResult.validation_passed, false);
  assert.ok(quoteCharsResult.violations.some(
    ({ code }) => code === 'evidence_total_quote_chars_exceeded',
  ));

  const quoteLengthOverflow = buildLosslessReplacementFacts(
    countOverflow.fact,
    [14, 13],
  );
  quoteLengthOverflow[0].evidence[0].quote = 'А'.repeat(1501);
  await assert.rejects(
    validateFactPartition(
      workflow,
      countOverflow,
      countPrepared.prepared,
      quoteLengthOverflow,
    ),
    /Invalid quote length/,
  );

  const validResult = await validateFactPartition(
    workflow,
    countOverflow,
    countPrepared.prepared,
    buildLosslessReplacementFacts(countOverflow.fact, [14, 13]),
  );
  assert.equal(validResult.validation_passed, true);
  assert.ok(validResult.verified_facts.every(({ evidence }) => evidence.length <= 25));
  assert.ok(validResult.verified_facts.every(
    ({ evidence }) => evidence.reduce((sum, item) => sum + item.quote.length, 0) <= 5000,
  ));
});

test('lossless partition allows at most one bounded retry per unit', async () => {
  const workflow = loadWorkflow();
  const unit = buildResourceOverflowUnit();
  const { classified } = await prepareFactPartition(workflow, unit);
  const afterAnotherRetry = structuredClone(classified);
  afterAnotherRetry.extractor.repair.requests_count = 1;

  await assert.rejects(
    runCodeNode(
      workflow,
      'Подготовить Lossless Fact Partition',
      afterAnotherRetry,
      afterAnotherRetry,
    ),
    /Второй retry запрещён/,
  );
  assert.deepEqual(
    connectedTargets(workflow, 'Fact partition passed?', 1),
    ['Завершить unit: evidence validation failed'],
  );
  assert.deepEqual(
    connectedTargets(workflow, 'Завершить unit: evidence validation failed'),
    [],
  );
});

test('lossless partition item linking rejects crossed analysis units', async () => {
  const workflow = loadWorkflow();
  const unitB = buildResourceOverflowUnit({ analysisUnitId: 'partition-unit-B' });
  const unitD = buildResourceOverflowUnit({ analysisUnitId: 'partition-unit-D' });
  const preparedB = await prepareFactPartition(workflow, unitB);
  const preparedD = await prepareFactPartition(workflow, unitD);
  const responseB = buildPartitionResponse([
    {
      source_fact_index: 0,
      violation_codes: preparedB.prepared.violations.map(({ code }) => code),
      replacement_facts: buildLosslessReplacementFacts(unitB.fact, [13, 13]),
    },
  ], unitB.analysisUnitId);

  await assert.rejects(
    runCodeNode(
      workflow,
      'Проверить Lossless Fact Partition',
      responseB,
      preparedD.prepared,
    ),
    /analysis_unit_id/,
  );
  const correctB = await runCodeNode(
    workflow,
    'Проверить Lossless Fact Partition',
    responseB,
    preparedB.prepared,
  );
  const correctD = await validateFactPartition(
    workflow,
    unitD,
    preparedD.prepared,
    buildLosslessReplacementFacts(unitD.fact, [13, 13]),
  );
  assert.equal(correctB.analysis_unit_meta.analysis_unit_id, unitB.analysisUnitId);
  assert.equal(correctD.analysis_unit_meta.analysis_unit_id, unitD.analysisUnitId);
  assert.equal(correctB.validation_passed, true);
  assert.equal(correctD.validation_passed, true);
});

test('14371 fixture is a synthetic structural class, not an execution replay', () => {
  const fixture = JSON.parse(
    fs.readFileSync(synthetic14371ReferenceOnlyFixturePath, 'utf8'),
  );
  assert.deepEqual(fixture, {
    schema_version: 'document_worker_evidence_reference_only_structural_class_v1',
    fixture_kind: 'synthetic_structural_class',
    runtime_replay: false,
    execution_id: 14371,
    analysis_unit_id: 'doc_3_au_0003',
    semantic_block_id: 'sb_0019',
    violation: {
      code: 'quote_not_found',
      exact_match_candidate_ids: [],
    },
  });
  assert.deepEqual(
    Object.keys(fixture).sort(),
    [
      'analysis_unit_id', 'execution_id', 'fixture_kind', 'runtime_replay',
      'schema_version', 'semantic_block_id', 'violation',
    ],
  );
});

test('Evidence Repair v2 builds stable canonical refs from block IDs and ordinals', async () => {
  const workflow = loadWorkflow();
  const source = buildSource([
    {
      semantic_block_id: 'sb_stable_a', scope: 'primary', type: 'text', role: 'body',
      text: 'Первый канонический фрагмент.',
    },
    {
      semantic_block_id: 'sb_stable_b', scope: 'overlap', type: 'text', role: 'heading',
      text: 'Второй канонический фрагмент.',
    },
  ]);
  const invalid = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    buildExtractorResponse([buildFact([{
      semantic_block_id: 'sb_stable_a',
      quote: 'Невалидная цитата',
    }])]),
    source,
  );
  const first = await prepareEvidenceRepair(workflow, invalid);
  const second = await prepareEvidenceRepair(workflow, invalid);

  assert.deepEqual(first.repair_request.evidence_catalog, second.repair_request.evidence_catalog);
  assert.deepEqual(
    first.repair_request.evidence_catalog.map(({ evidence_ref }) => evidence_ref),
    ['er2:sb_stable_a:0001', 'er2:sb_stable_b:0001'],
  );
  assert.deepEqual(Object.keys(first.repair_request.evidence_catalog[0]).sort(), [
    'canonical_quote', 'context_after', 'context_before', 'evidence_ref',
    'role', 'scope', 'semantic_block_id', 'type',
  ]);
  assert.deepEqual(
    first.repair_request.evidence_catalog_contract,
    second.repair_request.evidence_catalog_contract,
  );
});

test('independent adjacent sentences remain two evidence refs and are never packed', async () => {
  const workflow = loadWorkflow();
  const { prepared } = await buildCatalogParityFixture(workflow, 'sentence-boundary-unit');
  const sentenceCandidates = prepared.repair_request.evidence_catalog.filter(
    ({ semantic_block_id }) => semantic_block_id === 'sb_parity_a',
  );
  assert.deepEqual(
    sentenceCandidates.map(({ evidence_ref, canonical_quote }) => ({ evidence_ref, canonical_quote })),
    [
      {
        evidence_ref: 'er2:sb_parity_a:0001',
        canonical_quote: 'Первое самостоятельное предложение.',
      },
      {
        evidence_ref: 'er2:sb_parity_a:0002',
        canonical_quote: 'Второе противоположное предложение.',
      },
    ],
  );
  assert.equal(sentenceCandidates[0].context_before, null);
  assert.equal(sentenceCandidates[0].context_after, sentenceCandidates[1].canonical_quote);
  assert.equal(sentenceCandidates[1].context_before, sentenceCandidates[0].canonical_quote);
  assert.equal(sentenceCandidates[1].context_after, null);
});

test('Prepare and attempt 2 contain byte-identical deterministic catalog builders', () => {
  const workflow = loadWorkflow();
  const start = '/* EVIDENCE_REPAIR_CATALOG_BUILDER_SHARED_START */';
  const end = '/* EVIDENCE_REPAIR_CATALOG_BUILDER_SHARED_END */';
  const extract = (nodeName) => {
    const code = findNode(workflow, nodeName).parameters.jsCode;
    const startIndex = code.indexOf(start);
    const endIndex = code.indexOf(end);
    assert.ok(startIndex >= 0 && endIndex > startIndex, `${nodeName}: shared catalog markers missing`);
    return code.slice(startIndex, endIndex + end.length);
  };
  assert.equal(
    extract('Подготовить Evidence Repair'),
    extract('Проверить evidence — попытка 2'),
  );
});

test('attempt 2 rebuild rejects a grounded quote tamper even with recalculated totals', async () => {
  const workflow = loadWorkflow();
  const { prepared, response } = await buildCatalogParityFixture(workflow, 'catalog-quote-tamper');
  const tampered = structuredClone(prepared);
  const candidate = tampered.repair_request.evidence_catalog.find(
    ({ evidence_ref }) => evidence_ref === 'er2:sb_parity_a:0001',
  );
  candidate.canonical_quote = 'самостоятельное предложение.';
  recalculatePreparedCatalogContract(tampered);
  await assert.rejects(
    runCodeNode(workflow, 'Проверить evidence — попытка 2', response, tampered),
    /catalog parity|immutable catalog/i,
  );
});

test('attempt 2 rebuild rejects omitted candidates and blocks', async () => {
  const workflow = loadWorkflow();
  const { prepared, response } = await buildCatalogParityFixture(workflow, 'catalog-omit-tamper');
  const tampered = structuredClone(prepared);
  tampered.repair_request.evidence_catalog = tampered.repair_request.evidence_catalog.filter(
    ({ semantic_block_id }) => semantic_block_id !== 'sb_parity_b',
  );
  recalculatePreparedCatalogContract(tampered);
  await assert.rejects(
    runCodeNode(workflow, 'Проверить evidence — попытка 2', response, tampered),
    /catalog parity|immutable catalog/i,
  );
});

test('attempt 2 rebuild rejects candidate reordering', async () => {
  const workflow = loadWorkflow();
  const { prepared, response } = await buildCatalogParityFixture(workflow, 'catalog-order-tamper');
  const tampered = structuredClone(prepared);
  const left = tampered.repair_request.evidence_catalog.findIndex(
    ({ semantic_block_id }) => semantic_block_id === 'sb_parity_b',
  );
  const right = tampered.repair_request.evidence_catalog.findIndex(
    ({ semantic_block_id }) => semantic_block_id === 'sb_parity_c',
  );
  [tampered.repair_request.evidence_catalog[left], tampered.repair_request.evidence_catalog[right]] =
    [tampered.repair_request.evidence_catalog[right], tampered.repair_request.evidence_catalog[left]];
  await assert.rejects(
    runCodeNode(workflow, 'Проверить evidence — попытка 2', response, tampered),
    /catalog parity|immutable catalog/i,
  );
});

test('attempt 2 rebuild rejects source-grounded context tampering', async () => {
  const workflow = loadWorkflow();
  const { prepared, response } = await buildCatalogParityFixture(workflow, 'catalog-context-tamper');
  const tampered = structuredClone(prepared);
  const candidate = tampered.repair_request.evidence_catalog.find(
    ({ evidence_ref }) => evidence_ref === 'er2:sb_parity_a:0001',
  );
  candidate.context_after = 'противоположное предложение.';
  recalculatePreparedCatalogContract(tampered);
  await assert.rejects(
    runCodeNode(workflow, 'Проверить evidence — попытка 2', response, tampered),
    /catalog parity|immutable catalog/i,
  );
});

test('attempt 2 rebuild rejects an alternate exact fragment boundary', async () => {
  const workflow = loadWorkflow();
  const unitId = 'catalog-fragment-boundary-tamper';
  const longHead = 'A'.repeat(1500);
  const longTail = 'B'.repeat(100);
  const source = buildSource([{
    semantic_block_id: 'sb_long_boundary', scope: 'primary', type: 'text', role: 'body',
    text: `${longHead} ${longTail}`,
  }], unitId);
  const first = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    buildExtractorResponse([buildFact([{
      semantic_block_id: 'sb_long_boundary', quote: 'missing',
    }])], unitId),
    source,
  );
  const prepared = await prepareEvidenceRepair(workflow, first);
  const tampered = structuredClone(prepared);
  const candidates = tampered.repair_request.evidence_catalog;
  candidates[0].canonical_quote = 'A'.repeat(1499);
  candidates[0].context_after = longTail;
  candidates[1].context_before = 'A'.repeat(1499);
  recalculatePreparedCatalogContract(tampered);
  const response = buildRepairResponse([{
    fact_index: 0,
    violation_codes: [],
    selected_evidence_refs: ['er2:sb_long_boundary:0001'],
  }], { analysis_unit_id: unitId });
  await assert.rejects(
    runCodeNode(workflow, 'Проверить evidence — попытка 2', response, tampered),
    /catalog parity|immutable catalog/i,
  );
});

test('Evidence Repair v2 materializes single and multiple refs with exact downstream shape', async () => {
  const workflow = loadWorkflow();
  const source = buildSource([
    {
      semantic_block_id: 'sb_retained', scope: 'primary', type: 'text', role: 'body',
      text: 'Уже точная исходная цитата.',
    },
    {
      semantic_block_id: 'sb_repaired', scope: 'primary', type: 'text', role: 'body',
      text: 'Первая материализованная цитата.',
    },
    {
      semantic_block_id: 'sb_additional', scope: 'overlap', type: 'text', role: 'heading',
      text: 'Вторая материализованная цитата.',
    },
  ]);
  const invalidQuote = 'Эта строка отсутствует в источнике';
  const invalid = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    buildExtractorResponse([buildFact([
      { semantic_block_id: 'sb_retained', quote: 'Уже точная исходная цитата.' },
      { semantic_block_id: 'sb_repaired', quote: invalidQuote },
    ])]),
    source,
  );
  const prepared = await prepareEvidenceRepair(workflow, invalid);
  const repaired = await runCodeNode(
    workflow,
    'Проверить evidence — попытка 2',
    buildRepairResponse([buildReferenceRepair(
      prepared,
      0,
      ['sb_repaired', 'sb_additional'],
      ['quote_not_found'],
    )]),
    prepared,
  );

  assert.equal(repaired.validation_passed, true, JSON.stringify(repaired.violations));
  assert.deepEqual(
    repaired.verified_facts[0].evidence.map(({ semantic_block_id, quote }) => ({
      semantic_block_id,
      quote,
    })),
    [
      { semantic_block_id: 'sb_retained', quote: 'Уже точная исходная цитата.' },
      { semantic_block_id: 'sb_repaired', quote: 'Первая материализованная цитата.' },
      { semantic_block_id: 'sb_additional', quote: 'Вторая материализованная цитата.' },
    ],
  );
  assert.ok(repaired.verified_facts[0].evidence.every((evidence) => (
    Object.hasOwn(evidence, 'scope') &&
    Object.hasOwn(evidence, 'type') &&
    Object.hasOwn(evidence, 'role') &&
    Object.hasOwn(evidence, 'source_block_ids') &&
    Object.hasOwn(evidence, 'page_from') &&
    Object.hasOwn(evidence, 'page_to') &&
    Object.hasOwn(evidence, 'sheet_name') &&
    Object.hasOwn(evidence, 'sources')
  )));
  assert.doesNotMatch(JSON.stringify(repaired.verified_facts), new RegExp(invalidQuote));
  assert.doesNotMatch(JSON.stringify(repaired.evidence_context), new RegExp(invalidQuote));
});

test('repair_dropped_grounded_evidence synchronizes diagnostics metrics and audit counts', async () => {
  const workflow = loadWorkflow();
  const unitId = 'repair-dropped-metrics-unit';
  const source = buildSource([
    {
      semantic_block_id: 'sb_metrics_retained', scope: 'primary', type: 'text', role: 'body',
      text: 'Grounded evidence that must be retained.',
    },
    {
      semantic_block_id: 'sb_metrics_selected', scope: 'primary', type: 'text', role: 'body',
      text: 'Grounded selected replacement.',
    },
  ], unitId);
  const first = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    buildExtractorResponse([buildFact([
      { semantic_block_id: 'sb_metrics_retained', quote: 'Grounded evidence that must be retained.' },
      { semantic_block_id: 'sb_metrics_selected', quote: 'missing quote' },
    ])], unitId),
    source,
  );
  const prepared = await prepareEvidenceRepair(workflow, first);
  const search = "if (isExactGroundedEvidence(segment, evidence.quote)) {\n      addExact({ semantic_block_id: evidence.semantic_block_id, quote: evidence.quote });\n    }";
  const replacement = "if (false && isExactGroundedEvidence(segment, evidence.quote)) {\n      addExact({ semantic_block_id: evidence.semantic_block_id, quote: evidence.quote });\n    }";
  const harnessWorkflow = workflowWithAttemptTwoMutation(workflow, search, replacement);
  const result = await runCodeNode(
    harnessWorkflow,
    'Проверить evidence — попытка 2',
    buildRepairResponse([buildReferenceRepair(
      prepared,
      0,
      ['sb_metrics_selected'],
      ['quote_not_found'],
    )], { analysis_unit_id: unitId }),
    prepared,
  );
  assert.equal(result.validation_passed, false);
  assert.deepEqual(
    result.violations.map(({ code }) => code),
    ['repair_dropped_grounded_evidence'],
  );
  const metrics = result.extractor.evidence_diagnostics.resource_metrics;
  assert.equal(metrics.violations_by_code.repair_dropped_grounded_evidence, 1);
  assert.equal(metrics.unresolved_violations_count, result.violations.length);
  assert.equal(
    result.extractor.evidence_diagnostics.violations.length,
    result.evidence_validation.violations_count,
  );
  assert.deepEqual(
    result.evidence_validation.resource_metrics,
    metrics,
  );
});

test('Evidence Repair v2 rejects unknown, foreign, and duplicate refs exactly', async () => {
  const workflow = loadWorkflow();
  const makePrepared = async (unitId, blockId) => {
    const source = buildSource([{
      semantic_block_id: blockId,
      scope: 'primary',
      type: 'text',
      role: 'body',
      text: `Canonical ${unitId}`,
    }], unitId);
    const invalid = await runCodeNode(
      workflow,
      'Проверить и привязать evidence',
      buildExtractorResponse([buildFact([{
        semantic_block_id: blockId,
        quote: 'Missing quote',
      }])], unitId),
      source,
    );
    return prepareEvidenceRepair(workflow, invalid);
  };
  const preparedA = await makePrepared('unit-ref-a', 'sb_ref_a');
  const preparedB = await makePrepared('unit-ref-b', 'sb_ref_b');
  const validRef = firstCatalogRef(preparedA, 'sb_ref_a');
  const foreignRef = firstCatalogRef(preparedB, 'sb_ref_b');

  for (const refs of [['er2:sb_unknown:0001'], [foreignRef], [validRef, validRef]]) {
    await assert.rejects(
      runCodeNode(
        workflow,
        'Проверить evidence — попытка 2',
        buildRepairResponse([{
          fact_index: 0,
          violation_codes: [],
          selected_evidence_refs: refs,
        }], { analysis_unit_id: 'unit-ref-a' }),
        preparedA,
      ),
      /evidence_ref|duplicate|allow-list|unknown|foreign/i,
    );
  }
});

test('Evidence Repair v2 source duplicate IDs and catalog ref collisions fail closed', async () => {
  const workflow = loadWorkflow();
  const segments = [
    { semantic_block_id: 'sb_duplicate', scope: 'primary', type: 'text', role: 'body', text: 'A' },
    { semantic_block_id: 'sb_duplicate', scope: 'overlap', type: 'text', role: 'body', text: 'B' },
  ];
  const source = buildSource(segments, 'collision-unit');
  const invalid = {
      validation_passed: false,
      violations: [{
        code: 'quote_not_found', fact_index: 0, evidence_index: 0,
        details: { exact_match_candidate_ids: [] },
      }],
      repair_context: {
        original_extractor_response: {
          schema_version: 'ai_extractor_v1',
          field_catalog_version: 'tender_fields_v1',
          analysis_unit_id: 'collision-unit',
          facts: [buildFact([{ semantic_block_id: segments[0].semantic_block_id, quote: 'missing' }])],
        },
        source,
        field_catalog: [],
      },
      evidence_validation: {
        resource_contract: {
          max_evidence_per_fact: 25,
          max_quote_length: 1500,
          max_total_quote_chars_per_fact: 5000,
        },
      },
      retry_decision: {
        route: 'evidence_repair',
        invalid_fact_indexes: [0],
        evidence_repair_fact_indexes: [0],
      },
  };
  await assert.rejects(
    runCodeNode(workflow, 'Подготовить Evidence Repair', invalid, invalid),
    /duplicate|collision/i,
  );

  const validSource = buildSource([
    { semantic_block_id: 'sb_catalog_a', scope: 'primary', type: 'text', role: 'body', text: 'Catalog A' },
    { semantic_block_id: 'sb_catalog_b', scope: 'overlap', type: 'text', role: 'body', text: 'Catalog B' },
  ], 'catalog-collision-unit');
  const invalidUnit = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    buildExtractorResponse([buildFact([{
      semantic_block_id: 'sb_catalog_a', quote: 'missing',
    }])], 'catalog-collision-unit'),
    validSource,
  );
  const prepared = await prepareEvidenceRepair(workflow, invalidUnit);
  const tampered = structuredClone(prepared);
  tampered.repair_request.evidence_catalog[1].evidence_ref =
    tampered.repair_request.evidence_catalog[0].evidence_ref;
  await assert.rejects(
    runCodeNode(
      workflow,
      'Проверить evidence — попытка 2',
      buildRepairResponse([buildReferenceRepair(prepared, 0, ['sb_catalog_a'])], {
        analysis_unit_id: 'catalog-collision-unit',
      }),
      tampered,
    ),
    /duplicate evidence_ref|collision/i,
  );
});

test('identical canonical text in distinct blocks produces distinct identity-safe refs', async () => {
  const workflow = loadWorkflow();
  const unitId = 'duplicate-phrase-distinct-blocks';
  const phrase = 'Одинаковая допустимая фраза.';
  const source = buildSource([
    { semantic_block_id: 'sb_same_primary', scope: 'primary', type: 'text', role: 'body', text: phrase },
    { semantic_block_id: 'sb_same_overlap', scope: 'overlap', type: 'table', role: 'heading', text: `[C1] ${phrase}` },
  ], unitId);
  source.provenance.index.sb_same_primary.source_block_ids = ['#/texts/1'];
  source.provenance.index.sb_same_overlap.source_block_ids = ['#/tables/1'];
  const first = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    buildExtractorResponse([buildFact([{
      semantic_block_id: 'sb_same_primary', quote: 'Неточная цитата',
    }])], unitId),
    source,
  );
  const prepared = await prepareEvidenceRepair(workflow, first);
  assert.deepEqual(
    prepared.repair_request.evidence_catalog.map((candidate) => ({
      evidence_ref: candidate.evidence_ref,
      semantic_block_id: candidate.semantic_block_id,
      scope: candidate.scope,
      type: candidate.type,
      role: candidate.role,
      canonical_quote: candidate.canonical_quote,
    })),
    [
      {
        evidence_ref: 'er2:sb_same_primary:0001', semantic_block_id: 'sb_same_primary',
        scope: 'primary', type: 'text', role: 'body', canonical_quote: phrase,
      },
      {
        evidence_ref: 'er2:sb_same_overlap:0001', semantic_block_id: 'sb_same_overlap',
        scope: 'overlap', type: 'table', role: 'heading', canonical_quote: phrase,
      },
    ],
  );
  const repaired = await runCodeNode(
    workflow,
    'Проверить evidence — попытка 2',
    buildRepairResponse([{
      fact_index: 0,
      violation_codes: ['quote_not_found', 'missing_primary_evidence'],
      selected_evidence_refs: [
        'er2:sb_same_primary:0001',
        'er2:sb_same_overlap:0001',
      ],
    }], { analysis_unit_id: unitId }),
    prepared,
  );
  assert.equal(repaired.validation_passed, true, JSON.stringify(repaired.violations));
  assert.deepEqual(
    repaired.verified_facts[0].evidence.map((evidence) => ({
      semantic_block_id: evidence.semantic_block_id,
      scope: evidence.scope,
      type: evidence.type,
      role: evidence.role,
      source_block_ids: evidence.source_block_ids,
    })),
    [
      {
        semantic_block_id: 'sb_same_primary', scope: 'primary', type: 'text', role: 'body',
        source_block_ids: ['#/texts/1'],
      },
      {
        semantic_block_id: 'sb_same_overlap', scope: 'overlap', type: 'table', role: 'heading',
        source_block_ids: ['#/tables/1'],
      },
    ],
  );
});

test('Evidence Repair v2 catalog has explicit hard bounds and never truncates overflow', async () => {
  const workflow = loadWorkflow();
  const segments = [{
    semantic_block_id: 'sb_bound_incremental',
    scope: 'primary',
    type: 'text',
    role: 'body',
    text: Array.from({ length: 300 }, (_, index) => (
      `Unique bounded candidate ${index + 1}.`
    )).join('\n'),
  }];
  const source = buildSource(segments, 'catalog-overflow-unit');
  const first = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    buildExtractorResponse([buildFact([{
      semantic_block_id: segments[0].semantic_block_id,
      quote: 'Not in the source',
    }])], 'catalog-overflow-unit'),
    source,
  );

  await assert.rejects(
    prepareEvidenceRepair(workflow, first),
    /candidate count overflow.*candidate_index=257/i,
  );

  const charOverflowSegments = Array.from({ length: 251 }, (_, index) => ({
    semantic_block_id: `sb_chars_${String(index + 1).padStart(4, '0')}`,
    scope: index === 0 ? 'primary' : 'overlap',
    type: 'text',
    role: 'body',
    text: `${String(index + 1).padStart(4, '0')}-${'X'.repeat(995)}`,
  }));
  const charOverflowSource = buildSource(charOverflowSegments, 'catalog-char-overflow-unit');
  const charOverflowFirst = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    buildExtractorResponse([buildFact([{
      semantic_block_id: charOverflowSegments[0].semantic_block_id,
      quote: 'Not in this source either',
    }])], 'catalog-char-overflow-unit'),
    charOverflowSource,
  );
  await assert.rejects(
    prepareEvidenceRepair(workflow, charOverflowFirst),
    /canonical source.*overflow|catalog total character overflow/i,
  );
});

test('catalog preflight bounds an oversized single canonical block before request construction', async () => {
  const workflow = loadWorkflow();
  const unitId = 'oversized-canonical-source-unit';
  const source = buildSource([{
    semantic_block_id: 'sb_oversized_source',
    scope: 'primary',
    type: 'text',
    role: 'body',
    text: 'Z'.repeat(100001),
  }], unitId);
  const first = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    buildExtractorResponse([buildFact([{
      semantic_block_id: 'sb_oversized_source', quote: 'missing',
    }])], unitId),
    source,
  );
  await assert.rejects(
    prepareEvidenceRepair(workflow, first),
    /canonical source preflight overflow/i,
  );
});

test('Evidence Repair enforces the actual serialized HTTP request budget without truncation', async () => {
  const workflow = loadWorkflow();
  const source = buildSource([{
    semantic_block_id: 'sb_request_budget', scope: 'primary', type: 'text', role: 'body',
    text: 'Короткий source candidate.',
  }], 'request-budget-unit');
  const first = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    buildExtractorResponse([buildFact([{
      semantic_block_id: 'sb_request_budget', quote: 'missing',
    }])], 'request-budget-unit'),
    source,
  );
  first.repair_context.field_catalog = [{
    field_key: 'application_documents',
    instructions: 'Y'.repeat(400000),
  }];
  await assert.rejects(
    prepareEvidenceRepair(workflow, first),
    /serialized request budget overflow/i,
  );

  first.repair_context.field_catalog = [];
  const prepared = await prepareEvidenceRepair(workflow, first);
  const requestProjection = JSON.stringify({
    model: 'google/gemini-3.7-flash@provider=google-ai-studio/flex&reasoning_effort=low',
    messages: [
      { role: 'system', content: prepared.repair_request.system_prompt },
      { role: 'user', content: prepared.repair_request.user_prompt },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 8192,
    stream: false,
  });
  assert.equal(
    prepared.repair_request.evidence_catalog_contract.serialized_request_chars,
    requestProjection.length,
  );
  assert.equal(
    prepared.repair_request.evidence_catalog_contract.max_serialized_request_chars,
    360000,
  );
  const prepareCode = findNode(workflow, 'Подготовить Evidence Repair').parameters.jsCode;
  assert.doesNotMatch(prepareCode, /remaining\s*=\s*remaining\.slice/);
  assert.match(prepareCode, /sourceOffset/);
});

test('Evidence Repair v2 rejects source provenance and scope mismatch before provider input', async () => {
  const workflow = loadWorkflow();
  const source = buildSource([{
    semantic_block_id: 'sb_provenance_scope',
    scope: 'primary',
    type: 'text',
    role: 'body',
    text: 'Canonical source',
  }], 'provenance-scope-unit');
  const first = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    buildExtractorResponse([buildFact([{
      semantic_block_id: 'sb_provenance_scope',
      quote: 'Missing source text',
    }])], 'provenance-scope-unit'),
    source,
  );
  const classified = await classifyRetry(workflow, first);
  classified.repair_context.source.provenance.index.sb_provenance_scope.scope = 'overlap';
  await assert.rejects(
    runCodeNode(
      workflow,
      'Подготовить Evidence Repair',
      classified,
      classified,
    ),
    /provenance\/scope mismatch/i,
  );
});

test('DW-17 leaves Primary Extractor contract and Evidence Repair HTTP node byte-stable', () => {
  const workflow = loadWorkflow();
  const parameterHashes = Object.fromEntries([
    'Подготовить запрос для AI',
    'AI Extractor v1.0',
    'Связать primary Extractor response с source',
    'Проверить и привязать evidence',
  ].map((name) => [
    name,
    crypto.createHash('sha256')
      .update(JSON.stringify(findNode(workflow, name).parameters))
      .digest('hex'),
  ]));
  assert.deepEqual(parameterHashes, {
    'Подготовить запрос для AI': 'd7fadf8133a06e3faca1fcbe564c18fbe2715aa8277d6b9138bbecda36248cc2',
    'AI Extractor v1.0': 'f08f1c27ffb0969694b923718964515b58edfca69fd46edfc6a3b054a3ef6059',
    'Связать primary Extractor response с source': 'e42b9b2c4d0e2dc00bd2387702c53b39732c529456c9fbb1839c770775271176',
    'Проверить и привязать evidence': '22195356bcece450952479fcb473fa5e37ac121b101464aae7d313e3284be34d',
  });
  assert.equal(
    crypto.createHash('sha256')
      .update(JSON.stringify(findNode(workflow, 'AI Evidence Repair v1')))
      .digest('hex'),
    'b2eb9ea0dfe99de44b3d113cc9f1663b0ed0fa2f8394e1369a221d82160479f3',
  );
});

test('DW-17 preserves base Validator preparation parameters byte-for-byte', () => {
  const workflow = loadWorkflow();
  const parameters = findNode(workflow, 'Развернуть units для AI Validator').parameters;
  assert.equal(
    crypto.createHash('sha256').update(JSON.stringify(parameters)).digest('hex'),
    'cd95632a02b7beb442ea5f342c09f6e23671626926d44d0e1cfcf281810fb0ed',
  );
});

test('Evidence Repair v2 schema exposes selected refs only and prohibits model-authored evidence', async () => {
  const workflow = loadWorkflow();
  const source = buildSource([
    {
      semantic_block_id: 'sb_0001',
      scope: 'primary',
      type: 'text',
      role: 'body',
      text: 'Правильная цитата',
    },
  ]);
  const invalid = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    buildExtractorResponse([
      buildFact([{ semantic_block_id: 'sb_0001', quote: 'Нет в блоке' }]),
    ]),
    source,
  );
  const prepared = await prepareEvidenceRepair(workflow, invalid);
  const repairItemSchema = prepared.repair_request.response_schema
    .properties.repairs.items;
  assert.deepEqual(
    repairItemSchema.required,
    ['fact_index', 'violation_codes', 'selected_evidence_refs'],
  );
  assert.deepEqual(
    Object.keys(repairItemSchema.properties).sort(),
    ['fact_index', 'selected_evidence_refs', 'violation_codes'],
  );
  assert.equal(repairItemSchema.properties.evidence, undefined);
  assert.equal(repairItemSchema.properties.semantic_block_id, undefined);
  assert.equal(repairItemSchema.properties.quote, undefined);
  assert.equal(prepared.repair_request.prompt_version, 'tender_evidence_repair_prompt_v2');
  assert.equal(prepared.repair_request.schema_version, 'ai_evidence_repair_v2');
  assert.match(prepared.repair_request.system_prompt, /selected_evidence_refs/);
  assert.match(prepared.repair_request.system_prompt, /не.*quote/i);
  assert.match(prepared.repair_request.system_prompt, /"repairs"/);
  assert.match(prepared.repair_request.system_prompt, /не возвращай repaired_facts/i);
  const userPayload = JSON.parse(prepared.repair_request.user_prompt);
  assert.ok(userPayload.response_schema);
  assert.ok(userPayload.required_output_shape);
  assert.ok(Array.isArray(userPayload.required_output_shape.repairs));
  assert.ok(Array.isArray(userPayload.evidence_catalog));
  assert.deepEqual(
    Object.keys(userPayload.required_output_shape.repairs[0]).sort(),
    ['fact_index', 'selected_evidence_refs', 'violation_codes'],
  );
  assert.equal(userPayload.required_output_shape.repaired_facts, undefined);
});

test('attempt 2 deterministically rejects repaired_facts instead of repairs', async () => {
  const workflow = loadWorkflow();
  const source = buildSource([{
    semantic_block_id: 'sb_0001',
    scope: 'primary',
    type: 'text',
    role: 'body',
    text: 'Точная replacement quote',
  }]);
  const invalid = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    buildExtractorResponse([
      buildFact([{ semantic_block_id: 'sb_0001', quote: 'Нет в блоке' }]),
    ]),
    source,
  );
  const prepared = await prepareEvidenceRepair(workflow, invalid);
  const wrongRoot = buildRepairResponse([], {
    repaired_facts: [{ fact_index: 0, evidence: [] }],
  });
  const content = JSON.parse(wrongRoot.choices[0].message.content);
  delete content.repairs;
  wrongRoot.choices[0].message.content = JSON.stringify(content);

  await assert.rejects(
    runCodeNode(
      workflow,
      'Проверить evidence — попытка 2',
      wrongRoot,
      prepared,
    ),
    /недопустимое поле repaired_facts/,
  );
});

test('attempt 2 can replace wrong evidence while preserving the original fact value', async () => {
  const workflow = loadWorkflow();
  const source = buildSource([
    {
      semantic_block_id: 'sb_0001',
      scope: 'primary',
      type: 'text',
      role: 'body',
      text: 'Исходный первый блок',
    },
    {
      semantic_block_id: 'sb_0002',
      scope: 'primary',
      type: 'text',
      role: 'body',
      text: 'Нужная точная цитата',
    },
  ]);
  const originalValue = 'Неизменяемое значение факта';
  const invalid = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    buildExtractorResponse([
      buildFact(
        [{ semantic_block_id: 'sb_0001', quote: 'Нужная точная цитата' }],
        { value_text: originalValue },
      ),
    ]),
    source,
  );
  const prepared = await prepareEvidenceRepair(workflow, invalid);
  const repaired = await runCodeNode(
    workflow,
    'Проверить evidence — попытка 2',
    buildRepairResponse([
      {
        fact_index: 0,
        violation_codes: [],
        selected_evidence_refs: [firstCatalogRef(prepared, 'sb_0002')],
      },
    ]),
    prepared,
  );

  assert.equal(repaired.validation_passed, true);
  assert.equal(repaired.verified_facts[0].value_text, originalValue);
  assert.equal(repaired.verified_facts[0].evidence[0].semantic_block_id, 'sb_0002');
  assert.equal(repaired.extractor.repair.requests_count, 1);
  assert.equal(repaired.extractor.evidence_diagnostics.attempt, 2);
});

test('attempt 2 rejects a non-allow-listed evidence ref before materialization', async () => {
  const workflow = loadWorkflow();
  const source = buildSource([
    {
      semantic_block_id: 'sb_0001',
      scope: 'primary',
      type: 'text',
      role: 'body',
      text: 'Единственная точная цитата',
    },
  ]);
  const invalid = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    buildExtractorResponse([
      buildFact([{ semantic_block_id: 'sb_0001', quote: 'Отсутствующая цитата' }]),
    ]),
    source,
  );
  const prepared = await prepareEvidenceRepair(workflow, invalid);
  await assert.rejects(
    runCodeNode(
      workflow,
      'Проверить evidence — попытка 2',
      buildRepairResponse([{
        fact_index: 0,
        violation_codes: ['quote_not_found'],
        selected_evidence_refs: ['er2:sb_foreign:0001'],
      }]),
      prepared,
    ),
    /unknown|allow-list|evidence_ref/i,
  );
});

test('attempt 2 rejects incomplete repair output as a hard contract error', async () => {
  const workflow = loadWorkflow();
  const source = buildSource([
    {
      semantic_block_id: 'sb_0001',
      scope: 'primary',
      type: 'text',
      role: 'body',
      text: 'Точная цитата',
    },
  ]);
  const invalid = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    buildExtractorResponse([
      buildFact([{ semantic_block_id: 'sb_0001', quote: 'Нет в блоке' }]),
    ]),
    source,
  );
  const prepared = await prepareEvidenceRepair(workflow, invalid);

  await assert.rejects(
    runCodeNode(
      workflow,
      'Проверить evidence — попытка 2',
      buildRepairResponse([]),
      prepared,
    ),
    /каждого invalid fact/,
  );
});

test('attempt 2 enforces violation_codes application-side', async () => {
  const workflow = loadWorkflow();
  const source = buildSource([
    {
      semantic_block_id: 'sb_0001',
      scope: 'primary',
      type: 'text',
      role: 'body',
      text: 'Точная цитата',
    },
  ]);
  const invalid = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    buildExtractorResponse([
      buildFact([{ semantic_block_id: 'sb_0001', quote: 'Нет в блоке' }]),
    ]),
    source,
  );
  const prepared = await prepareEvidenceRepair(workflow, invalid);

  await assert.rejects(
    runCodeNode(
      workflow,
      'Проверить evidence — попытка 2',
      buildRepairResponse([
        {
          fact_index: 0,
          violation_codes: ['invented_violation'],
          selected_evidence_refs: [firstCatalogRef(prepared, 'sb_0001')],
        },
      ]),
      prepared,
    ),
    /violation_codes/,
  );
});

test('convergence: all-valid batch performs zero repairs and passes completeness', async () => {
  const workflow = loadWorkflow();
  const units = [
    buildConvergenceUnit('unitA', true),
    buildConvergenceUnit('unitB', true),
    buildConvergenceUnit('unitC', true),
  ];
  const result = await convergeUnits(workflow, units);
  assert.deepEqual(result.repairUnitIds, []);
  assert.equal(result.converged.length, 3);
  assert.deepEqual(result.failed, []);

  const savedUnits = units.map((unit) => ({
    analysis_batch: { units_total: units.length },
    analysis_unit_meta: { analysis_unit_id: unit.unitId },
  }));
  const barrier = await runCodeNodeItems(
    workflow,
    'Собрать units после evidence validation',
    result.converged,
    savedUnits,
  );
  assert.equal(barrier.length, 3);
  assert.equal(barrier[0].evidence_batch_metrics.repair_requests, 0);
});

test('convergence: mixed A/B/C/D repairs only B and D with no cross-linking', async () => {
  const workflow = loadWorkflow();
  const units = [
    buildConvergenceUnit('unitA', true),
    buildConvergenceUnit('unitB', false),
    buildConvergenceUnit('unitC', true),
    buildConvergenceUnit('unitD', false),
  ];
  const result = await convergeUnits(workflow, units);
  assert.deepEqual(result.repairUnitIds, ['unitB', 'unitD']);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(
    result.converged.map((item) => item.analysis_unit_meta.analysis_unit_id).sort(),
    ['unitA', 'unitB', 'unitC', 'unitD'],
  );
  assert.equal(new Set(
    result.converged.map((item) => item.analysis_unit_meta.analysis_unit_id),
  ).size, 4);
  for (const repairedId of ['unitB', 'unitD']) {
    const repaired = result.converged.find(
      (item) => item.analysis_unit_meta.analysis_unit_id === repairedId,
    );
    assert.equal(
      repaired.verified_facts[0].evidence[0].quote,
      `Точная цитата для ${repairedId}`,
    );
  }
});

test('analysis_unit_id rejects crossed B/D source links end-to-end', async () => {
  const workflow = loadWorkflow();
  const unitB = buildConvergenceUnit('unitB', false);
  const unitD = buildConvergenceUnit('unitD', false);
  const firstB = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    unitB.extractorResponse,
    unitB.source,
  );
  const firstD = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    unitD.extractorResponse,
    unitD.source,
  );
  const preparedB = await prepareEvidenceRepair(workflow, firstB);
  const preparedD = await prepareEvidenceRepair(workflow, firstD);
  const repairB = buildRepairResponse(
    [{
      fact_index: 0,
      violation_codes: [],
      selected_evidence_refs: [firstCatalogRef(
        preparedB,
        unitB.source.ai_segments[0].semantic_block_id,
      )],
    }],
    { analysis_unit_id: 'unitB' },
  );

  await assert.rejects(
    runCodeNode(
      workflow,
      'Проверить evidence — попытка 2',
      repairB,
      preparedD,
    ),
    /analysis_unit_id не совпадает/,
  );
  const correct = await runCodeNode(
    workflow,
    'Проверить evidence — попытка 2',
    repairB,
    preparedB,
  );
  assert.equal(correct.analysis_unit_meta.analysis_unit_id, 'unitB');
  assert.equal(correct.validation_passed, true);
});

test('convergence: all-invalid batch gets at most one repair per unit', async () => {
  const workflow = loadWorkflow();
  const units = ['unitA', 'unitB', 'unitC', 'unitD'].map(
    (unitId) => buildConvergenceUnit(unitId, false),
  );
  const result = await convergeUnits(workflow, units);
  assert.deepEqual(result.repairUnitIds, ['unitA', 'unitB', 'unitC', 'unitD']);
  assert.equal(result.converged.length, 4);
  assert.equal(result.failed.length, 0);
  assert.ok(result.converged.every(
    (item) => item.extractor.repair.requests_count === 1,
  ));
});

test('valid refs that exceed attempt-2 quote budget reach explicit Worker terminal exhaustion', async () => {
  const workflow = loadWorkflow();
  const unitId = 'terminal-exhaustion-unit';
  const segments = Array.from({ length: 4 }, (_, index) => ({
    semantic_block_id: `sb_terminal_${index + 1}`,
    scope: 'primary',
    type: 'text',
    role: 'body',
    text: `${index + 1}`.repeat(1400),
  }));
  const source = buildSource(segments, unitId);
  const first = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    buildExtractorResponse([buildFact([{
      semantic_block_id: 'sb_terminal_1', quote: 'not-grounded',
    }])], unitId),
    source,
  );
  const prepared = await prepareEvidenceRepair(workflow, first);
  const failed = await runCodeNode(
    workflow,
    'Проверить evidence — попытка 2',
    buildRepairResponse([buildReferenceRepair(
      prepared,
      0,
      segments.map(({ semantic_block_id }) => semantic_block_id),
    )], { analysis_unit_id: unitId }),
    prepared,
  );
  assert.equal(failed.validation_passed, false);
  assert.ok(failed.violations.some(({ code }) => code === 'evidence_total_quote_chars_exceeded'));
  await assert.rejects(
    runCodeNode(
      workflow,
      'Завершить unit: evidence validation failed',
      failed,
      failed,
    ),
    /Evidence validation exhausted.*attempts=2/,
  );
  assert.deepEqual(
    connectedTargets(workflow, 'Evidence repair passed?', 1),
    ['Завершить unit: evidence validation failed'],
  );
  assert.deepEqual(
    connectedTargets(workflow, 'Завершить unit: evidence validation failed'),
    [],
  );
});

test('execution 14059 doc_11_au_0005 grounds all 33 evidence on attempt 1 without repair', async () => {
  const workflow = loadWorkflow();
  const fixture = loadCoordinateTableFixture();
  const parsed = JSON.parse(fixture.response.choices[0].message.content);
  const expectedEvidenceCount = parsed.facts.reduce(
    (sum, fact) => sum + fact.evidence.length,
    0,
  );

  assert.equal(fixture.source_execution_id, 14059);
  assert.equal(fixture.source_workflow_name, '[2 TEST] TENDER — Обработать документ');
  assert.equal(fixture.analysis_unit_id, 'doc_11_au_0005');
  assert.equal(expectedEvidenceCount, 33);

  const result = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    fixture.response,
    fixture.source,
  );

  assert.equal(result.validation_attempt, 1);
  assert.equal(result.validation_passed, true, JSON.stringify(result.violations));
  assert.deepEqual(result.violations, []);
  assert.equal(
    result.verified_facts.reduce((sum, fact) => sum + fact.evidence.length, 0),
    33,
  );
  assert.equal(result.extractor.repair.requests_count, 0);
});

test('attempt 1 rejects a table evidence quote containing only one coordinate token', async () => {
  const workflow = loadWorkflow();
  const segment = {
    semantic_block_id: 'sb_coordinate_only_single',
    scope: 'primary',
    type: 'table',
    role: 'body',
    text: '[C1] Реальный текст ячейки',
  };
  const result = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    buildExtractorResponse([buildFact([{
      semantic_block_id: segment.semantic_block_id,
      quote: '[C1]',
    }])]),
    buildSource([segment]),
  );

  assert.equal(result.validation_passed, false);
  assert.ok(result.violations.some(({ code }) => code === 'quote_not_found'));
  assert.ok(result.violations.some(({ code }) => code === 'missing_primary_evidence'));
  assert.equal(result.verified_facts.length, 0);
});

test('attempt 1 rejects a table evidence quote containing multiple coordinate-only lines', async () => {
  const workflow = loadWorkflow();
  const segment = {
    semantic_block_id: 'sb_coordinate_only_multiline',
    scope: 'primary',
    type: 'table',
    role: 'body',
    text: '[C1] Первая ячейка\n[C2-C5] Вторая ячейка',
  };
  const result = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    buildExtractorResponse([buildFact([{
      semantic_block_id: segment.semantic_block_id,
      quote: '[C1]\n[C2-C5]\n[R1-R2,C1]',
    }])]),
    buildSource([segment]),
  );

  assert.equal(result.validation_passed, false);
  assert.ok(result.violations.some(({ code }) => code === 'quote_not_found'));
  assert.equal(result.verified_facts.length, 0);
});

test('coordinate-only quote with unknown ID produces no exact table candidates', async () => {
  const workflow = loadWorkflow();
  const segments = [1, 2, 3].map((index) => ({
    semantic_block_id: `sb_unknown_candidate_${index}`,
    scope: 'primary',
    type: 'table',
    role: 'body',
    text: `[C${index}] Реальный текст ${index}`,
  }));
  const result = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    buildExtractorResponse([buildFact([{
      semantic_block_id: 'sb_unknown_coordinate_only',
      quote: '[C1]',
    }])]),
    buildSource(segments),
  );
  const violation = result.violations.find(
    ({ code }) => code === 'unknown_semantic_block_id',
  );

  assert.ok(violation);
  assert.deepEqual(violation.details.exact_match_candidate_ids, []);
});

test('attempt 2 materializes canonical table evidence without generated coordinates', async () => {
  const workflow = loadWorkflow();
  const segment = {
    semantic_block_id: 'sb_coordinate_only_attempt_2',
    scope: 'primary',
    type: 'table',
    role: 'body',
    text: '[C1] Реальный текст ячейки',
  };
  const source = buildSource([segment]);
  const first = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    buildExtractorResponse([buildFact([{
      semantic_block_id: segment.semantic_block_id,
      quote: 'Цитаты нет',
    }])]),
    source,
  );
  const prepared = await prepareEvidenceRepair(workflow, first);
  const second = await runCodeNode(
    workflow,
    'Проверить evidence — попытка 2',
    buildRepairResponse([{
      fact_index: 0,
      violation_codes: first.violations.map(({ code }) => code),
      selected_evidence_refs: [firstCatalogRef(prepared, segment.semantic_block_id)],
    }]),
    prepared,
  );

  assert.equal(second.validation_passed, true, JSON.stringify(second.violations));
  assert.equal(second.verified_facts[0].evidence[0].quote, 'Реальный текст ячейки');
});

test('classifier never routes coordinate-only resource evidence to fact_partition', async () => {
  const workflow = loadWorkflow();
  const unit = buildResourceOverflowUnit({ analysisUnitId: 'coordinate-only-overflow' });
  unit.source.ai_segments.forEach((segment, index) => {
    segment.type = 'table';
    segment.text = `[C${index + 1}] Реальный текст ${index + 1}`;
    unit.fact.evidence[index].quote = `[C${index + 1}]`;
  });
  unit.extractorResponse = buildExtractorResponse([unit.fact], unit.analysisUnitId);
  const first = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    unit.extractorResponse,
    unit.source,
  );
  const classified = await classifyRetry(workflow, first);

  assert.equal(classified.retry_decision.route, 'hard_error');
  assert.equal(classified.retry_decision.all_partition_evidence_exact_grounded, false);
});

test('Lossless Fact Partition rejects coordinate-only replacement evidence', async () => {
  const workflow = loadWorkflow();
  const unit = buildResourceOverflowUnit({ analysisUnitId: 'coordinate-only-partition' });
  unit.source.ai_segments.forEach((segment, index) => {
    segment.type = 'table';
    segment.text = `[C${index + 1}] Реальный текст ${index + 1}`;
    unit.fact.evidence[index].quote = `[C${index + 1}]`;
  });
  unit.extractorResponse = buildExtractorResponse([unit.fact], unit.analysisUnitId);
  const original = JSON.parse(unit.extractorResponse.choices[0].message.content);
  const resourceViolation = {
    code: 'evidence_limit_exceeded',
    fact_index: 0,
    evidence_index: null,
    details: { actual: 26, maximum: 25 },
  };
  const forcedPartitionSource = {
    tender: unit.source.tender,
    document: unit.source.document,
    analysis_batch: unit.source.analysis_batch,
    analysis_unit_meta: unit.source.analysis_unit_meta,
    validation_attempt: 1,
    validation_passed: false,
    violations: [resourceViolation],
    verified_facts: [],
    evidence_context: {},
    extractor: { repair: { attempted: false, requests_count: 0 } },
    evidence_validation: {
      resource_contract: {
        max_evidence_per_fact: 25,
        max_quote_length: 1500,
        max_total_quote_chars_per_fact: 5000,
      },
    },
    repair_context: {
      original_extractor_response: original,
      source: unit.source,
    },
    retry_decision: {
      version: 'evidence_retry_router_v1',
      route: 'fact_partition',
      retry_budget: 1,
      fact_partition_fact_indexes: [0],
      all_partition_evidence_exact_grounded: true,
    },
  };
  const prepared = await runCodeNode(
    workflow,
    'Подготовить Lossless Fact Partition',
    forcedPartitionSource,
    forcedPartitionSource,
  );
  const result = await validateFactPartition(
    workflow,
    unit,
    prepared,
    buildLosslessReplacementFacts(unit.fact, [13, 13]),
  );

  assert.equal(result.validation_passed, false);
  assert.ok(result.violations.some(({ code }) => code === 'quote_not_found'));
  assert.ok(result.violations.some(({ code }) => code === 'missing_primary_evidence'));
});

test('text block preserves and exactly grounds a literal coordinate-looking quote', async () => {
  const workflow = loadWorkflow();
  const segment = {
    semantic_block_id: 'sb_text_literal_coordinate',
    scope: 'primary',
    type: 'text',
    role: 'body',
    text: 'Инструкция использует буквальную метку [C1].',
  };
  const result = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    buildExtractorResponse([buildFact([{
      semantic_block_id: segment.semantic_block_id,
      quote: '[C1]',
    }])]),
    buildSource([segment]),
  );

  assert.equal(result.validation_passed, true, JSON.stringify(result.violations));
  assert.equal(result.verified_facts[0].evidence[0].quote, '[C1]');
});

test('table grounding ignores only generated line-leading coordinates between formula and value', async () => {
  const workflow = loadWorkflow();
  const segment = {
    semantic_block_id: 'sb_table_formula',
    scope: 'primary',
    type: 'table',
    role: 'body',
    text: '[C1] Формула расчёта\n[C2-C5] 42,00',
  };
  const fact = buildFact([{
    semantic_block_id: segment.semantic_block_id,
    quote: 'Формула расчёта 42,00',
  }]);

  const result = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    buildExtractorResponse([fact]),
    buildSource([segment]),
  );

  assert.equal(result.validation_passed, true, JSON.stringify(result.violations));
});

test('table grounding remains contiguous and rejects a skipped intermediate cell', async () => {
  const workflow = loadWorkflow();
  const segment = {
    semantic_block_id: 'sb_table_contiguous',
    scope: 'primary',
    type: 'table',
    role: 'body',
    text: '[C1] Формула\n[C2] промежуточная ячейка\n[C3] 42,00',
  };
  const result = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    buildExtractorResponse([buildFact([{
      semantic_block_id: segment.semantic_block_id,
      quote: 'Формула 42,00',
    }])]),
    buildSource([segment]),
  );

  assert.equal(result.validation_passed, false);
  assert.ok(result.violations.some(({ code }) => code === 'quote_not_found'));
});

test('table grounding preserves ordinary brackets and coordinate-like text inside a line', async () => {
  const workflow = loadWorkflow();
  const cases = [
    {
      id: 'sb_table_brackets',
      text: '[C1] Формула\n[Важно] значение',
      quote: 'Формула значение',
    },
    {
      id: 'sb_table_inline_coordinate',
      text: '[C1] Формула [C2] значение',
      quote: 'Формула значение',
    },
  ];

  for (const fixtureCase of cases) {
    const segment = {
      semantic_block_id: fixtureCase.id,
      scope: 'primary',
      type: 'table',
      role: 'body',
      text: fixtureCase.text,
    };
    const result = await runCodeNode(
      workflow,
      'Проверить и привязать evidence',
      buildExtractorResponse([buildFact([{
        semantic_block_id: segment.semantic_block_id,
        quote: fixtureCase.quote,
      }])]),
      buildSource([segment]),
    );
    assert.equal(result.validation_passed, false, fixtureCase.id);
    assert.ok(result.violations.some(({ code }) => code === 'quote_not_found'));
  }
});

test('coordinate exception is unavailable to text blocks and malformed table tokens', async () => {
  const workflow = loadWorkflow();
  const cases = [
    {
      id: 'sb_text_coordinates',
      type: 'text',
      text: '[C1] Формула\n[C2] значение',
      quote: 'Формула значение',
    },
    {
      id: 'sb_table_malformed',
      type: 'table',
      text: '[C1] Формула\n[C2-5] значение',
      quote: 'Формула значение',
    },
  ];

  for (const fixtureCase of cases) {
    const segment = {
      semantic_block_id: fixtureCase.id,
      scope: 'primary',
      type: fixtureCase.type,
      role: 'body',
      text: fixtureCase.text,
    };
    const result = await runCodeNode(
      workflow,
      'Проверить и привязать evidence',
      buildExtractorResponse([buildFact([{
        semantic_block_id: segment.semantic_block_id,
        quote: fixtureCase.quote,
      }])]),
      buildSource([segment]),
    );
    assert.equal(result.validation_passed, false, fixtureCase.id);
    assert.ok(result.violations.some(({ code }) => code === 'quote_not_found'));
  }
});

test('attempt 2 applies the same exact table-coordinate grounding contract', async () => {
  const workflow = loadWorkflow();
  const segment = {
    semantic_block_id: 'sb_table_attempt_2',
    scope: 'primary',
    type: 'table',
    role: 'body',
    text: '[R1-R2,C1] Формула\n[R5-R6,C2-C3] значение',
  };
  const source = buildSource([segment]);
  const first = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    buildExtractorResponse([buildFact([{
      semantic_block_id: segment.semantic_block_id,
      quote: 'Невалидная цитата',
    }])]),
    source,
  );
  const prepared = await prepareEvidenceRepair(workflow, first);
  const second = await runCodeNode(
    workflow,
    'Проверить evidence — попытка 2',
    buildRepairResponse([{
      fact_index: 0,
      violation_codes: ['quote_not_found', 'missing_primary_evidence'],
      selected_evidence_refs: [firstCatalogRef(prepared, segment.semantic_block_id)],
    }]),
    prepared,
  );

  assert.equal(second.validation_passed, true, JSON.stringify(second.violations));
});

test('bounded retry classifier and lossless partition use the same table-coordinate grounding', async () => {
  const workflow = loadWorkflow();
  const unit = buildResourceOverflowUnit({ analysisUnitId: 'table-partition-unit' });
  unit.source.ai_segments.forEach((segment, index) => {
    const originalText = segment.text;
    segment.type = 'table';
    const [label, ordinal, ...remainder] = originalText.split(' ');
    segment.text = `[C${index + 1}] ${label} ${ordinal}\n[C${index + 2}] ${remainder.join(' ')}`;
    unit.fact.evidence[index].quote = originalText;
  });
  unit.extractorResponse = buildExtractorResponse([unit.fact], unit.analysisUnitId);

  const first = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    unit.extractorResponse,
    unit.source,
  );
  const classified = await classifyRetry(workflow, first);
  assert.equal(classified.retry_decision.route, 'fact_partition');
  assert.equal(classified.retry_decision.all_partition_evidence_exact_grounded, true);

  const prepared = await runCodeNode(
    workflow,
    'Подготовить Lossless Fact Partition',
    classified,
    classified,
  );
  const result = await validateFactPartition(
    workflow,
    unit,
    prepared,
    buildLosslessReplacementFacts(unit.fact, [13, 13]),
  );
  assert.equal(result.validation_passed, true, JSON.stringify(result.violations));
});

test('all four deterministic grounding nodes share one non-fuzzy table canonicalization contract', () => {
  const workflow = loadWorkflow();
  const nodeNames = [
    'Проверить и привязать evidence',
    'Проверить evidence — попытка 2',
    'Классифицировать bounded retry',
    'Проверить Lossless Fact Partition',
  ];

  for (const nodeName of nodeNames) {
    const code = findNode(workflow, nodeName).parameters.jsCode;
    assert.match(code, /TABLE_COORDINATE_TOKEN_AT_LINE_START/);
    assert.match(code, /segmentType === 'table'/);
    assert.match(code, /replace\(TABLE_COORDINATE_TOKEN_AT_LINE_START, ''\)/);
    assert.match(code, /function isExactGroundedEvidence\(segment, quote\)/);
    assert.match(code, /normalizedQuote\.length === 0/);
    assert.doesNotMatch(code, /levenshtein|similarity|fuzzy/i);
  }
});

test('execution 14075 preserves exact quote_not_found for РАЗРЕЩЕНИЙ versus РАЗРЕШЕНИЙ', async () => {
  const workflow = loadWorkflow();
  const fixture = loadExecution14075Fixture();

  assert.equal(fixture.source_execution_id, 14075);
  assert.equal(fixture.analysis_unit_id, 'doc_11_au_0002');
  assert.equal(fixture.problem_fact_index, 1);
  assert.equal(fixture.field_key, 'licenses_certificates');
  assert.match(fixture.source.ai_segments[0].text, /РАЗРЕЩЕНИЙ/);
  assert.doesNotMatch(fixture.source.ai_segments[0].text, /РАЗРЕШЕНИЙ/);

  const attempt1 = await runCodeNode(
    workflow,
    'Проверить и привязать evidence',
    fixture.extractor_response,
    fixture.source,
  );
  assert.equal(attempt1.validation_passed, false);
  assert.deepEqual(
    attempt1.violations.map(({ code, fact_index, evidence_index, details }) => ({
      code,
      fact_index,
      evidence_index,
      semantic_block_id: details.semantic_block_id,
    })),
    fixture.expected.attempt_1.violations,
  );

  const prepared = await prepareEvidenceRepair(workflow, attempt1);
  const exactRepairCandidate = prepared.repair_request.evidence_catalog.find(
    (candidate) => candidate.semantic_block_id ===
      (fixture.semantic_block_id ?? fixture.source.ai_segments[0].semantic_block_id) &&
      candidate.canonical_quote.includes('РАЗРЕЩЕНИЙ'),
  );
  assert.ok(exactRepairCandidate, 'Expected a structurally isolated exact РАЗРЕЩЕНИЙ candidate');
  const attempt2 = await runCodeNode(
    workflow,
    'Проверить evidence — попытка 2',
    buildRepairResponse([{
      fact_index: fixture.problem_fact_index,
      violation_codes: ['quote_not_found'],
      selected_evidence_refs: [exactRepairCandidate.evidence_ref],
    }], { analysis_unit_id: fixture.analysis_unit_id }),
    prepared,
  );
  assert.equal(attempt2.validation_passed, true, JSON.stringify(attempt2.violations));
  assert.doesNotMatch(JSON.stringify(attempt2.verified_facts), /РАЗРЕШЕНИЙ/);
  assert.match(JSON.stringify(attempt2.verified_facts), /РАЗРЕЩЕНИЙ/);
});

test('completeness barrier references the canonical upstream persistence node by exact name', () => {
  const workflow = loadWorkflow();
  const barrier = findNode(workflow, 'Собрать units после evidence validation');
  const sourceReferences = [...barrier.parameters.jsCode.matchAll(
    /\$\(['"]([^'"]+)['"]\)\.all\(\)/g,
  )].map((match) => match[1]);

  assert.deepEqual(sourceReferences, ['Сохранить analysis unit']);
  const persistence = findNode(workflow, sourceReferences[0]);
  assert.equal(persistence.type, 'n8n-nodes-base.postgres');
  assert.deepEqual(
    connectedTargets(workflow, 'Развернуть части для AI v1.2'),
    ['Сохранить analysis unit'],
  );
  assert.deepEqual(
    connectedTargets(workflow, 'Сохранить analysis unit'),
    ['Подготовить запрос для AI'],
  );
  assert.doesNotMatch(sourceReferences[0], /(?:22 item|66 item|\d$)/);
  assert.match(
    findNode(workflow, 'Собрать факты документа1').parameters.jsCode,
    /\$\('Сохранить analysis unit'\)\.all\(\)/,
  );
});

test('immutable beta Worker snapshot retains its reviewed packaging hash', () => {
  const betaHash = crypto
    .createHash('sha256')
    .update(fs.readFileSync(betaWorkflowPath))
    .digest('hex');

  assert.equal(
    betaHash,
    '02e4e5ccc761ecf78771c2ae4a3c4e529f3536533de2d9e7a5ef2084fe0459dd',
  );
});

test('production import candidate preserves beta packaging outside reviewed DW-18 and Extractor recovery nodes', () => {
  const workflow = loadWorkflow();
  const betaWorkflow = loadBetaWorkflow();
  const expectedRemovedNodes = [
    'Filter',
    'When clicking ‘Execute workflow’',
    'Проверить и привязать evidence ТЕСТОВАЯ',
    'Проверить ответ AI Validator ТЕСТОВАЯ',
    'Собрать факты документа ТЕСТОВАЯ',
    'Сохранить analysis unit 22 item1',
    'Сохранить analysis unit123',
    'режем огромную таблицу на части для теста',
    'статистика аномальных блоков',
  ].sort();
  const expectedDw18Nodes = [
    'AI Extractor fallback v1.0',
    'Вернуть DOCX binary для Docling',
    'Извлечь DOCX OOXML',
    'Подготовить DOCX archive alias',
    'Привязать parsed XML к части',
    'Прочитать DOCX XML',
    'Развернуть DOCX OOXML части',
    'Разобрать состояния DOCX ActiveX',
    'Разобрать DOCX XML',
    'Собрать DOCX parts для parser',
    'DOCX option-state extraction?',
    'OOXML часть XML?',
    'Primary Extractor accepted?',
    'Зафиксировать fallback Extractor attempt',
    'Зафиксировать primary Extractor attempt',
    'Подготовить fallback Extractor',
    'Проверить fallback и привязать evidence',
    'Проверить полноту Extractor recovery',
    'Связать fallback Extractor response с source',
    'Связать primary Extractor response с source',
  ].sort();
  const expectedChangedSharedNodes = new Set([
    'AI Extractor v1.0',
    'связать результат Docling и метаданные',
    'Нормализовать документ Docling',
    'Собрать смысловые разделы v1.4',
    'подготовить части для анализа v1.3',
    'Развернуть части для AI v1.2',
    'Подготовить Evidence Repair',
    'Проверить и привязать evidence',
    'Проверить evidence — попытка 2',
    'Классифицировать bounded retry',
    'Проверить Lossless Fact Partition',
    'Подготовить dispatch AI Validator',
    'Проверить ответ AI Validator',
    'Сформировать units without AI Validator',
    'Свести AI и units without AI',
    'Собрать факты документа1',
    'Обработать evidence units по одной',
    'Собрать units после evidence validation',
  ]);
  const expectedChangedRuntimeNodes = new Set(['AI Extractor v1.0']);
  const betaNodesByName = new Map(betaWorkflow.nodes.map((node) => [node.name, node]));
  const candidateNodesByName = new Map(workflow.nodes.map((node) => [node.name, node]));
  assert.equal(betaNodesByName.size, 60);
  assert.equal(candidateNodesByName.size, 71);
  assert.deepEqual(
    [...betaNodesByName.keys()]
      .filter((name) => !candidateNodesByName.has(name))
      .sort(),
    expectedRemovedNodes,
  );
  assert.deepEqual(
    [...candidateNodesByName.keys()]
      .filter((name) => !betaNodesByName.has(name))
      .sort(),
    expectedDw18Nodes,
  );

  for (const [name, candidateNode] of candidateNodesByName) {
    const betaNode = betaNodesByName.get(name);
    if (!betaNode) {
      assert.ok(expectedDw18Nodes.includes(name), `Unexpected candidate-only node: ${name}`);
      continue;
    }
    if (!expectedChangedSharedNodes.has(name)) {
      assert.deepEqual(candidateNode.parameters, betaNode.parameters, `${name}: parameters drift`);
    }
    else {
      assert.notDeepEqual(candidateNode.parameters, betaNode.parameters, `${name}: expected DW-18 parameters drift`);
    }
    assert.deepEqual(candidateNode.credentials ?? null, betaNode.credentials ?? null, `${name}: credentials drift`);
    assert.equal(candidateNode.type, betaNode.type, `${name}: type drift`);
    assert.equal(candidateNode.typeVersion, betaNode.typeVersion, `${name}: typeVersion drift`);
    if (!expectedChangedRuntimeNodes.has(name)) {
      assert.deepEqual(
        nodeRuntimeSettings(candidateNode),
        nodeRuntimeSettings(betaNode),
        `${name}: node settings drift`,
      );
    }
  }

  const betaEdges = workflowConnectionEdges(betaWorkflow);
  const candidateEdges = workflowConnectionEdges(workflow);
  assert.deepEqual(
    betaEdges.filter((edge) => !candidateEdges.includes(edge)),
    [
      'AI Extractor v1.0|main|0|Проверить и привязать evidence|main|0',
      'Обработать evidence units по одной|main|0|Собрать units после evidence validation|main|0',
      'Обработать evidence units по одной|main|1|Evidence validation passed?|main|0',
      'Связать метаданные и файл|main|0|определить тип файла|main|0',
      'When clicking ‘Execute workflow’|main|0|Сохранить analysis unit|main|0',
    ].sort(),
  );
  const candidateOnlyEdges = candidateEdges.filter((edge) => !betaEdges.includes(edge));
  assert.deepEqual(
    candidateOnlyEdges.filter((edge) => !expectedDw18Nodes.some(
      (nodeName) => edge.startsWith(`${nodeName}|`) || edge.includes(`|${nodeName}|`),
    )),
    [
      'When Executed by Another Workflow|main|0|Проверить вход Worker|main|0',
      'Развернуть части для AI v1.2|main|0|Сохранить analysis unit|main|0',
    ].sort(),
  );
  assert.ok(candidateOnlyEdges.length > 2, 'DW-18 graph edges must be present');

  assert.equal(Object.hasOwn(workflow, 'id'), false);
  assert.equal(Object.hasOwn(workflow, 'versionId'), false);
  assert.equal(Object.hasOwn(workflow, 'meta'), false);

  assert.equal(workflow.name, 'TENDER — Обработать документ');
  assert.equal(workflow.active, false);
  assert.equal(workflow.settings.availableInMCP, false);
  assert.deepEqual(Object.keys(workflow.pinData ?? {}), []);
  assert.deepEqual(workflow.nodeGroups ?? [], betaWorkflow.nodeGroups ?? []);
  assert.equal(
    workflow.nodes.some((node) => node.type === 'n8n-nodes-base.manualTrigger'),
    false,
  );
  assert.deepEqual(
    workflow.nodes
      .filter((node) => /Сохранить analysis unit/.test(node.name))
      .map((node) => node.name),
    ['Сохранить analysis unit'],
  );
  assert.deepEqual(
    connectedTargets(workflow, 'When Executed by Another Workflow'),
    ['Проверить вход Worker'],
  );
  assert.doesNotMatch(
    JSON.stringify(workflow),
    /Сохранить analysis unit (?:22 item|66 item)(?:\d+)?/,
  );
});

test('test helper rejects a nonexistent named source instead of masking it with wildcard data', async () => {
  const workflow = loadWorkflow();
  const mutated = structuredClone(workflow);
  const barrier = findNode(mutated, 'Собрать units после evidence validation');
  barrier.parameters.jsCode = barrier.parameters.jsCode.replace(
    /\$\(['"][^'"]+['"]\)\.all\(\)/,
    "$('Несуществующий persistence source').all()",
  );
  const savedUnits = [{
    analysis_batch: { units_total: 1 },
    analysis_unit_meta: { analysis_unit_id: 'strict-source-unit' },
  }];
  const validatedUnits = [{
    ...savedUnits[0],
    validation_passed: true,
    violations: [],
    verified_facts: [],
    deterministically_rejected_facts: [],
    evidence_validation: {
      passed: true,
      resource_metrics: { evidence_count: 0, total_quote_chars: 0 },
    },
  }];

  await assert.rejects(
    runCodeNodeItems(
      mutated,
      'Собрать units после evidence validation',
      validatedUnits,
      savedUnits,
    ),
    /Unknown workflow source node: Несуществующий persistence source/,
  );
});

test('completeness barrier accepts exactly the 16 saved and validated units from executions 14073-14074', async () => {
  const workflow = loadWorkflow();
  const savedUnits = Array.from({ length: 16 }, (_, index) => ({
    analysis_batch: { units_total: 16 },
    analysis_unit_meta: { analysis_unit_id: `doc_11_au_${String(index + 1).padStart(4, '0')}` },
  }));
  const validatedUnits = savedUnits.map((unit) => ({
    ...unit,
    validation_passed: true,
    violations: [],
    verified_facts: [],
    deterministically_rejected_facts: [],
    resolved_violations: [],
    evidence_validation: {
      passed: true,
      resource_metrics: { evidence_count: 0, total_quote_chars: 0 },
    },
  }));

  const results = await runCodeNodeItemsWithSources(
    workflow,
    'Собрать units после evidence validation',
    validatedUnits,
    { 'Сохранить analysis unit': savedUnits },
  );
  assert.equal(results.length, 16);
  assert.equal(results[0].evidence_batch_metrics.units_total, 16);

  await assert.rejects(
    runCodeNodeItemsWithSources(
      workflow,
      'Собрать units после evidence validation',
      validatedUnits.slice(0, 15),
      { 'Сохранить analysis unit': savedUnits },
    ),
    /Validated units count mismatch: 15\/16/,
  );
});

test('completeness barrier rejects a missing unit and reports request metrics', async () => {
  const workflow = loadWorkflow();
  const savedUnits = [0, 1].map((index) => ({
    analysis_batch: { units_total: 2 },
    analysis_unit_meta: { analysis_unit_id: `fixture-unit-${index}` },
  }));
  const validatedUnits = savedUnits.map((saved, index) => ({
    ...saved,
    validation_passed: true,
    violations: [],
    verified_facts: [],
    deterministically_rejected_facts: [],
    extractor: {
      repair: { requests_count: index },
      attempt_audit: {
        final_source: index === 0 ? 'primary' : 'fallback',
      },
    },
    evidence_validation: {
      passed: true,
      resource_metrics: { evidence_count: 2, total_quote_chars: 30 },
    },
  }));

  const results = await runCodeNodeItems(
    workflow,
    'Собрать units после evidence validation',
    validatedUnits,
    savedUnits,
  );
  assert.equal(results.length, 2);
  assert.deepEqual(results[0].evidence_batch_metrics, {
    units_total: 2,
    extractor_requests: 2,
    extractor_fallback_requests: 1,
    evidence_repair_requests: 1,
    fact_partition_requests: 0,
    total_retry_requests: 1,
    repair_requests: 1,
    total_ai_requests_before_ai_validator: 4,
    evidence_count: 4,
    total_quote_chars: 60,
    deterministically_rejected_facts_count: 0,
    loop_batch_size: 1,
    extractor_flow: 'batch-first primary before per-unit convergence loop',
    latency_note: 'Primary Extractor runs as a multi-item batch before Loop Over Items; only per-unit convergence and bounded fallback/evidence retries are serialized by batch=1.',
  });
  assert.deepEqual(
    results[0].extractor.evidence_batch_metrics,
    results[0].evidence_batch_metrics,
  );

  await assert.rejects(
    runCodeNodeItems(
      workflow,
      'Собрать units после evidence validation',
      validatedUnits.slice(0, 1),
      savedUnits,
    ),
    /Validated units count mismatch/,
  );
});
