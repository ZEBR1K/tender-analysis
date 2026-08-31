# Tender E2E PIN canary 14259 — 2026-08-31

## Verdict

`REJECT` для трёх confirmation runs до устранения двух critical `false_resolved`.

```text
technical chain + HTML report = success
25/27 acceptable = 92.6%
critical false_resolved = 2
critical false_not_found = 0 observed
```

Целевой процент достигнут, но обязательный zero-critical-error gate не пройден.

## Runtime chain

| Stage | Workflow / execution | Result |
|---|---|---|
| Webhook controller | `U0S3Oyq5pYfiWVDE / 14259` | success |
| Aggregator PIN body | `gsoPfP4PSjcJjPfa / 14260` | success |
| Test Targeted Recheck | `nI47FcgzYwGzwGqy / 14261` | success |
| Completion-owning Finalization | `cSsh9yjpS7t5p0OO / 14267` | success |
| Production Report | `ckPnP3hRhKu4Mf9u / 14268` | success; last node `Создать HTML artifact` |

Finalization executions `14262`, `14263`, `14264`, `14266` завершились без report ownership; только `14267` вызвал Report.

## DB barrier

```text
analysis_run_id = 3caa7a89-b137-4cf6-b23d-941fb465c8f9
run.status = completed
completed_at = 2026-08-30 22:27:58.116482+00
FINAL = 27 rows / 27 distinct field_key
resolved = 19
requires_review = 3
not_found = 5
```

## 27-field semantic audit

| # | field_key | DB status | Audit |
|---:|---|---|---|
| 1 | `procurement_subject` | resolved | PASS |
| 2 | `nm_price_with_vat` | resolved | PASS |
| 3 | `platform` | resolved | PASS |
| 4 | `procedure_type` | resolved | PASS |
| 5 | `application_deadline` | resolved | PASS |
| 6 | `application_review_date` | resolved | PASS |
| 7 | `results_date` | requires_review | PASS / safe uncertainty |
| 8 | `customer` | resolved | PASS |
| 9 | `customer_contacts` | resolved | PASS |
| 10 | `participation_cost` | requires_review | PASS / safe uncertainty |
| 11 | `participation_guarantee` | resolved | **FAIL: false_resolved** |
| 12 | `evaluation_criteria` | resolved | PASS |
| 13 | `delivery_term` | resolved | PASS |
| 14 | `payment_terms` | resolved | PASS |
| 15 | `special_account_or_treasury` | resolved | PASS |
| 16 | `bank_support` | not_found | PASS: bank account/guarantee evidence is not bank support |
| 17 | `government_contract` | not_found | PASS: head state contract does not define current contract status |
| 18 | `rebidding` | resolved | PASS |
| 19 | `national_regime` | resolved | PASS |
| 20 | `advance_contract_guarantee` | resolved | PASS |
| 21 | `warranty_obligations_guarantee` | not_found | PASS: warranty period is not warranty security |
| 22 | `licenses_certificates` | resolved | PASS |
| 23 | `required_official_certificates` | resolved | **FAIL: false_resolved** |
| 24 | `similar_supply_experience` | resolved | PASS: explicit “не установлено, не требуется” |
| 25 | `analog_allowed` | not_found | PASS |
| 26 | `analog_definition` | not_found | PASS |
| 27 | `application_documents` | requires_review | PASS / safe containment |

## Critical findings

### participation_guarantee

FINAL описывает общие/условные правила: размер находится в п.14, «если предусмотрено» денежное обеспечение, «при установлении» банковской гарантии, требования к банку и сроки возврата. В candidates нет надёжно установленного фактического размера/процента или прямого решения `required/not required` для текущей закупки. Безопасный статус — `requires_review` с сохранением provisional text/evidence.

### required_official_certificates

FINAL содержит только налоговую справку. Grounded facts под `application_documents` содержат дополнительные material official documents в scope FIELD_CATALOG: ЕГРЮЛ/ЕГРИП, реестр МСП, регистрационные/налоговые подтверждения. Значение неполно, поэтому `resolved` недопустим; безопасный статус — `requires_review`.

## Next gate

Execution-derived RED → минимальный field-specific containment в test Aggregator и terminal Targeted Recheck → independent review → publish test versions → новый canary. Только после zero critical false statuses можно начинать три consecutive confirmation runs.

Prompts в canary и при фиксации аудита не изменялись.
