import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import {
  LIVE_MODEL_ALIAS,
  betaAggregatorWorkflowPath,
  evaluateProcurementSubjectOracle,
  evaluateRecordedFixture,
  executeWorkflowCodeNode,
  loadAggregatorFixture,
  loadAggregatorWorkflow,
  repositoryRoot,
  runAggregatorRound1,
} from '../helpers/aggregator-runtime-eval.mjs';

const BETA_WORKFLOW_ID = 'ftvmrEHoMbPOAqZG';
const BETA_WORKFLOW_NAME = '[TEST CODEX] TENDER — Агрегация закупки';

function requireExplicitBetaWorkflowPath(workflowPath) {
  if (typeof workflowPath !== 'string' || workflowPath.trim() === '') {
    throw new Error(
      '[Aggregator runtime eval] Live mode requires an explicit beta workflowPath.',
    );
  }
  return path.resolve(workflowPath);
}

function loadBetaWorkflowArtifact(workflowPath) {
  const resolvedPath = requireExplicitBetaWorkflowPath(workflowPath);
  const rawWorkflow = fs.readFileSync(resolvedPath, 'utf8');
  const workflow = JSON.parse(rawWorkflow);
  if (workflow.id !== BETA_WORKFLOW_ID || workflow.name !== BETA_WORKFLOW_NAME) {
    throw new Error(
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
    throw new Error(
      '[Aggregator runtime eval] Semantic Aggregator jsonBody is missing.',
    );
  }
  const trimmed = jsonBody.trim();
  if (!trimmed.startsWith('={{') || !trimmed.endsWith('}}')) {
    throw new Error(
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

export async function prepareLiveBetaRuntimeRequest({ fixture, workflowPath }) {
  const artifact = loadBetaWorkflowArtifact(workflowPath);
  const prepared = await executeWorkflowCodeNode({
    workflow: artifact.workflow,
    nodeName: 'Подготовить запрос Semantic Aggregator',
    inputJson: fixture.aggregator_field_item,
  });
  const request = evaluateHttpRequestBody({
    workflow: artifact.workflow,
    prepared,
  });
  if (request.model !== LIVE_MODEL_ALIAS) {
    throw new Error(
      `[Aggregator runtime eval] Beta model alias mismatch: expected=${LIVE_MODEL_ALIAS}, actual=${request.model ?? null}`,
    );
  }
  return {
    prepared,
    request,
    workflow: {
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
      model_alias: request.model,
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
  workflow = null,
  fixture,
  pipeline,
}) {
  const basePayload = {
    mode,
    ai_called: aiCalled,
    request_model: requestModel,
    response_model: responseModel,
    checker_accepted: pipeline.checked.aggregation_validated === true,
    route: pipeline.route,
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
    return {
      payload: {
        ...basePayload,
        final_status: pipeline.final.aggregation_status,
        semantic_oracle_passed: oracle.passed,
        oracle,
      },
      exitCode: oracle.passed ? 0 : 1,
    };
  }

  if (pipeline.route === 'targeted_recheck') {
    if (pipeline.final !== null) {
      throw new Error(
        '[Aggregator runtime eval] targeted_recheck route requires final=null.',
      );
    }
    return {
      payload: {
        ...basePayload,
        final_status: null,
        false_resolved_prevented: true,
        semantic_outcome: 'deferred_to_targeted_recheck',
      },
      exitCode: 3,
    };
  }

  throw new Error(
    `[Aggregator runtime eval] Unsupported pipeline route: ${pipeline.route}`,
  );
}

function failUsage(message) {
  process.stderr.write(`${message}\n`);
  process.stderr.write(
    'Usage: node tests/runtime/aggregator-procurement-subject-runtime-eval.mjs --recorded\n' +
      '   or: node tests/runtime/aggregator-procurement-subject-runtime-eval.mjs --live --beta --allow-paid-ai\n',
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
  } else if (modes[0] === '--recorded') {
    const fixture = loadAggregatorFixture();
    const pipeline = await evaluateRecordedFixture(fixture);
    const report = reportRuntimePipeline({
      mode: 'recorded',
      aiCalled: false,
      fixture,
      pipeline,
    });
    process.stdout.write(`${JSON.stringify(report.payload)}\n`);
    process.exitCode = report.exitCode;
  } else if (!args.includes('--beta')) {
    failUsage('--live requires the additional explicit --beta flag.');
  } else if (!args.includes('--allow-paid-ai')) {
    failUsage('--live requires the additional explicit --allow-paid-ai flag.');
  } else {
    const endpoint = process.env.AGGREGATOR_RUNTIME_URL;
    const apiKey = process.env.AGGREGATOR_RUNTIME_API_KEY;
    if (!endpoint || !apiKey) {
      failUsage(
        '--live requires AGGREGATOR_RUNTIME_URL and AGGREGATOR_RUNTIME_API_KEY.',
      );
    } else {
      const fixture = loadAggregatorFixture();
      const workflowPath = process.env.AGGREGATOR_BETA_WORKFLOW_PATH ??
        betaAggregatorWorkflowPath;
      let runtimePreparation;
      try {
        runtimePreparation = await prepareLiveBetaRuntimeRequest({
          fixture,
          workflowPath,
        });
      } catch (error) {
        failUsage(`Beta workflow preparation failed: ${error.message}`);
      }
      if (runtimePreparation) {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(runtimePreparation.request),
        });
        if (!response.ok) {
          throw new Error(`Aggregator runtime endpoint returned HTTP ${response.status}`);
        }
        const modelResponse = await response.json();
        const pipeline = await evaluateLiveBetaModelResponse({
          fixture,
          modelResponse,
          workflowPath,
        });
        const report = reportRuntimePipeline({
          mode: 'live',
          aiCalled: true,
          requestModel: runtimePreparation.request.model,
          responseModel: modelResponse.model ?? null,
          workflow: runtimePreparation.workflow,
          fixture,
          pipeline,
        });
        process.stdout.write(`${JSON.stringify(report.payload)}\n`);
        process.exitCode = report.exitCode;
      }
    }
  }
}
