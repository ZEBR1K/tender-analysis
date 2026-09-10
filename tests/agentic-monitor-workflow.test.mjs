import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const path = new URL('../workflows/n8n-exports/TENDER — Агентский анализ — Монитор.json', import.meta.url);
const load = async () => JSON.parse(await readFile(path, 'utf8'));
const find = (workflow, name) => {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(node, `missing node ${name}`);
  return node;
};
const targets = (workflow, source) => (
  workflow.connections[source]?.main?.[0] ?? []
).map(({ node }) => node);
const reaches = (workflow, source, target) => {
  const pending = [source];
  const seen = new Set();
  while (pending.length) {
    const current = pending.shift();
    if (current === target) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const output of workflow.connections[current]?.main ?? []) {
      for (const edge of output ?? []) pending.push(edge.node);
    }
  }
  return false;
};
const runCode = async (source, response, claimed, sourceNode = 'Jobs по одному') => {
  const script = new vm.Script(`(async()=>{${source}})()`);
  return script.runInNewContext({
    $input: { first: () => ({ json: response }) },
    $: (name) => {
      assert.equal(name, sourceNode);
      return { item: { json: claimed } };
    },
    Number,
    String,
  });
};

test('monitor is inactive, identity-neutral and scheduled every minute', async () => {
  const workflow = await load();
  assert.equal(workflow.name, 'TENDER — Агентский анализ — Монитор');
  assert.equal(workflow.active, false);
  assert.deepEqual(workflow.pinData, {});
  assert.equal(workflow.settings.errorWorkflow, 'AGENTIC_ERROR_WORKFLOW_ID');
  const trigger = find(workflow, 'Каждую минуту');
  assert.equal(trigger.type, 'n8n-nodes-base.scheduleTrigger');
  assert.deepEqual(trigger.parameters.rule.interval, [{ field: 'minutes', minutesInterval: 1 }]);
});

test('claim uses skip locked, exact execution owner, stale lease and limit two', async () => {
  const workflow = await load();
  const sql = find(workflow, 'Захватить до двух jobs').parameters.query;
  assert.match(sql, /FOR UPDATE SKIP LOCKED/iu);
  assert.match(sql, /LIMIT\s+2/iu);
  assert.match(sql, /poll_owner_execution_id\s*=\s*\$1/iu);
  assert.match(sql, /interval\s+'5 minutes'/iu);
  assert.match(sql, /COMMIT/iu);
  assert.doesNotMatch(find(workflow, 'Опросить runner').parameters.url, /BEGIN|COMMIT/iu);
});

test('monitor polls jobs one at a time with header auth and bounded status response', async () => {
  const workflow = await load();
  assert.equal(find(workflow, 'Jobs по одному').parameters.batchSize, 1);
  const poll = find(workflow, 'Опросить runner');
  assert.equal(poll.parameters.authentication, 'genericCredentialType');
  assert.equal(poll.parameters.genericAuthType, 'httpHeaderAuth');
  assert.equal(poll.credentials.httpHeaderAuth.id, 'RUNNER_HEADER_AUTH_CREDENTIAL_ID');
  assert.equal(poll.retryOnFail, false);
  assert.equal(poll.onError, 'continueErrorOutput');
});

test('runner JSON requests use autodetect so n8n resolves response streams before identity checks', async () => {
  const workflow = await load();
  for (const name of ['Опросить runner', 'Получить validated result', 'Reconcile runner start']) {
    const response = find(workflow, name).parameters.options.response.response;
    assert.equal(response.fullResponse, true, `${name} must preserve HTTP status and headers`);
    assert.equal(response.neverError, true, `${name} must route typed HTTP failures itself`);
    assert.equal(response.responseFormat, 'autodetect', `${name} must resolve JSON stream bodies on n8n 2.35`);
  }
});

