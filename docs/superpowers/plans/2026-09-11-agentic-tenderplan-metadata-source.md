# Agentic TenderPlan Metadata Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seal the complete TenderPlan FullInfo response as an agent-visible metadata source and prove it in a fresh mark-to-report canary.

**Architecture:** Preserve original documents and their manifest exactly as documents. Add one root-level immutable metadata source covered by the manifest hash, allow its reserved artifact key at the syntactic evidence boundary, and translate it into the report's already-supported TenderPlan source type during FINAL promotion.

**Tech Stack:** n8n workflow JSON, PostgreSQL SQL nodes, Node.js runner, JSON Schema, Node test runner, Docker Compose.

---

### Task 1: Lock the source contract with failing tests

**Files:**
- Modify: `tests/agentic-runner-manifest.test.mjs`
- Modify: `tests/agentic-result-validator.test.mjs`
- Modify: `tests/agentic-codex-command.test.mjs`
- Modify: `tests/agentic-dispatch-workflow.test.mjs`
- Modify: `tests/tender-orchestrator-input.test.mjs`
- Modify: `tests/agentic-finalization-integration.test.mjs`

- [ ] Add a manifest test that supplies the reserved `tender_metadata` object,
      confirms its data changes the canonical manifest hash, and rejects unknown
      keys, oversized data and collision with a document artifact key.
- [ ] Add a result-validator test proving metadata evidence is accepted while an
      unknown evidence artifact and metadata in `inspected_documents` remain
      rejected.
- [ ] Change the prompt regression to require the sealed metadata source and the
      absence-as-negative warning, while retaining the no-internet and no
      field-specific-rule assertions.
- [ ] Add workflow regressions requiring FullInfo preservation, Dispatch manifest
      inclusion, and metadata promotion to `source_type=tender_metadata`.
- [ ] Run the focused tests and confirm RED failures are caused only by the
      missing metadata-source implementation.

### Task 2: Implement the sealed runner source

**Files:**
- Modify: `deploy/codex-runner/src/manifest.mjs`
- Modify: `deploy/codex-runner/src/result-validator.mjs`
- Modify: `deploy/codex-runner/agent-template/AGENTS.md`
- Modify: `deploy/codex-runner/agent-template/.agents/skills/tender-document-analysis/SKILL.md`
- Modify: `deploy/codex-runner/prompts/tender-analysis-v1.txt`
- Modify: `deploy/codex-runner/README.md`

- [ ] Extend `normalizeSourceManifest()` with an optional closed
      `tender_metadata` object using the fixed identity
      `tenderplan-metadata`/`tender_metadata`, a nonblank source name, a plain
      object payload and a bounded canonical byte length.
- [ ] Reject artifact-key collision with `documents[]`; keep
      `expected_documents` tied only to original files.
- [ ] Include the metadata artifact only in the evidence membership set, not the
      inspected-document membership set.
- [ ] Tell Codex to inspect the metadata as an independent source, cite it by the
      reserved artifact key and locator, and never infer a negative from missing
      metadata.
- [ ] Run the focused runner tests until GREEN.

### Task 3: Carry TenderPlan through n8n and FINAL promotion

**Files:**
- Modify: `workflows/n8n-exports/ТЕНДЕРЫ ОРКЕСТРАТОР.json`
- Modify: `workflows/n8n-exports/TENDER — Агентский анализ — Запуск.json`
- Modify: `workflows/n8n-exports/TENDER — Финализация анализа.json`
- Modify: `workflows/orchestrator.md`
- Modify: `workflows/agentic-analysis-dispatch.md`
- Modify: `workflows/finalization.md`

- [ ] In `нормализовать карточку`, add only
      `source_payload: input` to the existing normalized metadata.
- [ ] In Dispatch preflight, select the run's `tender_meta`; include it in the
      runner request under the closed reserved source contract.
- [ ] In `Продвинуть agentic FINAL`, accept metadata evidence only for the
      reserved artifact key and non-empty run metadata; map it to
      `source_type=tender_metadata` without evaluating its meaning.
- [ ] Keep every existing document identity, 27/27 barrier, ownership guard,
      retry rule and agent-only route unchanged.
- [ ] Run the focused workflow tests until GREEN, then run the full repository
      suite and `git diff --check`.

### Task 4: Deploy and verify a real canary

**Files:**
- Modify: `PROJECT_STATUS.md`
- Modify: `README.md`
- Create: `evaluations/AGENTIC_TENDERPLAN_METADATA_CANARY_2026-09-11.md`

- [ ] Build and restart only the runner service; verify health and isolation
      readiness before accepting jobs.
- [ ] Update the live Orchestrator, Dispatch and Finalization drafts using their
      currently bound credentials and exact existing connections; validate,
      publish and read back each active version.
- [ ] Start a fresh controlled run for tender
      `6aa2c2ad5b7165804b8c4ff7` through the published route. Do not mutate
      PostgreSQL directly.
- [ ] Verify executions and read-only PostgreSQL state: completed run, exactly 27
      unique FINAL fields, valid statuses, HTML/PDF artifacts, metadata-source
      evidence mapping and preserved audit history.
- [ ] Compare the new result with run
      `6c36e5da-f9e2-48d9-a062-0493f0c2bf73`; record semantic differences as
      offline findings only.
- [ ] Update the project status/evaluation, run final verification, commit only
      scoped files and push `codex/agentic-analysis-integration`.

## Self-review

- Spec coverage: every design requirement maps to Tasks 1–4.
- Placeholder scan: no implementation step depends on TBD behavior.
- Type consistency: `tender_metadata`, `tenderplan-metadata`,
  `source_type=tender_metadata` and `source_payload` are used consistently.
- Scope: no parser, page/OOXML/XLSX index, field-specific rule, quote check or
  semantic blocker is introduced.
