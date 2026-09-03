# DW-21 Structural DOCX Option Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deterministically bind each supported DOCX ActiveX option to its exact option text, structural mutually-exclusive group, enclosing question owner, and one semantic block; ambiguous ownership must remain review-only.

**Architecture:** Extend the existing `docx_option_state_v1`/audit data carried by the canonical Document Worker. The OOXML parser will emit structural table/row/cell ancestry and explicit ActiveX group identity; the Normalizer will resolve that source group to exactly one normalized table plus one semantic question owner without global label-only matching. The existing Validator dispatch/checker remain the final fail-closed barrier: selected options with a unique owner stay eligible, unselected siblings are excluded, and unknown/conflicting/multiple ownership cannot become `confirmed`.

**Tech Stack:** n8n workflow JSON, JavaScript Code nodes, OOXML/MS-OFORMS structures, Node.js built-in test runner.

**Recovery baseline:** this branch starts at `a5c6050`. The authoritative local full Node suite is `404 total / 397 pass / 7 fail`; the seventh failure is the documented source-derived DOCX fixture-byte mismatch. Do not report the older literal-six set as this branch's exact local baseline.

---

### Task 1: Commit the bounded design and recovery evidence

**Files:**
- Create: `docs/superpowers/plans/2026-09-03-dw21-structural-option-owner.md`

- [ ] Record the exact baseline (`a5c6050`), accepted focused failure (`word/_rels/document.xml.rels` byte assertion), first incorrect boundary, unchanged contracts, and no-runtime/no-production-write boundary.
- [ ] Commit only this plan as `docs: plan DW-21 structural option ownership`.

### Task 2: Add an execution-derived sanitized RED fixture

**Files:**
- Create: `tests/fixtures/document-worker-docx-option-owner/execution-14374-structural-owner.json`
- Create: `tests/document-worker-docx-option-owner.test.mjs`

- [ ] Build the fixture from read-only execution `14374` outside the repository and check in only neutral token strings. Preserve equality/collision topology, source table/row/cell/nesting refs, control relationships, relative row geometry, `doc_3_au_0012`, `sb_0465`, `sb_0466`, and separate expected oracle; omit client text, credentials, URLs, UUIDs, provider responses, and the full DOCX.
- [ ] Exercise the real canonical Code-node bodies through the existing VM harness pattern. Assert that current Normalizer retains exact selected/unselected state and exact grounding but lacks a unique question/group/semantic owner.
- [ ] Cover: selected owner mapping, unselected sibling exclusion, nested table, duplicate labels in different groups, missing owner, conflicting coordinates/multiple owners, joint support by mutually-exclusive alternatives, neutral non-option fact, and a resolved selected-option control.
- [ ] Run `node --test --test-isolation=none tests/document-worker-docx-option-owner.test.mjs`; expect semantic assertions to fail for missing `mapping_status`, `option_group_id`, `question_owner`, and `semantic_block_id`, while fixture-integrity assertions pass.
- [ ] Commit fixture/tests only as `test: reproduce DW-21 unresolved option ownership`.

### Task 3: Extend source structural ownership minimally

**Files:**
- Modify: `workflows/n8n-exports/TENDER — Обработать документ.json` (`Разобрать состояния DOCX ActiveX`)
- Test: `tests/document-worker-docx-option-owner.test.mjs`

- [ ] Extend direct OOXML traversal to emit stable source table/row/control-cell/label-cell refs and bounded table ancestry. Derive a question owner only from an unambiguous direct structural owner (direct preceding sibling paragraph/row or enclosing ancestor cell), never from global/nearest-text search.
- [ ] Treat a preceding paragraph/row as an owner only when the OOXML tree records it as a typed direct sibling relation and there is exactly one candidate. Distance/proximity scoring is forbidden.
- [ ] Form mutually-exclusive groups only from explicit ActiveX group identity scoped to the structural owner/table; unsupported checkbox grouping remains `unknown` unless the structural source proves one exact group.
- [ ] Emit `mapping_status`/audit reasons for missing, conflicting, or multiple source owners. Do not use control names, ActiveX part numbers, labels, tender IDs, or execution IDs as production rules.
- [ ] Run the focused test and retain REDs that belong to downstream semantic binding.

### Task 4: Bind one structural group to one semantic owner

