# DW-17 Reference-Only Evidence Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace quote-writing Evidence Repair v1 with a bounded reference-only v2 contract while preserving strict grounding and all downstream contracts.

**Architecture:** The existing preparation Code node builds a bounded, source-derived candidate catalog. The Repair HTTP call receives that catalog and returns refs only. The existing attempt-2 Code node independently rebuilds and exact-compares the catalog, validates refs, materializes canonical evidence, performs a lossless merge, then invokes unchanged strict `validateFacts(..., 2)` semantics.

**Tech Stack:** n8n workflow JSON, JavaScript Code nodes, Node.js built-in test runner.

---

### Task 1: RED reference-only contract and regression fixtures

**Files:**
- Modify: `tests/document-worker-evidence-repair.test.mjs`
- Create: `tests/fixtures/document-worker-evidence/synthetic-14371-reference-only-structure.json`

- [x] Add a synthetic, non-replay fixture containing only sanitized structural data for `doc_3_au_0003`, `sb_0019`, `quote_not_found`, and an empty `exact_match_candidate_ids`; do not add client text or claim unavailable runtime payload details.
- [x] Change test helpers to express wished-for `ai_evidence_repair_v2` responses with `selected_evidence_refs` and no quote fields.
- [x] Add focused tests for stable refs, separate adjacent sentences, identical text in distinct blocks, exact rebuild parity tampering, refs-only schema, materialization/lossless merge, metrics synchronization, ref/collision rejection, overlap/table behavior, incremental catalog/source/request bounds, terminal exhaustion and unchanged Primary contract.
- [x] Capture RED before workflow changes, including the continuation review gate (`98 total / 86 pass / 12 expected failures`).

### Task 2: GREEN minimal workflow implementation

**Files:**
- Modify: `workflows/n8n-exports/TENDER — Обработать документ.json`

- [x] In `Подготовить Evidence Repair`, preserve existing route/violation/source guards and add deterministic source validation plus incrementally bounded structural catalog generation under the shared exact whitespace/table semantics.
- [x] Version prompt/schema as `tender_evidence_repair_prompt_v2` / `ai_evidence_repair_v2`; expose only `selected_evidence_refs` in model output and prohibit model-authored quote/block/provenance.
- [x] Keep `AI Evidence Repair v1` node identity, model, credentials, request count, timeout, graph wiring and application-side enforcement unchanged.
- [x] In attempt 2, byte-preserve shared `validateFacts`, rebuild and exact-compare the catalog/contract, validate exact v2 keys/cardinality/refs, materialize from source-derived refs, merge losslessly, synchronize post-invariant metrics, and invoke `validateFacts(repairedFacts, source, 2)`.
- [x] Run the focused test to `99/99` GREEN.

### Task 3: Direct documentation and status truth

**Files:**
- Modify: `workflows/document-worker.md`
- Modify: `TECH_DEBT.md`
- Modify: `PROJECT_STATUS.md`
- Modify: `DEVELOPMENT_LOG.md`

- [x] Document the v2 internal ref contract, strict catalog rebuild, deterministic materialization/lossless merge, resource bounds, preserved strict validation and local-only verification.
- [x] Mark DW-17 as locally mitigated/GREEN but explicitly open for unavailable `14234`/`14238` replay fixtures, promotion and runtime canary; do not claim production/runtime GREEN.
- [x] Record that Extractor, Validator, persistence, terminal failure policy and live workflows were unchanged.

### Task 4: Verification and orchestrator handoff

**Files:** all task files above.

- [x] Run focused Worker evidence suite and all Document Worker suites.
- [x] Run `node --test tests/*.test.mjs`; compare failures to the clean baseline of 22 files, 18 pass, 4 fail on this managed runner and report any changed signatures/counts.
- [x] Run `git diff --check`, parse canonical workflow JSON, scan changed content for secrets/client text, inspect `git status --short` and `git diff`.
- [x] Perform spec/safety self-review focused on false grounding, lossless merge, contracts, scope, secrets and test adequacy; correct every Important/Critical finding and rerun affected checks.
- [ ] Leave the reviewed worktree uncommitted; the orchestrator creates the single final commit. Do not push, merge, publish, deploy or access live services.
