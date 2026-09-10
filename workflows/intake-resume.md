# TENDER — Intake Resume

Repository export for the typed, resumable tender dispatcher. Live workflow
`VO8Ml0sfO65w2Jiz` is published in temporary Task 17 agent-only mode.

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

After document-owner recovery, an existing run may enter the additive agentic shadow path only when its lifecycle is `processing`, `ready_for_aggregation`, or `aggregating`, the registered document set exactly matches authoritative `documents_total`, every processable PDF/DOCX/XLSX/XLS has full byte identity, at least one processable document exists, and no document is `failed`. `failed`, `completed`, `superseded`, incomplete, or zero-processable runs skip Dispatch. The synchronous `mode=all` call uses the identity-neutral contract `TENDER — Агентский анализ — Запуск` with the same `analysis_run_id`, `pipeline_version=tender_agentic_pipeline_v1`, and `replicate_index=1`; the child owns idempotent new-job/recoverable-retry/no-op resolution.

The new-run route path does not call Dispatch again: `created_new_run=true` from
Orchestrator goes directly to intake-event completion because Orchestrator
already passed the shadow barrier. Existing eligible runs go through Dispatch
and then directly to intake-event completion. Legacy document decision, Worker,
Aggregator and Finalization nodes remain in the export but are unreachable from
both routes. The deliberate disconnection is marked
`TASK17_TEMPORARY_AGENT_ONLY`.

An acknowledged child launch is completed with top-level
`action=agentic_dispatched`; an acknowledged idempotent child no-op uses
`action=agentic_no_op`. The original Dispatch action remains nested in
`agentic_shadow.action` for audit. This prevents a successful agentic handoff
from being mislabeled `manual_attention_required`.

## Runtime verification

Isolated no-Worker executions `14704`-`14742` verify same-run retry, the automatic
dispatch gate against seeded attempt counts 1 and 2, manual override, one-hour
stale reclaim, live-owner retention,
fail-closed Execution API outage behavior, guarded CAS race loss, scoped Recovery
Scan and exact-event Error Workflow retry. The global execution inventory for the
test window contains no Document Worker, Aggregator, Finalization or production
Orchestrator execution. Full evidence is recorded in
`evaluations/TENDER_INTAKE_MIGRATION_AND_NO_WORKER_CANARY_2026-09-08.md`.

Task 17 execution `15296` exercised the live agent-only route for existing run
`a5e765d7-52a3-42d9-833a-7ab52ec07d10`. It returned
`manual_attention_required / manifest_incomplete`, created no agentic job and
did not invoke legacy Worker or Aggregator. This is fail-closed routing evidence;
the run predates byte-identity preparation and is not a completed Codex canary.

The terminal real-Codex canary used fresh run
`b731f861-4df6-40df-a8c5-67b8564f3f03`. Controlled Intake execution `15372`
dispatched replicate 2 through execution `15373`; the temporary replicate input
was then restored to normal `replicate_index=1`. Job
`13b090b5-38fc-432a-a235-90ae43f609fe` completed on attempt 1, Monitor `15387`
committed exact 27 shadow rows, and no legacy Worker/Aggregator/Finalization node
ran.

## Packaging required

The repository export remains identity-neutral. The live copy and TenderPlan
Mark Intake are published after the real Codex canary closed the Task 17 gate.
Post-review Intake version is `51f567d2-4100-4d81-9a17-29b7df7eeb6c`.

Before controlled import:

1. Bind both execution-read HTTP nodes to the real read-only Header Auth credential with `X-N8N-API-KEY`.
2. Confirm that both nodes target the intended self-hosted origin `https://n8nworkup.ru`; this non-secret origin is stored directly because Custom Variables are unavailable on the current self-hosted plan.
3. Import and publish `TENDER — Ошибка Intake Resume`, read back its real workflow ID, and set that actual value in `settings.errorWorkflow`.
4. Import `TENDER — Агентский анализ — Запуск`, read back its real workflow ID, and replace `AGENTIC_DISPATCH_WORKFLOW_ID`; the repository export intentionally remains identity-neutral.
5. Read back the imported dispatcher and validate node configuration before activation.

No API key, fake credential, or real Dispatch/Error Workflow ID is stored in the repository export. The only instance-specific literal is the non-secret HTTPS origin.
