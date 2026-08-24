# Report Generation Architecture V2

Дата ревью: 24.08.2026
Рабочая ветка: `feature/report-generation-docx-v2`
Статус документа: архитектурное решение, без изменений workflow и PostgreSQL

## 1. Цель

Сформировать для MVP полноценный клиентский HTML-отчёт, не меняя семантику анализа закупки. DOCX переносится на следующий этап после успешной демонстрации HTML MVP.

Целевой отчёт должен:

- содержать ровно 27 полей в порядке `field_index = 1..27`;
- показывать для каждого поля клиентское название, значение и источники;
- сохранять все пригодные evidence, а не только первый элемент;
- показывать название документа, страницу или лист и точную цитату;
- явно различать `resolved`, `requires_review` и `not_found`;
- не показывать UUID, `semantic_block_id`, `fact_id`, `analysis_unit_id`, `field_key` и другие внутренние поля;
- быть детерминированным представлением уже сохранённых FINAL results;
- не вызывать AI и не переинтерпретировать документы;
- позволять менять порядок полей и HTML-дизайн независимо от Aggregator, Targeted Recheck и Finalization.

## 2. Границы решения

В scope V2 входят только:

```text
Finalization output / ручной retry по analysis_run_id
→ read-only report snapshot из PostgreSQL
→ report data model
→ нормализация источников
→ HTML renderer внутри n8n
→ HTML файл
→ проверка HTML результата
→ отправка отчёта
```

Вне scope:

- изменение Extractor, Validator, Aggregator или Targeted Recheck;
- изменение FINAL contract `tender_field_final_v1`;
- изменение смысла 27 полей;
- изменение PostgreSQL schema;
- company matching;
- повторное извлечение фактов в report stage;
- исправление unrelated technical debt.

## 3. Проверенные источники

Ревью выполнено по:

- всем семи JSON export в `workflows/n8n-exports/`;
- `README.md`, `ARCHITECTURE.md`, `DATA_MODEL.md`, `FIELD_CATALOG.md`, `DEVELOPMENT_LOG.md`, `TECH_DEBT.md`, `REPORT_FIELD_MAPPING.md`, `REVIEW_2026-08-23.md`;
- локальной официальной документации n8n в `F:\Vibe-projects\n8n\references\n8n-docs`;
- read-only production n8n API;
- read-only production PostgreSQL;
- OOXML-структуре и визуальному рендеру двух DOCX заказчика.

### 3.1. Обнаруженное расхождение документации и реализации

`README.md`, `ARCHITECTURE.md`, `TECH_DEBT.md`, `workflows/aggregator.md` и `DEVELOPMENT_LOG.md` описывают `TENDER — Генерация отчета` как stub. Это корректно для production execution `13864` от 23.08.2026: в нём были только trigger и `Заглушка генерации отчета`.

Локальный export и текущий live workflow уже содержат 12 нод и попытку построить Markdown. Они совпадают между собой, включая `versionId=026332fc-aa0d-498c-a2e2-857be29f89a0`. Поэтому authoritative current state для настоящего ревью — live workflow и совпадающий с ним JSON export. Старые описания stub являются исторически верными, но устаревшими относительно текущего workflow.

Это расхождение следует исправить в существующей документации только после фактической реализации и runtime-проверки V2.

## 4. Фактическая E2E-цепочка

### 4.1. Ревью всех workflow exports

| Workflow | Нод | Проверенный upstream/downstream contract |
|---|---:|---|
| `ТЕНДЕРЫ ОРКЕСТРАТОР` | 12 | создаёт run, регистрирует все документы, запускает один Worker на документ |
| `TENDER — Обработать документ` | 31 | получает run/document contract, сохраняет units/facts, запускает readiness/Aggregator path |
| `TENDER — Ошибка обработки документа` | 2 | error trigger и перевод processing document в failed |
| `TENDER — Агрегация закупки` | 38 | читает candidates, создаёт FINAL/Targeted Recheck requests и вызывает Finalization |
| `TENDER - Targeted Recheck` | 63 | завершает проблемные поля, UPSERT FINAL и вызывает Finalization |
| `TENDER — Финализация анализа` | 5 | проверяет 27/27, атомарно завершает run и один раз вызывает report stage |
| `TENDER — Генерация отчета` | 12 | текущая report-разработка; падает до Markdown artifact |

