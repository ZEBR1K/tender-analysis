# ТЕНДЕРЫ ОРКЕСТРАТОР

**Статус:** Active development / MVP  
**Последнее обновление:** 2026-08-22  
**Тип:** root workflow / orchestrator  
**Точное имя workflow в n8n:** `ТЕНДЕРЫ ОРКЕСТРАТОР`  
**Точка входа:** manual trigger  
**Вызывает:** `TENDER — Обработать документ`  
**Error Workflow:** не настроен  
**Основной источник:** TenderPlan FullInfo API  
**Основной PostgreSQL credential:** `KITATEH Tenders`

---

# 1. Назначение

`ТЕНДЕРЫ ОРКЕСТРАТОР` — корневой workflow текущего тендерного анализа.

Он отвечает за запуск анализа одной закупки и подготовку всех документов к независимой обработке.

Основная задача:

```text
tender_id
→ получить полную карточку TenderPlan
→ нормализовать tender metadata
→ создать analysis_run
→ зарегистрировать ВСЕ документы
→ перевести run в processing
→ развернуть документы в отдельные items
→ запустить Document Worker для каждого документа
```

Orchestrator сам:

- не скачивает документы;
- не парсит файлы;
- не вызывает AI Extractor;
- не создаёт facts;
- не агрегирует 27 полей;
- не формирует финальный отчёт.

Эта работа делегируется downstream workflow.

---

# 2. Место в общей системе

```text
ТЕНДЕРЫ ОРКЕСТРАТОР
        |
        v
TenderPlan FullInfo
        |
        v
Normalize tender card
        |
        v
Create analysis_run
        |
        v
Register ALL documents
        |
        v
Split documents
        |
        v
TENDER — Обработать документ
        |
        v
Document Worker per document
        |
        v
all documents completed
        |
        v
ready_for_aggregation
        |
        v
TENDER — Агрегация закупки
```

---

# 3. Текущая архитектура

```text
When clicking ‘Execute workflow’
        |
        v
id тендера 2
        |
        v
получить полную информацию о тендере
        |
        v
нормализовать карточку
        |
        v
Создать запуск анализа
        |
        v
Зарегистрировать документы
        |
        v
разделить документы
        |
        v
ВРЕМЕННЫЙ ФИЛЬТР РАСШИРЕНИЯ
        |
        v
Запустить обработку документа
        |
        v
TENDER — Обработать документ
```

### Productive path

Показанный выше исполняемый productive path содержит:

```text
9 nodes
```

### Physical inventory

По актуальному JSON workflow физически содержит:

```text
43 nodes
```

При этом workflow имеет `active=false`. Отдельно существует trigger-connected dead-end node `id тендера 1`; ещё 33 nodes являются trigger-unreachable / legacy, из них 7 disabled. Назначение этих unreachable legacy nodes в этой документации не фиксируется.

---

# 4. Точка входа

## `When clicking ‘Execute workflow’`

Тип:

```text
Manual Trigger
```

Текущая версия workflow запускается вручную из n8n.

Это development/MVP entry point.

Production trigger пока не реализован.

---

# 5. `id тендера 2`

Тип:

```text
Set
```

Сейчас задаёт вручную:

```text
tender_id
```

Пример:

```text
6a7ef6ac3951804ff32da751
```

Это временный development input.

В будущем источник `tender_id` может быть:

- webhook;
- Telegram;
- Bitrix;
- scheduler;
- другой workflow;
- внешний frontend/API.

Важно:

downstream архитектура уже опирается только на:

```text
tender_id
```

поэтому смена trigger не требует переписывания остальной логики Orchestrator.

---

# 6. TenderPlan FullInfo

## `получить полную информацию о тендере`

Тип:

```text
HTTP Request
```

Метод:

```text
GET
```

Endpoint:

```text
https://tenderplan.ru/api/tenders/v2/fullinfo
```

Query:

```text
id = tender_id
```

Authentication:

```text
HTTP Header Auth
```

Credential:

```text
Тендерплан kitateh n8n автоматизация тендеров
```

---

# 7. Реальный TenderPlan response

FullInfo возвращает root object с ключами:

