import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CANARY_EXPECTED_ID_SOURCE,
  deriveExpectedAnalysisUnitIds,
  selectCanaryExpectedItems,
} from './helpers/document-worker-canary-barrier.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(
  testDirectory,
  'fixtures',
  'document-worker-extractor-recovery',
  'execution-14362-canary-source-contract.json',
), 'utf8'));

test('execution 14362 canary barrier derives expected IDs only after materialization', () => {
  assert.equal(fixture.source_execution.observed_units, 12);
  assert.equal(CANARY_EXPECTED_ID_SOURCE, fixture.expected_source_node);
  const selected = selectCanaryExpectedItems({
    bypassItems: fixture.bypass_items,
    postMaterializationItems: fixture.post_materialization_items,
  });
  assert.deepEqual(
    deriveExpectedAnalysisUnitIds(selected),
    fixture.expected_analysis_unit_ids,
  );
});

test('canary barrier source preserves post-materialization order and cardinality', () => {
  const ids = deriveExpectedAnalysisUnitIds(fixture.post_materialization_items);
  assert.equal(ids.length, fixture.source_execution.observed_units);
  assert.deepEqual(ids, fixture.expected_analysis_unit_ids);
});

test('canary barrier source fails closed on missing or duplicate materialized IDs', () => {
  const missing = structuredClone(fixture.post_materialization_items);
  delete missing[4].json.analysis_unit_meta.analysis_unit_id;
  assert.throws(
    () => deriveExpectedAnalysisUnitIds(missing),
    /missing analysis_unit_id/i,
  );

  const duplicate = structuredClone(fixture.post_materialization_items);
  duplicate[7].json.analysis_unit_meta.analysis_unit_id =
    duplicate[6].json.analysis_unit_meta.analysis_unit_id;
  assert.throws(
    () => deriveExpectedAnalysisUnitIds(duplicate),
    /duplicate analysis_unit_id/i,
  );
});
