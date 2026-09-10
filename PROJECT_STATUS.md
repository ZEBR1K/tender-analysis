# PROJECT STATUS — Tender Analysis

**Snapshot date:** 2026-09-10
**Status:** Active development / test hardening before client report
**Branch at snapshot:** `codex/agentic-analysis-integration`

## Agentic shadow foundation Tasks 0–16 — GREEN; Task 17 not started

The additive Codex runner foundation is implemented through Task 10 without
changing live n8n or production PostgreSQL. It preserves the complete legacy
pipeline while adding isolated shadow tables/migration, source-only manifest
staging, a focused agent skill, audited non-interactive execution,
contract/source-identity validation, and an asynchronous restart-safe runner
lifecycle. Tasks 11–12 add identity-neutral Dispatch and Monitor
exports with exact DB ownership, source staging, runner polling, and atomic
27-row shadow persistence. Task 13 adds an inactive, identity-neutral Error
Workflow candidate: Dispatch crashes can fail only their exact pre-start owner;
Monitor crashes only release their exact poll lease and append bounded technical
audit without failing a running job. Task 14 now wires the inactive,
identity-neutral Dispatch candidate additively into the repository Orchestrator
new-run path and Intake Resume existing-run recovery path. The complete manifest
is registered first; legacy Worker fan-out and downstream FINAL routing remain
unchanged.

Runtime validation is intentionally restricted to security, file/artifact
integrity, and the closed JSON contract. Page/OOXML/XLSX indexing, quote
verification, evidence sufficiency, semantic status rewriting, field-specific
rules, and PRICE/VAT/NEGATIVE/CONFLICT-style business checks are absent. The
complete removal/retention inventory and open gates are recorded in
`evaluations/AGENTIC_TASKS_0_10_HANDOFF_2026-09-09.md`.

The archive-aware prerequisite and Task 14 wiring passed RED→GREEN graph,
contract and Code-node compilation tests plus independent final-bytes review.
Direct PDF/DOCX/XLSX documents are downloaded sequentially only to establish
MIME, byte size and SHA-256; no page, OOXML or semantic parser was added.
Archive/container and unsupported rows remain in the manifest for audit, while
only pending supported documents reach the legacy Worker.

Task 15 now has a fail-closed offline multi-procurement batch harness for
`procurement-02` and `procurement-03`, each configured for two identical
replicates. It provides deterministic resume, unique run identity per replicate,
external-root guards and a SHA-256 chain over the terminal runner archive,
result and validation envelope. Fake-run coverage and the full agentic test
suite are green.

Task 16 deployed the runner as a separate, non-privileged container on the
current n8n host. The named AppArmor profile permits only the user namespace
operation required by the Codex sandbox; the container remains non-root,
read-only, drops all Linux capabilities, has no published port and keeps
`no-new-privileges`. Linux isolation attestation and authenticated reachability
from both n8n containers are GREEN. The runner-owned execution profile is now
exposed and matches the pinned model, effort, CLI and artifact hashes. Four
runner-direct blind runs completed under a bounded systemd driver. All four
returned exactly 27 unique fields and passed structural/archive-integrity
evaluation. Repeatability differences remain unadjudicated because neither new
procurement has an employee-authored gold report. Evidence is recorded in the
2026-09-10 runner/canary evaluations.

The operator-approved additive migration is now applied to production
Supabase. Independent read-only verification confirms the exact shadow schema,
constraints and indexes plus
`tender_analysis_documents.ingestion_metadata jsonb NOT NULL DEFAULT '{}'`.
The inactive n8n canary then reproduced and fixed two technical contract defects:
n8n `2.35.3` did not resolve explicit-JSON `fullResponse` streams, and
PostgreSQL does not implement `max(uuid)`. Runner JSON calls now use response
auto-detection, UUID aggregates cast through text, and the binary upload no
longer carries the invalid raw-body-only parameter.

The final inactive chain completed successfully: wrapper execution `15256`,
corrected Dispatch `15257`, and one-shot Monitor `15258`. Shadow job
`79149bb3-0028-413a-bbb9-813de64b6052` committed exactly 27 ordered field rows
and completed. The fake runner used for this transport/DB canary reported
`paid_execution=false`; it was removed afterward. The real runner is again
healthy and authenticated from both n8n containers, with zero restarts. The
temporary one-shot workflows were archived.

Corrected inactive candidates are Dispatch `gP29fv0rq4MoON9a` and the
schedule-based Monitor `CALcBEXvQsO1AcfP`. Their normalized graphs match the
repository exports and exact existing credentials are bound. Earlier imported
Dispatch `d37251e524754e1f` and Monitor `47e6ede6c10349c0` remain inactive
pre-fix copies and must not be promoted. Error candidate
`6ccedae778a14176` remains inactive. No workflow was activated and legacy
production routing was not changed. Production promotion and error-workflow
publication/linking are Task 17 and were not started. Full evidence is in
`evaluations/AGENTIC_TASK16_LIVE_CANARY_2026-09-10.md`.

## Task 0 baseline reconciliation and live routing audit — 2026-09-08

The integration branch starts from archive/report tip `f596755`, merges the
current intake tip `2701bc8` (which supersedes the earlier `cec69c0` plan
reference), and then merges Agentic Lane A tip `0b5a95b`. The four expected
intake conflicts in `AGENTS.md`, `README.md`, `PROJECT_STATUS.md` and
`DEVELOPMENT_LOG.md` were resolved by retaining both archive/report and intake
state. `FIELD_CATALOG.md` was not semantically edited. The complete blind-test
archive and its `raw/` subtree retain the exact Lane A Git tree objects
`4d82e2a0351e572d56d3354e5fa9c3f3a9cd299d` and
`a231738d23513883f257c71870f8c69396da5e27`.

Fresh production n8n evidence was collected through the scoped read-only API
using only paginated workflow-list and workflow-detail GET requests. The list
contained 100 accessible workflows. `versionId` below is the current draft
version returned by workflow detail; `activeVersionId` is shown separately when
it differs or is absent. Live n8n is authoritative where repository exports
conflict.

| Role / live workflow | ID | Active | `versionId` / `activeVersionId` | Nodes | Execute Workflow targets |
|---|---|---:|---|---:|---|
| Orchestrator — `ТЕНДЕРЫ ОРКЕСТРАТОР` | `Q1RWSrB0jaTA6Dmx` | no | `75a99242-ad3a-47c1-beac-b7a407ae3795` / null | 12 | `Запустить обработку документа` → `W4mNOUkdsFtNENpI` (inactive) |
| Document Preparation — `TENDER — Подготовить документацию` | `0scTZu1aBKsMd6AM` | no | `15d704c2-08b7-41be-9218-77469a6ba08b` / null | 15 | none |
| Worker — `TENDER — Обработать документ` | `1Pw61ZY3HgBSvcUr` | yes | `f3d9fdb3-21ea-4d38-8dba-5bc65dd3309d` / same | 37 | → `iLt7wLLfueg8qffZ` (inactive) |
| Worker candidate — `[PROD CANDIDATE] TENDER — Обработать документ` | `csnDg78NzN1nIjUT` | yes | `778dfb50-72be-434d-ba82-2f8fcf90daec` / `c5977af5-c263-4846-8af2-762b85edcc87` | 52 current draft | → `ftvmrEHoMbPOAqZG` (active) |
| Worker candidate — `[3 TEST] TENDER — Обработать документ` | `2T7szFpiGcfNpKkB` | no | `55664cef-7e4f-4d9b-8f28-e1e2eb6a7c52` / null | 60 | → `iLt7wLLfueg8qffZ` (inactive) |
| Worker candidate — `[DW-23 TEST CODEX] TENDER — Обработать документ` | `W4mNOUkdsFtNENpI` | no | `a32653e5-4486-46b8-9617-6e90c56dd0ed` / null | 86 | disabled call → `ftvmrEHoMbPOAqZG` (active) |
| Worker candidate — `LEGACY [DW-23 TEST CODEX] TENDER — Обработать документ` | `URFdslUfULtOLv9B` | yes | `1c1654cf-e47c-443f-9cc1-e6776afa1ba5` / same | 86 | → `ftvmrEHoMbPOAqZG` (active) |
| Aggregator candidate — `[LEGACY] TENDER — Агрегация закупки` | `iLt7wLLfueg8qffZ` | no | `89b33d04-8fd2-4efa-b363-8ba7b9263d46` / null | 24 | 2× → `9uDOU31DGo30fGXX` (active); 2× → `cSsh9yjpS7t5p0OO` (active) |
| Aggregator — `TENDER — Агрегация закупки` | `ftvmrEHoMbPOAqZG` | yes | `1f5f6f96-1eb9-4f02-8a9a-8b80b7c1e87b` / same | 31 | 2× → `pReSd1KIRTgbysUZ` (active); 2× → `cSsh9yjpS7t5p0OO` (active) |
| Targeted Recheck — `TENDER - Targeted Recheck` | `9uDOU31DGo30fGXX` | yes | `4e0858c9-6ca2-42c7-969b-e74a2f91b8c6` / same | 64 | 8× → `cSsh9yjpS7t5p0OO` (active) |
| Targeted Recheck candidate — `[TEST CODEX] TENDER - Targeted Recheck` | `nI47FcgzYwGzwGqy` | yes | `799914f2-4a76-43fe-a501-3b9445ad6313` / same | 64 | 8× → `cSsh9yjpS7t5p0OO` (active) |
| Targeted Recheck route guard — `[TEST ROUTE GUARD 14449] TENDER - Targeted Recheck` | `pReSd1KIRTgbysUZ` | yes | `a88d9d2a-c86b-4563-89f5-e07aec99a99a` / same | 70 | 9× → `cSsh9yjpS7t5p0OO` (active) |
| Finalization — `TENDER — Финализация анализа` | `cSsh9yjpS7t5p0OO` | yes | `742051fe-a58a-4e03-afa6-6233c0177247` / same | 5 | → `ckPnP3hRhKu4Mf9u` (active) |
| Report — `TENDER — Генерация отчета` | `ckPnP3hRhKu4Mf9u` | yes | `a6fbb0f6-eed0-4656-9c4c-de4bbc30aa3b` / same | 12 | none |
| Intake Resume candidate — `[CODEX CANDIDATE] TENDER — Intake Resume — NO WORKER` | `VO8Ml0sfO65w2Jiz` | no | `55d3a8a2-9864-4d83-bd69-7bf96ff7a0be` / null | 53 | enabled → `thE9gLyNTvxLWt8I` (inactive no-worker Orchestrator); disabled → `1Pw61ZY3HgBSvcUr`, `ftvmrEHoMbPOAqZG`, `cSsh9yjpS7t5p0OO` (all active) |
| Mark Intake candidate — `[CODEX CANDIDATE] TENDER — TenderPlan Mark Intake` | `biYC4OvWBlfJRmnj` | no | `1bba9fab-250f-4280-ab85-82bcd99326ea` / null | 5 | → `VO8Ml0sfO65w2Jiz` (inactive) |
| Manual Resume candidate — `[CODEX CANDIDATE] TENDER — Manual Resume` | `z8nynFC12H9WOM9s` | no | `65506d90-f32c-4488-aacb-66e0d03d2cd7` / null | 3 | → `VO8Ml0sfO65w2Jiz` (inactive) |
| Recovery Scan candidate — `[CODEX CANDIDATE] TENDER — Recovery Scan` | `lwcHHdmmNd5YE6cw` | no | `19976752-0f3e-4427-8e2e-e44a7490659c` / null | 4 | → `VO8Ml0sfO65w2Jiz` (inactive) |
| Intake Error — `TENDER — Ошибка Intake Resume` | `kff8KIrSHzo5Mmt1` | yes | `717888b5-22df-4ec6-b632-2704d6ee8fb4` / same | 4 | none |

Fresh local/live conflicts and authoritative resolution:

- repository Orchestrator has 14 nodes at `466ed98e-…` and routes to
  `URFdslUfULtOLv9B`; live has 12 nodes at `75a99242-…` and routes to inactive
  `W4mNOUkdsFtNENpI`; live is the current production state;
- repository canonical Worker is an 85-node identity-neutral package routing to
  inactive legacy Aggregator `iLt7wLLfueg8qffZ`; no exact installed live identity
  matches that package. Repository beta ID `URFdslUfULtOLv9B` also has stale
  name/version metadata relative to live;
- repository Aggregator `ftvmrEHoMbPOAqZG`, Finalization
  `cSsh9yjpS7t5p0OO` and Report `ckPnP3hRhKu4Mf9u` match live identity,
  current version, node count and Execute Workflow targets. Repository exports
  omit live `activeVersionId` metadata;
- repository canonical Targeted Recheck identifies `pReSd1KIRTgbysUZ` as an
  inactive 70-node candidate at `cae31e7f-…`; live has the same ID and 70-node
  target shape but is active at `a88d9d2a-…`; live is authoritative;
- repository Intake/Mark/Manual/Recovery packages contain no installed IDs and
  preserve packaging placeholders. The only matching accessible live candidates
  are the inactive `[CODEX CANDIDATE]` workflows above, with Intake deliberately
  wired to a no-worker Orchestrator. Repository Intake Error is inactive and
  identity-neutral, while live Intake Error is active at `kff8KIrSHzo5Mmt1`.

Worker routing selection is **BLOCKED**. The only direct inactive/inactive pair,
`2T7szFpiGcfNpKkB → iLt7wLLfueg8qffZ`, is not a closed test chain because the
Aggregator has enabled calls to active production Targeted Recheck
`9uDOU31DGo30fGXX` and active Finalization `cSsh9yjpS7t5p0OO`, which continues to
active Report Generation. Inactive Worker `W4mNOUkdsFtNENpI` cannot form the
required pair either: its Aggregator node is disabled and targets active
`ftvmrEHoMbPOAqZG`. No inactive test Worker plus matching inactive test
Aggregator is therefore selected. Production routing was not changed.

Post-reconciliation verification is GREEN: the focused intake/archive/report
command completed `68/68` tests, the full repository command completed
`565/565` tests, and no historical or new failure signature remains in this
integrated tree.

## Archive extractor deployment — runtime GREEN

The bounded archive extractor from commit `cc2336e` is deployed as the isolated
Compose project `tender-archive-extractor` in `/opt/tender-archive-extractor`.
The container is healthy with no host port, non-root UID/GID `10001:10001`, a
read-only root filesystem, dropped capabilities, `no-new-privileges`, and
limits of 512 MiB, 0.5 CPU and 64 PIDs. Both production n8n main and worker
containers resolve the internal service and receive the expected health
contract.

Two disposable runtime canaries are GREEN: direct ZIP extraction and nested
`ZIP → 7Z → file`. Both returned deterministic manifests and exact downloaded
bytes; exact-run cleanup succeeded and post-cleanup artifact reads returned
`404`. All eight pre-existing containers retained their exact IDs, start times
and restart counts across deployment. Canary artifacts were deleted and the
staging directory was removed. RAR/TAR/GZIP and a real TenderPlan archive have
not yet been runtime exercised.

