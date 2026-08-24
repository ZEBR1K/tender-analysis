# Report Generation V2 — Executor Task 2: Source Normalization

Рабочая ветка: `feature/report-generation-docx-v2`

Выполняй этот этап самостоятельно, без субагентов. Не начинай Task 2, пока Task 1 не прошёл acceptance criteria и не предоставил фактический terminal JSON.

Task 2 зависит только от завершённого Task 1. Он не зависит от HTML renderer или Task 3.

## 1. Цель этапа

Добавить к каждому найденному полю корректные renderer-independent sources и удалить internal evidence data из публичной Report Data Model.

Граница этапа:

```text
Task 1 Report Data Model
↓
analysis evidence + source index
↓
source normalization
↓
validated renderer-ready Report Data Model
```

Целевой field contract:

```json
{
  "field_index": 14,
  "field": "payment_terms",
  "label": "Условия оплаты",
  "status": "resolved",
  "value": "Авансовый платеж не предусмотрен...",
  "review_note": null,
  "source": {
    "document": "Договор.pdf",
    "page": 2,
    "sheet": null,
    "quote": "Авансовый платеж не предусмотрен..."
  },
  "sources": [
    {
      "kind": "document",
      "document": "Договор.pdf",
      "page": 2,
      "page_to": 2,
      "sheet": null,
      "quote": "Авансовый платеж не предусмотрен...",
      "role": "primary",
      "location_status": "exact"
    }
  ]
}
```

`sources[]` — canonical полный массив. `source` — projection первого primary source или `null`; он не заполняется независимо.

## 2. Что разрешено менять

Только source-related участок local/test Report Generation workflow:

- read-only source index из уже существующего snapshot node Task 1;
- `Добавить источники и доказательства` / целевая `Нормализовать источники`;
- `Проверить контракт отчёта v2`;
- connections от terminal output Task 1 до terminal output Task 2.

Разрешено:

- использовать documents/facts/units, уже загруженные `Загрузить снимок анализа для отчёта`;
- использовать explicit node reference к snapshot node;
- нормализовать embedded evidence;
- разрешать document/page/sheet через deterministic joins;
- сохранять несколько sources;
- deduplicate источники;
- строить `attention_fields` только из `requires_review`;
- использовать live n8n/PostgreSQL только read-only для диагностики.

Если snapshot Task 1 не содержит documents/facts/units, остановись и верни Task 1 на исправление его read-only query. Не добавляй скрытый второй источник данных без документирования контракта.

## 3. Что запрещено менять

Не делать в Task 2:

- HTML;
- CSS;
- Telegram;
- renderer;
- binary file creation;
- изменение Task 1 procurement/statistics/field order;
- повторный AI extraction;
- изменение FINAL status/value;
- создание отрицательного факта для `not_found`;
- удаление rejected facts из persistence;
- изменение Aggregator, Targeted Recheck или Finalization;
- изменение PostgreSQL schema/data;
- новая таблица `report_data_model`;
- production write без отдельного разрешения.

## 4. Какие файлы изучить

Обязательно прочитать:

1. `AGENTS.md`;
2. `DATA_MODEL.md`;
3. `FIELD_CATALOG.md`;
4. `REPORT_FIELD_MAPPING.md`;
5. `REPORT_GENERATION_ARCHITECTURE_V2.md`;
6. `REPORT_GENERATION_IMPLEMENTATION_PLAN_V2.md`;
7. `REPORT_GENERATION_EXECUTOR_TASK_1_DATA_MODEL.md`;
8. фактический terminal JSON и execution ID Task 1;
9. `workflows/n8n-exports/TENDER — Генерация отчета.json`;
10. `workflows/n8n-exports/TENDER — Агрегация закупки.json`;
11. `workflows/n8n-exports/TENDER - Targeted Recheck.json`.

В `DATA_MODEL.md` проверить связи:

```text
field result evidence
→ candidate_ref / analysis_unit_id
→ tender_analysis_facts / tender_analysis_units
→ document_id
→ tender_analysis_documents.file_name
```

Runtime fixture:

