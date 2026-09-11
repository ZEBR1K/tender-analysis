import { execFile } from 'node:child_process';
import { constants, createWriteStream } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

import { officeRuntimeDirectory } from './office-runtime.mjs';

const execFileAsync = promisify(execFile);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const REQUEST_FILE_PATTERN = /^office-request-([0-9a-f-]{36})\.json$/u;
const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_REQUESTS_PER_ATTEMPT = 64;

function assertUuid(value, name) {
  const normalized = String(value || '').toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw new Error(`${name} must be a UUID`);
  return normalized;
}

function isInside(target, root) {
  const relative = path.relative(root, target);
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

async function assertRealDirectory(target, name) {
  const metadata = await lstat(target);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${name} must be a real directory`);
  }
  return realpath(target);
}

async function assertRealFile(target, name) {
  const metadata = await lstat(target);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${name} must be a regular file`);
  }
  return {
    path: await realpath(target),
    device: metadata.dev,
    inode: metadata.ino,
  };
}

function assertExactRequest(value, requestId) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Office request must be an object');
  }
  const keys = Object.keys(value).sort();
  const expected = ['output_directory', 'request_id', 'schema_version', 'source'];
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error('Office request properties are invalid');
  }
  if (value.schema_version !== 'tender_office_render_request_v1') {
    throw new Error('Office request schema is invalid');
  }
  if (assertUuid(value.request_id, 'request_id') !== requestId) {
    throw new Error('Office request id does not match its file name');
  }
  if (typeof value.source !== 'string' || typeof value.output_directory !== 'string') {
    throw new Error('Office request paths must be strings');
  }
  return value;
}

async function validatedRequest(value, roots) {
  const request = assertExactRequest(value, roots.requestId);
  const source = await assertRealFile(request.source, 'Office source');
  if (!isInside(source.path, roots.inputRoot) && !isInside(source.path, roots.workspaceRoot)) {
    throw new Error('Office source escaped the current job');
  }
  if (!['.docx', '.xlsx', '.xls'].includes(path.extname(source.path).toLowerCase())) {
    throw new Error('Office source extension is unsupported');
  }
  const outputDirectory = await assertRealDirectory(request.output_directory, 'Office output');
  if (!isInside(outputDirectory, roots.outputRoot) || outputDirectory === roots.outputRoot) {
    throw new Error('Office output escaped job-local document tools');
  }
  return Object.freeze({ requestId: roots.requestId, source, outputDirectory });
}

async function copyValidatedSource(source, target) {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const sourceHandle = await open(source.path, constants.O_RDONLY | noFollow);
  try {
    const metadata = await sourceHandle.stat();
    if (!metadata.isFile() || metadata.dev !== source.device || metadata.ino !== source.inode) {
      throw new Error('Office source changed after validation');
    }
    await pipeline(
      sourceHandle.createReadStream({ autoClose: false }),
      createWriteStream(target, {
        flags: constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
        mode: 0o400,
      }),
    );
  } finally {
    await sourceHandle.close().catch(() => {});
  }
}

async function findPrivatePdf(outputDirectory) {
  const entries = await readdir(outputDirectory, { withFileTypes: true });
  const pdfs = entries.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.pdf'));
  if (pdfs.length !== 1) throw new Error('LibreOffice did not produce exactly one PDF');
  const target = path.join(outputDirectory, pdfs[0].name);
  const metadata = await lstat(target);
  if (
    !metadata.isFile()
    || metadata.isSymbolicLink()
    || metadata.size <= 0
    || metadata.size > 128 * 1024 * 1024
  ) throw new Error('LibreOffice PDF is invalid');
  return target;
}

async function copyPrivatePdfToRuntime(source, target) {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  await pipeline(
    (await open(source, constants.O_RDONLY | noFollow)).createReadStream(),
    createWriteStream(target, {
      flags: constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
      mode: 0o400,
    }),
  );
}

