# Журнал разработки — AI-анализ тендерной документации

## 13.08.2026

### Подключили Docling для разбора документов

**Что было**

Нужно было получать из документов не просто сплошной текст, а структуру, пригодную для дальнейшего точного AI-анализа:

- текст;
- таблицы;
- страницы;
- заголовки;
- порядок элементов;
- координаты;
- изображения.

Рассматривали Docling как основной парсер документов.

**Что попробовали**

Настроили отправку файлов в облачный IBM Docling через API из n8n.

Рабочая схема:

```text
POST /v1/convert/file/async
        ↓
получаем task_id
        ↓
GET /v1/status/poll/{task_id}
        ↓
GET /v1/result/{task_id}
        ↓
скачиваем JSON / Markdown artifacts
```

Для отправки оказалось важно передавать `to_formats` отдельными multipart-полями:

```text
to_formats = md
to_formats = json
```

Вложенный вариант параметров в этом deployment работал некорректно — возвращался только Markdown.

**Что произошло**

Удалось стабильно получать:

- Markdown;
- Docling JSON;
- `task_id`;
- status;
- presigned URL результата.

Решили использовать **Docling JSON как основной структурный источник**, а Markdown оставить как вспомогательное представление.

**Вывод**

Docling подходит как первый parser layer.

Архитектуру при этом нельзя жёстко завязывать именно на него:

```text
Parser
    ↓
единый внутренний формат
    ↓
вся остальная система
```

Тогда позже Docling можно заменить без полной переделки workflow.

**Оставили на потом**

- [ ] После отправки в Docling сделать полноценный цикл polling:
  ```text
  pending
  processing
  success
  failure
  ```
- [ ] Добавить timeout/max attempts.
- [ ] Retry для `429` и `5xx`.
- [ ] Exponential backoff.
- [ ] После `success` сразу скачивать artifacts, потому что ссылки временные.
- [ ] Проверять не только общий статус task, но и `num_failed` / статус отдельных документов.

---

### Решили сохранять исходные данные отдельно от n8n

**Проблема**

На текущем этапе `raw_source` существует только внутри выполнения workflow.

Если execution удалится или будет очищен, исходные данные можно потерять.

**Решение**

Позже сохранять `raw_source` в БД.

Пример будущей логики:

```text
скачанный документ
    ↓
raw parser result
    ↓
PostgreSQL / object storage
    ↓
normalized result
```

**Оставили на потом**

- [ ] Спроектировать хранение `raw_source`.
- [ ] Не хранить большие бинарные файлы непосредственно в execution n8n дольше необходимого.
- [ ] Определить, что сохраняем:
  - исходный файл;
  - raw Docling JSON;
  - normalized JSON;
  - версия normalizer;
  - parser/version;
  - время обработки.

---

## 14.08.2026

### Отказались от отдельных workflow для каждого формата документа

**Что было**

Первоначально логично выглядел вариант:

```text
PDF → отдельная ветка
DOCX → отдельная ветка
XLSX → отдельная ветка
...
```

**Проблема**

Это быстро приводит к дублированию:

- одинаковая логика provenance;
- одинаковые проверки;
- одинаковая подготовка к AI;
- изменения приходится делать в нескольких местах.

**Решение**

Сделали архитектуру:

```text
PDF / DOCX / XLSX / ...
        ↓
Parser
        ↓
единый Normalizer
        ↓
специализированные функции внутри Normalizer
        ↓
единый внутренний schema
```

То есть **один normalizer, но разные обработчики внутри него**, когда формат этого требует.

**Вывод**

Это лучше отдельных веток.

Универсальность означает не «обрабатывать все документы одинаково», а:

> все форматы должны приводиться к одному внутреннему контракту данных.

---

### Сделали универсальный Normalizer Docling JSON

Normalizer научился обрабатывать:

```text
texts
tables
pictures
groups
key_value_items
form_items
body
furniture
```

Для каждого блока сохраняются:

```text
block_id
order
type
label
content_layer
group_path
sheet_name
source.page_no
source.bbox
```

Для таблиц сохраняются реальные `table_cells`.

Важно: используем:

```text
data.table_cells
```

а не готовый `grid`, потому что `grid` мог дублировать merged cells.

Добавили аудит:

```text
coverage
unknown_refs
unvisited_refs
blocks_count
table_cells_count
characters
```

**Результат**

На протестированных документах:

```text
coverage = 1
unknown_refs = 0
unvisited_refs = 0
```

**Вывод**

Normalizer сейчас является стабильным внутренним слоем между parser и дальнейшим анализом.

---

### Проверили DOCX

Проверили реальный DOCX.

Получили:

```text
66 text blocks
1 table
3 groups
```

Normalizer:

```text
67 blocks
coverage = 1
unknown = 0
unvisited = 0
```

Важные данные документа сохранились:

- предмет закупки;
- ОКПД2;
- финансирование;
- отсутствие аванса;
- срок поставки;
- адрес;
- требования к сертификатам;
- гарантия;
- количество.

---

### Обнаружили проблему legacy `.doc`

**Что попробовали**

Отправили старый бинарный `.doc` напрямую в managed Docling.

**Что произошло**

Task формально завершался, но конкретный документ внутри task завершался ошибкой.

**Вывод**

Legacy:

```text
.doc
```

нужно предварительно преобразовывать:

```text
.doc
 ↓
.docx
 ↓
Docling
```

Предпочтительно конвертировать именно в DOCX, а не PDF, чтобы максимально сохранить структуру документа.

**Оставили на потом**

- [ ] Сделать pre-convert `.doc → .docx`.
- [ ] Выбрать, где выполнять LibreOffice-конвертацию.
- [ ] На текущем VPS с ~2 GB RAM LibreOffice желательно не поднимать без необходимости.

---

### Обнаружили блокировку Росэлторга по IP

**Что было**

Некоторые файлы Росэлторга не скачивались с VPS.

DNS работал, но:

```text
TCP 443 → timeout
```

С домашнего российского IP файл открывался.

Через зарубежный/VPN IP — нет.

**Вывод**

Практически подтвердили IP/geo restriction.

**Решение**

Купили российский HTTP proxy.

Архитектура:

```text
обычные источники
    ↓
direct download

Росэлторг / проблемные домены
    ↓
RU proxy
```

Прокси протестирован — скачивание работает.

**Важно**

Не проксируем весь workflow глобально.

Прокси используется только там, где действительно нужен.

**Оставили на потом**

- [ ] Убрать proxy credentials из открытых настроек workflow.
- [ ] Хранить секреты через Credentials / environment.
- [ ] Позже сделать автоматический выбор direct/proxy по домену.

---

### Проверили scan PDF

На реальном одностраничном скане Docling сохранил:

- страницу;
- таблицу;
- координаты;
- структуру документа.

Но русский OCR оказался заметно повреждён.

При этом собственные confidence-оценки Docling выглядели относительно нормальными:

```text
layout ≈ 0.72
OCR ≈ 0.85
```

Хотя глазами качество было недостаточным.

**Вывод**

Нельзя использовать встроенный confidence Docling как единственный критерий качества OCR.

Также нельзя отдавать плохой OCR нейронке с просьбой «исправить», потому что модель может придумать:

- цифры;
- артикулы;
- нормативные документы;
- даты.

**Решение**

OCR для сканов отложили на отдельный этап.

**Оставили на потом**

- [ ] Custom OCR quality gate.
- [ ] Fallback OCR.
- [ ] Сравнение нескольких OCR результатов.
- [ ] Отдельная обработка сканов.

---

### Проверили native PDF

Проверили нормальный 16-страничный PDF.

Normalizer получил:

```text
249 text blocks
2 tables
47 groups
251 block total
coverage = 1
```

Текст извлёкся очень хорошо.

Сохранились:

- предмет;
- условия оплаты;
- отсутствие аванса;
- срок поставки;
- постановление №1875;
- спецификация;
- стоимость;
- позиции.

**Вывод**

Для native PDF текущий parser + normalizer работают хорошо.

---

### Сделали ноду `Подготовить блоки к анализу`

Задача — убрать технический мусор перед построением смысловой структуры, но ничего не потерять.

Нода:

- сохраняет исходные blocks;
- добавляет `analysis.include`;
- добавляет `exclude_reason`;
- создаёт `analysis_sequence`;
- убирает:
  - пустые таблицы;
  - footer;
  - номера страниц;
  - визуальные элементы из текстового потока;
- контролирует количество блоков.

Для PDF добавили осторожную коррекцию reading order.

На простых страницах можно использовать визуальный порядок.

На сложных многоколоночных страницах сохраняем parser order.

**Почему**

Глобальная сортировка:

```text
page → y → x
```

сломала бы, например, двухколоночную страницу договора.

---

### Обнаружили cross-page разрывы

В PDF некоторые пункты начинались на одной странице и продолжались на другой:

```text
2.2
3.1
4.9
4.14
5.2.1
5.4.4
6.4
7.11
9.1
13.1
```

Это стало отдельной задачей следующего semantic layer.

---

### Сделали `Собрать смысловые разделы`

Построили слой:

```text
source blocks
     ↓
semantic_blocks
     ↓
sections
```

Система научилась распознавать:

```text
Статья 5...
Раздел 6...
Глава...
5.3. Поставщик вправе:
```

и сохранять:

```text
section
subsection
paragraph
table
```

Также сделано консервативное объединение продолжений между страницами.

На PDF:

```text
coverage = 1
missing = 0
duplicates = 0
data_loss = false
```

Все известные cross-page continuations объединились правильно.

---

### Исправили особенности DOCX-заголовков

Нашли два реальных случая.

#### Случай 1

Заголовок:

```text
6. Основные технические требования...
```

оказался разделён на два Word paragraphs.

Добавили консервативное объединение split heading.

#### Случай 2

Строку:

```text
ОКПД 2...
```

Docling ошибочно считал заголовком.

Добавили downgrade ложных parser subheadings без хардкода конкретно под `ОКПД`.

**Результат**

DOCX после исправлений:

```text
coverage = 1
missing = 0
duplicates = 0
warnings = []
```

---

### Решили пока не переусложнять определение заголовков

Текущая система достаточно универсальна, но криво оформленный документ всё ещё может её обмануть.

**Будущая идея**

Вместо бинарных правил сделать heading scoring.

Например:

```text
Docling → section_header      +5
bold                          +2
font больше окружающего       +2
короткая строка               +1
центрирование                 +1
номер раздела                 +N
```

И затем:

```text
score >= threshold
→ heading
```

**Оставили на потом**

- [ ] Heading scoring.
- [ ] Использовать font size/style/alignment, если parser отдаёт их достаточно стабильно.
- [ ] Не переделывать сейчас, пока реальные тесты проходят.

---

### Сделали `Подготовить части для анализа`

Архитектура:

```text
sections
   ↓
logical groups/subsections
   ↓
analysis_units
```

Принципы:

- крупные разделы не смешиваются;
- подраздел стараемся сохранить целиком;
- режем только между `semantic_blocks`;
- таблицу посередине не режем;
- один огромный semantic block оставляем целиком;
- overlap только внутри одного продолжающегося подраздела.

---

### Проверили искусственный маленький лимит

Для стресс-теста снизили:

```javascript
maxPrimaryApproxTokens: 600
```

чтобы заставить систему реально делить документы.

Нашли потенциальное улучшение:

если условно содержимое:

```text
960 токенов
68 токенов
```

сейчас может получиться неидеальный баланс частей.

**Будущая идея**

Балансировать части:

```text
600 + 450
```

вместо:

```text
960 + 90
```

если семантические границы позволяют.

**Оставили на потом**

- [ ] Balanced packing.
- [ ] Не жертвовать смысловыми границами только ради одинакового размера.

---

## 15.08.2026

### Исправили overlap для таблиц

**Проблема**

При стресс-тесте XLSX большая таблица могла попасть в следующую analysis unit как overlap.

Получалось:

```text
Unit 2:
огромная таблица

Unit 3:
та же огромная таблица как overlap
+ маленький остаток документа
```

Это:

- дорого;
- бессмысленно;
- создаёт дубли фактов;
- усложняет aggregation.

**Первый очевидный вариант**

Можно было сделать:

```javascript
.filter(block => block.type !== 'table')
.slice(-overlapCount)
```

Но это тоже плохо.

Если последним блоком была таблица, код начинал бы искать более ранний текст и использовать уже устаревший контекст.

**Рабочее решение**

Сначала берём реальные последние N блоков:

```javascript
.slice(-overlapCount)
```

и только затем удаляем таблицы.

То есть:

> если на границе была таблица — overlap просто отсутствует.

**Результат**

Stress test PASS.

```text
units_with_overlap_count = 0
```

для XLSX.

---

### Поняли побочный эффект запрета table overlap

Первый маленький блок XLSX тоже являлся технически таблицей, хотя по смыслу это был заголовок:

```text
Обоснование начальной (максимальной) цены контракта...
```

После полного запрета table overlap большая таблица перестала получать этот заголовок.

**Вывод**

Не надо делать исключение вида:

```text
маленькая таблица → можно overlap
большая → нельзя
```

Это смешивает две разные задачи.

Правильнее:

```text
overlap = локальный контекст разрыва

document/sheet context = постоянный контекст документа
```

---

### Добавили `spreadsheet_context`

В `Собрать смысловые разделы v1.3` добавили понимание Excel-листов.

Теперь сохраняется:

```json
{
  "sheet_name": "Лист1",
  "sheet_title": "Обоснование начальной (максимальной) цены контракта...",
  "title_source_block_id": "#/tables/1",
  "title_semantic_block_id": "sb_0001"
}
```

Заголовок определяется консервативно:

- первый блок листа;
- таблица;
- одна непустая ячейка;
- ячейка занимает большую часть ширины.

**Результат**

На реальном XLSX:

```text
sheet_title detection = PASS
```

---

### Запретили смешивать разные Excel-листы

В `Подготовить части для анализа v1.3` добавили жёсткое правило:

```text
sheet_name изменился
→ новая analysis unit
```

Даже если оба листа вместе укладываются в token limit.

Например:

```text
Лист "НМЦК"
Лист "Характеристики"
```

никогда не должны попасть в один AI request.

Также добавили safety check:

если одна unit каким-то образом содержит несколько `sheet_name`, workflow падает с ошибкой вместо передачи модели неправильного контекста.

**Оставили на потом**

- [ ] Реальный multi-sheet regression test.

---

### Добавили постоянный Excel context в analysis units

Теперь каждая часть знает:

```json
"context": {
  "sheet_name": "Лист1",
  "sheet_title": "Обоснование начальной..."
}
```

И нейронка получает:

```text
КОНТЕКСТ ДОКУМЕНТА
Раздел: ...
Excel-лист: Лист1
Заголовок листа: ...
```

Если заголовок уже находится непосредственно в `primary_text`, повторно его не вставляем.

---

### Нашли проблему представления Excel-таблиц

Старый renderer создавал:

```text
РАСЧЕТ НМЦК | | | | | | | | | | | ...
```

и:

```text
Дата подготовки... | | | | | | ...
```

Это:

- тратило токены;
- ухудшало читаемость;
- при простом удалении пустых колонок могло потерять соответствие «заголовок → значение».

---

### Не стали просто удалять пустые ячейки

Обсудили вариант:

```text
№ | Товар | | ОКПД2 | 50
```

→

```text
№ | Товар | ОКПД2 | 50
```

и отказались.

**Почему**

После удаления пустой ячейки значения могут визуально «сдвинуться» относительно исходных колонок.

Для тендерного анализа это слишком рискованно.

---

### Сделали smart table renderer

`Собрать смысловые разделы v1.4`.

Теперь используется два режима.

#### Режим 1 — merged text

Если таблица фактически является несколькими широкими объединёнными текстовыми строками:

```text
Дата подготовки...
| | | | |
```

превращаем в:

```text
Дата подготовки...
```

То же для:

