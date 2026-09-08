# TenderPlan mark intake and resumable analysis design

**Date:** 2026-09-07

**Status:** repository candidate implemented and offline-verified; deployment/runtime pending

**Scope:** automatically detect a TenderPlan procurement mark, start one analysis for a new procurement, and resume the same `analysis_run_id` after document-processing failures without reprocessing completed documents.

**Task 9 contract correction (2026-09-08):** the notification type-5 adapter below is superseded. Executions `14682/14683` proved `GET /api/tenders/v2/getlist?type=1&id=6a732cd00c61629cf1d3c144`, label «Проверить», with the same tender duplicated under `tender` and `tenders`. The poller reads current membership, derives a stable mark+tender key, and supplies no invented timestamp. Removing and later reassigning the same mark does not create a new event: the same key remains a duplicate and does not restart analysis. Automatic recovery uses Recovery Scan; operator retry uses Manual Resume with the existing `analysis_run_id`. Notification retention/recipient/ordering and relation pagination/exhaustiveness remain undocumented.

**Superseded-run amendment (2026-09-08):** the owner approved terminal run
status `superseded` for the exact 86 pre-rollout legacy rows confirmed by
read-only execution `14685`. Runs and all children remain intact;
`superseded_at` and `superseded_reason` record the transition without replacing
`error_message`. A superseded run never resumes. Active-run uniqueness excludes
both `completed` and `superseded`; therefore the first post-rollout mark may
create a new run when prior history is only superseded, while subsequent
remove/reassign observations still use the same stable event key and remain
duplicates.

## 1. Goal

An employee marks a procurement in TenderPlan. The system must detect that event and route it to the tender-analysis pipeline.

The same entry path must support:

- first-time analysis of a procurement;
- duplicate current-membership observations as no-ops;
- a direct manual resume by `analysis_run_id`;
- periodic recovery of failed or stale document processing;
- idempotent handling of duplicate TenderPlan mark-membership observations.

The normal result is:

```text
TenderPlan mark
→ resolve tender_id
→ create or reuse analysis_run_id
→ process only eligible documents
→ existing DB-backed readiness barrier
→ Aggregator
→ Finalization
→ report
```

The primary business requirement is that retrying an analysis must not create a new run or reprocess documents already marked `completed`.

## 2. Confirmed decisions

The user confirmed the following policy:

1. Use a separate intake/resume dispatcher rather than placing notification polling and recovery policy directly inside the current Orchestrator.
2. A document in `processing` becomes stale one hour after `started_at`.
3. Time alone is not sufficient to reclaim a stale document. The dispatcher must first check the recorded n8n execution.
4. A document may be moved from stale `processing` to `failed` only when the recorded execution is no longer active, is missing after the timeout, or finished without completing the document.
5. Automatic document processing has a maximum of two total claims: one initial attempt and one automatic retry.
6. Manual resume may retry the same run after the automatic budget is exhausted. It does not reset `attempts`.
7. Repeated current-membership observations use the same stable mark+tender key; removing and later reassigning the same mark does not create a new event or restart analysis.
8. Automatic recovery uses Recovery Scan; operator retry uses Manual Resume with the existing `analysis_run_id`. Starting a fresh historical reanalysis requires a separate explicit action.
9. `superseded` is terminal and cannot be reopened by mark intake, Recovery Scan, or Manual Resume.
10. Superseding preserves the run, every child row, and existing `error_message`; nullable `superseded_at` and `superseded_reason` provide audit.
11. The production-candidate migration may reconcile only the exact bounded 86-row legacy shape from execution `14685`; any other active duplicate shape rolls back.

## 3. Current state and authoritative discrepancies

The current Document Worker already performs an atomic claim:

```text
pending | failed
→ processing
attempts += 1
n8n_execution_id = current execution
```

Therefore `completed` documents are already protected from duplicate Worker processing, while `pending` and `failed` documents can be processed under the same `analysis_run_id`.

The current Orchestrator does not expose resume behavior. Every invocation inserts a new `tender_analysis_runs` row, registers all documents and starts Workers. It has no production trigger or tender-level deduplication policy.

Read-only live n8n inspection on 2026-09-07 found a material repository/live discrepancy:

