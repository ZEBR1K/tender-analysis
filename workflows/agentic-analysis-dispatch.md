# TENDER — Агентский анализ — Запуск

Inactive repository candidate for Task 11. It accepts the typed
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
copies, serializes, or logs document bytes. The runner credential is an import
placeholder (`RUNNER_HEADER_AUTH_CREDENTIAL_ID`); the export contains no token.

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
Packaging must replace the PostgreSQL credential ID, runner Header Auth
credential ID, and Error Workflow ID, then read back the imported
inactive graph before any canary. Task 11 does not wire Orchestrator/Intake and
does not change production state.