В repository нет export с именем `TENDER — Обработка документов.json`, указанным в постановке. Фактический Document Worker называется `TENDER — Обработать документ.json`; это имя подтверждено local export и production execution chain.

### 4.2. Runtime chain

Для `analysis_run_id=f9d8e1d7-f01a-4d91-8eac-89c8376535c2` восстановлена цепочка:

| Этап | Production execution | Результат |
|---|---:|---|
| Orchestrator | `13852` | success |
| Document Worker, документ 1 | `13853` | success |
| Document Worker, документ 2 | `13854` | success |
| Document Worker, документ 3 | `13855` | success |
| Aggregator | `13856` | success, aggregation claim |
| Targeted Recheck | `13857`, `13862` | success |
| Finalization | `13858–13863` | execution `13863` сделал completion claim |
| Report Generation, исторический stub | `13864` | success |
| Текущая разработка Report Generation | `13892` | error в `Подготовить структуру отчёта` |

Finalization execution `13863` передал в report stage:

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

Это корректный trigger contract. Полные данные закупки и evidence не обязаны передаваться через Finalization: report stage может и должен получать их заново из PostgreSQL по `analysis_run_id`.

## 5. Состояние PostgreSQL

Live schema всех пяти доступных таблиц совпала с `DATA_MODEL.md`; противоречий, требующих изменения схемы, не обнаружено.

| Таблица | Роль для отчёта |
|---|---|
| `tender_analysis_runs` | статус run и `tender_meta` для шапки закупки |
| `tender_analysis_documents` | клиентские имена файлов и тип документа |
| `tender_analysis_units` | связь `analysis_unit_id → document_id`, `source_pages`, `ai_segments`, `provenance` |
| `tender_analysis_facts` | связь `fact_id → document_id`, исходное evidence и audit trail |
| `tender_analysis_field_results` | canonical 27 FINAL results и `result_json` |

Состояние проверенного run:

```text
run.status = completed
documents = 3 completed
analysis units = 18
facts = 38
  confirmed = 20
  requires_review = 10
  rejected = 8
FINAL fields = 27
  resolved = 11
  requires_review = 3
  not_found = 13
```

Важное наблюдение: evidence не исчезло из persistence layer, но оно распределено по разным сущностям.

- FINAL `result_json.evidence[]` обычно содержит `quote`, `semantic_block_id`, страницу/лист и иногда `candidate_ref` или `analysis_unit_id`.
- Для части Round 1 results имя документа не вложено в FINAL evidence.
- `candidate_ref="fact:<uuid>"` позволяет связать FINAL evidence с `tender_analysis_facts`, затем с `tender_analysis_documents`.
- `analysis_unit_id` позволяет восстановить документ через `tender_analysis_units`, если match внутри run однозначен.
- Для TenderPlan metadata нет документа и страницы; это отдельный тип источника.
- Для части DOCX parser не сохранил страницу. Report stage не должен придумывать номер страницы.

Следовательно, новая схема PostgreSQL не нужна. Нужна детерминированная read-only нормализация существующего audit trail.

## 6. Текущий Report Generation workflow

Workflow: `TENDER — Генерация отчета`
Workflow ID: `ckPnP3hRhKu4Mf9u`

### 6.1. Ноды и фактическая ответственность

