# TENDER — Генерация отчета

**Workflow ID:** `ckPnP3hRhKu4Mf9u`
**Фактический export:** `workflows/n8n-exports/TENDER — Генерация отчета.json`
**Назначение:** детерминированно построить client-facing HTML artifact из уже завершённого FINAL-анализа закупки.

## 1. Место в системе

```text
Orchestrator
→ Document Worker
→ Aggregator
→ Targeted Recheck
→ Finalization
→ TENDER — Генерация отчета
```

Report Generation начинается только после successful Finalization event. Он не извлекает новые facts, не меняет FINAL status/value и не переинтерпретирует исходные документы AI-моделью.

Вход Finalization:

```json
{
  "analysis_run_id": "uuid",
  "final_count": 27,
  "barrier_ready": true,
  "completion_claimed": true,
  "finalization_state": "completed_now"
}
```

Первый guard прекращает execution, если отсутствует `analysis_run_id`, completion claim не получен, barrier не готов или `final_count !== 27`.

## 2. Фактический граф

Имена Code Nodes в export имеют технические n8n-суффиксы из-за истории копирования нод. Ниже сначала дан логический слой, затем фактическое имя.

```text
When Executed by Another Workflow (input от Finalization)
→ Проверить результат финализации           (Проверить результат финализации5)
→ Получить Report Snapshot                 (Получить Report Snapshot4)
→ Проверить Report Snapshot                (Проверить Report Snapshot4)
→ Адаптировать поля отчёта                 (Адаптировать поля отчёта3)
→ Собрать Report Model                     (Собрать Report Model2)
→ Проверить Report Model                   (Проверить Report Model2)
→ Сгенерировать HTML                       (Сгенерировать HTML1)
→ Создать HTML artifact
```

`Создать HTML artifact` — terminal node текущего export. Он создаёт скачиваемый binary property `report_html`; delivery, DOCX и PDF в этот workflow не входят.

## 3. Report Snapshot

### 3.1. Назначение

Нода `Получить Report Snapshot4` выполняет один read-only PostgreSQL query c единым `analysis_run_id` и возвращает один объект:

```text
report_snapshot.snapshot_version = tender_report_snapshot_v2
```

Snapshot включает:

- `analysis_run`: status, tender identities и `tender_meta`;
- `field_results`: 27 FINAL results, упорядоченных по `field_index`;
- `source_index.documents`;
- `source_index.facts`;
- `source_index.units`.

Он читает только:

```text
tender_analysis_runs
tender_analysis_field_results
tender_analysis_documents
tender_analysis_facts
tender_analysis_units
```

После чтения Report Generation не делает повторных SQL queries: один snapshot является неизменяемым read-only источником данных execution. Guard добавляет рядом только `snapshot_validation`, не изменяя canonical `field_results`.

### 3.2. Snapshot guard

`Проверить Report Snapshot4` работает fail-fast до presentation/source logic. Он проверяет:

- `snapshot_version === tender_report_snapshot_v2`;
- run существует и имеет `status=completed`;
- ровно 27 fields, точный порядок `1..27` и ожидаемые `field_key`;
- exact canonical contract каждого поля:
  `field_index`, `field_key`, `status`, `value_text`, `confidence`, `requires_human_review`, `result_json`;
- status/value/review invariants для `resolved`, `requires_review` и `not_found`;
- существование массивов `documents`, `facts` и `units` в `source_index`.

При нарушении workflow завершает execution с явной ошибкой, например `REPORT_RUN_NOT_COMPLETED`, `REPORT_SNAPSHOT_FIELD_COUNT_INVALID`, `REPORT_ANALYSIS_CONTRACT_CHANGED` или `REPORT_SNAPSHOT_SOURCE_INDEX_INVALID`.

## 4. Report Adapter

`Адаптировать поля отчёта3` берёт только validated snapshot и возвращает `adapter_version=tender_report_adapter_v2`.

Для каждого поля:

- `analysis_result` — копия canonical FINAL object без rename или semantic change;
- `presentation` — отдельный клиентский mapping:

```json
{
  "client_field_name": "Условия оплаты",
  "section_name": "Исполнение договора",
  "status_text": "Подтверждено"
}
```

- `sources` — массив client-safe источников:

```json
{
  "kind": "document",
  "document": "Проект договора.pdf",
  "page": 2,
  "page_to": 2,
  "sheet": null,
  "quote": "…",
  "location_status": "exact"
}
```

Поддерживаются `location_status`: `exact`, `unavailable`, `ambiguous`, а для metadata — `not_applicable`.

### 4.1. Source resolution

Adapter обрабатывает только `result_json.evidence[]` конкретного FINAL result. Он не выбирает произвольный confirmed/requires-review fact по `field_key` или `validator_verdict`.

Поддерживаемые references:

1. `candidate_ref: fact:<uuid>` или exact `fact_id`:
   `fact_id → source_index.facts → document_id → source_index.documents → file_name`.
