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
const previousStaticPromptPath = path.join(
  repositoryRoot,
  'prompts',
  'AI validator prompt v1.1.txt',
);

const CANONICAL_FIELD_KEYS = [
  'procurement_subject',
  'nm_price_with_vat',
  'platform',
  'procedure_type',
  'application_deadline',
  'application_review_date',
  'results_date',
  'customer',
  'customer_contacts',
  'participation_cost',
  'participation_guarantee',
  'evaluation_criteria',
  'delivery_term',
  'payment_terms',
  'special_account_or_treasury',
  'bank_support',
  'government_contract',
  'rebidding',
  'national_regime',
  'advance_contract_guarantee',
  'warranty_obligations_guarantee',
  'licenses_certificates',
  'required_official_certificates',
  'similar_supply_experience',
  'analog_allowed',
  'analog_definition',
  'application_documents',
];

function loadWorkflow() {
  return JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
}

function findNode(workflow, name) {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(node, `Workflow node not found: ${name}`);
  return node;
}

async function executeCode({ code, inputJsons, sources = {} }) {
  const inputItems = inputJsons.map((json) => ({ json: structuredClone(json) }));
  const sourceItems = Object.fromEntries(
    Object.entries(sources).map(([name, jsons]) => [
      name,
      jsons.map((json) => ({ json: structuredClone(json) })),
    ]),
  );
  const context = vm.createContext({
    console,
    structuredClone,
    $json: inputItems[0]?.json,
    $input: {
      all: () => inputItems,
      first: () => inputItems[0],
      item: inputItems[0],
    },
    $: (name) => {
      const items = sourceItems[name];
      if (!items) throw new Error(`Unknown source node: ${name}`);
      return {
        all: () => items,
        first: () => items[0],
        itemMatching: (index) => items[index],
        item: items[0],
      };
    },
  });
  const result = await new vm.Script(
    `(async () => { ${code}\n })()`,
  ).runInContext(context);
  return (Array.isArray(result) ? result : [result]).map((item) =>
    JSON.parse(JSON.stringify(item.json)),
  );
}

async function runNode(workflow, name, inputJsons, sources = {}) {
  return executeCode({
    code: findNode(workflow, name).parameters.jsCode,
    inputJsons,
    sources,
  });
}

function buildFact(factIndex, fieldKey) {
  return {
    fact_index: factIndex,
    field_key: fieldKey,
    value_text: `Exact value ${fieldKey}/${factIndex}`,
    status: 'found',
    confidence: 0.9,
    review_reason_code: null,
    review_note: null,
    evidence: [
      {
        semantic_block_id: `sb_${factIndex}`,
        quote: `Exact quote ${factIndex}`,
        scope: 'primary',
        type: 'text',
        role: 'body',
      },
    ],
  };
}

function buildUnit(analysisUnitId, fieldKeys) {
  const verifiedFacts = fieldKeys.map((fieldKey, index) =>
    buildFact(index, fieldKey),
  );
  return {
    tender: { tender_id: 'fixture' },
    document: { document_id: 'fixture-document' },
    analysis_batch: { units_total: 1 },
    analysis_unit_meta: { analysis_unit_id: analysisUnitId },
    validation_passed: true,
    violations: [],
    resolved_violations: [],
    verified_facts: verifiedFacts,
    deterministically_rejected_facts: [],
    evidence_context: Object.fromEntries(
      verifiedFacts.map((fact) => [
        fact.evidence[0].semantic_block_id,
        {
          semantic_block_id: fact.evidence[0].semantic_block_id,
          scope: 'primary',
          type: 'text',
          role: 'body',
          text: fact.evidence[0].quote,
        },
      ]),
    ),
    evidence_validation: { passed: true, version: 'evidence_validator_v2' },
  };
}

function buildEnvelope(unitsForAi, unitsWithoutAi = []) {
  return {
    dispatch_version: 'ai_validator_dispatch_v1',
    expected_units_total: unitsForAi.length + unitsWithoutAi.length,
    expected_analysis_unit_ids: [...unitsForAi, ...unitsWithoutAi].map(
      (unit) => unit.analysis_unit_meta.analysis_unit_id,
    ),
    units_for_ai: unitsForAi,
    units_without_ai: unitsWithoutAi,
  };
}

function buildValidatorResponse(unit, { provider } = {}) {
  return {
    id: 'fixture-response',
    model: 'google/gemini-3.7-flash',
    ...(provider === undefined ? {} : { provider }),
    choices: [
      {
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            schema_version: 'ai_validator_v1',
            analysis_unit_id: unit.analysis_unit_meta.analysis_unit_id,
            validations: unit.verified_facts.map((fact) => ({
              fact_index: fact.fact_index,
              field_key: fact.field_key,
              verdict: 'confirmed',
              confidence: 0.98,
              reason_code: null,
              reason_note: null,
            })),
          }),
        },
      },
    ],
    usage: {},
  };
}

function validatorSystemTemplate(workflow) {
  const body = findNode(workflow, 'AI Validator v1').parameters.jsonBody;
  const match = body.match(
    /role:\s*'system',\s*content:\s*`([\s\S]*?)`\s*\n\s*},/,
  );
  assert.ok(match, 'Validator system prompt not found');
  return match[1];
}

