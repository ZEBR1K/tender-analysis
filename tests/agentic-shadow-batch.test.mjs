import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import {
  mkdir,
  mkdtemp,
  lstat,
  readlink,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..');
const batchScriptPath = path.join(repositoryRoot, 'scripts', 'run-agentic-shadow-batch.mjs');
const evaluatorScriptPath = path.join(repositoryRoot, 'scripts', 'evaluate-agentic-result.mjs');
const resultFixturePath = path.join(
  repositoryRoot,
  'tests',
  'fixtures',
  'agentic',
  'results',
  'valid-27.json',
);
const authToken = 'fake-runner-token-that-is-long-enough';
const TERMINAL_FOR_TEST = new Set(['completed', 'failed', 'canceled']);
const fixtureSha256 = (name) => createHash('sha256')
  .update(`${name} fixture\n`, 'utf8')
  .digest('hex')
  .toUpperCase();
const defaultExecutionProfile = Object.freeze({
  schema_version: 'tender_codex_runner_execution_profile_v1',
  model: 'gpt-5.6-sol',
  reasoning_effort: 'high',
  codex_cli_version: '0.153.4',
  field_catalog_sha256: fixtureSha256('field_catalog'),
  prompt_sha256: fixtureSha256('prompt'),
  skill_sha256: fixtureSha256('skill'),
  result_schema_sha256: fixtureSha256('result_schema'),
  unexpected_field: 'must-not-be-archived',
});

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function collectBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function json(response, status, body) {
  const bytes = Buffer.from(`${JSON.stringify(body)}\n`, 'utf8');
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': bytes.length,
  });
  response.end(bytes);
}