- live Orchestrator `Q1RWSrB0jaTA6Dmx` is inactive and uses a Manual Trigger with hard-coded `tender_id` values;
- it calls inactive test Worker `W4mNOUkdsFtNENpI`;
- that test Worker has no configured Error Workflow;
- active production Worker `1Pw61ZY3HgBSvcUr` does have Error Workflow `jYzQ8RtNmnTM2PGz` configured.

Live n8n is authoritative for current production state. Wiring the dispatcher to the intended production candidate must be an explicit promotion decision, not an inferred ID replacement.

The current Error Workflow changes a claimed document from `processing` to `failed`, but leaves the parent run in `processing`. This allows retry but can leave the run unfinished indefinitely when no retry controller is present.

The current Aggregator atomically claims only:

```text
ready_for_aggregation
→ aggregating
```

A repeated call while the run is already `aggregating` receives `aggregation_claimed=false` and stops. Automatic mid-Aggregator recovery is not introduced by the document retry policy; the dispatcher handles this state conservatively as defined below.

## 4. Selected architecture

Use three small entry workflows around the existing processing workflows:

```text
TENDER — TenderPlan Mark Intake
    Schedule Trigger: every 10 minutes
    → read current tenders under mark «Проверить»
    → validate and deduplicate tender IDs
    → persist/deduplicate stable mark+tender intent
    → call TENDER — Intake / Resume

TENDER — Recovery Scan
    Schedule Trigger: every 10 minutes
    → find unfinished runs and retryable/stale documents
    → call TENDER — Intake / Resume

TENDER — Manual Resume
    Manual Trigger in the authenticated n8n UI
    → Edit Fields: analysis_run_id
    → analysis_run_id
    → call TENDER — Intake / Resume

TENDER — Intake / Resume
    typed reusable sub-workflow
    → resolve run
    → route by run/document state
    → call Orchestrator, Worker, Aggregator or Finalization as appropriate
```

The three entry workflows contain no duplicated business logic. `TENDER — Intake / Resume` is the single policy owner.

The existing Orchestrator remains responsible for new-run initialization only:

```text
tender_id
→ TenderPlan FullInfo
→ create analysis_run
→ register all documents
→ dispatch one Worker execution per document
```

It must stop using hard-coded TenderPlan IDs and accept a typed `tender_id` input from the dispatcher. A Manual Trigger may remain for isolated testing, but it must feed the same validated input contract.

## 5. TenderPlan intake contract

The inspected TenderPlan Swagger identifies notification type `5` as a tender marked with a label, but executions `14677`, `14680`, and `14682` returned no usable notification event. Runtime execution `14683` instead confirmed the current relation contract for mark `6a732cd00c61629cf1d3c144` («Проверить»): `GET /api/tenders/v2/getlist?type=1&id=<mark_id>` returns the tenders currently assigned to the mark. The production candidate therefore polls current mark membership rather than relying on undocumented notification retention or recipient behavior.

Polling requirements:

- interval: 10 minutes;
- perform one bounded GET for the configured mark; Swagger and execution `14683` expose no pagination, ordering, cursor, or exhaustive-result contract, so the candidate must not invent one;
- normalize only confirmed `tender.id` and `tenders[].id` paths and deduplicate repeated representations;
- require a non-empty TenderPlan `tender_id` before dispatch;
- derive a stable source key from the confirmed mark ID and tender ID;
- leave `observed_at` absent when the source relation supplies no event timestamp;
- retry transient TenderPlan network errors at the node level;
- use a workflow-level Error Workflow;
- store TenderPlan authentication only in n8n Credentials;
- never use n8n static data as the durable deduplication boundary.

The adapter's known limitation is current-state rather than historical coverage: a relation removed between polls cannot be reconstructed, and exhaustive coverage beyond the returned response is not runtime-proven. Malformed populated relation structures fail closed.

If TenderPlan later provides a supported webhook, only this adapter changes. The dispatcher contract remains unchanged.

## 6. Persistent intake event ledger

Add a PostgreSQL table dedicated to external-intent idempotency and intake audit:

```text
tender_analysis_intake_events
```

Required logical fields:

| Field | Purpose |
|---|---|
| `id` | Internal UUID primary key |
| `source` | `tenderplan` |
| `event_key` | Stable unique external-intent key |
| `event_type` | Normalized `mark_added` |
| `tender_id` | TenderPlan procurement ID |
| `observed_at` | Source event time when available |
| `trigger_kind` | `tenderplan_mark`, `recovery_scan` or `manual` |
| `analysis_run_id` | Run selected or created by the dispatcher |
| `status` | `processing`, `completed` or `failed` |
| `attempts` | Number of event-processing claims |
| `n8n_execution_id` | Current event-processing owner |
| `processing_started_at` | Start time of the current event claim |
| `action` | Dispatcher outcome |
| `error_message` | Bounded failure detail |
| `created_at` | First persistence time |
| `processed_at` | Successful terminal intake time |

`event_key` must be unique per source. The selected relation adapter uses `tenderplan:mark:<mark_id>:tender:<tender_id>` because both coordinates are confirmed and immutable for one current mark membership; repeated polls and remove/reassign cycles intentionally produce the same key. The latter remains a duplicate rather than a new event. The source relation has no confirmed event timestamp, so it does not invent one. Manual and recovery invocations use synthetic keys containing their n8n execution ID and selected `analysis_run_id`.

An existing ledger row is terminally duplicate only when `status='completed'` and `processed_at` is set. Insert/retry uses an atomic event claim that records `n8n_execution_id`, increments `attempts` and sets `processing_started_at`. A fresh `processing` owner cannot be replaced. A `failed` event or a stale `processing` event whose recorded execution is confirmed terminal may be reclaimed. This recovers processing of the same intake intent; it does not turn mark reassignment into a new event or replace Recovery Scan as the automatic analysis-run recovery path.

The event ledger is not the source of truth for analysis completion. `tender_analysis_runs` and its child tables remain the source of truth. The ledger answers only whether an external event was seen and what action it caused.

Expected `action` values:

```text
created_new_run
resumed_existing_run
already_active
already_completed
superseded_no_op
retry_exhausted
duplicate_event
conflict_multiple_runs
manual_attention_required
failed
```

## 7. Dispatcher input and output contracts

Typed input:

```json
{
  "trigger_kind": "tenderplan_mark | recovery_scan | manual",
  "tender_id": "string | null",
  "analysis_run_id": "uuid | null",
  "source_event_key": "string | null",
  "manual_override": false
}
```

Validation rules:

- `tenderplan_mark` requires `tender_id` and `source_event_key`;
- `tenderplan_mark` and `recovery_scan` are automatic intents and require `manual_override=false`;
- `recovery_scan` requires `analysis_run_id`;
- `manual` requires `analysis_run_id` and sets `manual_override=true` only through the protected admin path;
- ambiguous or unknown identifiers fail before any state mutation.

Typed output:

```json
{
  "success": true,
  "action": "resumed_existing_run",
  "analysis_run_id": "uuid",
  "tender_id": "string",
  "documents_dispatched": 1,
  "documents_skipped_completed": 2,
  "documents_active": 0,
  "documents_retry_exhausted": 0,
  "next_state": "processing"
}
```

Expected business outcomes return a structured result. Unknown states, malformed contracts and failed state transitions are hard errors routed to the workflow-level Error Workflow.

## 8. Run resolution and tender deduplication

For `tenderplan_mark`, the dispatcher resolves by `(source='tenderplan', tender_id)`. PostgreSQL enforces at most one active run with a partial unique index on `(source, tender_id)` using `status NOT IN ('completed', 'superseded')`.

Resolution policy:

| Existing state | Action |
|---|---|
| No run exists | Call the new-run Orchestrator path |
| Exactly one unfinished run exists | Reuse its `analysis_run_id` |
| One or more completed runs and no unfinished run | Return `already_completed` |
| Only superseded history exists | Call the new-run Orchestrator path |
| More than one unfinished run | Fail closed with `conflict_multiple_runs` and alert |

Unfinished includes:

```text
created
processing
ready_for_aggregation
aggregating
failed
```

`superseded` and `completed` are terminal and are not unfinished/active.

Before creating the index, the migration may reconcile only these exact active
legacy groups: `24` rows for
`manual_test/manual-calibration-167-26-ZO` through
`2026-09-07T05:59:14.629399+00:00`, `50` rows for
`tenderplan/6a7af04c3951804ff31b66a6` through
`2026-08-17T18:50:41.678699+00:00`, and `12` rows for
`tenderplan/6a7ef6ac3951804ff32da751` through
`2026-08-23T16:29:52.779826+00:00`. It must assert the complete shape before
updating exactly 86 rows. No active duplicates is a no-op; any other shape
aborts and rolls back. No run or child is deleted.

