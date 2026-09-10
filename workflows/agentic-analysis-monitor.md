# TENDER — Агентский анализ — Монитор

The Task 12 repository export remains an inactive, identity-neutral candidate.
Its imported live n8n copy is also inactive and has workflow ID
`47e6ede6c10349c0`. A one-minute Schedule Trigger claims at
most two `ready`, `running`, or `validating` jobs. The short PostgreSQL claim
transaction uses `FOR UPDATE SKIP LOCKED`, the current n8n execution ID as the
exact poll owner, and a five-minute stale-lease cutoff. It commits before the
first runner HTTP request, so no database transaction remains open while the
runner is polled. Claimed jobs are processed sequentially.

Dispatch-owned jobs are excluded from the claim. Runner `ready`, `running`, and
`validating` responses may update only allow-listed, size-bounded heartbeat,
usage and technical artifact metadata and release the exact lease. HTTP/network
poll errors, status identity errors, and result-fetch errors record bounded
monitor audit and release only that lease without changing job status. Only an
explicit identity-valid runner `failed` response terminally fails the owned job
and synchronizes its attempt/retryability audit. No failure path creates shadow
fields or inferred `not_found` values. Every guarded update returns an explicit
updated or ownership-lost outcome.

If an identity-valid poll still reports runner `ready` for a DB job marked
`START_OUTCOME_UNKNOWN`, the exact poll owner calls the runner's idempotent
`/start` once in that poll. An identity-valid `running` acknowledgement with
attempt 1–2 is synchronized by an exact `ready`/error/lease CAS; an ambiguous
reconciliation request releases the lease and a later poll safely observes or
retries the idempotent runner operation without duplicating a child process.

For `completed`, the workflow fetches `/result` and checks the closed validation
envelope: job, analysis run, pipeline, catalog, sealed manifest and artifact
hash identities plus exactly 27 fields. It does not inspect or reinterpret
field meaning. A successfully fetched but contract-invalid completed result has
a distinct terminal `RESULT_CONTRACT_INVALID` policy and creates no field rows.
All untrusted envelope collections and entries are type-checked before access,
so malformed successful HTTP responses cannot throw and strand the poll lease.
One PostgreSQL transaction locks the exact owned job, verifies
the exact ordered catalog, UPSERTs the 27 agent-reported shadow rows, rechecks
the persisted count/catalog set, and only then marks the job completed and
releases the lease. Any exception rolls back the complete transaction.

Completed jobs are excluded from claims, making subsequent schedules a
byte-compatible no-op. The DB stores only bounded hashes, usage, summary and
artifact metadata. Full runner/Codex JSONL remains runner-side and is neither
fetched nor persisted by this workflow.

The export is inactive, identity-neutral and has empty `pinData`. Read-only live
reconciliation confirmed that the imported inactive graph, after masking the
instance workflow ID and bound credential IDs, matches the repository candidate.
Its PostgreSQL and runner Header Auth credential types are bound, and
`settings.errorWorkflow` points to the live agentic Error Workflow
`6ccedae778a14176`. The n8n execution-list endpoint returned zero executions for
this workflow.

The required Dispatch source-hash prerequisite is still absent, so no
Dispatch → Monitor → exact 27-row live canary has run. The Monitor schedule has
not been activated, Task 12 does not wire production routing, and the legacy
pipeline is unchanged.