```text
tender
tenderInfo
lawyers
tasks
```

Главная рабочая сущность:

```text
tender
```

В реальном pin data присутствуют, среди прочего:

```text
_id
number
id
eid
orderName
maxPrice
status
kind
type
placingWay

publicationDateTime
receiveDateTime
submissionStartDateTime
submissionCloseDateTime
scoringDateTime
summingUpDateTime
updateDateTime

customers
platform
href

prepayment
guaranteeApp
guaranteeContract
guaranteeProv

okpd2
okpd
ktru

smp
multilot
isChanged
isDeleted

attachments
```

В raw source также могут присутствовать данные, которые пока не нормализуются, например:

```text
participants
tenderInfo.protocols
tenderInfo.contracts
tenderInfo.bankGuarantees
json
notification
```

---

# 8. `нормализовать карточку`

Тип:

```text
Code Node
runOnceForEachItem
```

Назначение:

```text
raw TenderPlan FullInfo
→ normalized tender_meta
→ normalized attachments[]
→ raw_source
```

---

# 9. Проверка TenderPlan response

Нода требует:

```javascript
input.tender
```

Если `tender` отсутствует:

```text
hard error
```

Сообщение:

```text
TenderPlan response does not contain "tender"
```

---

# 10. Нормализация дат

TenderPlan отдаёт timestamps в миллисекундах.

Функция:

```text
Unix timestamp ms
→ ISO 8601
```

Если timestamp:

- null;
- undefined;
- invalid;

результат:

```text
null
```

---

# 11. Определение расширения

Расширение извлекается только из:

```text
file.realName
```

Логика намеренно ничего не додумывает.

Пример:

```text
Проект договора.pdf
→ pdf
```

Если расширение определить нельзя:

```text
file_extension = null
```

---

# 12. Normalized attachments

Для каждого TenderPlan attachment формируется:

```json
{
  "document_index": 1,
  "file_name": "Проект договора.pdf",
  "file_extension": "pdf",
  "display_name": "Проект договора.pdf",
  "download_url": "https://...",
  "publication_at": "2026-08-14T11:05:03.000Z",
  "source_size": null
}
```

### `document_index`

Формируется как:

```text
index + 1
```

То есть начинается с:

```text
1
```

Это согласуется с DB CHECK:

```text
document_index > 0
```

---

# 13. Customers normalization

TenderPlan может вернуть несколько заказчиков.

Нода не ограничивается первым.

Формируется:

```json
[
  {
    "id": "...",
    "name": "...",
    "region": 77
  }
]
```

Все заказчики сохраняются в:

```text
tender_meta.customers
```

Для удобства отдельно:

```text
tender_meta.primary_customer = customers[0] ?? null
```

Важно:

`primary_customer` — convenience field.

Это не означает, что остальные заказчики потеряны.

---

# 14. Контракт `tender_meta`

Текущий normalized contract:

```text
source
tender_id
tender_number
tender_external_id
eid

title
max_price
currency

region
status
kind
type
placing_way

publication_at
receive_at
submission_start_at
submission_close_at
scoring_at
summing_up_at
updated_at_source

customers
primary_customer

platform.name
platform.url

tender_url

prepayment
guarantee_application
guarantee_contract
guarantee_provision

okpd2
okpd
ktru

smp
multilot
is_changed
is_deleted

documents_count
```

---

# 15. Важные решения нормализации

## Currency

Если TenderPlan не передал валюту:

```text
currency = null
```

Система не подставляет RUB самостоятельно.

## Multiple customers

Сохраняются все.

## TenderPlan structured guarantees

Если TenderPlan уже отдаёт:

```text
prepayment
guaranteeApp
guaranteeContract
guaranteeProv
```

они сохраняются в `tender_meta`.

Но их наличие не означает, что все соответствующие FINAL-поля автоматически закрываются через metadata.

Решение о deterministic mapping принимается отдельно в Aggregator / FIELD_CATALOG.

---

# 16. Output `нормализовать карточку`

Нода возвращает:

```json
{
  "tender_meta": {},
  "attachments": [],
  "raw_source": {}
}
```

`raw_source` содержит полный исходный TenderPlan response на этом этапе.