async function startFakeRunner({
  runnerJobsRoot,
  terminalStatus = 'completed',
  executionProfile = defaultExecutionProfile,
  statusOverrides = {},
  failCreateAfterTerminalJobs = null,
  archiveSymlink = null,
}) {
  const jobs = new Map();
  const events = [];
  let activeUploads = 0;
  let maximumActiveUploads = 0;
  let terminalJobs = 0;
  const terminalRecorded = new Set();
  const resultFixture = JSON.parse(await readFile(resultFixturePath, 'utf8'));
  const resultArtifacts = (job) => {
    const result = structuredClone(resultFixture);
    result.field_catalog_sha256 = job.manifest.field_catalog_sha256;
    result.input_manifest_sha256 = job.inputManifestSha256;
    const rawResultBytes = Buffer.from(`${JSON.stringify(result)}\n`, 'utf8');
    const rawResultSha256 = createHash('sha256')
      .update(rawResultBytes)
      .digest('hex')
      .toUpperCase();
    const validatedResultSha256 = createHash('sha256')
      .update(canonicalJson(result), 'utf8')
      .digest('hex')
      .toUpperCase();
    return {
      result,
      rawResultBytes,
      validation: {
        schema_version: 'tender_agent_validation_v1',
        job_id: job.manifest.job_id,
        valid: true,
        job_issues: [],
        fields: result.fields.map((field) => ({
          field_index: field.field_index,
          field_key: field.field_key,
          status: field.status,
          value_text: field.value_text,
          issues: [],
        })),
        raw_result_sha256: rawResultSha256,
        validated_result_sha256: validatedResultSha256,
      },
    };
  };
  const publicJobState = (job, extra = {}) => ({
    job_id: job.manifest.job_id,
    analysis_run_id: job.manifest.analysis_run_id,
    manifest_version: job.manifest.manifest_version,
    pipeline_version: job.manifest.pipeline_version,
    field_catalog_version: job.manifest.field_catalog_version,
    field_catalog_sha256: job.manifest.field_catalog_sha256,
    expected_documents: job.manifest.expected_documents,
    staged_documents: job.uploads.length,
    input_manifest_sha256: job.inputManifestSha256 ?? null,
    status: job.status,
    ...extra,
  });
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://runner.invalid');
    if (request.method === 'GET' && url.pathname === '/health') {
      events.push('health');
      return json(response, 200, {
        schema_version: 'tender_codex_runner_health_v1',
        status: 'ready',
        tools: { codex: 'codex-cli 0.153.4' },
        readiness: { execute: true, isolation_canary: true },
        ...(executionProfile ? { execution_profile: executionProfile } : {}),
      });
    }
    if (request.headers['x-tender-codex-token'] !== authToken) {
      return json(response, 401, { error: { code: 'RUNNER_AUTH_REQUIRED' } });
    }
    if (request.method === 'PUT' && url.pathname === '/v1/jobs') {
      if (
        Number.isSafeInteger(failCreateAfterTerminalJobs)
        && terminalJobs >= failCreateAfterTerminalJobs
      ) {
        return json(response, 503, { error: { code: 'RUNNER_TEST_UNAVAILABLE' } });
      }
      const manifest = JSON.parse((await collectBody(request)).toString('utf8'));
      const existing = jobs.get(manifest.job_id);
      if (existing && existing.status !== 'staging') {
        return json(response, 409, { error: { code: 'RUNNER_JOB_SEALED' } });
      }
      const job = existing ?? {
        manifest,
        polls: 0,
        uploads: [],
        status: 'staging',
      };
      jobs.set(manifest.job_id, job);
      events.push(`create:${manifest.job_id}`);
      return json(response, 201, publicJobState(job));
    }
    const documentMatch = /^\/v1\/jobs\/([^/]+)\/documents\/([^/]+)$/u.exec(url.pathname);
    if (request.method === 'PUT' && documentMatch) {
      activeUploads += 1;
      maximumActiveUploads = Math.max(maximumActiveUploads, activeUploads);
      const body = await collectBody(request);
      activeUploads -= 1;
      const job = jobs.get(documentMatch[1]);
      job.uploads.push({ artifactKey: documentMatch[2], bytes: body });
      events.push(`upload:${documentMatch[1]}:${documentMatch[2]}`);
      return json(response, 200, {
        job_id: documentMatch[1],
        artifact_key: documentMatch[2],
        byte_size: body.length,
        sha256: createHash('sha256').update(body).digest('hex').toUpperCase(),
      });
    }
    const actionMatch = /^\/v1\/jobs\/([^/]+)\/(seal|start|result)$/u.exec(url.pathname);
    if (actionMatch && request.method === 'POST' && actionMatch[2] === 'seal') {
      const job = jobs.get(actionMatch[1]);
      job.status = 'ready';
      job.inputManifestSha256 = 'B'.repeat(64);
      events.push(`seal:${actionMatch[1]}`);
      return json(response, 200, publicJobState(job));
    }
    if (actionMatch && request.method === 'POST' && actionMatch[2] === 'start') {
      const job = jobs.get(actionMatch[1]);
      job.status = 'running';
      events.push(`start:${actionMatch[1]}`);
      return json(response, 202, publicJobState(job, { attempt: 1 }));
    }
    if (actionMatch && request.method === 'GET' && actionMatch[2] === 'result') {
      const artifacts = resultArtifacts(jobs.get(actionMatch[1]));
      events.push(`result:${actionMatch[1]}`);
      return json(response, 200, {
        job_id: actionMatch[1],
        result: artifacts.result,
        validation: artifacts.validation,
      });
    }
    const statusMatch = /^\/v1\/jobs\/([^/]+)$/u.exec(url.pathname);
    if (request.method === 'GET' && statusMatch) {
      const job = jobs.get(statusMatch[1]);
      if (!job) return json(response, 404, { error: { code: 'RUNNER_JOB_NOT_FOUND' } });
      job.polls += 1;
      const status = TERMINAL_FOR_TEST.has(job.status)
        ? job.status
        : job.polls === 1
          ? 'running'
          : terminalStatus;
      job.status = status;
      events.push(`status:${statusMatch[1]}:${status}`);
      if (status === terminalStatus) {
        if (!terminalRecorded.has(statusMatch[1])) {
          terminalRecorded.add(statusMatch[1]);
          terminalJobs += 1;
        }
        const artifacts = resultArtifacts(job);
        const auditDirectory = path.join(runnerJobsRoot, statusMatch[1], 'audit');
        await mkdir(auditDirectory, { recursive: true });
        await writeFile(
          path.join(auditDirectory, 'codex-events.attempt-1.jsonl'),
          '{"type":"fake-run"}\n',
          'utf8',
        );
        await writeFile(
          path.join(auditDirectory, 'validated-result.attempt-1.json'),
          artifacts.rawResultBytes,
        );
        await writeFile(
          path.join(auditDirectory, 'validation.attempt-1.json'),
          `${canonicalJson(artifacts.validation)}\n`,
          'utf8',
        );
        await writeFile(
          path.join(runnerJobsRoot, statusMatch[1], 'job-state.json'),
          `${JSON.stringify({
            manifest: job.manifest,
            status,
            input_manifest_sha256: job.inputManifestSha256,
            result: status === 'completed'
              ? {
                  attempt: 1,
                  raw_result_sha256: artifacts.validation.raw_result_sha256,
                  validated_result_sha256: artifacts.validation.validated_result_sha256,
                  validation_file_sha256: createHash('sha256')
                    .update(`${canonicalJson(artifacts.validation)}\n`, 'utf8')
                    .digest('hex')
                    .toUpperCase(),
                }
              : null,
          })}\n`,
          'utf8',
        );
        if (archiveSymlink) {
          const jobRoot = path.join(runnerJobsRoot, statusMatch[1]);
          const workspaceDirectory = path.join(jobRoot, 'workspace');
          await mkdir(workspaceDirectory, { recursive: true });
          const targetPath = archiveSymlink === 'internal'
            ? path.join(jobRoot, 'audit', 'codex-events.attempt-1.jsonl')
            : archiveSymlink === 'external'
              ? path.join(runnerJobsRoot, 'outside-job.txt')
              : archiveSymlink === 'special'
                ? path.join(jobRoot, 'audit', 'special-target')
                : path.join(jobRoot, 'audit', 'missing-target');
          if (archiveSymlink === 'external') {
            await writeFile(targetPath, 'outside job\n', 'utf8');
          } else if (archiveSymlink === 'special') {
            await execFileAsync('mkfifo', [targetPath]);
          }
          await symlink(
            path.relative(workspaceDirectory, targetPath),
            path.join(workspaceDirectory, 'source-alias'),
            'file',
          );
        }
      }
      return json(response, 200, publicJobState(job, {
        attempt: 1,
        usage: {
          input_tokens: 100,
          cached_input_tokens: 80,
          output_tokens: 20,
        },
        ...statusOverrides,
      }));
    }
    return json(response, 404, { error: { code: 'RUNNER_ROUTE_NOT_FOUND' } });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))),
    events,
    jobs,
    maximumActiveUploads: () => maximumActiveUploads,
  };
}

