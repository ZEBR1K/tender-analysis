import { createHash } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  LIMITS,
  SUPPORTED_ARCHIVE_EXTENSIONS,
  SUPPORTED_DOCUMENT_EXTENSIONS,
} from './config.mjs';
import { ArchiveError, asArchiveError } from './errors.mjs';
import { validateAnalysisRunId, validateUploadJobId } from './store.mjs';

const MIME_BY_EXTENSION = Object.freeze({
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  txt: 'text/plain',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  md: 'text/markdown',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  rtf: 'application/rtf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  bmp: 'image/bmp',
  webp: 'image/webp',
});

function extensionFor(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.tar.gz')) return 'tar.gz';
  const dot = lower.lastIndexOf('.');
  return dot > 0 ? lower.slice(dot + 1) : '';
}

function normalizeInput({ analysisRunId, sourceAttachmentIndex, jobId, fileName, declaredExtension }) {
  const runId = validateAnalysisRunId(analysisRunId);
  if (!Number.isSafeInteger(sourceAttachmentIndex) || sourceAttachmentIndex < 1 || sourceAttachmentIndex > 999999) {
    throw new ArchiveError('INGESTION_CONTRACT_INVALID', 'source_attachment_index must be a positive integer', 400);
  }
  const safeJobId = validateUploadJobId(jobId, runId, sourceAttachmentIndex);
  const safeFileName = String(fileName ?? '').normalize('NFC').trim();
  if (
    !safeFileName
    || safeFileName.length > 200
    || safeFileName === '.'
    || safeFileName === '..'
    || /[\u0000-\u001f\u007f/\\]/u.test(safeFileName)
  ) {
    throw new ArchiveError('INGESTION_CONTRACT_INVALID', 'file_name is invalid', 400);
  }
  const extension = String(declaredExtension ?? '').trim().toLowerCase().replace(/^\./u, '');
  if (extension !== extensionFor(safeFileName)) {
    throw new ArchiveError('INGESTION_CONTRACT_INVALID', 'declared_extension does not match file_name', 400);
  }
  if (!SUPPORTED_DOCUMENT_EXTENSIONS.has(extension) && !SUPPORTED_ARCHIVE_EXTENSIONS.has(extension)) {
    throw new ArchiveError('INGESTION_CONTRACT_INVALID', 'File type is not allowed', 400);
  }
  return { runId, safeJobId, safeFileName, extension };
}

async function writeSource({ inputStream, outputPath, maxBytes }) {
  const hash = createHash('sha256');
  const handle = await open(outputPath, 'wx', 0o600);
  let sizeBytes = 0;
  let prefix = Buffer.alloc(0);
  let exceededLimit = false;
  try {
    for await (const value of inputStream) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      sizeBytes += chunk.length;
      if (sizeBytes > maxBytes) {
        exceededLimit = true;
        continue;
      }
      if (prefix.length < 8) prefix = Buffer.concat([prefix, chunk]).subarray(0, 8);
      hash.update(chunk);
      await handle.write(chunk);
    }
    if (exceededLimit) {
      throw new ArchiveError('SOURCE_FILE_TOO_LARGE', 'Uploaded file exceeds the allowed per-file limit', 413, {
        max_bytes: maxBytes,
      });
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  const executableMagic = prefix.subarray(0, 2).equals(Buffer.from('MZ'))
    || prefix.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
    || prefix.subarray(0, 2).equals(Buffer.from('#!'))
    || ['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe']
      .includes(prefix.subarray(0, 4).toString('hex'));
  if (executableMagic) {
    throw new ArchiveError('INGESTION_CONTRACT_INVALID', 'Executable content is not allowed', 400);
  }
  return { sizeBytes, sha256: hash.digest('hex') };
}

export function createSourceUploader({ store, limits: overrides = {} } = {}) {
  if (!store) throw new TypeError('store is required');
  const limits = {
    maxDocumentBytes: overrides.maxDocumentBytes ?? LIMITS.maxDocumentBytes,
    maxArchiveBytes: overrides.maxArchiveBytes ?? LIMITS.maxArchiveBytes,
  };

  async function uploadSource(input) {
    const { runId, safeJobId, safeFileName, extension } = normalizeInput(input);
    const maxBytes = SUPPORTED_ARCHIVE_EXTENSIONS.has(extension)
      ? limits.maxArchiveBytes
      : limits.maxDocumentBytes;
    let stagingDirectory;
    try {
      stagingDirectory = await store.createStagingDirectory({ analysisRunId: runId, jobId: safeJobId });
      const sourcePath = path.join(stagingDirectory, 'source.bin');
      const source = await writeSource({ inputStream: input.inputStream, outputPath: sourcePath, maxBytes });
      const committed = await store.readCommittedManifest({ analysisRunId: runId, jobId: safeJobId });
      if (committed) {
        if (
          committed.source?.sha256 !== source.sha256
          || committed.entries?.[0]?.file_name !== safeFileName
          || committed.entries?.[0]?.file_extension !== extension
        ) {
          throw new ArchiveError('JOB_INPUT_MISMATCH', 'The completed upload has different source content', 409);
        }
        await rm(stagingDirectory, { recursive: true, force: true });
        stagingDirectory = null;
        return committed;
      }

      const artifactId = source.sha256;
      await rename(sourcePath, path.join(stagingDirectory, 'artifacts', `${artifactId}.bin`));
      const mimeType = MIME_BY_EXTENSION[extension] || 'application/octet-stream';
      const manifest = {
        schema_version: 'tender_manual_source_upload_v1',
        success: true,
        job_id: safeJobId,
        analysis_run_id: runId,
        source_attachment_index: input.sourceAttachmentIndex,
        source: {
          declared_extension: extension,
          size_bytes: source.sizeBytes,
          sha256: source.sha256,
        },
        entries: [{
          kind: 'file',
          logical_path: safeFileName,
          file_name: safeFileName,
          file_extension: extension,
          archive_depth: 0,
          archive_chain: [],
          mime_type: mimeType,
          size_bytes: source.sizeBytes,
          sha256: source.sha256,
          artifact_id: artifactId,
        }],
      };
      const result = await store.commitJob({
        analysisRunId: runId,
        jobId: safeJobId,
        stagingDirectory,
        manifest,
      });
      stagingDirectory = null;
      if (result.source?.sha256 !== source.sha256) {
        throw new ArchiveError('JOB_INPUT_MISMATCH', 'The completed upload has different source content', 409);
      }
      return result;
    } catch (error) {
      if (stagingDirectory) await rm(stagingDirectory, { recursive: true, force: true });
      throw asArchiveError(error);
    }
  }

  return { uploadSource };
}
