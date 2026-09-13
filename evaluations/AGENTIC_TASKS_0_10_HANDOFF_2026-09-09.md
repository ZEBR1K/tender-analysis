# Agentic analysis Tasks 0–10 handoff

**Date:** 2026-09-09  
**Branch:** `codex/agentic-analysis-integration`  
**Scope:** repository-only shadow foundation; no live n8n, production database, or server mutation

## Result

Tasks 0–5 and 7–10 are implemented and locally verified. Task 6 has the
required nonblocking multi-procurement protocol, but the repository still has
only one real procurement with four repeated runs. Its state is therefore
truthfully `awaiting_additional_procurements`, not a semantic release pass.

The isolated runner now accepts an immutable source-only manifest, verifies
original file size/SHA-256, stages one job-local Codex workspace, runs a fixed
non-interactive command with bounded audit artifacts, validates only the closed
JSON/source-identity contract, and exposes an asynchronous restart-safe job
lifecycle. One automatic second attempt is allowed only for a typed
transport/process failure without a valid JSON result. Contract failure never
causes a paid automatic retry.

The agentic lane remains additive and isolated. Existing Document Worker,
Aggregator, Targeted Recheck, Finalization, report workflows, and canonical
tables were not removed or replaced. Tasks 11–17, n8n wiring, production
deployment, and live database changes were intentionally not performed.

## Simplification audit: removed or rejected

| Artifact or behavior | Disposition |
|---|---|
| `source-index.mjs` and `source-index/{common,docx,pdf,xlsx,activex}.mjs` from rejected commit `9d83f01` | Never merged; its page/sheet/OOXML parsing and mechanical coverage model are absent from the integration branch. |
| `agentic-source-index-{pdf,docx,xlsx}.test.mjs` and `source-index-minimal.json` | Never merged with the rejected parser implementation. |
| Schema-level `inspection_coverage`, page/sheet/part counters, `quote_mode`, conflict objects, and completeness proof | Removed from the runtime result contract. Agent inspection reports are audit statements, not a mechanically proven coverage barrier. |
| Semantic status rewrite (`reported_status` → `effective_status`) | Removed. Runtime either accepts the agent value/status unchanged or rejects the whole structurally invalid job. |
| Shadow persistence columns `reported_status`, `effective_status`, `reported_value_text`, `effective_value_text`, `requires_human_review`, and `validation_level` | Removed from the unapplied repository migration. The shadow row now stores only `status`, `value_text`, contract-only `validation_issues`, and the original `result_json`. PostgreSQL 17 empty/populated/double-apply/ownership/drift evidence was regenerated for the exact migration bytes. |
| Legacy `reported_`/`effective_` status aliases in `schema-validation.mjs` | Removed. Only the current `status` property can produce the JSON-contract issue `STATUS_INVALID`. |
| Semantic issue codes `VALUE_REQUIRED`, `INSPECTION_INCOMPLETE`, `QUOTE_NOT_VERIFIED`, `ELLIPSIS_FRAGMENT_MISMATCH`, `ELLIPSIS_MATERIAL_GAP`, `CONFLICT_BLOCKS_RESOLVED`, `NEGATIVE_BASIS_MISSING`, `NOT_FOUND_WITH_INCOMPLETE_COVERAGE`, `COMPLETENESS_PROOF_MISSING`, and `ARITHMETIC_MISMATCH` | Removed from the blocking validation schema and runtime. No PRICE/VAT/NEGATIVE/CONFLICT family remains as a business-semantic runtime rule. |
| Field policy flags such as `negative_result_sensitive`, `completeness_required`, `value_kind`, `selected_control_required`, and field-specific arithmetic checks | Removed. The policy now contains only catalog identity and the exact key/index mapping. |
| Single-procurement semantic fixtures `absence-negative.json`, `conflict-resolved.json`, `ellipsis-material-gap.json`, `ellipsis-valid.json`, and `incomplete-not-found.json` | Removed as blocking-test inputs. The old duplicate fixture was also removed; duplicate-field contract behavior is still tested directly as JSON cardinality/identity. |
| Quote search, quote completeness, evidence sufficiency, value-to-quote matching, arithmetic, VAT, negative-answer inference, conflict resolution, and field-specific containment | Not implemented in runtime code or blocking tests. |

