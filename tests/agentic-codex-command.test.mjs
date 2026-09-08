import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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
  assert.doesNotMatch(prompt, /https?:\/\//iu);
  assert.doesNotMatch(prompt, /credential|password|secret|token/iu);
  assert.doesNotMatch(prompt, /TenderPlan|n8n|PostgreSQL|Telegram/iu);
  assert.doesNotMatch(prompt, /цена|НДС|лиценз|аналог|гарант/iu);
});

test('runner image contains the dedicated template and prompt', async () => {
  const dockerfile = await readFile(dockerfilePath, 'utf8');
  assert.match(dockerfile, /^COPY agent-template \.\/agent-template$/mu);
  assert.match(dockerfile, /^COPY prompts \.\/prompts$/mu);
});
