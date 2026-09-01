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
const fixturePath = path.join(
  testDirectory,
  'fixtures',
  'document-worker-extractor-envelope',
  'execution-14359-response-matrix.json',
);
const recoveryFixturePath = path.join(
  testDirectory,
  'fixtures',
  'document-worker-extractor-recovery',
  'execution-14359-recovery-oracle.json',
);

const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const recoveryFixture = JSON.parse(fs.readFileSync(recoveryFixturePath, 'utf8'));

function findNode(name) {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(node, `Workflow node not found: ${name}`);
  return node;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function runRequestPreparation(inputJson) {
  const node = findNode('Подготовить запрос для AI');
  const inputItem = { json: structuredClone(inputJson) };
  const context = vm.createContext({
    console,
    structuredClone,
    $input: {
      all: () => [inputItem],
      first: () => inputItem,
      item: inputItem,
    },
  });
  return new vm.Script(
    `(async () => { ${node.parameters.jsCode}\n })()`,
  ).runInContext(context);
}

function buildAttemptEnvelope(apiResponse, source, attempt = 'primary') {
  return {
    attempt_transport: {
      version: 'ai_extractor_attempt_transport_v1',
      attempt,
      analysis_unit_id: source?.analysis_unit_meta?.analysis_unit_id ?? null,
      model_alias: attempt === 'primary'
        ? recoveryFixture.models.primary_alias
        : recoveryFixture.models.fallback_alias,
      transport_status: 'succeeded',
      source: structuredClone(source),
      provider_response: structuredClone(apiResponse),
      failure_class: null,
      failure_code: null,
    },
  };
}

async function runEvidenceValidator(apiResponse, source, attempt = 'primary') {
  const nodeName = attempt === 'primary'
    ? 'Проверить и привязать evidence'
    : 'Проверить fallback и привязать evidence';
  const node = findNode(nodeName);
  const inputItem = {
    json: buildAttemptEnvelope(apiResponse, source, attempt),
  };
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
      throw new Error('explicit attempt-envelope validator must not use linked-item lookup');
    },
  });
  const result = await new vm.Script(
    `(async () => { ${node.parameters.jsCode}\n })()`,
  ).runInContext(context);
  return JSON.parse(JSON.stringify(result));
}

function acceptedUnit(output) {
  const unit = output.json.validated_unit;
  assert.deepEqual(output.json.extractor_recovery_decision, {
    version: recoveryFixture.primary_decision_contract.version,
    analysis_unit_id: unit.analysis_unit_meta.analysis_unit_id,
    decision: recoveryFixture.primary_decision_contract.accepted,
    primary_failure_class: null,
    primary_failure_code: null,
  });
  return unit;
}

function assertFallbackDecision(output, expectedCode, expectedUnitId) {
  assert.deepEqual(output.json.extractor_recovery_decision, {
    version: recoveryFixture.primary_decision_contract.version,
    analysis_unit_id: expectedUnitId,
    decision: recoveryFixture.primary_decision_contract.fallback_required,
    primary_failure_class: recoveryFixture.primary_decision_contract.fallback_failure_class,
    primary_failure_code: expectedCode,
  });
  assert.equal(
    recoveryFixture.primary_decision_contract.fallback_failure_codes.includes(expectedCode),
    true,
  );
  assert.equal(JSON.stringify(output).includes('choices'), false);
}

function buildSource(analysisUnitId, text = 'Требуется точный документ') {
  return {
    tender: { tender_id: 'sanitized-tender' },
    document: { document_id: 'sanitized-document' },
    analysis_batch: { units_total: 1 },
    analysis_unit_meta: { analysis_unit_id: analysisUnitId },
    ai_segments: [
      {
        semantic_block_id: `sb_${analysisUnitId}`,
        scope: 'primary',
        type: 'text',
        role: 'body',
        text,
      },
    ],
    provenance: {
      index: {
        [`sb_${analysisUnitId}`]: {
          scope: 'primary',
          source_block_ids: [],
          sources: [],
        },
      },
    },
    ai_request: {
      prompt_version: 'tender_extractor_prompt_v2',
      schema_version: 'ai_extractor_v1',
      field_catalog_version: 'tender_fields_v1',
      field_catalog: [],
    },
  };
}

function buildFact(analysisUnitId, valueText = 'Требуется точный документ') {
  return {
    field_key: 'application_documents',
    value_text: valueText,
    status: 'found',
    confidence: 0.91,
    evidence: [
      {
        semantic_block_id: `sb_${analysisUnitId}`,
        quote: valueText,
      },
    ],
    review_reason_code: null,
    review_note: null,
  };
}

