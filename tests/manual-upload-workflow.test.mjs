import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowUrl = new URL(
  '../workflows/n8n-exports/TENDER — Ручная загрузка закупки.json',
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

test('manual upload is a public n8n form with explicit safe file types', async () => {
  const workflow = await loadWorkflow();
  assert.equal(workflow.name, 'TENDER — Ручная загрузка закупки');
  assert.equal(workflow.active, true);
  assert.equal(workflow.pinData, undefined);

  const form = findNode(workflow, 'Ручная загрузка закупки');
  assert.equal(form.type, 'n8n-nodes-base.formTrigger');
  assert.equal(form.typeVersion, 2.6);
  assert.equal(form.parameters.authentication, 'none');
  assert.equal(form.parameters.responseMode, 'lastNode');
  assert.equal(form.parameters.options.path, 'tender-manual-upload');
  assert.equal(form.parameters.options.appendAttribution, false);
  assert.equal(form.parameters.options.ignoreBots, true);

  const fields = form.parameters.formFields.values;
  assert.equal(fields.find((field) => field.fieldName === 'procurement_title')?.requiredField, true);
  assert.equal(fields.find((field) => field.fieldName === 'documents')?.fieldType, 'file');
  assert.equal(fields.find((field) => field.fieldName === 'documents')?.multipleFiles, true);
  const accepted = fields.find((field) => field.fieldName === 'documents')?.acceptFileTypes ?? '';
  const acceptedExtensions = new Set(accepted.split(','));
  for (const extension of ['.pdf', '.docx', '.xlsx', '.xls', '.txt', '.csv', '.png', '.jpg', '.zip', '.7z', '.rar']) {
    assert.match(accepted, new RegExp(extension.replace('.', '\\.')));
  }
  for (const extension of ['.exe', '.dll', '.msi', '.bat', '.cmd', '.ps1', '.sh', '.js', '.py']) {
    assert.equal(acceptedExtensions.has(extension), false);
  }
});

test('manual upload validates security, streams one file at a time and enforces 200 MiB total', async () => {
  const workflow = await loadWorkflow();
  const preflight = findNode(workflow, 'Проверить ручную загрузку');
  assert.match(preflight.parameters.jsCode, /SUPPORTED_DOCUMENTS/u);
  assert.match(preflight.parameters.jsCode, /SUPPORTED_ARCHIVES/u);
  assert.match(preflight.parameters.jsCode, /Executable/u);

  const loop = findNode(workflow, 'Загрузить файлы по одному');
  assert.equal(loop.type, 'n8n-nodes-base.splitInBatches');
  assert.equal(loop.parameters.batchSize, 1);

  const upload = findNode(workflow, 'Сохранить исходный файл');
  assert.equal(upload.type, 'n8n-nodes-base.httpRequest');
  assert.equal(upload.parameters.method, 'POST');
  assert.equal(upload.parameters.contentType, 'binaryData');
  assert.equal(upload.parameters.inputDataFieldName, 'data');
  assert.match(upload.parameters.url, /\/v1\/source-files\//u);
  assert.equal(upload.parameters.options.response.response.responseFormat, 'json');
  assert.equal(upload.retryOnFail, true);
  assert.equal(upload.maxTries, 3);

  const aggregate = findNode(workflow, 'Собрать сохранённые исходники');
  assert.match(aggregate.parameters.jsCode, /200 \* 1024 \* 1024/u);
  assert.match(aggregate.parameters.jsCode, /MANUAL_UPLOAD_TOTAL_TOO_LARGE/u);
  assert.match(aggregate.parameters.jsCode, /n8n_execution_id/u);
});

test('manual entry reuses preparation, registers all documents atomically, then dispatches Codex', async () => {
  const workflow = await loadWorkflow();
  const prepare = findNode(workflow, 'Подготовить документацию');
  assert.equal(prepare.type, 'n8n-nodes-base.executeWorkflow');
  assert.equal(prepare.parameters.options.waitForSubWorkflow, true);

  const register = findNode(workflow, 'Создать запуск и зарегистрировать документы');
  assert.equal(register.type, 'n8n-nodes-base.postgres');
  assert.equal(register.parameters.operation, 'executeQuery');
  assert.match(register.parameters.query, /INSERT INTO tender_analysis_runs/u);
  assert.match(register.parameters.query, /INSERT INTO tender_analysis_documents/u);
  assert.match(register.parameters.query, /FROM inserted_run AS run/u);
  assert.match(register.parameters.options.queryReplacement, /manual_upload/u);

  const dispatch = findNode(workflow, 'Запустить агентский анализ');
  assert.equal(dispatch.type, 'n8n-nodes-base.executeWorkflow');
  assert.equal(dispatch.parameters.options.waitForSubWorkflow, true);

  const connections = workflow.connections;
  assert.deepEqual(connections['Собрать сохранённые исходники'].main[0].map(({ node }) => node), ['Подготовить документацию']);
  assert.deepEqual(connections['Проверить результат подготовки'].main[0].map(({ node }) => node), ['Создать запуск и зарегистрировать документы']);
  assert.deepEqual(connections['Проверить регистрацию запуска'].main[0].map(({ node }) => node), ['Запустить агентский анализ']);
});

test('workflow keeps audit metadata, has a completion page and no mock data or secrets', async () => {
  const workflow = await loadWorkflow();
  const source = JSON.stringify(workflow);
  assert.match(source, /source_payload/u);
  assert.match(source, /manual_upload/u);
  assert.doesNotMatch(source, /Tender-blind-test|procurement-02|pinnedData|pinData/u);
  assert.doesNotMatch(source, /45\.139\.169\.25|32RgjD|qtYRCv/u);

  const completion = findNode(workflow, 'Показать подтверждение');
  assert.equal(completion.type, 'n8n-nodes-base.form');
  assert.equal(completion.parameters.operation, 'completion');
  assert.match(completion.parameters.completionMessage, /analysis_run_id/u);
  assert.equal(workflow.settings.errorWorkflow, 'xW4DHtnBYddbaU14');
  assert.equal(workflow.settings.availableInMCP, true);
  assert.equal(workflow.settings.binaryMode, undefined);
});
