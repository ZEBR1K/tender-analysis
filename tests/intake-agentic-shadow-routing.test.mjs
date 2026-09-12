import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const orchestratorUrl = new URL(
  '../workflows/n8n-exports/%D0%A2%D0%95%D0%9D%D0%94%D0%95%D0%A0%D0%AB%20%D0%9E%D0%A0%D0%9A%D0%95%D0%A1%D0%A2%D0%A0%D0%90%D0%A2%D0%9E%D0%A0.json',
  import.meta.url,
);
const preparationUrl = new URL(
  '../workflows/n8n-exports/TENDER — Подготовить документацию.json',
  import.meta.url,
);
const intakeResumeUrl = new URL(
  '../workflows/n8n-exports/TENDER — Intake Resume.json',
  import.meta.url,
);

async function loadWorkflow(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

function nodeByName(workflow, name) {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(node, `missing node ${name}`);
  return node;
}

function directTargets(workflow, nodeName) {
  return (workflow.connections?.[nodeName]?.main ?? [])
    .flatMap((output) => output.map((connection) => connection.node));
}

function outputTargets(workflow, nodeName, outputIndex) {
  return (workflow.connections?.[nodeName]?.main?.[outputIndex] ?? [])
    .map((connection) => connection.node);
}

function canReach(workflow, startName, targetName, blockedNames = new Set()) {
  if (blockedNames.has(startName) || blockedNames.has(targetName)) return false;
  const queue = [startName];
  const visited = new Set();

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === targetName) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of directTargets(workflow, current)) {
      if (!visited.has(next) && !blockedNames.has(next)) queue.push(next);
    }
  }
  return false;
}

function configuredWorkflowName(node) {
  return String(node.parameters?.workflowId?.cachedResultName ?? '').trim();
}

async function runAllItemsCode(node, input, named = {}) {
  const execute = new Function(
    '$input',
    '$',
    `return (async () => { ${String(node.parameters?.jsCode ?? '')}\n })();`,
  );
  const items = input.map((json) => ({ json }));
  const select = (name) => ({
    first: () => ({ json: named[name] }),
    item: { json: named[name] },
  });
  return execute({ first: () => items[0], all: () => items }, select);
}

test('Document Preparation and its fail-closed validator dominate atomic registration', async () => {
  const workflow = await loadWorkflow(orchestratorUrl);
  const normalization = nodeByName(workflow, 'нормализовать карточку');
  const registration = nodeByName(workflow, 'Создать запуск и зарегистрировать документы');
  const preparationCalls = workflow.nodes.filter(
    (node) =>
      node.type === 'n8n-nodes-base.executeWorkflow'
      && configuredWorkflowName(node) === 'TENDER — Подготовить документацию',
  );
  assert.equal(preparationCalls.length, 1, 'expected one synchronous Document Preparation call');

  const preparation = preparationCalls[0];
  assert.equal(preparation.parameters.mode, 'all');
  assert.equal(preparation.parameters.options?.waitForSubWorkflow, true);
  assert.deepEqual(
    Object.keys(preparation.parameters.workflowInputs?.value ?? {}).sort(),
    ['analysis_run_id', 'attachments'],
  );

  const validation = nodeByName(workflow, 'Проверить результат подготовки');
  assert.ok(canReach(workflow, normalization.name, preparation.name));
  assert.ok(canReach(workflow, preparation.name, validation.name));
  assert.ok(canReach(workflow, validation.name, registration.name));
  assert.equal(
    canReach(workflow, normalization.name, registration.name, new Set([preparation.name])),
    false,
    'registration must be unreachable when preparation is removed',
  );
  assert.equal(
    canReach(workflow, normalization.name, registration.name, new Set([validation.name])),
    false,
    'registration must be unreachable when preparation validation is removed',
  );

  const validationCode = String(validation.parameters?.jsCode ?? '');
  assert.match(validationCode, /success\s*!==\s*true/u);
  assert.match(validationCode, /tender_document_ingestion_v1/u);
  assert.match(validationCode, /manifest\.documents/u);
  assert.match(validationCode, /content_sha256/u);
  assert.match(validationCode, /\/\^\[0-9a-f\]\{64\}\$\/[iu]*/u);
  assert.match(validationCode, /throw\s+new\s+Error/u);

  const sql = String(registration.parameters?.query ?? '');
  const replacement = String(registration.parameters?.options?.queryReplacement ?? '');
  assert.match(replacement, /Проверить результат подготовки/u);
  assert.match(sql, /document->>'status'/u);
  assert.match(sql, /document->>'mime_type'/u);
  assert.match(sql, /document->>'file_size'/u);
  assert.match(sql, /document->'ingestion_metadata'/u);
  assert.match(sql, /content_sha256/u);
});

