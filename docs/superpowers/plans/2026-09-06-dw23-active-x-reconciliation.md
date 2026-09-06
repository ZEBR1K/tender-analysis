# DW-23 ActiveX Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce one importable DW-23 Worker that keeps the verified `main` implementation of ActiveX ownership, DW-22 overflow handling, and selective Validator retry while retaining only the intentional operational settings from the current live test workflow.

**Architecture:** Start from the tested canonical Worker at commit `4334b4f`, not from the stale live Code-node bodies. Add a small regression test for the operational overlay, then apply only the test Aggregator route, Error Workflow, Extractor provider, two-second post-loop wait, and current test-workflow identity. Verify focused Worker contracts before the full suite; do not write to live n8n.

**Tech Stack:** n8n workflow JSON, JavaScript Code nodes, Node.js built-in test runner, Git.

---

## File map

- Modify: `workflows/n8n-exports/TENDER — Обработать документ.json` — reconciled importable Worker.
- Create: `tests/document-worker-live-test-overlay.test.mjs` — protects the intentional live-test routing/configuration without asserting volatile `versionId` values.
- Modify: `workflows/document-worker.md` — records the canonical test candidate identity and routing boundary.
- Modify: `PROJECT_STATUS.md` — records verification results and states that live promotion is pending.

### Task 1: Restore the verified implementation base

**Files:**
- Modify: `workflows/n8n-exports/TENDER — Обработать документ.json`

- [ ] **Step 1: Record the current imported-live regression boundary**

Run:

```powershell
node --test tests/document-worker-docx-option-owner.test.mjs tests/document-worker-docx-option-state.test.mjs tests/document-worker-evidence-repair.test.mjs tests/document-worker-extractor-envelope.test.mjs tests/document-worker-extractor-recovery.test.mjs tests/document-worker-validator-selective-retry.test.mjs
```

Expected: the imported live Worker is RED, including ActiveX owner/state failures and two selective-retry contract failures. Save only the test summary in the task notes; do not change tests to accept this state.

- [ ] **Step 2: Restore only the canonical Worker from the tested `main` snapshot**

Run:

```powershell
git restore --source=4334b4f -- 'workflows/n8n-exports/TENDER — Обработать документ.json'
```

Do not restore any other workflow or documentation file.

- [ ] **Step 3: Verify that the restored graph contains all three implementation layers**

Run:

```powershell
rg -n "v2i:|v2g:|target_ranked_windows|ai_validator_selective_retry_v1|ai_validator_retry_fallback_v1" 'workflows/n8n-exports/TENDER — Обработать документ.json'
```

Expected: all five markers are present. The graph has 85 unique nodes before adding the operational Wait node.

- [ ] **Step 4: Re-run the focused Worker tests**

Run the command from Step 1 again.

Expected: the additional failures introduced by the live export disappear. Any remaining failures must match the known `4334b4f` baseline exactly; no test may be deleted, skipped, or weakened.

### Task 2: Define the operational overlay as a regression contract

**Files:**
- Create: `tests/document-worker-live-test-overlay.test.mjs`
- Test: `tests/document-worker-live-test-overlay.test.mjs`

- [ ] **Step 1: Add the focused overlay test**

Create the file with this complete content:

```javascript
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const workflowPath = path.join(
  testDirectory,
  '..',
  'workflows',
  'n8n-exports',
  'TENDER — Обработать документ.json',
);
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

function node(name) {
  const result = workflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(result, `Workflow node not found: ${name}`);
  return result;
}

function outputs(name, outputIndex = 0) {
  return (workflow.connections[name]?.main?.[outputIndex] ?? []).map(
    ({ node: target, index }) => ({ node: target, index }),
  );
}

test('canonical Worker retains only the approved live-test operational overlay', () => {
  assert.equal(workflow.id, 'URFdslUfULtOLv9B');
  assert.equal(workflow.name, '[DW-23 TEST CODEX] TENDER — Обработать документ');
  assert.equal(workflow.active, true);
  assert.deepEqual(workflow.pinData ?? {}, {});
  assert.equal(workflow.settings?.errorWorkflow, 'jYzQ8RtNmnTM2PGz');

  const aggregator = node("Call '[TEST CODEX] TENDER — Агрегация закупки'");
  assert.equal(aggregator.parameters.workflowId.value, 'ftvmrEHoMbPOAqZG');
  assert.equal(
    workflow.nodes.some(({ name }) => name === "Call 'TENDER — Агрегация закупки'"),
    false,
  );

  const wait = node('Wait');
  assert.equal(wait.type, 'n8n-nodes-base.wait');
  assert.equal(wait.parameters.amount, 2);
  assert.deepEqual(outputs('Обработать evidence units по одной', 1), [
    { node: 'Wait', index: 0 },
  ]);
  assert.deepEqual(outputs('Wait'), [
    { node: 'Primary Extractor accepted?', index: 0 },
  ]);

  assert.match(
    node('AI Extractor v1.0').parameters.jsonBody,
    /z-ai\/glm-5\.3-flash@provider=novita\/fp8&reasoning_effort=low/u,
  );
});
```

