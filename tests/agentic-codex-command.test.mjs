import assert from 'node:assert/strict';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildCodexCommand,
  executeCodexCommand,
  runCodexAttempt,
  sanitizeCodexEnvironment,
  shouldRetryCodexAttempt,
  stageAgentTemplate,
  stageCodexHome,
} from '../deploy/codex-runner/src/codex-command.mjs';
import {
  createCodexEventAccumulator,
  parseCodexEventLine,
} from '../deploy/codex-runner/src/codex-events.mjs';
import { buildCodexPermissionBoundary } from '../deploy/codex-runner/src/permissions.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..');
const runnerRoot = path.join(repositoryRoot, 'deploy', 'codex-runner');
const templateRoot = path.join(runnerRoot, 'agent-template');
const agentInstructionsPath = path.join(templateRoot, 'AGENTS.md');
const skillPath = path.join(
  templateRoot,
  '.agents',
  'skills',
  'tender-document-analysis',
  'SKILL.md',
);
const promptPath = path.join(runnerRoot, 'prompts', 'tender-analysis-v1.txt');
const dockerfilePath = path.join(runnerRoot, 'Dockerfile');
const fakeCodexPath = path.join(
  repositoryRoot,
  'tests',
  'fixtures',
  'agentic',
  'fake-codex.mjs',
);
const fixtureJobId = '00000000-0000-4000-8000-000000000007';

async function listRelativeFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listRelativeFiles(root, target));
    else if (entry.isFile()) files.push(path.relative(root, target).replaceAll('\\', '/'));
  }
  return files.sort();
}