См. `OR-3`: дальше он сейчас не сохраняется.

---

# 17. `Создать запуск анализа`

Тип:

```text
PostgreSQL
Execute Query
```

Назначение:

```text
создать root analysis_run
```

Таблица:

```text
tender_analysis_runs
```

---

# 18. INSERT analysis_run

Вставляются:

```text
source
tender_id
tender_number
tender_external_id
status
documents_total
tender_meta
```

Первичный статус:

```text
created
```

`documents_total` на этом шаге:

```text
attachments.length
```

---

# 19. Output `Создать запуск анализа`

Нода возвращает:

```text
analysis_run_id
source
tender_id
tender_number
tender_external_id
status
documents_total
tender_meta
attachments
created_at
updated_at
```

Важно:

`attachments` не читаются из БД, а возвращаются через:

```text
$7::jsonb
```

чтобы downstream регистрация документов продолжила работать.

---

# 20. Реальный example run

Из pin data:

```text
analysis_run_id:
18f3eaee-528d-4bc1-8d72-a1ea2f313df2

status:
created

documents_total:
3
```

---

# 21. `Зарегистрировать документы`

Тип:

```text
PostgreSQL
Execute Query
```

Это одна из ключевых архитектурных нод.

Она выполняет две операции:

```text
1. зарегистрировать ВСЕ документы
2. перевести run в processing
```

---

# 22. Почему документы регистрируются заранее

Критичный invariant:

> Все документы закупки должны существовать в `tender_analysis_documents` до старта первого Document Worker.

Это необходимо для корректного readiness check.

Иначе система не могла бы надёжно определить:

```text
сколько документов существует всего
сколько completed
сколько pending
сколько processing
сколько failed
```

---

# 23. Input documents parsing

SQL использует:

```sql
jsonb_array_elements($2::jsonb)
```

и извлекает:

```text
document_index
file_name
file_extension
display_name
download_url
publication_at
source_size
```

---

# 24. UPSERT documents

Таблица:

```text
tender_analysis_documents
```

Первичный status:

```text
pending
```

Conflict key:

```text
(analysis_run_id, document_index)
```

При conflict обновляются metadata документа:

```text
file_name
file_extension
display_name
download_url
publication_at
source_size
```

---

# 25. Output registered documents

После UPSERT PostgreSQL возвращает:

```text
document_id
analysis_run_id
document_index
file_name
file_extension
display_name
download_url
publication_at
source_size
status
```

Это принципиально важный переход:

```text
TenderPlan attachment
→ внутренний зарегистрированный document
```

После этой точки downstream работает уже с:

```text
document_id
```

нашей БД.

---

# 26. `documents_json`

SQL агрегирует зарегистрированные документы обратно в массив:

```text
attachments[]
```

и считает:

```text
registered_documents_count
```

---

# 27. Run transition

После регистрации документов:

```text
run.status
created
→
processing
```

Также:

```text
documents_total = registered_documents_count
```

Это полезно, потому что фактическое число зарегистрированных документов становится source of truth для run.

---

# 28. Output после регистрации

Реальный контракт:

```json
{
  "analysis_run_id": "uuid",
  "source": "tenderplan",
  "tender_id": "...",
  "tender_number": "...",
  "tender_external_id": "...",

  "status": "processing",

  "documents_total": 3,
  "registered_documents_count": 3,

  "tender_meta": {},

  "attachments": [
    {
      "status": "pending",
      "document_id": "uuid",
      "document_index": 1,
      "file_name": "...",
      "file_extension": "xlsx",
      "download_url": "..."
    }
  ]
}
```

---

# 29. `разделить документы`

Тип:

```text
Split Out
```

Field:

```text
attachments
```

Сохраняет рядом:

```text
analysis_run_id
tender_meta
```

Если было:

```text
attachments.length = 3
```

выход:

```text
3 items
```

---

# 30. Raw Document Worker input

После Split Out каждый item имеет вид:

```json
{
  "attachments": {
    "status": "pending",
    "file_name": "Проект договора.pdf",
    "document_id": "uuid",
    "source_size": null,
    "display_name": "Проект договора.pdf",
    "download_url": "https://...",
    "document_index": 2,
    "file_extension": "pdf",
    "publication_at": "2026-08-14T11:05:03+00:00"
  },

  "analysis_run_id": "uuid",

  "tender_meta": {}
}
```

