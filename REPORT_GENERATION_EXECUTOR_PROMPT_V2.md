# Prompt для исполнителя Report Generation V2

> **Статус:** этот документ заменён на три последовательных этапа реализации:
>
> 1. [Task 1 — Data Model](REPORT_GENERATION_EXECUTOR_TASK_1_DATA_MODEL.md)
> 2. [Task 2 — Source Normalization](REPORT_GENERATION_EXECUTOR_TASK_2_SOURCE_NORMALIZATION.md)
> 3. [Task 3 — HTML Renderer](REPORT_GENERATION_EXECUTOR_TASK_3_HTML_RENDERER.md)
>
> Новый исполнитель должен выполнять эти файлы по порядку. Текст ниже сохранён как исходный общий reference и не должен использоваться как единый execution prompt.

Текст ниже сохранён только как исторический общий reference. Для реализации используй три Task-файла выше.

---

Ты работаешь как Senior Automation Engineer / n8n Engineer над Tender Analysis System.

Выполняй задачу сам, без субагентов. Работай строго последовательно и по одному логическому этапу. После каждого runtime checkpoint остановись, покажи фактический input/output нод и дождись подтверждения перед следующим крупным этапом.

## Цель

Реализовать `TENDER — Генерация отчета` V2:

```text
completed analysis_run
→ read-only DB snapshot
→ tender_report_data_v2
→ normalized sources
→ HTML renderer
→ HTML file validation
→ Telegram delivery
```

Не менять логику анализа. Aggregator, Targeted Recheck и Finalization — стабильный upstream.

## Жёсткие ограничения

Не делай без отдельного явного разрешения:

- write operations в production n8n;
- write/DDL в production PostgreSQL;
- изменения `ТЕНДЕРЫ ОРКЕСТРАТОР.json`;
- изменения `TENDER — Обработать документ.json`;
- изменения `TENDER — Агрегация закупки.json`;
- изменения `TENDER - Targeted Recheck.json`;
- изменения `TENDER — Финализация анализа.json`;
- изменения `DATA_MODEL.md` и PostgreSQL schema;
- изменения `FIELD_CATALOG.md` и смысла 27 полей;
- AI-вызов в report workflow;
- hardcoded credentials/secrets;
- silent fallback, который скрывает ошибку.

Разрешённый implementation scope:

- local export `workflows/n8n-exports/TENDER — Генерация отчета.json`;
- HTML renderer/template/tests внутри report workflow;
- report documentation;
- read-only диагностика live n8n/PostgreSQL;
- production change только после отдельного разрешения пользователя.

## Source of truth

При конфликте используй:

1. live n8n workflow для текущего production state;
2. local workflow export для текущей repository implementation;
3. `FIELD_CATALOG.md` для семантики 27 полей;
4. live PostgreSQL schema, затем `DATA_MODEL.md`;
5. workflow docs и `ARCHITECTURE.md`;
6. `TECH_DEBT.md`;
7. `DEVELOPMENT_LOG.md` только как историю.

Никогда не выбирай противоречащую версию молча. Сообщи источники, отличие, authoritative вариант и предлагаемый diff.

## Обязательные файлы

Сначала полностью прочитай:

1. `AGENTS.md`;
2. `README.md`;
3. `ARCHITECTURE.md`;
4. `DATA_MODEL.md`;
5. `FIELD_CATALOG.md`;
6. `REPORT_FIELD_MAPPING.md`;
7. `REPORT_GENERATION_ARCHITECTURE_V2.md`;
8. `REPORT_GENERATION_IMPLEMENTATION_PLAN_V2.md`;
9. `TECH_DEBT.md` — report/AG-0 sections;
10. `DEVELOPMENT_LOG.md` — latest E2E section;
11. `workflows/n8n-exports/TENDER — Финализация анализа.json`;
12. `workflows/n8n-exports/TENDER — Генерация отчета.json`.

Для n8n behavior сначала проверяй локальную официальную документацию:

```text
F:\Vibe-projects\n8n\references\n8n-docs
```

Особенно:

- Execute Sub-workflow/Trigger data passing;
- Code Node item/binary behavior;
- PostgreSQL Execute Query/query parameters;
- Convert to File и Code Node binary behavior;
- Telegram Send Document;
- HTML escaping и UTF-8 file creation.

Не изменяй n8n docs.

## Визуальный ориентир заказчика

DOCX references используются только как ориентир структуры и визуального языка:

