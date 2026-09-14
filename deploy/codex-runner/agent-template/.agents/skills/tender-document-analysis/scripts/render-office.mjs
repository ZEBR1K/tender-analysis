import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import {
  cleanupToolOutputAfterError,
  createToolOutputDirectory,
  isDirectRun,
  printJson,
  resolveRegularInput,
  runCli,
  validateGeneratedFiles,
} from './document-toolkit-lib.mjs';

const OFFICE_RUNTIME_PATTERN = /^\/dev\/shm\/tc-[0-9a-f]{24}$/u;
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const USAGE = `Usage:
  node render-office.mjs <source.docx|source.xlsx|source.xls>

Converts one Office document to a derived PDF below workspace .tmp. The
original remains immutable and authoritative.
`;

export function requiredOfficeRuntimeDirectory(environment = process.env) {
  const runtimeDirectory = environment?.TENDER_OFFICE_RUNTIME_DIR;
  if (typeof runtimeDirectory !== 'string' || !OFFICE_RUNTIME_PATTERN.test(runtimeDirectory)) {
    throw new Error('Office runtime directory is missing or invalid');
  }
  return runtimeDirectory;
}

export function buildLibreOfficeArgs(source, outputDirectory, runtimeDirectory) {
  const runtime = requiredOfficeRuntimeDirectory({
    TENDER_OFFICE_RUNTIME_DIR: runtimeDirectory,
  });
  return [
    `-env:OSL_SOCKET_PATH=${runtime}`,
    `-env:UserInstallation=file://${runtime}/profile`,
    '--headless',
    '--convert-to',
    'pdf',
    '--outdir',
    outputDirectory,
    source,
  ];
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function requestOfficeRender({
  source,
  outputDirectory,
  runtimeDirectory = requiredOfficeRuntimeDirectory(),
  requestId = randomUUID(),
  pollIntervalMs = 50,
  timeoutMs = 120_000,
  resolveRuntimeDirectory = requiredOfficeRuntimeDirectory,
} = {}) {
  const runtime = resolveRuntimeDirectory({ TENDER_OFFICE_RUNTIME_DIR: runtimeDirectory });
  const normalizedRequestId = String(requestId || '').toLowerCase();
  if (!REQUEST_ID_PATTERN.test(normalizedRequestId)) throw new Error('Office request id is invalid');
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1 || pollIntervalMs > 1_000) {
    throw new Error('Office request poll interval is invalid');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < pollIntervalMs || timeoutMs > 180_000) {
    throw new Error('Office request timeout is invalid');
  }
  const requestPath = path.join(runtime, `office-request-${normalizedRequestId}.json`);
  const temporaryPath = path.join(runtime, `.office-request-${normalizedRequestId}.tmp`);
  const responsePath = path.join(runtime, `office-response-${normalizedRequestId}.json`);
  const resultPath = path.join(runtime, `office-result-${normalizedRequestId}.pdf`);
  const resultName = `office-${normalizedRequestId}.pdf`;
  const request = {
    schema_version: 'tender_office_render_request_v1',
    request_id: normalizedRequestId,
    source,
    output_directory: outputDirectory,
  };
  await writeFile(temporaryPath, `${JSON.stringify(request)}\n`, { flag: 'wx', mode: 0o600 });
  await rename(temporaryPath, requestPath);
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const bytes = await readFile(responsePath).catch((error) => {
        if (error?.code === 'ENOENT') return null;
        throw error;
      });
      if (!bytes) {
        await delay(pollIntervalMs);
        continue;
      }
      if (bytes.length > 8 * 1024) throw new Error('Office broker response is too large');
      const response = JSON.parse(bytes.toString('utf8'));
      if (
        response?.schema_version !== 'tender_office_render_response_v1'
        || response?.request_id !== normalizedRequestId
        || !['ok', 'error'].includes(response?.status)
      ) throw new Error('Office broker response is invalid');
      if (response.status !== 'ok') throw new Error('Office render broker rejected the request');
      if (response.result_path !== resultPath || response.file_name !== resultName) {
        throw new Error('Office broker result identity is invalid');
      }
      const resultMetadata = await lstat(resultPath);
      if (
        !resultMetadata.isFile()
        || resultMetadata.isSymbolicLink()
        || resultMetadata.size <= 0
        || resultMetadata.size > 128 * 1024 * 1024
      ) throw new Error('Office broker result file is invalid');
      const outputPath = path.join(outputDirectory, resultName);
      await copyFile(resultPath, outputPath, constants.COPYFILE_EXCL);
      return { ...response, output_path: outputPath };
    }
    throw new Error('Office render broker timed out');
  } finally {
    await Promise.all([
      rm(temporaryPath, { force: true }).catch(() => {}),
      rm(requestPath, { force: true }).catch(() => {}),
      rm(responsePath, { force: true }).catch(() => {}),
      rm(resultPath, { force: true }).catch(() => {}),
    ]);
  }
}

export async function main(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write(USAGE);
    return;
  }
  if (args.length !== 1) throw new Error('Expected exactly one Office source file');
  const source = await resolveRegularInput(args[0], { extensions: ['.docx', '.xlsx', '.xls'] });
  const outputDirectory = await createToolOutputDirectory('office-render');
  const runtimeDirectory = requiredOfficeRuntimeDirectory();
  try {
    const runtimeMetadata = await lstat(runtimeDirectory);
    if (!runtimeMetadata.isDirectory() || runtimeMetadata.isSymbolicLink()) {
      throw new Error('Office runtime directory is not a real directory');
    }
    await Promise.all([
      mkdir(path.join(runtimeDirectory, 'profile'), { recursive: true, mode: 0o700 }),
      mkdir(path.join(runtimeDirectory, 'home'), { recursive: true, mode: 0o700 }),
      mkdir(path.join(runtimeDirectory, 'cache'), { recursive: true, mode: 0o700 }),
    ]);
    await requestOfficeRender({ source, outputDirectory, runtimeDirectory });
    const [pdf] = await validateGeneratedFiles(outputDirectory, {
      extensions: ['.pdf'],
      expectedCount: 1,
      maxFileBytes: 128 * 1024 * 1024,
      maxTotalBytes: 128 * 1024 * 1024,
    });
    printJson({
      schema_version: 'tender_document_office_render_v1',
      source,
      pdf: pdf.path,
      advisory: 'The PDF is a visual inspection aid; cite the immutable Office source file.',
    });
  } catch (error) {
    await cleanupToolOutputAfterError(error, outputDirectory);
  }
}

if (isDirectRun(import.meta.url)) await runCli(main);
