# TENDER — Агентский анализ — Запуск

The Task 11 repository export remains an inactive, identity-neutral candidate.
Its imported live n8n copy is also inactive and has workflow ID
`d37251e524754e1f`. It accepts the typed
`analysis_run_id`, `pipeline_version=tender_agentic_pipeline_v1`, and positive
`replicate_index` contract.

The first PostgreSQL operation serializes and claims the logical job identity
with the exact dispatch execution ID, creates or loads its shadow job, verifies
the registered manifest and source-identity barrier, and inserts all processable
document ownership rows before any runner side effect. Existing
`running`, `validating`, `completed`, and `canceled` jobs are structured no-ops.
A failed job is eligible only when the synchronized runner audit says the
failure is retryable, the runner attempt is below two, and its code is one of
`RUNNER_ORPHANED_EXECUTION`, `CODEX_PROCESS_FAILED`,
`CODEX_TRANSPORT_ERROR`, or `CODEX_TIMEOUT`. Contract failures cannot retry.

Documents are processed by `Loop Over Items` with batch size 1. The source HTTP
node returns the file in n8n binary property `data`; the next HTTP node streams
that binary property to the authenticated internal runner. No Code node reads,
copies, serializes, or logs document bytes. The repository export contains only
the runner Header Auth import placeholder and no token. In the live inactive
copy the expected credential types are bound; no credential value or bound ID
is recorded in the repository documentation.

After every upload response matches the owned artifact/hash, PostgreSQL marks
that document staged. An exact DB barrier requires the expected total, all
staged, no incomplete state, and unique document indexes and artifact keys.
The job remains `staging` and dispatch-owned through that barrier and runner
`/seal`; only the verified seal moves it to `ready`. Monitor therefore cannot
claim a pre-start job. A verified `/start` response guardedly moves the exact
owned job from `ready` to `running` and synchronizes the runner attempt. If the
start response is lost or cannot be identified, the workflow records bounded
`START_OUTCOME_UNKNOWN`, releases dispatch ownership, and leaves the job
`ready` so Monitor can reconcile the idempotent runner job without issuing a
second paid start. Every guarded update emits an explicit updated/no-op or
ownership-lost result; a zero-row CAS cannot silently end the branch. Other
errors are reduced to bounded typed code/message fields; source URLs and binary
content are never persisted in the error record.

The export is identity-neutral, inactive, and has empty `pinData`. The pinned
shadow-v0 catalog hash is repository-known and included in the closed manifest.
Read-only live reconciliation confirmed that the imported inactive graph,
after masking the instance workflow ID and bound credential IDs, matches the
repository candidate. Its PostgreSQL and runner Header Auth credential types
are bound, and `settings.errorWorkflow` points to the live agentic Error
Workflow `6ccedae778a14176`. The n8n execution-list endpoint returned zero
executions for this workflow.

The live canary remains blocked because
`tender_analysis_documents.ingestion_metadata` is absent and Dispatch therefore
cannot obtain the required source `content_sha256`. The workflow has not been
activated, Task 11 does not wire Orchestrator/Intake, and legacy production
routing is unchanged.
