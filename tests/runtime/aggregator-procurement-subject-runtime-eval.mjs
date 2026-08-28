import { pathToFileURL } from 'node:url';
import {
  LIVE_MODEL_ALIAS,
  evaluateProcurementSubjectOracle,
  evaluateRecordedFixture,
  loadAggregatorFixture,
  runAggregatorRound1,
} from '../helpers/aggregator-runtime-eval.mjs';

export function reportRuntimePipeline({
  mode,
  aiCalled,
  requestModel = null,
  responseModel = null,
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
      '   or: node tests/runtime/aggregator-procurement-subject-runtime-eval.mjs --live --allow-paid-ai\n',
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
      const recordedPreparation = await evaluateRecordedFixture(fixture);
      const request = {
        model: LIVE_MODEL_ALIAS,
        messages: [
          { role: 'system', content: recordedPreparation.prepared.system_prompt },
          { role: 'user', content: recordedPreparation.prepared.user_prompt },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 8192,
        stream: false,
      };
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        throw new Error(`Aggregator runtime endpoint returned HTTP ${response.status}`);
      }
      const modelResponse = await response.json();
      const pipeline = await runAggregatorRound1({ fixture, modelResponse });
      const report = reportRuntimePipeline({
        mode: 'live',
        aiCalled: true,
        requestModel: LIVE_MODEL_ALIAS,
        responseModel: modelResponse.model ?? null,
        fixture,
        pipeline,
      });
      process.stdout.write(`${JSON.stringify(report.payload)}\n`);
      process.exitCode = report.exitCode;
    }
  }
}
