#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  cp,
  lstat,
  mkdir,
  realpath,
  readlink,
  readFile,
  readdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const PIPELINE_VERSION = 'tender_agentic_pipeline_v1';
const MANIFEST_VERSION = 'tender_source_manifest_v1';
const CATALOG_VERSION = 'tender_fields_v1';
const PINNED_RUNNER_CONTROLS = Object.freeze({
  model: 'gpt-5.6-sol',
  reasoning_effort: 'high',
  codex_cli_version: '0.153.4',
});
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'canceled']);
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const MIME_TYPES = new Map([
  ['.pdf', 'application/pdf'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
]);

class BatchError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BatchError';
    this.code = code;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function resolveConfiguredPath(configDirectory, value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BatchError('BATCH_CONFIG_INVALID', `${label} must be a nonblank path`);
  }
  return path.resolve(configDirectory, value);
}

function assertSafeId(value, label) {
  if (typeof value !== 'string' || !SAFE_ID_PATTERN.test(value)) {
    throw new BatchError('BATCH_CONFIG_INVALID', `${label} must be a safe stable identifier`);
  }
  return value;
}

function normalizeConfig(value, configDirectory) {
  if (
    !isRecord(value)
    || value.schema_version !== 'agentic_shadow_batch_v1'
    || !isRecord(value.controls)
    || !Array.isArray(value.cases)
    || value.cases.length === 0
  ) {
    throw new BatchError(
      'BATCH_CONFIG_INVALID',
      'Batch config violates agentic_shadow_batch_v1',
    );
  }
  const batchId = assertSafeId(value.batch_id, 'batch_id');
  const controls = value.controls;
  for (const key of ['model', 'reasoning_effort', 'codex_cli_version']) {
    if (typeof controls[key] !== 'string' || !controls[key].trim()) {
      throw new BatchError('BATCH_CONFIG_INVALID', `controls.${key} must be nonblank`);
    }
    if (controls[key] !== PINNED_RUNNER_CONTROLS[key]) {
      throw new BatchError(
        'BATCH_RUNNER_CONTROL_MISMATCH',
        'Declared controls do not match the pinned runner baseline',
      );
    }
  }
  const caseIds = new Set();
  const procurementKeys = new Set();
  const cases = value.cases.map((entry) => {
    if (!isRecord(entry)) {
      throw new BatchError('BATCH_CONFIG_INVALID', 'Every case must be an object');
    }
    const caseId = assertSafeId(entry.case_id, 'case_id');
    const procurementKey = assertSafeId(entry.procurement_key, 'procurement_key');
    if (caseIds.has(caseId) || procurementKeys.has(procurementKey)) {
      throw new BatchError('BATCH_CONFIG_INVALID', 'Case identities must be unique');
    }
    caseIds.add(caseId);
    procurementKeys.add(procurementKey);
    if (!Number.isSafeInteger(entry.replicates) || entry.replicates < 1 || entry.replicates > 20) {
      throw new BatchError('BATCH_CONFIG_INVALID', 'replicates must be an integer from 1 to 20');
    }
    return {
      case_id: caseId,
      procurement_key: procurementKey,
      source_root: resolveConfiguredPath(configDirectory, entry.source_root, 'source_root'),
      replicates: entry.replicates,
      adjudication: entry.adjudication === null || entry.adjudication === undefined
        ? null
        : resolveConfiguredPath(configDirectory, entry.adjudication, 'adjudication'),
    };
  });
  return {
    schema_version: value.schema_version,
    batch_id: batchId,
    controls: {
      model: controls.model,
      reasoning_effort: controls.reasoning_effort,
      codex_cli_version: controls.codex_cli_version,
      field_catalog_path: resolveConfiguredPath(
        configDirectory,
        controls.field_catalog_path,
        'controls.field_catalog_path',
      ),
      prompt_path: resolveConfiguredPath(configDirectory, controls.prompt_path, 'controls.prompt_path'),
      skill_path: resolveConfiguredPath(configDirectory, controls.skill_path, 'controls.skill_path'),
      result_schema_path: resolveConfiguredPath(
        configDirectory,
        controls.result_schema_path,
        'controls.result_schema_path',
      ),
    },
    cases,
  };
}

