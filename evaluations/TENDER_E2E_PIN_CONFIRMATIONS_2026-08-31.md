# Tender E2E PIN consecutive confirmations — 2026-08-31

Exact contract: Aggregator `91c17313-a593-4fb9-9072-79320a958dd7`, Targeted Recheck `13b3c124-4fef-4a6f-9d5f-8befa3725bc1`, same saved PIN data and run `3caa7a89-b137-4cf6-b23d-941fb465c8f9`.

## Confirmation 1/3 — GREEN

| Stage | Execution | Result |
|---|---:|---|
| Controller | `14304` | success |
| Aggregator body | `14305` | success |
| Targeted Recheck | `14306`, `14310` | success |
| Report replay | `14313` | success |

```text
DB = exact 27/27
16 resolved / 6 requires_review / 5 not_found
HTML = valid, 476893 bytes, renderer round-trip true
semantic audit = 27/27 acceptable
critical false_resolved = 0 observed
critical false_not_found = 0 observed
technical fallback used = no; all model responses passed strict checker
```

Safe uncertainties remained explicit. In particular, `participation_guarantee`, `required_official_certificates`, and `application_documents` stayed `requires_review`. `government_contract/not_found` remained evidence-safe: the note distinguishes the upstream State Contract from the current contract and does not create a negative fact.

## Confirmation 2/3 — GREEN

| Stage | Execution | Result |
|---|---:|---|
| Controller | `14314` | success |
| Aggregator body | `14315` | success |
| Targeted Recheck | `14316`, `14320` | success |
| Report replay | `14324` | success |

```text
DB = exact 27/27
16 resolved / 7 requires_review / 4 not_found
HTML = valid, 477940 bytes, renderer round-trip true
semantic audit = 27/27 acceptable
critical false_resolved = 0 observed
critical false_not_found = 0 observed
technical fallback used = no; all model responses passed strict checker
```

The stochastic status change was safe: `government_contract` returned to `requires_review`, with an explicit `ambiguous_scope` note. Composite and guarantee fields remained safely reviewable.

## Confirmation 3/3 — GREEN

| Stage | Execution | Result |
|---|---:|---|
| Controller | `14325` | success |
| Aggregator body | `14326` | success |
| Targeted Recheck | `14327`, `14331` | success |
| Report replay | `14335` | success |

```text
DB = exact 27/27
16 resolved / 7 requires_review / 4 not_found
HTML = valid, 481901 bytes, renderer round-trip true
semantic audit = 27/27 acceptable
critical false_resolved = 0 observed
critical false_not_found = 0 observed
technical fallback used = no; all model responses passed strict checker
```

`application_review_date` conservatively changed from resolved to `requires_review/ambiguous_scope`. `required_official_certificates` contained only the tax-certificate candidate in its provisional text, but remained `requires_review/insufficient_evidence`; therefore the incomplete list was not presented as resolved. The other composite and guarantee boundaries remained safe.

## Final verdict

`3/3 consecutive GREEN`. Each run completed controller → body → all Targeted Recheck children → exactly one Report, passed the exact DB 27/27 barrier and HTML validation, achieved 27/27 acceptable semantic outcomes, and had zero observed critical false statuses.