async function prepareFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agentic-shadow-batch-'));
  const sourceRoot = path.join(root, 'sources');
  const controlsRoot = path.join(root, 'controls');
  const runnerJobsRoot = path.join(root, 'runner-jobs');
  const outputRoot = path.join(root, 'output');
  await mkdir(controlsRoot, { recursive: true });
  await mkdir(runnerJobsRoot, { recursive: true });
  const controlPaths = {};
  for (const name of ['field_catalog', 'prompt', 'skill', 'result_schema']) {
    const filePath = path.join(controlsRoot, `${name}.txt`);
    await writeFile(filePath, `${name} fixture\n`, 'utf8');
    controlPaths[`${name}_path`] = filePath;
  }
  const cases = [];
  for (const [caseIndex, caseId] of ['procurement-02', 'procurement-03'].entries()) {
    const documents = path.join(sourceRoot, caseId, 'documents');
    await mkdir(documents, { recursive: true });
    await writeFile(path.join(documents, `source-${caseIndex + 1}.pdf`), `pdf-${caseId}`, 'utf8');
    await writeFile(path.join(documents, `source-${caseIndex + 1}.docx`), `docx-${caseId}`, 'utf8');
    cases.push({
      case_id: caseId,
      procurement_key: caseId,
      source_root: documents,
      replicates: 2,
      adjudication: null,
    });
  }
  const configPath = path.join(root, 'batch-config.json');
  await writeFile(configPath, `${JSON.stringify({
    schema_version: 'agentic_shadow_batch_v1',
    batch_id: 'shadow-baseline-v1',
    controls: {
      model: 'gpt-5.6-sol',
      reasoning_effort: 'high',
      codex_cli_version: '0.153.4',
      ...controlPaths,
    },
    cases,
  })}\n`, 'utf8');
  return { root, configPath, runnerJobsRoot, outputRoot };
}