test('nonterminal and failed paths persist only bounded metadata and release exact lease', async () => {
  const workflow = await load();
  const heartbeat = find(workflow, 'Сохранить heartbeat').parameters.query;
  assert.match(heartbeat, /heartbeat_at/iu);
  assert.match(heartbeat, /input_tokens|output_tokens/iu);
  assert.match(heartbeat, /artifacts/iu);
  assert.match(heartbeat, /poll_owner_execution_id\s*=\s*NULL/iu);
  assert.match(heartbeat, /poll_owner_execution_id\s*=\s*\$2/iu);
  assert.doesNotMatch(heartbeat, /tender_agentic_field_results/iu);

  const failed = find(workflow, 'Сохранить runner failure').parameters.query;
  assert.match(failed, /status='failed'/iu);
  assert.match(failed, /left\([^,]+,\s*500\)/iu);
  assert.match(failed, /input_tokens/iu);
  assert.match(failed, /artifacts\s*=\s*artifacts\s*\|\|\s*\$7::jsonb/iu);
  assert.match(heartbeat, /artifacts\s*=\s*artifacts\s*\|\|\s*\$4::jsonb/iu);
  assert.doesNotMatch(failed, /not_found|tender_agentic_field_results/iu);
  assert.match(
    find(workflow, 'Сформировать monitor failure').parameters.jsCode,
    /\$\('Jobs по одному'\)\.item/u,
  );
  assert.doesNotMatch(
    find(workflow, 'Сформировать monitor failure').parameters.jsCode,
    /source\.error_message|body\.error\?\.message/u,
  );
});

test('completed ingestion validates identity and atomically upserts exact catalog 27', async () => {
  const workflow = await load();
  const fetch = find(workflow, 'Получить validated result');
  assert.match(fetch.parameters.url, /\/result/u);
  const validate = find(workflow, 'Проверить envelope identity').parameters.jsCode;
  const pollIdentity = find(workflow, 'Нормализовать runner status').parameters.jsCode;
  for (const token of ['job_id', 'analysis_run_id', 'pipeline_version', 'field_catalog_version', 'field_catalog_sha256', 'input_manifest_sha256']) {
    assert.match(pollIdentity, new RegExp(token, 'u'));
  }
  for (const token of ['job_id', 'field_catalog_version', 'field_catalog_sha256', 'input_manifest_sha256', 'raw_result_sha256', 'validated_result_sha256']) {
    assert.match(validate, new RegExp(token, 'u'));
  }
  assert.match(validate, /fields\.length\s*!==\s*27/u);
  assert.match(validate, /\$\('Нормализовать runner status'\)\.item/u);

  const sql = find(workflow, 'Сохранить ровно 27 shadow rows').parameters.query;
  assert.match(sql, /BEGIN/iu);
  assert.match(sql, /jsonb_array_elements/iu);
  assert.match(sql, /INSERT INTO public\.tender_agentic_field_results/iu);
  assert.match(sql, /ON CONFLICT\s*\(job_id, field_key\)/iu);
  assert.match(sql, /count\(\*\)[^\n]*\)?\s*<>\s*27/iu);
  assert.match(sql, /array_agg\([^)]*field_key/iu);
  assert.match(sql, /RAISE EXCEPTION/iu);
  assert.match(sql, /status='completed'/iu);
  assert.match(sql, /COMMIT/iu);
  assert.match(sql, /set_config\('tender\.poll_owner',\$2::text,true\)/iu);
  assert.match(sql, /set_config\('tender\.catalog_version',\$5::text,true\)/iu);
});

test('completed duplicate is byte-compatible no-op and JSONL is never persisted', async () => {
  const workflow = await load();
  const claim = find(workflow, 'Захватить до двух jobs').parameters.query;
  assert.doesNotMatch(claim, /status\s*=\s*'completed'/iu);
  const all = JSON.stringify(workflow);
  assert.doesNotMatch(all, /codex-events|runner-events|jsonl/iu);
  const finalize = find(workflow, 'Завершить agentic analysis');
  assert.equal(finalize.type, 'n8n-nodes-base.executeWorkflow');
  assert.deepEqual(targets(workflow, 'Сохранить ровно 27 shadow rows'), [finalize.name]);
  assert.equal(finalize.parameters.workflowInputs, undefined);
  const saveSql = find(workflow, 'Сохранить ровно 27 shadow rows').parameters.query;
  assert.match(saveSql, /analysis_run_id/u);
  assert.match(saveSql, /agentic_job_id/u);
  assert.doesNotMatch(all, /legacy|tender_analysis_facts|Targeted Recheck|Обработать документ/iu);
});