The n8n workflow `0scTZu1aBKsMd6AM` remains inactive and unwired. PostgreSQL,
the production Orchestrator and its workflows were not changed. The next
integration gate is the reviewed additive migration and minimal Orchestrator
wiring after the concurrent Orchestrator work is reconciled, followed by one
bounded real-archive canary before activation.
## TenderPlan intake/resume checkpoint — automatic mark path GREEN in isolated NO-WORKER contour, activation pending

Starting feature commit before documentation integration: `4c32d0b`. `main` is
not changed.

### Verified

- Inactive repository candidates `TENDER — Intake Resume`, `TENDER — Manual
  Resume`, `TENDER — Recovery Scan` and `TENDER — Ошибка Intake Resume` are
  implemented and offline-tested.
- Dispatcher preserves the same `analysis_run_id`, never repeats
  `completed`/`skipped` documents, and caps automatic dispatch at exactly two
  Worker claims total. `manual_override=true` may retry an exhausted failed
  document.
- Terminal run status `superseded` is implemented in the repository migration
  and dispatcher contracts. Automatic/manual/recovery requests for such an
  `analysis_run_id` return `superseded_no_op` and cannot reach Worker,
  Aggregator or Finalization. Runs, children and existing `error_message` remain
  preserved; nullable `superseded_at` / `superseded_reason` provide audit.
- Active-run uniqueness now uses
  `status NOT IN ('completed', 'superseded')`. Only-superseded history permits
  the first post-rollout mark to create a new run; stable mark+tender key and
  remove/reassign no-repeat semantics are unchanged.
- A `processing` document becomes stale after one hour. Reclaim requires
  read-only n8n execution observation plus guarded CAS; unavailable API,
  malformed/mismatched-ID observation and unknown status do not mutate state.
- Read-only pre-DB smoke execution `14678` in workflow
  `yocBDh0nCvPPxItn` verified exact Orchestrator input validation, TenderPlan
  FullInfo identity and normalization for both test tender IDs. It stopped before
  DB registration, contained no PostgreSQL/Execute Workflow node, performed no
  DB writes and invoked no Worker. Evidence:
  `evaluations/TENDERPLAN_ORCHESTRATOR_PRE_DB_SMOKE_14678_2026-09-08.md`.
- Current intake/resume focused gate: `42/42 PASS` across migration, dispatcher,
  Orchestrator, Mark Intake, Manual Resume, Recovery Scan and Error Workflow
  tests. Fresh current full suite is `526/526 PASS`.
- Exact-body rollback dry-run execution `14686` completed with `ROLLBACK`; the
  follow-up snapshots showed the schema and all bounded rows unchanged.
  Immediate full-quiescence verification was zero `new`/`running`/`waiting`
  executions. Fresh preflight `14687` reproduced the approved `24 + 50 + 12`
  legacy shape immediately before application.
- Production migration execution `14688` succeeded. Read-only postflights
  `14689`, `14690` and `14703` confirm the intake ledger, superseded audit
  columns, superseded-aware status CHECK and partial unique index. Exactly
  `86/86` bounded legacy runs are `superseded`, active duplicate groups are
  zero, and the 26-field run `18f3eaee-528d-4bc1-8d72-a1ea2f313df2` is included.
  All related data remains present: `273` documents, `577` units, `756` facts
  and `29` field results.
- New isolated n8n copies were created without modifying the existing live
  workflows: Error `kff8KIrSHzo5Mmt1`, NO-WORKER Orchestrator
  `thE9gLyNTvxLWt8I`, Intake Resume `VO8Ml0sfO65w2Jiz`, Mark Intake
  `biYC4OvWBlfJRmnj`, Recovery Scan `lwcHHdmmNd5YE6cw` and Manual Resume
  `z8nynFC12H9WOM9s`. Entry workflows remain inactive/unpublished. The new Error
  workflow is published only so the inactive candidates can reference it.
- NO-WORKER Orchestrator canaries `14691` and `14694` created/reused exactly one
  active run for each approved test tender. Intake ledger canaries `14697` and
  `14700` used stable mark+tender keys: the first delivery completed both ledger
  rows, the second returned `duplicate_event` for both and preserved the same
  `analysis_run_id`. Postflight `14703` shows both ledger rows at `attempts=1`.
- The two canary runs contain `6` and `5` registered documents respectively;
  every document remains `pending`, `attempts=0`, with no owner execution.
  Searches across all 14 workflows named `Обработать документ` found zero Worker
  executions after the canary start. In this disabled test topology the returned
  `documents_dispatched=6/5` is queue cardinality, not actual Worker dispatch.
- The isolated Intake runtime matrix is GREEN. Credential smoke `14704` returned
  HTTP 200. Post-fix stale-event executions `14707/14708` preserved the same run,
  incremented the event to attempt 2 and queued 6 pending documents. Automatic
  attempt-cap executions `14711`-`14716` excluded a failed document at attempt 2
  while manual override included it. Terminal-owner reclaim `14719/14720` moved
  the stale processing document to `failed` with a guarded increment; cleanup
  `14721` restored the approved canary state.
- A live waiting owner was not reclaimed in `14726/14727`; an intentional
  Execution API outage failed closed in `14729/14730`; corrected CAS-race canary
  `14734` returned `cas_rows=0` after a competing owner update. Recovery Scan
  `14736/14737` reused the same run. Production-mode Error Workflow executions
  `14738/14739` marked the exact event failed, and `14740/14741` retried that
  same event/run to `completed`, attempts 2. Read-only verifier `14742` found all
  6 documents pending and no processing/failed documents.
- The global execution inventory for `14722`-`14742` contains only isolated test,
  Intake, Recovery and Error workflows. No Document Worker, Aggregator,
  Finalization or production Orchestrator execution was created.
- Post-review hardening now requires an HTTP 200 execution-read body ID to match
  the requested owner exactly; a mismatch fails closed as unavailable. The same
  two-node patch was applied only to inactive candidate `VO8Ml0sfO65w2Jiz` and
  read back at draft version `3b46d3ac-bdc6-4e73-9201-37e3f4fae15e` with both
  guards present, no active version, and Worker/Aggregator/Finalization disabled.
- Current-state Mark Intake execution `14743` exposed the first incorrect state:
  TenderPlan returns its internal 24-character identifier in `tender._id` /
  `tenders[]._id`, while `tender.id` may be an external procurement identifier.
  The repository and inactive candidate normalizer now validate and deduplicate
  `_id`. Repeat execution `14744` succeeded and launched only Intake execution
  `14745`; that child returned `duplicate_event` with the existing
  `analysis_run_id=d29195fd-13af-49cc-a1a5-6c7a3f44a8cf`. The global execution
  inventory for the canary window contains only `14744` and `14745`: no
  Orchestrator, Document Worker, Aggregator or Finalization execution was created.
- Read-only local/live audit found that Orchestrator and both plausible Worker
  targets differ. Document Error Workflow, Aggregator and Finalization have exact
  normalized config and connections parity under the documented comparison
  boundary. Sanitized evidence:
  `evaluations/TENDER_INTAKE_LIVE_PARITY_PREFLIGHT_2026-09-08.md`.
- A fresh read-only live check on 2026-09-09 found additional Orchestrator drift:
  `Q1RWSrB0jaTA6Dmx` now targets inactive Worker `W4mNOUkdsFtNENpI`, whereas the
  earlier checked-in preflight recorded `URFdslUfULtOLv9B`. None of the existing
  live Worker candidates checked (`1Pw61ZY3HgBSvcUr`, `URFdslUfULtOLv9B`,
  `csnDg78NzN1nIjUT`) contains the DW-8 scoped retry-persistence contract.
- Two new isolated, inactive and unpublished candidates were therefore created
  without changing existing workflows. Worker `YX7RBDdy0fnTvoSV` has 85 nodes,
  the canonical Cloudflare Extractor configuration, the DW-8
  `current_unit_ids` / `deleted_stale_units` query, existing credential
  references, document Error Workflow `jYzQ8RtNmnTM2PGz`, and canonical
  Aggregator target `ftvmrEHoMbPOAqZG`; the Aggregator call remains disabled for
  the bounded Worker canary. Orchestrator `TRLYuU7mVyE1bjjr` has 14 nodes and
  calls only this new Worker. Read-back confirms both have `active=false` and
  `activeVersionId=null`.
- Inactive Intake Resume candidate `VO8Ml0sfO65w2Jiz` was wired in draft to
  Orchestrator `TRLYuU7mVyE1bjjr` and Worker `YX7RBDdy0fnTvoSV`; direct Worker,
  Aggregator and Finalization dispatch nodes remain disabled. Read-back version
  is `58ee1a87-3a74-4b61-ab2c-642882a0fc7f` with zero validation warnings. The
  temporary import artifacts were scanned before upload: no embedded API keys,
  tokens, passwords, Authorization values or pin data were found. Fresh full
  repository suite remains `526/526 PASS`.

### Not verified / blocked
- Historical Task 8 TenderPlan type-5 event contract was not established and is
  superseded, not a current poller blocker. Probe workflow
  `oCXpDbO3Xz1qrCBf`, execution `14677`, returned an empty type-5 list;
  FullInfo returned `marks=[]` for both test tender IDs. No event paths or fixture
  were fabricated.
- Latest repeat probe execution `14680` produced the same negative result:
  empty type-5 list, `marks=[]` and empty `notification` for both test tender IDs.
- Execution `14682` confirmed the target tender's FullInfo mark ID while the
  type-5 feed remained empty. Execution `14683` proved the read-only relation
  contract for mark `6a732cd00c61629cf1d3c144` («Проверить»), including
  duplicate `tender`/`tenders` placement and one unique tender.
- Task 9 Mark Intake is imported and read back with the real TenderPlan
  credential and the isolated Intake target. Its manual current-state poll is
  runtime GREEN through Intake duplicate/no-op (`14744` → `14745`), but the
  ten-minute schedule is intentionally not activated. Pagination/order/cursor
  and exhaustive-result semantics remain undocumented.
- The isolated Intake retry/stale/manual/CAS/API-outage runtime matrix is GREEN.
  Both execution-read HTTP nodes are bound in the isolated live candidate to the
  owner-created read-only Header Auth credential and use the explicit non-secret
  self-hosted origin `https://n8nworkup.ru`; no API key is embedded. The portable
  repository export intentionally keeps the credential reference unbound.
- Exact execution-response ID correlation is offline-tested and present in the
  inactive live candidate, but has not required an additional runtime canary.
- Aggregator and Finalization routes remain unverified in this change because the
  approved canary boundary required stopping before Document Worker. Their
  controlled end-to-end runtime test is a separate promotion gate.
- Existing live workflows were not changed. Mark Intake, Recovery Scan, Manual
  Resume and Intake Resume remain inactive/unpublished; production activation
  remains a separate owner decision.
- The new Worker has not been executed because the approved runtime boundary
  still stops before Document Worker. Therefore DW-8 controlled retry behavior,
  paid AI calls, production-DB writes, Aggregator/Finalization and schedule
  activation remain unverified. Publication/activation must not proceed until a
  separately approved bounded Worker canary is GREEN.
- n8n import preserved all `101/101` Worker connection edges and the critical
  claim/persistence SQL, but normalized away eleven explicitly exported default
  parameter paths across ten nodes. The current HTTP Request type definition
  documents omitted `batchInterval` as default `1000`; the other omissions are
  likewise default-shaped. Exact installed-runtime equivalence is intentionally
  not claimed until node-schema review and the bounded canary are complete.
- MCP ignored requested folder placement for created test workflows and returned
  `parentFolderId=null`; this is recorded as tooling/packaging drift. The safe
  no-worker Orchestrator `thE9gLyNTvxLWt8I` was executed only by the bounded
  canaries above.

Controlled activation order remains:

```text
migration
→ error workflow
→ Worker
→ Orchestrator
→ Dispatcher
→ Manual Resume
→ Recovery Scan
→ TenderPlan poller
```

This checkpoint is not production-complete.

## DW-24 ActiveX GroupName NUL containment — runtime GREEN

Execution `14592` failed in `Сохранить analysis unit` because a corrupted
MS-OFORMS GroupName containing literal U+0000 reached a JSONB query parameter,
although the same control's option Value `0/1` was decoded reliably. The local
canonical Worker and required `[DW-23 TEST CODEX]` parity package now reject only
an implausible GroupName to `group_context=null`, retain selected/unselected
state, and add bounded NUL-free `invalid_activex_group_name` audit. Existing
`Развернуть части для AI v1.2`, immediately before persistence, recursively
hard-fails on any residual literal NUL without stripping it.

The fixture is a sanitized structural derivative with no client text, raw
binary, tender identifiers, UUIDs or credentials. Execution `14596` verified
the fixed `[DW-23 TEST CODEX]` Worker on the previously failing document:
ActiveX parsing and analysis-unit persistence succeeded, residual NUL count was
zero, `8/8` units and `15` facts were persisted, and the document reached
`completed`. The two malformed GroupName values were retained only as bounded
`invalid_activex_group_name` audit warnings. The test Aggregator was not invoked
because this was a document-level replay; production promotion and a fresh full
run remain separate gates.

## Integration checkpoint — one DW-23 implementation, two packages

The isolated integration branch combines `03fee9b` group-local ActiveX ownership
and DW-22 `target_ranked_windows`, `689859e` JSONB-safe `v2i:/v2q:/v2g:` tuple
identities, and the selective Validator retry series `91b8dfd..012bcff`.
The primary Validator remains outside the retry loop; only contract-invalid
facts retry, valid siblings remain intact, source identity is carried in an
immutable `ai_validator_source_envelope_v1`, retry audit is system-owned, and
attempt-three exhaustion becomes audited `requires_review`.

The core has two local packages. Canonical
`workflows/n8n-exports/TENDER — Обработать документ.json` is neutral and inactive,
has no top-level instance identity, uses the generic Aggregator and canonical
Cloudflare GLM Extractor, and has `85` unique nodes. Beta
`workflows/n8n-exports/beta/[DW-23 TEST CODEX] TENDER — Обработать документ.json`
is import-ready for `[DW-23 TEST CODEX]`, with workflow ID `URFdslUfULtOLv9B`,
test Aggregator `ftvmrEHoMbPOAqZG`, Novita FP8 Extractor, configured Error
Workflow and beta-only two-second Wait; it has `86` unique nodes. Every common
Code node is identical between packages and every connection endpoint resolves.
Both packages use the JSON-verified Validator model
`google/gemini-3.7-flash@provider=google-ai-studio/flex&reasoning_effort=low`
for primary validation and retry attempts 2–3.

