import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import {
  LIVE_MODEL_ALIAS,
  aggregatorFixturePath,
  betaAggregatorWorkflowPath,
  evaluateProcurementSubjectOracle,
  evaluateRecordedFixture,
  executeWorkflowCodeNode,
  loadAggregatorFixture,
  repositoryRoot,
  runAggregatorRound1,
} from '../helpers/aggregator-runtime-eval.mjs';

const BETA_WORKFLOW_ID = 'ftvmrEHoMbPOAqZG';
const BETA_WORKFLOW_NAME = '[TEST CODEX] TENDER — Агрегация закупки';
export const ALLOWED_RUNTIME_MODEL_ALIASES = Object.freeze([
  'z-ai/glm-5.3-flash@provider=cloudflare&reasoning_effort=low',
  'google/gemini-3.7-flash@provider=google-ai-studio/flex&reasoning_effort=low',
]);
const ALLOWED_RUNTIME_MODEL_ALIAS_SET = new Set(ALLOWED_RUNTIME_MODEL_ALIASES);
const EXIT_CODE_SEMANTICS = Object.freeze({
  0: 'semantic_green_resolved',
  1: 'checker_rejection_or_oracle_failure',
  2: 'configuration_or_preflight_failure',
  3: 'safe_targeted_recheck_inconclusive',
});

export class RuntimePreflightError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RuntimePreflightError';
    this.exitCode = 2;
  }
}

class RuntimeHttpError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RuntimeHttpError';
    this.exitCode = 1;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function requireExplicitBetaWorkflowPath(workflowPath) {
  if (typeof workflowPath !== 'string' || workflowPath.trim() === '') {
    throw new RuntimePreflightError(
      '[Aggregator runtime eval] Live mode requires an explicit beta workflowPath.',
    );
  }
  const resolvedPath = path.resolve(workflowPath);
  if (resolvedPath !== path.resolve(betaAggregatorWorkflowPath)) {
    throw new RuntimePreflightError(
      '[Aggregator runtime eval] Refusing anything except the exact beta workflow artifact.',
    );
  }
  return resolvedPath;
}

function loadBetaWorkflowArtifact(workflowPath) {
  const resolvedPath = requireExplicitBetaWorkflowPath(workflowPath);
  const rawWorkflow = fs.readFileSync(resolvedPath, 'utf8');
  const workflow = JSON.parse(rawWorkflow);
  if (workflow.id !== BETA_WORKFLOW_ID || workflow.name !== BETA_WORKFLOW_NAME) {
    throw new RuntimePreflightError(
      `[Aggregator runtime eval] Refusing non-beta workflow artifact: id=${workflow.id ?? null}, name=${workflow.name ?? null}`,
    );
  }
  return {
    resolvedPath,
    rawWorkflow,
    workflow,
  };
}

function evaluateHttpRequestBody({ workflow, prepared }) {
  const httpNode = workflow.nodes.find(
    ({ name }) => name === 'Semantic Aggregator',
  );
  const jsonBody = httpNode?.parameters?.jsonBody;
  if (typeof jsonBody !== 'string') {
    throw new RuntimePreflightError(
      '[Aggregator runtime eval] Semantic Aggregator jsonBody is missing.',
    );
  }
  const trimmed = jsonBody.trim();
  if (!trimmed.startsWith('={{') || !trimmed.endsWith('}}')) {
    throw new RuntimePreflightError(
      '[Aggregator runtime eval] Semantic Aggregator jsonBody is not an n8n expression.',
    );
  }
  const expression = trimmed.slice(3, -2).trim();
  const context = vm.createContext({
    $json: structuredClone(prepared),
    structuredClone,
  });
  const request = new vm.Script(`(${expression})`).runInContext(context);
  return JSON.parse(JSON.stringify(request));
}

function findHttpNode(workflow) {
  const node = workflow.nodes.find(({ name }) => name === 'Semantic Aggregator');
  if (!node) {
    throw new RuntimePreflightError(
      '[Aggregator runtime eval] Semantic Aggregator HTTP node is missing.',
    );
  }
  return node;
}

