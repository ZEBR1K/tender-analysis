import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  buildValidatorRequest,
  evaluateValidatorOutput,
} from '../helpers/ai-validator-runtime-eval.mjs';

const runtimeDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(runtimeDirectory, '..', '..');
const fixturePath = path.join(
  repositoryRoot,
  'tests',
  'fixtures',
  'document-worker-validator-runtime-eval.json',
);
const promptPath = path.join(
  repositoryRoot,
  'prompts',
  'AI validator prompt v1.2.txt',
);
const workflowPath = path.join(
  repositoryRoot,
  'workflows',
  'n8n-exports',
  'TENDER — Обработать документ.json',
);

async function renderDynamicSystemPrompt(promptTemplate, validatorInput) {
  const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
  const expandNode = workflow.nodes.find(
    ({ name }) => name === 'Развернуть units для AI Validator',
  );
  if (!expandNode) throw new Error('Expand AI Validator node not found.');
  const unit = {
    analysis_unit_meta: { analysis_unit_id: validatorInput.analysis_unit_id },
    verified_facts: structuredClone(validatorInput.verified_facts),
    evidence_context: structuredClone(validatorInput.evidence_context),
  };
  const inputItems = [{
    json: {
      dispatch_version: 'ai_validator_dispatch_v1',
      units_for_ai: [unit],
    },
  }];
  const context = vm.createContext({
    structuredClone,
    $input: { all: () => inputItems },
  });
  const result = await new vm.Script(
    `(async () => { ${expandNode.parameters.jsCode}\n })()`,
  ).runInContext(context);
  const promptContext = result?.[0]?.json?.validator_prompt_context;
  if (!promptContext?.field_profiles_text) {
    throw new Error('Dynamic validator field profiles were not rendered.');
  }
  return promptTemplate.replace(
    '${$json.validator_prompt_context.field_profiles_text}',
    promptContext.field_profiles_text,
  );
}

function failUsage(message) {
  process.stderr.write(`${message}\n`);
  process.stderr.write(
    'Usage: node tests/runtime/document-worker-validator-runtime-eval.mjs (--recorded | --live) [--case <case_id>]\n',
  );
  process.exitCode = 2;
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

const args = process.argv.slice(2);
const modes = ['--recorded', '--live'].filter((mode) => args.includes(mode));
if (modes.length !== 1) {
  failUsage('Choose exactly one explicit mode: --recorded or --live.');
} else {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const selectedCase = optionValue(args, '--case');
  const units = selectedCase
    ? fixture.units.filter(({ case_id: caseId }) => caseId === selectedCase)
    : fixture.units;

  if (selectedCase && units.length === 0) {
    failUsage(`Unknown --case: ${selectedCase}`);
  } else if (modes[0] === '--recorded') {
    let matchesFixtureContract = true;
    for (const unitCase of units) {
      const result = evaluateValidatorOutput({
        validatorInput: unitCase.validator_input,
        modelOutput: unitCase.recorded_model_output,
        expectations: unitCase.expectations,
      });
      const expected = fixture.recorded_evaluations[unitCase.case_id];
      const matches =
        expected !== undefined &&
        result.valid === expected.expected_valid &&
        JSON.stringify(result.violation_codes) ===
          JSON.stringify(expected.expected_violation_codes);
      matchesFixtureContract &&= matches;
      process.stdout.write(
        `${JSON.stringify({
          case_id: unitCase.case_id,
          source_model: unitCase.source_model,
          recorded_output_valid: result.valid,
          violation_codes: result.violation_codes,
          matches_fixture_contract: matches,
        })}\n`,
      );
    }
    if (!matchesFixtureContract) process.exitCode = 1;
  } else {
    const endpoint = process.env.AI_VALIDATOR_RUNTIME_URL;
    const apiKey = process.env.AI_VALIDATOR_RUNTIME_API_KEY;
    if (!endpoint || !apiKey) {
      failUsage(
        '--live requires AI_VALIDATOR_RUNTIME_URL and AI_VALIDATOR_RUNTIME_API_KEY.',
      );
    } else {
      const promptTemplate = fs.readFileSync(promptPath, 'utf8').replace(/\r?\n$/, '');
      let canaryPassed = true;
      for (const unitCase of units) {
        const systemPrompt = await renderDynamicSystemPrompt(
          promptTemplate,
          unitCase.validator_input,
        );
        const request = buildValidatorRequest({
          systemPrompt,
          validatorInput: unitCase.validator_input,
        });
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request),
        });
        if (!response.ok) {
          throw new Error(
            `Runtime endpoint returned HTTP ${response.status} for ${unitCase.case_id}`,
          );
        }
        const modelOutput = await response.json();
        const result = evaluateValidatorOutput({
          validatorInput: unitCase.validator_input,
          modelOutput,
          expectations: unitCase.expectations,
        });
        canaryPassed &&= result.valid;
        process.stdout.write(
          `${JSON.stringify({
            case_id: unitCase.case_id,
            runtime_model: modelOutput.model ?? request.model,
            valid: result.valid,
            violation_codes: result.violation_codes,
            violations: result.violations,
          })}\n`,
        );
      }
      if (!canaryPassed) process.exitCode = 1;
    }
  }
}
