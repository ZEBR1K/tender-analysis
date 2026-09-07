import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflowPath = new URL(
  '../workflows/n8n-exports/%D0%A2%D0%95%D0%9D%D0%94%D0%95%D0%A0%D0%AB%20%D0%9E%D0%A0%D0%9A%D0%95%D0%A1%D0%A2%D0%A0%D0%90%D0%A2%D0%9E%D0%A0.json',
  import.meta.url,
);
const workerWorkflowPath = new URL(
  '../workflows/n8n-exports/TENDER — Обработать документ.json',
  import.meta.url,
);

const workflow = JSON.parse(
  readFileSync(workflowPath, 'utf8').replace(/^\uFEFF/, ''),
);
const workerWorkflow = JSON.parse(
  readFileSync(workerWorkflowPath, 'utf8').replace(/^\uFEFF/, ''),
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

function cteBody(sql, name) {
  const ctePattern = new RegExp(`(?:\\bWITH|,)\\s*"?${name}"?\\s+AS\\s*\\(`, 'i');
  const match = ctePattern.exec(sql);
  assert.ok(match, `atomic creation SQL must define ${name}`);

  const openIndex = match.index + match[0].lastIndexOf('(');
  let depth = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = openIndex; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];

    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (character === quote && next === quote) {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '-' && next === '-') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === '(') depth += 1;
    if (character === ')') {
      depth -= 1;
      if (depth === 0) {
        return {
          body: sql.slice(openIndex + 1, index),
          endIndex: index + 1,
        };
      }
    }
  }

  assert.fail(`could not find the closing parenthesis for ${name}`);
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
    !/\b(?:INSERT|UPDATE|DELETE)\b/i.test(sql)
  );
}

function regexEscape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validatedInputVariable(code, validationNodeName) {
  const escapedName = regexEscape(validationNodeName);
  return code.match(
    new RegExp(
      `\\bconst\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*\\$\\(\\s*['"]${escapedName}['"]\\s*\\)\\.(?:item|first\\(\\))\\.json\\b`,
    ),
  )?.[1];
}