function assertTenderMetadataInstructions(source, label) {
  assert.match(
    source,
    /(?:sealed[\s\S]{0,160}tender_metadata|tender_metadata[\s\S]{0,160}sealed)/iu,
    `${label} must identify tender_metadata as a sealed source`,
  );
  assert.match(source, /tenderplan-metadata/u, `${label} must name the reserved artifact key`);
  assert.match(
    source,
    /(?:absent|missing|null)[^\n]{0,240}(?:must not|does not|never)[^\n]{0,160}(?:negative|["'“]no["'”]|false|not required)/iu,
    `${label} must forbid treating absent/null metadata as a negative fact`,
  );
}

test('agent template contains only its boundary instructions and one focused skill', async () => {
  assert.deepEqual(await listRelativeFiles(templateRoot), [
    '.agents/skills/tender-document-analysis/SKILL.md',
    'AGENTS.md',
  ]);

  const instructions = await readFile(agentInstructionsPath, 'utf8');
  assert.match(instructions, /\.\.\/input\/manifest\.json/u);
  assert.match(instructions, /\.\.\/input\/documents/u);
  assert.match(instructions, /read[- ]only/iu);
  assert.match(instructions, /no internet|do not use (?:the )?internet/iu);
  assert.match(instructions, /do not read|outside/iu);
  assert.doesNotMatch(instructions, /n8n|postgres|telegram|browser/iu);
});

test('skill is short, agent-led and contains no mechanical parser or semantic validator policy', async () => {
  const skill = await readFile(skillPath, 'utf8');
  assert.ok(skill.length <= 5000, `skill is too long: ${skill.length}`);
  assert.match(skill, /^---\s*[\s\S]*?name:\s*tender-document-analysis\s*[\s\S]*?---/u);
  assert.match(skill, /description:\s*Use when/iu);
  assert.match(skill, /one document at a time|document-by-document/iu);
  assert.match(skill, /choose|select/iu);
  assert.match(skill, /text|visual|OCR|OOXML/iu);
  assert.match(skill, /field-ledger\.json/u);
  assert.match(skill, /exact(?:ly)? 27|ровно 27/iu);
  assert.match(skill, /inspected_documents/u);
  assert.match(skill, /limitations/u);
  assert.match(skill, /constraints/u);
  assert.match(skill, /requires_review/u);
  assert.match(skill, /not_found/u);
  assert.match(skill, /artifact_key/u);
  assert.match(skill, /locator/u);
  assert.match(skill, /quote.*optional|optional.*quote/iu);
  assertTenderMetadataInstructions(skill, 'skill');

  for (const forbidden of [
    /source[-_ ]index/iu,
    /every page|all pages|each page/iu,
    /every sheet|all sheets|each sheet/iu,
    /quote match|verify (?:the )?quote/iu,
    /price arithmetic|VAT check|negative answer/iu,
    /field-specific/iu,
  ]) {
    assert.doesNotMatch(skill, forbidden);
  }
});

test('runtime prompt only binds job-local inputs, skill and structured output', async () => {
  const prompt = await readFile(promptPath, 'utf8');
  assert.ok(prompt.length <= 1400, `prompt is too long: ${prompt.length}`);
  for (const required of [
    '../input/manifest.json',
    '../input/FIELD_CATALOG.md',
    '../input/documents',
    'tender-document-analysis',
    'tender_agent_result_v1',
  ]) {
    assert.ok(prompt.includes(required), required);
  }
  assertTenderMetadataInstructions(prompt, 'prompt');
  assert.doesNotMatch(prompt, /https?:\/\//iu);
  assert.doesNotMatch(prompt, /credential|password|secret|token/iu);
  assert.doesNotMatch(prompt, /n8n|PostgreSQL|Telegram/iu);
  assert.doesNotMatch(prompt, /цена|НДС|лиценз|аналог|гарант/iu);
});

test('runner image contains the dedicated template and prompt', async () => {
  const dockerfile = await readFile(dockerfilePath, 'utf8');
  assert.match(dockerfile, /^COPY agent-template \.\/agent-template$/mu);
  assert.match(dockerfile, /^COPY prompts \.\/prompts$/mu);
});

test('Codex argv is fixed, shell-free and includes the exact per-job permission boundary', () => {
  const command = buildCodexCommand({ jobId: fixtureJobId });
  const boundary = buildCodexPermissionBoundary({ jobId: fixtureJobId });

  assert.equal(command.executable, 'codex');
  assert.deepEqual(
    command.args.slice(0, boundary.cliArgs.length + 1),
    ['exec', ...boundary.cliArgs],
  );
  assert.equal(command.cwd, boundary.workspaceDirectory);
  assert.equal(command.promptPath, '/app/prompts/tender-analysis-v1.txt');
  assert.equal(
    command.resultPath,
    `/data/jobs/${fixtureJobId}/workspace/output/result.json`,
  );
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
    '--output-schema',
    '/app/schemas/tender-agent-result-v1.schema.json',
    '--json',
    '-o',
    command.resultPath,
    '-',
  ]);
  assert.equal(command.args.filter((entry) => entry === '--ignore-user-config').length, 1);
  assert.equal(command.args.includes('--sandbox'), false);
  assert.equal(command.args.includes('-s'), false);
  assert.equal(command.args.some((entry) => entry.includes('sandbox_workspace_write')), false);
  assert.equal(command.shell, false);
  assert.ok(boundary.readOnlyInstructionPaths.includes(
    `/data/jobs/${fixtureJobId}/workspace/AGENTS.md`,
  ));
  assert.ok(boundary.readOnlyInstructionPaths.includes(
    `/data/jobs/${fixtureJobId}/workspace/.agents`,
  ));

  assert.throws(
    () => buildCodexCommand({ jobId: fixtureJobId, extraArgs: ['--sandbox', 'workspace-write'] }),
    /unsupported option|caller arguments/iu,
  );
});

test('agent template staging copies only trusted instructions and rejects drift', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'agentic-template-stage-'));
  try {
    const workspaceDirectory = path.join(temporaryRoot, 'workspace');
    await mkdir(workspaceDirectory);
    await stageAgentTemplate({ workspaceDirectory, templateDirectory: templateRoot });
    assert.deepEqual(await listRelativeFiles(workspaceDirectory), [
      '.agents/skills/tender-document-analysis/SKILL.md',
      'AGENTS.md',
    ]);
    assert.deepEqual((await readdir(workspaceDirectory)).sort(), [
      '.agents',
      '.tmp',
      'AGENTS.md',
      'output',
    ]);
    assert.deepEqual(await readdir(path.join(temporaryRoot, 'audit')), []);
    assert.equal(
      await readFile(path.join(workspaceDirectory, 'AGENTS.md'), 'utf8'),
      await readFile(agentInstructionsPath, 'utf8'),
    );

    await chmod(path.join(workspaceDirectory, 'AGENTS.md'), 0o600);
    await writeFile(path.join(workspaceDirectory, 'AGENTS.md'), 'drift', 'utf8');
    await assert.rejects(
      stageAgentTemplate({ workspaceDirectory, templateDirectory: templateRoot }),
      /instruction.*changed|trusted.*instruction/iu,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('job-local Codex home stages the mounted auth privately outside the agent workspace', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'agentic-codex-home-'));
  try {
    const jobDirectory = path.join(temporaryRoot, fixtureJobId);
    const authDirectory = path.join(temporaryRoot, 'mounted-auth');
    const codexAuthFile = path.join(authDirectory, 'auth.json');
    await Promise.all([
      mkdir(jobDirectory, { mode: 0o700 }),
      mkdir(authDirectory, { mode: 0o700 }),
    ]);
    await writeFile(codexAuthFile, '{"auth":"fixture"}\n', { mode: 0o400 });

    const codexHome = await stageCodexHome({ jobDirectory, codexAuthFile });
    assert.equal(codexHome, path.join(jobDirectory, 'codex-home'));
    assert.equal(await readFile(path.join(codexHome, 'auth.json'), 'utf8'), '{"auth":"fixture"}\n');
    assert.equal(path.dirname(codexHome), jobDirectory);
    if (process.platform !== 'win32') {
      assert.equal((await stat(codexHome)).mode & 0o777, 0o700);
      assert.equal((await stat(path.join(codexHome, 'auth.json'))).mode & 0o777, 0o600);
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('Codex event parser accepts audited terminals and sums exact usage', () => {
  const accumulator = createCodexEventAccumulator();
  accumulator.accept(parseCodexEventLine('{"type":"thread.started","thread_id":"thread-1"}'));
  accumulator.accept(parseCodexEventLine(JSON.stringify({
    type: 'turn.completed',
    usage: {
      input_tokens: 120,
      cached_input_tokens: 80,
      output_tokens: 30,
      reasoning_output_tokens: 12,
    },
  })));

  assert.deepEqual(accumulator.snapshot(), {
    thread_id: 'thread-1',
    terminal_event: 'turn.completed',
    event_count: 2,
    usage: {
      input_tokens: 120,
      cached_input_tokens: 80,
      output_tokens: 30,
      reasoning_output_tokens: 12,
    },
  });
  assert.throws(() => parseCodexEventLine('not-json'), /CODEX_EVENT_STREAM_INVALID/);
});

test('Codex process environment is allowlisted and strips secret-like keys', () => {
  const sanitized = sanitizeCodexEnvironment({
    PATH: '/usr/bin:/bin',
    CODEX_HOME: '/run/codex-auth',
    HOME: '/run/codex-auth',
    LANG: 'C.UTF-8',
    TZ: 'Europe/Moscow',
    TMPDIR: '/data/jobs/.tmp',
    OPENAI_API_KEY: 'must-not-pass',
    TENDER_CODEX_RUNNER_AUTH_TOKEN: 'must-not-pass',
    DATABASE_PASSWORD: 'must-not-pass',
    SAFE_BUT_UNLISTED: 'must-not-pass',
  });
  assert.deepEqual(sanitized, {
    PATH: '/usr/bin:/bin',
    CODEX_HOME: '/run/codex-auth',
    HOME: '/run/codex-auth',
    LANG: 'C.UTF-8',
    TZ: 'Europe/Moscow',
    TMPDIR: '/data/jobs/.tmp',
  });
});

async function runFake(mode, {
  timeoutMs = 2_000,
  killGraceMs = 100,
  secretValues = [],
} = {}) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'agentic-codex-command-'));
  const workspaceDirectory = path.join(temporaryRoot, 'workspace');
  const outputDirectory = path.join(workspaceDirectory, 'output');
  const auditDirectory = path.join(temporaryRoot, 'audit');
  await Promise.all([
    mkdir(outputDirectory, { recursive: true }),
    mkdir(auditDirectory, { recursive: true }),
  ]);
  const resultPath = path.join(outputDirectory, 'result.json');
  const execution = await executeCodexCommand({
    executable: process.execPath,
    args: [fakeCodexPath, '-o', resultPath, '-'],
    cwd: workspaceDirectory,
    prompt: `[fake:${mode}]`,
    resultPath,
    auditDirectory,
    attempt: 1,
    timeoutMs,
    killGraceMs,
    baseEnv: {
      ...process.env,
      OPENAI_API_KEY: 'must-not-reach-fake',
      TENDER_CODEX_RUNNER_AUTH_TOKEN: 'must-not-reach-fake',
    },
    secretValues,
  });
  return { temporaryRoot, execution };
}