```text
РАСЧЕТ НМЦК
```

и подписи ответственного.

#### Режим 2 — настоящая таблица

Сохраняем координаты:

```text
Строка R5:
[R5-R6,C1] №
[R5-R6,C2-C3] Наименование товара
[C7] Поставщик 1
[C8] Поставщик 2
[C29] Средняя цена
[C30] НМЦК

Строка R7:
[C1] 1
[C7] 449,00
[C8] 490,00
[C29] 504.67
[C30] 25233.5
```

Теперь модель явно видит:

```text
C7 → Поставщик 1 → 449
C8 → Поставщик 2 → 490
C29 → Средняя цена → 504.67
C30 → НМЦК → 25233.5
```

**Вывод**

Это надёжнее обычного Markdown/pipe table для сложных merged Excel.

---

### Проверили smart renderer стресс-тестом

С лимитом:

```text
600 tokens
```

получили:

```text
3 analysis units
```

Большая таблица:

```text
~953 условных токена
```

осталась целиком.

При этом:

```text
coverage = 1
data_loss = false
duplicates = 0
overlap tables = 0
```

**Интересный результат**

Количество токенов большой таблицы немного выросло относительно старого renderer:

```text
~907 → ~953
```

Это нормально.

Мы заменили бессмысленные:

```text
| | | |
```

на полезную структуру:

```text
[C7]
[R5-R6,C29]
Строка R7
```

То есть платим небольшим количеством токенов за значительно более надёжное понимание таблицы.

---

### Вернули production limit

После стресс-тестов вернули:

```javascript
maxPrimaryApproxTokens: 3200
```

Production test XLSX:

```text
analysis_units = 1
primary tokens ≈ 1058
analysis tokens ≈ 1093
split_sections = 0
overlap = 0
coverage = 1
data_loss = false
warnings = []
```

Весь небольшой XLSX теперь отправляется модели одним цельным запросом.

**Вывод**

Текущую базовую XLSX-подготовку можно заморозить.

Текущие стабильные версии:

```text
Собрать смысловые разделы v1.4
Подготовить части для анализа v1.3
maxPrimaryApproxTokens = 3200
```

---

# Что сознательно оставили на потом

## Высокий приоритет

### 1. Provenance перед AI

Сейчас unit знает:

```text
semantic_block_id
source_block_id
page
bbox
```

Но перед AI нужно сформировать компактный provenance index.

Например:

```json
{
  "semantic_block_id": "sb_0002",
  "source_block_id": "#/tables/2",
  "sheet_name": "Лист1",
  "page_no": 1,
  "bbox": {}
}
```

Для XLSX желательно позже уметь указывать:

```text
Лист1 → R7 → C30
```

Это следующий текущий этап.

---

### 2. Первый AI Extractor

После provenance:

```text
analysis unit
    ↓
LLM extractor
    ↓
candidate facts
```

Модель должна возвращать только найденные факты, например:

```json
{
  "field_key": "tender.nmc",
  "value": 25233.5,
  "evidence": [...]
}
```

Нельзя возвращать `not_found` только потому, что конкретная unit не содержит факт.

Глобальный `not_found` можно определять только после обработки всего документа.

---

### 3. Validator + второй проход

Архитектура:

```text
Extractor
   ↓
Validator
   ↓
сомнительные / критические факты
   ↓
Targeted recheck
```

Для критичных полей:

```text
сумма
срок
аванс
обеспечение
лицензия
сертификат
```

должно быть обязательное evidence.

---

## Средний приоритет

### Очень большие таблицы

Если один table block окажется, например:

```text
15 000 tokens
```

текущая система оставит его целиком.

Нужно будет сделать:

```text
header rows
   ↓
data rows 1–50

header rows
   ↓
data rows 51–100
```

Правила:

- одну строку не разрезать;
- headers повторять;
- координаты сохранять.

---

### Multi-sheet XLSX test

Логика уже написана, но реальным файлом ещё не проверена.

Нужно протестировать:

```text
Лист1 — НМЦК
Лист2 — Характеристики
Лист3 — Требования
```

и убедиться:

```text
никакая unit не содержит два sheet_name
```

---

### XLSX-лист как semantic section

Сейчас XLSX всё ещё может иметь:

```text
section_title = "Преамбула"
```

хотя логичнее:

```text
section_title = "НМЦК"
```

или название листа.

Функционально это сейчас не мешает, потому что `sheet_name` уже является жёсткой границей.

---

### Template placeholders

Сейчас:

```text
{Поставщик_4}
{Цена_4}
```

правильно сохраняются как текст исходного документа.

Позже надо явно маркировать:

```text
template_placeholder
```

чтобы AI не решил, что это реальные данные.

---

### Арифметическая проверка XLSX

Не доверять вычисления LLM.

Например кодом проверять:

```text
449
490
575
 ↓
average
 ↓
504.67

504.67 × 50
 ↓
25233.5
```

И отдельно проверять:

- standard deviation;
- coefficient of variation;
- итоговую НМЦК.

---

## Более поздний этап

### Embedded formulas / pictures в XLSX

В реальном XLSX обнаружили встроенные изображения с формулами.

Docling не передал все из них в текст.

То есть:

```text
Normalizer coverage = 1
```

означает:

> мы сохранили 100% того, что отдал Docling,

а **не**:

> Docling извлёк 100% исходного файла.

Это важное различие.

Позже:

- [ ] извлекать embedded images;
- [ ] распознавать формулы;
- [ ] тип `formula/equation`;
- [ ] связывать формулу с листом/ячейками.

---

### OCR scan fallback

Отдельный этап:

```text
scan
 ↓
OCR quality assessment
 ↓
good → дальше
bad → fallback OCR
 ↓
comparison
```

Не просить LLM самостоятельно «догадаться», что было на плохом скане.

---

### Балансировка частей

Сейчас при больших разделах может получиться:

```text
960 + 68
```

В будущем попробовать:

```text
600 + 428
```

но только если это не разрушает:

- подраздел;
- список;
- таблицу;
- логическую последовательность.

---

### Heading scoring

Текущие правила оставить, пока не появится реальный проблемный документ.

Будущий вариант:

```text
parser section_header       +5
bold                        +2
larger font                 +2
numbered heading            +2
short line                  +1
centered                    +1
surrounded by whitespace    +1
```

И classification по сумме.

---

# Ключевые архитектурные решения на текущий момент

Если совсем коротко, сейчас система строится так:

```text
TenderPlan
    ↓
attachments
    ↓
direct / RU proxy download
    ↓
Docling
    ↓
RAW Docling JSON
    ↓
Universal Normalizer
    ↓
Подготовить блоки к анализу
    ↓
Собрать смысловые разделы v1.4
    ↓
Подготовить части для анализа v1.3
    ↓
Развернуть части для AI
    ↓
[СЛЕДУЮЩИЙ ЭТАП]
Compact provenance
    ↓
AI Extractor
    ↓
Validator
    ↓
Targeted recheck
    ↓
Cross-document checks
    ↓
Сравнение с документами компании
    ↓
Итоговый отчёт
```

Самый важный принцип, который уже сформировался за эти три дня:

> **не пытаться заставить одну нейронку понять весь тендер и поверить её ответу. Сначала максимально детерминированно сохранить структуру документа, затем давать модели небольшие осмысленные части с источниками, а критичные факты отдельно проверять.**

Именно это решение сейчас выглядит основой всей системы.

---

## 18.08.2026

### Перешли от Loop-архитектуры к Postgres state machine

**Что было**

Изначально обработку всех документов одной закупки можно было строить как один длинный workflow с Loop.

Проблемы такого подхода:

- один execution держит всю закупку;
- сложнее повторно запускать только один упавший документ;
- сложнее масштабировать обработку документов;
- неудобно определять, когда действительно завершены все документы;
- ошибка одного документа влияет на весь длинный execution.

**Решение**

Перешли к архитектуре:

```text
Postgres хранит состояние
n8n выполняет отдельные работы
```

Основной принцип:

> **1 Document Worker execution = 1 документ.**

Текущая схема:

```text
ORCHESTRATOR
    ↓
создать analysis_run
    ↓
зарегистрировать ВСЕ документы в Postgres
    ↓
запустить Document Worker для каждого документа

DOCUMENT WORKER
    ↓
атомарно захватить документ
    ↓
скачать
    ↓
Docling
    ↓
Normalizer
    ↓
semantic sections / analysis units
    ↓
AI Extractor
    ↓
evidence validator
    ↓
AI Validator
    ↓
сохранить facts
    ↓
document = completed
    ↓
проверить готовность всей закупки

AGGREGATOR
    ↓
загрузить facts всех документов
    ↓
сгруппировать по 27 полям
    ↓
semantic aggregation
    ↓
при необходимости Targeted Recheck
    ↓
финальное состояние поля
```

**Критически важное решение**

Все документы закупки должны быть зарегистрированы **до запуска первого Worker**.

Иначе быстрый Worker может завершиться раньше, чем остальные документы вообще будут зарегистрированы, и ошибочно решить, что он последний.

---

### Создали Postgres-схему анализа тендера

Созданы и проверены таблицы:

```text
tender_analysis_runs
tender_analysis_documents
tender_analysis_units
tender_analysis_facts
```

#### `tender_analysis_runs`

Хранит состояние всего запуска анализа.

Основные статусы:

```text
created
processing
ready_for_aggregation
aggregating
completed
failed
```

#### `tender_analysis_documents`

Одна запись = один документ закупки.

Основные статусы:

```text
pending
processing
completed
failed
skipped
```

Хранит:

- `analysis_run_id`;
- индекс документа;
- имя;
- расширение;
- ссылку;
- MIME type;
- attempts;
- execution id Worker;
- units_total;
- facts_count;
- error_message;
- timestamps.

#### `tender_analysis_units`

Хранит подготовленные части документа для AI:

```text
analysis_unit_id
unit_index
section_id
section_title
section_kind
source_pages
analysis_unit
ai_segments
provenance
```

#### `tender_analysis_facts`

Хранит candidate facts после Extractor / Validator.

Используется каталог:

```text
tender_fields_v1
```

из 27 полей.

**Важно**

Для всех Postgres-нод тендерного проекта используется credential:

```text
KITATEH Tenders
```

Один раз по ошибке был выбран credential другого проекта (`WatchOne Avito`), из-за чего Postgres не видел нужные таблицы.

---

### Реализовали Orchestrator

Рабочая последовательность:

```text
TenderPlan fullinfo
    ↓
Normalize tender
    ↓
Создать запуск анализа
    ↓
Зарегистрировать документы
    ↓
Split attachments
    ↓
Execute Document Worker
```

#### `Создать запуск анализа`

Создаёт запись в:

```text
tender_analysis_runs
```

и сохраняет:

- `analysis_run_id`;
- `tender_meta`;
- `documents_total`.

#### `Зарегистрировать документы`

До запуска Worker:

- вставляет все attachments в `tender_analysis_documents`;
- назначает каждому документу UUID;
- ставит `pending`;
- переводит run из `created` в `processing`.

**Результат**

Проверено на реальной закупке с 3 документами — PASS.

---

### Реализовали атомарный захват документа Worker

В начале Document Worker используется Postgres-нода:

```text
Захватить документ в обработку
```

Логика:

```text
pending / failed
    ↓
processing
```

При этом:

- `attempts += 1`;
- сохраняется `$execution.id`;
- очищается старая ошибка;
- выставляется `started_at`.

Если тот же документ попытаются забрать повторно параллельно:

```text
claim_succeeded = false
```

и выполнение безопасно заканчивается.

**Результат**

Проверены:

- первый запуск;
- повторный claim;
- retry после `failed`.

PASS.

---

### Реализовали Error Workflow для Document Worker

Создан отдельный workflow:

```text
TENDER — Ошибка обработки документа
```

Схема:

```text
Error Trigger
    ↓
найти документ по n8n_execution_id
    ↓
processing → failed
    ↓
сохранить error_message
```

Важно: `Error Trigger` не срабатывает при ручном `Execute workflow`.

Для проверки использовали временный автоматический запуск и `Stop And Error`.

**Результат**

Проверено:

```text
processing → failed
retry → processing → completed
attempts: 1 → 2
```

PASS.

---

### Сохраняем analysis units до AI

Стабильная цепочка подготовки документа сейчас:

```text
Нормализовать документ Docling
    ↓
Подготовить блоки к анализу
    ↓
Собрать смысловые разделы v1.4
    ↓
Подготовить части для анализа v1.3
    ↓
Развернуть части для AI v1.2
    ↓
Сохранить analysis unit
```

`Сохранить analysis unit` пишет в:

```text
tender_analysis_units
```

в том числе:

- `analysis_unit`;
- `ai_segments`;
- `provenance`;
- `source_pages`.

Также обновляет:

```text
documents.units_total
```

**Результат**

PASS.

Это означает, что Targeted Recheck позже может искать контекст уже в Postgres и **не запускать Docling заново**.

---

### Сделали первый AI Extractor

Цепочка:

```text
Подготовить запрос для AI
    ↓
AI Extractor v1.0
```

Extractor возвращает только candidate facts.

Глобальный `not_found` на уровне одной analysis unit запрещён.

Правило:

> отсутствие факта в одной части документа не означает отсутствие факта во всей закупке.

---

### Исправили проблему reasoning у Extractor

Изначально DeepSeek Extractor работал с reasoning.

На реальном документе получали:

```text
finish_reason = length
content = ""
reasoning_tokens ≈ 4096
```

То есть весь лимит уходил в reasoning, а JSON-ответ не возвращался.

**Решение**

Для Extractor отключили thinking:

```javascript
thinking: {
  type: 'disabled'
}
```

Оставили:

```javascript
response_format: {
  type: 'json_object'
}

max_tokens: 4096
```

**Результат**

```text
finish_reason = stop
content = валидный JSON
reasoning = null
```

PASS.

---

### Усилили контракт evidence Extractor

Добавили правило:

> `quote` должен быть непрерывной дословной цитатой из одного semantic block.

Нельзя делать:

```text
кусок из начала блока + кусок из конца блока
```

как одну цитату.

Если факт подтверждается несколькими местами одного блока:

```text
evidence[0] → quote A
evidence[1] → quote B
```

с одинаковым `semantic_block_id`.

Также закрепили контракт статусов:

```text
found
→ review_reason_code = null
→ review_note = null

requires_review
→ review_reason_code != null
→ review_note != null
```

Если фактического значения поля нет, Extractor не должен создавать fake candidate только ради сообщения об отсутствии.

---

### Сделали детерминированную проверку evidence

После Extractor:

```text
Проверить и привязать evidence
```

Проверяется:

- существует ли `semantic_block_id`;
- существует ли соответствующий analysis unit;
- находится ли quote внутри исходного текста.

Для пробелов применяется только нормализация whitespace:

```text
несколько пробелов
переносы строк
табуляции
```

могут отличаться.

Но слова и содержимое изменять нельзя.

Также разрешили несколько разных quote из одного semantic block.

Точный повтор одного и того же evidence:

```text
semantic_block_id + quote
```

дедуплицируется.

---

### Реализовали независимый AI Validator

После deterministic evidence check:

```text
AI Validator v1
    ↓
Проверить ответ AI Validator
```

Validator оценивает уже не существование цитаты, а смысл:

```text
действительно ли evidence подтверждает candidate?
```

Результаты:

```text
confirmed
requires_review
rejected
```

Детерминированная нода затем проверяет контракт ответа Validator.

---

### Сохраняем facts документа в Postgres

После всех analysis units:

```text
Собрать факты документа
    ↓
Сохранить факты документа
```

Факты **не дедуплицируются между analysis units** на этом этапе.

Это намеренно.

Например два разных документа могут независимо подтвердить одно и то же значение, и Aggregator должен видеть оба источника.

После сохранения:

```text
documents.facts_count
```

обновляется.

---

### Завершение документа стало детерминированным

Нода:

```text
Завершить обработку документа
```