function buildResponse(payload, ordinal = 1) {
  return {
    id: `sanitized-response-${ordinal}`,
    model: 'sanitized-model',
    choices: [
      {
        finish_reason: 'stop',
        message: { content: JSON.stringify(payload) },
      },
    ],
    usage: {},
  };
}

function semanticProjection(fact) {
  return {
    field_key: fact.field_key,
    value_text: fact.value_text,
    status: fact.status,
    confidence: fact.confidence,
    evidence: fact.evidence.map(({ semantic_block_id, quote }) => ({
      semantic_block_id,
      quote,
    })),
    review_reason_code: fact.review_reason_code,
    review_note: fact.review_note,
  };
}

function assertAttachmentAudit(unit, expected) {
  assert.deepEqual(
    JSON.parse(JSON.stringify(unit.extractor.envelope_attachment)),
    {
      version: 'ai_extractor_envelope_attachment_v1',
      reported_schema_version: expected.reportedSchemaVersion,
      effective_schema_version: 'ai_extractor_v1',
      reported_analysis_unit_id: expected.reportedAnalysisUnitId,
      effective_analysis_unit_id: expected.effectiveAnalysisUnitId,
      repair_reasons: expected.repairReasons,
    },
  );
}

test('execution 14359 fixture is a sanitized exact 16-response structural matrix', () => {
  assert.equal(fixture.source_execution.execution_id, '14359');
  assert.equal(fixture.source_execution.response_count, 16);
  assert.equal(fixture.responses.length, 16);
  assert.deepEqual(
    fixture.responses.map(({ ordinal }) => ordinal),
    Array.from({ length: 16 }, (_, index) => index + 1),
  );
  assert.deepEqual(
    fixture.responses.map(({ fact_count }) => fact_count),
    [0, 0, 0, 5, 4, 3, 7, 3, 1, 0, 6, 0, 0, 2, 42, 1],
  );
  assert.equal(fixture.observed_totals.json_parseable, 16);
  assert.equal(fixture.observed_totals.finish_reason_stop, 16);
  assert.equal(fixture.observed_totals.missing_field_catalog_version, 16);
  assert.equal(fixture.observed_totals.safely_recoverable_under_stage_2_boundary, 0);
  assert.deepEqual(fixture.response_classification_defaults, {
    json_parseable: true,
    finish_reason: 'stop',
    facts_type: 'array',
    first_rejecting_node: 'Проверить и привязать evidence',
  });
  assert.deepEqual(
    fixture.facts_shape_classification.strictly_valid_empty_fact_ordinals,
    [1, 2, 3, 10, 12, 13],
  );
  assert.deepEqual(
    fixture.facts_shape_classification.incompatible_nonempty_fact_ordinals,
    [4, 5, 6, 7, 8, 9, 11, 14, 15, 16],
  );
  assert.deepEqual(
    fixture.facts_shape_classification.exact_fact_key_shape_but_invalid_semantics_ordinals,
    [16],
  );
  assert.equal(
    fixture.responses.filter(({ safely_recoverable }) => safely_recoverable).length,
    0,
  );
  assert.equal(
    fixture.responses.filter(({ semantic_payload_valid }) => semantic_payload_valid).length,
    6,
  );

  const forbiddenKeys = new Set([
    'content',
    'reasoning',
    'reasoning_content',
    'system_prompt',
    'user_prompt',
    'value_text',
    'quote',
    'api_key',
    'token',
  ]);
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false, `forbidden fixture key: ${key}`);
      visit(child);
    }
  };
  visit(fixture);
});

test('execution 14359 request contract matches both known-good GLM low controls', () => {
  const comparison = fixture.request_contract_comparison;
  assert.equal(
    comparison.classification,
    'model_contract_noncompliance_not_prompt_or_request_drift',
  );
  assert.match(comparison.shared_request_json_body_sha256, /^[a-f0-9]{64}$/);
  assert.match(comparison.shared_system_prompt_sha256, /^[a-f0-9]{64}$/);
  assert.match(comparison.shared_response_schema_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    comparison.known_good_controls.map((control) => [
      control.execution_id,
      control.full_contract_responses,
    ]),
    [['14117', 16], ['14119', 16]],
  );
  assert.equal(comparison.execution_14359_full_contract_responses, 0);
});

