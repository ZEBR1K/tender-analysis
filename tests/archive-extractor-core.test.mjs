import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import { ArchiveError, toSafeError } from '../deploy/archive-extractor/src/errors.mjs';
import {
  assertSafeLogicalPath,
  collisionKey,
  normalizeLogicalPath,
} from '../deploy/archive-extractor/src/path-policy.mjs';
import { createStore } from '../deploy/archive-extractor/src/store.mjs';
import { createExtractor } from '../deploy/archive-extractor/src/extract-job.mjs';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = `${RUN_ID}--source-000001`;

function inputBuffer(value = 'root archive') {
  return Readable.from([Buffer.from(value)]);
}

function fakeArchiveAdapter(entriesByArchive, bodiesByEntry = {}) {
  return {
    async detectArchive({ archivePath }) {
      return entriesByArchive[archivePath]?.format ?? null;
    },
    async listArchive({ archivePath }) {
      const archive = entriesByArchive[archivePath];
      if (!archive) throw new Error(`Unknown fake archive: ${archivePath}`);
      return archive.entries;
    },
    async streamEntry({ archivePath, entryPath, outputPath, byteBudget }) {
      const key = `${archivePath}:${entryPath}`;
      const body = Buffer.from(bodiesByEntry[key] ?? entryPath);
      if (body.length > byteBudget) {
        throw new ArchiveError('ARCHIVE_FILE_TOO_LARGE', 'Archive entry exceeds its byte budget', 413);
      }
      await import('node:fs/promises').then(({ writeFile }) => writeFile(outputPath, body));
      return { bytesWritten: body.length };
    },
  };
}

test('path policy normalizes separators and Unicode without discarding provenance', () => {
  assert.equal(normalizeLogicalPath('folder\\Документ.pdf'), 'folder/Документ.pdf');
  assert.equal(normalizeLogicalPath('e\u0301/file.pdf'), 'é/file.pdf');
  assert.equal(collisionKey('A/FILE.PDF'), collisionKey('a/file.pdf'));
});

test('path policy rejects absolute, UNC, drive, URI, dot, parent and NUL paths', () => {
  const unsafe = [
    '/etc/passwd',
    '\\windows\\system32',
    '\\\\server\\share\\file.pdf',
    'C:\\temp\\file.pdf',
    'https://example.test/file.pdf',
    './file.pdf',
    'a/../file.pdf',
    'a/./file.pdf',
    `a/\0/file.pdf`,
  ];
  for (const value of unsafe) {
    assert.throws(
      () => assertSafeLogicalPath(value),
      (error) => error instanceof ArchiveError && error.code === 'ARCHIVE_PATH_UNSAFE',
      value,
    );
  }
});

test('safe errors expose typed audit data without stack traces', () => {
  const safe = toSafeError(new ArchiveError('ARCHIVE_CORRUPT', 'broken', 422, { entry: 'a.zip' }));
  assert.deepEqual(safe, {
    ok: false,
    error: { code: 'ARCHIVE_CORRUPT', message: 'broken', details: { entry: 'a.zip' } },
  });
  const unknown = toSafeError(new Error('secret stack'));
  assert.equal(unknown.error.code, 'ARTIFACT_STORE_ERROR');
  assert.equal('stack' in unknown.error, false);
});

test('store uses validated opaque identifiers, atomic manifest commit and exact artifact lookup', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'archive-store-'));
  const store = createStore({ rootDirectory: root, ttlHours: 72 });
  const job = store.pathsForJob({ analysisRunId: RUN_ID, jobId: JOB_ID });
  assert.match(job.jobDirectory, /11111111-1111-4111-8111-111111111111[\\/]jobs[\\/]11111111-1111-4111-8111-111111111111--source-000001$/);
  assert.throws(
    () => store.pathsForJob({ analysisRunId: '../escape', jobId: JOB_ID }),
    (error) => error.code === 'INGESTION_CONTRACT_INVALID',
  );

  const staging = await store.createStagingDirectory({ analysisRunId: RUN_ID, jobId: JOB_ID });
  const artifactId = 'a'.repeat(64);
  await import('node:fs/promises').then(({ mkdir, writeFile }) => Promise.all([
    mkdir(path.join(staging, 'artifacts'), { recursive: true }),
    writeFile(path.join(staging, 'source.bin'), 'source'),
  ]).then(() => writeFile(path.join(staging, 'artifacts', `${artifactId}.bin`), 'artifact')));
  const manifest = {
    ok: true,
    analysis_run_id: RUN_ID,
    job_id: JOB_ID,
    source_sha256: 'b'.repeat(64),
    entries: [{ artifact_id: artifactId, file_name: 'report.pdf' }],
  };
  await store.commitJob({ analysisRunId: RUN_ID, jobId: JOB_ID, stagingDirectory: staging, manifest });

  assert.deepEqual(await store.readCommittedManifest({ analysisRunId: RUN_ID, jobId: JOB_ID }), manifest);
  const resolved = await store.resolveArtifact({ analysisRunId: RUN_ID, artifactId });
  assert.equal(await readFile(resolved.path, 'utf8'), 'artifact');
  assert.equal((await stat(job.manifestPath)).isFile(), true);
});

