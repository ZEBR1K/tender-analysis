import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';

import { ArchiveError } from './errors.mjs';

const EXECUTABLE = process.env.ARCHIVE_EXTRACTOR_7ZZ || '7zz';

function mapFailure(stderr, fallback = 'ARCHIVE_CORRUPT') {
  const text = String(stderr).toLowerCase();
  if (text.includes('wrong password') || text.includes('encrypted')) {
    return new ArchiveError('ARCHIVE_ENCRYPTED', 'Encrypted archives are not supported', 422);
  }
  if (text.includes('cannot open') || text.includes('is not archive') || text.includes('unexpected end')) {
    return new ArchiveError('ARCHIVE_CORRUPT', 'Archive cannot be read', 422);
  }
  return new ArchiveError(fallback, 'Archive cannot be read', 422);
}

async function capture(args, { signal, allowFailure = false } = {}) {
  const child = spawn(EXECUTABLE, args, {
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const abort = () => child.kill('SIGKILL');
  signal?.addEventListener('abort', abort, { once: true });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  const [code] = await once(child, 'close');
  signal?.removeEventListener('abort', abort);
  const result = {
    code,
    stdout: Buffer.concat(stdout).toString('utf8'),
    stderr: Buffer.concat(stderr).toString('utf8'),
  };
  if (signal?.aborted) throw new ArchiveError('ARCHIVE_TIMEOUT', 'Archive extraction exceeded five minutes', 408);
  if (code !== 0 && !allowFailure) throw mapFailure(result.stderr || result.stdout);
  return result;
}

function parseSlt(text) {
  const blocks = String(text).split(/\r?\n\r?\n/u);
  const records = [];
  for (const block of blocks) {
    const record = {};
    for (const line of block.split(/\r?\n/u)) {
      const split = line.indexOf(' = ');
      if (split < 1) continue;
      record[line.slice(0, split)] = line.slice(split + 3);
    }
    if (Object.keys(record).length > 0) records.push(record);
  }
  return records;
}

function normalizeFormat(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw.includes('7z')) return '7z';
  if (raw.includes('rar')) return 'rar';
  if (raw.includes('gzip')) return 'gzip';
  if (raw.includes('tar')) return 'tar';
  if (raw.includes('zip')) return 'zip';
  return raw || null;
}

export async function detectArchive({ archivePath, actualArchivePath, signal, allowUnknown = false }) {
  const target = actualArchivePath || archivePath;
  const result = await capture(['l', '-slt', '-ba', '--', target], { signal, allowFailure: allowUnknown });
  if (result.code !== 0) return null;
  const records = parseSlt(result.stdout);
  const formatRecord = records.find((record) => record.Type || record.Physical_Size || record['Headers Size']);
  return normalizeFormat(formatRecord?.Type);
}

export async function listArchive({ archivePath, actualArchivePath, signal }) {
  const target = actualArchivePath || archivePath;
  const result = await capture(['l', '-slt', '-ba', '--', target], { signal });
  const records = parseSlt(result.stdout);
  const entries = [];
  for (const record of records) {
    if (!record.Path || record.Type || record.Physical_Size || record['Headers Size']) continue;
    const attributes = String(record.Attributes || '');
    const folder = record.Folder === '+' || attributes.startsWith('D');
    const symbolicLink = record['Symbolic Link'] || record['Hard Link'];
    entries.push({
      path: record.Path,
      type: symbolicLink ? (record['Hard Link'] ? 'hardlink' : 'symlink') : folder ? 'directory' : 'file',
      size: record.Size === undefined ? null : Number(record.Size),
      encrypted: record.Encrypted === '+',
      linkTarget: symbolicLink || null,
    });
  }
  return entries;
}

export async function streamEntry({
  archivePath,
  actualArchivePath,
  entryPath,
  outputPath,
  byteBudget,
  signal,
}) {
  const target = actualArchivePath || archivePath;
  const child = spawn(EXECUTABLE, ['x', '-so', '-bd', '-y', '--', target, entryPath], {
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = createWriteStream(outputPath, { flags: 'wx', mode: 0o600 });
  let bytesWritten = 0;
  let stderr = '';
  const abort = () => child.kill('SIGKILL');
  signal?.addEventListener('abort', abort, { once: true });
  child.stderr.on('data', (chunk) => {
    if (stderr.length < 8192) stderr += chunk.toString('utf8');
  });
  let limitError = null;
  child.stdout.on('data', (chunk) => {
    bytesWritten += chunk.length;
    if (bytesWritten > byteBudget && !limitError) {
      limitError = new ArchiveError('ARCHIVE_FILE_TOO_LARGE', 'Archive entry exceeds 50 MiB', 413);
      child.kill('SIGKILL');
      output.destroy(limitError);
      return;
    }
    if (!output.write(chunk)) child.stdout.pause();
  });
  output.on('drain', () => child.stdout.resume());
  const [code] = await once(child, 'close');
  signal?.removeEventListener('abort', abort);
  if (!output.destroyed) output.end();
  if (!output.closed) await once(output, 'close');
  if (limitError) throw limitError;
  if (signal?.aborted) throw new ArchiveError('ARCHIVE_TIMEOUT', 'Archive extraction exceeded five minutes', 408);
  if (code !== 0) throw mapFailure(stderr);
  return { bytesWritten };
}
