import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

/*
 * Runtime design evidence (metadata-only; no issue payload is checked in):
 * - Local official n8n docs: Loop Over Items output 0 is the completed batch;
 *   feedback reaches the Loop input only after an iteration tail succeeds.
 * - Local item-linking docs: `.item`/`itemMatching()` require paired lineage;
 *   `.first()` is positional and does not resolve a paired item.
 * - n8n upstream issues #12558 and #30050 report paired lineage unavailable
 *   after `Continue (using error output)`.
 *
 * Therefore HTTP transport errors hard-stop and have no recovery output. Only
 * a regular successful HTTP result reaches a small wrapper, which immediately
 * emits an explicit source + attempt + provider_response envelope. Strict
 * primary contract failures then become typed regular-output decisions. No
 * recovery node reconstructs source through linked-item APIs.
 */

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..');
const workflowPath = path.join(
  repositoryRoot,
  'workflows',
  'n8n-exports',
  'TENDER — Обработать документ.json',
);
const recoveryFixturePath = path.join(
  testDirectory,
  'fixtures',
  'document-worker-extractor-recovery',
  'execution-14359-recovery-oracle.json',
);
const envelopeFixturePath = path.join(
  testDirectory,
  'fixtures',
  'document-worker-extractor-envelope',
  'execution-14359-response-matrix.json',
);

const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const fixture = JSON.parse(fs.readFileSync(recoveryFixturePath, 'utf8'));
const envelopeFixture = JSON.parse(fs.readFileSync(envelopeFixturePath, 'utf8'));

const NODES = {
  prepare: 'Подготовить запрос для AI',
  loop: 'Обработать evidence units по одной',
  primaryHttp: 'AI Extractor v1.0',
  primaryWrapper: 'Связать primary Extractor response с source',
  primaryValidator: 'Проверить и привязать evidence',
  primaryDecision: 'Primary Extractor accepted?',
  prepareFallback: 'Подготовить fallback Extractor',
  fallbackHttp: 'AI Extractor fallback v1.0',
  fallbackWrapper: 'Связать fallback Extractor response с source',
  fallbackValidator: 'Проверить fallback и привязать evidence',
  primaryAudit: 'Зафиксировать primary Extractor attempt',
  fallbackAudit: 'Зафиксировать fallback Extractor attempt',
  evidenceDecision: 'Evidence validation passed?',
  recoveryBarrier: 'Проверить полноту Extractor recovery',
  evidenceCollector: 'Собрать units после evidence validation',
  saveFacts: 'Сохранить факты документа',
  validatorDispatch: 'Подготовить dispatch AI Validator',
  evidenceRepairDecision: 'Evidence repair passed?',
  factPartitionDecision: 'Fact partition passed?',
  retryUnavailableStop: 'Завершить unit: retry route unavailable',
  evidenceFailedStop: 'Завершить unit: evidence validation failed',
};

const AUDIT_KEYS = [
  'version',
  'analysis_unit_id',
  'primary_model',
  'fallback_model',
  'primary_failure_class',
  'primary_failure_code',
  'attempt_count',
  'final_source',
];

function findNode(name) {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(node, `Workflow node not found: ${name}`);
  return node;
}

function outputsFrom(name, outputIndex = 0, graph = workflow) {
  return (graph.connections[name]?.main?.[outputIndex] ?? []).map(
    ({ node, index }) => ({ node, index }),
  );
}

function inboundTo(name, graph = workflow) {
  const inbound = [];
  for (const [source, connection] of Object.entries(graph.connections)) {
    for (let outputIndex = 0; outputIndex < (connection.main ?? []).length; outputIndex += 1) {
      for (const edge of connection.main[outputIndex] ?? []) {
        if (edge.node === name) inbound.push({ source, outputIndex, inputIndex: edge.index });
      }
    }
  }
  return inbound;
}

function reachableNodes(startEdges, options = {}) {
  const excludedOutput = options.excludedOutput ?? (() => false);
  const seen = new Set();
  const queue = [...startEdges.map(({ node }) => node)];
  while (queue.length > 0) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const main = workflow.connections[name]?.main ?? [];
    for (let outputIndex = 0; outputIndex < main.length; outputIndex += 1) {
      if (excludedOutput(name, outputIndex)) continue;
      for (const edge of main[outputIndex] ?? []) queue.push(edge.node);
    }
  }
  return seen;
}

