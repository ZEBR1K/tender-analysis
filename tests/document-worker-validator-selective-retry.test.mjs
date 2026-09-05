import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..');
const workflowPath = path.join(
  repositoryRoot,
  'workflows',
  'n8n-exports',
  'TENDER — Обработать документ.json',
);
const fixturePath = path.join(
  testDirectory,
  'fixtures',
  'document-worker-validator-execution-14491-sanitized.json',
);

const NODES = {
  expand: 'Развернуть units для AI Validator',
  primaryHttp: 'AI Validator v1',
  classifyPrimary: 'Классифицировать primary AI Validator',
  hasRetry: 'Есть contract-invalid Validator facts?',
  expandRetry: 'Развернуть Validator retry queue',
  loop: 'Обработать Validator retry facts по одной',
  retry2Http: 'AI Validator retry attempt 2',
  classifyRetry2: 'Классифицировать Validator retry attempt 2',
  retry2Accepted: 'Validator retry attempt 2 accepted?',
  waitRetry3: 'Wait before Validator retry attempt 3',
  retry3Http: 'AI Validator retry attempt 3',
  classifyRetry3: 'Классифицировать Validator retry attempt 3',
  retry3Accepted: 'Validator retry attempt 3 accepted?',
  fallback: 'Сформировать Validator technical fallback',
  assembleRetry: 'Собрать ответы AI Validator после retry',
  assembleNoRetry: 'Собрать ответы AI Validator без retry',
  strictChecker: 'Проверить ответ AI Validator',
  converge: 'Свести AI и units without AI',
  collect: 'Собрать факты документа1',
};

const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

