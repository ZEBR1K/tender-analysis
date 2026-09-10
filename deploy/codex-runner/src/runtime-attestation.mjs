import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  chmod,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';

import {
  buildCodexPermissionBoundary,
  buildIsolationNegativeCanary,
} from './permissions.mjs';

export const PINNED_CODEX_MODEL = 'gpt-5.6-sol';
export const PINNED_REASONING_EFFORT = 'high';
export const PINNED_CODEX_CLI_VERSION = '0.153.4';

const EXECUTION_PROFILE_FILES = Object.freeze([
  ['field_catalog_sha256', 'field-catalog/FIELD_CATALOG.md'],
  ['prompt_sha256', 'prompts/tender-analysis-v1.txt'],
  ['skill_sha256', 'agent-template/.agents/skills/tender-document-analysis/SKILL.md'],
  ['result_schema_sha256', 'schemas/tender-agent-result-v1.schema.json'],
]);
const PROBE_COMMAND = 'node ../input/isolation-probe.mjs';
export const ISOLATION_PROBE_IDS = Object.freeze([
  'current_input',
  'workspace',
  'current_input_write',
  'sibling_job',
  'jobs_parent',
  'codex_auth',
  'job_codex_auth',
  'runner_secret',
  'slash_tmp',
  'self_process_environment',
  'parent_process_environment',
  'credential_environment',
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[0-9a-f]{64}$/iu;
const MAX_ATTESTATION_BYTES = 64 * 1024;
const MAX_CANARY_DURATION_MS = 10 * 60 * 1000;
const MAX_ATTESTATION_AGE_MS = 24 * 60 * 60 * 1000;

async function sha256RegularFile(filePath) {
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('Runner execution-profile artifact must be a regular image file');
  }
  return createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex')
    .toUpperCase();
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(
    (key) => [key, canonicalValue(value[key])],
  ));
}

function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function sha256Json(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex').toUpperCase();
}

export function executionProfileSha256(profile) {
  return sha256Json(profile);
}

function canaryPaths({ rootDirectory, containerJobsRoot, challengeId, jobId }) {
  const relative = path.join('.runner-isolation', 'canaries', challengeId, 'jobs');
  return {
    hostJobsRoot: path.join(rootDirectory, relative),
    containerJobsRoot: path.posix.join(
      containerJobsRoot,
      '.runner-isolation',
      'canaries',
      challengeId,
      'jobs',
    ),
    eventLogPath: path.join(
      rootDirectory,
      relative,
      jobId,
      'audit',
      'codex-events.attempt-1.jsonl',
    ),
  };
}

export async function buildRunnerExecutionProfile({ runnerRoot = '/app' } = {}) {
  const hashes = {};
  for (const [key, relativePath] of EXECUTION_PROFILE_FILES) {
    hashes[key] = await sha256RegularFile(path.resolve(runnerRoot, relativePath));
  }
  return Object.freeze({
    schema_version: 'tender_codex_runner_execution_profile_v1',
    model: PINNED_CODEX_MODEL,
    reasoning_effort: PINNED_REASONING_EFFORT,
    codex_cli_version: PINNED_CODEX_CLI_VERSION,
    ...hashes,
  });
}

export function buildIsolationCanaryCommand({ jobId, jobsRoot } = {}) {
  const boundary = buildCodexPermissionBoundary({ jobId, jobsRoot });
  const resultPath = path.posix.join(
    boundary.workspaceDirectory,
    'output',
    'isolation-canary-result.json',
  );
  return Object.freeze({
    executable: 'codex',
    args: Object.freeze([
      'exec',
      ...boundary.cliArgs,
      '--ephemeral',
      '--ignore-rules',
      '--model',
      PINNED_CODEX_MODEL,
      '-c',
      `model_reasoning_effort=${JSON.stringify(PINNED_REASONING_EFFORT)}`,
      '-c',
      'tools.web_search=false',
      '-C',
      boundary.workspaceDirectory,
      '--skip-git-repo-check',
      '--json',
      '-o',
      resultPath,
      '-',
    ]),
    cwd: boundary.workspaceDirectory,
    resultPath,
    probeCommand: PROBE_COMMAND,
    shell: false,
  });
}

