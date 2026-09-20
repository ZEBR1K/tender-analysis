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
  '[BITRIX] TENDER — Ошибка доставки Bitrix.json',
);
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

test('error workflow changes only the failed execution sending row to unknown', () => {
  assert.equal(workflow.active, false);
  assert.equal(workflow.nodes[0].type, 'n8n-nodes-base.errorTrigger');
  assert.equal(workflow.nodes[0].typeVersion, 1);

  const node = workflow.nodes.find(({ name }) => name === 'Зафиксировать неоднозначный исход доставки');
  assert.ok(node);
  assert.equal(node.type, 'n8n-nodes-base.postgres');
  assert.equal(node.typeVersion, 2.7);
  assert.match(node.parameters.query, /status = 'unknown'/u);
  assert.match(node.parameters.query, /next_attempt_at = NULL/u);
  assert.match(node.parameters.query, /WHERE n8n_execution_id = \$1/u);
  assert.match(node.parameters.query, /AND status = 'sending'/u);
  assert.doesNotMatch(node.parameters.query, /'sent'|'failed'|'pending'|'retry_wait'/u);
  assert.match(node.parameters.options.queryReplacement, /Error Trigger/u);
  assert.match(node.parameters.options.queryReplacement, /execution[.]id/u);
});

test('error workflow has no communication or raw-error persistence nodes', () => {
  const forbiddenTypes = new Set([
    'n8n-nodes-base.emailSend',
    'n8n-nodes-base.httpRequest',
    'n8n-nodes-base.respondToWebhook',
    'n8n-nodes-base.slack',
    'n8n-nodes-base.telegram',
    'n8n-nodes-base.webhook',
  ]);
  assert.equal(workflow.nodes.some(({ type }) => forbiddenTypes.has(type)), false);
  assert.doesNotMatch(
    workflow.nodes[1].parameters.query,
    /stack|request[_ ]?url|raw[_ ]?error|node[_ ]?parameters/iu,
  );
});