export async function runLibreOfficeConversion({
  requestId,
  source,
  outputDirectory,
  runtimeDirectory,
  execute = execFileAsync,
} = {}) {
  const request = assertUuid(requestId, 'requestId');
  const runtime = await assertRealDirectory(runtimeDirectory, 'Office runtime');
  const requestRuntime = path.join(runtime, `request-${request}`);
  const profile = path.join(requestRuntime, 'profile');
  const home = path.join(requestRuntime, 'home');
  const cache = path.join(requestRuntime, 'cache');
  await Promise.all([
    mkdir(profile, { recursive: true, mode: 0o700 }),
    mkdir(home, { recursive: true, mode: 0o700 }),
    mkdir(cache, { recursive: true, mode: 0o700 }),
  ]);
  await execute('unshare', [
    '--user',
    '--map-root-user',
    '--net',
    '--pid',
    '--fork',
    '--mount-proc',
    '--',
    'libreoffice',
    `-env:UserInstallation=file://${profile}`,
    '--headless',
    '--convert-to',
    'pdf',
    '--outdir',
    outputDirectory,
    source,
  ], {
    encoding: 'utf8',
    env: {
      PATH: '/usr/local/bin:/usr/bin:/bin',
      HOME: home,
      XDG_CACHE_HOME: cache,
      TMPDIR: '/tmp',
      TEMP: '/tmp',
      TMP: '/tmp',
      SAL_USE_VCLPLUGIN: 'svp',
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
    },
    timeout: 120_000,
    killSignal: 'SIGKILL',
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
}

async function writeResponse(runtimeDirectory, requestId, value) {
  const target = path.join(runtimeDirectory, `office-response-${requestId}.json`);
  const temporary = path.join(runtimeDirectory, `.office-response-${requestId}.tmp`);
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { flag: 'wx', mode: 0o600 });
  await rename(temporary, target);
}

export async function startOfficeRenderBroker({
  jobId,
  jobsRoot = '/data/jobs',
  runtimeDirectory = officeRuntimeDirectory(jobId),
  pollIntervalMs = 50,
  executeLibreOffice = runLibreOfficeConversion,
} = {}) {
  const currentJobId = assertUuid(jobId, 'jobId');
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1 || pollIntervalMs > 1_000) {
    throw new Error('pollIntervalMs must be from 1 to 1000');
  }
  const runtime = await assertRealDirectory(runtimeDirectory, 'Office runtime');
  const jobRoot = await assertRealDirectory(path.join(jobsRoot, currentJobId), 'Job root');
  const inputRoot = await assertRealDirectory(path.join(jobRoot, 'input'), 'Job input');
  const workspaceRoot = await assertRealDirectory(path.join(jobRoot, 'workspace'), 'Job workspace');
  const outputRootPath = path.join(workspaceRoot, '.tmp', 'document-tools');
  await mkdir(outputRootPath, { recursive: true, mode: 0o700 });
  const outputRoot = await assertRealDirectory(
    outputRootPath,
    'Document tools output root',
  );
  const brokerBasePath = path.join(jobsRoot, '.tmp', 'office-broker');
  await mkdir(brokerBasePath, { recursive: true, mode: 0o700 });
  const brokerBase = await assertRealDirectory(brokerBasePath, 'Office broker root');
  if (!isInside(brokerBase, await realpath(jobsRoot))) {
    throw new Error('Office broker root escaped the jobs volume');
  }
  const brokerJobRoot = path.join(brokerBase, currentJobId);
  const existingBrokerRoot = await lstat(brokerJobRoot).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (existingBrokerRoot) {
    if (!existingBrokerRoot.isDirectory() || existingBrokerRoot.isSymbolicLink()) {
      throw new Error('Office broker job root is invalid');
    }
    await rm(brokerJobRoot, { recursive: true, force: false });
  }
  await mkdir(brokerJobRoot, { mode: 0o700 });
  let closed = false;
  let timer = null;
  let scanPromise = Promise.resolve();
  let processed = 0;

  async function processRequest(fileName, requestId) {
    const requestPath = path.join(runtime, fileName);
    const processingPath = path.join(runtime, `.processing-${requestId}.json`);
    try {
      await rename(requestPath, processingPath);
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    try {
      const metadata = await lstat(processingPath);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_REQUEST_BYTES) {
        throw new Error('Office request file is invalid');
      }
      const request = await validatedRequest(JSON.parse(await readFile(processingPath, 'utf8')), {
        requestId,
        inputRoot,
        workspaceRoot,
        outputRoot,
      });
      const brokerRequestRoot = path.join(brokerJobRoot, requestId);
      const brokerOutput = path.join(brokerRequestRoot, 'output');
      await mkdir(brokerOutput, { recursive: true, mode: 0o700 });
      const brokerSource = path.join(
        brokerRequestRoot,
        `source${path.extname(request.source.path).toLowerCase()}`,
      );
      await copyValidatedSource(request.source, brokerSource);
      await executeLibreOffice({
        requestId,
        source: brokerSource,
        outputDirectory: brokerOutput,
        runtimeDirectory: runtime,
      });
      const privatePdf = await findPrivatePdf(brokerOutput);
      const resultPath = path.join(runtime, `office-result-${requestId}.pdf`);
      await copyPrivatePdfToRuntime(privatePdf, resultPath);
      await writeResponse(runtime, requestId, {
        schema_version: 'tender_office_render_response_v1',
        request_id: requestId,
        status: 'ok',
        result_path: resultPath,
        file_name: `office-${requestId}.pdf`,
      });
    } catch {
      await writeResponse(runtime, requestId, {
        schema_version: 'tender_office_render_response_v1',
        request_id: requestId,
        status: 'error',
        error_code: 'OFFICE_RENDER_REJECTED',
      }).catch(() => {});
    } finally {
      await rm(processingPath, { force: true }).catch(() => {});
    }
  }

  async function scan() {
    const entries = await readdir(runtime, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const match = REQUEST_FILE_PATTERN.exec(entry.name);
      if (!match || !UUID_PATTERN.test(match[1])) continue;
      processed += 1;
      if (processed > MAX_REQUESTS_PER_ATTEMPT) {
        await rm(path.join(runtime, entry.name), { force: true });
        continue;
      }
      await processRequest(entry.name, match[1]);
    }
  }

  function schedule() {
    if (closed) return;
    timer = setTimeout(() => {
      scanPromise = scan().catch(() => {}).finally(schedule);
    }, pollIntervalMs);
  }

  schedule();
  return Object.freeze({
    async close() {
      closed = true;
      if (timer) clearTimeout(timer);
      await scanPromise;
      await rm(brokerJobRoot, { recursive: true, force: true });
    },
  });
}
