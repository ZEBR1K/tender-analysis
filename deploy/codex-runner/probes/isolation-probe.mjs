#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[0-9a-f]{64}$/iu;
const DENIED_CODES = new Set(['EACCES', 'EPERM', 'EROFS']);
const PROBE_IDS = Object.freeze([
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

function assertPlan(plan, cwd) {
  const keys = [
    'schema_version',
    'challenge_id',
    'job_id',
    'sibling_job_id',
    'jobs_root',
    'protected_jobs_root',
    'current_marker_sha256',
    'probe_script_sha256',
  ].sort();
  if (
    plan === null
    || typeof plan !== 'object'
    || Array.isArray(plan)
    || Object.keys(plan).sort().join('\n') !== keys.join('\n')
    || plan.schema_version !== 'tender_codex_runner_isolation_probe_plan_v1'
    || !UUID_PATTERN.test(plan.challenge_id)
    || !UUID_PATTERN.test(plan.job_id)
    || !UUID_PATTERN.test(plan.sibling_job_id)
    || plan.job_id === plan.sibling_job_id
    || !SHA256_PATTERN.test(plan.current_marker_sha256)
    || !SHA256_PATTERN.test(plan.probe_script_sha256)
  ) throw new Error('Isolation probe plan is invalid');
  for (const root of [plan.jobs_root, plan.protected_jobs_root]) {
    if (typeof root !== 'string' || !root.startsWith('/') || path.posix.normalize(root) !== root) {
      throw new Error('Isolation probe root is invalid');
    }
  }
  if (cwd !== path.posix.join(plan.jobs_root, plan.job_id, 'workspace')) {
    throw new Error('Isolation probe workspace does not match its plan');
  }
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

async function denied(task) {
  try {
    await task();
    return false;
  } catch (error) {
    return DENIED_CODES.has(error?.code);
  }
}

export async function runIsolationProbe({
  plan,
  cwd = process.cwd(),
  environment = process.env,
  ppid = process.ppid,
  io = { readFile, readdir, unlink, writeFile },
} = {}) {
  assertPlan(plan, cwd);
  const inputDirectory = path.posix.join(plan.jobs_root, plan.job_id, 'input');
  const workspaceMarker = path.posix.join(cwd, 'isolation-probe-write.tmp');
  const currentInputMarker = path.posix.join(inputDirectory, 'current-readable.txt');
  const probes = [];
  const record = (id, passed) => probes.push({ id, passed: passed === true });

  let currentInputReadable = false;
  try {
    currentInputReadable = digest(await io.readFile(currentInputMarker))
      === plan.current_marker_sha256;
  } catch {}
  record('current_input', currentInputReadable);

  let workspaceWritable = false;
  try {
    await io.writeFile(workspaceMarker, 'workspace\n', { flag: 'wx', mode: 0o600 });
    workspaceWritable = String(await io.readFile(workspaceMarker)) === 'workspace\n';
  } catch {}
  await io.unlink(workspaceMarker).catch(() => {});
  record('workspace', workspaceWritable);

  record('current_input_write', await denied(() => io.writeFile(
    path.posix.join(inputDirectory, 'isolation-probe-write.tmp'),
    'forbidden\n',
    { flag: 'wx', mode: 0o600 },
  )));
  record('sibling_job', await denied(() => io.readFile(path.posix.join(
    plan.jobs_root,
    plan.sibling_job_id,
    'input',
    'sibling-readable.txt',
  ))));
  record('jobs_parent', await denied(() => io.readdir(plan.protected_jobs_root)));
  record('codex_auth', await denied(() => io.readFile('/run/codex-auth/auth.json')));
  record('job_codex_auth', await denied(() => io.readFile(path.posix.join(
    plan.jobs_root,
    plan.job_id,
    'codex-home',
    'auth.json',
  ))));
  record('runner_secret', await denied(() => io.readFile('/run/secrets/runner-auth-token')));
  record('slash_tmp', await denied(() => io.writeFile(
    '/tmp/tender-codex-runner-isolation-probe.tmp',
    'forbidden\n',
    { flag: 'wx', mode: 0o600 },
  )));
  record('self_process_environment', await denied(() => io.readFile('/proc/self/environ')));
  record('parent_process_environment', await denied(() => io.readFile(
    `/proc/${ppid}/environ`,
  )));
  record('credential_environment', Object.keys(environment).every(
    (name) => !/(?:KEY|SECRET|TOKEN|PASSWORD)/iu.test(name),
  ));

  if (probes.map(({ id }) => id).join('\n') !== PROBE_IDS.join('\n')) {
    throw new Error('Isolation probe coverage is incomplete');
  }
  return {
    schema_version: 'tender_codex_runner_isolation_probe_v1',
    challenge_id: plan.challenge_id,
    job_id: plan.job_id,
    sibling_job_id: plan.sibling_job_id,
    probe_script_sha256: plan.probe_script_sha256,
    probes,
  };
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  let exitCode = 17;
  try {
    const inputDirectory = path.posix.resolve(process.cwd(), '../input');
    const plan = JSON.parse(await readFile(
      path.posix.join(inputDirectory, 'isolation-probe-plan.json'),
      'utf8',
    ));
    const actualScriptSha256 = digest(await readFile(fileURLToPath(import.meta.url)));
    if (actualScriptSha256 !== plan.probe_script_sha256) {
      throw new Error('Isolation probe script hash mismatch');
    }
    const output = await runIsolationProbe({ plan });
    process.stdout.write(`${JSON.stringify(output)}\n`);
    if (output.probes.every(({ passed }) => passed)) exitCode = 0;
  } catch {
    // The caller fails closed when the command sentinel is absent.
  }
  process.exitCode = exitCode;
}
