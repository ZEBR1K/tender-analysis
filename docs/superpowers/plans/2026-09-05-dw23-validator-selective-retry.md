# DW-23 AI Validator selective retry implementation plan

**Goal:** Contain fact-local AI Validator contract failures so a document completes with an auditable `requires_review` fallback after a bounded retry budget.

**Scope:** Canonical Document Worker export, focused tests/fixture, Document Worker documentation, project status, technical debt, and development log. No production n8n/DB mutation, schema change, field-semantic change, or merge to `main`.

## Task 1 — Add execution-derived RED

Files:

- `tests/fixtures/document-worker-validator-execution-14491-sanitized.json`
- `tests/document-worker-validator-selective-retry.test.mjs`

Create a minimal sanitized 22-unit/22-response replay retaining the observed identity and malformed `confidence` boundary. Assert primary node placement, target-only retry identity, sibling preservation, exact attempt budget, terminal fallback metadata, strict-checker compatibility, and hard-fail source/identity guards. Run the focused test and confirm RED for missing retry topology.

## Task 2 — Implement the bounded local retry path

File:

- `workflows/n8n-exports/TENDER — Обработать документ.json`

Make the smallest graph change between `AI Validator v1` and `Проверить ответ AI Validator`:

1. preserve explicit source/profile data in Validator dispatch;
2. classify primary responses fact-locally;
3. expand only invalid fact identities;
4. iterate the finite retry queue with batch size 1;
5. run explicit attempts 2 and 3 with the same Validator request contract;
6. classify each retry without accepting malformed output;
7. materialize the deterministic technical fallback after attempt 3;
8. reassemble complete unit responses in original source order;
9. propagate retry/fallback audit through the existing strict checker into `validator_meta`;
10. preserve all downstream nodes and contracts.

Disable hidden HTTP retries and use explicit continue-on-error output for these three logical calls. Keep source invariant failures hard-stop.

Run the focused test until GREEN, then run the existing Validator, evidence-repair, lossless-partition, and item-linking suites.

## Task 3 — Document and verify

Files:

- `workflows/document-worker.md`
- `TECH_DEBT.md`
- `PROJECT_STATUS.md`
- `DEVELOPMENT_LOG.md`

Document only the implemented local candidate state. Mark runtime/promotion as not verified. Record exact focused/full test results and preserve known baseline failures without relabelling them as DW-23 regressions.

Verification:

1. parse canonical workflow JSON;
2. assert node names/IDs and graph reachability;
3. run focused DW-23 test;
4. run relevant Document Worker suites;
5. run full `node --test tests/*.test.mjs` and compare failures with the accepted baseline;
6. inspect `git diff --check`, `git diff --stat`, and `git status`;
7. perform independent code review before declaring completion.

