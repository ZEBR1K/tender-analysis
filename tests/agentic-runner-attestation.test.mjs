import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildCodexPermissionBoundary } from '../deploy/codex-runner/src/permissions.mjs';

const testsDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testsDirectory, '..');
const runnerRoot = path.join(repositoryRoot, 'deploy', 'codex-runner');

async function sha256(relativePath) {
  return createHash('sha256')
    .update(await readFile(path.join(runnerRoot, relativePath)))
    .digest('hex')
    .toUpperCase();
}

test('runner execution profile hashes the exact pinned image artifacts', async () => {
  const { buildRunnerExecutionProfile } = await import(
    '../deploy/codex-runner/src/runtime-attestation.mjs'
  );
  const profile = await buildRunnerExecutionProfile({ runnerRoot });

  assert.deepEqual(profile, {
    schema_version: 'tender_codex_runner_execution_profile_v1',
    model: 'gpt-5.6-sol',
    reasoning_effort: 'high',
    codex_cli_version: '0.153.4',
    field_catalog_sha256: await sha256('field-catalog/FIELD_CATALOG.md'),
    prompt_sha256: await sha256('prompts/tender-analysis-v1.txt'),
    skill_sha256: await sha256(
      'agent-template/.agents/skills/tender-document-analysis/SKILL.md',
    ),
    result_schema_sha256: await sha256('schemas/tender-agent-result-v1.schema.json'),
  });
});

test('isolation canary command uses the real pinned Codex argv and permission boundary', async () => {
  const { buildIsolationCanaryCommand } = await import(
    '../deploy/codex-runner/src/runtime-attestation.mjs'
  );
  const jobId = '11111111-1111-4111-8111-111111111111';
  const jobsRoot = '/data/jobs/.runner-isolation/canary/jobs';
  const command = buildIsolationCanaryCommand({ jobId, jobsRoot });
  const boundary = buildCodexPermissionBoundary({ jobId, jobsRoot });
  assert.equal(command.args.includes('tools.view_image=true'), false);

  assert.equal(command.executable, 'codex');
  assert.deepEqual(command.args.slice(0, boundary.cliArgs.length + 1), [
    'exec',
    ...boundary.cliArgs,
  ]);
  assert.deepEqual(command.args.slice(boundary.cliArgs.length + 1), [
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
    '--json',
    '-o',
    `${boundary.workspaceDirectory}/output/isolation-canary-result.json`,
    '-',
  ]);
  assert.equal(command.cwd, boundary.workspaceDirectory);
  assert.equal(command.shell, false);
  assert.equal(command.probeCommand, 'node ../input/isolation-probe.mjs');
  assert.equal(command.args.includes('--sandbox'), false);
  assert.equal(command.args.includes('-s'), false);
  assert.equal(command.args.some((entry) => entry.includes('sandbox_workspace_write')), false);
});

const probeIds = [
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
];

function probePayload(overrides = {}) {
  return {
    schema_version: 'tender_codex_runner_isolation_probe_v1',
    challenge_id: '33333333-3333-4333-8333-333333333333',
    job_id: '11111111-1111-4111-8111-111111111111',
    sibling_job_id: '22222222-2222-4222-8222-222222222222',
    probe_script_sha256: 'E'.repeat(64),
    probes: probeIds.map((id) => ({ id, passed: true })),
    ...overrides,
  };
}

function commandEvent(payload = probePayload(), overrides = {}) {
  return `${JSON.stringify({
    type: 'item.completed',
    item: {
      id: 'item_1',
      type: 'command_execution',
      command: 'node ../input/isolation-probe.mjs',
      aggregated_output: `${JSON.stringify(payload)}\n`,
      exit_code: 0,
      status: 'completed',
      ...overrides,
    },
  })}\n${JSON.stringify({ type: 'turn.completed', usage: {} })}\n`;
}

