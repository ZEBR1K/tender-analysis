import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKFLOW_ID = 'ckPnP3hRhKu4Mf9u';
const WORKFLOW_NAME = 'TENDER — Генерация отчета';
const OUTPUT_NAME = `${WORKFLOW_NAME}.json`;

const baseUrl = process.env.N8N_TENDER_BASE_URL?.replace(/\/$/u, '');
const apiKey = process.env.N8N_TENDER_READONLY_API_KEY;
if (!baseUrl || !apiKey) {
  throw new Error('Missing read-only n8n environment variables');
}

const response = await fetch(`${baseUrl}/api/v1/workflows/${WORKFLOW_ID}`, {
  headers: { 'X-N8N-API-KEY': apiKey },
});
if (!response.ok) {
  throw new Error(`Read-only n8n export failed with HTTP ${response.status}`);
}

const workflow = await response.json();
if (workflow.id !== WORKFLOW_ID || workflow.name !== WORKFLOW_NAME) {
  throw new Error('Refusing to export an unexpected workflow');
}
if (workflow.active !== true) {
  throw new Error('Refusing to export an inactive production report workflow');
}
if (!workflow.versionId || workflow.versionId !== workflow.activeVersionId) {
  throw new Error('Refusing to export when the production draft is not the active version');
}
if (workflow.nodes?.length !== 12) {
  throw new Error(`Expected 12 nodes, got ${workflow.nodes?.length ?? 'null'}`);
}

const nodeNames = new Set(workflow.nodes.map(({ name }) => name));
for (const name of [
  'Создать HTML artifact',
  'Подготовить HTML для Gotenberg',
  'Конвертировать HTML в PDF',
  'Проверить PDF artifact',
]) {
  if (!nodeNames.has(name)) {
    throw new Error(`Expected production node is missing: ${name}`);
  }
}

function targets(source) {
  return (workflow.connections[source]?.main?.[0] ?? []).map(({ node }) => node);
}

const expectedPdfChain = [
  ['Создать HTML artifact', 'Подготовить HTML для Gotenberg'],
  ['Подготовить HTML для Gotenberg', 'Конвертировать HTML в PDF'],
  ['Конвертировать HTML в PDF', 'Проверить PDF artifact'],
];
for (const [source, target] of expectedPdfChain) {
  if (JSON.stringify(targets(source)) !== JSON.stringify([target])) {
    throw new Error(`Unexpected production connection after: ${source}`);
  }
}

// Match the repository's canonical n8n export shape and exclude ownership or
// sharing metadata returned by the public API.
const exportKeys = [
  'name',
  'nodes',
  'pinData',
  'connections',
  'active',
  'settings',
  'versionId',
  'meta',
  'nodeGroups',
  'id',
  'tags',
];
const exportWorkflow = Object.fromEntries(
  exportKeys
    .filter((key) => Object.hasOwn(workflow, key))
    .map((key) => [key, workflow[key]]),
);

// Manual pin data is an execution aid, not part of the production contract.
// Keep real tender payloads out of the version-controlled canonical export.
exportWorkflow.pinData = {};

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.join(
  scriptDirectory,
  '..',
  'workflows',
  'n8n-exports',
  OUTPUT_NAME,
);
await fs.writeFile(outputPath, `${JSON.stringify(exportWorkflow, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  workflowId: workflow.id,
  versionId: workflow.versionId,
  activeVersionId: workflow.activeVersionId,
  active: workflow.active,
  nodeCount: workflow.nodes.length,
  outputPath,
}, null, 2));
