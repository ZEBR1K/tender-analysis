# Tender Intake full DB deployment preflight — execution 14684

**Date:** 2026-09-08
**Verdict:** migration `NO-GO`
**Evidence scope:** one authorized inactive/unpublished read-only n8n probe execution

## Objective

Obtain a current aggregate-only PostgreSQL preflight before considering
`migrations/2026-09-07_tender_intake_resume.sql`.

The probe was required to return no tender identifiers or client rows. It checked
only connection safety, run counts, duplicate unfinished groups and migration
catalog objects.

## Probe

```text
Workflow ID: fbjRXqyQ71toBhZK
Name: [CODEX TEST] Tender Intake Full DB Preflight — 2026-09-08
Draft version: daccb6f4-98af-4860-974b-c0e18470f08a
Nodes: 3
Graph: Manual Trigger → one PostgreSQL WITH…SELECT → fail-closed sanitized Code
active: false
activeVersionId: null
availableInMCP: true
prohibited nodes: 0
```

The PostgreSQL credential reference was copied from existing inactive workflow
`3TyiqT31AaNdRPQX` without reading or exposing secret values. The workflow was
created once, retained unchanged and not published or activated.

## Execution

```text
Execution ID: 14684
Mode: manual
Status: error
Started: 2026-09-08T09:35:03.319Z
Stopped: 2026-09-08T09:35:04.473Z
retryOf: null
retrySuccessId: null
Executions authorized/performed: 1/1
```

No retry was attempted. The aggregate PostgreSQL `SELECT` completed, then the
sanitizer intentionally failed closed because connection and migration
preconditions were unsafe.

## Sanitized results

```text
current_user: postgres
transaction_read_only: off
connection_uses_ssl: false
total_run_count: 97
unfinished_run_count: 86
duplicate_unfinished_group_count: 3
intake_events_table_exists: false
unfinished_run_unique_index_exists: false
intake_run_index_exists: false
intake_status_started_index_exists: false
```

No grouped `source`/`tender_id` rows, credentials, connection strings or client
payloads were retrieved or recorded.

## Blocking findings

1. The credential used by the historical preflight workflow connects as
   `postgres`, not the required read-only role `tender_codex_ro`.
2. The transaction is not read-only.
3. The connection does not use SSL.
4. Three `(source, tender_id)` groups contain more than one unfinished run.
5. The intake ledger and all three migration indexes are absent.

Runtime evidence is authoritative for this connection. It contradicts the
intended read-only/TLS diagnostic boundary, so this credential must not be used
for further DB diagnostics or migration work.

## Decision

```text
Apply migration:              NO-GO
Import inactive intake stack: NO-GO pending packaging/target fixes
Production activation:        NO-GO
```

The migration must not be applied while duplicate unfinished groups exist. No
run may be selected, updated or deleted automatically.

## Required next gate

1. Provision or expose the approved `tender_codex_ro` connection with CA-verified
   TLS and confirm `transaction_read_only=on`.
2. Run an aggregate read-only preflight through that connection.
3. If duplicate groups remain, perform separately authorized read-only forensic
   review of those groups and define an owner-approved reconciliation policy.
4. Re-run the duplicate precondition and require exactly `0` groups.
5. Only then review a separately authorized migration application window.

No PostgreSQL data/schema, existing workflow, credential, variable, production
workflow or repository file was changed by execution `14684`. The only n8n
mutation was creation of the explicitly authorized inactive probe; it remains as
audit evidence.