function runtimeContract({ jobId, siblingJobId, jobsRoot, protectedJobsRoot }) {
  const command = buildIsolationCanaryCommand({ jobId, jobsRoot });
  const probeSet = buildIsolationNegativeCanary({
    jobId,
    siblingJobId,
    jobsRoot,
    protectedJobsRoot,
  });
  return {
    runtime_contract_sha256: sha256Json({
      schema_version: 'tender_codex_runner_isolation_command_contract_v1',
      executable: command.executable,
      args: command.args,
      cwd: command.cwd,
      result_path: command.resultPath,
      probe_command: command.probeCommand,
      shell: command.shell,
      probes: probeSet.probes,
    }),
    probe_set_sha256: sha256Json(probeSet.probes),
  };
}

function exactKeys(value, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

export function validateIsolationEvidence({
  jsonl,
  challengeId,
  jobId,
  siblingJobId,
  probeScriptSha256,
  probeCommand = PROBE_COMMAND,
} = {}) {
  const fail = (code) => ({ verified: false, code });
  const source = Buffer.isBuffer(jsonl) ? jsonl.toString('utf8') : String(jsonl || '');
  if (Buffer.byteLength(source, 'utf8') > 2 * 1024 * 1024) return fail('EVENT_LOG_TOO_LARGE');
  let events;
  try {
    events = source.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return fail('EVENT_LOG_INVALID');
  }
  const commandEvents = events.filter((event) => event?.item?.type === 'command_execution');
  const completedCommands = commandEvents.filter((event) => event.type === 'item.completed');
  const startedCommands = commandEvents.filter((event) => event.type === 'item.started');
  if (
    completedCommands.length !== 1
    || commandEvents.length > 2
    || startedCommands.length !== commandEvents.length - 1
    || commandEvents.some((event) => !['item.started', 'item.completed'].includes(event.type))
    || commandEvents.some((event) => typeof event.item.id !== 'string' || !event.item.id)
    || new Set(commandEvents.map((event) => event.item.id)).size !== 1
  ) return fail('COMMAND_EVIDENCE_AMBIGUOUS');
  const command = completedCommands[0].item;
  const acceptedCommands = new Set([
    probeCommand,
    `/bin/bash -lc '${probeCommand}'`,
    `/usr/bin/bash -lc '${probeCommand}'`,
    `/bin/sh -lc '${probeCommand}'`,
  ]);
  if (
    !acceptedCommands.has(command.command)
    || commandEvents.some((event) => event.item.command !== command.command)
    || startedCommands.some((event) => (
      event.item.exit_code !== null
      || event.item.status !== 'in_progress'
      || event.item.aggregated_output !== ''
    ))
    || command.exit_code !== 0
    || command.status !== 'completed'
  ) return fail('PROBE_COMMAND_FAILED');
  const terminalEvents = events.filter((event) => event?.type === 'turn.completed');
  if (
    terminalEvents.length !== 1
    || events.indexOf(terminalEvents[0]) < events.indexOf(completedCommands[0])
  ) {
    return fail('TERMINAL_EVIDENCE_INVALID');
  }
  const outputLines = String(command.aggregated_output || '').split(/\r?\n/u).filter(Boolean);
  if (outputLines.length !== 1) return fail('PROBE_SENTINEL_AMBIGUOUS');
  let output;
  try {
    output = JSON.parse(outputLines[0]);
  } catch {
    return fail('PROBE_SENTINEL_INVALID');
  }
  if (!exactKeys(output, [
    'schema_version',
    'challenge_id',
    'job_id',
    'sibling_job_id',
    'probe_script_sha256',
    'probes',
  ])) return fail('PROBE_SENTINEL_INVALID');
  if (
    output.schema_version !== 'tender_codex_runner_isolation_probe_v1'
    || output.challenge_id !== challengeId
    || output.job_id !== jobId
    || output.sibling_job_id !== siblingJobId
    || output.probe_script_sha256 !== probeScriptSha256
    || !Array.isArray(output.probes)
    || output.probes.length !== ISOLATION_PROBE_IDS.length
  ) return fail('PROBE_SENTINEL_MISMATCH');
  for (const [index, probe] of output.probes.entries()) {
    if (
      !exactKeys(probe, ['id', 'passed'])
      || probe.id !== ISOLATION_PROBE_IDS[index]
      || probe.passed !== true
    ) return fail('PROBE_FAILED');
  }
  return {
    verified: true,
    code: 'ISOLATION_ATTESTED',
    event_log_sha256: createHash('sha256').update(source, 'utf8').digest('hex').toUpperCase(),
    probe_output_sha256: createHash('sha256')
      .update(outputLines[0], 'utf8')
      .digest('hex')
      .toUpperCase(),
  };
}

async function defaultContainerIdentitySha256() {
  const parts = await Promise.all([
    readFile('/etc/hostname'),
    readFile('/proc/self/cgroup'),
    readFile('/proc/sys/kernel/random/boot_id'),
  ]);
  return createHash('sha256').update(Buffer.concat(parts)).digest('hex').toUpperCase();
}

async function readBoundedRegularFile(filePath, maxBytes) {
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > maxBytes) {
    throw new Error('Attestation artifact is not a bounded regular file');
  }
  return readFile(filePath);
}