test('current canonical request body, system prompt, and response schema retain the compared hashes', async () => {
  const comparison = fixture.request_contract_comparison;
  const httpNode = findNode('AI Extractor v1.0');
  assert.equal(
    sha256(httpNode.parameters.jsonBody),
    comparison.shared_request_json_body_sha256,
  );

  const analysisUnitId = 'prompt_hash_control';
  const semanticBlockId = `sb_${analysisUnitId}`;
  const [prepared] = await runRequestPreparation({
    tender: { tender_id: 'sanitized-tender' },
    document: { document_id: 'sanitized-document' },
    analysis_batch: { units_total: 1 },
    analysis_unit: {
      analysis_unit_id: analysisUnitId,
      primary_semantic_block_ids: [semanticBlockId],
      overlap_semantic_block_ids: [],
    },
    ai_segments: [
      {
        semantic_block_id: semanticBlockId,
        scope: 'primary',
        type: 'text',
        role: 'body',
        text: 'Sanitized prompt hash control',
      },
    ],
    provenance: {
      primary_semantic_blocks_count: 1,
      overlap_semantic_blocks_count: 0,
      total_semantic_blocks_count: 1,
      index: {
        [semanticBlockId]: {
          scope: 'primary',
          source_block_ids: [],
          sources: [],
        },
      },
    },
  });
  assert.equal(
    sha256(prepared.json.ai_request.system_prompt),
    comparison.shared_system_prompt_sha256,
  );
  assert.equal(
    sha256(JSON.stringify(prepared.json.ai_request.response_schema)),
    comparison.shared_response_schema_sha256,
  );
});

test('RED: missing schema_version is attached only after exact facts validation with audit', async () => {
  const analysisUnitId = 'safe_missing_schema';
  const source = buildSource(analysisUnitId);
  const fact = buildFact(analysisUnitId);
  const response = buildResponse({
    field_catalog_version: 'tender_fields_v1',
    analysis_unit_id: analysisUnitId,
    facts: [fact],
  });

  const output = await runEvidenceValidator(response, source);
  const unit = acceptedUnit(output);

  assert.equal(unit.validation_passed, true);
  assert.deepEqual(semanticProjection(unit.verified_facts[0]), fact);
  assert.equal(
    JSON.stringify(unit.evidence_context).includes('envelope_attachment'),
    false,
  );
  assertAttachmentAudit(unit, {
    reportedSchemaVersion: null,
    reportedAnalysisUnitId: analysisUnitId,
    effectiveAnalysisUnitId: analysisUnitId,
    repairReasons: ['missing_schema_version'],
  });
});

test('RED: missing analysis_unit_id uses one explicit source identity and records reported/effective IDs', async () => {
  const analysisUnitId = 'safe_missing_identity';
  const source = buildSource(analysisUnitId);
  const fact = buildFact(analysisUnitId);
  const response = buildResponse({
    schema_version: 'ai_extractor_v1',
    field_catalog_version: 'tender_fields_v1',
    facts: [fact],
  });

  const output = await runEvidenceValidator(response, source);
  const unit = acceptedUnit(output);

  assert.equal(unit.analysis_unit_meta.analysis_unit_id, analysisUnitId);
  assert.deepEqual(semanticProjection(unit.verified_facts[0]), fact);
  assert.equal(
    JSON.stringify(unit.verified_facts).includes('envelope_attachment'),
    false,
  );
  assertAttachmentAudit(unit, {
    reportedSchemaVersion: 'ai_extractor_v1',
    reportedAnalysisUnitId: null,
    effectiveAnalysisUnitId: analysisUnitId,
    repairReasons: ['missing_analysis_unit_id'],
  });
});