| # | Нода | Тип | Текущее поведение |
|---:|---|---|---|
| 1 | `When Executed by Another Workflow` | Execute Workflow Trigger | принимает результат Finalization |
| 2 | `Проверить результат финализации` | Code | требует `completion_claimed=true`, `barrier_ready=true`, `final_count=27` |
| 3 | `Получить данные закупки` | PostgreSQL | загружает run и `tender_meta` |
| 4 | `Нормализовать данные закупки` | Code | строит объект `procurement` |
| 5 | `Получить результаты анализа` | PostgreSQL | загружает 27 FINAL rows |
| 6 | `Собрать итоговые данные` | Code | строит единый envelope с `procurement`, `fields`, `statistics`; сохраняет только первый evidence в `source` |
| 7 | `Добавить источники и доказательства` | Code | ошибочно трактует единый envelope как набор field items |
| 8 | `Подготовить данные отчёта` | Code | частично распаковывает вложенные fields, но не восстанавливает procurement/statistics |
| 9 | `Подготовить структуру отчёта` | Code | ожидает procurement/statistics и падает; дополнительно не переносит `source_text` дальше |
| 10 | `Подготовить данные для отчёта` | Code | строит presentation model, скрывает часть `not_found`, местами заменяет FINAL value значением TenderPlan |
| 11 | `Сформировать Markdown отчёт` | Code | создаёт Markdown без источников и цитат |
| 12 | `Создать Markdown файл` | Code | создаёт binary `.md`, оставляя в JSON только filename |

### 6.2. Текущий вход

Входом является короткий Finalization contract из раздела 4. Это достаточный вход, если report workflow самостоятельно перечитывает completed snapshot по `analysis_run_id`.

### 6.3. Текущий выход

Если бы workflow доходил до конца, он возвращал бы:

```json
{
  "json": {
    "filename": "Анализ закупки_10273121.md"
  },
  "binary": {
    "data": {
      "mimeType": "text/markdown",
      "fileName": "Анализ закупки_10273121.md"
    }
  }
}
```

`analysis_run_id` в terminal JSON теряется. Клиентского HTML-файла и отправки в Telegram нет.

### 6.4. Где сейчас формируется структура

Структура строится последовательно и дублируется в четырёх Code Nodes:

```text
Собрать итоговые данные
→ Подготовить данные отчёта
→ Подготовить структуру отчёта
→ Подготовить данные для отчёта
```

Это не отдельные стабильные слои. Каждая нода меняет форму объекта, а две ноды содержат собственные неполные словари названий полей.

## 7. Root cause ошибки `Нет данных закупки [line 21]`

Последний проверенный failed execution: `13892`, 24.08.2026 07:33:04 UTC.

### 7.1. Где впервые появляется неправильное состояние

Первая неправильная нода — `Добавить источники и доказательства`.

Она получает один item:

```json
{
  "analysis_run_id": "f9d8e1d7-f01a-4d91-8eac-89c8376535c2",
  "procurement": { "number": "10273121" },
  "fields": [
    { "field_index": 1, "key": "procurement_subject" }
  ],
  "statistics": {
    "total": 27,
    "resolved": 11,
    "requires_review": 3,
    "not_found": 13
  }
}
```

Но её код ожидает, что каждый входной item уже является отдельным field:

```text
const fields = items.map(item => item.json)
```

Поэтому она превращает envelope в единственный элемент массива `fields`:

```json
{
  "analysis_run_id": "f9d8e1d7-f01a-4d91-8eac-89c8376535c2",
  "fields": [
    {
      "analysis_run_id": "f9d8e1d7-f01a-4d91-8eac-89c8376535c2",
      "procurement": { "number": "10273121" },
      "fields": ["27 field objects"],
      "statistics": { "total": 27 },
      "sources": []
    }
  ]
}
```

`Подготовить данные отчёта` видит эту вложенность и распаковывает только:

```text
input.fields = input.fields[0].fields
```

Она не поднимает `input.fields[0].procurement` и `input.fields[0].statistics`. В результате фактический input `Подготовить структуру отчёта`:

```json
{
  "analysis_run_id": "f9d8e1d7-f01a-4d91-8eac-89c8376535c2",
  "report_fields": ["27 objects"]
}
```

Ожидался:

```json
{
  "analysis_run_id": "f9d8e1d7-f01a-4d91-8eac-89c8376535c2",
  "procurement": { "number": "10273121" },
  "statistics": {
    "total": 27,
    "resolved": 11,
    "requires_review": 3,
    "not_found": 13
  },
  "report_fields": ["27 objects"]
}
```

