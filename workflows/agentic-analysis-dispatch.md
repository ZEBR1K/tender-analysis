# TENDER — Агентский анализ — Запуск

Inactive repository candidate for Task 11. It accepts the typed
`analysis_run_id`, `pipeline_version=tender_agentic_pipeline_v1`, and positive
`replicate_index` contract.

The first PostgreSQL operation serializes and claims the logical job identity
with the exact dispatch execution ID, creates or loads its shadow job, verifies
the registered manifest and source-identity barrier, and inserts all processable
document ownership rows before any runner side effect. Existing
`running`, `validating`, `completed`, and `canceled` jobs are structured no-ops.
A failed job is eligible only for the migration's bounded second attempt and
only for the explicitly recoverable process/transport error codes.

Documents are processed by `Loop Over Items` with batch size 1. The source HTTP
node returns the file in n8n binary property `data`; the next HTTP node streams
that binary property to the authenticated internal runner. No Code node reads,
copies, serializes, or logs document bytes. The runner credential is an import
placeholder (`RUNNER_HEADER_AUTH_CREDENTIAL_ID`); the export contains no token.

After every upload response matches the owned artifact/hash, PostgreSQL marks
that document staged. An exact DB barrier requires the expected total, all
staged, no incomplete state, and unique document indexes and artifact keys.
Only then does the workflow call runner `/seal`, verify catalog/manifest/job
identity, call `/start`, and guardedly mark the DB job `running` with the n8n
dispatch execution ID. Errors are reduced to bounded typed code/message fields;
source URLs and binary content are never persisted in the error record.

The export is identity-neutral, inactive, and has empty `pinData`. The pinned
shadow-v0 catalog hash is repository-known and included in the closed manifest.
Packaging must replace the PostgreSQL credential ID, runner Header Auth
credential ID, and Error Workflow ID, then read back the imported
inactive graph before any canary. Task 11 does not wire Orchestrator/Intake and
does not change production state.