function isPathWithin(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function resolveRealPathOrLeaf(candidate) {
  try {
    return await realpath(candidate);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    const realParent = await realpath(path.dirname(candidate));
    return path.join(realParent, path.basename(candidate));
  }
}

function deterministicUuid(identity) {
  const bytes = createHash('sha256').update(identity, 'utf8').digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex').toUpperCase();
}

async function loadControls(controls) {
  const identities = {};
  for (const [name, filePath] of [
    ['field_catalog_sha256', controls.field_catalog_path],
    ['prompt_sha256', controls.prompt_path],
    ['skill_sha256', controls.skill_path],
    ['result_schema_sha256', controls.result_schema_path],
  ]) {
    const metadata = await stat(filePath);
    if (!metadata.isFile()) {
      throw new BatchError('BATCH_CONTROL_INVALID', `${name} source must be a regular file`);
    }
    identities[name] = await sha256File(filePath);
  }
  return {
    model: controls.model,
    reasoning_effort: controls.reasoning_effort,
    codex_cli_version: controls.codex_cli_version,
    ...identities,
  };
}

async function verifyRunnerExecutionProfile({ fetchImpl, runnerBaseUrl, controls }) {
  const response = await fetchImpl(`${runnerBaseUrl}/health`, { method: 'GET' });
  let health;
  try {
    health = JSON.parse(await response.text());
  } catch {
    throw new BatchError('RUNNER_RESPONSE_INVALID', 'Runner health response is not JSON');
  }
  if (health?.readiness?.execute !== true || health?.readiness?.isolation_canary !== true) {
    throw new BatchError(
      'RUNNER_ISOLATION_NOT_READY',
      'Runner execution isolation has not passed its runtime canary',
    );
  }
  const profile = health.execution_profile;
  if (
    !isRecord(profile)
    || profile.schema_version !== 'tender_codex_runner_execution_profile_v1'
    || !String(health?.tools?.codex ?? '').includes(controls.codex_cli_version)
    || Object.entries(controls).some(([key, expected]) => profile[key] !== expected)
  ) {
    throw new BatchError(
      'RUNNER_PROVENANCE_NOT_READY',
      'Runner-owned execution provenance does not match the requested batch controls',
    );
  }
  return {
    schema_version: profile.schema_version,
    model: profile.model,
    reasoning_effort: profile.reasoning_effort,
    codex_cli_version: profile.codex_cli_version,
    field_catalog_sha256: profile.field_catalog_sha256,
    prompt_sha256: profile.prompt_sha256,
    skill_sha256: profile.skill_sha256,
    result_schema_sha256: profile.result_schema_sha256,
  };
}

async function loadSourceDocuments(caseEntry, realRepositoryRoot) {
  const sourceRoot = await realpath(caseEntry.source_root);
  if (isPathWithin(realRepositoryRoot, sourceRoot)) {
    throw new BatchError('BATCH_SOURCE_INSIDE_REPOSITORY', 'Source documents must remain outside Git');
  }
  const sourceMetadata = await stat(sourceRoot);
  if (!sourceMetadata.isDirectory()) {
    throw new BatchError('BATCH_SOURCE_INVALID', 'source_root must be a directory');
  }
  const entries = (await readdir(sourceRoot, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name, 'en'));
  if (entries.length === 0) {
    throw new BatchError('BATCH_SOURCE_INVALID', 'source_root must contain at least one document');
  }
  const documents = [];
  for (const [offset, entry] of entries.entries()) {
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new BatchError('BATCH_SOURCE_INVALID', 'source_root may contain only regular files');
    }
    const extension = path.extname(entry.name).toLowerCase();
    const mimeType = MIME_TYPES.get(extension);
    if (!mimeType) {
      throw new BatchError('BATCH_SOURCE_UNSUPPORTED', 'source_root contains an unsupported file type');
    }
    const sourcePath = path.join(sourceRoot, entry.name);
    const metadata = await stat(sourcePath);
    if (metadata.size > 50 * 1024 * 1024) {
      throw new BatchError('BATCH_SOURCE_TOO_LARGE', 'A source document exceeds 50 MiB');
    }
    const sourceSha256 = await sha256File(sourcePath);
    const documentIndex = offset + 1;
    documents.push({
      artifact_key: `doc-${String(documentIndex).padStart(4, '0')}`,
      document_index: documentIndex,
      source_document_id: deterministicUuid(
        `${caseEntry.procurement_key}:document:${documentIndex}:${sourceSha256}`,
      ),
      file_name: entry.name,
      mime_type: mimeType,
      byte_size: metadata.size,
      source_sha256: sourceSha256,
      source_path: sourcePath,
    });
  }
  return documents;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function requestJson({ fetchImpl, runnerBaseUrl, authToken, route, method, body, byteSize }) {
  const headers = { 'x-tender-codex-token': authToken };
  const options = { method, headers };
  if (body !== undefined) {
    if (typeof body === 'string') {
      headers['content-type'] = 'application/json';
      options.body = body;
    } else {
      headers['content-type'] = 'application/octet-stream';
      headers['content-length'] = String(byteSize);
      options.body = body;
      options.duplex = 'half';
    }
  }
  const response = await fetchImpl(`${runnerBaseUrl}${route}`, options);
  let payload;
  try {
    payload = JSON.parse(await response.text());
  } catch {
    throw new BatchError('RUNNER_RESPONSE_INVALID', 'Runner response is not JSON');
  }
  if (!response.ok) {
    const code = payload?.error?.code ?? 'RUNNER_REQUEST_FAILED';
    throw new BatchError(code, `Runner request failed with HTTP ${response.status}`);
  }
  return payload;
}

function assertRunnerStateIdentity(state, manifest) {
  for (const key of [
    'job_id',
    'analysis_run_id',
    'manifest_version',
    'pipeline_version',
    'field_catalog_version',
    'field_catalog_sha256',
    'expected_documents',
  ]) {
    if (state?.[key] !== manifest[key]) {
      throw new BatchError('RUNNER_IDENTITY_MISMATCH', 'Runner job manifest identity is invalid');
    }
  }
  if (typeof state.status !== 'string') {
    throw new BatchError('RUNNER_IDENTITY_MISMATCH', 'Runner status identity is invalid');
  }
}

async function pollTerminalJob({
  fetchImpl,
  runnerBaseUrl,
  authToken,
  jobId,
  pollIntervalMs,
  pollTimeoutMs,
  sleep,
  now,
  manifest,
}) {
  const deadline = now() + pollTimeoutMs;
  while (now() <= deadline) {
    const status = await requestJson({
      fetchImpl,
      runnerBaseUrl,
      authToken,
      route: `/v1/jobs/${jobId}`,
      method: 'GET',
    });
    assertRunnerStateIdentity(status, manifest);
    if (TERMINAL_STATUSES.has(status.status)) return status;
    await sleep(pollIntervalMs);
  }
  throw new BatchError('RUNNER_POLL_TIMEOUT', 'Runner job did not reach terminal state in time');
}

async function assertArchivableTree(
  directory,
  { archiveRoot = directory, counters = { entries: 0, bytes: 0 } } = {},
) {
  const directoryMetadata = await lstat(directory);
  if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
    throw new BatchError('RUNNER_ARCHIVE_INVALID', 'Runner job archive root must be a regular directory');
  }
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    counters.entries += 1;
    if (counters.entries > 20_000) {
      throw new BatchError('RUNNER_ARCHIVE_INVALID', 'Runner job archive contains too many entries');
    }
    const entryPath = path.join(directory, entry.name);
    const metadata = await lstat(entryPath);
    if (metadata.isSymbolicLink()) {
      let resolvedTarget;
      try {
        resolvedTarget = await realpath(entryPath);
      } catch {
        throw new BatchError('RUNNER_ARCHIVE_INVALID', 'Runner job archive contains a broken symlink');
      }
      if (!isPathWithin(archiveRoot, resolvedTarget)) {
        throw new BatchError('RUNNER_ARCHIVE_INVALID', 'Runner job archive symlink escaped its root');
      }
      const targetMetadata = await stat(entryPath);
      if (!targetMetadata.isFile() && !targetMetadata.isDirectory()) {
        throw new BatchError('RUNNER_ARCHIVE_INVALID', 'Runner job archive symlink targets a special file');
      }
      continue;
    }
    if (metadata.isDirectory()) {
      await assertArchivableTree(entryPath, { archiveRoot, counters });
    } else if (metadata.isFile()) {
      counters.bytes += metadata.size;
      if (counters.bytes > 2 * 1024 * 1024 * 1024) {
        throw new BatchError('RUNNER_ARCHIVE_INVALID', 'Runner job archive exceeds 2 GiB');
      }
    } else {
      throw new BatchError('RUNNER_ARCHIVE_INVALID', 'Runner job archive contains a special file');
    }
  }
  return counters;
}

