import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { evaluateIntakeResumeDecision } from './helpers/intake-resume-model.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(
  testDirectory,
  'fixtures',
  'intake-resume',
  'run-states.json',
), 'utf8'));
const automaticIntents = [
  { triggerKind: 'tenderplan_mark', manualOverride: false },
  { triggerKind: 'recovery_scan', manualOverride: false },
];
const manualIntent = { triggerKind: 'manual', manualOverride: true };

function evaluate({ intent, document, runStatus = 'processing', finalCount = 0 }) {
  return evaluateIntakeResumeDecision({
    ...intent,
    runStatus,
    finalCount,
    documents: document === undefined ? [] : [structuredClone(document)],
    now: fixture.now,
  });
}

function expectedDocumentAction(document, expected) {
  const action = { id: document.id, ...expected };
  if (expected.action === 'cas_to_failed') {
    action.compareAndSet = {
      id: document.id,
      status: 'processing',
      startedAt: document.startedAt,
    };
  }
  return action;
}

test('decision model: every approved document row applies to both automatic triggers and manual intent', () => {
  for (const scenario of fixture.documentCases) {
    for (const intent of automaticIntents) {
      const result = evaluate({ intent, document: scenario.document });
      assert.deepEqual(
        result.documentActions,
        [expectedDocumentAction(scenario.document, scenario.automatic)],
        `${scenario.name}: ${intent.triggerKind}`,
      );
      assert.equal(result.stageAction, 'continue_document_stage');
    }

    const manualResult = evaluate({
      intent: manualIntent,
      document: scenario.document,
    });
    assert.deepEqual(
      manualResult.documentActions,
      [expectedDocumentAction(scenario.document, scenario.manual)],
      `${scenario.name}: manual`,
    );
    assert.equal(manualResult.stageAction, 'continue_document_stage');
  }
});

test('decision model: automatic Worker dispatch stops after two total claims while manual intent may continue', () => {
  for (const status of ['pending', 'failed']) {
    const document = {
      id: `doc-${status}-budget`,
      status,
      attempts: 2,
      startedAt: null,
      executionState: null,
    };

    for (const intent of automaticIntents) {
      assert.equal(
        evaluate({ intent, document }).documentActions[0].action,
        'exhausted',
      );
    }
    assert.equal(
      evaluate({ intent: manualIntent, document }).documentActions[0].action,
      'dispatch',
    );
  }
});

test('decision model: stale processing requires an execution observation before any recovery action', () => {
  const staleWithoutObservation = {
    id: 'doc-stale-unobserved',
    status: 'processing',
    attempts: 1,
    startedAt: '2026-09-07T10:00:00.000Z',
    executionState: null,
  };

  assert.throws(
    () => evaluate({ intent: automaticIntents[0], document: staleWithoutObservation }),
    /execution observation/iu,
  );
});

test('decision model: stale compare-and-set carries the observed snapshot and treats a newer Worker claim as a benign race', () => {
  const race = fixture.staleCasRace;
  const action = evaluate({
    intent: automaticIntents[1],
    document: race.observed,
  }).documentActions[0];

  assert.deepEqual(action.compareAndSet, {
    id: race.observed.id,
    status: race.observed.status,
    startedAt: race.observed.startedAt,
  });
  assert.notEqual(action.compareAndSet.startedAt, race.currentAtCas.startedAt);
  assert.equal(action.onNotApplied, race.expectedOnMiss);
});

test('decision model: stage routing follows the approved ready, aggregating, and completed table', () => {
  for (const scenario of fixture.stageCases) {
    for (const intent of [...automaticIntents, manualIntent]) {
      const result = evaluate({
        intent,
        runStatus: scenario.runStatus,
        finalCount: scenario.finalCount,
      });
      assert.deepEqual(result.documentActions, [], scenario.name);
      assert.equal(result.stageAction, scenario.expected, scenario.name);
    }
  }
});

test('decision model: malformed intent, state, attempts, counts, and timestamps fail closed', () => {
  const validDocument = {
    id: 'doc-valid',
    status: 'pending',
    attempts: 0,
    startedAt: null,
    executionState: null,
  };
  const invalidCases = [
    {
      name: 'automatic trigger with override',
      input: { intent: { triggerKind: 'tenderplan_mark', manualOverride: true }, document: validDocument },
    },
    {
      name: 'manual trigger without override',
      input: { intent: { triggerKind: 'manual', manualOverride: false }, document: validDocument },
    },
    {
      name: 'unknown trigger',
      input: { intent: { triggerKind: 'unknown', manualOverride: false }, document: validDocument },
    },
    {
      name: 'unknown document state',
      input: { intent: automaticIntents[0], document: { ...validDocument, status: 'mystery' } },
    },
    {
      name: 'negative attempts',
      input: { intent: automaticIntents[0], document: { ...validDocument, attempts: -1 } },
    },
    {
      name: 'unknown run state',
      input: { intent: automaticIntents[0], document: validDocument, runStatus: 'mystery' },
    },
    {
      name: 'too many FINAL rows',
      input: { intent: automaticIntents[0], runStatus: 'aggregating', finalCount: 28 },
    },
    {
      name: 'invalid processing timestamp',
      input: {
        intent: automaticIntents[0],
        document: {
          ...validDocument,
          status: 'processing',
          startedAt: 'not-a-timestamp',
          executionState: 'running',
        },
      },
    },
  ];

  for (const scenario of invalidCases) {
    assert.throws(() => evaluate(scenario.input), undefined, scenario.name);
  }
});

test('workflow export exists for the typed Intake Resume dispatcher', () => {
  const exportPath = path.resolve(
    testDirectory,
    '..',
    'workflows',
    'n8n-exports',
    'TENDER — Intake Resume.json',
  );

  assert.equal(
    fs.existsSync(exportPath),
    true,
    `planned export is absent: ${exportPath}`,
  );
});
