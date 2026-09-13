import { randomUUID } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import path from 'node:path';

import { ArchiveError } from './errors.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ARTIFACT_ID = /^[0-9a-f]{64}$/u;

function expectedJobId(analysisRunId, sourceAttachmentIndex) {
  return `${analysisRunId}--source-${String(sourceAttachmentIndex).padStart(6, '0')}`;
}

export function validateAnalysisRunId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new ArchiveError('INGESTION_CONTRACT_INVALID', 'analysis_run_id must be a UUID', 400);
  }
  return value.toLowerCase();
}

export function validateJobId(value, analysisRunId = null, sourceAttachmentIndex = null) {
  if (typeof value !== 'string' || !/^([0-9a-f-]{36})--source-\d{6}$/iu.test(value)) {
    throw new ArchiveError('INGESTION_CONTRACT_INVALID', 'job_id has an invalid format', 400);
  }
  if (analysisRunId && Number.isSafeInteger(sourceAttachmentIndex)) {
    const expected = expectedJobId(analysisRunId, sourceAttachmentIndex);
    if (value.toLowerCase() !== expected.toLowerCase()) {
      throw new ArchiveError('INGESTION_CONTRACT_INVALID', 'job_id does not match the source attachment', 400);
    }
  }
  return value.toLowerCase();
}

function assertInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ArchiveError('INGESTION_CONTRACT_INVALID', 'Resolved storage path is outside the extractor root', 400);
  }
}