test('monitor never claims a dispatch-owned pre-start job', async () => {
  const workflow = await load();
  const claim = find(workflow, 'Захватить до двух jobs').parameters.query;
  assert.match(claim, /dispatch_execution_id\s+IS\s+NULL/iu);
});

test('transient monitor failure only audits and releases its exact lease', async () => {
  const workflow = await load();
  const sql = find(workflow, 'Сохранить monitor audit и освободить lease').parameters.query;
  assert.match(sql, /poll_owner_execution_id\s*=\s*\$2/iu);
  assert.match(sql, /poll_owner_execution_id\s*=\s*NULL/iu);
  assert.doesNotMatch(sql, /status\s*=\s*'failed'/iu);
  assert.match(sql, /MONITOR_/u);
  assert.match(sql, /ownership_lost|update_count/iu);
  for (const source of ['Опросить runner', 'Проверить envelope identity'])
    assert.ok(reaches(workflow, source, 'Сформировать monitor failure'), `${source} must release rather than terminalize`);
});

test('only explicit identity-valid runner failed terminalizes and synchronizes attempt policy', async () => {
  const workflow = await load();
  const normalize = find(workflow, 'Нормализовать runner status').parameters.jsCode;
  assert.match(normalize, /runner_failed/u);
  assert.match(normalize, /failure(?:\?\.)?\.retryable|failure\.retryable/u);
  assert.match(normalize, /runner_attempt/u);
  const failed = find(workflow, 'Сохранить runner failure').parameters.query;
  assert.match(failed, /status='failed'/iu);
  assert.match(failed, /attempts\s*=\s*\$5::smallint/iu);
  assert.match(failed, /runner_retryable/iu);
  assert.match(failed, /dispatch_execution_id=NULL/iu);
  assert.match(failed, /ownership_lost|update_count/iu);
});

test('contract-invalid completed result has a distinct terminal policy and creates no fields', async () => {
  const workflow = await load();
  const sql = find(workflow, 'Сохранить terminal contract failure').parameters.query;
  assert.match(sql, /RESULT_CONTRACT_INVALID/u);
  assert.match(sql, /status='failed'/iu);
  assert.doesNotMatch(sql, /tender_agentic_field_results|not_found/iu);
  assert.ok(reaches(workflow, 'Проверить envelope identity', 'Сохранить terminal contract failure'));
});

