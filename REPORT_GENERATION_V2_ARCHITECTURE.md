# Report Generation V2 — архитектура

Дата проектирования: 24.08.2026  
Рабочая ветка: `feature/report-generation-docx-v2`  
Статус: проектирование; workflow, Code Nodes и PostgreSQL не изменялись

## 1. Цель

Создать стабильный read-only слой генерации клиентского HTML-отчёта поверх уже завершённого анализа закупки.

Архитектура анализа остаётся без изменений:

```text
Aggregator / Targeted Recheck
→ tender_analysis_field_results
→ Finalization
→ Report Generation V2
```

Report Generation не извлекает новые факты, не меняет статусы и не переинтерпретирует документы.

## 2. Неприкосновенный контракт анализа

Источник истины для Report Generation — 27 строк `tender_analysis_field_results`, прочитанные в порядке `field_index`.

Следующие поля должны пройти в Report Snapshot без переименования и изменения значений:

```text
field_index
field_key
status
value_text
confidence
requires_human_review
result_json
```

Запрещено:

- `field_key → field`;
- `field_key → key`;
- `value_text → value`;
- `requires_human_review → requires_review`;
- заменять `field_key` клиентским названием;
- подменять `value_text` значением из `tender_meta`;
- модифицировать `result_json` при добавлении источников.

Клиентское название поля создаётся только в отдельном presentation-слое Report Adapter.

## 3. Проверенные источники и фактическое состояние

Проверены:

- `README.md`, `ARCHITECTURE.md`, `DATA_MODEL.md`, `FIELD_CATALOG.md`, `REPORT_FIELD_MAPPING.md`;
- `TENDER — Агрегация закупки.json`;
- `TENDER — Финализация анализа.json`;
- `beta/TENDER — Генерация отчета beta v2.json`;
- live workflow через read-only n8n API;
- executions `13856`, `13863`, `13864`, `13892`;
- все пять таблиц, доступные роли `tender_codex_ro`, только через `SELECT` и TLS verification.

Локальный beta-export и live Report workflow совпадают по:

```text
workflow_id = ckPnP3hRhKu4Mf9u
versionId   = c3de6189-6e82-49b3-8ce8-d5e9f66727c0
nodes       = 14
```

### 3.1. Runtime проверенного run

```text
analysis_run_id = f9d8e1d7-f01a-4d91-8eac-89c8376535c2
run.status      = completed
documents      = 3
analysis units = 18
facts          = 38
FINAL results  = 27

resolved        = 11
requires_review = 3
not_found       = 13
```

Finalization execution `13863` завершился успешно и передал report stage событие:

```json
{
  "analysis_run_id": "f9d8e1d7-f01a-4d91-8eac-89c8376535c2",
  "run_exists": true,
  "run_status_before": "aggregating",
  "final_count": 27,
  "barrier_ready": true,
  "completion_claimed": true,
  "missing_keys": [],
  "unexpected_keys": [],
  "invalid_status_keys": [],
  "invalid_catalog_keys": [],
  "invalid_contract_keys": [],
  "finalization_state": "completed_now"
}
```

Historical execution `13864` вызвал ещё stub. Execution `13892` относится к промежуточной версии Report workflow и упал в `Подготовить структуру отчёта` с `Нет данных закупки [line 21]`.

### 3.2. PostgreSQL

Live schema совпадает с `DATA_MODEL.md`. Доступны:

| Таблица | Роль в Report V2 |
|---|---|
| `tender_analysis_runs` | completed run и `tender_meta` |
| `tender_analysis_documents` | имя и тип документа |
| `tender_analysis_units` | связь unit с документом, `source_pages`, `ai_segments`, provenance |
| `tender_analysis_facts` | разрешение `candidate_ref`, document и исходное evidence |
| `tender_analysis_field_results` | канонические 27 результатов |

Новая таблица для Report Model не нужна. Snapshot и Report Model являются объектами одного execution и строятся read-only.

### 3.3. Evidence в проверенном run

В 27 FINAL results найдено 29 элементов evidence:

- 23 содержат `candidate_ref="fact:..."`; все 23 разрешаются в fact и document;
- 3 относятся к TenderPlan metadata;
- 3 содержат `analysis_unit_id`;
- у `payment_terms` четыре evidence, поэтому выбор только первого источника недопустим;
- у 13 `not_found` полей evidence пустой, что корректно;
- у DOCX номер страницы может отсутствовать, и Report Adapter не должен его придумывать.

## 4. Обнаруженные противоречия

### 4.1. «Контракт выходит из Finalization» и фактический transport

Логически Finalization открывает границу Report Generation. Фактически он не передаёт 27 field objects: он передаёт completion event и `analysis_run_id`.

Authoritative состояние:

```text
Finalization event
  +
canonical rows в tender_analysis_field_results
  ↓
Report Snapshot
```

