# Tender E2E PIN canary 14294 — 2026-08-31

## Verdict

`ACCEPT` as fresh post-fix canary. Confirmation series may start from `0/3`.

```text
technical chain + HTML report = success
27/27 semantically acceptable = 100%
critical false_resolved = 0 observed
critical false_not_found = 0 observed
```

## Runtime chain

| Stage | Workflow / execution | Result |
|---|---|---|
| Webhook controller | `U0S3Oyq5pYfiWVDE / 14294` | success |
| Aggregator PIN body | `gsoPfP4PSjcJjPfa / 14295` | success |
| Test Targeted Recheck | `nI47FcgzYwGzwGqy / 14296`, `14300` | success |
| Test-only Report replay | `b4Ga1PoFmlS5ep6Y / 14303` | success |

Controller подтвердил `completed` replay contract: `completion_claimed=false`, `finalization_state=already_completed`, exact 27/27 barrier and one Report dispatch. HTML artifact `Анализ закупки_без_номера.html` is valid `text/html`, `482829` bytes, renderer round-trip passed.

## DB and semantic audit

```text
FINAL = 27 rows / 27 canonical keys
resolved = 16
requires_review = 6
not_found = 5
```

The 27-field audit remains acceptable against the same grounded PIN data. The only status change from accepted canary `14279` is `government_contract: requires_review → not_found`. This is safe: the source proves only that the tender contract is concluded in performance of another State Contract; it neither proves that the new contract itself has state/municipal status nor proves a negative. The saved `not_found` note explicitly preserves that uncertainty and does not materialize `false`.

Safe uncertain fields remain `requires_review`: `application_deadline`, `results_date`, `participation_cost`, `participation_guarantee`, `required_official_certificates`, `application_documents`. Other `not_found` fields remain evidence-safe: `bank_support`, `warranty_obligations_guarantee`, `analog_allowed`, `analog_definition`.

Both Targeted Recheck executions returned strictly valid model envelopes/evidence in this canary; the new technical fallback was not needed at runtime. Its execution-14292 behavior remains covered by exact offline regression.

Preflight execution `14293` is excluded: root sent an incorrectly shaped harness request; controller fail-closed before body/LLM execution. Prompts were not changed.

## Next gate

Three consecutive runs on the same exact PIN contract. Each must have successful controller/body/all Targeted Recheck children/one Report, exact DB 27/27, at least 80% semantic accuracy, and zero critical false statuses.
