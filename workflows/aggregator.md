# TENDER — Агрегация закупки

**Статус:** Active development / MVP  
**Последнее обновление:** 2026-08-23
**Тип:** sub-workflow n8n  
**Вызывается:** другим workflow после готовности всех документов  
**Вызывает:** `TENDER - Targeted Recheck`  
**Финальный контракт поля:** `tender\\\_field\\\_final\\\_v1`  
**Каталог полей:** `tender\\\_fields\\\_v1`  
**AI transport:** Polza AI (`https://polza.ai/api/v1/chat/completions`)
**Основная модель Semantic Aggregator:** `deepseek/deepseek-v4-pro-0813`
**Reasoning:** через alias модели `@reasoning_effort=low`

\---

## 1\. Назначение

`TENDER — Агрегация закупки` собирает результаты анализа всех документов одного `analysis\\\_run`, раскладывает candidate facts по 27 полям каталога `tender\\\_fields\\\_v1` и определяет финальный путь разрешения каждого поля.

Workflow не извлекает новые facts из документов.

Его задача:

1. в intended architecture атомарно захватить готовый `analysis\\\_run` для агрегации;
2. загрузить документы, TenderMeta и candidate facts;
3. создать **ровно 27 field items**;
4. для полей с candidates выполнить Semantic Aggregator Round 1;
5. для полей без candidates попробовать deterministic TenderMeta Resolver;
6. при необходимости передать поле в `TENDER - Targeted Recheck`;
7. для полей, закрытых внутри Aggregator, сформировать `tender\\\_field\\\_final\\\_v1`;
8. сохранить FINAL field в PostgreSQL.

&#x20;   	Для полей, переданных в Targeted Recheck, дальнейшая финализация происходит вне текущего execution Aggregator через отдельный sub-workflow.

Atomic claim фактически исполняется перед загрузкой фактов: execution `13856` подтвердил `aggregation_claimed=true`. После независимых FINAL UPSERT Aggregator вызывает `TENDER — Финализация анализа`, который выполняет DB-backed 27/27 barrier и atomic completion claim. Downstream Report Generation V2 — отдельный read-only workflow, создающий HTML artifact; подробный контракт находится в `workflows/report-generation.md`.

### Downstream finalization

```text
Aggregator / Targeted Recheck
→ UPSERT tender_analysis_field_results
→ TENDER — Финализация анализа
→ COUNT(unique field_key) = 27
→ atomic aggregating → completed
→ TENDER — Генерация отчета (Report Generation V2)
```

Finalization workflow ID: `cSsh9yjpS7t5p0OO`. Report Generation workflow ID: `ckPnP3hRhKu4Mf9u`.

\---

## 2\. Место в общей системе

```text
Orchestrator / Document Workers
        |
        v
Все документы зарегистрированы и обработаны
        |
        v
run.status = ready\\\_for\\\_aggregation
        |
        v
TENDER — Агрегация закупки
        |
        |-- candidates есть
        |      |
        |      v
        |  Semantic Aggregator Round 1
        |      |
        |      +-- resolved
        |      |     |
        |      |     v
        |      |   FINAL -> DB
        |      |
        |      `-- requires\\\_recheck
        |            |
        |            v
        |      TENDER - Targeted Recheck
        |            |
        |            v
        |           DB
        |
        `-- candidates нет
               |
               v
          TenderMeta Resolver
               |
               +-- resolved
               |     |
               |     v
               |   FINAL -> DB
               |
               `-- unresolved
                     |
                     v
              TENDER - Targeted Recheck

\&#x20;                    |

\&#x20;       	     +-- direct FINAL

\&#x20;       	     |

\&#x20;        	     +-- Semantic Aggregator Round 2

\&#x20;        	     |

\&#x20;       	     +-- requires\\\_review

\&#x20;       	     |

\&#x20;       	     +-- not\\\_found

\&#x20;       	     |

\&#x20;       	     v

\&#x09;	tender\\\_field\\\_final\\\_v1

\&#x20;       	     |

\&#x20;       	     v

\&#x09;  	 UPSERT DB

\\---

## 3\\. Текущая граница ответственности

Aggregator отвечает за:

\* intended atomic claim run;
\* загрузку агрегируемых данных;
\* fan-out в 27 полей;
\* Round 1 semantic aggregation;
\* deterministic TenderMeta fallback;
\* отправку проблемных полей в Targeted Recheck;
\* локальную финализацию resolved-полей;
\* сохранение своих FINAL-полей в `tender\\\_analysis\\\_field\\\_results`.

