import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..');
const workflow = JSON.parse(fs.readFileSync(path.join(
  repositoryRoot,
  'workflows',
  'n8n-exports',
  'TENDER — Обработать документ.json',
), 'utf8'));
const fixture = JSON.parse(fs.readFileSync(path.join(
  testDirectory,
  'fixtures',
  'document-worker-extractor-recovery',
  'execution-14373-save-output-barrier.json',
), 'utf8'));

const barrier = workflow.nodes.find(
  (node) => node.name === 'Проверить полноту Extractor recovery',
);
assert.ok(barrier, 'Extractor recovery barrier node must exist');

async function runBarrier(recoveredOutput, saveOutput = fixture.save_analysis_unit_output) {
  const inputItems = recoveredOutput.map((json, index) => ({
    json: structuredClone(json),
    pairedItem: { item: index },
  }));
  const savedItems = structuredClone(saveOutput);
  const context = vm.createContext({
    $input: { all: () => inputItems },
    $: (nodeName) => {
      assert.equal(nodeName, 'Сохранить analysis unit');
      return { all: () => savedItems };
    },
  });
  return new vm.Script(`(async () => { ${barrier.parameters.jsCode}\n})()`)
    .runInContext(context);
}

test('execution 14373 accepts 12 top-level Save IDs with matching recovered order and audit', async () => {
  assert.equal(fixture.source_execution.execution_id, '14373');
  assert.equal(fixture.fixture_kind, 'sanitized_execution_derived_barrier_contract');
  assert.equal(fixture.replay_scope, 'save_output_shape_and_recovery_barrier_contract_only');
  assert.equal(fixture.source_execution.observed_units, 12);
  assert.equal(fixture.save_analysis_unit_output.length, 12);
  assert.equal(fixture.recovered_output.length, 12);
  for (const [index, item] of fixture.save_analysis_unit_output.entries()) {
    assert.equal(
      item.json.analysis_unit_id,
      `doc_3_au_${String(index + 1).padStart(4, '0')}`,
    );
    assert.equal(item.json.analysis_unit_meta, undefined);
  }

  const result = await runBarrier(fixture.recovered_output);
  assert.deepEqual(
    result.map((item) => item.json.analysis_unit_meta.analysis_unit_id),
    fixture.save_analysis_unit_output.map((item) => item.json.analysis_unit_id),
  );
});

test('execution 14373 barrier remains fail-closed for expected ID defects', async () => {
  const missing = structuredClone(fixture.save_analysis_unit_output);
  delete missing[0].json.analysis_unit_id;
  await assert.rejects(
    runBarrier(fixture.recovered_output, missing),
    /Expected item 0 missing analysis_unit_id/,
  );

  const duplicate = structuredClone(fixture.save_analysis_unit_output);
  duplicate[5].json.analysis_unit_id = duplicate[4].json.analysis_unit_id;
  await assert.rejects(
    runBarrier(fixture.recovered_output, duplicate),
    /Expected unit set contains duplicate identities/,
  );
});

test('execution 14373 barrier remains fail-closed for recovered output defects', async () => {
  await assert.rejects(
    runBarrier(fixture.recovered_output.slice(0, 11)),
    /Output count\/cardinality mismatch/,
  );

  const reordered = structuredClone(fixture.recovered_output);
  [reordered[2], reordered[3]] = [reordered[3], reordered[2]];
  await assert.rejects(runBarrier(reordered), /Source order mismatch/);

  const invalidAudit = structuredClone(fixture.recovered_output);
  invalidAudit[7].extractor.attempt_audit.attempt_count = 2;
  await assert.rejects(runBarrier(invalidAudit), /Invalid primary attempt audit/);
});
