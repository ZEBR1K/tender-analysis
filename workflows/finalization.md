# TENDER — Финализация анализа

**Canonical export:** `workflows/n8n-exports/TENDER — Финализация анализа.json`
**Назначение:** promotion проверенного agentic результата в canonical FINAL,
27/27 completion barrier и вызов генерации отчёта.

## Agentic promotion contract

`Продвинуть agentic FINAL` принимает `analysis_run_id` и опциональный
`agentic_job_id`. Если job указан, один PostgreSQL transaction проверяет:

- identity и terminal `completed` state agentic job;
- неизменённый file staging barrier;
- ровно 27 уникальных catalog fields и допустимые статусы;
- непустой locator для evidence у `resolved` и `requires_review`;
- принадлежность evidence оригинальному manifest document либо зарезервированному
  источнику `tenderplan-metadata`.

Зарезервированный metadata source разрешён только когда соответствующий run
содержит непустой `tender_meta`. При promotion он получает:

```json
{
  "source_type": "tender_metadata",
  "document": "TenderPlan — карточка закупки"
}
```

Для любого другого `artifact_key` обязательна строка этого job в
`tender_agentic_documents`. Metadata не является документом и не ослабляет
`expected_documents`, staged-file или 27/27 barriers.

Workflow не проверяет программно истинность цитаты, достаточность evidence или
соответствие значения конкретному тексту. Это семантика Codex; runtime защищает
только identity, file integrity и JSON/FINAL contract.

## Downstream

После promotion существующий DB-backed barrier требует ровно 27 canonical FINAL
строк, переводит run из `aggregating` в `completed` и вызывает
`TENDER — Генерация отчета`. Report adapter уже отображает
`source_type=tender_metadata` как карточку TenderPlan.
