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
const attributesPath = path.join(repositoryRoot, '.gitattributes');
const authSourcePath = path.join(runnerDirectory, 'src', 'http-auth.mjs');
const permissionsSourcePath = path.join(runnerDirectory, 'src', 'permissions.mjs');
const packagePath = path.join(runnerDirectory, 'package.json');
const implementationPlanPath = path.join(
  repositoryRoot,
  'docs',
  'superpowers',
  'plans',
  '2026-09-08-agentic-analysis-stages-3-5.md',
);

test('runner image pins Node, Codex CLI and every document inspection tool', async () => {
  const [dockerfile, attributes, packageJson] = await Promise.all([
    readFile(dockerfilePath, 'utf8'),
    readFile(attributesPath, 'utf8'),
    readFile(packagePath, 'utf8').then(JSON.parse),
  ]);

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
  assert.match(dockerfile, /COPY field-catalog \.\/field-catalog/u);
  assert.match(dockerfile, /COPY probes \.\/probes/u);
  assert.equal(packageJson.scripts['attest:isolation'], 'node src/run-isolation-attestation.mjs');
  assert.match(
    attributes,
    /^deploy\/codex-runner\/field-catalog\/FIELD_CATALOG\.md binary$/mu,
  );
  assert.match(dockerfile, /CODEX_HOME=\/run\/codex-auth/u);
  assert.doesNotMatch(dockerfile, /CODEX_HOME=\/data\/jobs/u);
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
  assert.match(compose, /\/opt\/tender-codex-runner\/secrets\/runner-auth-token:\/run\/secrets\/runner-auth-token:ro/u);
  assert.match(compose, /\/opt\/tender-codex-runner\/secrets\/codex-auth:\/run\/codex-auth:ro/u);
  assert.doesNotMatch(compose, /TENDER_CODEX_RUNNER_AUTH_TOKEN:\s/u);
  assert.doesNotMatch(compose, /^\s*tmpfs:/mu);
  const hostMounts = compose.split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- /opt/tender-codex-runner/'));
  assert.deepEqual(hostMounts.filter((line) => !line.endsWith(':ro')), [
    '- /opt/tender-codex-runner/jobs:/data/jobs',
  ]);
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

test('runner ships a fail-closed Codex permission boundary rather than legacy sandbox flags', async () => {
  const permissionsSource = await readFile(permissionsSourcePath, 'utf8');
  assert.match(permissionsSource, /filesystem\.:root/u);
  assert.match(permissionsSource, /filesystem\.:minimal/u);
  assert.match(permissionsSource, /--ignore-user-config/u);
  assert.match(permissionsSource, /shell_environment_policy/u);
  assert.doesNotMatch(permissionsSource, /dangerously-bypass/u);
});

test('Task 8 consumes the boundary builder and explicitly forbids both legacy sandbox forms', async () => {
  const plan = await readFile(implementationPlanPath, 'utf8');
  const task8 = plan.split('### Task 8:', 2)[1].split('### Task 9:', 1)[0];

  assert.match(task8, /buildCodexPermissionBoundary\(\{ jobId \}\)\.cliArgs/u);
  assert.match(task8, /forbid[^\n]*--sandbox[^\n]*sandbox_workspace_write/iu);
  assert.doesNotMatch(task8, /^\s*--sandbox\s+workspace-write\s*$/mu);
  assert.doesNotMatch(task8, /^\s*-c\s+sandbox_workspace_write\./mu);
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
