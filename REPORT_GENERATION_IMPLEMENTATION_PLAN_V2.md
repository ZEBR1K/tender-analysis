# Report Generation Implementation Plan V2

> План предназначен для последовательного выполнения на ветке `feature/report-generation-docx-v2`. Не использовать субагентов. После каждого логического этапа остановиться, проверить runtime contract и только затем переходить дальше.

Дата: 24.08.2026
Scope: только `TENDER — Генерация отчета` и HTML presentation layer для MVP
Запрещено этим планом: менять Aggregator, Targeted Recheck, Finalization, FINAL semantics или PostgreSQL schema

## 1. Целевой результат

```text
analysis_run_id
→ completed + 27/27 DB check
→ tender_report_data_v2
→ normalized sources
→ tender_report_html_v1
→ valid HTML binary
→ Telegram document
```

Acceptance criteria:

1. Report workflow можно запустить с одним `analysis_run_id`.
2. Он читает только completed run и ровно 27 FINAL results.
3. В HTML есть 27 строк в порядке `1..27`.
4. Колонки: `Поле`, `Значение`, `Источник`.
5. Для document sources показываются filename, page/sheet, quote.
6. Для всех evidence сохраняется массив `sources[]`; первый источник не вытесняет остальные.
7. В HTML нет UUID, `semantic_block_id`, `fact_id`, `analysis_unit_id`, `candidate_ref`, `field_key`.
8. `not_found` не преобразуется в отрицательный ответ.
9. Report workflow не вызывает AI и не пишет в analysis tables.
10. Self-contained HTML открывается локально в браузере, корректно отображается в print preview и успешно отправляется в Telegram.

## 2. Перед началом реализации

1. Выполнить `git status --short --branch` и убедиться, что активна `feature/report-generation-docx-v2`.
2. Прочитать:
   - `README.md`;
   - `ARCHITECTURE.md`;
   - `DATA_MODEL.md`;
   - `FIELD_CATALOG.md`;
   - `REPORT_FIELD_MAPPING.md`;
   - `REPORT_GENERATION_ARCHITECTURE_V2.md`;
   - `workflows/n8n-exports/TENDER — Генерация отчета.json`;
   - `workflows/n8n-exports/TENDER — Финализация анализа.json`.
3. Сверить local Report workflow с live read-only export. При расхождении остановиться и считать live workflow production source of truth.
4. Не редактировать upstream workflow exports.
5. Не выполнять write API calls к production n8n и PostgreSQL.
6. Подготовить sanitized fixture по run `f9d8e1d7-f01a-4d91-8eac-89c8376535c2`; UUID допустим во fixture только как internal test input и не должен оказаться в rendered HTML.

## 3. Порядок реализации

### Этап 1. Изолированно исправить текущую ошибку envelope

Цель этапа — подтвердить root cause `Нет данных закупки [line 21]`, не смешивая bug fix с HTML refactor.

Предпочтительный минимальный diff:

```text
Собрать итоговые данные
→ Подготовить данные отчёта
```

Временно обойти `Добавить источники и доказательства`.

Проверка после изменения:

- input `Подготовить данные отчёта` имеет keys `analysis_run_id, procurement, fields, statistics`;
- input `Подготовить структуру отчёта` имеет keys `analysis_run_id, procurement, statistics, report_fields`;
- ошибка строки 21 исчезла;
- execution доходит до Markdown binary.

Альтернатива, если нельзя менять connection: заменить код `Добавить источники и доказательства` на envelope-preserving вариант:

```js
const input = $json;

if (!input.analysis_run_id) {
  throw new Error('Источники: отсутствует analysis_run_id');
}

if (!input.procurement || !Array.isArray(input.fields) || !input.statistics) {
  throw new Error('Источники: ожидался envelope analysis_run_id/procurement/fields/statistics');
}

const fields = input.fields.map((field) => ({
  ...field,
  sources: Array.isArray(field.result_json?.evidence)
    ? field.result_json.evidence.map((evidence) => ({
        document: evidence.document?.file_name ?? null,
        page_from: evidence.page_from ?? null,
        page_to: evidence.page_to ?? null,
        sheet_name: evidence.sheet_name ?? null,
        quote: evidence.quote ?? null,
      }))
    : [],
}));

return [{ json: { ...input, fields } }];
```

