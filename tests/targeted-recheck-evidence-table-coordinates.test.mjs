import assert from 'node:assert/strict';
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
const nodeName = 'Проверить #2 evidence Targeted Recheck';
const sourceNodeName = 'Подготовить запрос #2 AI Targeted Recheck';

function buildSource({
  text,
  analysisUnitId = 'doc_2_au_0002',
  semanticBlockId = 'sb_0075',
}) {
  return {
    analysis_run_id: '00000000-0000-4000-8000-000000014253',
    field_catalog_version: 'tender_fields_v1',
    field_index: 6,
    field_key: 'application_review_date',
    recheck_attempt: 1,
    original_aggregation: null,
    existing_candidates: [],
    recheck_context: {},
    recheck_profile: {},
    allowed_metadata: {},
    allowed_semantic_blocks: [
      {
        analysis_unit_id: analysisUnitId,
        semantic_block_id: semanticBlockId,
        text,
      },
    ],
  };
}

function buildAiResponse({
  quote,
  analysisUnitId = 'doc_2_au_0002',
  semanticBlockId = 'sb_0075',
}) {
  return {
    id: 'offline-execution-14253-regression',
    model: 'offline-no-ai',
    choices: [
      {
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            schema_version: 'targeted_recheck_extractor_v1',
            field_key: 'application_review_date',
            recheck_outcome: 'candidate_found',
            candidates: [
              {
                candidate_index: 0,
                value_text: 'Рассматриваются три части заявок.',
                status: 'found',
                confidence: 0.95,
                evidence: [
                  {
                    source_type: 'semantic_block',
                    analysis_unit_id: analysisUnitId,
                    semantic_block_id: semanticBlockId,
                    quote,
                  },
                ],
                review_reason_code: null,
                review_note: null,
              },
            ],
            recheck_note: null,
          }),
        },
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  };
}

async function validateEvidence({
  sourceText,
  quote,
  sourceUnitId,
  sourceBlockId,
  quoteUnitId,
  quoteBlockId,
}) {
  const workflow = loadAggregatorWorkflow(workflowPath);
  const source = buildSource({
    text: sourceText,
    analysisUnitId: sourceUnitId,
    semanticBlockId: sourceBlockId,
  });
  return executeWorkflowCodeNode({
    workflow,
    nodeName,
    inputJson: buildAiResponse({
      quote,
      analysisUnitId: quoteUnitId ?? sourceUnitId,
      semanticBlockId: quoteBlockId ?? sourceBlockId,
    }),
    sourceJsonByNode: {
      [sourceNodeName]: source,
    },
  });
}

async function assertEvidenceFallback(options, errorPattern) {
  const result = await validateEvidence(options);
  assert.equal(result.technical_fallback_required, true);
  assert.equal(result.technical_fallback_reason_code, 'targeted_recheck_model_validation_failed');
  assert.equal(result.technical_fallback_stage, 'evidence_validation');
  assert.equal(result.evidence_validated, false);
  assert.deepEqual(result.candidates, []);
  assert.match(result.technical_fallback_error.message, errorPattern);
}

test('execution 14253 table coordinates do not invalidate an otherwise exact quote', async () => {
  const quote =
    'Квалификационной части заявок Технической части заявок Коммерческой части заявок';
  const result = await validateEvidence({
    sourceText:
      '[C2] Квалификационной части заявок [C4] Технической части заявок [C6] Коммерческой части заявок',
    quote,
  });

  assert.equal(result.evidence_validated, true);
  assert.equal(result.candidates[0].evidence[0].quote, quote);
});

test('all exact production table-coordinate forms are removed before exact containment', async () => {
  const quote = 'Альфа Бета Гамма Дельта';
  const result = await validateEvidence({
    sourceText:
      '[C2] Альфа [C2-C5] Бета [R2,C3] Гамма [R2-R4,C3-C5] Дельта',
    quote,
  });

  assert.equal(result.evidence_validated, true);
});

test('table-coordinate normalization is symmetric for source text and quote', async () => {
  const result = await validateEvidence({
    sourceText: 'Альфа Бета Гамма Дельта',
    quote: '[C2] Альфа [C2-C5] Бета [R2,C3] Гамма [R2-R4,C3-C5] Дельта',
  });

  assert.equal(result.evidence_validated, true);
});

test('removing a semantic word still fails exact grounding', async () => {
  await assertEvidenceFallback(
    {
      sourceText: '[C2] Дата рассмотрения заявок 15 сентября 2026 года',
      quote: 'Дата заявок 15 сентября 2026 года',
    },
    /quote отсутствует в semantic block/iu,
  );
});

test('changing a semantic digit still fails exact grounding', async () => {
  await assertEvidenceFallback(
    {
      sourceText: '[R2,C3] Дата рассмотрения заявок 15 сентября 2026 года',
      quote: 'Дата рассмотрения заявок 16 сентября 2026 года',
    },
    /quote отсутствует в semantic block/iu,
  );
});

test('unknown semantic block reference pair still fails', async () => {
  await assertEvidenceFallback(
    {
      sourceText: 'Дата рассмотрения заявок 15 сентября 2026 года',
      quote: 'Дата рассмотрения заявок 15 сентября 2026 года',
      quoteBlockId: 'sb_unknown',
    },
    /неизвестная пара analysis_unit_id \+ semantic_block_id/iu,
  );
});

test('ordinary exact quote without table coordinates remains valid', async () => {
  const quote = 'Дата рассмотрения заявок 15 сентября 2026 года';
  const result = await validateEvidence({
    sourceText: quote,
    quote,
  });

  assert.equal(result.evidence_validated, true);
});