function readHttpContract(httpNode) {
  const parameters = httpNode.parameters ?? {};
  if (
    parameters.method !== 'POST' ||
    typeof parameters.url !== 'string' ||
    parameters.url.trim() === '' ||
    parameters.sendBody !== true ||
    parameters.specifyBody !== 'json'
  ) {
    throw new RuntimePreflightError(
      '[Aggregator runtime eval] Unsupported beta HTTP node contract.',
    );
  }
  const timeoutMs = parameters.options?.timeout;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RuntimePreflightError(
      '[Aggregator runtime eval] Beta HTTP timeout is missing or invalid.',
    );
  }
  return {
    url: parameters.url,
    method: parameters.method,
    timeout_ms: timeoutMs,
  };
}

function resolveRuntimeModelOverride({ args = [], env = {} }) {
  const overrideFlag = args.includes('--allow-model-override');
  const aliasWasProvided = Object.hasOwn(env, 'AGGREGATOR_RUNTIME_MODEL_ALIAS');
  const rawAlias = aliasWasProvided
    ? env.AGGREGATOR_RUNTIME_MODEL_ALIAS
    : undefined;

  if (aliasWasProvided && !overrideFlag) {
    throw new RuntimePreflightError(
      'AGGREGATOR_RUNTIME_MODEL_ALIAS requires --allow-model-override.',
    );
  }
  if (overrideFlag && (typeof rawAlias !== 'string' || rawAlias.trim() === '')) {
    throw new RuntimePreflightError(
      '--allow-model-override requires a non-empty AGGREGATOR_RUNTIME_MODEL_ALIAS.',
    );
  }
  if (!overrideFlag) {
    return { applied: false, alias: null };
  }

  for (const requiredFlag of ['--live', '--beta', '--allow-paid-ai']) {
    if (!args.includes(requiredFlag)) {
      throw new RuntimePreflightError(
        `--allow-model-override requires ${requiredFlag}.`,
      );
    }
  }

  const alias = rawAlias.trim();
  if (!ALLOWED_RUNTIME_MODEL_ALIAS_SET.has(alias)) {
    throw new RuntimePreflightError(
      `Runtime model alias is not allowed by the exact A/B allow-list: ${alias}`,
    );
  }
  return { applied: true, alias };
}

export async function prepareLiveBetaRuntimeRequest({
  fixture,
  workflowPath,
  args = [],
  env = {},
}) {
  const artifact = loadBetaWorkflowArtifact(workflowPath);
  const prepared = await executeWorkflowCodeNode({
    workflow: artifact.workflow,
    nodeName: 'Подготовить запрос Semantic Aggregator',
    inputJson: fixture.aggregator_field_item,
  });
  const httpNode = findHttpNode(artifact.workflow);
  const artifactRequest = evaluateHttpRequestBody({
    workflow: artifact.workflow,
    prepared,
  });
  if (artifactRequest.model !== LIVE_MODEL_ALIAS) {
    throw new RuntimePreflightError(
      `[Aggregator runtime eval] Beta model alias mismatch: expected=${LIVE_MODEL_ALIAS}, actual=${artifactRequest.model ?? null}`,
    );
  }
  const override = resolveRuntimeModelOverride({ args, env });
  const request = structuredClone(artifactRequest);
  if (override.applied) request.model = override.alias;

  return {
    prepared,
    request,
    http: readHttpContract(httpNode),
    workflow: {
      workflow_id: artifact.workflow.id,
      workflow_name: artifact.workflow.name,
      workflow_path: path
        .relative(repositoryRoot, artifact.resolvedPath)
        .split(path.sep)
        .join('/'),
      workflow_sha256: sha256(artifact.rawWorkflow),
      model_alias: artifactRequest.model,
      artifact_model_alias: artifactRequest.model,
      effective_request_model_alias: request.model,
      model_override_applied: override.applied,
    },
    fixture: {
      source_execution_id: String(fixture.source?.execution_id ?? ''),
      fixture_sha256: sha256(fs.readFileSync(aggregatorFixturePath)),
    },
  };
}

export async function evaluateLiveBetaModelResponse({
  fixture,
  modelResponse,
  workflowPath,
}) {
  const artifact = loadBetaWorkflowArtifact(workflowPath);
  return runAggregatorRound1({
    fixture,
    modelResponse,
    workflowPath: artifact.resolvedPath,
  });
}

