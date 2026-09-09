# TENDER — Агентский анализ — Монитор

Inactive Task 12 repository candidate. A one-minute Schedule Trigger claims at
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

For `completed`, the workflow fetches `/result` and checks the closed validation
envelope: job, analysis run, pipeline, catalog, sealed manifest and artifact
hash identities plus exactly 27 fields. It does not inspect or reinterpret
field meaning. A successfully fetched but contract-invalid completed result has
a distinct terminal `RESULT_CONTRACT_INVALID` policy and creates no field rows.
One PostgreSQL transaction locks the exact owned job, verifies
the exact ordered catalog, UPSERTs the 27 agent-reported shadow rows, rechecks
the persisted count/catalog set, and only then marks the job completed and
releases the lease. Any exception rolls back the complete transaction.

Completed jobs are excluded from claims, making subsequent schedules a
byte-compatible no-op. The DB stores only bounded hashes, usage, summary and
artifact metadata. Full runner/Codex JSONL remains runner-side and is neither
fetched nor persisted by this workflow.

The export is inactive, identity-neutral and has empty `pinData`. Packaging must
bind the PostgreSQL credential, runner Header Auth credential and real agentic
Error Workflow ID, then validate and read back the inactive import. Task 12 does
not wire or activate production routing.
