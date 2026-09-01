import assert from 'node:assert/strict';
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
  primaryValidator: 'Проверить и привязать evidence',
  prepareFallback: 'Подготовить fallback Extractor',
  fallbackHttp: 'AI Extractor fallback v1.0',
  fallbackValidator: 'Проверить fallback и привязать evidence',
  primaryAudit: 'Зафиксировать primary Extractor attempt',
  fallbackAudit: 'Зафиксировать fallback Extractor attempt',
  evidenceDecision: 'Evidence validation passed?',
  recoveryBarrier: 'Проверить полноту Extractor recovery',
  evidenceCollector: 'Собрать units после evidence validation',
  saveFacts: 'Сохранить факты документа',
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

function outputsFrom(name, outputIndex = 0) {
  return (workflow.connections[name]?.main?.[outputIndex] ?? []).map(
    ({ node, index }) => ({ node, index }),
  );
}

function inboundTo(name) {
  const inbound = [];
  for (const [source, connection] of Object.entries(workflow.connections)) {
    for (let outputIndex = 0; outputIndex < (connection.main ?? []).length; outputIndex += 1) {
      for (const edge of connection.main[outputIndex] ?? []) {
        if (edge.node === name) inbound.push({ source, outputIndex, inputIndex: edge.index });
      }
    }
  }
  return inbound;
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

async function runPrepareFallback(errorJson, source) {
  const node = findNode(NODES.prepareFallback);
  assert.equal(node.parameters.mode, 'runOnceForEachItem');
  const inputItem = { json: structuredClone(errorJson) };
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
    $: (nodeName) => {
      assert.equal(nodeName, NODES.loop);
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

async function runStrictValidator(nodeName, response, source) {
  const node = findNode(nodeName);
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
      assert.equal(nodeNameLookup, NODES.prepare);
      return {
        all: () => [sourceItem],
        first: () => sourceItem,
        itemMatching: () => sourceItem,
        item: sourceItem,
      };
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
});

test('RED: graph serializes one primary plus at most one fallback and converges only on Loop done', () => {
  const loop = findNode(NODES.loop);
  const primaryHttp = findNode(NODES.primaryHttp);
  const primaryValidator = findNode(NODES.primaryValidator);
  const fallbackHttp = findNode(NODES.fallbackHttp);
  const fallbackValidator = findNode(NODES.fallbackValidator);

  assert.equal(loop.type, 'n8n-nodes-base.splitInBatches');
  assert.equal(loop.typeVersion, 3);
  assert.equal(loop.parameters.batchSize ?? 1, 1);
  assert.equal(loop.parameters.options?.reset ?? false, false);
  assert.deepEqual(outputsFrom(NODES.prepare), [{ node: NODES.loop, index: 0 }]);
  assert.deepEqual(outputsFrom(NODES.loop, 1), [{ node: NODES.primaryHttp, index: 0 }]);
  assert.deepEqual(outputsFrom(NODES.loop, 0), [{ node: NODES.recoveryBarrier, index: 0 }]);

  assert.equal(primaryHttp.onError, 'continueErrorOutput');
  assert.equal(primaryValidator.onError, 'continueErrorOutput');
  assert.deepEqual(outputsFrom(NODES.primaryHttp, 0), [{ node: NODES.primaryValidator, index: 0 }]);
  assert.deepEqual(outputsFrom(NODES.primaryHttp, 1), [{ node: NODES.prepareFallback, index: 0 }]);
  assert.deepEqual(outputsFrom(NODES.primaryValidator, 0), [{ node: NODES.primaryAudit, index: 0 }]);
  assert.deepEqual(outputsFrom(NODES.primaryValidator, 1), [{ node: NODES.prepareFallback, index: 0 }]);
  assert.deepEqual(outputsFrom(NODES.prepareFallback), [{ node: NODES.fallbackHttp, index: 0 }]);
  assert.deepEqual(outputsFrom(NODES.fallbackHttp), [{ node: NODES.fallbackValidator, index: 0 }]);
  assert.deepEqual(outputsFrom(NODES.fallbackValidator), [{ node: NODES.fallbackAudit, index: 0 }]);
  assert.deepEqual(outputsFrom(NODES.primaryAudit), [{ node: NODES.evidenceDecision, index: 0 }]);
  assert.deepEqual(outputsFrom(NODES.fallbackAudit), [{ node: NODES.evidenceDecision, index: 0 }]);

  assert.notEqual(fallbackHttp.onError, 'continueErrorOutput');
  assert.notEqual(fallbackValidator.onError, 'continueErrorOutput');
  assert.deepEqual(outputsFrom(NODES.fallbackHttp, 1), []);
  assert.deepEqual(outputsFrom(NODES.fallbackValidator, 1), []);
  assert.equal(primaryHttp.retryOnFail, false);
  assert.notEqual(fallbackHttp.retryOnFail, true);
  assert.deepEqual(inboundTo(NODES.fallbackHttp), [
    { source: NODES.prepareFallback, outputIndex: 0, inputIndex: 0 },
  ]);
  assert.deepEqual(inboundTo(NODES.recoveryBarrier), [
    { source: NODES.loop, outputIndex: 0, inputIndex: 0 },
  ]);
  assert.deepEqual(outputsFrom(NODES.recoveryBarrier), [{ node: NODES.evidenceCollector, index: 0 }]);
  assert.equal(inboundTo(NODES.saveFacts).some(({ source }) => source === NODES.recoveryBarrier), false);
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
  assert.equal(fallbackValidator.parameters.jsCode, primaryValidator.parameters.jsCode);
  assert.notEqual(fallbackValidator.onError, 'continueErrorOutput');

  const unitId = 'sanitized_invalid_fallback';
  const source = buildStrictSource(unitId);
  await assert.rejects(
    runStrictValidator(NODES.fallbackValidator, buildProviderResponse({ facts: [] }), source),
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

test('RED: primary transport errors route once to fallback with bounded transport audit', async () => {
  assert.deepEqual(outputsFrom(NODES.primaryHttp, 1), [{ node: NODES.prepareFallback, index: 0 }]);
  const id = 'sanitized_transport_failure';
  const source = buildStrictSource(id);
  const rawTransportMessage = 'sanitized provider body must not enter audit';
  const prepared = await runPrepareFallback({ error: { message: rawTransportMessage } }, source);
  assert.deepEqual(prepared.json.ai_request, source.ai_request);
  assert.deepEqual(prepared.json.extractor_recovery, {
    version: 'ai_extractor_recovery_context_v1',
    analysis_unit_id: id,
    primary_model: fixture.models.primary_alias,
    fallback_model: fixture.models.fallback_alias,
    primary_failure_class: 'transport',
    primary_failure_code: 'primary_transport_error',
    next_attempt: 2,
  });
  assert.equal(JSON.stringify(prepared).includes(rawTransportMessage), false);

  const unit = buildFinalUnit(id, 'fallback', {
    failure_class: 'transport',
    failure_code: 'primary_transport_error',
  });
  const [output] = await runRecoveryBarrier([unit], [id]);
  assert.deepEqual(output.json.extractor.attempt_audit, buildAudit(id, 'fallback', {
    failure_class: 'transport',
    failure_code: 'primary_transport_error',
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
  const output = await runStrictValidator(NODES.primaryValidator, buildProviderResponse({
    field_catalog_version: 'tender_fields_v1',
    analysis_unit_id: unitId,
    facts: [strictFact],
  }), source);

  assert.equal(output.json.validation_passed, true);
  assert.deepEqual(
    output.json.extractor.envelope_attachment.repair_reasons,
    ['missing_schema_version'],
  );
  assert.deepEqual(outputsFrom(NODES.primaryValidator, 0), [{ node: NODES.primaryAudit, index: 0 }]);
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
