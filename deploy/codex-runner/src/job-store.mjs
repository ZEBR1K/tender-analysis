import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';

import fieldPolicy from '../policies/tender-fields-v1.json' with { type: 'json' };
import { RunnerError } from './errors.mjs';
import {
  assertArtifactKey,
  assertJobId,
  canonicalJson,
  computeManifestSha256,
  normalizeSourceManifest,
} from './manifest.mjs';

const STATE_FILE_NAME = 'job-state.json';
const MANIFEST_FILE_NAME = 'manifest.json';
const CATALOG_FILE_NAME = 'FIELD_CATALOG.md';
const RESIDUE_PATTERN = /^\.upload-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/iu;
const CREATE_RESIDUE_PATTERN = /^\.create-([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.tmp$/iu;
const WRITE_RESIDUE_PATTERN = /^\.write-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/iu;
const JOB_DIRECTORY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed']);
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SEALED_JOB_STATUSES = new Set([
  'ready',
  'running',
  'validating',
  'completed',
  'failed',
]);

function storeError(code, message, httpStatus = 422) {
  return new RunnerError(code, message, httpStatus);
}

function exactChild(parent, childName) {
  const resolvedParent = path.resolve(parent);
  const resolved = path.resolve(resolvedParent, childName);
  if (path.dirname(resolved) !== resolvedParent) {
    throw storeError('RUNNER_REQUEST_INVALID', 'Resolved path escaped its parent directory', 400);
  }
  return resolved;
}

export function resolveJobPath(rootDirectory, jobId) {
  const normalizedJobId = assertJobId(jobId);
  return exactChild(path.resolve(rootDirectory), normalizedJobId);
}

export function documentPhysicalName(document) {
  const artifactKey = assertArtifactKey(document?.artifact_key);
  if (!Number.isSafeInteger(document?.document_index) || document.document_index < 1) {
    throw storeError('RUNNER_MANIFEST_INVALID', 'document_index must be a positive integer');
  }
  return `${String(document.document_index).padStart(4, '0')}-${artifactKey}.source`;
}

async function fsyncDirectory(directory) {
  let handle;
  try {
    handle = await open(directory, 'r');
    await handle.sync();
  } catch (error) {
    if (process.platform !== 'win32') throw error;
  } finally {
    await handle?.close();
  }
}

async function atomicWriteFile(targetPath, contents) {
  const parent = path.dirname(targetPath);
  const temporaryPath = exactChild(parent, `.write-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporaryPath, targetPath);
    await fsyncDirectory(parent);
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

async function hashReadable(readable) {
  const hash = createHash('sha256');
  let byteSize = 0;
  for await (const chunk of readable) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    hash.update(buffer);
    byteSize += buffer.length;
  }
  return { byteSize, sha256: hash.digest('hex').toUpperCase() };
}

async function hashFile(filePath, {
  code = 'RUNNER_DOCUMENT_MISMATCH',
  message = 'A staged source path is missing or is not a regular file',
} = {}) {
  const metadata = await lstat(filePath).catch((error) => {
    if (error?.code === 'ENOENT') throw storeError(code, message);
    throw error;
  });
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw storeError(code, message);
  }
  try {
    return await hashReadable(createReadStream(filePath));
  } catch (error) {
    if (['EISDIR', 'ELOOP', 'ENOENT'].includes(error?.code)) throw storeError(code, message);
    throw error;
  }
}

async function assertFileIdentity(filePath, expected, code, message) {
  const actual = await hashFile(filePath, { code, message });
  if (actual.byteSize !== expected.byteSize || actual.sha256 !== expected.sha256) {
    throw storeError(code, message);
  }
}

function publicJobState(state, { idempotent } = {}) {
  const response = {
    job_id: state.manifest.job_id,
    analysis_run_id: state.manifest.analysis_run_id,
    manifest_version: state.manifest.manifest_version,
    pipeline_version: state.manifest.pipeline_version,
    field_catalog_version: state.manifest.field_catalog_version,
    field_catalog_sha256: state.manifest.field_catalog_sha256,
    status: state.status,
    expected_documents: state.manifest.expected_documents,
    staged_documents: Object.keys(state.uploads).length,
    input_manifest_sha256: state.input_manifest_sha256 ?? null,
  };
  if (Number.isSafeInteger(state.attempt) && state.attempt > 0) {
    response.attempt = state.attempt;
  }
  if (Array.isArray(state.prior_attempts) && state.prior_attempts.length > 0) {
    response.prior_attempts = structuredClone(state.prior_attempts);
  }
  if (state.failure) response.failure = structuredClone(state.failure);
  if (state.execution?.usage) response.usage = structuredClone(state.execution.usage);
  if (state.status === 'completed') response.result_available = true;
  if (idempotent !== undefined) response.idempotent = idempotent;
  return response;
}

function resultBytes(value) {
  const bytes = Buffer.isBuffer(value)
    ? value
    : typeof value === 'string'
      ? Buffer.from(value, 'utf8')
      : null;
  if (!bytes || bytes.length === 0 || bytes.length > 2 * 1024 * 1024) {
    throw storeError('RUNNER_REQUEST_INVALID', 'Validated result bytes are missing or exceed the limit');
  }
  return bytes;
}

function validatedResultArtifactName(attempt) {
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > 2) {
    throw storeError('RUNNER_JOB_STATE_INVALID', 'Result attempt is invalid', 409);
  }
  return `validated-result.attempt-${attempt}.json`;
}

function validationArtifactName(attempt) {
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > 2) {
    throw storeError('RUNNER_JOB_STATE_INVALID', 'Validation attempt is invalid', 409);
  }
  return `validation.attempt-${attempt}.json`;
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

function parseResultObject(bytes) {
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw storeError('RUNNER_REQUEST_INVALID', 'Validated result bytes are not valid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw storeError('RUNNER_REQUEST_INVALID', 'Validated result must be a JSON object');
  }
  return value;
}

function parseJsonObjectOrNull(bytes) {
  if (!bytes) return null;
  try {
    const value = JSON.parse(bytes.toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

async function assertOrWriteExactFile(filePath, bytes) {
  const metadata = await lstat(filePath).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (!metadata) {
    await atomicWriteFile(filePath, bytes);
    return;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw storeError('RUNNER_INTERNAL', 'Runner result target is invalid', 500);
  }
  const current = await readFile(filePath);
  if (!current.equals(bytes)) {
    throw storeError('RUNNER_INTERNAL', 'Runner result changed between validation and persistence', 500);
  }
}

async function readBoundedRegularFile(filePath, maxBytes = 2 * 1024 * 1024) {
  const metadata = await lstat(filePath).catch((error) => {
    if (error?.code === 'ENOENT') {
      throw storeError('RUNNER_INTERNAL', 'Runner result artifact is missing', 500);
    }
    throw error;
  });
  if (
    !metadata.isFile()
    || metadata.isSymbolicLink()
    || metadata.size > maxBytes
  ) {
    throw storeError('RUNNER_INTERNAL', 'Runner result artifact is invalid or exceeds its bound', 500);
  }
  const bytes = await readFile(filePath);
  if (bytes.length > maxBytes) {
    throw storeError('RUNNER_INTERNAL', 'Runner result artifact exceeds its bound', 500);
  }
  return bytes;
}

async function readOptionalBoundedRegularFile(filePath) {
  const metadata = await lstat(filePath).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (!metadata) return null;
  return readBoundedRegularFile(filePath);
}

async function readState(jobPath) {
  const statePath = exactChild(jobPath, STATE_FILE_NAME);
  let source;
  try {
    source = await readFile(statePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') throw storeError('RUNNER_JOB_NOT_FOUND', 'Job was not found', 404);
    throw error;
  }
  try {
    return JSON.parse(source);
  } catch {
    throw storeError('RUNNER_INTERNAL', 'Runner job state is unreadable', 500);
  }
}

async function writeState(jobPath, state) {
  await atomicWriteFile(exactChild(jobPath, STATE_FILE_NAME), `${canonicalJson(state)}\n`);
}

async function ensureRegularDirectory(directory, missingCode = 'RUNNER_JOB_NOT_FOUND') {
  const metadata = await lstat(directory).catch((error) => {
    if (error?.code === 'ENOENT') throw storeError(missingCode, 'Job was not found', 404);
    throw error;
  });
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw storeError('RUNNER_INTERNAL', 'Runner job directory is invalid', 500);
  }
}

async function ensureOrCreateRegularDirectory(parent, name) {
  const directory = exactChild(parent, name);
  const metadata = await lstat(directory).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (metadata) {
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw storeError('RUNNER_INTERNAL', 'Runner workspace directory is invalid', 500);
    }
    return directory;
  }
  await mkdir(directory, { mode: 0o700 });
  return directory;
}

function boundedCode(value, fallback = 'RUNNER_INTERNAL') {
  const normalized = String(value || '');
  return /^[A-Z0-9_]{1,80}$/u.test(normalized) ? normalized : fallback;
}

function tokenUsage(value) {
  const result = {};
  for (const key of [
    'input_tokens',
    'cached_input_tokens',
    'output_tokens',
    'reasoning_output_tokens',
  ]) {
    result[key] = Number.isSafeInteger(value?.[key]) && value[key] >= 0 ? value[key] : 0;
  }
  return result;
}

function executionSummary(execution) {
  const eventAudit = execution?.events ?? execution;
  return {
    code: boundedCode(execution?.code, 'CODEX_TRANSPORT_ERROR'),
    thread_id: typeof eventAudit?.thread_id === 'string'
      ? eventAudit.thread_id.slice(0, 200)
      : null,
    usage: tokenUsage(eventAudit?.usage),
    artifacts: Object.fromEntries(
      Object.entries(execution?.artifacts ?? {})
        .filter(([, value]) => typeof value === 'string')
        .map(([key, value]) => [key, path.basename(value).slice(0, 255)]),
    ),
  };
}

function priorAttemptRecord({ attempt, code, at, execution }) {
  return {
    attempt,
    code: boundedCode(code, 'CODEX_TRANSPORT_ERROR'),
    retryable: true,
    at,
    execution: execution ? executionSummary(execution) : null,
  };
}

function validationFailureBytes({ jobId, attempt, envelope, issues }) {
  const payload = envelope ?? {
    schema_version: 'tender_agent_validation_failure_v1',
    job_id: jobId,
    attempt,
    valid: false,
    issues: Array.isArray(issues) ? issues : [],
  };
  const bytes = Buffer.from(`${canonicalJson(payload)}\n`, 'utf8');
  if (bytes.length > 2 * 1024 * 1024) {
    throw storeError('RUNNER_INTERNAL', 'Validation audit exceeds its bound', 500);
  }
  return { bytes, envelopeAvailable: envelope !== null && envelope !== undefined };
}

async function cleanupCrashResidue(temporaryDirectory) {
  const entries = await readdir(temporaryDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (!RESIDUE_PATTERN.test(entry.name)) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    await unlink(exactChild(temporaryDirectory, entry.name)).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }
}

async function cleanupAtomicWriteResidue(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!WRITE_RESIDUE_PATTERN.test(entry.name)) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    await unlink(exactChild(directory, entry.name)).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }
}

async function cleanupCreateResidue(rootDirectory, jobId) {
  const entries = await readdir(rootDirectory, { withFileTypes: true });
  for (const entry of entries) {
    const match = entry.name.match(CREATE_RESIDUE_PATTERN);
    if (!match || match[1].toLowerCase() !== jobId) continue;
    await rm(exactChild(rootDirectory, entry.name), { recursive: true, force: true });
  }
}

export function createJobStore({
  rootDirectory,
  fieldCatalogPath,
  expectedCatalogSha256 = fieldPolicy.expected_catalog_sha256,
  faultInjector = async () => {},
  now = () => new Date(),
} = {}) {
  if (typeof rootDirectory !== 'string' || rootDirectory.length === 0) {
    throw new TypeError('rootDirectory is required');
  }
  if (typeof fieldCatalogPath !== 'string' || fieldCatalogPath.length === 0) {
    throw new TypeError('fieldCatalogPath is required');
  }
  if (!/^[0-9a-f]{64}$/iu.test(expectedCatalogSha256 ?? '')) {
    throw new TypeError('expectedCatalogSha256 must be a SHA-256 value');
  }
  if (typeof faultInjector !== 'function') throw new TypeError('faultInjector must be a function');
  if (typeof now !== 'function') throw new TypeError('now must be a function');

  const resolvedRoot = path.resolve(rootDirectory);
  const resolvedCatalogPath = path.resolve(fieldCatalogPath);
  const normalizedCatalogSha256 = expectedCatalogSha256.toUpperCase();
  const lockTails = new Map();

  function timestamp() {
    const value = now();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new TypeError('now must return a valid Date');
    }
    return value.toISOString();
  }

  async function withJobLock(jobId, task) {
    const normalizedJobId = assertJobId(jobId);
    const previous = lockTails.get(normalizedJobId) ?? Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const tail = previous.then(() => gate);
    lockTails.set(normalizedJobId, tail);
    await previous;
    try {
      return await task(normalizedJobId);
    } finally {
      release();
      if (lockTails.get(normalizedJobId) === tail) lockTails.delete(normalizedJobId);
    }
  }

  async function catalogBytes() {
    const bytes = await readFile(resolvedCatalogPath).catch((error) => {
      throw storeError('RUNNER_CATALOG_MISMATCH', `Pinned field catalog is unavailable (${error.code ?? 'read error'})`, 503);
    });
    const actual = createHash('sha256').update(bytes).digest('hex').toUpperCase();
    if (actual !== normalizedCatalogSha256) {
      throw storeError('RUNNER_CATALOG_MISMATCH', 'Pinned field catalog hash does not match runner policy', 503);
    }
    return bytes;
  }

  async function loadJob(normalizedJobId) {
    const jobPath = resolveJobPath(resolvedRoot, normalizedJobId);
    await ensureRegularDirectory(jobPath);
    const inputDirectory = exactChild(jobPath, 'input');
    const documentsDirectory = exactChild(inputDirectory, 'documents');
    const temporaryDirectory = exactChild(inputDirectory, '.upload-tmp');
    await Promise.all([
      ensureRegularDirectory(inputDirectory),
      ensureRegularDirectory(documentsDirectory),
      ensureRegularDirectory(temporaryDirectory),
    ]);
    await Promise.all([
      cleanupAtomicWriteResidue(jobPath),
      cleanupAtomicWriteResidue(inputDirectory),
    ]);
    return {
      jobPath,
      inputDirectory,
      documentsDirectory,
      temporaryDirectory,
      state: await readState(jobPath),
    };
  }

  async function verifySealedJob(job) {
    if (
      !SEALED_JOB_STATUSES.has(job.state.status)
      || !/^[0-9a-f]{64}$/iu.test(job.state.input_manifest_sha256 ?? '')
    ) {
      throw storeError('RUNNER_MANIFEST_INCOMPLETE', 'Job input is not sealed', 409);
    }

    let manifest;
    try {
      manifest = normalizeSourceManifest(job.state.manifest, {
        expectedCatalogSha256: normalizedCatalogSha256,
      });
    } catch {
      throw storeError('RUNNER_MANIFEST_MISMATCH', 'Sealed manifest state is invalid');
    }
    if (canonicalJson(manifest) !== canonicalJson(job.state.manifest)) {
      throw storeError('RUNNER_MANIFEST_MISMATCH', 'Sealed manifest state is invalid');
    }

    await assertExactDirectoryEntries(
      job.inputDirectory,
      [
        { name: '.upload-tmp', kind: 'directory' },
        { name: CATALOG_FILE_NAME, kind: 'file' },
        { name: MANIFEST_FILE_NAME, kind: 'file' },
        { name: 'documents', kind: 'directory' },
      ],
      'Agent-visible input contains undeclared files',
    );
    await assertExactDirectoryEntries(
      job.temporaryDirectory,
      [],
      'Agent-visible upload staging contains undeclared files',
    );
    await assertExactDirectoryEntries(
      job.documentsDirectory,
      manifest.documents.map((document) => ({
        name: documentPhysicalName(document),
        kind: 'file',
      })),
      'Agent-visible documents do not exactly match the sealed manifest',
    );

    for (const document of manifest.documents) {
      await assertFileIdentity(
        exactChild(job.documentsDirectory, documentPhysicalName(document)),
        { byteSize: document.byte_size, sha256: document.source_sha256 },
        'RUNNER_DOCUMENT_MISMATCH',
        'A sealed source file no longer matches the manifest',
      );
    }

    const catalog = await catalogBytes();
    await assertFileIdentity(
      exactChild(job.inputDirectory, CATALOG_FILE_NAME),
      {
        byteSize: catalog.length,
        sha256: createHash('sha256').update(catalog).digest('hex').toUpperCase(),
      },
      'RUNNER_CATALOG_MISMATCH',
      'Sealed field catalog no longer matches the runner catalog',
    );

    const persistedManifest = {
      ...manifest,
      staged_documents: manifest.expected_documents,
    };
    const manifestSha256 = computeManifestSha256(persistedManifest);
    if (job.state.input_manifest_sha256 !== manifestSha256) {
      throw storeError('RUNNER_MANIFEST_MISMATCH', 'Sealed manifest hash no longer matches job state');
    }
    persistedManifest.input_manifest_sha256 = manifestSha256;
    const manifestBytes = Buffer.from(`${canonicalJson(persistedManifest)}\n`, 'utf8');
    await assertFileIdentity(
      exactChild(job.inputDirectory, MANIFEST_FILE_NAME),
      {
        byteSize: manifestBytes.length,
        sha256: createHash('sha256').update(manifestBytes).digest('hex').toUpperCase(),
      },
      'RUNNER_MANIFEST_MISMATCH',
      'Sealed manifest file no longer matches job state',
    );

    return publicJobState(job.state, { idempotent: true });
  }

  async function createJob(rawManifest) {
    const manifest = normalizeSourceManifest(rawManifest, {
      expectedCatalogSha256: normalizedCatalogSha256,
    });
    await catalogBytes();
    return withJobLock(manifest.job_id, async (normalizedJobId) => {
      await mkdir(resolvedRoot, { recursive: true, mode: 0o700 });
      const jobPath = resolveJobPath(resolvedRoot, normalizedJobId);
      const existingJob = await lstat(jobPath).catch((error) => {
        if (error?.code === 'ENOENT') return null;
        throw error;
      });
      if (existingJob) {
        await ensureRegularDirectory(jobPath);
        await cleanupAtomicWriteResidue(jobPath);
        const existing = await readState(jobPath);
        if (existing.status === 'ready') {
          throw storeError('RUNNER_JOB_SEALED', 'Sealed job inputs are immutable', 409);
        }
        if (canonicalJson(existing.manifest) !== canonicalJson(manifest)) {
          throw storeError('RUNNER_JOB_EXISTS_CONFLICT', 'Job already exists with a different manifest', 409);
        }
        return publicJobState(existing, { idempotent: true });
      }

      await cleanupCreateResidue(resolvedRoot, normalizedJobId);
      const createPath = exactChild(
        resolvedRoot,
        `.create-${normalizedJobId}-${randomUUID()}.tmp`,
      );
      let published = false;
      try {
        await mkdir(createPath, { mode: 0o700 });
        await faultInjector('after-create-job-directory');
        const inputDirectory = exactChild(createPath, 'input');
        const documentsDirectory = exactChild(inputDirectory, 'documents');
        const temporaryDirectory = exactChild(inputDirectory, '.upload-tmp');
        await mkdir(inputDirectory, { mode: 0o700 });
        await mkdir(documentsDirectory, { mode: 0o700 });
        await mkdir(temporaryDirectory, { mode: 0o700 });
        const createdAt = timestamp();
        const state = {
          manifest,
          status: 'staging',
          uploads: {},
          input_manifest_sha256: null,
          attempt: 0,
          prior_attempts: [],
          failure: null,
          execution: null,
          created_at: createdAt,
          updated_at: createdAt,
          finished_at: null,
        };
        await writeState(createPath, state);
        await rename(createPath, jobPath);
        published = true;
        await fsyncDirectory(resolvedRoot);
        return publicJobState(state, { idempotent: false });
      } catch (error) {
        if (!published) await rm(createPath, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
    });
  }

  async function uploadDocument({ jobId, artifactKey, bodyStream }) {
    const normalizedArtifactKey = assertArtifactKey(artifactKey);
    if (!bodyStream || typeof bodyStream[Symbol.asyncIterator] !== 'function') {
      throw storeError('RUNNER_REQUEST_INVALID', 'Document body must be a stream', 400);
    }
    return withJobLock(jobId, async (normalizedJobId) => {
      const job = await loadJob(normalizedJobId);
      if (job.state.status !== 'staging') {
        throw storeError('RUNNER_JOB_SEALED', 'Sealed job inputs are immutable', 409);
      }
      await cleanupCrashResidue(job.temporaryDirectory);
      const document = job.state.manifest.documents.find(
        (candidate) => candidate.artifact_key === normalizedArtifactKey,
      );
      if (!document) throw storeError('RUNNER_DOCUMENT_NOT_FOUND', 'Document is not declared in the manifest', 404);

      const alreadyUploaded = Object.hasOwn(job.state.uploads, normalizedArtifactKey);
      const temporaryPath = exactChild(job.temporaryDirectory, `.upload-${randomUUID()}.tmp`);
      let handle;
      let incoming;
      try {
        handle = await open(temporaryPath, 'wx', 0o600);
        const hash = createHash('sha256');
        let byteSize = 0;
        for await (const chunk of bodyStream) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          byteSize += buffer.length;
          hash.update(buffer);
          await handle.write(buffer);
        }
        await handle.sync();
        await handle.close();
        handle = null;
        incoming = { byteSize, sha256: hash.digest('hex').toUpperCase() };
      } catch (error) {
        await handle?.close().catch(() => {});
        await unlink(temporaryPath).catch(() => {});
        throw error;
      }

      const matchesDeclaration = incoming.byteSize === document.byte_size
        && incoming.sha256 === document.source_sha256;
      if (!matchesDeclaration) {
        await unlink(temporaryPath).catch(() => {});
        throw alreadyUploaded
          ? storeError('RUNNER_DOCUMENT_CONFLICT', 'Repeated upload differs from the sealed source declaration', 409)
          : storeError('RUNNER_DOCUMENT_MISMATCH', 'Uploaded bytes do not match declared size and SHA-256');
      }

      const targetPath = exactChild(job.documentsDirectory, documentPhysicalName(document));
      if (alreadyUploaded) {
        const stored = await hashFile(targetPath);
        await unlink(temporaryPath).catch(() => {});
        if (stored.byteSize !== document.byte_size || stored.sha256 !== document.source_sha256) {
          throw storeError('RUNNER_DOCUMENT_MISMATCH', 'Previously staged source bytes no longer match the manifest');
        }
        return {
          job_id: normalizedJobId,
          artifact_key: normalizedArtifactKey,
          byte_size: incoming.byteSize,
          sha256: incoming.sha256,
          staged_documents: Object.keys(job.state.uploads).length,
          idempotent: true,
        };
      }

      const existingTarget = await lstat(targetPath).catch((error) => {
        if (error?.code === 'ENOENT') return null;
        throw error;
      });
      if (existingTarget) {
        const stored = await hashFile(targetPath);
        await unlink(temporaryPath).catch(() => {});
        if (stored.byteSize !== document.byte_size || stored.sha256 !== document.source_sha256) {
          throw storeError('RUNNER_DOCUMENT_CONFLICT', 'An untracked document target conflicts with the manifest', 409);
        }
        job.state.uploads[normalizedArtifactKey] = {
          byte_size: stored.byteSize,
          sha256: stored.sha256,
        };
        job.state.updated_at = timestamp();
        await writeState(job.jobPath, job.state);
        return {
          job_id: normalizedJobId,
          artifact_key: normalizedArtifactKey,
          byte_size: stored.byteSize,
          sha256: stored.sha256,
          staged_documents: Object.keys(job.state.uploads).length,
          idempotent: true,
        };
      }
      await rename(temporaryPath, targetPath);
      await fsyncDirectory(job.documentsDirectory);
      job.state.uploads[normalizedArtifactKey] = {
        byte_size: incoming.byteSize,
        sha256: incoming.sha256,
      };
      job.state.updated_at = timestamp();
      await writeState(job.jobPath, job.state);
      return {
        job_id: normalizedJobId,
        artifact_key: normalizedArtifactKey,
        byte_size: incoming.byteSize,
        sha256: incoming.sha256,
        staged_documents: Object.keys(job.state.uploads).length,
        idempotent: false,
      };
    });
  }

  async function sealJob(jobId) {
    return withJobLock(jobId, async (normalizedJobId) => {
      const job = await loadJob(normalizedJobId);
      if (job.state.status === 'ready') return verifySealedJob(job);
      if (job.state.status !== 'staging') {
        throw storeError('RUNNER_REQUEST_INVALID', 'Job cannot be sealed from its current state', 409);
      }
      await cleanupCrashResidue(job.temporaryDirectory);
      if (Object.keys(job.state.uploads).length !== job.state.manifest.expected_documents) {
        throw storeError('RUNNER_MANIFEST_INCOMPLETE', 'Every manifest document must be staged before seal', 409);
      }

      for (const document of job.state.manifest.documents) {
        if (!Object.hasOwn(job.state.uploads, document.artifact_key)) {
          throw storeError('RUNNER_MANIFEST_INCOMPLETE', 'Every manifest document must be staged before seal', 409);
        }
        const actual = await hashFile(exactChild(job.documentsDirectory, documentPhysicalName(document)));
        if (actual.byteSize !== document.byte_size || actual.sha256 !== document.source_sha256) {
          throw storeError('RUNNER_DOCUMENT_MISMATCH', 'A staged source file no longer matches the manifest');
        }
      }

      const catalog = await catalogBytes();
      const persistedManifest = {
        ...job.state.manifest,
        staged_documents: job.state.manifest.expected_documents,
      };
      const manifestSha256 = computeManifestSha256(persistedManifest);
      persistedManifest.input_manifest_sha256 = manifestSha256;
      await atomicWriteFile(exactChild(job.inputDirectory, CATALOG_FILE_NAME), catalog);
      await atomicWriteFile(
        exactChild(job.inputDirectory, MANIFEST_FILE_NAME),
        `${canonicalJson(persistedManifest)}\n`,
      );
      await assertExactDirectoryEntries(
        job.inputDirectory,
        [
          { name: '.upload-tmp', kind: 'directory' },
          { name: CATALOG_FILE_NAME, kind: 'file' },
          { name: MANIFEST_FILE_NAME, kind: 'file' },
          { name: 'documents', kind: 'directory' },
        ],
        'Agent-visible input contains undeclared files',
      );
      await assertExactDirectoryEntries(
        job.temporaryDirectory,
        [],
        'Agent-visible upload staging contains undeclared files',
      );
      await assertExactDirectoryEntries(
        job.documentsDirectory,
        persistedManifest.documents.map((document) => ({
          name: documentPhysicalName(document),
          kind: 'file',
        })),
        'Agent-visible documents do not exactly match the sealed manifest',
      );
      job.state.status = 'ready';
      job.state.input_manifest_sha256 = manifestSha256;
      job.state.updated_at = timestamp();
      await writeState(job.jobPath, job.state);
      return publicJobState(job.state, { idempotent: false });
    });
  }

  async function claimStart(jobId) {
    return withJobLock(jobId, async (normalizedJobId) => {
      const job = await loadJob(normalizedJobId);
      if (['running', 'validating', 'completed'].includes(job.state.status)) {
        return {
          ...publicJobState(job.state, { idempotent: true }),
          should_execute: false,
        };
      }
      const retrying = job.state.status === 'failed'
        && job.state.failure?.retryable === true
        && Number(job.state.attempt || 0) < 2;
      if (job.state.status !== 'ready' && !retrying) {
        if (job.state.status === 'failed') {
          return {
            ...publicJobState(job.state, { idempotent: true }),
            should_execute: false,
          };
        }
        throw storeError('RUNNER_JOB_NOT_READY', 'Job must be sealed before execution', 409);
      }

      await verifySealedJob(job);
      const workspaceDirectory = await ensureOrCreateRegularDirectory(job.jobPath, 'workspace');
      await ensureOrCreateRegularDirectory(workspaceDirectory, 'output');
      await ensureOrCreateRegularDirectory(workspaceDirectory, '.tmp');
      await ensureOrCreateRegularDirectory(job.jobPath, 'audit');

      if (retrying) {
        job.state.prior_attempts = Array.isArray(job.state.prior_attempts)
          ? job.state.prior_attempts
          : [];
        job.state.prior_attempts.push(priorAttemptRecord({
          attempt: Number(job.state.attempt),
          code: boundedCode(job.state.failure?.code),
          at: job.state.failure?.at ?? timestamp(),
          execution: job.state.execution,
        }));
      }
      job.state.attempt = retrying ? Number(job.state.attempt) + 1 : 1;
      job.state.status = 'running';
      job.state.failure = null;
      job.state.execution = null;
      job.state.updated_at = timestamp();
      job.state.finished_at = null;
      await writeState(job.jobPath, job.state);
      return {
        ...publicJobState(job.state, { idempotent: false }),
        should_execute: true,
      };
    });
  }

  async function beginAutomaticRetry(jobId, { attempt, execution } = {}) {
    return withJobLock(jobId, async (normalizedJobId) => {
      const job = await loadJob(normalizedJobId);
      if (
        job.state.status !== 'running'
        || job.state.attempt !== attempt
        || attempt !== 1
      ) {
        throw storeError('RUNNER_JOB_STATE_INVALID', 'Automatic retry transition is invalid', 409);
      }
      await verifySealedJob(job);
      job.state.prior_attempts = Array.isArray(job.state.prior_attempts)
        ? job.state.prior_attempts
        : [];
      job.state.prior_attempts.push(priorAttemptRecord({
        attempt,
        code: execution?.code,
        at: timestamp(),
        execution,
      }));
      job.state.attempt = 2;
      job.state.execution = null;
      job.state.updated_at = timestamp();
      await writeState(job.jobPath, job.state);
      return {
        ...publicJobState(job.state),
        should_execute: true,
      };
    });
  }

  async function releaseUnstartedClaim(jobId, { attempt } = {}) {
    return withJobLock(jobId, async (normalizedJobId) => {
      const job = await loadJob(normalizedJobId);
      if (
        job.state.status !== 'running'
        || job.state.attempt !== attempt
        || job.state.execution !== null
      ) {
        throw storeError('RUNNER_JOB_STATE_INVALID', 'Unstarted claim release is invalid', 409);
      }
      if (attempt === 1) {
        job.state.status = 'ready';
        job.state.attempt = 0;
        job.state.failure = null;
        job.state.finished_at = null;
      } else if (attempt === 2) {
        const prior = Array.isArray(job.state.prior_attempts)
          ? job.state.prior_attempts.pop()
          : null;
        if (!prior || prior.attempt !== 1 || prior.retryable !== true) {
          throw storeError('RUNNER_INTERNAL', 'Retry audit cannot restore the unstarted claim', 500);
        }
        job.state.status = 'failed';
        job.state.attempt = 1;
        job.state.failure = {
          code: boundedCode(prior.code),
          retryable: true,
          at: prior.at,
        };
        job.state.execution = prior.execution;
        job.state.finished_at = prior.at;
      } else {
        throw storeError('RUNNER_JOB_STATE_INVALID', 'Unstarted claim attempt is invalid', 409);
      }
      job.state.updated_at = timestamp();
      await writeState(job.jobPath, job.state);
      return publicJobState(job.state);
    });
  }

  async function markValidating(jobId, { attempt, execution } = {}) {
    return withJobLock(jobId, async (normalizedJobId) => {
      const job = await loadJob(normalizedJobId);
      if (job.state.status !== 'running' || job.state.attempt !== attempt) {
        throw storeError('RUNNER_JOB_STATE_INVALID', 'Validation transition is invalid', 409);
      }
      job.state.status = 'validating';
      job.state.execution = executionSummary(execution);
      job.state.updated_at = timestamp();
      await writeState(job.jobPath, job.state);
      return publicJobState(job.state);
    });
  }

  async function completeAttempt(jobId, {
    attempt,
    execution,
    rawResult,
    validationEnvelope,
  } = {}) {
    return withJobLock(jobId, async (normalizedJobId) => {
      const job = await loadJob(normalizedJobId);
      if (job.state.status !== 'validating' || job.state.attempt !== attempt) {
        throw storeError('RUNNER_JOB_STATE_INVALID', 'Completion transition is invalid', 409);
      }
      if (validationEnvelope?.valid !== true || validationEnvelope?.job_id !== normalizedJobId) {
        throw storeError('RUNNER_REQUEST_INVALID', 'Only a valid matching envelope can complete a job');
      }
      await verifySealedJob(job);
      const bytes = resultBytes(rawResult);
      const parsedResult = parseResultObject(bytes);
      const rawResultSha256 = sha256Bytes(bytes);
      const validatedResultSha256 = sha256Bytes(Buffer.from(canonicalJson(parsedResult), 'utf8'));
      if (
        validationEnvelope.raw_result_sha256 !== rawResultSha256
        || validationEnvelope.validated_result_sha256 !== validatedResultSha256
      ) {
        throw storeError(
          'RUNNER_REQUEST_INVALID',
          'Validation envelope hashes do not match the result bytes',
        );
      }
      const auditDirectory = await ensureOrCreateRegularDirectory(job.jobPath, 'audit');
      const resultArtifact = validatedResultArtifactName(attempt);
      const validationArtifact = validationArtifactName(attempt);
      await assertOrWriteExactFile(exactChild(auditDirectory, resultArtifact), bytes);
      await faultInjector('after-terminal-result-artifact');
      const validationBytes = Buffer.from(`${canonicalJson(validationEnvelope)}\n`, 'utf8');
      await assertOrWriteExactFile(
        exactChild(auditDirectory, validationArtifact),
        validationBytes,
      );
      await faultInjector('after-terminal-validation-artifact');
      job.state.status = 'completed';
      job.state.failure = null;
      job.state.execution = executionSummary(execution);
      job.state.result = {
        attempt,
        raw_result_sha256: validationEnvelope.raw_result_sha256,
        validated_result_sha256: validationEnvelope.validated_result_sha256,
        validation_file_sha256: sha256Bytes(validationBytes),
      };
      job.state.updated_at = timestamp();
      job.state.finished_at = job.state.updated_at;
      await writeState(job.jobPath, job.state);
      return publicJobState(job.state);
    });
  }

  async function failAttempt(jobId, {
    attempt,
    code,
    retryable = false,
    execution,
    validationEnvelope,
    validationIssues,
  } = {}) {
    return withJobLock(jobId, async (normalizedJobId) => {
      const job = await loadJob(normalizedJobId);
      if (
        !['running', 'validating'].includes(job.state.status)
        || job.state.attempt !== attempt
      ) {
        throw storeError('RUNNER_JOB_STATE_INVALID', 'Failure transition is invalid', 409);
      }
      job.state.status = 'failed';
      job.state.failure = {
        code: boundedCode(code),
        retryable: Boolean(retryable && attempt < 2),
        at: timestamp(),
      };
      if (validationEnvelope || Array.isArray(validationIssues)) {
        const auditDirectory = await ensureOrCreateRegularDirectory(job.jobPath, 'audit');
        const validationAudit = validationFailureBytes({
          jobId: normalizedJobId,
          attempt,
          envelope: validationEnvelope,
          issues: validationIssues,
        });
        const artifact = validationArtifactName(attempt);
        await assertOrWriteExactFile(
          exactChild(auditDirectory, artifact),
          validationAudit.bytes,
        );
        await faultInjector('after-failure-validation-artifact');
        job.state.failure.validation = {
          artifact,
          sha256: sha256Bytes(validationAudit.bytes),
          envelope_available: validationAudit.envelopeAvailable,
        };
      }
      if (execution) job.state.execution = executionSummary(execution);
      job.state.updated_at = job.state.failure.at;
      job.state.finished_at = job.state.failure.at;
      await writeState(job.jobPath, job.state);
      return publicJobState(job.state);
    });
  }

  async function getResult(jobId) {
    return withJobLock(jobId, async (normalizedJobId) => {
      const job = await loadJob(normalizedJobId);
      if (job.state.status !== 'completed') {
        throw storeError('RUNNER_RESULT_NOT_READY', 'Validated result is not available', 409);
      }
      const auditDirectory = exactChild(job.jobPath, 'audit');
      await ensureRegularDirectory(auditDirectory);
      const resultAttempt = job.state.result?.attempt;
      const [rawBytes, validationBytes] = await Promise.all([
        readBoundedRegularFile(exactChild(
          auditDirectory,
          validatedResultArtifactName(resultAttempt),
        )),
        readBoundedRegularFile(exactChild(
          auditDirectory,
          validationArtifactName(resultAttempt),
        )),
      ]);
      let result;
      let validation;
      try {
        result = JSON.parse(rawBytes.toString('utf8'));
        validation = JSON.parse(validationBytes.toString('utf8'));
      } catch {
        throw storeError('RUNNER_INTERNAL', 'Runner result artifact is unreadable', 500);
      }
      const rawResultSha256 = sha256Bytes(rawBytes);
      const validatedResultSha256 = sha256Bytes(Buffer.from(canonicalJson(result), 'utf8'));
      if (
        rawResultSha256 !== job.state.result?.raw_result_sha256
        || validatedResultSha256 !== job.state.result?.validated_result_sha256
        || sha256Bytes(validationBytes) !== job.state.result?.validation_file_sha256
        || validation?.job_id !== normalizedJobId
        || validation?.valid !== true
        || validation?.raw_result_sha256 !== rawResultSha256
        || validation?.validated_result_sha256 !== validatedResultSha256
      ) {
        throw storeError('RUNNER_INTERNAL', 'Runner result artifact failed integrity verification', 500);
      }
      return { job_id: normalizedJobId, result, validation };
    });
  }

  async function recoverOrphanedJobs() {
    await mkdir(resolvedRoot, { recursive: true, mode: 0o700 });
    const entries = await readdir(resolvedRoot, { withFileTypes: true });
    const recovered = [];
    for (const entry of entries) {
      if (!JOB_DIRECTORY_PATTERN.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) {
        continue;
      }
      await withJobLock(entry.name, async (normalizedJobId) => {
        const job = await loadJob(normalizedJobId);
        if (!['running', 'validating'].includes(job.state.status)) return;
        const attempt = Number.isSafeInteger(job.state.attempt) ? job.state.attempt : 1;
        const at = timestamp();
        try {
          await verifySealedJob(job);
        } catch (error) {
          job.state.status = 'failed';
          job.state.failure = {
            code: boundedCode(error?.code, 'RUNNER_MANIFEST_MISMATCH'),
            retryable: false,
            at,
          };
          job.state.updated_at = at;
          job.state.finished_at = at;
          await writeState(job.jobPath, job.state);
          recovered.push(normalizedJobId);
          return;
        }

        const auditDirectory = await ensureOrCreateRegularDirectory(job.jobPath, 'audit');
        const validationArtifact = validationArtifactName(attempt);
        const validationBytes = await readOptionalBoundedRegularFile(
          exactChild(auditDirectory, validationArtifact),
        );
        const validation = parseJsonObjectOrNull(validationBytes);

        if (
          validation?.schema_version === 'tender_agent_validation_v1'
          && validation.job_id === normalizedJobId
          && validation.valid === true
        ) {
          const rawBytes = await readOptionalBoundedRegularFile(exactChild(
            auditDirectory,
            validatedResultArtifactName(attempt),
          ));
          const parsedResult = parseJsonObjectOrNull(rawBytes);
          const rawResultSha256 = rawBytes ? sha256Bytes(rawBytes) : null;
          const validatedResultSha256 = parsedResult
            ? sha256Bytes(Buffer.from(canonicalJson(parsedResult), 'utf8'))
            : null;
          if (
            rawResultSha256 === validation.raw_result_sha256
            && validatedResultSha256 === validation.validated_result_sha256
          ) {
            job.state.status = 'completed';
            job.state.failure = null;
            job.state.result = {
              attempt,
              raw_result_sha256: rawResultSha256,
              validated_result_sha256: validatedResultSha256,
              validation_file_sha256: sha256Bytes(validationBytes),
            };
            job.state.updated_at = at;
            job.state.finished_at = at;
            await writeState(job.jobPath, job.state);
            recovered.push(normalizedJobId);
            return;
          }
        }

        if (
          validation?.job_id === normalizedJobId
          && validation.valid === false
          && [
            'tender_agent_validation_v1',
            'tender_agent_validation_failure_v1',
          ].includes(validation.schema_version)
        ) {
          job.state.status = 'failed';
          job.state.failure = {
            code: 'CODEX_CONTRACT_INVALID',
            retryable: false,
            at,
            validation: {
              artifact: validationArtifact,
              sha256: sha256Bytes(validationBytes),
              envelope_available: validation.schema_version === 'tender_agent_validation_v1',
            },
          };
          job.state.updated_at = at;
          job.state.finished_at = at;
          await writeState(job.jobPath, job.state);
          recovered.push(normalizedJobId);
          return;
        }

        job.state.status = 'failed';
        job.state.failure = {
          code: 'RUNNER_ORPHANED_EXECUTION',
          retryable: attempt < 2,
          at,
        };
        job.state.updated_at = at;
        job.state.finished_at = at;
        await writeState(job.jobPath, job.state);
        recovered.push(normalizedJobId);
      });
    }
    recovered.sort();
    return { recovered_jobs: recovered.length, job_ids: recovered };
  }

  async function cleanupExpiredJobs({ ttlMs = DEFAULT_TTL_MS } = {}) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
      throw new TypeError('ttlMs must be a positive integer');
    }
    await mkdir(resolvedRoot, { recursive: true, mode: 0o700 });
    const current = now();
    if (!(current instanceof Date) || Number.isNaN(current.getTime())) {
      throw new TypeError('now must return a valid Date');
    }
    const cutoff = current.getTime() - ttlMs;
    const entries = await readdir(resolvedRoot, { withFileTypes: true });
    const deleted = [];
    for (const entry of entries) {
      if (!JOB_DIRECTORY_PATTERN.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) {
        continue;
      }
      await withJobLock(entry.name, async (normalizedJobId) => {
        const jobPath = resolveJobPath(resolvedRoot, normalizedJobId);
        await ensureRegularDirectory(jobPath);
        const state = await readState(jobPath);
        const finishedAt = Date.parse(state.finished_at ?? '');
        if (
          !TERMINAL_JOB_STATUSES.has(state.status)
          || !Number.isFinite(finishedAt)
          || finishedAt > cutoff
        ) {
          return;
        }
        if (path.dirname(path.resolve(jobPath)) !== resolvedRoot) {
          throw storeError('RUNNER_INTERNAL', 'Cleanup target escaped runner root', 500);
        }
        await rm(jobPath, { recursive: true, force: false });
        deleted.push(normalizedJobId);
      });
    }
    deleted.sort();
    return { deleted_jobs: deleted.length, deleted_job_ids: deleted };
  }

  async function getJob(jobId) {
    return withJobLock(jobId, async (normalizedJobId) => {
      const job = await loadJob(normalizedJobId);
      await cleanupCrashResidue(job.temporaryDirectory);
      return publicJobState(job.state);
    });
  }

  async function verifySealedInput(jobId) {
    return withJobLock(jobId, async (normalizedJobId) => {
      const job = await loadJob(normalizedJobId);
      return verifySealedJob(job);
    });
  }

  async function readVerifiedInputManifest(jobId) {
    return withJobLock(jobId, async (normalizedJobId) => {
      const job = await loadJob(normalizedJobId);
      await verifySealedJob(job);
      return structuredClone({
        ...job.state.manifest,
        staged_documents: job.state.manifest.expected_documents,
        input_manifest_sha256: job.state.input_manifest_sha256,
      });
    });
  }

  return Object.freeze({
    beginAutomaticRetry,
    claimStart,
    cleanupExpiredJobs,
    completeAttempt,
    createJob,
    failAttempt,
    getJob,
    getResult,
    markValidating,
    readVerifiedInputManifest,
    recoverOrphanedJobs,
    releaseUnstartedClaim,
    sealJob,
    uploadDocument,
    verifySealedInput,
  });
}

async function assertExactDirectoryEntries(directory, expectedEntries, message) {
  const entries = await readdir(directory, { withFileTypes: true });
  const expected = new Map(expectedEntries.map((entry) => [entry.name, entry.kind]));
  if (entries.length !== expected.size) {
    throw storeError('RUNNER_DOCUMENT_MISMATCH', message);
  }
  for (const entry of entries) {
    const expectedKind = expected.get(entry.name);
    const actualKind = entry.isFile() && !entry.isSymbolicLink()
      ? 'file'
      : entry.isDirectory() && !entry.isSymbolicLink()
        ? 'directory'
        : 'other';
    if (expectedKind !== actualKind) {
      throw storeError('RUNNER_DOCUMENT_MISMATCH', message);
    }
  }
}