Это только regression repair. Не считать его завершённой архитектурой sources.

После runtime-проверки сохранить execution ID в `DEVELOPMENT_LOG.md` только в конце всей V2-задачи, не в середине.

### Этап 2. Зафиксировать HTML contract и inline template

Сравнение реализации:

| Вариант | Сложность | Надёжность | Поддерживаемость | Решение |
|---|---|---|---|---|
| HTML template внутри Code Node | низкая | высокая при обязательном escaping и structural tests | средняя | выбрать для MVP |
| HTML template file + заполнение | средняя: нужно гарантировать file availability всем runners | высокая | высокая | перейти после стабилизации дизайна |
| Отдельный renderer service | высокая: deployment, auth, monitoring | высокая | высокая | отложить, для HTML MVP избыточен |

Выбор: inline HTML/CSS в одной Code Node. Это не смешивает analysis и presentation, потому что нода получает уже validated `tender_report_data_v2` и не выполняет source resolution или semantic decisions.

Не создавать renderer service и новую DB table. Для MVP подготовить в report workflow:

```text
tender_report_data_v2
→ Code Node с versioned inline HTML/CSS template
→ HTML string
→ binary .html
```

Template requirements:

- self-contained HTML5;
- `<meta charset="utf-8">`;
- CSS внутри `<style>`;
- без внешних scripts, styles, fonts и images;
- титульный блок закупки;
- summary из четырёх показателей;
- таблица `Поле | Значение | Источник` с 27 rows;
- блок `Требуют внимания` только для `requires_review`;
- финальная статистика;
- print styles;
- все dynamic values проходят `escapeHtml`;
- version marker `tender_report_html_v1`.

Expected renderer output:

```json
{
  "analysis_run_id": "f9d8e1d7-f01a-4d91-8eac-89c8376535c2",
  "filename": "Краткая справка по закупке 10273121.html",
  "mime_type": "text/html",
  "template_version": "tender_report_html_v1",
  "html": "<!doctype html>..."
}
```

Не создавать отдельный renderer-specific JSON schema: validated `tender_report_data_v2` достаточен для inline renderer.

Не создавать таблицу `report_data_model`: модель детерминированно строится в памяти из completed analysis snapshot. Persistence потребует отдельной схемы versioning/invalidation и не даёт ценности первой HTML-демонстрации. При необходимости durable artifact history вынести это в отдельный milestone.

### Этап 3. Заменить текущий report-data pipeline

Не наращивать текущие четыре несовместимые presentation Code Nodes. Перестроить только report workflow по target graph из архитектурного документа.

Existing nodes to keep:

- `When Executed by Another Workflow`;
- PostgreSQL credential;
- workflow identity/activation settings после проверки.

Existing nodes to replace or rename:

| Текущая нода | Действие |
|---|---|
| `Проверить результат финализации` | заменить на `Проверить вход генерации отчёта` |
| `Получить данные закупки` | заменить query и переименовать в `Загрузить снимок анализа для отчёта` |
| `Нормализовать данные закупки` | заменить на `Проверить готовность данных отчёта` |
| `Получить результаты анализа` | удалить/обойти: результаты входят в единый snapshot query |
| `Собрать итоговые данные` | заменить на `Собрать модель отчёта v2` |
| `Добавить источники и доказательства` | заменить на `Нормализовать источники` |
| `Подготовить данные отчёта` | заменить на `Проверить контракт отчёта v2` |
| `Подготовить структуру отчёта` | заменить на `Сгенерировать HTML отчёт` |
| `Подготовить данные для отчёта` | удалить: semantic overrides запрещены |
| `Сформировать Markdown отчёт` | удалить/обойти после переноса rendering в `Сгенерировать HTML отчёт` |
| `Создать Markdown файл` | заменить на `Создать HTML файл` |