перед `completed` сверяет:

```text
ожидаемое units_total
vs
реально сохранённые units

ожидаемое facts_count
vs
реально сохранённые facts
```

Только если числа совпадают:

```text
processing → completed
```

Важно:

> `completed` означает технически завершённую обработку документа, а не то, что все извлечённые факты confirmed.

---

### Сделали проверку готовности закупки к агрегации

После завершения каждого документа выполняется:

```text
Проверить готовность к агрегации
```

Run переводится:

```text
processing → ready_for_aggregation
```

только если:

```text
documents_total > 0
registered_documents = documents_total
completed_documents = documents_total
```

Только один Worker получает:

```text
should_start_aggregation = true
```

**Результат**

На реальной закупке:

```text
3 registered
3 completed
→ ready_for_aggregation
```

PASS.

---

### Провели полный тест реальной закупки

Тестовая закупка:

```text
Барбер-кресло Waslshop А066В черное 1000х500х600мм
```

Run:

```text
f535a209-2f4b-4acd-94b7-99222cbaa6cf
```

Документы:

```text
1. Экспорт спецификаций_КС_1003968783.xlsx
2. Проект договора.pdf
3. Краткое описание КС 10273121.docx
```

Все 3 документа:

```text
completed
```

После первичного анализа в БД:

```text
facts_total = 21
confirmed = 15
requires_review = 2
rejected = 4
```

---

### Начали Aggregator закупки

Создан workflow:

```text
TENDER — Агрегация закупки
```

#### Атомарный claim run

Нода:

```text
Захватить run для агрегации
```

переводит:

```text
ready_for_aggregation → aggregating
```

Повторный запуск не захватывает уже агрегируемый run.

PASS.

---

### Загрузили все facts закупки

Нода:

```text
Загрузить факты закупки
```

загружает:

- `tender_meta`;
- документы;
- candidate facts;
- статистику.

В Semantic Aggregator передаются только:

```text
confirmed
requires_review
```

`rejected` сохраняются в статистике, но не участвуют как рабочие кандидаты.

---

### Сгруппировали facts по 27 полям

Нода:

```text
Сгруппировать факты по полям
```

всегда создаёт:

```text
27 items
```

по одному на каждый `field_key`.

На тестовой закупке:

```text
10 полей с candidates
17 полей без candidates
```

Всего кандидатов для агрегации:

```text
17
```

---

### Реализовали Semantic Aggregator — Round 1

Схема:

```text
поле + все candidate facts
    ↓
Подготовить запрос Semantic Aggregator
    ↓
AI Semantic Aggregator
    ↓
Проверить ответ Semantic Aggregator
```

Aggregator не извлекает новые факты.

Он определяет отношения:

```text
primary
duplicate
supporting
complement
conflict
not_applicable
```

Round 1 может вернуть:

```text
resolved
requires_recheck
```

---

### Добавили field-specific rules

На текущий момент вручную настроены правила для:

```text
procurement_subject
delivery_term
nm_price_with_vat
```

#### `procurement_subject`

Aggregator правильно выбрал конкретное:

```text
Барбер-кресло Waslshop А066В...
```

а общий текст:

```text
поставка товара
```

пометил как `not_applicable`.

PASS.

#### `delivery_term`

Aggregator различил:

```text
реальный срок поставки
```

и:

```text
общий срок исполнения договора
```

Итог:

```text
18.08.2026 → 24.08.2026
```

PASS.

#### `nm_price_with_vat`

Первый Aggregator **не стал автоматически считать сумму спецификации НМЦК**.

Получили:

```text
status = requires_recheck
confidence = 0.3
reason = insufficient_evidence
```

Это правильное поведение.

---

### Реализовали Targeted Recheck для спорного поля

На текущем этапе Targeted Recheck полностью протестирован на:

```text
nm_price_with_vat
```

Схема:

```text
Semantic Aggregator #1
    ↓
requires_recheck
    ↓
Подготовить Targeted Recheck Request
    ↓
Найти контекст для Targeted Recheck
    ↓
Подготовить компактный контекст
    ↓
Подготовить запрос AI Targeted Recheck
    ↓
AI Targeted Recheck
    ↓
Проверить evidence Targeted Recheck
    ↓
AI Validator Targeted Recheck
    ↓
Проверить ответ Validator Targeted Recheck
    ↓
Собрать кандидаты после Targeted Recheck
    ↓
Semantic Aggregator #2
    ↓
Проверить ответ #2 Semantic Aggregator
```

---

### Targeted Recheck ищет контекст в сохранённых analysis units

Для поля:

```text
nm_price_with_vat
```

Postgres retrieval нашёл:

- исходную PDF-спецификацию;
- раздел «Цена договора»;
- краткое описание DOCX;
- XLSX-спецификацию;
- нерелевантный фрагмент про штрафы.

Затем отдельная Code-нода компактно отобрала нужные semantic blocks.

Это важно:

> Recheck не запускает parser повторно. Он работает по уже сохранённым analysis units.

---

### Tender metadata стало отдельным типом evidence

Для Targeted Recheck добавили provenance двух типов.

#### Документ

```json
{
  "source_type": "semantic_block",
  "analysis_unit_id": "...",
  "semantic_block_id": "...",
  "quote": "..."
}
```

#### Metadata TenderPlan

```json
{
  "source_type": "tender_metadata",
  "metadata_key": "max_price",
  "value": 85000
}
```

Детерминированный validator проверяет оба типа отдельно.

---

### Targeted Recheck успешно разрешил НМЦК

До Recheck:

```text
85000 руб (в т.ч. НДС)
→ requires_review
→ confidence 0.7
```

Recheck нашёл:

```text
TenderMeta:
max_price = 85000

PDF:
[C9] Сумма, руб (в т.ч. НДС)
[C9] 85000.00
```

После Extractor:

```text
candidate_found
85000.00 руб (в т.ч. НДС)
confidence = 0.95
```

Evidence прошёл deterministic validation.

Независимый Validator подтвердил:

```text
verdict = confirmed
confidence = 0.95
```

---

### Реализовали Semantic Aggregator — Round 2

После Targeted Recheck старый и новый кандидаты объединяются.

Используется новый идентификатор:

```text
candidate_ref
```

Пример:

```text
fact:<uuid>
recheck:1:0
```

Это важно, потому что новый Recheck candidate ещё не является строкой из:

```text
tender_analysis_facts
```

Round 2 является **финальным**.

Допустимые статусы:

```text
resolved
requires_review
```

Повторный Targeted Recheck после Round 2 запрещён.

---

### Финальный результат НМЦК

Aggregator #2 получил:

```text
старый candidate
→ requires_review

новый Targeted Recheck candidate
→ confirmed
```

И правильно определил:

```text
старый → duplicate
новый → primary
```

Финальный результат:

```text
aggregation_status = resolved
final_value_text = 85000.00 руб (в т.ч. НДС)
confidence = 0.95
needs_recheck = false
aggregation_validated = true
```

То есть полный цикл:

```text
initial extraction
→ validation
→ aggregation
→ targeted recheck
→ validation
→ final aggregation
```

успешно прошёл на реальном поле.

---

### Обнаружили важный технический нюанс Round 2

При копировании второй ветки Validator сначала ссылался на старую ноду:

```text
Подготовить запрос Semantic Aggregator
```

вместо:

```text
Подготовить запрос #2 Semantic Aggregator
```

Из-за этого Validator ожидал 1 candidate, хотя Round 2 вернул 2.

После исправления ссылки:

```text
PASS
```

**Вывод**

При двух физических AI Aggregator-ветках нужно внимательно следить, к какой подготовительной ноде привязан deterministic validator.

Позже эту общую логику можно вынести в sub-workflow и убрать дублирование.

---

### Начали ветку полей без candidate facts

После:

```text
Сгруппировать факты по полям
```

есть:

```text
Есть кандидаты?
```

На тестовой закупке:

```text
TRUE  = 10 полей
FALSE = 17 полей
```

Приняли принцип:

> `candidates = []` после первичного анализа ещё НЕ означает `not_found`.

Правильная логика:

```text
0 candidates
    ↓
сначала проверить structured TenderMeta
    ↓
если metadata не закрывает поле
    ↓
Targeted Recheck
    ↓
только после него возможно not_found
```

---

### Добавили Metadata Resolver для полей без candidates

На FALSE-ветке создана Code-нода:

```text
Разрешить поле из TenderMeta
```

и затем IF:

```text
Поле закрыто из TenderMeta?
```

Текущая схема:

```text
Есть кандидаты?
    ↓ FALSE
Разрешить поле из TenderMeta
    ↓
Поле закрыто из TenderMeta?
    ├─ TRUE  → готовое поле
    └─ FALSE → будущий Targeted Recheck
```

---

### Metadata Resolver сейчас умеет закрывать 2 поля

#### `platform`

Источник:

```text
tender_meta.platform
```

На тестовой закупке:

```text
Портал поставщиков МО
https://zakupki.mos.ru/
```

Результат:

```text
metadata_resolved = true
aggregation_status = resolved
confidence = 1
resolution_method = deterministic_metadata
```

#### `application_deadline`

Источник:

```text
tender_meta.submission_close_at
```

Результат:

```text
2026-08-17T11:05:03.000Z
```

Также:

```text
metadata_resolved = true
aggregation_status = resolved
confidence = 1
```

После этих двух правил на тестовой закупке:

```text
TRUE  = 2 поля
FALSE = 15 полей
```

---

### Важное правило по TenderMeta

Нельзя интерпретировать:

```text
null
```

как:

```text
нет / не требуется / отсутствует
```

Например:

```text
guaranteeApp = null
guaranteeContract = null
guaranteeProv = null
prepayment = null
scoringDateTime = null
summingUpDateTime = null
biddingDateTime = null
```

пока означают только:

> в текущем payload нет значения.

Они НЕ доказывают юридическое отсутствие соответствующего требования.

Так же осторожно нужно относиться к пустым массивам.

Например:

```text
tenderInfo.bankGuarantees = []
```

не означает автоматически:

```text
bank_support = нет
```

---

### Приняли решение: сначала полностью разобрать TenderMeta по 27 полям

До продолжения ветки:

```text
0 candidates → Targeted Recheck
```

решили сначала провести аудит всего payload TenderPlan.

Цель:

```text
27 field_key
    ↓
для каждого определить:
    A. direct metadata
    B. partial / conditional metadata
    C. no reliable metadata
```

Это нужно, чтобы:

- не тратить LLM на факты, которые API уже дал структурированно;
- использовать metadata как дополнительное evidence там, где оно закрывает только часть поля;
- отправлять в Targeted Recheck только действительно необходимые поля.

**Важно**

Эта классификация и дополнительные mapping rules **ещё не реализованы**.

На момент завершения работы 18.08.2026 Metadata Resolver содержит только:

```text
platform
application_deadline
```

---

# Актуальный статус пунктов, которые были «следующим этапом» 15.08

## Уже сделано

- [x] Compact provenance перед AI.
- [x] Первый AI Extractor.
- [x] Детерминированная проверка evidence.
- [x] Независимый AI Validator.
- [x] Сохранение analysis units в Postgres.
- [x] Сохранение candidate facts в Postgres.
- [x] Aggregation по всем документам.
- [x] Semantic Aggregator Round 1.
- [x] Targeted Recheck MVP.
- [x] Semantic Aggregator Round 2.
- [x] Полный Recheck-cycle протестирован на `nm_price_with_vat`.
- [x] Metadata Resolver MVP для полей без candidates.
- [x] Direct metadata mapping для `platform`.
- [x] Direct metadata mapping для `application_deadline`.

## Ещё не сделано

- [ ] Полный mapping TenderMeta → 27 полей.
- [ ] Разделение metadata status на `resolved / partial / unavailable`.
- [ ] Targeted Recheck для полей с `candidates = []`.
- [ ] Финальный `not_found` после полного recheck.
- [ ] Сохранение финальных результатов 27 полей в отдельную структуру / таблицу.
- [ ] Cross-document deterministic checks.
- [ ] Сравнение с документами компании.
- [ ] Формирование финального отчёта.
- [ ] Удаление временных test IF-нод.
- [ ] Параллельный запуск Document Workers вместо текущего dev-режима с ожиданием sub-workflow.
- [ ] Pre-convert `.doc → .docx`.
- [ ] OCR fallback для плохих сканов.
- [ ] Timeout / max attempts / backoff для Docling polling.
- [ ] Безопасное хранение proxy credentials.
- [ ] Очень большие таблицы.
- [ ] Multi-sheet XLSX regression test.
- [ ] Arithmetic checks XLSX.
- [ ] Хранение raw parser result / исходных файлов вне execution n8n.

---

# Текущая архитектура на конец 18.08.2026

```text
TenderPlan
    ↓
Normalize tender + tender_meta
    ↓
Create analysis_run
    ↓
Register ALL documents in Postgres
    ↓
Document Workers
    ↓
Download direct / RU proxy
    ↓
Docling
    ↓
Universal Normalizer
    ↓
Подготовить блоки к анализу
    ↓
Собрать смысловые разделы v1.4
    ↓
Подготовить части для анализа v1.3
    ↓
Развернуть части для AI v1.2
    ↓
Save analysis units
    ↓
AI Extractor
    ↓
Deterministic evidence validator
    ↓
AI Validator
    ↓
Deterministic validator-response check
    ↓
Save facts
    ↓
Document completed
    ↓
All documents completed?
    ↓
Run ready_for_aggregation
    ↓
Group facts by 27 fields
    ↓
┌───────────────────────────────────────────────┐
│ Есть candidates?                              │
├───────────────────────┬───────────────────────┤
│ YES                   │ NO                    │
│                       │                       │
│ Semantic Aggregator   │ Metadata Resolver     │
│ Round 1               │                       │
│       ↓               │ resolved?             │
│ resolved?             │   ├─ YES → готово    │
│   ├─ YES → готово     │   └─ NO → [NEXT]     │
│   └─ NO               │                       │
│       ↓               │                       │
│ Targeted Recheck      │                       │
│       ↓               │                       │
│ Validator             │                       │
│       ↓               │                       │
│ Semantic Aggregator   │                       │
│ Round 2               │                       │
└───────────────────────┴───────────────────────┘
    ↓
[Следующие этапы]
финальные 27 полей
    ↓
cross-document / company checks
    ↓
итоговый отчёт
```

---

# Точка продолжения на следующий день

Работа остановлена перед следующим этапом:

## 1. Разложить полный TenderPlan/TenderMeta по всем 27 `field_key`

Для каждого поля определить:

```text
direct metadata
partial / conditional metadata
no reliable metadata
```

## 2. Расширить `Разрешить поле из TenderMeta`

Сейчас реализованы только:

```text
platform
application_deadline
```

Не считать предыдущие предложения по:

```text
procurement_subject
customer
delivery_term
nm_price_with_vat partial
```

уже реализованными — они только обсуждались.

## 3. После полного metadata audit

Продолжить FALSE-ветку:

```text
Поле закрыто из TenderMeta?
    ↓ FALSE
Targeted Recheck для candidates=[]
    ↓
found / requires_review / not_found
```

Главный принцип остаётся тем же:

> **Structured metadata используется раньше AI.  
> `null` не трактуется как отрицательный факт.  
> `not_found` возможен только после полного анализа документов и Targeted Recheck.**


---

## 19.08.2026

### Перешли от «частично готового поля» к единому FINAL-контракту

После развития Aggregator и Targeted Recheck стало понятно, что всем terminal-веткам нужен один и тот же выходной контракт независимо от способа получения результата.

Зафиксирован канонический контракт:

```text
result_contract_version = tender_field_final_v1
```

Допустимые статусы:

```text
resolved
requires_review
not_found
```

Основные поля:

```text
analysis_run_id
field_catalog_version
field_index
field_key
status
value_text
confidence
requires_human_review
resolution_method
evidence
review
not_found
audit
```