export function reportRuntimePipeline({
  mode,
  aiCalled,
  requestModel = null,
  responseModel = null,
  modelResponse = null,
  latencyMs = null,
  workflow = null,
  fixture,
  pipeline,
}) {
  const decisions = Array.isArray(pipeline.checked?.candidate_decisions)
    ? pipeline.checked.candidate_decisions
    : [];
  const primaryFactIds = decisions
    .filter(({ role }) => role === 'primary')
    .map(({ fact_id: factId }) => factId);
  const targetAnalysisUnitId =
    fixture.semantic_oracle?.target_analysis_unit_id ?? null;
  const targetFactId = targetAnalysisUnitId
    ? fixture.fact_ids_by_analysis_unit?.[targetAnalysisUnitId]
    : null;
  const targetRole = decisions.find(
    ({ fact_id: factId }) => factId === targetFactId,
  )?.role ?? null;
  const artifactModelAlias =
    workflow?.artifact_model_alias ?? workflow?.model_alias ?? null;
  const effectiveRequestModelAlias =
    requestModel ?? workflow?.effective_request_model_alias ?? artifactModelAlias;
  const rawCostFields = Object.fromEntries(
    Object.entries(modelResponse ?? {}).filter(([key]) => /cost|price/iu.test(key)),
  );
  const basePayload = {
    mode,
    ai_called: aiCalled,
    source_execution_id: fixture.source?.execution_id ?? null,
    fixture_sha256:
      fixture.source?.execution_id === '14104'
        ? sha256(fs.readFileSync(aggregatorFixturePath))
        : null,
    request_model: effectiveRequestModelAlias,
    artifact_model_alias: artifactModelAlias,
    effective_request_model_alias: effectiveRequestModelAlias,
    model_override_applied:
      workflow?.model_override_applied ??
      (artifactModelAlias != null &&
        effectiveRequestModelAlias != null &&
        artifactModelAlias !== effectiveRequestModelAlias),
    response_model: responseModel ?? modelResponse?.model ?? null,
    response_provider: modelResponse?.provider ?? null,
    finish_reason: modelResponse?.choices?.[0]?.finish_reason ?? null,
    response_usage:
      modelResponse?.usage === undefined
        ? null
        : JSON.parse(JSON.stringify(modelResponse.usage)),
    ...(Object.keys(rawCostFields).length > 0
      ? { response_cost_fields: JSON.parse(JSON.stringify(rawCostFields)) }
      : {}),
    latency_ms: latencyMs,
    checker_accepted: pipeline.checked.aggregation_validated === true,
    route: pipeline.route,
    primary_fact_ids: primaryFactIds,
    target_analysis_unit_id: targetAnalysisUnitId,
    target_role: targetRole,
    final_value_text: pipeline.final?.final_value_text ?? null,
    ...(workflow
      ? {
          workflow_id: workflow.workflow_id,
          workflow_name: workflow.workflow_name,
          workflow_path: workflow.workflow_path,
          workflow_sha256: workflow.workflow_sha256,
          model_alias: workflow.model_alias,
        }
      : {}),
  };

  if (pipeline.route === 'round1_final') {
    if (pipeline.final == null) {
      throw new Error(
        '[Aggregator runtime eval] round1_final route requires a FINAL result.',
      );
    }
    const oracle = evaluateProcurementSubjectOracle({
      fixture,
      checked: pipeline.checked,
      final: pipeline.final,
    });
    const exitCode = oracle.passed ? 0 : 1;
    return {
      payload: {
        ...basePayload,
        final_status: pipeline.final.aggregation_status,
        semantic_oracle_passed: oracle.passed,
        oracle_checks: oracle.checks,
        oracle,
        semantic_outcome: oracle.passed
          ? 'semantic_green_resolved'
          : 'semantic_oracle_failure',
        exit_code: exitCode,
        exit_code_semantics: EXIT_CODE_SEMANTICS,
      },
      exitCode,
    };
  }

  if (pipeline.route === 'targeted_recheck') {
    if (pipeline.final !== null) {
      throw new Error(
        '[Aggregator runtime eval] targeted_recheck route requires final=null.',
      );
    }
    const oracle = {
      passed: true,
      checks: {
        checker_accepted: pipeline.checked.aggregation_validated === true,
        targeted_recheck_route: pipeline.route === 'targeted_recheck',
        final_is_null: pipeline.final === null,
        round1_final_not_executed:
          !pipeline.executed_nodes.includes('Сформировать FINAL после Round 1'),
      },
      observed: {
        target_role: targetRole,
        primary_ids: primaryFactIds,
        final_value_text: null,
      },
    };
    oracle.passed = Object.values(oracle.checks).every(Boolean);
    const exitCode = oracle.passed ? 3 : 1;
    return {
      payload: {
        ...basePayload,
        final_status: null,
        semantic_oracle_passed: oracle.passed,
        oracle_checks: oracle.checks,
        oracle,
        false_resolved_prevented: oracle.passed,
        semantic_outcome: 'deferred_to_targeted_recheck',
        exit_code: exitCode,
        exit_code_semantics: EXIT_CODE_SEMANTICS,
      },
      exitCode,
    };
  }

  throw new Error(
    `[Aggregator runtime eval] Unsupported pipeline route: ${pipeline.route}`,
  );
}

