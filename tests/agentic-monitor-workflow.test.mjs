import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const path = new URL('../workflows/n8n-exports/TENDER — Агентский анализ — Монитор.json', import.meta.url);
const load = async () => JSON.parse(await readFile(path, 'utf8'));
const find = (workflow, name) => {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(node, `missing node ${name}`);
  return node;
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
  assert.match(failed, /artifacts\s*=\s*artifacts\s*\|\|\s*\$6::jsonb/iu);
  assert.match(heartbeat, /artifacts\s*=\s*artifacts\s*\|\|\s*\$5::jsonb/iu);
  assert.doesNotMatch(failed, /not_found|tender_agentic_field_results/iu);
  assert.match(
    find(workflow, 'Сформировать monitor failure').parameters.jsCode,
    /\$\('Jobs по одному'\)\.item/u,
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
  assert.doesNotMatch(all, /legacy|tender_analysis_facts|tender_analysis_field_results/iu);
});
