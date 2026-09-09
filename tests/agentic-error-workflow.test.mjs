import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const workflowPath = new URL('../workflows/n8n-exports/TENDER — Ошибка агентского анализа.json', import.meta.url);

async function loadWorkflow() {
  return JSON.parse(await readFile(workflowPath, 'utf8'));
}

function findNode(workflow, name) {
  const node = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(node, `missing node ${name}`);
  return node;
}

async function runClassifier(source, payload) {
  return new vm.Script(`(async()=>{${source}})()`).runInNewContext({
    $input: { first: () => ({ json: payload }) },
    String,
  });
}

function applyOwnershipModel(rows, event) {
  const next = structuredClone(rows);
  if (!event.execution_id) return { rows: next, outcome: 'invalid_identity', update_count: 0 };

  if (event.source_kind === 'dispatch') {
    const owned = next.filter(({ dispatch_execution_id }) => dispatch_execution_id === event.execution_id);
    if (owned.some(({ status }) => ['completed', 'canceled', 'failed'].includes(status))) {
      return { rows: next, outcome: 'terminal_no_op', update_count: 0 };
    }
    const eligible = owned.filter(({ status }) => ['created', 'staging', 'ready'].includes(status));
    if (eligible.length !== 1) {
      return { rows: next, outcome: 'ownership_lost', update_count: 0 };
    }
    const [row] = eligible;
    row.status = 'failed';
    row.dispatch_execution_id = null;
    row.error_code = event.error_code;
    row.error_message = event.error_message;
    return { rows: next, outcome: 'dispatch_failed', update_count: 1 };
  }

  if (event.source_kind === 'monitor') {
    const owned = next.filter(({ poll_owner_execution_id }) => poll_owner_execution_id === event.execution_id);
    if (owned.some(({ status }) => ['completed', 'canceled', 'failed'].includes(status))) {
      return { rows: next, outcome: 'terminal_no_op', update_count: 0 };
    }
    const eligible = owned.filter(({ status }) => ['ready', 'running', 'validating'].includes(status));
    for (const row of eligible) {
      row.poll_owner_execution_id = null;
      row.poll_claimed_at = null;
      row.validation_summary = {
        ...row.validation_summary,
        monitor_error_count: Math.min((row.validation_summary.monitor_error_count ?? 0) + 1, 1000000),
        monitor_error: { code: event.error_code, message: event.error_message },
      };
    }
    return { rows: next, outcome: eligible.length ? 'monitor_lease_released' : 'ownership_lost', update_count: eligible.length };
  }
  return { rows: next, outcome: 'unsupported_workflow', update_count: 0 };
}

const baseRows = () => [
  {
    id: '11111111-1111-4111-8111-111111111111', status: 'staging',
    dispatch_execution_id: 'dispatch-17', poll_owner_execution_id: null, poll_claimed_at: null,
    error_code: null, error_message: null, validation_summary: {},
    staged_documents: 12, artifacts: { runner: 'preserved' },
  },
  {
    id: '22222222-2222-4222-8222-222222222222', status: 'running',
    dispatch_execution_id: null, poll_owner_execution_id: 'monitor-8', poll_claimed_at: 'now',
    error_code: null, error_message: null, validation_summary: { runner_attempt: 1 },
    staged_documents: 4, artifacts: { log: 'preserved' },
  },
  {
    id: '33333333-3333-4333-8333-333333333333', status: 'completed',
    dispatch_execution_id: null, poll_owner_execution_id: null, poll_claimed_at: null,
    error_code: null, error_message: null, validation_summary: { valid: true },
    staged_documents: 2, artifacts: { result: 'preserved' },
  },
];

test('export is inactive, identity-neutral, secret-free and linearly connected', async () => {
  const workflow = await loadWorkflow();
  assert.equal(workflow.name, 'TENDER — Ошибка агентского анализа');
  assert.equal(workflow.active, false);
  assert.deepEqual(workflow.pinData, {});
  for (const key of ['id', 'versionId', 'activeVersionId', 'meta']) assert.equal(key in workflow, false);
  assert.equal(workflow.settings?.errorWorkflow, undefined);
  assert.deepEqual(workflow.nodes.map(({ name }) => name), [
    'Error Trigger',
    'Нормализовать agentic error',
    'Применить ownership guard',
  ]);
  assert.deepEqual(workflow.connections['Error Trigger'].main[0].map(({ node }) => node), ['Нормализовать agentic error']);
  assert.deepEqual(workflow.connections['Нормализовать agentic error'].main[0].map(({ node }) => node), ['Применить ownership guard']);
  assert.deepEqual(findNode(workflow, 'Применить ownership guard').credentials.postgres, {
    id: 'POSTGRES_CREDENTIAL_ID',
    name: 'KITATEH Tenders',
  });
});