test('direct processable files are downloaded sequentially and registered with full byte identity', async () => {
  const workflow = await loadWorkflow(preparationUrl);
  const classifier = nodeByName(workflow, 'Проверить и классифицировать вход');
  const classifierCode = String(classifier.parameters?.jsCode ?? '');
  assert.match(classifierCode, /direct_document_jobs/u);
  assert.match(
    classifierCode,
    /supportedDocuments\s*=\s*new Set\(\[[^\]]*'xls'[^\]]*\]\)/u,
    'legacy XLS must be staged as an untouched source document for Codex',
  );

  const loop = nodeByName(workflow, 'Обработать прямые документы по одному');
  assert.equal(loop.type, 'n8n-nodes-base.splitInBatches');
  assert.equal(loop.parameters.batchSize, 1);

  const download = nodeByName(workflow, 'Скачать прямой документ');
  assert.equal(download.type, 'n8n-nodes-base.httpRequest');
  assert.equal(download.parameters.options.response.response.responseFormat, 'file');
  assert.equal(download.parameters.options.response.response.outputPropertyName, 'data');
  assert.equal(download.onError, 'continueErrorOutput');

  const hash = nodeByName(workflow, 'Вычислить SHA-256 прямого документа');
  assert.equal(hash.type, 'n8n-nodes-base.crypto');
  assert.equal(hash.parameters.action, 'hash');
  assert.equal(hash.parameters.binaryData, true);
  assert.equal(hash.parameters.binaryPropertyName, 'data');
  assert.equal(hash.parameters.type, 'SHA256');
  assert.equal(hash.parameters.encoding, 'hex');
  assert.equal(hash.parameters.dataPropertyName, 'content_sha256');

  const identity = nodeByName(workflow, 'Зафиксировать идентичность прямого документа');
  const identityCode = String(identity.parameters?.jsCode ?? '');
  for (const field of ['file_name', 'mime_type', 'file_size', 'content_sha256']) {
    assert.match(identityCode, new RegExp(`\\b${field}\\b`, 'u'));
  }
  assert.match(identityCode, /\/\^\[0-9a-f\]\{64\}\$\/[iu]*/u);

  const downloadNormalizer = nodeByName(workflow, 'Нормализовать скачивание прямого документа');
  assert.match(
    String(downloadNormalizer.parameters?.jsCode ?? ''),
    /xls:\s*'application\/vnd\.ms-excel'/u,
    'XLS receives only its standard MIME fallback; its contents remain agent-owned',
  );

  const manifest = nodeByName(workflow, 'Сформировать полный manifest');
  const manifestCode = String(manifest.parameters?.jsCode ?? '');
  assert.match(manifestCode, /direct_document_jobs/u);
  assert.match(manifestCode, /Собрать результаты прямых документов/u);
  const directCollector = nodeByName(workflow, 'Собрать результаты прямых документов');
  assert.match(String(directCollector.parameters?.jsCode ?? ''), /\$input\.all\(\)/u);
  assert.match(manifestCode, /document\.status\s*===\s*'pending'/u);
  assert.match(manifestCode, /document\.file_name/u);
  assert.match(manifestCode, /document\.mime_type/u);
  assert.match(manifestCode, /document\.file_size/u);
  assert.match(manifestCode, /content_sha256/u);
  assert.match(manifestCode, /INGESTION_CONTRACT_INVALID/u);
});