test('VALIDATOR_FIELD_PROFILES contains exactly the 27 canonical keys and complete profiles', async () => {
  const workflow = loadWorkflow();
  const source = findNode(
    workflow,
    'Развернуть units для AI Validator',
  ).parameters.jsCode;
  const inspectionCode = source.replace(
    'const items = $input.all();',
    `return [{ json: {
      keys: Object.keys(VALIDATOR_FIELD_PROFILES),
      profiles: VALIDATOR_FIELD_PROFILES,
    } }];`,
  );
  const [inspection] = await executeCode({ code: inspectionCode, inputJsons: [{}] });
  assert.deepEqual(inspection.keys, CANONICAL_FIELD_KEYS);
  assert.equal(new Set(inspection.keys).size, 27);
  for (const fieldKey of CANONICAL_FIELD_KEYS) {
    assert.equal(
      (source.match(new RegExp(`\\n\\s*${fieldKey}:\\s*Object\\.freeze`, 'g')) ?? [])
        .length,
      1,
      `Profile definition count for ${fieldKey}`,
    );
    const profile = inspection.profiles[fieldKey];
    for (const property of [
      'title',
      'definition',
      'confirmation_criteria',
      'semantic_exclusions',
      'rejected_when',
      'requires_review_when',
    ]) {
      assert.ok(profile[property]?.length > 0, `${fieldKey}.${property}`);
    }
  }
});

test('single-field unit receives only its profile', async () => {
  const workflow = loadWorkflow();
  const unit = buildUnit('single-field', ['customer']);
  const [expanded] = await runNode(
    workflow,
    'Развернуть units для AI Validator',
    [buildEnvelope([unit])],
  );
  assert.deepEqual(expanded.validator_prompt_context.field_keys, ['customer']);
  assert.match(expanded.validator_prompt_context.field_profiles_text, /FIELD PROFILE: customer/);
  for (const fieldKey of CANONICAL_FIELD_KEYS.filter((key) => key !== 'customer')) {
    assert.ok(
      !expanded.validator_prompt_context.field_profiles_text.includes(
        `FIELD PROFILE: ${fieldKey}`,
      ),
      `Unexpected profile ${fieldKey}`,
    );
  }
});

test('multi-field unit receives the exact canonical union once and stays one HTTP item', async () => {
  const workflow = loadWorkflow();
  const unit = buildUnit('multi-field', [
    'delivery_term',
    'customer',
    'procurement_subject',
  ]);
  const expanded = await runNode(
    workflow,
    'Развернуть units для AI Validator',
    [buildEnvelope([unit])],
  );
  assert.equal(expanded.length, 1);
  assert.deepEqual(expanded[0].validator_prompt_context.field_keys, [
    'procurement_subject',
    'customer',
    'delivery_term',
  ]);
  for (const fieldKey of expanded[0].validator_prompt_context.field_keys) {
    assert.equal(
      expanded[0].validator_prompt_context.field_profiles_text.split(
        `FIELD PROFILE: ${fieldKey}`,
      ).length - 1,
      1,
    );
  }
});

test('duplicate field keys do not duplicate profiles or merge facts', async () => {
  const workflow = loadWorkflow();
  const unit = buildUnit('duplicate-field', ['payment_terms', 'payment_terms']);
  const originalFacts = structuredClone(unit.verified_facts);
  const [expanded] = await runNode(
    workflow,
    'Развернуть units для AI Validator',
    [buildEnvelope([unit])],
  );
  assert.deepEqual(expanded.validator_prompt_context.field_keys, ['payment_terms']);
  assert.equal(
    expanded.validator_prompt_context.field_profiles_text.split(
      'FIELD PROFILE: payment_terms',
    ).length - 1,
    1,
  );
  assert.deepEqual(expanded.verified_facts, originalFacts);
  assert.deepEqual(
    expanded.verified_facts.map(({ fact_index: factIndex }) => factIndex),
    [0, 1],
  );
});

test('empty verified_facts remains units_without_ai and creates no validator HTTP item', async () => {
  const workflow = loadWorkflow();
  const unit = buildUnit('empty-unit', []);
  const [dispatch] = await runNode(
    workflow,
    'Подготовить dispatch AI Validator',
    [unit],
  );
  assert.equal(dispatch.units_for_ai.length, 0);
  assert.equal(dispatch.units_without_ai.length, 1);
  assert.equal(dispatch.counts.http_ai_validator_items, 0);
  const httpTargets = workflow.connections['Развернуть units для AI Validator'].main[0];
  assert.deepEqual(httpTargets.map(({ node }) => node), ['AI Validator v1']);
});

test('unknown field_key hard-fails before the HTTP Validator', async () => {
  const workflow = loadWorkflow();
  const unit = buildUnit('unknown-field', ['unknown_field']);
  await assert.rejects(
    runNode(
      workflow,
      'Развернуть units для AI Validator',
      [buildEnvelope([unit])],
    ),
    /unknown field_key.*unknown_field/i,
  );
});