Before that update, the migration must inspect the same-name active-run index.
It may drop only the exact valid legacy definition on `(source, tender_id)`
with predicate `status <> 'completed'`; this happens inside the transaction and
before reconciliation because the legacy predicate still indexes
`superseded`. The exact current definition is retained, absence is the fresh-DB
path, and every unknown or incompatible same-name object aborts without a
drop. After reconciliation and the final duplicate preflight, the migration
creates the current predicate. Transaction rollback restores a dropped legacy
index if any later step fails.

The new-run SQL uses conflict-aware insert against that partial uniqueness boundary and returns whether it inserted a run or lost the conflict. Creation of the run and registration of its complete document set must occur in the same PostgreSQL statement/transaction after TenderPlan FullInfo has been normalized. A failure cannot commit an empty `created` run between those two operations. When the insert loses a concurrent conflict, the caller performs a fresh `SELECT` to load the now-visible unfinished run. Therefore two concurrent dispatcher claims may both reach the create boundary, but only one can create the run and register documents; the other reuses the returned unfinished `analysis_run_id` and must not register documents again.

For `manual` and `recovery_scan`, `analysis_run_id` is authoritative. The dispatcher validates that the run exists and reads `tender_id` from PostgreSQL; it does not accept conflicting tender identity from the caller.

## 9. Document resume policy

The dispatcher evaluates every document in the selected run:

| Document state | Automatic `tenderplan_mark` / `recovery_scan` | `manual` with `manual_override=true` |
|---|---|---|
| `completed` | Skip | Skip |
| `pending`, `attempts < 2` | Dispatch | Dispatch |
| `failed`, `attempts < 2` | Dispatch | Dispatch |
| `pending` or `failed`, `attempts >= 2` | Exhausted; do not dispatch | Dispatch |
| `processing`, age < 1 hour | Active; do not dispatch | Active; do not dispatch |
| `processing`, age >= 1 hour | Verify n8n execution, then conditionally reclaim | Same verification; no blind reclaim |
| `skipped` | Preserve; do not reinterpret | Preserve; do not reinterpret |

`attempts` is incremented by the existing Worker atomic claim. Therefore:

```text
attempts = 0 → initial claim → attempts = 1
attempts = 1 → one automatic retry → attempts = 2
attempts >= 2 → no further automatic Worker call
```

Only `trigger_kind=manual` with `manual_override=true` may call the Worker when `attempts >= 2`. The Worker increments the counter normally. The counter is never reset or decremented.

Every later observation, including after remove/reassign, carries the same TenderPlan mark+tender event key rather than creating a new event. A completed ledger row is therefore a duplicate and does not invoke analysis retry policy again. Reclaim of a failed/stale ledger row only recovers processing of that same intake intent. Automatic analysis recovery is initiated by Recovery Scan; only direct Manual Resume with `manual_override=true` may reopen a run after automatic exhaustion.

## 10. One-hour stale processing recovery

A document is a stale candidate when:

```text
status = processing
AND started_at <= now() - interval '1 hour'
AND n8n_execution_id IS NOT NULL
```

The dispatcher uses a dedicated read-only n8n API credential to inspect the recorded execution.

Decision table:

| Execution observation | State mutation |
|---|---|
| Running or waiting | None |
| Terminal success, but document still `processing` | Mark `failed` with `execution_finished_without_document_completion` |
| Terminal error/cancel/crash | Mark `failed` with the normalized terminal reason |
| Execution not found after the one-hour threshold | Mark `failed` with `execution_not_found_after_timeout` |
| n8n API unavailable or response invalid | No mutation; return/alert `execution_status_unavailable` |

The stale transition must be compare-and-set and return the affected row:

```text
UPDATE only when:
document_id matches
analysis_run_id matches
status is still processing
n8n_execution_id still equals the inspected execution
started_at is still the inspected timestamp
```

This prevents the recovery scan from overwriting a newer Worker claim. After a successful transition to `failed`, the dispatcher applies the attempt budget and may invoke the Worker.