test('Orchestrator temporary agent-only canary dispatches after manifest and cannot reach legacy Worker', async () => {
  const workflow = await loadWorkflow(orchestratorUrl);
  const registration = nodeByName(workflow, 'Создать запуск и зарегистрировать документы');
  const createdGate = nodeByName(workflow, 'Создан новый запуск?');
  const processableGate = nodeByName(workflow, 'Есть поддерживаемые документы?');
  const legacySplit = nodeByName(workflow, 'разделить документы');
  const terminal = nodeByName(workflow, 'Вернуть результат Orchestrator');
  const calls = workflow.nodes.filter(
    (node) => node.type === 'n8n-nodes-base.executeWorkflow'
      && configuredWorkflowName(node) === 'TENDER — Агентский анализ — Запуск',
  );

  assert.equal(calls.length, 1, 'new-run path must contain exactly one agentic dispatch call');
  const dispatch = calls[0];
  assert.equal(dispatch.parameters.workflowId?.value, 'AGENTIC_DISPATCH_WORKFLOW_ID');
  assert.equal(dispatch.parameters.mode, 'all');
  assert.equal(dispatch.parameters.options?.waitForSubWorkflow, true);
  assert.deepEqual(Object.keys(dispatch.parameters.workflowInputs?.value ?? {}).sort(), [
    'analysis_run_id', 'pipeline_version', 'replicate_index',
  ]);
  assert.match(String(dispatch.parameters.workflowInputs.value.analysis_run_id), /Создать запуск и зарегистрировать документы/u);
  assert.equal(dispatch.parameters.workflowInputs.value.pipeline_version, 'tender_agentic_pipeline_v1');
  assert.equal(dispatch.parameters.workflowInputs.value.replicate_index, 1);

  const restore = nodeByName(workflow, 'Восстановить контекст после agentic dispatch');
  const restoreCode = String(restore.parameters?.jsCode ?? '');
  assert.match(restoreCode, /tender_agentic_dispatch_v1/u);
  assert.match(restoreCode, /agentic_shadow/u);
  assert.match(restoreCode, /Создать запуск и зарегистрировать документы/u);
  assert.match(restoreCode, /source_event_key/u);
  assert.deepEqual(outputTargets(workflow, createdGate.name, 0), [processableGate.name]);
  assert.deepEqual(outputTargets(workflow, createdGate.name, 1), ['Загрузить существующий незавершённый запуск']);
  assert.deepEqual(outputTargets(workflow, processableGate.name, 0), [dispatch.name]);
  assert.deepEqual(outputTargets(workflow, processableGate.name, 1), [terminal.name]);
  assert.deepEqual(outputTargets(workflow, dispatch.name, 0), [restore.name]);
  assert.deepEqual(outputTargets(workflow, restore.name, 0), [terminal.name]);
  assert.ok(canReach(workflow, registration.name, dispatch.name));
  assert.equal(canReach(workflow, dispatch.name, legacySplit.name), false);
  assert.ok(canReach(workflow, dispatch.name, terminal.name));
  assert.equal(canReach(workflow, registration.name, legacySplit.name, new Set([dispatch.name])), false);
  assert.equal(canReach(workflow, 'Загрузить существующий незавершённый запуск', dispatch.name), false);
  assert.match(String(restore.notes ?? ''), /TASK17_TEMPORARY_AGENT_ONLY/u);
  assert.match(String(restore.notes ?? ''), /legacy/u);

  const terminalCode = String(terminal.parameters?.jsCode ?? '');
  assert.match(terminalCode, /source_event_key/u);
  assert.match(terminalCode, /agentic_shadow/u);
});

