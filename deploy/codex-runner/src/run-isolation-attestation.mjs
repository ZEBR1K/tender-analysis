#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  executeCodexCommand,
  removeStagedCodexHome,
  stageCodexHome,
} from './codex-command.mjs';
import { config } from './config.mjs';
import {
  buildIsolationAttestationRecord,
  buildIsolationCanaryCommand,
  buildRunnerExecutionProfile,
  persistIsolationAttestation,
  executionProfileSha256,
  PINNED_CODEX_CLI_VERSION,
} from './runtime-attestation.mjs';

const CANARY_TIMEOUT_MS = 10 * 60 * 1000;
const HEALTH_TIMEOUT_MS = 5 * 1000;
const MAX_HEALTH_BYTES = 128 * 1024;
const PROBE_PROMPT = [
  'Run exactly this one command once:',
  'node ../input/isolation-probe.mjs',
  'Do not run any other command.',
  'After it finishes, return exactly this JSON object: {"canary_complete":true}',
].join('\n');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

function exactJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function canaryPaths({ rootDirectory, containerJobsRoot, challengeId, jobId, siblingJobId }) {
  const hostJobsRoot = path.join(
    rootDirectory,
    '.runner-isolation',
    'canaries',
    challengeId,
    'jobs',
  );
  const containerCanaryJobsRoot = path.posix.join(
    containerJobsRoot,
    '.runner-isolation',
    'canaries',
    challengeId,
    'jobs',
  );
  return {
    hostJobsRoot,
    containerCanaryJobsRoot,
    protectedJobsRoot: containerJobsRoot,
    currentJob: path.join(hostJobsRoot, jobId),
    containerCurrentJob: path.posix.join(containerCanaryJobsRoot, jobId),
    currentInput: path.join(hostJobsRoot, jobId, 'input'),
    currentWorkspace: path.join(hostJobsRoot, jobId, 'workspace'),
    currentAudit: path.join(hostJobsRoot, jobId, 'audit'),
    siblingInput: path.join(hostJobsRoot, siblingJobId, 'input'),
  };
}

async function assertRegularFile(filePath) {
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('Required isolation target is not a regular file');
  }
}

async function assertDirectory(directory) {
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('Required isolation target is not a directory');
  }
}

async function defaultVerifyProtectedTargets({ containerJobsRoot, codexAuthFile }) {
  await Promise.all([
    assertDirectory(containerJobsRoot),
    assertDirectory('/tmp'),
    assertRegularFile(codexAuthFile),
    assertRegularFile('/run/secrets/runner-auth-token'),
    assertRegularFile('/proc/self/environ'),
    assertRegularFile('/proc/1/environ'),
  ]);
}

function defaultProbeCodexVersion() {
  return new Promise((resolve, reject) => {
    execFile('codex', ['--version'], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024,
      timeout: HEALTH_TIMEOUT_MS,
      windowsHide: true,
    }, (error, stdout) => {
      if (error) reject(new Error('Pinned Codex CLI version probe failed'));
      else resolve(String(stdout).trim());
    });
  });
}