function buildFact(unitId) {
  const valueText = `Sanitized exact requirement ${unitId}`;
  return {
    fact_index: 0,
    field_key: 'application_documents',
    value_text: valueText,
    status: 'found',
    confidence: 0.91,
    evidence: [{
      semantic_block_id: `sb_${unitId}`,
      quote: valueText,
      scope: 'primary',
      type: 'text',
      role: 'body',
      source_block_ids: [],
      page_from: null,
      page_to: null,
      sheet_name: null,
      sources: [],
    }],
    review_reason_code: null,
    review_note: null,
  };
}

function buildAudit(unitId, finalSource, failure = null) {
  return {
    version: 'ai_extractor_attempt_audit_v1',
    analysis_unit_id: unitId,
    primary_model: fixture.models.primary_alias,
    fallback_model: fixture.models.fallback_alias,
    primary_failure_class: failure?.failure_class ?? null,
    primary_failure_code: failure?.failure_code ?? null,
    attempt_count: finalSource === 'fallback' ? 2 : 1,
    final_source: finalSource,
  };
}

function buildFinalUnit(unitId, finalSource = 'primary', failure = null) {
  const fact = buildFact(unitId);
  return {
    tender: { tender_id: 'sanitized-tender' },
    document: { document_id: 'sanitized-document' },
    analysis_batch: { units_total: 1 },
    analysis_unit_meta: { analysis_unit_id: unitId },
    validation_attempt: 1,
    validation_passed: true,
    violations: [],
    verified_facts: [fact],
    deterministically_rejected_facts: [],
    resolved_violations: [],
    evidence_context: {},
    extractor: {
      model: finalSource === 'primary'
        ? fixture.models.primary_alias
        : fixture.models.fallback_alias,
      attempt_audit: buildAudit(unitId, finalSource, failure),
    },
    evidence_validation: {
      passed: true,
      resource_metrics: { evidence_count: 1, total_quote_chars: fact.value_text.length },
    },
  };
}

function buildSavedUnits(unitIds) {
  return unitIds.map((unitId) => ({
    json: {
      analysis_batch: { units_total: unitIds.length },
      analysis_unit_meta: { analysis_unit_id: unitId },
    },
  }));
}

async function runRecoveryBarrier(units, expectedUnitIds) {
  const node = findNode(NODES.recoveryBarrier);
  assert.notEqual(node.parameters.mode, 'runOnceForEachItem');
  const inputItems = units.map((unit) => ({
    json: {
      ...structuredClone(unit),
      analysis_batch: {
        ...(structuredClone(unit.analysis_batch) ?? {}),
        units_total: expectedUnitIds.length,
      },
    },
  }));
  const savedUnits = buildSavedUnits(expectedUnitIds);
  const context = vm.createContext({
    console,
    structuredClone,
    $input: {
      all: () => inputItems,
      first: () => inputItems[0],
      item: inputItems[0],
    },
    $: (nodeName) => {
      assert.equal(nodeName, 'Сохранить analysis unit');
      return {
        all: () => savedUnits,
        first: () => savedUnits[0],
      };
    },
  });
  const result = await new vm.Script(
    `(async () => { ${node.parameters.jsCode}\n })()`,
  ).runInContext(context);
  return JSON.parse(JSON.stringify(result));
}

async function runPrepareFallback(decisionJson) {
  const node = findNode(NODES.prepareFallback);
  assert.equal(node.parameters.mode, 'runOnceForEachItem');
  const inputItem = { json: structuredClone(decisionJson) };
  const context = vm.createContext({
    console,
    structuredClone,
    $json: inputItem.json,
    $input: {
      all: () => [inputItem],
      first: () => inputItem,
      item: inputItem,
    },
    $: () => {
      throw new Error('linked-item lookup is forbidden in fallback preparation');
    },
  });
  const result = await new vm.Script(
    `(async () => { ${node.parameters.jsCode}\n })()`,
  ).runInContext(context);
  return JSON.parse(JSON.stringify(result));
}