New nodes:

- `Проверить HTML результат`;
- `Отправить HTML в Telegram`.

### Этап 4. Создать HTML binary и интегрировать Telegram

1. `Сгенерировать HTML отчёт` возвращает HTML string и metadata.
2. `Создать HTML файл` создаёт binary property `report_html`, UTF-8, MIME `text/html`, filename `.html`.
3. `Проверить HTML результат` проверяет structure, 27 rows, escaping markers, MIME и filename.
4. Telegram node отправляет `report_html` как Document.
5. Caption не содержит UUID; достаточно tender number и распределения статусов.
6. Telegram response является terminal output MVP; run/artifact context остаётся в предыдущих execution data.

### Этап 5. Runtime regression

Выполнять проверки последовательно:

1. Unit-like execution на snapshot fixture до renderer.
2. HTML renderer test на synthetic 27-row model.
3. Full report execution для `f9d8e1d7-f01a-4d91-8eac-89c8376535c2` без Telegram либо в test chat.
4. Visual review HTML в браузере и print preview.
5. Telegram delivery в test chat.
6. Повторный запуск report workflow по тому же run id.
7. Negative scenarios из раздела 8.

Только после всех проверок обновить docs и экспорт workflow JSON.

## 4. Спецификация каждой новой/изменяемой ноды

### 4.1. `Проверить вход генерации отчёта`

Тип: Code
Действие: изменить существующую `Проверить результат финализации`

Назначение:

- проверить формат `analysis_run_id`;
- сохранить transient Finalization diagnostics, если они есть;
- разрешить retry с одним `analysis_run_id`.

Вход:

```json
{
  "analysis_run_id": "f9d8e1d7-f01a-4d91-8eac-89c8376535c2",
  "completion_claimed": true,
  "barrier_ready": true,
  "final_count": 27
}
```

Выход:

```json
{
  "analysis_run_id": "f9d8e1d7-f01a-4d91-8eac-89c8376535c2",
  "trigger_context": {
    "completion_claimed": true,
    "barrier_ready": true,
    "final_count": 27
  }
}
```

Dependencies:

- Execute Workflow Trigger;
- UUID validation function.

Ошибки:

- нет id → `REPORT_INPUT_MISSING_RUN_ID`;
- неверный UUID → `REPORT_INPUT_INVALID_RUN_ID`.

Не делать:

- не блокировать retry из-за `completion_claimed !== true`;
- не считать transient flags source of truth.

### 4.2. `Загрузить снимок анализа для отчёта`

Тип: PostgreSQL / Execute Query
Действие: изменить и переименовать существующую `Получить данные закупки`

Назначение: одним read-only SELECT получить согласованный snapshot.

Вход:

```json
{
  "analysis_run_id": "f9d8e1d7-f01a-4d91-8eac-89c8376535c2"
}
```

Выход:

```json
{
  "snapshot": {
    "analysis_run": {
      "id": "f9d8e1d7-f01a-4d91-8eac-89c8376535c2",
      "status": "completed",
      "tender_meta": {}
    },
    "field_results": [],
    "documents": [],
    "facts": [],
    "units": []
  }
}
```

Query requirements:

- только `SELECT`;
- parameter `$1` через query replacement `{{ $json.analysis_run_id }}`;
- `field_results` сортировать по `field_index`;
- facts загружать для текущего run, включая `id`, `document_id`, `analysis_unit_id`, `evidence`;
- units загружать для текущего run, включая `document_id`, `analysis_unit_id`, `source_pages`, `ai_segments`, `provenance`;
- documents включают `id`, `file_name`, `display_name`, `file_extension`, `document_index`;
- использовать `COALESCE(..., '[]'::jsonb)` для массивов;
- вернуть один item, а не fan-out rows.

Dependencies:

- текущая PostgreSQL credential;
- существующие пять таблиц;
- `DATA_MODEL.md`.

Ошибки:

- run отсутствует: downstream guard `REPORT_RUN_NOT_FOUND`;
- DB timeout/query error: execution fail, не возвращать пустой snapshot;
- более одного top-level item: `REPORT_SNAPSHOT_CARDINALITY_ERROR`.

### 4.3. `Проверить готовность данных отчёта`

Тип: Code
Действие: заменить `Нормализовать данные закупки`

Назначение: DB-backed barrier непосредственно перед report building.

Вход: snapshot из предыдущей ноды.

Выход:

```json
{
  "schema_version": "tender_report_snapshot_v2",
  "analysis_run": {},
  "field_results": ["27 ordered rows"],
  "source_index": {
    "documents": {},
    "facts": {},
    "units": []
  },
  "readiness": {
    "ready": true,
    "final_count": 27
  }
}
```

Проверки:

- run существует;
- `status === "completed"`;
- 27 rows;
- unique `field_index` и `field_key`;
- indexes exactly `1..27`;
- `field_catalog_version === "tender_fields_v1"`;
- `result_contract_version === "tender_field_final_v1"`;
- statuses из `resolved/requires_review/not_found`;
- `result_json` существует.

Dependencies:

- FIELD_CATALOG 27-key order;
- FINAL contract.

Ошибки:

- `REPORT_RUN_NOT_COMPLETED`;
- `REPORT_FINAL_COUNT_NOT_27`;
- `REPORT_FINAL_DUPLICATE_KEY`;
- `REPORT_FINAL_CONTRACT_INVALID`.

При любой ошибке: бросить exception с `analysis_run_id` и безопасной диагностикой, но не выводить credentials.

### 4.4. `Собрать модель отчёта v2`

Тип: Code
Действие: переписать `Собрать итоговые данные`

Назначение:

- построить report model независимо от HTML/будущего DOCX renderer;
- применить exact labels из `REPORT_FIELD_MAPPING.md`;
- сохранить FINAL semantics без замены значений.

Вход: validated snapshot.

Выход:

```json
{
  "schema_version": "tender_report_data_v2",
  "internal": {
    "analysis_run_id": "f9d8e1d7-f01a-4d91-8eac-89c8376535c2",
    "source_index": {}
  },
  "report": {
    "title": "Краткая справка по закупке №10273121",
    "procurement": {},
    "statistics": {
      "total": 27,
      "resolved": 11,
      "requires_review": 3,
      "not_found": 13
    },
    "fields": [
      {
        "order": 1,
        "internal_field_key": "procurement_subject",
        "label": "Предмет закупки",
        "status": "resolved",
        "value": "...",
        "review_note": null,
        "not_found_note": null,
        "raw_evidence": []
      }
    ],
    "attention_fields": []
  }
}
```

`internal_field_key`, raw evidence и source indexes находятся только во временной internal model. `attention_fields` строится только из `requires_review`. Internal данные должны быть удалены до renderer.

Dependencies:

- один декларативный mapping из 27 объектов;
- `REPORT_FIELD_MAPPING.md`;
- `FIELD_CATALOG.md` для semantics.

Ошибки:

- mapping не содержит один из 27 keys;
- duplicate order/label;
- `resolved` без value;
- `not_found` с синтетическим отрицательным value.

Не делать:

- не скрывать `not_found` rows;
- не заменять `nm_price_with_vat` значением `tender_meta.max_price`;
- не использовать hardcoded review explanation вместо canonical review data.

### 4.5. `Нормализовать источники`

Тип: Code
Действие: полностью переписать `Добавить источники и доказательства`

Назначение: превратить распределённое audit evidence в отдельные client-safe source entities.

Вход:

```json
{
  "internal": { "source_index": {} },
  "report": {
    "fields": [
      {
        "raw_evidence": [
          {
            "candidate_ref": "fact:internal-id",
            "semantic_block_id": "internal-block",
            "quote": "Авансовый платеж не предусмотрен...",
            "page_from": 2
          }
        ]
      }
    ]
  }
}
```

Выход:

```json
{
  "schema_version": "tender_report_data_v2",
  "internal": {
    "analysis_run_id": "f9d8e1d7-f01a-4d91-8eac-89c8376535c2"
  },
  "report": {
    "fields": [
      {
        "order": 14,
        "label": "Условия оплаты",
        "status": "resolved",
        "value": "Авансовый платеж не предусмотрен...",
        "source": {
          "document": "Проект договора.pdf",
          "page": 2,
          "sheet": null,
          "quote": "Авансовый платеж не предусмотрен..."
        },
        "sources": [
          {
            "kind": "document",
            "document": "Проект договора.pdf",
            "page": 2,
            "page_to": 2,
            "sheet": null,
            "quote": "Авансовый платеж не предусмотрен...",
            "role": "primary",
            "is_primary": true,
            "location_status": "exact"
          }
        ]
      }
    ]
  }
}
```

`source` является projection первого primary элемента `sources[]`, а не независимо заполняемым вторым источником.

Resolution precedence:

1. embedded evidence document;
2. `candidate_ref → fact → document`;
3. unique unit match within run;
4. TenderPlan metadata source;
5. unresolved source marker.

Location precedence:

1. explicit FINAL evidence page/sheet;
2. matching fact evidence;
3. matching semantic segment/provenance;
4. unit single source page;
5. location unavailable.

Dependencies:

- source indexes from snapshot;
- deterministic deduplication;
- no external API or AI.

Ошибки:

- ambiguous unit match: не выбирать первый; source получает `location_status="ambiguous"`, workflow продолжает с visible limitation;
- document id найден, document row отсутствует: `resolution_status="unresolved_document"`;
- evidence без quote для document source: разрешено только если это metadata/audit-only source; иначе пометить incomplete.

### 4.6. `Проверить контракт отчёта v2`

Тип: Code
Действие: заменить `Подготовить данные отчёта`

Назначение: последний semantic/data barrier перед presentation.

Вход: `tender_report_data_v2`.

Выход: тот же объект плюс:

```json
{
  "validation": {
    "valid": true,
    "field_count": 27,
    "forbidden_key_hits": 0
  }
}
```

Проверки:

- 27 rows, order `1..27`;
- labels exact;
- statuses valid;
- status/value semantics;
- sources is array;
- no raw evidence/internal keys in `report` subtree;
- ни одно значение в `report` subtree не равно известному internal run/document/fact/unit UUID из snapshot; не запрещать UUID-подобный текст внутри реальной цитаты только по regex;
- no `semantic_block_id`, `fact_id`, `analysis_unit_id`, `candidate_ref`, `field_key`;
- statistics sum to 27.

Dependencies:

- JSON schema `tender-report-data-v2` либо эквивалентная deterministic validation.

Ошибки:

- `REPORT_MODEL_SCHEMA_INVALID`;
- `REPORT_MODEL_INTERNAL_DATA_LEAK`;
- `REPORT_MODEL_STATUS_SEMANTICS_INVALID`.

### 4.7. `Сгенерировать HTML отчёт`

Тип: Code
Действие: полностью переписать `Подготовить структуру отчёта`

Назначение: отрендерить validated `tender_report_data_v2` в self-contained HTML, не меняя semantics.

Вход:

```json
{
  "schema_version": "tender_report_data_v2",
  "internal": {
    "analysis_run_id": "f9d8e1d7-f01a-4d91-8eac-89c8376535c2"
  },
  "report": {
    "procurement": {},
    "statistics": {},
    "fields": ["27 validated fields"],
    "attention_fields": []
  }
}
```

Выход:

```json
{
  "analysis_run_id": "f9d8e1d7-f01a-4d91-8eac-89c8376535c2",
  "filename": "Краткая справка по закупке 10273121.html",
  "mime_type": "text/html",
  "template_version": "tender_report_html_v1",
  "expected_field_count": 27,
  "html": "<!doctype html>..."
}
```

Обязательные render helpers:

- `escapeHtml(value)`;
- `renderSummary(statistics)`;
- `renderSource(source)`;
- `renderFieldRow(field)`;
- `renderAttentionItem(field)`.

HTML sections:

1. `<header data-report-section="title">` — number, subject, customer, platform, price, publication date и generated date.
2. `<section data-report-section="summary">` — 27/11/3/13 counters.
3. `<table data-report-section="fields">` — header plus 27 `<tr data-field-order="...">`.
4. `<section data-report-section="attention">` — только `requires_review`.
5. `<section data-report-section="statistics">` — финальная статистика.

Source formatting:

- PDF: `Страница: 2` или `Страницы: 2–3`;
- XLSX: `Лист: <name>`;
- unknown: `Страница/лист: не определены`;
- metadata: `TenderPlan — карточка закупки`;
- quote показывать как отдельный `<blockquote>`.

Dependencies:

- validated report model;
- inline HTML/CSS template;
- filename sanitization;
- built-in JavaScript only, без external modules.

Ошибки:

- filename empty/unsafe;
- field count not 27;
- missing required report sections;
- `internal` попал в HTML;
- dynamic value вставляется без escaping.

Не добавлять префикс `КТ` без authoritative project code.

### 4.8. `Создать HTML файл`

Тип: Code
Действие: переписать `Создать Markdown файл`

Назначение: превратить готовую HTML string в binary, не меняя content.

Вход:

```json
{
  "analysis_run_id": "f9d8e1d7-f01a-4d91-8eac-89c8376535c2",
  "filename": "Краткая справка по закупке 10273121.html",
  "mime_type": "text/html",
  "template_version": "tender_report_html_v1",
  "html": "<!doctype html>..."
}
```

Выход:

```json
{
  "json": {
    "analysis_run_id": "f9d8e1d7-f01a-4d91-8eac-89c8376535c2",
    "filename": "Краткая справка по закупке 10273121.html",
    "template_version": "tender_report_html_v1"
  },
  "binary": {
    "report_html": {
      "mimeType": "text/html",
      "fileName": "Краткая справка по закупке 10273121.html"
    }
  }
}
```

Implementation contract:

- encoding UTF-8;
- binary property `report_html`;
- MIME `text/html`;
- exact filename from renderer;
- preserve `analysis_run_id` and template version in JSON.

Dependencies:

- Node `Buffer`, уже используемый текущей Markdown file node;
- no filesystem and no external modules.

Ошибки:

- `REPORT_HTML_STRING_MISSING`;
- `REPORT_HTML_FILENAME_INVALID`;
- `REPORT_HTML_ENCODING_FAILED`.

### 4.9. `Проверить HTML результат`

Тип: Code
Действие: новая нода

Назначение: не отправлять пустой, неполный или небезопасный HTML.

Вход: JSON metadata и binary `report_html`.

Выход:

```json
{
  "analysis_run_id": "f9d8e1d7-f01a-4d91-8eac-89c8376535c2",
  "artifact": {
    "filename": "Краткая справка по закупке 10273121.html",
    "mime_type": "text/html",
    "size_bytes": 18342,
    "template_version": "tender_report_html_v1",
    "valid": true
  }
}
```

Binary сохраняется без изменения.

Проверки:

- binary exists;
- filename ends `.html`;
- MIME starts `text/html`;
- UTF-8 text начинается с `<!doctype html>`;
- присутствуют markers title/summary/fields/attention/statistics;
- ровно 27 table-row tags `<tr ... data-field-order="...">`; не считать CSS selectors или другие text occurrences;
- отсутствуют `<script`, `javascript:`, external `<link`, `src="http..."` и CSS `url(http...)`; обычный URL внутри escaped текста evidence не считать external resource;
- отсутствуют known internal IDs и forbidden internal key labels.

Dependencies:

- binary data access, подтверждённый для текущей n8n version;
- список known internal IDs из предыдущих execution data либо explicit guard до удаления internal subtree.

Ошибки:

- `REPORT_HTML_BINARY_MISSING`;
- `REPORT_HTML_MIME_INVALID`;
- `REPORT_HTML_STRUCTURE_INVALID`;
- `REPORT_HTML_FIELD_COUNT_INVALID`;
- `REPORT_HTML_UNSAFE_CONTENT`;
- `REPORT_HTML_INTERNAL_DATA_LEAK`.

