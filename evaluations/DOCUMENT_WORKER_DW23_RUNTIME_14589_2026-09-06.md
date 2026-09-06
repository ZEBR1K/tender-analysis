# Document Worker DW-23 runtime evidence 14589 — 2026-09-06

## Verdict

`GREEN` for the exact pinned `invalid_confidence` regression from execution `14491`.

Execution `14589` finished with `status=success` in workflow `[DW-23 TEST CODEX] TENDER — Обработать документ`. The selective retry path isolated the single contract-invalid AI Validator item, accepted its second attempt and allowed the document to complete without revalidating the already valid sibling item.

## Source identity

```text
analysis_run_id = 0d477ca1-65f0-48bc-8d4f-5d96c1bf47bc
document_id = a87ba83e-9341-405b-bce7-5f485061fde2
document = Блок_6_Проект_договора.docx
analysis_unit_id = doc_7_au_0037
section = Приложение № 5 к Приложению № 7
fact_index = 1
field_key = licenses_certificates
```

## Observed retry path

```text
primary Validator source responses = 22
primary contract-invalid items = 1
retry queue items = 1
max total attempts = 3

attempt 1:
  outcome = contract_invalid
  failure_code = invalid_confidence

attempt 2:
  outcome = accepted
  verdict = rejected
  confidence = 0.95
  reason_code = wrong_field_classification
  contract_validated = true
  retry_exhausted = false
```

The accepted sibling item `doc_7_au_0037 / fact_index=0 / application_documents` remained on the primary path. Only `fact_index=1 / licenses_certificates` was sent to the retry model.

The terminal rejection is semantically consistent with the supplied evidence: the text asks the manufacturer about lean-production practices and references GOST R 56404-2021 and GOST R 56407-2023; it is not a requirement to provide a licence, certificate of conformity or permit.

## Completion evidence

```text
Validator unit responses after assembly = 22/22
analysis units = 66/66
audited facts persisted = 69
confirmed = 34
requires_review = 6
rejected = 29
document_status = completed
execution_status = success
```

The strict final AI Validator response checker completed successfully after retry assembly. Fact persistence and document completion nodes also completed successfully.

## Scope and limitation

This execution intentionally used pinned data copied from the failing execution to reproduce the exact malformed primary response. It proves the DW-23 selective item retry behavior for `invalid_confidence`; it does not replace a fresh full run without pinned data and does not prove live production promotion. No live n8n workflow was changed while recording this evidence.