## Retained runtime mechanisms and their allowed reason

| Retained mechanism | Allowed reason |
|---|---|
| Header authentication, internal-only Compose boundary, permission profile, environment allow-list/redaction, size limits, queue bound, timeout and process-tree termination | **Security** |
| UUID/path guards, symlink rejection, atomic upload/write, exact directory ownership, original size/SHA-256 checks, sealed manifest/catalog hashes, attempt-local immutable audit, result artifact hashes, exact-job TTL cleanup | **Original-file and artifact integrity** |
| `tender-fields-v1.json` containing only catalog identity plus 27 key/index pairs | **JSON contract** |
| Strict Ajv schemas and `schema-validation.mjs` | **JSON contract:** object types, required properties, closed properties, exact 27 unique fields, and allowed statuses |
| `result-validator.mjs` | **JSON contract and file integrity:** sealed input identity, manifest membership for referenced `artifact_key`, and a nonblank locator for `resolved`/`requires_review` |
| Additive shadow migration and `agentic-job-migration.test.mjs` | **File/data ownership integrity and JSON contract:** exact job/run/catalog ownership, unique field key/index, bounded field index, and the allowed status enum. They contain no semantic downgrade or alternate effective value. The later 27-row DB transaction is outside Tasks 0–10. |
| Job state-transition and retry tests | **Artifact integrity and JSON/API contract:** no duplicate child, bounded retry, restart recovery, immutable result, and no silent queue loss |
| Result-schema and result-validator tests | **JSON contract and file integrity:** required types/properties, exact unique 27-key mapping, allowed statuses, source membership and nonblank locator. They do not score meaning, quotes, evidence sufficiency, or field semantics. |
| Deployment, process, manifest and lifecycle tests | **Security, file/artifact integrity and JSON/API contract:** isolation, bounded input/processes, safe paths, immutable hashes, crash recovery and typed state transitions. |
| `scripts/evaluate-agentic-result.mjs` and its harness tests | **JSON/evaluation-input contract only:** typed adapters make the four archived formats comparable offline. Their semantic metrics are diagnostic and cannot reject or rewrite a runtime result. |

`not_found` requires no source, citation, or locator. The top-level
`inspected_documents`, `limitations`, and `constraints` arrays preserve the
agent's general audit without claiming mechanically complete inspection.

## Offline semantic material

`scripts/evaluate-agentic-result.mjs`, the provisional four-run baseline, and
the skill pressure tests remain offline diagnostics. They may compare semantic
quality, but they never reject, rewrite, or block a runtime result. Any future
semantic defect must first be reproduced on distinct procurements and retried
through a short-skill change; it cannot become a runtime rule without the
separate four-part admission test recorded in the plan.

## Verification and open gates

- Full repository run at final Tasks 0–10 review HEAD: `670 passed`, `0 failed`, `2 skipped`.
- Expected skips: real PostgreSQL fixture without an explicit disposable
  runtime, and a POSIX-only ignored-`SIGTERM` process-group regression on the
  Windows development host.
- Task 8 code review: approved after JSONL token accounting, exact-secret
  redaction, forced process-tree termination, trusted instruction staging, and
  runtime-directory fixes.
- Task 10 lifecycle review: approved after attempt-local terminal journals,
  restart reconciliation, and fault-injection coverage for partial success and
  contract-failure crashes.
- Real Linux container isolation canary is still mandatory and fail-closed;
  `POST /start` remains unavailable until that deployment gate is explicitly
  verified.
- The pinned blind-test catalog and repository root `FIELD_CATALOG.md` have the
  same 27 key/index mapping but different hashes. Reconciliation remains a
  production-wiring gate, not a reason to mutate either source silently.
- Task 6 needs at least one genuinely different sanitized procurement before
  repeatability can be described as cross-procurement evidence.

This inventory covers artifacts created for the agentic shadow foundation.
Legacy Document Worker/Aggregator parsers and validators remain untouched in
their separate existing lane and are not imported into, or used as gates by,
the Codex runner.
