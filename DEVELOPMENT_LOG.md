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
