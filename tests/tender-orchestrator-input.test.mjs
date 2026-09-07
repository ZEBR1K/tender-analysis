import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflowPath = new URL(
  '../workflows/n8n-exports/%D0%A2%D0%95%D0%9D%D0%94%D0%95%D0%A0%D0%AB%20%D0%9E%D0%A0%D0%9A%D0%95%D0%A1%D0%A2%D0%A0%D0%90%D0%A2%D0%9E%D0%A0.json',
  import.meta.url,
);

const workflow = JSON.parse(
  readFileSync(workflowPath, 'utf8').replace(/^\uFEFF/, ''),
);

const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
const nodesByName = new Map(nodes.map((node) => [node.name, node]));

function nodesOfType(type) {
  return nodes.filter((node) => node.type === type);
}

function stringsIn(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(stringsIn);
  }
  return [];
}

function outputTargets(nodeName, outputIndex) {
  const output = workflow.connections?.[nodeName]?.main?.[outputIndex] ?? [];
  return output.map((connection) => connection.node);
}

function directTargets(nodeName) {
  const outputs = workflow.connections?.[nodeName]?.main ?? [];
  return outputs.flatMap((output) => output.map((connection) => connection.node));
}

function canReach(startName, targetName, blockedNames = new Set()) {
  if (blockedNames.has(startName) || blockedNames.has(targetName)) return false;

  const queue = [startName];
  const visited = new Set();

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === targetName) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    for (const next of directTargets(current)) {
      if (!visited.has(next) && !blockedNames.has(next)) queue.push(next);
    }
  }

  return false;
}

function everyPathPassesThrough(startName, targetName, requiredNames) {
  return (
    canReach(startName, targetName) &&
    !canReach(startName, targetName, new Set(requiredNames))
  );
}

function codeSource(node) {
  return String(node.parameters?.jsCode ?? '');
}