The workflow must never change `processing` to `failed` only because the clock passed one hour.

## 11. Run failure and manual reopening

The run remains `processing` while any document is:

- actively processing;
- pending and eligible for a claim;
- failed and eligible for its one automatic retry.

The dispatcher moves the run to `failed` only when all of the following are true:

```text
no pending documents remain
no processing documents remain
at least one failed document has attempts >= 2
the run cannot reach the all-documents-completed barrier automatically
```

The run-level `error_message` records a bounded summary of exhausted document IDs/counts. Per-document details remain in `tender_analysis_documents.error_message` and n8n executions.

Only `trigger_kind=manual` with `manual_override=true` may atomically reopen a `failed` run:

```text
failed
→ processing
```

It then dispatches only non-completed documents authorized by the manual override. Existing `completed` documents, units and facts are untouched.

## 12. Retry-safe persistence gate

Automatic document retry must not be enabled until known issue `DW-8` is resolved for the selected Worker package.

The retry attempt may produce a smaller current set of analysis units than the previous failed attempt. After the current unit set has been persisted, the Worker must reconcile rows proven stale for that same document and current run before completion counts are evaluated.

The reconciliation boundary is narrow:

- only the retried `document_id` and its `analysis_run_id`;
- only unit/fact rows no longer present in the newly persisted deterministic current set;
- never rows belonging to another document or run;
- never rejected facts merely because Aggregator does not consume them;
- retry reason, previous `attempts`, execution ID and reconciliation counts must remain auditable.

The implementation plan must add a focused regression where attempt one creates three units, attempt two creates two units, and the document still reaches `completed` with exactly the current two-unit persistence set.

## 13. Stage-aware continuation after documents

After document dispatch or when no Worker needs to run, the dispatcher reads DB state rather than relying on in-memory branch convergence.

| Run/document state | Continuation |
|---|---|
| Some documents pending/processing/retryable failed | End dispatcher execution; Workers continue independently |
| All documents completed and run is `processing` | Execute the existing readiness claim |
| Run is `ready_for_aggregation` | Call Aggregator with the same `analysis_run_id` |
| Run is `aggregating` with 27 valid FINAL rows | Call Finalization; it already supports safe `already_completed` behavior |
| Run is `aggregating` with fewer than 27 FINAL rows | Return `manual_attention_required`; do not reset or rerun Aggregator blindly |
| Run is `completed` | Return `already_completed` |
| Run is `superseded` | Return `superseded_no_op`; dispatch nothing |

This scope guarantees automatic recovery of the document stage and safe continuation into an unstarted Aggregator. It does not invent automatic recovery for a partially executed Aggregator because the current run schema does not record an Aggregator execution owner and the current Aggregator claim rejects `aggregating`.

A later dedicated Aggregator-resume design may add an aggregation execution owner/lease and selective missing-field recovery. Until then, manual attention for partial `aggregating` is safer than rerunning all 27 AI field operations or resetting lifecycle state without ownership evidence.

## 14. Error handling and observability

Every unattended entry workflow must have a workflow-level Error Workflow. Fallible HTTP and database nodes must have explicit retry/error behavior appropriate to the operation.

Required visible outcomes:

- TenderPlan polling/auth/pagination failure;
- duplicate event;
- missing or ambiguous tender ID;
- multiple unfinished runs for one tender;
- n8n execution-status API unavailable;
- stale document reclaimed;
- automatic retry dispatched;
- automatic retry exhausted;
- manual run reopened;
- Aggregator partial state requiring manual attention.

No path may silently return zero items when a state transition was expected. Every state-changing PostgreSQL query must return a row/count and a following guard must reject an unexpected zero-row result.

Credentials required by TenderPlan and the n8n API remain in n8n Credentials. No token, API key or connection string is stored in workflow JSON, logs, the event ledger or repository.

## 15. Concurrency and idempotency invariants

