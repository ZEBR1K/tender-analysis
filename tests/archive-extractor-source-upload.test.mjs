import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import { ArchiveError } from '../deploy/archive-extractor/src/errors.mjs';
import { createSourceUploader } from '../deploy/archive-extractor/src/source-upload.mjs';
import { createStore } from '../deploy/archive-extractor/src/store.mjs';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = `${RUN_ID}--upload-000001`;

async function createUploader(limitOverrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'manual-source-upload-'));
  const store = createStore({ rootDirectory: root, ttlHours: 72 });
  return {
    root,
    store,
    uploader: createSourceUploader({ store, limits: limitOverrides }),
  };
}

function uploadInput(overrides = {}) {
  return {
    inputStream: Readable.from(overrides.bytes ?? Buffer.from('manual pdf bytes')),
    analysisRunId: RUN_ID,
    sourceAttachmentIndex: 1,
    jobId: JOB_ID,
    fileName: overrides.fileName ?? 'Техническое задание.pdf',
    declaredExtension: overrides.declaredExtension ?? 'pdf',
    mimeType: overrides.mimeType ?? 'application/pdf',
  };
}

test('source uploader persists exact bytes and returns an integrity manifest', async () => {
  const { store, uploader } = await createUploader();
  const result = await uploader.uploadSource(uploadInput());

  assert.equal(result.schema_version, 'tender_manual_source_upload_v1');
  assert.equal(result.success, true);
  assert.equal(result.analysis_run_id, RUN_ID);
  assert.equal(result.source_attachment_index, 1);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].file_name, 'Техническое задание.pdf');
  assert.equal(result.entries[0].file_extension, 'pdf');
  assert.equal(result.entries[0].mime_type, 'application/pdf');
  assert.equal(result.entries[0].size_bytes, Buffer.byteLength('manual pdf bytes'));
  assert.match(result.entries[0].sha256, /^[0-9a-f]{64}$/u);
  assert.equal(result.entries[0].artifact_id, result.entries[0].sha256);

  const artifact = await store.resolveArtifact({
    analysisRunId: RUN_ID,
    artifactId: result.entries[0].artifact_id,
  });
  assert.equal(await readFile(artifact.path, 'utf8'), 'manual pdf bytes');
  assert.equal((await stat(artifact.path)).isFile(), true);
});

test('source uploader is idempotent for the same bytes and rejects changed content', async () => {
  const { uploader } = await createUploader();
  const first = await uploader.uploadSource(uploadInput());
  const second = await uploader.uploadSource(uploadInput());
  assert.deepEqual(second, first);

  await assert.rejects(
    uploader.uploadSource(uploadInput({ bytes: Buffer.from('different') })),
    (error) => error instanceof ArchiveError && error.code === 'JOB_INPUT_MISMATCH',
  );
});

test('source uploader rejects executables, unknown formats and unsafe names', async () => {
  const { uploader } = await createUploader();

  for (const input of [
    uploadInput({ fileName: 'payload.exe', declaredExtension: 'exe' }),
    uploadInput({ fileName: 'payload.pdf.exe', declaredExtension: 'exe' }),
    uploadInput({ fileName: 'payload.unknown', declaredExtension: 'unknown' }),
    uploadInput({ fileName: '../report.pdf' }),
    uploadInput({ fileName: 'folder/report.pdf' }),
  ]) {
    await assert.rejects(
      uploader.uploadSource(input),
      (error) => error instanceof ArchiveError && error.code === 'INGESTION_CONTRACT_INVALID',
    );
  }

  const { uploader: disguisedUploader } = await createUploader();
  await assert.rejects(
    disguisedUploader.uploadSource(uploadInput({
      fileName: 'report.pdf',
      bytes: Buffer.from('MZ executable payload'),
    })),
    (error) => error instanceof ArchiveError && error.code === 'INGESTION_CONTRACT_INVALID',
  );
});

test('source uploader accepts office, text, image and archive formats', async () => {
  const accepted = [
    'pdf', 'docx', 'xlsx', 'xls',
    'txt', 'csv', 'tsv', 'md', 'json', 'xml', 'html', 'rtf',
    'png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp', 'webp',
    'zip', '7z', 'rar', 'tar', 'gz', 'tar.gz', 'tgz',
  ];

  for (const [offset, extension] of accepted.entries()) {
    const index = offset + 1;
    const { uploader } = await createUploader();
    const result = await uploader.uploadSource({
      ...uploadInput({
        fileName: extension === 'tar.gz' ? 'documents.tar.gz' : `documents.${extension}`,
        declaredExtension: extension,
        mimeType: 'application/octet-stream',
      }),
      sourceAttachmentIndex: index,
      jobId: `${RUN_ID}--upload-${String(index).padStart(6, '0')}`,
    });
    assert.equal(result.entries[0].file_extension, extension);
  }
});

test('source uploader enforces 50 MiB document and 100 MiB archive limits while streaming', async () => {
  const { uploader: documentUploader } = await createUploader({
    maxDocumentBytes: 4,
    maxArchiveBytes: 8,
  });
  await assert.rejects(
    documentUploader.uploadSource(uploadInput({ bytes: Buffer.from('12345') })),
    (error) => error instanceof ArchiveError && error.code === 'SOURCE_FILE_TOO_LARGE',
  );

  const { uploader: archiveUploader } = await createUploader({
    maxDocumentBytes: 4,
    maxArchiveBytes: 8,
  });
  await assert.rejects(
    archiveUploader.uploadSource(uploadInput({
      bytes: Buffer.from('123456789'),
      fileName: 'documents.zip',
      declaredExtension: 'zip',
    })),
    (error) => error instanceof ArchiveError && error.code === 'SOURCE_FILE_TOO_LARGE',
  );
});