- [ ] **Step 2: Run the overlay test and confirm it is RED**

Run:

```powershell
node --test tests/document-worker-live-test-overlay.test.mjs
```

Expected: FAIL because the clean candidate has no live workflow ID, uses the non-test Aggregator route, lacks the two-second Wait, and has no live Error Workflow setting.

### Task 3: Apply only the approved operational differences

**Files:**
- Modify: `workflows/n8n-exports/TENDER — Обработать документ.json`
- Test: `tests/document-worker-live-test-overlay.test.mjs`

- [ ] **Step 1: Restore current test-workflow identity without preserving volatile revision metadata**

Set the top-level fields to:

```json
{
  "name": "[DW-23 TEST CODEX] TENDER — Обработать документ",
  "active": true,
  "id": "URFdslUfULtOLv9B",
  "pinData": {}
}
```

Do not copy `versionId` or `meta` from the live export; n8n owns revision metadata during import/save.

- [ ] **Step 2: Apply the Error Workflow settings**

Preserve the tested base settings and add only:

```json
{
  "executionOrder": "v1",
  "binaryMode": "separate",
  "availableInMCP": false,
  "timeSavedMode": "fixed",
  "errorWorkflow": "jYzQ8RtNmnTM2PGz",
  "callerPolicy": "workflowsFromSameOwner"
}
```

- [ ] **Step 3: Retarget the Aggregator call**

Rename `Call 'TENDER — Агрегация закупки'` to `Call '[TEST CODEX] TENDER — Агрегация закупки'`, retain its node ID and position from the verified base, and replace only `parameters.workflowId` with:

```json
{
  "__rl": true,
  "value": "ftvmrEHoMbPOAqZG",
  "mode": "list",
  "cachedResultUrl": "/workflow/ftvmrEHoMbPOAqZG",
  "cachedResultName": "[TEST CODEX] TENDER — Агрегация закупки"
}
```

Update the outbound edge from `Проверить готовность к агрегации1` to the renamed node. Do not change `workflowInputs` or `waitForSubWorkflow`.

- [ ] **Step 4: Apply the current Extractor provider selection**

In `AI Extractor v1.0.parameters.jsonBody`, replace only the model value:

```javascript
model: 'z-ai/glm-5.3-flash@provider=novita/fp8&reasoning_effort=low'
```

Do not replace the HTTP node, credential reference, prompts, batching, timeout, or response-format settings.

- [ ] **Step 5: Add the two-second post-loop Wait**

Add this node exactly once:

```json
{
  "parameters": {
    "amount": 2
  },
  "type": "n8n-nodes-base.wait",
  "typeVersion": 1.1,
  "position": [4688, 1312],
  "id": "28370d0b-84d6-4488-a4c9-2b3d2e63fcd5",
  "name": "Wait",
  "webhookId": "d989853c-4672-4ab4-bc1f-d8f040f7b1a1"
}
```

Replace only the second output of `Обработать evidence units по одной`:

```json
[
  [{ "node": "Проверить полноту Extractor recovery", "type": "main", "index": 0 }],
  [{ "node": "Wait", "type": "main", "index": 0 }]
]
```

Add:

```json
"Wait": {
  "main": [[
    { "node": "Primary Extractor accepted?", "type": "main", "index": 0 }
  ]]
}
```

- [ ] **Step 6: Run the overlay test**

Run:

```powershell
node --test tests/document-worker-live-test-overlay.test.mjs
```

Expected: `1` test, `1` pass, `0` fail.

- [ ] **Step 7: Confirm that no stale live Code-node body was copied**

Run:

```powershell
git diff --word-diff=porcelain 4334b4f -- 'workflows/n8n-exports/TENDER — Обработать документ.json' | rg "^[-+]" 
```

Expected differences are limited to workflow identity/settings, the test Aggregator node and edge, the Extractor model string, and the Wait node/edge. Any ActiveX, Evidence Repair, Extractor recovery, or Validator Code-node body difference is a blocker.

### Task 4: Verify all Worker contracts

**Files:**
- Test: `tests/document-worker-live-test-overlay.test.mjs`
- Test: existing `tests/document-worker-*.test.mjs`

- [ ] **Step 1: Run the focused contract suite**

Run:

```powershell
node --test tests/document-worker-docx-option-owner.test.mjs tests/document-worker-docx-option-state.test.mjs tests/document-worker-evidence-repair.test.mjs tests/document-worker-extractor-envelope.test.mjs tests/document-worker-extractor-recovery.test.mjs tests/document-worker-validator-selective-retry.test.mjs tests/document-worker-live-test-overlay.test.mjs
```

Expected: overlay test passes and the original Worker tests match the clean `4334b4f` baseline with no additional failure signature.

- [ ] **Step 2: Run structural JSON checks**

Run:

```powershell
node -e "const fs=require('fs');const p='workflows/n8n-exports/TENDER — Обработать документ.json';const w=JSON.parse(fs.readFileSync(p,'utf8'));const names=w.nodes.map(n=>n.name);if(new Set(names).size!==names.length)throw new Error('duplicate node names');for(const [source,c] of Object.entries(w.connections)){if(!names.includes(source))throw new Error('missing source '+source);for(const outputs of c.main??[])for(const edge of outputs??[])if(!names.includes(edge.node))throw new Error('missing target '+edge.node)}console.log(JSON.stringify({nodes:names.length,connectionSources:Object.keys(w.connections).length}))"
```

Expected: valid JSON, `86` unique nodes, and no missing connection source or target.

- [ ] **Step 3: Run the complete repository suite**

Run:

```powershell
node --test
```

Expected: `466 total / 459 pass / 7` known unrelated failures. There must be no new Document Worker failure. If baseline counts changed because tests were added independently, compare exact failure names rather than accepting a count-only match.

### Task 5: Update project documentation and commit

**Files:**
- Modify: `workflows/document-worker.md`
- Modify: `PROJECT_STATUS.md`
- Modify: `workflows/n8n-exports/TENDER — Обработать документ.json`
- Create: `tests/document-worker-live-test-overlay.test.mjs`

- [ ] **Step 1: Update Worker documentation**

Record these exact boundaries in `workflows/document-worker.md`:

```text
Canonical repository export is the reconciled, not-yet-promoted test candidate for workflow ID URFdslUfULtOLv9B. Its implementation base is the verified 4334b4f Worker; only the test Aggregator route, Error Workflow, Novita FP8 Extractor selection, and two-second post-loop Wait are overlaid from live. Live n8n was not modified by this reconciliation.
```

Do not claim a fresh runtime execution or production promotion.

- [ ] **Step 2: Add a dated reconciliation checkpoint to `PROJECT_STATUS.md`**

Include:

- implementation base `4334b4f`;
- live source workflow ID `URFdslUfULtOLv9B`;
- the four operational overlay categories;
- focused and full test totals with exact remaining baseline failures;
- explicit statements that live n8n and PostgreSQL were not modified;
- next step: manual import followed by read-back and runtime canary.

- [ ] **Step 3: Review the final diff and secret boundary**

Run:

```powershell
git diff --check
git status --short
git diff --stat
rg -l "N8N_TENDER_READONLY_API_KEY|SUPABASE_TENDER_READONLY_PASSWORD|Bearer [A-Za-z0-9._-]+" workflows tests PROJECT_STATUS.md
```

Expected: no whitespace errors, no credential values, and no unrelated file included in the implementation commit.

- [ ] **Step 4: Commit the reconciliation**

Run:

```powershell
git add -- 'workflows/n8n-exports/TENDER — Обработать документ.json' 'tests/document-worker-live-test-overlay.test.mjs' 'workflows/document-worker.md' 'PROJECT_STATUS.md'
git commit -m "fix(worker): reconcile DW-23 with verified ActiveX base"
```

Do not add the other imported workflow exports to this commit. Do not push, merge, import, publish, activate, or modify live n8n during this plan.
