import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  config,
  LIMITS,
  SUPPORTED_ARCHIVE_EXTENSIONS,
} from './config.mjs';
import { ArchiveError, asArchiveError } from './errors.mjs';
import { assertSafeLogicalPath, collisionKey, logicalBasename } from './path-policy.mjs';
import { createStore, validateAnalysisRunId, validateJobId } from './store.mjs';
import * as sevenzip from './sevenzip.mjs';

const FORMAT_BY_DECLARED_EXTENSION = Object.freeze({
  zip: new Set(['zip']),
  '7z': new Set(['7z']),
  rar: new Set(['rar']),
  tar: new Set(['tar']),
  gz: new Set(['gzip']),
  'tar.gz': new Set(['gzip']),
  tgz: new Set(['gzip']),
});

const MIME_BY_EXTENSION = Object.freeze({
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  csv: 'text/csv',
  xml: 'application/xml',
  json: 'application/json',
});

function normalizeFormat(value) {
  const format = String(value ?? '').trim().toLowerCase();
  const aliases = {
    '7-zip': '7z',
    gzip: 'gzip',
    gz: 'gzip',
    rard5: 'rar',
    rar5: 'rar',
  };
  return (aliases[format] ?? format) || null;
}

function extensionFor(logicalPath) {
  const name = logicalBasename(logicalPath).toLowerCase();
  if (name.endsWith('.tar.gz')) return 'tar.gz';
  const index = name.lastIndexOf('.');
  return index > 0 ? name.slice(index + 1) : '';
}

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function makeArtifactId(jobId, logicalPath, contentSha256) {
  return sha256Buffer(Buffer.from(`${jobId}\n${logicalPath}\n${contentSha256}`, 'utf8'));
}

function mergeLimits(overrides = {}) {
  return Object.freeze({
    maxSourceBytes: overrides.maxSourceBytes ?? overrides.maxArchiveBytes ?? LIMITS.maxArchiveBytes,
    maxFileBytes: overrides.maxFileBytes ?? LIMITS.maxFileBytes,
    maxTotalBytes: overrides.maxTotalBytes ?? LIMITS.maxTotalBytes,
    maxEntries: overrides.maxEntries ?? LIMITS.maxEntries,
    maxDepth: overrides.maxDepth ?? overrides.maxArchiveDepth ?? LIMITS.maxArchiveDepth,
    maxDurationMs: overrides.maxDurationMs ?? LIMITS.maxDurationMs,
  });
}

function validateInput({ analysisRunId, sourceAttachmentIndex, declaredExtension, jobId, deadlineEpochMs, now }) {
  const runId = validateAnalysisRunId(analysisRunId);
  if (!Number.isSafeInteger(sourceAttachmentIndex) || sourceAttachmentIndex <= 0 || sourceAttachmentIndex > 999999) {
    throw new ArchiveError('INGESTION_CONTRACT_INVALID', 'source_attachment_index must be a positive integer', 400);
  }
  const extension = String(declaredExtension ?? '').trim().toLowerCase().replace(/^\./u, '');
  if (!SUPPORTED_ARCHIVE_EXTENSIONS.has(extension)) {
    throw new ArchiveError('INGESTION_CONTRACT_INVALID', 'declared_extension is not supported', 400);
  }
  const safeJobId = validateJobId(jobId, runId, sourceAttachmentIndex);
  if (!Number.isSafeInteger(deadlineEpochMs) || deadlineEpochMs <= now) {
    throw new ArchiveError('ARCHIVE_TIMEOUT', 'Archive extraction deadline has expired', 408);
  }
  return { runId, extension, safeJobId };
}

