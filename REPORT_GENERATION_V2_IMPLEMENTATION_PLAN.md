# Report Generation V2 — план реализации

> **Legacy / completed implementation plan.** План относится к beta export и не описывает текущее runtime-состояние. Актуальная документация: [workflows/report-generation.md](workflows/report-generation.md).

Дата: 24.08.2026  
Статус: план; не разрешает немедленное изменение workflow  
Целевой workflow: `workflows/n8n-exports/beta/TENDER — Генерация отчета beta v2.json`

## 1. Ограничения

До отдельного согласования архитектуры запрещено:

- редактировать workflow JSON;
- менять Code Nodes;
- менять live n8n;
- выполнять PostgreSQL writes или DDL;
- менять Aggregator, Targeted Recheck или Finalization;
- менять исходный семиполевой analysis contract.

После согласования выполнять изменения по одному логическому этапу, с runtime checkpoint после каждого этапа.

## 2. Итоговый граф

```text
Trigger
→ Проверить результат финализации
→ Получить Report Snapshot
→ Проверить Report Snapshot
→ Адаптировать поля отчёта
→ Собрать Report Model
→ Проверить Report Model
→ Сгенерировать HTML
→ Создать HTML файл
→ Проверить HTML файл
```

## 3. Этап 0 — preflight после согласования

1. Убедиться, что пользователь явно написал, что архитектура согласована и реализацию можно начинать.
2. Выполнить `git status --short --branch`.
3. Не перезаписывать существующие пользовательские изменения.
4. Сравнить local beta export и live Report workflow:
   - workflow ID;
   - versionId;
   - node names;
   - connections;
   - Code/SQL parameters.
5. Проверить execution `13892` и run `f9d8e1d7-f01a-4d91-8eac-89c8376535c2` read-only.
6. Проверить, что live DB schema по-прежнему совпадает с `DATA_MODEL.md`.
7. Если local/live расходятся — остановиться и сообщить точное расхождение.

## 4. Этап 1 — входной guard

### Нода: `When Executed by Another Workflow`

Действие: оставить.

Назначение: получить существующий Finalization event.

Вход:

```json
{
  "analysis_run_id": "uuid",
  "final_count": 27,
  "barrier_ready": true,
  "completion_claimed": true,
  "finalization_state": "completed_now"
}
```

Выход: тот же item.

Зависимости: Finalization workflow.

Ошибки: отсутствующий item — execution не должен продолжаться.

### Нода: `Проверить результат финализации`

Действие: оставить текущую логику для автоматического path.

Назначение: не создавать отчёт до successful 27/27 completion claim.

Выход:

```json
{
  "analysis_run_id": "uuid",
  "final_count": 27,
  "finalization_state": "completed_now",
  "report_generation_started": true
}
```

Проверки:

- `analysis_run_id` существует;
- `completion_claimed === true`;
- `barrier_ready === true`;
- `final_count === 27`.

Примечание: ручной re-render completed run — отдельная будущая функция. Не ослаблять guard в рамках первой реализации.

## 5. Этап 2 — Report Snapshot

### Нода: `Получить Report Snapshot`

Исходная нода: `Получить данные закупки`.

Действие: переписать SQL и переименовать ноду.

Тип: PostgreSQL / Execute Query.

Назначение: одним read-only SQL statement вернуть один JSON snapshot.

Вход:

```json
{
  "analysis_run_id": "f9d8e1d7-f01a-4d91-8eac-89c8376535c2"
}
```

SQL должен читать только:

- `tender_analysis_runs`;
- `tender_analysis_field_results`;
- `tender_analysis_documents`;
- `tender_analysis_facts`;
- `tender_analysis_units`.

Query parameter:

```text
{{ [$json.analysis_run_id] }}
```

SQL requirements:

1. Все CTE фильтруются одним `$1::uuid`.
2. `field_results` выбирает ровно:

```text
field_index
field_key
status
value_text
confidence
requires_human_review
result_json
```