Поэтому upstream менять не требуется. Report Generation сам перечитывает completed snapshot по `analysis_run_id`.

### 4.2. Текущий beta workflow нарушает контракт

Нода `Собрать итоговые данные` делает:

```text
field_key             → key
value_text            → value
requires_human_review → requires_review
```

Это противоречит заданному контракту. Исправление должно происходить только внутри Report Generation: канонический объект сохраняется без изменений, presentation добавляется рядом.

### 4.3. Текущая цепочка источников теряет envelope

В beta workflow:

```text
Собрать итоговые данные
→ Получить документы источников
→ Получить факты источников
→ Обогатить источники документов
```

Проблемы:

- результат запроса документов не содержит `analysis_run_id`, хотя следующая нода читает `$json.analysis_run_id`;
- `Обогатить источники документов` фактически получает rows facts, но трактует их как documents;
- lookup создаётся по `fact.id`, а поиск выполняется по `document_id`;
- берётся только первый evidence;
- `Получить факты источников` загружает данные, которые текущий Code Node не использует корректно;
- units не загружаются, поэтому fallback по `analysis_unit_id` невозможен.

## 5. Целевая архитектура

```text
Finalization
    ↓ completion event + analysis_run_id
Report Snapshot
    ↓ immutable analysis contract + source index
Report Adapter
    ↓ canonical analysis + presentation + normalized sources
Report Model
    ↓ validated renderer input
HTML Renderer
    ↓ self-contained HTML
HTML file
```

### 5.1. Разделение ответственности

| Слой | Делает | Не делает |
|---|---|---|
| Finalization | подтверждает 27/27 и completed lifecycle | не строит отчёт |
| Report Snapshot | одним read-only запросом фиксирует данные run | не переименовывает поля |
| Report Adapter | добавляет presentation и нормализует sources | не меняет analysis contract |
| Report Model | собирает шапку, статистику и порядок отображения | не читает БД |
| HTML Renderer | рендерит validated model | не знает DB/evidence resolution |

## 6. Выход Finalization без изменений

Report Generation должен принимать существующий completion event без изменения Finalization workflow.

Обязательные для автоматического запуска поля:

```json
{
  "analysis_run_id": "uuid",
  "final_count": 27,
  "barrier_ready": true,
  "completion_claimed": true,
  "finalization_state": "completed_now"
}
```

Остальные diagnostic fields Finalization сохраняются как часть входного события, но не являются заменой Report Snapshot.

Канонические field results не следует проталкивать через Finalization. Они уже атомарно сохранены в PostgreSQL и загружаются Report Generation read-only запросом.

## 7. Report Snapshot

### 7.1. Назначение

Report Snapshot — внутренний неизменяемый снимок данных одного completed run. Это JSON одного execution, а не новая PostgreSQL-таблица.

Рекомендуется сформировать snapshot одним SQL statement с JSON aggregates. Это даёт один согласованный read-only снимок и устраняет последовательную потерю `analysis_run_id` между PostgreSQL nodes.

### 7.2. Контракт

```json
{
  "snapshot_version": "tender_report_snapshot_v2",
  "analysis_run_id": "f9d8e1d7-f01a-4d91-8eac-89c8376535c2",
  "analysis_run": {
    "status": "completed",
    "tender_id": "...",
    "tender_number": "10273121",
    "tender_meta": {}
  },
  "field_results": [
    {
      "field_index": 14,
      "field_key": "payment_terms",
      "status": "resolved",
      "value_text": "Авансовый платеж не предусмотрен...",
      "confidence": 0.98,
      "requires_human_review": false,
      "result_json": {}
    }
  ],
  "source_index": {
    "documents": [
      {
        "document_id": "internal UUID",
        "document_index": 2,
        "file_name": "Проект договора.pdf",
        "display_name": "Проект договора.pdf",
        "file_extension": "pdf"
      }
    ],
    "facts": [
      {
        "fact_id": "internal UUID",
        "field_key": "payment_terms",
        "document_id": "internal UUID",
        "analysis_unit_id": "internal id",
        "validator_verdict": "confirmed",
        "evidence": []
      }
    ],
    "units": [
      {
        "document_id": "internal UUID",
        "analysis_unit_id": "internal id",
        "source_pages": [2],
        "ai_segments": [],
        "provenance": {}
      }
    ]
  },
  "snapshot_validation": {
    "run_status": "completed",
    "field_count": 27
  }
}
```

Internal UUID и technical ids разрешены только в Snapshot/source index. Они не должны попасть в HTML.

### 7.3. Snapshot invariants

