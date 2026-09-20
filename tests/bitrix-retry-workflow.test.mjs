import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = path.join(
  repositoryRoot,
  'workflows',
  'n8n-exports',
  'beta',
  '[BITRIX] TENDER — Повторить доставки Bitrix.json',
);
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

function byName(name) {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(node, `Missing node: ${name}`);
  return node;
}

function targets(name) {
  return (workflow.connections[name]?.main?.[0] ?? []).map(({ node }) => node);
}

test('retry worker is inactive, minute-scheduled, and fail-closed', () => {
  assert.equal(workflow.active, false);
  assert.equal(workflow.settings.errorWorkflow, '__BITRIX_ERROR_WORKFLOW_ID__');

  const trigger = byName('Каждую минуту');
  assert.equal(trigger.type, 'n8n-nodes-base.scheduleTrigger');
  assert.equal(trigger.typeVersion, 1.2);
  assert.deepEqual(trigger.parameters.rule.interval, [{ field: 'minutes', minutesInterval: 1 }]);
});

test('retry selection admits only due retry_wait rows behind the exact final barrier', () => {
  const node = byName('Выбрать доставки для повтора');
  assert.equal(node.type, 'n8n-nodes-base.postgres');
  assert.equal(node.typeVersion, 2.7);
  const sql = node.parameters.query;
  assert.match(sql, /d[.]status = 'retry_wait'/u);
  assert.match(sql, /d[.]next_attempt_at <= now\(\)/u);
  assert.doesNotMatch(sql, /'sent'|'failed'|'unknown'/u);
  assert.match(sql, /r[.]status = 'completed'/u);
  assert.match(sql, /\(27, 'application_documents'\)/u);
  assert.match(sql, /WHERE final_count = 27/u);
  assert.match(sql, /valid_status_count = 27/u);
  assert.match(sql, /valid_contract_count = 27/u);
});

test('retry regenerates one report and forwards each item unchanged to delivery', () => {
  const report = byName("Call 'TENDER — Генерация отчета'");
  assert.equal(report.type, 'n8n-nodes-base.executeWorkflow');
  assert.equal(report.typeVersion, 1.3);
  assert.equal(report.parameters.workflowId.value, 'ckPnP3hRhKu4Mf9u');
  assert.equal(report.parameters.mode, 'each');
  assert.equal(report.parameters.options.waitForSubWorkflow, true);

  const delivery = byName("Call 'TENDER — Отправить отчёт в Bitrix'");
  assert.equal(delivery.type, 'n8n-nodes-base.executeWorkflow');
  assert.equal(delivery.typeVersion, 1.3);
  assert.equal(delivery.parameters.workflowId.value, '__BITRIX_DELIVERY_WORKFLOW_ID__');
  assert.equal(delivery.parameters.mode, 'each');
  assert.equal(delivery.parameters.options.waitForSubWorkflow, true);
  assert.equal(Object.hasOwn(report.parameters, 'workflowInputs'), false);
  assert.equal(Object.hasOwn(delivery.parameters, 'workflowInputs'), false);

  assert.deepEqual(targets('Каждую минуту'), ['Выбрать доставки для повтора']);
  assert.deepEqual(targets('Выбрать доставки для повтора'), ["Call 'TENDER — Генерация отчета'"]);
  assert.deepEqual(targets("Call 'TENDER — Генерация отчета'"), ["Call 'TENDER — Отправить отчёт в Bitrix'"]);
});