async function runResponseWrapper(nodeName, response, source, linkedSourceNode) {
  const node = findNode(nodeName);
  assert.equal(node.parameters.mode, 'runOnceForEachItem');
  const inputItem = { json: structuredClone(response) };
  const sourceItem = { json: structuredClone(source) };
  const context = vm.createContext({
    console,
    structuredClone,
    $json: inputItem.json,
    $input: {
      all: () => [inputItem],
      first: () => inputItem,
      item: inputItem,
    },
    $: (nodeNameLookup) => {
      assert.equal(nodeNameLookup, linkedSourceNode);
      return { item: sourceItem, itemMatching: () => sourceItem };
    },
  });
  const result = await new vm.Script(
    `(async () => { ${node.parameters.jsCode}\n })()`,
  ).runInContext(context);
  return JSON.parse(JSON.stringify(result));
}

function buildStrictSource(unitId) {
  const fact = buildFact(unitId);
  return {
    tender: { tender_id: 'sanitized-tender' },
    document: { document_id: 'sanitized-document' },
    analysis_batch: { units_total: 1 },
    analysis_unit_meta: { analysis_unit_id: unitId },
    ai_segments: [{
      semantic_block_id: `sb_${unitId}`,
      scope: 'primary',
      type: 'text',
      role: 'body',
      text: fact.value_text,
    }],
    provenance: {
      index: {
        [`sb_${unitId}`]: { scope: 'primary', source_block_ids: [], sources: [] },
      },
    },
    ai_request: {
      prompt_version: 'tender_extractor_prompt_v2',
      schema_version: 'ai_extractor_v1',
      field_catalog_version: 'tender_fields_v1',
      field_catalog: [],
      system_prompt: 'Sanitized exact system prompt',
      user_prompt: `Sanitized exact user prompt ${unitId}`,
      response_schema: { title: 'SanitizedAIExtractorV1' },
    },
  };
}

function buildProviderResponse(payload) {
  return {
    id: 'sanitized-response',
    model: 'sanitized-model',
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(payload) } }],
    usage: {},
  };
}

function buildAttemptEnvelope(source, response, attempt = 'primary') {
  const modelAlias = attempt === 'primary'
    ? fixture.models.primary_alias
    : fixture.models.fallback_alias;
  return {
    attempt_transport: {
      version: 'ai_extractor_attempt_transport_v1',
      attempt,
      analysis_unit_id: source.analysis_unit_meta.analysis_unit_id,
      model_alias: modelAlias,
      transport_status: 'succeeded',
      source: structuredClone(source),
      provider_response: structuredClone(response),
      failure_class: null,
      failure_code: null,
    },
  };
}

function buildFallbackDecision(source, failureClass, failureCode) {
  return {
    source: structuredClone(source),
    extractor_recovery_decision: {
      version: 'ai_extractor_primary_decision_v1',
      analysis_unit_id: source.analysis_unit_meta.analysis_unit_id,
      decision: 'fallback_required',
      primary_failure_class: failureClass,
      primary_failure_code: failureCode,
    },
  };
}

async function runStrictClassifier(nodeName, attemptEnvelope) {
  const node = findNode(nodeName);
  const inputItem = { json: structuredClone(attemptEnvelope) };
  const context = vm.createContext({
    console,
    structuredClone,
    $json: inputItem.json,
    $input: {
      all: () => [inputItem],
      first: () => inputItem,
      item: inputItem,
    },
    $: () => {
      throw new Error('linked-item lookup is forbidden in Extractor classification');
    },
  });
  return new vm.Script(
    `(async () => { ${node.parameters.jsCode}\n })()`,
  ).runInContext(context);
}

function semanticProjection(unit) {
  return {
    verified_facts: unit.verified_facts,
    deterministically_rejected_facts: unit.deterministically_rejected_facts,
    resolved_violations: unit.resolved_violations,
    evidence_context: unit.evidence_context,
  };
}

function assertBoundedAudit(audit, expectedSource) {
  assert.deepEqual(Object.keys(audit).sort(), [...AUDIT_KEYS].sort());
  assert.equal(audit.version, 'ai_extractor_attempt_audit_v1');
  assert.equal(audit.final_source, expectedSource);
  assert.ok(Number.isInteger(audit.attempt_count));
  assert.ok(audit.attempt_count >= 1 && audit.attempt_count <= 2);
  assert.equal(typeof audit.analysis_unit_id, 'string');
  assert.equal(typeof audit.primary_model, 'string');
  assert.equal(typeof audit.fallback_model, 'string');
  assert.equal(JSON.stringify(audit).includes('choices'), false);
  assert.equal(JSON.stringify(audit).includes('message.content'), false);
}

