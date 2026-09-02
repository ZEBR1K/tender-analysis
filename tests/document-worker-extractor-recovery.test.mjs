import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { injectExactlyOneFallbackEnvelope } from './helpers/document-worker-canary-fallback-injector.mjs';

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
const batchingFixturePath = path.join(
  testDirectory,
  'fixtures',
  'document-worker-extractor-recovery',
  'execution-14365-http-batching-shape.json',
);
const fallbackInjectorFixturePath = path.join(
  testDirectory,
  'fixtures',
  'document-worker-extractor-recovery',
  'exactly-one-fallback-injector.json',
);

const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const fixture = JSON.parse(fs.readFileSync(recoveryFixturePath, 'utf8'));
const envelopeFixture = JSON.parse(fs.readFileSync(envelopeFixturePath, 'utf8'));
const batchingFixture = JSON.parse(fs.readFileSync(batchingFixturePath, 'utf8'));
const fallbackInjectorFixture = JSON.parse(
  fs.readFileSync(fallbackInjectorFixturePath, 'utf8'),
);

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

function assertExactHardStop(name, { requireRetryDisabled = true } = {}) {
  const node = findNode(name);
  assert.ok(
    node.onError === undefined || node.onError === 'stopWorkflow',
    `${name}: onError must be absent or stopWorkflow`,
  );
  assert.notEqual(node.onError, 'continueRegularOutput');
  assert.notEqual(node.onError, 'continueErrorOutput');
  if (requireRetryDisabled) assert.equal(node.retryOnFail, false, `${name}: retryOnFail`);
  assert.deepEqual(outputsFrom(name, 1), [], `${name}: error output must be disconnected`);
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

async function runFallbackAudit(unitJson) {
  const node = findNode(NODES.fallbackAudit);
  const inputItem = { json: structuredClone(unitJson) };
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
      throw new Error('fallback audit must consume only current-input recovery_context');
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

async function runPrimaryBatchWrappers(responses, sources, pairedSourceIndexes) {
  assert.equal(responses.length, sources.length);
  assert.equal(pairedSourceIndexes.length, responses.length);
  return Promise.all(responses.map(async (response, index) => {
    const inputItem = {
      json: structuredClone(response),
      pairedItem: { item: pairedSourceIndexes[index] },
    };
    const sourceItems = sources.map((source) => ({ json: structuredClone(source) }));
    const node = findNode(NODES.primaryWrapper);
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
        assert.equal(nodeNameLookup, NODES.prepare);
        const pairedIndex = inputItem.pairedItem.item;
        return {
          item: sourceItems[pairedIndex],
          itemMatching: (requestedIndex) => sourceItems[requestedIndex],
        };
      },
    });
    const result = await new vm.Script(
      `(async () => { ${node.parameters.jsCode}\n })()`,
    ).runInContext(context);
    return JSON.parse(JSON.stringify(result));
  }));
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

function buildProviderTextResponse(content) {
  return {
    id: 'sanitized-response',
    model: 'sanitized-model',
    choices: [{ finish_reason: 'stop', message: { content } }],
    usage: {},
  };
}

function buildStrictProviderFact(unitId) {
  const fact = buildFact(unitId);
  delete fact.fact_index;
  fact.evidence = fact.evidence.map(({ semantic_block_id, quote }) => ({
    semantic_block_id,
    quote,
  }));
  return fact;
}

function buildStrictProviderPayload(unitId) {
  return {
    schema_version: 'ai_extractor_v1',
    field_catalog_version: 'tender_fields_v1',
    analysis_unit_id: unitId,
    facts: [buildStrictProviderFact(unitId)],
  };
}