### 4.10. `Отправить HTML в Telegram`

Тип: Telegram / Send Document
Действие: новая нода

Назначение: доставить HTML binary клиенту или в test chat.

Вход:

- JSON artifact metadata;
- binary property `report_html`.

Выход, пример:

```json
{
  "ok": true,
  "result": {
    "message_id": 12345,
    "document": {
      "file_name": "Краткая справка по закупке 10273121.html"
    }
  }
}
```

Dependencies:

- Telegram credential;
- approved test/production chat id;
- Input Binary Field = `report_html`.

Ошибки:

- Telegram API error → fail execution;
- `ok !== true` или нет `message_id` → fail;
- не включать UUID/internal diagnostics в caption.

Ограничение: без persisted delivery state неоднозначный timeout может привести к duplicate при retry; exactly-once не заявляется.

## 5. Exact mapping 27 полей

Использовать один декларативный mapping и не дублировать словари между Code Nodes:

| # | `field_key` internal | Client label |
|---:|---|---|
| 1 | `procurement_subject` | Предмет закупки |
| 2 | `nm_price_with_vat` | НМЦ (с НДС) |
| 3 | `platform` | Площадка |
| 4 | `procedure_type` | Тип процедуры |
| 5 | `application_deadline` | Срок окончания приема заявок |
| 6 | `application_review_date` | Дата рассмотрения заявок |
| 7 | `results_date` | Дата подведения итогов |
| 8 | `customer` | Заказчик |
| 9 | `customer_contacts` | Контактная информация Заказчика |
| 10 | `participation_cost` | Стоимость участия |
| 11 | `participation_guarantee` | БГ на участие |
| 12 | `evaluation_criteria` | Критерии оценки |
| 13 | `delivery_term` | Срок поставки (исполнения) |
| 14 | `payment_terms` | Условия оплаты |
| 15 | `special_account_or_treasury` | Спецсчет/казна |
| 16 | `bank_support` | Банковское сопровождение |
| 17 | `government_contract` | Госконтракт |
| 18 | `rebidding` | Переторжка |
| 19 | `national_regime` | Национальный режим |
| 20 | `advance_contract_guarantee` | БГ аванс |
| 21 | `warranty_obligations_guarantee` | БГ гарантийные обязательства |
| 22 | `licenses_certificates` | Лицензии/сертификаты |
| 23 | `required_official_certificates` | Необходимые справки |
| 24 | `similar_supply_experience` | Опыт аналогичных поставок |
| 25 | `analog_allowed` | Допускается ли аналог |
| 26 | `analog_definition` | Что считается аналогом |
| 27 | `application_documents` | Состав заявки |

`field_key` используется для internal mapping, но не рендерится.

## 6. Tests renderer и report model

### 6.1. Contract tests

- happy path: 27 valid rows;
- 26 rows → fail;
- duplicate index → fail;
- unknown key → fail;
- resolved value null → fail;
- not_found gets `Не удалось надёжно установить`, не `нет`;
- exact leak известного internal UUID в public report → fail.

### 6.2. Source resolution tests

- embedded document + page + quote;
- `candidate_ref → fact → document`;
- unit match → document;
- unique `source_pages=[16]` → page 16;
- multiple source pages without exact segment → page remains unknown;
- XLSX sheet source;
- TenderPlan metadata source;
- multiple evidence retained and deduplicated;
- ambiguous unit match does not select first;
- DOCX without page produces visible `не определены`.

### 6.3. HTML renderer tests

- valid HTML5 doctype and UTF-8 meta;
- title block contains number/subject/customer/platform/price/publication date/generated date;
- summary counters equal report statistics;
- exactly 27 `data-field-order` rows;
- columns `Поле / Значение / Источник` exist;
- `attention` contains only `requires_review`;
- source renders document, page/sheet and quote;
- all user/source strings are escaped;
- no `<script>`, external styles/resources or `javascript:` links;
- no UUID/internal labels in rendered HTML;
- long quotes wrap and remain readable;
- print preview does not clip columns;
- filename ends `.html`, MIME is `text/html`.