function codeChecksTypedInput(code) {
  const canonical = code.replaceAll('_', '').replace(/\s+/g, ' ');
  const hasTenderId = /\btenderid\b/i.test(canonical);
  const checksNonEmpty =
    /if\s*\([^)]*(?:!\s*[\w$.]*tenderid|[\w$.]*tenderid(?:\.length)?\s*(?:={2,3}|<=)\s*(?:['"]{2}|0))/i.test(
      canonical,
    );
  const checksBounds =
    /tenderid\.length\s*(?:<=|>=|<|>)\s*\d+/i.test(canonical) ||
    /\d+\s*(?:<=|>=|<|>)\s*tenderid\.length/i.test(canonical) ||
    /\{\s*\d+\s*,\s*\d+\s*\}/.test(canonical);
  const checksSource =
    /(?:if|assert|validate)[\s\S]{0,240}\bsource\b/i.test(canonical) ||
    /(?:has|includes)\s*\(\s*source\s*\)/i.test(canonical);
  const checksTriggerKind =
    /(?:if|assert|validate)[\s\S]{0,240}\btriggerkind\b/i.test(canonical) ||
    /(?:has|includes)\s*\(\s*triggerkind\s*\)/i.test(canonical);

  return (
    hasTenderId &&
    /\.trim\s*\(/.test(canonical) &&
    checksNonEmpty &&
    checksBounds &&
    checksSource &&
    checksTriggerKind &&
    /throw\s+new\s+Error\b/i.test(canonical)
  );
}

function sqlSource(node) {
  return String(node.parameters?.query ?? '');
}

function hasCte(sql, name) {
  return new RegExp(`(?:\\bWITH|,)\\s*"?${name}"?\\s+AS\\s*\\(`, 'i').test(sql);
}

function isUnfinishedRunSelect(node) {
  if (node.type !== 'n8n-nodes-base.postgres') return false;

  const sql = sqlSource(node);
  return (
    /\bSELECT\b/i.test(sql) &&
    /\bFROM\s+(?:"?public"?\.)?"?tender_analysis_runs"?\b/i.test(sql) &&
    /\bsource\b/i.test(sql) &&
    /\btender_id\b/i.test(sql) &&
    /\bstatus\b\s*<>\s*'completed'/i.test(sql) &&
    /\bLIMIT\s+1\b/i.test(sql) &&
    !/\b(?:INSERT|UPDATE|DELETE)\b/i.test(sql)
  );
}

function configuredWorkflowId(node) {
  const workflowId = node.parameters?.workflowId;
  if (typeof workflowId === 'string') return workflowId.trim();
  if (workflowId && typeof workflowId.value === 'string') {
    return workflowId.value.trim();
  }
  return '';
}

test('orchestrator enforces typed intake and atomic concurrent-run routing before Worker dispatch', () => {
  // 1. Typed intake boundary.
  const triggers = nodesOfType('n8n-nodes-base.executeWorkflowTrigger');
  assert.equal(
    triggers.length,
    1,
    'expected exactly one Execute Workflow Trigger',
  );

  const trigger = triggers[0];
  assert.equal(trigger.typeVersion, 1.2, 'Execute Workflow Trigger must use v1.2');
  assert.equal(
    trigger.parameters?.inputSource,
    'workflowInputs',
    'Execute Workflow Trigger must define workflowInputs',
  );

  const declaredInputs = trigger.parameters?.workflowInputs?.values ?? [];
  assert.deepEqual(
    declaredInputs.map((input) => input.name),
    ['tender_id', 'source', 'source_event_key', 'trigger_kind'],
    'workflow inputs must have the exact ordered contract',
  );
  assert.ok(
    declaredInputs.every((input) => input.type === 'string'),
    'every workflow input must be typed as string',
  );

  assert.equal(
    nodesOfType('n8n-nodes-base.manualTrigger').length,
    0,
    'Manual Trigger must be absent',
  );

  const setNodesWithLiteralTenderIds = nodesOfType('n8n-nodes-base.set').filter(
    (node) => stringsIn(node.parameters).some((value) => /\b[0-9a-f]{24}\b/i.test(value)),
  );
  assert.deepEqual(
    setNodesWithLiteralTenderIds.map((node) => node.name),
    [],
    'Set nodes must not contain literal 24-hex tender IDs',
  );

  const fullInfoHttpNodes = nodesOfType('n8n-nodes-base.httpRequest').filter((node) =>
    /\/fullinfo\b/i.test(String(node.parameters?.url ?? '')),
  );
  assert.equal(fullInfoHttpNodes.length, 1, 'expected exactly one FullInfo HTTP node');
  const fullInfoHttp = fullInfoHttpNodes[0];
  const idQueryParameters =
    fullInfoHttp.parameters?.queryParameters?.parameters?.filter(
      (parameter) => parameter.name === 'id',
    ) ?? [];
  assert.equal(idQueryParameters.length, 1, 'FullInfo HTTP must have one id query parameter');
  assert.match(
    String(idQueryParameters[0].value ?? ''),
    /\$json\.tender_id\b/,
    'FullInfo HTTP id query must reference $json.tender_id',
  );

  // 2. Validation must dominate every trigger-to-FullInfo path.
  const validationNodes = nodesOfType('n8n-nodes-base.code').filter((node) => {
    return (
      canReach(trigger.name, node.name) &&
      canReach(node.name, fullInfoHttp.name) &&
      codeChecksTypedInput(codeSource(node))
    );
  });
  assert.ok(
    validationNodes.length > 0,
    'expected a Code node that validates non-empty/bounded tender_id, source, and trigger_kind',
  );
  assert.ok(
    everyPathPassesThrough(
      trigger.name,
      fullInfoHttp.name,
      validationNodes.map((node) => node.name),
    ),
    'every path from trigger to FullInfo HTTP must pass through typed-input validation',
  );

  // 3. Run creation and complete document registration are one atomic SQL statement.
  const creationNodes = nodesOfType('n8n-nodes-base.postgres').filter((node) =>
    /\bINSERT\s+INTO\s+(?:"?public"?\.)?"?tender_analysis_runs"?\b/i.test(sqlSource(node)),
  );
  assert.equal(creationNodes.length, 1, 'expected exactly one Postgres run-creation node');
  const creation = creationNodes[0];
  const creationSql = sqlSource(creation);

  for (const cteName of [
    'input_documents',
    'inserted_run',
    'registered_documents',
    'document_stats',
    'activated_run',
  ]) {
    assert.ok(hasCte(creationSql, cteName), `atomic creation SQL must define ${cteName}`);
  }

  assert.match(
    creationSql,
    /\bON\s+CONFLICT\s*\(\s*"?source"?\s*,\s*"?tender_id"?\s*\)\s*WHERE\s+"?status"?\s*<>\s*'completed'\s+DO\s+NOTHING\b/i,
    "run INSERT must use ON CONFLICT (source,tender_id) WHERE status <> 'completed' DO NOTHING",
  );
  assert.match(
    creationSql,
    /\bINSERT\s+INTO\s+(?:"?public"?\.)?"?tender_analysis_documents"?[\s\S]*?\bSELECT\b[\s\S]*?\bFROM\s+"?inserted_run"?\b/i,
    'document INSERT must select from inserted_run',
  );
  assert.match(
    creationSql,
    /\bTRUE\b\s+AS\s+"?created_new_run"?/i,
    'atomic creation SQL must emit created_new_run=true',
  );
  assert.match(
    creationSql,
    /\bFALSE\b\s+AS\s+"?created_new_run"?/i,
    'atomic creation SQL must emit a created_new_run=false sentinel',
  );
  assert.equal(
    nodes.some((node) => node.name === 'Зарегистрировать документы'),
    false,
    'old separate Зарегистрировать документы node must be absent',
  );

  // 4. New runs dispatch documents; concurrent duplicates resume without dispatch.
  const creationSuccessTargets = outputTargets(creation.name, 0);
  assert.equal(
    creationSuccessTargets.length,
    1,
    'atomic creation must connect immediately to one IF node',
  );
  const createdNewRunIf = nodesByName.get(creationSuccessTargets[0]);
  assert.equal(
    createdNewRunIf?.type,
    'n8n-nodes-base.if',
    'atomic creation must connect immediately to IF',
  );
  assert.ok(
    stringsIn(createdNewRunIf.parameters).some((value) => /\bcreated_new_run\b/.test(value)),
    'creation IF must branch on created_new_run',
  );

  const trueTargets = outputTargets(createdNewRunIf.name, 0);
  const falseTargets = outputTargets(createdNewRunIf.name, 1);
  assert.ok(trueTargets.length > 0, 'created_new_run=true branch must be connected');
  assert.ok(falseTargets.length > 0, 'created_new_run=false branch must be connected');

  const attachmentSplitNodes = nodesOfType('n8n-nodes-base.splitOut').filter((node) => {
    const splitFields = String(node.parameters?.fieldToSplitOut ?? '')
      .split(',')
      .map((field) => field.trim())
      .filter(Boolean);
    return splitFields.length === 1 && splitFields[0] === 'attachments';
  });
  assert.equal(attachmentSplitNodes.length, 1, 'expected one Split Out for attachments');
  const attachmentSplit = attachmentSplitNodes[0];

  const workerNodes = nodesOfType('n8n-nodes-base.executeWorkflow').filter((node) =>
    canReach(attachmentSplit.name, node.name),
  );
  assert.equal(workerNodes.length, 1, 'expected one Worker Execute Workflow downstream of Split Out');
  const worker = workerNodes[0];

  assert.ok(
    trueTargets.some((target) => canReach(target, attachmentSplit.name)),
    'created_new_run=true must reach Split Out',
  );
  assert.ok(
    canReach(attachmentSplit.name, worker.name),
    'created_new_run=true must reach Worker after Split Out',
  );

  const resumeSelectNodes = nodes.filter((node) => {
    return (
      node.name !== creation.name &&
      falseTargets.some((target) => canReach(target, node.name)) &&
      isUnfinishedRunSelect(node)
    );
  });
  assert.equal(
    resumeSelectNodes.length,
    1,
    'created_new_run=false must reach one fresh SELECT for an unfinished source/tender_id run',
  );
  const resumeSelect = resumeSelectNodes[0];

  const concurrentGuardNodes = nodesOfType('n8n-nodes-base.code').filter((node) => {
    const code = codeSource(node);
    return (
      canReach(resumeSelect.name, node.name) &&
      /\bif\s*\(/i.test(code) &&
      /\breturn\b/i.test(code) &&
      /\baction\b\s*:\s*['"]concurrent_existing_run['"]/i.test(code)
    );
  });
  assert.equal(
    concurrentGuardNodes.length,
    1,
    'unfinished-run SELECT must reach a Code guard returning action concurrent_existing_run',
  );
  assert.ok(
    falseTargets.every((target) => !canReach(target, worker.name)),
    'created_new_run=false must not reach Worker',
  );

  // 5. Split Out produces one document item and Worker consumes each item once.
  assert.equal(worker.parameters?.mode, 'each', 'Worker Execute Workflow must use mode=each');
  assert.ok(configuredWorkflowId(worker), 'Worker Execute Workflow must configure one workflowId');
  assert.equal(
    Array.isArray(worker.parameters?.workflowId),
    false,
    'Worker Execute Workflow must not configure multiple workflowIds',
  );

  const splitIncludeMode = attachmentSplit.parameters?.include;
  const retainedFields = String(attachmentSplit.parameters?.fieldsToInclude ?? '')
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean);
  assert.ok(
    splitIncludeMode === 'allOtherFields' || retainedFields.includes('analysis_run_id'),
    'each split attachments item must retain analysis_run_id',
  );
  assert.ok(
    everyPathPassesThrough(trigger.name, worker.name, [attachmentSplit.name]),
    'Worker must only be reachable downstream of Split Out',
  );

  // 6. No document-registration write exists outside the atomic creation query.
  const documentInsertNodes = nodesOfType('n8n-nodes-base.postgres').filter((node) =>
    /\bINSERT\s+INTO\s+(?:"?public"?\.)?"?tender_analysis_documents"?\b/i.test(sqlSource(node)),
  );
  assert.deepEqual(
    documentInsertNodes.map((node) => node.name),
    [creation.name],
    'all document registration must be inside the atomic creation SQL',
  );
  assert.ok(
    everyPathPassesThrough(trigger.name, worker.name, [creation.name]),
    'atomic document registration must complete before Worker can run',
  );
});