test('extractor returns deterministic leaves and preserves duplicate basenames in separate paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'archive-extract-'));
  const store = createStore({ rootDirectory: root, ttlHours: 72 });
  const fakeRoot = '__SOURCE__';
  const adapter = fakeArchiveAdapter({
    [fakeRoot]: {
      format: 'zip',
      entries: [
        { path: 'b/report.pdf', type: 'file', size: 3 },
        { path: 'a/report.pdf', type: 'file', size: 3 },
        { path: 'notes.txt', type: 'file', size: 4 },
      ],
    },
  }, {
    [`${fakeRoot}:a/report.pdf`]: 'AAA',
    [`${fakeRoot}:b/report.pdf`]: 'BBB',
    [`${fakeRoot}:notes.txt`]: 'text',
  });
  const extractor = createExtractor({
    store,
    archiveAdapter: adapter,
    sourceArchiveAlias: fakeRoot,
    now: () => 1_700_000_000_000,
  });

  const manifest = await extractor.extractJob({
    inputStream: inputBuffer(),
    analysisRunId: RUN_ID,
    sourceAttachmentIndex: 1,
    declaredExtension: 'zip',
    jobId: JOB_ID,
    deadlineEpochMs: 1_700_000_300_000,
  });

  assert.equal(manifest.success, true);
  assert.equal(manifest.source.detected_format, 'zip');
  assert.deepEqual(manifest.entries.map((entry) => entry.logical_path), [
    'a/report.pdf',
    'b/report.pdf',
    'notes.txt',
  ]);
  assert.deepEqual(manifest.entries.map((entry) => entry.file_extension), ['pdf', 'pdf', 'txt']);
  assert.equal(new Set(manifest.entries.map((entry) => entry.artifact_id)).size, 3);
  assert.deepEqual(
    await extractor.extractJob({
      inputStream: inputBuffer(),
      analysisRunId: RUN_ID,
      sourceAttachmentIndex: 1,
      declaredExtension: 'zip',
      jobId: JOB_ID,
      deadlineEpochMs: 1_700_000_300_000,
    }),
    manifest,
  );
});

test('extractor rejects normalized collisions and link entries before extracting', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'archive-collision-'));
  const store = createStore({ rootDirectory: root, ttlHours: 72 });
  for (const [jobId, entries, code] of [
    ['collision', [{ path: 'A.pdf', type: 'file' }, { path: 'a.PDF', type: 'file' }], 'ARCHIVE_PATH_UNSAFE'],
    ['symlink', [{ path: 'link.pdf', type: 'symlink' }], 'ARCHIVE_PATH_UNSAFE'],
  ]) {
    const extractor = createExtractor({
      store,
      archiveAdapter: fakeArchiveAdapter({ __SOURCE__: { format: 'zip', entries } }),
      sourceArchiveAlias: '__SOURCE__',
      now: () => 1_700_000_000_000,
    });
    await assert.rejects(
      extractor.extractJob({
        inputStream: inputBuffer(jobId),
        analysisRunId: RUN_ID,
        sourceAttachmentIndex: jobId === 'collision' ? 2 : 3,
        declaredExtension: 'zip',
        jobId: `${RUN_ID}--source-${jobId === 'collision' ? '000002' : '000003'}`,
        deadlineEpochMs: 1_700_000_300_000,
      }),
      (error) => error.code === code,
    );
  }
});