function buildModelContractDefectCorpus(unitId) {
  const valid = buildStrictProviderPayload(unitId);
  const conflictingIdentity = structuredClone(valid);
  conflictingIdentity.analysis_unit_id = `${unitId}_other`;
  const missingCatalog = structuredClone(valid);
  delete missingCatalog.field_catalog_version;
  const wrongSchema = structuredClone(valid);
  wrongSchema.schema_version = 'ai_extractor_v2';
  const invalidRoot = structuredClone(valid);
  invalidRoot.schema = invalidRoot.schema_version;
  delete invalidRoot.schema_version;
  const invalidFact = structuredClone(valid);
  invalidFact.facts = [{ field: 'application_documents', value: 'wrong contract' }];
  const invalidEvidence = structuredClone(valid);
  delete invalidEvidence.facts[0].evidence[0].quote;
  return [
    { axis: 'json', code: 'invalid_json', response: buildProviderTextResponse('{') },
    { axis: 'root', code: 'invalid_root_contract', response: buildProviderResponse(invalidRoot) },
    { axis: 'identity', code: 'conflicting_analysis_unit_id', response: buildProviderResponse(conflictingIdentity) },
    { axis: 'catalog', code: 'invalid_field_catalog_version', response: buildProviderResponse(missingCatalog) },
    { axis: 'schema', code: 'invalid_schema_version', response: buildProviderResponse(wrongSchema) },
    { axis: 'fact', code: 'invalid_fact_contract', response: buildProviderResponse(invalidFact) },
    { axis: 'evidence', code: 'invalid_evidence_contract', response: buildProviderResponse(invalidEvidence) },
  ];
}

function buildRecoveryContext(source, failureCode = 'invalid_json') {
  return {
    version: 'ai_extractor_recovery_context_v1',
    analysis_unit_id: source.analysis_unit_meta.analysis_unit_id,
    primary_model: fixture.models.primary_alias,
    fallback_model: fixture.models.fallback_alias,
    primary_failure_class: 'contract',
    primary_failure_code: failureCode,
    next_attempt: 2,
  };
}

function buildAttemptEnvelope(source, response, attempt = 'primary', recoveryContext = null) {
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
      ...(attempt === 'fallback'
        ? { recovery_context: structuredClone(recoveryContext ?? buildRecoveryContext(source)) }
        : {}),
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
  const result = await new vm.Script(
    `(async () => { ${node.parameters.jsCode}\n })()`,
  ).runInContext(context);
  return JSON.parse(JSON.stringify(result));
}

function extractSharedValidationBody(nodeName) {
  const code = findNode(nodeName).parameters.jsCode;
  const contract = fixture.shared_validation_contract;
  const startIndex = code.indexOf(contract.source_start_marker);
  const endIndex = code.indexOf(contract.source_end_marker);
  assert.ok(startIndex >= 0, `${nodeName}: shared validator start marker missing`);
  assert.ok(endIndex > startIndex, `${nodeName}: shared validator end marker missing`);
  const body = code.slice(
    startIndex + contract.source_start_marker.length,
    endIndex,
  );
  assert.match(body, new RegExp(contract.version));
  return body;
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
    http_retry_on_fail: false,
    regular_success_wrapper_fields: ['source', 'attempt', 'provider_response'],
    contract_failure_output: 'typed_regular_decision',
    fallback_prep_source: 'current_input_only',
    merge_nodes: 0,
  });
  assert.deepEqual(fixture.primary_decision_contract, {
    version: 'ai_extractor_primary_decision_v1',
    accepted: 'accepted',
    fallback_required: 'fallback_required',
    fallback_failure_class: 'contract',
    fallback_failure_codes: [
      'invalid_json',
      'invalid_root_contract',
      'conflicting_analysis_unit_id',
      'invalid_field_catalog_version',
      'invalid_schema_version',
      'invalid_fact_contract',
      'invalid_evidence_contract',
    ],
    unknown_decision_or_failure_code: 'hard_stop',
  });
  assert.deepEqual(fixture.shared_validation_contract, {
    version: 'ai_extractor_strict_validator_v3',
    source_start_marker: '/* AI_EXTRACTOR_STRICT_VALIDATOR_SHARED_START */',
    source_end_marker: '/* AI_EXTRACTOR_STRICT_VALIDATOR_SHARED_END */',
    primary_and_fallback_body: 'byte_identical',
  });
});