Aggregator \*\*не отвечает в текущей версии\*\* за:

\* ожидание завершения всех Targeted Recheck executions;
\* проверку, что в БД появилось ровно 27 FINAL-полей;
\* перевод `analysis\\\_run` из `aggregating` в `completed`;
\* генерацию Markdown/XLSX отчёта;
\* отправку отчёта в Telegram.



Важно:



После передачи field item в Targeted Recheck текущий execution Aggregator больше не ожидает ответ.



Targeted Recheck самостоятельно:

\\- выполняет дополнительный анализ;

\\- формирует FINAL;

\\- сохраняет результат через UPSERT.

\\---

## 4\\. RAW INPUT CONTRACT

Workflow запускается через `When Executed by Another Workflow`.

Реальный пример входа из pin data:

```json
{
  "analysis\\\_run\\\_id": "18f3eaee-528d-4bc1-8d72-a1ea2f313df2",
  "previous\\\_run\\\_status": "processing",
  "run\\\_status": "ready\\\_for\\\_aggregation",
  "documents\\\_total": 3,
  "registered\\\_documents\\\_count": 3,
  "completed\\\_documents\\\_count": 3,
  "pending\\\_documents\\\_count": 0,
  "processing\\\_documents\\\_count": 0,
  "failed\\\_documents\\\_count": 0,
  "skipped\\\_documents\\\_count": 0,
  "ready\\\_at": "2026-08-21T15:12:48.500Z",
  "should\\\_start\\\_aggregation": true,
  "readiness\\\_reason": "all\\\_documents\\\_completed"
}
```

Для текущего Aggregator реально критичен прежде всего:

```text
analysis\\\_run\\\_id
```

Остальная readiness-информация приходит от upstream и полезна для provenance/debugging. Atomic claim остаётся intended invariant, но текущий production execution graph его обходит.

\---

## 5\. Полная архитектура workflow

```text
When Executed by Another Workflow
        |
        v
Загрузить факты закупки
                     |
                     v
           Сгруппировать факты по полям
                    |
                    v
              Есть кандидаты?
             /              \\\\
          TRUE              FALSE
           |                  |
           v                  v
  Подготовить запрос     Разрешить поле
  Semantic Aggregator   из TenderMeta
           |                  |
           v                  v
  Semantic Aggregator   Поле закрыто
           |             из TenderMeta?
           v               /        \\\\
  Проверить ответ       TRUE        FALSE
  Semantic Aggregator    |            |
           |             v            v
           v         FINAL Meta   TENDER -
   Нужен Targeted        |         Targeted
      Recheck?           v         Recheck
      /     \\\\         Normalize        |
   TRUE     FALSE        |             v
    |         |          v            DB
    |         v         DB
    |     FINAL Round 1
    |         |
    |         v
    |      Normalize
    |         |
    |         v
    |        DB
    |
    v
TENDER - Targeted Recheck
    |
    v
   DB
```

\---

## 6\. Stage 0 — Trigger

### `When Executed by Another Workflow`

**Получает:** один run item от upstream workflow.

**Назначение:** передать контекст текущего `analysis\\\_run` в Aggregator.

**Ключевое поле:**

```text
analysis\\\_run\\\_id
```

\---

## 7\. Intended Stage 1 — Atomic Run Claim

`Захватить run для агрегации` и `Продолжать агрегацию?` входят в актуальный исполняемый путь. Execution `13856` подтвердил `aggregation_claimed=true` и переход run в `aggregating`.

### `Захватить run для агрегации`

В intended architecture PostgreSQL-нода атомарно переводит run:

```text
ready\\\_for\\\_aggregation
→
aggregating
```

Условие UPDATE:

```sql
WHERE id = $1::uuid
  AND status = 'ready\\\_for\\\_aggregation'
```

При успешном claim возвращается:

```text
aggregation\\\_claimed = true
```

Если другой execution уже захватил run или run имеет другой статус:

```text
aggregation\\\_claimed = false
```

Также заполняется:

```text
aggregation\\\_started\\\_at
updated\\\_at
```

### Зачем нужен claim

Защита от конкурентного двойного запуска Aggregator для одного `analysis\\\_run`.

\---

### `Продолжать агрегацию?` (intended architecture)