2. embedded `evidence.document`: имя документа берётся непосредственно из evidence.
3. `analysis_unit_id`: unique unit разрешается через `source_index.units` и его `document_id`.
4. `semantic_block_id`: Adapter ищет unique matching unit в `ai_segments`/provenance и затем его документ.
5. `source_type=tender_metadata`: возвращается отдельный metadata-source:

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

Quote берётся только из evidence. Страницы и sheet берутся из evidence либо source pages unit; если они не установлены, остаются `null`. Workflow не придумывает page, sheet или quote. Неоднозначный document не выбирается молча; diagnostics отражают unresolved/ambiguous reference.

Для `status=not_found` evidence не обрабатываются и всегда формируется `sources: []`. Sources дедуплицируются только при полном совпадении client-safe source object.

Internal ids (`fact_id`, `document_id`, `analysis_unit_id`, `semantic_block_id`, bbox, provenance и AI segments) применяются только внутри Adapter и не попадают в `sources[]`.

## 5. Report Model

`Собрать Report Model2` не читает БД. Он строит единственный renderer input:

```json
{
  "report_model_version": "tender_report_model_v2",
  "internal": {
    "analysis_run_id": "uuid",
    "snapshot_version": "tender_report_snapshot_v2"
  },
  "procurement": {},
  "statistics": {},
  "fields": [],
  "attention_field_indexes": []
}
```

- `procurement` — presentation data из `analysis_run.tender_meta` (number, subject, customer, platform, price, publication_at); missing metadata становится `null`, не подменяет FINAL value.
- `statistics` пересчитывается из `analysis_result.status`.
- `fields` — те же adapter fields без normalization/copy-on-write presentation logic.
- `attention_field_indexes` — производная проекция полей с `requires_human_review === true`.

`Проверить Report Model2` повторно проверяет порядок всех 27 fields, exact canonical/presentation/source contracts, statistics, пустые sources у `not_found` и attention indexes. Успешный output содержит:

```json
{ "model_validation": { "valid": true } }
```

Canonical `analysis_result` и `result_json` остаются internal audit data в Report Model. Renderer не должен сериализовать их целиком в HTML.

## 6. HTML Renderer

`Сгенерировать HTML1` принимает только `tender_report_model_v2` с `model_validation.valid=true`. Он не делает DB queries, source resolution или AI calls.

Renderer создаёт self-contained HTML с inline CSS и обязательными sections:

```text
title
summary
fields
attention
statistics
```

HTML содержит ровно 27 client-facing rows с `data-field-index="1" … "27"`:

- label берётся из `presentation.client_field_name`;
- значение — из `analysis_result.value_text`;
- отображаются все уже подготовленные `sources[]`;
- block `attention` содержит только `requires_human_review=true`.

Все динамические values и quotes проходят `escapeHtml`. HTML не выводит UUID, `field_key`, `result_json`, `confidence`, `fact_id`, `semantic_block_id`, `analysis_unit_id`, `candidate_ref` или `analysis_run_id`. Последний остаётся только в техническом JSON output Renderer/Artifact, а не в HTML.

`not_found` не означает отрицательный факт и показывается нейтрально:

```text
Не удалось надёжно установить по доступным источникам
```

`requires_review` имеет отдельный status label и отдельный attention block.

## 7. HTML artifact

`Создать HTML artifact` превращает `html` Renderer в UTF-8 binary:

```text
binary.report_html
mimeType = text/html
fileName = Renderer filename
```

Нода проверяет non-empty HTML, filename с расширением `.html`, `mime_type=text/html`, положительный byte size и Base64 round-trip equality с Renderer HTML. В terminal JSON остаются metadata и `artifact_validation`; raw HTML находится только в binary.

## 8. Reference regression

Reference run:

```text
analysis_run_id = f9d8e1d7-f01a-4d91-8eac-89c8376535c2
```

Подтверждённые результаты:

| Проверка | Результат |
|---|---:|
| Fields / total | 27 |
| resolved | 11 |
| requires_review | 3 |
| not_found | 13 |
| attention_field_indexes | [2, 17, 21] |
| Sources | 29 |
| payment_terms sources | 4 |
| Internal data leaks in HTML | 0 |
| HTML escaping test | passed |

Для HTML artifact того же run:

```text
filename = Анализ закупки_10273121.html
mimeType = text/html
binary property = report_html
size = 30592 UTF-8 bytes
decoded binary = Renderer HTML
```

## 9. Limitations and future work

Текущая реализация **не** включает:

- PDF generation;
- DOCX generation;
- automatic delivery, Telegram или email;
- manual upload workflow;
- source ranking/filtering beyond exact-source resolution and full-identical deduplication;
- client-safe projection of internal `review_note`;
- XLSX artifact.

Эти возможности являются future work/technical debt, а не частью текущего completed HTML workflow.

## 10. Legacy documentation

Файлы `REPORT_GENERATION_V2_ARCHITECTURE.md`, `REPORT_GENERATION_V2_IMPLEMENTATION_PLAN.md` и `REPORT_GENERATION_V2_EXECUTOR_PROMPT.md` описывают согласование и поэтапную реализацию beta export. Они не являются описанием текущего runtime workflow. Актуальный источник документирования — этот файл и основной JSON export.
