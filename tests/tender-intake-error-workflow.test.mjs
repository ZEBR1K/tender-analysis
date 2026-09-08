import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const workflowPath = new URL(
  '../workflows/n8n-exports/TENDER — Ошибка Intake Resume.json',
  import.meta.url,
);
const documentErrorWorkflowPath = new URL(
  '../workflows/n8n-exports/TENDER — Ошибка обработки документа.json',
  import.meta.url,
);

function readWorkflow(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/u, ''));
}

function stringsIn(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(stringsIn);
  }
  return [];
}

function objectKeysIn(value) {
  if (Array.isArray(value)) return value.flatMap(objectKeysIn);
  if (!value || typeof value !== 'object') return [];
  return [
    ...Object.keys(value),
    ...Object.values(value).flatMap(objectKeysIn),
  ];
}

function codeSource(node) {
  return String(node.parameters?.jsCode ?? '');
}

function sqlSource(node) {
  return String(node.parameters?.query ?? '');
}

function outputTargets(workflow, nodeName, outputIndex = 0) {
  return (workflow.connections?.[nodeName]?.main?.[outputIndex] ?? [])
    .map((connection) => connection.node);
}

function inputCount(workflow, nodeName) {
  return Object.values(workflow.connections ?? {})
    .flatMap((connection) => connection.main ?? [])
    .flat()
    .filter((connection) => connection.node === nodeName)
    .length;
}

function codeInput(items) {
  const normalized = items.map((json) => ({ json }));
  const empty = { json: {} };
  return {
    all: () => normalized,
    first: () => normalized[0] ?? empty,
    item: normalized[0] ?? empty,
  };
}

async function runCodeNode(source, inputJson, namedInputs = {}) {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const input = codeInput(inputJson);
  const namedNode = (name) => codeInput(namedInputs[name] ?? []);
  const execute = new AsyncFunction('$input', '$', '$json', source);
  return execute(input, namedNode, input.first().json);
}

function codeResultJson(result, node, label) {
  const mode = node.parameters?.mode;

  if (mode === 'runOnceForEachItem') {
    assert.equal(
      Array.isArray(result),
      false,
      `${label} must return one item object in runOnceForEachItem mode`,
    );
    assert.ok(result?.json && typeof result.json === 'object', `${label} must return JSON`);
    assert.deepEqual(
      Object.keys(result),
      ['json'],
      `${label} must return exactly { json: {...} } in runOnceForEachItem mode`,
    );
    return result.json;
  }

  assert.equal(mode, 'runOnceForAllItems', `${label} must declare a supported Code mode`);
  assert.ok(Array.isArray(result), `${label} must return an item array in runOnceForAllItems mode`);
  assert.equal(result.length, 1, `${label} must return exactly one item`);
  assert.ok(result[0]?.json && typeof result[0].json === 'object', `${label} must return JSON`);
  return result[0].json;
}