Проверяет:

```text
aggregation\\\_claimed === true
```

#### TRUE

Продолжаем Aggregator.

#### FALSE

Execution заканчивается без дальнейшей обработки.

\---

## 8\. Stage 2 — Load Aggregation Dataset

### `Загрузить факты закупки`

Нода собирает единый dataset текущей закупки из PostgreSQL.

### Читает

```text
tender\\\_analysis\\\_runs
tender\\\_analysis\\\_documents
tender\\\_analysis\\\_facts
```

### Из `tender\\\_analysis\\\_runs`

Получает:

```text
analysis\\\_run\\\_id
tender\\\_id
tender\\\_number
tender\\\_external\\\_id
run\\\_status
documents\\\_total
tender\\\_meta
```

`tender\\\_meta` является структурированным источником данных для deterministic Metadata Resolver.

### Из `tender\\\_analysis\\\_documents`

Формирует `documents\\\[]` с данными о каждом документе.

### Из `tender\\\_analysis\\\_facts`

В массив `facts\\\[]` попадают только facts с:

```text
validator\\\_verdict = confirmed
или
validator\\\_verdict = requires\\\_review
```

Rejected facts в Semantic Aggregator не передаются.

### Статистика facts

Рассчитываются:

```text
facts\\\_total
confirmed\\\_count
requires\\\_review\\\_count
rejected\\\_count
aggregation\\\_candidates\\\_count
```

Важно:

```text
facts\\\_total
```

включает все facts run, а:

```text
aggregation\\\_candidates\\\_count
```

равен числу facts, реально допущенных в агрегацию.

\---

## 9\. Stage 3 — Expand to 27 Field Items

### `Сгруппировать факты по полям`

Эта нода превращает:

```text
1 dataset item
+
N candidate facts
```

в:

```text
ровно 27 field items
```

по фиксированному каталогу:

```text
tender\\\_fields\\\_v1
```

### 27 field\_key

1. `procurement\\\_subject`
2. `nm\\\_price\\\_with\\\_vat`
3. `platform`
4. `procedure\\\_type`
5. `application\\\_deadline`
6. `application\\\_review\\\_date`
7. `results\\\_date`
8. `customer`
9. `customer\\\_contacts`
10. `participation\\\_cost`
11. `participation\\\_guarantee`
12. `evaluation\\\_criteria`
13. `delivery\\\_term`
14. `payment\\\_terms`
15. `special\\\_account\\\_or\\\_treasury`
16. `bank\\\_support`
17. `government\\\_contract`
18. `rebidding`
19. `national\\\_regime`
20. `advance\\\_contract\\\_guarantee`
21. `warranty\\\_obligations\\\_guarantee`
22. `licenses\\\_certificates`
23. `required\\\_official\\\_certificates`
24. `similar\\\_supply\\\_experience`
25. `analog\\\_allowed`
26. `analog\\\_definition`
27. `application\\\_documents`

Группы создаются заранее, поэтому поле без facts не исчезает.

### Контракт field item

```json
{
  "analysis\\\_run\\\_id": "uuid",
  "field\\\_catalog\\\_version": "tender\\\_fields\\\_v1",
  "field\\\_index": 16,
  "field\\\_key": "bank\\\_support",
  "has\\\_candidates": false,
  "candidates\\\_count": 0,
  "confirmed\\\_count": 0,
  "requires\\\_review\\\_count": 0,
  "source\\\_documents\\\_count": 0,
  "source\\\_documents": \\\[],
  "candidates": \\\[]
}
```

### Guards

Неизвестный `field\\\_key` в загруженных facts вызывает hard error.

\---

## 10\. Stage 4 — First Routing

### `Есть кандидаты?`

Условие:

```text
has\\\_candidates === true
```

### TRUE

Поле идёт в Semantic Aggregator Round 1.

### FALSE

Поле идёт в deterministic TenderMeta Resolver.

\---

## 11\. Stage 5 — Semantic Aggregator Round 1

### `Подготовить запрос Semantic Aggregator`

**Получает:** один field item с `candidates\\\[]`.

### Проверяет

```text
analysis\\\_run\\\_id
field\\\_key
candidates должен быть массивом
fact\\\_id должен существовать у каждого candidate
```

### FIELD\_RULES

Round 1 `FIELD\\\_RULES` содержит правила для всех 27 полей.

Структура одного field rule:

```json
{
  "title": "...",
  "definition": "...",
  "rules": \\\["..."]
}
```

### Подготавливает candidates для AI

Из evidence удаляются тяжёлые технические поля.

Остаются:

```text
quote
type
role
page\\\_from
page\\\_to
sheet\\\_name
semantic\\\_block\\\_id
```

\---

## 12\. Semantic Aggregator Round 1 — роль AI

### `Semantic Aggregator`

**Модель:** `deepseek/deepseek-v4-pro-0813@reasoning_effort=low` через Polza AI

Настройки:

```text
thinking = enabled
reasoning\\\_effort = low
response\\\_format = json\\\_object
max\\\_tokens = 8192
timeout = 180000 ms
```

Semantic Aggregator:

* не извлекает новые facts;
* работает только с переданными candidates;
* классифицирует отношения между candidates;
* формирует итоговое значение поля;
* решает, достаточно ли evidence для resolved.

### Candidate roles

```text
primary
duplicate
supporting
complement
conflict
not\\\_applicable
```

### Допустимые Round 1 statuses

```text
resolved
requires\\\_recheck
```

### Допустимые `recheck\\\_reason\\\_code`

```text
conflicting\\\_candidates
insufficient\\\_evidence
ambiguous\\\_scope
no\\\_reliable\\\_candidate
other
```

\---

## 13\. Round 1 AI output contract

```json
{
  "field\\\_key": "string",
  "status": "resolved | requires\\\_recheck",
  "final\\\_value\\\_text": "string | null",
  "confidence": 0.0,
  "candidate\\\_decisions": \\\[
    {
      "fact\\\_id": "uuid",
      "role": "primary | duplicate | supporting | complement | conflict | not\\\_applicable",
      "reason": "..."
    }
  ],
  "supporting\\\_fact\\\_ids": \\\[],
  "conflict\\\_fact\\\_ids": \\\[],
  "needs\\\_recheck": false,
  "recheck\\\_reason\\\_code": null,
  "recheck\\\_note": null
}
```

\---

## 14\. Stage 6 — Deterministic Round 1 Validation

### `Проверить ответ Semantic Aggregator`

Нода не доверяет AI JSON автоматически.

Проверяет:

```text
choices\\\[0] существует
finish\\\_reason = stop
message.content не пуст
валидный JSON
field\\\_key не изменился
status в allow-list
confidence ∈ \\\[0,1]
```

### Candidate decisions

Каждый входной `fact\\\_id` обязан присутствовать ровно один раз.

Запрещено:

* придумывать новые `fact\\\_id`;
* терять входной fact;
* повторять fact дважды.

### Для `resolved`

Обязательно:

```text
final\\\_value\\\_text != empty
needs\\\_recheck = false
recheck\\\_reason\\\_code = null
primaryCount = 1
conflict\\\_fact\\\_ids.length = 0
```

### Для `requires\\\_recheck`

Обязательно:

```text
needs\\\_recheck = true
valid recheck\\\_reason\\\_code
recheck\\\_note != empty
primaryCount <= 1
```

На выходе:

```text
aggregation\\\_validated = true
```

\---

## 15\. Stage 7 — Round 1 Resolution Routing

### `Нужен Targeted Recheck?`

Проверяет:

```text
needs\\\_recheck === true
```

### TRUE

Field item передаётся в:

```text
TENDER - Targeted Recheck
```

Aggregator больше его не финализирует.

### FALSE

Идёт в:

```text
Сформировать FINAL после Round 1
→ Нормализовать FINAL поле1
→ Сохранить FINAL результат поля в БД1
```

\---

## 16\. FINAL after Round 1

### `Сформировать FINAL после Round 1`

Проверяет:

```text
analysis\\\_run\\\_id
field\\\_key
aggregation\\\_validated = true
aggregation\\\_status = resolved
needs\\\_recheck = false
final\\\_value\\\_text != empty
confidence ∈ \\\[0,1]
```

### Evidence

В основной FINAL evidence включаются только роли:

```text
primary
duplicate
supporting
complement
```

Не включаются:

```text
conflict
not\\\_applicable
```

Добавляется provenance:

```text
candidate\\\_ref = fact:<fact\\\_id>
candidate\\\_role
candidate\\\_origin = initial\\\_analysis
candidate\\\_value\\\_text
```

Conflict evidence сохраняется отдельно в audit.

### Результат