Fresh verification: canonical focused Worker/package tests `241 total / 239 pass / 2
fail` (only the pre-existing ActiveX fixture byte-count and immutable beta-hash
pins); overlay/package tests `4/4 PASS`; full repository suite `469 total / 462 pass / 7
fail`, with the seven known baseline artifact/fixture/prompt pins and no new
Worker behavior failure. No live n8n or PostgreSQL change, push, merge or runtime
execution occurred. Canonical is not promoted and runtime GREEN is not claimed.
Next step is manual beta import, exact read-back, then an isolated runtime canary.

Execution-level tests now run the real `Нормализовать документ Docling` path on
the checked-in ActiveX ownership fixture. They prove emitted `v2i`, `v2q` and
`v2g` tuple members, exact group-discriminator retention, collision-safe tuple
round-trip and recursive U+0000 absence through semantic blocks and AI segments.
The real primary Validator classifier and retry assembler likewise prove
`v1vf:` JSON tuple identities, shuffled multi-identity reassembly and NUL-free
retry audit/envelopes. This is offline evidence only, not runtime promotion.

## Aggregator live synchronization — 2026-09-05

Read-only n8n API export confirmed that workflow ID `ftvmrEHoMbPOAqZG`,
historically named `[TEST CODEX] TENDER — Агрегация закупки`, is currently
active and named `TENDER — Агрегация закупки`. Its 31-node live graph is now
the canonical repository snapshot. The live `procurement_subject` rules already
contain the verified AG-8 current-procurement boundary, so no additional prompt
rewrite was needed after export. The same live graph also contains the safe
`application_documents` Round 1 deferral and an explicit retry-model fallback.

Offline verification after synchronization: `465 total / 458 pass / 7` known
baseline failures. AG-8's prior intentional production RED gate is now GREEN;
the remaining failures are artifact/fixture/prompt byte-pins unrelated to this
sync. This read-back does not prove a fresh runtime execution or full 27/27
semantic result. No n8n or PostgreSQL write was performed by Codex.

## DW-23 selective AI Validator retry — local implementation GREEN

Canonical local Document Worker now contains a bounded, fact-selective retry
contour for `AI Validator v1`. The initial Validator call remains outside the
Loop. Its response is classified by exact
`analysis_unit_id + fact_index + field_key`; valid facts and semantic verdicts
are retained, while only contract-invalid facts are queued one-by-one for at
most two additional calls (three total attempts). Valid siblings and unrelated
units are not re-sent. If any primary validation has no attributable integer
`fact_index` or otherwise cannot be bound to one exact source identity, the
response unit is not partially accepted: every source fact in that unit enters
retry with `unattributable_validation_identity`.

If the third response is still contract-invalid, the affected original fact is
reassembled deterministically as `requires_review` with `confidence=0` as an
explicit system sentinel, `reason_code=other`, unchanged value/evidence and a
three-attempt `validator_meta` audit. The existing strict
`Проверить ответ AI Validator` remains after convergence and still validates the
complete reassembled unit response. Missing/crossed source identity, duplicate
fact identity and programming invariants remain hard failures.

Independent review rejected the first local implementation because assemblers
expanded one aggregate input into many outputs while assigning impossible
upstream `pairedItem` indexes, and because a mixed known-invalid + unknown
identity could partially clear a unit. The remediation removes those invalid
links and gives every reassembled provider item an immutable top-level
`validator_source_envelope` (`ai_validator_source_envelope_v1`) containing the
source plus exact unit/fact identities. The strict checker now requires and
hard-validates that envelope without positional source lookup; its own 1:1
`pairedItem` still references its immediate input.

Final audit hardening makes `validator_retry_audit` system-owned on every
reassembled item. Units without an actual retry receive a canonical empty
envelope (`ai_validator_selective_retry_v1`, `max_total_attempts=3`, `facts=[]`),
overwriting any provider-supplied top-level field. Retried units receive only the
workflow-built audit. The strict checker rejects foreign audit versions, attempt
bounds and extra top-level keys before fact metadata is produced.

Execution-`14491`-derived sanitized regression is explicitly marked
`runtime_replay=false`. Focused DW-23 tests are `9/9 PASS`; related Document
Worker tests are `264 total / 261 pass / 3` exact baseline failures; full suite is
`458 total / 450 pass / 8` exact pre-existing baseline signatures. Workflow
structure validates as `85` unique nodes / `82` connection sources / `101`
resolved edges. No production n8n, PostgreSQL, credentials, schema,
`FIELD_CATALOG`, or main branch was changed.

### DW-23 pinned runtime canary — execution 14589 GREEN

Owner-started execution `14589` in `[DW-23 TEST CODEX] TENDER — Обработать
документ` reproduced the exact malformed primary response from execution
`14491`: `doc_7_au_0037 / fact_index=1 / licenses_certificates` omitted
`confidence`. Classifier `ai_validator_selective_retry_v1` retained the valid
primary results and queued only this one contract-invalid item. Attempt 2 was
accepted as contract-valid `rejected`, `confidence=0.95`,
`reason_code=wrong_field_classification`; retry was not exhausted.

After retry assembly the strict checker accepted all `22/22` Validator unit
responses. Worker persisted `69` audited facts across `66/66` analysis units and
completed document `a87ba83e-9341-405b-bce7-5f485061fde2`; execution status is
`success`. Full evidence is recorded in
`evaluations/DOCUMENT_WORKER_DW23_RUNTIME_14589_2026-09-06.md`.

This closes the exact pinned `invalid_confidence` runtime gate through
persistence and document completion. A fresh full run without pinned data and
live production promotion remain separate gates; no live n8n workflow was
changed while recording this evidence.

## Document Worker Evidence Repair overflow checkpoint — executions 14487 / 14491

Execution `14487` originally failed before the Evidence Repair AI call at
`candidate_index=257` for `doc_7_au_0022`, primary target `sb_0714`. The local
canonical Worker preserves byte-compatible full mode for `<=256` candidates and,
for a single-fact overflow only, performs bounded deterministic retrieval of exact
canonical fragments inside the violation-bound target block. Multi-fact overflow
remains intentionally fail-closed until a fact-local catalog contract exists.

Owner-started manual execution `14491` exercised the same observed geometry:
`44,375` canonical characters, `2,016` structural candidates and `2,015` target
candidates. `selection_mode=target_ranked_windows` retained `37` candidates and
omitted `1,979`; the serialized request was `31,627 / 360,000` characters. One
Evidence Repair call ran for the target unit. Attempt 2 independently rebuilt the
catalog, accepted four allow-listed refs from `sb_0714`, materialized all four
exactly, and returned `validation_passed=true` with zero evidence violations.
Therefore the **DW-22 overflow runtime contour and exact/deterministic grounding
are GREEN**. The repaired fact was subsequently rejected safely by AI Validator
as `wrong_field_classification`; successful grounding did not bypass semantic
validation.

Execution `14491` later failed in `Проверить ответ AI Validator` on a different
unit, `doc_7_au_0037`, fact `licenses_certificates`: validation item `1` omitted
the mandatory `confidence` property, so the strict checker observed `undefined`
and correctly failed closed with `validations[1].confidence должен быть числом от
0 до 1`. Persistence, document completion, readiness and Aggregator dispatch were
not reached. Thus DW-22 is runtime GREEN, but the complete Worker execution and
full procurement run are not GREEN.

### Agreed next change — selective bounded retry for invalid AI items

Implement locally in the current workflow, **without a separate sub-workflow**:

```text
AI call
→ strict response classification
→ valid items continue
→ only contract-invalid items enter a local retry branch
→ merge by stable item identity
→ final strict checker
```

The agreed default is three total attempts per item (initial call plus at most two
retries), with bounded waits and explicit attempt audit. Already valid items must
not be sent to the model again. Transport failures and retryable schema/contract
failures are retried; semantic verdicts such as `wrong_field_classification` are
not. After exhaustion the workflow must terminate the affected item safely using
the stage-specific technical fallback (`requires_review` where its contract
allows it), never infer `not_found`, never fabricate evidence or AI confidence,
and never loop without a hard bound. Roll this pattern out one AI stage at a time,
starting with `AI Validator v1 → Проверить ответ AI Validator`, with an
execution-`14491`-derived RED fixture and item-level cardinality/cost assertions.
Prompts, models, strict semantic validators, PostgreSQL schema and the 27-field
catalog remain outside this change.

## Targeted Recheck route-guard checkpoint — executions 14429 / 14449

Owner-started full run `535461ec-8969-4e15-ad69-a87c3b9e4747` завершил 27/27,
но не является semantic GREEN: `application_documents` после validated Targeted
Recheck впервые стал неправильным в `Определить путь после Validator`
(`post_validator_route=round_2`) и реально вызвал общий `Semantic Aggregator1`.
Containment предотвратил `false_resolved`, однако FIELD_CATALOG запрещает Round 2
для этого field key.

Local canonical Targeted Recheck теперь имеет exact four-key Round 2 allow-list,
отдельный terminal `requires_review` для остальных 23 полей и defense-in-depth в
Round 2 collector. `application_documents` сохраняет validated candidate
evidence и route-guard audit; существующий `direct_final` contract не изменён.
Выделенная canonical terminal-цепочка
`Нормализовать FINAL поле8 → Сохранить FINAL результат поля в БД8 →
Подготовить вызов Finalizer8 → Call 'TENDER — Финализация анализа'8` не сходится
в ранее используемые `...5 / БД5 / Finalizer2` nodes. Все четыре node contracts
скопированы из этих текущих canonical counterparts с изменением только
name/id/position; PostgreSQL credential reference сохранён, credential values не
добавлялись. Current candidate graph: `70/70` nodes reachable, disabled nodes
нет. Execution-derived regression по `14429` GREEN offline.

Owner-started manual execution `14449` в отдельном inactive test workflow
`SKzmu0VqYRtJ0Ai1` прошёл runtime contour на пяти исходных field items execution
`14429`. Для `application_documents` реально выполнились Targeted Recheck AI,
exact evidence validator (`evidence_validated=true`) и AI Validator. Validator
вернул `requires_review` (`unsupported_inference`, confidence `0.7`), после чего
route guard выставил `terminal_requires_review` с причиной
`field_catalog_round_2_not_allowed`. `Собрать candidates для Round 2` и
`Semantic Aggregator1` имели `0` runs. Отдельная terminal-ветка один раз
нормализовала и сохранила FINAL `requires_review`; Finalizer подтвердил валидный
барьер `27/27` для уже завершённого run. Это evidence owner-modified test
топологии; exact parity её parameters/IDs/positions с local canonical не
доказана, потому что отдельный read-only snapshot этой test topology для
программного сравнения не сохранён.

Это не production promotion и не fresh полный запуск от Orchestrator. Production
Targeted Recheck не изменён; fresh независимый PostgreSQL `SELECT` после `14449`
не выполнялся. Следующий отдельный gate — review и явно согласованный production
promotion, после него fresh full run.

## ActiveX semantic checkpoint: parent 14409 / Worker 14410

### Execution 14425 — ActiveX V2 / JSONB runtime GREEN

Read-only forensic execution `14425` подтвердил исправленный изолированный
Worker `U3u87zB2GNSbzU9e`, `[TEST ACTIVE X V2 JSONB SAFE] TENDER — Обработать
документ`: `integrated / success`, parent execution `14424`, без retry lineage.
Workflow оставался inactive и unpublished (`active=false`,
`activeVersionId=null`), а вызов Aggregator был disabled. Execution API не
возвращает execution `versionId`, но три изменённые Code nodes точно совпали с
local commit `689859e72eb3d4053e8c12035cdb0015a425fe7f`; runtime output также
подтвердил JSONB-safe V2 identities.

Прямая persistence projection содержала `12` analysis units и `0` literal
U+0000 во всех `analysis_unit`, `ai_segments`, `provenance`. `Сохранить analysis
unit` успешно сохранила `12/12`, поэтому PostgreSQL JSONB blocker execution
`14423` не воспроизвёлся. Extractor recovery завершился `12/12`: primary
Extractor принял `11` units, один unit прошёл разрешённый fallback; Evidence
Repair выполнил `4/4`, Lossless Fact Partition не потребовался. AI Validator
обработал `9` units, ещё `3` units без verified facts прошли deterministic
convergence без Validator HTTP.

Обе целевые ActiveX-цепочки дошли до persisted confirmed facts:

```text
activeX5/6/7/8 → #/tables/2 → activeX8 selected → «Не применимо.»
→ national_regime → exact grounded evidence → Validator confirmed
→ processing_status=confirmed → persisted

activeX55/56 → #/tables/25 → activeX55 selected → «Не предусмотрены;»
→ participation_guarantee → exact grounded evidence → Validator confirmed
→ processing_status=confirmed → persisted
```

Итог execution: `40` persisted facts (`24 confirmed`, `7 requires_review`, `9
rejected`), document `b85f8a8d-ce79-4f37-bfe4-678b3218693a` завершён, run
`d592b2c2-c4c2-46e7-884a-a413bfc5b9e0` переведён в
`ready_for_aggregation`. Disabled Aggregator node дала только canvas
pass-through; в точном execution window найден только `14425`, реальных
Aggregator/Finalization/Report/Delivery child executions не было. Fresh DB
`SELECT` отдельно не выполнялся, поэтому persisted state подтверждён outputs
успешных PostgreSQL nodes на момент execution, а не независимым последующим
read-back.

ActiveX local semantic ownership и JSONB-safe identity gate закрыты runtime
evidence. Повторный Worker execution для этого run не нужен. Следующий отдельный
gate — read-only preflight точного test Aggregator/Targeted Recheck target и
после отдельного разрешения запуск агрегации уже подготовленного
`ready_for_aggregation` run; не смешивать его с ActiveX branch scope.

### Execution 14423 PostgreSQL NUL containment — local implementation

Execution `14423` впервые завершился ошибкой в `Save analysis unit`: PostgreSQL
отклонил JSON payload как `unsupported Unicode escape`. Execution-derived
диагностика насчитала `581` paths с literal U+0000; целевые ActiveX groups к
этому моменту были разрешены корректно, а AI ещё не запускался.

Local canonical Worker теперь использует tagged canonical JSON tuple encoding:

```text
control identity = 'v2i:' + JSON.stringify([document_part, control_rel_target])
group identity   = 'v2g:' + JSON.stringify([block_id, source_table_ref, control_type, discriminator])
```

Normalizer публикует эти NUL-free identities, semantic builder и Validator
dispatch вычисляют тот же contract без decoder. `Развернуть части для AI v1.2`
не изменён. Старой persisted migration нет. Execution-derived sanitized RED
воспроизвёл `54` NUL-bearing paths в target projection после real
Normalizer→semantic→expand; после минимального изменения paths = `0`, exact
group matching сохранён. Production-path adversarial regression дополнительно
показал collision старого delimiter encoding (`3` identities вместо `4`) и
GREEN для tagged tuples (`4/4` distinct identities), включая downstream
Validator dispatch.

Финальная offline verification после corrective review:

- focused execution/mutation regressions: `2/2 PASS`;
- focused option-state file: `83 tests / 82 pass / 1` baseline fixture-size fail;
- file-isolated Document Worker suites: `249 / 248 / 1` против parent
  `247 / 246 / 1`;