async function buildArchiveInventory(root) {
  const inventory = [];
  async function walk(directory) {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      const metadata = await lstat(entryPath);
      if (metadata.isSymbolicLink()) {
        inventory.push({
          path: path.relative(root, entryPath).split(path.sep).join('/'),
          entry_type: 'symlink',
          link_target: await readlink(entryPath),
        });
      } else if (metadata.isDirectory()) await walk(entryPath);
      else if (metadata.isFile()) {
        inventory.push({
          path: path.relative(root, entryPath).split(path.sep).join('/'),
          byte_size: metadata.size,
          sha256: await sha256File(entryPath),
        });
      }
    }
  }
  await walk(root);
  return inventory;
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function copyTerminalJob({ runnerJobsRoot, jobId, replicateDirectory }) {
  const source = path.resolve(runnerJobsRoot, jobId);
  if (!isPathWithin(runnerJobsRoot, source) || source === path.resolve(runnerJobsRoot)) {
    throw new BatchError('RUNNER_ARCHIVE_INVALID', 'Runner job archive path escaped its root');
  }
  await assertArchivableTree(source);
  const sourceFiles = await buildArchiveInventory(source);
  const destination = path.join(replicateDirectory, 'job');
  let destinationExists = true;
  try {
    await lstat(destination);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    destinationExists = false;
  }
  if (destinationExists) {
    await assertArchivableTree(destination);
  } else {
    await cp(source, destination, {
      recursive: true,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
    });
  }
  await assertArchivableTree(destination);
  const files = await buildArchiveInventory(destination);
  if (canonicalJson(files) !== canonicalJson(sourceFiles)) {
    throw new BatchError(
      'RUNNER_ARCHIVE_INTEGRITY_MISMATCH',
      'Existing or copied runner archive does not match the terminal job directory',
    );
  }
  await writeJson(path.join(replicateDirectory, 'archive-sha256.json'), {
    schema_version: 'agentic_shadow_archive_inventory_v1',
    job_id: jobId,
    file_count: files.length,
    files,
  });
}

