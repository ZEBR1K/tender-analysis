# TenderPlan mark intake and resumable analysis design

**Date:** 2026-09-07

**Status:** approved for implementation planning

**Scope:** automatically detect a TenderPlan procurement mark, start one analysis for a new procurement, and resume the same `analysis_run_id` after document-processing failures without reprocessing completed documents.

## 1. Goal

An employee marks a procurement in TenderPlan. The system must detect that event and route it to the tender-analysis pipeline.

The same entry path must support:

- first-time analysis of a procurement;
- a repeated mark on an unfinished procurement;
- a direct manual resume by `analysis_run_id`;
- periodic recovery of failed or stale document processing;
- idempotent handling of duplicate TenderPlan notifications.

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
7. A repeated mark or manual resume reuses the existing unfinished `analysis_run_id`.
8. A repeated mark on a completed procurement is a no-op. Starting a fresh historical reanalysis requires a separate explicit action.

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
    → read TenderPlan notifications
    → retain mark-added events
    → persist/deduplicate event
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

The inspected TenderPlan Swagger exposes notification retrieval and identifies notification type `5` as a tender marked with a label. It does not document a push webhook for this event. The production adapter is therefore a scheduled poller; it behaves as an event source for the dispatcher.

Polling requirements:

- interval: 10 minutes;
- read every available page required to cover the poll window;
- use an overlap window so a transient poll failure does not lose events;
- filter only notification type `5`;
- require a non-empty TenderPlan `tender_id` before dispatch;
- retry transient TenderPlan network errors at the node level;
- use a workflow-level Error Workflow;
- store TenderPlan authentication only in n8n Credentials;
- never advance event processing state when pagination or persistence fails.

Exact TenderPlan request and response field names must be taken from the live Swagger and a sanitized runtime sample during implementation. The integration must not guess notification IDs, pagination parameters or nested `tender_id` paths.

If TenderPlan later provides a supported webhook, only this adapter changes. The dispatcher contract remains unchanged.

## 6. Persistent intake event ledger

Add a PostgreSQL table dedicated to notification idempotency and intake audit:

```text
tender_analysis_intake_events
```

Required logical fields:

| Field | Purpose |
|---|---|
| `id` | Internal UUID primary key |
| `source` | `tenderplan` |
| `event_key` | Stable unique notification key |
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

`event_key` must be unique per source. Prefer the stable notification identifier supplied by TenderPlan. If the runtime payload has no stable notification ID, derive a deterministic key from the normalized event type, `tender_id`, source timestamp and other immutable notification coordinates confirmed by the runtime payload. Manual and recovery invocations use synthetic keys containing their n8n execution ID and selected `analysis_run_id`.

An existing ledger row is terminally duplicate only when `status='completed'` and `processed_at` is set. Insert/retry uses an atomic event claim that records `n8n_execution_id`, increments `attempts` and sets `processing_started_at`. A fresh `processing` owner cannot be replaced. A `failed` event or a stale `processing` event whose recorded execution is confirmed terminal may be reclaimed. This prevents concurrent dispatch of the same event while allowing recovery after a transient downstream failure.

The event ledger is not the source of truth for analysis completion. `tender_analysis_runs` and its child tables remain the source of truth. The ledger answers only whether an external event was seen and what action it caused.

Expected `action` values:

```text
created_new_run
resumed_existing_run
already_active
already_completed
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
- `recovery_scan` requires `analysis_run_id` and never enables `manual_override`;
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

For `tenderplan_mark`, the dispatcher resolves by `(source='tenderplan', tender_id)`. PostgreSQL enforces at most one unfinished run with a partial unique index on `(source, tender_id)` for statuses other than `completed`.

Resolution policy:

| Existing state | Action |
|---|---|
| No run exists | Call the new-run Orchestrator path |
| Exactly one unfinished run exists | Reuse its `analysis_run_id` |
| One or more completed runs and no unfinished run | Return `already_completed` |
| More than one unfinished run | Fail closed with `conflict_multiple_runs` and alert |

Unfinished includes:

```text
created
processing
ready_for_aggregation
aggregating
failed
```

Before creating the index, migration preflight must fail if existing data contains more than one unfinished run for the same `(source, tender_id)`; it must not choose or delete a run automatically.

The new-run SQL uses conflict-aware insert against that partial uniqueness boundary and returns whether it inserted a run or lost the conflict. Creation of the run and registration of its complete document set must occur in the same PostgreSQL statement/transaction after TenderPlan FullInfo has been normalized. A failure cannot commit an empty `created` run between those two operations. When the insert loses a concurrent conflict, the caller performs a fresh `SELECT` to load the now-visible unfinished run. Therefore two distinct mark events may both reach the create boundary, but only one can create the run and register documents; the other reuses the returned unfinished `analysis_run_id` and must not register documents again.

For `manual` and `recovery_scan`, `analysis_run_id` is authoritative. The dispatcher validates that the run exists and reads `tender_id` from PostgreSQL; it does not accept conflicting tender identity from the caller.

## 9. Document resume policy

The dispatcher evaluates every document in the selected run:

| Document state | Automatic `recovery_scan` | Mark/manual resume |
|---|---|---|
| `completed` | Skip | Skip |
| `pending`, `attempts < 2` | Dispatch | Dispatch |
| `failed`, `attempts < 2` | Dispatch | Dispatch |
| `pending` or `failed`, `attempts >= 2` | Exhausted; do not dispatch | Dispatch only with manual intent |
| `processing`, age < 1 hour | Active; do not dispatch | Active; do not dispatch |
| `processing`, age >= 1 hour | Verify n8n execution, then conditionally reclaim | Same verification; no blind reclaim |
| `skipped` | Preserve; do not reinterpret | Preserve; do not reinterpret |

`attempts` is incremented by the existing Worker atomic claim. Therefore:

```text
attempts = 0 → initial claim → attempts = 1
attempts = 1 → one automatic retry → attempts = 2
attempts >= 2 → no further automatic Worker call
```

Manual resume is an operator action and may call the Worker when `attempts >= 2`. The Worker increments the counter normally. The counter is never reset or decremented.

A unique repeated TenderPlan mark is treated as manual employee intent for an existing failed run. It may reopen that same run after automatic exhaustion. A duplicate delivery of the same notification cannot do so because the event ledger rejects its `event_key`.

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

A mark/manual resume of a `failed` run performs an atomic reopen:

```text
failed
→ processing
```

It then dispatches only non-completed documents authorized by manual intent. Existing `completed` documents, units and facts are untouched.

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

1. One procurement may have historical completed runs, but PostgreSQL enforces at most one unfinished run per `(source, tender_id)`.
2. One unique TenderPlan notification causes at most one dispatcher action.
3. One Document Worker execution processes exactly one document.
4. Worker atomic claim remains the final protection against duplicate dispatch.
5. `completed` documents are never reverted by intake/recovery workflows.
6. Stale recovery uses execution verification plus compare-and-set.
7. Automatic Worker claims stop at `attempts = 2`.
8. Manual claims preserve and increment `attempts`.
9. PostgreSQL remains the synchronization layer; no Merge or `$input.all()` barrier coordinates independent Workers.
10. All documents remain registered before the first Worker of a new run starts.
11. The existing 27/27 FINAL barrier and field semantics are unchanged.

## 16. Verification scenarios

The design is accepted only when implementation proves at least these cases:

1. First mark for an unknown `tender_id` creates exactly one run and registers all documents once.
2. Duplicate delivery of the same notification creates no run and no Worker execution.
3. Two concurrent distinct mark events for one new tender still create one unfinished run, and the losing conflict-aware insert does not register documents.
4. Repeated mark on a run with two completed and one failed document dispatches only the failed document with the same `analysis_run_id`.
5. `failed`, `attempts=1` is automatically claimed once and becomes `attempts=2`.
6. `failed`, `attempts=2` is not automatically dispatched.
7. Manual resume of `failed`, `attempts=2` uses the same run and increments to `attempts=3`.
8. `processing` for 59 minutes is not inspected/reclaimed.
9. `processing` older than one hour with a running/waiting execution remains untouched.
10. `processing` older than one hour with a terminal execution becomes `failed` only through the guarded update.
11. n8n API failure leaves document state unchanged and produces a visible error/alert.
12. A concurrent newer claim makes the stale compare-and-set affect zero rows, and the guard reports a benign race rather than overwriting it.
13. Attempt-one three units followed by attempt-two two units passes the retry-safe persistence/completion regression.
14. Exhausted failed document plus no remaining active documents moves the run to `failed`.
15. A repeated mark or direct manual resume reopens that same failed run.
16. Repeated mark on a completed tender returns `already_completed` and creates no new run.
17. All documents completed under a processing run cause the existing readiness claim and one Aggregator start.
18. `ready_for_aggregation` resumes Aggregator without running any Worker.
19. `aggregating` plus 27 valid FINAL rows invokes Finalization safely.
20. Partial `aggregating` returns visible `manual_attention_required` and performs no lifecycle reset.

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