```text
references/Краткая_справка_по_проекту_шаблон.docx
references/Краткая справка по проекту КТ150.docx
```

Не реализуй DOCX runtime. Для HTML MVP перенеси только следующие принципы:

- деловой титульный блок;
- компактная таблица;
- тонкие границы;
- читаемые длинные значения;
- нейтральная типографика.

HTML использует три колонки `Поле / Значение / Источник`, browser layout и print styles.

## Проверочный production run

Используй только read-only диагностику:

```text
analysis_run_id = f9d8e1d7-f01a-4d91-8eac-89c8376535c2
```

Известная цепочка, которую надо перепроверить перед изменениями:

```text
Orchestrator 13852
Workers 13853, 13854, 13855
Aggregator 13856
Targeted Recheck 13857, 13862
Finalization 13858–13863
old Report stub 13864
current failed Report execution 13892
```

DB baseline:

```text
run completed
3 documents completed
18 units
38 facts
27 FINAL
11 resolved / 3 requires_review / 13 not_found
```

Если actual state отличается, остановись и сообщи.

## Известная текущая ошибка

Workflow падает в `Подготовить структуру отчёта`:

```text
Нет данных закупки [line 21]
```

Root cause уже установлен, но ты обязан подтвердить его по execution `13892`:

1. `Собрать итоговые данные` возвращает один envelope с keys:

```text
analysis_run_id, procurement, fields, statistics
```

2. `Добавить источники и доказательства` ошибочно делает:

```js
const fields = items.map(item => item.json);
```

Она ожидает 27 field items, хотя получила один envelope. В результате создаётся `fields[0]`, внутри которого лежат procurement/fields/statistics.

3. `Подготовить данные отчёта` распаковывает только nested fields, но не procurement/statistics.

4. Фактический input failed node:

```json
{
  "analysis_run_id": "f9d8e1d7-f01a-4d91-8eac-89c8376535c2",
  "report_fields": ["27 objects"]
}
```