test('execution 14359 recovery fixture is sanitized and independently preserves the exact 16-decision oracle', () => {
  assert.equal(fixture.source_execution.execution_id, '14359');
  assert.equal(fixture.primary_decisions.length, 16);
  assert.equal(fixture.source_execution.safely_attachable_response_count, 0);
  assert.equal(fixture.source_execution.fallback_required_response_count, 16);
  assert.deepEqual(
    fixture.primary_decisions.map(({ ordinal }) => ordinal),
    Array.from({ length: 16 }, (_, index) => index + 1),
  );
  assert.deepEqual(
    fixture.primary_decisions.map(({ fact_count }) => fact_count),
    envelopeFixture.responses.map(({ fact_count }) => fact_count),
  );
  assert.deepEqual(
    fixture.primary_decisions.map(({ top_level_keys }) => top_level_keys),
    envelopeFixture.responses.map(({ top_level_keys }) => top_level_keys),
  );
  assert.ok(fixture.primary_decisions.every(({ decision }) => decision === 'fallback_required'));
  assert.ok(fixture.primary_decisions.every(({ failure_code }) => failure_code === 'invalid_field_catalog_version'));
  assert.deepEqual(fixture.sanitization, {
    contains_model_reasoning: false,
    contains_provider_content: false,
    contains_client_document_text: false,
    contains_full_execution_payload: false,
  });
  assert.equal(
    fixture.runtime_semantics_evidence.design_consequence,
    'never_recover_source_with_item_or_itemMatching_after_error_output',
  );
  assert.deepEqual(
    fixture.runtime_semantics_evidence.upstream_n8n_issues.map(({ issue }) => issue),
    [12558, 30050],
  );
  assert.deepEqual(fixture.explicit_carry_contract, {
    transport_errors: 'hard_stop',
    http_error_outputs: 0,
    regular_success_wrapper_fields: ['source', 'attempt', 'provider_response'],
    contract_failure_output: 'typed_regular_decision',
    fallback_prep_source: 'current_input_only',
    merge_nodes: 0,
  });
});

