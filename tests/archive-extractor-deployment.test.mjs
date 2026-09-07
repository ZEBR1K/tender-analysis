import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dockerfileUrl = new URL('../deploy/archive-extractor/Dockerfile', import.meta.url);
const composeUrl = new URL('../deploy/archive-extractor/compose.yaml', import.meta.url);
const sevenZipUrl = new URL('../deploy/archive-extractor/src/sevenzip.mjs', import.meta.url);

test('Dockerfile pins Node and verifies the exact 7-Zip artifact checksum', async () => {
  const dockerfile = await readFile(dockerfileUrl, 'utf8');
  assert.match(dockerfile, /^FROM node:22\.23\.2-bookworm-slim$/mu);
  assert.match(dockerfile, /https:\/\/github\.com\/ip7z\/7zip\/releases\/download\/26\.03\/7z2603-linux-x64\.tar\.xz/u);
  assert.match(dockerfile, /dc99eff5008f1ab79bd7084c68513701547a808a89502bf4133683535ab3c695/u);
  assert.match(dockerfile, /sha256sum -c/u);
  assert.match(dockerfile, /USER 10001:10001/u);
  assert.match(dockerfile, /CMD \["node", "src\/server\.mjs"\]/u);
});

test('Compose keeps extractor internal-only and resource bounded', async () => {
  const compose = await readFile(composeUrl, 'utf8');
  assert.doesNotMatch(compose, /^\s*ports:/mu);
  assert.match(compose, /read_only:\s*true/u);
  assert.match(compose, /user:\s*"10001:10001"/u);
  assert.match(compose, /cap_drop:\s*\r?\n\s*- ALL/u);
  assert.match(compose, /no-new-privileges:true/u);
  assert.match(compose, /\/opt\/tender-archive-extractor\/data:\/var\/lib\/archive-extractor/u);
  assert.match(compose, /memory:\s*512M/u);
  assert.match(compose, /cpus:\s*0\.50/u);
  assert.match(compose, /pids_limit:\s*64/u);
  assert.match(compose, /external:\s*true/u);
});

test('7-Zip listing keeps technical archive metadata for format detection', async () => {
  const source = await readFile(sevenZipUrl, 'utf8');
  assert.match(source, /capture\(\['l', '-slt', '--', target\]/u);
  assert.doesNotMatch(source, /capture\(\['l', '-slt', '-ba'/u);
});