test('isolation evidence passes only for one exact successful probe command event', async () => {
  const { validateIsolationEvidence } = await import(
    '../deploy/codex-runner/src/runtime-attestation.mjs'
  );
  const expected = {
    challengeId: '33333333-3333-4333-8333-333333333333',
    jobId: '11111111-1111-4111-8111-111111111111',
    siblingJobId: '22222222-2222-4222-8222-222222222222',
    probeScriptSha256: 'E'.repeat(64),
    probeCommand: 'node ../input/isolation-probe.mjs',
  };

  assert.equal(validateIsolationEvidence({ jsonl: commandEvent(), ...expected }).verified, true);
  const wrappedCommand = "/bin/bash -lc 'node ../input/isolation-probe.mjs'";
  const startedAndCompleted = `${JSON.stringify({
    type: 'item.started',
    item: {
      id: 'item_1',
      type: 'command_execution',
      command: wrappedCommand,
      aggregated_output: '',
      exit_code: null,
      status: 'in_progress',
    },
  })}\n${commandEvent(probePayload(), { command: wrappedCommand })}`;
  assert.equal(validateIsolationEvidence({
    jsonl: startedAndCompleted,
    ...expected,
  }).verified, true);
  assert.equal(validateIsolationEvidence({
    jsonl: startedAndCompleted.replaceAll('/bin/bash', '/usr/bin/bash'),
    ...expected,
  }).verified, true);

  const agentClaim = `${JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text: JSON.stringify(probePayload()) },
  })}\n${JSON.stringify({ type: 'turn.completed', usage: {} })}\n`;
  const failures = [
    '',
    agentClaim,
    commandEvent(probePayload(), { exit_code: 7, status: 'failed' }),
    commandEvent({ ...probePayload(), probes: probePayload().probes.slice(0, -1) }),
    commandEvent(probePayload({
      probes: probeIds.map((id) => ({ id, passed: id !== 'slash_tmp' })),
    })),
    commandEvent(probePayload(), { command: 'printf forged' }),
    startedAndCompleted.replace('"status":"in_progress"', '"status":"completed"'),
    `${commandEvent()}${commandEvent()}`,
    commandEvent(undefined, { aggregated_output: 'not-json\n' }),
  ];
  for (const jsonl of failures) {
    assert.equal(validateIsolationEvidence({ jsonl, ...expected }).verified, false);
  }
});

test('probe script executes every declared read, write and environment check itself', async () => {
  const { runIsolationProbe } = await import(
    '../deploy/codex-runner/probes/isolation-probe.mjs'
  );
  const jobsRoot = '/data/jobs/.runner-isolation/333/jobs';
  const jobId = '11111111-1111-4111-8111-111111111111';
  const siblingJobId = '22222222-2222-4222-8222-222222222222';
  const currentMarker = Buffer.from('current marker\n', 'utf8');
  const currentMarkerSha256 = createHash('sha256').update(currentMarker).digest('hex').toUpperCase();
  const reads = [];
  const writes = [];
  const deniedReads = new Set([
    `${jobsRoot}/${siblingJobId}/input/sibling-readable.txt`,
    '/data/jobs',
    '/run/codex-auth/auth.json',
    `${jobsRoot}/${jobId}/codex-home/auth.json`,
    '/run/secrets/runner-auth-token',
    '/proc/self/environ',
    '/proc/42/environ',
  ]);
  const io = {
    async readFile(filePath) {
      reads.push(filePath);
      if (filePath === `${jobsRoot}/${jobId}/input/current-readable.txt`) return currentMarker;
      if (filePath.endsWith('/workspace/isolation-probe-write.tmp')) return Buffer.from('workspace\n');
      if (deniedReads.has(filePath)) {
        const hidden = filePath === `${jobsRoot}/${siblingJobId}/input/sibling-readable.txt`
          || filePath === `${jobsRoot}/${jobId}/codex-home/auth.json`;
        throw Object.assign(new Error('denied'), { code: hidden ? 'ENOENT' : 'EACCES' });
      }
      throw Object.assign(new Error('unexpected read'), { code: 'ENOENT' });
    },
    async readdir(filePath) {
      reads.push(filePath);
      const visible = new Map([
        ['/data/jobs', ['.runner-isolation']],
        ['/data/jobs/.runner-isolation', ['333']],
        ['/data/jobs/.runner-isolation/333', ['jobs']],
        [jobsRoot, [jobId]],
      ]);
      if (visible.has(filePath)) return visible.get(filePath);
      throw Object.assign(new Error('unexpected readdir'), { code: 'ENOENT' });
    },
    async writeFile(filePath) {
      writes.push(filePath);
      if (filePath.endsWith('/workspace/isolation-probe-write.tmp')) return;
      throw Object.assign(new Error('denied'), { code: 'EACCES' });
    },
    async unlink() {},
  };
  const output = await runIsolationProbe({
    plan: {
      schema_version: 'tender_codex_runner_isolation_probe_plan_v1',
      challenge_id: '33333333-3333-4333-8333-333333333333',
      job_id: jobId,
      sibling_job_id: siblingJobId,
      jobs_root: jobsRoot,
      protected_jobs_root: '/data/jobs',
      current_marker_sha256: currentMarkerSha256,
      probe_script_sha256: 'E'.repeat(64),
    },
    cwd: `${jobsRoot}/${jobId}/workspace`,
    environment: { PATH: '/usr/bin:/bin', HOME: `${jobsRoot}/${jobId}/workspace` },
    ppid: 42,
    io,
  });

  assert.deepEqual(output.probes, probeIds.map((id) => ({ id, passed: true })));
  assert.deepEqual(reads, [
    `${jobsRoot}/${jobId}/input/current-readable.txt`,
    `${jobsRoot}/${jobId}/workspace/isolation-probe-write.tmp`,
    `${jobsRoot}/${siblingJobId}/input/sibling-readable.txt`,
    '/data/jobs',
    '/data/jobs/.runner-isolation',
    '/data/jobs/.runner-isolation/333',
    jobsRoot,
    '/run/codex-auth/auth.json',
    `${jobsRoot}/${jobId}/codex-home/auth.json`,
    '/run/secrets/runner-auth-token',
    '/proc/self/environ',
    '/proc/42/environ',
  ]);
  assert.deepEqual(writes, [
    `${jobsRoot}/${jobId}/workspace/isolation-probe-write.tmp`,
    `${jobsRoot}/${jobId}/input/isolation-probe-write.tmp`,
    '/tmp/tender-codex-runner-isolation-probe.tmp',
  ]);

  const leakedParent = await runIsolationProbe({
    plan: {
      schema_version: 'tender_codex_runner_isolation_probe_plan_v1',
      challenge_id: '33333333-3333-4333-8333-333333333333',
      job_id: jobId,
      sibling_job_id: siblingJobId,
      jobs_root: jobsRoot,
      protected_jobs_root: '/data/jobs',
      current_marker_sha256: currentMarkerSha256,
      probe_script_sha256: 'E'.repeat(64),
    },
    cwd: `${jobsRoot}/${jobId}/workspace`,
    environment: { PATH: '/usr/bin:/bin', HOME: `${jobsRoot}/${jobId}/workspace` },
    ppid: 42,
    io: {
      ...io,
      async readdir(filePath) {
        if (filePath === '/data/jobs') return ['.runner-isolation', 'another-job'];
        return io.readdir(filePath);
      },
    },
  });
  assert.equal(
    leakedParent.probes.find(({ id }) => id === 'jobs_parent').passed,
    false,
  );
});