test('RED: explicit-carry graph has exact Loop feedback, no Merge, and no pre-done persistence path', () => {
  const loop = findNode(NODES.loop);
  const primaryHttp = findNode(NODES.primaryHttp);
  const primaryValidator = findNode(NODES.primaryValidator);
  const fallbackHttp = findNode(NODES.fallbackHttp);
  const fallbackValidator = findNode(NODES.fallbackValidator);
  findNode(NODES.primaryWrapper);
  findNode(NODES.fallbackWrapper);
  findNode(NODES.primaryDecision);
  findNode(NODES.recoveryBarrier);

  assert.equal(loop.type, 'n8n-nodes-base.splitInBatches');
  assert.equal(loop.typeVersion, 3);
  assert.equal(loop.parameters.batchSize ?? 1, 1);
  assert.equal(loop.parameters.options?.reset ?? false, false);
  assert.deepEqual(outputsFrom(NODES.prepare), [{ node: NODES.loop, index: 0 }]);
  assert.deepEqual(outputsFrom(NODES.loop, 1), [{ node: NODES.primaryHttp, index: 0 }]);
  assert.deepEqual(outputsFrom(NODES.loop, 0), [{ node: NODES.recoveryBarrier, index: 0 }]);

  assert.notEqual(primaryHttp.onError, 'continueErrorOutput');
  assert.notEqual(primaryValidator.onError, 'continueErrorOutput');
  assert.deepEqual(outputsFrom(NODES.primaryHttp, 0), [{ node: NODES.primaryWrapper, index: 0 }]);
  assert.deepEqual(outputsFrom(NODES.primaryHttp, 1), []);
  assert.deepEqual(outputsFrom(NODES.primaryWrapper), [{ node: NODES.primaryValidator, index: 0 }]);
  assert.deepEqual(outputsFrom(NODES.primaryValidator), [{ node: NODES.primaryDecision, index: 0 }]);
  assert.deepEqual(outputsFrom(NODES.primaryValidator, 1), []);
  assert.deepEqual(outputsFrom(NODES.primaryDecision, 0), [{ node: NODES.primaryAudit, index: 0 }]);
  assert.deepEqual(outputsFrom(NODES.primaryDecision, 1), [{ node: NODES.prepareFallback, index: 0 }]);
  assert.deepEqual(outputsFrom(NODES.prepareFallback), [{ node: NODES.fallbackHttp, index: 0 }]);
  assert.deepEqual(outputsFrom(NODES.fallbackHttp), [{ node: NODES.fallbackWrapper, index: 0 }]);
  assert.deepEqual(outputsFrom(NODES.fallbackHttp, 1), []);
  assert.deepEqual(outputsFrom(NODES.fallbackWrapper), [{ node: NODES.fallbackValidator, index: 0 }]);
  assert.deepEqual(outputsFrom(NODES.fallbackValidator), [{ node: NODES.fallbackAudit, index: 0 }]);
  assert.deepEqual(outputsFrom(NODES.primaryAudit), [{ node: NODES.evidenceDecision, index: 0 }]);
  assert.deepEqual(outputsFrom(NODES.fallbackAudit), [{ node: NODES.evidenceDecision, index: 0 }]);

  assert.notEqual(fallbackHttp.onError, 'continueErrorOutput');
  assert.notEqual(fallbackValidator.onError, 'continueErrorOutput');
  assert.deepEqual(outputsFrom(NODES.fallbackValidator, 1), []);
  assert.equal(primaryHttp.retryOnFail, false);
  assert.notEqual(fallbackHttp.retryOnFail, true);
  assert.deepEqual(inboundTo(NODES.fallbackHttp), [
    { source: NODES.prepareFallback, outputIndex: 0, inputIndex: 0 },
  ]);
  assert.deepEqual(outputsFrom(NODES.recoveryBarrier), [{ node: NODES.evidenceCollector, index: 0 }]);

  const expectedLoopInbound = [
    { source: NODES.prepare, outputIndex: 0, inputIndex: 0 },
    { source: NODES.evidenceDecision, outputIndex: 0, inputIndex: 0 },
    { source: NODES.evidenceRepairDecision, outputIndex: 0, inputIndex: 0 },
    { source: NODES.factPartitionDecision, outputIndex: 0, inputIndex: 0 },
  ].sort((left, right) => left.source.localeCompare(right.source));
  assert.deepEqual(
    inboundTo(NODES.loop).sort((left, right) => left.source.localeCompare(right.source)),
    expectedLoopInbound,
  );
  for (const tail of [
    NODES.evidenceDecision,
    NODES.evidenceRepairDecision,
    NODES.factPartitionDecision,
  ]) {
    assert.deepEqual(outputsFrom(tail, 0), [{ node: NODES.loop, index: 0 }]);
  }
  assert.equal(outputsFrom(NODES.primaryValidator).some(({ node }) => node === NODES.loop), false);
  assert.deepEqual(outputsFrom(NODES.retryUnavailableStop), []);
  assert.deepEqual(outputsFrom(NODES.evidenceFailedStop), []);

  assert.deepEqual(inboundTo(NODES.recoveryBarrier), [
    { source: NODES.loop, outputIndex: 0, inputIndex: 0 },
  ]);
  assert.deepEqual(inboundTo(NODES.evidenceCollector), [
    { source: NODES.recoveryBarrier, outputIndex: 0, inputIndex: 0 },
  ]);
  assert.deepEqual(inboundTo(NODES.validatorDispatch), [
    { source: NODES.evidenceCollector, outputIndex: 0, inputIndex: 0 },
  ]);
  const beforeDoneReachable = reachableNodes(outputsFrom(NODES.loop, 1), {
    excludedOutput: (name, outputIndex) => name === NODES.loop && outputIndex === 0,
  });
  for (const forbidden of [
    NODES.recoveryBarrier,
    NODES.evidenceCollector,
    NODES.validatorDispatch,
    NODES.saveFacts,
  ]) assert.equal(beforeDoneReachable.has(forbidden), false, `pre-done path reaches ${forbidden}`);
  assert.deepEqual(
    [...beforeDoneReachable]
      .map((name) => findNode(name))
      .filter(({ type }) => type === 'n8n-nodes-base.merge')
      .map(({ name }) => name),
    [],
  );
});

