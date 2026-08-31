import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  executeWorkflowCodeNode,
  loadAggregatorWorkflow,
} from './helpers/aggregator-runtime-eval.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const workflowPath = path.join(
  testDirectory,
  '..',
  'workflows',
  'n8n-exports',
  'TENDER - Targeted Recheck.json',
);
const checkerNodeName = 'Проверить #2 evidence Targeted Recheck';
const prepareNodeName = 'Подготовить запрос #2 AI Targeted Recheck';
const validatorPrepareNodeName = 'Подготовить запрос #2 Validator Targeted Recheck';
const promptArtifactPath = path.join(
  testDirectory,
  '..',
  'prompts',
  'targeted-recheck-extractor-system-prompt-v1.1-2026-08-31.txt',
);

const existingOnlyEvidenceIndexes = [
  7, 8, 9, 10, 11, 12, 13,
  15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
];
const coordinateRepairEvidenceIndex = 14;

function semanticEvidence(analysisUnitId, semanticBlockId, quote) {
  return {
    source_type: 'semantic_block',
    analysis_unit_id: analysisUnitId,
    semantic_block_id: semanticBlockId,
    quote,
  };
}

function extractorResponse({ fieldKey, candidates, outcome = 'candidate_found' }) {
  return {
    id: `sanitized-execution-14256-${fieldKey}`,
    model: 'z-ai/glm-5.3-flash',
    choices: [
      {
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            schema_version: 'targeted_recheck_extractor_v1',
            field_key: fieldKey,
            recheck_outcome: outcome,
            candidates,
            recheck_note:
              outcome === 'insufficient_evidence'
                ? 'Sanitized execution-derived insufficient evidence.'
                : null,
          }),
        },
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

function candidate({ evidence, status = 'found' }) {
  return {
    candidate_index: 0,
    value_text: 'Sanitized execution-derived candidate value.',
    status,
    confidence: 0.92,
    evidence,
    review_reason_code: status === 'found' ? null : 'insufficient_evidence',
    review_note: status === 'found' ? null : 'Sanitized review note.',
  };
}

function sourceFor({
  fieldKey,
  fieldIndex,
  allowedSemanticBlocks,
  existingCandidates = [],
}) {
  return {
    analysis_run_id: '00000000-0000-4000-8000-000000014256',
    field_catalog_version: 'tender_fields_v1',
    field_index: fieldIndex,
    field_key: fieldKey,
    recheck_attempt: 1,
    original_aggregation: { status: 'requires_recheck' },
    existing_candidates: existingCandidates,
    recheck_context: [],
    recheck_profile: { title: fieldKey, objective: 'Sanitized regression.' },
    allowed_metadata: {},
    allowed_semantic_blocks: allowedSemanticBlocks,
  };
}

function simpleLinkedItem({ fieldKey, fieldIndex, status = 'found' }) {
  const evidence = Array.from({ length: 4 }, (_, index) =>
    semanticEvidence(
      `${fieldKey}_unit`,
      `${fieldKey}_block_${index}`,
      `${fieldKey} trusted quote ${index}`,
    ));
  return {
    source: sourceFor({
      fieldKey,
      fieldIndex,
      allowedSemanticBlocks: evidence.map((item) => ({
        analysis_unit_id: item.analysis_unit_id,
        semantic_block_id: item.semantic_block_id,
        text: item.quote,
      })),
      existingCandidates: [
        {
          fact_id: `${fieldKey}_existing_fact`,
          analysis_unit_id: evidence[0].analysis_unit_id,
          evidence: [{
            semantic_block_id: evidence[0].semantic_block_id,
            quote: evidence[0].quote,
          }],
        },
      ],
    }),
    response: extractorResponse({
      fieldKey,
      candidates: [candidate({ evidence, status })],
    }),
  };
}

function buildApplicationDocumentsItem() {
  const existingCandidates = Array.from({ length: 124 }, (_, index) => ({
    fact_id: `sanitized-existing-fact-${String(index).padStart(3, '0')}`,
    analysis_unit_id:
      index === 25 ? 'trusted_repair_unit' : `existing_unit_${String(index).padStart(3, '0')}`,
    evidence: [
      {
        semantic_block_id:
          index === 25 ? 'repair_block' : `existing_block_${String(index).padStart(3, '0')}`,
        quote:
          index === 25
            ? 'Unique exact quote for deterministic coordinate repair.'
            : `Exact stored existing candidate quote ${String(index).padStart(3, '0')}.`,
      },
    ],
  }));
  const allowedSemanticBlocks = Array.from({ length: 17 }, (_, index) => ({
    analysis_unit_id: `targeted_unit_${String(index).padStart(2, '0')}`,
    semantic_block_id: `targeted_block_${String(index).padStart(2, '0')}`,
    text: `Exact targeted context quote ${String(index).padStart(2, '0')}.`,
  }));
  const evidence = [];

  for (let index = 0; index < 7; index++) {
    const block = allowedSemanticBlocks[index];
    evidence.push(semanticEvidence(block.analysis_unit_id, block.semantic_block_id, block.text));
  }
  for (let index = 0; index < 7; index++) {
    const trusted = existingCandidates[index].evidence[0];
    evidence.push(semanticEvidence(
      existingCandidates[index].analysis_unit_id,
      trusted.semantic_block_id,
      trusted.quote,
    ));
  }
  evidence.push(semanticEvidence(
    'reported_wrong_unit',
    'repair_block',
    existingCandidates[25].evidence[0].quote,
  ));
  for (let index = 7; index < 25; index++) {
    const trusted = existingCandidates[index].evidence[0];
    evidence.push(semanticEvidence(
      existingCandidates[index].analysis_unit_id,
      trusted.semantic_block_id,
      trusted.quote,
    ));
  }
  for (let index = 7; index < 17; index++) {
    const block = allowedSemanticBlocks[index];
    evidence.push(semanticEvidence(block.analysis_unit_id, block.semantic_block_id, block.text));
  }

  assert.equal(evidence.length, 43);
  return {
    source: sourceFor({
      fieldKey: 'application_documents',
      fieldIndex: 27,
      allowedSemanticBlocks,
      existingCandidates,
    }),
    response: extractorResponse({
      fieldKey: 'application_documents',
      candidates: [candidate({ evidence })],
    }),
  };
}

function buildExecution14256Fixture() {
  return {
    provenance: {
      parent_execution_id: '14255',
      child_execution_id: '14256',
      workflow_id: 'nI47FcgzYwGzwGqy',
      sanitization: 'Identifiers and text replaced; counts, linking classes, and failure order retained.',
    },
    linked_items: [
      simpleLinkedItem({
        fieldKey: 'application_deadline',
        fieldIndex: 5,
        status: 'requires_review',
      }),
      simpleLinkedItem({ fieldKey: 'application_review_date', fieldIndex: 6 }),
      simpleLinkedItem({ fieldKey: 'results_date', fieldIndex: 7 }),
      {
        source: sourceFor({
          fieldKey: 'participation_cost',
          fieldIndex: 10,
          allowedSemanticBlocks: [],
          existingCandidates: [{
            fact_id: 'participation_cost_existing_fact',
            analysis_unit_id: 'participation_cost_unit',
            evidence: [{ semantic_block_id: 'participation_cost_block', quote: 'Stored quote.' }],
          }],
        }),
        response: extractorResponse({
          fieldKey: 'participation_cost',
          outcome: 'insufficient_evidence',
          candidates: [],
        }),
      },
      buildApplicationDocumentsItem(),
    ],
  };
}

async function checkItem(workflow, item) {
  return executeWorkflowCodeNode({
    workflow,
    nodeName: checkerNodeName,
    inputJson: item.response,
    sourceJsonByNode: { [prepareNodeName]: item.source },
  });
}

async function assertTechnicalFallback(workflow, item, errorPattern) {
  const checked = await checkItem(workflow, item);
  assert.equal(checked.technical_fallback_required, true);
  assert.equal(checked.technical_fallback_reason_code, 'targeted_recheck_model_validation_failed');
  assert.equal(checked.technical_fallback_stage, 'evidence_validation');
  assert.equal(checked.evidence_validated, false);
  assert.deepEqual(checked.candidates, []);
  assert.match(checked.technical_fallback_error.message, errorPattern);
  assert.equal(
    checked.targeted_recheck_meta.raw_ai_content,
    item.response.choices[0].message.content,
  );
}

function mutateApplicationItem(mutator) {
  const item = structuredClone(buildExecution14256Fixture().linked_items[4]);
  const result = JSON.parse(item.response.choices[0].message.content);
  mutator({ item, result });
  item.response.choices[0].message.content = JSON.stringify(result);
  return item;
}

test('execution 14256 accepts the trusted union, preserves 43 evidence, and audits one coordinate repair', async () => {
  const workflow = loadAggregatorWorkflow(workflowPath);
  const fixture = buildExecution14256Fixture();
  const item = fixture.linked_items[4];
  const rawResult = JSON.parse(item.response.choices[0].message.content);

  assert.equal(fixture.linked_items.length, 5);
  assert.equal(item.source.existing_candidates.length, 124);
  assert.equal(rawResult.candidates[0].evidence.length, 43);
  assert.equal(existingOnlyEvidenceIndexes.length, 25);

  const checked = await checkItem(workflow, item);
  assert.equal(checked.evidence_validated, true);
  assert.equal(checked.candidates[0].evidence.length, 43);
  for (const index of existingOnlyEvidenceIndexes) {
    assert.deepEqual(checked.candidates[0].evidence[index], rawResult.candidates[0].evidence[index]);
  }
  assert.equal(
    checked.candidates[0].evidence[coordinateRepairEvidenceIndex].analysis_unit_id,
    'trusted_repair_unit',
  );
  assert.equal(
    checked.candidates[0].evidence[coordinateRepairEvidenceIndex].quote,
    rawResult.candidates[0].evidence[coordinateRepairEvidenceIndex].quote,
  );
  assert.deepEqual(checked.targeted_recheck_meta.evidence_coordinate_repairs, [
    {
      candidate_index: 0,
      evidence_index: coordinateRepairEvidenceIndex,
      reported_analysis_unit_id: 'reported_wrong_unit',
      effective_analysis_unit_id: 'trusted_repair_unit',
      semantic_block_id: 'repair_block',
      repair_type: 'unique_semantic_block_and_exact_normalized_quote',
    },
  ]);

  const validatorPrepared = await executeWorkflowCodeNode({
    workflow,
    nodeName: validatorPrepareNodeName,
    inputJson: checked,
  });
  assert.equal(validatorPrepared.candidates[0].evidence.length, 43);
  assert.deepEqual(
    validatorPrepared.targeted_recheck_meta.evidence_coordinate_repairs,
    checked.targeted_recheck_meta.evidence_coordinate_repairs,
  );
});

test('the other four execution 14256 child items remain independently checker-valid', async () => {
  const workflow = loadAggregatorWorkflow(workflowPath);
  const fixture = buildExecution14256Fixture();
  const checked = await Promise.all(
    fixture.linked_items.slice(0, 4).map((item) => checkItem(workflow, item)),
  );
  assert.deepEqual(
    checked.map(({ field_key: fieldKey }) => fieldKey),
    ['application_deadline', 'application_review_date', 'results_date', 'participation_cost'],
  );
  assert.deepEqual(checked.map(({ evidence_validated: value }) => value), [true, true, true, true]);
});

test('direct targeted context and exact existing-candidate evidence are both trusted', async () => {
  const workflow = loadAggregatorWorkflow(workflowPath);
  const checked = await checkItem(workflow, buildExecution14256Fixture().linked_items[4]);
  assert.equal(checked.candidates[0].evidence[0].analysis_unit_id, 'targeted_unit_00');
  assert.equal(checked.candidates[0].evidence[7].analysis_unit_id, 'existing_unit_000');
  assert.deepEqual(checked.targeted_recheck_meta.evidence_coordinate_repairs.length, 1);
});

test('unknown semantic block and unknown pair remain fail-closed technical fallbacks', async () => {
  const workflow = loadAggregatorWorkflow(workflowPath);
  const unknownBlock = mutateApplicationItem(({ result }) => {
    result.candidates[0].evidence[0].semantic_block_id = 'unknown_block';
  });
  const noAlternative = mutateApplicationItem(({ result }) => {
    result.candidates[0].evidence[0].analysis_unit_id = 'unknown_unit';
    result.candidates[0].evidence[0].quote = 'Changed exact quote with no trusted match.';
  });
  await assertTechnicalFallback(workflow, unknownBlock, /неизвестная пара/iu);
  await assertTechnicalFallback(workflow, noAlternative, /неизвестная пара/iu);
});

test('ambiguous repeated semantic block and quote remains a fail-closed technical fallback', async () => {
  const workflow = loadAggregatorWorkflow(workflowPath);
  const item = mutateApplicationItem(({ item: mutableItem, result }) => {
    mutableItem.source.existing_candidates[120] = {
      fact_id: 'ambiguous-a',
      analysis_unit_id: 'ambiguous_unit_a',
      evidence: [{ semantic_block_id: 'ambiguous_block', quote: 'Repeated trusted quote.' }],
    };
    mutableItem.source.existing_candidates[121] = {
      fact_id: 'ambiguous-b',
      analysis_unit_id: 'ambiguous_unit_b',
      evidence: [{ semantic_block_id: 'ambiguous_block', quote: 'Repeated trusted quote.' }],
    };
    result.candidates[0].evidence[0] = semanticEvidence(
      'reported_unknown_unit',
      'ambiguous_block',
      'Repeated trusted quote.',
    );
  });
  await assertTechnicalFallback(workflow, item, /неоднознач|больше одной|несколько/iu);
});

test('known pair with a changed word or digit fails closed without coordinate jumping', async () => {
  const workflow = loadAggregatorWorkflow(workflowPath);
  const changedWord = mutateApplicationItem(({ result }) => {
    result.candidates[0].evidence[0].quote = 'Exact targeted altered quote 00.';
  });
  const changedDigit = mutateApplicationItem(({ result }) => {
    result.candidates[0].evidence[0].quote = 'Exact targeted context quote 99.';
  });
  await assertTechnicalFallback(workflow, changedWord, /quote отсутствует/iu);
  await assertTechnicalFallback(workflow, changedDigit, /quote отсутствует/iu);
});

test('same block ID with quote mismatch remains a fail-closed technical fallback', async () => {
  const workflow = loadAggregatorWorkflow(workflowPath);
  const item = mutateApplicationItem(({ result }) => {
    result.candidates[0].evidence[7].quote = 'Different quote for the same stored block.';
  });
  await assertTechnicalFallback(workflow, item, /quote отсутствует/iu);
});

test('malformed existing candidate coordinates cannot expand the trusted union', async () => {
  const workflow = loadAggregatorWorkflow(workflowPath);
  const malformedCases = [
    { analysis_unit_id: '', evidence: [{ semantic_block_id: 'malformed_block', quote: 'Malformed quote.' }] },
    { analysis_unit_id: 'malformed_unit', evidence: [{ semantic_block_id: '', quote: 'Malformed quote.' }] },
    { analysis_unit_id: 'malformed_unit', evidence: [{ semantic_block_id: 'malformed_block', quote: '' }] },
  ];
  for (const malformed of malformedCases) {
    const item = mutateApplicationItem(({ item: mutableItem, result }) => {
      mutableItem.source.existing_candidates[123] = { fact_id: 'malformed', ...malformed };
      result.candidates[0].evidence[0] = semanticEvidence(
        'malformed_unit',
        'malformed_block',
        'Malformed quote.',
      );
    });
    await assertTechnicalFallback(workflow, item, /неизвестная пара/iu);
  }
});

test('existing candidate table-coordinate normalization remains exact and symmetric', async () => {
  const workflow = loadAggregatorWorkflow(workflowPath);
  const item = mutateApplicationItem(({ item: mutableItem, result }) => {
    mutableItem.source.existing_candidates[0].evidence[0].quote =
      '[C2] Alpha [R2,C3] Beta 15.';
    result.candidates[0].evidence[7].quote = 'Alpha Beta 15.';
  });
  const checked = await checkItem(workflow, item);
  assert.equal(checked.candidates[0].evidence[7].quote, 'Alpha Beta 15.');
});

test('Targeted Recheck prompt aligns evidence coordinates with both trusted sources', async () => {
  const workflow = loadAggregatorWorkflow(workflowPath);
  const applicationItem = buildExecution14256Fixture().linked_items[4];
  const prepared = await executeWorkflowCodeNode({
    workflow,
    nodeName: prepareNodeName,
    inputJson: {
      analysis_run_id: applicationItem.source.analysis_run_id,
      field_catalog_version: 'tender_fields_v1',
      field_index: 27,
      field_key: 'application_documents',
      context_found: true,
      context_units: [{
        analysis_unit_id: 'targeted_unit_00',
        document_id: 'sanitized-document',
        document_index: 1,
        file_name: 'sanitized.pdf',
        file_extension: 'pdf',
        segments: [{
          semantic_block_id: 'targeted_block_00',
          text: 'Exact targeted context quote 00.',
        }],
      }],
      existing_candidates: applicationItem.source.existing_candidates,
      recheck_profile: {
        title: 'Application documents',
        objective: 'Check application documents.',
        rules: [],
      },
      tender_metadata: {},
      recheck_attempt: 1,
      original_aggregation: { status: 'requires_recheck' },
    },
  });
  assert.match(prepared.system_prompt, /TARGETED CONTEXT.*EXISTING CANDIDATES/is);
  assert.match(prepared.system_prompt, /copy.*candidate\.analysis_unit_id.*evidence\.semantic_block_id.*quote/is);
  assert.match(prepared.system_prompt, /never.*invent.*coordinates/is);
  assert.match(prepared.system_prompt, /does not.*prove.*completeness/is);

  const prepareNode = workflow.nodes.find(({ name }) => name === prepareNodeName);
  const promptMatch = prepareNode.parameters.jsCode.match(
    /const systemPrompt = `([\s\S]*?)`\.trim\(\);/u,
  );
  assert.ok(promptMatch, 'Unable to extract the complete system prompt template.');
  assert.equal(
    fs.readFileSync(promptArtifactPath, 'utf8').trimEnd(),
    promptMatch[1].trim(),
  );
});