Проверка `if (!input.procurement)` закономерно выбрасывает ошибку на строке 21.

### 7.2. Минимальное исправление текущей ошибки

Самый маленький безопасный ремонт — сохранить единый envelope:

```text
Собрать итоговые данные
→ Подготовить данные отчёта
```

То есть временно обойти `Добавить источники и доказательства`: предыдущая нода уже содержит `result_json` и первичный `source`. Это восстанавливает `procurement` и `statistics` без изменения upstream contracts.

Если граф необходимо сохранить, альтернативный минимальный fix — переписать `Добавить источники и доказательства`, чтобы она принимала один envelope, обогащала `input.fields` и возвращала `{...input, fields: enrichedFields}`.

Этот ремонт устраняет падение, но не решает архитектурные проблемы evidence и HTML presentation; после него обязательна отдельная реализация HTML MVP.

## 8. Где теряются данные

| Данные | Где доступны | Где теряются или искажаются |
|---|---|---|
| Закупка | `Нормализовать данные закупки`, `Собрать итоговые данные` | вложена нодой `Добавить источники и доказательства`, затем не поднята обратно |
| Статистика | `Собрать итоговые данные` | тот же envelope bug |
| Все evidence | `result_json.evidence[]`, facts/units | `Собрать итоговые данные` выбирает только первый evidence |
| Название документа | `tender_analysis_documents`; иногда вложено в evidence | текущий workflow не выполняет join по `candidate_ref`/unit; часто получает `null` |
| Страница/лист | FINAL evidence, fact evidence, unit provenance | берётся только из первого FINAL evidence; fallback к facts/units отсутствует |
| Цитата | FINAL evidence | первая цитата сохраняется временно; остальные отбрасываются |
| `source_text` | формируется в `Подготовить данные отчёта` | не копируется в `preparedField` ноды `Подготовить структуру отчёта` |
| Статус 27 полей | FINAL rows | presentation node скрывает часть `not_found`, поэтому отчёт перестаёт быть 27/27-представлением |
| FINAL value | FINAL rows | для `nm_price_with_vat` presentation node заменяет значение TenderPlan metadata, смешивая анализ и представление |
| Audit identity run | до последней ноды | `Создать Markdown файл` оставляет только filename |

## 9. Визуальный ориентир заказчика для HTML MVP

Предоставленные DOCX остаются визуальным ориентиром, но не runtime template MVP.

Из них сохраняются принципы:

- простой титульный блок;
- нейтральная деловая типографика;
- компактная табличная структура;
- тонкие границы;
- длинные значения без обрезки;
- порядок полей, понятный бизнес-пользователю.

HTML не обязан повторять одностраничный Word layout. Он должен быть читаемым в браузере, при открытии локального `.html` и в print preview.

## 10. Целевая архитектура HTML MVP

```text
Finalization completion event
или retry trigger по analysis_run_id
              ↓
Проверка входа
              ↓
Read-only snapshot анализа из PostgreSQL
              ↓
Проверка completed + 27/27
              ↓
Report data model v2
              ↓
Нормализация источников
              ↓
Проверка tender_report_data_v2
              ↓
HTML renderer
              ↓
HTML файл
              ↓
Проверка HTML результата
              ↓
Telegram / клиент
```

DB readiness и contract validation сохраняются: это небольшие deterministic barriers, которые предотвращают silent failure. DOCX-specific view model, внешний renderer service и сложная artifact validation для HTML MVP не нужны.

### 10.1. Слой 1 — Analysis data

Canonical данные остаются в существующих пяти таблицах. Report workflow читает snapshot только после `run.status=completed` и не изменяет FINAL results.

### 10.2. Слой 2 — Report data model

Renderer-independent модель содержит:

- 27 полей в порядке `1..27`;
- клиентские названия;
- значения и статусы без переинтерпретации;
- procurement header;
- статистику;
- normalized `sources[]`;
- блок `requires_review`;
- никаких внутренних идентификаторов в public subtree.