test('RED: all-primary-valid 16/16 preserves cardinality and invokes no fallback path', async () => {
  const ids = fixture.primary_decisions.map(({ analysis_unit_id }) => analysis_unit_id);
  const units = ids.map((unitId) => buildFinalUnit(unitId, 'primary'));
  const output = await runRecoveryBarrier(units, ids);

  assert.deepEqual(output.map(({ json }) => json.analysis_unit_meta.analysis_unit_id), ids);
  assert.ok(output.every(({ json }) => json.extractor.attempt_audit.attempt_count === 1));
  assert.ok(output.every(({ json }) => json.extractor.attempt_audit.final_source === 'primary'));
  assert.ok(output.every(({ json }) => json.extractor.attempt_audit.primary_failure_code === null));
});

test('RED: exact execution 14359 matrix requires exactly one fallback for each of 16 units', async () => {
  const ids = fixture.primary_decisions.map(({ analysis_unit_id }) => analysis_unit_id);
  const units = fixture.primary_decisions.map((decision) => buildFinalUnit(
    decision.analysis_unit_id,
    'fallback',
    decision,
  ));
  const output = await runRecoveryBarrier(units, ids);

  assert.equal(output.length, 16);
  assert.deepEqual(output.map(({ json }) => json.analysis_unit_meta.analysis_unit_id), ids);
  assert.ok(output.every(({ json }) => json.extractor.attempt_audit.attempt_count === 2));
  assert.ok(output.every(({ json }) => json.extractor.attempt_audit.final_source === 'fallback'));
  assert.ok(output.every(({ json }) => json.extractor.attempt_audit.primary_failure_code === 'invalid_field_catalog_version'));
});

test('RED: a mixed batch falls back only for the invalid subset and retains source order', async () => {
  const ids = ['sanitized_mixed_1', 'sanitized_mixed_2', 'sanitized_mixed_3', 'sanitized_mixed_4'];
  const units = [
    buildFinalUnit(ids[0], 'primary'),
    buildFinalUnit(ids[1], 'fallback', { failure_class: 'contract', failure_code: 'invalid_json' }),
    buildFinalUnit(ids[2], 'primary'),
    buildFinalUnit(ids[3], 'fallback', { failure_class: 'contract', failure_code: 'invalid_fact_contract' }),
  ];
  const output = await runRecoveryBarrier(units, ids);

  assert.deepEqual(output.map(({ json }) => json.analysis_unit_meta.analysis_unit_id), ids);
  assert.deepEqual(
    output.map(({ json }) => json.extractor.attempt_audit.final_source),
    ['primary', 'fallback', 'primary', 'fallback'],
  );
  assert.deepEqual(
    output.map(({ json }) => json.extractor.attempt_audit.attempt_count),
    [1, 2, 1, 2],
  );
});

test('RED: an invalid fallback response uses the same strict validator and hard-fails', async () => {
  const primaryValidator = findNode(NODES.primaryValidator);
  const fallbackValidator = findNode(NODES.fallbackValidator);
  assert.match(primaryValidator.parameters.jsCode, /evidence_validator_v2/);
  assert.match(fallbackValidator.parameters.jsCode, /evidence_validator_v2/);
  assert.notEqual(fallbackValidator.onError, 'continueErrorOutput');

  const unitId = 'sanitized_invalid_fallback';
  const source = buildStrictSource(unitId);
  const invalidEnvelope = buildAttemptEnvelope(
    source,
    buildProviderResponse({ facts: [] }),
  );
  const primaryDecision = await runStrictClassifier(NODES.primaryValidator, invalidEnvelope);
  assert.deepEqual(primaryDecision.json.extractor_recovery_decision, {
    version: 'ai_extractor_primary_decision_v1',
    analysis_unit_id: unitId,
    decision: 'fallback_required',
    primary_failure_class: 'contract',
    primary_failure_code: 'invalid_field_catalog_version',
  });
  assert.deepEqual(primaryDecision.json.source, source);
  assert.equal(JSON.stringify(primaryDecision).includes('choices'), false);
  await assert.rejects(
    runStrictClassifier(
      NODES.fallbackValidator,
      buildAttemptEnvelope(source, buildProviderResponse({ facts: [] }), 'fallback'),
    ),
    /field_catalog_version/,
  );
});