test('extractor enforces source size, entry count, per-file, total and deadline limits', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'archive-limits-'));
  const base = {
    maxSourceBytes: 8,
    maxFileBytes: 4,
    maxTotalBytes: 6,
    maxEntries: 2,
    maxDepth: 3,
  };
  const cases = [
    {
      jobId: 'source-limit',
      input: '123456789',
      entries: [],
      code: 'ARCHIVE_TOO_LARGE',
    },
    {
      jobId: 'entry-limit',
      input: 'ok',
      entries: [{ path: 'a.pdf', type: 'file' }, { path: 'b.pdf', type: 'file' }, { path: 'c.pdf', type: 'file' }],
      bodies: { '__SOURCE__:a.pdf': 'a', '__SOURCE__:b.pdf': 'b', '__SOURCE__:c.pdf': 'c' },
      code: 'ARCHIVE_ENTRY_LIMIT',
    },
    {
      jobId: 'file-limit',
      input: 'ok',
      entries: [{ path: 'large.pdf', type: 'file' }],
      bodies: { '__SOURCE__:large.pdf': '12345' },
      code: 'ARCHIVE_FILE_TOO_LARGE',
    },
    {
      jobId: 'total-limit',
      input: 'ok',
      entries: [{ path: 'a.pdf', type: 'file' }, { path: 'b.pdf', type: 'file' }],
      bodies: { '__SOURCE__:a.pdf': '1234', '__SOURCE__:b.pdf': '5678' },
      code: 'ARCHIVE_TOTAL_TOO_LARGE',
    },
  ];
  for (const sample of cases) {
    const store = createStore({ rootDirectory: root, ttlHours: 72 });
    const extractor = createExtractor({
      store,
      limits: base,
      archiveAdapter: fakeArchiveAdapter(
        { __SOURCE__: { format: 'zip', entries: sample.entries } },
        sample.bodies,
      ),
      sourceArchiveAlias: '__SOURCE__',
      now: () => 1_700_000_000_000,
    });
    await assert.rejects(
      extractor.extractJob({
        inputStream: inputBuffer(sample.input),
        analysisRunId: RUN_ID,
        sourceAttachmentIndex: cases.indexOf(sample) + 10,
        declaredExtension: 'zip',
        jobId: `${RUN_ID}--source-${String(cases.indexOf(sample) + 10).padStart(6, '0')}`,
        deadlineEpochMs: 1_700_000_300_000,
      }),
      (error) => error.code === sample.code,
      sample.jobId,
    );
  }

  const timeoutExtractor = createExtractor({
    store: createStore({ rootDirectory: root, ttlHours: 72 }),
    archiveAdapter: fakeArchiveAdapter({ __SOURCE__: { format: 'zip', entries: [] } }),
    sourceArchiveAlias: '__SOURCE__',
    now: () => 1_700_000_400_000,
  });
  await assert.rejects(
    timeoutExtractor.extractJob({
      inputStream: inputBuffer('ok'),
      analysisRunId: RUN_ID,
      sourceAttachmentIndex: 20,
      declaredExtension: 'zip',
      jobId: `${RUN_ID}--source-000020`,
      deadlineEpochMs: 1_700_000_300_000,
    }),
    (error) => error.code === 'ARCHIVE_TIMEOUT',
  );
});

test('extractor rejects format mismatch and nested depth four', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'archive-depth-'));
  const store = createStore({ rootDirectory: root, ttlHours: 72 });
  const mismatch = createExtractor({
    store,
    archiveAdapter: fakeArchiveAdapter({ __SOURCE__: { format: '7z', entries: [] } }),
    sourceArchiveAlias: '__SOURCE__',
    now: () => 1_700_000_000_000,
  });
  await assert.rejects(
    mismatch.extractJob({
      inputStream: inputBuffer('ok'),
      analysisRunId: RUN_ID,
      sourceAttachmentIndex: 21,
      declaredExtension: 'zip',
      jobId: `${RUN_ID}--source-000021`,
      deadlineEpochMs: 1_700_000_300_000,
    }),
    (error) => error.code === 'ARCHIVE_FORMAT_MISMATCH',
  );

  const bodies = {
    '__SOURCE__:l2.zip': 'level2',
  };
  const adapter = fakeArchiveAdapter({
    __SOURCE__: { format: 'zip', entries: [{ path: 'l2.zip', type: 'file' }] },
  }, bodies);
  adapter.detectArchive = async ({ logicalPath }) => logicalPath?.endsWith('.zip') ? 'zip' : 'zip';
  adapter.listArchive = async ({ archivePath, logicalPath }) => {
    const level = Number(/l(\d)/.exec(logicalPath ?? '')?.[1] ?? 1);
    return level < 4 ? [{ path: `l${level + 1}.zip`, type: 'file' }] : [{ path: 'end.pdf', type: 'file' }];
  };
  adapter.streamEntry = async ({ entryPath, outputPath }) => {
    const body = Buffer.from(entryPath);
    await import('node:fs/promises').then(({ writeFile }) => writeFile(outputPath, body));
    return { bytesWritten: body.length };
  };
  const depth = createExtractor({ store, archiveAdapter: adapter, sourceArchiveAlias: '__SOURCE__', now: () => 1_700_000_000_000 });
  await assert.rejects(
    depth.extractJob({
      inputStream: inputBuffer('ok'),
      analysisRunId: RUN_ID,
      sourceAttachmentIndex: 22,
      declaredExtension: 'zip',
      jobId: `${RUN_ID}--source-000022`,
      deadlineEpochMs: 1_700_000_300_000,
    }),
    (error) => error.code === 'ARCHIVE_DEPTH_EXCEEDED',
  );
});