Это текущий фактический input contract workflow:

```text
TENDER — Обработать документ
```

---

# 31. `ВРЕМЕННЫЙ ФИЛЬТР РАСШИРЕНИЯ`

Тип:

```text
Filter
```

Пропускает только:

```text
xlsx
docx
pdf
```

Условие:

```text
OR
```

по:

```text
attachments.file_extension
```

---

# 32. Текущий смысл фильтра

Это временное ограничение текущей document-processing реализации.

Фактически:

```text
xlsx → Worker
docx → Worker
pdf  → Worker

остальное → execution branch ends
```

FALSE output не подключён.

Это создаёт критичный edge case `OR-0`.

---

# 33. `Запустить обработку документа`

Тип:

```text
Execute Workflow
```

Workflow:

```text
TENDER — Обработать документ
```

Workflow ID:

```text
1Pw61ZY3HgBSvcUr
```

Mode:

```text
each
```

То есть:

```text
1 input item
→ 1 child workflow execution
```

---

# 34. Wait behavior

Настройка:

```text
waitForSubWorkflow = true
```

Следовательно, parent execution ждёт завершения вызванного child execution.

При нескольких input items n8n запускает child workflow для каждого item согласно режиму `each`.

Текущий parent workflow после этой ноды не имеет дальнейшей логики.

---

# 35. Что Orchestrator НЕ делает после Worker

После:

```text
Запустить обработку документа
```

Orchestrator заканчивается.

Он не:

- собирает ответы child workflows;
- проверяет completed documents;
- запускает Aggregator напрямую;
- переводит run в ready_for_aggregation;
- строит report.

Readiness/aggregation initiation реализованы downstream через document completion logic.

---

# 36. Lifecycle run внутри Orchestrator

Orchestrator отвечает за:

```text
CREATE:
created

после регистрации документов:
processing
```

Не отвечает за:

```text
ready_for_aggregation
aggregating
completed
```

---

# 37. Lifecycle documents внутри Orchestrator

Orchestrator создаёт документы как:

```text
pending
```

Document Worker отвечает дальше за:

```text
pending
→ processing
→ completed / failed
```

---

# 38. Основные invariants

1. Один запуск Orchestrator создаёт один новый `analysis_run`.
2. `analysis_run_id` генерируется PostgreSQL.
3. Все TenderPlan attachments нормализуются до регистрации.
4. Все документы должны быть зарегистрированы до запуска Workers.
5. Каждый зарегистрированный документ получает внутренний `document_id`.
6. `document_index` начинается с 1.
7. `(analysis_run_id, document_index)` уникален.
8. После регистрации run переводится в `processing`.
9. `documents_total` после регистрации равен `registered_documents_count`.
10. Split Out должен выполняться только после регистрации документов.
11. Document Worker должен получать внутренний `document_id`.
12. Один document item вызывает один `TENDER — Обработать документ`.
13. `tender_meta` сохраняется на уровне run и одновременно передаётся Worker как context.
14. Ошибка в любом основном node сейчас не обрабатывается отдельным Error Workflow.
15. Production trigger пока отсутствует.

---

# 39. Проверенный реальный сценарий

Тестовая закупка:

```text
tender_id:
6a7ef6ac3951804ff32da751
```

TenderPlan вернул:

```text
3 attachments
```

Типы:

```text
xlsx
pdf
docx
```

Run:

```text
created
→ processing
```

Зарегистрировано:

```text
3 / 3 documents
```

После Split Out:

```text
3 items
```

Все три прошли temporary extension filter.

Document Worker был вызван для каждого.

Pin output Execute Workflow:

```json
{
  "success": true
}
```

---

# 40. Known Technical Debt

## OR-0 — Unsupported files регистрируются, но не обрабатываются

**Severity:** Critical  
**Status:** Open

Текущий порядок:

```text
Register ALL attachments
        ↓
documents_total = N
        ↓
Split Out
        ↓
Filter pdf/docx/xlsx
        ↓
Worker only for supported formats
```