async function fetchHealth({ runnerBaseUrl, fetchImpl }) {
  const url = new URL('/health', runnerBaseUrl);
  if (
    url.protocol !== 'http:'
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username
    || url.password
  ) throw new Error('Runner health URL must be local HTTP');
  const response = await fetchImpl(url, {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok || Buffer.byteLength(text, 'utf8') > MAX_HEALTH_BYTES) {
    throw new Error('Runner health is unavailable');
  }
  let health;
  try {
    health = JSON.parse(text);
  } catch {
    throw new Error('Runner health is invalid');
  }
  return health;
}

function challengeFromHealth(health) {
  const challenge = health?.isolation_attestation;
  if (
    health?.schema_version !== 'tender_codex_runner_health_v1'
    || health.status !== 'ready'
    || challenge?.schema_version !== 'tender_codex_runner_isolation_challenge_v1'
    || !UUID_PATTERN.test(challenge.challenge_id || '')
  ) throw new Error('Runner isolation challenge is unavailable');
  return challenge;
}

async function stageProbe({ paths, runnerRoot, challenge, jobId, siblingJobId }) {
  await Promise.all([
    mkdir(paths.currentInput, { recursive: true, mode: 0o700 }),
    mkdir(path.join(paths.currentWorkspace, '.tmp'), { recursive: true, mode: 0o700 }),
    mkdir(path.join(paths.currentWorkspace, 'output'), { recursive: true, mode: 0o700 }),
    mkdir(paths.currentAudit, { recursive: true, mode: 0o700 }),
    mkdir(paths.siblingInput, { recursive: true, mode: 0o700 }),
  ]);
  const probeSourcePath = path.join(runnerRoot, 'probes', 'isolation-probe.mjs');
  await assertRegularFile(probeSourcePath);
  const probeSource = await readFile(probeSourcePath);
  if (digest(probeSource) !== challenge.probe_script_sha256) {
    throw new Error('Isolation probe image hash mismatch');
  }
  const currentMarker = randomBytes(32);
  const plan = {
    schema_version: 'tender_codex_runner_isolation_probe_plan_v1',
    challenge_id: challenge.challenge_id,
    job_id: jobId,
    sibling_job_id: siblingJobId,
    jobs_root: paths.containerCanaryJobsRoot,
    protected_jobs_root: paths.protectedJobsRoot,
    current_marker_sha256: digest(currentMarker),
    probe_script_sha256: challenge.probe_script_sha256,
  };
  await Promise.all([
    writeFile(path.join(paths.currentInput, 'isolation-probe.mjs'), probeSource, {
      flag: 'wx',
      mode: 0o400,
    }),
    writeFile(path.join(paths.currentInput, 'isolation-probe-plan.json'), `${JSON.stringify(plan)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o400,
    }),
    writeFile(path.join(paths.currentInput, 'current-readable.txt'), currentMarker, {
      flag: 'wx',
      mode: 0o400,
    }),
    writeFile(path.join(paths.siblingInput, 'sibling-readable.txt'), randomBytes(32), {
      flag: 'wx',
      mode: 0o400,
    }),
  ]);
  await chmod(paths.currentInput, 0o500);
}

export async function runIsolationAttestation({
  rootDirectory,
  runnerRoot = '/app',
  containerJobsRoot = '/data/jobs',
  runnerBaseUrl = 'http://127.0.0.1:8080',
  fetchImpl = fetch,
  platform = process.platform,
  jobIds = [randomUUID(), randomUUID()],
  now = () => new Date(),
  verifyProtectedTargets = defaultVerifyProtectedTargets,
  probeCodexVersion = defaultProbeCodexVersion,
  executeCommand = executeCodexCommand,
  baseEnv = process.env,
  secretValues = [],
  codexAuthFile = '/run/codex-auth/auth.json',
} = {}) {
  if (platform !== 'linux') throw new Error('Isolation attestation is Linux-only');
  if (
    typeof rootDirectory !== 'string'
    || !Array.isArray(jobIds)
    || jobIds.length !== 2
    || !jobIds.every((id) => UUID_PATTERN.test(id))
    || jobIds[0] === jobIds[1]
  ) throw new Error('Isolation attestation configuration is invalid');

  const initialHealth = await fetchHealth({ runnerBaseUrl, fetchImpl });
  const publicChallenge = challengeFromHealth(initialHealth);
  if (
    initialHealth.readiness?.isolation_canary === true
    || initialHealth.readiness?.execute === true
    || initialHealth.queue?.active !== 0
    || initialHealth.queue?.queued !== 0
  ) throw new Error('Runner is not idle and awaiting isolation attestation');
  const executionProfile = await buildRunnerExecutionProfile({ runnerRoot });
  if (
    !exactJson(initialHealth.execution_profile, executionProfile)
    || publicChallenge.execution_profile_sha256 !== executionProfileSha256(executionProfile)
    || initialHealth.tools?.codex !== `codex-cli ${PINNED_CODEX_CLI_VERSION}`
    || await probeCodexVersion() !== `codex-cli ${PINNED_CODEX_CLI_VERSION}`
  ) throw new Error('Runner execution profile does not match the image runtime');

  const challenge = {
    ...publicChallenge,
    execution_profile: executionProfile,
  };
  const [jobId, siblingJobId] = jobIds;
  const paths = canaryPaths({
    rootDirectory,
    containerJobsRoot,
    challengeId: challenge.challenge_id,
    jobId,
    siblingJobId,
  });
  await verifyProtectedTargets({ containerJobsRoot, codexAuthFile });
  await stageProbe({ paths, runnerRoot, challenge, jobId, siblingJobId });

  const command = buildIsolationCanaryCommand({
    jobId,
    jobsRoot: paths.containerCanaryJobsRoot,
  });
  const startedAt = now();
  await stageCodexHome({ jobDirectory: paths.currentJob, codexAuthFile });
  let execution;
  try {
    execution = await executeCommand({
      ...command,
      prompt: PROBE_PROMPT,
      auditDirectory: paths.currentAudit,
      attempt: 1,
      timeoutMs: CANARY_TIMEOUT_MS,
      killGraceMs: 30 * 1000,
      baseEnv: {
        ...baseEnv,
        CODEX_HOME: path.posix.join(paths.containerCurrentJob, 'codex-home'),
      },
      secretValues,
    });
  } finally {
    await removeStagedCodexHome({ jobDirectory: paths.currentJob });
  }
  const completedAt = now();
  const expectedEventPath = path.join(paths.currentAudit, 'codex-events.attempt-1.jsonl');
  if (
    execution?.ok !== true
    || execution.code !== 'CODEX_COMPLETED'
    || path.resolve(execution.artifacts?.events || '') !== path.resolve(expectedEventPath)
  ) throw new Error('Isolation canary execution failed');
  const eventLogBytes = await readFile(expectedEventPath);
  const record = await buildIsolationAttestationRecord({
    challenge,
    jobId,
    siblingJobId,
    eventLogBytes,
    startedAt,
    completedAt,
    containerJobsRoot,
  });
  await persistIsolationAttestation({ rootDirectory, record });

  const finalHealth = await fetchHealth({ runnerBaseUrl, fetchImpl });
  const finalChallenge = challengeFromHealth(finalHealth);
  if (
    finalChallenge.challenge_id !== challenge.challenge_id
    || finalHealth.readiness?.isolation_canary !== true
    || finalHealth.readiness?.execute !== true
  ) throw new Error('Runner did not accept the isolation attestation');
  return {
    schema_version: 'tender_codex_runner_isolation_attestation_result_v1',
    attested: true,
    challenge_id: challenge.challenge_id,
  };
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  runIsolationAttestation({
    rootDirectory: config.rootDirectory,
    runnerRoot: '/app',
    containerJobsRoot: '/data/jobs',
    runnerBaseUrl: `http://127.0.0.1:${config.port}`,
    codexAuthFile: config.codexAuthFile,
    secretValues: [config.authToken],
  }).then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch(() => {
    process.stderr.write(`${JSON.stringify({
      schema_version: 'tender_codex_runner_isolation_attestation_result_v1',
      attested: false,
      code: 'ISOLATION_ATTESTATION_FAILED',
    })}\n`);
    process.exitCode = 1;
  });
}
