# Report Generation V2 — Executor Task 3: HTML Renderer

Рабочая ветка: `feature/report-generation-docx-v2`

Выполняй этот этап самостоятельно, без субагентов. Не начинай Task 3, пока Task 2 не прошёл acceptance criteria и не предоставил renderer-ready terminal JSON.

Task 3 не читает PostgreSQL, не восстанавливает evidence и не меняет analysis/report semantics.

## 1. Цель этапа

Создать клиентский self-contained HTML-отчёт из проверенной Report Data Model, сформировать HTML binary и отправить его через Telegram.

Граница этапа:

```text
validated Task 2 Report Data Model
↓
HTML template
↓
HTML string
↓
HTML file
↓
HTML validation
↓
Telegram
```

Вход Task 3:

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

Если input содержит raw evidence/internal IDs или не содержит sources для resolved fields, Task 3 должен остановиться и вернуть Task 2 на исправление.

## 2. Что разрешено менять

Только presentation/delivery участок local/test Report Generation workflow:

- `Сгенерировать HTML отчёт`;
- `Создать HTML файл`;
- `Проверить HTML результат`;
- `Отправить HTML в Telegram`;
- connections после terminal model Task 2.

Разрешено:

- versioned inline HTML/CSS template внутри Code Node;
- built-in JavaScript helpers;
- HTML escaping;
- UTF-8 binary creation через built-in `Buffer`;
- print CSS;
- Telegram Send Document;
- local/browser visual review;
- test chat до production delivery.

Production n8n/Telegram delivery можно изменять только после отдельного явного разрешения пользователя.

## 3. Что запрещено менять

Не делать в Task 3:

- PostgreSQL queries;
- изменение PostgreSQL schema/data;
- изменение Finalization;
- изменение Aggregator или Targeted Recheck;
- source extraction/normalization;
- чтение raw `result_json`;
- изменение field status/value;
- повторный mapping business semantics;
- скрытие части 27 полей;
- AI-вызовы;
- внешние JavaScript/CSS/font/image dependencies;
- renderer service;
- DOCX/PDF generation;
- новая таблица `report_data_model`;
- отображение UUID/internal fields;
- production write без отдельного разрешения.

## 4. Какие файлы изучить

Обязательно прочитать:

1. `AGENTS.md`;
2. `REPORT_GENERATION_ARCHITECTURE_V2.md`;
3. `REPORT_GENERATION_IMPLEMENTATION_PLAN_V2.md`;
4. `REPORT_GENERATION_EXECUTOR_TASK_1_DATA_MODEL.md` — только output contract;
5. `REPORT_GENERATION_EXECUTOR_TASK_2_SOURCE_NORMALIZATION.md`;
6. фактический terminal JSON и execution ID Task 2;
7. `REPORT_FIELD_MAPPING.md` — только для проверки labels, не для повторной semantic mapping;
8. `workflows/n8n-exports/TENDER — Генерация отчета.json`.

В локальной документации n8n проверить:

```text
F:\Vibe-projects\n8n\references\n8n-docs
```

Минимально:

- Code Node binary data;
- Telegram Send Document;
- execution error behavior.

## 5. Пошаговый план действий

### Шаг 1. Проверить вход Task 3

До rendering проверить:

```text
schema_version = tender_report_data_v2
analysis_run_id present
statistics.total = 27
report_fields.length = 27
field indexes = 1..27
attention_fields contains only requires_review
resolved fields have sources
not_found fields have sources=[]
raw result_json/internal IDs absent
```

Task 3 не исправляет входной contract. При ошибке остановись и верни Task 2 на исправление.

### Шаг 2. Создать HTML template

Использовать один self-contained HTML5 document:

```html
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Краткая справка по закупке</title>
  <style>/* inline styles only */</style>
</head>
<body>
  <header data-report-section="title"></header>
  <section data-report-section="summary"></section>
  <table data-report-section="fields"></table>
  <section data-report-section="attention"></section>
  <section data-report-section="statistics"></section>
</body>
</html>
```

Запрещены:

- `<script>`;
- external `<link>`;
- `src="http..."`;
- CSS `url(http...)`;
- interactive JavaScript;
- raw insertion dynamic values.

### Шаг 3. Реализовать единый escaping path

Каждое динамическое значение проходит `escapeHtml`, включая:

- procurement values;
- labels;
- field values;
- review notes;
- filenames;
- page/sheet strings;
- quotes;
- TenderPlan source name.

Escape минимум:

```text
& → &amp;
< → &lt;
> → &gt;
" → &quot;
' → &#39;
```

Не вставлять evidence как raw HTML.

### Шаг 4. Сформировать титульный блок

Показать:

- номер закупки;
- предмет закупки;
- заказчика;
- площадку;
- цену;
- дату публикации, если доступна;
- дату формирования отчёта.

Не показывать `analysis_run_id`.

Если presentation value отсутствует, использовать `Не указано`, не превращая его в business fact.

### Шаг 5. Сформировать summary

Показать четыре показателя из готовой `statistics`:

```text
Всего полей
Подтверждено
Требует проверки
Не найдено
```

Не пересчитывать statuses независимо без validation. Допускается контрольный пересчёт и explicit error при расхождении.

### Шаг 6. Сформировать таблицу 27 полей

Колонки:

```text
Поле | Значение | Источник
```

Каждая строка:

```html
<tr data-field-order="14" data-field-status="resolved">
  <td>Условия оплаты</td>
  <td>Авансовый платеж не предусмотрен...</td>
  <td><!-- source blocks --></td>
</tr>
```

Правила значения:

- `resolved`: готовый value;
- `requires_review`: value и заметная status label;
- `not_found`: `Не удалось надёжно установить`;
- не скрывать ни одно поле.

