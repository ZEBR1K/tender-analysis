import { spawn } from 'node:child_process';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_MAX_COMMAND_BYTES = 32 * 1024 * 1024;
export const DEFAULT_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
export const DEFAULT_KILL_GRACE_MS = 5 * 1000;

function isWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function canonicalDirectory(directory, label) {
  const resolved = path.resolve(directory);
  const metadata = await lstat(resolved);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory, not a symlink or junction`);
  }
  return realpath(resolved);
}

async function existingCanonicalDirectory(directory) {
  try {
    return await canonicalDirectory(directory, 'Approved job root');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function ensureContainedDirectory(directory, root) {
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
  const canonical = await canonicalDirectory(directory, 'Workspace tool directory');
  if (!isWithin(canonical, root)) {
    throw new Error('Workspace tool directory escapes the workspace through a symlink or junction');
  }
  return canonical;
}

export function toolOutputRoot(workspaceDirectory = process.cwd()) {
  return path.resolve(workspaceDirectory, '.tmp', 'document-tools');
}

export async function createToolOutputDirectory(
  kind,
  { workspaceDirectory = process.cwd() } = {},
) {
  if (!/^[a-z][a-z0-9-]{0,31}$/u.test(kind)) {
    throw new Error('Tool output kind is invalid');
  }
  const workspace = await canonicalDirectory(workspaceDirectory, 'Workspace');
  const temporary = await ensureContainedDirectory(path.join(workspace, '.tmp'), workspace);
  const root = await ensureContainedDirectory(path.join(temporary, 'document-tools'), workspace);
  const created = await mkdtemp(path.join(root, `${kind}-`));
  const canonical = await canonicalDirectory(created, 'Tool output directory');
  if (!isWithin(canonical, root) || canonical === root) {
    throw new Error('Tool output directory escapes the workspace');
  }
  return canonical;
}

export async function resolveRegularInput(
  inputPath,
  {
    extensions = [],
    workspaceDirectory = process.cwd(),
    inputDirectory = path.resolve(process.cwd(), '..', 'input'),
  } = {},
) {
  if (typeof inputPath !== 'string' || !inputPath.trim()) {
    throw new Error('Input path is required');
  }
  const resolved = path.resolve(inputPath);
  const metadata = await lstat(resolved);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('Input must be a regular non-symlink file');
  }
  const canonical = await realpath(resolved);
  const approvedRoots = (await Promise.all([
    existingCanonicalDirectory(workspaceDirectory),
    existingCanonicalDirectory(inputDirectory),
  ])).filter(Boolean);
  if (!approvedRoots.some((root) => isWithin(canonical, root))) {
    throw new Error('Input must stay within the approved job roots (workspace or input)');
  }
  const allowed = new Set(extensions.map((value) => value.toLowerCase()));
  if (allowed.size > 0 && !allowed.has(path.extname(canonical).toLowerCase())) {
    throw new Error(`Input extension is not supported: ${path.extname(canonical) || '(none)'}`);
  }
  return canonical;
}

export async function validateGeneratedFiles(
  directory,
  {
    extensions = [],
    expectedCount,
    maxFileBytes = 64 * 1024 * 1024,
    maxTotalBytes = 256 * 1024 * 1024,
  } = {},
) {
  const canonicalDirectoryPath = await canonicalDirectory(directory, 'Generated artifact directory');
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes <= 0) {
    throw new TypeError('maxFileBytes must be a positive integer');
  }
  if (!Number.isSafeInteger(maxTotalBytes) || maxTotalBytes <= 0) {
    throw new TypeError('maxTotalBytes must be a positive integer');
  }
  const allowed = new Set(extensions.map((value) => value.toLowerCase()));
  const entries = await readdir(canonicalDirectoryPath, { withFileTypes: true });
  const files = [];
  let totalBytes = 0;
  for (const entry of entries) {
    const candidate = path.join(canonicalDirectoryPath, entry.name);
    const metadata = await lstat(candidate);
    if (!entry.isFile() || !metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error('Generated artifacts must contain only regular non-symlink files');
    }
    const canonical = await realpath(candidate);
    if (!isWithin(canonical, canonicalDirectoryPath) || canonical === canonicalDirectoryPath) {
      throw new Error('Generated artifact escapes its output directory');
    }
    if (allowed.size > 0 && !allowed.has(path.extname(entry.name).toLowerCase())) {
      throw new Error(`Generated artifact extension is not allowed: ${entry.name}`);
    }
    totalBytes += metadata.size;
    if (metadata.size > maxFileBytes || totalBytes > maxTotalBytes) {
      throw new Error('Generated artifact size limit exceeded');
    }
    files.push({ name: entry.name, path: canonical, size: metadata.size });
  }
  files.sort((left, right) => left.name.localeCompare(right.name, 'en'));
  if (expectedCount !== undefined && files.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} generated artifacts and found ${files.length}`);
  }
  return files;
}