**Ключевой принцип**

`not_found` теперь имеет строгое значение:

> значение не удалось надёжно установить по предоставленным источникам после полного анализа и Targeted Recheck.

`not_found` НЕ означает:

```text
нет
не требуется
не предусмотрено
```

Это закрепило границу между:

```text
отрицательным фактом
```

и:

```text
отсутствием достаточного evidence
```

---

### Создали таблицу финальных результатов полей

Добавлена:

```text
tender_analysis_field_results
```

Одна строка = один FINAL результат одного `field_key` внутри одного `analysis_run`.

Основные ограничения:

```text
PRIMARY KEY (analysis_run_id, field_key)
UNIQUE (analysis_run_id, field_index)
field_index BETWEEN 1 AND 27
status IN ('resolved','not_found','requires_review')
confidence BETWEEN 0 AND 1
```

Сохранение сделано через идемпотентный UPSERT:

```text
INSERT
ON CONFLICT (analysis_run_id, field_key)
DO UPDATE
```

Полный FINAL сохраняется в:

```text
result_json JSONB
```

**Зачем**

Это стало persistent synchronization layer для будущего:

```text
27 / 27 FINAL fields
→ run completed
→ report
```

---

### Targeted Recheck стал полноценным side-effect sub-workflow

Зафиксирован workflow:

```text
TENDER - Targeted Recheck
```

Он вызывается из Aggregator в двух случаях.

#### 1. `aggregation_recheck`

После Round 1:

```text
candidates есть
→ Semantic Aggregator
→ needs_recheck = true
```

#### 2. `no_initial_candidates`

После ветки:

```text
candidates = []
→ TenderMeta Resolver
→ metadata_resolved = false
```

Targeted Recheck теперь сам отвечает за полный цикл поля:

```text
targeted retrieval
→ AI Recheck Extractor
→ deterministic evidence validation
→ independent AI Validator
→ deterministic Validator response check
→ direct final / Round 2 / not_found / requires_review
→ normalize tender_field_final_v1
→ UPSERT field result
```

Parent Aggregator не финализирует его результат повторно.

---

### Расширили Targeted Recheck profiles на все 27 полей

В `Подготовить #2 Targeted Recheck Request` добавлены `RECHECK_PROFILES` для всех:

```text
27 field_key
```

Каждый профиль содержит:

```text
title
objective
search_terms
metadata_keys
rules
```

Это позволило сделать targeted retrieval field-specific, а не универсальным поиском по одним и тем же словам.

---

### Зафиксировали три корректных сценария `not_found`

После Recheck допускаются только понятные причины:

```text
no_relevant_context_after_targeted_retrieval

insufficient_evidence_after_targeted_recheck

all_recheck_candidates_rejected
```

Это важно, потому что `not_found` теперь является результатом **полного пути проверки**, а не отсутствия candidate на раннем этапе.

---

## 20.08.2026

### Довели Targeted Recheck до двухступенчатой финализации

После нового Recheck candidate добавлен отдельный Validator.

Схема:

```text
Targeted Recheck Extractor
→ deterministic evidence validation
→ AI Validator
→ deterministic Validator response validation
```

Если найден единственный новый confirmed candidate и старых candidates не было:

```text
direct_final
```

Если нужно сравнить:

```text
existing candidates
+
new usable recheck candidates
```

используется:

```text
Semantic Aggregator Round 2
```

---

### В Round 2 ввели `candidate_ref`

Старый candidate:

```text
fact:<fact_id>
```

Новый Recheck candidate:

```text
recheck:<attempt>:<candidate_index>
```

Это решило проблему, что новый Recheck candidate ещё не существует как строка в:

```text
tender_analysis_facts
```

Round 2 теперь может одинаково ссылаться и на старые, и на новые candidates.

---

### Round 2 стал terminal

После Round 2 повторный Recheck запрещён.

Допустимые статусы:

```text
resolved
requires_review
```

То есть схема стала:

```text
Round 1
→ Recheck
→ Round 2
→ FINAL
```

а не бесконечным циклом.

---

### Протестировали несколько Recheck-сценариев

Проверены:

```text
no initial + no context
→ not_found

no initial + context + insufficient evidence
→ not_found

no initial + candidate + all rejected
→ not_found

existing candidate + recheck insufficient
→ requires_review

one new confirmed + no old
→ direct_final

existing + new usable
→ Round 2

Round 2 resolved
→ FINAL resolved

Round 2 requires_review
→ FINAL requires_review
```

Также выявлены незакрытые сценарии:

```text
TR-0:
existing candidate + no context

TR-1:
existing candidate + all new rejected

TR-2:
Round 2 FIELD_RULES пока не покрывают все 27 полей
```

---

### Проверили поле `warranty_obligations_guarantee`

Получен реальный успешный сценарий:

```text
field_key = warranty_obligations_guarantee
```

Targeted Recheck нашёл evidence в semantic block и сформировал:

```text
resolved
final_value_text = "Гарантийные обязательства поставщика"
confidence = 0.8
```

Это подтвердило, что Recheck работает не только для НМЦК, но и для другого semantic field.

---

### Metadata Resolver расширен

Помимо ранее реализованных:

```text
platform
application_deadline
```

добавлены deterministic mappings:

```text
procurement_subject
→ tender_meta.title

customer
→ tender_meta.primary_customer.name
```

Таким образом текущий Metadata Resolver умеет закрывать 4 поля:

```text
procurement_subject
platform
application_deadline
customer
```

При этом правило осталось прежним:

```text
metadata missing
≠
negative fact
```

---

## 21.08.2026

### Полный Aggregator теперь создаёт и сохраняет все 27 FINAL-пути

На полном integration run Aggregator сформировал:

```text
ровно 27 field items
```

с индексами:

```text
1..27
```

без пропусков и дублей.

FINAL результаты пришли из нескольких независимых branch executions:

```text
9 + 1 + 2 + 1 + 14 = 27
```

Это подтвердило, что все 27 field paths реально достигают terminal persistence.

---

### Обнаружили важное поведение n8n при объединении веток

Несколько conditional branches, подключённых к одной Code Node, не означают:

```text
один запуск Code Node со всеми входами
```

На практике Code Node выполняется отдельно для каждой пришедшей ветки.

Поэтому:

```javascript
$input.all()
```

не собирает автоматически все 27 результатов из разных branch executions.

**Вывод**

Для синхронизации 27 полей нельзя полагаться на обычное in-memory объединение веток.

Решение должно быть DB-backed:

```text
каждый FINAL
→ UPSERT PostgreSQL
→ проверить count
```

Это закрепило роль PostgreSQL как synchronization layer системы.

---

### Зафиксировали главный незавершённый gap Aggregator

Aggregator в начале делает:

```text
ready_for_aggregation
→ aggregating
```

Но после сохранения field results пока нет:

```text
27 / 27?
→ aggregating → completed
```

Из-за этого run может остаться:

```text
aggregating
```

даже если все 27 FINAL уже существуют.

Проблема получила ID:

```text
AG-0
```

Целевая схема:

```text
ANY FINAL UPSERT
→ COUNT(unique final fields)
→ 27?
→ atomic completion claim
→ run completed
→ report
```

---

### Провели полный аудит Aggregator

Зафиксирована фактическая архитектура:

```text
atomic run claim
→ load run/documents/facts
→ exactly 27 field items
→ has_candidates?
```

#### TRUE

```text
Round 1 Semantic Aggregator
→ resolved
или
Targeted Recheck
```

#### FALSE

```text
TenderMeta Resolver
→ resolved
или
Targeted Recheck
```

Round 1 `FIELD_RULES` на текущем этапе уже покрывают:

```text
все 27 полей
```

---

### Зафиксировали текущее состояние Round 2

В отличие от Round 1, Round 2 field-specific rules пока есть только для:

```text
procurement_subject
nm_price_with_vat
delivery_term
warranty_obligations_guarantee
```

Это стало критичным техдолгом:

```text
TR-2
```

---

## 22.08.2026

### Провели архитектурный аудит Document Worker

Восстановили полный workflow:

```text
input
→ atomic claim
→ download
→ Docling
→ universal normalization
→ semantic sections
→ analysis units
→ save units
→ AI Extractor
→ deterministic evidence validation
→ independent AI Validator
→ deterministic Validator response validation
→ collect facts
→ save facts
→ document completion
→ run readiness
→ Aggregator
```

Подтверждено:

```text
1 Worker execution = 1 document
```

и:

```text
all documents are registered before first Worker
```

---

### Нашли critical silent-error path

Нода:

```text
Проверить и привязать evidence
```

имеет:

```text
onError = continueErrorOutput
```

но Error output никуда не подключён.

Это означает потенциальный сценарий:

```text
document = processing
→ evidence validation error
→ error item уходит в пустой output
→ workflow может не считаться failed
→ Error Workflow не запускается
→ document навсегда processing
```

Проблема:

```text
DW-14 / EW-3
```

---

### Нашли реальный semantic false positive

На реальном execution Extractor создал:

```text
customer = "не указан"
```

с evidence:

```text
адрес поставки
```

Independent AI Validator ошибочно подтвердил candidate:

```text
verdict = confirmed
confidence = 0.95
```

Несмотря на прямое правило:

```text
absence of information
≠
negative fact
```

**Главный вывод**

Два LLM-прохода сами по себе не гарантируют semantic correctness.

Нужны deterministic guards для известных классов ошибок.

Проблема:

```text
DW-15
```

---

### Нашли retry-риск со stale analysis units

Facts при retry очищаются корректно:

```text
delete stale facts
```

Но `analysis_units` пока только UPSERT-ятся.

Если первая попытка дала:

```text
3 units
```

а новая:

```text
2 units
```

старая третья unit может остаться.

Тогда document completion увидит:

```text
units_total = 2
stored_units_count = 3
```

и не позволит:

```text
processing → completed
```

Проблема:

```text
DW-8
```

---

### Зафиксировали незакрытый Docling failure path

Polling знает:

```text
pending
processing
success
```

но terminal failure status не имеет явной ветки.

Также нет:

```text
max poll attempts
absolute deadline
```

Проблемы:

```text
DW-3
DW-4
```

---

### Полностью разобрали Error Workflow

Workflow:

```text
TENDER — Ошибка обработки документа
```

реально работает так:

```text
Error Trigger
→ execution.id
→ найти document по n8n_execution_id
→ processing → failed
→ сохранить error_message
```

Реальный pin execution подтвердил correlation.

При этом выявлены gaps:

```text
EW-0:
failed document не завершает lifecycle run

EW-1:
UPDATE 0 rows не считается ошибкой

EW-2:
ошибка до claim не может найти document

EW-3:
continueErrorOutput может обойти Error Workflow
```

---

### Провели аудит Orchestrator

Подтверждён текущий путь:

```text
Manual Trigger
→ tender_id
→ TenderPlan FullInfo
→ normalize
→ create run
→ register ALL documents
→ Split Out
→ temporary extension filter
→ Document Worker
```

Найден critical edge case:

```text
unsupported file
→ document уже зарегистрирован pending
→ filter не запускает Worker
→ document остаётся pending
→ run не станет ready_for_aggregation
```

Проблема:

```text
OR-0
```

---

### Зафиксировали semantic source of truth по 27 полям

Создан отдельный каталог:

```text
FIELD_CATALOG.md
```

Он фиксирует:

```text
field_index
field_key
business meaning
что считать evidence
что не считать evidence
expected result type
TenderMeta mapping
Round 1 coverage
Recheck coverage
Round 2 coverage
business clarification status
```

Поля, требующие отдельного подтверждения бизнес-смысла:

```text
results_date
participation_guarantee
delivery_term
payment_terms
special_account_or_treasury
advance_contract_guarantee
warranty_obligations_guarantee
licenses_certificates
required_official_certificates
```

До уточнения:

```text
field_key не менять
27 fields не менять
architecture не менять
```

---

### Полностью зафиксировали Data Model

Документированы таблицы:

```text
tender_analysis_runs
tender_analysis_documents
tender_analysis_units
tender_analysis_facts
tender_analysis_field_results
```

и реальные:

```text
PK
FK
UNIQUE
CHECK
indexes
```

Обнаружено:

```text
DM-0:
tender_analysis_field_results.analysis_run_id
не имеет физического FK на runs.id
```

Также найден дублирующий unique index по:

```text
(analysis_run_id, field_key)
```

---

### Создали комплект архитектурной документации

На текущий момент подготовлены:

```text
ARCHITECTURE.md
FIELD_CATALOG.md
DATA_MODEL.md
TECH_DEBT.md

workflows/orchestrator.md
workflows/document-worker.md
workflows/aggregator.md
workflows/targeted-recheck.md
workflows/error-workflow.md
```

Цель документации:

> новый чат или разработчик должен восстановить состояние проекта без повторного разбора всей истории переписки.

---

# Актуальное состояние проекта на 22.08.2026

## Уже работает

```text
TenderPlan FullInfo
→ normalize tender
→ create analysis_run
→ register all documents
→ one Worker per document
→ atomic document claim
→ RU proxy download
→ Docling
→ universal normalizer
→ semantic sections
→ analysis units
→ persisted units
→ Extractor
→ deterministic evidence validation
→ independent AI Validator
→ persisted facts
→ deterministic document completion
→ run readiness
→ Aggregator
→ exactly 27 field items
→ Round 1
→ TenderMeta Resolver
→ Targeted Recheck
→ Round 2
→ tender_field_final_v1
→ UPSERT final field results
```

---

## Ещё не завершено

### Critical correctness

```text
TR-0
TR-1
TR-2
TR-3

DW-14
DW-15
DW-8
DW-3

OR-0
```

### Final synchronization

```text
AG-0
27 / 27
→ run completed
```

### Report

```text
load ordered 27 FINAL fields
→ Markdown
→ XLSX
→ Telegram
```

---

# Текущий приоритет разработки

После завершения документации:

```text
1. TR-0
2. TR-1
3. TR-2
4. TR-3

5. DW-14 / EW-3
6. DW-3
7. DW-15
8. DW-8

9. OR-0

10. AG-0
11. 27/27 completion
12. Markdown
13. XLSX
14. Telegram
```

---

# Главный архитектурный принцип к 22.08.2026

Система окончательно строится не как:

```text
один большой prompt
→ один большой ответ
```

а как контролируемая цепочка:

```text
source document
→ normalized structure
→ semantic block
→ analysis unit
→ candidate fact
→ grounded evidence
→ independent validation
→ cross-document field aggregation
→ targeted recheck
→ FINAL field
→ persistent DB synchronization
→ report
```

Главный следующий шаг проекта — уже не новый AI-слой.

Это:

```text
закрыть critical correctness gaps
→ 27/27 DB barrier
→ completed
→ report
```


# 22.08.2026 — Targeted Recheck Round 2 stabilization

## Закрытые задачи

### TR-0 — existing candidate + no context

Исправлено поведение сценария:

- существующий candidate есть;
- Targeted Recheck не нашёл новый релевантный контекст.

Ранее риск:
- неправильный переход в not_found.

Новое поведение:

- сохраняется existing candidate;
- поле завершается через requires_review;
- сохраняется evidence и audit.

---

### TR-1 — existing candidates + recheck candidates

Проверен полный сценарий:

Round 1:

requires_recheck


↓

Targeted Recheck:


new candidate / supporting evidence


↓

Validator #2

↓

Semantic Aggregator Round 2

↓

FINAL

Проверено:
- candidate_ref;
- объединение candidates;
- сохранение evidence;
- корректный переход resolved/requires_review.

---

### TR-3 — child workflow references

Исправлена проблема переноса workflow.

Причина:
дочерний workflow содержал ссылки на nodes из parent workflow.

Решение:
- убраны внешние node references;
- данные передаются через входной JSON;
- workflow стал автономным.

---

## Тестовый кейс

Field:


nm_price_with_vat


Сценарий:

Round 1:


requires_recheck
confidence=0.4


