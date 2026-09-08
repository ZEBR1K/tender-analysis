import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testsDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testsDirectory, '..');
const runnerDirectory = path.join(repositoryRoot, 'deploy', 'codex-runner');
const dockerfilePath = path.join(runnerDirectory, 'Dockerfile');
const composePath = path.join(runnerDirectory, 'compose.yaml');
const authSourcePath = path.join(runnerDirectory, 'src', 'http-auth.mjs');

test('runner image pins Node, Codex CLI and every document inspection tool', async () => {
  const dockerfile = await readFile(dockerfilePath, 'utf8');

  assert.match(dockerfile, /^FROM node:24\.18\.0-bookworm-slim$/mu);
  assert.match(dockerfile, /@openai\/codex@0\.153\.4/u);
  assert.match(dockerfile, /poppler-utils=22\.12\.0-2\+deb12u3/u);
  assert.match(dockerfile, /libreoffice-core=4:7\.4\.7-1\+deb12u14/u);
  assert.match(dockerfile, /libreoffice-writer=4:7\.4\.7-1\+deb12u14/u);
  assert.match(dockerfile, /libreoffice-calc=4:7\.4\.7-1\+deb12u14/u);
  assert.match(dockerfile, /tesseract-ocr=5\.3\.0-2/u);
  assert.match(dockerfile, /tesseract-ocr-eng=1:4\.1\.0-2/u);
  assert.match(dockerfile, /tesseract-ocr-rus=1:4\.1\.0-2/u);
  assert.match(dockerfile, /npm ci --omit=dev/u);
  assert.match(dockerfile, /USER 10001:10001/u);
  assert.match(dockerfile, /CMD \["node", "src\/server\.mjs"\]/u);
});

test('runner Compose boundary is internal-only, least-privilege and resource bounded', async () => {
  const compose = await readFile(composePath, 'utf8');

  assert.doesNotMatch(compose, /^\s*ports:/mu);
  assert.match(compose, /container_name:\s+tender-codex-runner/u);
  assert.match(compose, /read_only:\s*true/u);
  assert.match(compose, /user:\s*"10001:10001"/u);
  assert.match(compose, /cap_drop:\s*\r?\n\s*- ALL/u);
  assert.match(compose, /no-new-privileges:true/u);
  assert.match(compose, /healthcheck:/u);
  assert.match(compose, /\/opt\/tender-codex-runner\/jobs:\/data\/jobs/u);
  assert.doesNotMatch(compose, /^\s*tmpfs:/mu);
  assert.equal((compose.match(/^\s*volumes:/gmu) || []).length, 1);
  assert.match(compose, /cpus:\s*1\.0/u);
  assert.match(compose, /memory:\s*1536M/u);
  assert.match(compose, /pids_limit:\s*192/u);
  assert.match(compose, /n8n_default:\s*\r?\n\s*external:\s*true/u);
  assert.doesNotMatch(compose, /^\s+(N8N_|POSTGRES|SUPABASE|TENDERPLAN|TELEGRAM)[A-Z0-9_]*:/mu);
});

test('runner uses constant-time Header Auth for protected routes', async () => {
  const authSource = await readFile(authSourcePath, 'utf8');
  assert.match(authSource, /timingSafeEqual/u);
  assert.match(authSource, /x-tender-codex-token/iu);
});

test('runner Compose passes the Docker Compose parser', (context) => {
  const version = spawnSync('docker', ['compose', 'version'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (version.error?.code === 'ENOENT' || version.status !== 0) {
    context.skip('Docker Compose CLI is unavailable in this environment');
    return;
  }

  const validation = spawnSync(
    'docker',
    ['compose', '-p', 'tender-codex-runner-test', '-f', composePath, 'config', '-q'],
    {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, TENDER_CODEX_RUNNER_AUTH_TOKEN: 'compose-validation-placeholder' },
    },
  );
  assert.equal(
    validation.status,
    0,
    `docker compose config failed:\n${validation.stdout}${validation.stderr}`,
  );
});