function checkerRejectionResult({
  mode,
  aiCalled,
  preparation,
  fixture,
  modelResponse,
  latencyMs,
  error,
}) {
  const rawCostFields = Object.fromEntries(
    Object.entries(modelResponse ?? {}).filter(([key]) => /cost|price/iu.test(key)),
  );
  return {
    payload: {
      mode,
      ai_called: aiCalled,
      source_execution_id: fixture.source?.execution_id ?? null,
      fixture_sha256: sha256(fs.readFileSync(aggregatorFixturePath)),
      workflow_id: preparation.workflow.workflow_id,
      workflow_name: preparation.workflow.workflow_name,
      workflow_path: preparation.workflow.workflow_path,
      workflow_sha256: preparation.workflow.workflow_sha256,
      model_alias: preparation.workflow.model_alias,
      artifact_model_alias: preparation.workflow.artifact_model_alias,
      effective_request_model_alias:
        preparation.workflow.effective_request_model_alias,
      model_override_applied: preparation.workflow.model_override_applied,
      request_model: preparation.request.model,
      response_model: modelResponse?.model ?? null,
      response_provider: modelResponse?.provider ?? null,
      finish_reason: modelResponse?.choices?.[0]?.finish_reason ?? null,
      response_usage:
        modelResponse?.usage === undefined
          ? null
          : JSON.parse(JSON.stringify(modelResponse.usage)),
      ...(Object.keys(rawCostFields).length > 0
        ? { response_cost_fields: JSON.parse(JSON.stringify(rawCostFields)) }
        : {}),
      latency_ms: latencyMs,
      checker_accepted: false,
      route: null,
      final_status: null,
      semantic_oracle_passed: false,
      oracle_checks: { checker_accepted: false },
      oracle: {
        passed: false,
        checks: { checker_accepted: false },
        observed: null,
      },
      primary_fact_ids: [],
      target_analysis_unit_id:
        fixture.semantic_oracle?.target_analysis_unit_id ?? null,
      target_role: null,
      final_value_text: null,
      checker_error: error.message,
      semantic_outcome: 'checker_rejected',
      exit_code: 1,
      exit_code_semantics: EXIT_CODE_SEMANTICS,
    },
    pipeline: null,
    exitCode: 1,
  };
}

async function evaluatePreparedModelResponse({
  mode,
  aiCalled,
  fixture,
  modelResponse,
  workflowPath,
  preparation,
  latencyMs,
}) {
  try {
    const pipeline = await evaluateLiveBetaModelResponse({
      fixture,
      modelResponse,
      workflowPath,
    });
    return {
      ...reportRuntimePipeline({
        mode,
        aiCalled,
        requestModel: preparation.request.model,
        modelResponse,
        latencyMs,
        workflow: preparation.workflow,
        fixture,
        pipeline,
      }),
      pipeline,
    };
  } catch (error) {
    return checkerRejectionResult({
      mode,
      aiCalled,
      preparation,
      fixture,
      modelResponse,
      latencyMs,
      error,
    });
  }
}