- file-isolated full repository suite: `428 / 424 / 4` против parent
  `426 / 422 / 4`;
- failure files/signatures совпадают с parent, новых failures нет;
- independent semantic review: `PASS`, blockers `0`;
- independent JSONB/runtime-safety review: `PASS`, blockers `0`.

Это offline evidence после read-only forensic execution `14423`: live n8n и
PostgreSQL не изменялись, execution не перезапускался, runtime GREEN после fix
не заявлен.

Read-only MCP evidence on 2026-09-03 established that execution `14409` is the
manual parent (`workflowId=5rYqVLDj4bHnnUD8`) and is not MCP-visible. Its child
execution `14410` is the actual Document Worker run for exact workflow
`MUsCcwlpURJilj10`, `[TEST ACTIVE X] TENDER — Обработать документ`. The child
metadata is `integrated / success`, has no retry lineage, and identifies `14409`
as its parent. Therefore `14409` must not be described as belonging to the
Worker; its own workflow name/version cannot be independently read back with
the current MCP access.

The Worker run decoded `290` controls: `38 selected`, `88 unselected`, `164
unknown`, `0 conflict`. Normalization attached `83/290` unique controls to
semantic owners and produced `33` warning groups (`29
missing_structural_semantic_owner`, `4 conflicting_structural_option_coordinates`).
The document-wide semantic status remained `unknown`.

The two exact semantic oracles were grounded correctly:

```text
activeX5/6/7/8
→ OOXML table[3] rows 1/2/3/4
→ Docling #/tables/2
→ unselected / unselected / unselected / selected
→ selected label: Не применимо.

activeX55/56
→ OOXML table[28] rows 1/2
→ Docling #/tables/25
→ selected / unselected
→ selected label: Не предусмотрены;
```

The Extractor request for the owning analysis units contained explicit
`[OPTION_STATE selected]` / `[OPTION_STATE unselected]` markers plus structured
option-state provenance. The model therefore did not see labels alone. It
returned the semantically correct negative candidates, but the current
document-wide unknown guard capped both to `requires_review`. Unselected
alternatives were retained for audit and did not become applicable candidates.

First incorrect state: `Нормализовать документ Docling` collapses unrelated
unresolved ownership anywhere in the document into the global
`docx_option_state_semantic_status=unknown`; downstream guarded facts cannot
distinguish a locally exact, complete option group from an affected block.
Exact grounding is verified for both oracles; global semantic completeness is
not verified. Remaining blocker: introduce a deterministic block/group-local
ownership and completeness verdict while preserving the document-wide audit.
One next step: implement the accepted contract in
`docs/superpowers/specs/2026-09-03-activex-local-semantic-ownership-design.md`
through an execution-derived TDD slice.

### Offline implementation checkpoint

The accepted group-local v2 contract is implemented in the local canonical
Worker export and independently reviewed. Stable identity remains canonical
`document_part + control_rel_target`; changes to state, binary target, source
coordinate, type, name, exact label, or group context are conflicting observed
snapshots rather than new identities. Radio and checkbox groups have separate
cardinality rules. Unknown/conflicting groups fail closed, while unrelated
groups do not poison a resolved local group. Selected and unselected states,
the full v2 group projection, original canonical text/evidence, and rejected
audit facts survive semantic blocks, analysis units, compact provenance,
Extractor evidence handling, Validator dispatch, and convergence. AI-only
markers are not canonical evidence, and Validator cannot elevate review-only
facts. The deterministic applicability guard remains limited to
`national_regime` and `participation_guarantee`.

Offline verification on 2026-09-03:

- focused DOCX option-state suite: `81 tests / 80 pass / 1 fail`;
- all Document Worker suites: `10 files / 247 tests / 245 pass / 2 fail`;
- full repository suite: `25 files / 426 tests / 417 pass / 9 fail`;
- base `bfaa93147ea5109f48375cd6ea410b4d9ec78f6c`: Document Worker
  `236 / 234 / 2`, full suite `415 / 406 / 9`;
- candidate adds `11` passing regressions and preserves the same baseline
  failure files, counts, and signatures.

The two independent post-correction reviews are `APPROVE`. This checkpoint is
**offline only**: no n8n draft was updated, no runtime/canary was started, and
neither execution `14409` nor child `14410` was repeated. Runtime GREEN is not
verified.

Post-commit live preflight for workflow `MUsCcwlpURJilj10` confirmed
`active=true`, `sameAsDraft=true`, and
`versionId=activeVersionId=1ae15557-28e8-4604-b662-d65cfe057a9c`; the only
execution remains child `14410`. The four target Code-node parameter objects are
byte-equivalent to the local parent/base and differ from the reviewed candidate,
so the intended code transition is exact. Automatic draft sync was nevertheless
stopped before write: the available MCP `update_workflow` schema exposes no
`versionId`/`expectedVersionId` compare-and-swap, while the live clone also has
intentional drift in connections, node metadata, settings/`availableInMCP`, and
credential-reference structure. No approval card was opened and
`update_workflow` was not called. The next gate is a safe owner-operated import
or another reviewed update path that preserves the live graph and provides an
adequate concurrency boundary; only after read-back may a statically
side-effect-free bounded canary be considered.

Этот файл — короткий оперативный снимок. Он не заменяет:

- live n8n export как фактическое состояние workflow;
- `FIELD_CATALOG.md` как source of truth для смысла 27 полей;
- `DATA_MODEL.md` как описание PostgreSQL schema;
- `TECH_DEBT.md` как полный backlog;
- `DEVELOPMENT_LOG.md` как историю.

## 1. Current business goal

```text
полный корректный анализ тестовой закупки по всем документам
→ ручная проверка итоговых 27 полей
→ клиентский отчёт для Дмитрия
```

До отправки отчёта должны быть закрыты P0-риски, способные дать `false_resolved`, `false_not_found` или неполный результат.

## 2. Production / test boundary

### Production workflows

| Workflow | ID | Active | Latest verified/read-only checkpoint |
|---|---|---:|---|
| `TENDER — Обработать документ` | `1Pw61ZY3HgBSvcUr` | yes | API вернул 37 nodes, version `f3d9fdb3-…`; test hardening ниже не promoted |
| `TENDER — Агрегация закупки` | `iLt7wLLfueg8qffZ` | yes | owner-supplied read-only checkpoint 2026-09-03: active=draft, 24 nodes/version `89b33d04-…`; local canonical остаётся 38-node snapshot `1c9019de-…` |
| `TENDER - Targeted Recheck` | `9uDOU31DGo30fGXX` | yes | owner-supplied read-only checkpoint 2026-09-03: active 64 nodes/version `4e0858c9-…`; live/local drift и node-count convention описаны ниже |
| `TENDER — Финализация анализа` | `cSsh9yjpS7t5p0OO` | yes | 5 nodes; protected workflow, не менялся в текущем цикле |
| `TENDER — Генерация отчета` | `ckPnP3hRhKu4Mf9u` | yes | 2026-09-07: published active version `a6fbb0f6-…`, 12 nodes; exact HTML → Gotenberg → PDF chain присутствует, `versionId=activeVersionId`; post-promotion production execution не выполнялся по решению owner |

Production PostgreSQL Codex не изменял. Workflow owner вручную перенёс проверенные PDF nodes в production Report Generation и опубликовал version `a6fbb0f6-eed0-4656-9c4c-de4bbc30aa3b`; Codex выполнил только read-only сверку и repository sync. Более раннее утверждение, что 24-node Aggregator оставался unpublished draft, устарело: owner-supplied read-back для цепочки `14389–14391` фиксирует его как active и `sameAsDraft=true`.

### MCP-enabled test workflows

| Workflow | ID | Active | Current purpose |
|---|---|---:|---|
| `[3 TEST] TENDER — Обработать документ` | `2T7szFpiGcfNpKkB` | no | legacy calibration/runtime workflow, 60 nodes, current unpublished version `55664cef-…`; последние executions `14147–14158`, в клиентском 12-document run не участвовал |
| `[PROD CANDIDATE] TENDER — Обработать документ` | `csnDg78NzN1nIjUT` | yes | фактический Worker клиентского 12-document run; published active version `c5977af5-…` с 51-node execution graph, current unpublished draft `778dfb50-…` содержит 52 nodes; executions `14234/14238` воспроизводят `DW-17` |
| `[DW-17 MANUAL REVIEW — INACTIVE] TENDER — Обработать документ` | `8dEt6A8IwTybFuIq` | no | inactive/unpublished 71-node audit contour; current observed draft `62041fec-…`; executions `14374/14376` technical GREEN through readiness, semantic gate FAIL; Aggregator disabled |
| `[TEST CODEX] TENDER — Агрегация закупки` | `ftvmrEHoMbPOAqZG` | yes | published active `f11906df-…`; current unpublished draft `3654ec40-…` содержит 30 nodes и bounded recovery для exact-one omission; execution `14398` относится к прежнему active graph и завершился fail-closed на `9/10 candidate_decisions`; новый draft runtime не запускался |
| `[TEST CODEX] TENDER - Targeted Recheck` | `nI47FcgzYwGzwGqy` | yes | published active `13b3c124-…`; current unpublished draft `cf0f67f6-…` содержит только stitched-quote prompt hardening; execution `14398` до Targeted Recheck не дошёл |
| `[PDF TEST] TENDER — Генерация отчета` | `1dQTcUnE5JIcrEfI` | no | inactive 12-node source candidate; execution `14649` GREEN, `%PDF-`, 909642 bytes, 153 A4 pages, HTML preserved; visual review accepted; retained as promotion evidence |

MCP доступ включён только для тестового контура. Это не является разрешением менять production workflows.

### Report Generation PDF promotion checkpoint — 2026-09-07

```text
production Finalization cSsh9yjpS7t5p0OO
→ production Report Generation ckPnP3hRhKu4Mf9u
→ published version a6fbb0f6-eed0-4656-9c4c-de4bbc30aa3b
→ 12 nodes
→ report_html + report_pdf topology
```

Read-only live comparison подтвердил те же 12 node names, Code/HTTP logic и connections, что в tested candidate. Production UI export опускает только default values `mode=runOnceForAllItems`, `language=javaScript`, `authentication=none`, `fullResponse=false`, `neverError=false`; official node definitions подтверждают эти defaults. Это configuration-equivalent representation, не semantic drift. Production MCP access остаётся выключен.

Post-promotion execution намеренно не запускался. Поэтому статус разделён явно:

- published production topology — verified;
- isolated execution `14649` и visual PDF QA — verified;
- runtime конкретной production version `a6fbb0f6-…` — not verified yet.

Repository также содержит inactive local-only export `[TEMP] TENDER — Ручная загрузка файлов` (`tmpManual16726ZO`, 8 nodes). Несмотря на имя, его текущая роль — сформировать calibration fixture, зарегистрировать test run/documents и вызвать test Worker; это не production manual-upload feature.

### Forensic checkpoint — executions 14389 / 14390 / 14391

Owner-supplied read-only evidence фиксирует terminal chain:

```text
14389 parent (manual, error)
→ 14390 Aggregator (integrated, error)
→ claim ready_for_aggregation → aggregating
→ 14391 Targeted Recheck (integrated, error)
→ Проверить #2 evidence Targeted Recheck
```

Aggregator загрузил `1` completed document, `84` facts и `28` units, построил `27` grouped fields (`10` with candidates / `17` without), выполнил `10/10` Round 1 AI calls и направил `9` полей в Targeted Recheck; `evaluation_criteria` был единственным Round 1 `resolved`.

Targeted Recheck выполнил retrieval, prompt preparation и AI для `9/9` items (`9` calls; `170873 / 10448 / 181321` prompt/completion/total tokens). Первый failure — item `6/9`, `advance_contract_guarantee`, `doc_3_au_0024 / sb_0459`: AI создал structurally valid `requires_review/ambiguous_scope` candidate с `12` evidence, но `evidence[1]` stitched header и четыре несмежные table rows, пропуская промежуточные cells и labels `Строка R2…R5`. Exact deterministic error:

```text
[Targeted Recheck Evidence Validator] candidate[0].evidence[1]: quote отсутствует в semantic block после нормализации пробелов
```

Retrieval передал полный block корректно; первый неправильный state возник в `#2 AI Targeted Recheck v1`. Validator правильно отклонил quote и не меняется. Downstream Validator, Round 2, FINAL UPSERT и Finalization имели `0` runs; Targeted Recheck выполнил два DB read и `0` DB write. Цепочка создала `0` FINAL. Состояние run после claim считается `aggregating` по runData/inference, без отдельного DB query.

Live drift на этом checkpoint:

- Aggregator active graph уже `24` nodes/version `89b33d04-…`, тогда как local canonical — `38` nodes/version `1c9019de-…`;
- Targeted Recheck live — `64` nodes/version `4e0858c9-…`, local version — `7f82ae43-…`; owner comparison считает `63` local core nodes и одну live-only disconnected test-validator node, тогда как прямой parse repository JSON даёт `64` nodes. Это расхождение node-count convention не скрывается;
- main live validator удаляет `[C…]` table coordinates, local comparison использует whitespace-only normalization; noncontiguous omissions воспроизводят defect при обеих semantics.

Полный sanitized report: `evaluations/TARGETED_RECHECK_FORENSIC_14389_14391_2026-09-03.md`.

DW-21 implementation находится только на стороне пользователя и отсутствует в текущей Git branch. Owner-supplied выводы `14386/14387` приняты без повторного аудита: Docling прошёл, ActiveX `national_regime` с selected `Не применимо` был grounded, но overall mapping остался partial/unknown (`51 exact / 189 missing_owner / 50 conflicting`); attempts завершались `429` на Evidence Repair/fallback. Добавленный пользователем Wait не входит в этот branch.

### Forensic checkpoint — executions 14397 / 14398

- Lineage: `14396 manual ancestor → 14397 document-processing execution (DJtWSqTcUmQo0xWv) → document completed/readiness=true → 14398 test Aggregator ftvmrEHoMbPOAqZG → Проверить ответ Semantic Aggregator → ERROR`.
- Wiring теперь правильно ведёт в test Aggregator, не production.
- Downstream evidence: `1/1` completed document, `28` units, `65` persisted facts, readiness `all_documents_completed`. Полный internal `14397` runData недоступен (`404/502`), поэтому внутренние Docling/Extractor/fallback/Repair/Validator counts не independently verified.
- `14398`: atomic claim `ready_for_aggregation → aggregating`; `65` facts; `27` fields; `10` with candidates / `17` without; `10` AI responses.
- Первый incorrect node item — index `2`, `evaluation_criteria` (`field_index=12`). Модель `google/gemini-3.7-flash` вернула valid JSON и `9 candidate_decisions` при ожидаемых `10`. Exact error: `[Semantic Aggregator Validator] Ожидалось 10 candidate_decisions, получено 9 [line 144]`. Отсутствует ровно один allowed fact ID; duplicate/unknown IDs нет. `finish_reason=stop`, `completion_tokens=1029`, workflow `max_tokens=16384`: model omission при normal stop, не truncation/`429`/JSON parse.
- Validator корректно сработал fail-closed и не должен быть ослаблен.
- Targeted Recheck не вызван; новый unpublished prompt draft `cf0f67f6-…` не exercised. FINAL/Finalizer/27/27/report отсутствуют. Latest state `aggregating` inferred from runData, без DB `SELECT`; тот же run нельзя перезапускать без reset/retry policy.
- **Current blocker:** execution-14398 omission mitigated в local candidate и загружен только в unpublished test Aggregator draft `3654ec40-…`; published active version `f11906df-…` не изменена, новый draft runtime не проверен.
- **One next step:** отдельно авторизованный bounded runtime canary на test draft; публикация остаётся отдельным решением после runtime evidence.

