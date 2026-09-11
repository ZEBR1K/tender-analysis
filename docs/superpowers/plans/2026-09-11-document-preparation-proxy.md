# Document Preparation Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore reliable source-document download for the published agentic route and complete a fresh mark-to-report canary.

**Architecture:** Use the user-supplied live RU proxy only at the two source-download transport boundaries: Document Preparation and Dispatch staging. Preserve the current sequential manifest builder, typed error route and semantic contracts. A failed, unstarted and unsealed Dispatch job gets at most one audited full-restage retry.

**Tech Stack:** n8n HTTP Request 4.5, repository JSON exports, Node.js test runner, PostgreSQL read-only verification.

---

### Task 1: Add the transport regression

**Files:**
- Modify: `tests/document-preparation-workflow.test.mjs`

- [x] **Step 1: Change the direct-download assertions**

```javascript
assert.equal(directDownload.parameters.options.proxy, '=');
assert.equal(directDownload.retryOnFail, true);
assert.equal(directDownload.maxTries, 3);
assert.equal(directDownload.waitBetweenTries, 5000);
```

- [x] **Step 2: Verify RED**

Run: `node --test tests/document-preparation-workflow.test.mjs`

Expected: FAIL because the current direct-download node has no proxy and has
`retryOnFail=false`.

### Task 2: Update the portable workflow export

**Files:**
- Modify: `workflows/n8n-exports/TENDER — Подготовить документацию.json`
- Modify: `workflows/document-preparation.md`

- [x] **Step 1: Apply the minimal node settings**

```json
"options": {
  "response": {
    "response": {
      "responseFormat": "file",
      "outputPropertyName": "data"
    }
  },
  "proxy": "="
},
"retryOnFail": true,
"maxTries": 3,
"waitBetweenTries": 5000,
"onError": "continueErrorOutput"
```

- [x] **Step 2: Verify GREEN**

Run: `node --test tests/document-preparation-workflow.test.mjs`

Expected: all focused tests pass.

### Task 3: Update and publish live n8n

**Files:**
- No credential values are written to repository files.

- [x] **Step 1: Atomically copy the existing proxy value and set retry**

Update only `Скачать прямой документ` in workflow `0scTZu1aBKsMd6AM`.

- [x] **Step 2: Validate and publish**

Validate the updated node and complete workflow, publish the current draft,
then read it back. Expected: active/draft parity, non-empty proxy, three tries,
five-second delay, unchanged error output and graph.

### Task 3B: Cover the runtime-discovered Dispatch boundary

**Files:**
- `tests/agentic-dispatch-workflow.test.mjs`
- `workflows/n8n-exports/TENDER — Агентский анализ — Запуск.json`

- [x] Reproduce execution `15815`: source staging timed out before runner start.
- [x] Add the same non-secret proxy placeholder and native bounded retry to
  `Скачать оригинал`.
- [x] Permit one audited restage only when `attempts=0`, the manifest is
  unsealed and the source HTTP branch produced the narrow typed error
  `AGENTIC_SOURCE_DOWNLOAD_FAILED`.
- [x] Keep all other identity, ownership, CAS, seal and contract failures on the
  ordinary terminal failure route.
- [x] Keep runner retry codes, ownership barriers, binary handoff and semantic
  contracts unchanged.

### Task 4: Run the fresh canary and record evidence

**Files:**
- Create: `evaluations/AGENTIC_MARK_TO_REPORT_CANARY_2026-09-11.md`
- Modify current-state documentation only where runtime evidence changes it.

- [x] **Step 1: Observe the automatic retry**

Expected sequence:

```text
TenderPlan Mark Intake
→ Intake Resume
→ Orchestrator
→ Document Preparation
→ Agentic Dispatch / runner
→ Monitor
→ Finalization
→ Report Generation
```

- [x] **Step 2: Verify database and artifacts read-only**

Require one completed run, exactly 27 unique FINAL fields, one completed Codex
job, and valid HTML/PDF evidence. Do not semantically score the fields in
runtime.

- [x] **Step 3: Run the full suite and commit**

Run: `node --test`

Expected: zero failures. Stage only task-owned files, commit, push the existing
branch, and verify the remote hash.