5. Ожидался:

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
  "report_fields": ["27 objects"]
}
```

## Точный порядок реализации

### Шаг 0. Baseline и git

Выполни:

```powershell
git status --short --branch
git log -5 --oneline --decorate
```

Убедись, что ветка:

```text
feature/report-generation-docx-v2
```

Не трогай unrelated user changes. Сохрани список файлов, которые планируешь менять.

### Шаг 1. Read-only audit

1. Экспортируй current live Report workflow через read-only API.
2. Сравни live/local nodes, connections, parameters и versionId.
3. Прочитай execution `13892` с data.
4. Зафиксируй JSON keys после пяти нод:
   - trigger;
   - `Собрать итоговые данные`;
   - `Добавить источники и доказательства`;
   - `Подготовить данные отчёта`;
   - `Подготовить структуру отчёта`.
5. PostgreSQL: только SELECT; проверь run, 3 docs, 18 units, 38 facts, 27 finals.

Не выводи API key, password или connection string.

### Шаг 2. Минимальный repair текущего падения

В local/test copy workflow измени только connection:

```text
Собрать итоговые данные
→ Подготовить данные отчёта
```

Обойди `Добавить источники и доказательства`.

Почему именно так: `Собрать итоговые данные` уже возвращает правильный envelope; следующая нода умеет прочитать его. Это минимальный diff для подтверждения root cause.

Запусти regression fixture. Покажи:

```text
Подготовить данные отчёта input keys
Подготовить структуру отчёта input keys
terminal filename/mime
```

Expected:

```text
procurement preserved
statistics preserved
report_fields = 27
line 21 error absent
```

Остановись после проверки. Не объявляй report V2 завершённым: sources всё ещё неполные, а output Markdown.

### Шаг 3. Зафиксировать HTML MVP contract

Не создавай новую DB table, template file или внешний сервис.

`report_data_model` не сохраняй в PostgreSQL: он детерминированно строится из completed analysis snapshot. Новая таблица создаст дублирование, versioning/invalidation и дополнительный failure mode без пользы для HTML-демонстрации.

Recommended renderer:

```text
validated tender_report_data_v2
→ inline HTML/CSS template в Code Node
→ HTML string
→ binary .html
```

Сравнение уже принято:

- inline Code Node — минимальная сложность, выбрать для MVP;
- template file — отложить до стабилизации дизайна;
- внешний сервис — не использовать в HTML MVP как избыточный.

Requirements:

- self-contained HTML5;
- `<meta charset="utf-8">`;
- CSS только в `<style>`;
- no scripts/external resources;
- one `escapeHtml` path для всех dynamic values;
- title with number/subject/customer/platform/price/publication and generated dates, summary, 27-row table, attention, statistics;
- source: document, page/sheet, quote;
- template version `tender_report_html_v1`.

Создай synthetic 27-row fixture и сначала проверь HTML string отдельно от Telegram.

### Шаг 4. Перестроить report workflow

Целевой graph:

```text
When Executed by Another Workflow
→ Проверить вход генерации отчёта
→ Загрузить снимок анализа для отчёта
→ Проверить готовность данных отчёта
→ Собрать модель отчёта v2
→ Нормализовать источники
→ Проверить контракт отчёта v2
→ Сгенерировать HTML отчёт
→ Создать HTML файл
→ Проверить HTML результат
→ Отправить HTML в Telegram
```

#### 4.1. `Проверить вход генерации отчёта`

Перепиши текущую `Проверить результат финализации`.

Requirements:

- required only `analysis_run_id`;
- UUID format guard;
- preserve optional Finalization flags under `trigger_context`;
- retry с `{analysis_run_id}` должен работать;
- убрать hard dependency от `completion_claimed=true`.

Не удаляй DB readiness check: она будет следующими нодами.

#### 4.2. `Загрузить снимок анализа для отчёта`

Замени `Получить данные закупки` одним SELECT, который всегда возвращает один item:

```sql
WITH run_row AS (
  SELECT
    id,
    source,
    tender_id,
    tender_number,
    tender_external_id,
    status,
    documents_total,
    tender_meta,
    created_at,
    completed_at
  FROM tender_analysis_runs
  WHERE id = $1
),
final_rows AS (
  SELECT
    analysis_run_id,
    field_catalog_version,
    result_contract_version,
    field_index,
    field_key,
    status,
    value_text,
    confidence,
    requires_human_review,
    resolution_method,
    result_json
  FROM tender_analysis_field_results
  WHERE analysis_run_id = $1
),
document_rows AS (
  SELECT
    id,
    document_index,
    file_name,
    display_name,
    file_extension,
    mime_type,
    status
  FROM tender_analysis_documents
  WHERE analysis_run_id = $1
),
fact_rows AS (
  SELECT
    id,
    document_id,
    analysis_unit_id,
    fact_index,
    field_key,
    validator_verdict,
    evidence
  FROM tender_analysis_facts
  WHERE analysis_run_id = $1
),
unit_rows AS (
  SELECT
    id,
    document_id,
    analysis_unit_id,
    source_pages,
    ai_segments,
    provenance
  FROM tender_analysis_units
  WHERE analysis_run_id = $1
)
SELECT jsonb_build_object(
  'analysis_run', (SELECT to_jsonb(r) FROM run_row r),
  'field_results', COALESCE(
    (SELECT jsonb_agg(to_jsonb(f) ORDER BY f.field_index) FROM final_rows f),
    '[]'::jsonb
  ),
  'documents', COALESCE(
    (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.document_index) FROM document_rows d),
    '[]'::jsonb
  ),
  'facts', COALESCE(
    (SELECT jsonb_agg(to_jsonb(f)) FROM fact_rows f),
    '[]'::jsonb
  ),
  'units', COALESCE(
    (SELECT jsonb_agg(to_jsonb(u)) FROM unit_rows u),
    '[]'::jsonb
  )
) AS snapshot;
```

n8n query parameter expression показывай без leading `=`:

```text
{{ $json.analysis_run_id }}
```

Проверь точные типы/serialization на актуальной PostgreSQL node версии. Если JSONB возвращается string, parse только после explicit type check.

#### 4.3. `Проверить готовность данных отчёта`

Замени `Нормализовать данные закупки`.

Guards:

```text
analysis_run exists
status = completed
27 FINAL rows
unique field_index/field_key
indexes exactly 1..27
catalog tender_fields_v1
contract tender_field_final_v1
allowed statuses only
```

При ошибке throw. Не возвращай `{ready:false}` в success path.

#### 4.4. `Собрать модель отчёта v2`

Полностью перепиши `Собрать итоговые данные`.

Используй один exact mapping из `REPORT_FIELD_MAPPING.md`. Не оставляй два словаря названий.

Сохрани:

```text
status
value_text
result_json.review
result_json.not_found
all result_json.evidence[]
attention_fields derived only from requires_review
```

Не делай:

```text
hide missing fields
replace nm_price_with_vat
invent review comments
convert not_found to no/false
```

#### 4.5. `Нормализовать источники`

Полностью перепиши `Добавить источники и доказательства`.

Алгоритм:

```text
for each field
  for each evidence
    document:
      embedded evidence.document
      else candidate_ref fact lookup
      else unique analysis_unit lookup in run
      else metadata/unresolved

    location:
      explicit FINAL page/sheet
      else matching fact evidence
      else matching segment/provenance
      else single unit source page
      else unknown

  deduplicate
  preserve all evidence
  strip all internal ids from report subtree
