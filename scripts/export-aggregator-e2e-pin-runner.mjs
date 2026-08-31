import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BODY_WORKFLOW_NAME,
  CONTROLLER_WORKFLOW_NAME,
  REPLAY_REPORT_WORKFLOW_NAME,
  REPORT_VERSION_ID,
  REPORT_WORKFLOW_ID,
  SOURCE_VERSION_ID,
  SOURCE_WORKFLOW_ID,
  assertBodyParity,
  buildBodyWorkflow,
  buildControllerWorkflow,
  buildReplayReportWorkflow,
  assertReplayReportParity,
  scanWorkflowForSecrets,
  workflowToSdkCode,
} from '../tests/helpers/aggregator-e2e-runner-builder.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const outputDirectory = path.join(
  repositoryRoot,
  'workflows',
  'n8n-exports',
  'beta',
);
const replayReportOnly = process.argv.includes('--replay-report-only');
const bodyWorkflowId =
  process.argv.find((argument) => argument.startsWith('--body-workflow-id='))
    ?.slice('--body-workflow-id='.length) ?? '__BODY_WORKFLOW_ID__';
const replayReportWorkflowId =
  process.argv.find((argument) => argument.startsWith('--replay-report-workflow-id='))
    ?.slice('--replay-report-workflow-id='.length) ?? '__REPLAY_REPORT_WORKFLOW_ID__';

if (replayReportOnly) {
  const reportSourcePath = path.join(
    outputDirectory,
    `[TEST CODEX] TENDER — Генерация отчета.live-${REPORT_VERSION_ID}.json`,
  );
  const reportSource = JSON.parse(await fs.readFile(reportSourcePath, 'utf8'));
  const replayReport = buildReplayReportWorkflow(reportSource);
  assertReplayReportParity(reportSource, replayReport);
  if (scanWorkflowForSecrets(replayReport).length > 0) {
    throw new Error('Secret scan failed for replay Report artifact');
  }
  await fs.writeFile(
    path.join(outputDirectory, `${REPLAY_REPORT_WORKFLOW_NAME}.json`),
    `${JSON.stringify(replayReport, null, 2)}\n`,
    'utf8',
  );
  const sdkOutputDirectory = path.join(repositoryRoot, 'tests', 'runtime');
  await fs.mkdir(sdkOutputDirectory, { recursive: true });
  await fs.writeFile(
    path.join(sdkOutputDirectory, 'aggregator-e2e-pin-replay-report.sdk.ts'),
    `${workflowToSdkCode(replayReport, 'aggregator-e2e-pin-replay-report')}\n`,
    'utf8',
  );
  console.log(JSON.stringify({
    replayReportOnly: true,
    replayReportNodes: replayReport.nodes.length,
    authorizedSourceVersionId: SOURCE_VERSION_ID,
  }, null, 2));
  process.exit(0);
}

const baseUrl = process.env.N8N_TENDER_BASE_URL?.replace(/\/$/u, '');
const apiKey = process.env.N8N_TENDER_READONLY_API_KEY;
if (!baseUrl || !apiKey) {
  throw new Error('Missing read-only n8n environment variables');
}

async function fetchWorkflow(workflowId) {
  const response = await fetch(`${baseUrl}/api/v1/workflows/${workflowId}`, {
    headers: { 'X-N8N-API-KEY': apiKey },
  });
  if (!response.ok) {
    throw new Error(`Read-only n8n export failed with HTTP ${response.status}`);
  }
  return response.json();
}
const [source, reportSource] = await Promise.all([
  fetchWorkflow(SOURCE_WORKFLOW_ID),
  fetchWorkflow(REPORT_WORKFLOW_ID),
]);
const body = buildBodyWorkflow(source);
const replayReport = buildReplayReportWorkflow(reportSource);
const controller = buildControllerWorkflow({
  bodyWorkflowId,
  replayReportWorkflowId,
});
assertBodyParity(source, body);
assertReplayReportParity(reportSource, replayReport);

const secretFindings = [
  ...scanWorkflowForSecrets(source),
  ...scanWorkflowForSecrets(body),
  ...scanWorkflowForSecrets(replayReport),
  ...scanWorkflowForSecrets(controller),
];
if (secretFindings.length > 0) {
  throw new Error(`Secret scan failed: ${secretFindings.length} finding(s)`);
}

const files = [
  [
    `[TEST CODEX] TENDER — Агрегация закупки.live-${SOURCE_VERSION_ID}.json`,
    source,
  ],
  [`${BODY_WORKFLOW_NAME}.json`, body],
  [
    `[TEST CODEX] TENDER — Генерация отчета.live-${REPORT_VERSION_ID}.json`,
    reportSource,
  ],
  [`${REPLAY_REPORT_WORKFLOW_NAME}.json`, replayReport],
  [`${CONTROLLER_WORKFLOW_NAME}.json`, controller],
];
await fs.mkdir(outputDirectory, { recursive: true });
for (const [name, value] of files) {
  await fs.writeFile(
    path.join(outputDirectory, name),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
}

const sdkOutputDirectory = path.join(repositoryRoot, 'tests', 'runtime');
await fs.mkdir(sdkOutputDirectory, { recursive: true });
await fs.writeFile(
  path.join(sdkOutputDirectory, 'aggregator-e2e-pin-body.sdk.ts'),
  `${workflowToSdkCode(body, 'aggregator-e2e-pin-body')}\n`,
  'utf8',
);
await fs.writeFile(
  path.join(sdkOutputDirectory, 'aggregator-e2e-pin-replay-report.sdk.ts'),
  `${workflowToSdkCode(replayReport, 'aggregator-e2e-pin-replay-report')}\n`,
  'utf8',
);
await fs.writeFile(
  path.join(sdkOutputDirectory, 'aggregator-e2e-pin-controller.sdk.ts'),
  `${workflowToSdkCode(controller, 'aggregator-e2e-pin-controller')}\n`,
  'utf8',
);

console.log(
  JSON.stringify(
    {
      sourceWorkflowId: SOURCE_WORKFLOW_ID,
      sourceVersionId: SOURCE_VERSION_ID,
      bodyWorkflowId,
      replayReportWorkflowId,
      bodyNodes: body.nodes.length,
      replayReportNodes: replayReport.nodes.length,
      controllerNodes: controller.nodes.length,
      files: files.map(([name]) => name),
    },
    null,
    2,
  ),
);