## 3. Document Worker test candidate

### Read-only runtime and semantic audit — executions 14374 / 14376

Current observed test workflow state:

```text
workflow = 8dEt6A8IwTybFuIq
name = [DW-17 MANUAL REVIEW — INACTIVE] TENDER — Обработать документ
active = false
activeVersionId = null (unpublished)
nodes = 71
current observed draft = 62041fec-78c3-493a-9d2e-df648b51d1c9
Aggregator call = disabled
```

Existing executions `14374` and `14376` were audited read-only. Both succeeded through `12/12` Extractor recovery, `9/9` Validator dispatch, fact persistence parity, `document.status=completed` and `run.status=ready_for_aggregation`. The disabled Execute Workflow node produced no Aggregator child; 27/27 FINAL, Targeted Recheck, report and delivery were not exercised. n8n does not expose an immutable executed version ID for these executions, so the current draft ID is an observed state, not proof of their exact execution graph.

Technical runtime gate is **GREEN through readiness only**. Semantic gate is **FAIL**:

- `14374`: `46` facts / `179` evidence / `20 confirmed`, `13 requires_review`, `13 rejected`;
- `14376`: `42` facts / `171` evidence / `20 confirmed`, `13 requires_review`, `9 rejected`;
- exact grounding passed for all repaired evidence, but `doc_3_au_0012#0 / advance_contract_guarantee` relied on unresolved mutually exclusive DOCX options and was still confirmed;
- DOCX metrics stayed `647 normalized / 528 semantic / 290 controls / 126 resolved / 33 warnings` (`29` missing owner + `4` conflicting coordinates), with semantic status `unknown`;
- `analog_allowed` disappeared in `14376`, the `application_documents` fact/verdict qualification distribution changed, and `delivery_term` changed from `requires_review` to `rejected`; the aggregate audit does not assign a root cause for the `application_documents` change.

This is not production-ready. Exact details and sanitized repaired-unit tables: `evaluations/DOCUMENT_WORKER_SEMANTIC_AUDIT_14374_14376_2026-09-03.md`.

`DW-21` is now local GREEN. The canonical Worker derives exact control/label cells and typed direct question ancestry, binds each option group to one source and semantic owner, carries the proof separately from canonical text, and enforces universal fact-local applicability after every evidence path. A mapped selected option remains eligible for Validator; mapped unselected is deterministically rejected; missing/multiple/conflicting ownership stays `requires_review`, cannot be promoted by AI and keeps the original verdict/evidence/audit. The sanitized fixture preserves execution-derived topology without client text or a full DOCX. Focused `19/19`, Worker `255/252/3`, full suite `423/416/7`; all failures are exact pre-existing signatures.

**One next step:** review the local DW-21 candidate and its audit contracts. Only after explicit approval, run a bounded isolated Worker canary that exercises the corrected structural owner → Validator → persistence path. Aggregator remains disabled for that checkpoint.

### Aggregator candidate-decision omission recovery — local only — 2026-09-03

Execution `14398` established a typed Round 1 transport-contract failure: `evaluation_criteria` returned valid JSON with `finish_reason=stop`, but only `9/10` unique allowed `candidate_decisions`. The original deterministic validator remains unchanged and fail-closed.

The local canonical and beta exports now contain a bounded field-local contour: only an otherwise structurally consistent exact-one allowed-ID omission receives one repair call with the missing ID and full allow-list. The complete retry response passes a byte-identical strict checker. A second invalid response produces an audited technical `requires_review` with no accepted model decisions and continues through the existing FINAL normalizer/persistence path. Malformed JSON, unknown/duplicate IDs and role/list inconsistencies remain ineligible for retry and reach the original hard-fail checker.

This is offline implementation/test evidence only. Production n8n, live workflows, PostgreSQL, credentials, models and existing semantic prompts were not changed; runtime GREEN is not claimed. The next safe step is owner-operated packaging/promotion review followed by a separately authorized runtime canary.

В `[3 TEST]` реализованы:

1. bounded Evidence Repair и lossless Fact Partition;
2. одинаковая exact-grounding semantics на validation attempt 1/2;
3. audited deterministic rejection для pure exact-grounded `overlap_only`;
4. document-level dispatch:
   - `units_for_ai` при `verified_facts.length > 0`;
   - `units_without_ai` при `verified_facts.length === 0`;
   - exact unit-set convergence без per-unit Validator loop и без Merge;
5. `VALIDATOR_FIELD_PROFILES` версии `validator_field_profiles_v1` для ровно 27 canonical `field_key`;
6. hard error для unknown/missing Validator profile до HTTP;
7. fact-local material literal guard `fact_local_material_literals_v1`;
8. GLM 5.3 Flash low в тестовом Extractor;
9. Gemini 3.7 Flash low в тестовом AI Validator.

### Extractor model-selection checkpoint

На одинаковых 16 pinned units проверены:

```text
GLM 5.3 Flash low/high
GLM 5.2 low/without reasoning
Gemini 3.7 Flash low
GPT-5.6 Luna Pro low
GPT-5.4 Nano low
GPT-5 Mini low
DeepSeek V4 Flash 0731
```

По reliability-first приоритету текущим provisional baseline выбран:

```text
z-ai/glm-5.3-flash@provider=cloudflare&reasoning_effort=low
```

На model-selection checkpoint Gemini 3.7 Flash low был выбран benchmark fallback-кандидатом для bounded one-fallback contour; на тот момент runtime canary ещё не выполнялся. Поиск новых моделей на этом fixture остановлен; сводный evidence-backed отчёт находится в `evaluations/EXTRACTOR_MODEL_COMPARISON_2026-08-29.md`. Последующий bounded batch-first runtime gate закрыт execution `14367`; full-path Validator/persistence остаётся отдельным pending gate.

MCP read-back тестового Worker подтвердил атомарное изменение только `AI Extractor v1.0`: alias приведён с временного `@provider=deepinfra/fp8` к протестированному `@provider=cloudflare`; workflow остался inactive/unpublished, node count `60`, connections, settings, pin data и credentials не изменились.

Этот выбор подтверждает только сравнительный Extractor result. Full path Evidence Repair → AI Validator → persistence с выбранной связкой ещё требует отдельного runtime canary.

### Extractor envelope recovery checkpoint — local GREEN, runtime pending

Read-only diagnosis execution `14359` классифицировал все `16/16` primary GLM responses как nonrecoverable для deterministic attachment: каждый ответ нарушал обязательный exact `field_catalog_version` contract; часть ответов также не сообщала `schema_version` и/или `analysis_unit_id`. Сравнение exact request/system prompt и workflow version с canonical и последним known-good Extractor contract не выявило prompt/version drift. Root cause на этом execution — model contract noncompliance; безопасно attachable responses: `0/16`.

Canonical local Worker теперь имеет bounded recovery contour:

```text
persisted analysis unit
→ primary GLM multi-item batch → explicit attempt envelope → shared strict validator v3
→ Loop Over Items, batchSize=1
   ├─ accepted → primary attempt audit
   └─ exact allow-listed model contract failure → максимум один Gemini 3.7 Flash low fallback
      → explicit fallback envelope → тот же strict validator → fallback attempt audit
→ existing evidence repair / fact partition tails
→ Loop done-only cardinality/order/identity barrier
→ existing Validator dispatch and persistence
```

Primary/fallback transport и internal errors hard-stop; accepted primary items не вызывают fallback. Разрешены только семь typed primary model failures: invalid JSON, root contract, conflicting identity, field catalog, schema, fact contract и evidence contract. Safe deterministic attachment для отсутствующего `schema_version`/`analysis_unit_id` сохраняется только при exact catalog/root/source и полном strict facts/evidence validation. Audit bounded, не является evidence и не изменяет semantic fields.

Implementation chain: RED `dff07a9`, safe-attachment GREEN `507e12e`, recovery RED `581ed5c`, explicit-source RED `e690528`, fail-closed/parity RED `78935b8`, local GREEN `58556f6`. Focused recovery/envelope suite: `23/23`. Relevant Worker suite: `171 total / 170 pass / 1` accepted immutable-beta-hash failure. Full suite: `370 total / 364 pass / 6` exact accepted failures, без нового failure signature.

На local recovery checkpoint `58556f6` это ещё не было runtime GREEN: canonical candidate не promoted, production n8n/PostgreSQL/credentials не изменялись, paid AI на этом checkpoint не запускался. Последующий execution `14367` доказал fallback cardinality/order, максимум две попытки и strict acceptance на deliberately isolated path без partial persistence; canonical promotion и full-path Validator/persistence остаются pending.

### Primary Extractor batch-first latency recovery — bounded runtime GREEN, packaging pending

Runtime evidence локализует latency regression без изменения semantic contract: execution `14359` выполнил primary Extractor одним node run для `16` items примерно за `32` секунды; после переноса Loop перед Extractor execution `14362` выполнил `12` последовательных primary node runs за `423` секунды. Canonical local Worker возвращает primary transport до Loop:

```text
Подготовить запрос для AI
→ AI Extractor v1.0 (multi-item; options.batching.batch = 16 / 1000 ms, timeout=180000)
→ Связать primary Extractor response с source
→ Проверить и привязать evidence
→ Loop Over Items, batchSize=1
→ Primary Extractor accepted?
→ primary audit либо максимум один Gemini fallback
→ bounded evidence repair / fact partition
→ Loop done-only recovery barrier
→ existing collector / Validator / persistence
```

Primary transport по-прежнему `retryOnFail=false`, без error output или partial-persistence bypass. Regression tests статически фиксируют graph и симулируют wrapper mapping на непозиционной перестановке 16 distinct `pairedItem`, а также проверяют cardinality/order, fallback только invalid subset, максимум две попытки, недостижимость primary HTTP из loop body и недостижимость collector/Validator/persistence до done. Execution `14367` теперь отдельно подтверждает installed-runtime linked-item propagation и exact order на 12-item batch. Audit сохраняет совместимый `extractor_requests`, добавляет `extractor_fallback_requests`; total до AI Validator = primary + fallback + evidence repair + fact partition. Models, prompts, shared strict validator, fallback allow-list, evidence semantics, DOCX/ActiveX, Validator, PostgreSQL и 27-field contract не менялись.

Execution `14365` подтвердил отдельный platform-configuration defect до проверки batch-first runtime contract: установленный HTTP Request `4.4` завершился на `Cannot read properties of undefined (reading 'batchInterval')`. Live type definition требует `options.batching.batch.batchSize/batchInterval`, тогда как локальный candidate `66d5a8f`, этот документ и прежний regression ожидали flat `options.batching.batchSize/batchInterval`. Для platform parameter shape authoritative являются installed type/runtime; canonical JSON был текущей, но несовместимой реализацией. Execution-derived TDD теперь требует nested shape и запрещает flat keys для каждого реально batched Extractor HTTP node; значения `16 / 1000 ms`, timeout `180000` и все semantic/graph contracts сохранены.

RunData `14365` фиксирует один failed node run `AI Extractor v1.0`, но ошибка возникла до provider request: paid AI calls = `0`. Forbidden node runs = `0` для exact reviewed set: `AI Extractor fallback v1.0`, `AI Evidence Repair v1`, `AI Lossless Fact Partition v1`, `Собрать units после evidence validation`, `AI Validator v1`, все PostgreSQL nodes (`Захватить документ в обработку`, `Сохранить analysis unit`, `Сохранить факты документа`, `Завершить обработку документа`, `Проверить готовность к агрегации`) и `Call 'TENDER — Агрегация закупки'`. Это execution safety evidence до downstream, а не доказательство batch-first runtime behavior.

После отдельного owner-authorized draft-only исправления disposable clone execution `14367` закрыл bounded runtime batch-first gate: primary HTTP выполнился одним node run (`12` outputs, `4339 ms`), `pairedItem=0..11` сохранился через wrapper/decision/barrier, Loop дал `12` item runs + done, только `sanitized_au_0007` вызвал один fallback с exact `invalid_field_catalog_version`, barrier вернул `12` ordered items, summary — `accepted=true`, `paid_calls_observed=13`, cap `25`. Evidence Repair/Fact Partition и весь forbidden downstream имели `0` runs.

Граница этого GREEN узкая: Yq workflow — disposable inactive/unpublished clone с пятью canary nodes и barrier-only terminal, не production candidate. Persistence-facing `extractor_requests`, `extractor_fallback_requests` и `total_ai_requests_before_ai_validator` не materialized, потому что collector намеренно недостижим; runtime подтверждены summary counts и per-unit attempt audits. Canonical commit `2ffe1de` ещё не импортирован как clean candidate. Следующий gate — отдельный reviewed packaging/import canonical в новый inactive/unpublished candidate с exact read-back; full-path Validator/persistence test возможен только после отдельного разрешения.

Локальная verification на Node `v26.5.1`: focused recovery `21/21`, Extractor envelope `9/9`, evidence repair `79/79`; DOCX option-state `70 total / 69 pass / 1` unchanged baseline fixture-byte failure; все Worker tests `213 / 211 / 2`; полный suite после добавления текущего sanitized runtime-evidence regression `381 / 372 / 9` против непосредственно предшествующего `380 / 371 / 9`, с теми же девятью signatures и без нового failure. Managed sandbox не воспроизводит исторический exact-six runner: пять CLI/runtime assertions получают пустой child-process output из-за подтверждённого `spawnSync ... EPERM`, ещё один pre-change failure — byte-size mismatch source-derived DOCX fixture. Поэтому исторические шесть accepted failures, перечисленные ниже в `Verified`, остаются authoritative repository baseline, но literal `6` на этом runner не подтверждён. Bounded runtime batch-first gate закрыт; full-path metrics/Validator/persistence runtime GREEN не заявляется.

### Extractor recovery runtime diagnostic 14360 — blocked before AI

В isolated test Worker `pDTFwbq6B19qNAVI` был выполнен ровно один manual draft run на сохранённых PIN data, без publish. Временный canary contour статически имел zero reachability к PostgreSQL, Validator, persistence и Aggregator; его верхняя граница была `16` primary + до `16` fallback + до `16` mutually exclusive evidence-repair/partition calls (`<=48`). Фактически execution `14360` остановился до parser и AI, поэтому paid calls = `0`, PostgreSQL node runs = `0`.