function validIsoDate(value) {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function recordShapeValid(record) {
  return exactKeys(record, [
    'schema_version',
    'challenge_id',
    'container_identity_sha256',
    'execution_profile_sha256',
    'probe_script_sha256',
    'runtime_contract_sha256',
    'probe_set_sha256',
    'codex_cli_version',
    'job_id',
    'sibling_job_id',
    'started_at',
    'completed_at',
    'event_log_sha256',
    'probe_output_sha256',
  ])
    && record.schema_version === 'tender_codex_runner_isolation_attestation_v1'
    && UUID_PATTERN.test(record.challenge_id)
    && UUID_PATTERN.test(record.job_id)
    && UUID_PATTERN.test(record.sibling_job_id)
    && record.job_id !== record.sibling_job_id
    && [
      'container_identity_sha256',
      'execution_profile_sha256',
      'probe_script_sha256',
      'runtime_contract_sha256',
      'probe_set_sha256',
      'event_log_sha256',
      'probe_output_sha256',
    ].every((key) => SHA256_PATTERN.test(record[key]))
    && record.codex_cli_version === PINNED_CODEX_CLI_VERSION
    && validIsoDate(record.started_at)
    && validIsoDate(record.completed_at);
}

export async function buildIsolationAttestationRecord({
  challenge,
  jobId,
  siblingJobId,
  eventLogBytes,
  startedAt,
  completedAt,
  containerJobsRoot = '/data/jobs',
} = {}) {
  if (
    challenge?.schema_version !== 'tender_codex_runner_isolation_challenge_v1'
    || !UUID_PATTERN.test(jobId || '')
    || !UUID_PATTERN.test(siblingJobId || '')
    || !(startedAt instanceof Date)
    || Number.isNaN(startedAt.getTime())
    || !(completedAt instanceof Date)
    || Number.isNaN(completedAt.getTime())
    || completedAt < startedAt
    || completedAt.getTime() - startedAt.getTime() > MAX_CANARY_DURATION_MS
  ) throw new Error('Isolation attestation inputs are invalid');
  const paths = canaryPaths({
    rootDirectory: '.',
    containerJobsRoot,
    challengeId: challenge.challenge_id,
    jobId,
  });
  const evidence = validateIsolationEvidence({
    jsonl: eventLogBytes,
    challengeId: challenge.challenge_id,
    jobId,
    siblingJobId,
    probeScriptSha256: challenge.probe_script_sha256,
  });
  if (!evidence.verified) throw new Error(`Isolation evidence failed: ${evidence.code}`);
  const contract = runtimeContract({
    jobId,
    siblingJobId,
    jobsRoot: paths.containerJobsRoot,
    protectedJobsRoot: containerJobsRoot,
  });
  return {
    schema_version: 'tender_codex_runner_isolation_attestation_v1',
    challenge_id: challenge.challenge_id,
    container_identity_sha256: challenge.container_identity_sha256,
    execution_profile_sha256: challenge.execution_profile_sha256,
    probe_script_sha256: challenge.probe_script_sha256,
    ...contract,
    codex_cli_version: PINNED_CODEX_CLI_VERSION,
    job_id: jobId,
    sibling_job_id: siblingJobId,
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    event_log_sha256: evidence.event_log_sha256,
    probe_output_sha256: evidence.probe_output_sha256,
  };
}

async function ensurePrivateDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('Runner attestation directory is invalid');
  }
}