- run существует и имеет `status="completed"`;
- `field_results.length === 27`;
- `field_index` образует точный набор `1..27`;
- пара `field_index/field_key` совпадает с `FIELD_CATALOG.md`;
- статус только `resolved`, `requires_review`, `not_found`;
- семь полей исходного контракта существуют и не переименованы;
- `not_found` не превращается в отрицательный факт;
- snapshot query выполняет только `SELECT`.

## 8. Report Adapter

### 8.1. Где происходит `field_key → название поля`

Только в Report Adapter.

Adapter использует `REPORT_FIELD_MAPPING.md` как mapping client presentation и `FIELD_CATALOG.md` как semantic reference. Он не заменяет `field_key`, а добавляет отдельный объект `presentation`.

```json
{
  "analysis_result": {
    "field_index": 14,
    "field_key": "payment_terms",
    "status": "resolved",
    "value_text": "Авансовый платеж не предусмотрен...",
    "confidence": 0.98,
    "requires_human_review": false,
    "result_json": {}
  },
  "presentation": {
    "client_field_name": "Условия оплаты",
    "section_name": "Исполнение договора",
    "status_text": "Подтверждено"
  },
  "sources": []
}
```

`client_field_name` не является новым analysis field и не заменяет `field_key`.

### 8.2. Где добавляются document, page, quote и source

Только в Report Adapter, в отдельном `sources[]` рядом с неизменённым `analysis_result`.

```json
{
  "kind": "document",
  "document": "Проект договора.pdf",
  "page": 2,
  "page_to": 2,
  "sheet": null,
  "quote": "Авансовый платеж не предусмотрен...",
  "location_status": "exact"
}
```

Для TenderPlan metadata:

```json
{
  "kind": "tender_metadata",
  "document": "TenderPlan — карточка закупки",
  "page": null,
  "page_to": null,
  "sheet": null,
  "quote": null,
  "location_status": "not_applicable"
}
```

Для `not_found`:

```json
{
  "sources": []
}
```

### 8.3. Алгоритм разрешения источника

Для каждого элемента `analysis_result.result_json.evidence[]`:

1. Сохранить все evidence; не выбирать только первый.
2. Взять `quote`, page/page range и sheet из FINAL evidence, если они заполнены.
3. Если embedded document уже есть, использовать его.
4. Если есть `candidate_ref="fact:<uuid>"`, найти fact по `fact_id`, затем document по `document_id`.
5. Если есть `analysis_unit_id`, найти unit в пределах текущего run; использовать документ только при однозначном совпадении.
6. Для `semantic_block_id` разрешать location через fact evidence/`ai_segments` только при однозначном match.
7. Для metadata evidence создать `kind="tender_metadata"`.
8. Дедуплицировать только полностью совпадающие client-safe sources.
9. Удалить из source object UUID, `candidate_ref`, `semantic_block_id`, `analysis_unit_id` и fact ids.
10. Если страница или лист отсутствуют, оставить `null`; не вычислять и не придумывать значение.

Quote берётся только из evidence. Нельзя создавать quote из `value_text`.

## 9. Report Model

### 9.1. Назначение

Report Model — единственный вход HTML Renderer. Он не хранится в отдельной таблице.

```json
{
  "report_model_version": "tender_report_model_v2",
  "internal": {
    "analysis_run_id": "f9d8e1d7-f01a-4d91-8eac-89c8376535c2",
    "snapshot_version": "tender_report_snapshot_v2"
  },
  "procurement": {
    "number": "10273121",
    "subject": "...",
    "customer": "...",
    "platform": "...",
    "price": "...",
    "publication_at": "..."
  },
  "statistics": {
    "total": 27,
    "resolved": 11,
    "requires_review": 3,
    "not_found": 13
  },
  "fields": [
    {
      "analysis_result": {
        "field_index": 14,
        "field_key": "payment_terms",
        "status": "resolved",
        "value_text": "Авансовый платеж не предусмотрен...",
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
          "quote": "Авансовый платеж не предусмотрен...",
          "location_status": "exact"
        }
      ]
    }
  ],
  "attention_field_indexes": [2, 17, 21]
}
```

`attention_field_indexes` — производная проекция полей с `requires_human_review=true`. Она не является вторым источником истины.

### 9.2. Report Model invariants

- `fields.length === 27`;
- порядок — `analysis_result.field_index` 1..27;
- `analysis_result` содержит исходные имена и значения;
- statistics вычисляется из `status`, а не принимается на доверии;
- `attention_field_indexes` соответствует `requires_human_review=true`;
- `sources` всегда массив;
- presentation mapping содержит все 27 `field_key`;
- `result_json` остаётся internal audit data и никогда не сериализуется целиком в HTML.

## 10. HTML Renderer

Renderer читает только утверждённые paths Report Model:

```text
procurement
statistics
fields[].analysis_result.status
fields[].analysis_result.value_text
fields[].presentation
fields[].sources
attention_field_indexes
```

Renderer не читает БД, не разрешает sources и не меняет business semantics.