test('RED: convergence rejects missing, duplicate, unknown, cardinality, and order defects', async () => {
  findNode(NODES.recoveryBarrier);
  const ids = ['sanitized_barrier_1', 'sanitized_barrier_2', 'sanitized_barrier_3'];
  const valid = ids.map((unitId) => buildFinalUnit(unitId));

  await assert.rejects(runRecoveryBarrier(valid.slice(0, 2), ids), /count|cardinality/i);
  await assert.rejects(
    runRecoveryBarrier([valid[0], valid[0], valid[2]], ids),
    /duplicate/i,
  );
  await assert.rejects(
    runRecoveryBarrier([valid[0], buildFinalUnit('sanitized_unknown'), valid[2]], ids),
    /unknown|unit set|identity/i,
  );
  await assert.rejects(
    runRecoveryBarrier([valid[1], valid[0], valid[2]], ids),
    /order/i,
  );
  const missingId = structuredClone(valid);
  delete missingId[1].analysis_unit_meta.analysis_unit_id;
  await assert.rejects(runRecoveryBarrier(missingId, ids), /missing.*analysis_unit_id/i);
});

test('RED: successful primary response is explicitly carried and fallback prep rejects missing source', async () => {
  assert.deepEqual(outputsFrom(NODES.primaryHttp, 1), []);
  const primaryHttp = findNode(NODES.primaryHttp);
  assert.notEqual(primaryHttp.onError, 'continueErrorOutput');
  const id = 'sanitized_explicit_source';
  const source = buildStrictSource(id);
  const response = buildProviderResponse({ facts: [] });
  const wrapped = await runResponseWrapper(
    NODES.primaryWrapper,
    response,
    source,
    NODES.prepare,
  );
  assert.deepEqual(wrapped.json, buildAttemptEnvelope(source, response));

  const decision = await runStrictClassifier(NODES.primaryValidator, wrapped.json);
  assert.equal(decision.json.extractor_recovery_decision.decision, 'fallback_required');
  assert.deepEqual(decision.json.source, source);
  const fallbackNode = findNode(NODES.prepareFallback);
  assert.doesNotMatch(fallbackNode.parameters.jsCode, /\.item(?:Matching)?\b/);
  await assert.rejects(
    runPrepareFallback({
      extractor_recovery_decision: decision.json.extractor_recovery_decision,
    }),
    /explicit source|source.*missing|source.*required/i,
  );
  const prepared = await runPrepareFallback(decision.json);
  assert.deepEqual(prepared.json.ai_request, source.ai_request);
  assert.deepEqual(prepared.json.extractor_recovery, {
    version: 'ai_extractor_recovery_context_v1',
    analysis_unit_id: id,
    primary_model: fixture.models.primary_alias,
    fallback_model: fixture.models.fallback_alias,
    primary_failure_class: 'contract',
    primary_failure_code: 'invalid_field_catalog_version',
    next_attempt: 2,
  });
  assert.deepEqual(prepared.json.source, source);
  assert.equal(JSON.stringify(prepared).includes('choices'), false);

  const unit = buildFinalUnit(id, 'fallback', {
    failure_class: 'contract',
    failure_code: 'invalid_field_catalog_version',
  });
  const [output] = await runRecoveryBarrier([unit], [id]);
  assert.deepEqual(output.json.extractor.attempt_audit, buildAudit(id, 'fallback', {
    failure_class: 'contract',
    failure_code: 'invalid_field_catalog_version',
  }));
});

