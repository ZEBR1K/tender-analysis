import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
const fixturePath = path.join(
  testDirectory,
  'fixtures',
  'targeted-recheck',
  'execution-14391-noncontiguous-table-quote.json',
);
const currentPromptArtifactPath = path.join(
  testDirectory,
  '..',
  'prompts',
  'targeted-recheck-extractor-system-prompt-v1.2-2026-09-03.txt',
);
const immutableLiveWorkflowPath = path.join(
  testDirectory,
  '..',
  'workflows',
  'n8n-exports',
  'beta',
  'TENDER - Targeted Recheck.live-4e0858c9-6ca2-42c7-969b-e74a2f91b8c6.json',
);
const nodeName = 'Подготовить запрос #2 AI Targeted Recheck';
const routeGuardChangedNodeNames = new Set([
  'Определить путь после Validator',
  'Собрать candidates для Round 2',
]);
const routeGuardAddedNodeNames = new Set([
  'Round 2 разрешён для поля?',
  'Сформировать requires_review — Round 2 запрещён',
  'Нормализовать FINAL поле8',
  'Сохранить FINAL результат поля в БД8',
  'Подготовить вызов Finalizer8',
  "Call 'TENDER — Финализация анализа'8",
]);
const strictEvidenceQuoteParagraph = `Каждый semantic_block evidence.quote должен быть одной непрерывной
дословной подстрокой текста одного semantic block.

Нельзя склеивать несколько строк или ячеек в один evidence.quote
с пропуском любого промежуточного текста.

Если нужны несколько раздельных фрагментов одного semantic block,
создавай отдельные evidence objects для каждого фрагмента
с теми же analysis_unit_id и semantic_block_id.`;

const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