function publicDocuments(documents) {
  return documents.map(({ source_path: ignored, ...document }) => document);
}

async function executeReplicate({
  batch,
  caseEntry,
  documents,
  controls,
  replicateIndex,
  outputRoot,
  runnerJobsRoot,
  runnerBaseUrl,
  authToken,
  fetchImpl,
  pollIntervalMs,
  pollTimeoutMs,
  sleep,
  now,
}) {
  const sourceIdentity = createHash('sha256')
    .update(canonicalJson(publicDocuments(documents)), 'utf8')
    .digest('hex')
    .toUpperCase();
  const analysisRunId = deterministicUuid(
    `${batch.batch_id}:${caseEntry.procurement_key}:replicate:${replicateIndex}:analysis-run:${sourceIdentity}`,
  );
  const jobId = deterministicUuid(
    `${batch.batch_id}:${caseEntry.case_id}:replicate:${replicateIndex}:${sourceIdentity}:${canonicalJson(controls)}`,
  );
  const manifest = {
    manifest_version: MANIFEST_VERSION,
    job_id: jobId,
    analysis_run_id: analysisRunId,
    pipeline_version: PIPELINE_VERSION,
    field_catalog_version: CATALOG_VERSION,
    field_catalog_sha256: controls.field_catalog_sha256,
    expected_documents: documents.length,
    documents: publicDocuments(documents),
  };
  const replicateDirectory = path.join(
    outputRoot,
    'cases',
    caseEntry.case_id,
    `replicate-${String(replicateIndex).padStart(2, '0')}`,
  );
  await mkdir(replicateDirectory, { recursive: true });

  let current;
  try {
    current = await requestJson({
      fetchImpl,
      runnerBaseUrl,
      authToken,
      route: `/v1/jobs/${jobId}`,
      method: 'GET',
    });
  } catch (error) {
    if (!(error instanceof BatchError) || error.code !== 'RUNNER_JOB_NOT_FOUND') throw error;
    current = null;
  }
  if (current) assertRunnerStateIdentity(current, manifest);
  if (!current || current.status === 'staging') {
    current = await requestJson({
      fetchImpl,
      runnerBaseUrl,
      authToken,
      route: '/v1/jobs',
      method: 'PUT',
      body: JSON.stringify(manifest),
    });
    assertRunnerStateIdentity(current, manifest);
    if (current.status !== 'staging') {
      throw new BatchError('RUNNER_IDENTITY_MISMATCH', 'Runner create identity is invalid');
    }
  }

  let sealed = current;
  if (current.status === 'staging') {
    for (const document of documents) {
      const uploaded = await requestJson({
        fetchImpl,
        runnerBaseUrl,
        authToken,
        route: `/v1/jobs/${jobId}/documents/${document.artifact_key}`,
        method: 'PUT',
        body: createReadStream(document.source_path),
        byteSize: document.byte_size,
      });
      if (
        uploaded.job_id !== jobId
        || uploaded.artifact_key !== document.artifact_key
        || uploaded.byte_size !== document.byte_size
        || String(uploaded.sha256).toUpperCase() !== document.source_sha256
      ) {
        throw new BatchError('RUNNER_UPLOAD_IDENTITY_MISMATCH', 'Runner upload identity is invalid');
      }
    }
    sealed = await requestJson({
      fetchImpl,
      runnerBaseUrl,
      authToken,
      route: `/v1/jobs/${jobId}/seal`,
      method: 'POST',
    });
  } else if (current.status === 'ready') {
    sealed = await requestJson({
      fetchImpl,
      runnerBaseUrl,
      authToken,
      route: `/v1/jobs/${jobId}/seal`,
      method: 'POST',
    });
  }
  assertRunnerStateIdentity(sealed, manifest);
  if (!['ready', 'running', 'validating', 'completed', 'failed', 'canceled'].includes(sealed.status)) {
    throw new BatchError('RUNNER_IDENTITY_MISMATCH', 'Runner sealed state identity is invalid');
  }
  if (sealed.status === 'ready' || (sealed.status === 'failed' && sealed.failure?.retryable === true)) {
    const started = await requestJson({
      fetchImpl,
      runnerBaseUrl,
      authToken,
      route: `/v1/jobs/${jobId}/start`,
      method: 'POST',
    });
    assertRunnerStateIdentity(started, manifest);
    current = started;
  } else {
    current = sealed;
  }
  const terminal = TERMINAL_STATUSES.has(current.status)
    ? current
    : await pollTerminalJob({
        fetchImpl,
        runnerBaseUrl,
        authToken,
        jobId,
        pollIntervalMs,
        pollTimeoutMs,
        sleep,
        now,
        manifest,
      });
  assertRunnerStateIdentity(terminal, manifest);
  await writeJson(path.join(replicateDirectory, 'terminal-status.json'), terminal);

  let resultPath = null;
  if (terminal.status === 'completed') {
    const response = await requestJson({
      fetchImpl,
      runnerBaseUrl,
      authToken,
      route: `/v1/jobs/${jobId}/result`,
      method: 'GET',
    });
    if (response.job_id !== jobId || !isRecord(response.result) || !isRecord(response.validation)) {
      throw new BatchError('RUNNER_RESULT_INVALID', 'Runner result envelope is invalid');
    }
    await writeJson(path.join(replicateDirectory, 'result.json'), response.result);
    await writeJson(path.join(replicateDirectory, 'validation.json'), response.validation);
    resultPath = path.relative(
      outputRoot,
      path.join(replicateDirectory, 'result.json'),
    ).split(path.sep).join('/');
  }
  await copyTerminalJob({ runnerJobsRoot, jobId, replicateDirectory });
  const metadata = {
    schema_version: 'agentic_shadow_run_metadata_v1',
    batch_id: batch.batch_id,
    case_id: caseEntry.case_id,
    procurement_key: caseEntry.procurement_key,
    replicate_index: replicateIndex,
    job_id: jobId,
    analysis_run_id: analysisRunId,
    pipeline_version: PIPELINE_VERSION,
    source_identity_sha256: sourceIdentity,
    input_manifest_sha256: terminal.input_manifest_sha256
      ?? sealed.input_manifest_sha256
      ?? null,
    controls,
    documents: publicDocuments(documents),
    terminal_status: terminal.status,
    token_usage: terminal.usage ?? null,
  };
  await writeJson(path.join(replicateDirectory, 'run-metadata.json'), metadata);
  return {
    case_id: caseEntry.case_id,
    procurement_key: caseEntry.procurement_key,
    replicate_index: replicateIndex,
    job_id: jobId,
    terminal_status: terminal.status,
    result: resultPath,
  };
}

