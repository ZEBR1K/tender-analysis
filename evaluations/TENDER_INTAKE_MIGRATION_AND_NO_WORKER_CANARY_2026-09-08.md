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
| Runtime matrix harness | `GPw5DfK3lZGnhLRH` | New manual test copy; left read-only/non-mutating. |
| Waiting owner | `Y986NKoQ2fk7FXIS` | New bounded Wait test; inactive after completion. |
| Error canary | `zDZHdQ6ta0XIRJ9W` | New webhook failure test; unpublished immediately after one call. |

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

## Intake/resume runtime matrix

| Executions | Result |
|---|---|
| `14704` | Read-only execution credential and explicit origin returned HTTP 200 for execution `14703`. |
| `14705/14706` | First stale-event test exposed timestamp precision loss; exact CAS correctly updated zero rows. |
| `14707/14708` | Post-fix event reclaim used `processing_started_at::text`, preserved the same run, incremented attempts to 2 and queued 6 documents. |
| `14709/14710` | Manual Resume reused the same run and queued all 6 eligible documents. |
| `14711`-`14716` | Automatic retry included failed attempt 1, excluded failed attempt 2, and manual override included failed attempt 2. |
| `14717/14718` | Cleanup and read-only verification restored the attempt-cap fixture state. |
| `14719/14720` | One-hour stale document with terminal owner execution `14703` was reclaimed via guarded CAS and moved to failed/attempt 1. |
| `14721` | Cleanup restored the terminal-owner document to pending/attempt 0. |
| `14722`, `14726/14727` | A genuinely waiting execution retained ownership; the stale-looking document was not reclaimed. |
| `14728` | Cleanup restored the live-owner document to pending/attempt 0. |
| `14729/14730` | Intentional Execution API connection refusal classified the owner as unavailable and failed closed without state mutation. |
| `14731` | Cleanup restored the API-outage fixture. |
| `14732` | First race probe preserved the competing owner; its aggregate metric was invalid because `count(*)` counted the LEFT JOIN row. |
| `14733` | Cleanup after the diagnostic-only race probe. |
| `14734` | Corrected CAS-race measurement returned `cas_rows=0` and preserved the competing owner. |
| `14735` | Cleanup restored the CAS-race fixture. |
| `14736/14737` | Temporarily scoped Recovery Scan selected one approved run; Intake reused the same run and queued its 6 documents. The broad query was restored immediately. |
| `14738/14739` | A one-shot production webhook failure invoked the linked Error Workflow, which marked the exact event failed while preserving event key and run ID. |
| `14740/14741` | Retry of the same failed event reused the same event ID and run ID, incremented attempts from 1 to 2, and completed. |
| `14742` | Read-only verifier: event completed/attempts 2; 6 documents pending, zero processing and zero failed. |
| `14743` | First full Mark Intake draft canary reached the normalizer and failed closed because live TenderPlan used internal `_id` while the candidate expected `id`; Intake and all downstream workflows were not called. |
| `14744/14745` | Corrected Mark Intake poll succeeded, dispatched one asynchronous Intake call, and returned `duplicate_event` with the existing run `d29195fd-13af-49cc-a1a5-6c7a3f44a8cf`. |

Harness attempt `14723/14724` failed before Intake state mutation because the
test supplied PostgreSQL `now()::text` instead of an ISO timestamp. Error
Workflow execution `14725` therefore had no owned ledger row to update. The
harness input was corrected and the intended live-owner assertion passed in
`14726/14727`; this was a test-fixture defect, not an Intake defect.

The isolated Intake candidate was restored after every temporary test mutation:
it is inactive/unpublished, both execution-read URLs point to
`https://n8nworkup.ru`, and Worker, Aggregator and Finalization call nodes remain
disabled. Recovery Scan was restored to its original broad selection SQL and is
inactive. The one-shot Error canary was unpublished immediately after execution.

Post-review fail-closed hardening requires every HTTP 200 execution-read body ID
to equal the requested owner ID before its status is trusted. The two classifier
changes were applied only to inactive candidate `VO8Ml0sfO65w2Jiz`. Exact
read-back of draft version `3b46d3ac-bdc6-4e73-9201-37e3f4fae15e` confirmed both
guards, `active=false`, `activeVersionId=null`, and all Worker/Aggregator/
Finalization call nodes still disabled. The mismatched-ID scenario is verified
offline and was not represented as a new runtime execution.

A global execution search covering `14722`-`14742` found only the isolated Wait,
harness, Intake, Error, Recovery and one-shot canary workflows. It found no
Document Worker, Aggregator, Finalization or production Orchestrator execution.

The current-state Mark Intake canary provided an additional bounded execution
window. Execution `14743` established the real response identity contract:
`tender._id` / `tenders[]._id` is the internal 24-character ID used by FullInfo,
whereas `tender.id` may be an external procurement number with a type suffix.
After the minimal `_id` correction, parent `14744` and child `14745` were the
only executions in the window. The child took the stable-key duplicate/no-op
path and preserved the existing `analysis_run_id`; no Orchestrator, Document
Worker, Aggregator or Finalization execution existed.

Final offline verification is GREEN: the six-file
`tender-intake-resume/error/migration + tenderplan-mark-intake + manual-resume + recovery-scan`
suite passes `35/35`; the broader seven-file intake suite including Orchestrator
passes `42/42`; and the complete repository suite passes `526/526`. The
classifier contract also rejects an HTTP 200 response whose body execution ID
does not exactly match the requested owner ID; this is offline fail-closed
coverage, not an additional live runtime canary.

## Remaining gates

- Aggregator and Finalization runtime was intentionally not exercised because
  the owner-approved safety boundary stops before Document Worker.
- Review and explicitly authorize controlled promotion/activation of the new
  workflow family. Existing production workflows remain unchanged.