test('classifier executes documented Error Trigger shapes and emits only bounded safe context', async () => {
  const workflow = await loadWorkflow();
  const source = findNode(workflow, 'Нормализовать agentic error').parameters.jsCode;
  const longSecret = `GET https://signed.example/file?token=super-secret ${'x'.repeat(2000)}`;
  const dispatch = (await runClassifier(source, {
    execution: { id: ' dispatch-17 ', error: { message: longSecret, stack: 'PRIVATE STACK' }, url: 'https://n8n/execution/17' },
    workflow: { id: 'private-id', name: 'TENDER — Агентский анализ — Запуск' },
    binary: { data: 'PRIVATE BYTES' },
    headers: { authorization: 'Bearer private' },
  }))[0].json;
  assert.deepEqual(Object.keys(dispatch).sort(), ['error_code', 'error_message', 'execution_id', 'source_kind']);
  assert.equal(dispatch.source_kind, 'dispatch');
  assert.equal(dispatch.execution_id, 'dispatch-17');
  assert.equal(dispatch.error_code, 'DISPATCH_WORKFLOW_FAILED');
  assert.ok(dispatch.error_message.length <= 500);
  assert.doesNotMatch(JSON.stringify(dispatch), /https?:|signed\.example|super-secret|PRIVATE|Bearer/iu);

  for (const credentialLike of ['Bearer eyJhbGciOiJIUzI1NiJ9', 'password is hunter2', 'API key sk-private']) {
    const redacted = (await runClassifier(source, {
      execution: { id: 'dispatch-17', error: { message: credentialLike } },
      workflow: { name: 'TENDER — Агентский анализ — Запуск' },
    }))[0].json;
    assert.equal(redacted.error_message, 'Agentic dispatch workflow failed');
    assert.doesNotMatch(JSON.stringify(redacted), /eyJ|hunter2|sk-private/u);
  }

  const monitor = (await runClassifier(source, {
    execution: { id: 'monitor-8', error: { description: 'socket timeout on internal runner' } },
    workflow: { name: 'TENDER — Агентский анализ — Монитор' },
  }))[0].json;
  assert.equal(monitor.source_kind, 'monitor');
  assert.equal(monitor.error_code, 'MONITOR_WORKFLOW_FAILED');
  assert.match(monitor.error_message, /socket timeout/iu);
});

test('missing or invalid execution identity is an explicit fail-closed no-op', async () => {
  const workflow = await loadWorkflow();
  const source = findNode(workflow, 'Нормализовать agentic error').parameters.jsCode;
  for (const id of [undefined, '', 'x'.repeat(4097), { unsafe: true }]) {
    const result = (await runClassifier(source, {
      execution: { id, error: { message: 'failure' } },
      workflow: { name: 'TENDER — Агентский анализ — Запуск' },
    }))[0].json;
    assert.equal(result.source_kind, 'invalid_identity');
    assert.equal(result.execution_id, null);
    assert.equal(result.error_code, 'AGENTIC_ERROR_IDENTITY_INVALID');
  }
});

test('dispatch failure changes only exact owned pre-start job and preserves staged/audit state', () => {
  const before = baseRows();
  const unrelated = structuredClone(before.slice(1));
  const result = applyOwnershipModel(before, {
    source_kind: 'dispatch', execution_id: 'dispatch-17',
    error_code: 'DISPATCH_WORKFLOW_FAILED', error_message: 'bounded',
  });
  assert.equal(result.outcome, 'dispatch_failed');
  assert.equal(result.rows[0].status, 'failed');
  assert.equal(result.rows[0].staged_documents, 12);
  assert.deepEqual(result.rows[0].artifacts, { runner: 'preserved' });
  assert.deepEqual(result.rows.slice(1), unrelated);
});

test('wrong dispatch owner and running job remain byte-identical', () => {
  for (const setup of ['wrong_owner', 'running_owner']) {
    const before = baseRows();
    let execution_id = 'wrong-owner';
    if (setup === 'running_owner') {
      before[0].dispatch_execution_id = null;
      before[1].dispatch_execution_id = 'dispatch-17';
      execution_id = 'dispatch-17';
    }
    const snapshot = JSON.stringify(before);
    const result = applyOwnershipModel(before, {
      source_kind: 'dispatch', execution_id,
      error_code: 'DISPATCH_WORKFLOW_FAILED', error_message: 'bounded',
    });
    assert.equal(result.outcome, 'ownership_lost');
    assert.equal(JSON.stringify(result.rows), snapshot);
  }
});

