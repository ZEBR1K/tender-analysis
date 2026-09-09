# TENDER — TenderPlan Mark Intake

Inactive repository candidate for polling the current members of one configured TenderPlan mark every 10 minutes.

## Confirmed source contract

The configured mark is `6a732cd00c61629cf1d3c144`, label «Проверить». Execution `14683` of inactive disposable workflow `JraLbsWe59YXq0jc` is runtime GREEN for the read-only relation endpoint:

```text
GET /api/tenders/v2/getlist?type=1&id=6a732cd00c61629cf1d3c144
```

A tender may be present both at `tender._id` and `tenders[]._id`. Execution `14743` confirmed that `_id` is the internal 24-character TenderPlan identifier used by FullInfo, while `tender.id` may instead contain an external value such as a procurement number plus type suffix. Normalization validates `_id`, deduplicates it, and emits no source payload.

After that fail-closed diagnostic run, corrected inactive-candidate execution
`14744` completed successfully and asynchronously started Intake execution
`14745`. The stable event was already present, so Intake returned
`duplicate_event` with the existing `analysis_run_id`; the canary window contained
no Orchestrator, Document Worker, Aggregator or Finalization execution.

## Output contract

Each unique tender is asynchronously passed to `TENDER — Intake Resume` with `trigger_kind=tenderplan_mark`, `manual_override=false`, `tender_id`, and stable key `tenderplan:mark:6a732cd00c61629cf1d3c144:tender:<tender_id>`.

The relation has no confirmed event timestamp, so `observed_at` is absent and the dispatcher persists it as null. Repeated polls produce the same key; the PostgreSQL intake ledger is the sole durable deduplication boundary. Removing and later reassigning the same mark does not create a new event: the stable mark+tender key remains a duplicate and does not restart analysis by itself. Automatic recovery is initiated by `TENDER — Recovery Scan`; operator retry is initiated by `TENDER — Manual Resume` with the existing `analysis_run_id`. No workflow static data is used.

After the migration supersedes the bounded pre-rollout legacy runs, the first
poll has no pre-existing ledger event and may create a new run when history for
that tender contains only `superseded`. Once that stable mark+tender key is
claimed, later remove/reassign cycles remain duplicates as before.

## Bounded coverage and failure behavior

Swagger/OpenAPI documents `type` and `id` but no pagination, ordering, cursor or exhaustive-result semantics. The workflow makes exactly one bounded request and invents no fields. Any malformed populated relation fails the whole normalization step; an empty relation emits no items. HTTP transport uses at most three attempts with five seconds between attempts.

This is current-state membership polling, not event history. A tender removed between polls cannot be reconstructed, and exhaustive coverage is not runtime-proven. Dispatcher remains the owner of completed no-op, unfinished-run reuse, failed/stale reclaim and all PostgreSQL transitions.

## Superseded notification plan

Notification type `5` is documented as “tender marked”, but executions `14677`, `14680` and `14682` produced no usable event. Search `q` does not address an internal ID, while retention, recipient scoping and ordering are undocumented. That plan is historical negative evidence and is superseded by the confirmed relation adapter.

## Packaging gates

The portable export is inactive and keeps credential/workflow IDs unbound. The
isolated live candidate has the existing TenderPlan Header Auth credential,
Intake target and published Error Workflow bound and read back; its controlled
current-state canary is GREEN through Intake. Production activation remains a
separate owner decision, and no existing production workflow was changed.