3. `field_results` сортируется по `field_index` внутри JSON aggregate.
4. `documents` содержит internal id, index, filename, display name, extension.
5. `facts` содержит только данные, нужные для source resolution.
6. `units` содержит только document/unit ids, `source_pages`, `ai_segments`, `provenance`.
7. Не выполнять `INSERT`, `UPDATE`, `DELETE`, DDL или stored procedure с side effects.
8. Вернуть один item с property `report_snapshot`.

Выход:

```json
{
  "report_snapshot": {
    "snapshot_version": "tender_report_snapshot_v2",
    "analysis_run_id": "uuid",
    "analysis_run": {},
    "field_results": ["27 canonical objects"],
    "source_index": {
      "documents": [],
      "facts": [],
      "units": []
    }
  }
}
```

Зависимости: PostgreSQL credential с read access; текущая schema.

Ошибки:

- нет run → `REPORT_RUN_NOT_FOUND` на следующем guard;
- SQL вернул не один item → `REPORT_SNAPSHOT_SHAPE_INVALID`;
- query содержит write keyword → не запускать и остановить review.

### Нода: `Проверить Report Snapshot`

Исходная нода: `Нормализовать данные закупки`.

Действие: полностью переписать и переименовать.

Тип: Code.

Назначение: fail-fast barrier до любой presentation logic.

Вход: `{ report_snapshot }`.

Выход: тот же snapshot плюс:

```json
{
  "snapshot_validation": {
    "valid": true,
    "field_count": 27,
    "indexes_valid": true,
    "keys_valid": true,
    "contract_valid": true
  }
}
```

Проверки:

- snapshot version;
- run status `completed`;
- ровно 27 field results;
- exact order 1..27;
- exact 27 `field_key` из `FIELD_CATALOG.md`;
- каждый result содержит все семь исходных keys;
- status/value/review invariants;
- source index arrays существуют.

Errors:

- `REPORT_RUN_NOT_COMPLETED`;
- `REPORT_SNAPSHOT_FIELD_COUNT_INVALID`;
- `REPORT_ANALYSIS_CONTRACT_CHANGED`;
- `REPORT_SNAPSHOT_SOURCE_INDEX_INVALID`.

Checkpoint этапа 2:

```text
run f9d8... → 27 canonical rows
11 resolved / 3 requires_review / 13 not_found
ни одного key/value rename
```

Не переходить к Adapter, пока этот checkpoint не подтверждён execution data.

## 6. Этап 3 — Report Adapter

### Нода: `Адаптировать поля отчёта`

Исходная нода: `Собрать итоговые данные`.

Действие: полностью переписать и переименовать.

Тип: Code.

Назначение:

- сохранить каждый canonical result в `analysis_result`;
- добавить отдельный `presentation`;
- создать client-safe `sources[]` из evidence и source index.

Вход: validated Report Snapshot.

Выход:

```json
{
  "adapter_version": "tender_report_adapter_v2",
  "analysis_run_id": "uuid",
  "analysis_run": {},
  "adapted_fields": [
    {
      "analysis_result": {
        "field_index": 14,
        "field_key": "payment_terms",
        "status": "resolved",
        "value_text": "...",
        "confidence": 0.98,
        "requires_human_review": false,
        "result_json": {}
      },
      "presentation": {
        "client_field_name": "Условия оплаты",
        "section_name": "Исполнение договора",
        "status_text": "Подтверждено"
      },
      "sources": [
        {
          "kind": "document",
          "document": "Проект договора.pdf",
          "page": 2,
          "page_to": 2,
          "sheet": null,
          "quote": "...",
          "location_status": "exact"
        }
      ]
    }
  ]
}
```

Dependencies:

- mapping всех 27 полей из `REPORT_FIELD_MAPPING.md`;
- expected keys из `FIELD_CATALOG.md`;
- `source_index.documents/facts/units`;
- FINAL `result_json.evidence[]`.

Source rules:

