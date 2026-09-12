import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const workflowUrl = new URL(
  '../workflows/n8n-exports/TENDER — Ошибка ручной загрузки.json',
  import.meta.url,
);

async function loadWorkflow() {
  return JSON.parse(await readFile(workflowUrl, 'utf8'));
}

function findNode(workflow, name) {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(node, `Missing workflow node: ${name}`);
  return node;
}

async function runNormalizer(source, payload) {
  return new vm.Script(`(async()=>{${source}})()`).runInNewContext({
    $input: { first: () => ({ json: payload }) },
    String,
  });
}

test('manual upload error workflow is isolated, audit-safe and identity-neutral', async () => {
  const workflow = await loadWorkflow();
  assert.equal(workflow.name, 'TENDER — Ошибка ручной загрузки');
  assert.equal(workflow.active, false);
  assert.deepEqual(workflow.pinData, {});
  for (const key of ['id', 'versionId', 'activeVersionId', 'meta']) assert.equal(key in workflow, false);
  assert.deepEqual(workflow.nodes.map(({ name }) => name), [
    'Error Trigger',
    'Нормализовать ошибку ручной загрузки',
    'Завершить только принадлежащий manual run',
  ]);
  assert.deepEqual(workflow.connections['Error Trigger'].main[0].map(({ node }) => node), [
    'Нормализовать ошибку ручной загрузки',
  ]);
  assert.deepEqual(workflow.connections['Нормализовать ошибку ручной загрузки'].main[0].map(({ node }) => node), [
    'Завершить только принадлежащий manual run',
  ]);
  assert.deepEqual(findNode(workflow, 'Завершить только принадлежащий manual run').credentials.postgres, {
    id: 'POSTGRES_CREDENTIAL_ID',
    name: 'KITATEH Tenders',
  });
});

test('manual upload error normalizer keeps only bounded safe execution identity and message', async () => {
  const workflow = await loadWorkflow();
  const source = findNode(workflow, 'Нормализовать ошибку ручной загрузки').parameters.jsCode;
  const normalized = (await runNormalizer(source, {
    execution: {
      id: ' 18777 ',
      error: { message: 'Dispatch failed after registration' },
      stack: 'private stack',
    },
    workflow: { name: 'TENDER — Ручная загрузка закупки' },
    binary: { data: 'private bytes' },
  }))[0].json;
  assert.deepEqual(Object.keys(normalized).sort(), ['error_code', 'error_message', 'execution_id']);
  assert.equal(normalized.execution_id, '18777');
  assert.equal(normalized.error_code, 'MANUAL_UPLOAD_WORKFLOW_FAILED');
  assert.equal(normalized.error_message, 'Dispatch failed after registration');

  const secret = (await runNormalizer(source, {
    execution: { id: '18777', error: { message: 'token=super-secret-value' } },
    workflow: { name: 'TENDER — Ручная загрузка закупки' },
  }))[0].json;
  assert.equal(secret.error_message, 'Manual upload workflow failed');
  assert.doesNotMatch(JSON.stringify(secret), /super-secret-value/u);
});

test('manual upload error SQL owns a single nonterminal run by the recorded n8n execution id', async () => {
  const workflow = await loadWorkflow();
  const node = findNode(workflow, 'Завершить только принадлежащий manual run');
  const sql = node.parameters.query;
  assert.equal(node.type, 'n8n-nodes-base.postgres');
  assert.match(sql, /source\s*=\s*'manual_upload'/iu);
  assert.match(sql, /tender_meta\s*->\s*'source_payload'\s*->>\s*'n8n_execution_id'/iu);
  assert.match(sql, /status\s+IN\s*\('created',\s*'processing',\s*'ready_for_aggregation',\s*'aggregating'\)/iu);
  assert.match(sql, /owner_count\s*=\s*1/iu);
  assert.match(sql, /SET\s+status\s*=\s*'failed'/iu);
  assert.match(sql, /error_message\s*=\s*input\.error_message/iu);
  assert.match(sql, /ownership_ambiguous|manual_run_failed|ownership_lost|invalid_identity/iu);
  assert.doesNotMatch(sql, /DELETE|TRUNCATE|ALTER|DROP/iu);
  assert.equal(node.alwaysOutputData, true);
});