### 10.3. Слой 3 — HTML renderer

Для MVP renderer — одна Code Node с versioned inline HTML/CSS template. Она получает только validated report model, экранирует все динамические значения и строит self-contained HTML без внешних JavaScript/CSS/font dependencies.

Renderer:

- не обращается к PostgreSQL и AI;
- не меняет status/value/source semantics;
- не разрешает evidence;
- не скрывает строки;
- отвечает только за HTML structure, CSS и безопасное escaping.

## 11. Требования к HTML-отчёту

### 11.1. Титульный блок

Показывать:

- номер закупки;
- предмет закупки;
- заказчика;
- площадку;
- цену;
- дату публикации закупки, если она доступна;
- дату формирования отчёта.

Если значение отсутствует, показывать `Не указано`, но не создавать отрицательный business fact.

### 11.2. Краткий итог

Четыре показатели:

```text
Всего проверено: 27
Подтверждено: 11
Требуют проверки: 3
Не найдено: 13
```

### 11.3. Основная таблица

Колонки:

```text
Поле | Значение | Источник
```

В таблице всегда 27 строк. Source cell содержит один или несколько блоков:

```text
Документ: Проект договора.pdf
Страница: 2
Цитата: «Авансовый платеж не предусмотрен...»
```

Для XLSX вместо страницы показывать `Лист`. Если location отсутствует, выводить `Страница/лист: не определены`.

### 11.4. Блок `Требуют внимания`

Включать только поля со статусом `requires_review`. Для каждого показывать:

- клиентское название;
- текущее значение, если оно есть;
- canonical review note;
- normalized sources.

Не генерировать собственные объяснения причин проверки.

### 11.5. Статистика анализа

В конце отчёта повторить распределение 27 полей и дату формирования. Статистика должна совпадать с кратким итогом.

## 12. Целевой workflow и ноды

| # | Нода | Тип | Назначение |
|---:|---|---|---|
| 1 | `When Executed by Another Workflow` | Trigger | принять initial call или retry payload |
| 2 | `Проверить вход генерации отчёта` | Code | потребовать валидный `analysis_run_id` |
| 3 | `Загрузить снимок анализа для отчёта` | PostgreSQL | одним read-only query получить run, 27 FINAL, documents, facts и units |
| 4 | `Проверить готовность данных отчёта` | Code | проверить completed, 27/27 и FINAL contracts |
| 5 | `Собрать модель отчёта v2` | Code | применить mapping и построить renderer-independent JSON |
| 6 | `Нормализовать источники` | Code | восстановить document/page/sheet/quote и удалить internal IDs |
| 7 | `Проверить контракт отчёта v2` | Code | строгий barrier перед presentation |
| 8 | `Сгенерировать HTML отчёт` | Code | versioned inline template, CSS и HTML escaping |
| 9 | `Создать HTML файл` | Code | сформировать binary `.html` с UTF-8 и `text/html` |
| 10 | `Проверить HTML результат` | Code | проверить filename, MIME, размер, markers и отсутствие internal leaks |
| 11 | `Отправить HTML в Telegram` | Telegram | отправить binary как document |

Для MVP не добавлять отдельную terminal packaging node: Telegram response остаётся terminal output, а предыдущие node execution data сохраняют run/artifact context.

## 13. Контракты данных

### 13.1. Trigger contract

```json
{
  "analysis_run_id": "f9d8e1d7-f01a-4d91-8eac-89c8376535c2"
}
```

Transient `completion_claimed`, `barrier_ready` и `final_count` можно сохранить как diagnostics, но source of truth для retry — повторная DB-проверка.

### 13.2. Analysis snapshot

```json
{
  "schema_version": "tender_report_snapshot_v2",
  "analysis_run": {
    "id": "f9d8e1d7-f01a-4d91-8eac-89c8376535c2",
    "status": "completed",
    "tender_meta": {}
  },
  "field_results": [],
  "source_index": {
    "documents": [],
    "facts": [],
    "units": []
  }
}
```

