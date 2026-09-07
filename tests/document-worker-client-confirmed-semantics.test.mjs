import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..');
const workflowPath = path.join(
  repositoryRoot,
  'workflows',
  'n8n-exports',
  'TENDER — Обработать документ.json',
);

function loadWorkflow() {
  return JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
}

function normalizeLineEndings(value) {
  return value.replace(/\r\n/g, '\n');
}

function nodeCode(workflow, name) {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(node, `Workflow node not found: ${name}`);
  assert.equal(typeof node.parameters?.jsCode, 'string', `${name} has no jsCode`);
  return node.parameters.jsCode;
}

function extractorField(source, fieldKey) {
  const start = source.indexOf(`    key: '${fieldKey}',`);
  assert.notEqual(start, -1, `Extractor field not found: ${fieldKey}`);
  const next = source.indexOf("\n  {\n    key: '", start + 1);
  return source.slice(start, next === -1 ? source.indexOf('\n];', start) : next);
}

function validatorField(source, fieldKey) {
  const start = source.indexOf(`  ${fieldKey}: Object.freeze({`);
  assert.notEqual(start, -1, `Validator profile not found: ${fieldKey}`);
  const next = source.indexOf('\n  }),\n  ', start + 1);
  return source.slice(start, next === -1 ? source.indexOf('\n};', start) : next + 5);
}

const workflow = loadWorkflow();
const extractorSource = nodeCode(workflow, 'Подготовить запрос для AI');
const validatorSource = nodeCode(workflow, 'Развернуть units для AI Validator');
const validatorCheckerSource = nodeCode(workflow, 'Проверить ответ AI Validator');

test('semantic contract versions are bumped for auditability', () => {
  assert.match(extractorSource, /promptVersion: 'tender_extractor_prompt_v2_1'/u);
  assert.match(
    validatorSource,
    /VALIDATOR_FIELD_PROFILES_VERSION = 'validator_field_profiles_v1_1'/u,
  );
  assert.match(
    validatorCheckerSource,
    /expectedFieldProfilesVersion: 'validator_field_profiles_v1_1'/u,
  );
});

function assertBoth(fieldKey, patterns) {
  const extractor = extractorField(extractorSource, fieldKey);
  const validator = validatorField(validatorSource, fieldKey);
  for (const pattern of patterns) {
    assert.match(extractor, pattern, `Extractor ${fieldKey} misses ${pattern}`);
    assert.match(validator, pattern, `Validator ${fieldKey} misses ${pattern}`);
  }
}

test('results_date preserves every explicitly named winner-selection event', () => {
  assertBoth('results_date', [
    /все[^.\n]*событ[^.\n]*выбор[^.\n]*победител/iu,
    /итогов[^.\n]*протокол/iu,
  ]);
});

test('customer means the contracting legal entity rather than the organizer', () => {
  assertBoth('customer', [
    /юридическ[^.\n]*лиц/iu,
    /заключ[^.\n]*договор/iu,
    /организатор[^.\n]*(?:не является|не доказ)/iu,
  ]);
});

test('customer_contacts keeps procurement and technical roles distinguishable', () => {
  assertBoth('customer_contacts', [
    /организац[^.\n]*(?:процедур|закуп)|закупщик/iu,
    /техническ[^.\n]*(?:вопрос|специалист|контакт)/iu,
  ]);
});

test('delivery_term admits a labelled general-contract fallback without displacing a direct term', () => {
  assertBoth('delivery_term', [
    /прям[^.\n]*срок|непосредственн[^.\n]*срок/iu,
    /общ[^.\n]*срок[^.\n]*исполнения[^.\n]*договор/iu,
    /(?:приоритет|выбор)[^.\n]*агрегац/iu,
  ]);
});

test('government_contract covers municipal, GOZ, and performed-under categories', () => {
  assertBoth('government_contract', [
    /муниципальн/iu,
    /государственн[^.\n]*оборонн[^.\n]*заказ|\bГОЗ\b/u,
    /во исполнение/iu,
  ]);
});

test('national_regime uses the four client values and requires direct proof for non-application', () => {
  assertBoth('national_regime', [
    /Запрет/u,
    /Ограничение/u,
    /Преимущество/u,
    /Не применяется/u,
    /Не применяется[^.\n]*(?:прям|явн)[^.\n]*(?:подтверж|evidence)|(?:прям|явн)[^.\n]*(?:подтверж|evidence)[^.\n]*Не применяется/iu,
  ]);
});

test('licenses_certificates accepts only literal licences or certificates without losing application documents', () => {
  assertBoth('licenses_certificates', [
    /только[^.\n]*(?:назван|называет)[^.\n]*(?:лицензи|сертификат)/iu,
    /декларац[^.\n]*(?:не относ|исключ)/iu,
    /разрешен[^.\n]*(?:не относ|исключ)/iu,
    /application_documents/u,
  ]);
});

test('similar_supply_experience classifies mandatory and scored experience separately', () => {
  assertBoth('similar_supply_experience', [
    /обязательн/iu,
    /оценочн|балл/iu,
    /раздельн|отдельн|классифиц/iu,
  ]);
});

test('review artifacts contain the complete executable prompt-bearing sources', () => {
  const extractorArtifact = fs.readFileSync(
    path.join(repositoryRoot, 'prompts', 'document-worker-extractor-request-builder-v2.1-2026-09-07.txt'),
    'utf8',
  );
  const validatorArtifact = fs.readFileSync(
    path.join(repositoryRoot, 'prompts', 'document-worker-validator-field-profiles-v1.1-2026-09-07.txt'),
    'utf8',
  );
  assert.equal(normalizeLineEndings(extractorArtifact), `${extractorSource}\n`);
  assert.equal(normalizeLineEndings(validatorArtifact), `${validatorSource}\n`);
});