function sha256(value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

function promptInput() {
  const table = fixture.synthetic_table;
  return {
    analysis_run_id: 'sanitized-analysis-run',
    field_catalog_version: 'tender_fields_v1',
    field_index: 20,
    field_key: 'advance_contract_guarantee',
    context_found: true,
    context_units: [{
      analysis_unit_id: fixture.provenance.analysis_unit_id,
      document_id: 'sanitized-document',
      document_index: 3,
      file_name: 'sanitized-table.docx',
      file_extension: 'docx',
      section_title: 'Sanitized guarantee table',
      source_pages: [],
      segments: [{
        semantic_block_id: fixture.provenance.semantic_block_id,
        type: 'table',
        role: 'primary',
        text: table.source_text,
      }],
    }],
    existing_candidates: [],
    recheck_profile: {
      title: 'Обеспечение исполнения договора / аванса',
      objective: 'Sanitized execution-derived prompt regression.',
      rules: [],
    },
    tender_metadata: {},
    recheck_attempt: 1,
    original_aggregation: { status: 'requires_recheck' },
  };
}

test('execution 14391 fixture reproduces noncontiguous sb_0459-style table stitching without client data', () => {
  assert.equal(fixture.fixture_kind, 'execution_derived_synthetic_structural_class');
  assert.equal(fixture.runtime_replay, false);
  assert.match(fixture.provenance.sanitization, /client text.*replaced/iu);
  assert.equal(fixture.provenance.field_index, 20);
  assert.equal(fixture.provenance.field_key, 'advance_contract_guarantee');
  assert.equal(fixture.observed_failure.existing_candidates, 13);
  assert.equal(fixture.observed_failure.allowed_semantic_blocks, 51);
  assert.equal(fixture.observed_failure.evidence_count, 12);
  assert.match(fixture.observed_failure.error_message, /quote отсутствует в semantic block/iu);

  const source = normalizeWhitespace(fixture.synthetic_table.source_text);
  const stitched = normalizeWhitespace(fixture.synthetic_table.invalid_stitched_quote);
  assert.equal(source.includes(stitched), false, 'Stitched quote must not be a continuous substring.');

  for (const omitted of fixture.synthetic_table.omitted_intermediate_text) {
    assert.equal(source.includes(normalizeWhitespace(omitted)), true);
    assert.equal(stitched.includes(normalizeWhitespace(omitted)), false);
  }

  for (const evidence of fixture.synthetic_table.required_separate_evidence) {
    assert.equal(source.includes(normalizeWhitespace(evidence.quote)), true);
    assert.equal(evidence.analysis_unit_id, fixture.provenance.analysis_unit_id);
    assert.equal(evidence.semantic_block_id, fixture.provenance.semantic_block_id);
  }
});

test('Targeted Recheck system prompt owns the exact continuous-quote invariant and current artifact', async () => {
  const workflow = loadAggregatorWorkflow(workflowPath);
  const prepared = await executeWorkflowCodeNode({
    workflow,
    nodeName,
    inputJson: promptInput(),
  });
  assert.equal(
    prepared.system_prompt.includes(strictEvidenceQuoteParagraph),
    true,
    'System prompt must contain the exact bounded continuous-quote paragraph.',
  );
  assert.equal(
    prepared.user_prompt.includes(strictEvidenceQuoteParagraph),
    false,
    'User prompt must not duplicate or replace the system-owned quote invariant.',
  );
  assert.equal(
    fs.readFileSync(currentPromptArtifactPath, 'utf8').trimEnd(),
    prepared.system_prompt,
    'Current v1.2 artifact must exactly equal the executable runtime system prompt.',
  );
});

test('canonical workflow preserves the TR-15 prompt-only baseline outside the later route-guard slice', () => {
  const workflow = loadAggregatorWorkflow(workflowPath);
  const immutableLiveWorkflow = loadAggregatorWorkflow(immutableLiveWorkflowPath);
  const baseline = fixture.parent_workflow_baseline;
  const target = workflow.nodes.find(({ name }) => name === nodeName);
  assert.ok(target, `Missing node: ${nodeName}`);
  assert.equal(
    workflow.nodes.length,
    baseline.node_count + routeGuardAddedNodeNames.size,
  );

  const workflowProjection = structuredClone(workflow);
  workflowProjection.nodes = workflowProjection.nodes
    .filter(({ name }) => !routeGuardAddedNodeNames.has(name))
    .map((node) => {
      if (node.name === nodeName) {
        return {
          ...node,
          parameters: {
            ...node.parameters,
            jsCode: '__TARGET_PROMPT_JSCODE__',
          },
        };
      }
      if (routeGuardChangedNodeNames.has(node.name)) {
        const baselineNode = immutableLiveWorkflow.nodes.find(
          ({ name }) => name === node.name,
        );
        assert.ok(baselineNode, `Missing immutable baseline node ${node.name}.`);
        return structuredClone(baselineNode);
      }
      return node;
    });
  for (const addedNodeName of routeGuardAddedNodeNames) {
    delete workflowProjection.connections[addedNodeName];
  }
  workflowProjection.connections['Можно завершить без Round 2?'].main[1] = [{
    node: 'Собрать candidates для Round 2',
    type: 'main',
    index: 0,
  }];

  const targetProjection = structuredClone(target);
  delete targetProjection.parameters.jsCode;

  assert.equal(
    sha256(workflowProjection),
    baseline.workflow_with_target_jsCode_sentinel_sha256,
    'A workflow path outside the allowed target parameters.jsCode changed.',
  );
  assert.equal(sha256(targetProjection), baseline.target_node_except_jsCode_sha256);
  assert.equal(
    sha256(workflowProjection.connections),
    baseline.connections_sha256,
  );
  assert.equal(sha256(workflow.settings), baseline.settings_sha256);
  assert.equal(
    sha256(workflowProjection.nodes.filter(({ name }) => name !== nodeName)),
    baseline.other_nodes_sha256,
  );
  assert.notEqual(
    sha256(target.parameters.jsCode),
    baseline.target_jsCode_sha256,
    'Target prompt jsCode still matches the parent baseline.',
  );
});
