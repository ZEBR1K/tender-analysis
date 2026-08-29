import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import {
  LIVE_MODEL_ALIAS,
  betaAggregatorWorkflowPath,
  executeWorkflowCodeNode,
  repositoryRoot,
  runAggregatorRound1,
} from '../helpers/aggregator-runtime-eval.mjs';
import { evaluateApplicationDocumentsOracle } from '../helpers/application-documents-oracle.mjs';

const BETA_WORKFLOW_ID = 'ftvmrEHoMbPOAqZG';
const BETA_WORKFLOW_NAME = '[TEST CODEX] TENDER — Агрегация закупки';
const FIXTURE_PATH = path.join(
  repositoryRoot,
  'tests',
  'fixtures',
  'aggregator',
  'execution-14173-application-documents.json',
);

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

export function loadApplicationDocumentsFixture() {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
}

function requireExplicitBetaWorkflowPath(workflowPath) {
  if (typeof workflowPath !== 'string' || workflowPath.trim() === '') {
    throw new RuntimePreflightError(
      '[Application documents runtime eval] Live preparation requires an explicit beta workflowPath.',
    );
  }
  const resolvedPath = path.resolve(workflowPath);
  const expectedPath = path.resolve(betaAggregatorWorkflowPath);
  if (resolvedPath !== expectedPath) {
    throw new RuntimePreflightError(
      '[Application documents runtime eval] Refusing anything except the exact beta workflow artifact.',
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
      `[Application documents runtime eval] Refusing non-beta workflow metadata: id=${workflow.id ?? null}, name=${workflow.name ?? null}`,
    );
  }
  return {
    resolvedPath,
    rawWorkflow,
    workflow,
  };
}

function findHttpNode(workflow) {
  const node = workflow.nodes.find(({ name }) => name === 'Semantic Aggregator');
  if (!node) {
    throw new RuntimePreflightError(
      '[Application documents runtime eval] Semantic Aggregator HTTP node is missing.',
    );
  }
  return node;
}

function evaluateHttpRequestBody({ httpNode, prepared }) {
  const jsonBody = httpNode.parameters?.jsonBody;
  if (typeof jsonBody !== 'string') {
    throw new RuntimePreflightError(
      '[Application documents runtime eval] Semantic Aggregator jsonBody is missing.',
    );
  }
  const trimmed = jsonBody.trim();
  if (!trimmed.startsWith('={{') || !trimmed.endsWith('}}')) {
    throw new RuntimePreflightError(
      '[Application documents runtime eval] Semantic Aggregator jsonBody is not an n8n expression.',
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
      '[Application documents runtime eval] Unsupported beta HTTP node contract.',
    );
  }
  const timeoutMs = parameters.options?.timeout;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RuntimePreflightError(
      '[Application documents runtime eval] Beta HTTP timeout is missing or invalid.',
    );
  }
  return {
    url: parameters.url,
    method: parameters.method,
    timeout_ms: timeoutMs,
    response_format:
      parameters.options?.response?.response?.responseFormat ?? null,
  };
}

function workflowReportMetadata(artifact, requestModel) {
  return {
    workflow_id: artifact.workflow.id,
    workflow_name: artifact.workflow.name,
    workflow_path: path
      .relative(repositoryRoot, artifact.resolvedPath)
      .split(path.sep)
      .join('/'),
    workflow_sha256: crypto
      .createHash('sha256')
      .update(artifact.rawWorkflow)
      .digest('hex'),
    version_metadata: {
      version_id: artifact.workflow.versionId ?? null,
      active_version_id: artifact.workflow.activeVersionId ?? null,
      updated_at: artifact.workflow.updatedAt ?? null,
      active: artifact.workflow.active ?? null,
    },
    model_alias: requestModel,
  };
}

