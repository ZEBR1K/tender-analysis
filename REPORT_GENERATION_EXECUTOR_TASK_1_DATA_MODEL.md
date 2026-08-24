# Report Generation V2 — Executor Task 1: Data Model

Рабочая ветка: `feature/report-generation-docx-v2`

Выполняй этот этап самостоятельно, без субагентов. Работай только по одному логическому изменению и после каждого checkpoint сверяй фактический input/output нод.

Task 1 является первым этапом. Он не зависит от Task 2 или Task 3. После выполнения остановись и передай стабильный контракт следующему исполнителю.

## 1. Цель этапа

Стабилизировать поток данных Report Generation от результата Finalization до базовой Report Data Model и устранить ошибку:

```text
Нет данных закупки [line 21]
```

Граница этапа:

```text
Finalization
↓
проверка входа
↓
read-only сбор данных анализа
↓
базовая Report Data Model
```

Целевой terminal output Task 1:

```json
{
  "analysis_run_id": "f9d8e1d7-f01a-4d91-8eac-89c8376535c2",
  "procurement": {
    "number": "10273121",
    "subject": "Кресло парикмахерское",
    "customer": "Наименование заказчика",
    "platform": "Портал поставщиков Московской области",
    "price": 85000,
    "publication_at": "2026-08-20T10:00:00+03:00"
  },
  "statistics": {
    "total": 27,
    "resolved": 11,
    "requires_review": 3,
    "not_found": 13
  },
  "report_fields": [
    {
      "field_index": 14,
      "field": "payment_terms",
      "label": "Условия оплаты",
      "status": "resolved",
      "value": "Авансовый платеж не предусмотрен...",
      "requires_review": false,
      "result_json": {}
    }
  ]
}
```

`result_json` на этом промежуточном этапе сохраняется только как вход Task 2. Он не является клиентским полем и не должен попасть в renderer.

## 2. Что разрешено менять

Только local/test copy workflow:

```text
workflows/n8n-exports/TENDER — Генерация отчета.json
```

И только участок:

- `When Executed by Another Workflow`;
- `Проверить результат финализации`;
- `Получить данные закупки`;
- `Нормализовать данные закупки`;
- `Получить результаты анализа`;
- `Собрать итоговые данные`;
- connections до terminal base model.

Разрешено:

- переименовать report-stage nodes в соответствии с `REPORT_GENERATION_IMPLEMENTATION_PLAN_V2.md`;
- изменить read-only SELECT report snapshot;
- исправить передачу единого envelope;
- использовать exact mapping 27 полей из `REPORT_FIELD_MAPPING.md`;
- временно сделать базовую model node terminal checkpoint;
- использовать live n8n и PostgreSQL только read-only для диагностики.

Production n8n можно изменять только после отдельного явного разрешения пользователя.

## 3. Что запрещено менять

Не делать в Task 1:

- HTML generation;
- CSS;
- Telegram;
- renderer;
- создание binary-файла;
- source normalization;
- join evidence с documents/facts/units;
- изменение business semantics 27 полей;
- изменение Aggregator, Targeted Recheck или Finalization;
- изменение PostgreSQL schema или данных;
- создание таблицы `report_data_model`;
- AI-вызовы;
- скрытие `not_found` полей;
- подмена FINAL value данными TenderPlan;
- production write без отдельного разрешения.

Не исправляй unrelated technical debt.

## 4. Какие файлы изучить

Обязательно прочитать:

1. `AGENTS.md`;
2. `README.md`;
3. `ARCHITECTURE.md`;
4. `DATA_MODEL.md`;
5. `FIELD_CATALOG.md`;
6. `REPORT_FIELD_MAPPING.md`;
7. `REPORT_GENERATION_ARCHITECTURE_V2.md`;
8. `REPORT_GENERATION_IMPLEMENTATION_PLAN_V2.md`;
9. `workflows/n8n-exports/TENDER — Финализация анализа.json`;
10. `workflows/n8n-exports/TENDER — Генерация отчета.json`.

Для поведения n8n проверить локальную официальную документацию:

```text
F:\Vibe-projects\n8n\references\n8n-docs
```

Минимально проверить:

- Execute Sub-workflow Trigger и передачу items;
- Code Node item structure;
- PostgreSQL Execute Query и query parameters.

Runtime baseline:

```text
analysis_run_id = f9d8e1d7-f01a-4d91-8eac-89c8376535c2
failed Report execution = 13892
Finalization completion execution = 13863
```

## 5. Пошаговый план действий

### Шаг 1. Зафиксировать baseline

1. Выполни `git status --short --branch`.
2. Убедись, что ветка `feature/report-generation-docx-v2`.
3. Сравни local Report export с live workflow через read-only API.
4. Если local/live отличаются, явно покажи отличие и остановись до выбора authoritative implementation.
5. Не выводи API key или credentials.

### Шаг 2. Подтвердить root cause execution `13892`

Проверь реальные outputs:

```text
Собрать итоговые данные
→ keys: analysis_run_id, procurement, fields, statistics

Добавить источники и доказательства
→ fields.length = 1
→ fields[0] содержит analysis_run_id/procurement/fields/statistics

Подготовить данные отчёта
→ keys: analysis_run_id, report_fields
→ procurement/statistics отсутствуют
```

