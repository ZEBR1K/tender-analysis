import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const deliveryPath = path.join(
  repositoryRoot,
  'workflows',
  'n8n-exports',
  'beta',
  '[BITRIX] TENDER — Отправить отчёт в Bitrix.json',
);
const sanitizerPath = path.join(
  repositoryRoot,
  'scripts',
  'sanitize-bitrix-workflow-export.mjs',
);
const webhookPattern = /https:\/\/[^\s"'<>]+\/rest\/\d+\/[^/\s"'<>]+\/imbot[.]v2[.]File[.]upload/giu;

function deliveryWorkflow() {
  return JSON.parse(fs.readFileSync(deliveryPath, 'utf8'));
}

function configValue(workflow, name) {
  return workflow.nodes
    .find((node) => node.name === 'Конфигурация Bitrix')
    .parameters.assignments.assignments
    .find((assignment) => assignment.name === name)
    .value;
}

test('tracked source files contain no Bitrix inbound webhook URL', () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).split('\0').filter(Boolean);
  const inspected = tracked.filter((relativePath) => (
    !relativePath.startsWith('graphify-out/')
    && /[.](?:json|md|mjs|js|sql)$/u.test(relativePath)
  ));

  for (const relativePath of inspected) {
    const content = fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
    webhookPattern.lastIndex = 0;
    assert.equal(webhookPattern.test(content), false, relativePath);
  }
});

test('delivery candidate contains every required configuration sentinel', () => {
  const workflow = deliveryWorkflow();
  const httpNode = workflow.nodes.find(({ name }) => name === 'Отправить PDF в Bitrix');
  assert.equal(httpNode.parameters.url, '__BITRIX_WEBHOOK_FILE_UPLOAD_URL__');
  assert.equal(configValue(workflow, 'bitrix_bot_id'), '__BITRIX_BOT_ID__');
  assert.equal(configValue(workflow, 'bitrix_dialog_id'), '__BITRIX_DIALOG_ID__');
  assert.equal(configValue(workflow, 'bitrix_bot_token'), '__BITRIX_BOT_TOKEN__');
});

test('sanitizer removes live values and workflow identity metadata', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(repositoryRoot, '.tmp-bitrix-sanitize-'));
  try {
    const inputPath = path.join(temporaryDirectory, 'live.json');
    const outputPath = path.join(temporaryDirectory, 'safe.json');
    const workflow = deliveryWorkflow();
    const fakeWebhook = [
      'https://portal.example',
      'rest',
      '123',
      'fake-webhook-secret',
      'imbot.v2.File.upload.json',
    ].join('/');
    const fakeBotToken = ['fake', 'bot', 'token'].join('-');
    workflow.nodes.find(({ name }) => name === 'Отправить PDF в Bitrix').parameters.url = fakeWebhook;
    workflow.nodes
      .find(({ name }) => name === 'Конфигурация Bitrix')
      .parameters.assignments.assignments
      .find(({ name }) => name === 'bitrix_bot_token').value = fakeBotToken;
    workflow.active = true;
    workflow.id = 'live-workflow-id';
    workflow.versionId = 'live-version-id';
    workflow.meta = { instanceId: 'live-instance-id' };
    fs.writeFileSync(inputPath, JSON.stringify(workflow), 'utf8');

    execFileSync(process.execPath, [sanitizerPath, inputPath, outputPath], {
      cwd: repositoryRoot,
      stdio: 'pipe',
    });

    const serialized = fs.readFileSync(outputPath, 'utf8');
    const sanitized = JSON.parse(serialized);
    assert.doesNotMatch(serialized, /fake-webhook-secret|fake-bot-token/u);
    assert.equal(sanitized.active, false);
    assert.deepEqual(sanitized.pinData, {});
    assert.equal(Object.hasOwn(sanitized, 'id'), false);
    assert.equal(Object.hasOwn(sanitized, 'versionId'), false);
    assert.equal(Object.hasOwn(sanitized, 'meta'), false);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('sanitizer refuses an unexpected workflow', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(repositoryRoot, '.tmp-bitrix-refuse-'));
  try {
    const inputPath = path.join(temporaryDirectory, 'wrong.json');
    const outputPath = path.join(temporaryDirectory, 'safe.json');
    const workflow = deliveryWorkflow();
    workflow.name = 'Unrelated workflow';
    fs.writeFileSync(inputPath, JSON.stringify(workflow), 'utf8');

    assert.throws(
      () => execFileSync(process.execPath, [sanitizerPath, inputPath, outputPath], {
        cwd: repositoryRoot,
        stdio: 'pipe',
      }),
      /Command failed/u,
    );
    assert.equal(fs.existsSync(outputPath), false);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
