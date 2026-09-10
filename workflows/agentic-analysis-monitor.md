# TENDER — Агентский анализ — Монитор

The Task 12 repository export remains identity-neutral and inactive by default.
The corrected schedule-based live workflow `CALcBEXvQsO1AcfP` is published for
the temporary Task 17 agent-only route. The earlier imported `47e6ede6c10349c0` is a pre-fix
inactive copy and must not be promoted. A one-minute Schedule Trigger claims at
most two `ready`, `running`, or `validating` jobs. The short PostgreSQL claim
transaction uses `FOR UPDATE SKIP LOCKED`, the current n8n execution ID as the
exact poll owner, and a five-minute stale-lease cutoff. It commits before the
first runner HTTP request, so no database transaction remains open while the
runner is polled. Claimed jobs are processed sequentially.

Runner JSON HTTP nodes use response auto-detection so n8n `2.35.3` resolves
`application/json` streams before identity checks. Guarded SQL casts UUID
values through text before aggregate selection because PostgreSQL has no
`max(uuid)`.

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

After that transaction succeeds, its first result set exposes only the exact
`analysis_run_id` and `agentic_job_id` handoff identifiers. The synchronous
`Завершить agentic analysis` node passes that item unchanged to the existing
Finalization workflow. Finalization owns canonical promotion, the 27/27
completion barrier and Report Generation; Monitor does not reinterpret field
meaning after the runner validation envelope has passed. Repeating the same
run/job pair is handled as an idempotent same-producer replay, while a different
producer or job fails closed. The repository export keeps the Finalization
resource locator unbound and binds it to live workflow `cSsh9yjpS7t5p0OO`
only during controlled deployment.

Completed jobs are excluded from later scheduled claims, making subsequent
schedules a byte-compatible no-op. The synchronous Finalization handoff is part
of the successful terminal Monitor execution; any promotion or report error
fails that execution and reaches the configured Agentic Error workflow instead
of being swallowed. The DB stores only bounded hashes, usage, summary and
artifact metadata. Full runner/Codex JSONL remains runner-side and is neither
fetched nor persisted by this workflow.

The export is inactive, identity-neutral and has empty `pinData`. Normalized
read-back confirms that the corrected inactive candidate matches the repository
nodes and connections and has the exact PostgreSQL/runner credentials bound.
An archived one-shot clone executed the same corrected graph as execution
`15258`, validated the runner envelope and atomically committed exactly 27
shadow rows for job `79149bb3-0028-413a-bbb9-813de64b6052`. The schedule-based
live workflow is now published and linked to ownership-guarded Agentic Error
workflow `6ccedae778a14176`. Real terminal execution `15387` accepted job
`13b090b5-38fc-432a-a235-90ae43f609fe`, verified 27 unique fields with zero job
issues and atomically committed exact 27 shadow rows. Both source artifacts were
reported as inspected and every evidence entry referenced the manifest with a
nonblank locator. TenderPlan Mark Intake was published after this gate passed.