function structuredTerminalCodeNodes() {
  const requiredFields = [
    'analysis_run_id',
    'source',
    'tender_id',
    'source_event_key',
    'trigger_kind',
    'created_new_run',
    'action',
    'next_state',
    'documents_total',
    'registered_documents_count',
    'documents_dispatched',
  ];

  return nodesOfType('n8n-nodes-base.code').filter((node) => {
    const code = codeSource(node);
    return (
      requiredFields.every((field) => new RegExp(`\\b${field}\\b`).test(code)) &&
      /\breturn\s*\[\s*\{\s*json\s*:/i.test(code)
    );
  });
}

function codeThrowsOnMismatch(code, leftVariable, rightVariable) {
  const left = regexEscape(leftVariable);
  const right = regexEscape(rightVariable);
  const comparisons = [
    new RegExp(`\\b${left}\\s*!==\\s*${right}\\b`),
    new RegExp(`\\b${right}\\s*!==\\s*${left}\\b`),
  ];

  return [...code.matchAll(/\bif\s*\(([\s\S]{1,400}?)\)\s*\{?([\s\S]{0,200}?)\bthrow\s+new\s+Error\b/gi)]
    .some((match) => comparisons.some((comparison) => comparison.test(match[1])));
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

  const nodesWithLiteralTenderIds = nodes.filter(
    (node) => stringsIn(node.parameters).some(
      (value) => /(?<![0-9a-z])[0-9a-f]{24}(?![0-9a-z])/i.test(value),
    ),
  );
  assert.deepEqual(
    nodesWithLiteralTenderIds.map((node) => node.name),
    [],
    'node parameters must not contain literal standalone 24-hex tender IDs',
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

  assert.doesNotMatch(
    creationSql,
    /\bUPDATE\s+(?:"?public"?\.)?"?tender_analysis_runs"?\b/i,
    'same-snapshot atomic creation SQL must not UPDATE tender_analysis_runs',
  );

  const insertedRun = cteBody(creationSql, 'inserted_run');
  assert.match(
    insertedRun.body,
    /\bINSERT\s+INTO\s+(?:"?public"?\.)?"?tender_analysis_runs"?\b/i,
    'inserted_run must insert the analysis run',
  );
  assert.match(
    insertedRun.body,
    /'processing'/i,
    "inserted_run must insert status 'processing' directly",
  );
  assert.doesNotMatch(
    insertedRun.body,
    /'created'/i,
    "inserted_run must not insert the intermediate status 'created'",
  );

  const activatedRun = cteBody(creationSql, 'activated_run');
  assert.match(
    activatedRun.body,
    /^\s*SELECT\b/i,
    'activated_run must be a read-only SELECT',
  );
  assert.doesNotMatch(
    activatedRun.body,
    /\b(?:INSERT|UPDATE|DELETE)\b/i,
    'activated_run must not be data-modifying',
  );
  assert.match(
    activatedRun.body,
    /\bFROM\s+"?inserted_run"?\b/i,
    'activated_run must select from inserted_run',
  );
  assert.match(
    activatedRun.body,
    /\b(?:CROSS\s+JOIN|JOIN)\s+"?document_stats"?\b/i,
    'activated_run must cross/join document_stats',
  );

  const finalTrueResult = creationSql
    .slice(activatedRun.endIndex)
    .match(/^\s*SELECT\b[\s\S]*?(?=\bUNION\s+ALL\b|$)/i)?.[0];
  assert.ok(finalTrueResult, 'atomic creation SQL must have a final true-result SELECT');
  assert.match(
    finalTrueResult,
    /\bTRUE\b\s+AS\s+"?created_new_run"?/i,
    'final result from activated_run must emit created_new_run=true',
  );
  assert.match(
    finalTrueResult,
    /\bFROM\s+"?activated_run"?\b/i,
    'final created_new_run=true result must select from activated_run',
  );

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
  const workerTriggers = (workerWorkflow.nodes ?? []).filter(
    (node) => node.type === 'n8n-nodes-base.executeWorkflowTrigger',
  );
  assert.equal(
    workerTriggers.length,
    1,
    'canonical Worker must have exactly one Execute Workflow Trigger',
  );
  assert.equal(
    workerTriggers[0].parameters?.inputSource,
    'passthrough',
    'canonical Worker trigger must accept all input data via passthrough',
  );

  assert.equal(worker.parameters?.mode, 'each', 'Worker Execute Workflow must use mode=each');
  assert.ok(configuredWorkflowId(worker), 'Worker Execute Workflow must configure one workflowId');
  assert.equal(
    Array.isArray(worker.parameters?.workflowId),
    false,
    'Worker Execute Workflow must not configure multiple workflowIds',
  );
  assert.equal(
    worker.parameters?.workflowInputs?.mappingMode,
    'defineBelow',
    'Worker caller must use the established empty defineBelow mapping form',
  );
  assert.deepEqual(
    worker.parameters?.workflowInputs?.value,
    {},
    'Worker caller mapping value must be empty for passthrough',
  );
  assert.deepEqual(
    worker.parameters?.workflowInputs?.schema,
    [],
    'Worker caller mapping schema must be empty for passthrough',
  );

  const splitIncludeMode = attachmentSplit.parameters?.include;
  const retainedFields = String(attachmentSplit.parameters?.fieldsToInclude ?? '')
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean);
  assert.ok(
    splitIncludeMode === 'allOtherFields' ||
      ['analysis_run_id', 'tender_meta'].every((field) => retainedFields.includes(field)),
    'each split attachments item must explicitly retain analysis_run_id and tender_meta',
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

test('normalization rejects a mismatched TenderPlan identity', () => {
  const trigger = nodesOfType('n8n-nodes-base.executeWorkflowTrigger')[0];
  const fullInfoHttp = nodesOfType('n8n-nodes-base.httpRequest').find((node) =>
    /\/fullinfo\b/i.test(String(node.parameters?.url ?? '')),
  );
  const creation = nodesOfType('n8n-nodes-base.postgres').find((node) =>
    /\bINSERT\s+INTO\s+(?:"?public"?\.)?"?tender_analysis_runs"?\b/i.test(sqlSource(node)),
  );
  assert.ok(trigger && fullInfoHttp && creation, 'expected trigger, FullInfo, and run creation nodes');

  const validationNodes = nodesOfType('n8n-nodes-base.code').filter((node) =>
    canReach(trigger.name, node.name) &&
    canReach(node.name, fullInfoHttp.name) &&
    codeChecksTypedInput(codeSource(node)),
  );
  assert.equal(validationNodes.length, 1, 'expected exactly one typed-input validation node');
  const validation = validationNodes[0];

  const normalizationNodes = nodesOfType('n8n-nodes-base.code').filter((node) =>
    canReach(fullInfoHttp.name, node.name) && canReach(node.name, creation.name),
  );
  assert.equal(normalizationNodes.length, 1, 'expected exactly one FullInfo normalization node');
  const normalizationCode = codeSource(normalizationNodes[0]);
  const requestVariable = validatedInputVariable(normalizationCode, validation.name);
  assert.ok(
    requestVariable,
    'normalization must read the validated request from the typed-input validation node',
  );

  const requestedIdVariable = normalizationCode.match(
    new RegExp(
      `\\bconst\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:String\\(\\s*)?${regexEscape(requestVariable)}\\.tender_id\\b`,
    ),
  )?.[1];
  const responseIdVariable = normalizationCode.match(
    /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*typeof\s+tender\._id\s*===\s*['"]string['"]\s*\?\s*tender\._id\.trim\s*\(\s*\)\s*:\s*['"]{2}\s*;/,
  )?.[1];
  assert.ok(requestedIdVariable, 'normalization must bind the validated requested tender_id');
  assert.ok(
    responseIdVariable,
    'normalization must bind TenderPlan tender._id only when it is a string',
  );
  assert.doesNotMatch(
    normalizationCode,
    /\bString\s*\(\s*tender\._id\b/,
    'normalization must not coerce a non-string TenderPlan tender._id',
  );
  assert.ok(
    codeThrowsOnMismatch(normalizationCode, responseIdVariable, requestedIdVariable),
    'normalization must fail closed when TenderPlan tender._id differs from requested tender_id',
  );
});

test('normalization preserves validated intake provenance through run creation', () => {
  const trigger = nodesOfType('n8n-nodes-base.executeWorkflowTrigger')[0];
  const fullInfoHttp = nodesOfType('n8n-nodes-base.httpRequest').find((node) =>
    /\/fullinfo\b/i.test(String(node.parameters?.url ?? '')),
  );
  const creation = nodesOfType('n8n-nodes-base.postgres').find((node) =>
    /\bINSERT\s+INTO\s+(?:"?public"?\.)?"?tender_analysis_runs"?\b/i.test(sqlSource(node)),
  );
  assert.ok(trigger && fullInfoHttp && creation, 'expected trigger, FullInfo, and run creation nodes');

  const validation = nodesOfType('n8n-nodes-base.code').find((node) =>
    canReach(trigger.name, node.name) &&
    canReach(node.name, fullInfoHttp.name) &&
    codeChecksTypedInput(codeSource(node)),
  );
  const normalization = nodesOfType('n8n-nodes-base.code').find((node) =>
    canReach(fullInfoHttp.name, node.name) && canReach(node.name, creation.name),
  );
  assert.ok(validation && normalization, 'expected validation and normalization nodes');
  const normalizationCode = codeSource(normalization);
  const requestVariable = validatedInputVariable(normalizationCode, validation.name);
  assert.ok(
    requestVariable,
    'normalization must read the validated request before preserving provenance',
  );

  for (const field of ['source', 'source_event_key', 'trigger_kind']) {
    assert.match(
      normalizationCode,
      new RegExp(`\\b${field}\\s*:\\s*${regexEscape(requestVariable)}\\.${field}\\b`),
      `normalization output must preserve validated ${field}`,
    );
  }
  assert.match(
    String(creation.parameters?.options?.queryReplacement ?? ''),
    /\$json\.source\b/,
    'run creation must bind source from the preserved validated input',
  );
});

test('unfinished-run lookup exposes duplicate invariant violations to the count guard', () => {
  const resumeSelectNodes = nodes.filter(isUnfinishedRunSelect);
  assert.equal(resumeSelectNodes.length, 1, 'expected exactly one unfinished-run SELECT');
  assert.doesNotMatch(
    sqlSource(resumeSelectNodes[0]),
    /\bLIMIT\s+1\b/i,
    'unfinished-run SELECT must not mask duplicates with LIMIT 1',
  );

  const countGuards = nodesOfType('n8n-nodes-base.code').filter((node) => {
    const code = codeSource(node);
    return (
      canReach(resumeSelectNodes[0].name, node.name) &&
      /\$input\.all\s*\(\s*\)/.test(code) &&
      /\.length\s*!==\s*1\b/.test(code) &&
      /throw\s+new\s+Error\b/i.test(code)
    );
  });
  assert.equal(
    countGuards.length,
    1,
    'all unfinished rows must reach the existing exactly-one count guard',
  );
});

test('orchestrator dispatches Workers asynchronously', () => {
  const attachmentSplit = nodesOfType('n8n-nodes-base.splitOut').find(
    (node) => String(node.parameters?.fieldToSplitOut ?? '').trim() === 'attachments',
  );
  assert.ok(attachmentSplit, 'expected attachments Split Out');
  const workerNodes = nodesOfType('n8n-nodes-base.executeWorkflow').filter((node) =>
    canReach(attachmentSplit.name, node.name),
  );
  assert.equal(workerNodes.length, 1, 'expected one Worker dispatch');
  assert.equal(
    workerNodes[0].parameters?.options?.waitForSubWorkflow,
    false,
    'Worker dispatch must be fire-and-forget with waitForSubWorkflow=false',
  );
});

test('created and concurrent paths return one symmetric structured result', () => {
  const creation = nodesOfType('n8n-nodes-base.postgres').find((node) =>
    /\bINSERT\s+INTO\s+(?:"?public"?\.)?"?tender_analysis_runs"?\b/i.test(sqlSource(node)),
  );
  assert.ok(creation, 'expected run creation node');
  const createdNewRunIf = nodesByName.get(outputTargets(creation.name, 0)[0]);
  assert.equal(createdNewRunIf?.type, 'n8n-nodes-base.if', 'creation must feed created-new-run IF');

  const attachmentSplit = nodesOfType('n8n-nodes-base.splitOut').find(
    (node) => String(node.parameters?.fieldToSplitOut ?? '').trim() === 'attachments',
  );
  assert.ok(attachmentSplit, 'expected attachments Split Out');
  const workerNodes = nodesOfType('n8n-nodes-base.executeWorkflow').filter((node) =>
    canReach(attachmentSplit.name, node.name),
  );
  assert.equal(workerNodes.length, 1, 'expected one Worker dispatch');
  const worker = workerNodes[0];

  const concurrentGuards = nodesOfType('n8n-nodes-base.code').filter((node) =>
    /\baction\b\s*:\s*['"]concurrent_existing_run['"]/i.test(codeSource(node)),
  );
  assert.equal(concurrentGuards.length, 1, 'expected one concurrent-run guard');

  const terminalNodes = structuredTerminalCodeNodes();
  assert.equal(
    terminalNodes.length,
    1,
    'created and concurrent paths must share exactly one structured terminal-result Code node',
  );
  const terminal = terminalNodes[0];
  assert.equal(
    terminal.parameters?.mode,
    'runOnceForAllItems',
    'terminal-result Code node must run once for all incoming items',
  );
  assert.ok(
    outputTargets(createdNewRunIf.name, 0).some((target) => canReach(target, terminal.name)),
    'created_new_run=true must reach the shared terminal result',
  );
  assert.ok(
    canReach(concurrentGuards[0].name, terminal.name),
    'concurrent existing-run path must reach the same terminal result',
  );
  assert.ok(
    outputTargets(createdNewRunIf.name, 0).some((target) =>
      canReach(target, terminal.name, new Set([worker.name])),
    ),
    'new-run result must reach the terminal without depending on Worker child output',
  );
  assert.equal(
    canReach(worker.name, terminal.name),
    false,
    'structured new-run result must not be derived from Worker child output',
  );
  assert.match(
    codeSource(terminal),
    new RegExp(`\\$\\(\\s*['"]${regexEscape(creation.name)}['"]\\s*\\)`),
    'terminal result must explicitly read the created run from the atomic creation node',
  );
  const trigger = nodesOfType('n8n-nodes-base.executeWorkflowTrigger')[0];
  const validation = nodesOfType('n8n-nodes-base.code').find((node) =>
    canReach(trigger.name, node.name) && codeChecksTypedInput(codeSource(node)),
  );
  assert.ok(validation, 'expected typed-input validation node');
  const terminalRequestVariable = validatedInputVariable(codeSource(terminal), validation.name);
  assert.ok(
    terminalRequestVariable,
    'terminal result must read validated intake provenance directly',
  );
  for (const field of ['source', 'source_event_key', 'trigger_kind']) {
    assert.match(
      codeSource(terminal),
      new RegExp(`\\b${field}\\s*:\\s*${regexEscape(terminalRequestVariable)}\\.${field}\\b`),
      `terminal result must preserve validated ${field}`,
    );
  }
  assert.match(
    codeSource(terminal),
    /\bnext_state\s*:\s*row\.status\b/,
    'terminal next_state must expose the lifecycle run status',
  );
  assert.doesNotMatch(
    codeSource(terminal),
    /\bconst\s+nextState\b/,
    'terminal action outcome must not be stored in next_state',
  );
  assert.match(
    codeSource(terminal),
    /\breturn\s*\[\s*\{\s*json\s*:/i,
    'terminal result must return one explicit n8n item',
  );
});

test('zero supported documents bypass Split Out and return the shared structured result', () => {
  const creation = nodesOfType('n8n-nodes-base.postgres').find((node) =>
    /\bINSERT\s+INTO\s+(?:"?public"?\.)?"?tender_analysis_runs"?\b/i.test(sqlSource(node)),
  );
  assert.ok(creation, 'expected run creation node');
  const createdNewRunIf = nodesByName.get(outputTargets(creation.name, 0)[0]);
  assert.equal(createdNewRunIf?.type, 'n8n-nodes-base.if', 'creation must feed created-new-run IF');

  const attachmentSplit = nodesOfType('n8n-nodes-base.splitOut').find(
    (node) => String(node.parameters?.fieldToSplitOut ?? '').trim() === 'attachments',
  );
  assert.ok(attachmentSplit, 'expected attachments Split Out');

  const extensionFilter = nodes.find(
    (node) => node.type === 'n8n-nodes-base.filter' && canReach(attachmentSplit.name, node.name),
  );
  assert.ok(extensionFilter, 'expected supported-extension filter downstream of Split Out');
  const supportedExtensions = (extensionFilter.parameters?.conditions?.conditions ?? [])
    .map((condition) => String(condition.rightValue ?? '').trim().toLowerCase())
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index);
  assert.ok(supportedExtensions.length > 0, 'extension filter must declare supported extensions');

  const supportedDocumentGates = nodesOfType('n8n-nodes-base.if').filter((node) => {
    if (node.name === createdNewRunIf.name) return false;
    const parameterStrings = stringsIn(node.parameters);
    return (
      outputTargets(createdNewRunIf.name, 0).some((target) => canReach(target, node.name)) &&
      canReach(node.name, attachmentSplit.name) &&
      parameterStrings.some((value) => /attachments/i.test(value)) &&
      supportedExtensions.every((extension) =>
        parameterStrings.some((value) => value.toLowerCase().includes(extension.toLowerCase())),
      )
    );
  });
  assert.equal(
    supportedDocumentGates.length,
    1,
    'new runs must pass through one pre-Split gate that checks for supported attachments',
  );
  const gate = supportedDocumentGates[0];
  const terminalNodes = structuredTerminalCodeNodes();
  assert.equal(terminalNodes.length, 1, 'expected one shared structured terminal result');
  const terminal = terminalNodes[0];
  const splitOutputs = [0, 1].filter((index) =>
    outputTargets(gate.name, index).some((target) => canReach(target, attachmentSplit.name)),
  );
  assert.equal(splitOutputs.length, 1, 'supported-document gate must have one dispatch output');
  const supportedOutput = splitOutputs[0];
  assert.deepEqual(
    outputTargets(gate.name, supportedOutput),
    [attachmentSplit.name, terminal.name],
    'supported-document output must fan out directly to Split Out first and terminal result second',
  );

  const noDocumentOutput = supportedOutput === 0 ? 1 : 0;
  assert.deepEqual(
    outputTargets(gate.name, noDocumentOutput),
    [terminal.name],
    'empty/unsupported-document output must go directly to the shared terminal result',
  );
});