export async function persistIsolationAttestation({ rootDirectory, record } = {}) {
  if (typeof rootDirectory !== 'string' || !recordShapeValid(record)) {
    throw new Error('Isolation attestation record is invalid');
  }
  const directory = path.join(rootDirectory, '.runner-isolation', 'attestations');
  await ensurePrivateDirectory(directory);
  const target = path.join(directory, `${record.challenge_id}.json`);
  const temporary = path.join(directory, `.write-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, target);
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
  }
  return target;
}

export function createRuntimeAttestationGate({
  rootDirectory,
  runnerRoot = '/app',
  containerJobsRoot = '/data/jobs',
  challengeId = randomUUID(),
  containerIdentitySha256,
  now = () => new Date(),
} = {}) {
  if (typeof rootDirectory !== 'string' || !UUID_PATTERN.test(challengeId)) {
    throw new Error('Runtime attestation gate configuration is invalid');
  }
  const createdAt = now();
  if (!(createdAt instanceof Date) || Number.isNaN(createdAt.getTime())) {
    throw new Error('Runtime attestation clock is invalid');
  }
  const attestationPath = path.join(
    rootDirectory,
    '.runner-isolation',
    'attestations',
    `${challengeId}.json`,
  );
  let challengePromise;
  const getChallenge = () => {
    challengePromise ??= (async () => {
    const executionProfile = await buildRunnerExecutionProfile({ runnerRoot });
    const identity = containerIdentitySha256 ?? await defaultContainerIdentitySha256();
    if (!SHA256_PATTERN.test(identity)) throw new Error('Container identity is unavailable');
    return Object.freeze({
      schema_version: 'tender_codex_runner_isolation_challenge_v1',
      challenge_id: challengeId,
      created_at: createdAt.toISOString(),
      container_identity_sha256: identity.toUpperCase(),
      execution_profile: executionProfile,
      execution_profile_sha256: sha256Json(executionProfile),
      probe_script_sha256: await sha256RegularFile(path.join(
        runnerRoot,
        'probes',
        'isolation-probe.mjs',
      )),
    });
    })();
    return challengePromise;
  };

  async function verify() {
    try {
      const challenge = await getChallenge();
      const bytes = await readBoundedRegularFile(attestationPath, MAX_ATTESTATION_BYTES);
      const record = JSON.parse(bytes.toString('utf8'));
      if (!recordShapeValid(record)) return { verified: false, code: 'ATTESTATION_INVALID' };
      const started = Date.parse(record.started_at);
      const completed = Date.parse(record.completed_at);
      const checkedAt = now();
      if (!(checkedAt instanceof Date) || Number.isNaN(checkedAt.getTime())) {
        return { verified: false, code: 'ATTESTATION_CLOCK_INVALID' };
      }
      if (
        record.challenge_id !== challenge.challenge_id
        || record.container_identity_sha256 !== challenge.container_identity_sha256
        || record.execution_profile_sha256 !== challenge.execution_profile_sha256
        || record.probe_script_sha256 !== challenge.probe_script_sha256
        || started < Date.parse(challenge.created_at)
        || completed < started
        || completed - started > MAX_CANARY_DURATION_MS
        || completed > checkedAt.getTime()
        || checkedAt.getTime() - completed > MAX_ATTESTATION_AGE_MS
      ) return { verified: false, code: 'ATTESTATION_MISMATCH' };
      const paths = canaryPaths({
        rootDirectory,
        containerJobsRoot,
        challengeId,
        jobId: record.job_id,
      });
      const contract = runtimeContract({
        jobId: record.job_id,
        siblingJobId: record.sibling_job_id,
        jobsRoot: paths.containerJobsRoot,
        protectedJobsRoot: containerJobsRoot,
      });
      if (
        record.runtime_contract_sha256 !== contract.runtime_contract_sha256
        || record.probe_set_sha256 !== contract.probe_set_sha256
      ) return { verified: false, code: 'ATTESTATION_CONTRACT_MISMATCH' };
      const eventLog = await readBoundedRegularFile(paths.eventLogPath, 2 * 1024 * 1024);
      const evidence = validateIsolationEvidence({
        jsonl: eventLog,
        challengeId,
        jobId: record.job_id,
        siblingJobId: record.sibling_job_id,
        probeScriptSha256: challenge.probe_script_sha256,
      });
      if (
        !evidence.verified
        || record.event_log_sha256 !== evidence.event_log_sha256
        || record.probe_output_sha256 !== evidence.probe_output_sha256
      ) return { verified: false, code: 'ATTESTATION_EVIDENCE_MISMATCH' };
      return { verified: true, code: 'ISOLATION_ATTESTED' };
    } catch {
      return { verified: false, code: 'ATTESTATION_UNAVAILABLE' };
    }
  }

  return Object.freeze({
    attestationPath,
    getChallenge,
    verify,
  });
}