function requireLiveFlags(args) {
  if (!args.includes('--live')) {
    throw new RuntimePreflightError('Live canary requires --live.');
  }
  if (!args.includes('--beta')) {
    throw new RuntimePreflightError(
      '--live requires the additional explicit --beta flag.',
    );
  }
  if (!args.includes('--allow-paid-ai')) {
    throw new RuntimePreflightError(
      '--live requires the additional explicit --allow-paid-ai flag.',
    );
  }
}

export async function runLiveCanary({
  args,
  env = process.env,
  fetchImpl = globalThis.fetch,
}) {
  requireLiveFlags(args);
  const apiKey = env.AGGREGATOR_RUNTIME_API_KEY;
  if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    throw new RuntimePreflightError(
      '--live requires AGGREGATOR_RUNTIME_API_KEY.',
    );
  }
  if (typeof fetchImpl !== 'function') {
    throw new RuntimePreflightError('Global fetch is unavailable.');
  }

  const fixture = loadAggregatorFixture();
  const workflowPath = env.AGGREGATOR_BETA_WORKFLOW_PATH ??
    betaAggregatorWorkflowPath;
  let preparation;
  try {
    preparation = await prepareLiveBetaRuntimeRequest({
      fixture,
      workflowPath,
      args,
      env,
    });
  } catch (error) {
    if (error instanceof RuntimePreflightError) throw error;
    throw new RuntimePreflightError(
      `Beta workflow preparation failed: ${error.message}`,
    );
  }

  const startedAt = Date.now();
  let response;
  try {
    response = await fetchImpl(preparation.http.url, {
      method: preparation.http.method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(preparation.request),
      signal: AbortSignal.timeout(preparation.http.timeout_ms),
    });
  } catch (error) {
    throw new RuntimeHttpError(
      `Aggregator runtime request failed: ${error.message}`,
    );
  }
  if (!response.ok) {
    throw new RuntimeHttpError(
      `Aggregator runtime endpoint returned HTTP ${response.status}`,
    );
  }

  let modelResponse;
  try {
    modelResponse = await response.json();
  } catch (error) {
    throw new RuntimeHttpError(
      `Aggregator runtime response is not JSON: ${error.message}`,
    );
  }
  const latencyMs = Date.now() - startedAt;
  return evaluatePreparedModelResponse({
    mode: 'live',
    aiCalled: true,
    fixture,
    modelResponse,
    workflowPath,
    preparation,
    latencyMs,
  });
}

function failUsage(message) {
  process.stderr.write(`${message}\n`);
  process.stderr.write(
    'Usage: node tests/runtime/aggregator-procurement-subject-runtime-eval.mjs --recorded\n' +
      '   or: node tests/runtime/aggregator-procurement-subject-runtime-eval.mjs --live --beta --allow-paid-ai\n' +
      '   or: node tests/runtime/aggregator-procurement-subject-runtime-eval.mjs --live --beta --allow-paid-ai --allow-model-override\n',
  );
  process.exitCode = 2;
}

const isDirectExecution =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  const args = process.argv.slice(2);
  const modes = ['--recorded', '--live'].filter((mode) => args.includes(mode));

  if (modes.length !== 1) {
    failUsage('Choose exactly one explicit mode: --recorded or --live.');
  } else if (
    modes[0] === '--recorded' &&
    (args.includes('--allow-model-override') ||
      Object.hasOwn(process.env, 'AGGREGATOR_RUNTIME_MODEL_ALIAS'))
  ) {
    failUsage('Runtime model override is allowed only in explicit live beta paid mode.');
  } else if (modes[0] === '--recorded') {
    const fixture = loadAggregatorFixture();
    const pipeline = await evaluateRecordedFixture(fixture);
    const report = reportRuntimePipeline({
      mode: 'recorded',
      aiCalled: false,
      modelResponse: fixture.recorded_false_resolved_api_response,
      fixture,
      pipeline,
    });
    process.stdout.write(`${JSON.stringify(report.payload)}\n`);
    process.exitCode = report.exitCode;
  } else {
    try {
      const result = await runLiveCanary({ args });
      process.stdout.write(`${JSON.stringify(result.payload)}\n`);
      process.exitCode = result.exitCode;
    } catch (error) {
      if (error?.exitCode === 2) {
        failUsage(error.message);
      } else {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = error?.exitCode ?? 1;
      }
    }
  }
}