## 7. Runtime regression scenarios

### R1 — основной production run

Input:

```json
{
  "analysis_run_id": "f9d8e1d7-f01a-4d91-8eac-89c8376535c2"
}
```

Expected:

```text
27 rows
11 resolved
3 requires_review
13 not_found
3 source documents available
HTML valid
```

Проверить минимум поля:

- `payment_terms`: несколько evidence, PDF page 2 и supporting DOCX без page;
- `nm_price_with_vat`: requires_review, source/document/page resolve без подмены FINAL semantic value;
- `platform`: TenderPlan metadata source;
- один XLSX source: sheet name отображается как лист;
- любой `not_found`: нейтральная формулировка.

### R2 — повторный запуск completed run

Ожидание: report workflow проходит DB check без `completion_claimed=true` и создаёт тот же logical content/filename. Generated timestamp может отличаться. Telegram duplicate risk учитывается вручную/test chat.

### R3 — run не completed

Ожидание: fail до renderer/Telegram с `REPORT_RUN_NOT_COMPLETED`.

### R4 — не 27 FINAL

Ожидание: fail до renderer/Telegram с exact count diagnostics.

### R5 — renderer получил unsafe input

Ожидание: dynamic `<`, `>`, `&`, quotes экранированы; HTML validation не обнаруживает executable markup. Telegram получает безопасный файл.

### R6 — повреждённый binary

Ожидание: `Проверить HTML результат` останавливает workflow при пустом binary, неверном MIME, отсутствии mandatory sections или количестве rows не 27.

### R7 — Telegram error

Ожидание: HTML artifact success виден в execution, delivery failure явный; run остаётся completed.

## 8. Проверка после изменений

После каждого этапа:

1. Проверить node input/output в execution data, а не только code preview.
2. Сравнить expected/factual JSON keys.
3. Убедиться, что error path не возвращает success-like object.
4. Проверить, что ни одна analysis table не менялась.
5. Проверить, что upstream exports не изменились.

Перед завершением:

```text
implementation
+ contract tests
+ runtime execution
+ HTML structural validation
+ browser/print visual review
+ Telegram test delivery
```

Git checks:

```powershell
git status --short
git diff -- workflows/n8n-exports/TENDER` —` Генерация` отчета.json
git diff --check
```

Проверить отдельно, что diff не содержит credentials, API keys, database passwords, Telegram token или production URLs с secret query parameters.

## 9. Документация после успешного runtime

Обновить только после подтверждённого E2E:

- `README.md`: HTML MVP вместо report stub/Markdown primary;
- `ARCHITECTURE.md`: report data model и renderer boundary;
- `TECH_DEBT.md`: закрыть report implementation, добавить limitation durable artifact/exactly-once delivery при необходимости;
- `DEVELOPMENT_LOG.md`: execution IDs и проверенный результат;
- новый workflow doc `workflows/report-generation.md`;
- `REPORT_FIELD_MAPPING.md`: только если display mapping действительно изменился.

Не менять:

- `DATA_MODEL.md`, поскольку schema не менялась;
- `FIELD_CATALOG.md`, поскольку бизнес-семантика не менялась.

## 10. Stop conditions

Остановить реализацию и сообщить о противоречии, если:

- live Report workflow отличается от local export;
- live DB schema отличается от `DATA_MODEL.md`;
- inline HTML template не удаётся сделать self-contained без внешних runtime dependencies;
- source normalization требует придумать отсутствующую страницу;
- для завершения требуется изменение FINAL contract или upstream AI logic;
- production write access требуется раньше, чем готовы local fixtures/tests.

## 11. Что оставить для DOCX V2 позже

- versioned DOCX template;
- отдельный DOCX renderer только после подтверждения report model на HTML MVP;
- PDF conversion;
- фирменное оформление, headers/footers и логотипы;
- автоматическая генерация приложений;
- Word/PDF visual regression;
- durable artifact storage и версии отчёта.