```text
aggregation\\\_status = resolved
needs\\\_recheck = false
aggregation\\\_validated = true
requires\\\_human\\\_review = false
resolution\\\_method = semantic\\\_aggregator\\\_round\\\_1
aggregation\\\_round = 1
```

\---

## 17\. Stage 8 — TenderMeta Resolver

FALSE-ветка `Есть кандидаты?`.

### `Разрешить поле из TenderMeta`

Это deterministic fallback.

Отсутствие mapping или значения **не означает `not\\\_found`**.

Оно означает:

```text
metadata\\\_resolved = false
→ Targeted Recheck
```

### Текущие deterministic mappings

```text
platform             → tender\\\_meta.platform
application\\\_deadline → tender\\\_meta.submission\\\_close\\\_at
procurement\\\_subject  → tender\\\_meta.title
customer             → tender\\\_meta.primary\\\_customer.name
```

При успешном resolution:

```text
metadata\\\_resolved = true
aggregation\\\_status = resolved
confidence = 1
resolution\\\_method = deterministic\\\_metadata
```

Metadata Resolver сохраняет:

```text
original\\\_field = input
```

чтобы Targeted Recheck мог распознать `no\\\_initial\\\_candidates`.

\---

## 18\. Stage 9 — TenderMeta Routing

### `Поле закрыто из TenderMeta?`

Условие:

```text
metadata\\\_resolved === true
```

### TRUE

```text
Сформировать FINAL из TenderMeta
→ Нормализовать FINAL поле2
→ Сохранить FINAL результат поля в БД2
```

### FALSE

```text
TENDER - Targeted Recheck
```

\---

## 19\. FINAL from TenderMeta

### `Сформировать FINAL из TenderMeta`

Проверяет:

```text
analysis\\\_run\\\_id
field\\\_key
metadata\\\_resolved = true
aggregation\\\_status = resolved
final\\\_value\\\_text != empty
confidence ∈ \\\[0,1]
evidence.length > 0
```

Формирует:

```text
aggregation\\\_status = resolved
needs\\\_recheck = false
aggregation\\\_validated = true
requires\\\_human\\\_review = false
resolution\\\_method = deterministic\\\_metadata
aggregation\\\_round = null
```

\---

## 20\. Канонический FINAL — `tender\\\_field\\\_final\\\_v1`

Round 1 и TenderMeta ветки проходят через одинаковую логику нормализации.

Основные поля:

```text
result\\\_contract\\\_version
analysis\\\_run\\\_id
field\\\_catalog\\\_version
field\\\_index
field\\\_key
status
value\\\_text
confidence
requires\\\_human\\\_review
resolution\\\_method
evidence
review
not\\\_found
audit
```

Aggregator сам создаёт главным образом `resolved` FINAL-поля.

`requires\\\_review` и `not\\\_found` в текущей архитектуре обычно возникают внутри `TENDER - Targeted Recheck`.

\---

## 21\. PostgreSQL — `tender\\\_analysis\\\_runs`

Корневая сущность одного анализа.

|Колонка|Тип|Nullable|
|-|-|-:|
|`id`|uuid|NO|
|`source`|text|NO|
|`tender\\\_id`|text|NO|
|`tender\\\_number`|text|YES|
|`tender\\\_external\\\_id`|text|YES|
|`status`|text|NO|
|`documents\\\_total`|integer|NO|
|`tender\\\_meta`|jsonb|NO|
|`error\\\_message`|text|YES|
|`created\\\_at`|timestamptz|NO|
|`started\\\_at`|timestamptz|NO|
|`updated\\\_at`|timestamptz|NO|
|`ready\\\_at`|timestamptz|YES|
|`aggregation\\\_started\\\_at`|timestamptz|YES|
|`completed\\\_at`|timestamptz|YES|

PK:

```text
id
```

Актуальный Aggregator lifecycle:

```text
ready\\\_for\\\_aggregation
→ aggregating
```

После field UPSERT Aggregator передаёт управление Finalization workflow; сам Aggregator не является единственным completion claimant.

\---

## 22\. PostgreSQL — `tender\\\_analysis\\\_documents`

Документы одного analysis run.

Ключевые поля:

```text
id
analysis\\\_run\\\_id
document\\\_index
file\\\_name
file\\\_extension
display\\\_name
status
attempts
units\\\_total
facts\\\_count
error\\\_message
started\\\_at
completed\\\_at
```

