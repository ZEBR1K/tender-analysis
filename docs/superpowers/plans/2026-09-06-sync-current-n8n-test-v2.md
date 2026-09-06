# Current n8n Test v2 Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the seven repository canonical workflow exports and their regression tests accurately describe the user-verified `TEST v2 ТЕНДЕРЫ КИТАТЕХ` n8n workflow chain without changing live n8n.

**Architecture:** Treat the newly exported workflow JSON as the factual implementation baseline. Preserve semantic safety invariants and audit behavior; update tests only where they encode superseded topology, prompt text, or request-envelope contracts. Do not weaken an oracle merely to make the suite green, and retain the seven pre-existing intentional RED baseline failures unless the new implementation genuinely resolves them.

**Tech Stack:** n8n workflow JSON, Node.js built-in test runner, Markdown project documentation, Git.

**Status:** Completed locally on `codex/sync-n8n-test-v2`; final regression result `469/469`, with no live n8n changes.

---

### Task 1: Reconcile canonical exports and regression contracts

**Files:**
- Modify: `workflows/n8n-exports/*.json` only where clean canonical packaging is required
- Modify: `tests/*.test.mjs` and `tests/helpers/*.mjs` only where expectations are superseded by the verified exports
- Modify: `workflows/*.md`, `PROJECT_STATUS.md`, and `TECH_DEBT.md` only when factual behavior/status changed

- [x] **Step 1: Establish the baseline**

Run the full suite before accepting the new exports and record the final pre-reconciliation baseline after DW-23: 469 tests, 462 passing, 7 known failures.

- [x] **Step 2: Classify every new failure**

Run the full suite against the imported exports. Group failures by workflow/node and classify each as: superseded exact snapshot/topology expectation, superseded request-envelope fixture, intentionally resolved diagnostic vulnerability, or genuine regression. Do not edit tests until the implementation and project semantic contract prove the expected new behavior.

- [x] **Step 3: Normalize repository packaging**

Keep `pinData` empty. Preserve functional node parameters, connections, credential references, workflow IDs used by `Execute Workflow`, and the Worker `errorWorkflow` reference. Ensure canonical filenames remain those listed in `AGENTS.md`. Remove only test-instance metadata that repository conventions explicitly exclude; do not change workflow behavior.

- [x] **Step 4: Update tests minimally**

For superseded tests, change fixtures/helpers/assertions to exercise the current implementation contract. Preserve negative controls, evidence grounding, cardinality, identity, audit, retry bounds, `requires_review`, `not_found`, 27/27, and no-silent-failure invariants. If a failing test reveals a real regression, leave it RED and report it rather than weakening the assertion.

- [x] **Step 5: Update factual documentation**

Record the current workflow IDs/routes and synchronization status. Do not claim production promotion or runtime verification beyond the executions already documented.

- [x] **Step 6: Verify**

Run focused affected tests, then `node --test`. Final result: 469 passed, 0 failed. Run `git diff --check` and inspect `git diff --stat`.

- [x] **Step 7: Commit**

Commit only the synchronized exports, tests, and directly affected documentation on `codex/sync-n8n-test-v2`. Do not merge or push automatically.
