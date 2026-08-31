# Tender E2E PIN canary 14279 — 2026-08-31

## Verdict

`ACCEPT` как canary; разрешён переход к трём consecutive confirmation runs.

```text
technical chain + HTML report = success
27/27 semantically acceptable = 100%
critical false_resolved = 0 observed
critical false_not_found = 0 observed
```

Безопасные uncertain outcomes сохранены как `requires_review`; процент не означает, что все поля автоматически resolved.

## Runtime chain

| Stage | Workflow / execution | Result |
|---|---|---|
| Webhook controller | `U0S3Oyq5pYfiWVDE / 14279` | success |
| Aggregator PIN body | `gsoPfP4PSjcJjPfa / 14280` | success |
| Test Targeted Recheck | `nI47FcgzYwGzwGqy / 14281`, `14285` | success |
| Test-only Report replay | `b4Ga1PoFmlS5ep6Y / 14289` | success |

Controller подтвердил truthful completed replay: `completion_claimed=false`, `finalization_state=already_completed`, exact 27/27 barrier и ровно один Report dispatch. HTML artifact: `Анализ закупки_без_номера.html`, `text/html`, `484540` bytes, renderer round-trip valid.

## DB barrier

```text
analysis_run_id = 3caa7a89-b137-4cf6-b23d-941fb465c8f9
run.status = completed
FINAL = 27 rows / 27 distinct field_key
resolved = 16
requires_review = 7
not_found = 4
max updated_at = 2026-08-30 23:32:08.528936+00
```

## 27-field semantic audit

| # | field_key | DB status | Audit |
|---:|---|---|---|
| 1 | `procurement_subject` | resolved | PASS |
| 2 | `nm_price_with_vat` | resolved | PASS |
| 3 | `platform` | resolved | PASS |
| 4 | `procedure_type` | resolved | PASS |
| 5 | `application_deadline` | requires_review | PASS / safe uncertainty |
| 6 | `application_review_date` | resolved | PASS |
| 7 | `results_date` | requires_review | PASS / safe uncertainty |
| 8 | `customer` | resolved | PASS |
| 9 | `customer_contacts` | resolved | PASS |
| 10 | `participation_cost` | requires_review | PASS / safe uncertainty |
| 11 | `participation_guarantee` | requires_review | PASS / previous critical false-resolved contained |
| 12 | `evaluation_criteria` | resolved | PASS |
| 13 | `delivery_term` | resolved | PASS |
| 14 | `payment_terms` | resolved | PASS |
| 15 | `special_account_or_treasury` | resolved | PASS |
| 16 | `bank_support` | not_found | PASS: guarantee/account evidence is not bank support |
| 17 | `government_contract` | requires_review | PASS: upstream state contract is not silently treated as current contract status |
| 18 | `rebidding` | resolved | PASS |
| 19 | `national_regime` | resolved | PASS |
| 20 | `advance_contract_guarantee` | resolved | PASS |
| 21 | `warranty_obligations_guarantee` | not_found | PASS: warranty period is not warranty security |
| 22 | `licenses_certificates` | resolved | PASS |
| 23 | `required_official_certificates` | requires_review | PASS / ЕГРЮЛ и ЕГРИП included; completeness remains reviewable |
| 24 | `similar_supply_experience` | resolved | PASS: explicit “не установлено, не требуется” |
| 25 | `analog_allowed` | not_found | PASS |
| 26 | `analog_definition` | not_found | PASS |
| 27 | `application_documents` | requires_review | PASS / safe composite-field containment |

## Preceding runner regression

Canary `14269` не засчитывается: Aggregator `14270` и Targeted Recheck `14271/14275` были successful, но Report replay `14278` fail-closed отклонил новый published source version из-за stale exact UUID. TDD fix изменил только replay entry guard; test version `80ad3549-998f-41a0-a973-f02ef5eae46a` опубликована, downstream Report parity остаётся `8/8`.

Prompts не менялись.

## Next gate

Три последовательных запуска на том же exact PIN contract. Каждый должен иметь controller/body/Targeted Recheck/Report success, exact DB 27/27, один HTML report, не менее 80% semantic accuracy и zero critical false statuses.