test('intake error workflow has a guarded, bounded, audit-safe four-node contract', async () => {
  assert.ok(
    existsSync(fileURLToPath(workflowPath)),
    'planned export is absent: workflows/n8n-exports/TENDER — Ошибка Intake Resume.json',
  );

  const workflow = readWorkflow(workflowPath);
  const documentErrorWorkflow = readWorkflow(documentErrorWorkflowPath);
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  const nodesByName = new Map(nodes.map((node) => [node.name, node]));
  const expectedNames = [
    'Error Trigger',
    'Normalize Intake Error',
    'Mark Owned Intake Event Failed',
    'Return Error Audit Result',
  ];

  assert.equal(workflow.name, 'TENDER — Ошибка Intake Resume');
  assert.equal(nodes.length, 4, 'workflow must contain exactly the four contract nodes');
  assert.deepEqual(nodes.map((node) => node.name), expectedNames);
  assert.deepEqual(
    nodes.map((node) => node.type),
    [
      'n8n-nodes-base.errorTrigger',
      'n8n-nodes-base.code',
      'n8n-nodes-base.postgres',
      'n8n-nodes-base.code',
    ],
  );

  const errorTriggers = nodes.filter((node) => node.type === 'n8n-nodes-base.errorTrigger');
  assert.equal(errorTriggers.length, 1, 'expected exactly one Error Trigger');
  assert.equal(errorTriggers[0].name, 'Error Trigger');
  assert.equal(inputCount(workflow, 'Error Trigger'), 0, 'Error Trigger must be the only start');

  for (let index = 0; index < expectedNames.length - 1; index += 1) {
    assert.deepEqual(
      outputTargets(workflow, expectedNames[index]),
      [expectedNames[index + 1]],
      `${expectedNames[index]} must connect only to ${expectedNames[index + 1]}`,
    );
    assert.equal(
      inputCount(workflow, expectedNames[index + 1]),
      1,
      `${expectedNames[index + 1]} must have exactly one incoming connection`,
    );
  }
  assert.deepEqual(
    outputTargets(workflow, 'Return Error Audit Result'),
    [],
    'Return Error Audit Result must be terminal',
  );

  const normalize = nodesByName.get('Normalize Intake Error');
  const normalizeCode = codeSource(normalize);
  assert.match(normalizeCode, /\bexecution\s*\??\.\s*id\b/u);
  assert.match(normalizeCode, /\bexecution\s*\??\.\s*error\s*\??\.\s*message\b/u);
  assert.match(normalizeCode, /\bexecution\s*\??\.\s*error\s*\??\.\s*description\b/u);
  assert.match(normalizeCode, /\.trim\s*\(/u, 'execution identity and message must be trimmed');
  assert.match(normalizeCode, /\.length\b/u, 'normalizer must enforce explicit bounds');
  assert.match(normalizeCode, /\bthrow\s+new\s+Error\b/u, 'invalid execution identity must fail closed');
  assert.doesNotMatch(
    normalizeCode,
    /\$(?:execution|env)\b|\bexecutionId\b|\berrorMessage\b|\bpayload\b/u,
    'normalizer must not fall back to undocumented payload or runtime fields',
  );

  const primaryResult = codeResultJson(
    await runCodeNode(normalizeCode, [{
      execution: {
        id: '  execution-123  ',
        error: {
          message: '  primary failure  ',
          description: 'secondary failure',
        },
      },
    }]),
    normalize,
    'Normalize Intake Error',
  );
  assert.equal(primaryResult.n8n_execution_id, 'execution-123');
  assert.equal(primaryResult.error_message, 'primary failure');

  const descriptionResult = codeResultJson(
    await runCodeNode(normalizeCode, [{
      execution: {
        id: 'execution-124',
        error: { message: '   ', description: '  description failure  ' },
      },
    }]),
    normalize,
    'Normalize Intake Error description fallback',
  );
  assert.equal(descriptionResult.error_message, 'description failure');

  const fallbackResult = codeResultJson(
    await runCodeNode(normalizeCode, [{
      execution: { id: 'execution-125', error: {} },
      errorMessage: 'undocumented decoy',
    }]),
    normalize,
    'Normalize Intake Error bounded fallback',
  );
  assert.match(fallbackResult.error_message, /\S/u, 'fallback message must be non-empty');
  assert.notEqual(fallbackResult.error_message, 'undocumented decoy');
  assert.ok(fallbackResult.error_message.length <= 2000, 'fallback message must be bounded');

  const boundedMessageResult = codeResultJson(
    await runCodeNode(normalizeCode, [{
      execution: {
        id: 'execution-126',
        error: { message: `  ${'x'.repeat(2500)}  ` },
      },
    }]),
    normalize,
    'Normalize Intake Error long message',
  );
  assert.equal(boundedMessageResult.error_message.length, 2000);
  assert.equal(boundedMessageResult.error_message, 'x'.repeat(2000));

  for (const invalidInput of [
    { execution: {} },
    { execution: { id: '   ' } },
    { execution: { id: { undocumented: true } } },
    { executionId: 'undocumented-decoy' },
    { execution: { id: 'x'.repeat(4097) } },
  ]) {
    await assert.rejects(
      runCodeNode(normalizeCode, [invalidInput]),
      /execution|identity|id|required|invalid|length|bound|long/i,
      'missing, invalid, or oversized documented execution.id must fail closed',
    );
  }

  const markFailed = nodesByName.get('Mark Owned Intake Event Failed');
  assert.equal(markFailed.parameters?.operation, 'executeQuery');
  const sql = sqlSource(markFailed);
  assert.match(
    sql,
    /^\s*UPDATE\s+(?:(?:"?public"?)\.)?"?tender_analysis_intake_events"?\b/iu,
    'query must update only the intake ledger',
  );
  assert.equal((sql.match(/\bUPDATE\b/giu) ?? []).length, 1, 'query must contain one UPDATE');
  assert.doesNotMatch(
    sql,
    /\b(?:INSERT|UPSERT|DELETE|TRUNCATE|ALTER|CREATE|DROP|MERGE)\b/iu,
    'error workflow must not create, upsert, or delete state',
  );

  const setClause = sql.match(/\bSET\b([\s\S]*?)\bWHERE\b/iu)?.[1] ?? '';
  assert.match(setClause, /\bstatus\b\s*=\s*'failed'/iu);
  assert.match(setClause, /\berror_message\b\s*=\s*(?:pg_catalog\.)?left\s*\(\s*\$2\s*,\s*2000\s*\)/iu);
  assert.match(setClause, /\bupdated_at\b\s*=\s*(?:pg_catalog\.)?now\s*\(\s*\)/iu);
  assert.doesNotMatch(
    setClause,
    /\b(?:id|source|event_key|event_type|tender_id|trigger_kind|analysis_run_id|attempts|n8n_execution_id|processing_started_at|action|created_at|processed_at)\b\s*=/iu,
    'error update must preserve event ownership and audit fields',
  );

  assert.match(
    sql,
    /\bUPDATE\s+(?:(?:"?public"?)\.)?"?tender_analysis_intake_events"?\s+AS\s+"?event"?\b[\s\S]*?\bWHERE\s+"?event"?\."?id"?\s*=\s*\(\s*SELECT\s+"?owned"?\."?id"?\s+FROM\s+(?:(?:"?public"?)\.)?"?tender_analysis_intake_events"?\s+AS\s+"?owned"?\s+WHERE\s+"?owned"?\."?n8n_execution_id"?\s*=\s*\$1\s+AND\s+"?owned"?\."?status"?\s*=\s*'processing'\s*\)/iu,
    'UPDATE target must be selected by an unbounded scalar subquery so duplicate owners fail before mutation',
  );
  assert.doesNotMatch(sql, /\bLIMIT\b/iu, 'cardinality guard must not mask duplicate owners with LIMIT');
  assert.match(
    sql,
    /\bRETURNING\s+"?event"?\."?id"?\s*,\s*"?event"?\."?event_key"?\s*,\s*"?event"?\."?analysis_run_id"?\s*,\s*"?event"?\."?status"?/iu,
  );
  assert.doesNotMatch(sql, /\$[3-9]\d*\b/u, 'query contract must use only $1 and $2');

  const replacements = String(markFailed.parameters?.options?.queryReplacement ?? '');
  assert.match(replacements, /\bn8n_execution_id\b/u);
  assert.match(replacements, /\berror_message\b/u);
  assert.ok(
    replacements.indexOf('n8n_execution_id') < replacements.indexOf('error_message'),
    'query replacement order must be execution ID, then bounded error message',
  );

  const updateHasExplicitZeroRowResult = /\bWITH\b[\s\S]*\bUPDATE\b[\s\S]*\bSELECT\b[\s\S]*\bevent_updated\b/iu.test(sql);
  assert.ok(
    markFailed.alwaysOutputData === true || updateHasExplicitZeroRowResult,
    'zero-row UPDATE must emit an item through alwaysOutputData or an explicit SQL sentinel',
  );

  const returnNode = nodesByName.get('Return Error Audit Result');
  const returnCode = codeSource(returnNode);
  assert.match(returnCode, /\bevent_updated\b/u);
  assert.match(returnCode, /\breturn\s*\[/iu);

  const namedNormalizeInput = { 'Normalize Intake Error': [primaryResult] };
  const zeroRowResult = codeResultJson(
    await runCodeNode(returnCode, [{}], namedNormalizeInput),
    returnNode,
    'Return Error Audit Result zero-row case',
  );
  assert.equal(zeroRowResult.event_updated, false);
  assert.equal(zeroRowResult.n8n_execution_id, 'execution-123');

  const returnedRow = {
    id: '11111111-1111-4111-8111-111111111111',
    event_key: 'tenderplan:mark:123',
    analysis_run_id: '22222222-2222-4222-8222-222222222222',
    status: 'failed',
  };
  const oneRowResult = codeResultJson(
    await runCodeNode(returnCode, [returnedRow], namedNormalizeInput),
    returnNode,
    'Return Error Audit Result updated-row case',
  );
  assert.equal(oneRowResult.event_updated, true);
  assert.equal(oneRowResult.event_id, returnedRow.id);
  assert.equal(oneRowResult.event_key, returnedRow.event_key);
  assert.equal(oneRowResult.analysis_run_id, returnedRow.analysis_run_id);
  assert.equal(oneRowResult.status, 'failed');
  assert.equal(oneRowResult.n8n_execution_id, 'execution-123');

  const oversizedAuditRow = {
    id: 'i'.repeat(5000),
    event_key: 'e'.repeat(5000),
    analysis_run_id: 'r'.repeat(5000),
    status: 'failed',
  };
  const boundedAuditResult = codeResultJson(
    await runCodeNode(returnCode, [oversizedAuditRow], namedNormalizeInput),
    returnNode,
    'Return Error Audit Result bounded audit case',
  );
  for (const field of ['event_id', 'event_key', 'analysis_run_id']) {
    assert.match(String(boundedAuditResult[field] ?? ''), /\S/u, `${field} must remain useful`);
    assert.ok(
      String(boundedAuditResult[field]).length < 5000,
      `${field} must be bounded before returning audit data`,
    );
  }
  assert.equal(boundedAuditResult.status, 'failed');

  const referencePostgresCredential = documentErrorWorkflow.nodes
    ?.find((node) => node.type === 'n8n-nodes-base.postgres')
    ?.credentials?.postgres;
  assert.ok(referencePostgresCredential, 'document error workflow must provide the credential reference pattern');
  assert.deepEqual(
    markFailed.credentials,
    { postgres: referencePostgresCredential },
    'only the existing named PostgreSQL credential reference may be reused',
  );
  assert.deepEqual(
    nodes.filter((node) => node.credentials).map((node) => node.name),
    ['Mark Owned Intake Event Failed'],
    'no other node may carry credentials',
  );
  assert.doesNotMatch(
    objectKeysIn(workflow).join('\n'),
    /^(?:password|passphrase|secret|token|api[_-]?key|authorization)$/imu,
    'workflow must not contain secret-bearing fields',
  );
  assert.doesNotMatch(
    stringsIn(workflow).join('\n'),
    /\bBearer\s+[A-Za-z0-9._~+/=-]+|postgres(?:ql)?:\/\//iu,
    'workflow must not embed tokens or database connection strings',
  );

  assert.equal(workflow.active, false, 'repository workflow candidate must remain inactive');
  assert.equal(workflow.settings?.executionOrder, 'v1');

  const workflowText = stringsIn(workflow).join('\n');
  assert.doesNotMatch(workflowText, /\btender_analysis_documents\b/iu);
  assert.doesNotMatch(workflowText, /\bdocument_(?:id|index|status)\b/iu);
  assert.equal(
    nodes.some((node) => /документ|document/iu.test(node.name)),
    false,
    'intake error workflow must not inherit document-error behavior',
  );
});

test('intake error SQL fails before mutation when execution ownership is ambiguous', () => {
  const workflow = readWorkflow(workflowPath);
  const markFailed = workflow.nodes?.find(
    (node) => node.name === 'Mark Owned Intake Event Failed',
  );
  const sql = sqlSource(markFailed);

  assert.match(
    sql,
    /\bUPDATE\s+(?:(?:"?public"?)\.)?"?tender_analysis_intake_events"?\s+AS\s+"?event"?\b[\s\S]*?\bWHERE\s+"?event"?\."?id"?\s*=\s*\(\s*SELECT\s+"?owned"?\."?id"?\s+FROM\s+(?:(?:"?public"?)\.)?"?tender_analysis_intake_events"?\s+AS\s+"?owned"?\s+WHERE\s+"?owned"?\."?n8n_execution_id"?\s*=\s*\$1\s+AND\s+"?owned"?\."?status"?\s*=\s*'processing'\s*\)/iu,
    'ambiguous n8n_execution_id ownership must raise a scalar-subquery cardinality error before UPDATE',
  );
  assert.doesNotMatch(sql, /\bLIMIT\b/iu, 'LIMIT must not hide duplicate ownership');
});