HTML содержит:

1. титульный блок: номер, предмет, заказчик, площадка, цена, дата;
2. summary: всего, подтверждено, требует проверки, не найдено;
3. таблицу из 27 строк: `Поле / Значение / Источник`;
4. все источники каждого поля: документ, страница/лист, цитата;
5. блок «Требует внимания» только для `requires_review`;
6. статистику анализа.

Требования безопасности:

- экранировать все динамические значения через `escapeHtml`;
- self-contained HTML без внешних scripts/styles/resources;
- не выводить UUID, `field_key`, `result_json`, `semantic_block_id`, `fact_id`, `analysis_unit_id`, `candidate_ref`;
- `not_found` отображать нейтрально: «Не удалось надёжно установить по доступным источникам»;
- не скрывать строки `not_found`: таблица остаётся 27/27.

## 11. Целевой n8n workflow

```text
When Executed by Another Workflow
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

Логических слоёв пять; validation и file packaging являются guards вокруг них.

## 12. Судьба текущих нод beta v2

| Текущая нода | Решение | Целевая роль |
|---|---|---|
| `When Executed by Another Workflow` | оставить | вход Finalization event |
| `Проверить результат финализации` | оставить | guard `analysis_run_id/27/barrier/completion` |
| `Получить данные закупки` | переписать и переименовать | `Получить Report Snapshot`, один read-only SQL |
| `Нормализовать данные закупки` | переписать и переименовать | `Проверить Report Snapshot` |
| `Получить результаты анализа` | удалить | поглощена snapshot query |
| `Собрать итоговые данные` | переписать и переименовать | `Адаптировать поля отчёта` |
| `Подготовить данные отчёта` | переписать и переименовать | `Собрать Report Model` |
| `Подготовить структуру отчёта` | переписать и переименовать | `Проверить Report Model` |
| `Подготовить данные для отчёта` | переписать и переименовать | `Сгенерировать HTML` |
| `Сформировать Markdown отчёт` | переписать и переименовать | `Создать HTML файл` |
| `Создать Markdown файл` | переписать и переименовать | `Проверить HTML файл` |
| `Получить документы источников` | удалить | поглощена snapshot query |
| `Получить факты источников` | удалить | поглощена snapshot query |
| `Обогатить источники документов` | удалить | заменена Report Adapter |

Удаление здесь означает будущий implementation action после согласования архитектуры. В рамках проектирования ноды не изменялись.

## 13. Почему snapshot одним SQL лучше текущей цепочки

- один `analysis_run_id` используется во всех CTE;
- один SQL statement видит согласованный snapshot;
- нет потери envelope между PostgreSQL nodes;
- не нужен Merge как synchronization mechanism;
- источник данных остаётся PostgreSQL;
- query остаётся read-only;
- Report Adapter получает один объект с явным контрактом.

Для крупного run source index следует ограничивать текущим `analysis_run_id` и выбирать только необходимые columns. Весь `analysis_unit` загружать не требуется.

## 14. Ошибки и fail-fast policy

| Код | Условие |
|---|---|
| `REPORT_INPUT_INVALID` | нет `analysis_run_id` или invalid Finalization event |
| `REPORT_RUN_NOT_COMPLETED` | run отсутствует или не completed |
| `REPORT_SNAPSHOT_FIELD_COUNT_INVALID` | не 27 результатов |
| `REPORT_ANALYSIS_CONTRACT_CHANGED` | отсутствует/переименовано одно из семи полей |
| `REPORT_FIELD_MAPPING_INCOMPLETE` | нет presentation mapping для одного из 27 keys |
| `REPORT_SOURCE_AMBIGUOUS` | source нельзя разрешить однозначно; не выбирать первый молча |
| `REPORT_MODEL_INVALID` | statistics/order/status invariants нарушены |
| `REPORT_HTML_INVALID` | файл пустой, нет обязательных sections или не 27 rows |
| `REPORT_HTML_INTERNAL_DATA_LEAK` | в HTML обнаружены internal ids/keys |

Неоднозначная страница при корректно установленном документе не обязательно останавливает отчёт: `page=null`, `location_status="unavailable"` и видимая пометка. Неоднозначный document нельзя выбирать молча.

## 15. Архитектурные решения

1. Aggregator, Targeted Recheck и Finalization не меняются.
2. PostgreSQL schema не меняется.
3. Отдельная таблица Report Model не создаётся.
4. Analysis contract сохраняется неизменным внутри `analysis_result`.
5. Client names добавляются только в `presentation`.
6. Sources нормализуются только в Report Adapter.
7. Все evidence сохраняются как `sources[]`.
8. HTML Renderer является полностью детерминированным.
9. В HTML нет internal audit identifiers.
10. Реализация workflow начинается только после отдельного согласования этой архитектуры.

