import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const path = new URL('../workflows/n8n-exports/TENDER — Агентский анализ — Запуск.json', import.meta.url);

async function workflow() {
  return JSON.parse(await readFile(path, 'utf8'));
}

function nodeByName(value, name) {
  const node = value.nodes.find((candidate) => candidate.name === name);
  assert.ok(node, `missing node ${name}`);
  return node;
}

function stringsIn(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringsIn);
  return [];
}

test('dispatch export is inactive, identity-neutral and has the typed contract', async () => {
  const value = await workflow();
  assert.equal(value.name, 'TENDER — Агентский анализ — Запуск');
  assert.equal(value.active, false);
  assert.deepEqual(value.pinData, {});
  assert.equal(value.settings?.executionOrder, 'v1');
  assert.equal(value.settings?.errorWorkflow, 'AGENTIC_ERROR_WORKFLOW_ID');
  const trigger = nodeByName(value, 'When Executed by Another Workflow');
  assert.equal(trigger.type, 'n8n-nodes-base.executeWorkflowTrigger');
  assert.equal(trigger.typeVersion, 1.2);
  assert.deepEqual(trigger.parameters.workflowInputs.values, [
    { name: 'analysis_run_id', type: 'string' },
    { name: 'pipeline_version', type: 'string' },
    { name: 'replicate_index', type: 'number' },
  ]);
});

test('dispatch validates input and uses one atomic database preflight', async () => {
  const value = await workflow();
  const validation = nodeByName(value, 'Проверить вход').parameters.jsCode;
  assert.match(validation, /UUID/iu);
  assert.match(validation, /tender_agentic_pipeline_v1/u);
  assert.match(validation, /replicate_index/u);
  assert.match(validation, />= 1|< 1/u);

  const sql = nodeByName(value, 'Создать или загрузить job и manifest').parameters.query;
  assert.match(sql, /pg_advisory_xact_lock/iu);
  assert.match(sql, /tender_agentic_jobs/iu);
  assert.match(sql, /ON CONFLICT\s*\(analysis_run_id,\s*pipeline_version,\s*replicate_index\)/iu);
  assert.match(sql, /(?:rs\.)?registered_count\s*=\s*(?:rs\.)?documents_total/iu);
  assert.match(sql, /processable_count\s*>\s*0/iu);
  assert.match(sql, /tender_agentic_documents/iu);
  assert.match(sql, /jsonb_agg/iu);
  assert.match(sql, /completed|running/iu);
  assert.match(sql, /attempts\s*<\s*2/iu);
  assert.match(sql, /dispatch_execution_id/iu);
  assert.match(sql, /invalid_identity_count\s*=\s*0/iu);
  assert.match(sql, /'CODEX_TRANSPORT_ERROR'/u);
  assert.match(sql, /'retry'/u);
  assert.ok(stringsIn(value).filter((text) => text.includes('{{')).every((text) => text.startsWith('={{')));
});

test('dispatch stages sequentially and sends binary only between HTTP nodes', async () => {
  const value = await workflow();
  const loop = nodeByName(value, 'Документы по одному');
  assert.equal(loop.type, 'n8n-nodes-base.splitInBatches');
  assert.equal(loop.parameters.batchSize, 1);

  const download = nodeByName(value, 'Скачать оригинал');
  assert.equal(download.parameters.options.response.response.responseFormat, 'file');
  assert.equal(download.parameters.options.response.response.outputPropertyName, 'data');
  assert.equal(download.retryOnFail, false);
  assert.equal(download.onError, 'continueErrorOutput');

  const upload = nodeByName(value, 'Загрузить оригинал в runner');
  assert.equal(upload.parameters.contentType, 'binaryData');
  assert.equal(upload.parameters.inputDataFieldName, 'data');
  assert.equal(upload.parameters.authentication, 'genericCredentialType');
  assert.equal(upload.parameters.genericAuthType, 'httpHeaderAuth');
  assert.equal(upload.credentials.httpHeaderAuth.id, 'RUNNER_HEADER_AUTH_CREDENTIAL_ID');
  assert.equal(
    upload.parameters.headerParameters.parameters.find(({ name }) => name === 'Content-Type')?.value,
    'application/octet-stream',
  );
  assert.equal(upload.retryOnFail, false);
  assert.equal(upload.onError, 'continueErrorOutput');

  for (const node of value.nodes.filter((candidate) => candidate.type === 'n8n-nodes-base.code')) {
    assert.doesNotMatch(node.parameters.jsCode, /getBinaryDataBuffer|\.binary\s*=|binary:/u);
  }

  const restore = nodeByName(value, 'Восстановить manifest context').parameters.jsCode;
  assert.match(restore, /expected\.documents/u);
  assert.deepEqual(
    value.connections['Создать job в runner'].main[0].map(({ node }) => node),
    ['Восстановить manifest context'],
  );
  assert.match(upload.parameters.url, /\$\('Документы по одному'\)\.item/u);
  assert.doesNotMatch(JSON.stringify(upload.parameters), /Buffer\.from/u);
  assert.match(nodeByName(value, 'Создать job в runner').parameters.body, /download_url,file_name_base64,\.\.\.document/u);
});

test('dispatch verifies exact staging barrier before one seal and one start', async () => {
  const value = await workflow();
  const barrier = nodeByName(value, 'Проверить staging barrier').parameters.query;
  assert.match(barrier, /count\(\*\).*expected_documents/isu);
  assert.match(barrier, /status\s*=\s*'staged'/iu);
  assert.match(barrier, /pending|uploading|failed/iu);
  assert.match(barrier, /COUNT\(DISTINCT (?:d\.)?artifact_key\)/iu);
  assert.match(barrier, /COUNT\(DISTINCT (?:d\.)?document_index\)/iu);

  const seal = nodeByName(value, 'Запечатать job');
  const start = nodeByName(value, 'Запустить Codex');
  assert.match(seal.parameters.url, /\/seal/u);
  assert.match(start.parameters.url, /\/start/u);
  const mark = nodeByName(value, 'Зафиксировать running').parameters.query;
  assert.match(mark, /dispatch_execution_id/iu);
  assert.match(mark, /status\s+IN\s*\(\s*'ready'\s*,\s*'running'\s*\)/iu);
  assert.match(mark, /staged_documents\s*=\s*expected_documents/iu);
  assert.ok(nodeByName(value, 'Проверить start identity').onError === 'continueErrorOutput');
});

test('dispatch errors are typed and bounded without source URL or binary', async () => {
  const value = await workflow();
  const failureSql = nodeByName(value, 'Сохранить typed failure').parameters.query;
  assert.match(failureSql, /error_code/iu);
  assert.match(failureSql, /left\([^,]+,\s*500\)/iu);
  assert.match(failureSql, /dispatch_execution_id\s*=\s*\$4/iu);
  assert.match(failureSql, /UPDATE public\.tender_agentic_documents/iu);
  assert.match(failureSql, /source_document_id\s*=\s*NULLIF\(\$5/iu);
  assert.doesNotMatch(failureSql, /download_url|binary|base64/iu);
  assert.doesNotMatch(JSON.stringify(value.credentials ?? {}), /token|secret|password/iu);
});
