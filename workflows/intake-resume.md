# TENDER — Intake Resume

Inactive repository candidate for the typed, resumable tender dispatcher.

## Contract

`tenderplan_mark` and `recovery_scan` are automatic intents. Only `manual` with `manual_override=true` may reopen a failed run or dispatch documents after two total Worker claims. The dispatcher preserves the same `analysis_run_id`, never dispatches completed or skipped documents, and leaves attempt increments to the Worker atomic claim.

`superseded` is a separate terminal run state. Any direct automatic, recovery,
or manual request for that `analysis_run_id` returns explicit
`action=superseded_no_op`, dispatches no document, Aggregator, or Finalization,
and never reopens the run. TenderPlan resolution treats `completed` and
`superseded` as non-active; if history contains only `superseded`, the first new
mark event after rollout may call Orchestrator to create a new run.

`observed_at` is source time only. When the upstream relation adapter has no
confirmed event timestamp it passes no value, and the dispatcher persists null;
it never substitutes intake wall-clock time for a source event time.

Intake events are claimed in `tender_analysis_intake_events`. Duplicate completed events and fresh owned events exit as structured no-ops. A processing owner becomes eligible for inspection at an age of one hour or more; the recorded n8n execution must be observed before a compare-and-set reclaim.

Document recovery treats `new`, `running`, and `waiting` executions as owned. `success`, `error`, `canceled`, `crashed`, and confirmed HTTP 404 are reclaimable. A successful execution-read response is accepted only when its body `id` exactly matches the requested owner execution ID. Network, credential, malformed, mismatched-ID, or unavailable observations do not mutate document state. Unknown valid execution statuses fail closed.

The intake-event compare-and-set carries `processing_started_at` twice: the normal timestamp drives the one-hour decision, while `processing_started_at::text` is preserved as `processing_started_at_cas` for the exact PostgreSQL equality guard. This avoids losing stored microseconds through JavaScript Date serialization without weakening race protection.

The dispatcher uses PostgreSQL for the long-lived barrier. Worker readiness SQL is copied from the canonical Worker. Finalization is called only when the complete 27-field FINAL barrier is valid for `tender_fields_v1` / `tender_field_final_v1`.

## Runtime verification

Isolated no-Worker executions `14704`-`14742` verify same-run retry, the automatic
dispatch gate against seeded attempt counts 1 and 2, manual override, one-hour
stale reclaim, live-owner retention,
fail-closed Execution API outage behavior, guarded CAS race loss, scoped Recovery
Scan and exact-event Error Workflow retry. The global execution inventory for the
test window contains no Document Worker, Aggregator, Finalization or production
Orchestrator execution. Full evidence is recorded in
`evaluations/TENDER_INTAKE_MIGRATION_AND_NO_WORKER_CANARY_2026-09-08.md`.

## Packaging required

This export is intentionally inactive and is not production-ready by itself.

Before controlled import:

1. Bind both execution-read HTTP nodes to the real read-only Header Auth credential with `X-N8N-API-KEY`.
2. Confirm that both nodes target the intended self-hosted origin `https://n8nworkup.ru`; this non-secret origin is stored directly because Custom Variables are unavailable on the current self-hosted plan.
3. Import and publish `TENDER — Ошибка Intake Resume`, read back its real workflow ID, and set that actual value in `settings.errorWorkflow`.
4. Read back the imported dispatcher and validate node configuration before activation.

No API key, fake credential, or placeholder Error Workflow ID is stored in the repository export. The only instance-specific literal is the non-secret HTTPS origin.
