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

const executeCodeNode = (jsCode, json) => {
  const execute = new Function('$json', '$input', '$', jsCode);
  return execute(json, { first: () => ({ json }) }, undefined);
};

const fieldCatalog = [
  'procurement_subject',
  'nm_price_with_vat',
  'platform',
  'procedure_type',
  'application_deadline',
  'application_review_date',
  'results_date',
  'customer',
  'customer_contacts',
  'participation_cost',
  'participation_guarantee',
  'evaluation_criteria',
  'delivery_term',
  'payment_terms',
  'special_account_or_treasury',
  'bank_support',
  'government_contract',
  'rebidding',
  'national_regime',
  'advance_contract_guarantee',
  'warranty_obligations_guarantee',
  'licenses_certificates',
  'required_official_certificates',
  'similar_supply_experience',
  'analog_allowed',
  'analog_definition',
  'application_documents',
];

const agenticSnapshot = () => ({
  snapshot_version: 'tender_report_snapshot_v2',
  analysis_run_id: '00000000-0000-4000-8000-000000000001',
  analysis_run: {
    status: 'completed',
    tender_id: 'fixture',
    tender_number: null,
    tender_external_id: null,
    tender_meta: {},
  },
  field_results: fieldCatalog.map((fieldKey, index) => {
    const status = index === 0 ? 'resolved' : index === 1 ? 'requires_review' : 'not_found';
    const evidence = status === 'not_found' ? [] : [{
      artifact_key: 'document-001.docx',
      document: 'Документ <1>.docx',
      locator: 'таблица <2>, строка 3',
      quote: 'цитата <script>alert(1)</script>',
    }];
    return {
      field_index: index + 1,
      field_key: fieldKey,
      status,
      value_text: status === 'not_found' ? null : `Значение ${index + 1}`,
      confidence: null,
      requires_human_review: status === 'requires_review',
      resolution_method: 'codex_agentic_v1',
      result_json: { evidence },
    };
  }),
  source_index: { documents: [], facts: [], units: [] },
});

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
  assert.match(sql, /v_actual_count\s*<>\s*27/iu);
  assert.match(sql, /jsonb_array_elements[\s\S]*evidence/iu);
  assert.match(sql, /file_name/iu);
  assert.doesNotMatch(sql, /\b(?:PRICE|VAT|NEGATIVE)\b|quote_accuracy|evidence_sufficiency/iu);
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

test('agentic Report path executes all Code nodes and escapes an opaque locator', async () => {
  const workflow = await load('TENDER — Генерация отчета.json');
  const snapshot = agenticSnapshot();
  const validated = executeCodeNode(
    byName(workflow, 'Проверить Report Snapshot4').parameters.jsCode,
    { report_snapshot: snapshot },
  )[0].json;
  const adapted = executeCodeNode(
    byName(workflow, 'Адаптировать поля отчёта3').parameters.jsCode,
    validated,
  )[0].json;
  const model = executeCodeNode(
    byName(workflow, 'Собрать Report Model2').parameters.jsCode,
    adapted,
  )[0].json;
  const checkedModel = executeCodeNode(
    byName(workflow, 'Проверить Report Model2').parameters.jsCode,
    model,
  )[0].json;
  const rendered = executeCodeNode(
    byName(workflow, 'Сгенерировать HTML1').parameters.jsCode,
    checkedModel,
  )[0].json;

  assert.equal(adapted.adapted_fields[0].sources[0].locator, 'таблица <2>, строка 3');
  assert.match(rendered.html, /таблица &lt;2&gt;, строка 3/u);
  assert.doesNotMatch(rendered.html, /<script>alert\(1\)<\/script>/u);
});

test('agentic confidence exception does not weaken the legacy resolved contract', async () => {
  const workflow = await load('TENDER — Генерация отчета.json');
  const validator = byName(workflow, 'Проверить Report Snapshot4').parameters.jsCode;
  const legacySnapshot = agenticSnapshot();
  legacySnapshot.field_results[0].resolution_method = 'deterministic_metadata';

  assert.throws(
    () => executeCodeNode(validator, { report_snapshot: legacySnapshot }),
    /resolved invariant/u,
  );

  legacySnapshot.field_results[0].confidence = 1;
  assert.doesNotThrow(() => executeCodeNode(validator, { report_snapshot: legacySnapshot }));
});