async function writeInputStream({ inputStream, outputPath, maxBytes, checkDeadline }) {
  const hash = createHash('sha256');
  const handle = await open(outputPath, 'wx', 0o600);
  let sizeBytes = 0;
  try {
    for await (const value of inputStream) {
      checkDeadline();
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      sizeBytes += chunk.length;
      if (sizeBytes > maxBytes) {
        inputStream.destroy?.();
        throw new ArchiveError('ARCHIVE_TOO_LARGE', 'Source archive exceeds 100 MiB', 413, {
          max_bytes: maxBytes,
        });
      }
      hash.update(chunk);
      await handle.write(chunk);
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  return { sizeBytes, sha256: hash.digest('hex') };
}

function joinLogical(prefix, entryPath) {
  return assertSafeLogicalPath(prefix ? `${prefix}/${entryPath}` : entryPath);
}

function safeEntryType(entry) {
  if (entry.encrypted) {
    throw new ArchiveError('ARCHIVE_ENCRYPTED', 'Encrypted archives are not supported', 422);
  }
  if (entry.isLink || entry.linkTarget || ['symlink', 'hardlink', 'special'].includes(entry.type)) {
    throw new ArchiveError('ARCHIVE_PATH_UNSAFE', 'Archive links and special entries are not allowed', 422);
  }
  if (entry.type === 'directory') return 'directory';
  if (entry.type === 'file' || !entry.type) return 'file';
  throw new ArchiveError('ARCHIVE_PATH_UNSAFE', 'Archive contains an unsupported filesystem entry', 422);
}

export function createExtractor({
  store,
  archiveAdapter,
  limits: limitOverrides,
  sourceArchiveAlias = null,
  now = Date.now,
} = {}) {
  if (!store || !archiveAdapter) throw new TypeError('store and archiveAdapter are required');
  const limits = mergeLimits(limitOverrides);

  async function extractJob({
    inputStream,
    analysisRunId,
    sourceAttachmentIndex,
    declaredExtension,
    jobId,
    deadlineEpochMs,
  }) {
    const startedAt = now();
    const { runId, extension, safeJobId } = validateInput({
      analysisRunId,
      sourceAttachmentIndex,
      declaredExtension,
      jobId,
      deadlineEpochMs,
      now: startedAt,
    });
    const effectiveDeadline = Math.min(deadlineEpochMs, startedAt + limits.maxDurationMs);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1, effectiveDeadline - startedAt));
    timeout.unref?.();
    let stagingDirectory;

    function checkDeadline() {
      if (controller.signal.aborted || now() >= effectiveDeadline) {
        controller.abort();
        throw new ArchiveError('ARCHIVE_TIMEOUT', 'Archive extraction exceeded five minutes', 408);
      }
    }

    try {
      stagingDirectory = await store.createStagingDirectory({ analysisRunId: runId, jobId: safeJobId });
      const sourcePath = path.join(stagingDirectory, 'source.bin');
      const source = await writeInputStream({
        inputStream,
        outputPath: sourcePath,
        maxBytes: limits.maxSourceBytes,
        checkDeadline,
      });

      const committed = await store.readCommittedManifest({ analysisRunId: runId, jobId: safeJobId });
      if (committed) {
        if (committed.source?.sha256 !== source.sha256) {
          throw new ArchiveError('JOB_INPUT_MISMATCH', 'The completed job has different source content', 409);
        }
        await rm(stagingDirectory, { recursive: true, force: true });
        stagingDirectory = null;
        return committed;
      }

      checkDeadline();
      const rootAdapterPath = sourceArchiveAlias || sourcePath;
      const detectedFormat = normalizeFormat(await archiveAdapter.detectArchive({
        archivePath: rootAdapterPath,
        actualArchivePath: sourcePath,
        logicalPath: null,
        signal: controller.signal,
      }));
      if (!FORMAT_BY_DECLARED_EXTENSION[extension]?.has(detectedFormat)) {
        throw new ArchiveError('ARCHIVE_FORMAT_MISMATCH', 'Archive content does not match its declared extension', 422, {
          declared_extension: extension,
          detected_format: detectedFormat,
        });
      }

      const queue = [{
        archivePath: rootAdapterPath,
        actualArchivePath: sourcePath,
        archiveDepth: 1,
        archiveChain: [],
        logicalPrefix: '',
        logicalPath: null,
        format: detectedFormat,
      }];
      const entries = [];
      const seenPaths = new Set();
      let entryCount = 0;
      let unpackedTotalBytes = 0;
      let archiveCount = 0;

      while (queue.length > 0) {
        checkDeadline();
        const current = queue.shift();
        archiveCount += 1;
        let listed;
        try {
          listed = await archiveAdapter.listArchive({
            archivePath: current.archivePath,
            actualArchivePath: current.actualArchivePath,
            logicalPath: current.logicalPath,
            signal: controller.signal,
          });
        } catch (error) {
          throw asArchiveError(error, 'ARCHIVE_CORRUPT');
        }
        if (!Array.isArray(listed)) {
          throw new ArchiveError('ARCHIVE_CORRUPT', 'Archive listing is invalid', 422);
        }

        for (const listedEntry of listed) {
          checkDeadline();
          entryCount += 1;
          if (entryCount > limits.maxEntries) {
            throw new ArchiveError('ARCHIVE_ENTRY_LIMIT', 'Archive contains more than 500 entries', 413, {
              max_entries: limits.maxEntries,
            });
          }
          const relativePath = assertSafeLogicalPath(String(listedEntry.path ?? ''));
          const logicalPath = joinLogical(current.logicalPrefix, relativePath);
          const key = collisionKey(logicalPath);
          if (seenPaths.has(key)) {
            throw new ArchiveError('ARCHIVE_PATH_UNSAFE', 'Archive contains colliding normalized paths', 422, {
              path: logicalPath,
              reason: 'normalized_collision',
            });
          }
          seenPaths.add(key);
          const type = safeEntryType(listedEntry);
          if (type === 'directory') continue;
          if (Number.isFinite(Number(listedEntry.size)) && Number(listedEntry.size) > limits.maxFileBytes) {
            throw new ArchiveError('ARCHIVE_FILE_TOO_LARGE', 'Archive entry exceeds 50 MiB', 413, {
              path: logicalPath,
              max_bytes: limits.maxFileBytes,
            });
          }

          const temporaryPath = path.join(stagingDirectory, 'work', `${randomUUID()}.bin`);
          let extracted;
          try {
            extracted = await archiveAdapter.streamEntry({
              archivePath: current.archivePath,
              actualArchivePath: current.actualArchivePath,
              entryPath: relativePath,
              outputPath: temporaryPath,
              byteBudget: limits.maxFileBytes,
              signal: controller.signal,
            });
          } catch (error) {
            throw asArchiveError(error, 'ARCHIVE_CORRUPT');
          }
          const sizeBytes = Number(extracted?.bytesWritten);
          if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
            throw new ArchiveError('ARCHIVE_CORRUPT', 'Extractor returned an invalid entry size', 422);
          }
          if (sizeBytes > limits.maxFileBytes) {
            throw new ArchiveError('ARCHIVE_FILE_TOO_LARGE', 'Archive entry exceeds 50 MiB', 413);
          }
          unpackedTotalBytes += sizeBytes;
          if (unpackedTotalBytes > limits.maxTotalBytes) {
            throw new ArchiveError('ARCHIVE_TOTAL_TOO_LARGE', 'Archive output exceeds 300 MiB', 413, {
              max_bytes: limits.maxTotalBytes,
            });
          }
          const contentSha256 = await sha256File(temporaryPath);
          const fileName = logicalBasename(logicalPath);
          const fileExtension = extensionFor(logicalPath);

          let nestedFormat = null;
          if (!['docx', 'xlsx'].includes(fileExtension)) {
            try {
              nestedFormat = normalizeFormat(await archiveAdapter.detectArchive({
                archivePath: temporaryPath,
                actualArchivePath: temporaryPath,
                logicalPath,
                signal: controller.signal,
                allowUnknown: true,
              }));
            } catch (error) {
              if (error instanceof ArchiveError && error.code !== 'ARCHIVE_CORRUPT') throw error;
              nestedFormat = null;
            }
          }

          if (nestedFormat) {
            const gzipTarWrapper = current.format === 'gzip' && nestedFormat === 'tar';
            if (!gzipTarWrapper) {
              if (current.archiveDepth >= limits.maxDepth) {
                throw new ArchiveError('ARCHIVE_DEPTH_EXCEEDED', 'Nested archive depth exceeds three levels', 422, {
                  path: logicalPath,
                  max_depth: limits.maxDepth,
                });
              }
              entries.push({
                kind: 'archive_container',
                logical_path: logicalPath,
                file_name: fileName,
                file_extension: fileExtension || null,
                archive_depth: current.archiveDepth + 1,
                archive_chain: [...current.archiveChain],
                mime_type: 'application/octet-stream',
                size_bytes: sizeBytes,
                sha256: contentSha256,
                artifact_id: null,
              });
            }
            queue.push({
              archivePath: temporaryPath,
              actualArchivePath: temporaryPath,
              archiveDepth: gzipTarWrapper ? current.archiveDepth : current.archiveDepth + 1,
              archiveChain: gzipTarWrapper
                ? current.archiveChain
                : [...current.archiveChain, logicalPath],
              logicalPrefix: gzipTarWrapper ? current.logicalPrefix : logicalPath,
              logicalPath,
              format: nestedFormat,
            });
            continue;
          }

          const artifactId = makeArtifactId(safeJobId, logicalPath, contentSha256);
          const artifactPath = path.join(stagingDirectory, 'artifacts', `${artifactId}.bin`);
          await rename(temporaryPath, artifactPath);
          entries.push({
            kind: 'file',
            logical_path: logicalPath,
            file_name: fileName,
            file_extension: fileExtension || null,
            archive_depth: current.archiveDepth,
            archive_chain: [...current.archiveChain],
            mime_type: MIME_BY_EXTENSION[fileExtension] || 'application/octet-stream',
            size_bytes: sizeBytes,
            sha256: contentSha256,
            artifact_id: artifactId,
          });
        }
      }

      entries.sort((left, right) => {
        const leftFolded = left.logical_path.normalize('NFC').toLocaleLowerCase('en-US');
        const rightFolded = right.logical_path.normalize('NFC').toLocaleLowerCase('en-US');
        return leftFolded.localeCompare(rightFolded, 'en-US') || left.logical_path.localeCompare(right.logical_path, 'en-US');
      });
      const manifest = {
        schema_version: 'tender_archive_extraction_v1',
        success: true,
        job_id: safeJobId,
        analysis_run_id: runId,
        source_attachment_index: sourceAttachmentIndex,
        source: {
          declared_extension: extension,
          detected_format: detectedFormat,
          size_bytes: source.sizeBytes,
          sha256: source.sha256,
        },
        stats: {
          entry_count: entryCount,
          unpacked_total_bytes: unpackedTotalBytes,
          archive_count: archiveCount,
          duration_ms: Math.max(0, now() - startedAt),
        },
        entries,
      };
      const committedManifest = await store.commitJob({
        analysisRunId: runId,
        jobId: safeJobId,
        stagingDirectory,
        manifest,
      });
      stagingDirectory = null;
      return committedManifest;
    } catch (error) {
      if (stagingDirectory) await rm(stagingDirectory, { recursive: true, force: true });
      if (controller.signal.aborted && !(error instanceof ArchiveError)) {
        throw new ArchiveError('ARCHIVE_TIMEOUT', 'Archive extraction exceeded five minutes', 408);
      }
      throw asArchiveError(error);
    } finally {
      clearTimeout(timeout);
    }
  }

  return { extractJob };
}

const defaultStore = createStore({ rootDirectory: config.rootDirectory, ttlHours: config.ttlHours });
const defaultExtractor = createExtractor({ store: defaultStore, archiveAdapter: sevenzip });

export const extractJob = defaultExtractor.extractJob;