UUID допустимы только в internal snapshot.

### 13.3. Report data model `tender_report_data_v2`

```json
{
  "schema_version": "tender_report_data_v2",
  "internal": {
    "analysis_run_id": "f9d8e1d7-f01a-4d91-8eac-89c8376535c2"
  },
  "report": {
    "title": "Краткая справка по закупке №10273121",
    "generated_at": "2026-08-24T10:45:00+03:00",
    "procurement": {
      "number": "10273121",
      "subject": "Кресло парикмахерское",
      "customer": "Наименование заказчика",
      "platform": "Портал поставщиков Московской области",
      "price": "85 000 ₽",
      "publication_at": "20.08.2026 10:00"
    },
    "statistics": {
      "total": 27,
      "resolved": 11,
      "requires_review": 3,
      "not_found": 13
    },
    "fields": [
      {
        "order": 14,
        "label": "Условия оплаты",
        "status": "resolved",
        "status_label": "Подтверждено",
        "value": "Авансовый платеж не предусмотрен...",
        "review_note": null,
        "not_found_note": null,
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
            "location_status": "exact"
          }
        ]
      }
    ],
    "attention_fields": []
  },
  "renderer": {
    "template_version": "tender_report_html_v1",
    "filename": "Краткая справка по закупке 10273121.html"
  }
}
```

`source` — вычисляемая ссылка на первый primary source для простого потребителя; `sources[]` — canonical полный массив. Они формируются в одной ноде из одного набора данных, чтобы не расходиться. `internal` удаляется перед HTML rendering.

Префикс `КТ` нельзя автоматически присоединять к tender number без отдельного authoritative project code.

### 13.4. Source entity

Документальный источник:

```json
{
  "kind": "document",
  "document": "contract.pdf",
  "page": 2,
  "page_to": 2,
  "sheet": null,
  "quote": "Оригинальный фрагмент документа",
  "role": "primary",
  "location_status": "exact"
}
```

TenderPlan metadata:

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

Source object не содержит UUID или semantic identifiers.

## 14. Нормализация источников

Для каждого `result_json.evidence[]`:

1. Сохранить оригинальную цитату и роль evidence.
2. Использовать embedded document, если он есть.
3. Иначе разрешить `candidate_ref → fact → document`.
4. Иначе разрешить однозначный `analysis_unit_id → unit → document` внутри run.
5. Location разрешать в порядке: FINAL evidence → matching fact evidence → segment provenance → единственная `unit.source_pages`.
6. Для XLSX показывать sheet, не искусственную parser page.
7. TenderPlan metadata оформлять отдельным source kind.
8. Deduplicate по `kind + document + page range/sheet + quote`.
9. Сохранить все sources; primary поставить первым.
10. При неоднозначности или отсутствии location ничего не угадывать.

Для `not_found` source cell содержит: `Надёжный источник не установлен после полного анализа и Targeted Recheck`.

## 15. Правила presentation layer

| FINAL status | Значение в HTML | Источник |
|---|---|---|
| `resolved` | точный `value_text`, допускается только безопасное форматирование | все normalized sources |
| `requires_review` | значение и заметная пометка `Требует проверки`; canonical review note | все sources |
| `not_found` | `Не удалось надёжно установить` | нейтральное пояснение, не `нет` и не `false` |

Все динамические строки, включая цитаты и filenames, проходят HTML escaping. В MVP не выполнять JavaScript в отчёте и не загружать внешние ресурсы.

Нельзя:

- заменять FINAL value TenderPlan metadata;
- скрывать часть 27 полей;
- генерировать hardcoded review explanation;
- переносить internal audit IDs в HTML;
- вставлять evidence через raw HTML без escaping.

## 16. Выбор реализации HTML MVP

| Вариант | Сложность | Надёжность | Поддерживаемость | Оценка MVP |
|---|---|---|---|---|
| Inline HTML/CSS template в Code Node | низкая | высокая при escaping и tests | средняя | рекомендуется |
| HTML template file + заполнение | средняя | высокая | высокая | следующий шаг, если дизайн часто меняется |
| Отдельный renderer service | высокая | высокая | высокая | избыточен для первой демонстрации |