Причина:

Найдена сумма 85000 с НДС, но отсутствовало подтверждение связи с НМЦК.

Targeted Recheck:

Добавлены:

- tender_metadata.max_price = 85000;
- semantic block с суммой 85000.

Round 2 Aggregator:

Результат:


status:
resolved

confidence:
0.9

resolution_method:
semantic_aggregator_round_2


Финальный результат успешно сохранён в:


tender_analysis_field_results


через:


ON CONFLICT (analysis_run_id, field_key)
DO UPDATE


---

## Следующий этап

После стабилизации Targeted Recheck:

1. Закрыть TR-2:
   - определить стратегию расширения Round 2 на остальные поля.

2. Перейти к AG-0:
   - проверка полноты 27/27 fields;
   - формирование итогового отчёта.



## Выполнен полный прогон закупки через Aggregator

Проверена цепочка:

```text
tender_analysis_facts
        ↓
Group facts by field_key
        ↓
Semantic Aggregator Round 1
        ↓
Validator
        ↓
tender_analysis_field_results



## 2026-08-23 — Documentation reconciliation with current workflow exports

### Completed

Синхронизирована проектная документация с актуальными n8n workflow exports.

Проверены и обновлены:

- `workflows/orchestrator.md`
- `workflows/document-worker.md`
- `workflows/error-workflow.md`
- `workflows/aggregator.md`
- `workflows/targeted-recheck.md`
- `README.md`
- `ARCHITECTURE.md`
- `TECH_DEBT.md`

### Fixed discrepancies

- Orchestrator:
  - разделены productive path и полный physical inventory workflow;
  - уточнено наличие legacy/unreachable nodes.

- Document Worker:
  - исправлена модель AI Extractor:
    - было: `deepseek-v4-flash`
    - стало: `deepseek-v4-pro`.

- Document Worker / Error Workflow:
  - исправлено описание error handling;
  - убрано неподтверждённое утверждение про `continueErrorOutput`;
  - runtime validation оставлена как отдельная задача.

- Aggregator:
  - исправлено описание atomic claim;
  - зафиксировано различие между intended architecture и текущей production topology;
  - atomic claim обозначен как prerequisite для дальнейшего развития.

- Targeted Recheck:
  - уточнена topology workflow;
  - исправлены metadata retrieval assumptions;
  - уточнён фактический guard для recheck routing;
  - исправлены имена routing nodes;
  - обновлён статус Round 2.

### Current state

Документация теперь соответствует фактической структуре workflow exports.

Следующий архитектурный этап:
анализ вариантов реализации DB-backed 27/27 FINAL field completion barrier.

---

## 23.08.2026 — Polza AI migration and full E2E verification

### AI provider

AI transport в актуальных Extractor, Validator, Semantic Aggregator и Targeted Recheck переведён с DeepSeek API на Polza AI:

```text
https://polza.ai/api/v1/chat/completions
```

Используется модель:

```text
deepseek/deepseek-v4-pro-0813
```

Параметр `reasoning_effort` задаётся через alias модели:

```text
@reasoning_effort=none  — Extractor
@reasoning_effort=low   — Validator / Semantic Aggregator
```

### Full end-to-end test

Read-only audit execution от 23.08.2026, запуск около 20:13 MSK:

```text
Orchestrator: 13852
Document Workers: 13853, 13854, 13855
Aggregator: 13856
Targeted Recheck: 13857, 13862
Finalization: 13858–13863
Report stub: 13864
```

Результат PostgreSQL для `analysis_run_id=f9d8e1d7-f01a-4d91-8eac-89c8376535c2`:

```text
3 documents
18 analysis units
38 facts: 20 confirmed, 10 requires_review, 8 rejected
27 FINAL rows: 11 resolved, 3 requires_review, 13 not_found
barrier_ready = true
completion_claimed = true
run.status = completed
```

Report workflow был вызван успешно, но остаётся stub: реальные Markdown/XLSX/Telegram outputs ещё не формируются.

---

## 2026-08-24 — Report Generation V2 завершён

### Реализованная цепочка

```text
Report Snapshot
→ Snapshot validation
→ Adapter
→ Report Model
→ Model validation
→ HTML Renderer
→ HTML artifact
```

- `canonical analysis_result` сохраняется без изменений как internal audit data.
- Source resolution выполняется только в Adapter.
- Renderer читает validated Report Model, не обращается к PostgreSQL и не интерпретирует `result_json`.
- Формируется скачиваемый UTF-8 HTML artifact.

### Reference regression

```text
analysis_run_id = f9d8e1d7-f01a-4d91-8eac-89c8376535c2
total = 27
resolved = 11
requires_review = 3
not_found = 13
attention = [2, 17, 21]
sources = 29
internal data leaks = 0
HTML escaping test = passed
```

### Ограничения и следующий этап

PDF, DOCX и delivery пока не реализованы.

Следующий крупный этап — calibration на новой закупке клиента с большим пакетом документов.

---

## 2026-08-28 — Document Worker hardening и Aggregator RED checkpoint

### Document Worker test candidate

В изолированном workflow `[3 TEST] TENDER — Обработать документ` реализованы:

- bounded Evidence Repair;
- lossless Fact Partition для pure resource overflow;
- deterministic audited rejection pure exact-grounded `overlap_only`;
- document-level Validator dispatch без per-unit loop и без Merge;
- `units_for_ai` / `units_without_ai` с exact unit-set convergence;
- `validator_field_profiles_v1` для ровно 27 canonical `field_key`;
- Gemini 3.7 Flash в тестовом AI Validator;
- fact-local material literal guard `fact_local_material_literals_v1`.

Exact evidence grounding сохранён. Fuzzy matching, OCR auto-correction и automatic rebind не добавлялись.

### Execution 14104

Runtime canary подтвердил:

```text
66 units
65 pass attempt 1
1 bounded Evidence Repair
20 units_for_ai + 46 units_without_ai = 66
61 persisted facts
41 confirmed / 2 requires_review / 18 rejected
```

Literal guard понизил ровно один verdict:

```text
advance_contract_guarantee
confirmed → requires_review
missing fact-local literal = 30%
```

Один pure overlap-only fact сохранён как audited `rejected` без silent drop.

Execution не доказал новый Aggregator result: run уже был terminal, readiness вернул `run_not_claimed`, поэтому новый fact snapshot не агрегировался.

### Document Worker promotion boundary

Локальный export по пути `workflows/n8n-exports/TENDER — Обработать документ.json` сейчас является `[3 TEST]` workflow и не готов для production import:

- canonical persistence path не подключён к completeness barrier;
- присутствуют calibration persistence nodes;
- присутствуют Manual Trigger и `pinData`.

Эти два promotion gates оставлены явными падающими tests, а не скрыты.

### Aggregator execution-derived RED

Для execution `14104` создан regression fixture поля `procurement_subject` и neutral anti-overfit controls.

Доказана текущая trust-boundary vulnerability:

```text
internal/auxiliary process selected as primary
→ structural checker passes
→ Round 1 FINAL materializes
→ schema-valid false_resolved
```

Runtime harness стал route-aware:

- `round1_final` требует FINAL и запускает semantic oracle;
- `targeted_recheck` требует `final=null`, не запускает resolved-only oracle и возвращает inconclusive exit `3`;
- несогласованные route/status combinations дают explicit contract error.

Aggregator workflow не изменялся. Оставлен один actionable RED: отсутствует universal current-procurement scope boundary для `procurement_subject`. Backlog ID: `AG-8`.

### Offline suite

Fresh result:

```text
127 tests
124 passed
3 failed
```

Открытые RED gates:

1. `AG-8` prompt boundary;
2. Document Worker canonical persistence connection;
3. clean production import candidate без test/calibration state.

### Source-of-truth drift

Создан `PROJECT_STATUS.md`.

Read-only n8n API выявил и разрешил расхождение draft/published:

- production Aggregator current draft: 24 nodes/version `89b33d04-…`;
- published active version: 38 nodes/version `c4bbee79-…`;
- local Aggregator export содержит те же 38 node names и connections, что active version;
- известное отличие local/live parameters ограничено model alias ноды `Semantic Aggregator` (`@provider=deepseek` в live).

24-нoded draft не опубликован и не определяет production executions. Published version остаётся authoritative production state.

Production workflows, protected workflows и PostgreSQL в рамках checkpoint не изменялись.

---

## 2026-08-29 — AG-8 test GREEN и runtime canary checkpoint

### Test-only implementation

В изолированном workflow `[TEST CODEX] TENDER — Агрегация закупки` (`ftvmrEHoMbPOAqZG`) усилены только universal `procurement_subject FIELD_RULES`:

```text
current procurement / contract scope required
specific wording alone does not prove applicability
internal / auxiliary / separate-agreement objects are not_applicable
ambiguous scope → requires_recheck
```

Topology, SQL, response checker, FINAL builder, Targeted Recheck и production Aggregator не менялись.

Beta export:

```text
workflows/n8n-exports/beta/[TEST CODEX] TENDER — Агрегация закупки.json
SHA-256 = 95a04f8f7c054fda00b55abed0338cc66ba6c3c90d52e10698265b03d05bdb0c
```

Offline beta contract и MCP read-back прошли GREEN. MCP version comparison подтвердил изменение только ноды `Подготовить запрос Semantic Aggregator`; workflow остался inactive/unpublished.

### Paid runtime canary — execution-derived fixture 14104

Выполнен один ограниченный AI-вызов через beta runtime harness:

```text
request model = deepseek/deepseek-v4-pro-0813@provider=deepseek&reasoning_effort=low
response model = deepseek/deepseek-v4-pro-0813
ai_called = true
checker_accepted = true
route = round1_final
final_status = resolved
semantic_oracle_passed = true
exit code = 0
```

Semantic result:

```text
doc_7_au_0031 role = not_applicable
primary = 14104000-0001-4000-8000-000000000001
fixture mapping = doc_7_au_0001
final_value_text = Стандартные закрытия палуб для ледокола-лидера пр.10510 зав № 056001
oracle checks = 6/6 passed
```

Первый transient TLS `ECONNRESET` классифицирован как transport incident, не semantic failure. Неблокирующий follow-up: необработанный network exception runtime harness возвращает exit `1`, который может быть ошибочно воспринят как semantic oracle failure; позже нужно развести transport и semantic exit semantics без redesign Aggregator.

### Production boundary и следующий milestone

AG-8 имеет статус **mitigated / verified in test**, но остаётся открытым:

- production Aggregator и canonical production export не изменялись;
- production promotion остаётся отдельным gate;
- fresh full 27/27 run после hardening ещё не выполнен.

Следующий milestone:

```text
clean Document Worker production import candidate
→ test workflow promotion / wiring
→ fresh full run
→ manual semantic review 27/27
→ client report
```

Fresh offline baseline checkpoint:

```text
139 total
136 passed
3 intentional gate failures
```

---

## 2026-08-29 — Document Worker offline production candidate packaging

Работа выполнена только локально. MCP, live n8n, PostgreSQL и AI не вызывались.

### Immutable beta snapshot

Точный test/calibration workflow сохранён без изменений:

```text
workflows/n8n-exports/beta/[3 TEST] TENDER — Обработать документ.json
nodes = 60
SHA-256 = 02e4e5ccc761ecf78771c2ae4a3c4e529f3536533de2d9e7a5ef2084fe0459dd
```

### Clean canonical candidate

Canonical JSON упакован как offline production import candidate:

```text
workflows/n8n-exports/TENDER — Обработать документ.json
name = TENDER — Обработать документ
nodes = 51
active = false
settings.availableInMCP = false
pinData = {}
```

Удалены только top-level `id`, `versionId` и `meta`. Node IDs, Wait `webhookId`, credentials, parameters, positions, connections, settings и `nodeGroups` не изменялись на этом packaging-шаге.

Beta→canonical regression фиксирует:

- удаление ровно девяти test/calibration nodes;
- идентичность shared node parameters, credentials, types, type versions и runtime settings;
- удаление Manual Trigger edge;
- добавление только production trigger edge и canonical persistence edge;
- отсутствие instance identity и test state в candidate.

### Offline verification

```text
Document Worker: 78/78 PASS
Validator: 31/31 PASS
full suite: 139 total / 138 PASS / 1 intentional AG-8 production-promotion RED
git diff --check: PASS
```

### Remaining boundary

Live production Worker `1Pw61ZY3HgBSvcUr` не изменён. Candidate ещё не promoted/wired, runtime canary candidate не выполнялся. `DATA_MODEL.md` и `FIELD_CATALOG.md` не менялись.

Следующий шаг:

```text
test workflow promotion / wiring clean Document Worker candidate
→ runtime canary
→ fresh full run
→ manual semantic review 27/27
→ client report
```

---

## 2026-08-29 — Extractor model benchmark checkpoint

На одинаковых 16 pinned analysis units документа `Блок_9_Требования.docx` завершён сравнительный Extractor A/B.

Проверены:

```text
GLM 5.3 Flash low/high
GLM 5.2 low/without reasoning
Gemini 3.7 Flash low
GPT-5.6 Luna Pro low
GPT-5.4 Nano low
GPT-5 Mini low
DeepSeek V4 Flash 0731
```

Итог:

```text
current provisional Extractor baseline:
z-ai/glm-5.3-flash@provider=cloudflare&reasoning_effort=low

fallback:
google/gemini-3.7-flash low