Первый incorrect node — `Связать метаданные и файл`. Его pre-existing expression `$('Захватить документ в обработку').item.json` запросил paired-item ancestry для pinned, но не исполнявшейся в этом временном пути claim-ноды. n8n завершил node в `workflow-data-proxy getPairedItem`; это canary-harness linking defect, а не verdict по GLM/Gemini recovery contract. Live-патч и повторный run не выполнялись.

Временный graph восстановлен из approved snapshot `a9e13672-…` в draft `3016111f-…`: exact version comparison подтверждает равенство nodes/connections/nodeGroups, `71` nodes / `68` connection sources, отсутствие `[CANARY]` nodes, прежний pin-data SHA-256 и credentials. Published version `a7d04a95-…` не менялась. Runtime gate остаётся открытым: execution не дал ни primary decisions, ни fallback calls, ни barrier output. Sanitized audit: `evaluations/DOCUMENT_WORKER_EXTRACTOR_RECOVERY_CANARY_14360_2026-09-01.md`.

### Corrected pinned-claim canary 14361 — blocked before parser/AI

Один исправленный manual run подключил временный Webhook непосредственно к pinned `Захватить документ в обработку`, поэтому claim стал executed ancestor. Execution evidence подтвердил pin substitution: claim присутствовал в execution `pinData`, его output JSON exact совпал с сохранённым pin, а canary execution ID не был записан в claim output. `Связать метаданные и файл` после этого прошёл.

Новый первый incorrect node — `Подготовить DOCX archive alias`: node настроена как `runOnceForEachItem`, но line 1 вызывала `$input.first()`. Installed runtime execution `14361` hard-stop с `Can't use .first() here` до parser и AI; все AI nodes и все non-pinned PostgreSQL nodes отсутствуют в runData, поэтому paid calls = `0`, DB writes = `0`. Execution-derived TDD commits `bdba85e` / `a4c3853` сохранили per-item mode и заменили только current-item access на `$input.item`; focused `70/70`, Worker `203/201` с двумя известными baseline failures, full `371/365` с exact six accepted failures. Test draft и повторный run после local GREEN не выполнялись, поэтому runtime canary остаётся pending.

Временный draft восстановлен из `3016111f-…` в `b8a06968-…`; exact nodes/connections/nodeGroups равны, итог `71/68`, `[CANARY]` nodes отсутствуют, pin-data SHA-256/credentials/published `a7d04a95-…` неизменны. Stage 2 runtime gate всё ещё открыт. Sanitized audit: `evaluations/DOCUMENT_WORKER_EXTRACTOR_RECOVERY_CANARY_14361_2026-09-01.md`.

### Post-fix recovery canary 14362 — Loop complete, temporary barrier rejected

Approved local `$input.item` fix был синхронизирован только в isolated test draft и runtime прошёл прежний hard-stop: DOCX archive alias, OOXML parser, Docling normalization и подготовка units завершились. Execution `14362` обработал `12` units: `12/12` strict primary GLM decisions accepted, Gemini fallback `0`, Evidence Repair `5`, partition `0`, всего `17` paid calls при cap `<=48`. Loop выполнил `12` batches и done-run; non-pinned PostgreSQL nodes не исполнялись, DB writes `0`.

Первый incorrect node — временная canary-версия `Проверить полноту Extractor recovery`. Barrier искал `analysis_unit_meta.analysis_unit_id` в `[CANARY] Bypass analysis-unit persistence`, но bypass сохраняет pre-preparation shape с `analysis_unit`; все `12` unique IDs материализуются только следующей `Подготовить запрос для AI`. Hard-stop произошёл до bounded summary, Validator и persistence. Это canary-harness expected-ID source defect, не model-contract failure; live patch/retry/second run не выполнялись.

Normalizer runtime сохранил fail-closed `docx_option_state_semantic_status=unknown`, `33` warning groups и exact target bindings activeX5/6/7/8 → `#/tables/2`, activeX55/56 → `#/tables/25`. Final guarded-field behavior не доказан, потому что Validator/persistence были недостижимы. Draft восстановлен в `50f43b3d-…`, exact равный corrected rollback `0800032b-…`: `71/68`, no `[CANARY]`, `$input.item` сохранён, pin/credentials/published неизменны. Sanitized audit: `evaluations/DOCUMENT_WORKER_EXTRACTOR_RECOVERY_CANARY_14362_2026-09-01.md`.

Offline canary-contract TDD `b7b5987` / `b0255d1` теперь фиксирует правильную границу: persistence-bypassed barrier получает expected IDs только из post-materialization `Подготовить запрос для AI`, сохраняет exact order/cardinality и hard-fails missing/duplicate IDs. Focused `3/3`, recovery/envelope `26/26`, Worker `206/204` с двумя известными failures, full `374/368` с exact six baseline failures. На этом checkpoint это был harness-only GREEN; следующий runtime result зафиксирован ниже.

### Exactly-one fallback canary 14363 — temporary injector failed before strict classification

Offline injector TDD `921576b` / `73a93ce` зафиксировал generic first-post-materialization-ID selection, exact wrapper/source/order guards, target-only `provider_response` mutation и canonical `invalid_field_catalog_version` decision. Один согласованный manual run `14363` использовал isolated temporary draft `b96333fa-…`: `75/70`, только pinned claim среди reachable PostgreSQL, zero path к collector/Validator/persistence/Aggregator, pin/credentials/published unchanged, approved paid cap `<=33`.

Document path и `$input.item` снова прошли; Normalizer сохранил `290` controls, `126` parser-resolved, semantic `unknown`, `33` warning groups и target bindings activeX5/6/7/8 → `#/tables/2`, activeX55/56 → `#/tables/25`. `Подготовить запрос для AI` выдала `12` ordered unique units. После ровно одного primary GLM call temporary injector hard-stop: `structuredClone is not defined [line 46]`. Strict primary classifier, Gemini fallback, evidence retry/partition, Loop done, barrier и summary не запускались. Это offline-helper-versus-installed-Code-sandbox harness defect; production recovery verdict не получен. Live patch/retry/second run не выполнялись.

Единственный PostgreSQL-type run был pin-substituted claim, все non-pinned DB nodes = `0`, DB writes `0`. Restore создал draft `a62a7f29-…`, exact равный corrected `50f43b3d/0800032b`: `71/68`, no CANARY nodes, `$input.item`, pin SHA, 13 credential refs и published `a7d04a95-…` неизменны. Runtime recovery gate остаётся pending; Stage 4 не начат. Sanitized audit: `evaluations/DOCUMENT_WORKER_EXACTLY_ONE_FALLBACK_CANARY_14363_2026-09-01.md`.

Текущий `[PROD CANDIDATE]` Worker является отдельным live test contour и не равен ни `[3 TEST]`, ни canonical repository export. Перед исправлением `DW-17` или `DW-18` нужно сначала получить exact active/draft diff `c5977af5-… → 778dfb50-…` и определить назначение draft-only 52-й ноды; молчаливо редактировать draft как эквивалент execution `14234` нельзя.

### Runtime evidence

Execution `14104` подтвердил:

```text
66 analysis units
65 passed evidence attempt 1
1 passed bounded repair
20 units_for_ai + 46 units_without_ai = 66
61 persisted facts
41 confirmed / 2 requires_review / 18 rejected
```

Fact-local guard изменил ровно один AI verdict:

```text
doc_7_au_0001 / fact_index=4 / advance_contract_guarantee
confirmed → requires_review
missing literal: 30%
```

Pure `overlap_only` fact был сохранён как audited `rejected`, а не потерян и не отправлен в AI Validator.

### Offline production candidate packaging

Test/calibration workflow сохранён без изменений как immutable snapshot:

```text
workflows/n8n-exports/beta/[3 TEST] TENDER — Обработать документ.json
60 nodes
SHA-256: 02e4e5ccc761ecf78771c2ae4a3c4e529f3536533de2d9e7a5ef2084fe0459dd
```

Canonical path теперь содержит clean offline production candidate:

```text
workflows/n8n-exports/TENDER — Обработать документ.json
name = TENDER — Обработать документ
71 nodes after local DW-18 + Extractor recovery checkpoints
active = false
settings.availableInMCP = false
pinData = {}
```

Initial packaging удалил из beta девять test/calibration nodes. Последующие `DW-18` и Stage 2 checkpoints добавили только reviewed deterministic/recovery nodes и selective graph changes; beta→canonical regression разрешает именно этот перечисленный drift, сохраняя остальные parameters, credentials, types и runtime settings. Canonical persistence path подключён к done-only completeness barriers, Manual Trigger отсутствует, top-level `id`, `versionId` и `meta` удалены.

Это только import packaging: live production Worker `1Pw61ZY3HgBSvcUr` не изменён, candidate ещё не promoted/wired и runtime canary для него не выполнялся.

## 4. Aggregator semantic test mitigation

Execution-derived regression для `procurement_subject` показывает возможность schema-valid `false_resolved`:

- корректные candidates описывают закупаемые стандартные закрытия палуб;
- внутренний процесс поддержания технологического оборудования тоже пришёл как `confirmed`;
- текущий Round 1 checker проверяет IDs/cardinality/roles, но не может доказать semantic applicability;
- ложный AI response может выбрать внутренний процесс `primary` и сформировать FINAL.

Vulnerability остаётся production gate, но AG-8 теперь mitigated и verified в изолированном `[TEST CODEX]` workflow:

```text
universal procurement_subject FIELD_RULES
→ offline beta contract GREEN
→ MCP read-back workflow ftvmrEHoMbPOAqZG
→ один paid runtime canary на execution-derived fixture 14104
→ semantic oracle GREEN (6/6)
```

Runtime canary подтвердил:

```text
ai_called = true
checker_accepted = true
route = round1_final
final_status = resolved
doc_7_au_0031 = not_applicable
primary = doc_7_au_0001
semantic_oracle_passed = true
exit code = 0
```

The current beta artifact SHA-256 is `dc214110d3086d9e147f0b2c7fe983ee0e93543ca31f7d82c2c52ef3a1f04484`. On the exact `14104` fixture (SHA-256 `6392f9c882a211f20cf1f13777f7002b8c8628270d025df5fdf46492f2adbd75`), a request-model-only A/B accepted both GLM 5.3 Flash low and Gemini 3.7 Flash low with `round1_final` and a 6/6 oracle. Both assigned `doc_7_au_0031` `not_applicable`; GLM selected `doc_7_au_0001`, Gemini selected `doc_7_au_0008`.

GLM is the recommended Aggregator beta baseline for observed reliability/correctness/cost (0.08151487 RUB, 12911 ms, 3290 tokens); Gemini is the latency/provider fallback (0.25840089 RUB, 3711 ms, 3732 tokens). The detailed bounded comparison is `evaluations/AGGREGATOR_MODEL_COMPARISON_2026-08-29.md`.

Это **не** означает, что production исправлен: production Aggregator и canonical production export не менялись, production promotion test остаётся отдельным RED gate, а fresh 27/27 run ещё не выполнен. Backlog ID `AG-8` остаётся открытым до promotion и fresh full-run verification.

### `application_documents` execution 14173

Execution `14173` выявил отдельный schema-valid `false_resolved`: Round 1 включил в FINAL неоднозначные и не полностью подтверждённые требования, потерял существенные условия и расширил scope за пределы документов, подаваемых именно в составе заявки.

В `[TEST CODEX]` усилен только field-specific профиль `application_documents`. Execution-derived regression, neutral anti-overfit controls и route-aware oracle проходят offline. Paid runtime canary на точном beta artifact подтвердил безопасный результат:

```text
ai_called = true
checker_accepted = true
route = targeted_recheck
status = requires_recheck
recheck_reason_code = ambiguous_scope
final_status = null
false_resolved_prevented = true
semantic_oracle_passed = true
expected exit code = 3
```

Canary artifact SHA-256: `dc214110d3086d9e147f0b2c7fe983ee0e93543ca31f7d82c2c52ef3a1f04484`. HTTP `max_tokens` для beta runtime поднят `8192 → 16384` после подтверждённого `finish_reason=length`; model alias и timeout не менялись.

Это подтверждает только безопасную границу Round 1: ложный FINAL не создан. Полнота и окончательная семантика `application_documents` остаются не подтверждены до проверки Targeted Recheck. Production Aggregator и Targeted Recheck не изменялись.

### Targeted Recheck read-only audit and local TR-10 containment — 2026-08-30

Live workflow `9uDOU31DGo30fGXX` является authoritative production implementation: active, 64 nodes, version `4e0858c9-6ca2-42c7-969b-e74a2f91b8c6`. Canonical local export содержит 63 nodes/version `7f82ae43-2ddc-4568-8d76-a6d460c13924`; live-only node `Проверить #2 evidence Targeted Recheck ТЕСТОВАЯ` отключена от production path. До local containment параметры четырёх критических Round 2 нод совпадали между live и local:

```text
Собрать candidates для Round 2
Подготовить запрос #2 Semantic Aggregator
Проверить ответ #2 Semantic Aggregator
Сформировать FINAL после Round 2
```

Audit подтвердил сильные structural guards: evidence grounding, allow-list candidate linking, cardinality и hard error для malformed/empty AI response. Но LIVE для составного `application_documents` не имеет terminal completeness barrier: Round 2 может структурно принять частичный `resolved`, если один новый candidate подтверждён, хотя другие существенные clauses исходного набора не закрыты.

В local canonical candidate изменена только Code-нода `Проверить ответ #2 Semantic Aggregator`. После всех raw validations комбинация `tender_fields_v1 + Round 2 + application_documents + reported resolved` получает effective terminal `requires_review`, `review_reason_code=insufficient_evidence`, непустой universal note и audit policy `application_documents_round2_requires_review_v1`. `needs_recheck=false`; decisions, lists, provisional text, evidence и upstream audit сохраняются. Другие поля не затронуты, raw `application_documents/requires_review` сохраняет исходные reason/note.

Отдельный operational gap (`TR-11`): provider/checker failure fail-closed и не создаёт ложный FINAL, но текущая ветка не доказывает обязательный terminal field result или гарантированный alert. Это может оставить run незавершённым; исправление не смешивается с semantic regression.

Есть явное source conflict:

```text
FIELD_CATALOG.md: application_documents Round 2 = ❌
live/local Targeted Recheck: общий Round 2 profile реализован
```

`FIELD_CATALOG.md` остаётся authoritative для смысла поля, live workflow — для фактического production поведения, local canonical export — mutable promotion candidate. Каталог не изменялся.

`TR-10` mitigated/GREEN только в local canonical candidate. Immutable LIVE diagnostic продолжает воспроизводить partial `false_resolved`; production promotion/runtime result не подтверждены. Verdict готовности LIVE Targeted Recheck к автоматическому клиентскому отчёту остаётся `REJECT`.