1. Обрабатывать все evidence.
2. `candidate_ref fact → fact → document`.
3. `analysis_unit_id → unique unit → document`.
4. Metadata → `kind=tender_metadata`.
5. Final evidence location имеет приоритет над fallback.
6. Quote только из evidence.
7. Page/sheet отсутствует → `null`.
8. Удалить internal ids из `sources[]`.
9. `not_found → sources=[]`.
10. Не включать rejected fact, если он не referenced canonical evidence.

Errors:

- mapping отсутствует → `REPORT_FIELD_MAPPING_INCOMPLETE`;
- один `candidate_ref` не найден → visible unresolved source diagnostic; не выбирать другой fact по одному `field_key`;
- unit match неоднозначен → `location_status=ambiguous`, document не угадывать;
- analysis result был изменён → `REPORT_ANALYSIS_CONTRACT_MUTATED`.

Checkpoint этапа 3 для проверенного run:

- 29 evidence обработаны;
- 23 fact refs разрешены в documents;
- 3 metadata sources;
- 3 unit refs обработаны;
- `payment_terms` сохраняет 4 sources;
- 13 `not_found` имеют пустой `sources[]`.

## 7. Этап 4 — Report Model

### Нода: `Собрать Report Model`

Исходная нода: `Подготовить данные отчёта`.

Действие: полностью переписать и переименовать.

Тип: Code.

Назначение: собрать renderer-facing структуру без доступа к БД.

Вход: output Report Adapter.

Выход: `tender_report_model_v2` из архитектурного документа.

Procurement mapping берётся из `analysis_run.tender_meta`. Если metadata отсутствует, значение остаётся `null`; нельзя подменять canonical field results.

Statistics вычислять заново из `analysis_result.status`.

`attention_field_indexes` строить по `analysis_result.requires_human_review === true` и сверять со status.

Errors:

- invalid tender metadata shape → допустимы null presentation values, но model сохраняет 27 fields;
- statistics sum не 27 → `REPORT_MODEL_STATISTICS_INVALID`;
- duplicate/missing index → `REPORT_MODEL_ORDER_INVALID`.

### Нода: `Проверить Report Model`

Исходная нода: `Подготовить структуру отчёта`.

Действие: полностью переписать и переименовать.

Тип: Code.

Назначение: последний data-contract barrier перед HTML.

Проверки:

- model version;
- 27 fields, order 1..27;
- canonical key names сохранены;
- presentation для всех 27;
- sources arrays;
- statistics 11/3/13 для regression run;
- attention содержит только indexes 2, 17, 21 для regression run;
- никакой status/value не был подменён presentation logic.

Выход: тот же Report Model плюс `model_validation.valid=true`.

## 8. Этап 5 — HTML Renderer

### Нода: `Сгенерировать HTML`

Исходная нода: `Подготовить данные для отчёта`.

Действие: полностью переписать и переименовать.

Тип: Code.

Назначение: детерминированно превратить validated Report Model в self-contained HTML.

Вход: `tender_report_model_v2`.

Выход:

```json
{
  "analysis_run_id": "uuid",
  "filename": "Анализ закупки_10273121.html",
  "mime_type": "text/html",
  "template_version": "tender_report_html_v1",
  "expected_field_count": 27,
  "html": "<!doctype html>..."
}
```

Required helpers:

```text
escapeHtml
formatDate
formatPrice
renderSource
renderFieldRow
renderAttentionItem
```

Required sections:

```text
title
summary
fields
attention
statistics
```

Каждая строка таблицы должна иметь marker `data-field-index="N"`.

Renderer отображает:

- `presentation.client_field_name` как поле;
- `analysis_result.value_text` как значение;
- `sources[]` как источник.

Renderer не отображает `field_key`, `confidence`, `result_json` и internal section.

Errors:

- отсутствует validated model → `REPORT_MODEL_NOT_VALIDATED`;
- unsafe filename → `REPORT_HTML_FILENAME_INVALID`;
- dynamic value без escaping → code review block;
- не 27 rows → `REPORT_HTML_FIELD_COUNT_INVALID`.

