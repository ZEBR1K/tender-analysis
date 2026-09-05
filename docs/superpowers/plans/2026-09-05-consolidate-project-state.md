# Project State Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one isolated integration branch that combines the complete DW-23 history with DW-21 and preserves only useful regression coverage from the intentional ActiveX RED snapshot.

**Architecture:** Use `codex/dw23-validator-selective-retry` as the integration base because it contains the latest linear Worker, Aggregator, and Targeted Recheck history. Merge the independently developed DW-21 branch without changing `main`, then treat `codex/activex-jsonb-red-baseline-snapshot` as test evidence rather than as a merge source.

**Tech Stack:** Git worktrees, n8n workflow JSON exports, Node.js built-in test runner, JavaScript regression tests.

---

### Task 1: Establish the isolated baseline

**Files:**
- Create: `docs/superpowers/plans/2026-09-05-consolidate-project-state.md`
- Test: `tests/*.test.mjs`

- [x] **Step 1: Create the integration worktree and branch**

Run from the repository root:

```powershell
git worktree add .worktrees/consolidate-project-state -b codex/consolidate-project-state codex/dw23-validator-selective-retry
```

Expected: worktree HEAD is `012bcff` and the original checkout remains untouched.

- [x] **Step 2: Record the pre-merge baseline**

Run:

```powershell
$tests = @(rg --files tests | Where-Object { $_ -like '*.test.mjs' })
& 'C:\Program Files\nodejs\node.exe' --test $tests
```

Expected baseline observed on 2026-09-05: 458 tests, 450 pass, 8 fail. The failures must remain distinguishable from any merge-introduced regression.

- [x] **Step 3: Commit the integration plan**

```powershell
git add docs/superpowers/plans/2026-09-05-consolidate-project-state.md
git commit -m "docs: plan project state consolidation"
```

### Task 2: Merge DW-21 into the DW-23 integration base

**Files:**
- Modify only files reported by Git as merge conflicts.
- Test: `tests/*.test.mjs`

- [x] **Step 1: Merge the divergent branch with history preserved**

```powershell
git merge --no-ff codex/dw21-structural-option-owner
```

Expected: either a merge commit or an explicit conflict list. Do not resolve workflow JSON conflicts by selecting one whole side.

- [x] **Step 2: Resolve each conflict by contract ownership**

For Document Worker files, retain DW-21 structural option ownership and DW-23 JSONB-safe identities, local applicability, evidence overflow handling, and selective Validator retry. For documentation, preserve both completed histories and mark no production promotion that was not actually performed.

- [x] **Step 3: Compare the post-merge failures with the recorded baseline**

```powershell
$tests = @(rg --files tests | Where-Object { $_ -like '*.test.mjs' })
& 'C:\Program Files\nodejs\node.exe' --test $tests
```

Expected: no new failures beyond the eight recorded baseline failures. Any new failure must be investigated before proceeding.

### Task 3: Audit the intentional ActiveX RED snapshot

**Files:**
- Inspect: `tests/document-worker-docx-option-state.test.mjs`
- Inspect: `workflows/n8n-exports/TENDER — Обработать документ.json`
- Modify: `tests/document-worker-docx-option-state.test.mjs` only if a useful assertion is absent and the integrated implementation already satisfies it.

- [x] **Step 1: Compare snapshot-only assertions without merging the snapshot commit**

```powershell
git diff codex/consolidate-project-state...origin/codex/activex-jsonb-red-baseline-snapshot -- tests/document-worker-docx-option-state.test.mjs
```

Classify the four recorded scenarios: fixture-size pin, NUL-free persistence, collision-safe tuple identity, and group-local applicability.

- [x] **Step 2: Port only missing useful assertions**

Do not cherry-pick or merge `5b8f564`. Skip assertions already represented by equivalent or stronger passing tests. Do not copy a stale fixture byte-count assertion as behavior.

- [x] **Step 3: Verify the focused ActiveX suite**

```powershell
& 'C:\Program Files\nodejs\node.exe' --test tests/document-worker-docx-option-state.test.mjs
```

Expected: the three behavioral scenarios pass; any remaining failure must be identified as a stale fixture pin or a genuine integrated regression.

Observed on 2026-09-05: the NUL-free persistence and collision-safe tuple assertions were ported to the integrated DW-21 contract; group-local applicability already had equivalent stronger coverage. The snapshot commit was not merged. Focused Worker tests passed `98/99`; the only failure was the pre-existing stale fixture byte-count pin `1021 != 1012`.
