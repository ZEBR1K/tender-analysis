import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';

import { createCodexEventAccumulator, parseCodexEventLine } from './codex-events.mjs';
import { AGENT_TEMPLATE_FILES, agentTemplatePath } from './agent-template.mjs';
import { prepareOfficeRuntime, removeOfficeRuntime } from './office-runtime.mjs';
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
const NON_SECRET_AUDIT_COUNTER_KEYS = new Set([
  'input_tokens',
  'cached_input_tokens',
  'output_tokens',
  'reasoning_output_tokens',
]);

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
  let redacted = redactSecretText(value, secretValues);
  const bytes = Buffer.from(redacted, 'utf8');
  if (bytes.length <= MAX_STDERR_BYTES) return bytes;
  return Buffer.concat([
    bytes.subarray(0, MAX_STDERR_BYTES - 20),
    Buffer.from('\n[stderr truncated]\n', 'utf8'),
  ]).subarray(0, MAX_STDERR_BYTES);
}

function redactSecretText(value, secretValues = []) {
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
  return redacted;
}

function redactEventValue(value, secretValues, key = '') {
  if (
    /(?:KEY|SECRET|TOKEN|PASSWORD)/iu.test(key)
    && !NON_SECRET_AUDIT_COUNTER_KEYS.has(key)
  ) return '[REDACTED]';
  if (typeof value === 'string') return redactSecretText(value, secretValues);
  if (Array.isArray(value)) {
    return value.map((entry) => redactEventValue(entry, secretValues));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      redactEventValue(entryValue, secretValues, entryKey),
    ]));
  }
  return value;
}

function sanitizedEventAuditLine(line, secretValues) {
  try {
    return JSON.stringify(redactEventValue(JSON.parse(line), secretValues));
  } catch {
    return JSON.stringify({
      type: 'runner.invalid_stdout',
      byte_size: Buffer.byteLength(line),
      sha256: createHash('sha256').update(line).digest('hex').toUpperCase(),
    });
  }
}

async function readBoundedJson(filePath) {
  try {
    const metadata = await stat(filePath);
    if (!metadata.isFile() || metadata.size > MAX_RESULT_BYTES) {
      return { valid: false, value: null, bytes: null };
    }
    const bytes = await readFile(filePath);
    try {
      const value = JSON.parse(bytes.toString('utf8'));
      return {
        valid: value !== null && typeof value === 'object' && !Array.isArray(value),
        value,
        bytes,
      };
    } catch {
      return { valid: false, value: null, bytes };
    }
  } catch {
    return { valid: false, value: null, bytes: null };
  }
}

async function ensureRegularDirectory(directory) {
  await mkdir(directory, { mode: 0o700 }).catch((error) => {
    if (error?.code !== 'EEXIST') throw error;
  });
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('Trusted agent instruction directory is invalid');
  }
}

async function copyExactTrustedFile(sourcePath, targetPath) {
  const sourceMetadata = await lstat(sourcePath);
  if (!sourceMetadata.isFile() || sourceMetadata.isSymbolicLink()) {
    throw new Error('Trusted agent instruction source is invalid');
  }
  const expected = await readFile(sourcePath);
  const targetMetadata = await lstat(targetPath).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (!targetMetadata) {
    await writeFile(targetPath, expected, { flag: 'wx', mode: 0o400 });
    return;
  }
  if (!targetMetadata.isFile() || targetMetadata.isSymbolicLink()) {
    throw new Error('Trusted agent instruction target is invalid');
  }
  const actual = await readFile(targetPath);
  if (!actual.equals(expected)) {
    throw new Error('Trusted agent instruction changed in the job workspace');
  }
}

export async function stageAgentTemplate({ workspaceDirectory, templateDirectory } = {}) {
  if (typeof workspaceDirectory !== 'string' || typeof templateDirectory !== 'string') {
    throw new TypeError('workspaceDirectory and templateDirectory are required');
  }
  await ensureRegularDirectory(workspaceDirectory);
  await ensureRegularDirectory(templateDirectory);
  const jobDirectory = path.dirname(workspaceDirectory);
  await ensureRegularDirectory(jobDirectory);
  await ensureRegularDirectory(path.join(workspaceDirectory, 'output'));
  await ensureRegularDirectory(path.join(workspaceDirectory, '.tmp'));
  await ensureRegularDirectory(path.join(jobDirectory, 'audit'));
  const agentsDirectory = path.join(workspaceDirectory, '.agents');
  const skillsDirectory = path.join(agentsDirectory, 'skills');
  const skillDirectory = path.join(skillsDirectory, 'tender-document-analysis');
  await ensureRegularDirectory(agentsDirectory);
  await ensureRegularDirectory(skillsDirectory);
  await ensureRegularDirectory(skillDirectory);
  await ensureRegularDirectory(path.join(skillDirectory, 'references'));
  await ensureRegularDirectory(path.join(skillDirectory, 'scripts'));
  for (const relativePath of AGENT_TEMPLATE_FILES) {
    await copyExactTrustedFile(
      agentTemplatePath(templateDirectory, relativePath),
      agentTemplatePath(workspaceDirectory, relativePath),
    );
  }
}