test('RED: primary/fallback HTTP and recovery internals have exact hard-stop settings', () => {
  for (const httpNode of [NODES.primaryHttp, NODES.fallbackHttp]) {
    assert.equal(findNode(httpNode).type, 'n8n-nodes-base.httpRequest');
    assertExactHardStop(httpNode);
  }
  for (const internalNode of [
    NODES.primaryWrapper,
    NODES.primaryValidator,
    NODES.prepareFallback,
    NODES.fallbackWrapper,
    NODES.fallbackValidator,
    NODES.primaryAudit,
    NODES.fallbackAudit,
    NODES.recoveryBarrier,
  ]) assertExactHardStop(internalNode);
});

test('execution 14365 batching fixture is sanitized and records the pre-provider hard-stop', () => {
  assert.equal(batchingFixture.fixture_schema_version, 'execution_14365_http_batching_shape_v1');
  assert.deepEqual(batchingFixture.provenance, {
    source_kind: 'isolated_test_execution_run_data_and_installed_node_type_definition',
    execution_id: '14365',
    failed_node: NODES.primaryHttp,
    runtime_error: "Cannot read properties of undefined (reading 'batchInterval')",
    node_type: 'n8n-nodes-base.httpRequest',
    node_type_version: 4.4,
  });
  assert.deepEqual(batchingFixture.sanitization, {
    contains_provider_request_or_response: false,
    contains_model_reasoning: false,
    contains_client_document_text: false,
    contains_full_execution_payload: false,
    contains_credentials_or_secrets: false,
  });
  assert.deepEqual(batchingFixture.runtime_outcome, {
    paid_ai_calls: 0,
    forbidden_node_run_count: 0,
    forbidden_node_names: [
      NODES.fallbackHttp,
      'AI Evidence Repair v1',
      'AI Lossless Fact Partition v1',
      NODES.evidenceCollector,
      'AI Validator v1',
      'Захватить документ в обработку',
      'Сохранить analysis unit',
      NODES.saveFacts,
      'Завершить обработку документа',
      'Проверить готовность к агрегации',
      "Call 'TENDER — Агрегация закупки'",
    ],
  });
  for (const nodeName of batchingFixture.runtime_outcome.forbidden_node_names) {
    assert.ok(workflow.nodes.some(({ name }) => name === nodeName), `Unknown forbidden node: ${nodeName}`);
  }
});

test('RED: execution 14365 requires nested batching for every affected Extractor HTTP node', () => {
  assert.deepEqual(batchingFixture.batching_contract, {
    affected_node_names: [NODES.primaryHttp],
    required_options: {
      batching: {
        batch: {
          batchSize: 16,
          batchInterval: 1000,
        },
      },
      timeout: 180000,
    },
    flat_batching_keys_forbidden: true,
  });

  const extractorHttpNodes = workflow.nodes.filter(
    (node) => node.type === 'n8n-nodes-base.httpRequest' && /^AI Extractor/.test(node.name),
  );
  const affectedNodes = extractorHttpNodes.filter(
    (node) => Object.hasOwn(node.parameters.options ?? {}, 'batching'),
  );
  assert.deepEqual(
    affectedNodes.map(({ name }) => name),
    batchingFixture.batching_contract.affected_node_names,
  );

  for (const node of affectedNodes) {
    assert.equal(node.type, batchingFixture.provenance.node_type);
    assert.equal(node.typeVersion, batchingFixture.provenance.node_type_version);
    assert.deepEqual(
      {
        batching: node.parameters.options.batching,
        timeout: node.parameters.options.timeout,
      },
      batchingFixture.batching_contract.required_options,
      `${node.name}: installed HTTP Request v4.4 requires options.batching.batch`,
    );
    assert.equal(Object.hasOwn(node.parameters.options.batching, 'batchSize'), false);
    assert.equal(Object.hasOwn(node.parameters.options.batching, 'batchInterval'), false);
  }
});