### Targeted Recheck execution 14256 / TR-12 draft checkpoint — 2026-08-31

Execution `14256` подтвердил fail-closed prompt/checker mismatch: prompt разрешал exact evidence из `EXISTING CANDIDATES`, а evidence checker доверял только `allowed_semantic_blocks`. В local canonical export checker теперь строит exact trusted union и допускает только однозначное исправление `analysis_unit_id` при неизменных `semantic_block_id` и normalized exact quote; prompt явно запрещает изобретать или перепечатывать coordinates. Полная итоговая prompt-версия сохранена в `prompts/targeted-recheck-extractor-system-prompt-v1.1-2026-08-31.txt`.

Offline exact-execution harness сохранил 43/43 evidence для `application_documents`, принял 25 exact existing-only references и записал один audit repair `doc_3_au_0007 → doc_3_au_0006` для `sb_0227`. Все пять child items прошли реальный checker; текущая Validator preparation сохранила 43 evidence и repair audit. Related suite: `62/62`; полный offline suite: `208 total / 207 pass / 1 intentional AG-8 RED`.

После local GREEN обновлён только unpublished draft тестового workflow `nI47FcgzYwGzwGqy`:

```text
draft versionId = bca1746c-abcb-4490-a455-1daa6ac22092
activeVersionId = d74f1f17-c80f-4499-bf56-b0f7daab594b (unchanged)
prepare local/live SHA-256 = acb91d5136a0e063359bc36493dca6bcf60c04e490022a7728324cf5c8190ab3
checker local/live SHA-256 = 74c32f4d85b91e17665846346e02df492d827f7c86ddf70313627b4d8f064138
nodes = 63; graph/connections/credentials/settings/pinData unchanged
```

После независимого review версия `bca1746c-abcb-4490-a455-1daa6ac22092` опубликована только в тестовом workflow; `draft=active`. Это всё ещё **не runtime GREEN** до PIN-data canary. Production Targeted Recheck, PostgreSQL и credentials не изменялись; paid AI на этом checkpoint ещё не запускался.

### Test-only Aggregator E2E PIN runner — published, not executed — 2026-08-31

Для прямого запуска test Aggregator с Execute Workflow Trigger опубликован изолированный test harness:

```text
body: gsoPfP4PSjcJjPfa@18c770bb-70b5-4448-b3a5-d251057ea343
truthful replay Report: b4Ga1PoFmlS5ep6Y@8570c7ac-b01a-4421-a2e1-454e85cc7173
Webhook controller: U0S3Oyq5pYfiWVDE@90a69f3b-9c26-46a5-9fba-cb96eee23105
POST /webhook/test-codex-tender-aggregator-e2e-3caa7a89
```

Body fail closed принимает только exact audited contract для run `3caa7a89-b137-4cf6-b23d-941fb465c8f9` и двух сохранённых PIN payload. Он не повторяет atomic claim SQL, а inject-ит сохранённый claim output; все 22 business nodes и connections после claim совпадают с test Aggregator. Test Targeted Recheck, реальные LLM, FINAL persistence и production Finalization остаются в downstream graph.

Controller проверяет lifecycle и exact 27/27 DB barrier до/после body. Первый run со статусом `aggregating` оставляет единственный report production Finalization. Повторы уже `completed` используют отдельный test-only Report replay с truthful `completion_claimed=false`, `finalization_state=already_completed` и explicit authorization; восемь последующих Report nodes и connections совпадают с production Report.

Offline runner regression `8/8 PASS`; published structural parity: body `22/22`, Report downstream `8/8`, controller не вызывает production Report напрямую. Prompts не менялись. Paid E2E ещё не выполнялся; controller является временным публичным test endpoint и должен быть снят с публикации после серии испытаний.

#### Execution 14257 launch regression checkpoint

Первый canary controller `14257` / child body `14258` завершился fail-closed до LLM и downstream DB writes: body guard вернул `RUNNER_CONTRACT_MISMATCH`. Child trigger получил ровно 11 declared fields, но guard ошибочно сравнивал их с 9-полевым external request и не учитывал обязательные `controller_execution_id/contract_validated`.

Минимальный TDD fix опубликован только в test body/controller:

```text
body gsoPfP4PSjcJjPfa@18c770bb-70b5-4448-b3a5-d251057ea343
controller U0S3Oyq5pYfiWVDE@90a69f3b-9c26-46a5-9fba-cb96eee23105
```

Body guard теперь проверяет exact 11, numeric controller execution ID, `contract_validated=true` и hard-fail для missing/unknown keys. Lifecycle для post-run ownership читается отдельно из pre-run DB node. Изменены параметры одной body Code node и трёх controller Code nodes; topology, SQL, Aggregator/Targeted Recheck/Finalization/Report и prompts неизменны. Runner regression `10/10 PASS`; полный основной suite `218 total / 217 pass / 1 intentional AG-8 RED`. Повторный canary ещё не выполнялся.

## 5. Test status

### E2E PIN canary 14259 — technical success, semantic REJECT

Полная test chain завершилась:

```text
controller 14259 = success
Aggregator body 14260 = success
Targeted Recheck 14261 = success
completion-owning Finalization 14267 = success
Report 14268 = success; HTML artifact created
DB run = completed; exact 27/27
```

Semantic audit: `25/27 acceptable (92.6%)`, но найдены два critical `false_resolved`: `participation_guarantee` не устанавливает фактическую применимость/размер обеспечения заявки, а `required_official_certificates` неполно ограничен налоговой справкой при наличии обязательных ЕГРЮЛ/ЕГРИП и иных official documents в grounded facts. Critical `false_not_found` не обнаружены.

Verdict остаётся `REJECT` до минимального containment этих двух полей. Три confirmation runs не начаты. Подробный runtime audit: `evaluations/TENDER_E2E_PIN_CANARY_14259_2026-08-31.md`.

### AG-10 / TR-13 execution-derived containment — historical offline checkpoint

На fixture из body execution `14260` подтверждено, что оба critical поля проходили structural checks, но не имели независимого доказательства применимости/полноты. Минимальный field-specific containment добавлен без изменения prompts и без ослабления schema/linking/cardinality guards:

```text
Aggregator Round 1 reported resolved
→ effective requires_recheck / insufficient_evidence

Targeted Recheck terminal Round 2 reported resolved
→ effective requires_review / insufficient_evidence
→ needs_recheck=false / requires_human_review=true
```

Provisional value, candidates, evidence и reported/effective audit сохраняются. Изменены только unpublished test drafts:

```text
Aggregator ftvmrEHoMbPOAqZG
draft 91c17313-a593-4fb9-9072-79320a958dd7
active 01ff5e9d-30d2-4530-b2ff-4513224e9056

Targeted Recheck nI47FcgzYwGzwGqy
draft c43b4ed3-c384-41e9-b1d9-3636cff42ac5
active bca1746c-abcb-4490-a455-1daa6ac22092

E2E body gsoPfP4PSjcJjPfa
draft 7566262e-4c7a-4483-a5cd-9bdfd81a95aa
active 18c770bb-70b5-4448-b3a5-d251057ea343

E2E controller U0S3Oyq5pYfiWVDE
draft 03ac36e0-c4f8-44ea-bd52-bf41d5425012
active 90a69f3b-9c26-46a5-9fba-cb96eee23105
```

На этом историческом checkpoint live read-back подтвердил parameter-only diff четырёх Code nodes, неизменную topology и exact body downstream parity `22/22`. Позже drafts были опубликованы и проверены canary `14279`, описанным ниже.

### E2E PIN canary 14279 — technical and semantic GREEN

Test drafts опубликованы и новый canary завершился до HTML report:

```text
controller 14279 = success
Aggregator body 14280 = success
Targeted Recheck 14281 / 14285 = success
Report replay 14289 = success
DB = exact 27/27
16 resolved / 7 requires_review / 4 not_found
semantic audit = 27/27 acceptable
critical false_resolved = 0 observed
critical false_not_found = 0 observed
```

`participation_guarantee` и `required_official_certificates` теперь безопасно `requires_review`. HTML artifact валиден (`484540` bytes). Предыдущий attempt `14269` не засчитывается: replay `14278` fail-closed обнаружил stale source version UUID; TDD fix опубликован как `b4Ga1PoFmlS5ep6Y@80ad3549-998f-41a0-a973-f02ef5eae46a`, downstream parity `8/8`. Prompts не менялись. Audit: `evaluations/TENDER_E2E_PIN_CANARY_14279_2026-08-31.md`.

Canary gate пройден; три consecutive confirmation runs ещё pending.

### Confirmation attempt 14290 — fail-closed, серия 3/3 не начата

Первый post-canary confirmation attempt не засчитывается:

```text
controller 14290 = error
Aggregator body 14291 = error
Targeted Recheck 14292 = error
Report = не создан
```

Первый некорректный terminal state возник в `Проверить #2 evidence Targeted Recheck`: для `results_date` модель привязала точную цитату к неверной паре `doc_2_au_0002/sb_0048`, хотя цитата находится в trusted block `doc_2_au_0001/sb_0004`. В том же execution три других ответа нарушили extractor envelope/schema contract (`participation_guarantee`, `required_official_certificates`, `application_documents`). Checker корректно остановил workflow; provider/balance error не обнаружен.

Повторные paid runs приостановлены до TDD-fix: deterministic model-contract/evidence failure должен сохраняться в audit и завершать поле как technical `requires_review`, не принимая unvalidated candidate и не допуская `not_found`. Текущая последовательная серия остаётся `0/3`; canary `14279` сохраняется как отдельное успешное доказательство.

### Execution 14292 technical fallback — offline GREEN, test publish complete

Execution-derived TDD охватывает все семь AI envelopes `14292`. Четыре model contract/evidence violations теперь дают `technical_fallback_required=true`, `evidence_validated=false`, пустой validated candidate set и отдельный terminal `requires_review`; валидные ответы и валидный `insufficient_evidence → not_found` сохраняют прежнюю семантику. Неизвестные programming errors и отсутствующие upstream invariants продолжают hard-fail.

Root verification в authoritative main checkout: focused/related `60/60`, full suite `246 total / 245 pass / 1 intentional AG-8 RED`, graph `64/64` unique nodes, secret scan clean. Test Targeted Recheck `nI47FcgzYwGqy@13b3c124-4fef-4a6f-9d5f-8befa3725bc1` опубликован; production workflows/DB и prompts не изменялись. Следующий gate — fresh E2E canary; confirmation series остаётся `0/3` до его успешного semantic audit.

### Fresh post-fix canary 14294 — technical and semantic GREEN

```text
controller 14294 success
Aggregator body 14295 success
Targeted Recheck 14296 / 14300 success
Report replay 14303 success
HTML valid: 482829 bytes
DB exact 27/27: 16 resolved / 6 requires_review / 5 not_found
semantic audit: 27/27 acceptable
critical false_resolved / false_not_found: 0 observed
```

Новый technical fallback в этом canary не потребовался: все Extractor envelopes/evidence были валидны. Единственное отличие статусов от `14279` — `government_contract` стал безопасным `not_found`: audit прямо фиксирует упоминание только upstream State Contract, отсутствие доказательства статуса текущего договора и запрет отрицательного вывода. Preflight `14293` исключён как root invocation-shape error, остановленный controller до body/LLM. Audit: `evaluations/TENDER_E2E_PIN_CANARY_14294_2026-08-31.md`. Confirmation series готова к старту с `0/3`.

### Consecutive confirmations — 1/3 GREEN

Confirmation 1 завершён цепочкой `14304 → 14305 → 14306/14310 → 14313`: все executions success, exact DB `27/27`, HTML valid `476893` bytes, semantic audit `27/27 acceptable`, zero observed critical false statuses. Распределение `16 resolved / 6 requires_review / 5 not_found`; strict checker принял все model responses, technical fallback не потребовался. Audit: `evaluations/TENDER_E2E_PIN_CONFIRMATIONS_2026-08-31.md`.

Confirmation 2 завершён цепочкой `14314 → 14315 → 14316/14320 → 14324`: все executions success, exact DB `27/27`, HTML valid `477940` bytes, semantic audit `27/27 acceptable`, zero observed critical false statuses. Распределение `16 resolved / 7 requires_review / 4 not_found`; `government_contract` безопасно вернулся в `requires_review/ambiguous_scope`. Consecutive count: `2/3`.

Confirmation 3 завершён цепочкой `14325 → 14326 → 14327/14331 → 14335`: все executions success, exact DB `27/27`, HTML valid `481901` bytes, semantic audit `27/27 acceptable`, zero observed critical false statuses. Распределение `16 resolved / 7 requires_review / 4 not_found`; `application_review_date` консервативно понижен в `requires_review`, а неполный `required_official_certificates` не был материализован как resolved.

Итоговая consecutive series: `3/3 GREEN`. Критерий текущей test PIN-data задачи выполнен. Это не означает автоматическую production promotion всех test candidates.

Temporary public controller `U0S3Oyq5pYfiWVDE` успешно unpublished после серии. Его draft/version `03ac36e0-…` сохранён для audit, но `activeVersionId=null`; внешний webhook больше не должен принимать production-вызовы.

Final verification после unpublish временного controller:

```text
246 tests
245 passed
1 failed
```

Единственный падающий test — намеренный `AG-8` production promotion gate. Focused E2E runner suite проходит `11/11`; live verifier подтверждает exact active versions/parity body, replay Report, source Aggregator и Targeted Recheck, а controller имеет `active=false`, `activeVersionId=null`. `git diff --check` не обнаружил whitespace errors (только ожидаемые предупреждения Git о будущей нормализации LF/CRLF).

Этот checkpoint не является release-ready или production-ready состоянием.

### Preliminary client report checkpoint 14336 / 14345 — partial and not client-final

После test PIN confirmation series пользователь вручную запустил текущий test Aggregator на том же сохранённом run:

```text
analysis_run_id = 3caa7a89-b137-4cf6-b23d-941fb465c8f9
Aggregator 14336 = success
Targeted Recheck 14337 / 14341 = success
Finalization calls 14338–14343 = success
test Report replay 14345 = success
```

Получен HTML по 27 полям и локально создан предварительный A4 PDF. Это не clean 12/12 run: документ `Приложение_к_Блоку_7._ИТТ.pdf` ранее был вручную переведён в `failed`, run агрегирован как `11 completed / 1 failed`, а report replay использовал уже существующий 27/27 DB snapshot.

Сравнение с исходными документами и краткой справкой сотрудника подтвердило:

1. площадка определена корректно: ЭТП ГПБ — основная площадка, «Стратег» — отдельная закрытая секция;
2. `national_regime` в отчёте является P0 `false_resolved`: оригинальный DOCX явно выбирает `Не применимо`, но pipeline потерял selected state и принял общие положения ПП 1875 как доказательство применимости;
3. `participation_guarantee` безопасно остался `requires_review`, но оригинальный DOCX явно выбирает `Не предусмотрены`; selected negative также потерян;
4. сумма `24 900` для `participation_cost` отсутствует в предоставленных DOCX, text-readable PDF, OCR execution `14234` и пустом TenderMeta. Найденное `Плата не предусмотрена` относится к плате за предоставление документации, а не к тарифу ЭТП.