test('missing profile for a known field hard-fails before the HTTP Validator', async () => {
  const workflow = loadWorkflow();
  const node = findNode(workflow, 'Развернуть units для AI Validator');
  const mutatedCode = node.parameters.jsCode.replace(
    'const items = $input.all();',
    `delete VALIDATOR_FIELD_PROFILES.customer;\nconst items = $input.all();`,
  );
  await assert.rejects(
    executeCode({
      code: mutatedCode,
      inputJsons: [buildEnvelope([buildUnit('missing-profile', ['customer'])])],
    }),
    /missing profile.*customer/i,
  );
});

test('analysis_unit_id, fact linking, cardinality, and prompt audit are preserved', async () => {
  const workflow = loadWorkflow();
  const unit = buildUnit('audit-unit', ['customer', 'delivery_term']);
  const [expanded] = await runNode(
    workflow,
    'Развернуть units для AI Validator',
    [buildEnvelope([unit])],
  );
  const [checked] = await runNode(
    workflow,
    'Проверить ответ AI Validator',
    [buildValidatorResponse(expanded)],
    { 'Развернуть units для AI Validator': [expanded] },
  );
  assert.equal(checked.analysis_unit_meta.analysis_unit_id, 'audit-unit');
  assert.deepEqual(
    checked.validated_facts.map(({ fact_index: factIndex, field_key: fieldKey }) => [
      factIndex,
      fieldKey,
    ]),
    [
      [0, 'customer'],
      [1, 'delivery_term'],
    ],
  );
  assert.equal(checked.ai_validator.gateway, 'polza.ai');
  assert.equal(checked.ai_validator.provider, null);
  assert.equal(checked.ai_validator.response_model, 'google/gemini-3.7-flash');
  assert.equal(checked.ai_validator.prompt_version, 'ai_validator_prompt_v1_2');
  assert.equal(
    checked.ai_validator.field_profiles_version,
    'validator_field_profiles_v1',
  );
  assert.deepEqual(checked.ai_validator.field_keys, ['customer', 'delivery_term']);
  assert.equal(checked.ai_validator_response_check.expected_facts_count, 2);
  assert.equal(checked.ai_validator_response_check.received_validations_count, 2);
});

test('provider is copied only from the factual API response', async () => {
  const workflow = loadWorkflow();
  const unit = buildUnit('provider-unit', ['platform']);
  const [expanded] = await runNode(
    workflow,
    'Развернуть units для AI Validator',
    [buildEnvelope([unit])],
  );
  const [checked] = await runNode(
    workflow,
    'Проверить ответ AI Validator',
    [buildValidatorResponse(expanded, { provider: 'google-ai-studio' })],
    { 'Развернуть units для AI Validator': [expanded] },
  );
  assert.equal(checked.ai_validator.provider, 'google-ai-studio');
  assert.notEqual(checked.ai_validator.provider, 'deepseek');
});

test('single-field dynamic prompt omits the static 27-field catalog and is shorter', async () => {
  const workflow = loadWorkflow();
  const template = validatorSystemTemplate(workflow);
  assert.doesNotMatch(template, /КАТАЛОГ ПОЛЕЙ/);
  assert.match(
    template,
    /\$\{\$json\.validator_prompt_context\.field_profiles_text\}/,
  );
  const [expanded] = await runNode(
    workflow,
    'Развернуть units для AI Validator',
    [buildEnvelope([buildUnit('prompt-size', ['customer'])])],
  );
  const renderedSingleFieldPrompt = template.replace(
    '${$json.validator_prompt_context.field_profiles_text}',
    expanded.validator_prompt_context.field_profiles_text,
  );
  const previousStaticPrompt = fs.readFileSync(previousStaticPromptPath, 'utf8');
  assert.ok(renderedSingleFieldPrompt.length < previousStaticPrompt.length);
  assert.match(renderedSingleFieldPrompt, /FIELD PROFILE: customer/);
  assert.doesNotMatch(renderedSingleFieldPrompt, /FIELD PROFILE: delivery_term/);
});

test('model, response format, max tokens, timeout, topology, and HTTP call count stay unchanged', () => {
  const workflow = loadWorkflow();
  const validator = findNode(workflow, 'AI Validator v1');
  assert.match(
    validator.parameters.jsonBody,
    /google\/gemini-3\.7-flash@provider=google-ai-studio\/flex&reasoning_effort=low/,
  );
  assert.match(validator.parameters.jsonBody, /max_tokens:\s*8192/);
  assert.match(validator.parameters.jsonBody, /response_format:\s*\{\s*type:\s*'json_object'/);
  assert.equal(validator.parameters.options.timeout, 180000);
  assert.deepEqual(
    workflow.connections['Развернуть units для AI Validator'].main[0].map(
      ({ node }) => node,
    ),
    ['AI Validator v1'],
  );
  assert.deepEqual(
    workflow.connections['AI Validator v1'].main[0].map(({ node }) => node),
    ['Проверить ответ AI Validator'],
  );
  assert.equal(
    workflow.nodes.filter(({ name }) => name === 'AI Validator v1').length,
    1,
  );
});
