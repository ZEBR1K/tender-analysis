import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const exportPath = path.resolve(here, '..', 'workflows', 'n8n-exports', 'TENDER — TenderPlan Mark Intake.json');
const fixturePath = path.resolve(here, 'fixtures', 'tenderplan-mark-intake', 'mark-relation-duplicate-sanitized.json');
const MARK_ID = '6a732cd00c61629cf1d3c144';

function node(workflow, name) {
  const found = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(found, `missing node: ${name}`);
  return found;
}

async function runNormalizer(normalizer, inputs) {
  const context = vm.createContext({
    $input: { all: () => inputs.map((json) => ({ json })) },
  });
  return structuredClone(await new vm.Script(
    `(async () => {\n${normalizer.parameters.jsCode}\n})()`,
    { filename: `${normalizer.name}.code-node.js` },
  ).runInContext(context, { timeout: 1_000 }));
}

test('mark relation fixture is sanitized and preserves the confirmed duplicate structure', () => {
  const fixtureText = fs.readFileSync(fixturePath, 'utf8');
  const fixture = JSON.parse(fixtureText);
  assert.equal(fixture.tender.id, fixture.tenders[0].id);
  assert.deepEqual(Object.keys(fixture).sort(), ['tender', 'tenders']);
  assert.doesNotMatch(fixtureText, /https?:|token|authorization|password|customer|client/iu);
});

test('TenderPlan Mark Intake is an inactive GET-only ten-minute relation poller', () => {
  assert.ok(fs.existsSync(exportPath), 'TENDER — TenderPlan Mark Intake workflow export is absent');
  const text = fs.readFileSync(exportPath, 'utf8');
  const workflow = JSON.parse(text);

  assert.deepEqual(Object.keys(workflow).sort(), ['active', 'connections', 'name', 'nodes', 'settings', 'tags']);
  assert.equal(workflow.name, 'TENDER — TenderPlan Mark Intake');
  assert.equal(workflow.active, false);
  assert.equal(workflow.settings.executionOrder, 'v1');
  assert.equal(workflow.settings.availableInMCP, false);
  assert.equal(Object.hasOwn(workflow.settings, 'errorWorkflow'), false);
  assert.equal(workflow.nodes.filter((item) => item.type === 'n8n-nodes-base.scheduleTrigger').length, 1);
  assert.deepEqual(node(workflow, 'Every 10 Minutes').parameters, {
    rule: { interval: [{ field: 'minutes', minutesInterval: 10 }] },
  });

  const requests = workflow.nodes.filter((item) => item.type === 'n8n-nodes-base.httpRequest');
  assert.equal(requests.length, 1);
  const request = node(workflow, 'Get Current Tenders for Mark');
  assert.equal(request.parameters.method ?? 'GET', 'GET');
  assert.equal(request.parameters.url, 'https://tenderplan.ru/api/tenders/v2/getlist');
  assert.equal(request.parameters.sendQuery, true);
  assert.deepEqual(request.parameters.queryParameters.parameters, [
    { name: 'type', value: 1 },
    { name: 'id', value: MARK_ID },
  ]);
  assert.equal(request.parameters.authentication, 'genericCredentialType');
  assert.equal(request.parameters.genericAuthType, 'httpHeaderAuth');
  assert.deepEqual(request.credentials, {
    httpHeaderAuth: { id: '', name: 'TenderPlan API' },
  });
  assert.equal(request.retryOnFail, true);
  assert.equal(request.maxTries, 3);
  assert.equal(request.waitBetweenTries, 5000);
  assert.doesNotMatch(request.parameters.url, /notifications|acknowledge|delete/iu);
  assert.equal(request.parameters.method ?? 'GET', 'GET');
  assert.doesNotMatch(JSON.stringify(workflow.nodes.map((item) => item.parameters)), /\$getWorkflowStaticData|staticData/iu);
  assert.doesNotMatch(text, /Bearer\s+\S+|X-?API-?KEY|api[_-]?key\s*[:=]/iu);
  assert.equal(text.match(new RegExp(MARK_ID, 'g'))?.length >= 2, true);
  const packaging = node(workflow, 'Packaging Required').parameters.content;
  assert.match(packaging, /TENDER — Ошибка Intake Resume/u);
  assert.match(packaging, /settings\.errorWorkflow/u);
  assert.match(packaging, /inactive/u);
});

