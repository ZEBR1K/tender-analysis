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
  if (idempotent !== undefined) response.idempotent = idempotent;
  return response;
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

  const resolvedRoot = path.resolve(rootDirectory);
  const resolvedCatalogPath = path.resolve(fieldCatalogPath);
  const normalizedCatalogSha256 = expectedCatalogSha256.toUpperCase();
  const lockTails = new Map();

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
    if (job.state.status !== 'ready') {
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
        const state = {
          manifest,
          status: 'staging',
          uploads: {},
          input_manifest_sha256: null,
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
      job.state.status = 'ready';
      job.state.input_manifest_sha256 = manifestSha256;
      await writeState(job.jobPath, job.state);
      return publicJobState(job.state, { idempotent: false });
    });
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

  return Object.freeze({ createJob, getJob, sealJob, uploadDocument, verifySealedInput });
}
