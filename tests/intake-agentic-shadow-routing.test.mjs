import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const orchestratorUrl = new URL(
  '../workflows/n8n-exports/%D0%A2%D0%95%D0%9D%D0%94%D0%95%D0%A0%D0%AB%20%D0%9E%D0%A0%D0%9A%D0%95%D0%A1%D0%A2%D0%A0%D0%90%D0%A2%D0%9E%D0%A0.json',
  import.meta.url,
);
const preparationUrl = new URL(
  '../workflows/n8n-exports/TENDER — Подготовить документацию.json',
  import.meta.url,
);

async function loadWorkflow(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

function nodeByName(workflow, name) {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(node, `missing node ${name}`);
  return node;
}

function directTargets(workflow, nodeName) {
  return (workflow.connections?.[nodeName]?.main ?? [])
    .flatMap((output) => output.map((connection) => connection.node));
}

function canReach(workflow, startName, targetName, blockedNames = new Set()) {
  if (blockedNames.has(startName) || blockedNames.has(targetName)) return false;
  const queue = [startName];
  const visited = new Set();

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === targetName) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of directTargets(workflow, current)) {
      if (!visited.has(next) && !blockedNames.has(next)) queue.push(next);
    }
  }
  return false;
}

function configuredWorkflowName(node) {
  return String(node.parameters?.workflowId?.cachedResultName ?? '').trim();
}

test('Document Preparation and its fail-closed validator dominate atomic registration', async () => {
  const workflow = await loadWorkflow(orchestratorUrl);
  const normalization = nodeByName(workflow, 'нормализовать карточку');
  const registration = nodeByName(workflow, 'Создать запуск и зарегистрировать документы');
  const preparationCalls = workflow.nodes.filter(
    (node) =>
      node.type === 'n8n-nodes-base.executeWorkflow'
      && configuredWorkflowName(node) === 'TENDER — Подготовить документацию',
  );
  assert.equal(preparationCalls.length, 1, 'expected one synchronous Document Preparation call');

  const preparation = preparationCalls[0];
  assert.equal(preparation.parameters.mode, 'all');
  assert.equal(preparation.parameters.options?.waitForSubWorkflow, true);
  assert.deepEqual(
    Object.keys(preparation.parameters.workflowInputs?.value ?? {}).sort(),
    ['analysis_run_id', 'attachments'],
  );

  const validation = nodeByName(workflow, 'Проверить результат подготовки');
  assert.ok(canReach(workflow, normalization.name, preparation.name));
  assert.ok(canReach(workflow, preparation.name, validation.name));
  assert.ok(canReach(workflow, validation.name, registration.name));
  assert.equal(
    canReach(workflow, normalization.name, registration.name, new Set([preparation.name])),
    false,
    'registration must be unreachable when preparation is removed',
  );
  assert.equal(
    canReach(workflow, normalization.name, registration.name, new Set([validation.name])),
    false,
    'registration must be unreachable when preparation validation is removed',
  );

  const validationCode = String(validation.parameters?.jsCode ?? '');
  assert.match(validationCode, /success\s*!==\s*true/u);
  assert.match(validationCode, /tender_document_ingestion_v1/u);
  assert.match(validationCode, /manifest\.documents/u);
  assert.match(validationCode, /content_sha256/u);
  assert.match(validationCode, /\/\^\[0-9a-f\]\{64\}\$\/[iu]*/u);
  assert.match(validationCode, /throw\s+new\s+Error/u);

  const sql = String(registration.parameters?.query ?? '');
  const replacement = String(registration.parameters?.options?.queryReplacement ?? '');
  assert.match(replacement, /Проверить результат подготовки/u);
  assert.match(sql, /document->>'status'/u);
  assert.match(sql, /document->>'mime_type'/u);
  assert.match(sql, /document->>'file_size'/u);
  assert.match(sql, /document->'ingestion_metadata'/u);
  assert.match(sql, /content_sha256/u);
});

test('direct processable files are downloaded sequentially and registered with full byte identity', async () => {
  const workflow = await loadWorkflow(preparationUrl);
  const classifier = nodeByName(workflow, 'Проверить и классифицировать вход');
  const classifierCode = String(classifier.parameters?.jsCode ?? '');
  assert.match(classifierCode, /direct_document_jobs/u);

  const loop = nodeByName(workflow, 'Обработать прямые документы по одному');
  assert.equal(loop.type, 'n8n-nodes-base.splitInBatches');
  assert.equal(loop.parameters.batchSize, 1);

  const download = nodeByName(workflow, 'Скачать прямой документ');
  assert.equal(download.type, 'n8n-nodes-base.httpRequest');
  assert.equal(download.parameters.options.response.response.responseFormat, 'file');
  assert.equal(download.parameters.options.response.response.outputPropertyName, 'data');
  assert.equal(download.onError, 'continueErrorOutput');

  const hash = nodeByName(workflow, 'Вычислить SHA-256 прямого документа');
  assert.equal(hash.type, 'n8n-nodes-base.crypto');
  assert.equal(hash.parameters.action, 'hash');
  assert.equal(hash.parameters.binaryData, true);
  assert.equal(hash.parameters.binaryPropertyName, 'data');
  assert.equal(hash.parameters.type, 'SHA256');
  assert.equal(hash.parameters.encoding, 'hex');
  assert.equal(hash.parameters.dataPropertyName, 'content_sha256');

  const identity = nodeByName(workflow, 'Зафиксировать идентичность прямого документа');
  const identityCode = String(identity.parameters?.jsCode ?? '');
  for (const field of ['file_name', 'mime_type', 'file_size', 'content_sha256']) {
    assert.match(identityCode, new RegExp(`\\b${field}\\b`, 'u'));
  }
  assert.match(identityCode, /\/\^\[0-9a-f\]\{64\}\$\/[iu]*/u);

  const manifest = nodeByName(workflow, 'Сформировать полный manifest');
  const manifestCode = String(manifest.parameters?.jsCode ?? '');
  assert.match(manifestCode, /direct_document_jobs/u);
  assert.match(manifestCode, /Зафиксировать идентичность прямого документа/u);
  assert.match(manifestCode, /document\.status\s*===\s*'pending'/u);
  assert.match(manifestCode, /document\.file_name/u);
  assert.match(manifestCode, /document\.mime_type/u);
  assert.match(manifestCode, /document\.file_size/u);
  assert.match(manifestCode, /content_sha256/u);
  assert.match(manifestCode, /INGESTION_CONTRACT_INVALID/u);
});