export function createStore({ rootDirectory, ttlHours = 72 }) {
  const root = path.resolve(rootDirectory);
  const runsRoot = path.join(root, 'runs');

  function pathsForJob({ analysisRunId, jobId }) {
    const runId = validateAnalysisRunId(analysisRunId);
    const safeJobId = validateJobId(jobId);
    const runDirectory = path.join(runsRoot, runId);
    const jobsDirectory = path.join(runDirectory, 'jobs');
    const jobDirectory = path.join(jobsDirectory, safeJobId);
    assertInside(runsRoot, jobDirectory);
    return {
      rootDirectory: root,
      runDirectory,
      jobsDirectory,
      jobDirectory,
      sourcePath: path.join(jobDirectory, 'source.bin'),
      workDirectory: path.join(jobDirectory, 'work'),
      artifactsDirectory: path.join(jobDirectory, 'artifacts'),
      manifestPath: path.join(jobDirectory, 'manifest.json'),
    };
  }

  async function createStagingDirectory({ analysisRunId, jobId }) {
    const job = pathsForJob({ analysisRunId, jobId });
    const stagingRoot = path.join(job.runDirectory, '.staging');
    await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
    const stagingDirectory = path.join(stagingRoot, `${jobId}-${randomUUID()}`);
    assertInside(job.runDirectory, stagingDirectory);
    await mkdir(path.join(stagingDirectory, 'work'), { recursive: true, mode: 0o700 });
    await mkdir(path.join(stagingDirectory, 'artifacts'), { recursive: true, mode: 0o700 });
    return stagingDirectory;
  }

  async function readCommittedManifest({ analysisRunId, jobId }) {
    const { manifestPath } = pathsForJob({ analysisRunId, jobId });
    try {
      return JSON.parse(await readFile(manifestPath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      if (error instanceof SyntaxError) {
        throw new ArchiveError('ARTIFACT_STORE_ERROR', 'Committed manifest is invalid', 500);
      }
      throw error;
    }
  }

  async function commitJob({ analysisRunId, jobId, stagingDirectory, manifest }) {
    const job = pathsForJob({ analysisRunId, jobId });
    const resolvedStaging = path.resolve(stagingDirectory);
    assertInside(job.runDirectory, resolvedStaging);
    const temporaryManifest = path.join(resolvedStaging, 'manifest.json.tmp');
    const finalManifest = path.join(resolvedStaging, 'manifest.json');
    const handle = await open(temporaryManifest, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(manifest)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryManifest, finalManifest);
    await mkdir(job.jobsDirectory, { recursive: true, mode: 0o700 });
    try {
      await rename(resolvedStaging, job.jobDirectory);
    } catch (error) {
      if (error?.code !== 'EEXIST' && error?.code !== 'ENOTEMPTY') throw error;
      await rm(resolvedStaging, { recursive: true, force: true });
    }
    return readCommittedManifest({ analysisRunId, jobId });
  }

  async function resolveArtifact({ analysisRunId, artifactId }) {
    const runId = validateAnalysisRunId(analysisRunId);
    if (typeof artifactId !== 'string' || !ARTIFACT_ID.test(artifactId)) {
      throw new ArchiveError('INGESTION_CONTRACT_INVALID', 'artifact_id must be 64 hexadecimal characters', 400);
    }
    const jobsDirectory = path.join(runsRoot, runId, 'jobs');
    let jobs;
    try {
      jobs = await readdir(jobsDirectory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new ArchiveError('ARTIFACT_NOT_FOUND', 'Artifact was not found', 404);
      }
      throw error;
    }
    for (const entry of jobs) {
      if (!entry.isDirectory()) continue;
      let manifest;
      try {
        manifest = JSON.parse(await readFile(path.join(jobsDirectory, entry.name, 'manifest.json'), 'utf8'));
      } catch {
        continue;
      }
      const artifact = manifest.entries?.find((item) => item.artifact_id === artifactId);
      if (!artifact) continue;
      const artifactPath = path.join(jobsDirectory, entry.name, 'artifacts', `${artifactId}.bin`);
      assertInside(jobsDirectory, artifactPath);
      try {
        const metadata = await stat(artifactPath);
        if (!metadata.isFile()) throw new Error('not a file');
      } catch {
        throw new ArchiveError('ARTIFACT_NOT_FOUND', 'Artifact was not found', 404);
      }
      return { path: artifactPath, artifact, manifest };
    }
    throw new ArchiveError('ARTIFACT_NOT_FOUND', 'Artifact was not found', 404);
  }

  async function deleteRun(analysisRunId) {
    const runId = validateAnalysisRunId(analysisRunId);
    const runDirectory = path.join(runsRoot, runId);
    assertInside(runsRoot, runDirectory);
    await rm(runDirectory, { recursive: true, force: true });
  }

  async function cleanupExpiredRuns({ now = Date.now() } = {}) {
    let entries;
    try {
      entries = await readdir(runsRoot, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    const deleted = [];
    const cutoff = now - ttlHours * 60 * 60 * 1000;
    for (const entry of entries) {
      if (!entry.isDirectory() || !UUID.test(entry.name)) continue;
      const runDirectory = path.join(runsRoot, entry.name);
      const metadata = await stat(runDirectory);
      if (metadata.mtimeMs >= cutoff) continue;
      await rm(runDirectory, { recursive: true, force: true });
      deleted.push(entry.name);
    }
    return deleted;
  }

  return {
    rootDirectory: root,
    pathsForJob,
    createStagingDirectory,
    readCommittedManifest,
    commitJob,
    resolveArtifact,
    deleteRun,
    cleanupExpiredRuns,
  };
}

const defaultStore = createStore({
  rootDirectory: process.env.ARCHIVE_EXTRACTOR_ROOT || path.join(process.cwd(), '.archive-extractor'),
  ttlHours: Number(process.env.ARCHIVE_EXTRACTOR_TTL_HOURS || 72),
});

export const pathsForJob = defaultStore.pathsForJob;
export const readCommittedManifest = defaultStore.readCommittedManifest;
export const commitJob = defaultStore.commitJob;
export const resolveArtifact = defaultStore.resolveArtifact;
export const deleteRun = defaultStore.deleteRun;
export const cleanupExpiredRuns = defaultStore.cleanupExpiredRuns;
