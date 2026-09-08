# TenderPlan mark relation contract (sanitized)

- Selected adapter: `GET /api/tenders/v2/getlist?type=1&id=<mark_id>`.
- Fixed mark ID: `6a732cd00c61629cf1d3c144` (label `«Проверить»`).
- Runtime evidence: inactive disposable workflow `JraLbsWe59YXq0jc`, execution
  `14683`, HTTP 200 for mark lookup, mark list and relation lookup.
- Confirmed response paths: one procurement may appear as `tender.id` and again
  in `tenders[].id`; execution `14683` contained one unique procurement.
- The fixture preserves only those structural paths. The ID is synthetic. It
  contains no client text, URLs, authentication data or unrelated response data.
- Swagger/OpenAPI documents `type` and `id` for the relation request. It does
  not document pagination, ordering, a cursor, a relation-event timestamp or
  exhaustive-result guarantees. The adapter therefore performs one bounded
  current-state request, invents no pagination fields, and exposes this exact
  fail-closed coverage limitation.
- Historical negative evidence remains separate: notification type `5` is
  documented as “tender marked”, but executions `14677`, `14680` and `14682`
  returned no usable event. Notification search `q` is documented for
  name/number/classifiers, not internal tender ID; retention, recipient scoping
  and ordering are undocumented. The notification plan is superseded by the
  runtime-proven current mark-relation adapter.

`observed_at` is intentionally absent: the relation response has no confirmed
source event timestamp.
