# Report Artifact Readable Filename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Name final HTML/PDF reports with the TenderPlan procurement number and title.

**Architecture:** Reuse the existing `tender_report_model_v2.procurement` projection. Change only the renderer filename builder; the PDF terminal node continues deriving its name from the validated HTML filename.

**Tech Stack:** n8n Code node JavaScript, Node.js test runner, repository workflow JSON.

---

### Task 1: Lock the filename contract with tests

**Files:**
- Modify: `tests/report-generation-pdf.test.mjs`

- [x] Add assertions that renderer code uses both `procurement.number` and
  `procurement.subject`, sanitizes forbidden characters, limits the base name,
  and falls back to the procurement number when title is missing.
- [x] Run `node --test --test-reporter=tap tests/report-generation-pdf.test.mjs`.
- [x] Confirm RED because the current renderer builds the filename only from
  `safeTenderNumber`.

### Task 2: Implement the minimal renderer change

**Files:**
- Modify: `workflows/n8n-exports/TENDER — Генерация отчета.json`

- [x] Replace the number-only filename builder in `Сгенерировать HTML1` with a
  bounded file-part sanitizer and a base name built from TenderPlan number and
  title.
- [x] Keep the HTML body, `index.html` Gotenberg alias, terminal PDF rename,
  workflow graph and credentials unchanged.
- [x] Re-run the focused tests and confirm GREEN.

### Task 3: Document and verify

**Files:**
- Modify: `workflows/report-generation.md`
- Modify: `PROJECT_STATUS.md`

- [x] Document the filename source, format, fallback and intermediate UUID
  behavior.
- [x] Run the complete repository test suite and `git diff --check`.
- [x] Compare normalized workflow graph and credentials before/after.

### Task 4: Publish the one-node production update

**Files:**
- No additional repository files.

- [x] Read the live workflow and confirm draft/active parity.
- [x] Update only `Сгенерировать HTML1.parameters.jsCode`.
- [x] Validate the workflow, verify connections and credentials by read-back,
  then publish the new draft.
- [x] Verify `versionId=activeVersionId` and commit/push the repository changes.