**Files:**
- Modify: `workflows/n8n-exports/TENDER — Обработать документ.json` (`Нормализовать документ Docling`)
- Modify: `workflows/n8n-exports/TENDER — Обработать документ.json` (`Развернуть части для AI v1.2`)
- Test: `tests/document-worker-docx-option-owner.test.mjs`

- [ ] Resolve a source option group to exactly one normalized table using all group rows, their exact labels, cell coordinates, and one common relative row offset.
- [ ] Resolve the question owner through the source-derived owner relation and the same local Docling/semantic hierarchy; duplicate text in another table/group must not participate.
- [ ] Add bounded `docx_option_state_v1` fields for exact option text, group/question identity, source refs, owner block ID, and `mapping_status`; preserve canonical block text and quotes byte-for-byte.
- [ ] Make the AI-visible segment contract carry proven state, exact option text, question/group identity, source refs, owner semantic block ID, and mapping status. Unknown ownership must not be presented to AI as selected/applicable; canonical segment text and evidence quote remain byte-identical.
- [ ] On zero/multiple/conflicting matches, attach bounded issue IDs, keep full document audit once, and set the affected option/group to review-only.
- [ ] Run the focused test until structural ownership cases pass.

### Task 5: Preserve proof through Validator dispatch and checker

**Files:**
- Modify: `workflows/n8n-exports/TENDER — Обработать документ.json` (`Проверить и привязать evidence`, `Проверить fallback и привязать evidence`, `Проверить evidence — попытка 2`, `Проверить Lossless Fact Partition`, `Подготовить dispatch AI Validator`, `Проверить ответ AI Validator`)
- Test: `tests/document-worker-docx-option-owner.test.mjs`

- [ ] Replace field allow-list behavior with fact-local structural applicability for every field: evidence touching an option group must use only selected options with one mapped owner/group; unselected evidence is deterministically rejected; mixed mutually-exclusive evidence is review-only.
- [ ] Keep a final universal DW-21 cap: unknown/conflicting/multiple owner or group mapping forces `requires_review`, `accepted_for_normalization=false`, and preserves exact candidate/evidence/provenance plus original AI verdict/reason in audit.
- [ ] Carry `docx_option_state_fact_audit_v1` losslessly with state, exact option token/text, group/question identity, source table/row/cell refs, owner semantic block ID, `mapping_status`, and issue IDs. AI must not create or alter this proof.
- [ ] Audit every mirror evidence path in the actual graph: primary strict checker, fallback strict checker, Evidence Repair attempt 2 rebuild/materialization, Lossless Fact Partition, collector, and dispatch. Preserve byte-identical shared validator bodies where the current contract requires parity.
- [ ] Run the same fixture through primary plus at least one synthetic fallback/repair route before the Validator cap; additive ownership must survive each route unchanged and review-only must still block AI promotion.
- [ ] Confirm a uniquely mapped selected option remains eligible for the normal Validator and a neutral fact is unchanged.

### Task 6: Verify and document only observed behavior

**Files:**
- Modify: `workflows/document-worker.md`
- Modify: `PROJECT_STATUS.md`
- Modify: `TECH_DEBT.md`
- Modify: `DEVELOPMENT_LOG.md`

- [ ] Run focused tests, then `node --test --test-isolation=none tests/document-worker-*.test.mjs`, then `node --test tests/*.test.mjs`.
- [ ] Compare full-suite failures to the recovery baseline; accept only exact pre-existing signatures and introduce no new signature.
- [ ] Run workflow structural checks, `git diff --check`, secret scan, client-text/fixture scan, and `git status --short --branch`.
- [ ] Document local GREEN only. Do not claim runtime/promotion GREEN and do not run n8n/DB mutations or a new runtime execution.
- [ ] Commit implementation/tests separately from documentation, with no push or merge.

## Contract and regression checklist

- `docx_option_state_v1` remains the base contract; fields are additive and bounded.
- `docx_option_state_audit_v1` remains document-level and lossless.
- Canonical semantic text and evidence quotes are unchanged.
- Exact grounding, recovery barrier, Validator cardinality/linking, 27 field keys, DB schema, persistence of rejected facts, and production settings remain unchanged.
- RED/GREEN demonstrates `doc_3_au_0012#0` exact grounding PASS plus applicability FAIL before the fix, then review-only unless one selected option has one proven owner/group.
- Runtime test is explicitly deferred to the owner's review checkpoint.
