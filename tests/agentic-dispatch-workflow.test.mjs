import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

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
  assert.match(
    sql,
    /file_extension\s+IN\s*\(\s*'pdf'\s*,\s*'docx'\s*,\s*'xlsx'\s*,\s*'xls'\s*\)/iu,
    'Dispatch must stage legacy XLS as a raw source file',
  );
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
  assert.equal(download.parameters.options.proxy, '=');
  assert.equal(download.retryOnFail, true);
  assert.equal(download.maxTries, 3);
  assert.equal(download.waitBetweenTries, 5000);
  assert.equal(download.onError, 'continueErrorOutput');

  const upload = nodeByName(value, 'Загрузить оригинал в runner');
  assert.equal(upload.parameters.contentType, 'binaryData');
  assert.equal(upload.parameters.inputDataFieldName, 'data');
  assert.equal(upload.parameters.rawContentType, undefined);
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

test('runner JSON requests use autodetect so n8n resolves response streams before identity checks', async () => {
  const value = await workflow();
  for (const name of [
    'Создать job в runner',
    'Загрузить оригинал в runner',
    'Запечатать job',
    'Запустить Codex',
  ]) {
    const response = nodeByName(value, name).parameters.options.response.response;
    assert.equal(response.fullResponse, true, `${name} must preserve HTTP status and headers`);
    assert.equal(response.neverError, true, `${name} must route typed HTTP failures itself`);
    assert.equal(response.responseFormat, 'autodetect', `${name} must resolve JSON stream bodies on n8n 2.35`);
  }
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
  assert.match(mark, /status\s*=\s*'ready'/iu);
  assert.match(mark, /staged_documents\s*=\s*expected_documents/iu);
  assert.ok(nodeByName(value, 'Проверить start identity').onError === 'continueErrorOutput');
});

