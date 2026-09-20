import fs from 'node:fs/promises';
import path from 'node:path';

const [inputArgument, outputArgument] = process.argv.slice(2);
if (!inputArgument || !outputArgument) {
  throw new Error(
    'Usage: node scripts/sanitize-bitrix-workflow-export.mjs <input.json> <output.json>',
  );
}

const inputPath = path.resolve(inputArgument);
const outputPath = path.resolve(outputArgument);
const workflow = JSON.parse(await fs.readFile(inputPath, 'utf8'));

if (!String(workflow.name ?? '').includes('Отправить отчёт в Bitrix')) {
  throw new Error('Refusing to sanitize an unexpected workflow');
}

const httpNode = workflow.nodes.find(
  ({ name }) => name === 'Отправить PDF в Bitrix',
);
const configNode = workflow.nodes.find(
  ({ name }) => name === 'Конфигурация Bitrix',
);

if (!httpNode || !configNode) {
  throw new Error('Expected Bitrix configuration nodes are missing');
}

httpNode.parameters.url = '__BITRIX_WEBHOOK_FILE_UPLOAD_URL__';

const assignments = configNode.parameters.assignments?.assignments;
if (!Array.isArray(assignments)) {
  throw new Error('Bitrix configuration assignments are missing');
}

const sentinels = {
  bitrix_bot_id: '__BITRIX_BOT_ID__',
  bitrix_dialog_id: '__BITRIX_DIALOG_ID__',
  bitrix_bot_token: '__BITRIX_BOT_TOKEN__',
};

for (const [name, value] of Object.entries(sentinels)) {
  const assignment = assignments.find((candidate) => candidate.name === name);
  if (!assignment) {
    throw new Error('Missing Bitrix configuration field: ' + name);
  }
  assignment.value = value;
  assignment.type = 'string';
}

workflow.active = false;
workflow.pinData = {};

for (const key of [
  'id',
  'versionId',
  'activeVersionId',
  'shared',
  'meta',
  'workflowPublishHistory',
]) {
  delete workflow[key];
}

const serialized = JSON.stringify(workflow, null, 2) + '\n';
const webhookPattern = /https:\/\/[^\s"'<>]+\/rest\/\d+\/[^/\s"'<>]+\/imbot[.]v2[.]File[.]upload/giu;

if (webhookPattern.test(serialized)) {
  throw new Error('Sanitized workflow still contains an inbound webhook URL');
}
if (!serialized.includes('__BITRIX_BOT_TOKEN__')) {
  throw new Error('Sanitized workflow lost the bot-token sentinel');
}

await fs.writeFile(outputPath, serialized, 'utf8');
