import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testsDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testsDirectory, '..');
const composePath = path.join(repositoryRoot, 'deploy', 'gotenberg', 'compose.yaml');

test('Gotenberg compose is internal-only, pinned, and resource-bounded', () => {
  const compose = fs.readFileSync(composePath, 'utf8');

  assert.match(compose, /gotenberg\/gotenberg:8\.36\.0-chromium/u);
  assert.match(compose, /container_name:\s+tender-pdf-gotenberg/u);
  assert.doesNotMatch(compose, /^\s*ports:/mu);
  assert.match(compose, /n8n_default:\s*\n\s*external:\s*true/u);
  assert.match(compose, /memory:\s*512M/u);
  assert.match(compose, /cpus:\s*0\.5/u);
  assert.match(compose, /pids_limit:\s*128/u);
  assert.match(compose, /shm_size:\s*128m/u);
  assert.match(compose, /oom_score_adj:\s*500/u);

  for (const flag of [
    '--api-timeout=120s',
    '--api-body-limit=5MB',
    '--api-disable-download-from=true',
    '--webhook-disable=true',
    '--chromium-max-concurrency=1',
    '--chromium-max-queue-size=1',
    '--chromium-auto-start=false',
    '--chromium-idle-shutdown-timeout=30s',
    '--chromium-deny-public-ips=true',
    '--chromium-deny-private-ips=true',
    '--chromium-disable-javascript=true',
  ]) {
    assert.match(compose, new RegExp(flag.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  }
});

test('Gotenberg compose passes the Docker Compose parser', (context) => {
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
    ['compose', '-p', 'tender-pdf-test', '-f', composePath, 'config', '-q'],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.equal(
    validation.status,
    0,
    `docker compose config failed:\n${validation.stdout}${validation.stderr}`,
  );
});