test('seal identity accepts the uppercase SHA-256 representation returned by the runner', async () => {
  const value = await workflow();
  const source = nodeByName(value, 'Проверить seal identity').parameters.jsCode;
  const jobId = '11111111-1111-4111-8111-111111111111';
  const inputManifestSha256 = 'A'.repeat(64);
  const output = await new vm.Script(`(async()=>{${source}})()`).runInNewContext({
    $input: {
      first: () => ({
        json: {
          body: {
            job_id: jobId,
            field_catalog_sha256: 'ABCBEA68911CE9FFAD9D436C9EABE708E12DBC4F04F7D5591CAFE4C58359B843',
            input_manifest_sha256: inputManifestSha256,
          },
        },
      }),
    },
    $: (name) => {
      assert.equal(name, 'Разобрать решение');
      return { first: () => ({ json: { job_id: jobId } }) };
    },
    String,
  });

  assert.equal(output[0].json.job_id, jobId);
  assert.equal(output[0].json.input_manifest_sha256, inputManifestSha256);
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

test('dispatch failure formatter cannot copy a signed URL from an untrusted transport error', async () => {
  const value = await workflow();
  const source = nodeByName(value, 'Сформировать typed failure').parameters.jsCode;
  const output = await new vm.Script(`(async()=>{${source}})()`).runInNewContext({
    $input: { first: () => ({ json: { error_code: 'HTTP_FAILED', error_message: 'GET https://signed.example/file?token=super-secret failed' } }) },
    $: (name) => name === 'Разобрать решение'
      ? { first: () => ({ json: { job_id: '11111111-1111-4111-8111-111111111111' } }) }
      : { item: { json: { documents: { source_document_id: 'doc-1' } } } },
    String,
  });
  assert.equal(output[0].json.error_code, 'HTTP_FAILED');
  assert.equal(output[0].json.error_message, 'Agentic dispatch step failed');
  assert.doesNotMatch(JSON.stringify(output), /https?:|signed\.example|super-secret/u);
});

test('pre-start remains dispatch-owned and ambiguous start becomes reconcilable', async () => {
  const value = await workflow();
  const barrier = nodeByName(value, 'Проверить staging barrier').parameters.query;
  assert.doesNotMatch(barrier, /SET\s+status\s*=\s*'ready'/iu);
  assert.match(barrier, /dispatch_execution_id\s*(?:=|<>)\s*\$2/iu);

  const sealReady = nodeByName(value, 'Зафиксировать sealed ready').parameters.query;
  assert.match(sealReady, /status='ready'/iu);
  assert.match(sealReady, /dispatch_execution_id\s*=\s*\$2/iu);
  assert.match(sealReady, /input_manifest_sha256\s*=\s*\$3/iu);
  assert.match(sealReady, /count\(\*\)[^;]+status='staged'[^;]+expected_documents/isu);

  const ambiguous = nodeByName(value, 'Сохранить ambiguous start').parameters.query;
  assert.match(ambiguous, /START_OUTCOME_UNKNOWN/u);
  assert.match(ambiguous, /dispatch_execution_id=NULL/iu);
  assert.doesNotMatch(ambiguous, /status='failed'/iu);
  assert.deepEqual(
    value.connections['Запустить Codex'].main[1].map(({ node }) => node),
    ['Сформировать ambiguous start'],
  );
  assert.deepEqual(
    value.connections['Проверить start identity'].main[1].map(({ node }) => node),
    ['Сформировать ambiguous start'],
  );
});

test('retry claim uses synchronized runner retryability and actual runner codes', async () => {
  const value = await workflow();
  const sql = nodeByName(value, 'Создать или загрузить job и manifest').parameters.query;
  for (const code of ['RUNNER_ORPHANED_EXECUTION', 'CODEX_PROCESS_FAILED', 'CODEX_TRANSPORT_ERROR', 'CODEX_TIMEOUT']) {
    assert.match(sql, new RegExp(code, 'u'));
  }
  assert.match(sql, /validation_summary[^\n]*runner_retryable/iu);
  assert.match(sql, /poll_owner_execution_id\s+IS\s+NULL/iu);
  assert.match(sql, /attempts\s*<\s*2/iu);
  assert.match(nodeByName(value, 'Зафиксировать running').parameters.query, /attempts\s*=\s*\$4::smallint/iu);
});

test('only a source-download failure gets one auditable full restage retry', async () => {
  const value = await workflow();
  const claim = nodeByName(value, 'Создать или загрузить job и manifest').parameters.query;
  assert.match(claim, /AGENTIC_SOURCE_DOWNLOAD_FAILED/u);
  assert.doesNotMatch(claim, /coalesce\(j\.error_code,'?'\)?\s*=\s*'AGENTIC_DISPATCH_FAILED'/iu);
  assert.match(claim, /attempts\s*=\s*0/iu);
  assert.match(claim, /input_manifest_sha256\s+IS\s+NULL/iu);
  assert.match(claim, /prestart_retry_used/iu);
  assert.match(claim, /jsonb_set/iu);

  assert.deepEqual(
    value.connections['Скачать оригинал'].main[1].map(({ node }) => node),
    ['Сформировать download failure'],
  );
  assert.deepEqual(
    value.connections['Сформировать download failure'].main[0].map(({ node }) => node),
    ['Сохранить typed failure'],
  );
  assert.deepEqual(
    value.connections['Проверить upload identity'].main[1].map(({ node }) => node),
    ['Сформировать typed failure'],
  );

  const classifier = nodeByName(value, 'Сформировать download failure').parameters.jsCode;
  const classified = await new vm.Script(`(async()=>{${classifier}})()`).runInNewContext({
    $input: { first: () => ({ json: { error_message: 'GET https://signed.example/?token=secret failed' } }) },
    $: (name) => name === 'Разобрать решение'
      ? { first: () => ({ json: { job_id: '11111111-1111-4111-8111-111111111111' } }) }
      : { item: { json: { documents: { source_document_id: 'doc-1' } } } },
  });
  assert.equal(classified[0].json.error_code, 'AGENTIC_SOURCE_DOWNLOAD_FAILED');
  assert.equal(classified[0].json.error_message, 'Agentic source document download failed');
  assert.doesNotMatch(JSON.stringify(classified), /https?:|signed\.example|secret/u);

  const staged = nodeByName(value, 'Зафиксировать staged документ').parameters.query;
  assert.match(staged, /d\.status\s+IN\s*\([^)]*'failed'/isu);
});

test('every guarded dispatch update returns one explicit outcome row', async () => {
  const value = await workflow();
  for (const name of [
    'Зафиксировать staged документ',
    'Проверить staging barrier',
    'Зафиксировать sealed ready',
    'Зафиксировать running',
    'Сохранить typed failure',
    'Сохранить ambiguous start',
  ]) {
    const sql = nodeByName(value, name).parameters.query;
    assert.match(sql, /ownership_lost|update_count|barrier_failed/iu, `${name} needs explicit zero-row outcome`);
    assert.match(sql, /SELECT/iu, `${name} must always select an outcome row`);
  }
});

test('dispatch SQL never applies unsupported aggregates directly to UUID columns', async () => {
  const value = await workflow();
  for (const node of value.nodes.filter((candidate) => candidate.type === 'n8n-nodes-base.postgres')) {
    const sql = node.parameters.query;
    assert.doesNotMatch(sql, /max\s*\(\s*(?:id|analysis_run_id)\s*\)/iu, `${node.name} aggregates UUID directly`);
  }
});