test('normalizer deduplicates confirmed paths and emits only stable dispatcher coordinates', async () => {
  const workflow = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
  const normalizer = node(workflow, 'Normalize Mark Relations');
  assert.equal(normalizer.type, 'n8n-nodes-base.code');
  assert.equal(normalizer.parameters.mode, 'runOnceForAllItems');
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const result = await runNormalizer(normalizer, [fixture]);
  assert.deepEqual(result, [{ json: {
    trigger_kind: 'tenderplan_mark',
    manual_override: false,
    tender_id: '111111111111111111111111',
    source_event_key: `tenderplan:mark:${MARK_ID}:tender:111111111111111111111111`,
  } }]);
  assert.equal(Object.hasOwn(result[0].json, 'observed_at'), false);
  assert.equal(JSON.stringify(result).includes('tenders'), false);
  assert.deepEqual(await runNormalizer(normalizer, [{ tender: null, tenders: [] }]), []);
  await assert.rejects(runNormalizer(normalizer, [{ error: 'shape changed' }]), /malformed.*missing tender\/tenders/iu);
  await assert.rejects(runNormalizer(normalizer, [{ data: [] }]), /malformed.*missing tender\/tenders/iu);
  await assert.rejects(runNormalizer(normalizer, [{ tender: { id: '' }, tenders: [] }]), /malformed.*tender.*id/iu);
  await assert.rejects(runNormalizer(normalizer, [{ tender: { id: 'not-an-id' }, tenders: [] }]), /malformed.*tender.*id/iu);
  await assert.rejects(runNormalizer(normalizer, [{ tender: {}, tenders: [] }]), /malformed.*tender.*id/iu);
  await assert.rejects(runNormalizer(normalizer, [{ tender: null, tenders: [null] }]), /malformed.*tenders\[0\]/iu);
  await assert.rejects(runNormalizer(normalizer, [{ tender: null, tenders: 'wrong' }]), /malformed.*tenders/iu);
});

test('each unique tender is dispatched asynchronously with the exact Intake Resume payload', () => {
  const workflow = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
  const dispatchers = workflow.nodes.filter((item) => item.type === 'n8n-nodes-base.executeWorkflow');
  assert.equal(dispatchers.length, 1);
  const dispatcher = node(workflow, 'Execute TENDER — Intake Resume');
  assert.equal(dispatcher.parameters.mode, 'each');
  assert.equal(dispatcher.parameters.source, 'database');
  assert.deepEqual(dispatcher.parameters.workflowId, {
    __rl: true, value: '', mode: 'list', cachedResultName: 'TENDER — Intake Resume',
  });
  assert.equal(dispatcher.parameters.options.waitForSubWorkflow, false);
  assert.deepEqual(dispatcher.parameters.workflowInputs.value, {
    trigger_kind: 'tenderplan_mark',
    manual_override: false,
    tender_id: '={{ $json.tender_id }}',
    source_event_key: '={{ $json.source_event_key }}',
  });
  assert.deepEqual(workflow.connections, {
    'Every 10 Minutes': { main: [[{ node: 'Get Current Tenders for Mark', type: 'main', index: 0 }]] },
    'Get Current Tenders for Mark': { main: [[{ node: 'Normalize Mark Relations', type: 'main', index: 0 }]] },
    'Normalize Mark Relations': { main: [[{ node: 'Execute TENDER — Intake Resume', type: 'main', index: 0 }]] },
  });
});