FK:

```text
analysis\\\_run\\\_id
→ tender\\\_analysis\\\_runs.id
```

Уникальность документа внутри run:

```text
(analysis\\\_run\\\_id, document\\\_index)
```

\---

## 23\. PostgreSQL — `tender\\\_analysis\\\_facts`

Candidate facts до Aggregator.

Ключевые поля:

```text
id
analysis\\\_run\\\_id
document\\\_id
analysis\\\_unit\\\_id
fact\\\_index
field\\\_catalog\\\_version
field\\\_key
value\\\_text

extractor\\\_status
extractor\\\_confidence
extractor\\\_review\\\_reason\\\_code
extractor\\\_review\\\_note

validator\\\_verdict
validator\\\_confidence
validator\\\_reason\\\_code
validator\\\_reason\\\_note

evidence
extractor\\\_meta
validator\\\_meta
```

FK:

```text
analysis\\\_run\\\_id
→ tender\\\_analysis\\\_runs.id
```

Также существует composite связь с `tender\\\_analysis\\\_units`.

\---

## 24\. PostgreSQL — `tender\\\_analysis\\\_field\\\_results`

Финальное хранилище результатов 27 полей.

|Колонка|Тип|Nullable|
|-|-|-:|
|`analysis\\\_run\\\_id`|uuid|NO|
|`field\\\_catalog\\\_version`|text|NO|
|`result\\\_contract\\\_version`|text|NO|
|`field\\\_index`|smallint|NO|
|`field\\\_key`|text|NO|
|`status`|text|NO|
|`value\\\_text`|text|YES|
|`confidence`|numeric|YES|
|`requires\\\_human\\\_review`|boolean|NO|
|`resolution\\\_method`|text|NO|
|`result\\\_json`|jsonb|NO|
|`created\\\_at`|timestamptz|NO|
|`updated\\\_at`|timestamptz|NO|

UPSERT:

```text
ON CONFLICT (analysis\\\_run\\\_id, field\\\_key)
DO UPDATE
```

`result\\\_json` содержит полный `tender\\\_field\\\_final\\\_v1`.

\---

## 25\. Основные инварианты Aggregator

1. Один execution Aggregator работает с одним `analysis\\\_run\\\_id`.
2. Intended invariant: run должен быть атомарно захвачен перед агрегацией.
3. Intended continuation допускается только при `aggregation\\\_claimed=true`; текущий reachable graph claim не выполняет.
4. В Semantic Aggregator попадают только `confirmed` и `requires\\\_review`.
5. `rejected` facts не участвуют в candidate aggregation.
6. Перед первым бизнес-ветвлением создаются ровно 27 field items.
7. Каждый field item имеет стабильные `field\\\_index` и `field\\\_key`.
8. Неизвестный `field\\\_key` является hard error.
9. Поле без candidates не исчезает.
10. Semantic Aggregator Round 1 не извлекает новые facts.
11. Каждый input candidate получает ровно одну semantic role.
12. `resolved` Round 1 требует ровно одного `primary`.
13. `resolved` Round 1 не допускает unresolved conflicts.
14. Недостаточный evidence должен приводить к Targeted Recheck, а не к выдуманному resolved.
15. TenderMeta Resolver не превращает отсутствие mapping/value в `not\\\_found`.
16. Targeted Recheck вызывается только для незакрытого поля.
17. Поле, переданное в Targeted Recheck, больше не финализируется Aggregator.
18. Все локально resolved поля нормализуются в `tender\\\_field\\\_final\\\_v1`.
19. FINAL field сохраняется идемпотентно через UPSERT.
20. Отсутствие candidate или metadata не является доказательством отрицательного факта.

\---

## 26\. Проверенные сценарии

|Сценарий|Статус|Путь|
|-|-|-|
|atomic claim|✅ подтверждён execution `13856`|`ready\\\_for\\\_aggregation → aggregating`|
|duplicate Aggregator execution guard|✅ реализован в claim node|`aggregation\\\_claimed=false → stop`|
|candidate facts есть|✅|Round 1|
|facts отсутствуют для поля|✅|TenderMeta|
|Round 1 resolved|✅|FINAL → DB|
|Round 1 requires\_recheck|✅|Targeted Recheck|
|TenderMeta resolved|✅|FINAL → DB|
|TenderMeta unresolved|✅|Targeted Recheck|
|27 field items создаются заранее|✅|grouped field contract|
|Round 1 FIELD\_RULES на все 27|✅|текущая реализация|
|FINAL contract `tender_field_final_v1`|✅|Round 1 / Metadata / Targeted Recheck|
|полный E2E aggregation run|✅|3 documents → 38 facts → 27 FINAL rows|
|в БД реально сохранено ровно 27 FINAL fields|✅ проверено вручную|`tender_analysis_field_results`|
|completion barrier 27/27|✅ execution `13863`|`barrier_ready=true`, `completion_claimed=true`, `run → completed`|
|selective retry DeepSeek|❌|`AG-1`|
|missing run guard|⚠️ не проверено|`AG-4`|

