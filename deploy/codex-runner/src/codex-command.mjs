import { execFile, spawn } from 'node:child_process';
import { open, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';

import { createCodexEventAccumulator, parseCodexEventLine } from './codex-events.mjs';
import { buildCodexPermissionBoundary } from './permissions.mjs';

const DEFAULT_TIMEOUT_MS = 90 * 60 * 1000;
const DEFAULT_KILL_GRACE_MS = 30 * 1000;
const MAX_STDERR_BYTES = 64 * 1024;
const MAX_RESULT_BYTES = 2 * 1024 * 1024;
const RETRYABLE_CODES = new Set([
  'CODEX_PROCESS_FAILED',
  'CODEX_SPAWN_FAILED',
  'CODEX_TIMEOUT',
  'CODEX_TRANSPORT_ERROR',
]);
const CODEX_ENVIRONMENT_ALLOWLIST = [
  'PATH',
  'CODEX_HOME',
  'HOME',
  'LANG',
  'LC_ALL',
  'TZ',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'SystemRoot',
  'WINDIR',
  'ComSpec',
  'PATHEXT',
  'TEMP',
  'TMP',
  'TMPDIR',
];

function controlledPosixRoot(value, name) {
  const normalized = path.posix.normalize(String(value || ''));
  if (!normalized.startsWith('/') || normalized === '/' || normalized.includes('"')) {
    throw new Error(`${name} must be a controlled absolute POSIX path`);
  }
  return normalized.replace(/\/$/u, '');
}

function assertNoUnsupportedOptions(options, allowed) {
  const unknown = Object.keys(options).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`Unsupported option or caller arguments: ${unknown.join(', ')}`);
  }
}

function assertNoLegacySandbox(args) {
  if (
    args.includes('--sandbox')
    || args.includes('-s')
    || args.some((entry) => String(entry).includes('sandbox_workspace_write'))
  ) {
    throw new Error('Legacy sandbox arguments are forbidden with permission profiles');
  }
}

export function buildCodexCommand(options = {}) {
  assertNoUnsupportedOptions(options, new Set(['jobId', 'jobsRoot', 'runnerRoot']));
  const {
    jobId,
    jobsRoot = '/data/jobs',
    runnerRoot = '/app',
  } = options;
  const normalizedRunnerRoot = controlledPosixRoot(runnerRoot, 'runnerRoot');
  const boundary = buildCodexPermissionBoundary({ jobId, jobsRoot });
  const resultPath = path.posix.join(boundary.workspaceDirectory, 'output', 'result.json');
  const args = [
    'exec',
    ...boundary.cliArgs,
    '--ephemeral',
    '--ignore-rules',
    '--model',
    'gpt-5.6-sol',
    '-c',
    'model_reasoning_effort="high"',
    '-c',
    'tools.web_search=false',
    '-c',
    'tools.view_image=true',
    '-C',
    boundary.workspaceDirectory,
    '--skip-git-repo-check',
    '--output-schema',
    path.posix.join(normalizedRunnerRoot, 'schemas', 'tender-agent-result-v1.schema.json'),
    '--json',
    '-o',
    resultPath,
    '-',
  ];
  assertNoLegacySandbox(args);
  return Object.freeze({
    executable: 'codex',
    args: Object.freeze(args),
    cwd: boundary.workspaceDirectory,
    promptPath: path.posix.join(normalizedRunnerRoot, 'prompts', 'tender-analysis-v1.txt'),
    resultPath,
    shell: false,
  });
}

export function sanitizeCodexEnvironment(baseEnvironment = {}) {
  const sanitized = {};
  for (const allowedName of CODEX_ENVIRONMENT_ALLOWLIST) {
    const actualName = Object.keys(baseEnvironment).find(
      (candidate) => candidate.toLowerCase() === allowedName.toLowerCase(),
    );
    if (!actualName) continue;
    if (/(?:KEY|SECRET|TOKEN|PASSWORD)/iu.test(actualName)) continue;
    const value = baseEnvironment[actualName];
    if (typeof value === 'string' && value.length > 0) sanitized[allowedName] = value;
  }
  return sanitized;
}

