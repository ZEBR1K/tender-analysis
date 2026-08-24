# Executor Prompt — Report Generation V2

## Роль

Ты — исполнитель n8n с ограниченным контекстом. Работай только по этой инструкции. Не улучшай систему вне указанного scope.

## Главный стоп-сигнал

Сначала проверь, есть ли в текущем сообщении пользователя явное разрешение:

```text
Архитектура Report Generation V2 согласована. Можно начинать реализацию.
```

Если такого разрешения нет:

1. ничего не меняй;
2. не редактируй workflow JSON;
3. не меняй Code Nodes;
4. не меняй PostgreSQL;
5. сообщи: «Жду согласования архитектуры Report Generation V2»;
6. остановись.

Этот prompt не является самостоятельным разрешением на изменение workflow.

## 1. Разрешённый scope после согласования

Менять только Report Generation workflow:

```text
workflows/n8n-exports/beta/TENDER — Генерация отчета beta v2.json
```

Не менять:

```text
TENDER — Агрегация закупки.json
TENDER - Targeted Recheck.json
TENDER — Финализация анализа.json
PostgreSQL schema/data
FIELD_CATALOG.md
DATA_MODEL.md
```

Production n8n менять только при отдельном явном разрешении на production write. Наличие read-only API key не даёт write permission.

## 2. Неприкосновенный analysis contract

Каждый canonical field result имеет поля:

```text
field_index
field_key
status
value_text
confidence
requires_human_review
result_json
```

Запрещено создавать замены:

```text
field
key
value
requires_review
label вместо отдельного presentation-слоя
```

Правильно:

```json
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
    "client_field_name": "Условия оплаты"
  }
}
```

## 3. Файлы, которые прочитать до изменений

Прочитай полностью:

1. `AGENTS.md`;
2. `README.md`;
3. `ARCHITECTURE.md`;
4. `DATA_MODEL.md`;
5. `FIELD_CATALOG.md`;
6. `REPORT_FIELD_MAPPING.md`;
7. `REPORT_GENERATION_V2_ARCHITECTURE.md`;
8. `REPORT_GENERATION_V2_IMPLEMENTATION_PLAN.md`;
9. beta Report workflow JSON;
10. Finalization workflow JSON;
11. Aggregator workflow JSON.

По поведению n8n читай локальную официальную документацию:

```text
F:\Vibe-projects\n8n\references\n8n-docs
```

## 4. Preflight

Выполни:

```powershell
git status --short --branch
```

Зафиксируй существующие изменения пользователя. Не перезаписывай их.

Read-only проверка:

1. Сравни local beta workflow и live workflow ID `ckPnP3hRhKu4Mf9u`.
2. Сравни `versionId`, nodes, connections и node parameters.
3. Прочитай executions:
   - `13863` — successful Finalization;
   - `13892` — historical Report failure.
4. Прочитай PostgreSQL только `SELECT` для run:

```text
f9d8e1d7-f01a-4d91-8eac-89c8376535c2
```

Expected baseline:

```text
run.status = completed
documents = 3
units = 18
facts = 38
field results = 27
resolved = 11
requires_review = 3
not_found = 13
```

Если baseline или local/live workflow отличается — не меняй ничего. Опиши расхождение и остановись.

## 5. Порядок реализации

Работай строго по этапам. После каждого этапа остановись для проверки execution data. Не меняй сразу весь workflow.

### Этап 1 — Report Snapshot

1. Переименуй `Получить данные закупки` в `Получить Report Snapshot`.
2. Замени SQL на один read-only statement.
3. Statement должен вернуть:

```json
{
  "report_snapshot": {
    "snapshot_version": "tender_report_snapshot_v2",
    "analysis_run_id": "uuid",
    "analysis_run": {},
    "field_results": [],
    "source_index": {
      "documents": [],
      "facts": [],
      "units": []
    }
  }
}
```

4. В `field_results` выбери ровно семь исходных fields без aliases.
5. Отсортируй JSON aggregate по `field_index`.
6. Не загружай полный `analysis_unit`; нужны только source-related columns.
7. Переименуй `Нормализовать данные закупки` в `Проверить Report Snapshot`.
8. Полностью замени code этой ноды на validation из implementation plan.
9. Запусти regression input из execution `13863`.

Acceptance этапа 1:

```text
27 field_results
indexes 1..27
exact field_key catalog
exact seven contract keys
11 / 3 / 13 statistics
```

Если validation не проходит, исправляй только Snapshot. Не переходи дальше.

### Этап 2 — Report Adapter

1. Переименуй `Собрать итоговые данные` в `Адаптировать поля отчёта`.
2. Полностью замени code.
3. Для каждого field создай:

```text
analysis_result = неизменённый canonical object
presentation    = client display data
sources[]       = normalized client-safe sources
```

4. Mapping client names возьми только из `REPORT_FIELD_MAPPING.md`.
5. Не создавай `label`, `key`, `value`, `requires_review`.
6. Обработай каждый элемент `result_json.evidence[]`.
7. Разрешай `candidate_ref="fact:..."` через `source_index.facts`, затем document.
8. Разрешай `analysis_unit_id` только при однозначном match.
9. Metadata evidence преобразуй в `kind="tender_metadata"`.
10. Удали UUID/internal ids из `sources[]`.
11. Не придумывай page, sheet или quote.

