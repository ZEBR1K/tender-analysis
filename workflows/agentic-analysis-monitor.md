# TENDER — Агентский анализ — Монитор

Inactive Task 12 repository candidate. A one-minute Schedule Trigger claims at
most two `ready`, `running`, or `validating` jobs. The short PostgreSQL claim
transaction uses `FOR UPDATE SKIP LOCKED`, the current n8n execution ID as the
exact poll owner, and a five-minute stale-lease cutoff. It commits before the
first runner HTTP request, so no database transaction remains open while the
runner is polled. Claimed jobs are processed sequentially.

Runner `ready`, `running`, and `validating` responses may update only bounded
heartbeat, usage, validation-summary/artifact metadata and release the exact
lease. A typed runner failure marks the owned job failed, retains bounded audit
metadata, releases the lease, and never creates shadow fields or inferred
`not_found` values.

For `completed`, the workflow fetches `/result` and checks the closed validation
envelope: job, analysis run, pipeline, catalog, sealed manifest and artifact
hash identities plus exactly 27 fields. It does not inspect or reinterpret
field meaning. One PostgreSQL transaction locks the exact owned job, verifies
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