function redactStderr(value, secretValues = []) {
  let redacted = String(value || '');
  for (const secret of secretValues) {
    if (typeof secret === 'string' && secret.length >= 4) {
      redacted = redacted.split(secret).join('[REDACTED]');
    }
  }
  redacted = redacted.replace(
    /\b([A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*)\s*[:=]\s*[^\s]+/giu,
    '$1=[REDACTED]',
  );
  const bytes = Buffer.from(redacted, 'utf8');
  if (bytes.length <= MAX_STDERR_BYTES) return bytes;
  return Buffer.concat([
    bytes.subarray(0, MAX_STDERR_BYTES - 20),
    Buffer.from('\n[stderr truncated]\n', 'utf8'),
  ]).subarray(0, MAX_STDERR_BYTES);
}

async function readBoundedJson(filePath) {
  try {
    const metadata = await stat(filePath);
    if (!metadata.isFile() || metadata.size > MAX_RESULT_BYTES) {
      return { valid: false, value: null, bytes: null };
    }
    const bytes = await readFile(filePath);
    const value = JSON.parse(bytes.toString('utf8'));
    return {
      valid: value !== null && typeof value === 'object' && !Array.isArray(value),
      value,
      bytes,
    };
  } catch {
    return { valid: false, value: null, bytes: null };
  }
}

function terminateProcessTree(child, signal) {
  if (!child?.pid) return Promise.resolve();
  if (process.platform === 'win32') {
    const args = ['/PID', String(child.pid), '/T'];
    if (signal === 'SIGKILL') args.push('/F');
    return new Promise((resolve) => {
      const killer = execFile('taskkill', args, { windowsHide: true }, () => resolve());
      killer.once('error', () => {
        child.kill(signal);
        resolve();
      });
    });
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
  return Promise.resolve();
}

function waitForClose(child) {
  return new Promise((resolve) => {
    let spawnError = null;
    child.once('error', (error) => { spawnError = error; });
    child.once('close', (exitCode, signal) => resolve({ exitCode, signal, spawnError }));
  });
}

function attemptArtifactPaths(auditDirectory, attempt) {
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > 2) {
    throw new Error('attempt must be 1 or 2');
  }
  return {
    events: path.join(auditDirectory, `codex-events.attempt-${attempt}.jsonl`),
    stderr: path.join(auditDirectory, `codex-stderr.attempt-${attempt}.log`),
    result: path.join(auditDirectory, `codex-result.attempt-${attempt}.json`),
    status: path.join(auditDirectory, `codex-status.attempt-${attempt}.json`),
  };
}

export async function executeCodexCommand({
  executable,
  args,
  cwd,
  prompt,
  resultPath,
  auditDirectory,
  attempt,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  killGraceMs = DEFAULT_KILL_GRACE_MS,
  baseEnv = process.env,
  secretValues = [],
  spawnProcess = spawn,
} = {}) {
  if (typeof executable !== 'string' || executable.length === 0) throw new TypeError('executable is required');
  if (!Array.isArray(args) || args.some((entry) => typeof entry !== 'string')) throw new TypeError('args must be strings');
  if (typeof prompt !== 'string') throw new TypeError('prompt must be a string');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be positive');
  if (!Number.isSafeInteger(killGraceMs) || killGraceMs <= 0) throw new TypeError('killGraceMs must be positive');

  const artifacts = attemptArtifactPaths(auditDirectory, attempt);
  let eventsHandle;
  let stderrHandle;
  try {
    eventsHandle = await open(artifacts.events, 'wx', 0o600);
    stderrHandle = await open(artifacts.stderr, 'wx', 0o600);
  } catch (error) {
    await eventsHandle?.close().catch(() => {});
    await stderrHandle?.close().catch(() => {});
    throw error;
  }
  const accumulator = createCodexEventAccumulator();
  let eventError = null;
  const stderrChunks = [];
  let stderrCaptured = 0;
  let timedOut = false;
  let forceTimer = null;
  const terminationTasks = [];
  let child;

  try {
    await unlink(resultPath).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
    child = spawnProcess(executable, args, {
      cwd,
      env: sanitizeCodexEnvironment(baseEnv),
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdoutTask = (async () => {
      const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
      for await (const line of lines) {
        await eventsHandle.write(`${line}\n`);
        if (eventError) continue;
        try {
          accumulator.accept(parseCodexEventLine(line));
        } catch (error) {
          eventError = error;
        }
      }
    })();
    const stderrTask = (async () => {
      for await (const chunk of child.stderr) {
        if (stderrCaptured >= MAX_STDERR_BYTES * 2) continue;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const remaining = (MAX_STDERR_BYTES * 2) - stderrCaptured;
        stderrChunks.push(buffer.subarray(0, remaining));
        stderrCaptured += Math.min(buffer.length, remaining);
      }
    })();

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      terminationTasks.push(terminateProcessTree(child, 'SIGTERM'));
      forceTimer = setTimeout(() => {
        terminationTasks.push(terminateProcessTree(child, 'SIGKILL'));
      }, killGraceMs);
    }, timeoutMs);
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);

    const closed = await waitForClose(child);
    clearTimeout(timeoutTimer);
    if (forceTimer) clearTimeout(forceTimer);
    await Promise.all([stdoutTask, stderrTask]);
    await Promise.all(terminationTasks);

    const stderr = redactStderr(Buffer.concat(stderrChunks).toString('utf8'), secretValues);
    await stderrHandle.write(stderr);
    await Promise.all([eventsHandle.sync(), stderrHandle.sync()]);
    const parsedResult = await readBoundedJson(resultPath);
    if (parsedResult.bytes) {
      await writeFile(artifacts.result, parsedResult.bytes, {
        flag: 'wx',
        mode: 0o600,
      });
    }
    const events = accumulator.snapshot();

    let code = 'CODEX_COMPLETED';
    if (timedOut) code = 'CODEX_TIMEOUT';
    else if (closed.spawnError) code = 'CODEX_SPAWN_FAILED';
    else if (eventError) code = 'CODEX_EVENT_STREAM_INVALID';
    else if (closed.exitCode !== 0) code = 'CODEX_PROCESS_FAILED';
    else if (!parsedResult.valid) code = 'CODEX_RESULT_INVALID';
    else if (events.terminal_event !== 'turn.completed') code = 'CODEX_TURN_FAILED';

    const response = {
      ok: code === 'CODEX_COMPLETED',
      code,
      exit_code: closed.exitCode,
      signal: closed.signal,
      timed_out: timedOut,
      valid_json_result: parsedResult.valid,
      result: parsedResult.value,
      events,
      artifacts,
    };
    await writeFile(artifacts.status, `${JSON.stringify({ ...response, result: undefined })}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    return response;
  } finally {
    if (forceTimer) clearTimeout(forceTimer);
    await Promise.all([
      eventsHandle.close().catch(() => {}),
      stderrHandle.close().catch(() => {}),
    ]);
  }
}

export function shouldRetryCodexAttempt({ code, validJsonResult, valid_json_result: validJsonResultWire } = {}) {
  const hasValidResult = validJsonResult === true || validJsonResultWire === true;
  return !hasValidResult && RETRYABLE_CODES.has(code);
}

export async function runCodexAttempt({
  jobId,
  jobsRoot = '/data/jobs',
  runnerRoot = '/app',
  attempt = 1,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  killGraceMs = DEFAULT_KILL_GRACE_MS,
  secretValues = [],
} = {}) {
  const options = arguments[0] ?? {};
  assertNoUnsupportedOptions(options, new Set([
    'jobId',
    'jobsRoot',
    'runnerRoot',
    'attempt',
    'timeoutMs',
    'killGraceMs',
    'secretValues',
  ]));
  const command = buildCodexCommand({ jobId, jobsRoot, runnerRoot });
  const prompt = await readFile(command.promptPath, 'utf8');
  const auditDirectory = path.posix.join(jobsRoot, jobId, 'audit');
  return executeCodexCommand({
    auditDirectory,
    attempt,
    timeoutMs,
    killGraceMs,
    secretValues,
    ...command,
    prompt,
  });
}