test('status Code node executes the transport, identity, and explicit runner-failed classifications', async () => {
  const workflow = await load();
  const source = find(workflow, 'Нормализовать runner status').parameters.jsCode;
  const claimed = {
    id: '11111111-1111-4111-8111-111111111111',
    analysis_run_id: '22222222-2222-4222-8222-222222222222',
    pipeline_version: 'tender_agentic_pipeline_v1',
    field_catalog_version: 'catalog-v1',
    field_catalog_sha256: 'A'.repeat(64),
    input_manifest_sha256: 'B'.repeat(64),
    poll_owner_execution_id: 'poll-17',
  };
  const transient = (await runCode(source, { statusCode: 503, body: { arbitrary: 'untrusted' } }, claimed))[0].json;
  assert.equal(transient.outcome, 'monitor_failure');
  assert.equal(transient.error_code, 'MONITOR_STATUS_HTTP_FAILED');

  const identity = (await runCode(source, { statusCode: 200, body: { ...claimed, job_id: 'wrong', status: 'running' } }, claimed))[0].json;
  assert.equal(identity.outcome, 'monitor_failure');
  assert.equal(identity.error_code, 'MONITOR_STATUS_IDENTITY_INVALID');

  const failedBody = {
    job_id: claimed.id,
    analysis_run_id: claimed.analysis_run_id,
    pipeline_version: claimed.pipeline_version,
    field_catalog_version: claimed.field_catalog_version,
    field_catalog_sha256: claimed.field_catalog_sha256,
    input_manifest_sha256: claimed.input_manifest_sha256,
    status: 'failed',
    attempt: 2,
    failure: { code: 'CODEX_PROCESS_FAILED', message: 'bounded', retryable: false },
    usage: { input_tokens: 10, unexpected: 999 },
  };
  const failed = (await runCode(source, { statusCode: 200, body: failedBody }, claimed))[0].json;
  assert.equal(failed.outcome, 'runner_failed');
  assert.equal(failed.runner_attempt, 2);
  assert.equal(failed.runner_retryable, false);
  assert.deepEqual(Object.keys(failed.usage).sort(), ['cached_input_tokens', 'input_tokens', 'output_tokens', 'reasoning_output_tokens']);

  const invalidAttempt = (await runCode(source, { statusCode: 200, body: { ...failedBody, attempt: 3 } }, claimed))[0].json;
  assert.equal(invalidAttempt.outcome, 'monitor_failure');
  assert.equal(invalidAttempt.error_code, 'MONITOR_STATUS_ATTEMPT_INVALID');
});

test('repeated ready polling of an ambiguous Dispatch start routes one idempotent start call per owned poll', async () => {
  const workflow = await load();
  const normalizeSource = find(workflow, 'Нормализовать runner status').parameters.jsCode;
  const classifySource = find(workflow, 'Классифицировать start reconciliation').parameters.jsCode;
  const claimed = {
    id: '11111111-1111-4111-8111-111111111111', analysis_run_id: '22222222-2222-4222-8222-222222222222',
    pipeline_version: 'tender_agentic_pipeline_v1', field_catalog_version: 'catalog-v1',
    field_catalog_sha256: 'A'.repeat(64), input_manifest_sha256: 'B'.repeat(64),
    poll_owner_execution_id: 'poll-17', error_code: 'START_OUTCOME_UNKNOWN',
  };
  const body = {
    job_id: claimed.id, analysis_run_id: claimed.analysis_run_id, pipeline_version: claimed.pipeline_version,
    field_catalog_version: claimed.field_catalog_version, field_catalog_sha256: claimed.field_catalog_sha256,
    input_manifest_sha256: claimed.input_manifest_sha256, status: 'ready',
  };
  for (let poll = 0; poll < 2; poll++) {
    const normalized = (await runCode(normalizeSource, { statusCode: 200, body }, claimed))[0].json;
    const classified = (await runCode(classifySource, normalized, claimed))[0].json;
    assert.equal(classified.outcome, 'reconcile_start');
  }
  assert.ok(reaches(workflow, 'Start reconciliation?', 'Reconcile runner start'));
  assert.equal(find(workflow, 'Reconcile runner start').parameters.method, 'POST');
  assert.match(find(workflow, 'Reconcile runner start').parameters.url, /\/start/u);
  const sync = find(workflow, 'Синхронизировать reconciled running').parameters.query;
  assert.match(sync, /poll_owner_execution_id\s*=\s*\$2/iu);
  assert.match(sync, /status='ready'/iu);
  assert.match(sync, /error_code='START_OUTCOME_UNKNOWN'/iu);
  assert.match(sync, /attempts\s*=\s*\$3::smallint/iu);
  assert.match(sync, /ownership_lost|update_count/iu);
});