export async function runAgenticShadowBatch({
  configPath,
  outputRoot,
  runnerBaseUrl,
  runnerJobsRoot,
  authToken,
  fetchImpl = globalThis.fetch,
  pollIntervalMs = 1_000,
  pollTimeoutMs = 24 * 60 * 60 * 1_000,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = () => Date.now(),
} = {}) {
  if (typeof fetchImpl !== 'function') throw new BatchError('BATCH_CONFIG_INVALID', 'fetch is required');
  if (typeof authToken !== 'string' || authToken.length < 32) {
    throw new BatchError('BATCH_AUTH_INVALID', 'Runner auth token must contain at least 32 characters');
  }
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1) {
    throw new BatchError('BATCH_CONFIG_INVALID', 'pollIntervalMs must be a positive integer');
  }
  if (!Number.isSafeInteger(pollTimeoutMs) || pollTimeoutMs < pollIntervalMs) {
    throw new BatchError('BATCH_CONFIG_INVALID', 'pollTimeoutMs must not be shorter than pollIntervalMs');
  }
  const resolvedConfigPath = path.resolve(configPath);
  const [realRepositoryRoot, resolvedOutputRoot, resolvedRunnerJobsRoot] = await Promise.all([
    realpath(repositoryRoot),
    resolveRealPathOrLeaf(path.resolve(outputRoot)),
    realpath(path.resolve(runnerJobsRoot)),
  ]);
  if (isPathWithin(realRepositoryRoot, resolvedOutputRoot)) {
    throw new BatchError('BATCH_OUTPUT_INSIDE_REPOSITORY', 'Evaluation output must remain outside Git');
  }
  if (isPathWithin(realRepositoryRoot, resolvedRunnerJobsRoot)) {
    throw new BatchError('BATCH_RUNNER_ROOT_INSIDE_REPOSITORY', 'Runner jobs must remain outside Git');
  }
  let runnerUrl;
  try {
    runnerUrl = new URL(runnerBaseUrl);
  } catch {
    throw new BatchError('BATCH_CONFIG_INVALID', 'runnerBaseUrl must be a valid URL');
  }
  if (!['http:', 'https:'].includes(runnerUrl.protocol) || runnerUrl.username || runnerUrl.password) {
    throw new BatchError('BATCH_CONFIG_INVALID', 'runnerBaseUrl must be an HTTP URL without credentials');
  }
  const normalizedRunnerBaseUrl = runnerUrl.href.replace(/\/$/u, '');
  const batch = normalizeConfig(
    JSON.parse(await readFile(resolvedConfigPath, 'utf8')),
    path.dirname(resolvedConfigPath),
  );
  const controls = await loadControls(batch.controls);
  const executionProfile = await verifyRunnerExecutionProfile({
    fetchImpl,
    runnerBaseUrl: normalizedRunnerBaseUrl,
    controls,
  });
  await mkdir(resolvedOutputRoot, { recursive: true });
  const runs = [];
  const indexCases = [];
  for (const caseEntry of batch.cases) {
    const documents = await loadSourceDocuments(caseEntry, realRepositoryRoot);
    const caseDirectory = path.join(resolvedOutputRoot, 'cases', caseEntry.case_id);
    await mkdir(caseDirectory, { recursive: true });
    let adjudication = null;
    if (caseEntry.adjudication) {
      const adjudicationBytes = await readFile(caseEntry.adjudication);
      JSON.parse(adjudicationBytes.toString('utf8'));
      adjudication = `cases/${caseEntry.case_id}/adjudication.json`;
      await writeFile(path.join(caseDirectory, 'adjudication.json'), adjudicationBytes);
    }
    const replicateEntries = [];
    const indexCase = {
      case_id: caseEntry.case_id,
      procurement_key: caseEntry.procurement_key,
      adjudication,
      replicates: replicateEntries,
    };
    indexCases.push(indexCase);
    for (let replicateIndex = 1; replicateIndex <= caseEntry.replicates; replicateIndex += 1) {
      const run = await executeReplicate({
        batch,
        caseEntry,
        documents,
        controls,
        replicateIndex,
        outputRoot: resolvedOutputRoot,
        runnerJobsRoot: resolvedRunnerJobsRoot,
        runnerBaseUrl: normalizedRunnerBaseUrl,
        authToken,
        fetchImpl,
        pollIntervalMs,
        pollTimeoutMs,
        sleep,
        now,
      });
      runs.push(run);
      replicateEntries.push({
        replicate_index: replicateIndex,
        job_id: run.job_id,
        terminal_status: run.terminal_status,
        result: run.result,
      });
      await writeJson(path.join(resolvedOutputRoot, 'evaluation-index.json'), {
        schema_version: 'agentic_shadow_evaluation_index_v1',
        batch_id: batch.batch_id,
        cases: indexCases.filter(({ replicates }) => replicates.length > 0),
      });
    }
  }
  const summary = {
    schema_version: 'agentic_shadow_batch_summary_v1',
    ok: runs.every(({ terminal_status: status }) => status === 'completed'),
    batch_id: batch.batch_id,
    case_count: batch.cases.length,
    replicate_count: runs.length,
    controls,
    runner_execution_profile: executionProfile,
    runs,
  };
  await writeJson(path.join(resolvedOutputRoot, 'batch-summary.json'), summary);
  await writeJson(path.join(resolvedOutputRoot, 'evaluation-index.json'), {
    schema_version: 'agentic_shadow_evaluation_index_v1',
    batch_id: batch.batch_id,
    cases: indexCases,
  });
  return summary;
}

