import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowUrl = (name) => new URL(`../workflows/n8n-exports/${name}`, import.meta.url);
const load = async (name) => JSON.parse(await readFile(workflowUrl(name), 'utf8'));

const byName = (workflow, name) => {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(node, `missing node ${name}`);
  return node;
};

const targets = (workflow, source) => (
  workflow.connections[source]?.main?.[0] ?? []
).map(({ node }) => node);

test('Finalization promotes one completed agentic job before its existing 27/27 barrier', async () => {
  const workflow = await load('TENDER — Финализация анализа.json');
  const trigger = byName(workflow, 'When Executed by Another Workflow');
  const promotion = byName(workflow, 'Продвинуть agentic FINAL');
  const sql = promotion.parameters.query;

  assert.equal(trigger.parameters.inputSource, 'passthrough');
  assert.equal(trigger.parameters.workflowInputs, undefined);
  assert.deepEqual(targets(workflow, trigger.name), [promotion.name]);
  assert.deepEqual(targets(workflow, promotion.name), ['Проверить 27 FINAL и завершить run']);

  for (const token of [
    'tender_agentic_jobs',
    'tender_agentic_field_results',
    'tender_agentic_documents',
    'tender_analysis_documents',
    'tender_analysis_field_results',
    'tender_field_final_v1',
    'codex_agentic_v1',
    'artifact_key',
    'agent_result',
    'agentic_job_id',
  ]) assert.match(sql, new RegExp(token, 'u'));

  assert.match(sql, /status\s*<>\s*'completed'/iu);
  assert.match(sql, /COUNT\(\*\)\s*<>\s*27/iu);
  assert.match(sql, /jsonb_array_elements[\s\S]*evidence/iu);
  assert.match(sql, /file_name/iu);
  assert.doesNotMatch(sql, /PRICE|VAT|NEGATIVE|quote_accuracy|evidence_sufficiency/iu);
});

test('agentic promotion is atomic, producer-isolated and replay-safe', async () => {
  const workflow = await load('TENDER — Финализация анализа.json');
  const promotion = byName(workflow, 'Продвинуть agentic FINAL');
  const sql = promotion.parameters.query;

  assert.equal(promotion.type, 'n8n-nodes-base.postgres');
  assert.equal(promotion.parameters.operation, 'executeQuery');
  assert.match(promotion.parameters.options.queryReplacement, /analysis_run_id/u);
  assert.match(promotion.parameters.options.queryReplacement, /agentic_job_id/u);
  assert.match(sql, /BEGIN;/iu);
  assert.match(sql, /FOR UPDATE/iu);
  assert.match(sql, /processing[\s\S]*aggregating/iu);
  assert.match(sql, /ON CONFLICT \(analysis_run_id, field_key\)/iu);
  assert.match(sql, /AGENTIC_PROMOTION_MIXED_PRODUCER/u);
  assert.match(sql, /AGENTIC_PROMOTION_DIFFERENT_AGENTIC_JOB/u);
  assert.match(sql, /COMMIT;/iu);
});

test('Monitor hands a completed exact-27 job to Finalization without restoring the legacy semantic route', async () => {
  const workflow = await load('TENDER — Агентский анализ — Монитор.json');
  const finalize = byName(workflow, 'Завершить agentic analysis');
  const serialized = JSON.stringify(workflow);

  assert.equal(finalize.type, 'n8n-nodes-base.executeWorkflow');
  assert.deepEqual(targets(workflow, 'Сохранить ровно 27 shadow rows'), [finalize.name]);
  assert.deepEqual(targets(workflow, finalize.name), ['Jobs по одному']);
  assert.equal(finalize.parameters.workflowInputs, undefined);
  assert.match(byName(workflow, 'Сохранить ровно 27 shadow rows').parameters.query, /analysis_run_id/u);
  assert.match(byName(workflow, 'Сохранить ровно 27 shadow rows').parameters.query, /agentic_job_id/u);
  assert.equal(finalize.parameters.options.waitForSubWorkflow, true);
  assert.doesNotMatch(serialized, /tender_analysis_facts|Targeted Recheck|Обработать документ/u);
});

test('Report accepts agentic null confidence and preserves opaque source locators', async () => {
  const workflow = await load('TENDER — Генерация отчета.json');
  const snapshotSql = byName(workflow, 'Получить Report Snapshot4').parameters.query;
  const validateSnapshot = byName(workflow, 'Проверить Report Snapshot4').parameters.jsCode;
  const adapt = byName(workflow, 'Адаптировать поля отчёта3').parameters.jsCode;
  const validateModel = byName(workflow, 'Проверить Report Model2').parameters.jsCode;
  const render = byName(workflow, 'Сгенерировать HTML1').parameters.jsCode;

  assert.match(snapshotSql, /resolution_method/u);
  assert.match(validateSnapshot, /codex_agentic_v1/u);
  assert.match(validateSnapshot, /confidence\s*!==\s*null/u);
  assert.match(adapt, /locator/u);
  assert.match(validateModel, /locator/u);
  assert.match(render, /source\.locator/u);
  assert.match(render, /escapeHtml\(source\.locator\)/u);
});
