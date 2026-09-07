import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testsDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testsDirectory, '..');
const canonicalPath = path.join(
  repositoryRoot,
  'workflows',
  'n8n-exports',
  'TENDER — Генерация отчета.json',
);
const candidatePath = path.join(
  repositoryRoot,
  'workflows',
  'n8n-exports',
  'beta',
  '[PDF TEST] TENDER — Генерация отчета.json',
);

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function byName(workflow, name) {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(node, `Missing node: ${name}`);
  return node;
}

function targets(workflow, source) {
  return (workflow.connections[source]?.main?.[0] ?? []).map(({ node }) => node);
}

function normalizedParameters(node) {
  const parameters = structuredClone(node.parameters);

  if (node.type === 'n8n-nodes-base.code') {
    parameters.mode ??= 'runOnceForAllItems';
    parameters.language ??= 'javaScript';
  }

  if (node.type === 'n8n-nodes-base.httpRequest') {
    parameters.authentication ??= 'none';
    const response = parameters.options?.response?.response;
    if (response) {
      response.fullResponse ??= false;
      response.neverError ??= false;
    }
  }

  return parameters;
}

test('published production PDF workflow matches the tested candidate semantics', () => {
  const canonical = loadJson(canonicalPath);
  const candidate = loadJson(candidatePath);
  const candidateText = fs.readFileSync(candidatePath, 'utf8');

  assert.equal(canonical.id, 'ckPnP3hRhKu4Mf9u');
  assert.equal(canonical.name, 'TENDER — Генерация отчета');
  assert.equal(canonical.active, true);
  assert.equal(canonical.nodes.length, 12);
  assert.equal(canonical.settings.availableInMCP, false);

  assert.equal(candidate.active, false);
  assert.equal(candidate.activeVersionId, null);
  assert.equal(candidate.name, '[PDF TEST] TENDER — Генерация отчета');
  assert.equal(candidate.nodes.length, 12);
  assert.equal(candidate.settings.availableInMCP, true);
  assert.equal(Object.hasOwn(candidate, 'shared'), false);
  assert.equal(Object.hasOwn(candidate, 'meta'), false);
  assert.doesNotMatch(candidateText, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu);

  for (const candidateNode of candidate.nodes) {
    const canonicalNode = byName(canonical, candidateNode.name);
    assert.equal(canonicalNode.type, candidateNode.type, candidateNode.name);
    assert.equal(canonicalNode.typeVersion, candidateNode.typeVersion, candidateNode.name);
    assert.deepEqual(
      normalizedParameters(canonicalNode),
      normalizedParameters(candidateNode),
      candidateNode.name,
    );
  }

  assert.deepEqual(canonical.connections, candidate.connections);
});

test('production and candidate append one fail-fast HTML to PDF chain', () => {
  for (const workflow of [loadJson(canonicalPath), loadJson(candidatePath)]) {
    assert.deepEqual(targets(workflow, 'Создать HTML artifact'), ['Подготовить HTML для Gotenberg']);
    assert.deepEqual(targets(workflow, 'Подготовить HTML для Gotenberg'), ['Конвертировать HTML в PDF']);
    assert.deepEqual(targets(workflow, 'Конвертировать HTML в PDF'), ['Проверить PDF artifact']);
    assert.deepEqual(targets(workflow, 'Проверить PDF artifact'), []);

    const prepare = byName(workflow, 'Подготовить HTML для Gotenberg');
    assert.equal(prepare.type, 'n8n-nodes-base.code');
    assert.match(prepare.parameters.jsCode, /artifact_validation\?\.valid !== true/u);
    assert.match(prepare.parameters.jsCode, /fileName: 'index\.html'/u);
    assert.match(prepare.parameters.jsCode, /gotenberg_html/u);

    const validate = byName(workflow, 'Проверить PDF artifact');
    assert.equal(validate.type, 'n8n-nodes-base.code');
    assert.match(validate.parameters.jsCode, /getBinaryDataBuffer\(0, 'report_pdf'\)/u);
    assert.match(validate.parameters.jsCode, /signature !== '%PDF-'/u);
    assert.match(validate.parameters.jsCode, /report_html: reportHtml/u);
    assert.match(validate.parameters.jsCode, /report_pdf:/u);
    assert.match(validate.parameters.jsCode, /pdf_artifact_validation/u);
  }
});

test('HTTP Request posts the validated HTML binary to the internal Gotenberg endpoint', () => {
  for (const workflow of [loadJson(canonicalPath), loadJson(candidatePath)]) {
    const convert = byName(workflow, 'Конвертировать HTML в PDF');

    assert.equal(convert.type, 'n8n-nodes-base.httpRequest');
    assert.equal(convert.typeVersion, 4.4);
    assert.equal(convert.parameters.method, 'POST');
    assert.equal(
      convert.parameters.url,
      'http://tender-pdf-gotenberg:3000/forms/chromium/convert/html',
    );
    assert.equal(convert.parameters.authentication ?? 'none', 'none');
    assert.equal(convert.parameters.contentType, 'multipart-form-data');
    assert.equal(convert.parameters.options.timeout, 120000);
    assert.equal(
      convert.parameters.options.response.response.outputPropertyName,
      'report_pdf',
    );
    assert.equal(convert.parameters.options.response.response.fullResponse ?? false, false);
    assert.equal(convert.parameters.options.response.response.neverError ?? false, false);
    assert.equal(convert.retryOnFail, undefined);
    assert.equal(convert.onError, undefined);

    const body = convert.parameters.bodyParameters.parameters;
    assert.deepEqual(body[0], {
      parameterType: 'formBinaryData',
      name: 'files',
      inputDataFieldName: 'gotenberg_html',
    });
    assert.deepEqual(
      Object.fromEntries(body.slice(1).map(({ name, value }) => [name, value])),
      {
        paperWidth: '8.27',
        paperHeight: '11.7',
        marginTop: '0.39',
        marginBottom: '0.39',
        marginLeft: '0.39',
        marginRight: '0.39',
        landscape: 'false',
        emulatedMediaType: 'print',
        printBackground: 'true',
        singlePage: 'false',
        preferCssPageSize: 'false',
      },
    );
  }
});