test('Intake Resume temporary agent-only canary terminates after Dispatch without legacy recovery', async () => {
  const workflow = await loadWorkflow(intakeResumeUrl);
  const calls = workflow.nodes.filter(
    (node) => node.type === 'n8n-nodes-base.executeWorkflow'
      && configuredWorkflowName(node) === 'TENDER — Агентский анализ — Запуск',
  );
  assert.equal(calls.length, 1, 'existing-run recovery must contain exactly one agentic dispatch call');

  const dispatch = calls[0];
  assert.equal(dispatch.parameters.workflowId?.value, 'AGENTIC_DISPATCH_WORKFLOW_ID');
  assert.equal(dispatch.parameters.mode, 'all');
  assert.equal(dispatch.parameters.options?.waitForSubWorkflow, true);
  assert.deepEqual(Object.keys(dispatch.parameters.workflowInputs?.value ?? {}).sort(), [
    'analysis_run_id', 'pipeline_version', 'replicate_index',
  ]);
  assert.equal(dispatch.parameters.workflowInputs.value.pipeline_version, 'tender_agentic_pipeline_v1');
  assert.equal(dispatch.parameters.workflowInputs.value.replicate_index, 1);

  const reload = nodeByName(workflow, 'Reload Run Snapshot After Recovery');
  const runEntry = nodeByName(workflow, 'Apply Run Entry Policy');
  const prepare = nodeByName(workflow, 'Prepare Agentic Shadow Dispatch');
  const gate = nodeByName(workflow, 'Should Dispatch Agentic Shadow?');
  const restore = nodeByName(workflow, 'Restore Existing Run Context After Agentic');
  const decide = nodeByName(workflow, 'Decide Document and Stage Action');
  const complete = nodeByName(workflow, 'Complete Intake Event');
  const completeReplacement = String(complete.parameters?.options?.queryReplacement ?? '');
  const prepareCode = String(prepare.parameters?.jsCode ?? '');
  assert.match(
    String(runEntry.parameters?.query ?? ''),
    /COALESCE\(u\.documents_total\s*,\s*s\.documents_total\)\s+AS\s+documents_total/iu,
    'Apply Run Entry Policy must project documents_total for the existing-run eligibility contract',
  );
  assert.match(prepareCode, /documents_total/u);
  assert.match(prepareCode, /Apply Run Entry Policy/u);
  assert.match(prepareCode, /manifest_incomplete/u);
  assert.match(prepareCode, /failed_documents/u);
  assert.match(prepareCode, /no_processable_documents/u);
  assert.match(prepareCode, /ready_for_aggregation/u);
  assert.match(prepareCode, /aggregating/u);
  assert.match(prepareCode, /content_sha256/u);
  assert.match(prepareCode, /agentic_shadow/u);
  assert.match(completeReplacement, /should_dispatch_agentic_shadow\s*===\s*false/u);
  assert.match(completeReplacement, /manual_attention_required/u);
  assert.match(completeReplacement, /already_completed/u);
  assert.match(completeReplacement, /superseded_no_op/u);

  assert.deepEqual(outputTargets(workflow, reload.name, 0), [prepare.name]);
  assert.deepEqual(outputTargets(workflow, prepare.name, 0), [gate.name]);
  assert.deepEqual(outputTargets(workflow, gate.name, 0), [dispatch.name]);
  assert.deepEqual(outputTargets(workflow, gate.name, 1), [complete.name]);
  assert.deepEqual(outputTargets(workflow, dispatch.name, 0), [restore.name]);
  assert.deepEqual(outputTargets(workflow, restore.name, 0), [complete.name]);
  assert.ok(canReach(workflow, dispatch.name, complete.name));
  assert.equal(canReach(workflow, dispatch.name, decide.name), false);
  assert.equal(canReach(workflow, gate.name, decide.name), false);
  assert.match(String(gate.notes ?? ''), /TASK17_TEMPORARY_AGENT_ONLY/u);
  assert.match(String(restore.notes ?? ''), /TASK17_TEMPORARY_AGENT_ONLY/u);
  assert.deepEqual(outputTargets(workflow, 'Orchestrator Created Run?', 0), [complete.name]);
  assert.equal(
    canReach(workflow, 'Orchestrator Created Run?', dispatch.name, new Set(['Apply Run Entry Policy'])),
    false,
    'created_new_run=true must not double-dispatch through Intake Resume',
  );
  assert.match(String(restore.parameters?.jsCode ?? ''), /tender_agentic_dispatch_v1/u);
  assert.match(String(restore.parameters?.jsCode ?? ''), /agentic_shadow/u);
  const namedContext = {
    'Prepare Agentic Shadow Dispatch': {
      analysis_run_id: '20000000-0000-4000-8000-000000000001',
      source_event_key: 'tenderplan:mark:test:tender:test',
      run_status: 'processing',
    },
    'Classify Intake Event': {
      source_event_key: 'tenderplan:mark:test:tender:test',
    },
  };
  const [started] = await runAllItemsCode(
    restore,
    [{
      schema_version: 'tender_agentic_dispatch_v1',
      success: true,
      no_op: false,
      job_id: '30000000-0000-4000-8000-000000000001',
      status: 'running',
    }],
    namedContext,
  );
  assert.equal(started.json.action, 'agentic_dispatched');

  const [noOp] = await runAllItemsCode(
    restore,
    [{
      schema_version: 'tender_agentic_dispatch_v1',
      success: true,
      no_op: true,
      job_id: '30000000-0000-4000-8000-000000000001',
      status: 'completed',
    }],
    namedContext,
  );
  assert.equal(noOp.json.action, 'agentic_no_op');
  const terminalCode = String(nodeByName(workflow, 'Return Structured Outcome').parameters?.jsCode ?? '');
  assert.match(terminalCode, /source_event_key/u);
  assert.match(terminalCode, /agentic_shadow/u);
  assert.match(terminalCode, /agentic_dispatched/u);
  assert.match(terminalCode, /agentic_no_op/u);
});

