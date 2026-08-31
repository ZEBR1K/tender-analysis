import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  LIVE_MODEL_ALIAS,
  aggregatorWorkflowPath,
  betaAggregatorWorkflowPath,
  loadAggregatorWorkflow,
} from './helpers/aggregator-runtime-eval.mjs';
import { evaluateApplicationDocumentsOracle } from './helpers/application-documents-oracle.mjs';
import * as runtimeEvaluator from './runtime/aggregator-application-documents-runtime-eval.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..');
const runtimeEvalPath = path.join(
  testDirectory,
  'runtime',
  'aggregator-application-documents-runtime-eval.mjs',
);
const applicationDocumentsTestPath = path.join(
  testDirectory,
  'aggregator-application-documents-execution-14173.test.mjs',
);
const fixturePath = path.join(
  testDirectory,
  'fixtures',
  'aggregator',
  'execution-14173-application-documents.json',
);

function loadFixture() {
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

test('application_documents offline test and runtime evaluator share a side-effect-free oracle helper', async () => {
  const fixture = loadFixture();
  const applicationDocumentsTestSource = fs.readFileSync(
    applicationDocumentsTestPath,
    'utf8',
  );
  const result = await runtimeEvaluator.evaluateOfflineModelResponse({
    mode: 'recorded',
    fixture,
    modelResponse: fixture.recorded_schema_valid_api_response,
    workflowPath: betaAggregatorWorkflowPath,
  });
  const directOracle = evaluateApplicationDocumentsOracle({
    fixture,
    checked: result.pipeline.checked,
    final: result.pipeline.final,
    route: result.pipeline.route,
  });

  assert.match(
    applicationDocumentsTestSource,
    /from '\.\/helpers\/application-documents-oracle\.mjs'/u,
  );
  assert.doesNotMatch(
    applicationDocumentsTestSource,
    /function evaluateApplicationDocumentsOracle\s*\(/u,
  );
  assert.deepEqual(result.oracle, directOracle);
});

test('live request is derived from the exact beta prepare and HTTP nodes plus fixture 14173', async () => {
  const fixture = loadFixture();
  const workflow = loadAggregatorWorkflow(betaAggregatorWorkflowPath);
  const httpNode = workflow.nodes.find(({ name }) => name === 'Semantic Aggregator');
  const preparedRuntime = await runtimeEvaluator.prepareLiveBetaRuntimeRequest({
    fixture,
    workflowPath: betaAggregatorWorkflowPath,
  });

  assert.equal(preparedRuntime.workflow.workflow_id, 'ftvmrEHoMbPOAqZG');
  assert.equal(
    preparedRuntime.workflow.workflow_path,
    'workflows/n8n-exports/beta/[TEST CODEX] TENDER — Агрегация закупки.json',
  );
  assert.match(preparedRuntime.workflow.workflow_sha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(preparedRuntime.workflow.version_metadata, {
    version_id: workflow.versionId ?? null,
    active_version_id: workflow.activeVersionId ?? null,
    updated_at: workflow.updatedAt ?? null,
    active: workflow.active ?? null,
  });
  assert.equal(
    preparedRuntime.request.messages[0].content,
    preparedRuntime.prepared.system_prompt,
  );
  assert.equal(
    preparedRuntime.request.messages[1].content,
    preparedRuntime.prepared.user_prompt,
  );
  assert.equal(preparedRuntime.http.url, httpNode.parameters.url);
  assert.equal(preparedRuntime.http.method, httpNode.parameters.method);
  assert.equal(preparedRuntime.request.max_tokens, 16384);
  assert.equal(preparedRuntime.request.model, LIVE_MODEL_ALIAS);
  assert.equal(
    preparedRuntime.request.model,
    'deepseek/deepseek-v4-pro-0813@provider=deepseek&reasoning_effort=low',
  );
  assert.equal(
    preparedRuntime.http.timeout_ms,
    180000,
  );
  assert.equal(preparedRuntime.http.timeout_ms, httpNode.parameters.options.timeout);
  assert.equal(preparedRuntime.prepared.allowed_fact_ids.length, 28);
});

test('live CLI requires both --beta and --allow-paid-ai before HTTP', () => {
  const baseEnv = {
    ...process.env,
    AGGREGATOR_RUNTIME_API_KEY: 'offline-placeholder-must-not-be-used',
  };
  const withoutBeta = spawnSync(
    process.execPath,
    [runtimeEvalPath, '--live', '--allow-paid-ai'],
    { cwd: repositoryRoot, encoding: 'utf8', env: baseEnv },
  );
  const withoutPaidPermission = spawnSync(
    process.execPath,
    [runtimeEvalPath, '--live', '--beta'],
    { cwd: repositoryRoot, encoding: 'utf8', env: baseEnv },
  );

  assert.equal(withoutBeta.status, 2, withoutBeta.stderr || withoutBeta.stdout);
  assert.match(withoutBeta.stderr, /--live requires[^\n]*--beta/iu);
  assert.doesNotMatch(withoutBeta.stderr, /fetch failed|ECONNREFUSED/iu);
  assert.equal(
    withoutPaidPermission.status,
    2,
    withoutPaidPermission.stderr || withoutPaidPermission.stdout,
  );
  assert.match(
    withoutPaidPermission.stderr,
    /--live requires[^\n]*--allow-paid-ai/iu,
  );
  assert.doesNotMatch(
    withoutPaidPermission.stderr,
    /fetch failed|ECONNREFUSED/iu,
  );
});

test('runtime evaluator rejects production workflow and has no production fallback', async () => {
  const fixture = loadFixture();
  const runtimeSource = fs.readFileSync(runtimeEvalPath, 'utf8');

  await assert.rejects(
    runtimeEvaluator.prepareLiveBetaRuntimeRequest({ fixture }),
    /explicit beta workflowPath/iu,
  );
  await assert.rejects(
    runtimeEvaluator.prepareLiveBetaRuntimeRequest({
      fixture,
      workflowPath: aggregatorWorkflowPath,
    }),
    /exact beta workflow artifact/iu,
  );
  assert.doesNotMatch(runtimeSource, /aggregatorWorkflowPath/u);
  assert.doesNotMatch(
    runtimeSource,
    /TENDER — Агрегация закупки\.json['"]/u,
  );
});

test('recorded schema-valid false-resolved response is contained and returns safe exit 3', async () => {
  const fixture = loadFixture();
  const result = await runtimeEvaluator.evaluateOfflineModelResponse({
    mode: 'recorded',
    fixture,
    modelResponse: fixture.recorded_schema_valid_api_response,
    workflowPath: betaAggregatorWorkflowPath,
  });

  assert.equal(result.exitCode, 3);
  assert.equal(result.payload.ai_called, false);
  assert.equal(result.payload.checker_accepted, true);
  assert.equal(result.payload.route, 'targeted_recheck');
  assert.equal(result.payload.final_status, null);
  assert.equal(result.payload.semantic_oracle_passed, true);
  assert.deepEqual(result.payload.failed_checks, []);
  assert.equal(result.payload.false_resolved_prevented, true);
  assert.equal(typeof result.payload.ambiguous_candidate_roles['0024'], 'string');
  assert.equal(typeof result.payload.ambiguous_candidate_roles['0028'], 'string');
  assert.equal(result.payload.final_value_text, null);
  assert.equal(result.pipeline.final, null);
  assert.equal(
    result.pipeline.checked.semantic_aggregator_meta.reported_status,
    'resolved',
  );
  assert.equal(
    typeof result.pipeline.checked.semantic_aggregator_meta.reported_result
      .final_value_text,
    'string',
  );
});

test('synthetic requires_recheck response returns exit 3, skips FINAL, and passes route-aware oracle', async () => {
  const fixture = loadFixture();
  const result = await runtimeEvaluator.evaluateOfflineModelResponse({
    mode: 'synthetic_requires_recheck',
    fixture,
    modelResponse:
      runtimeEvaluator.buildSafeRequiresRecheckResponse(fixture),
    workflowPath: betaAggregatorWorkflowPath,
  });

  assert.equal(result.exitCode, 3);
  assert.equal(result.payload.checker_accepted, true);
  assert.equal(result.payload.route, 'targeted_recheck');
  assert.equal(result.pipeline.final, null);
  assert.equal(
    result.pipeline.executed_nodes.includes('Сформировать FINAL после Round 1'),
    false,
  );
  assert.equal(result.payload.final_status, null);
  assert.equal(result.payload.final_value_text, null);
  assert.equal(result.payload.semantic_oracle_passed, true);
  assert.deepEqual(result.payload.failed_checks, []);
  assert.equal(result.payload.false_resolved_prevented, true);
  assert.equal(
    result.payload.semantic_outcome,
    'deferred_to_targeted_recheck',
  );
});

test('checker rejection returns exit 1 without pretending that routing or FINAL occurred', async () => {
  const fixture = loadFixture();
  const result = await runtimeEvaluator.evaluateOfflineModelResponse({
    mode: 'checker_rejection_control',
    fixture,
    modelResponse: { model: 'offline-invalid-response', choices: [] },
    workflowPath: betaAggregatorWorkflowPath,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.payload.checker_accepted, false);
  assert.equal(result.payload.route, null);
  assert.equal(result.payload.final_status, null);
  assert.equal(result.payload.semantic_oracle_passed, false);
  assert.deepEqual(result.payload.failed_checks, ['checker_rejected']);
  assert.equal(result.payload.false_resolved_prevented, true);
});

test('finish_reason=length checker rejection preserves safe runtime diagnostics and prevents false resolved', async () => {
  const fixture = loadFixture();
  const modelResponse = structuredClone(
    fixture.recorded_schema_valid_api_response,
  );
  const responseContent = modelResponse.choices[0].message.content;
  const reasoningContent = 'synthetic truncated reasoning control';
  modelResponse.id = 'synthetic-length-checker-rejection';
  modelResponse.model = 'synthetic-length-no-ai';
  modelResponse.choices[0].finish_reason = 'length';
  modelResponse.choices[0].message.reasoning_content = reasoningContent;
  modelResponse.usage = {
    prompt_tokens: 12000,
    completion_tokens: 16384,
    total_tokens: 28384,
  };

  const result = await runtimeEvaluator.evaluateOfflineModelResponse({
    mode: 'synthetic_length_checker_rejection',
    fixture,
    modelResponse,
    workflowPath: betaAggregatorWorkflowPath,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.payload.ai_called, false);
  assert.equal(result.payload.checker_accepted, false);
  assert.equal(result.payload.route, null);
  assert.equal(result.payload.final_status, null);
  assert.equal(result.payload.final_value_text, null);
  assert.equal(result.payload.false_resolved_prevented, true);
  assert.equal(result.payload.semantic_outcome, 'checker_rejected');
  assert.equal(result.payload.finish_reason, 'length');
  assert.deepEqual(result.payload.response_usage, modelResponse.usage);
  assert.equal(result.payload.response_content_chars, responseContent.length);
  assert.equal(
    result.payload.reasoning_content_chars,
    reasoningContent.length,
  );
  assert.match(result.payload.checker_error, /finish_reason|length/iu);
  assert.equal(JSON.stringify(result.payload).includes('Authorization'), false);
  assert.equal(
    JSON.stringify(result.payload).includes('offline-placeholder'),
    false,
  );
});

test('configuration failure is exit 2 and occurs before injected fetch', async () => {
  let fetchCalls = 0;

  await assert.rejects(
    runtimeEvaluator.runLiveCanary({
      args: ['--live', '--beta', '--allow-paid-ai'],
      env: {},
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error('fetch must not run');
      },
    }),
    (error) =>
      error?.exitCode === 2 &&
      /AGGREGATOR_RUNTIME_API_KEY/iu.test(error.message),
  );
  assert.equal(fetchCalls, 0);
});

test('offline injected transport control performs exactly one beta-derived HTTP call', async () => {
  const fixture = loadFixture();
  const calls = [];
  const result = await runtimeEvaluator.runLiveCanary({
    args: ['--live', '--beta', '--allow-paid-ai'],
    env: { AGGREGATOR_RUNTIME_API_KEY: 'offline-placeholder' },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () =>
          runtimeEvaluator.buildSafeRequiresRecheckResponse(fixture),
      };
    },
  });
  const betaWorkflow = loadAggregatorWorkflow(betaAggregatorWorkflowPath);
  const httpNode = betaWorkflow.nodes.find(
    ({ name }) => name === 'Semantic Aggregator',
  );
  const requestBody = JSON.parse(calls[0].options.body);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, httpNode.parameters.url);
  assert.equal(calls[0].options.method, httpNode.parameters.method);
  assert.equal(requestBody.model, result.payload.request_model);
  assert.equal(requestBody.max_tokens, 16384);
  assert.equal(requestBody.model, LIVE_MODEL_ALIAS);
  assert.equal(httpNode.parameters.options.timeout, 180000);
  assert.equal(result.payload.ai_called, true);
  assert.equal(result.exitCode, 3);
  assert.equal(result.payload.semantic_outcome, 'deferred_to_targeted_recheck');
});