model search on current fixture:
stopped
```

GLM 5.3 Flash low выбран по совокупности schema reliability, semantic precision и observed cost. Он не объявлен окончательно production-verified: full Evidence Repair → Validator → persistence canary ещё не выполнен.

Созданы evidence-backed evaluation artifacts в `evaluations/`, включая сводный `EXTRACTOR_MODEL_COMPARISON_2026-08-29.md`.

Test workflow `2T7szFpiGcfNpKkB` синхронизирован через MCP с выбранным A/B baseline:

```text
node: AI Extractor v1.0
model alias: z-ai/glm-5.3-flash@provider=cloudflare&reasoning_effort=low
version: 2f3e1ea6-2fda-4c0f-81ec-7ff514efdafc
active: false
published: false
```

Read-back подтвердил, что изменена только Extractor-нода. Node count `60`, connections, settings, pin data и credentials остались без изменений. Все возвращённые `DISCONNECTED_NODE` warnings были pre-existing test/calibration warnings.

Production Worker, Aggregator, Targeted Recheck, Finalization, Report Generation и PostgreSQL этим checkpoint не изменялись.

Следующий фокус:

```text
Aggregator AG-8 production-candidate audit / promotion decision
→ отдельное согласование protected workflow change
→ full Document Worker runtime canary
→ fresh 27/27 run
```

---

## 2026-08-29 — Aggregator `application_documents` safe-deferral checkpoint

Execution `14173` использован как execution-derived regression для поля `application_documents`. Recorded schema-valid Round 1 response проходит production checker и материализует `resolved`, но отдельный semantic oracle фиксирует false-resolved: неоднозначный scope, потерянные существенные условия, расплывчатые сроки и неподтверждённые clauses.

В beta `[TEST CODEX] TENDER — Агрегация закупки` изменён только field-specific профиль `application_documents`. Добавлены neutral anti-overfit controls, общий route-aware oracle и beta-only runtime evaluator. Production Aggregator, checker, topology, SQL, Targeted Recheck и PostgreSQL не менялись.

Первый paid canary с `max_tokens=8192` завершился `finish_reason=length`; false-resolved не был создан. После локальной синхронизации beta limit с test draft (`16384`) повторный paid canary exact artifact вернул:

```text
workflow_id = ftvmrEHoMbPOAqZG
workflow_sha256 = dc214110d3086d9e147f0b2c7fe983ee0e93543ca31f7d82c2c52ef3a1f04484
ai_called = true
checker_accepted = true
route = targeted_recheck
status = requires_recheck
recheck_reason_code = ambiguous_scope
final_status = null
false_resolved_prevented = true
semantic_oracle_passed = true
expected exit code = 3
```

Observed candidate roles: fixture `0024 → not_applicable`, `0028 → complement`. Round 1 FINAL не исполнялся. Это safe deferral, а не terminal semantic proof; следующий semantic gate — фактический Targeted Recheck для `application_documents`.

Fresh verification перед checkpoint:

```text
application_documents targeted = 24/24 PASS
full offline suite = 163 total / 162 PASS / 1 intentional AG-8 production-promotion RED
git diff --check = PASS
```

---

## 2026-08-29 — Aggregator `procurement_subject` model A/B checkpoint

На exact beta artifact `[TEST CODEX] TENDER — Агрегация закупки` (`ftvmrEHoMbPOAqZG`) выполнен bounded A/B на fixture execution `14104`.

```text
fixture SHA-256 = 6392f9c882a211f20cf1f13777f7002b8c8628270d025df5fdf46492f2adbd75
beta SHA-256 = dc214110d3086d9e147f0b2c7fe983ee0e93543ca31f7d82c2c52ef3a1f04484
```

Harness не обращался к БД/n8n и менял только `request.model`; workflow и fixture не менялись.

| Model | Result | Primary | `doc_7_au_0031` | Cost / latency / tokens |
|---|---|---|---|---|
| Gemini 3.7 Flash low | exit 0, `stop`, checker accepted, `round1_final`, oracle 6/6 | `doc_7_au_0008` | `not_applicable` | 0.25840089 RUB / 3711 ms / 3732 |
| GLM 5.3 Flash low | exit 0, `stop`, checker accepted, `round1_final`, oracle 6/6 | `doc_7_au_0001` | `not_applicable` | 0.08151487 RUB / 12911 ms / 3290 |

GLM оказался на 68.5% дешевле; Gemini — на 71.3% быстрее. GLM выбран recommended Aggregator beta baseline по observed reliability/correctness/cost; Gemini остаётся fallback при latency/provider issues. Полный evidence: `evaluations/AGGREGATOR_MODEL_COMPARISON_2026-08-29.md`.

Предыдущее `application_documents` evidence остаётся только safe Round 1 deferral: обе модели дали `requires_recheck/ambiguous_scope`; GLM был дешевле и более scope-sensitive, Gemini быстрее. Фактический Targeted Recheck для terminal correctness остаётся P0 gate до полного клиентского прогона.

Production promotion не выполнялась. Production Aggregator остаётся с intentional promotion RED; ни полная корректность 27 полей, ни fresh 27/27 run этим checkpoint не подтверждаются.

Fresh offline suite после harness:

```text
170 total / 169 pass / 1 intentional production-promotion RED
```

---

## 2026-08-30 — Targeted Recheck read-only audit checkpoint

Выполнен повторный read-only refresh live `TENDER - Targeted Recheck`:

```text
workflow id = 9uDOU31DGo30fGXX
active = true
live version = 4e0858c9-6ca2-42c7-969b-e74a2f91b8c6
live nodes = 64

local export version = 7f82ae43-2ddc-4568-8d76-a6d460c13924
local nodes = 63
```

Live-only node `Проверить #2 evidence Targeted Recheck ТЕСТОВАЯ` не подключена к production path. Параметры core Round 2 nodes совпадают между live и local export:

```text
Собрать candidates для Round 2
Подготовить запрос #2 Semantic Aggregator
Проверить ответ #2 Semantic Aggregator
Сформировать FINAL после Round 2
```

Audit verdict для автоматического клиентского отчёта: `REJECT`.

Новый P0 `TR-10`: structural checker Round 2 не доказывает полноту composite result. Для `application_documents` возможен schema-valid частичный `resolved`, который закрывает один grounded candidate, но теряет другие unresolved material clauses и материализует неполный FINAL.

Новый P1 `TR-11`: provider/checker failures fail closed и не создают ложный FINAL, но terminal field result и гарантированный alert не подтверждены; 27/27 barrier может остаться недостигнутым.

Зафиксирован source conflict:

```text
FIELD_CATALOG.md: application_documents Round 2 = ❌
live workflow: общий Round 2 profile реализован
```

Каталог не изменялся. Следующий единственный implementation gate — RED-only regression на exact current Round 2 Code nodes с fixture `14173`, без MCP write, PostgreSQL и paid AI. GREEN fix требует отдельного согласования protected workflow.

В этом checkpoint изменяется только документация. Live n8n читался через read-only API; workflow JSON, tests, PostgreSQL и AI не изменялись и не запускались.

---

## 2026-08-30 — Targeted Recheck TR-10 local GREEN containment

После принятого execution-derived RED добавлен минимальный field-specific containment в local canonical export `TENDER - Targeted Recheck`, нода `Проверить ответ #2 Semantic Aggregator`.

Контракт:

```text
field_catalog_version=tender_fields_v1
aggregation_round=2
field_key=application_documents
reported_status=resolved
→ effective_status=requires_review
→ review_reason_code=insufficient_evidence
→ needs_recheck=false
→ requires_human_review=true в FINAL
```

Containment вычисляется после всех существующих raw schema/cardinality/linking/status guards. Parsed AI result не мутируется. Output сохраняет provisional `final_value_text`, candidate decisions, supporting/conflict lists, evidence и upstream audit. `semantic_aggregator_meta` добавляет reported/effective statuses, applied flag, policy и universal containment reason.

Anti-overfit boundaries:

```text
procurement_subject Round 2 resolved → остаётся resolved
application_documents raw requires_review → reason/note сохраняются, containment_applied=false
malformed/finish_reason guards → без изменений
not_found / TR-11 → вне scope
```

Fresh offline verification:

```text
candidate gate = 3/3 PASS
immutable LIVE diagnostic = 2/2 PASS
targeted application_documents suite = 29/29 PASS
full offline suite = 175 total / 174 PASS / 1 intentional AG-8 RED
topology = 63 unique nodes / 63 unique IDs / all connections resolve
```

Read-only LIVE read-back после local edit:

```text
workflow id = 9uDOU31DGo30fGXX
active = true
versionId = 4e0858c9-6ca2-42c7-969b-e74a2f91b8c6
activeVersionId = 4e0858c9-6ca2-42c7-969b-e74a2f91b8c6
nodes = 64
```

LIVE production workflow не изменён и остаётся vulnerable согласно immutable diagnostic. Promotion, runtime canary и fresh 27/27 run — отдельные gates. PostgreSQL, credentials и paid AI не использовались; commit не создавался.

---

## 2026-08-31 — Targeted Recheck execution 14256 trusted evidence union

Execution `14256` выявил контрактное противоречие в `[TEST CODEX] TENDER - Targeted Recheck`: Extractor prompt разрешал evidence из targeted context и existing candidates, но `Проверить #2 evidence Targeted Recheck` строил trusted map только из `allowed_semantic_blocks`. Первый exact existing-only reference падал fail-closed на `candidate[0].evidence[7]`; Validator, Round 2, FINAL и DB save не выполнялись.

TDD regression запускает реальные Code nodes из canonical export и сохраняет material shape: пять linked items, 124 existing candidates для `application_documents`, 43 model evidence, 25 existing-only exact references и одна неверная coordinate `doc_3_au_0007 / sb_0227`, однозначно исправимая на trusted `doc_3_au_0006 / sb_0227` по тому же block ID и exact normalized quote.

Минимальный implementation diff ограничен двумя Code-node bodies:

```text
Подготовить запрос #2 AI Targeted Recheck
→ prompt явно разрешает TARGETED CONTEXT или EXISTING CANDIDATES
→ existing evidence требует exact copy candidate.analysis_unit_id + semantic_block_id + quote
→ coordinates нельзя изобретать/перепечатывать; existing evidence само по себе не доказывает completeness

Проверить #2 evidence Targeted Recheck
→ trusted union = allowed_semantic_blocks + well-formed stored existing-candidate quotes
→ known pair требует exact normalized containment
→ unknown pair можно исправить только по тому же semantic_block_id + exact quote и ровно одной trusted pair
→ меняется только analysis_unit_id; zero/ambiguous/mismatch остаются hard failure
→ audit: targeted_recheck_meta.evidence_coordinate_repairs[]
```

Полная итоговая prompt-версия сохранена как `prompts/targeted-recheck-extractor-system-prompt-v1.1-2026-08-31.txt`.

Fresh offline verification:

```text
execution-14256 focused regression = 10/10 PASS
related Targeted Recheck/application_documents suite = 62/62 PASS
full offline suite = 208 total / 207 PASS / 1 intentional AG-8 RED
git diff --check = PASS
high-confidence secret scan = no matches
```

Exact execution offline harness сохранил 43/43 evidence, принял 25 existing-only references, записал один repair `doc_3_au_0007 → doc_3_au_0006` для `sb_0227`; остальные четыре child items прошли checker независимо. Validator preparation сохранила 43 evidence и один repair audit.

После local GREEN атомарно обновлён только unpublished draft тестового workflow `nI47FcgzYwGzwGqy`:

```text
versionId before = d74f1f17-c80f-4499-bf56-b0f7daab594b
versionId after = bca1746c-abcb-4490-a455-1daa6ac22092
activeVersionId = d74f1f17-c80f-4499-bf56-b0f7daab594b (unchanged)
prepare local/live SHA-256 = acb91d5136a0e063359bc36493dca6bcf60c04e490022a7728324cf5c8190ab3
checker local/live SHA-256 = 74c32f4d85b91e17665846346e02df492d827f7c86ddf70313627b4d8f064138
node count = 63
graph, connections, credentials, settings, pinData and published active graph = unchanged
```

Этот checkpoint — offline/draft GREEN, но **не runtime GREEN**. PIN-data canary, publish и activation оставлены оркестратору после review. Workflow execution, paid AI, PostgreSQL, production workflows и credentials не изменялись; commit не создавался.

### 2026-08-31 — TR-12 test publish checkpoint

После независимого review опубликована только тестовая версия `[TEST CODEX] TENDER - Targeted Recheck`:

```text
workflow id = nI47FcgzYwGzwGqy
versionId = bca1746c-abcb-4490-a455-1daa6ac22092
activeVersionId = bca1746c-abcb-4490-a455-1daa6ac22092
draft = active
nodes = 63
```

Перед publish подтверждены `17/17` focused evidence tests, полный offline suite `208 total / 207 pass / 1 intentional AG-8 RED`, valid configuration обеих изменённых Code nodes и exact live diff только их `parameters`. Graph, connections, credentials, settings и node count не изменялись. Это test publish, а не runtime verdict; PIN-data canary с реальными LLM и downstream FINAL/report ещё не выполнялся.

---

## 2026-08-31 — Test-only Aggregator E2E PIN launch harness

Прямой MCP-запуск test Aggregator `ftvmrEHoMbPOAqZG@01ff5e9d-30d2-4530-b2ff-4513224e9056` невозможен из-за Execute Workflow Trigger. После TDD и отдельного review опубликован изолированный test-only contour:

```text
Aggregator PIN body = gsoPfP4PSjcJjPfa@e489fc85-b49b-46b4-b8a2-88ebdbb08be2
truthful Report replay = b4Ga1PoFmlS5ep6Y@8570c7ac-b01a-4421-a2e1-454e85cc7173
Webhook controller = U0S3Oyq5pYfiWVDE@9fec6c5a-4d08-49c3-81a2-2087aabbad4c
POST /webhook/test-codex-tender-aggregator-e2e-3caa7a89
```

Body требует exact audited request и сохранённые trigger/claim PIN items; повторный DB claim отсутствует. После claim сохранены 22/22 source business nodes и connections, включая test Targeted Recheck и production Finalization. Controller использует только read-only pre/post DB checks и exact 27/27 barrier.

Первый draft был остановлен review из-за fabricated `completion_claimed=true` на replay. Исправленный contract не подменяет Finalization: для completed run передаются truthful `completion_claimed=false/finalization_state=already_completed` и explicit `report_replay_authorized=true` в отдельный test Report clone. В clone изменён только initial guard; восемь downstream Report nodes и graph совпадают с production source. Controller не вызывает production Report напрямую.

```text
runner tests = 8/8 PASS
live body downstream parity = 22/22
live Report downstream parity = 8/8
published readback = draft=active для всех трёх workflow
prompts changed = no
```

Первый E2E controller `14257` был запущен после review и безопасно остановился до LLM/downstream DB writes. Paid Aggregator chain фактически не началась; FINAL остался `0/27`.

### Execution 14257 — exact child input contract fix

Controller `14257` / child `14258` подтвердил fail-closed `RUNNER_CONTRACT_MISMATCH`. Execute Workflow predecessor содержал lifecycle metadata, child trigger отфильтровал их и получил declared 11 keys, но body guard ожидал только девять external request keys.

TDD regression исполняет реальные Code-node bodies и доказывает: predecessor перед body формирует ровно 11 declared fields; exact body принимается; missing/unknown keys отвергаются; post-run ownership отдельно корректен для `aggregating` и `completed`.

```text
body: e489fc85-b49b-46b4-b8a2-88ebdbb08be2
   → 18c770bb-70b5-4448-b3a5-d251057ea343
controller: 9fec6c5a-4d08-49c3-81a2-2087aabbad4c
         → 90a69f3b-9c26-46a5-9fba-cb96eee23105
```

Изменены параметры одной body Code node и трёх controller Code nodes. Connections/node counts, SQL, Aggregator business nodes, Targeted Recheck, Finalization, Report/replay и prompts не менялись. Live body downstream parity остаётся `22/22`, Report `8/8`; runner `10/10 PASS`; основной full suite `218 total / 217 pass / 1 intentional AG-8 RED`. Повторный paid canary оставлен root после независимого review.

---

## 2026-08-31 — E2E PIN canary 14259: technical GREEN, semantic REJECT

После runner execution-14257 fix выполнен один реальный canary на exact Aggregator PIN data:

```text
controller 14259 success
Aggregator body 14260 success
Targeted Recheck 14261 success
Finalization owner 14267 success
Report 14268 success → Создать HTML artifact
run completed; FINAL 27/27
19 resolved / 3 requires_review / 5 not_found
```

One-report ownership подтверждён: Finalization `14262/14263/14264/14266` report не вызывали, только completion owner `14267` вызвал единственный Report `14268`.

Ручной semantic audit дал `25/27 acceptable = 92.6%`, zero observed critical `false_not_found`, но два critical `false_resolved`:

1. `participation_guarantee` — общий conditional contract без фактической применимости/размера текущей закупки;
2. `required_official_certificates` — только налоговая справка при material ЕГРЮЛ/ЕГРИП/registry evidence, сохранённом под `application_documents`.

Три confirmation runs намеренно не запускались. Создан отдельный implementation task на execution-derived RED и минимальный test-only containment. Production workflows/credentials не изменялись; prompts не менялись. Audit: `evaluations/TENDER_E2E_PIN_CANARY_14259_2026-08-31.md`.

---

## 2026-08-31 — executions 14260/14261 semantic containment offline GREEN

Первый полный E2E run технически завершился успешно, но semantic audit отверг два critical false-resolved:

```text
participation_guarantee/resolved/0.92
→ generic conditional/template rules; applicability/size не доказаны

required_official_certificates/resolved/0.95
→ только tax-certificate alternatives при material ЕГРЮЛ/ЕГРИП/registry facts
```

TDD fixture `execution-14260-semantic-containment.json` сначала дал четыре RED: Round 1 и Round 2 принимали reported `resolved` для обоих полей. Minimal field-specific containment добавлен только в:

```text
Aggregator / Проверить ответ Semantic Aggregator
Round 1 resolved → requires_recheck / insufficient_evidence

Targeted Recheck / Проверить ответ #2 Semantic Aggregator
Round 2 resolved → requires_review / insufficient_evidence
```