test('persistable structural identities are versioned, NUL-free, collision-safe, and group-local', () => {
  const normalizer = workflow.nodes.find(
    (candidate) => candidate.name === 'Нормализовать документ Docling',
  );
  assert.ok(normalizer, 'Workflow node not found: Нормализовать документ Docling');

  const code = normalizer.parameters.jsCode;
  assert.doesNotMatch(code, /\.join\(['"]\\u0000['"]\)/u);
  assert.match(code, /'v2i:'\s*\+\s*JSON\.stringify\(\[/u);
  assert.match(
    code,
    /'v2q:'\s*\+\s*JSON\.stringify\(\[/u,
  );

  const encode = (parts) => `v2i:${JSON.stringify(parts)}`;
  assert.notEqual(encode(['a\u0000b', 'c']), encode(['a', 'b\u0000c']));
  assert.equal(JSON.stringify({ identity: encode(['a\u0000b', 'c']) }).includes('\u0000'), false);

  const groupA = `v2g:${JSON.stringify(['owner', 'table', 'option_button', 'group-a'])}`;
  const groupB = `v2g:${JSON.stringify(['owner', 'table', 'option_button', 'group-b'])}`;
  assert.notEqual(groupA, groupB, 'group-local applicability must retain the discriminator');
});

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

async function runCodeNode(name, inputItems, sources = {}) {
  const code = findNode(name).parameters.jsCode;
  const clonedInputs = structuredClone(inputItems);
  const clonedSources = Object.fromEntries(
    Object.entries(sources).map(([sourceName, sourceItems]) => [
      sourceName,
      structuredClone(sourceItems),
    ]),
  );
  const context = vm.createContext({
    console,
    structuredClone,
    $json: clonedInputs[0]?.json,
    $input: {
      all: () => clonedInputs,
      first: () => clonedInputs[0],
      item: clonedInputs[0],
    },
    $: (sourceName) => {
      const items = clonedSources[sourceName];
      if (!items) throw new Error(`Unknown source node: ${sourceName}`);
      return {
        all: () => items,
        first: () => items[0],
        itemMatching: (index) => items[index],
        item: items[0],
      };
    },
  });
  const output = await new vm.Script(`(async () => { ${code}\n })()`).runInContext(context);
  return structuredClone(Array.isArray(output) ? output : [output]);
}

function buildFact(unitId, factIndex, fieldKey) {
  const exactText = `Sanitized exact requirement ${unitId}#${factIndex}`;
  return {
    fact_index: factIndex,
    field_key: fieldKey,
    value_text: exactText,
    status: 'found',
    confidence: 0.91,
    review_reason_code: null,
    review_note: null,
    evidence: [{
      semantic_block_id: `sb_${unitId}_${factIndex}`,
      quote: exactText,
      scope: 'primary',
      type: 'text',
      role: 'body',
    }],
  };
}

function buildUnits() {
  return fixture.unit_ids.map((unitId) => {
    const facts = unitId === fixture.target_identity.analysis_unit_id
      ? [
          buildFact(unitId, 0, fixture.preserved_sibling_identity.field_key),
          buildFact(unitId, 1, fixture.target_identity.field_key),
        ]
      : [buildFact(unitId, 0, 'application_documents')];
    return {
      tender: { tender_id: 'sanitized-tender' },
      document: { document_id: 'sanitized-document' },
      analysis_batch: { units_total: fixture.recorded_counts.primary_source_items },
      analysis_unit_meta: { analysis_unit_id: unitId },
      validation_passed: true,
      violations: [],
      resolved_violations: [],
      verified_facts: facts,
      deterministically_rejected_facts: [],
      evidence_context: Object.fromEntries(facts.map((fact) => [
        fact.evidence[0].semantic_block_id,
        {
          semantic_block_id: fact.evidence[0].semantic_block_id,
          scope: 'primary',
          type: 'text',
          role: 'body',
          text: fact.evidence[0].quote,
        },
      ])),
      evidence_validation: { passed: true, version: 'evidence_validator_v2' },
    };
  });
}

function dispatchEnvelope(units) {
  return {
    dispatch_version: 'ai_validator_dispatch_v1',
    expected_units_total: units.length,
    expected_analysis_unit_ids: units.map(
      (unit) => unit.analysis_unit_meta.analysis_unit_id,
    ),
    units_for_ai: units,
    units_without_ai: [],
  };
}

function validationFor(fact, overrides = {}) {
  return {
    fact_index: fact.fact_index,
    field_key: fact.field_key,
    verdict: 'confirmed',
    confidence: 0.97,
    reason_code: null,
    reason_note: null,
    ...overrides,
  };
}

function providerResponse(source, validations, suffix = 'primary') {
  return {
    id: `sanitized-${suffix}-${source.analysis_unit_meta.analysis_unit_id}`,
    model: 'sanitized-validator-model',
    provider: 'sanitized-provider',
    choices: [{
      finish_reason: 'stop',
      message: {
        content: JSON.stringify({
          schema_version: 'ai_validator_v1',
          analysis_unit_id: source.analysis_unit_meta.analysis_unit_id,
          validations,
        }),
      },
    }],
    usage: {},
  };
}

function emptySystemRetryAudit() {
  return {
    version: 'ai_validator_selective_retry_v1',
    max_total_attempts: 3,
    facts: [],
  };
}

function providerOwnedRetryAudit(source, validation) {
  return {
    version: 'provider-owned-retry-audit-v0',
    max_total_attempts: 999,
    facts: [{
      analysis_unit_id: source.analysis_unit_meta.analysis_unit_id,
      fact_index: validation.fact_index,
      field_key: validation.field_key,
      validator_meta: {
        origin: 'ai_validator_retry',
        version: 'ai_validator_selective_retry_v1',
        confidence_origin: 'model',
        reported_ai_confidence: validation.confidence,
        contract_validated: true,
        retry_exhausted: false,
        attempt_count: 2,
        final_failure_code: null,
        analysis_unit_id: source.analysis_unit_meta.analysis_unit_id,
        fact_index: validation.fact_index,
        field_key: validation.field_key,
      },
      attempt_audit: [
        { attempt: 1, forged_by: 'provider' },
        { attempt: 2, forged_by: 'provider' },
      ],
    }],
  };
}

function explicitSourceEnvelope(expectedSource) {
  return {
    version: 'ai_validator_source_envelope_v1',
    source_identity: {
      analysis_unit_id: expectedSource.analysis_unit_meta.analysis_unit_id,
      facts: expectedSource.verified_facts.map(({ fact_index, field_key }) => ({
        fact_index,
        field_key,
      })),
    },
    source: expectedSource,
  };
}

function assertExplicitSourceEnvelope(providerItem, expectedSource) {
  assert.equal(providerItem.pairedItem, undefined);
  assert.deepEqual(
    providerItem.json.validator_source_envelope,
    explicitSourceEnvelope(expectedSource),
  );
}

async function buildExecutionBoundary({ providerAuditUnitId = null } = {}) {
  const units = buildUnits();
  const dispatch = dispatchEnvelope(units);
  const sourceItems = await runCodeNode(NODES.expand, [{ json: dispatch }]);
  const primaryItems = sourceItems.map((item, sourceIndex) => {
    const source = item.json;
    const validations = source.verified_facts.map((fact) => validationFor(fact));
    if (source.analysis_unit_meta.analysis_unit_id === fixture.target_identity.analysis_unit_id) {
      delete validations.find(
        ({ fact_index: factIndex }) => factIndex === fixture.target_identity.fact_index,
      ).confidence;
    }
    const response = providerResponse(source, validations);
    if (source.analysis_unit_meta.analysis_unit_id === providerAuditUnitId) {
      response.validator_retry_audit = providerOwnedRetryAudit(source, validations[0]);
    }
    return {
      json: response,
      pairedItem: { item: sourceIndex },
    };
  });
  const [classified] = await runCodeNode(
    NODES.classifyPrimary,
    primaryItems,
    { [NODES.expand]: sourceItems },
  );
  return { units, dispatch, sourceItems, primaryItems, classified };
}

test('execution 14491 fixture keeps the observed 22-item one-fact malformed boundary', () => {
  assert.equal(fixture.source_execution_id, 14491);
  assert.equal(fixture.runtime_replay, false);
  assert.equal(fixture.unit_ids.length, 22);
  assert.deepEqual(fixture.recorded_counts, {
    primary_source_items: 22,
    primary_response_items: 22,
    target_source_facts: 2,
    contract_invalid_facts: 1,
  });
  assert.deepEqual(fixture.target_identity, {
    analysis_unit_id: 'doc_7_au_0037',
    fact_index: 1,
    field_key: 'licenses_certificates',
    observed_failure_code: 'invalid_confidence',
  });
});

test('primary Validator stays outside a finite fact-only retry loop with three explicit total attempts', () => {
  const primary = findNode(NODES.primaryHttp);
  const loop = findNode(NODES.loop);
  const retry2 = findNode(NODES.retry2Http);
  const retry3 = findNode(NODES.retry3Http);
  assert.equal(primary.retryOnFail, false);
  assert.equal(primary.onError, 'continueRegularOutput');
  assert.equal(retry2.retryOnFail, false);
  assert.equal(retry3.retryOnFail, false);
  assert.equal(retry2.onError, 'continueRegularOutput');
  assert.equal(retry3.onError, 'continueRegularOutput');
  assert.equal(loop.type, 'n8n-nodes-base.splitInBatches');
  assert.equal(loop.parameters.batchSize, 1);
  assert.notEqual(loop.parameters.options?.reset, true);
  assert.deepEqual(outputsFrom(NODES.primaryHttp), [{ node: NODES.classifyPrimary, index: 0 }]);
  assert.deepEqual(outputsFrom(NODES.loop, 1), [{ node: NODES.retry2Http, index: 0 }]);
  assert.deepEqual(outputsFrom(NODES.loop, 0), [{ node: NODES.assembleRetry, index: 0 }]);
  assert.ok(!inboundTo(NODES.primaryHttp).some(({ source }) => source === NODES.loop));
  assert.deepEqual(outputsFrom(NODES.retry2Accepted, 0), [{ node: NODES.loop, index: 0 }]);
  assert.deepEqual(outputsFrom(NODES.retry3Accepted, 0), [{ node: NODES.loop, index: 0 }]);
  assert.deepEqual(outputsFrom(NODES.fallback), [{ node: NODES.loop, index: 0 }]);
});

test('execution 14491 classification retries only doc_7_au_0037#1 and preserves its valid sibling', async () => {
  const { sourceItems, primaryItems, classified } = await buildExecutionBoundary();
  assert.equal(classified.json.source_count, 22);
  assert.equal(classified.json.retry_queue.length, 1);
  assert.deepEqual(classified.json.retry_queue[0].identity, {
    analysis_unit_id: fixture.target_identity.analysis_unit_id,
    fact_index: fixture.target_identity.fact_index,
    field_key: fixture.target_identity.field_key,
  });
  assert.equal(classified.json.retry_queue[0].attempt_audit.length, 1);
  assert.equal(classified.json.retry_queue[0].attempt_audit[0].failure_code, 'invalid_confidence');

  const targetSourceIndex = sourceItems.findIndex(
    ({ json }) => json.analysis_unit_meta.analysis_unit_id === fixture.target_identity.analysis_unit_id,
  );
  const targetPrimary = JSON.parse(
    primaryItems[targetSourceIndex].json.choices[0].message.content,
  );
  const sibling = targetPrimary.validations.find(
    ({ fact_index: factIndex }) => factIndex === fixture.preserved_sibling_identity.fact_index,
  );
  const targetState = classified.json.units.find(
    ({ analysis_unit_id: unitId }) => unitId === fixture.target_identity.analysis_unit_id,
  );
  assert.deepEqual(targetState.accepted_validations, [sibling]);
  assert.deepEqual(targetState.retry_fact_indexes, [fixture.target_identity.fact_index]);
});

test('all-valid primary responses use the explicit source envelope through no-retry assembly and strict checking', async () => {
  const units = buildUnits();
  const sourceItems = await runCodeNode(NODES.expand, [{ json: dispatchEnvelope(units) }]);
  const poisonedSourceIndex = 0;
  const primaryItems = sourceItems.map((item, sourceIndex) => {
    const validations = item.json.verified_facts.map((fact) => validationFor(fact));
    const response = providerResponse(
      item.json,
      validations,
      'all-valid',
    );
    if (sourceIndex === poisonedSourceIndex) {
      response.validator_retry_audit = providerOwnedRetryAudit(item.json, validations[0]);
    }
    return { json: response, pairedItem: { item: sourceIndex } };
  });
  const [classified] = await runCodeNode(
    NODES.classifyPrimary,
    primaryItems,
    { [NODES.expand]: sourceItems },
  );
  assert.equal(classified.json.retry_queue.length, 0);

  const assembled = await runCodeNode(NODES.assembleNoRetry, [classified]);
  assert.equal(assembled.length, sourceItems.length);
  for (let index = 0; index < assembled.length; index += 1) {
    assertExplicitSourceEnvelope(assembled[index], sourceItems[index].json);
  }

  const checked = await runCodeNode(NODES.strictChecker, assembled);
  assert.equal(checked.length, sourceItems.length);
  assert.deepEqual(
    {
      assembledAudit: assembled[poisonedSourceIndex].json.validator_retry_audit,
      persistedRetry: checked[poisonedSourceIndex].json.validated_facts[0]
        .validator_meta.validator_retry,
    },
    {
      assembledAudit: emptySystemRetryAudit(),
      persistedRetry: undefined,
    },
  );
});

test('valid attempt 2 reassembles all 22 units and strips provider audit from its non-retried units', async () => {
  const providerAuditUnitId = fixture.unit_ids.find(
    (unitId) => unitId !== fixture.target_identity.analysis_unit_id,
  );
  const boundary = await buildExecutionBoundary({ providerAuditUnitId });
  const retryItems = await runCodeNode(NODES.expandRetry, [boundary.classified]);
  assert.equal(retryItems.length, 1);
  assert.equal(retryItems[0].json.verified_facts.length, 1);
  assert.deepEqual(retryItems[0].json.validator_field_keys, [fixture.target_identity.field_key]);
  assert.deepEqual(retryItems[0].json.validator_prompt_context.field_keys, [fixture.target_identity.field_key]);
  assert.ok(retryItems[0].json.validator_prompt_context.field_profiles_text.includes(
    `FIELD PROFILE: ${fixture.target_identity.field_key}`,
  ));
  assert.ok(!retryItems[0].json.validator_prompt_context.field_profiles_text.includes(
    `FIELD PROFILE: ${fixture.preserved_sibling_identity.field_key}`,
  ));

  const retrySource = retryItems[0].json;
  const acceptedValidation = validationFor(retrySource.verified_facts[0], { confidence: 0.88 });
  const [retryResult] = await runCodeNode(
    NODES.classifyRetry2,
    [{ json: providerResponse(retrySource, [acceptedValidation], 'attempt-2') }],
    { [NODES.loop]: [retryItems[0]] },
  );
  assert.equal(retryResult.json.validator_retry_result.accepted, true);
  assert.equal(retryResult.json.validator_retry_result.attempt_count, 2);

  const assembled = await runCodeNode(
    NODES.assembleRetry,
    [retryResult],
    { [NODES.classifyPrimary]: [boundary.classified] },
  );
  assert.equal(assembled.length, 22);
  const targetAssembled = assembled.find(
    ({ json }) => JSON.parse(json.choices[0].message.content).analysis_unit_id === fixture.target_identity.analysis_unit_id,
  );
  const parsedTarget = JSON.parse(targetAssembled.json.choices[0].message.content);
  assert.deepEqual(parsedTarget.validations.map(({ fact_index: factIndex }) => factIndex), [0, 1]);
  assert.equal(parsedTarget.validations[1].confidence, 0.88);
  const targetSource = boundary.sourceItems.find(
    ({ json }) => json.analysis_unit_meta.analysis_unit_id === fixture.target_identity.analysis_unit_id,
  ).json;
  assertExplicitSourceEnvelope(targetAssembled, targetSource);
  const nonRetriedAssembled = assembled.find(
    ({ json }) => json.validator_source_envelope.source_identity.analysis_unit_id === providerAuditUnitId,
  );

  const checked = await runCodeNode(NODES.strictChecker, assembled);
  assert.equal(checked.length, 22);
  const targetChecked = checked.find(
    ({ json }) => json.analysis_unit_meta.analysis_unit_id === fixture.target_identity.analysis_unit_id,
  );
  assert.equal(targetChecked.json.validated_facts[0].validator_meta.validator_retry, undefined);
  assert.equal(targetChecked.json.validated_facts[1].validator_meta.validator_retry.attempt_count, 2);
  assert.equal(targetChecked.json.validated_facts[1].validator_meta.validator_retry.contract_validated, true);
  const nonRetriedChecked = checked.find(
    ({ json }) => json.analysis_unit_meta.analysis_unit_id === providerAuditUnitId,
  );
  assert.deepEqual(
    {
      assembledAudit: nonRetriedAssembled.json.validator_retry_audit,
      persistedRetry: nonRetriedChecked.json.validated_facts[0].validator_meta.validator_retry,
    },
    {
      assembledAudit: emptySystemRetryAudit(),
      persistedRetry: undefined,
    },
  );
});

test('strict checker rejects foreign validator retry audit version, attempt bound, and shape', async () => {
  const [sourceItem] = await runCodeNode(
    NODES.expand,
    [{ json: dispatchEnvelope([buildUnits()[0]]) }],
  );
  const source = sourceItem.json;
  const validation = validationFor(source.verified_facts[0]);
  const baseAudit = providerOwnedRetryAudit(source, validation);
  const cases = [
    {
      audit: baseAudit,
      expected: /validator_retry_audit\.version/u,
    },
    {
      audit: {
        ...baseAudit,
        version: 'ai_validator_selective_retry_v1',
      },
      expected: /validator_retry_audit\.max_total_attempts/u,
    },
    {
      audit: {
        ...emptySystemRetryAudit(),
        provider_owned: true,
      },
      expected: /validator_retry_audit.*недопустимое поле "provider_owned"/u,
    },
  ];
  for (const { audit, expected } of cases) {
    await assert.rejects(
      runCodeNode(NODES.strictChecker, [{
        json: {
          ...providerResponse(source, [validation], 'foreign-audit'),
          validator_source_envelope: explicitSourceEnvelope(source),
          validator_retry_audit: audit,
        },
      }]),
      expected,
    );
  }
});

test('attempt 3 exhaustion becomes audited requires_review and reaches document fact collection', async () => {
  const boundary = await buildExecutionBoundary();
  const [retryItem] = await runCodeNode(NODES.expandRetry, [boundary.classified]);
  const invalidResponse = providerResponse(
    retryItem.json,
    [validationFor(retryItem.json.verified_facts[0])],
    'invalid',
  );
  const invalidContent = JSON.parse(invalidResponse.choices[0].message.content);
  delete invalidContent.validations[0].confidence;
  invalidResponse.choices[0].message.content = JSON.stringify(invalidContent);

  const [afterAttempt2] = await runCodeNode(
    NODES.classifyRetry2,
    [{ json: invalidResponse }],
    { [NODES.loop]: [retryItem] },
  );
  assert.equal(afterAttempt2.json.validator_retry_result.accepted, false);
  assert.equal(afterAttempt2.json.validator_retry_result.attempt_count, 2);

  const [afterAttempt3] = await runCodeNode(
    NODES.classifyRetry3,
    [{ json: invalidResponse }],
    { [NODES.waitRetry3]: [afterAttempt2] },
  );
  assert.equal(afterAttempt3.json.validator_retry_result.accepted, false);
  assert.equal(afterAttempt3.json.validator_retry_result.attempt_count, 3);

  const [fallback] = await runCodeNode(NODES.fallback, [afterAttempt3]);
  assert.equal(fallback.json.validator_retry_result.accepted, true);
  assert.deepEqual(fallback.json.validator_retry_result.validation, {
    fact_index: fixture.target_identity.fact_index,
    field_key: fixture.target_identity.field_key,
    verdict: fixture.fallback.verdict,
    confidence: fixture.fallback.confidence,
    reason_code: fixture.fallback.reason_code,
    reason_note: 'AI Validator response contract remained invalid after three attempts; manual review is required.',
  });

  const assembled = await runCodeNode(
    NODES.assembleRetry,
    [fallback],
    { [NODES.classifyPrimary]: [boundary.classified] },
  );
  const checked = await runCodeNode(NODES.strictChecker, assembled);
  const targetChecked = checked.find(
    ({ json }) => json.analysis_unit_meta.analysis_unit_id === fixture.target_identity.analysis_unit_id,
  );
  const fallbackFact = targetChecked.json.validated_facts.find(
    ({ fact_index: factIndex }) => factIndex === fixture.target_identity.fact_index,
  );
  assert.equal(fallbackFact.processing_status, 'requires_review');
  assert.equal(fallbackFact.ai_validation.confidence, 0);
  assert.equal(fallbackFact.value_text, retryItem.json.verified_facts[0].value_text);
  assert.deepEqual(fallbackFact.evidence, retryItem.json.verified_facts[0].evidence);
  assert.deepEqual(
    {
      origin: fallbackFact.validator_meta.origin,
      version: fallbackFact.validator_meta.version,
      confidence_origin: fallbackFact.validator_meta.confidence_origin,
      reported_ai_confidence: fallbackFact.validator_meta.reported_ai_confidence,
      contract_validated: fallbackFact.validator_meta.contract_validated,
      retry_exhausted: fallbackFact.validator_meta.retry_exhausted,
      attempt_count: fallbackFact.validator_meta.attempt_count,
      analysis_unit_id: fallbackFact.validator_meta.analysis_unit_id,
      fact_index: fallbackFact.validator_meta.fact_index,
      field_key: fallbackFact.validator_meta.field_key,
    },
    {
      origin: fixture.fallback.origin,
      version: fixture.fallback.version,
      confidence_origin: fixture.fallback.confidence_origin,
      reported_ai_confidence: null,
      contract_validated: false,
      retry_exhausted: true,
      attempt_count: fixture.fallback.attempt_count,
      analysis_unit_id: fixture.target_identity.analysis_unit_id,
      fact_index: fixture.target_identity.fact_index,
      field_key: fixture.target_identity.field_key,
    },
  );
  assert.equal(fallbackFact.validator_meta.validator_retry.attempt_audit.length, 3);

  const converged = await runCodeNode(
    NODES.converge,
    checked,
    { 'Подготовить dispatch AI Validator': [{ json: boundary.dispatch }] },
  );
  const savedUnits = boundary.units.map((unit) => ({
    json: {
      analysis_run_id: 'sanitized-run',
      tender: unit.tender,
      document: unit.document,
      analysis_batch: unit.analysis_batch,
      analysis_unit_id: unit.analysis_unit_meta.analysis_unit_id,
    },
  }));
  const [documentFacts] = await runCodeNode(
    NODES.collect,
    converged,
    { 'Сохранить analysis unit': savedUnits },
  );
  const collectedFallback = documentFacts.json.facts.find(
    ({ analysis_unit_id: unitId, fact_index: factIndex }) =>
      unitId === fixture.target_identity.analysis_unit_id && factIndex === fixture.target_identity.fact_index,
  );
  assert.equal(collectedFallback.processing_status, 'requires_review');
  assert.equal(collectedFallback.validator_meta.retry_exhausted, true);
});

test('response identity violations are never accepted and source invariant violations still hard-fail', async () => {
  const boundary = await buildExecutionBoundary();
  const [retryItem] = await runCodeNode(NODES.expandRetry, [boundary.classified]);
  const mismatched = providerResponse(
    retryItem.json,
    [validationFor(retryItem.json.verified_facts[0], { field_key: 'application_documents' })],
    'mismatch',
  );
  const [classifiedMismatch] = await runCodeNode(
    NODES.classifyRetry2,
    [{ json: mismatched }],
    { [NODES.loop]: [retryItem] },
  );
  assert.equal(classifiedMismatch.json.validator_retry_result.accepted, false);
  assert.equal(classifiedMismatch.json.validator_retry_result.final_failure_code, 'field_key_mismatch');

  const targetSourceIndex = boundary.sourceItems.findIndex(
    ({ json }) => json.analysis_unit_meta.analysis_unit_id === fixture.target_identity.analysis_unit_id,
  );
  const transportErrorItems = structuredClone(boundary.primaryItems);
  transportErrorItems[targetSourceIndex].json = {
    error: { message: 'sanitized transport failure' },
  };
  const [transportClassified] = await runCodeNode(
    NODES.classifyPrimary,
    transportErrorItems,
    { [NODES.expand]: boundary.sourceItems },
  );
  const transportRetries = transportClassified.json.retry_queue.filter(
    ({ identity }) => identity.analysis_unit_id === fixture.target_identity.analysis_unit_id,
  );
  assert.deepEqual(transportRetries.map(({ identity }) => identity.fact_index), [0, 1]);
  assert.ok(transportRetries.every(({ attempt_audit: audit }) =>
    audit[0].outcome === 'transport_error' && audit[0].failure_code === 'transport_error'));

  const unknownIdentityItems = structuredClone(boundary.primaryItems);
  const unknownIdentityContent = JSON.parse(
    unknownIdentityItems[targetSourceIndex].json.choices[0].message.content,
  );
  unknownIdentityContent.validations.push({
    ...unknownIdentityContent.validations[0],
    fact_index: 999,
  });
  unknownIdentityItems[targetSourceIndex].json.choices[0].message.content =
    JSON.stringify(unknownIdentityContent);
  const [unknownIdentityClassified] = await runCodeNode(
    NODES.classifyPrimary,
    unknownIdentityItems,
    { [NODES.expand]: boundary.sourceItems },
  );
  const unknownIdentityRetries = unknownIdentityClassified.json.retry_queue.filter(
    ({ identity }) => identity.analysis_unit_id === fixture.target_identity.analysis_unit_id,
  );
  assert.deepEqual(
    unknownIdentityRetries.map(({ identity }) => identity.fact_index),
    [0, 1],
  );
  assert.ok(unknownIdentityRetries.every(
    ({ attempt_audit: audit }) => audit[0].failure_code === 'unattributable_validation_identity',
  ));

  const duplicateIdentityItems = structuredClone(boundary.primaryItems);
  const duplicateIdentityContent = JSON.parse(
    duplicateIdentityItems[targetSourceIndex].json.choices[0].message.content,
  );
  duplicateIdentityContent.validations[1].confidence = 0.9;
  duplicateIdentityContent.validations.splice(1, 0, {
    ...duplicateIdentityContent.validations[0],
  });
  duplicateIdentityItems[targetSourceIndex].json.choices[0].message.content =
    JSON.stringify(duplicateIdentityContent);
  const [duplicateIdentityClassified] = await runCodeNode(
    NODES.classifyPrimary,
    duplicateIdentityItems,
    { [NODES.expand]: boundary.sourceItems },
  );
  const duplicateIdentityRetries = duplicateIdentityClassified.json.retry_queue.filter(
    ({ identity }) => identity.analysis_unit_id === fixture.target_identity.analysis_unit_id,
  );
  assert.deepEqual(
    duplicateIdentityRetries.map(({ identity }) => identity.fact_index),
    [fixture.preserved_sibling_identity.fact_index],
  );
  assert.equal(
    duplicateIdentityRetries[0].attempt_audit[0].failure_code,
    'duplicate_validation',
  );

  const duplicateSourceItems = structuredClone(boundary.sourceItems);
  duplicateSourceItems[1].json.analysis_unit_meta.analysis_unit_id =
    duplicateSourceItems[0].json.analysis_unit_meta.analysis_unit_id;
  await assert.rejects(
    runCodeNode(NODES.classifyPrimary, boundary.primaryItems, { [NODES.expand]: duplicateSourceItems }),
    /Duplicate source analysis_unit_id/u,
  );

  const mismatchedSourceItems = structuredClone(boundary.sourceItems);
  mismatchedSourceItems[targetSourceIndex].json.validator_field_keys = ['application_documents'];
  await assert.rejects(
    runCodeNode(NODES.classifyPrimary, boundary.primaryItems, { [NODES.expand]: mismatchedSourceItems }),
    /validator_field_keys mismatch/u,
  );
});

test('two invalid identities survive queue expansion, shuffled terminal order, and explicit-envelope reassembly', async () => {
  const boundary = await buildExecutionBoundary();
  const secondSourceIndex = boundary.sourceItems.findIndex(
    ({ json }) => json.analysis_unit_meta.analysis_unit_id !== fixture.target_identity.analysis_unit_id,
  );
  const secondInvalidItems = structuredClone(boundary.primaryItems);
  const secondInvalidContent = JSON.parse(
    secondInvalidItems[secondSourceIndex].json.choices[0].message.content,
  );
  delete secondInvalidContent.validations[0].confidence;
  secondInvalidItems[secondSourceIndex].json.choices[0].message.content =
    JSON.stringify(secondInvalidContent);
  const [classified] = await runCodeNode(
    NODES.classifyPrimary,
    secondInvalidItems,
    { [NODES.expand]: boundary.sourceItems },
  );
  assert.equal(classified.json.retry_queue.length, 2);

  const retryItems = await runCodeNode(NODES.expandRetry, [classified]);
  assert.equal(retryItems.length, 2);
  assert.ok(retryItems.every((item) => item.pairedItem === undefined));
  const terminalItems = [];
  for (const retryItem of retryItems) {
    const response = providerResponse(
      retryItem.json,
      [validationFor(retryItem.json.verified_facts[0], { confidence: 0.86 })],
      'multi-attempt-2',
    );
    const [terminal] = await runCodeNode(
      NODES.classifyRetry2,
      [{ json: response }],
      { [NODES.loop]: [retryItem] },
    );
    terminalItems.unshift(terminal);
  }

  const assembled = await runCodeNode(
    NODES.assembleRetry,
    terminalItems,
    { [NODES.classifyPrimary]: [classified] },
  );
  assert.equal(assembled.length, boundary.sourceItems.length);
  for (const assembledItem of assembled) {
    const unitId = assembledItem.json.validator_source_envelope.source_identity.analysis_unit_id;
    const expectedSource = boundary.sourceItems.find(
      ({ json }) => json.analysis_unit_meta.analysis_unit_id === unitId,
    ).json;
    assertExplicitSourceEnvelope(assembledItem, expectedSource);
  }
  const checked = await runCodeNode(NODES.strictChecker, assembled);
  assert.equal(checked.length, boundary.sourceItems.length);
});