Если TenderPlan вернёт:

```text
.doc
.xls
.pptx
.txt
zip
или другой unsupported type
```

такой document уже существует в БД:

```text
status = pending
```

но Worker не запустится.

Readiness logic затем увидит:

```text
pending_documents_count > 0
```

и run потенциально навсегда останется:

```text
processing
```

### Требуемое будущее решение

Нельзя просто удалить такие документы из регистрации, потому что это скроет часть исходной закупки.

Корректное направление:

```text
unsupported document
→ явно классифицировать
→ status = skipped или failed
→ reason сохранить
→ readiness учитывает terminal status
```

Точная реализация будет выбрана позже.

---

## OR-1 — Zero documents edge case

**Severity:** Medium  
**Status:** To verify

Если:

```text
attachments = []
```

происходит:

```text
run created
documents_total = 0

Зарегистрировать документы
→ run processing
```

Но:

```text
Split Out
→ 0 items
```

Document Worker не запускается.

Если именно Worker completion запускает readiness logic, некому перевести run в:

```text
ready_for_aggregation
```

Потенциальный зависший run:

```text
processing
documents_total=0
```

Нужно отдельно протестировать.

---

## OR-2 — Manual trigger + hardcoded tender_id

**Severity:** Expected MVP limitation  
**Status:** Open

Сейчас:

```text
Manual Trigger
→ hardcoded Set tender_id
```

Это development-only entry point.

Не является ошибкой текущего MVP, но production entry point ещё не спроектирован.

---

## OR-3 — `raw_source` не сохраняется дальше normalization node

**Severity:** Low / Medium  
**Status:** Open

`нормализовать карточку` возвращает:

```text
raw_source = full TenderPlan response
```

Комментарий говорит, что полный источник сохраняется на случай будущих полезных полей.

Но:

```text
Создать запуск анализа
```

не:

- пишет `raw_source` в PostgreSQL;
- возвращает его downstream.

После этой ноды raw source теряется из normal data path.

### Возможные будущие варианты

1. хранить `raw_source` в отдельной JSONB колонке;
2. отдельная source snapshots table;
3. сознательно не хранить, а исправить комментарий.

Не MVP blocker.

---

## OR-4 — Поддержка расширений ограничена

**Severity:** Medium  
**Status:** Open

Текущий supported set:

```text
pdf
docx
xlsx
```

Реальные тендеры потенциально содержат:

```text
doc
xls
ppt
pptx
images
archives
и другие типы
```

Связано с `OR-0`.

---

## OR-5 — Error Workflow не настроен

**Severity:** Medium  
**Status:** Open

В Workflow Settings:

```text
Error Workflow = none
```

Следовательно, ошибка:

- TenderPlan HTTP;
- Code Node;
- PostgreSQL;
- Execute Workflow;

не имеет отдельного централизованного error-handler на уровне Orchestrator.

Текущий проект имеет отдельный Error Workflow как системную сущность, но данный workflow к нему сейчас не подключён.

До production hardening это нужно исправить.

---

## OR-6 — TenderPlan request не имеет явной retry policy

**Severity:** Medium  
**Status:** Open

HTTP Request к TenderPlan может временно упасть из-за:

- timeout;
- 5xx;
- network error;
- rate limiting;
- auth issue.

В текущем Orchestrator нет отдельной retry/backoff ветки.

Не обязательно чинить до первого интеграционного MVP, но важно перед production.

---

## OR-7 — Новый run создаётся при каждом ручном запуске

**Severity:** Low / design decision  
**Status:** Open

`Создать запуск анализа` всегда делает новый INSERT.

То есть повторный анализ того же:

```text
tender_id
```

создаст новый:

```text
analysis_run_id
```

Это может быть корректной исторической моделью:

```text
1 tender
→ many analysis runs
```

Но политика повторного запуска пока явно не задокументирована:

- разрешены ли параллельные runs одного tender;
- нужен ли dedup активного анализа;
- когда считать новый run повторным анализом.

Для MVP текущая модель допустима.

---

# 41. Что НЕ является проблемой

## Все документы регистрируются одним SQL до Split Out