Containment выполняется после raw schema/linking/cardinality guards, сохраняет provisional value, candidates/evidence и reported/effective policy/reason audit. Raw `requires_recheck`/`requires_review`, unrelated fields и malformed/linking/cardinality controls не изменены. Prompt changes: **no**.

```text
focused semantic containment + runner = 22/22 PASS
full main suite = 230 total / 229 PASS / 1 intentional AG-8 RED
git diff --check = PASS
```

Unpublished test drafts после parameter-only updates:

```text
ftvmrEHoMbPOAqZG draft 91c17313-a593-4fb9-9072-79320a958dd7
nI47FcgzYwGzwGqy draft c43b4ed3-c384-41e9-b1d9-3636cff42ac5
gsoPfP4PSjcJjPfa draft 7566262e-4c7a-4483-a5cd-9bdfd81a95aa
U0S3Oyq5pYfiWVDE draft 03ac36e0-c4f8-44ea-bd52-bf41d5425012
```

Live verifier подтвердил body `22/22` post-claim executable parity, controller parity, unchanged topology и parameter-only scope. Publish и paid E2E после fix оставлены отдельным runtime gate.

---

## 2026-08-31 — E2E canary 14279 GREEN; replay regression 14278 closed

После публикации `AG-10/TR-13` первый attempt `14269` дошёл через Aggregator `14270` и Targeted Recheck `14271/14275`, но test Report replay `14278` fail-closed остановился на stale exact `source_workflow_version_id`. В том же runner task выполнен TDD fix одной Code node; published replay version `80ad3549-998f-41a0-a973-f02ef5eae46a`, downstream Report parity `8/8`, prompts не менялись.

Повторный canary:

```text
controller 14279 success
Aggregator body 14280 success
Targeted Recheck 14281 / 14285 success
Report replay 14289 success
HTML artifact valid, 484540 bytes
DB exact 27 rows / 27 keys
16 resolved / 7 requires_review / 4 not_found
semantic audit 27/27 acceptable
zero observed critical false_resolved / false_not_found
```

Canary принят. Следующий gate — три consecutive confirmation runs на том же exact PIN contract; временный public controller остаётся опубликован только до завершения серии.

---

## 2026-08-31 — confirmation attempt 14290/14291/14292 fail-closed

Первый confirmation attempt после GREEN canary не засчитан:

```text
controller 14290 error
Aggregator body 14291 error
Targeted Recheck 14292 error
Report отсутствует
consecutive confirmations = 0/3
```

Сбой не связан с balance/provider availability. В `Проверить #2 evidence Targeted Recheck` строгий checker остановил `results_date`: evidence[4] содержал точную цитату, но неверную пару координат `doc_2_au_0002/sb_0048`; trusted source для цитаты — `doc_2_au_0001/sb_0004`. Дополнительно execution содержит три model-response schema variants, не соответствующие `targeted_recheck_extractor_v1`: `participation_guarantee`, `required_official_certificates`, `application_documents`.

Повторные paid runs остановлены. В тот же существующий semantic-containment task отправлен TDD follow-up: сохранить строгие guards, но детерминированные model-contract/evidence failures преобразовывать в явно аудируемый terminal `requires_review` с `evidence_validated=false`, без принятия unvalidated candidates и без возможности получить `not_found`. Production workflows/DB и prompts не изменялись на этом checkpoint.

### Offline fix и test publish

TDD fixture охватывает все семь AI envelopes `14292`. Typed checker перехватывает только собственные model contract/evidence violations; unknown programming errors/upstream invariant failures остаются hard-fail. Invalid AI candidates удаляются, raw response/error/stage сохраняются в audit, а отдельный IF направляет item в terminal `requires_review` как для `requires_recheck`, так и для `no_initial_candidates`. Валидный `insufficient_evidence` не изменён и по-прежнему может завершиться `not_found`.

```text
focused/related = 60/60 PASS
full main suite = 246 total / 245 PASS / 1 intentional AG-8 RED
test Targeted Recheck = nI47FcgzYwGzwGqy@13b3c124-4fef-4a6f-9d5f-8befa3725bc1
published active = yes
prompts changed = no
production workflows / DB changed = no
```

Fresh E2E canary и confirmation series ещё не выполнялись после этого publish.

### Fresh canary 14294 GREEN

Preflight `14293` fail-closed до body/LLM из-за неверной root-формы PIN payload и не учитывается. Исправленный exact request завершил цепочку `14294 → 14295 → 14296/14300 → 14303` со статусом success, exact DB `27/27` и валидным HTML `482829` bytes.

Semantic audit: `27/27 acceptable`, `16 resolved / 6 requires_review / 5 not_found`, zero observed critical false statuses. `government_contract` безопасно изменился на `not_found`: note различает upstream State Contract и статус заключаемого договора и не создаёт отрицательного факта. Technical fallback в runtime не понадобился; все envelopes/evidence были валидны. Confirmation series остаётся `0/3` и начинается только со следующего запуска.

### Confirmation 1/3 GREEN

`14304 → 14305 → 14306/14310 → 14313`: controller, body, оба Targeted Recheck и один Report replay завершились success. DB exact `27/27`; HTML `476893` bytes и renderer round-trip valid; semantic audit `27/27 acceptable`; `16 resolved / 6 requires_review / 5 not_found`; critical false statuses не обнаружены. Technical fallback не использовался. Consecutive count: `1/3`.

### Confirmation 2/3 GREEN

`14314 → 14315 → 14316/14320 → 14324`: все stages success, DB exact `27/27`, HTML `477940` bytes valid, semantic audit `27/27 acceptable`, `16 resolved / 7 requires_review / 4 not_found`, zero observed critical false statuses. `government_contract` безопасно завершён `requires_review/ambiguous_scope`. Technical fallback не использовался. Consecutive count: `2/3`.

### Confirmation 3/3 GREEN

`14325 → 14326 → 14327/14331 → 14335`: все stages success, DB exact `27/27`, HTML `481901` bytes valid, semantic audit `27/27 acceptable`, `16 resolved / 7 requires_review / 4 not_found`, zero observed critical false statuses. `application_review_date` безопасно понижен в `requires_review/ambiguous_scope`; incomplete `required_official_certificates` остался `requires_review`, а не resolved. Technical fallback не использовался.

Consecutive gate завершён: `3/3 GREEN`. Prompts в серии не менялись.

После завершения серии test controller `U0S3Oyq5pYfiWVDE` unpublished. Draft/version сохранён, public webhook деактивирован; test Targeted Recheck и source Aggregator остаются published для подтверждённого test contour.

### Final verification after controller unpublish

Live verifier повторно подтвердил exact workflow identity/parity: Aggregator body `gsoPfP4PSjcJjPfa@7566262e-…`, replay Report `b4Ga1PoFmlS5ep6Y@80ad3549-…`, source Aggregator `ftvmrEHoMbPOAqZG@91c17313-…` и Targeted Recheck `nI47FcgzYwGzwGqy@13b3c124-…` активны в проверенных версиях; controller `U0S3Oyq5pYfiWVDE` имеет `active=false`, `activeVersionId=null`.

Focused E2E runner suite = `11/11 PASS`. Полный offline suite = `246 total / 245 PASS / 1 intentional AG-8 production-promotion RED`. `git diff --check` не обнаружил whitespace errors; выданы только предупреждения Git о будущей нормализации LF/CRLF. Полные prompt versions не архивировались, потому что в исправлении и runtime-серии prompts не менялись.

Итог текущей задачи: tested Aggregator PIN-data contour готов по gate `fresh canary + 3/3 consecutive GREEN`, каждый запуск создал exact `27/27` FINAL и валидный HTML-отчёт, semantic audit `27/27 acceptable`, zero observed critical `false_resolved/false_not_found`. Это не production promotion и не clean новый прогон всех `12/12` документов: replay основан на ранее сохранённых PIN data после согласованного обхода одного failed документа.

---

## 2026-08-31 — КТ172 preliminary report audit: DOCX ActiveX option-state loss

После завершения PIN-data серии пользователь вручную выполнил сохранённый client-run contour:

```text
analysis_run_id 3caa7a89-b137-4cf6-b23d-941fb465c8f9
Aggregator 14336 success
Targeted Recheck 14337 / 14341 success
Finalization calls 14338–14343 success
Report replay 14345 success
```

Сформированный HTML содержит 27 полей. Локально создан предварительный A4 PDF с именем `ПРЕДВАРИТЕЛЬНЫЙ — Анализ закупки КТ172 — 11 из 12 документов.pdf`; PDF прошёл render QA, 140 страниц, полный evidence appendix сохранён. Artifact не считается production feature и не добавляет PDF-generation в n8n: конвертация выполнена локально из HTML.

Client/source audit выявил три расхождения:

```text
national_regime
report: resolved, ПП 1875 / преимущество 15%
source: selected "Не применимо"
verdict: P0 false_resolved

participation_guarantee
report: requires_review
source: selected "Не предусмотрены"
verdict: safe containment, но explicit negative потерян

participation_cost
employee brief: 24 900
source bundle / OCR execution 14234 / TenderMeta: значение отсутствует
report candidate: плата за предоставление документации, не тариф участия
verdict: external-source/subtype gap, 24 900 нельзя materialize без grounded source
```

Визуальный render `Блок_2_Информационная_карта.docx` подтвердил выбранные `Не применимо` и `Не предусмотрены`. Direct OOXML inspection установил root cause: Word хранит отметки как ActiveX controls (`w:control`, relationships `word/activeX/*`), а parser/normalizer переносит только option labels. Targeted Recheck `14337` поэтому честно увидел оба альтернативных текста без отметки и вернул `insufficient_evidence`; для `national_regime` Round 1 execution `14336` принял шесть generic/conditional PP 1875 candidates и materialized false `resolved`.

Новый P0 записан как `DW-18 / AG-11`. Required fix boundary:

```text
deterministic selected/unselected extraction
→ semantic option-state contract
→ unselected options excluded from applicability candidates
→ missing/ambiguous state cannot produce positive resolved
→ exact source regression
→ Worker/Aggregator runtime canary
```

Existing `DW-17` OCR/reference-only repair остаётся отдельным blocker clean 12/12 run. Текущий предварительный отчёт допустим только с явным клиентским disclaimer; final/client-ready verdict остаётся `REJECT` до `DW-18 / AG-11`, `DW-17`, fresh 12/12 и ручной проверки 27/27.

Live read-only refresh уточнил фактический Worker contour:

```text
[PROD CANDIDATE] TENDER — Обработать документ
workflow id = csnDg78NzN1nIjUT
published active version = c5977af5-c263-4846-8af2-762b85edcc87
execution 14234 / 14238 snapshot = 51 nodes
current unpublished draft = 778dfb50-72be-434d-ba82-2f8fcf90daec / 52 nodes
```

Старый `[3 TEST]` Worker `2T7szFpiGcfNpKkB@55664cef-…` inactive и в текущем клиентском run не участвовал. Следующий исполнитель обязан сначала сравнить active/draft `[PROD CANDIDATE]`; нельзя применять execution-derived fix к неподтверждённой 52-node draft topology как к source of truth.

Workflow, production n8n, PostgreSQL, credentials и prompts на этом audit checkpoint не изменялись.

---

## 2026-08-31 — DW-18 Task 2 exact-source fixture RED

Recovery baseline в isolated worktree `codex/dw18-ag11-option-state` не воспроизвёл документированный итог `245/246`: фактический full suite дал `240/246` и пять дополнительных pre-existing failures. Технический оркестратор принял решение продолжить DW-18/AG-11, сохранив их как pre-existing baseline; исправление этих тестов не входит в scope.

Raw Docling execution `14234` содержит пустой `form_items` и не содержит структурных `checked`/`selected`/ActiveX state. Поэтому выбран только standards-based OOXML relationships → CFB named `contents` stream → MS-OFORMS `Value` путь.

Создан минимальный производный fixture без полного клиентского DOCX. Он содержит sanitised `word/document.xml`/relationships только для шести требуемых control-label rows и exact source ActiveX XML/relationships/CFB parts. Full-source SHA-256:

```text
32f79d377ad3b775497e70754bdfdce8ec0928cfeb2626d60ca65ef519f7437b
```

Initial focused RED:

```text
node --test tests/document-worker-docx-option-state.test.mjs
11 tests / 1 pass / 10 fail / exit 1
```

Fixture integrity прошла. Все десять поведенческих сценариев упали по ожидаемой причине:

```text
Workflow node not found: Разобрать состояния DOCX ActiveX
```

RED охватывает exact `activeX5/6/7/8/55/56`, missing relationships, unknown CLSID, malformed CFB, unsupported persistence, missing/indeterminate `Value` и ambiguous control-label mappings. Production workflow, production n8n, DB, credentials и prompts не изменялись.

---

## 2026-08-31 — DW-18 Task 3 deterministic source parsing GREEN

Focused contract расширен по замечаниям review до 27 сценариев. XML структурно разбирается native n8n `Extract From File` + `XML` nodes; Code node получает parsed objects и выполняет только OPC relationship joining, bounded CFB FAT/miniFAT traversal, MS-OFORMS `Value` decoding и формирование fail-closed audit records.

Preparation boundary сохраняет исходный `binary.data`, создаёт только для DOCX отдельный `.zip` alias для Compression и определяет извлечённые OPC parts по `binary descriptor.fileName`. PDF/XLSX bypass сохраняет прежний JSON/binary contract.

Review RED/GREEN evidence:

```text
initial reviewed RED: 26 tests / 1 pass / 25 fail
first implementation run: 26 tests / 25 pass / 1 fail
cause: source_row_ref serialization differed from fixture contract
focused GREEN after minimal fix: 26 tests / 26 pass
additional CFB v4 sector-boundary RED: 1 test / 0 pass / 1 fail
final focused GREEN: 27 tests / 27 pass
```

Resource gates покрывают extracted-part count, суммарный размер требуемых частей, CFB v3/v4 sector sizes, sector indexes, FAT/miniFAT chain length, cycles, `contents` size и malformed/out-of-range structures. Exact source states подтверждены: 5/6/7 cleared, 8 selected `Не применимо`, 55 selected `Не предусмотрены`, 56 cleared. Все 11 добавленных нод прошли read-only schema validation `validate_node_config`. Production n8n, production DB, credentials и prompts не изменялись.

Дополнительный review gate устранил принятие orphan/stale CFB stream: `contents` теперь выбирается только среди directory entries, достижимых bounded traversal от `Root Entry.child` через child/left/right pointers. Focused directory-tree RED был `0/4`, GREEN — `4/4`; orphan `contents`, out-of-range child/sibling и cycle дают `unknown` с audit warning. Runtime native path этим не подтверждён и остаётся gate Task 6–7.

---

## 2026-08-31 — DW-18 Task 4 semantic propagation GREEN

Option-state metadata проходит через реальную Worker chain: Docling result context → normalized source block с exact-label ownership → semantic block → AI segment → evidence context. Канонический `semantic_block.text` не изменяется; AI-visible `ai_text` добавляет отдельный marker `[OPTION_STATE <state>] <exact label>`. Evidence validators проверяют цитаты только по `canonical_text`, поэтому AI-only marker не может стать новым evidence; resource budgeting при этом учитывает фактический `ai_text`.

Terminal applicability guard размещён в `Подготовить dispatch AI Validator`, после схождения attempt 1, Evidence Repair и Lossless Fact Partition. Для `national_regime` и `participation_guarantee` exact-grounded `unselected` переносится в audited deterministic rejection, `unknown`/`indeterminate` — в `requires_review`, а `selected` сохраняется как applicable с `option_state_evidence`. AI Validator не создаёт новых facts.

```text
Task 4 focused RED: 38 tests / 31 pass / 7 fail
AI-only marker/budgeting RED: 2 tests / 0 pass / 2 fail
AI-only marker/budgeting GREEN: 2 tests / 2 pass
downstream review RED: 43 tests / 35 pass / 8 fail
global-unknown/persistence RED: 44 tests / 42 pass / 2 fail
Task 4 final focused GREEN: 44 tests / 44 pass
related document-worker suite: 154 tests / 152 pass / 2 accepted pre-existing failures
```