function parseArguments(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith('--') || value === undefined) {
      throw new BatchError('BATCH_INVOCATION_INVALID', 'Arguments must be --name value pairs');
    }
    parsed[name.slice(2)] = value;
  }
  return parsed;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  for (const required of [
    'config',
    'output-root',
    'runner-url',
    'runner-jobs-root',
    'auth-token-file',
  ]) {
    if (!args[required]) {
      throw new BatchError(
        'BATCH_INVOCATION_INVALID',
        'Required: --config --output-root --runner-url --runner-jobs-root --auth-token-file',
      );
    }
  }
  const authToken = (await readFile(path.resolve(args['auth-token-file']), 'utf8')).trim();
  const summary = await runAgenticShadowBatch({
    configPath: args.config,
    outputRoot: args['output-root'],
    runnerBaseUrl: args['runner-url'],
    runnerJobsRoot: args['runner-jobs-root'],
    authToken,
    pollIntervalMs: args['poll-interval-ms'] ? Number(args['poll-interval-ms']) : undefined,
    pollTimeoutMs: args['poll-timeout-ms'] ? Number(args['poll-timeout-ms']) : undefined,
  });
  process.stdout.write(`${JSON.stringify({
    ok: summary.ok,
    batch_id: summary.batch_id,
    case_count: summary.case_count,
    replicate_count: summary.replicate_count,
  })}\n`);
  if (!summary.ok) process.exitCode = 2;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  main().catch((error) => {
    const code = error instanceof BatchError ? error.code : 'BATCH_FAILED';
    process.stdout.write(`${JSON.stringify({
      ok: false,
      error: { code, message: error instanceof BatchError ? error.message : 'Batch failed' },
    })}\n`);
    process.exitCode = 2;
  });
}