test('monitor crash releases only exact lease, records bounded audit and never fails job', () => {
  const before = baseRows();
  const unrelated = structuredClone([before[0], before[2]]);
  const result = applyOwnershipModel(before, {
    source_kind: 'monitor', execution_id: 'monitor-8',
    error_code: 'MONITOR_WORKFLOW_FAILED', error_message: 'bounded',
  });
  assert.equal(result.outcome, 'monitor_lease_released');
  assert.equal(result.rows[1].status, 'running');
  assert.equal(result.rows[1].poll_owner_execution_id, null);
  assert.deepEqual(result.rows[1].validation_summary.monitor_error, { code: 'MONITOR_WORKFLOW_FAILED', message: 'bounded' });
  assert.equal(result.rows[1].validation_summary.monitor_error_count, 1);
  assert.deepEqual([result.rows[0], result.rows[2]], unrelated);
});

test('one monitor execution atomically releases both of its exact claimed leases', () => {
  const before = baseRows();
  before.push({ ...structuredClone(before[1]), id: '44444444-4444-4444-8444-444444444444', status: 'validating' });
  const result = applyOwnershipModel(before, {
    source_kind: 'monitor', execution_id: 'monitor-8',
    error_code: 'MONITOR_WORKFLOW_FAILED', error_message: 'bounded',
  });
  assert.equal(result.outcome, 'monitor_lease_released');
  assert.equal(result.update_count, 2);
  assert.deepEqual(result.rows.filter(({ id }) => [before[1].id, before[3].id].includes(id)).map(({ poll_owner_execution_id }) => poll_owner_execution_id), [null, null]);
  assert.deepEqual(result.rows[0], before[0]);
  assert.deepEqual(result.rows[2], before[2]);
});

test('wrong monitor owner, missing identity and terminal rows remain byte-identical', () => {
  const scenarios = [
    { source_kind: 'monitor', execution_id: 'wrong-owner', expected: 'ownership_lost' },
    { source_kind: 'monitor', execution_id: null, expected: 'invalid_identity' },
    ...['completed', 'canceled', 'failed'].map((status) => ({ source_kind: 'dispatch', execution_id: 'dispatch-17', status, expected: 'terminal_no_op' })),
  ];
  for (const scenario of scenarios) {
    const rows = baseRows();
    if (scenario.status) rows[0].status = scenario.status;
    const snapshot = JSON.stringify(rows);
    const result = applyOwnershipModel(rows, {
      ...scenario,
      error_code: 'SAFE', error_message: 'bounded',
    });
    assert.equal(result.outcome, scenario.expected);
    assert.equal(JSON.stringify(result.rows), snapshot);
  }
});

test('one parameterized SQL statement guards both owners and always returns one explicit outcome', async () => {
  const workflow = await loadWorkflow();
  const node = findNode(workflow, 'Применить ownership guard');
  const sql = node.parameters.query;
  assert.equal(node.type, 'n8n-nodes-base.postgres');
  assert.match(sql, /dispatch_execution_id\s*=\s*input\.execution_id/iu);
  assert.match(sql, /status\s+IN\s*\('created',\s*'staging',\s*'ready'\)/iu);
  assert.match(sql, /poll_owner_execution_id\s*=\s*input\.execution_id/iu);
  assert.match(sql, /status\s+IN\s*\('ready',\s*'running',\s*'validating'\)/iu);
  assert.match(sql, /poll_owner_execution_id\s*=\s*NULL/iu);
  assert.match(sql, /validation_summary/iu);
  assert.match(sql, /monitor_error_count/iu);
  assert.match(sql, /LEAST\([\s\S]+1000000\s*\)/iu);
  assert.match(sql, /count\(\*\).*monitor_update/isu);
  assert.doesNotMatch(sql, /UPDATE\s+public\.tender_agentic_documents/iu);
  assert.doesNotMatch(sql, /DELETE|TRUNCATE|ALTER|DROP/iu);
  assert.match(sql, /dispatch_failed|monitor_lease_released|terminal_no_op|ownership_lost|invalid_identity|unsupported_workflow/iu);
  assert.match(sql, /SELECT[\s\S]+outcome/iu);
  assert.match(node.parameters.options.queryReplacement, /\$json\.source_kind/iu);
  assert.equal(node.alwaysOutputData, true);
});