`field` logical key не показывать.

### Шаг 7. Сформировать sources

Для каждого элемента `sources[]` вывести отдельный block:

```text
Документ: Проект договора.pdf
Страница: 2
Цитата: «Оригинальный фрагмент»
```

Location rules:

- `page` и `page_to` одинаковы → `Страница: 2`;
- range → `Страницы: 2–3`;
- `sheet` → `Лист: Лист1`;
- location null → `Страница/лист: не определены`;
- metadata → `Источник: TenderPlan — карточка закупки`;
- `not_found` → `Надёжный источник не установлен после полного анализа и Targeted Recheck`.

Renderer не ищет source в БД и не восстанавливает missing document/page.

### Шаг 8. Сформировать блок `Требует внимания`

Использовать только `attention_fields` Task 2.

Для каждого элемента показать:

- label;
- value, если есть;
- status `Требует проверки`;
- canonical `review_note`;
- sources.

Проверить:

```text
attention_fields.length = statistics.requires_review
every attention field status = requires_review
```

Не создавать hardcoded business explanations.

### Шаг 9. Сформировать финальную статистику

Повторить:

- всего 27;
- resolved;
- requires_review;
- not_found;
- generated date.

Значения обязаны совпадать с summary.

### Шаг 10. Создать HTML output

`Сгенерировать HTML отчёт` возвращает:

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

`analysis_run_id` остаётся technical JSON metadata и не рендерится.

### Шаг 11. Создать HTML file

`Создать HTML файл`:

- проверяет non-empty `html`;
- кодирует UTF-8;
- создаёт binary property `report_html`;
- ставит MIME `text/html`;
- сохраняет filename `.html`;
- сохраняет в JSON `analysis_run_id`, filename и template version.

Не использовать filesystem или external modules.

### Шаг 12. Проверить HTML результат

До Telegram проверить decoded binary:

```text
starts with <!doctype html>
contains charset=utf-8
contains five data-report-section markers
contains exactly 27 <tr ... data-field-order="..."> rows
contains all three table headers
contains attention section
contains no <script / javascript: / external resources
contains no known internal UUID or internal key labels
```

Проверять именно `<tr>` rows, не считать CSS selectors или текстовые упоминания `data-field-order`.

При ошибке throw `REPORT_HTML_*`. Не возвращать `{valid:false}` как success.

### Шаг 13. Провести visual review

1. Открыть `.html` локально без network access.
2. Проверить desktop layout.
3. Проверить print preview.
4. Проверить длинные values/quotes.
5. Проверить Cyrillic.
6. Проверить отсутствие horizontal clipping.
7. Проверить все 27 rows в порядке.
8. Проверить source blocks и attention section.

Layout исправлять только в inline HTML/CSS. Не менять report data model или source normalization.

### Шаг 14. Отправить в Telegram

Telegram Send Document:

- Input Binary Field = `report_html`;
- сначала test chat;
- caption содержит tender number и summary, но не UUID;
- API error завершает execution ошибкой;
- success output содержит `message_id`.

Без persisted delivery state exactly-once не заявляется. Неоднозначный timeout может дать duplicate при retry.

### Шаг 15. Проверить known run и retry

Для run `f9d8e1d7-f01a-4d91-8eac-89c8376535c2` ожидается:

```text
27 rows
11 resolved
3 requires_review
13 not_found
sources visible
HTML valid
Telegram success in test chat
```

Повторный запуск по тому же completed run должен создавать тот же logical content и deterministic filename; generated date может отличаться.

## 6. Проверки после выполнения

### HTML structure

- HTML открывается локально;
- UTF-8/Cyrillic корректны;
- присутствует титульный блок;
- summary показывает 27/11/3/13 для known run;
- основная таблица содержит 27 rows;
- headers: `Поле`, `Значение`, `Источник`;
- source показывает document, page/sheet и quote;
- блок `Требует внимания` содержит только 3 `requires_review` fields;
- финальная statistics совпадает с summary;
- print preview читаем.

### Security/internal leak

- все dynamic strings escaped;
- нет executable scripts;
- нет external resources;
- HTML не содержит `analysis_run_id` value;
- HTML не содержит UUID из source index;
- не показаны `field`, `semantic_block_id`, `candidate_ref`, `analysis_unit_id`, `fact_id`, confidence или raw evidence.

### Artifact/Telegram

- binary property `report_html` существует;
- filename заканчивается `.html`;
- MIME `text/html`;
- size больше минимального разумного порога;
- structural validator success;
- Telegram возвращает `message_id`;
- Telegram failure не превращается в success.

### Scope

- Task 1 и Task 2 contracts не изменены;
- PostgreSQL не читался и не изменялся Task 3;
- source normalization не дублируется в renderer;
- upstream workflows не изменены;
- DOCX/PDF не реализованы.

## 7. Критерии готовности

Task 3 готов только если:

1. Вход полностью соответствует renderer-ready output Task 2.
2. HTML создаётся из готовой model без DB/source fallback.
3. Титульный блок содержит номер, предмет, заказчика, площадку и цену.
4. Summary и финальная статистика согласованы.
5. Таблица содержит ровно 27 fields и три требуемые колонки.
6. Все sources отображают document, page/sheet и quote, если они доступны.
7. `Требует внимания` содержит только `requires_review`.
8. HTML не содержит UUID или internal technical fields.
9. HTML открывается в browser и проходит print-preview review.
10. Binary `.html` имеет корректные filename/MIME/UTF-8.
11. Telegram test delivery возвращает `message_id`.
12. Analysis, Finalization и source normalization не изменены.

После Task 3 Report Generation HTML MVP считается реализованным только при наличии implementation, regression execution, visual review и Telegram test result.