export async function prepareLiveBetaRuntimeRequest({ fixture, workflowPath }) {
  const artifact = loadBetaWorkflowArtifact(workflowPath);
  const prepared = await executeWorkflowCodeNode({
    workflow: artifact.workflow,
    nodeName: 'Подготовить запрос Semantic Aggregator',
    inputJson: fixture.aggregator_field_item,
  });
  const httpNode = findHttpNode(artifact.workflow);
  const request = evaluateHttpRequestBody({ httpNode, prepared });
  const http = readHttpContract(httpNode);
  if (request.model !== LIVE_MODEL_ALIAS) {
    throw new RuntimePreflightError(
      `[Application documents runtime eval] Beta model alias mismatch: expected=${LIVE_MODEL_ALIAS}, actual=${request.model ?? null}`,
    );
  }
  return {
    prepared,
    request,
    http,
    workflow: workflowReportMetadata(artifact, request.model),
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

export function buildSafeRequiresRecheckResponse(fixture) {
  const response = structuredClone(fixture.recorded_schema_valid_api_response);
  const content = JSON.parse(response.choices[0].message.content);
  const control = fixture.safe_requires_recheck_structural_control;

  response.id = control.response_id;
  response.model = control.model;
  content.status = 'requires_recheck';
  content.final_value_text = null;
  content.confidence = control.confidence;
  content.needs_recheck = true;
  content.recheck_reason_code = control.recheck_reason_code;
  content.recheck_note = control.recheck_note;
  response.choices[0].message.content = JSON.stringify(content);
  return response;
}

function ambiguousCandidateRoles({ fixture, checked }) {
  const decisionsById = new Map(
    (checked?.candidate_decisions ?? []).map((decision) => [
      decision.fact_id,
      decision,
    ]),
  );
  return Object.fromEntries(
    fixture.semantic_oracle.ambiguous_due_diligence_fact_ids.map((factId) => {
      const label = factId.match(/-(\d{4})-/u)?.[1] ?? factId;
      return [label, decisionsById.get(factId)?.role ?? null];
    }),
  );
}

function baseReport({
  mode,
  aiCalled,
  requestModel,
  responseModel,
  workflow,
}) {
  return {
    mode,
    ai_called: aiCalled,
    workflow_path: workflow.workflow_path,
    workflow_id: workflow.workflow_id,
    workflow_name: workflow.workflow_name,
    workflow_sha256: workflow.workflow_sha256,
    workflow_version_metadata: workflow.version_metadata,
    request_model: requestModel,
    response_model: responseModel,
  };
}

function safeResponseDiagnostics(modelResponse) {
  const choice = modelResponse?.choices?.[0];
  const message = choice?.message;
  const content = message?.content;
  const diagnostics = {
    finish_reason: choice?.finish_reason ?? null,
    response_usage:
      modelResponse?.usage === undefined
        ? null
        : JSON.parse(JSON.stringify(modelResponse.usage)),
    response_content_chars:
      typeof content === 'string' ? content.length : 0,
  };
  if (message && Object.hasOwn(message, 'reasoning_content')) {
    diagnostics.reasoning_content_chars =
      typeof message.reasoning_content === 'string'
        ? message.reasoning_content.length
        : 0;
  }
  return diagnostics;
}

export function reportRuntimePipeline({
  mode,
  aiCalled,
  requestModel,
  responseModel,
  workflow,
  fixture,
  pipeline,
}) {
  const oracle = evaluateApplicationDocumentsOracle({
    fixture,
    checked: pipeline.checked,
    final: pipeline.final,
    route: pipeline.route,
  });
  const payload = {
    ...baseReport({
      mode,
      aiCalled,
      requestModel,
      responseModel,
      workflow,
    }),
    checker_accepted: pipeline.checked.aggregation_validated === true,
    route: pipeline.route,
    final_status: pipeline.final?.aggregation_status ?? null,
    semantic_oracle_passed: oracle.passed,
    failed_checks: oracle.failed_checks,
    ambiguous_candidate_roles: ambiguousCandidateRoles({ fixture, checked: pipeline.checked }),
    final_value_text: pipeline.final?.final_value_text ?? null,
    false_resolved_prevented: oracle.passed,
    semantic_outcome:
      pipeline.route === 'targeted_recheck' && oracle.passed
        ? 'deferred_to_targeted_recheck'
        : oracle.passed
          ? 'round1_final_semantically_accepted'
          : 'false_resolved_detected',
    executed_nodes: pipeline.executed_nodes,
    oracle,
  };

  if (pipeline.route === 'targeted_recheck') {
    return {
      payload,
      oracle,
      exitCode: oracle.passed ? 3 : 1,
    };
  }
  if (pipeline.route === 'round1_final') {
    return {
      payload,
      oracle,
      exitCode: oracle.passed ? 0 : 1,
    };
  }
  return {
    payload: {
      ...payload,
      semantic_oracle_passed: false,
      failed_checks: ['unsupported_route'],
      false_resolved_prevented: false,
      semantic_outcome: 'unsupported_route',
    },
    oracle,
    exitCode: 1,
  };
}

function checkerRejectionResult({
  mode,
  aiCalled,
  requestModel,
  responseModel,
  workflow,
  fixture,
  modelResponse,
  error,
}) {
  return {
    payload: {
      ...baseReport({
        mode,
        aiCalled,
        requestModel,
        responseModel,
        workflow,
      }),
      checker_accepted: false,
      route: null,
      final_status: null,
      semantic_oracle_passed: false,
      failed_checks: ['checker_rejected'],
      ambiguous_candidate_roles: ambiguousCandidateRoles({ fixture, checked: null }),
      final_value_text: null,
      false_resolved_prevented: true,
      semantic_outcome: 'checker_rejected',
      ...safeResponseDiagnostics(modelResponse),
      checker_error: error.message,
      executed_nodes: ['Подготовить запрос Semantic Aggregator'],
    },
    pipeline: null,
    oracle: null,
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
        responseModel: modelResponse?.model ?? null,
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
      requestModel: preparation.request.model,
      responseModel: modelResponse?.model ?? null,
      workflow: preparation.workflow,
      fixture,
      modelResponse,
      error,
    });
  }
}