Это правильное архитектурное решение.

## `documents_total` сначала attachments.length, затем registered count

Финальное значение после registration корректируется фактическим числом зарегистрированных строк.

## `primary_customer`

Это convenience shortcut, а не потеря остальных customers.

## `currency = null`

Правильно лучше сохранить null, чем додумать RUB.

## FullInfo raw response содержит больше данных, чем tender_meta

Это нормально. `tender_meta` намеренно является нормализованной projection.

---

# 42. Safe Modification Checklist

Перед изменением Orchestrator:

1. Не запускать первый Worker до регистрации всех документов.
2. Не терять `document_id`.
3. Не менять `document_index` после регистрации.
4. Проверять, что `documents_total == registered_documents_count`.
5. Не фильтровать документ так, чтобы он навсегда оставался `pending`.
6. Если добавляется unsupported/skipped path — сохранить reason.
7. Не подставлять значения TenderMeta, которых TenderPlan не сообщил.
8. Сохранять всех customers.
9. При добавлении нового TenderMeta mapping сверять с `FIELD_CATALOG.md`.
10. Не смешивать source metadata и evidence из документов без явного правила.
11. Если меняется child input — синхронно обновить `document-worker.md`.
12. При добавлении production trigger не менять downstream contract без необходимости.
13. При подключении Error Workflow проверить duplicate notifications.
14. При retry TenderPlan не создавать дублирующий run до успешного получения карточки.

---

# 43. Regression Checklist

## O1 — valid tender

Input:

```text
valid tender_id
```

Ожидание:

```text
TenderPlan FullInfo получен
```

---

## O2 — missing `tender`

Ожидание:

```text
hard error в normalize
```

---

## O3 — three supported attachments

Input:

```text
pdf
docx
xlsx
```

Ожидание:

```text
registered_documents_count = 3
documents_total = 3
3 Worker calls
```

---

## O4 — registration order

Ожидание:

```text
все rows tender_analysis_documents существуют
до первого Worker call
```

---

## O5 — document identity

Ожидание:

```text
каждый Worker получает document_id из PostgreSQL
```

---

## O6 — run status

После create:

```text
created
```

После document registration:

```text
processing
```

---

## O7 — duplicate document index

Ожидание:

```text
UPSERT existing row
нет duplicate row
```

---

## O8 — unsupported extension

Текущее поведение:

```text
document registered pending
Worker не вызывается
```

Это демонстрирует `OR-0`.

После исправления:

```text
document получает явный terminal status
```

---

## O9 — zero attachments

Требует отдельного теста.

Проверить:

```text
не зависает ли run в processing
```

---

## O10 — TenderPlan transient failure

После future retry:

```text
retry без создания лишнего run
```

---

## O11 — Error Workflow

После future configuration:

```text
workflow error
→ central Error Workflow
```

---

# 44. Ближайшие изменения Orchestrator

До первого MVP не требуется серьёзный redesign.

Приоритет после основной документации:

```text
OR-0
→ корректно закрывать unsupported documents

OR-1
→ zero-documents readiness

OR-5
→ подключить Error Workflow

OR-6
→ retry/backoff TenderPlan
```

Production entry point `OR-2` можно выбирать позднее, когда будет определён пользовательский сценарий запуска анализа.

---

# 45. Краткое резюме

`ТЕНДЕРЫ ОРКЕСТРАТОР` — root workflow, который превращает внешний `tender_id` в полностью зарегистрированный `analysis_run`.

Ключевой путь:

```text
tender_id
→ TenderPlan FullInfo
→ tender_meta + attachments
→ INSERT run
→ UPSERT all documents
→ run processing
→ Split Out
→ one Document Worker per document
```

Главный сильный архитектурный invariant:

```text
ВСЕ документы регистрируются
ДО старта первого Document Worker
```

Это позволяет downstream readiness logic надёжно определить момент, когда закупка готова к агрегации.

Главная текущая проблема:

```text
OR-0:
unsupported files уже зарегистрированы,
но временный filter не запускает для них обработку
и не переводит их в terminal status.
```

Error Workflow для `ТЕНДЕРЫ ОРКЕСТРАТОР` на текущий момент не настроен.