\---

## 27\. Known Technical Debt
### AG-0 — закрыт для MVP; downstream Report Generation V2 реализован

**Severity:** Critical  
**Status:** ✅ Verified 23.08.2026

В intended architecture до начала основной агрегации должен выполняться переход:

```text
ready_for_aggregation
→ aggregating
```

Live execution `13856` подтвердил reachable atomic claim. Finalization executions `13858–13863` выполнили DB-backed 27/27 check; execution `13863` подтвердил `completion_claimed=true` и `run.status=completed`.

Execution `13864` исторически вызвал прежний stub. Текущий `TENDER — Генерация отчета` формирует validated Report Model, self-contained HTML и binary `report_html`.

\---
### AG-1 — отсутствует selective retry для Semantic Aggregator AI

**Severity:** Medium / High  
**Status:** Open / observed

На полном прогоне реально наблюдался:

```text
field_key = delivery_term
finish_reason = length

Желаемое поведение:

```text
invalid AI response
→ retry только конкретного field item
→ retry limit
→ hard fail
```

\---

### AG-2 — дублирование Normalize + Save

**Severity:** Medium  
**Status:** Open / refactoring

Сейчас существуют отдельные копии:

```text
Нормализовать FINAL поле1
Сохранить FINAL результат поля в БД1

Нормализовать FINAL поле2
Сохранить FINAL результат поля в БД2
```

Будущее направление без Merge:

```text
любой Finalizer
    |
    v
TENDER - Persist Final Field
    |
Normalize
    |
UPSERT
```

\---

### AG-3 — TenderMeta mappings захардкожены отдельно

**Severity:** Medium  
**Status:** Open / design debt

Mappings:

```text
platform
application\\\_deadline
procurement\\\_subject
customer
```

живут отдельно от остальных field semantics.

Будущее направление — единый versioned `FIELD\\\_CATALOG`.

\---

### AG-4 — нет явного guard для несуществующего `analysis\\\_run\\\_id`

**Severity:** Medium  
**Status:** To verify

Если run отсутствует, будущий atomic claim может вернуть 0 rows, и execution потенциально тихо закончится.

Желаемое поведение:

```text
unknown analysis\\\_run\\\_id
→ explicit hard error
```

\---

### AG-5 — field semantics распределены по нескольким workflow

**Severity:** Medium  
**Status:** Open / cross-workflow design debt

Правила одного поля сейчас могут находиться в:

```text
Aggregator Round 1 FIELD\\\_RULES
Aggregator TenderMeta Resolver
Targeted Recheck RECHECK\\\_PROFILES
Targeted Recheck Round 2 FIELD\\\_RULES
```

Целевое направление — единый versioned field catalog.

\---

### AG-6 — устаревший комментарий в Round 1 FIELD\_RULES

**Severity:** Low  
**Status:** Open

Комментарий говорит, что отлаживаются только `procurement\\\_subject` и `delivery\\\_term`, хотя фактически правила уже есть для всех 27 полей.



### AG-7 — ожидание Targeted Recheck

**Severity:** —  
**Status:** Merged into `AG-0`

Отдельный механизм ожидания Targeted Recheck внутри parent Aggregator не требуется.

Текущая архитектура намеренно асинхронная:

```text
Aggregator
→ запускает Targeted Recheck
→ parent execution не ждёт его FINAL
\---

## 28\. Safe Modification Checklist

Перед изменением Aggregator проверить:

1. После восстановления reachable topology не ломается ли atomic claim run.
2. Не может ли один run начать два Aggregator execution.
3. Сохраняется ли правило `27 field items`.
4. Не попадают ли rejected facts в Round 1.
5. Не меняется ли `field\\\_key`.
6. Каждый ли candidate получает semantic decision.
7. Не разрешается ли `resolved` с unresolved conflict.
8. Не превращается ли отсутствие candidates/TenderMeta в ложный отрицательный факт.
9. Поля `needs\\\_recheck=true` действительно уходят только в Targeted Recheck.
10. Поле, переданное в Targeted Recheck, не финализируется повторно Aggregator.
11. Локальный FINAL соответствует `tender\\\_field\\\_final\\\_v1`.
12. UPSERT остаётся идемпотентным.
13. При изменении field semantics проверить Round 1 / Metadata / Recheck / Round 2.
14. После появления completion barrier проверять ровно 27 уникальных `field\\\_key`.

\---

## 29\. Regression Checklist

### A1 — intended normal claim

Ожидание:

```text
aggregation\\\_claimed=true
run.status=aggregating
```

### A2 — intended duplicate claim

Ожидание:

```text
aggregation\\\_claimed=false
дальнейшая агрегация не запускается
```

### A3 — load facts

Ожидание:

```text
facts\\\[] содержит только confirmed/requires\\\_review
rejected\\\_count считается отдельно
```

### A4 — grouping

Ожидание:

```text
ровно 27 output items
field\\\_index = 1..27
```

### A5 — unknown field\_key

Ожидание:

```text
hard error
```

### A6 — candidates exist

Ожидание:

```text
Round 1 Semantic Aggregator
```

### A7 — Round 1 resolved

Ожидание:

```text
semantic\\\_aggregator\\\_round\\\_1
→ tender\\\_field\\\_final\\\_v1
→ UPSERT
```

### A8 — Round 1 requires recheck

Ожидание:

```text
TENDER - Targeted Recheck
```

### A9 — no candidates + supported metadata

Ожидание:

```text
deterministic\\\_metadata
→ resolved
→ UPSERT
```

### A10 — no candidates + unsupported/unavailable metadata

Ожидание:

```text
metadata\\\_resolved=false
→ TENDER - Targeted Recheck
```

### A11 — completion barrier (verified)

После `AG-0`, execution `13863` подтвердил:

```text
27 unique FINAL fields
→ run.status=completed
→ completed\\\_at set
```

### A12 — transient DeepSeek response

После `AG-1`:

```text
retry только проблемного field item
```

\---

## 30\. Ближайший план работ

### Следующий MVP milestone

1. Использовать реализованный `AG-0`:

```text
FINAL UPSERT
→ DB-backed 27/27 validation
→ atomic run completion claim
→ aggregating → completed
→ Report Generation V2 HTML artifact
```

2. Future report extensions:

```text
PDF / DOCX / XLSX
→ manual upload / delivery
```

3. После первого законченного report E2E:
regression dataset
→ несколько реальных закупок
→ ручная проверка 27 полей
→ корректировка semantic rules по фактическим ошибкам
4. Затем reliability/hardening:
AG-1 — selective retry
DW-14 / EW-3
DW-3
DW-8
OR-0
5. После MVP — refactoring:
AG-2
AG-3
AG-5
TR-5
TR-8

\---

## 31\. Краткое резюме для быстрого восстановления контекста

`TENDER — Агрегация закупки` — fan-out workflow, который принимает готовый `analysis\\\_run`, атомарно захватывает его, загружает candidate facts и создаёт 27 field items. После независимых FINAL UPSERT вызывается Finalization workflow.

Далее:

```text
candidate есть
→ Semantic Aggregator Round 1
→ resolved или Targeted Recheck

candidate нет
→ deterministic TenderMeta Resolver
→ resolved или Targeted Recheck
```

Все resolved-поля приводятся к:

```text
tender\\\_field\\\_final\\\_v1
```

и сохраняются в:

```text
tender\\\_analysis\\\_field\\\_results
```

Поля, требующие дополнительной проверки, передаются в:

```text
TENDER - Targeted Recheck
```

который сам сохраняет их FINAL-результат.

Последний полный integration run подтвердил:

```text
3 documents
→ 38 persisted candidate facts
→ 20 confirmed
→ 10 requires_review
→ 8 rejected
→ exactly 27 FINAL field results
→ Finalization `27/27` + atomic completion claim
→ `run.status=completed`
→ Report Generation V2 HTML artifact


AG-0 закрыт для проверенного MVP execution. HTML report path реализован; PDF/DOCX/XLSX/delivery остаются отдельным future work.
