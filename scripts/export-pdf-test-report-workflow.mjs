import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKFLOW_ID = '1dQTcUnE5JIcrEfI';
const WORKFLOW_NAME = '[PDF TEST] TENDER — Генерация отчета';
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
if (workflow.active !== false) {
  throw new Error('Refusing to export an active PDF test workflow');
}
if (workflow.nodes?.length !== 12) {
  throw new Error(`Expected 12 nodes, got ${workflow.nodes?.length ?? 'null'}`);
}

// Public API responses include personal-project ownership metadata. Persist an
// explicit executable/audit allowlist so future API fields cannot leak by default.
const exportKeys = [
  'id',
  'name',
  'description',
  'active',
  'activeVersionId',
  'createdAt',
  'updatedAt',
  'isArchived',
  'versionId',
  'versionCounter',
  'sourceWorkflowId',
  'triggerCount',
  'nodes',
  'connections',
  'nodeGroups',
  'settings',
  'staticData',
  'pinData',
  'tags',
  'activeVersion',
];
const exportWorkflow = Object.fromEntries(
  exportKeys
    .filter((key) => Object.hasOwn(workflow, key))
    .map((key) => [key, workflow[key]]),
);

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.join(
  scriptDirectory,
  '..',
  'workflows',
  'n8n-exports',
  'beta',
  OUTPUT_NAME,
);
await fs.writeFile(outputPath, `${JSON.stringify(exportWorkflow, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  workflowId: workflow.id,
  versionId: workflow.versionId,
  active: workflow.active,
  nodeCount: workflow.nodes.length,
  outputPath,
}, null, 2));
