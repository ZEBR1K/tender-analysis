import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  realpath,
  rm,
} from 'node:fs/promises';
import path from 'node:path';

const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DEFAULT_RUNTIME_ROOT = '/dev/shm';

function validatedJobId(value) {
  const normalized = String(value || '').toLowerCase();
  if (!JOB_ID_PATTERN.test(normalized)) throw new Error('jobId must be a UUID');
  return normalized;
}

function validatedRuntimeRoot(value) {
  if (typeof value === 'string' && value.startsWith('/')) {
    const normalized = path.posix.normalize(value);
    if (!path.posix.isAbsolute(normalized) || normalized === '/') {
      throw new Error('Office runtime root must be a controlled absolute path');
    }
    return normalized;
  }
  const normalized = path.resolve(String(value || ''));
  if (!path.isAbsolute(normalized) || normalized === path.parse(normalized).root) {
    throw new Error('Office runtime root must be a controlled absolute path');
  }
  return normalized;
}

export function officeRuntimeDirectory(
  jobId,
  { runtimeRoot = DEFAULT_RUNTIME_ROOT } = {},
) {
  const normalizedJobId = validatedJobId(jobId);
  const normalizedRoot = validatedRuntimeRoot(runtimeRoot);
  const suffix = createHash('sha256').update(normalizedJobId, 'utf8').digest('hex').slice(0, 24);
  return normalizedRoot.startsWith('/')
    ? path.posix.join(normalizedRoot, `tc-${suffix}`)
    : path.join(normalizedRoot, `tc-${suffix}`);
}

async function assertRuntimeRoot(runtimeRoot) {
  const metadata = await lstat(runtimeRoot);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('Office runtime root must be a real directory');
  }
  return realpath(runtimeRoot);
}

export async function removeOfficeRuntime({ jobId, runtimeRoot = DEFAULT_RUNTIME_ROOT } = {}) {
  const root = await assertRuntimeRoot(validatedRuntimeRoot(runtimeRoot));
  const target = officeRuntimeDirectory(jobId, { runtimeRoot: root });
  const metadata = await lstat(target).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (!metadata) return;
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('Office runtime target must be a real directory');
  }
  const canonical = await realpath(target);
  if (path.dirname(canonical) !== root || canonical !== target) {
    throw new Error('Office runtime target escaped its controlled root');
  }
  await rm(target, { recursive: true, force: false });
}

export async function prepareOfficeRuntime({ jobId, runtimeRoot = DEFAULT_RUNTIME_ROOT } = {}) {
  const root = await assertRuntimeRoot(validatedRuntimeRoot(runtimeRoot));
  await removeOfficeRuntime({ jobId, runtimeRoot: root });
  const target = officeRuntimeDirectory(jobId, { runtimeRoot: root });
  await mkdir(target, { mode: 0o700 });
  await chmod(target, 0o700);
  return target;
}