test('RED: safe deterministic envelope attachment remains primary and cannot enter fallback', async () => {
  findNode(NODES.primaryAudit);
  const unitId = 'sanitized_safe_attachment';
  const source = buildStrictSource(unitId);
  const strictFact = buildFact(unitId);
  delete strictFact.fact_index;
  strictFact.evidence = strictFact.evidence.map(({ semantic_block_id, quote }) => ({
    semantic_block_id,
    quote,
  }));
  const output = await runStrictClassifier(
    NODES.primaryValidator,
    buildAttemptEnvelope(source, buildProviderResponse({
      field_catalog_version: 'tender_fields_v1',
      analysis_unit_id: unitId,
      facts: [strictFact],
    })),
  );

  assert.equal(output.json.extractor_recovery_decision.decision, 'accepted');
  assert.equal(output.json.validated_unit.validation_passed, true);
  assert.deepEqual(
    output.json.validated_unit.extractor.envelope_attachment.repair_reasons,
    ['missing_schema_version'],
  );
  assert.deepEqual(outputsFrom(NODES.primaryValidator), [{ node: NODES.primaryDecision, index: 0 }]);
  assert.deepEqual(outputsFrom(NODES.primaryDecision, 0), [{ node: NODES.primaryAudit, index: 0 }]);
  assert.equal(outputsFrom(NODES.primaryAudit).some(({ node }) => node === NODES.prepareFallback), false);
});

test('RED: fallback request is the approved alias on the same provider and audit never mutates facts or evidence', async () => {
  const primaryHttp = findNode(NODES.primaryHttp);
  const fallbackHttp = findNode(NODES.fallbackHttp);
  assert.equal(fallbackHttp.parameters.url, primaryHttp.parameters.url);
  assert.deepEqual(fallbackHttp.credentials, primaryHttp.credentials);
  assert.match(fallbackHttp.parameters.jsonBody, /google\/gemini-3\.7-flash@provider=google-ai-studio\/flex&reasoning_effort=low/);
  assert.match(fallbackHttp.parameters.jsonBody, /\$json\.ai_request\.system_prompt/);
  assert.match(fallbackHttp.parameters.jsonBody, /\$json\.ai_request\.user_prompt/);
  assert.match(fallbackHttp.parameters.jsonBody, /response_format\s*:\s*\{\s*type\s*:\s*['"]json_object['"]/s);
  assert.match(fallbackHttp.parameters.jsonBody, /max_tokens\s*:\s*16384/);

  const id = 'sanitized_audit_projection';
  const source = buildStrictSource(id);
  const strictFact = buildFact(id);
  delete strictFact.fact_index;
  strictFact.evidence = strictFact.evidence.map(({ semantic_block_id, quote }) => ({
    semantic_block_id,
    quote,
  }));
  const fallbackResponse = buildProviderResponse({
    schema_version: 'ai_extractor_v1',
    field_catalog_version: 'tender_fields_v1',
    analysis_unit_id: id,
    facts: [strictFact],
  });
  const wrappedFallback = await runResponseWrapper(
    NODES.fallbackWrapper,
    fallbackResponse,
    { source, ai_request: source.ai_request },
    NODES.prepareFallback,
  );
  assert.deepEqual(
    wrappedFallback.json,
    buildAttemptEnvelope(source, fallbackResponse, 'fallback'),
  );
  const strictFallback = await runStrictClassifier(
    NODES.fallbackValidator,
    wrappedFallback.json,
  );
  assert.equal(strictFallback.json.validation_passed, true);
  assert.equal(strictFallback.json.analysis_unit_meta.analysis_unit_id, id);

  const unit = buildFinalUnit(id, 'fallback', {
    failure_class: 'contract',
    failure_code: 'invalid_evidence_contract',
  });
  const before = structuredClone(semanticProjection(unit));
  const [output] = await runRecoveryBarrier([unit], [id]);
  assert.deepEqual(semanticProjection(output.json), before);
  assertBoundedAudit(output.json.extractor.attempt_audit, 'fallback');
  assert.equal(JSON.stringify(output.json.verified_facts).includes('attempt_audit'), false);
  assert.equal(JSON.stringify(output.json.evidence_context).includes('attempt_audit'), false);

  const extraAuditField = structuredClone(unit);
  extraAuditField.extractor.attempt_audit.provider_content = 'must be rejected';
  await assert.rejects(
    runRecoveryBarrier([extraAuditField], [id]),
    /audit.*field|audit.*key|bounded audit/i,
  );
  const excessiveAttempts = structuredClone(unit);
  excessiveAttempts.extractor.attempt_audit.attempt_count = 3;
  await assert.rejects(
    runRecoveryBarrier([excessiveAttempts], [id]),
    /attempt_count|attempt count/i,
  );
});
