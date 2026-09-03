# ActiveX Local Semantic Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let locally exact DOCX ActiveX option groups establish deterministic applicability without being poisoned by unrelated document-wide mapping failures.

**Architecture:** Add a versioned group-local ownership projection at the existing Normalizer boundary, preserve it through semantic blocks and AI segments, and consume it in the existing deterministic Validator-dispatch guard. Keep the document-wide audit unchanged and fail closed whenever candidate evidence cannot resolve to exactly one safe group.

**Tech Stack:** n8n workflow JSON, JavaScript Code nodes, Node.js `node:test`, execution-derived sanitized fixtures.

---

### Task 1: Freeze the execution-derived RED

**Files:**
- Modify: `tests/document-worker-docx-option-state.test.mjs`
- Modify if needed: `tests/fixtures/document-worker-docx-option-state/execution-14359-semantic-binding.json`

- [ ] Add a sanitized fixture where two exact groups are resolved while an unrelated source-table owner is missing. The option-button pair must share a non-empty synthetic GroupName, mirroring execution `14410` without client-specific IDs.
- [ ] Assert current behavior incorrectly caps the selected negative facts because the document semantic status is `unknown`; assert canonical quote grounding already succeeds.
- [ ] Add REDs for repeated identity with changed state, binary target and coordinate; mixed resolved/unresolved groups in one semantic block; two selected radios; zero selected radios; caller-supplied all-cleared flag; and distinct GroupName values in one source table.
- [ ] Run `node tests/document-worker-docx-option-state.test.mjs` and record the exact new failures. They must fail on missing group-local behavior, not fixture syntax or the accepted pre-existing size assertion.

### Task 2: Produce group-local ownership at the Normalizer

**Files:**
- Modify: `workflows/n8n-exports/TENDER — Обработать документ.json`
- Test: `tests/document-worker-docx-option-state.test.mjs`

- [ ] In `Нормализовать документ Docling`, retain the existing parser, structural-table matching, canonical text and document audit. Add only the `docx_option_state_semantic_v2` projection specified in the accepted design.
- [ ] Use `document_part + control_rel_target` as the current identity key and compare all observed snapshot fields for conflicts.
- [ ] Implement exact GroupName/type classification, per-group completeness and scoped issue association. Do not use label-only ownership, tender-specific IDs/text or a document-wide veto.
- [ ] Run the focused test until the new Normalizer REDs are GREEN and the old exact-source/fail-closed cases retain their prior outcomes.

### Task 3: Preserve groups and enforce candidate applicability

**Files:**
- Modify: `workflows/n8n-exports/TENDER — Обработать документ.json`
- Test: `tests/document-worker-docx-option-state.test.mjs`

- [ ] Preserve the v2 group container through `Собрать смысловые разделы v1.4`, `Развернуть части для AI v1.2`, analysis units, provenance and the actual Extractor request.
- [ ] Keep `[OPTION_STATE ...]` as AI-only context and keep exact evidence matching against canonical text.
- [ ] In `Подготовить dispatch AI Validator`, resolve every option-bearing evidence item to exactly one group. Selected/resolved is applicable; unselected is deterministically rejected; zero/multiple/unknown/conflict/mixed verdicts are review-only. Ignore unrelated group/document warnings for a resolved group while retaining them in audit.
- [ ] Prove AI Validator cannot elevate review-only and cannot revive rejected unselected alternatives. Do not modify AI Validator behavior itself.
- [ ] Run `node tests/document-worker-docx-option-state.test.mjs` and record exact GREEN totals, separating the accepted baseline size failure if it remains.

### Task 4: Documentation and baseline comparison

**Files:**
- Modify: `workflows/document-worker.md`
- Modify: `PROJECT_STATUS.md`

- [ ] Replace the documented document-wide cap with the accepted group-local rule; preserve explicit fail-closed cases and audit semantics.
- [ ] Update the checkpoint with implementation status only after test evidence exists. Do not claim runtime verification.
- [ ] Run every `tests/document-worker-*.test.mjs` file in isolated processes and then every `tests/*.test.mjs` file in isolated processes. Record exact file/test/pass/fail totals and compare failures with base `bfaa93147ea5109f48375cd6ea410b4d9ec78f6c`.
- [ ] Inspect `git diff --check`, `git diff`, and `git status --short`. Do not commit; the orchestrator will perform independent review and create the single owner-requested commit.
