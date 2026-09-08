# Tender Intake migration and NO-WORKER canary — 2026-09-08

## Scope and safety boundary

The owner authorized the production migration and testing only in newly created
n8n workflows. Existing live workflows were not edited. Runtime canaries used
the two approved tender IDs and stopped before Document Worker. In the Intake
copy, `Dispatch Document Workers`, `Call Aggregator`, and `Call Finalization`
were disabled; the test Orchestrator contains no Execute Workflow node and ends
at `TEST STOP — Document Worker not invoked`.

## Migration evidence

| Execution | Result |
|---|---|
| `14686` | Exact committed migration body with terminal `COMMIT` replaced by `ROLLBACK`; state unchanged. |
| `14687` | Fresh preflight reproduced the exact approved `24 + 50 + 12` legacy groups. |
| `14688` | Real migration committed successfully. |
| `14689` | Basic schema/index postflight passed. |
| `14690` | Detailed postflight: `86/86` superseded, zero active duplicate groups, audit columns populated. |
| `14703` | Post-canary read-only verification reconfirmed migration and ledger invariants. |

The reconciled runs retain `273` documents, `577` analysis units, `756` facts,
and `29` field results. Run `18f3eaee-528d-4bc1-8d72-a1ea2f313df2`, which had
26 FINAL fields, is included in the 86 superseded rows. No child rows were
deleted.

## Isolated workflow inventory

| Workflow | ID | Runtime state |
|---|---|---|
| Intake error handler | `kff8KIrSHzo5Mmt1` | New copy; published only to allow error-workflow linking. |
| NO-WORKER Orchestrator | `thE9gLyNTvxLWt8I` | New test copy; inactive. |
| Intake Resume NO-WORKER | `VO8Ml0sfO65w2Jiz` | New candidate copy; inactive/unpublished. |
| TenderPlan Mark Intake | `biYC4OvWBlfJRmnj` | New candidate copy; inactive/unpublished. |
| Recovery Scan | `lwcHHdmmNd5YE6cw` | New candidate copy; inactive/unpublished. |
| Manual Resume | `z8nynFC12H9WOM9s` | New candidate copy; inactive/unpublished. |
| Intake ledger canary harness | `8KJth107XIhpDBAK` | New manual test copy; inactive/unpublished. |

The Mark Intake copy uses the existing TenderPlan Header Auth credential and the
stable event key `tenderplan:mark:<mark_id>:tender:<tender_id>`. No credential
values were copied into workflow text or repository files.

## Canary evidence

NO-WORKER Orchestrator execution `14691` created exactly one run per tender:

- `6a9edb435b7165804b33d53f` → `d29195fd-13af-49cc-a1a5-6c7a3f44a8cf`, 6 documents;
- `6a9edb415b7165804b3398bb` → `0729e84d-8d86-41bb-830d-276a185e9b2d`, 5 documents.

Repeat Orchestrator execution `14694` reused the same IDs and created no new run.
Intake harness execution `14697` created and completed the two ledger events;
subexecutions were `14698` and `14699`. Repeat execution `14700` returned
`duplicate_event` for both stable keys; subexecutions were `14701` and `14702`.

Postflight `14703` shows both ledger rows remain `completed`, `attempts=1`, with
the same run IDs. All 11 documents remain `pending`, `attempts=0`, and have no
owner execution. Searches across all 14 workflows whose name contains
`Обработать документ` found zero executions after `2026-09-08T17:29:40Z`.

The first Intake response reported `documents_dispatched=6/5`. In this isolated
topology that value is the calculated dispatch queue cardinality: the Worker
node was disabled and no Worker execution existed. Execution-tree evidence and
the all-Worker search are authoritative for the safety boundary.

## Remaining gates

- Bind the two execution-read HTTP nodes in the Intake candidate to the correct
  read-only n8n Header Auth credential and create the `N8N_TENDER_BASE_URL` n8n
  Variable before any stale-owner recovery test or activation.
- Run controlled automatic retry, one-hour stale reclaim, CAS race, n8n API
  outage, manual override, Aggregator, and Finalization scenarios.
- Review and explicitly authorize activation of the new Mark Intake and Recovery
  schedules. Existing production workflows remain unchanged.