export async function removeToolOutputDirectory(
  directory,
  { workspaceDirectory = process.cwd() } = {},
) {
  const workspace = await canonicalDirectory(workspaceDirectory, 'Workspace');
  const root = await canonicalDirectory(toolOutputRoot(workspace), 'Tool output root');
  if (root === workspace || !isWithin(root, workspace)) {
    throw new Error('Tool output root escapes the workspace through a symlink or junction');
  }
  const canonical = await canonicalDirectory(directory, 'Tool output directory');
  if (canonical === root || !isWithin(canonical, root)) {
    throw new Error('Refusing to remove a directory outside the workspace tool output root');
  }
  await rm(canonical, { recursive: true, force: true });
}

export async function cleanupToolOutputAfterError(
  error,
  directory,
  {
    workspaceDirectory = process.cwd(),
    removeOutputDirectory = removeToolOutputDirectory,
  } = {},
) {
  try {
    await removeOutputDirectory(directory, { workspaceDirectory });
  } catch (cleanupError) {
    const primaryMessage = error instanceof Error ? error.message : String(error);
    const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
    throw new AggregateError(
      [error, cleanupError],
      `${primaryMessage}; cleanup failure for ${directory}: ${cleanupMessage}`,
    );
  }
  throw error;
}

export async function readBoundedRegularFile(filePath, maxBytes = DEFAULT_MAX_COMMAND_BYTES) {
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('Generated artifact must be a regular non-symlink file');
  }
  if (metadata.size > maxBytes) throw new Error('Generated artifact exceeds the output limit');
  return readFile(filePath);
}

export async function writeNewFile(filePath, bytes) {
  await writeFile(filePath, bytes, { flag: 'wx', mode: 0o600 });
  return filePath;
}

export function runBoundedCommand(
  command,
  args,
  {
    cwd = process.cwd(),
    maxBytes = DEFAULT_MAX_COMMAND_BYTES,
    timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
    killGraceMs = DEFAULT_KILL_GRACE_MS,
    environment = process.env,
  } = {},
) {
  if (typeof command !== 'string' || !command || !Array.isArray(args)) {
    throw new TypeError('Command and argument array are required');
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError('maxBytes must be a positive integer');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('timeoutMs must be a positive integer');
  }
  if (!Number.isSafeInteger(killGraceMs) || killGraceMs <= 0) {
    throw new TypeError('killGraceMs must be a positive integer');
  }
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: environment,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    let settled = false;
    let childClosed = false;
    let treeStopComplete = false;
    let terminationError;
    let timeout;
    let killGraceTimeout;
    const stopProcessTree = () => {
      if (!child.pid) return Promise.resolve();
      if (process.platform === 'win32') {
        return new Promise((resolveTreeStop) => {
          const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
            shell: false,
            windowsHide: true,
            stdio: 'ignore',
          });
          let killerSettled = false;
          const finish = () => {
            if (killerSettled) return;
            killerSettled = true;
            resolveTreeStop();
          };
          killer.on('error', () => {
            try { child.kill('SIGKILL'); } catch {}
            finish();
          });
          killer.on('close', (code) => {
            if (code !== 0) {
              try { child.kill('SIGKILL'); } catch {}
            }
            finish();
          });
        });
      }
      try {
        if (child.pid) {
          process.kill(-child.pid, 'SIGKILL');
        }
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          // The process may already have exited between the limit and kill.
        }
      }
      return Promise.resolve();
    };
    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(killGraceTimeout);
      reject(error);
    };
    const finishTermination = () => {
      if (!terminationError || !treeStopComplete || !childClosed) return;
      finishReject(terminationError);
    };
    const beginTermination = (error) => {
      if (settled || terminationError) return;
      terminationError = error;
      clearTimeout(timeout);
      killGraceTimeout = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
        finishReject(new Error(
          `${error.message}; process tree termination exceeded ${killGraceMs} ms`,
        ));
      }, killGraceMs);
      stopProcessTree().then(() => {
        treeStopComplete = true;
        finishTermination();
      }, (stopError) => {
        treeStopComplete = true;
        terminationError = new AggregateError(
          [error, stopError],
          `${error.message}; process tree termination failed: ${stopError.message}`,
        );
        finishTermination();
      });
    };
    timeout = setTimeout(() => {
      beginTermination(new Error(`Command timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    timeout.unref?.();
    const collect = (target) => (chunk) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > maxBytes) {
        beginTermination(new Error(`Command output limit exceeded (${maxBytes} bytes)`));
        return;
      }
      target.push(chunk);
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    child.on('error', (error) => {
      childClosed = true;
      if (terminationError) finishTermination();
      else finishReject(error);
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      childClosed = true;
      if (terminationError) {
        finishTermination();
        return;
      }
      clearTimeout(timeout);
      const stdoutBytes = Buffer.concat(stdout);
      const stderrBytes = Buffer.concat(stderr);
      if (code !== 0) {
        const detail = stderrBytes.toString('utf8').trim().slice(0, 2000);
        finishReject(new Error(
          `Command failed (${command}, exit=${String(code)}, signal=${String(signal)}): ${detail}`,
        ));
        return;
      }
      settled = true;
      resolve({ stdout: stdoutBytes, stderr: stderrBytes });
    });
  });
}

export function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function isDirectRun(metaUrl) {
  return Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === metaUrl;
}

export async function runCli(main) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    })}\n`);
    process.exitCode = 1;
  }
}