test('completed-envelope checker never throws on malformed closed-contract values', async () => {
  const workflow = await load();
  const source = find(workflow, 'Проверить envelope identity').parameters.jsCode;
  const claimed = {
    job_id: '11111111-1111-4111-8111-111111111111', analysis_run_id: '22222222-2222-4222-8222-222222222222',
    pipeline_version: 'tender_agentic_pipeline_v1', field_catalog_version: 'catalog-v1',
    field_catalog_sha256: 'A'.repeat(64), input_manifest_sha256: 'B'.repeat(64), poll_owner_execution_id: 'poll-17',
  };
  const fields = Array.from({ length: 27 }, (_, field_index) => ({ field_index, field_key: `field_${field_index}`, status: 'resolved', value_text: 'x' }));
  const validationFields = fields.map(({ field_index, field_key, status, value_text }) => ({ field_index, field_key, status, value_text, issues: [] }));
  const base = { statusCode: 200, body: {
    job_id: claimed.job_id,
    result: { schema_version: 'tender_agent_result_v1', field_catalog_version: claimed.field_catalog_version,
      field_catalog_sha256: claimed.field_catalog_sha256, input_manifest_sha256: claimed.input_manifest_sha256, fields },
    validation: { schema_version: 'tender_agent_validation_v1', valid: true, job_id: claimed.job_id,
      raw_result_sha256: 'C'.repeat(64), validated_result_sha256: 'D'.repeat(64), job_issues: [], fields: validationFields },
  } };
  const malformed = [
    { ...base, body: { ...base.body, validation: { ...base.body.validation, fields: [null, ...validationFields.slice(1)] } } },
    { ...base, body: { ...base.body, validation: { ...base.body.validation, job_issues: {} } } },
    { ...base, body: { ...base.body, result: { ...base.body.result, fields: [null, ...fields.slice(1)] } } },
    { ...base, body: { ...base.body, validation: { ...base.body.validation, fields: 'not-an-array' } } },
    { ...base, body: { ...base.body,
      result: { ...base.body.result, fields: fields.map((v, i) => i === 3 ? { ...v, field_index: '3' } : v) },
      validation: { ...base.body.validation, fields: validationFields.map((v, i) => i === 3 ? { ...v, field_index: '3' } : v) } } },
    { ...base, body: { ...base.body, validation: { ...base.body.validation, fields: validationFields.map((v, i) => i === 4 ? { ...v, field_key: 'mismatch' } : v) } } },
  ];
  for (const response of malformed) {
    const output = await runCode(source, response, claimed, 'Нормализовать runner status');
    assert.equal(output[0].json.outcome, 'contract_invalid');
  }
  assert.ok(reaches(workflow, 'Проверить envelope identity', 'Сохранить terminal contract failure'));
});

test('bounded technical metadata is normalized before every JSONB write', async () => {
  const workflow = await load();
  const normalize = find(workflow, 'Нормализовать runner status').parameters.jsCode;
  assert.match(normalize, /input_tokens/u);
  assert.match(normalize, /Number\.isSafeInteger/u);
  assert.match(normalize, /allowedArtifact|artifact/u);
  assert.match(normalize, /slice\(0,/u);
  assert.doesNotMatch(normalize, /\.\.\.body\.usage|\.\.\.body\.artifacts/u);
});

test('every guarded monitor update returns an explicit ownership outcome', async () => {
  const workflow = await load();
  for (const name of [
    'Сохранить heartbeat',
    'Сохранить runner failure',
    'Сохранить monitor audit и освободить lease',
    'Сохранить terminal contract failure',
  ]) {
    const sql = find(workflow, name).parameters.query;
    assert.match(sql, /ownership_lost|update_count/iu, `${name} needs explicit zero-row outcome`);
    assert.match(sql, /SELECT/iu);
  }
});

test('monitor SQL never applies unsupported aggregates directly to UUID columns', async () => {
  const workflow = await load();
  for (const node of workflow.nodes.filter((candidate) => candidate.type === 'n8n-nodes-base.postgres')) {
    const sql = node.parameters.query;
    assert.doesNotMatch(sql, /max\s*\(\s*id\s*\)/iu, `${node.name} aggregates UUID directly`);
  }
});
