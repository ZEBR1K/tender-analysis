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
const executionFixturePath = path.join(
  testDirectory,
  'fixtures',
  'document-worker-validator-execution-14103.json',
);
const runtimeFixturePath = path.join(
  testDirectory,
  'fixtures',
  'document-worker-validator-runtime-eval.json',
);

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadWorkflow() {
  return loadJson(workflowPath);
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

function checkerSource() {
  return findNode(
    loadWorkflow(),
    'Проверить ответ AI Validator',
  ).parameters.jsCode;
}

async function assessFacts(facts) {
  const marker = 'const validatorItems =\n  $input.all();';
  const source = checkerSource();
  assert.ok(source.includes(marker), 'Checker input marker not found');
  const inspectionCode = source.replace(
    marker,
    `return [{
      json: {
        assessments: $json.facts.map((fact) => ({
          analysis_unit_id: fact.analysis_unit_id ?? null,
          fact_index: fact.fact_index,
          field_key: fact.field_key,
          original_verdict: fact.ai_validation?.verdict ?? 'confirmed',
          result: assessFactLocalMaterialLiterals(fact),
        })),
      },
    }];

${marker}`,
  );
  const [result] = await executeCode({
    code: inspectionCode,
    inputJsons: [{ facts }],
  });
  return result.assessments;
}

function fact({ valueText, evidenceText, verdict = 'confirmed', factIndex = 0 }) {
  return {
    fact_index: factIndex,
    field_key: 'payment_terms',
    value_text: valueText,
    evidence: [{
      semantic_block_id: `fixture_${factIndex}`,
      quote: evidenceText,
      scope: 'primary',
    }],
    ai_validation: {
      verdict,
      confidence: 0.9,
      reason_code: verdict === 'confirmed' ? null : 'insufficient_evidence',
      reason_note: verdict === 'confirmed' ? null : 'Recorded review.',
    },
  };
}

test('execution 14103 fixture preserves the exact P0 fact-local coverage failure and 61-fact baseline', () => {
  const fixture = loadJson(executionFixturePath);
  assert.equal(
    fixture.schema_version,
    'document_worker_fact_local_literal_guard_fixture_v1',
  );
  assert.equal(fixture.source_execution_id, 14103);
  assert.deepEqual(fixture.recorded_dispatch_counts, {
    expected_units_total: 66,
    units_for_ai: 20,
    units_without_ai: 46,
    http_ai_validator_items: 20,
    deterministic_rejected_facts: 1,
  });
  assert.equal(fixture.all_recorded_facts.length, 61);

  const source = fixture.target_checker_source;
  const target = source.verified_facts.find(
    ({ fact_index: factIndex }) => factIndex === fixture.oracle.fact_index,
  );
  assert.ok(target);
  assert.equal(target.field_key, 'advance_contract_guarantee');
  assert.match(target.value_text, /30\s*%/);
  assert.ok(target.evidence.every(({ quote }) => !/30\s*%/.test(quote)));

  const sibling = source.verified_facts.find(
    ({ field_key: fieldKey }) => fieldKey === 'payment_terms',
  );
  assert.ok(sibling.evidence.some(({ quote }) => /30\s*%/.test(quote)));
  assert.ok(
    Object.values(source.evidence_context).some(({ text }) => /30\s*%/.test(text)),
  );

  const recorded = fixture.target_recorded_checker_output.validated_facts.find(
    ({ fact_index: factIndex }) => factIndex === fixture.oracle.fact_index,
  );
  assert.equal(recorded.ai_validation.verdict, 'confirmed');
});

test('confirmed target is downgraded to requires_review with fact-local guard audit', async () => {
  const fixture = loadJson(executionFixturePath);
  const [checked] = await executeCode({
    code: checkerSource(),
    inputJsons: [fixture.target_recorded_model_output],
    sources: {
      'Развернуть units для AI Validator': [fixture.target_checker_source],
    },
  });
  const guarded = checked.validated_facts.find(
    ({ fact_index: factIndex }) => factIndex === fixture.oracle.fact_index,
  );

  assert.equal(guarded.ai_validation.verdict, 'requires_review');
  assert.equal(guarded.ai_validation.reason_code, 'insufficient_evidence');
  assert.notEqual(guarded.ai_validation.verdict, 'rejected');
  assert.equal(guarded.processing_status, 'requires_review');
  assert.equal(guarded.accepted_for_normalization, false);
  assert.deepEqual(
    guarded.validator_meta.fact_local_literal_guard,
    {
      version: 'fact_local_material_literals_v1',
      applied: true,
      original_ai_verdict: 'confirmed',
      downgraded: true,
      missing_literals: [{
        type: 'percentage',
        value: '30%',
        normalized: '30%',
      }],
    },
  );
});

test('fact-local guard is inert for non-confirmed AI verdicts', async () => {
  const fixture = loadJson(executionFixturePath);

  for (const originalVerdict of ['requires_review', 'rejected']) {
    const modelOutput = structuredClone(fixture.target_recorded_model_output);
    const response = JSON.parse(modelOutput.choices[0].message.content);
    const validation = response.validations.find(
      ({ fact_index: factIndex }) => factIndex === fixture.oracle.fact_index,
    );
    validation.verdict = originalVerdict;
    validation.reason_code = originalVerdict === 'rejected'
      ? 'value_not_supported'
      : 'insufficient_evidence';
    validation.reason_note = 'Synthetic non-confirmed control.';
    modelOutput.choices[0].message.content = JSON.stringify(response);

    const [checked] = await executeCode({
      code: checkerSource(),
      inputJsons: [modelOutput],
      sources: {
        'Развернуть units для AI Validator': [fixture.target_checker_source],
      },
    });
    const guarded = checked.validated_facts.find(
      ({ fact_index: factIndex }) => factIndex === fixture.oracle.fact_index,
    );

    assert.equal(guarded.ai_validation.verdict, originalVerdict);
    assert.deepEqual(guarded.validator_meta.fact_local_literal_guard, {
      version: 'fact_local_material_literals_v1',
      applied: false,
      original_ai_verdict: originalVerdict,
      downgraded: false,
      missing_literals: [],
    });
  }
});

test('fact-local normalization recognizes percent, date, money, and numbered identifiers', async () => {
  const cases = [
    fact({ factIndex: 0, valueText: 'Аванс 30%', evidenceText: 'Аванс составляет 30 %.' }),
    fact({ factIndex: 1, valueText: 'Срок до 01.09.2026', evidenceText: 'Срок установлен до 01/09/2026.' }),
    fact({ factIndex: 2, valueText: 'Цена 1 250 000,00 руб.', evidenceText: 'Цена: 1\u00a0250\u00a0000.00 руб' }),
    fact({
      factIndex: 3,
      valueText: 'Договор № AB-123/45, Приложение № 8',
      evidenceText: 'договор N AB‑123/45; приложение N 8.',
    }),
  ];
  const assessments = await assessFacts(cases);
  assert.equal(assessments.length, 4);
  assert.ok(assessments.every(({ result }) => result.missing_literals.length === 0));
});

test('material percent, date, money, duration, and identifier absent from this fact evidence are missing', async () => {
  const cases = [
    fact({ factIndex: 0, valueText: 'Аванс 30%', evidenceText: 'Аванс предусмотрен.' }),
    fact({ factIndex: 1, valueText: 'Срок до 01.09.2026', evidenceText: 'Срок будет согласован.' }),
    fact({ factIndex: 2, valueText: 'Цена 1 250 000 руб.', evidenceText: 'Цена указана в договоре.' }),
    fact({ factIndex: 3, valueText: 'Поставка в течение 45 рабочих дней', evidenceText: 'Поставка выполняется после заявки.' }),
    fact({ factIndex: 4, valueText: 'Приложение № 8', evidenceText: 'См. приложение к договору.' }),
  ];
  const assessments = await assessFacts(cases);
  assert.deepEqual(
    assessments.map(({ result }) => result.missing_literals.map(({ type }) => type)),
    [['percentage'], ['date'], ['money'], ['duration'], ['identifier']],
  );
});

test('neighboring facts and evidence_context cannot satisfy fact-local literals', async () => {
  const fixture = loadJson(executionFixturePath);
  const source = fixture.target_checker_source;
  const target = source.verified_facts.find(
    ({ fact_index: factIndex }) => factIndex === fixture.oracle.fact_index,
  );
  const [assessment] = await assessFacts([{
    ...target,
    ai_validation: { verdict: 'confirmed' },
  }]);
  assert.deepEqual(
    assessment.result.missing_literals.map(({ type, value }) => [type, value]),
    [['percentage', '30%']],
  );
});

test('existing positive controls remain confirmed under the deterministic guard', async () => {
  const fixture = loadJson(runtimeFixturePath);
  const positives = fixture.units.flatMap((unitCase) =>
    unitCase.expectations
      .filter(({ case_type: caseType }) => caseType === 'positive_control')
      .map((expectation) => {
        const sourceFact = unitCase.validator_input.verified_facts.find(
          ({ fact_index: factIndex }) => factIndex === expectation.fact_index,
        );
        return {
          ...structuredClone(sourceFact),
          ai_validation: { verdict: 'confirmed' },
        };
      }),
  );
  assert.equal(positives.length, 5);
  const assessments = await assessFacts(positives);
  assert.ok(assessments.every(({ result }) => result.missing_literals.length === 0));
});

test('execution 14103 sweep downgrades only the known oracle case', async () => {
  const fixture = loadJson(executionFixturePath);
  const assessments = await assessFacts(fixture.all_recorded_facts);
  assert.equal(assessments.length, 61);
  const downgrades = assessments
    .filter(({ original_verdict: verdict, result }) =>
      verdict === 'confirmed' && result.missing_literals.length > 0,
    )
    .map(({
      analysis_unit_id: analysisUnitId,
      fact_index: factIndex,
      field_key: fieldKey,
      result,
    }) => {
      return {
        analysis_unit_id: analysisUnitId,
        fact_index: factIndex,
        field_key: fieldKey,
        missing_literals: result.missing_literals,
      };
    });
  assert.deepEqual(downgrades, [{
    analysis_unit_id: fixture.oracle.analysis_unit_id,
    fact_index: fixture.oracle.fact_index,
    field_key: fixture.oracle.field_key,
    missing_literals: [{
      type: 'percentage',
      value: '30%',
      normalized: '30%',
    }],
  }]);
});