test('RED: Primary Extractor accepted IF has one strict accepted-only condition', () => {
  const primaryDecision = findNode(NODES.primaryDecision);
  assert.equal(primaryDecision.type, 'n8n-nodes-base.if');
  assert.equal(primaryDecision.typeVersion, 2.2);
  assert.deepEqual(primaryDecision.parameters.conditions.options, {
    caseSensitive: true,
    leftValue: '',
    typeValidation: 'strict',
    version: 3,
  });
  assert.deepEqual(primaryDecision.parameters.options, {});
  assert.equal(primaryDecision.parameters.conditions.combinator, 'and');
  assert.equal(primaryDecision.parameters.conditions.conditions.length, 1);
  const [acceptedCondition] = primaryDecision.parameters.conditions.conditions;
  assert.equal(
    acceptedCondition.leftValue,
    "={{ $json.extractor_recovery_decision.decision === 'accepted' }}",
  );
  assert.equal(acceptedCondition.rightValue, '');
  assert.deepEqual(acceptedCondition.operator, {
    type: 'boolean',
    operation: 'true',
    singleValue: true,
  });
  assert.deepEqual(outputsFrom(NODES.primaryDecision, 0), [{ node: NODES.primaryAudit, index: 0 }]);
  assert.deepEqual(outputsFrom(NODES.primaryDecision, 1), [{ node: NODES.prepareFallback, index: 0 }]);
});