test('fake Codex success preserves JSONL audit, usage and parsed result without secrets', async () => {
  const { temporaryRoot, execution } = await runFake('success');
  try {
    assert.equal(execution.ok, true);
    assert.equal(execution.code, 'CODEX_COMPLETED');
    assert.equal(execution.exit_code, 0);
    assert.equal(execution.valid_json_result, true);
    assert.equal(execution.events.terminal_event, 'turn.completed');
    assert.equal(execution.events.usage.cached_input_tokens, 80);
    assert.equal(execution.result.schema_version, 'fake_result_v1');

    const [events, stderr] = await Promise.all([
      readFile(execution.artifacts.events, 'utf8'),
      readFile(execution.artifacts.stderr, 'utf8'),
    ]);
    assert.match(events, /"type":"thread.started"/u);
    assert.match(events, /"type":"turn.completed"/u);
    const completedEvent = events.trim().split('\n')
      .map((line) => JSON.parse(line))
      .find((event) => event.type === 'turn.completed');
    assert.deepEqual(completedEvent.usage, {
      input_tokens: 120,
      cached_input_tokens: 80,
      output_tokens: 30,
      reasoning_output_tokens: 12,
    });
    assert.equal(events.includes('must-not-reach-fake'), false);
    assert.equal(events.includes('OPENAI_API_KEY'), false);
    assert.equal(events.includes('TENDER_CODEX_RUNNER_AUTH_TOKEN'), false);
    assert.equal(events.includes('DATABASE_PASSWORD'), false);
    assert.equal(stderr.includes('should-hide'), false);
    assert.ok(Buffer.byteLength(stderr) <= 64 * 1024);
    assert.equal(
      JSON.parse(await readFile(execution.artifacts.result, 'utf8')).schema_version,
      'fake_result_v1',
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('JSONL audit redacts exact secrets while remaining parseable', async () => {
  const { temporaryRoot, execution } = await runFake('stdout-secret', {
    secretValues: ['event-secret-value'],
  });
  try {
    assert.equal(execution.ok, true);
    const source = await readFile(execution.artifacts.events, 'utf8');
    assert.equal(source.includes('event-secret-value'), false);
    assert.match(source, /\[REDACTED\]/u);
    for (const line of source.trim().split('\n')) JSON.parse(line);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('malformed result bytes are retained in the immutable attempt audit', async () => {
  const { temporaryRoot, execution } = await runFake('malformed-result');
  try {
    assert.equal(execution.ok, false);
    assert.equal(execution.code, 'CODEX_RESULT_INVALID');
    assert.equal(await readFile(execution.artifacts.result, 'utf8'), '{"schema_version":');
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('a stale shared result is removed and cannot satisfy the current attempt', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'agentic-codex-stale-'));
  try {
    const workspaceDirectory = path.join(temporaryRoot, 'workspace');
    const outputDirectory = path.join(workspaceDirectory, 'output');
    const auditDirectory = path.join(temporaryRoot, 'audit');
    await Promise.all([
      mkdir(outputDirectory, { recursive: true }),
      mkdir(auditDirectory, { recursive: true }),
    ]);
    const resultPath = path.join(outputDirectory, 'result.json');
    await writeFile(resultPath, '{"schema_version":"stale_previous_attempt"}\n', 'utf8');
    const execution = await executeCodexCommand({
      executable: process.execPath,
      args: [fakeCodexPath, '-o', resultPath, '-'],
      cwd: workspaceDirectory,
      prompt: '[fake:terminal-no-result]',
      resultPath,
      auditDirectory,
      attempt: 1,
      timeoutMs: 2_000,
      killGraceMs: 100,
    });
    assert.equal(execution.ok, false);
    assert.equal(execution.code, 'CODEX_RESULT_INVALID');
    assert.equal(execution.valid_json_result, false);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('attempt audit files are immutable and a duplicate attempt fails closed', async () => {
  const first = await runFake('success');
  try {
    const workspaceDirectory = path.join(first.temporaryRoot, 'workspace');
    const resultPath = path.join(workspaceDirectory, 'output', 'result.json');
    await assert.rejects(
      executeCodexCommand({
        executable: process.execPath,
        args: [fakeCodexPath, '-o', resultPath, '-'],
        cwd: workspaceDirectory,
        prompt: '[fake:success]',
        resultPath,
        auditDirectory: path.join(first.temporaryRoot, 'audit'),
        attempt: 1,
        timeoutMs: 2_000,
        killGraceMs: 100,
      }),
      (error) => error?.code === 'EEXIST',
    );
  } finally {
    await rm(first.temporaryRoot, { recursive: true, force: true });
  }
});

test('invalid event stream and nonzero exit return typed failures without throwing', async () => {
  for (const [mode, expectedCode] of [
    ['invalid-jsonl', 'CODEX_EVENT_STREAM_INVALID'],
    ['nonzero', 'CODEX_PROCESS_FAILED'],
  ]) {
    const { temporaryRoot, execution } = await runFake(mode);
    try {
      assert.equal(execution.ok, false);
      assert.equal(execution.code, expectedCode);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }
});

test('wall-clock timeout terminates the child and returns a typed timeout', async () => {
  const { temporaryRoot, execution } = await runFake('hang', {
    timeoutMs: 80,
    killGraceMs: 40,
  });
  try {
    assert.equal(execution.ok, false);
    assert.equal(execution.code, 'CODEX_TIMEOUT');
    assert.equal(execution.timed_out, true);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('wall-clock timeout terminates the spawned subprocess tree', async () => {
  const { temporaryRoot, execution } = await runFake('child-hang', {
    timeoutMs: 300,
    killGraceMs: 200,
  });
  try {
    assert.equal(execution.code, 'CODEX_TIMEOUT');
    const childPid = Number((await readFile(
      path.join(temporaryRoot, 'workspace', 'child.pid'),
      'utf8',
    )).trim());
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.throws(
      () => process.kill(childPid, 0),
      (error) => error?.code === 'ESRCH',
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('forced timeout kill still runs after the main process exits on SIGTERM', {
  skip: process.platform === 'win32' ? 'POSIX process-group signal regression' : false,
}, async () => {
  const { temporaryRoot, execution } = await runFake('child-ignore-term', {
    timeoutMs: 300,
    killGraceMs: 80,
  });
  let childPid;
  try {
    assert.equal(execution.code, 'CODEX_TIMEOUT');
    childPid = Number((await readFile(
      path.join(temporaryRoot, 'workspace', 'child.pid'),
      'utf8',
    )).trim());
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.throws(
      () => process.kill(childPid, 0),
      (error) => error?.code === 'ESRCH',
    );
  } finally {
    if (Number.isSafeInteger(childPid)) {
      try { process.kill(childPid, 'SIGKILL'); } catch {}
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('automatic retry is limited to process or transport failure with no valid JSON', () => {
  for (const code of [
    'CODEX_PROCESS_FAILED',
    'CODEX_SPAWN_FAILED',
    'CODEX_TIMEOUT',
    'CODEX_TRANSPORT_ERROR',
  ]) {
    assert.equal(shouldRetryCodexAttempt({ code, validJsonResult: false }), true, code);
    assert.equal(shouldRetryCodexAttempt({ code, validJsonResult: true }), false, code);
    assert.equal(shouldRetryCodexAttempt({ code, valid_json_result: true }), false, code);
  }
  for (const code of [
    'CODEX_EVENT_STREAM_INVALID',
    'CODEX_RESULT_INVALID',
    'CODEX_CONTRACT_INVALID',
  ]) {
    assert.equal(shouldRetryCodexAttempt({ code, validJsonResult: false }), false, code);
  }
});

test('high-level run does not permit command, environment or spawn overrides', async () => {
  await assert.rejects(
    runCodexAttempt({
      jobId: fixtureJobId,
      executable: process.execPath,
      args: [fakeCodexPath],
      cwd: process.cwd(),
      baseEnv: { OPENAI_API_KEY: 'unsafe' },
      spawnProcess: () => {},
    }),
    /Unsupported option/iu,
  );
});