Acceptance этапа 2 для regression run:

```text
adapted_fields = 27
evidence processed = 29
fact refs resolved to documents = 23
metadata sources = 3
unit refs handled = 3
payment_terms sources = 4
not_found sources = []
```

Если один source неоднозначен, не выбирай первый. Верни visible diagnostic status.

### Этап 3 — Report Model

1. Переименуй `Подготовить данные отчёта` в `Собрать Report Model`.
2. Полностью замени code.
3. Построй `tender_report_model_v2` строго по architecture document.
4. Procurement presentation читай из `analysis_run.tender_meta`.
5. Не заменяй canonical `value_text` metadata значением.
6. Statistics вычисли из `analysis_result.status`.
7. `attention_field_indexes` вычисли из `requires_human_review === true`.
8. Переименуй `Подготовить структуру отчёта` в `Проверить Report Model`.
9. Полностью замени code на deterministic validation.

Acceptance этапа 3:

```text
fields = 27
statistics sum = 27
attention indexes = 2, 17, 21 для regression run
presentation exists for all 27
canonical key names unchanged
```

### Этап 4 — HTML Renderer

1. Переименуй `Подготовить данные для отчёта` в `Сгенерировать HTML`.
2. Полностью замени code.
3. Используй self-contained HTML и inline CSS.
4. Создай helpers:

```text
escapeHtml
formatDate
formatPrice
renderSource
renderFieldRow
renderAttentionItem
```

5. Выведи sections:

```text
title
summary
fields
attention
statistics
```

6. Таблица обязана содержать ровно 27 rows с `data-field-index`.
7. Поле отображается из `presentation.client_field_name`.
8. Значение отображается из `analysis_result.value_text`.
9. Источник отображается из всех `sources[]`.
10. Не рендери `field_key`, `result_json`, confidence или internal ids.
11. Для `not_found` используй нейтральную формулировку.

Acceptance этапа 4:

- HTML открывается в браузере;
- все строки и источники читаемы;
- quote экранирован;
- блок внимания содержит только requires_review;
- нет executable markup/external resources;
- нет UUID/technical keys.

### Этап 5 — HTML artifact

1. Переименуй `Сформировать Markdown отчёт` в `Создать HTML файл`.
2. Полностью замени code.
3. Binary property: `report_html`.
4. Encoding: UTF-8.
5. MIME: `text/html`.
6. Filename: `Анализ закупки_<number>.html`, с безопасной очисткой имени.
7. Сохрани `analysis_run_id` в terminal JSON.
8. Переименуй `Создать Markdown файл` в `Проверить HTML файл`.
9. Полностью замени code на terminal HTML/binary validation.

Acceptance этапа 5:

```text
binary exists
MIME text/html
filename ends .html
doctype exists
required sections exist
27 unique field rows
no internal data leak
```

### Этап 6 — удалить поглощённые ноды

Только после acceptance этапов 1–5 удалить:

```text
Получить результаты анализа
Получить документы источников
Получить факты источников
Обогатить источники документов
```

После удаления вручную проверь connections. Не должно быть dangling edges.

## 6. Обязательные regression scenarios

1. Successful run `f9d8...` → valid 27-row HTML.
2. 26 rows → fail до Adapter.
3. duplicate index/key → fail.
4. missing presentation mapping → fail.
5. `payment_terms` → четыре sources.
6. metadata source → без fictitious page/quote.
7. DOCX source без page → page остаётся null.
8. `not_found` → no source required, no negative fact.
9. `<>&"'` в value/quote → escaped HTML.
10. UUID/internal key в rendered HTML → fail terminal validation.

## 7. Что нельзя делать даже после согласования

- не менять upstream analysis workflow;
- не менять семантику 27 полей;
- не создавать новую PostgreSQL-таблицу;
- не выполнять DB writes;
- не вызывать AI из Report Generation;
- не выбирать случайный source при неоднозначности;
- не скрывать `not_found` rows;
- не заменять `nm_price_with_vat.value_text` metadata price;
- не удалять evidence из analysis audit;
- не отправлять в Telegram в рамках этого плана, если это не согласовано отдельно.

## 8. Финальная проверка

1. Покажи runtime input/output каждой изменённой ноды.
2. Покажи summary regression run: 27 / 11 / 3 / 13.
3. Покажи source coverage: 29 / 23 / 3 / 3 и `payment_terms=4`.
4. Открой HTML в браузере и проверь таблицу/длинные цитаты/print view.
5. Выполни `git diff --check`.
6. Подтверди отсутствие изменений Aggregator, Targeted Recheck, Finalization и PostgreSQL.
7. Не объявляй задачу завершённой без successful runtime execution.

## 9. Stop conditions

Сразу остановись и сообщи пользователю, если:

- нет явного согласования архитектуры;
- local/live Report workflow расходятся;
- DB schema расходится с `DATA_MODEL.md`;
- для source требуется придумать отсутствующую страницу;
- implementation требует изменить исходный analysis contract;
- требуется изменить upstream workflow;
- production write access не был явно предоставлен;
- в worktree есть пересекающиеся пользовательские изменения, которые нельзя сохранить.