test('boot-bound attestation accepts exact evidence and rejects tamper, stale or container mismatch', async () => {
  const {
    buildIsolationAttestationRecord,
    createRuntimeAttestationGate,
    persistIsolationAttestation,
  } = await import('../deploy/codex-runner/src/runtime-attestation.mjs');
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), 'runner-attestation-'));
  const challengeId = '33333333-3333-4333-8333-333333333333';
  const containerIdentitySha256 = 'F'.repeat(64);
  const createdAt = new Date('2026-09-10T00:00:00.000Z');
  const jobId = '11111111-1111-4111-8111-111111111111';
  const siblingJobId = '22222222-2222-4222-8222-222222222222';
  let checkedAt = createdAt;
  try {
    const gate = createRuntimeAttestationGate({
      rootDirectory,
      runnerRoot,
      containerJobsRoot: '/data/jobs',
      challengeId,
      containerIdentitySha256,
      now: () => checkedAt,
    });
    const challenge = await gate.getChallenge();
    assert.equal((await gate.verify()).verified, false);
    const jsonl = commandEvent(probePayload({
      challenge_id: challengeId,
      job_id: jobId,
      sibling_job_id: siblingJobId,
      probe_script_sha256: challenge.probe_script_sha256,
    }));
    const eventLogPath = path.join(
      rootDirectory,
      '.runner-isolation',
      'canaries',
      challengeId,
      'jobs',
      jobId,
      'audit',
      'codex-events.attempt-1.jsonl',
    );
    await mkdir(path.dirname(eventLogPath), { recursive: true });
    await writeFile(eventLogPath, jsonl, 'utf8');
    await assert.rejects(buildIsolationAttestationRecord({
      challenge,
      jobId,
      siblingJobId,
      eventLogBytes: Buffer.from(jsonl),
      startedAt: new Date('2026-09-10T00:00:01.000Z'),
      completedAt: new Date('2026-09-10T00:10:01.001Z'),
      containerJobsRoot: '/data/jobs',
    }));
    const record = await buildIsolationAttestationRecord({
      challenge,
      jobId,
      siblingJobId,
      eventLogBytes: Buffer.from(jsonl),
      startedAt: new Date('2026-09-10T00:00:01.000Z'),
      completedAt: new Date('2026-09-10T00:00:02.000Z'),
      runnerRoot,
      containerJobsRoot: '/data/jobs',
    });
    await persistIsolationAttestation({ rootDirectory, record });
    checkedAt = new Date('2026-09-10T00:00:03.000Z');
    assert.equal((await gate.verify()).verified, true);
    if (process.platform !== 'win32') {
      assert.equal((await stat(gate.attestationPath)).mode & 0o777, 0o600);
    }

    await writeFile(eventLogPath, `${jsonl} `, 'utf8');
    assert.equal((await gate.verify()).verified, false);
    await writeFile(eventLogPath, jsonl, 'utf8');

    checkedAt = new Date('2026-09-11T00:00:03.001Z');
    assert.equal((await gate.verify()).verified, false);
    checkedAt = new Date('2026-09-10T00:00:03.000Z');
    assert.equal((await gate.verify()).verified, true);

    let otherClockCalls = 0;
    const wrongContainerGate = createRuntimeAttestationGate({
      rootDirectory,
      runnerRoot,
      containerJobsRoot: '/data/jobs',
      challengeId,
      containerIdentitySha256: '0'.repeat(64),
      now: () => (otherClockCalls++ === 0 ? createdAt : checkedAt),
    });
    assert.equal((await wrongContainerGate.verify()).verified, false);

    const tampered = { ...record, runtime_contract_sha256: '0'.repeat(64) };
    await persistIsolationAttestation({ rootDirectory, record: tampered });
    assert.equal((await gate.verify()).verified, false);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('health provider exposes runner-owned profile and revalidates attestation dynamically', async () => {
  const { createDefaultHealthProvider } = await import(
    '../deploy/codex-runner/src/server.mjs'
  );
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), 'runner-health-attestation-'));
  const codexAuthFile = path.join(rootDirectory, 'auth.json');
  let verified = false;
  try {
    await writeFile(codexAuthFile, '{}\n', 'utf8');
    const provider = createDefaultHealthProvider({
      authenticator: { ready: true },
      queue: { snapshot: () => ({ active: 0, queued: 0, max_concurrent: 1, max_queued: 2 }) },
      rootDirectory,
      codexAuthFile,
      runnerRoot,
      toolProbe: Promise.resolve({
        versions: {
          node: process.version,
          codex: 'codex-cli 0.153.4',
          poppler: '22.12.0',
          libreoffice: '7.4.7.2',
          tesseract: '5.3.0',
          ocr_languages: ['eng', 'rus'],
        },
      }),
      runtimeAttestationGate: {
        getChallenge: async () => ({
          schema_version: 'tender_codex_runner_isolation_challenge_v1',
          challenge_id: '33333333-3333-4333-8333-333333333333',
          container_identity_sha256: 'F'.repeat(64),
          execution_profile_sha256: 'A'.repeat(64),
          probe_script_sha256: 'E'.repeat(64),
        }),
        verify: async () => ({ verified }),
      },
    });

    const before = await provider();
    assert.equal(before.execution_profile.model, 'gpt-5.6-sol');
    assert.equal(before.execution_profile.reasoning_effort, 'high');
    assert.equal(before.execution_profile.codex_cli_version, '0.153.4');
    assert.equal(before.readiness.isolation_canary, false);
    assert.equal(before.readiness.execute, false);
    assert.deepEqual(before.isolation_attestation, {
      schema_version: 'tender_codex_runner_isolation_challenge_v1',
      challenge_id: '33333333-3333-4333-8333-333333333333',
      container_identity_sha256: 'F'.repeat(64),
      execution_profile_sha256: 'A'.repeat(64),
      probe_script_sha256: 'E'.repeat(64),
    });

    verified = true;
    const after = await provider();
    assert.equal(after.readiness.isolation_canary, true);
    assert.equal(after.readiness.execute, true);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('attestation runner stages a fresh probe and persists only after fake Codex evidence', async () => {
  const {
    buildRunnerExecutionProfile,
    createRuntimeAttestationGate,
  } = await import('../deploy/codex-runner/src/runtime-attestation.mjs');
  const { runIsolationAttestation } = await import(
    '../deploy/codex-runner/src/run-isolation-attestation.mjs'
  );
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), 'runner-attestation-command-'));
  const challengeId = '33333333-3333-4333-8333-333333333333';
  const jobId = '11111111-1111-4111-8111-111111111111';
  const siblingJobId = '22222222-2222-4222-8222-222222222222';
  let gateTime = new Date('2026-09-10T00:00:00.000Z');
  const gate = createRuntimeAttestationGate({
    rootDirectory,
    runnerRoot,
    containerJobsRoot: '/data/jobs',
    challengeId,
    containerIdentitySha256: 'F'.repeat(64),
    now: () => gateTime,
  });
  const challenge = await gate.getChallenge();
  const executionProfile = await buildRunnerExecutionProfile({ runnerRoot });
  const codexAuthFile = path.join(rootDirectory, 'mounted-auth.json');
  await writeFile(codexAuthFile, '{"auth":"fixture"}\n', { mode: 0o400 });
  let observedCommand;
  let stagedAuthDuringExecution;
  let healthCalls = 0;
  const fetchImpl = async () => {
    healthCalls += 1;
    const verified = (await gate.verify()).verified;
    return new Response(JSON.stringify({
      schema_version: 'tender_codex_runner_health_v1',
      status: 'ready',
      tools: { codex: 'codex-cli 0.153.4' },
      execution_profile: executionProfile,
      isolation_attestation: {
        schema_version: challenge.schema_version,
        challenge_id: challenge.challenge_id,
        container_identity_sha256: challenge.container_identity_sha256,
        execution_profile_sha256: challenge.execution_profile_sha256,
        probe_script_sha256: challenge.probe_script_sha256,
      },
      readiness: { isolation_canary: verified, execute: verified },
      queue: { active: 0, queued: 0, max_concurrent: 1, max_queued: 2 },
    }), { status: 200 });
  };
  const times = [
    new Date('2026-09-10T00:00:01.000Z'),
    new Date('2026-09-10T00:00:02.000Z'),
  ];
  try {
    const summary = await runIsolationAttestation({
      rootDirectory,
      runnerRoot,
      containerJobsRoot: '/data/jobs',
      runnerBaseUrl: 'http://127.0.0.1:8080',
      fetchImpl,
      platform: 'linux',
      jobIds: [jobId, siblingJobId],
      now: () => times.shift(),
      codexAuthFile,
      verifyProtectedTargets: async () => {},
      probeCodexVersion: async () => 'codex-cli 0.153.4',
      executeCommand: async (command) => {
        observedCommand = command;
        stagedAuthDuringExecution = await readFile(path.join(
          rootDirectory,
          '.runner-isolation',
          'canaries',
          challengeId,
          'jobs',
          jobId,
          'codex-home',
          'auth.json',
        ), 'utf8');
        const jsonl = commandEvent(probePayload({
          challenge_id: challengeId,
          job_id: jobId,
          sibling_job_id: siblingJobId,
          probe_script_sha256: challenge.probe_script_sha256,
        }));
        const events = path.join(command.auditDirectory, 'codex-events.attempt-1.jsonl');
        await writeFile(events, jsonl, 'utf8');
        gateTime = new Date('2026-09-10T00:00:03.000Z');
        return { ok: true, code: 'CODEX_COMPLETED', artifacts: { events } };
      },
    });

    assert.equal(summary.schema_version, 'tender_codex_runner_isolation_attestation_result_v1');
    assert.equal(summary.attested, true);
    assert.equal(summary.challenge_id, challengeId);
    assert.equal(healthCalls, 2);
    assert.equal(observedCommand.executable, 'codex');
    assert.equal(observedCommand.args.includes('--sandbox'), false);
    assert.equal(observedCommand.shell, false);
    assert.equal(observedCommand.timeoutMs, 10 * 60 * 1000);
    assert.equal(stagedAuthDuringExecution, '{"auth":"fixture"}\n');
    assert.equal(
      observedCommand.baseEnv.CODEX_HOME,
      `/data/jobs/.runner-isolation/canaries/${challengeId}/jobs/${jobId}/codex-home`,
    );
    assert.match(observedCommand.prompt, /node \.\.\/input\/isolation-probe\.mjs/u);
    assert.equal((await gate.verify()).verified, true);
    await assert.rejects(
      stat(path.join(
        rootDirectory,
        '.runner-isolation',
        'canaries',
        challengeId,
        'jobs',
        jobId,
        'codex-home',
      )),
      { code: 'ENOENT' },
    );
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});
