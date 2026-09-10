# Document Preparation Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore reliable source-document download for the published agentic route and complete a fresh mark-to-report canary.

**Architecture:** Reuse the existing live RU proxy only at the direct download transport boundary. Preserve the current sequential manifest builder and typed error route; add native bounded retry without changing any semantic analysis contract.

**Tech Stack:** n8n HTTP Request 4.5, repository JSON exports, Node.js test runner, PostgreSQL read-only verification.

---

### Task 1: Add the transport regression

**Files:**
- Modify: `tests/document-preparation-workflow.test.mjs`

- [ ] **Step 1: Change the direct-download assertions**

```javascript
assert.equal(directDownload.parameters.options.proxy, '=');
assert.equal(directDownload.retryOnFail, true);
assert.equal(directDownload.maxTries, 3);
assert.equal(directDownload.waitBetweenTries, 5000);
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/document-preparation-workflow.test.mjs`

Expected: FAIL because the current direct-download node has no proxy and has
`retryOnFail=false`.

### Task 2: Update the portable workflow export

**Files:**
- Modify: `workflows/n8n-exports/TENDER — Подготовить документацию.json`
- Modify: `workflows/document-preparation.md`

- [ ] **Step 1: Apply the minimal node settings**

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

- [ ] **Step 2: Verify GREEN**

Run: `node --test tests/document-preparation-workflow.test.mjs`

Expected: all focused tests pass.

### Task 3: Update and publish live n8n

**Files:**
- No credential values are written to repository files.

- [ ] **Step 1: Atomically copy the existing proxy value and set retry**

Update only `Скачать прямой документ` in workflow `0scTZu1aBKsMd6AM`.

- [ ] **Step 2: Validate and publish**

Validate the updated node and complete workflow, publish the current draft,
then read it back. Expected: active/draft parity, non-empty proxy, three tries,
five-second delay, unchanged error output and graph.

### Task 4: Run the fresh canary and record evidence

**Files:**
- Create: `evaluations/AGENTIC_MARK_TO_REPORT_CANARY_2026-09-11.md`
- Modify current-state documentation only where runtime evidence changes it.

- [ ] **Step 1: Observe the automatic retry**

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

- [ ] **Step 2: Verify database and artifacts read-only**

Require one completed run, exactly 27 unique FINAL fields, one completed Codex
job, and valid HTML/PDF evidence. Do not semantically score the fields in
runtime.

- [ ] **Step 3: Run the full suite and commit**

Run: `node --test`

Expected: zero failures. Stage only task-owned files, commit, push the existing
branch, and verify the remote hash.