test('RED: bounded attachment preserves response cardinality and order without semantic mutation', async () => {
  const cases = [
    ['safe_batch_1', ['missing_schema_version']],
    ['safe_batch_2', ['missing_analysis_unit_id']],
    ['safe_batch_3', ['missing_schema_version', 'missing_analysis_unit_id']],
  ];
  const outputs = [];

  for (const [analysisUnitId, repairReasons] of cases) {
    const fact = buildFact(analysisUnitId, `Точное значение ${analysisUnitId}`);
    const source = buildSource(analysisUnitId, fact.value_text);
    const payload = {
      field_catalog_version: 'tender_fields_v1',
      facts: [fact],
    };
    if (!repairReasons.includes('missing_schema_version')) {
      payload.schema_version = 'ai_extractor_v1';
    }
    if (!repairReasons.includes('missing_analysis_unit_id')) {
      payload.analysis_unit_id = analysisUnitId;
    }

    const output = await runEvidenceValidator(
      buildResponse(payload, outputs.length + 1),
      source,
    );
    const unit = acceptedUnit(output);
    outputs.push(unit);
    assert.deepEqual(semanticProjection(unit.verified_facts[0]), fact);
    assertAttachmentAudit(unit, {
      reportedSchemaVersion: payload.schema_version ?? null,
      reportedAnalysisUnitId: payload.analysis_unit_id ?? null,
      effectiveAnalysisUnitId: analysisUnitId,
      repairReasons,
    });
  }

  assert.equal(outputs.length, cases.length);
  assert.deepEqual(
    outputs.map((unit) => unit.analysis_unit_meta.analysis_unit_id),
    cases.map(([analysisUnitId]) => analysisUnitId),
  );
});

test('RED: conflicting reported identity is fallback-eligible but missing explicit source hard-stops', async () => {
  const source = buildSource('expected_identity');
  const fact = buildFact('expected_identity');
  const conflicting = buildResponse({
    schema_version: 'ai_extractor_v1',
    field_catalog_version: 'tender_fields_v1',
    analysis_unit_id: 'reported_other_identity',
    facts: [fact],
  });
  assertFallbackDecision(
    await runEvidenceValidator(conflicting, source),
    'conflicting_analysis_unit_id',
    'expected_identity',
  );
  await assert.rejects(
    runEvidenceValidator(conflicting, source, 'fallback'),
    /analysis_unit_id|identity/i,
  );

  const otherwiseValid = buildResponse({
    schema_version: 'ai_extractor_v1',
    field_catalog_version: 'tender_fields_v1',
    analysis_unit_id: 'expected_identity',
    facts: [fact],
  });
  await assert.rejects(
    runEvidenceValidator(otherwiseValid, null),
    /source|attempt.*envelope|analysis_unit_id/i,
  );
});

test('RED: missing catalog and incompatible root/schema variants use only typed allow-listed fallback', async () => {
  const analysisUnitId = 'incompatible_envelope';
  const source = buildSource(analysisUnitId);
  const fact = buildFact(analysisUnitId);

  const cases = [
    [
      'invalid_field_catalog_version',
      buildResponse({
        schema_version: 'ai_extractor_v1',
        analysis_unit_id: analysisUnitId,
        facts: [fact],
      }),
    ],
    [
      'invalid_root_contract',
      buildResponse({
        schema: 'ai_extractor_v1',
        field_catalog_version: 'tender_fields_v1',
        analysis_unit_id: analysisUnitId,
        facts: [fact],
      }),
    ],
    [
      'invalid_schema_version',
      buildResponse({
        schema_version: 'ai_extractor_v2',
        field_catalog_version: 'tender_fields_v1',
        analysis_unit_id: analysisUnitId,
        facts: [fact],
      }),
    ],
  ];
  for (const [failureCode, response] of cases) {
    assertFallbackDecision(
      await runEvidenceValidator(response, source),
      failureCode,
      analysisUnitId,
    );
    await assert.rejects(runEvidenceValidator(response, source, 'fallback'));
  }
});

test('RED: missing identity never authorizes invalid facts or invalid evidence', async () => {
  const analysisUnitId = 'unsafe_semantics';
  const source = buildSource(analysisUnitId);
  const invalidFactResponse = buildResponse({
    schema_version: 'ai_extractor_v1',
    field_catalog_version: 'tender_fields_v1',
    facts: [{ field: 'application_documents', value: 'different schema' }],
  });
  assertFallbackDecision(
    await runEvidenceValidator(invalidFactResponse, source),
    'invalid_fact_contract',
    analysisUnitId,
  );
  await assert.rejects(
    runEvidenceValidator(invalidFactResponse, source, 'fallback'),
  );

  const invalidEvidenceFact = buildFact(analysisUnitId);
  delete invalidEvidenceFact.evidence[0].quote;
  const invalidEvidenceResponse = buildResponse({
    schema_version: 'ai_extractor_v1',
    field_catalog_version: 'tender_fields_v1',
    facts: [invalidEvidenceFact],
  });
  assertFallbackDecision(
    await runEvidenceValidator(invalidEvidenceResponse, source),
    'invalid_evidence_contract',
    analysisUnitId,
  );
  await assert.rejects(
    runEvidenceValidator(invalidEvidenceResponse, source, 'fallback'),
  );
});