export async function evaluateOfflineModelResponse({
  mode,
  fixture,
  modelResponse,
  workflowPath,
}) {
  const preparation = await prepareLiveBetaRuntimeRequest({
    fixture,
    workflowPath,
  });
  return evaluatePreparedModelResponse({
    mode,
    aiCalled: false,
    fixture,
    modelResponse,
    workflowPath,
    preparation,
  });
}

function requireLiveFlags(args) {
  if (!args.includes('--live')) {
    throw new RuntimePreflightError('Live canary requires --live.');
  }
  if (!args.includes('--beta')) {
    throw new RuntimePreflightError('--live requires the additional explicit --beta flag.');
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

  const fixture = loadApplicationDocumentsFixture();
  let preparation;
  try {
    preparation = await prepareLiveBetaRuntimeRequest({
      fixture,
      workflowPath: betaAggregatorWorkflowPath,
    });
  } catch (error) {
    if (error instanceof RuntimePreflightError) throw error;
    throw new RuntimePreflightError(
      `Beta workflow preparation failed: ${error.message}`,
    );
  }

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
  return evaluatePreparedModelResponse({
    mode: 'live',
    aiCalled: true,
    fixture,
    modelResponse,
    workflowPath: betaAggregatorWorkflowPath,
    preparation,
  });
}

function usage() {
  return (
    'Usage: node tests/runtime/aggregator-application-documents-runtime-eval.mjs --recorded --beta\n' +
    '   or: node tests/runtime/aggregator-application-documents-runtime-eval.mjs --synthetic-requires-recheck --beta\n' +
    '   or: node tests/runtime/aggregator-application-documents-runtime-eval.mjs --live --beta --allow-paid-ai\n'
  );
}

function failUsage(message) {
  process.stderr.write(`${message}\n${usage()}`);
  process.exitCode = 2;
}

const isDirectExecution =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  const args = process.argv.slice(2);
  const modes = [
    '--recorded',
    '--synthetic-requires-recheck',
    '--live',
  ].filter((mode) => args.includes(mode));

  if (modes.length !== 1) {
    failUsage(
      'Choose exactly one mode: --recorded, --synthetic-requires-recheck, or --live.',
    );
  } else if (!args.includes('--beta')) {
    failUsage(`${modes[0]} requires the additional explicit --beta flag.`);
  } else if (modes[0] === '--live' && !args.includes('--allow-paid-ai')) {
    failUsage('--live requires the additional explicit --allow-paid-ai flag.');
  } else {
    try {
      let result;
      if (modes[0] === '--live') {
        result = await runLiveCanary({ args });
      } else {
        const fixture = loadApplicationDocumentsFixture();
        const modelResponse =
          modes[0] === '--recorded'
            ? fixture.recorded_schema_valid_api_response
            : buildSafeRequiresRecheckResponse(fixture);
        result = await evaluateOfflineModelResponse({
          mode: modes[0].slice(2).replaceAll('-', '_'),
          fixture,
          modelResponse,
          workflowPath: betaAggregatorWorkflowPath,
        });
      }
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
