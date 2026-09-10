# Agentic Finalization and Report canary — 2026-09-11

## Scope

This checkpoint verifies the new terminal boundary only:

```text
validated 27-row agentic shadow result
→ canonical tender_field_final_v1 rows
→ existing DB-backed 27/27 completion barrier
→ existing Report Generation
→ HTML + PDF artifacts
```

It does not claim a new blind semantic evaluation or a fresh TenderPlan-to-report
run. The canary deliberately reused the already completed real Codex job from
Task 17 so the new promotion/finalization behavior could be isolated.

## Published live versions

| Workflow | ID | Published version |
|---|---|---|
| `TENDER — Генерация отчета` | `ckPnP3hRhKu4Mf9u` | `e21c7675-916a-4fd3-8499-e11444484b68` |
| `TENDER — Финализация анализа` | `cSsh9yjpS7t5p0OO` | `e1aad7e7-2b1b-4f95-9fff-bcaf72ebc8cd` |
| `TENDER — Агентский анализ — Монитор` | `CALcBEXvQsO1AcfP` | `b45e4a2c-48a1-456e-8556-873dd7b19d71` |

Read-only n8n API verification confirmed `versionId = activeVersionId` for all
three workflows. Finalization has six nodes and the exact route:

```text
When Executed by Another Workflow
→ Продвинуть agentic FINAL
→ Проверить 27 FINAL и завершить run
→ Проверить результат финализации
→ If
→ Call 'TENDER — Генерация отчета'
```

The new promotion node uses the same existing PostgreSQL credential as the
completion barrier. Its live parameters and query SHA-256 exactly match the
repository export. Monitor has 25 nodes, calls Finalization synchronously by
live workflow ID, and routes:

```text
Сохранить ровно 27 shadow rows
→ Завершить agentic analysis
→ Jobs по одному
```

## Canary input

```text
analysis_run_id = b731f861-4df6-40df-a8c5-67b8564f3f03
agentic_job_id  = 13b090b5-38fc-432a-a235-90ae43f609fe
tender_id       = 6aa2cbe85b7165804bceda0f
tender_number   = 290436-26LO
```

The job was the real Task 17 Codex result: exactly 27 shadow rows, 7 resolved,
4 requires_review and 16 not_found.

## First execution

Finalization execution `15662` completed successfully in manual mode:

| Check | Result |
|---|---|
| Agentic promotion | `agentic_promoted=true` |
| Exact run/job identity | passed |
| Canonical FINAL count | `27` |
| Completion barrier | `barrier_ready=true` |
| Atomic completion claim | `completion_claimed=true` |
| Finalization state | `completed_now` |
| Last node | Report Generation call |

The child Report Generation execution `15663` completed successfully:

| Check | Result |
|---|---|
| Snapshot FINAL rows | `27` |
| Report model fields | `27` |
| Report model validation | `valid=true` |
| HTML artifact | `24761` bytes, validation passed |
| PDF artifact | `90367` bytes, `%PDF-`, validation passed |
| Binary outputs | `report_html`, `report_pdf` |
| PDF filename | `Анализ закупки_290436-26LO.pdf` |

## Database read-back

The scoped read-only Supabase role used TLS certificate verification and only a
single `SELECT`. It confirmed:

| Check | Result |
|---|---|
| `tender_analysis_runs.status` | `completed` |
| `completed_at` | set |
| FINAL rows / unique keys | `27 / 27` |
| `result_contract_version` | `tender_field_final_v1` for all 27 |
| `resolution_method` | `codex_agentic_v1` for all 27 |
| Status distribution | `7 resolved / 4 requires_review / 16 not_found` |
| Null confidence | `27`, allowed only for the agentic producer |

## Idempotent replay

The same exact run/job input was executed again as Finalization execution
`15666`. It completed successfully in less than one second, returned
`final_count=27` and `completion_claimed=false`, stopped at `If`, and did not run
the Report Generation node. No duplicate report was produced.

Repository verification after the live canary completed with:

```text
node --test
760 total / 754 pass / 0 fail / 6 skipped
```

After the replay, the temporary trigger mock data was explicitly unpinned.
Read-only API verification confirmed Finalization `pinData={}` while its
published version remained unchanged.

## Verdict and remaining gate

The agentic promotion, canonical FINAL persistence, completion claim, existing
report adapter, HTML/PDF generation and same-producer replay are runtime GREEN.
The runtime guards remain limited to identity, source/file integrity and the
JSON/FINAL contracts; no quote accuracy, evidence sufficiency or field-specific
semantic validator was added.

The next gate is one fresh end-to-end procurement through the already published
TenderPlan mark route:

```text
mark → preparation → Dispatch → Codex runner → Monitor
→ Finalization → Report Generation
```

That run still requires a manual semantic review of all 27 values because the
two newer evaluation procurements do not have employee-authored gold reports.
