const REQUIRED_SCHEMA_VERSION = 'ai_validator_v1';

function recordedContent(modelOutput) {
  if (typeof modelOutput === 'string') return modelOutput;
  const content = modelOutput?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('Model output does not contain choices[0].message.content');
  }
  return content;
}
export function parseValidatorOutput(modelOutput) {
  const content = recordedContent(modelOutput);
  return JSON.parse(content);
}

export function evaluateValidatorOutput({
  validatorInput,
  modelOutput,
  expectations = [],
}) {
  const violations = [];
  let parsedOutput;

  try {
    parsedOutput = parseValidatorOutput(modelOutput);
  } catch (error) {
    violations.push({
      code: 'invalid_model_output',
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      valid: false,
      violation_codes: ['invalid_model_output'],
      violations,
      parsed_output: null,
    };
  }

  if (parsedOutput.schema_version !== REQUIRED_SCHEMA_VERSION) {
    violations.push({
      code: 'schema_version_mismatch',
      expected: REQUIRED_SCHEMA_VERSION,
      actual: parsedOutput.schema_version,
    });
  }
  if (parsedOutput.analysis_unit_id !== validatorInput.analysis_unit_id) {
    violations.push({
      code: 'analysis_unit_id_mismatch',
      expected: validatorInput.analysis_unit_id,
      actual: parsedOutput.analysis_unit_id,
    });
  }

  const sourceFacts = validatorInput.verified_facts;
  const validations = Array.isArray(parsedOutput.validations)
    ? parsedOutput.validations
    : [];
  if (!Array.isArray(parsedOutput.validations)) {
    violations.push({
      code: 'validations_not_array',
      actual_type: typeof parsedOutput.validations,
    });
  }
  if (validations.length !== sourceFacts.length) {
    violations.push({
      code: 'validation_count_mismatch',
      expected: sourceFacts.length,
      actual: validations.length,
    });
  }

  const inputByFactIndex = new Map(
    sourceFacts.map((fact) => [fact.fact_index, fact]),
  );
  const validationsByFactIndex = new Map();
  for (const validation of validations) {
    const list = validationsByFactIndex.get(validation.fact_index) ?? [];
    list.push(validation);
    validationsByFactIndex.set(validation.fact_index, list);
    if (!inputByFactIndex.has(validation.fact_index)) {
      violations.push({
        code: 'unexpected_fact_index',
        fact_index: validation.fact_index,
      });
    }
  }

  for (const fact of sourceFacts) {
    const linked = validationsByFactIndex.get(fact.fact_index) ?? [];
    if (linked.length === 0) {
      violations.push({
        code: 'missing_fact_index',
        fact_index: fact.fact_index,
        field_key: fact.field_key,
      });
      continue;
    }
    if (linked.length > 1) {
      violations.push({
        code: 'duplicate_fact_index',
        fact_index: fact.fact_index,
        count: linked.length,
      });
    }
    for (const validation of linked) {
      if (validation.field_key !== fact.field_key) {
        violations.push({
          code: 'field_key_mismatch',
          fact_index: fact.fact_index,
          expected: fact.field_key,
          actual: validation.field_key,
        });
      }
    }
  }

  for (const expectation of expectations) {
    const linked = validationsByFactIndex.get(expectation.fact_index) ?? [];
    if (linked.length !== 1) continue;
    const validation = linked[0];
    if (!expectation.expected_allowed_verdicts.includes(validation.verdict)) {
      violations.push({
        code: 'verdict_not_allowed',
        case_id: expectation.case_id,
        fact_index: expectation.fact_index,
        expected_allowed_verdicts: expectation.expected_allowed_verdicts,
        actual: validation.verdict,
      });
    }
    if (
      expectation.case_type === 'positive_control' &&
      validation.verdict !== 'confirmed'
    ) {
      violations.push({
        code: 'positive_control_not_confirmed',
        case_id: expectation.case_id,
        fact_index: expectation.fact_index,
        actual: validation.verdict,
      });
    }
  }

  const violationCodes = [...new Set(violations.map(({ code }) => code))];
  return {
    valid: violationCodes.length === 0,
    violation_codes: violationCodes,
    violations,
    parsed_output: parsedOutput,
  };
}

export function buildValidatorRequest({
  systemPrompt,
  validatorInput,
  model =
    'google/gemini-3.7-flash@provider=google-ai-studio/flex&reasoning_effort=low',
}) {
  const candidateFacts = validatorInput.verified_facts.map((fact) => ({
    fact_index: fact.fact_index,
    field_key: fact.field_key,
    value_text: fact.value_text,
    extractor_status: fact.status,
    extractor_confidence: fact.confidence,
    extractor_review_reason_code: fact.review_reason_code,
    extractor_review_note: fact.review_note,
    evidence: fact.evidence.map((evidence) => ({
      semantic_block_id: evidence.semantic_block_id,
      quote: evidence.quote,
      scope: evidence.scope,
    })),
  }));
  const evidenceBlocks = Object.values(validatorInput.evidence_context).map(
    (block) => ({
      semantic_block_id: block.semantic_block_id,
      scope: block.scope,
      type: block.type,
      role: block.role,
      text: block.text,
    }),
  );

  return {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Проверь следующие результаты AI Extractor.

analysis_unit_id:
${validatorInput.analysis_unit_id}

КАНДИДАТЫ FACTS:

${JSON.stringify(candidateFacts, null, 2)}

ПОЛНЫЙ ТЕКСТ ИСПОЛЬЗОВАННЫХ SEMANTIC BLOCKS:

${JSON.stringify(evidenceBlocks, null, 2)}

Проверь каждый fact независимо и верни результат строго по ai_validator_v1.`,
      },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 8192,
    stream: false,
  };
}
