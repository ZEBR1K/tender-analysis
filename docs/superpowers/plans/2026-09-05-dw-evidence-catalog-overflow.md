# Document Worker Evidence Catalog Overflow Corrective TDD Plan

> **Constraint:** no commit, push, workflow import/publication, paid call, or live write.

**Goal:** repair the blocked overflow implementation so it handles the real execution-14487 structural class without weakening exact evidence acceptance.

**Architecture:** preserve full mode for `<=256`; on overflow use bounded deterministic lexical overlap only to rank exact canonical candidates inside known violation-bound target blocks. AI still selects refs only. Attempt-2 rebuild parity and the unchanged strict validator remain authoritative.

## Task 1 — Correct the false-green fixture and prove RED

- [x] Replace the earlier 270-candidate whole-anchor assumption with a sanitized derivative preserving the observed `2,016` total candidates, `2,015` `sb_0714` candidates, `44,375` canonical characters, primary target scope and no whole-candidate exact anchor. The three distributed late candidates are explicitly synthetic retrieval-test geometry, not an observed runtime distribution.
- [x] Record the independent runtime lengths/hashes without including raw runtime material.
- [x] Execute actual canonical `Подготовить Evidence Repair` jsCode.
- [x] Capture expected RED: `[Prepare Evidence Repair] Target-window exact material anchor missing for sb_0714.`

## Task 2 — Minimal synchronized implementation

- [x] Keep full-mode output/contract unchanged for `<=256`.
- [x] Before any overflow ranking, require exactly one invalid fact and one repaired-fact context; multi-fact overflow hard-fails with audited counts pending a future fact-local catalog contract.
- [x] Add overflow-only token overlap ranking restricted to violation-bound target blocks.
- [x] Bound source scan, target blocks, anchor characters/tokens, candidate tokens, scoring operations, ranked anchors, and neighbours.
- [x] Ignore empty/short/stop/high-frequency ambiguous tokens; fail closed on fewer than two useful tokens or zero overlap.
- [x] Preserve stable original ordinal refs and output only exact canonical source candidates.
- [x] Treat selected primary target candidates as sufficient `missing_primary_evidence` retrieval coverage; otherwise require a deterministically relevant primary candidate.
- [x] Keep preparation and attempt-2 shared builders byte-identical.
- [x] Extend attempt-2 exact contract parity for selection mode/metrics/omissions without raw anchor text.
- [x] Leave materialization, `validateFacts`, one-call topology, models, credentials, and persistence unchanged.

## Task 3 — Focused regression matrix

- [x] Multi-fact overflow with two independently repairable facts and different target/primary material fails closed before ranked retrieval.
- [x] Execution-14487-shaped geometry plus synthetic distributed late fragments; real runtime token coverage remains a canary gate.
- [x] Constructed valid repair materializes exact source strings and passes unchanged validation.
- [x] Zero-overlap fail closed.
- [x] Generic/ambiguous low-information fail closed.
- [x] Target block absent fail closed.
- [x] Primary target coverage and relevant-primary fallback requirement.
- [x] Deterministic source-order tie break.
- [x] Existing `<=256` full-mode behavior.
- [x] Old adversarial overflow.
- [x] Serialized request bound.
- [x] Attempt-2 tamper parity.
- [x] Mutation reverting lexical selection to whole-candidate equality makes corrected 14487 preparation fail.

## Task 4 — Verification and documentation

- [x] Correct design, workflow documentation, project status, technical debt, and this plan so none claims whole-candidate exact anchors.
- [x] Run focused actual-jsCode file: `node --test tests/document-worker-evidence-repair.test.mjs` → `108/108` pass.
- [x] Run `git diff --check`, JSON parse/Code compilation checks, focused mutation check, and inspect final uncommitted diff/status.
- [x] Do not run the full repository suite because the focused suite is green and the task explicitly says not to run full unless needed.
- [x] Leave all changes uncommitted.

## RED / GREEN evidence

```text
RED
multi-fact catalog overflow fails closed before merged ranked retrieval can cross-select fact-local primary material
AssertionError: Missing expected rejection.

GREEN
node --test tests/document-worker-evidence-repair.test.mjs
108 tests / 108 pass / 0 fail
```

The mutation regression is part of the focused suite: replacing `candidateTokenSet.has(token)` with whole-candidate `materialLiterals.has(candidate.canonical_quote)` makes the corrected 14487 preparation reject with missing ranked material overlap.