Root cause для пунктов 2–3 подтверждён в source OOXML: отметки реализованы ActiveX controls (`w:control` и связанные `word/activeX/*`), тогда как semantic blocks содержат option labels без selected/unselected state. Это отдельный P0 `DW-18 / AG-11`; он не закрыт containment-серией `3/3`, потому что та воспроизводила уже сохранённые Aggregator PIN data после parsing.

Предварительный PDF допустим только с явным сопроводительным предупреждением об `11/12`, OCR gap и известных корректировках. Автоматически клиентским финальным отчётом его считать нельзя.

## 6. Verified / not verified

### Verified

- execution-derived Document Worker regressions `14006–14017`, `14059`, `14061`, `14075`, `14103`, `14104`;
- exact evidence grounding не заменено fuzzy/OCR matching;
- lossless fact partition и item linking покрыты offline tests;
- `DW-17` reference-only Evidence Repair v2 локально проходит focused `99/99`: identity-safe refs (включая одинаковый text в разных blocks), byte-identical catalog rebuild/parity, separate structural units, deterministic source-only materialization, lossless grounded-evidence merge, synchronized diagnostics, incremental catalog/source/request bounds, ref/collision rejection, table canonicalization и terminal exhaustion; Primary/Validator/persistence/graph не менялись. Safe sanitized fixtures `14234`/`14238` в repo/history отсутствуют, их exact replay, promotion и runtime canary остаются pending; `14371` покрыт только synthetic non-replay structure;
- execution `14373` локализовал отдельный post-repair barrier defect: persisted Save output имеет top-level `analysis_unit_id`, тогда как `Проверить полноту Extractor recovery` ожидал nested `analysis_unit_meta.analysis_unit_id`. Canonical local repair меняет только этот access; sanitized `12/12` regression и все cardinality/order/identity/audit negative guards GREEN. Focused combined suite `132/132`; full file-isolated suite сохраняет baseline parity `23 files / 19 pass / 4 fail` против base `22 / 18 / 4`;
- executions `14374/14376` runtime GREEN through readiness: `12/12` recovery, `9/9` Validator dispatch, exact fact persistence parity, document completion and `ready_for_aggregation`; disabled Aggregator created no child execution;
- reference-only repair exact grounding PASS, with sanitized repaired-unit audit recorded for both executions;
- Validator field profiles покрывают ровно 27 canonical keys;
- fact-local material literal guard не использует соседние facts или общий context как evidence;
- Aggregator candidate SQL по-прежнему исключает `rejected` и включает `confirmed`/`requires_review`;
- Aggregator route-aware harness не материализует Round 1 FINAL для `requires_recheck`;
- AG-8 offline beta contract, MCP read-back и один paid runtime canary execution-derived case `14104` прошли GREEN;
- runtime canary назначил `doc_7_au_0031` роль `not_applicable`, выбрал `doc_7_au_0001` primary и прошёл 6/6 semantic oracle checks.
- exact beta `14104` A/B accepted GLM and Gemini with the same safe scope decision; GLM is the beta baseline and Gemini is fallback only.
- `application_documents` execution `14173` воспроизводит production false-resolved как diagnostic control;
- beta field-specific boundary и neutral controls для `application_documents` проходят offline;
- paid runtime canary точного beta artifact безопасно выбрал `targeted_recheck/ambiguous_scope`, не создал Round 1 FINAL и прошёл route-aware oracle;
- read-only refresh live Targeted Recheck подтвердил active version `4e0858c9-…`, 64 nodes и точное совпадение параметров четырёх core Round 2 нод с local export;
- deterministic Targeted Recheck guards fail closed по schema/cardinality/linking/evidence; это не доказывает semantic completeness составного FINAL;
- mutable canonical Targeted Recheck gate детерминированно понижает `application_documents` Round 2 reported `resolved` до effective terminal `requires_review/insufficient_evidence`, сохраняя audit/evidence;
- neutral `procurement_subject/resolved` и raw `application_documents/requires_review` controls проходят без containment;
- execution-derived `AG-10/TR-13` containment для `participation_guarantee` и `required_official_certificates` проходит offline tests и не ослабляет universal structural guards;
- E2E runner drafts сохраняют exact post-claim Aggregator parity `22/22` после переноса containment;
- immutable Document Worker beta snapshot сохранён, но его старая expected-hash assertion остаётся принятым pre-existing RED baseline;
- canonical Document Worker JSON сохраняет beta packaging вне reviewed `DW-18` nodes; соответствующая selective packaging regression проходит.
- executions `14336`, `14337`, `14341` и report replay `14345` успешно завершили сохранённый partial `11/12` contour до HTML;
- визуальный и OOXML audit исходного `Блок_2_Информационная_карта.docx` подтвердил explicit selections `national_regime = Не применимо` и `participation_guarantee = Не предусмотрены`;
- Aggregator execution `14336` подтвердил первый incorrect terminal state для `national_regime`: Round 1 accepted `resolved` по generic/conditional PP 1875 candidates;
- Targeted Recheck `14337` корректно зафиксировал `insufficient_evidence` для `participation_guarantee`, потому что его context уже не содержал option-state.
- `DW-18` source-derived nested-table fixture и 61 focused regression offline подтверждают standards-based OOXML relationships → bounded CFB → MS-OFORMS parsing: controls 5/6/7/56 cleared, 8 selected `Не применимо`, 55 selected `Не предусмотрены`; parser input загружается из checked-in OOXML независимо от manifest; malformed/orphan/cyclic/out-of-range structures и unsafe archive paths fail closed.
- executions `14350–14352` локализовали три runtime gaps прежнего canonical candidate: split `directory + fileName`, потерю `docx_part_path/docx_part_kind` после Extract From File/XML и ancestor-table duplicate mapping (`578 controls / 126 decoded / partial`). Canonical Worker исправляет только эти boundaries и сохраняет настоящую ambiguity fail-closed.
- execution `14359` локализовал следующий первый incorrect state после корректного raw parser: global label-only normalizer не связывал selected state с нужным semantic owner при повторяющихся labels. Stage 1 TDD checkpoints: RED `4f6f23f`, GREEN `a5a1cb7`, Critical RED `e7e1987`, Critical GREEN `3643b29`, fixture-geometry correction `e8db92b`.
- exact read-only replay полного input execution `14359` после local fix подтвердил: activeX5/6/7/8 привязаны только к `#/tables/2` как `unselected/unselected/unselected/selected`, activeX55/56 — только к `#/tables/25` как `selected/unselected`. Replay остаётся fail-closed: `docx_option_state_semantic_status = unknown`, `33` warning groups и semantic owners только для `83/290` controls; guarded fields должны оставаться `requires_review` до post-fix canary.
- Worker semantic chain offline сохраняет option-state/audit до `validator_meta`, исключает exact-grounded unselected guarded facts, ограничивает unknown/indeterminate review-only и не разрешает AI Validator создавать новые facts.
- `DW-21` local TDD replaces the field-specific guard with universal fact-local structural ownership: real parser refs, unique question/group/source/semantic owner, AI-visible mapped proof, lossless primary/fallback/repair propagation, quote-only lexical matching and a post-AI cap all pass `19/19`; the full suite adds no failure signature.
- `AG-11` offline matrix проходит `31/31`: positive `national_regime/resolved` требует confirmed primary и exact-bound structured applicability proof; generic/conditional ПП 1875 clauses без proof понижаются до effective `requires_recheck/insufficient_evidence`.
- test Aggregator `ftvmrEHoMbPOAqZG` обновлён только в draft `f11906df-f760-4c54-a59e-16f4423ab534`: read-back 24 nodes, ровно три изменённые AG-11-ноды, connections сохранены, unexpected drift отсутствует. Published active остаётся `91c17313-a593-4fb9-9072-79320a958dd7`.
- fresh Stage 1 branch verification: focused `DW-18 69/69`; full suite `347 total / 341 pass / 6 fail`. Все шесть RED совпадают с принятым baseline: `RED actionable: procurement_subject FIELD_RULES contain the universal current-scope boundary`; `RED A/B runtime report contains the full execution, artifact, response, oracle, and exit audit`; `RED A/B harness refuses canonical production workflow and preserves fixture and beta SHA-256`; `immutable beta Worker snapshot retains its reviewed packaging hash`; `v1.2 prompt artifact is an exact clean copy of the imported validator system prompt`; `Targeted Recheck prompt aligns evidence coordinates with both trusted sources`. Новых failures нет.
- Stage 2 exact execution diagnosis подтвердил `0/16` safely attachable primary responses без prompt/version drift; local recovery chain `dff07a9 → 507e12e → 581ed5c → e690528 → 78935b8 → 58556f6` сохраняет strict validator parity, делает максимум один Gemini fallback и допускает persistence только после done-only completeness barrier. Focused `23/23`; relevant Worker `171/170` с единственным known beta-hash failure; full `370/364` с теми же шестью baseline failures.

### Not verified

- promotion/wiring clean Document Worker candidate в test/production contour;
- immutable execution-version attribution for `14374/14376`; current draft `62041fec-…` is observed state, because n8n metadata did not return an exact executed version ID;
- runtime semantic applicability after exact grounding: the local `DW-21` regression/fix is GREEN, but no post-fix execution has yet proved that unresolved ownership for the `doc_3_au_0012#0 / advance_contract_guarantee` class is capped through live Validator/persistence;
- stable extraction across repeated runs: `analog_allowed`, the `application_documents` fact/verdict qualification distribution and the `delivery_term` verdict differed between `14374` and `14376`; root cause for the `application_documents` change is not established;
- full runtime canary beyond Document Worker readiness: Aggregator was disabled, so 27/27 FINAL/report/delivery remain unverified;
- production promotion Aggregator AG-8 boundary;
- production promotion `application_documents` boundary;
- promotion и runtime canary local Targeted Recheck candidate в LIVE contour;
- terminal production Targeted Recheck и окончательный полный FINAL для `application_documents` после safe deferred route;
- terminal error/alert semantics для provider/checker failure в Targeted Recheck;
- полный clean run новой закупки от Orchestrator до нового отчёта после текущего hardening;
- причина и дальнейшая судьба unpublished 24-нoded production Aggregator draft;
- ручная бизнес-проверка всех 27 полей клиентского результата.
- post-fix runtime extraction/preservation DOCX ActiveX state в isolated Worker candidate; executions `14350–14352` являются pre-fix diagnostic evidence, а не GREEN canary;
- post-fix runtime verification bounded Extractor fallback: execution `14359` остаётся `0/16` safely attachable по primary evidence, а local GREEN `58556f6` ещё не доказывает успешный Gemini fallback, exact batch convergence или отсутствие partial persistence в n8n runtime;
- isolated execution `14360` не закрыл этот gate: canary harness остановился до AI на missing paired-item ancestry в `Связать метаданные и файл`; следующий run допустим только после отдельного reviewed source-carry design, который не зависит от `.item` к pinned-but-unexecuted claim node;
- corrected pinned-claim execution `14361` выявил hard-stop в `Подготовить DOCX archive alias`, а execution `14362` подтвердил `$input.item` fix и завершение `12` recovery loop items; temporary barrier source исправлен только offline TDD `b7b5987` / `b0255d1`, live draft не обновлялся и повторный canary не выполнялся;
- reproducible sanitized full-payload replay для semantic binding execution `14359`: checked-in regression намеренно сокращён до `6` controls и `4` meaningful tables, хотя отдельно хранит observed source counts (`290` controls, `64` raw tables, `6` raw body children, `647` normalized blocks, `528` semantic blocks). Перед promotion нужен воспроизводимый sanitized full-payload replay либо точное переименование fixture/replay contract, исключающее впечатление полного replay;
- published/runtime verification Aggregator fail-closed applicability boundary; `AG-11` пока находится только в test draft и offline GREEN;
- grounded внешний источник для суммы `participation_cost = 24 900`; в текущем source bundle это значение не подтверждено;
- финальный клиентский отчёт без известных `national_regime`/option-state расхождений.

## 7. Canonical export drift

На snapshot date exports имеют разные роли:

- `workflows/n8n-exports/beta/[3 TEST] TENDER — Обработать документ.json` — неизменяемый 60-node test/calibration snapshot;
- Document Worker canonical path — clean inactive 71-node offline candidate с `DW-18` и bounded Extractor recovery, без instance identity и test state;
- test Aggregator published active `91c17313-…` содержит execution-derived `AG-10`; unpublished test draft `f11906df-…` добавляет ровно три `AG-11` parameter changes без connection drift;
- test Targeted Recheck published active `13b3c124-…` содержит `TR-10/TR-13` containment и audited technical `requires_review` fallback для execution `14292`;
- 24-нoded production Aggregator draft не опубликован и соответствует очищенному core graph без disabled legacy/test nodes;
- защищённые workflow JSON не изменялись автоматически в рамках этого checkpoint.

Для production поведения authoritative остаются live published workflows: локальный Document Worker candidate ещё не promoted и не прошёл runtime canary. Перед любой promotion нужен повторный live read-back; молчаливо подменять published workflow локальным candidate нельзя.

## 8. Next checkpoint criterion

Следующий статус можно считать лучше текущего только после:

```text
DW-18 / AG-11 execution-derived RED на исходном DOCX (14350–14352)
→ canonical runtime hardening + offline deterministic contract (61/61 GREEN)
→ execution 14359 semantic binding: structural local owner + bounded fail-closed audit (69/69 GREEN)
→ execution 14359 Extractor envelope: 0/16 safely attachable primary; bounded one-fallback local contract (23/23 GREEN)
→ sanitized full-payload replay или точное переименование сокращённого replay contract
→ read back and update isolated Worker candidate `csnDg78NzN1nIjUT`
→ Worker/Aggregator runtime canary на national_regime и participation_guarantee
→ DW-17 reference-only evidence repair для failed OCR document
→ clean 12/12 document run from Orchestrator
→ exact 27/27 FINAL
→ ручная клиентская проверка и отправка отчёта Дмитрию
```

Текущий test PIN-data contour готов по согласованному gate: fresh canary и три последовательных подтверждения дошли до отчёта, каждый semantic audit дал `27/27 acceptable` и zero observed critical false statuses. Ограничение: это replay сохранённых Aggregator PIN data, сформированных после ранее согласованного обхода одного failed документа; это не новый clean full run всех `12/12` документов.

Immediate business state: предварительный отчёт можно отправить Дмитрию только как partial `11/12` с перечислением известных ограничений. Технический следующий шаг для Hermes — не новый model benchmark, а promotion-grade sanitized full-payload replay и post-fix Worker/Aggregator canary `DW-18 / AG-11`; local Stage 1 GREEN не является production runtime GREEN.