### Решение MVP

Использовать versioned inline template в `Сгенерировать HTML отчёт`:

- один self-contained HTML документ;
- CSS внутри `<style>`;
- без внешних библиотек и network resources;
- общая функция `escapeHtml` для всех динамических значений;
- отдельные небольшие render helpers для summary, field row, source block и attention item;
- template version `tender_report_html_v1` в output metadata.

`Создать HTML файл` получает готовую строку и создаёт binary с filename `.html`, UTF-8 и MIME `text/html`. Это можно сделать отдельной Code Node. Native `Convert to File → Convert to Text File` допустим только если runtime-проверка подтверждает требуемый MIME; не усложнять MVP ради этой замены.

## 17. Критический анализ сложности и persistence

### 17.1. Не слишком ли сложна архитектура

Логическая архитектура не избыточна: snapshot, report model, source normalization и renderer имеют разные контракты и разные причины изменения.

Избыточной для HTML MVP была физическая DOCX-часть:

- отдельный renderer service;
- отдельный DOCX view contract;
- template deployment;
- OOXML validation;
- renderer/template response headers;
- document conversion tooling.

После их удаления остаётся линейный workflow без Merge, AI и внешнего renderer dependency. Дополнительно объединять report model и source normalization не следует: это снова смешает business projection и evidence resolution, из-за чего текущая реализация уже потеряла источники.

### 17.2. Нужна ли таблица `report_data_model`

Для MVP — нет.

```text
PostgreSQL analysis data
→ Code Node
→ Report JSON Model в текущем execution
→ HTML Renderer
```

Причины:

- FINAL results и audit evidence уже сохранены;
- report model детерминированно восстанавливается по `analysis_run_id`;
- новая таблица продублирует canonical data;
- потребуются invalidation/versioning/upsert rules;
- появится новый failure mode между completion и report persistence;
- демонстрация HTML не требует отдельного queryable report store.

Persisted report state нужен позже только для durable artifact history, report versions, public links или exactly-once delivery. Это отдельный milestone, не часть HTML MVP.

## 18. Retry, idempotency и audit

HTML workflow должен принимать retry по одному `analysis_run_id`, перечитывать completed/27 snapshot и создавать детерминированный filename.

В рамках MVP audit хранится в n8n execution data. Без persisted delivery state неоднозначный Telegram timeout может привести к duplicate при retry; exactly-once не заявляется.

## 19. Ошибки и silent-failure policy

Workflow падает явно, если:

- run отсутствует или не `completed`;
- FINAL rows не ровно 27;
- keys/indexes/contracts/statuses некорректны;
- `resolved` не имеет значения;
- report model содержит internal leaks;
- HTML отсутствует, пуст, не содержит обязательные sections/27 rows или содержит unescaped unsafe markers;
- binary имеет неверный filename/MIME;
- Telegram не подтвердил отправку.

Отсутствие страницы у evidence — контролируемое состояние, а не техническая ошибка.

Существующий `TENDER — Ошибка обработки документа` не использовать для report errors.

## 20. Upstream impact

Изменения Orchestrator, Document Worker, Aggregator, Targeted Recheck, Finalization и PostgreSQL не требуются.

Finalization может продолжить initial call с текущим payload. Report workflow самостоятельно перепроверяет readiness в БД, чтобы поддерживать безопасный retry completed run.

## 21. Что оставить для DOCX V2 позже

- versioned DOCX template на основе клиентского образца;
- перенос HTML/report model в DOCX renderer без изменения анализа;
- PDF conversion как дополнительный immutable artifact;
- фирменное оформление, логотипы, headers/footers и стили печати;
- автоматическая генерация приложений;
- visual regression для Word/PDF;
- durable artifact storage и версии отчёта;
- при необходимости отдельный renderer service.

HTML MVP должен подтвердить report data model, sources и клиентскую структуру до инвестиций в DOCX-инфраструктуру.