test('batch driver stages multiple procurements sequentially and archives every completed replicate', async () => {
  const fixture = await prepareFixture();
  const runner = await startFakeRunner({ runnerJobsRoot: fixture.runnerJobsRoot });
  try {
    const { runAgenticShadowBatch } = await import(pathToFileURL(batchScriptPath).href);
    const summary = await runAgenticShadowBatch({
      configPath: fixture.configPath,
      outputRoot: fixture.outputRoot,
      runnerBaseUrl: runner.baseUrl,
      runnerJobsRoot: fixture.runnerJobsRoot,
      authToken,
      pollIntervalMs: 1,
      pollTimeoutMs: 5_000,
    });

    assert.equal(summary.ok, true);
    assert.equal(summary.case_count, 2);
    assert.equal(summary.replicate_count, 4);
    assert.equal(Object.hasOwn(summary.runner_execution_profile, 'unexpected_field'), false);
    assert.equal(runner.maximumActiveUploads(), 1);
    assert.equal(new Set(summary.runs.map(({ job_id: jobId }) => jobId)).size, 4);
    const metadataRuns = await Promise.all(summary.runs.map(async (run) => JSON.parse(await readFile(
      path.join(
        fixture.outputRoot,
        'cases',
        run.case_id,
        `replicate-${String(run.replicate_index).padStart(2, '0')}`,
        'run-metadata.json',
      ),
      'utf8',
    ))));
    assert.equal(new Set(metadataRuns.map(({ analysis_run_id: runId }) => runId)).size, 4);
    assert.deepEqual(
      summary.runs.map(({ case_id: caseId, replicate_index: replicateIndex }) => [caseId, replicateIndex]),
      [
        ['procurement-02', 1],
        ['procurement-02', 2],
        ['procurement-03', 1],
        ['procurement-03', 2],
      ],
    );

    const index = JSON.parse(await readFile(
      path.join(fixture.outputRoot, 'evaluation-index.json'),
      'utf8',
    ));
    assert.equal(index.schema_version, 'agentic_shadow_evaluation_index_v1');
    assert.equal(index.cases.length, 2);
    assert.ok(index.cases.every(({ replicates }) => replicates.length === 2));
    for (const run of summary.runs) {
      const replicateDirectory = path.join(
        fixture.outputRoot,
        'cases',
        run.case_id,
        `replicate-${String(run.replicate_index).padStart(2, '0')}`,
      );
      const entries = await readdir(replicateDirectory);
      assert.ok(entries.includes('result.json'));
      assert.ok(entries.includes('validation.json'));
      assert.ok(entries.includes('terminal-status.json'));
      assert.ok(entries.includes('run-metadata.json'));
      assert.ok(entries.includes('archive-sha256.json'));
      assert.equal(
        await stat(path.join(replicateDirectory, 'job', 'job-state.json'))
          .then((metadata) => metadata.isFile()),
        true,
      );
      assert.equal(
        await readFile(
          path.join(replicateDirectory, 'job', 'audit', 'codex-events.attempt-1.jsonl'),
          'utf8',
        ),
        '{"type":"fake-run"}\n',
      );
      const metadata = JSON.parse(await readFile(
        path.join(replicateDirectory, 'run-metadata.json'),
        'utf8',
      ));
      assert.equal(metadata.case_id, run.case_id);
      assert.equal(metadata.replicate_index, run.replicate_index);
      assert.equal(metadata.job_id, run.job_id);
      assert.equal(metadata.controls.model, 'gpt-5.6-sol');
      assert.equal(metadata.controls.reasoning_effort, 'high');
      assert.match(metadata.controls.prompt_sha256, /^[A-F0-9]{64}$/u);
      assert.equal(metadata.token_usage.cached_input_tokens, 80);
      assert.equal(JSON.stringify(metadata).includes(authToken), false);
    }

    const { evaluateAgenticEvaluationRoot } = await import(
      pathToFileURL(evaluatorScriptPath).href
    );
    const evaluated = await evaluateAgenticEvaluationRoot(fixture.outputRoot);
    assert.equal(evaluated.all_structural_pass, true);

    const firstJobEvents = runner.events.filter((event) => event.includes(summary.runs[0].job_id));
    assert.deepEqual(firstJobEvents.map((event) => event.split(':')[0]), [
      'create',
      'upload',
      'upload',
      'seal',
      'start',
      'status',
      'status',
      'result',
    ]);
  } finally {
    await runner.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('batch driver preserves a failed terminal replicate in the evaluation index and audit archive', async () => {
  const fixture = await prepareFixture();
  const config = JSON.parse(await readFile(fixture.configPath, 'utf8'));
  config.cases = [{ ...config.cases[0], replicates: 1 }];
  await writeFile(fixture.configPath, `${JSON.stringify(config)}\n`, 'utf8');
  const runner = await startFakeRunner({
    runnerJobsRoot: fixture.runnerJobsRoot,
    terminalStatus: 'failed',
  });
  try {
    const { runAgenticShadowBatch } = await import(pathToFileURL(batchScriptPath).href);
    const summary = await runAgenticShadowBatch({
      configPath: fixture.configPath,
      outputRoot: fixture.outputRoot,
      runnerBaseUrl: runner.baseUrl,
      runnerJobsRoot: fixture.runnerJobsRoot,
      authToken,
      pollIntervalMs: 1,
      pollTimeoutMs: 5_000,
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.runs[0].terminal_status, 'failed');
    assert.equal(summary.runs[0].result, null);
    const index = JSON.parse(await readFile(
      path.join(fixture.outputRoot, 'evaluation-index.json'),
      'utf8',
    ));
    assert.deepEqual(index.cases[0].replicates, [{
      replicate_index: 1,
      job_id: summary.runs[0].job_id,
      terminal_status: 'failed',
      result: null,
    }]);
    const replicateDirectory = path.join(
      fixture.outputRoot,
      'cases',
      'procurement-02',
      'replicate-01',
    );
    assert.equal(
      JSON.parse(await readFile(path.join(replicateDirectory, 'terminal-status.json'), 'utf8')).status,
      'failed',
    );
    assert.equal(
      await readFile(path.join(replicateDirectory, 'job', 'audit', 'codex-events.attempt-1.jsonl'), 'utf8'),
      '{"type":"fake-run"}\n',
    );
    await assert.rejects(readFile(path.join(replicateDirectory, 'result.json'), 'utf8'));

    const { evaluateAgenticEvaluationRoot } = await import(
      pathToFileURL(evaluatorScriptPath).href
    );
    const evaluation = await evaluateAgenticEvaluationRoot(fixture.outputRoot);
    assert.equal(evaluation.case_count, 1);
    assert.equal(evaluation.replicate_count, 1);
    assert.equal(evaluation.all_structural_pass, false);
    assert.deepEqual(evaluation.cases[0].replicates[0].evaluation, {
      ok: false,
      structural_pass: false,
      error: {
        type: 'terminal-run-failure',
        code: 'REPLICATE_NOT_COMPLETED',
        message: 'Replicate ended with terminal status failed.',
      },
    });
  } finally {
    await runner.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test(
  'batch driver preserves and inventories a relative symlink whose target stays inside the terminal job',
  { skip: process.platform === 'win32' ? 'Windows test host cannot create file symlinks' : false },
  async () => {
    const fixture = await prepareFixture();
    const config = JSON.parse(await readFile(fixture.configPath, 'utf8'));
    config.cases = [{ ...config.cases[0], replicates: 1 }];
    await writeFile(fixture.configPath, `${JSON.stringify(config)}\n`, 'utf8');
    const runner = await startFakeRunner({
      runnerJobsRoot: fixture.runnerJobsRoot,
      archiveSymlink: 'internal',
    });
    try {
      const { runAgenticShadowBatch } = await import(pathToFileURL(batchScriptPath).href);
      await runAgenticShadowBatch({
        configPath: fixture.configPath,
        outputRoot: fixture.outputRoot,
        runnerBaseUrl: runner.baseUrl,
        runnerJobsRoot: fixture.runnerJobsRoot,
        authToken,
        pollIntervalMs: 1,
        pollTimeoutMs: 5_000,
      });

      const replicateDirectory = path.join(
        fixture.outputRoot,
        'cases',
        'procurement-02',
        'replicate-01',
      );
      const archivedLink = path.join(replicateDirectory, 'job', 'workspace', 'source-alias');
      assert.equal((await lstat(archivedLink)).isSymbolicLink(), true);
      assert.equal(
        await readlink(archivedLink),
        path.join('..', 'audit', 'codex-events.attempt-1.jsonl'),
      );
      const inventory = JSON.parse(await readFile(
        path.join(replicateDirectory, 'archive-sha256.json'),
        'utf8',
      ));
      assert.deepEqual(
        inventory.files.find(({ path: entryPath }) => entryPath === 'workspace/source-alias'),
        {
          path: 'workspace/source-alias',
          entry_type: 'symlink',
          link_target: '../audit/codex-events.attempt-1.jsonl',
        },
      );
      const { evaluateAgenticEvaluationRoot } = await import(
        pathToFileURL(evaluatorScriptPath).href
      );
      const evaluated = await evaluateAgenticEvaluationRoot(fixture.outputRoot);
      assert.equal(evaluated.all_structural_pass, true);
      assert.equal(evaluated.cases[0].replicates[0].evaluation.ok, true);
    } finally {
      await runner.close();
      await rm(fixture.root, { recursive: true, force: true });
    }
  },
);

test(
  'batch driver rejects a terminal job symlink that escapes the runner job root',
  { skip: process.platform === 'win32' ? 'Windows test host cannot create file symlinks' : false },
  async () => {
    const fixture = await prepareFixture();
    const config = JSON.parse(await readFile(fixture.configPath, 'utf8'));
    config.cases = [{ ...config.cases[0], replicates: 1 }];
    await writeFile(fixture.configPath, `${JSON.stringify(config)}\n`, 'utf8');
    const runner = await startFakeRunner({
      runnerJobsRoot: fixture.runnerJobsRoot,
      archiveSymlink: 'external',
    });
    try {
      const { runAgenticShadowBatch } = await import(pathToFileURL(batchScriptPath).href);
      await assert.rejects(
        runAgenticShadowBatch({
          configPath: fixture.configPath,
          outputRoot: fixture.outputRoot,
          runnerBaseUrl: runner.baseUrl,
          runnerJobsRoot: fixture.runnerJobsRoot,
          authToken,
          pollIntervalMs: 1,
          pollTimeoutMs: 5_000,
        }),
        (error) => error.code === 'RUNNER_ARCHIVE_INVALID',
      );
    } finally {
      await runner.close();
      await rm(fixture.root, { recursive: true, force: true });
    }
  },
);

test(
  'batch driver rejects a broken terminal job symlink',
  { skip: process.platform === 'win32' ? 'Windows test host cannot create file symlinks' : false },
  async () => {
    const fixture = await prepareFixture();
    const config = JSON.parse(await readFile(fixture.configPath, 'utf8'));
    config.cases = [{ ...config.cases[0], replicates: 1 }];
    await writeFile(fixture.configPath, `${JSON.stringify(config)}\n`, 'utf8');
    const runner = await startFakeRunner({
      runnerJobsRoot: fixture.runnerJobsRoot,
      archiveSymlink: 'broken',
    });
    try {
      const { runAgenticShadowBatch } = await import(pathToFileURL(batchScriptPath).href);
      await assert.rejects(
        runAgenticShadowBatch({
          configPath: fixture.configPath,
          outputRoot: fixture.outputRoot,
          runnerBaseUrl: runner.baseUrl,
          runnerJobsRoot: fixture.runnerJobsRoot,
          authToken,
          pollIntervalMs: 1,
          pollTimeoutMs: 5_000,
        }),
        (error) => error.code === 'RUNNER_ARCHIVE_INVALID',
      );
    } finally {
      await runner.close();
      await rm(fixture.root, { recursive: true, force: true });
    }
  },
);

test(
  'batch driver rejects a terminal job containing a special-file symlink target',
  { skip: process.platform === 'win32' ? 'Windows test host cannot create FIFO files' : false },
  async () => {
    const fixture = await prepareFixture();
    const config = JSON.parse(await readFile(fixture.configPath, 'utf8'));
    config.cases = [{ ...config.cases[0], replicates: 1 }];
    await writeFile(fixture.configPath, `${JSON.stringify(config)}\n`, 'utf8');
    const runner = await startFakeRunner({
      runnerJobsRoot: fixture.runnerJobsRoot,
      archiveSymlink: 'special',
    });
    try {
      const { runAgenticShadowBatch } = await import(pathToFileURL(batchScriptPath).href);
      await assert.rejects(
        runAgenticShadowBatch({
          configPath: fixture.configPath,
          outputRoot: fixture.outputRoot,
          runnerBaseUrl: runner.baseUrl,
          runnerJobsRoot: fixture.runnerJobsRoot,
          authToken,
          pollIntervalMs: 1,
          pollTimeoutMs: 5_000,
        }),
        (error) => error.code === 'RUNNER_ARCHIVE_INVALID',
      );
    } finally {
      await runner.close();
      await rm(fixture.root, { recursive: true, force: true });
    }
  },
);

test('batch driver rejects control metadata that does not match the pinned runner', async () => {
  const fixture = await prepareFixture();
  try {
    const config = JSON.parse(await readFile(fixture.configPath, 'utf8'));
    config.controls.model = 'different-model';
    await writeFile(fixture.configPath, `${JSON.stringify(config)}\n`, 'utf8');
    const { runAgenticShadowBatch } = await import(pathToFileURL(batchScriptPath).href);

    await assert.rejects(
      runAgenticShadowBatch({
        configPath: fixture.configPath,
        outputRoot: fixture.outputRoot,
        runnerBaseUrl: 'http://127.0.0.1:1',
        runnerJobsRoot: fixture.runnerJobsRoot,
        authToken,
        pollIntervalMs: 1,
        pollTimeoutMs: 5_000,
      }),
      (error) => {
        assert.equal(error.code, 'BATCH_RUNNER_CONTROL_MISMATCH');
        assert.equal(error.message.includes('different-model'), false);
        return true;
      },
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('batch driver resumes deterministic completed jobs without uploading or starting them again', async () => {
  const fixture = await prepareFixture();
  const config = JSON.parse(await readFile(fixture.configPath, 'utf8'));
  config.cases = [{ ...config.cases[0], replicates: 1 }];
  await writeFile(fixture.configPath, `${JSON.stringify(config)}\n`, 'utf8');
  const runner = await startFakeRunner({ runnerJobsRoot: fixture.runnerJobsRoot });
  try {
    const { runAgenticShadowBatch } = await import(pathToFileURL(batchScriptPath).href);
    const first = await runAgenticShadowBatch({
      configPath: fixture.configPath,
      outputRoot: fixture.outputRoot,
      runnerBaseUrl: runner.baseUrl,
      runnerJobsRoot: fixture.runnerJobsRoot,
      authToken,
      pollIntervalMs: 1,
      pollTimeoutMs: 5_000,
    });
    runner.events.length = 0;
    const second = await runAgenticShadowBatch({
      configPath: fixture.configPath,
      outputRoot: fixture.outputRoot,
      runnerBaseUrl: runner.baseUrl,
      runnerJobsRoot: fixture.runnerJobsRoot,
      authToken,
      pollIntervalMs: 1,
      pollTimeoutMs: 5_000,
    });

    assert.equal(second.ok, true);
    assert.equal(second.runs[0].job_id, first.runs[0].job_id);
    assert.deepEqual(
      runner.events.map((event) => event.split(':')[0]),
      ['health', 'status', 'result'],
    );
  } finally {
    await runner.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('batch driver fails before staging when runner-owned execution provenance is unavailable', async () => {
  const fixture = await prepareFixture();
  const runner = await startFakeRunner({
    runnerJobsRoot: fixture.runnerJobsRoot,
    executionProfile: null,
  });
  try {
    const { runAgenticShadowBatch } = await import(pathToFileURL(batchScriptPath).href);
    await assert.rejects(
      runAgenticShadowBatch({
        configPath: fixture.configPath,
        outputRoot: fixture.outputRoot,
        runnerBaseUrl: runner.baseUrl,
        runnerJobsRoot: fixture.runnerJobsRoot,
        authToken,
        pollIntervalMs: 1,
        pollTimeoutMs: 5_000,
      }),
      (error) => {
        assert.equal(error.code, 'RUNNER_PROVENANCE_NOT_READY');
        assert.equal(error.message.includes(authToken), false);
        return true;
      },
    );
    assert.deepEqual(runner.events, ['health']);
    assert.equal(runner.jobs.size, 0);
  } finally {
    await runner.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('batch driver resolves junctions before enforcing external source and output roots', async (t) => {
  const fixture = await prepareFixture();
  const runner = await startFakeRunner({ runnerJobsRoot: fixture.runnerJobsRoot });
  const outputJunction = path.join(fixture.root, 'output-junction');
  const sourceJunction = path.join(fixture.root, 'source-junction');
  try {
    try {
      await symlink(repositoryRoot, outputJunction, 'junction');
      await symlink(repositoryRoot, sourceJunction, 'junction');
    } catch (error) {
      if (error?.code === 'EPERM') {
        t.skip('Creating a Windows junction is not permitted in this environment');
        return;
      }
      throw error;
    }
    const { runAgenticShadowBatch } = await import(pathToFileURL(batchScriptPath).href);
    await assert.rejects(
      runAgenticShadowBatch({
        configPath: fixture.configPath,
        outputRoot: outputJunction,
        runnerBaseUrl: runner.baseUrl,
        runnerJobsRoot: fixture.runnerJobsRoot,
        authToken,
        pollIntervalMs: 1,
        pollTimeoutMs: 5_000,
      }),
      (error) => error.code === 'BATCH_OUTPUT_INSIDE_REPOSITORY',
    );

    const config = JSON.parse(await readFile(fixture.configPath, 'utf8'));
    config.cases = [{ ...config.cases[0], source_root: sourceJunction, replicates: 1 }];
    await writeFile(fixture.configPath, `${JSON.stringify(config)}\n`, 'utf8');
    await assert.rejects(
      runAgenticShadowBatch({
        configPath: fixture.configPath,
        outputRoot: fixture.outputRoot,
        runnerBaseUrl: runner.baseUrl,
        runnerJobsRoot: fixture.runnerJobsRoot,
        authToken,
        pollIntervalMs: 1,
        pollTimeoutMs: 5_000,
      }),
      (error) => error.code === 'BATCH_SOURCE_INSIDE_REPOSITORY',
    );
  } finally {
    await runner.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('offline evaluator reports archived file and validation identity mismatches as structural issues', async () => {
  const fixture = await prepareFixture();
  const config = JSON.parse(await readFile(fixture.configPath, 'utf8'));
  config.cases = [{ ...config.cases[0], replicates: 1 }];
  await writeFile(fixture.configPath, `${JSON.stringify(config)}\n`, 'utf8');
  const runner = await startFakeRunner({ runnerJobsRoot: fixture.runnerJobsRoot });
  try {
    const { runAgenticShadowBatch } = await import(pathToFileURL(batchScriptPath).href);
    await runAgenticShadowBatch({
      configPath: fixture.configPath,
      outputRoot: fixture.outputRoot,
      runnerBaseUrl: runner.baseUrl,
      runnerJobsRoot: fixture.runnerJobsRoot,
      authToken,
      pollIntervalMs: 1,
      pollTimeoutMs: 5_000,
    });
    const replicateDirectory = path.join(
      fixture.outputRoot,
      'cases',
      'procurement-02',
      'replicate-01',
    );
    const validationPath = path.join(replicateDirectory, 'validation.json');
    const validation = JSON.parse(await readFile(validationPath, 'utf8'));
    validation.job_id = '00000000-0000-4000-8000-000000000000';
    await writeFile(validationPath, `${JSON.stringify(validation)}\n`, 'utf8');
    await writeFile(
      path.join(replicateDirectory, 'job', 'audit', 'codex-events.attempt-1.jsonl'),
      '{"type":"tampered"}\n',
      'utf8',
    );
    const resultPath = path.join(replicateDirectory, 'result.json');
    const result = JSON.parse(await readFile(resultPath, 'utf8'));
    result.analysis_run_id = '00000000-0000-4000-8000-000000000000';
    await writeFile(resultPath, `${JSON.stringify(result)}\n`, 'utf8');

    const { evaluateAgenticEvaluationRoot } = await import(
      pathToFileURL(evaluatorScriptPath).href
    );
    const evaluated = await evaluateAgenticEvaluationRoot(fixture.outputRoot);
    const replicate = evaluated.cases[0].replicates[0];
    assert.equal(evaluated.all_structural_pass, false);
    assert.equal(replicate.evaluation.structural_pass, false);
    assert.ok(replicate.evaluation.structural_issues.includes('VALIDATION_IDENTITY_MISMATCH'));
    assert.ok(replicate.evaluation.structural_issues.includes('ARCHIVE_FILE_INTEGRITY_MISMATCH'));
    assert.ok(replicate.evaluation.structural_issues.includes('RESULT_VALIDATION_HASH_MISMATCH'));
  } finally {
    await runner.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('batch driver rejects a resumed runner job whose manifest identity does not match', async () => {
  const fixture = await prepareFixture();
  const config = JSON.parse(await readFile(fixture.configPath, 'utf8'));
  config.cases = [{ ...config.cases[0], replicates: 1 }];
  await writeFile(fixture.configPath, `${JSON.stringify(config)}\n`, 'utf8');
  const runner = await startFakeRunner({
    runnerJobsRoot: fixture.runnerJobsRoot,
    statusOverrides: { analysis_run_id: '00000000-0000-4000-8000-000000000000' },
  });
  try {
    const { runAgenticShadowBatch } = await import(pathToFileURL(batchScriptPath).href);
    await assert.rejects(
      runAgenticShadowBatch({
        configPath: fixture.configPath,
        outputRoot: fixture.outputRoot,
        runnerBaseUrl: runner.baseUrl,
        runnerJobsRoot: fixture.runnerJobsRoot,
        authToken,
        pollIntervalMs: 1,
        pollTimeoutMs: 5_000,
      }),
      (error) => error.code === 'RUNNER_IDENTITY_MISMATCH',
    );
  } finally {
    await runner.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('batch driver checkpoints completed replicates before a later transport failure', async () => {
  const fixture = await prepareFixture();
  const config = JSON.parse(await readFile(fixture.configPath, 'utf8'));
  config.cases = config.cases.map((entry) => ({ ...entry, replicates: 1 }));
  await writeFile(fixture.configPath, `${JSON.stringify(config)}\n`, 'utf8');
  const runner = await startFakeRunner({
    runnerJobsRoot: fixture.runnerJobsRoot,
    failCreateAfterTerminalJobs: 1,
  });
  try {
    const { runAgenticShadowBatch } = await import(pathToFileURL(batchScriptPath).href);
    await assert.rejects(
      runAgenticShadowBatch({
        configPath: fixture.configPath,
        outputRoot: fixture.outputRoot,
        runnerBaseUrl: runner.baseUrl,
        runnerJobsRoot: fixture.runnerJobsRoot,
        authToken,
        pollIntervalMs: 1,
        pollTimeoutMs: 5_000,
      }),
      (error) => error.code === 'RUNNER_TEST_UNAVAILABLE',
    );
    const index = JSON.parse(await readFile(
      path.join(fixture.outputRoot, 'evaluation-index.json'),
      'utf8',
    ));
    assert.equal(index.cases.length, 1);
    assert.equal(index.cases[0].case_id, 'procurement-02');
    assert.equal(index.cases[0].replicates.length, 1);
    assert.equal(index.cases[0].replicates[0].terminal_status, 'completed');
  } finally {
    await runner.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('offline evaluator rejects a coherent result and validation rewrite outside the runner archive', async () => {
  const fixture = await prepareFixture();
  const config = JSON.parse(await readFile(fixture.configPath, 'utf8'));
  config.cases = [{ ...config.cases[0], replicates: 1 }];
  await writeFile(fixture.configPath, `${JSON.stringify(config)}\n`, 'utf8');
  const runner = await startFakeRunner({ runnerJobsRoot: fixture.runnerJobsRoot });
  try {
    const { runAgenticShadowBatch } = await import(pathToFileURL(batchScriptPath).href);
    await runAgenticShadowBatch({
      configPath: fixture.configPath,
      outputRoot: fixture.outputRoot,
      runnerBaseUrl: runner.baseUrl,
      runnerJobsRoot: fixture.runnerJobsRoot,
      authToken,
      pollIntervalMs: 1,
      pollTimeoutMs: 5_000,
    });
    const replicateDirectory = path.join(
      fixture.outputRoot,
      'cases',
      'procurement-02',
      'replicate-01',
    );
    const resultPath = path.join(replicateDirectory, 'result.json');
    const validationPath = path.join(replicateDirectory, 'validation.json');
    const result = JSON.parse(await readFile(resultPath, 'utf8'));
    const validation = JSON.parse(await readFile(validationPath, 'utf8'));
    result.limitations = ['coherent external rewrite'];
    validation.validated_result_sha256 = createHash('sha256')
      .update(canonicalJson(result), 'utf8')
      .digest('hex')
      .toUpperCase();
    await writeFile(resultPath, `${JSON.stringify(result)}\n`, 'utf8');
    await writeFile(validationPath, `${JSON.stringify(validation)}\n`, 'utf8');

    const { evaluateAgenticEvaluationRoot } = await import(
      pathToFileURL(evaluatorScriptPath).href
    );
    const evaluated = await evaluateAgenticEvaluationRoot(fixture.outputRoot);
    const issues = evaluated.cases[0].replicates[0].evaluation.structural_issues;
    assert.equal(evaluated.all_structural_pass, false);
    assert.ok(issues.includes('ARCHIVED_RESULT_CHAIN_MISMATCH'));
  } finally {
    await runner.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});
