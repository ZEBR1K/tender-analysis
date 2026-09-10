import path from 'node:path';

const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PROFILE_NAME = 'tender-analysis-job';

function validatedJobId(value, name = 'jobId') {
  const normalized = String(value || '').toLowerCase();
  if (!JOB_ID_PATTERN.test(normalized)) throw new Error(`${name} must be a UUID`);
  return normalized;
}

function validatedAbsoluteRoot(value, name) {
  const normalized = path.posix.normalize(String(value || ''));
  if (!normalized.startsWith('/') || normalized === '/' || normalized.includes('"')) {
    throw new Error(`${name} must be a controlled absolute POSIX path`);
  }
  return normalized.replace(/\/$/u, '');
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function tomlInlineStringMap(entries) {
  return `{${entries.map(([key, value]) => (
    `${JSON.stringify(key)}=${tomlString(value)}`
  )).join(',')}}`;
}

function override(key, value) {
  return `${key}=${value}`;
}

function cliOverrides(entries) {
  return entries.flatMap((entry) => ['-c', entry]);
}

export function buildCodexPermissionBoundary({
  jobId,
  jobsRoot = '/data/jobs',
  codexAuthRoot = '/run/codex-auth',
  runnerSecretsRoot = '/run/secrets',
} = {}) {
  const normalizedJobId = validatedJobId(jobId);
  const normalizedJobsRoot = validatedAbsoluteRoot(jobsRoot, 'jobsRoot');
  const normalizedAuthRoot = validatedAbsoluteRoot(codexAuthRoot, 'codexAuthRoot');
  const normalizedSecretsRoot = validatedAbsoluteRoot(runnerSecretsRoot, 'runnerSecretsRoot');
  const jobRoot = path.posix.join(normalizedJobsRoot, normalizedJobId);
  const workspaceDirectory = path.posix.join(jobRoot, 'workspace');
  const inputDirectory = path.posix.join(jobRoot, 'input');
  const workspaceTempDirectory = path.posix.join(workspaceDirectory, '.tmp');
  const agentInstructionsPath = path.posix.join(workspaceDirectory, 'AGENTS.md');
  const agentSkillsDirectory = path.posix.join(workspaceDirectory, '.agents');

  const filesystemEntries = [
    [':root', 'deny'],
    [':minimal', 'read'],
    [':tmpdir', 'deny'],
    [':slash_tmp', 'deny'],
    [normalizedJobsRoot, 'deny'],
    [workspaceDirectory, 'write'],
    [agentInstructionsPath, 'read'],
    [agentSkillsDirectory, 'read'],
    [inputDirectory, 'read'],
    [normalizedAuthRoot, 'deny'],
    [normalizedSecretsRoot, 'deny'],
    ['/proc/*/environ', 'deny'],
    ['/proc/self/environ', 'deny'],
    ['/proc/thread-self/environ', 'deny'],
  ];
  const entries = [
    override('default_permissions', tomlString(PROFILE_NAME)),
    override(`permissions.${PROFILE_NAME}.description`, tomlString('Isolated tender analysis job')),
    override(
      `permissions.${PROFILE_NAME}.filesystem`,
      tomlInlineStringMap(filesystemEntries),
    ),
    override(`permissions.${PROFILE_NAME}.network.enabled`, 'false'),
    override('shell_environment_policy.inherit', tomlString('none')),
    override('shell_environment_policy.ignore_default_excludes', 'false'),
    override('shell_environment_policy.experimental_use_profile', 'false'),
    override('shell_environment_policy.set.PATH', tomlString('/usr/local/bin:/usr/bin:/bin')),
    override('shell_environment_policy.set.HOME', tomlString(workspaceDirectory)),
    override('shell_environment_policy.set.TMPDIR', tomlString(workspaceTempDirectory)),
    override('shell_environment_policy.set.LANG', tomlString('C.UTF-8')),
    override('shell_environment_policy.set.LC_ALL', tomlString('C.UTF-8')),
  ];

  return Object.freeze({
    profileName: PROFILE_NAME,
    workspaceDirectory,
    readOnlyDirectories: Object.freeze([inputDirectory]),
    readOnlyInstructionPaths: Object.freeze([agentInstructionsPath, agentSkillsDirectory]),
    deniedRoots: Object.freeze([
      normalizedJobsRoot,
      normalizedAuthRoot,
      normalizedSecretsRoot,
      '/proc/*/environ',
      '/tmp',
    ]),
    shellEnvironmentKeys: Object.freeze(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL']),
    cliArgs: Object.freeze([
      '--ignore-user-config',
      '--strict-config',
      ...cliOverrides(entries),
    ]),
  });
}

export function buildIsolationNegativeCanary({
  jobId,
  siblingJobId,
  jobsRoot = '/data/jobs',
  protectedJobsRoot = '/data/jobs',
} = {}) {
  const current = validatedJobId(jobId);
  const sibling = validatedJobId(siblingJobId, 'siblingJobId');
  const normalizedJobsRoot = validatedAbsoluteRoot(jobsRoot, 'jobsRoot');
  const normalizedProtectedJobsRoot = validatedAbsoluteRoot(protectedJobsRoot, 'protectedJobsRoot');
  if (current === sibling) throw new Error('siblingJobId must identify another job');
  const currentRoot = path.posix.join(normalizedJobsRoot, current);
  return {
    schema_version: 'tender_codex_runner_isolation_canary_v1',
    job_id: current,
    sibling_job_id: sibling,
    probes: [
      { id: 'current_input', path: path.posix.join(currentRoot, 'input', 'current-readable.txt'), expected: 'readable' },
      { id: 'workspace', path: path.posix.join(currentRoot, 'workspace', 'isolation-probe-write.tmp'), expected: 'writable' },
      { id: 'current_input_write', path: path.posix.join(currentRoot, 'input', 'isolation-probe-write.tmp'), expected: 'denied' },
      { id: 'sibling_job', path: path.posix.join(normalizedJobsRoot, sibling, 'input', 'sibling-readable.txt'), expected: 'denied' },
      { id: 'jobs_parent', path: normalizedProtectedJobsRoot, expected: 'denied' },
      { id: 'codex_auth', path: '/run/codex-auth/auth.json', expected: 'denied' },
      { id: 'runner_secret', path: '/run/secrets/runner-auth-token', expected: 'denied' },
      { id: 'slash_tmp', path: '/tmp/tender-codex-runner-isolation-probe.tmp', expected: 'denied' },
      { id: 'self_process_environment', path: '/proc/self/environ', expected: 'denied' },
      { id: 'parent_process_environment', path: '/proc/${PPID}/environ', expected: 'denied' },
      { id: 'credential_environment', expected: 'absent' },
    ],
  };
}

export function permissionBoundaryContractReady() {
  try {
    const boundary = buildCodexPermissionBoundary({
      jobId: '00000000-0000-4000-8000-000000000001',
    });
    return boundary.cliArgs.includes('--ignore-user-config')
      && !boundary.cliArgs.includes('--sandbox')
      && boundary.readOnlyDirectories.length === 1
      && boundary.readOnlyInstructionPaths.length === 2;
  } catch {
    return false;
  }
}