function codexHomePath(jobDirectory) {
  const normalizedJobDirectory = path.resolve(jobDirectory);
  const target = path.resolve(normalizedJobDirectory, 'codex-home');
  if (path.dirname(target) !== normalizedJobDirectory) {
    throw new Error('Job-local Codex home escaped its job directory');
  }
  return target;
}

export async function removeStagedCodexHome({ jobDirectory } = {}) {
  if (typeof jobDirectory !== 'string' || jobDirectory.length === 0) {
    throw new TypeError('jobDirectory is required');
  }
  const target = codexHomePath(jobDirectory);
  const metadata = await lstat(target).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (!metadata) return;
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('Job-local Codex home is invalid');
  }
  await rm(target, { recursive: true, force: false });
}

export async function stageCodexHome({ jobDirectory, codexAuthFile } = {}) {
  if (
    typeof jobDirectory !== 'string'
    || jobDirectory.length === 0
    || typeof codexAuthFile !== 'string'
    || codexAuthFile.length === 0
  ) throw new TypeError('jobDirectory and codexAuthFile are required');

  await ensureRegularDirectory(jobDirectory);
  const sourceMetadata = await lstat(codexAuthFile);
  if (!sourceMetadata.isFile() || sourceMetadata.isSymbolicLink()) {
    throw new Error('Mounted Codex auth source is invalid');
  }
  const authBytes = await readFile(codexAuthFile);
  const target = codexHomePath(jobDirectory);
  await removeStagedCodexHome({ jobDirectory });
  await mkdir(target, { mode: 0o700 });
  await chmod(target, 0o700);
  try {
    const stagedAuthFile = path.join(target, 'auth.json');
    await writeFile(stagedAuthFile, authBytes, { flag: 'wx', mode: 0o600 });
    await chmod(stagedAuthFile, 0o600);
  } catch (error) {
    await removeStagedCodexHome({ jobDirectory }).catch(() => {});
    throw error;
  }
  return target;
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
  let forcedKillCompletion = Promise.resolve();
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
        await eventsHandle.write(`${sanitizedEventAuditLine(line, secretValues)}\n`);
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
      forcedKillCompletion = new Promise((resolve) => {
        forceTimer = setTimeout(async () => {
          const forcedKill = terminateProcessTree(child, 'SIGKILL');
          terminationTasks.push(forcedKill);
          await forcedKill;
          resolve();
        }, killGraceMs);
      });
    }, timeoutMs);
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);

    const closed = await waitForClose(child);
    clearTimeout(timeoutTimer);
    if (timedOut) await forcedKillCompletion;
    else if (forceTimer) clearTimeout(forceTimer);
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
    if (forceTimer && !timedOut) clearTimeout(forceTimer);
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
  codexAuthFile = '/run/codex-auth/auth.json',
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
    'codexAuthFile',
    'attempt',
    'timeoutMs',
    'killGraceMs',
    'secretValues',
  ]));
  const command = buildCodexCommand({ jobId, jobsRoot, runnerRoot });
  await stageAgentTemplate({
    workspaceDirectory: command.cwd,
    templateDirectory: path.posix.join(runnerRoot, 'agent-template'),
  });
  const prompt = await readFile(command.promptPath, 'utf8');
  const jobDirectory = path.posix.join(jobsRoot, jobId);
  const auditDirectory = path.posix.join(jobDirectory, 'audit');
  let codexHome;
  let officeRuntimePrepared = false;
  try {
    codexHome = await stageCodexHome({ jobDirectory, codexAuthFile });
    await prepareOfficeRuntime({ jobId });
    officeRuntimePrepared = true;
    return await executeCodexCommand({
      auditDirectory,
      attempt,
      timeoutMs,
      killGraceMs,
      secretValues,
      baseEnv: { ...process.env, CODEX_HOME: codexHome },
      ...command,
      prompt,
    });
  } finally {
    await Promise.all([
      codexHome ? removeStagedCodexHome({ jobDirectory }) : undefined,
      officeRuntimePrepared ? removeOfficeRuntime({ jobId }) : undefined,
    ]);
  }
}