### Нода: `Создать HTML файл`

Исходная нода: `Сформировать Markdown отчёт`.

Действие: полностью переписать и переименовать.

Тип: Code.

Назначение: создать binary artifact без изменения HTML.

Вход: renderer output.

Выход:

```json
{
  "json": {
    "analysis_run_id": "uuid",
    "filename": "Анализ закупки_10273121.html",
    "template_version": "tender_report_html_v1"
  },
  "binary": {
    "report_html": {
      "mimeType": "text/html",
      "fileName": "Анализ закупки_10273121.html"
    }
  }
}
```

Encoding: UTF-8. Binary property: `report_html`.

### Нода: `Проверить HTML файл`

Исходная нода: `Создать Markdown файл`.

Действие: полностью переписать и переименовать.

Тип: Code.

Назначение: terminal validation artifact.

Проверки:

- binary существует и не пустой;
- filename `.html`;
- MIME `text/html`;
- `<!doctype html>` и UTF-8 meta;
- все пять обязательных sections;
- ровно 27 уникальных `data-field-index` от 1 до 27;
- нет `<script`, `javascript:`, внешних stylesheet/resource URL;
- нет известных internal UUID и forbidden internal key names;
- HTML содержит source document/quote для test fields.

Выход: binary без изменения плюс artifact metadata.

## 9. Ноды, которые удалить после переноса ответственности

Удалять только после успешного checkpoint Report Snapshot/Adapter:

| Нода | Причина |
|---|---|
| `Получить результаты анализа` | данные загружаются snapshot query |
| `Получить документы источников` | данные загружаются snapshot query |
| `Получить факты источников` | данные загружаются snapshot query |
| `Обогатить источники документов` | current input contract ошибочен; заменена Adapter |

Перед удалением убедиться, что ни одна connection не ссылается на эти ноды.

## 10. Regression tests

### R1 — основной run

Input: Finalization event execution `13863`.

Expected:

```text
27 rows
11 resolved
3 requires_review
13 not_found
HTML file valid
```

### R2 — contract protection

Любое появление `key`, `value`, `requires_review` вместо исходных names → fail.

### R3 — source coverage

- `payment_terms` → 4 sources;
- fact refs разрешаются в документы;
- metadata source не требует page/quote;
- DOCX без page остаётся без page;
- `not_found` не требует source.

### R4 — 26 fields

Expected: fail до Adapter/Renderer.

### R5 — invalid order/duplicate key

Expected: fail в `Проверить Report Snapshot`.

### R6 — HTML escaping

В value/quote добавить fixture с `<`, `>`, `&`, кавычками. Expected: текст видим, executable markup отсутствует.

### R7 — internal leak

Известный UUID/`semantic_block_id` в HTML → terminal validation fail.

### R8 — `not_found` semantics

Expected text: «Не удалось надёжно установить по доступным источникам». Нельзя выводить «нет», `false` или «не предусмотрено» без canonical value.

## 11. Проверки Git и scope

После будущей реализации:

```powershell
git status --short
git diff --check
git diff -- workflows/n8n-exports/beta/TENDER` —` Генерация` отчета` beta` v2.json
```

Отдельно подтвердить отсутствие diff в:

```text
TENDER — Агрегация закупки.json
TENDER — Финализация анализа.json
DATA_MODEL.md
FIELD_CATALOG.md
```

Никакие credentials, API keys, PostgreSQL passwords или Telegram tokens не должны попасть в diff.

## 12. Definition of Done

Реализация завершена только если:

1. local/live workflow версии согласованы до изменения;
2. source analysis contract не изменён;
3. Snapshot стабильно даёт 27 rows;
4. Adapter сохраняет все evidence и client-safe sources;
5. Report Model проходит deterministic validation;
6. HTML содержит 27 fields и все обязательные sections;
7. HTML не содержит internal data;
8. runtime regression выполнен на указанном run;
9. upstream workflow и PostgreSQL не изменены;
10. execution IDs и результаты зафиксированы в документации после проверки.