```

Не разрешай `analysis_unit_id` через `.find()` без cardinality check. Если два match, пометь ambiguous и не выбирай первый.

Final field source contract:

```json
{
  "source": {
    "document": "contract.pdf",
    "page": 2,
    "sheet": null,
    "quote": "..."
  },
  "sources": [
    {
      "kind": "document",
      "document": "contract.pdf",
      "page": 2,
      "page_to": 2,
      "sheet": null,
      "quote": "...",
      "role": "primary"
    }
  ]
}
```

`source` всегда вычисляется как projection primary элемента `sources[]`; не заполняй их независимо.

#### 4.6. `Проверить контракт отчёта v2`

Замени `Подготовить данные отчёта`.

Validate:

- schema version;
- 27 ordered fields;
- exact labels;
- valid statuses and statistics;
- `sources[]` arrays;
- no internal keys и no values equal to known internal IDs in public `report`; не отклоняй реальную цитату только из-за UUID-подобного текста;
- no raw evidence in public `report`.

#### 4.7. `Сгенерировать HTML отчёт`

Полностью перепиши `Подготовить структуру отчёта`.

Эта нода получает validated model и только рендерит. Она не меняет FINAL value/status/source resolution.

Обязательные функции внутри Code Node:

```text
escapeHtml
renderSummary
renderSource
renderFieldRow
renderAttentionItem
```

Используй self-contained HTML5 с inline CSS. Добавь stable markers:

```html
<header data-report-section="title"></header>
<section data-report-section="summary"></section>
<table data-report-section="fields"></table>
<section data-report-section="attention"></section>
<section data-report-section="statistics"></section>
```

Каждая field row:

```html
<tr data-field-order="14" data-field-status="resolved">...</tr>
```

Source rendering:

```text
Документ: Проект договора.pdf
Страница: 2
Цитата: «...»
```

XLSX показывает `Лист`, unknown location — `Страница/лист: не определены`.

Output JSON:

```json
{
  "analysis_run_id": "...",
  "filename": "Краткая справка по закупке 10273121.html",
  "mime_type": "text/html",
  "template_version": "tender_report_html_v1",
  "expected_field_count": 27,
  "html": "<!doctype html>..."
}
```

Запрещено:

- raw insertion dynamic strings;
- `<script>`;
- external CSS/fonts/images;
- interactive JavaScript;
- internal identifiers in visible/hidden markup.

#### 4.8. `Создать HTML файл`

Перепиши `Создать Markdown файл`.

Requirements:

- input field `html` is non-empty string;
- encode UTF-8 using built-in `Buffer`;
- binary property `report_html`;
- `mimeType="text/html"`;
- filename ends `.html`;
- JSON preserves `analysis_run_id`, filename, template version.

Не используй filesystem, external modules или renderer API.

#### 4.9. `Проверить HTML результат`

Создай новую Code Node.

Check decoded binary:

```text
binary report_html exists
MIME starts text/html
filename ends .html
starts with <!doctype html>
contains five required data-report-section markers
contains exactly 27 <tr ... data-field-order="..."> row markers, excluding CSS/text occurrences
contains no <script, javascript:, external <link, src="http..." or CSS url(http...)
contains no known internal IDs/forbidden key labels
```

При любой ошибке throw с кодом `REPORT_HTML_*`; не возвращай success-like `{valid:false}`.

#### 4.10. `Отправить HTML в Telegram`

Создай Telegram Send Document.

Requirements:

- binary field `report_html`;
- credentials via n8n Credentials;
- сначала test chat;
- caption без UUID;
- failure is execution failure;
- `message_id` должен присутствовать в success output.

Telegram response является terminal output MVP. Не добавляй отдельную packaging node без новой необходимости.

### Шаг 5. Удалить obsolete behavior

После V2 contract test удали/отсоедини старые функции:

- partial source extraction from first evidence;
- duplicate `fieldTitles` dictionaries;
- `hiddenMissingFields`;
- hardcoded review comments;
- substitution of TenderPlan price for FINAL value;
- Markdown-only output;
- terminal JSON with only filename.

Не удаляй rejected facts из БД. Report query может не использовать их как client sources, но persistence/audit остаются неизменными.

### Шаг 6. Test matrix

Выполни в таком порядке:

1. Contract test: 27 valid rows.
2. Negative: 26 rows.
3. Negative: duplicate index/key.
4. Negative: run not completed.
5. Source: embedded document.
6. Source: candidate fact join.
7. Source: unique unit join.
8. Source: ambiguous unit — no guessing.
9. Source: PDF page range.
10. Source: XLSX sheet.
11. Source: DOCX with no page.
12. Source: TenderPlan metadata.
13. Multiple sources retained/deduplicated.
14. `not_found` semantic safety.
15. HTML renderer synthetic 27-row model.
16. Full run `f9d8e1d7-...`.
17. HTML unsafe-input/escaping fixture.
18. HTML structural marker validation.
19. Browser and print-preview review.
20. Telegram test delivery.
21. Retry same completed run with only `analysis_run_id`.

For full run verify exactly:

```text
27 fields
11 resolved
3 requires_review
13 not_found
```

Manually inspect:

- `payment_terms` — multiple evidence;
- `nm_price_with_vat` — no semantic substitution;
- `platform` — TenderPlan metadata source;
- XLSX field — sheet shown;
- any DOCX source with no page — transparent unknown location;
- any not_found — no negative fact.

### Шаг 7. HTML visual verification

Не считать HTML готовым только потому, что строка создана.

1. Открой generated `.html` локально в browser без network access.
2. Проверь desktop width и print preview.
3. Проверь:
   - title block: number/subject/customer/platform/price/publication date/generated date;
   - summary 27/11/3/13;
   - 27 fields in order;
   - three columns;
   - readable long values/quotes;
   - source document/page/sheet/quote;
   - attention contains only requires_review;
   - no clipping/horizontal overflow in print preview;
   - no visible internal IDs;
   - no external requests or executable scripts.
4. Открой HTML source и проверь escaping fixture.

Если layout плохой, меняй только inline HTML/CSS renderer. Не меняй analysis/report semantic code.

### Шаг 8. Runtime и production safety

До отдельного разрешения пользователя работай только local/test.

Если пользователь разрешил production update:

1. Сначала покажи exact workflow diff.
2. Не менять activation/credentials без необходимости.
3. Сохрани export до/после.
4. Запусти test/manual execution по known completed run.
5. Не retry/stop/delete production executions через read-only key.
6. Не менять production PostgreSQL.

### Шаг 9. Документация после подтверждённого E2E

Только после runtime success обнови:

- `README.md`;
- `ARCHITECTURE.md`;
- `TECH_DEBT.md`;
- `DEVELOPMENT_LOG.md`;
- создай `workflows/report-generation.md`.

Не меняй:

- `DATA_MODEL.md`;
- `FIELD_CATALOG.md`.

Документируй limitation:

```text
без отдельного persisted report/delivery state
нет durable artifact history и exactly-once Telegram delivery
```

Не расширяй эту задачу на изменение DB schema.

## Формат отчёта после каждого checkpoint

Отвечай конкретно:

```text
Файл / workflow
Нода
Текущий input
Ожидаемый input
Причина
Минимальное изменение
Фактический output
Как проверено
Что ещё не сделано
```

Не заявляй `готово`, `исправлено` или `passing`, пока нет:

```text
implementation
+ regression scenario
+ runtime result
+ HTML structural and visual verification
```

## Stop conditions

Остановись и запроси решение, если:

- local/live workflow не совпадают;
- live DB schema не совпадает с docs;
- HTML template требует внешнего renderer/service или новой deployment dependency;
- корректный MIME/binary contract не подтверждён текущей n8n version;
- report completeness требует изменить upstream FINAL data;
- невозможно определить страницу без inference;
- production write access отсутствует;
- требуется новая DB table для requested guarantee.

В этих случаях не делай обходной redesign и не ослабляй проверки.

## Что оставить для DOCX V2 позже

- DOCX template;
- PDF conversion;
- фирменное оформление и приложения;
- Word/PDF visual regression;
- durable artifact storage/versioning.

---

Конец prompt.
