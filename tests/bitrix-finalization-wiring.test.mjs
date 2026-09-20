import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canonical = JSON.parse(fs.readFileSync(path.join(
  repositoryRoot,
  'workflows',
  'n8n-exports',
  'TENDER — Финализация анализа.json',
), 'utf8'));
const candidate = JSON.parse(fs.readFileSync(path.join(
  repositoryRoot,
  'workflows',
  'n8n-exports',
  'beta',
  '[BITRIX] TENDER — Финализация анализа.json',
), 'utf8'));

function targets(workflow, sourceName) {
  return (workflow.connections[sourceName]?.main?.[0] ?? []).map(({ node }) => node);
}

test('Bitrix Finalization candidate changes only the post-report boundary', () => {
  assert.equal(canonical.nodes.length, 5);
  assert.equal(candidate.nodes.length, 6);
  assert.equal(candidate.active, false);

  for (const canonicalNode of canonical.nodes) {
    const candidateNode = candidate.nodes.find(({ name }) => name === canonicalNode.name);
    assert.ok(candidateNode, canonicalNode.name);
    assert.deepEqual(candidateNode.parameters, canonicalNode.parameters);
    assert.equal(candidateNode.type, canonicalNode.type);
    assert.equal(candidateNode.typeVersion, canonicalNode.typeVersion);
  }

  assert.deepEqual(
    targets(candidate, "Call 'TENDER — Генерация отчета'"),
    ["Call 'TENDER — Отправить отчёт в Bitrix'"],
  );
  assert.deepEqual(
    targets(candidate, "Call 'TENDER — Отправить отчёт в Bitrix'"),
    [],
  );
});

test('delivery call waits and passes the complete report item including binary', () => {
  const node = candidate.nodes.find(
    ({ name }) => name === "Call 'TENDER — Отправить отчёт в Bitrix'",
  );
  assert.ok(node);
  assert.equal(node.type, 'n8n-nodes-base.executeWorkflow');
  assert.equal(node.typeVersion, 1.3);
  assert.equal(node.parameters.workflowId.value, '__BITRIX_DELIVERY_WORKFLOW_ID__');
  assert.equal(node.parameters.mode, 'once');
  assert.equal(node.parameters.options.waitForSubWorkflow, true);
  assert.equal(Object.hasOwn(node.parameters, 'workflowInputs'), false);
});

test('canonical production Finalization remains active and unwired to Bitrix', () => {
  assert.equal(canonical.active, true);
  assert.equal(
    canonical.nodes.some(({ name }) => name === "Call 'TENDER — Отправить отчёт в Bitrix'"),
    false,
  );
  assert.deepEqual(targets(canonical, "Call 'TENDER — Генерация отчета'"), []);
});
