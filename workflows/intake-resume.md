# TENDER — Intake Resume

Inactive repository candidate for the typed, resumable tender dispatcher.

## Contract

`tenderplan_mark` and `recovery_scan` are automatic intents. Only `manual` with `manual_override=true` may reopen a failed run or dispatch documents after two total Worker claims. The dispatcher preserves the same `analysis_run_id`, never dispatches completed or skipped documents, and leaves attempt increments to the Worker atomic claim.

`observed_at` is source time only. When the upstream relation adapter has no
confirmed event timestamp it passes no value, and the dispatcher persists null;
it never substitutes intake wall-clock time for a source event time.

Intake events are claimed in `tender_analysis_intake_events`. Duplicate completed events and fresh owned events exit as structured no-ops. A processing owner becomes eligible for inspection at an age of one hour or more; the recorded n8n execution must be observed before a compare-and-set reclaim.

Document recovery treats `new`, `running`, and `waiting` executions as owned. `success`, `error`, `canceled`, `crashed`, and confirmed HTTP 404 are reclaimable. Network, credential, malformed, or unavailable observations do not mutate document state. Unknown valid execution statuses fail closed.

The dispatcher uses PostgreSQL for the long-lived barrier. Worker readiness SQL is copied from the canonical Worker. Finalization is called only when the complete 27-field FINAL barrier is valid for `tender_fields_v1` / `tender_field_final_v1`.

## Packaging required

This export is intentionally inactive and is not production-ready by itself.

Before controlled import:

1. Bind both execution-read HTTP nodes to the real read-only Header Auth credential with `X-N8N-API-KEY`.
2. Create the n8n Variable `N8N_TENDER_BASE_URL`.
3. Import and publish `TENDER — Ошибка Intake Resume`, read back its real workflow ID, and set that actual value in `settings.errorWorkflow`.
4. Read back the imported dispatcher and validate node configuration before activation.

No API key, production host, fake credential, or placeholder Error Workflow ID is stored in the repository export.