Root cause должен быть сформулирован точно:

> `Добавить источники и доказательства` ожидает отдельные field items, но получает один aggregate envelope и ошибочно оборачивает его в `fields[0]`.

Не меняй workflow до подтверждения этого факта по execution data.

### Шаг 3. Определить вход Task 1

Trigger обязан принимать минимум:

```json
{
  "analysis_run_id": "f9d8e1d7-f01a-4d91-8eac-89c8376535c2"
}
```

`completion_claimed`, `barrier_ready` и `final_count` можно сохранить как diagnostics, но повторный запуск completed run не должен зависеть от `completion_claimed=true`.

Source of truth readiness — read-only DB snapshot:

```text
run exists
status = completed
27 unique FINAL rows
field indexes exactly 1..27
catalog = tender_fields_v1
contract = tender_field_final_v1
```

Snapshot node должен внутренне загрузить данные, необходимые следующему этапу:

```text
analysis_run
field_results
documents
facts
units
```

Task 1 не нормализует эти sources и не добавляет source indexes в terminal contract. Данные остаются доступны Task 2 через явно названный snapshot node.

### Шаг 4. Исправить envelope loss минимальным diff

Для первого regression checkpoint соедини:

```text
Собрать итоговые данные
→ Подготовить данные отчёта
```

Временно обойди `Добавить источники и доказательства`: source enrichment относится к Task 2.

После изменения проверь input следующей ноды:

```text
analysis_run_id
procurement
fields
statistics
```

Если выбран не bypass, а исправление envelope node, она обязана возвращать:

```text
{ ...input, fields: enrichedFields }
```

и не имеет права удалять `procurement` или `statistics`.

### Шаг 5. Сформировать стабильную базовую Report Data Model

Преобразуй 27 FINAL rows в `report_fields[]`.

Для каждого элемента обязательны:

```text
field_index
field
label
status
value
requires_review
result_json
```

Правила:

- `field` = canonical `field_key`;
- `label` = exact client label из `REPORT_FIELD_MAPPING.md`;
- `value` = FINAL `value_text`, без semantic substitution;
- `result_json` передаётся без изменения только для Task 2;
- `not_found` остаётся отдельной строкой с `value=null`;
- порядок строго `field_index=1..27`;
- словарь mapping один, не дублировать его между несколькими Code Nodes.

Top-level output должен иметь только четыре обязательных contract keys:

```text
analysis_run_id
procurement
statistics
report_fields
```

Internal snapshot с documents/facts/units остаётся output предыдущей snapshot node и не дублируется в terminal model.

### Шаг 6. Сделать Task 1 terminal checkpoint

На время проверки Task 1 не запускай:

- source normalization;
- текущие presentation nodes;
- Markdown/HTML file creation;
- Telegram.

Workflow должен завершаться success на базовой model node. Не создавай фиктивный success object, который скрывает ошибку.

### Шаг 7. Проверить known run

Input:

```json
{
  "analysis_run_id": "f9d8e1d7-f01a-4d91-8eac-89c8376535c2"
}
```

Expected:

```text
procurement present
statistics.total = 27
statistics.resolved = 11
statistics.requires_review = 3
statistics.not_found = 13
report_fields.length = 27
field indexes = 1..27
error "Нет данных закупки" absent
```

Остановись после этого checkpoint. Не переходи к Task 2 в том же изменении.

## 6. Проверки после выполнения

### Contract checks

- top-level keys присутствуют;
- `analysis_run_id` не потерян;
- `procurement.number`, subject/title, customer, platform доступны;
- `statistics` совпадает с фактическими statuses;
- `report_fields` — массив из 27 объектов;
- keys/indexes уникальны;
- order `1..27`;
- все 27 client labels определены;
- `resolved` имеет value;
- `not_found` не превращён в `нет`, `false` или `не требуется`;
- `result_json` доступен Task 2;
- HTML/Telegram nodes не исполнялись.

### Negative checks

- run отсутствует → explicit error;
- run не completed → explicit error;
- 26/28 FINAL rows → explicit error;
- duplicate index/key → explicit error;
- invalid FINAL contract/status → explicit error;
- PostgreSQL error не превращается в пустой success object.

### Git/scope checks

- upstream workflow exports не изменены;
- PostgreSQL schema/data не изменены;
- credentials не попали в diff;
- diff относится только к Task 1.

## 7. Критерии готовности

Task 1 готов только если одновременно выполнено:

1. Ошибка `Нет данных закупки [line 21]` больше не возникает в regression execution.
2. Workflow success заканчивается на базовой Report Data Model.
3. `procurement` присутствует.
4. `statistics.total === 27`.
5. `report_fields.length === 27`.
6. Структура каждого field стабильна и документирована.
7. Raw `result_json` сохранён для Task 2, но не считается client output.
8. Snapshot node содержит documents/facts/units для Task 2.
9. Source normalization, HTML и Telegram не реализованы.
10. Есть execution ID и фактический terminal JSON для передачи Task 2.

Передача следующему этапу:

```text
Task 1 output
→ REPORT_GENERATION_EXECUTOR_TASK_2_SOURCE_NORMALIZATION.md
```
