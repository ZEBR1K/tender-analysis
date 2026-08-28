import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL, fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..');
const workflowPath = path.join(
  repositoryRoot,
  'workflows',
  'n8n-exports',
  'TENDER — Обработать документ.json',
);
const promptArtifactPath = path.join(
  repositoryRoot,
  'prompts',
  'AI validator prompt v1.2.txt',
);
const fixturePath = path.join(
  testDirectory,
  'fixtures',
  'document-worker-validator-runtime-eval.json',
);
const evaluatorPath = path.join(
  testDirectory,
  'helpers',
  'ai-validator-runtime-eval.mjs',
);
const runtimeCommandPath = path.join(
  testDirectory,
  'runtime',
  'document-worker-validator-runtime-eval.mjs',
);

function loadWorkflow() {
  return JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
}

function validatorBody(workflow) {
  const validator = workflow.nodes.find(({ name }) => name === 'AI Validator v1');
  assert.ok(validator, 'AI Validator v1 node not found');
  return validator.parameters.jsonBody;
}

function systemPrompt(body) {
  const match = body.match(
    /role:\s*'system',\s*content:\s*`([\s\S]*?)`\s*\n\s*},/,
  );
  assert.ok(match, 'AI Validator system prompt not found');
  return match[1];
}

test('v1.2 prompt artifact is an exact clean copy of the imported validator system prompt', () => {
  assert.ok(fs.existsSync(promptArtifactPath), 'Missing v1.2 prompt artifact');
  const artifact = fs.readFileSync(promptArtifactPath, 'utf8');
  assert.equal(artifact, `${systemPrompt(validatorBody(loadWorkflow()))}\n`);
});

test('execution-derived fixtures preserve exact validator inputs for all required executions', () => {
  assert.ok(fs.existsSync(fixturePath), 'Missing exact runtime-eval fixture');
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  assert.equal(
    fixture.schema_version,
    'document_worker_ai_validator_runtime_eval_v1',
  );
  assert.deepEqual(fixture.source_execution_ids, [14094, 14096, 14097, 14102]);

  const coveredExecutions = new Set();
  for (const unitCase of fixture.units) {
    coveredExecutions.add(unitCase.source_execution_id);
    const input = unitCase.validator_input;
    assert.equal(input.analysis_unit_id, unitCase.analysis_unit_id);
    assert.ok(Array.isArray(input.verified_facts));
    assert.ok(input.verified_facts.length > 0);
    assert.equal(typeof input.evidence_context, 'object');
    assert.ok(Object.keys(input.evidence_context).length > 0);
    assert.equal(typeof unitCase.recorded_model_output, 'object');

    for (const fact of input.verified_facts) {
      assert.ok(Number.isInteger(fact.fact_index));
      assert.equal(typeof fact.field_key, 'string');
      assert.equal(typeof fact.value_text, 'string');
      assert.ok(Array.isArray(fact.evidence));
      for (const evidence of fact.evidence) {
        for (const requiredKey of ['semantic_block_id', 'quote', 'scope']) {
          assert.ok(
            Object.hasOwn(evidence, requiredKey),
            `Missing exact evidence.${requiredKey}`,
          );
        }
        assert.ok(
          Object.hasOwn(input.evidence_context, evidence.semantic_block_id),
          `Missing exact evidence_context block ${evidence.semantic_block_id}`,
        );
      }
    }

    for (const expectation of unitCase.expectations) {
      const fact = input.verified_facts.find(
        ({ fact_index: factIndex }) => factIndex === expectation.fact_index,
      );
      assert.ok(fact, `Expected fact is absent: ${expectation.case_id}`);
      assert.equal(fact.field_key, expectation.field_key);
    }
  }
  assert.deepEqual([...coveredExecutions].sort(), [14094, 14096, 14097, 14102]);
});

test('recorded outputs are evaluated against cardinality, linking, verdict, and positive-control contracts', async () => {
  assert.ok(fs.existsSync(evaluatorPath), 'Missing runtime-eval contract evaluator');
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const { evaluateValidatorOutput } = await import(pathToFileURL(evaluatorPath));

  for (const unitCase of fixture.units) {
    const expectedEvaluation = fixture.recorded_evaluations[unitCase.case_id];
    assert.ok(expectedEvaluation, `Missing recorded evaluation: ${unitCase.case_id}`);
    const result = evaluateValidatorOutput({
      validatorInput: unitCase.validator_input,
      modelOutput: unitCase.recorded_model_output,
      expectations: unitCase.expectations,
    });
    assert.deepEqual(
      result.violation_codes,
      expectedEvaluation.expected_violation_codes,
      unitCase.case_id,
    );
    assert.equal(result.valid, expectedEvaluation.expected_valid);
  }
});

test('runtime eval is an explicit command and refuses an implicit AI call', () => {
  assert.ok(fs.existsSync(runtimeCommandPath), 'Missing explicit runtime-eval command');
  const result = spawnSync(process.execPath, [runtimeCommandPath], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {},
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Choose exactly one explicit mode: --recorded or --live/);
});