test('RED: batch-first primary graph has exact Loop feedback, completion barrier, and no pre-done persistence path', () => {
  const loop = findNode(NODES.loop);
  findNode(NODES.primaryHttp);
  findNode(NODES.primaryValidator);
  findNode(NODES.fallbackHttp);
  findNode(NODES.fallbackValidator);
  findNode(NODES.primaryWrapper);
  findNode(NODES.fallbackWrapper);
  findNode(NODES.primaryDecision);
  findNode(NODES.recoveryBarrier);

  assert.equal(loop.type, 'n8n-nodes-base.splitInBatches');
  assert.equal(loop.typeVersion, 3);
  assert.equal(loop.parameters.batchSize ?? 1, 1);
  assert.equal(loop.parameters.options?.reset ?? false, false);
  assert.deepEqual(outputsFrom(NODES.prepare), [{ node: NODES.primaryHttp, index: 0 }]);
  assert.deepEqual(outputsFrom(NODES.loop, 1), [{ node: NODES.primaryDecision, index: 0 }]);
  assert.deepEqual(outputsFrom(NODES.loop, 0), [{ node: NODES.recoveryBarrier, index: 0 }]);

  assert.deepEqual(outputsFrom(NODES.primaryHttp, 0), [{ node: NODES.primaryWrapper, index: 0 }]);
  assert.deepEqual(outputsFrom(NODES.primaryHttp, 1), []);
  assert.deepEqual(outputsFrom(NODES.primaryWrapper), [{ node: NODES.primaryValidator, index: 0 }]);
  assert.deepEqual(outputsFrom(NODES.primaryValidator), [{ node: NODES.loop, index: 0 }]);
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

  assert.deepEqual(inboundTo(NODES.fallbackHttp), [
    { source: NODES.prepareFallback, outputIndex: 0, inputIndex: 0 },
  ]);
  assert.deepEqual(outputsFrom(NODES.recoveryBarrier), [{ node: NODES.evidenceCollector, index: 0 }]);

  const expectedLoopInbound = [
    { source: NODES.primaryValidator, outputIndex: 0, inputIndex: 0 },
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
  assert.deepEqual(outputsFrom(NODES.primaryValidator), [{ node: NODES.loop, index: 0 }]);
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
  assert.equal(
    beforeDoneReachable.has(NODES.primaryHttp),
    false,
    'Primary HTTP must be unreachable from the serialized Loop body',
  );
  assert.deepEqual(
    [...beforeDoneReachable]
      .map((name) => findNode(name))
      .filter(({ type }) => type === 'n8n-nodes-base.merge')
      .map(({ name }) => name),
    [],
  );
});

test('RED: 16 primary responses retain exact paired source identity, order, and cardinality', async () => {
  const ids = fixture.primary_decisions.map(({ analysis_unit_id }) => analysis_unit_id);
  const sources = ids.map((unitId) => buildStrictSource(unitId));
  const pairedSourceIndexes = [5, 0, 15, 2, 11, 7, 1, 14, 4, 9, 3, 13, 6, 12, 8, 10];
  const expectedLinkedIds = pairedSourceIndexes.map((sourceIndex) => ids[sourceIndex]);
  assert.notDeepEqual(pairedSourceIndexes, Array.from({ length: 16 }, (_, index) => index));
  const responses = expectedLinkedIds.map((unitId, index) => ({
    ...buildProviderResponse(buildStrictProviderPayload(unitId)),
    id: `sanitized-response-${index + 1}`,
  }));
  const wrapped = await runPrimaryBatchWrappers(
    responses,
    sources,
    pairedSourceIndexes,
  );

  assert.equal(wrapped.length, 16);
  assert.deepEqual(
    wrapped.map(({ json }) => json.attempt_transport.analysis_unit_id),
    expectedLinkedIds,
  );
  assert.deepEqual(
    wrapped.map(({ json }) => json.attempt_transport.source.analysis_unit_meta.analysis_unit_id),
    expectedLinkedIds,
  );
  assert.deepEqual(
    wrapped.map(({ json }) => json.attempt_transport.provider_response.id),
    responses.map(({ id }) => id),
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
  const primaryResponses = ids.map((unitId) => buildProviderResponse(buildStrictProviderPayload(unitId)));
  primaryResponses[1] = buildProviderTextResponse('{');
  primaryResponses[3] = buildProviderResponse({
    ...buildStrictProviderPayload(ids[3]),
    field_catalog_version: 'unexpected_catalog',
  });
  const decisions = await Promise.all(ids.map((unitId, index) => runStrictClassifier(
    NODES.primaryValidator,
    buildAttemptEnvelope(buildStrictSource(unitId), primaryResponses[index]),
  )));
  assert.deepEqual(
    decisions.map(({ json }) => json.extractor_recovery_decision.decision),
    ['accepted', 'fallback_required', 'accepted', 'fallback_required'],
  );
  assert.deepEqual(
    decisions.flatMap(({ json }, index) => (
      json.extractor_recovery_decision.decision === 'fallback_required' ? [ids[index]] : []
    )),
    [ids[1], ids[3]],
  );
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

test('RED: one unit can enter at most one fallback and the barrier rejects a third attempt', async () => {
  assert.deepEqual(inboundTo(NODES.prepareFallback), [
    { source: NODES.primaryDecision, outputIndex: 1, inputIndex: 0 },
  ]);
  const unitId = 'sanitized_unbounded_fallback';
  const unbounded = buildFinalUnit(unitId, 'fallback', {
    failure_class: 'contract',
    failure_code: 'invalid_json',
  });
  unbounded.extractor.attempt_audit.attempt_count = 3;
  await assert.rejects(
    runRecoveryBarrier([unbounded], [unitId]),
    /attempt_count|attempt audit/i,
  );
});

test('RED: primary transport failure hard-stops before Loop done and cannot partially persist', () => {
  assertExactHardStop(NODES.primaryHttp);
  assert.deepEqual(outputsFrom(NODES.primaryHttp, 1), []);
  assert.deepEqual(inboundTo(NODES.recoveryBarrier), [
    { source: NODES.loop, outputIndex: 0, inputIndex: 0 },
  ]);
  const errorReachable = reachableNodes(outputsFrom(NODES.primaryHttp, 1));
  for (const forbidden of [
    NODES.loop,
    NODES.recoveryBarrier,
    NODES.evidenceCollector,
    NODES.validatorDispatch,
    NODES.saveFacts,
  ]) assert.equal(errorReachable.has(forbidden), false);
});

test('RED: temporary canary injector mutates exactly the first validated wrapper and canonical validation forces one fallback', async () => {
  const ids = [
    'sanitized_injector_unit_alpha',
    'sanitized_injector_unit_beta',
    'sanitized_injector_unit_gamma',
    'sanitized_injector_unit_delta',
  ];
  const postMaterializationItems = ids.map((analysisUnitId) => ({
    json: { analysis_unit_meta: { analysis_unit_id: analysisUnitId } },
  }));
  const wrappedItems = ids.map((analysisUnitId, index) => {
    const source = buildStrictSource(analysisUnitId);
    return {
      json: buildAttemptEnvelope(
        source,
        buildProviderResponse(buildStrictProviderPayload(analysisUnitId)),
      ),
      pairedItem: { item: index },
    };
  });
  const originalSnapshots = structuredClone(wrappedItems);
  const replacementProviderResponse = buildProviderResponse(
    fallbackInjectorFixture.replacement_provider_payload,
  );

  const cost = fallbackInjectorFixture.cost_bound;
  assert.equal(
    (cost.max_source_units * cost.primary_calls_per_source_unit)
      + cost.forced_fallback_calls
      + cost.max_mutually_exclusive_evidence_retry_calls,
    cost.max_total_paid_calls,
  );
  assert.equal(cost.max_total_paid_calls, 33);
  assert.deepEqual(fallbackInjectorFixture.future_canary_unreachable_nodes, [
    NODES.validatorDispatch,
    NODES.saveFacts,
    "Call 'TENDER — Агрегация закупки'",
  ]);

  const injected = injectExactlyOneFallbackEnvelope({
    wrappedItems,
    postMaterializationItems,
    replacementProviderResponse,
  });
  const mutationIndexes = injected.flatMap((item, index) => (
    JSON.stringify(item.json.attempt_transport.provider_response)
      === JSON.stringify(originalSnapshots[index].json.attempt_transport.provider_response)
      ? []
      : [index]
  ));
  assert.deepEqual(
    mutationIndexes,
    [0],
    'the absent temporary injector must be RED until exactly one wrapper is mutated',
  );

  const expectedTarget = structuredClone(originalSnapshots[0]);
  expectedTarget.json.attempt_transport.provider_response = replacementProviderResponse;
  assert.deepEqual(injected[0], expectedTarget);
  assert.equal(
    injected[0].json.attempt_transport.analysis_unit_id,
    postMaterializationItems[0].json.analysis_unit_meta.analysis_unit_id,
  );
  assert.deepEqual(
    injected[0].json.attempt_transport.source,
    originalSnapshots[0].json.attempt_transport.source,
  );
  for (let index = 1; index < wrappedItems.length; index += 1) {
    assert.strictEqual(injected[index], wrappedItems[index], `non-target ${index} identity`);
    assert.equal(JSON.stringify(injected[index]), JSON.stringify(originalSnapshots[index]));
  }

  const forcedDecision = await runStrictClassifier(NODES.primaryValidator, injected[0].json);
  assert.equal(
    forcedDecision.json.extractor_recovery_decision.decision,
    fallbackInjectorFixture.expected_primary_decision,
  );
  assert.equal(
    forcedDecision.json.extractor_recovery_decision.primary_failure_class,
    fallbackInjectorFixture.expected_primary_failure_class,
  );
  assert.equal(
    forcedDecision.json.extractor_recovery_decision.primary_failure_code,
    fallbackInjectorFixture.expected_primary_failure_code,
  );
  for (const control of injected.slice(1)) {
    const decision = await runStrictClassifier(NODES.primaryValidator, control.json);
    assert.equal(decision.json.extractor_recovery_decision.decision, 'accepted');
  }

  assert.throws(() => injectExactlyOneFallbackEnvelope({
    wrappedItems,
    postMaterializationItems: [],
    replacementProviderResponse,
  }), /target|empty|item/i);
  assert.throws(() => injectExactlyOneFallbackEnvelope({
    wrappedItems,
    postMaterializationItems: [{ json: { analysis_unit_meta: {} } }],
    replacementProviderResponse,
  }), /missing analysis_unit_id/i);
  assert.throws(() => injectExactlyOneFallbackEnvelope({
    wrappedItems,
    postMaterializationItems: [
      postMaterializationItems[0],
      postMaterializationItems[0],
    ],
    replacementProviderResponse,
  }), /duplicate analysis_unit_id/i);
  assert.throws(() => injectExactlyOneFallbackEnvelope({
    wrappedItems: [wrappedItems[1], wrappedItems[0], ...wrappedItems.slice(2)],
    postMaterializationItems,
    replacementProviderResponse,
  }), /order|identity|analysis_unit_id/i);
  assert.throws(() => injectExactlyOneFallbackEnvelope({
    wrappedItems: wrappedItems.slice(1),
    postMaterializationItems,
    replacementProviderResponse,
  }), /cardinality|target/i);
});

test('RED: primary and fallback share one strict validator body and defect corpus', async () => {
  assert.equal(
    extractSharedValidationBody(NODES.primaryValidator),
    extractSharedValidationBody(NODES.fallbackValidator),
  );
  const unitId = 'sanitized_validator_parity';
  const source = buildStrictSource(unitId);
  const corpus = buildModelContractDefectCorpus(unitId);
  assert.deepEqual(
    corpus.map(({ code }) => code),
    fixture.primary_decision_contract.fallback_failure_codes,
  );

  for (const defect of corpus) {
    const primary = await runStrictClassifier(
      NODES.primaryValidator,
      buildAttemptEnvelope(source, defect.response),
    );
    assert.deepEqual(primary.json.extractor_recovery_decision, {
      version: fixture.primary_decision_contract.version,
      analysis_unit_id: unitId,
      decision: fixture.primary_decision_contract.fallback_required,
      primary_failure_class: fixture.primary_decision_contract.fallback_failure_class,
      primary_failure_code: defect.code,
    }, defect.axis);
    assert.deepEqual(primary.json.source, source, defect.axis);
    assert.equal(JSON.stringify(primary).includes('choices'), false, defect.axis);
    await assert.rejects(
      runStrictClassifier(
        NODES.fallbackValidator,
        buildAttemptEnvelope(source, defect.response, 'fallback'),
      ),
      undefined,
      defect.axis,
    );
  }

  const validResponse = buildProviderResponse(buildStrictProviderPayload(unitId));
  const accepted = await runStrictClassifier(
    NODES.primaryValidator,
    buildAttemptEnvelope(source, validResponse),
  );
  assert.equal(accepted.json.extractor_recovery_decision.decision, 'accepted');
  const fallbackValidated = await runStrictClassifier(
    NODES.fallbackValidator,
    buildAttemptEnvelope(source, validResponse, 'fallback'),
  );
  assert.deepEqual(
    semanticProjection(accepted.json.validated_unit),
    semanticProjection(fallbackValidated.json),
  );
});

test('RED: unknown decisions/codes and malformed explicit envelopes hard-stop before fallback HTTP', async () => {
  findNode(NODES.prepareFallback);
  findNode(NODES.fallbackHttp);
  const unitId = 'sanitized_hard_stop_contract';
  const source = buildStrictSource(unitId);
  const decision = buildFallbackDecision(source, 'contract', 'unknown_model_failure');
  await assert.rejects(runPrepareFallback(decision), /failure.*code|allow|unknown/i);

  const unknownDecision = structuredClone(decision);
  unknownDecision.extractor_recovery_decision.decision = 'retry_anyway';
  unknownDecision.extractor_recovery_decision.primary_failure_code = 'invalid_json';
  await assert.rejects(runPrepareFallback(unknownDecision), /decision|fallback_required/i);

  const internalFailure = buildFallbackDecision(source, 'internal', 'invalid_json');
  await assert.rejects(runPrepareFallback(internalFailure), /failure.*class|contract/i);

  const validResponse = buildProviderResponse(buildStrictProviderPayload(unitId));
  const primaryMissingSource = buildAttemptEnvelope(source, validResponse);
  delete primaryMissingSource.attempt_transport.source;
  const primaryWrongAttempt = buildAttemptEnvelope(source, validResponse);
  primaryWrongAttempt.attempt_transport.attempt = 'fallback';
  for (const malformed of [{}, primaryMissingSource, primaryWrongAttempt]) {
    await assert.rejects(runStrictClassifier(NODES.primaryValidator, malformed));
  }
  const fallbackMissingSource = buildAttemptEnvelope(source, validResponse, 'fallback');
  delete fallbackMissingSource.attempt_transport.source;
  const fallbackWrongAttempt = buildAttemptEnvelope(source, validResponse, 'fallback');
  fallbackWrongAttempt.attempt_transport.attempt = 'primary';
  const fallbackUnboundedContext = buildAttemptEnvelope(source, validResponse, 'fallback');
  fallbackUnboundedContext.attempt_transport.recovery_context.provider_content = 'forbidden';
  for (const malformed of [
    {},
    fallbackMissingSource,
    fallbackWrongAttempt,
    fallbackUnboundedContext,
  ]) {
    await assert.rejects(runStrictClassifier(NODES.fallbackValidator, malformed));
  }
  assert.deepEqual(outputsFrom(NODES.prepareFallback), [{ node: NODES.fallbackHttp, index: 0 }]);
  assert.deepEqual(outputsFrom(NODES.fallbackHttp, 1), []);
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
  assert.deepEqual(outputsFrom(NODES.primaryValidator), [{ node: NODES.loop, index: 0 }]);
  assert.deepEqual(outputsFrom(NODES.loop, 1), [{ node: NODES.primaryDecision, index: 0 }]);
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
  const fallbackRecovery = buildRecoveryContext(source, 'invalid_evidence_contract');
  const wrappedFallback = await runResponseWrapper(
    NODES.fallbackWrapper,
    fallbackResponse,
    { source, ai_request: source.ai_request, extractor_recovery: fallbackRecovery },
    NODES.prepareFallback,
  );
  assert.deepEqual(
    wrappedFallback.json,
    buildAttemptEnvelope(source, fallbackResponse, 'fallback', fallbackRecovery),
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

test('RED: fallback audit consumes bounded current-input recovery_context and removes it after materialization', async () => {
  const node = findNode(NODES.fallbackAudit);
  assert.doesNotMatch(node.parameters.jsCode, /\$\(/);
  assert.match(node.parameters.jsCode, /recovery_context/);

  const id = 'sanitized_current_input_audit';
  const unit = buildFinalUnit(id, 'fallback', {
    failure_class: 'contract',
    failure_code: 'invalid_evidence_contract',
  });
  delete unit.extractor.attempt_audit;
  unit.extractor.recovery_context = {
    version: 'ai_extractor_recovery_context_v1',
    analysis_unit_id: id,
    primary_model: fixture.models.primary_alias,
    fallback_model: fixture.models.fallback_alias,
    primary_failure_class: 'contract',
    primary_failure_code: 'invalid_evidence_contract',
    next_attempt: 2,
  };
  const before = structuredClone(semanticProjection(unit));
  const output = await runFallbackAudit(unit);
  assert.deepEqual(semanticProjection(output.json), before);
  assertBoundedAudit(output.json.extractor.attempt_audit, 'fallback');
  assert.equal('recovery_context' in output.json.extractor, false);

  const unbounded = structuredClone(unit);
  unbounded.extractor.recovery_context.provider_content = 'forbidden';
  await assert.rejects(runFallbackAudit(unbounded), /allow-list|recovery_context/i);
});