Downstream review RED обнаружил и воспроизвёл четыре fail-open/runtime path: option-state rejection не принимался existing overlap-only converters, AI Validator мог повысить `review_only` до `confirmed`, ambiguous semantic ownership терял audit sentinel, а глобальный parser/resource `unknown` с пустым state array оставлял guarded fact обычным `found`. Все три deterministic converters теперь отдельно валидируют `deterministic_option_applicability_v1`; post-AI mapping сохраняет provenance и запрещает повышение `review_only`; exact-label mapping warnings и source-level `unknown` доходят до evidence context и terminal dispatch. Option-state audit упаковывается в сохраняемый `validator_meta.option_state` без изменения DB schema. Package assertions больше не маскируются старым beta hash failure.

Оставшиеся related failures — ранее зафиксированные baseline gates: immutable beta hash отличается от старой константы, а validator prompt artifact имеет CRLF/LF mismatch. Новый topology failure от DOCX Merge nodes устранён с сохранением запрета неожиданных Merge в Validator dispatch path. Runtime native execution всё ещё не проверялся.

---

## 2026-08-31 — AG-11 Task 5 Aggregator containment GREEN

Добавлен независимый fail-closed boundary после полного Round 1 structural validation и до FINAL materialization. Для `national_regime/resolved` checker принимает только `confirmed` primary с versioned structured applicability proof, точно связанным с candidate evidence: selected `docx_option_state_fact_audit_v1` либо `current_procurement_applicability_v1` от deterministic source contract. Конкретные option labels, control names, ActiveX part numbers и execution IDs production code не интерпретирует.

```text
Task 5 focused RED: 17 tests / 5 pass / 12 fail
exact quote binding RED: 27 tests / 25 pass / 2 fail
FINAL value binding RED: 31 tests / 27 pass / 4 fail
Task 5 final focused GREEN: 31 tests / 31 pass
AG-8/AG-9/AG-10/Targeted Recheck related: 156 tests / 152 pass / 4 accepted pre-existing failures
```

Без proof generic/conditional policy, labels-only и ambiguous/review-only candidates получают effective `requires_recheck/insufficient_evidence`. Selected negative и explicit current-procurement proof допускают `resolved`; raw recheck и unrelated field сохраняют прежнее поведение. Candidate SQL переносит из JSONB audit только `option_state` и `applicability_proof`; reported response, effective status, decisions, evidence и containment reason остаются в audit.

Четыре related RED совпадают с зафиксированным baseline: intentional AG-8 canonical prompt gate, два execution-14104 fixture SHA/report gates и Targeted Recheck coordinate mismatch. Production n8n, production DB и credentials не изменялись; runtime GREEN не заявляется.

---

## 2026-08-31 — DW-18 / AG-11 Task 6 test packaging checkpoint

Offline graph audit подтвердил canonical Worker `62` nodes и test Aggregator export `24` nodes: duplicate node names/IDs, missing connection targets и disabled nodes отсутствуют. Focused Worker + Aggregator tests прошли `75/75`; related Worker packaging run дал `153/154`, единственный RED — ранее зафиксированный immutable beta hash baseline (`cd7b76…` фактически против старой константы `02e4e5…`).

Test Aggregator `ftvmrEHoMbPOAqZG` был read-back на published/draft version `91c17313-a593-4fb9-9072-79320a958dd7`. Трёхстороннее сравнение live pre ↔ Task 5 base ↔ Task 5 target показало отсутствие conflict в трёх изменяемых нодах. Atomic update применил ровно `3/3` operations:

```text
Загрузить факты закупки
Подготовить запрос Semantic Aggregator
Проверить ответ Semantic Aggregator
```

Новый test draft `f11906df-f760-4c54-a59e-16f4423ab534` прочитан обратно: `24` nodes, parameters трёх нод совпадают с repository target, connections сохранены, unexpected node drift = `0`. Active version оставлен `91c17313-a593-4fb9-9072-79320a958dd7`; publish и runtime execution не выполнялись. Immutable snapshots:

```text
pre  workflows/n8n-exports/beta/[TEST CODEX] TENDER — Агрегация закупки.live-91c17313-a593-4fb9-9072-79320a958dd7.json
SHA-256 017093e027f781864b7fe261e77f8a704ccbcca5524102136300d65121e1063d

post workflows/n8n-exports/beta/[TEST CODEX] TENDER — Агрегация закупки.live-f11906df-f760-4c54-a59e-16f4423ab534.json
SHA-256 4d1b737efe64fe1fb870917c48f7d6d799c76cbd9b40bc1266db38a4cea06d7f
```

Exact Worker candidate `csnDg78NzN1nIjUT` имеет `availableInMCP=false`; MCP read/history возвращают explicit access error. UI подтвердил, что enable-MCP flow принимает только published workflows с webhook/form/schedule/chat trigger, а candidate — subworkflow/manual contour. По плану старый `[3 TEST]` Worker не использован как подмена, candidate не изменён, production n8n/DB/credentials не затронуты. Поэтому native Worker runtime path и end-to-end canary остаются непроверенным gate.

Final offline verification:

```text
node --test tests/document-worker-docx-option-state.test.mjs
44/44 PASS

node --test tests/aggregator-national-regime-option-state.test.mjs
31/31 PASS

node --test tests/document-worker-*.test.mjs
154 total / 152 pass / 2 accepted pre-existing failures

node --test tests/*.test.mjs
322 total / 316 pass / 6 accepted baseline failures
```

Full-suite RED set не изменился относительно принятой границы: intentional AG-8 current-scope gate; два execution-14104 A/B artifact/hash gates; immutable Worker beta hash; validator prompt CRLF/LF mismatch; Targeted Recheck evidence-coordinate mismatch. Новых failures нет.

---

## 2026-09-01 — DW-18 runtime hardening from executions 14350–14352

Recovery audit подтвердил clean branch HEAD `6796809` и exact source SHA-256 `32f79d377ad3b775497e70754bdfdce8ec0928cfeb2626d60ca65ef519f7437b`. Focused baseline был `44/44 PASS`.

Execution-derived RED (`3e6556c`) воспроизвёл три первые runtime boundaries:

```text
14350: Compression descriptor = directory + fileName, canonical использовал только fileName
14351: Extract From File/XML заменяет JSON и теряет docx_part_path/docx_part_kind
14352: 578 controls / 126 decoded / partial; target raw 0/0/0/1 оставались unknown из-за ancestor-table ambiguity
```

Sanitised fixture сохраняет реальную вложенную multi-control table structure без полного DOCX, PII, secrets или unrelated procurement content. RED: `46 total / 39 pass / 7 fail`; первичные assertions упали на missing Merge input 0, missing reconstructed OPC parts и `12` duplicate records вместо exact `6`.

Minimal GREEN (`20568db`) изменил только canonical Worker:

```text
full fileName OR directory + fileName → единый normalized OPC path
OOXML часть XML? True → Привязать parsed XML к части input 0
parsed XML → Привязать parsed XML к части input 1
direct table rows/cells only; nested w:tbl excluded from ancestor-cell content
```

Focused GREEN: `46/46 PASS`. Exact states: activeX5/6/7 unselected, activeX8 selected (`Не применимо.`), activeX55 selected (`Не предусмотрены;`), activeX56 unselected (`Предусмотрены…`). Настоящие multiple-label/multiple-control cases остаются `unknown`; unselected/review-only AG-11 semantics не ослаблены. Production n8n/DB, credentials, prompts и полный клиентский DOCX не изменялись. Post-fix runtime canary остаётся обязательным gate.

Final offline verification:

```text
DW-18 focused: 61/61 PASS
AG-11 focused: 31/31 PASS
document-worker related: 171 total / 169 pass / 2 exact baseline failures
full suite: 339 total / 333 pass / 6 exact baseline failures
```

Full-suite failure set совпал с checkpoint `da7bb7a`: intentional AG-8 current-scope gate; два execution-14104 A/B artifact/hash gates; immutable Worker beta hash; validator prompt CRLF/LF mismatch; Targeted Recheck evidence-coordinate mismatch. Packaging projection вне reviewed DW-18 nodes прошла; `git diff --check` не обнаружил whitespace errors.

Quality-review TDD добавил отдельный RED `8f4e959`: `61 total / 46 pass / 15 fail`. Один failure доказал, что прежний exact-six harness синтезировал XML из manifest вместо checked-in fixture; ещё 14 failures показали принятие absolute/UNC, drive/URI и dot-segment Compression paths. GREEN `3c9903f` загружает structured parser input напрямую из sanitised OOXML tree и отклоняет unsafe descriptors до OPC normalization с `invalid_extracted_part_path`. Valid full `fileName` и split `directory + fileName` regressions остаются GREEN.

---

## 2026-09-01 — DW-18 Stage 1 structural semantic binding from execution 14359

Read-only execution `14359` подтвердил правильный raw ActiveX parser state и первый incorrect downstream state в `Нормализовать документ Docling`: global label-only lookup дал ambiguity для повторяющихся labels и не привязал selected national-regime state к target semantic owner. TDD был разделён на checkpoints:

```text
4f6f23f test: reproduce DOCX semantic binding drift
a5a1cb7 fix: bind DOCX option state by source structure
e7e1987 test: expose remaining DOCX binding gaps
3643b29 fix: close remaining DOCX binding gaps
e8db92b test: correct execution 14359 geometry counts
```

Initial RED: `66 total / 61 pass / 5 intended fail`. Spec-review RED после exact-live fixture: `69 total / 65 pass / 4 intended fail`. Final focused GREEN: `69/69 PASS`.

Production logic теперь использует generic structural contract без tender-specific literals: строгий source `table/row`, stable-control identity consistency, единый relative row offset внутри source-table group и exact local label equality с matching-only Unicode whitespace normalization. OOXML и Docling table ordinals не приравниваются. Missing/contradictory/multiple ownership fail closed. Canonical block text/evidence не изменяются; mapping warning arrays сохраняются один раз, segments несут bounded issue IDs и scalar semantic status. Document-level `unknown`, даже без candidate block refs, принудительно оставляет guarded facts review-only во всех трёх evidence paths и Validator dispatch.

Exact read-only replay полного execution `14359` input (`290` controls, `64` raw tables) подтвердил:

```text
activeX5/6/7/8 → #/tables/2 → unselected/unselected/unselected/selected
activeX55/56 → #/tables/25 → selected/unselected
docx_option_state_semantic_status = unknown
mapping warning groups = 33
semantic owners = 83/290 controls
```

Поэтому replay является diagnostic structural evidence, но не runtime GREEN canary: `national_regime` и `participation_guarantee` обязаны оставаться не выше `requires_review`, пока fail-closed document status не пройдёт post-fix canary. Production n8n, PostgreSQL, credentials, Extractor/Validator prompts и model settings не изменялись; paid AI не запускался.

Final full-suite gate:

```text
node --test tests/*.test.mjs
347 total / 341 pass / 6 fail
```

Exact accepted pre-existing failures:

```text
RED actionable: procurement_subject FIELD_RULES contain the universal current-scope boundary
RED A/B runtime report contains the full execution, artifact, response, oracle, and exit audit
RED A/B harness refuses canonical production workflow and preserves fixture and beta SHA-256
immutable beta Worker snapshot retains its reviewed packaging hash
v1.2 prompt artifact is an exact clean copy of the imported validator system prompt
Targeted Recheck prompt aligns evidence coordinates with both trusted sources
```

Неблокирующий promotion debt: checked-in semantic-binding fixture replay сокращён до `6` controls и `4` meaningful tables, хотя metadata точно разделяет observed raw/downstream cardinalities: `290` controls, `64` raw tables, `6` raw body children, `647` normalized blocks, `528` semantic blocks. Перед promotion нужен reproducible sanitized full-payload replay либо точное переименование fixture/replay contract. Post-fix production runtime canary остаётся pending.

---

## 2026-09-01 — Document Worker Stage 2 Extractor envelope recovery local GREEN

Read-only diagnosis execution `14359` классифицировал все `16` primary GLM responses: transport завершился успешно, но deterministic envelope attachment был безопасен для `0/16`. Каждый response нарушал обязательный exact `field_catalog_version`; часть одновременно не сообщала `schema_version` и/или `analysis_unit_id`. Exact request body, system prompt, response contract и workflow version совпали с canonical и known-good controls. Root cause — model contract noncompliance, не prompt/version drift.

TDD checkpoints:

```text
dff07a9 test: diagnose Extractor envelope noncompliance
507e12e fix: attach only safe missing schema/identity envelopes
581ed5c test: define bounded Extractor fallback recovery
e690528 test: require explicit source carry without error-output pairing
78935b8 test: hard-stop settings, exact IF, shared parity and done barrier
58556f6 feat: implement one bounded Gemini fallback recovery
```

Safe deterministic attachment остаётся разрешён только для отсутствующего `schema_version` и/или `analysis_unit_id`, если root allow-list, `field_catalog_version`, unique explicit source identity и весь facts/evidence contract точны. Wrong schema, conflicting reported ID, missing catalog, alias/extra keys и invalid facts/evidence не coerc-ятся.

Для genuinely invalid primary model payload canonical Worker вызывает максимум один Gemini 3.7 Flash low fallback с original prompts/response contract и той же credential family. Primary и fallback используют byte-identical `ai_extractor_strict_validator_v3`; invalid fallback hard-stops document. HTTP transport/internal/source failures также hard-stop и не используют error outputs. Accepted primary items fallback не вызывают.

Existing Loop перенесён перед primary HTTP: output 1 обрабатывает один unit, а output 0 ведёт только в новый completeness barrier. Successful primary/fallback audit затем проходит прежние evidence validation/repair/fact-partition tails и возвращается в Loop ровно один раз. Barrier до collector/Validator/persistence проверяет exact cardinality, unique identities, deterministic source order и bounded attempt audit; partial batch не сохраняется. Merge не добавлен.

Self-review TDD выявил omission первоначального RED contract: fallback audit использовал positional `.first()` и мог взять context другой Loop iteration. Дополнительный focused RED: `23 total / 22 pass / 1 intended fail`. GREEN переносит exact seven-field `recovery_context` только через current input, валидирует allow-list/identity/model/failure/attempt вне semantic provider payload и удаляет context после materialization audit. Provider content и дополнительные context fields fail closed.

Final verification:

```text
focused envelope + recovery: 23/23 PASS
relevant Worker: 171 total / 170 pass / 1 accepted immutable-beta-hash failure
full: 370 total / 364 pass / exact 6 accepted failures
```

Exact six failures не изменились: intentional procurement-subject current-scope gate; два Aggregator A/B report/hash gates; immutable Worker beta hash; Validator prompt CRLF/LF mismatch; Targeted Recheck coordinate prompt mismatch. JSON/Code syntax/graph checks, `git diff --check`, secret и client-document literal scans прошли.

```text
RED actionable: procurement_subject FIELD_RULES contain the universal current-scope boundary
RED A/B runtime report contains the full execution, artifact, response, oracle, and exit audit
RED A/B harness refuses canonical production workflow and preserves fixture and beta SHA-256
immutable beta Worker snapshot retains its reviewed packaging hash
v1.2 prompt artifact is an exact clean copy of the imported validator system prompt
Targeted Recheck prompt aligns evidence coordinates with both trusted sources
```

Production n8n, PostgreSQL и credentials не изменялись; paid AI и push не выполнялись. Runtime canary остаётся pending, поэтому Stage 2 не является runtime complete и execution `14359` не объявляется исправленным в production.

Неблокирующий audit debt: pre-existing `extractor.provider = deepseek` остаётся legacy полем, несмотря на GLM primary и Gemini fallback. Authoritative actual aliases и `primary|fallback` source записаны в bounded `extractor.attempt_audit`; отдельная versioned migration legacy field отложена.