```text
analysis_run_id = f9d8e1d7-f01a-4d91-8eac-89c8376535c2
documents = 3
facts = 38
units = 18
FINAL = 27
```

## 5. Пошаговый план действий

### Шаг 1. Проверить вход Task 2

Task 2 принимает только завершённый output Task 1:

```json
{
  "analysis_run_id": "f9d8e1d7-f01a-4d91-8eac-89c8376535c2",
  "procurement": {},
  "statistics": {
    "total": 27,
    "resolved": 11,
    "requires_review": 3,
    "not_found": 13
  },
  "report_fields": ["27 base fields with result_json"]
}
```

До source normalization проверь:

- `analysis_run_id` присутствует;
- `report_fields.length === 27`;
- каждый field имеет `field`, `status`, `value`, `result_json`;
- Task 1 snapshot node содержит `documents`, `facts`, `units`.

При нарушении входного контракта остановись. Не компенсируй незавершённый Task 1 fallback-кодом.

### Шаг 2. Построить source indexes

Из snapshot Task 1 создать internal lookup maps:

```text
documentById
factById
unitsByAnalysisUnitId
```

`unitsByAnalysisUnitId` должен хранить массив matches, а не один элемент. `analysis_unit_id` разрешается только при cardinality `=== 1` внутри текущего run.

Internal IDs используются только во время normalization и не копируются в output model.

### Шаг 3. Нормализовать каждый evidence

Document resolution precedence:

1. embedded `evidence.document.file_name`;
2. `candidate_ref="fact:<id>" → fact.document_id → document.file_name`;
3. однозначный `analysis_unit_id → unit.document_id → document.file_name`;
4. `source_type=tender_metadata` → metadata source;
5. unresolved diagnostic — только internal error context, не клиентский fake source.

Location precedence:

1. explicit FINAL `page_from/page_to/sheet_name`;
2. matching fact evidence;
3. matching semantic segment/provenance;
4. `unit.source_pages`, только если страница одна и однозначна;
5. `null` с `location_status="not_available_in_source"`.

Никогда не выбирать первый unit/document при неоднозначности.

### Шаг 4. Привести source к публичному contract

Document source:

```json
{
  "kind": "document",
  "document": "Проект договора.pdf",
  "page": 2,
  "page_to": 2,
  "sheet": null,
  "quote": "Оригинальный фрагмент документа",
  "role": "primary",
  "location_status": "exact"
}
```

Spreadsheet source:

```json
{
  "kind": "document",
  "document": "Спецификация.xlsx",
  "page": null,
  "page_to": null,
  "sheet": "Лист1",
  "quote": "Оригинальный фрагмент строки",
  "role": "primary",
  "location_status": "exact"
}
```

TenderPlan source:

```json
{
  "kind": "tender_metadata",
  "source_name": "TenderPlan — карточка закупки",
  "document": null,
  "page": null,
  "page_to": null,
  "sheet": null,
  "quote": null,
  "role": "primary",
  "location_status": "not_applicable"
}
```

Для source document обязательна оригинальная `quote`. Отсутствующую page/sheet не придумывать.

### Шаг 5. Сохранить несколько источников

Для каждого field:

1. Нормализовать все `result_json.evidence[]`.
2. Удалить только exact duplicates по:

```text
kind + document + page + page_to + sheet + quote
```

3. Primary source поставить первым.
4. Supporting sources сохранить после primary.
5. `source = sources[0] ?? null`.

Не ограничивать output первым evidence.

### Шаг 6. Обработать статусы

`resolved`:

- value обязателен;
- `sources.length >= 1`;
- metadata source считается source;
- если source нельзя восстановить, Task 2 должен завершиться explicit error, а не скрыть проблему.

`requires_review`:

- сохранить value и canonical `review_note`;
- если evidence присутствует, нормализовать все sources;
- если value не `null`, обязателен минимум один document/metadata source;
- если value `null` и evidence отсутствует, `sources=[]` допустим только при явном review reason, описывающем отсутствие надёжного evidence;
- field включается в `attention_fields`.

`not_found`:

- `value=null`;
- `sources=[]`;
- source не требуется;
- не создавать `нет`, `false`, `не предусмотрено`.

### Шаг 7. Удалить internal data

До terminal output Task 2 удалить из public model:

- `result_json`;
- raw evidence;
- `candidate_ref`;
- `semantic_block_id`;
- `analysis_unit_id`;
- fact/document/unit UUID;
- confidence и internal audit metadata, если заказчик их не запросил.

`field` остаётся logical stable key для renderer, но Task 3 не показывает его клиенту.

### Шаг 8. Сформировать renderer-ready output

Terminal output Task 2:

```json
{
  "schema_version": "tender_report_data_v2",
  "analysis_run_id": "f9d8e1d7-f01a-4d91-8eac-89c8376535c2",
  "procurement": {},
  "statistics": {
    "total": 27,
    "resolved": 11,
    "requires_review": 3,
    "not_found": 13
  },
  "report_fields": ["27 normalized fields with source/sources"],
  "attention_fields": ["only requires_review fields"]
}
```

Сделай эту model node terminal checkpoint. HTML/Telegram не запускать.

### Шаг 9. Проверить known run

Минимально проверить:

- `payment_terms`: несколько sources сохраняются;
- PDF source: document + page + quote;
- XLSX source: document + sheet + quote;
- TenderPlan field: metadata source;
- DOCX source без page: document + quote, page/sheet null;
- каждый `not_found`: sources empty;
- `attention_fields.length === statistics.requires_review`.

Остановись после Task 2. Не переходи к HTML в том же изменении.

## 6. Проверки после выполнения

### Contract checks

- вход полностью соответствует Task 1;
- output schema version `tender_report_data_v2`;
- 27 report fields сохранены в исходном порядке;
- `source` равен primary `sources[0]` или null;
- несколько evidence не потеряны;
- document filename восстановлен;
- PDF page/page range восстановлены, если доступны;
- XLSX sheet восстановлен;
- quote совпадает с исходным evidence;
- `not_found` имеет `sources=[]`;
- `attention_fields` содержит только `requires_review`;
- statistics не изменена.

### Internal leak checks

В renderer-facing `report_fields` и `attention_fields` отсутствуют:

```text
UUID
candidate_ref
semantic_block_id
analysis_unit_id
fact_id
document_id
raw result_json
raw evidence
```

Top-level `analysis_run_id` остаётся техническим envelope field для audit/retry. Task 3 обязан сохранить его только в execution metadata и не рендерить в HTML.

Не отклонять реальную quote только потому, что внутри неё встречается UUID-подобный текст. Проверять exact known internal IDs и имена internal keys.

### Negative checks

- ambiguous unit match не выбирает первый source;
- missing document row не превращается в выдуманный filename;
- document evidence без quote вызывает explicit validation error;
- duplicate evidence дедуплицируется один раз;
- unknown page остаётся null;
- normalization error не возвращает success-like empty sources для `resolved`.

### Scope checks

- HTML/CSS отсутствуют;
- binary file не создан;
- Telegram не вызывался;
- upstream analysis workflows не изменены;
- PostgreSQL schema/data не изменены.

## 7. Критерии готовности

Task 2 готов только если:

1. Task 1 contract не изменён и не обходится fallback-кодом.
2. Все 27 fields присутствуют.
3. Каждый `resolved` field имеет минимум один source.
4. `not_found` fields имеют пустой `sources[]` и не требуют source.
5. Несколько sources сохраняются и дедуплицируются детерминированно.
6. `document`, `page`, `sheet`, `quote` не теряются.
7. Renderer-facing fields не содержат UUID или internal evidence identifiers; top-level `analysis_run_id` допускается только как technical envelope.
8. `attention_fields` содержит только `requires_review`.
9. Terminal JSON готов для любого renderer без обращения к PostgreSQL.
10. Есть execution ID и фактический terminal JSON для передачи Task 3.

Передача следующему этапу:

```text
Task 2 renderer-ready output
→ REPORT_GENERATION_EXECUTOR_TASK_3_HTML_RENDERER.md
```