1. One procurement may have historical completed/superseded runs, but PostgreSQL enforces at most one active run per `(source, tender_id)`.
2. One stable TenderPlan mark+tender intent causes at most one dispatcher action.
3. One Document Worker execution processes exactly one document.
4. Worker atomic claim remains the final protection against duplicate dispatch.
5. `completed` documents are never reverted by intake/recovery workflows.
6. Stale recovery uses execution verification plus compare-and-set.
7. Automatic `tenderplan_mark` and `recovery_scan` Worker claims stop at `attempts = 2`.
8. Only `manual` with `manual_override=true` may bypass that limit; manual claims preserve and increment `attempts`.
9. PostgreSQL remains the synchronization layer; no Merge or `$input.all()` barrier coordinates independent Workers.
10. All documents remain registered before the first Worker of a new run starts.
11. The existing 27/27 FINAL barrier and field semantics are unchanged.

## 16. Verification scenarios

The design is accepted only when implementation proves at least these cases:

1. First observed membership for an unknown `tender_id` creates exactly one run and registers all documents once.
2. A repeated poll or remove/reassign cycle emits the same key and creates no run or Worker execution.
3. Two concurrent dispatcher claims for one new tender still create one unfinished run, and the losing conflict-aware insert does not register documents.
4. Recovery Scan on a run with two completed documents and one `failed`, `attempts=1` document dispatches only that failed document with the same `analysis_run_id`.
5. `failed`, `attempts=1` is automatically claimed once and becomes `attempts=2`.
6. `failed`, `attempts=2` is not automatically dispatched.
7. Manual resume of `failed`, `attempts=2` uses the same run and increments to `attempts=3`.
8. `processing` for 59 minutes is not inspected/reclaimed.
9. `processing` at least one hour old with a running/waiting execution remains untouched.
10. `processing` at least one hour old with a terminal execution becomes `failed` only through the guarded update.
11. n8n API failure leaves document state unchanged and produces a visible error/alert.
12. A concurrent newer claim makes the stale compare-and-set affect zero rows, and the guard reports a benign race rather than overwriting it.
13. Attempt-one three units followed by attempt-two two units passes the retry-safe persistence/completion regression.
14. Exhausted failed document plus no remaining active documents moves the run to `failed`.
15. A remove/reassign cycle remains a duplicate and does not reopen an automatically exhausted failed run; only direct `manual` with `manual_override=true` reopens it.
16. The stable key for a completed tender remains a duplicate and creates no new run.
17. All documents completed under a processing run cause the existing readiness claim and one Aggregator start.
18. `ready_for_aggregation` resumes Aggregator without running any Worker.
19. `aggregating` plus 27 valid FINAL rows invokes Finalization safely.
20. Partial `aggregating` returns visible `manual_attention_required` and performs no lifecycle reset.
21. Automatic, recovery, and manual requests for a superseded `analysis_run_id` return `superseded_no_op` and reach no Worker, Aggregator, or Finalization.
22. After bounded reconciliation, the first mark may create a new run when only superseded history exists; the stable key still prevents remove/reassign replay after that first claim.

Verification must include offline workflow/SQL contract tests, workflow validation, read-back connection verification, isolated n8n runtime tests and a bounded end-to-end test. Production publication is a separate explicit step.

## 17. Rollout order

1. Add offline fixtures/tests for run resolution, retry budget and stale compare-and-set.
2. Resolve `DW-8` retry persistence correctness in the selected Worker package.
3. Add and document the intake event table and unfinished-run partial unique index migration, including duplicate-data preflight.
4. Convert Orchestrator to a typed new-run sub-workflow without changing its downstream contracts.
5. Build and test `TENDER — Intake / Resume` against non-production data.
6. Add Manual Resume and verify exhausted-run reopening.
7. Add Recovery Scan and verify one-hour execution-aware reclaim.
8. Add TenderPlan Mark Intake using a sanitized real notification payload.
9. Validate every workflow and read back connections after import/update.
10. Run isolated duplicate, concurrency, stale and retry-exhaustion scenarios.
11. Run one end-to-end marked tender canary.
12. Publish only after explicit production approval.

## 18. Out of scope

- automatic selective recovery of a partially executed Aggregator;
- silently resetting `aggregating` to `ready_for_aggregation`;
- changing any of the 27 field meanings or FINAL contracts;
- company-to-tender matching;
- reprocessing `completed` documents;
- automatic creation of a fresh run for a completed tender;
- changing TenderPlan labels or removing marks;
- production n8n, PostgreSQL or credential writes during design/planning;
- deleting execution history or unrelated analysis audit data.
