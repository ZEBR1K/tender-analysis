import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  requestOfficeRender,
} from '../deploy/codex-runner/agent-template/.agents/skills/tender-document-analysis/scripts/render-office.mjs';
import {
  runLibreOfficeConversion,
  startOfficeRenderBroker,
} from '../deploy/codex-runner/src/office-render-broker.mjs';

const jobId = '12345678-1234-4234-9234-123456789abc';

test('runner-side LibreOffice call is shell-free, bounded, and uses private temporary storage', async () => {
  const current = await fixture();
  let invocation;
  try {
    await runLibreOfficeConversion({
      requestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      source: path.join(current.input, 'source.docx'),
      outputDirectory: current.output,
      runtimeDirectory: current.runtime,
      execute: async (...args) => { invocation = args; },
    });
    assert.equal(invocation[0], 'unshare');
    assert.deepEqual(invocation[1].slice(0, 6), [
      '--user',
      '--map-root-user',
      '--net',
      '--fork',
      '--',
      'libreoffice',
    ]);
    assert.equal(invocation[1].includes('--pid'), false);
    assert.equal(invocation[1].includes('--mount-proc'), false);
    assert.match(invocation[1][6], /^-env:UserInstallation=file:\/\//u);
    assert.deepEqual(invocation[1].slice(7), [
      '--headless',
      '--convert-to',
      'pdf',
      '--outdir',
      current.output,
      path.join(current.input, 'source.docx'),
    ]);
    assert.equal(invocation[2].timeout, 120_000);
    assert.equal(invocation[2].env.TMPDIR, '/tmp');
    assert.equal(invocation[2].env.SAL_USE_VCLPLUGIN, 'svp');
    assert.equal('TENDER_CODEX_RUNNER_AUTH_TOKEN_FILE' in invocation[2].env, false);
  } finally {
    await rm(current.root, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'office-broker-'));
  const jobsRoot = path.join(root, 'jobs');
  const jobDirectory = path.join(jobsRoot, jobId);
  const workspace = path.join(jobDirectory, 'workspace');
  const input = path.join(jobDirectory, 'input');
  const runtime = path.join(root, 'runtime');
  const output = path.join(workspace, '.tmp', 'document-tools', 'office-render-test');
  await Promise.all([
    mkdir(workspace, { recursive: true }),
    mkdir(input, { recursive: true }),
    mkdir(runtime, { recursive: true }),
    mkdir(output, { recursive: true }),
  ]);
  return { root, jobsRoot, jobDirectory, workspace, input, runtime, output };
}

test('Office broker converts only a current-job source and returns through job-local files', async () => {
  const current = await fixture();
  const source = path.join(current.workspace, '.tmp', 'source.docx');
  await writeFile(source, 'sealed-office-source');
  const calls = [];
  const broker = await startOfficeRenderBroker({
    jobId,
    jobsRoot: current.jobsRoot,
    runtimeDirectory: current.runtime,
    pollIntervalMs: 5,
    executeLibreOffice: async (request) => {
      calls.push(request);
      await writeFile(path.join(request.outputDirectory, 'source.pdf'), '%PDF-smoke');
    },
  });
  try {
    const response = await requestOfficeRender({
      source,
      outputDirectory: current.output,
      runtimeDirectory: current.runtime,
      requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      pollIntervalMs: 5,
      timeoutMs: 2_000,
      resolveRuntimeDirectory: ({ TENDER_OFFICE_RUNTIME_DIR }) => TENDER_OFFICE_RUNTIME_DIR,
    });
    assert.equal(response.status, 'ok');
    assert.equal(calls.length, 1);
    assert.notEqual(calls[0].source, source);
    assert.equal(path.extname(calls[0].source), '.docx');
    assert.notEqual(calls[0].outputDirectory, current.output);
    assert.equal(
      await readFile(path.join(current.output, 'office-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf'), 'utf8'),
      '%PDF-smoke',
    );
  } finally {
    await broker.close();
    await rm(current.root, { recursive: true, force: true });
  }
});

test('Office broker rejects a source from a sibling job before LibreOffice runs', async () => {
  const current = await fixture();
  const sibling = path.join(current.jobsRoot, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  const siblingSource = path.join(sibling, 'workspace', 'secret.docx');
  await mkdir(path.dirname(siblingSource), { recursive: true });
  await writeFile(siblingSource, 'sibling-secret');
  let executeCount = 0;
  const broker = await startOfficeRenderBroker({
    jobId,
    jobsRoot: current.jobsRoot,
    runtimeDirectory: current.runtime,
    pollIntervalMs: 5,
    executeLibreOffice: async () => { executeCount += 1; },
  });
  try {
    await assert.rejects(requestOfficeRender({
      source: siblingSource,
      outputDirectory: current.output,
      runtimeDirectory: current.runtime,
      requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      pollIntervalMs: 5,
      timeoutMs: 2_000,
      resolveRuntimeDirectory: ({ TENDER_OFFICE_RUNTIME_DIR }) => TENDER_OFFICE_RUNTIME_DIR,
    }), /broker rejected/iu);
    assert.equal(executeCount, 0);
  } finally {
    await broker.close();
    await rm(current.root, { recursive: true, force: true });
  }
});

test('Office broker rejects output paths outside workspace temporary artifacts', async () => {
  const current = await fixture();
  const source = path.join(current.input, 'source.docx');
  const outside = path.join(current.root, 'outside');
  await Promise.all([writeFile(source, 'source'), mkdir(outside)]);
  let executeCount = 0;
  const broker = await startOfficeRenderBroker({
    jobId,
    jobsRoot: current.jobsRoot,
    runtimeDirectory: current.runtime,
    pollIntervalMs: 5,
    executeLibreOffice: async () => { executeCount += 1; },
  });
  try {
    await assert.rejects(requestOfficeRender({
      source,
      outputDirectory: outside,
      runtimeDirectory: current.runtime,
      requestId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      pollIntervalMs: 5,
      timeoutMs: 2_000,
      resolveRuntimeDirectory: ({ TENDER_OFFICE_RUNTIME_DIR }) => TENDER_OFFICE_RUNTIME_DIR,
    }), /broker rejected/iu);
    assert.equal(executeCount, 0);
  } finally {
    await broker.close();
    await rm(current.root, { recursive: true, force: true });
  }
});