test('Intake shadow eligibility skips terminal, failed, incomplete and non-processable runs', async () => {
  const workflow = await loadWorkflow(intakeResumeUrl);
  const prepare = nodeByName(workflow, 'Prepare Agentic Shadow Dispatch');
  const validDocument = {
    id: '10000000-0000-4000-8000-000000000001',
    document_index: 1,
    file_name: 'source.pdf',
    file_extension: 'pdf',
    download_url: 'https://example.invalid/source.pdf',
    mime_type: 'application/pdf',
    file_size: 64,
    status: 'pending',
    ingestion_metadata: { content_sha256: 'a'.repeat(64) },
  };
  const context = {
    analysis_run_id: '20000000-0000-4000-8000-000000000001',
    source_event_key: 'recovery:stable-event',
  };
  const run = async ({ runStatus = 'processing', documents = [validDocument], documentsTotal = 1 } = {}) => {
    const [result] = await runAllItemsCode(
      prepare,
      [{ ...context, run_status: runStatus, documents }],
      { 'Apply Run Entry Policy': { documents_total: documentsTotal } },
    );
    return result.json;
  };

  const eligible = await run();
  assert.equal(eligible.should_dispatch_agentic_shadow, true);
  assert.equal(eligible.agentic_shadow.reason, null);
  assert.equal(eligible.source_event_key, context.source_event_key);

  const legacyXls = await run({
    documents: [{
      ...validDocument,
      file_name: 'source.xls',
      file_extension: 'xls',
      mime_type: 'application/vnd.ms-excel',
    }],
  });
  assert.equal(legacyXls.should_dispatch_agentic_shadow, true);
  assert.equal(legacyXls.agentic_shadow.reason, null);

  for (const runStatus of ['failed', 'completed', 'superseded']) {
    const result = await run({ runStatus });
    assert.equal(result.should_dispatch_agentic_shadow, false);
    assert.equal(result.agentic_shadow.reason, 'terminal_run');
  }

  const failed = await run({ documents: [{ ...validDocument, status: 'failed' }] });
  assert.equal(failed.should_dispatch_agentic_shadow, false);
  assert.equal(failed.agentic_shadow.reason, 'failed_documents');

  const incomplete = await run({ documentsTotal: 2 });
  assert.equal(incomplete.should_dispatch_agentic_shadow, false);
  assert.equal(incomplete.agentic_shadow.reason, 'manifest_incomplete');

  const skipped = await run({
    documents: [{ ...validDocument, status: 'skipped', file_extension: 'zip' }],
  });
  assert.equal(skipped.should_dispatch_agentic_shadow, false);
  assert.equal(skipped.agentic_shadow.reason, 'no_processable_documents');
});
