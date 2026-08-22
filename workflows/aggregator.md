# TENDER — Агрегация закупки

**Статус:** Active development / MVP  
**Последнее обновление:** 2026-08-22  
**Тип:** sub-workflow n8n  
**Вызывается:** другим workflow после готовности всех документов  
**Вызывает:** `TENDER - Targeted Recheck`  
**Финальный контракт поля:** `tender_field_final_v1`  
**Каталог полей:** `tender_fields_v1`  
**Основная модель Semantic Aggregator:** `deepseek-v4-pro`

---

## 1. Назначение

`TENDER — Агрегация закупки` собирает результаты анализа всех документов одного `analysis_run`, раскладывает candidate facts по 27 полям каталога `tender_fields_v1` и определяет финальный путь разрешения каждого поля.

Workflow не извлекает новые facts из документов.

Его задача:

1. атомарно захватить готовый `analysis_run` для агрегации;
2. загрузить документы, TenderMeta и candidate facts;
3. создать **ровно 27 field items**;
4. для полей с candidates выполнить Semantic Aggregator Round 1;
5. для полей без candidates попробовать deterministic TenderMeta Resolver;
6. при необходимости передать поле в `TENDER - Targeted Recheck`;
7. для полей, закрытых внутри Aggregator, сформировать `tender_field_final_v1`;
8. сохранить FINAL field в PostgreSQL.

Текущая версия Aggregator **не выполняет финальную синхронизацию всего run после записи 27 полей**. См. `AG-0`.

---

## 2. Место в общей системе

```text
Orchestrator / Document Workers
        |
        v
Все документы зарегистрированы и обработаны
        |
        v
run.status = ready_for_aggregation
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
        |      `-- requires_recheck
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
                     |
                     v
                    DB
```

---

## 3. Текущая граница ответственности

Aggregator отвечает за:

- захват run;
- загрузку агрегируемых данных;
- fan-out в 27 полей;
- Round 1 semantic aggregation;
- deterministic TenderMeta fallback;
- отправку проблемных полей в Targeted Recheck;
- локальную финализацию resolved-полей;
- сохранение своих FINAL-полей в `tender_analysis_field_results`.

Aggregator **не отвечает в текущей версии** за:

- ожидание завершения всех Targeted Recheck executions;
- проверку, что в БД появилось ровно 27 FINAL-полей;
- перевод `analysis_run` из `aggregating` в `completed`;
- генерацию Markdown/XLSX отчёта;
- отправку отчёта в Telegram.

---

## 4. RAW INPUT CONTRACT

Workflow запускается через `When Executed by Another Workflow`.

Реальный пример входа из pin data:

```json
{
  "analysis_run_id": "18f3eaee-528d-4bc1-8d72-a1ea2f313df2",
  "previous_run_status": "processing",
  "run_status": "ready_for_aggregation",
  "documents_total": 3,
  "registered_documents_count": 3,
  "completed_documents_count": 3,
  "pending_documents_count": 0,
  "processing_documents_count": 0,
  "failed_documents_count": 0,
  "skipped_documents_count": 0,
  "ready_at": "2026-08-21T15:12:48.500Z",
  "should_start_aggregation": true,
  "readiness_reason": "all_documents_completed"
}
```

Для текущего Aggregator реально критичен прежде всего:

```text
analysis_run_id
```

Остальная readiness-информация приходит от upstream и полезна для provenance/debugging, но сам Aggregator повторно защищает запуск через atomic claim в PostgreSQL.

---

## 5. Полная архитектура workflow

```text
When Executed by Another Workflow
        |
        v
Захватить run для агрегации
        |
        v
Продолжать агрегацию?
    /             \
 FALSE            TRUE
   |                |
 конец              v
           Загрузить факты закупки
                    |
                    v
           Сгруппировать факты по полям
                    |
                    v
              Есть кандидаты?
             /              \
          TRUE              FALSE
           |                  |
           v                  v
  Подготовить запрос     Разрешить поле
  Semantic Aggregator   из TenderMeta
           |                  |
           v                  v
  Semantic Aggregator   Поле закрыто
           |             из TenderMeta?
           v               /        \
  Проверить ответ       TRUE        FALSE
  Semantic Aggregator    |            |
           |             v            v
           v         FINAL Meta   TENDER -
   Нужен Targeted        |         Targeted
      Recheck?           v         Recheck
      /     \         Normalize        |
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

---

## 6. Stage 0 — Trigger

### `When Executed by Another Workflow`

**Получает:** один run item от upstream workflow.

**Назначение:** передать контекст текущего `analysis_run` в Aggregator.

**Ключевое поле:**

```text
analysis_run_id
```

---

## 7. Stage 1 — Atomic Run Claim

### `Захватить run для агрегации`

PostgreSQL-нода атомарно переводит run:

```text
ready_for_aggregation
→
aggregating
```

Условие UPDATE:

```sql
WHERE id = $1::uuid
  AND status = 'ready_for_aggregation'
```

При успешном claim возвращается:

```text
aggregation_claimed = true
```

Если другой execution уже захватил run или run имеет другой статус:

```text
aggregation_claimed = false
```

Также заполняется:

```text
aggregation_started_at
updated_at
```

### Зачем нужен claim

Защита от конкурентного двойного запуска Aggregator для одного `analysis_run`.

---

### `Продолжать агрегацию?`

Проверяет:

```text
aggregation_claimed === true
```

#### TRUE

Продолжаем Aggregator.

#### FALSE

Execution заканчивается без дальнейшей обработки.

---

## 8. Stage 2 — Load Aggregation Dataset

### `Загрузить факты закупки`

Нода собирает единый dataset текущей закупки из PostgreSQL.

### Читает

```text
tender_analysis_runs
tender_analysis_documents
tender_analysis_facts
```

### Из `tender_analysis_runs`

Получает:

```text
analysis_run_id
tender_id
tender_number
tender_external_id
run_status
documents_total
tender_meta
```

`tender_meta` является структурированным источником данных для deterministic Metadata Resolver.

### Из `tender_analysis_documents`

Формирует `documents[]` с данными о каждом документе.

### Из `tender_analysis_facts`

В массив `facts[]` попадают только facts с:

```text
validator_verdict = confirmed
или
validator_verdict = requires_review
```

Rejected facts в Semantic Aggregator не передаются.

### Статистика facts

Рассчитываются:

```text
facts_total
confirmed_count
requires_review_count
rejected_count
aggregation_candidates_count
```

Важно:

```text
facts_total
```

включает все facts run, а:

```text
aggregation_candidates_count
```

равен числу facts, реально допущенных в агрегацию.

---

## 9. Stage 3 — Expand to 27 Field Items

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
tender_fields_v1
```

### 27 field_key

1. `procurement_subject`
2. `nm_price_with_vat`
3. `platform`
4. `procedure_type`
5. `application_deadline`
6. `application_review_date`
7. `results_date`
8. `customer`
9. `customer_contacts`
10. `participation_cost`
11. `participation_guarantee`
12. `evaluation_criteria`
13. `delivery_term`
14. `payment_terms`
15. `special_account_or_treasury`
16. `bank_support`
17. `government_contract`
18. `rebidding`
19. `national_regime`
20. `advance_contract_guarantee`
21. `warranty_obligations_guarantee`
22. `licenses_certificates`
23. `required_official_certificates`
24. `similar_supply_experience`
25. `analog_allowed`
26. `analog_definition`
27. `application_documents`

Группы создаются заранее, поэтому поле без facts не исчезает.

### Контракт field item

```json
{
  "analysis_run_id": "uuid",
  "field_catalog_version": "tender_fields_v1",
  "field_index": 16,
  "field_key": "bank_support",
  "has_candidates": false,
  "candidates_count": 0,
  "confirmed_count": 0,
  "requires_review_count": 0,
  "source_documents_count": 0,
  "source_documents": [],
  "candidates": []
}
```

### Guards

Неизвестный `field_key` в загруженных facts вызывает hard error.

---

## 10. Stage 4 — First Routing

### `Есть кандидаты?`

Условие:

```text
has_candidates === true
```

### TRUE

Поле идёт в Semantic Aggregator Round 1.

### FALSE

Поле идёт в deterministic TenderMeta Resolver.

---

## 11. Stage 5 — Semantic Aggregator Round 1

### `Подготовить запрос Semantic Aggregator`

**Получает:** один field item с `candidates[]`.

### Проверяет

```text
analysis_run_id
field_key
candidates должен быть массивом
fact_id должен существовать у каждого candidate
```

### FIELD_RULES

Round 1 `FIELD_RULES` содержит правила для всех 27 полей.

Структура одного field rule:

```json
{
  "title": "...",
  "definition": "...",
  "rules": ["..."]
}
```

### Подготавливает candidates для AI

Из evidence удаляются тяжёлые технические поля.

Остаются:

```text
quote
type
role
page_from
page_to
sheet_name
semantic_block_id
```

---

## 12. Semantic Aggregator Round 1 — роль AI

### `Semantic Aggregator`

**Модель:** `deepseek-v4-pro`

Настройки:

```text
thinking = enabled
reasoning_effort = low
response_format = json_object
max_tokens = 4096
timeout = 180000 ms
```

Semantic Aggregator:

- не извлекает новые facts;
- работает только с переданными candidates;
- классифицирует отношения между candidates;
- формирует итоговое значение поля;
- решает, достаточно ли evidence для resolved.

### Candidate roles

```text
primary
duplicate
supporting
complement
conflict
not_applicable
```

### Допустимые Round 1 statuses

```text
resolved
requires_recheck
```

### Допустимые `recheck_reason_code`

```text
conflicting_candidates
insufficient_evidence
ambiguous_scope
no_reliable_candidate
other
```

---

## 13. Round 1 AI output contract

```json
{
  "field_key": "string",
  "status": "resolved | requires_recheck",
  "final_value_text": "string | null",
  "confidence": 0.0,
  "candidate_decisions": [
    {
      "fact_id": "uuid",
      "role": "primary | duplicate | supporting | complement | conflict | not_applicable",
      "reason": "..."
    }
  ],
  "supporting_fact_ids": [],
  "conflict_fact_ids": [],
  "needs_recheck": false,
  "recheck_reason_code": null,
  "recheck_note": null
}
```

---

## 14. Stage 6 — Deterministic Round 1 Validation

### `Проверить ответ Semantic Aggregator`

Нода не доверяет AI JSON автоматически.

Проверяет:

```text
choices[0] существует
finish_reason = stop
message.content не пуст
валидный JSON
field_key не изменился
status в allow-list
confidence ∈ [0,1]
```

### Candidate decisions

Каждый входной `fact_id` обязан присутствовать ровно один раз.

Запрещено:

- придумывать новые `fact_id`;
- терять входной fact;
- повторять fact дважды.

### Для `resolved`

Обязательно:

```text
final_value_text != empty
needs_recheck = false
recheck_reason_code = null
primaryCount = 1
conflict_fact_ids.length = 0
```

### Для `requires_recheck`

Обязательно:

```text
needs_recheck = true
valid recheck_reason_code
recheck_note != empty
primaryCount <= 1
```

На выходе:

```text
aggregation_validated = true
```

---

## 15. Stage 7 — Round 1 Resolution Routing

### `Нужен Targeted Recheck?`

Проверяет:

```text
needs_recheck === true
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

---

## 16. FINAL after Round 1

### `Сформировать FINAL после Round 1`

Проверяет:

```text
analysis_run_id
field_key
aggregation_validated = true
aggregation_status = resolved
needs_recheck = false
final_value_text != empty
confidence ∈ [0,1]
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
not_applicable
```

Добавляется provenance:

```text
candidate_ref = fact:<fact_id>
candidate_role
candidate_origin = initial_analysis
candidate_value_text
```

Conflict evidence сохраняется отдельно в audit.

### Результат

```text
aggregation_status = resolved
needs_recheck = false
aggregation_validated = true
requires_human_review = false
resolution_method = semantic_aggregator_round_1
aggregation_round = 1
```

---

## 17. Stage 8 — TenderMeta Resolver

FALSE-ветка `Есть кандидаты?`.

### `Разрешить поле из TenderMeta`

Это deterministic fallback.

Отсутствие mapping или значения **не означает `not_found`**.

Оно означает:

```text
metadata_resolved = false
→ Targeted Recheck
```

### Текущие deterministic mappings

```text
platform             → tender_meta.platform
application_deadline → tender_meta.submission_close_at
procurement_subject  → tender_meta.title
customer             → tender_meta.primary_customer.name
```

При успешном resolution:

```text
metadata_resolved = true
aggregation_status = resolved
confidence = 1
resolution_method = deterministic_metadata
```

Metadata Resolver сохраняет:

```text
original_field = input
```

чтобы Targeted Recheck мог распознать `no_initial_candidates`.

---

## 18. Stage 9 — TenderMeta Routing

### `Поле закрыто из TenderMeta?`

Условие:

```text
metadata_resolved === true
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

---

## 19. FINAL from TenderMeta

### `Сформировать FINAL из TenderMeta`

Проверяет:

```text
analysis_run_id
field_key
metadata_resolved = true
aggregation_status = resolved
final_value_text != empty
confidence ∈ [0,1]
evidence.length > 0
```

Формирует:

```text
aggregation_status = resolved
needs_recheck = false
aggregation_validated = true
requires_human_review = false
resolution_method = deterministic_metadata
aggregation_round = null
```

---

## 20. Канонический FINAL — `tender_field_final_v1`

Round 1 и TenderMeta ветки проходят через одинаковую логику нормализации.

Основные поля:

```text
result_contract_version
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

Aggregator сам создаёт главным образом `resolved` FINAL-поля.

`requires_review` и `not_found` в текущей архитектуре обычно возникают внутри `TENDER - Targeted Recheck`.

---

## 21. PostgreSQL — `tender_analysis_runs`

Корневая сущность одного анализа.

| Колонка | Тип | Nullable |
|---|---|---:|
| `id` | uuid | NO |
| `source` | text | NO |
| `tender_id` | text | NO |
| `tender_number` | text | YES |
| `tender_external_id` | text | YES |
| `status` | text | NO |
| `documents_total` | integer | NO |
| `tender_meta` | jsonb | NO |
| `error_message` | text | YES |
| `created_at` | timestamptz | NO |
| `started_at` | timestamptz | NO |
| `updated_at` | timestamptz | NO |
| `ready_at` | timestamptz | YES |
| `aggregation_started_at` | timestamptz | YES |
| `completed_at` | timestamptz | YES |

PK:

```text
id
```

Aggregator использует lifecycle:

```text
ready_for_aggregation
→ aggregating
```

Текущий workflow не переводит run в `completed`.

---

## 22. PostgreSQL — `tender_analysis_documents`

Документы одного analysis run.

Ключевые поля:

```text
id
analysis_run_id
document_index
file_name
file_extension
display_name
status
attempts
units_total
facts_count
error_message
started_at
completed_at
```

FK:

```text
analysis_run_id
→ tender_analysis_runs.id
```

Уникальность документа внутри run:

```text
(analysis_run_id, document_index)
```

---

## 23. PostgreSQL — `tender_analysis_facts`

Candidate facts до Aggregator.

Ключевые поля:

```text
id
analysis_run_id
document_id
analysis_unit_id
fact_index
field_catalog_version
field_key
value_text

extractor_status
extractor_confidence
extractor_review_reason_code
extractor_review_note

validator_verdict
validator_confidence
validator_reason_code
validator_reason_note

evidence
extractor_meta
validator_meta
```

FK:

```text
analysis_run_id
→ tender_analysis_runs.id
```

Также существует composite связь с `tender_analysis_units`.

---

## 24. PostgreSQL — `tender_analysis_field_results`

Финальное хранилище результатов 27 полей.

| Колонка | Тип | Nullable |
|---|---|---:|
| `analysis_run_id` | uuid | NO |
| `field_catalog_version` | text | NO |
| `result_contract_version` | text | NO |
| `field_index` | smallint | NO |
| `field_key` | text | NO |
| `status` | text | NO |
| `value_text` | text | YES |
| `confidence` | numeric | YES |
| `requires_human_review` | boolean | NO |
| `resolution_method` | text | NO |
| `result_json` | jsonb | NO |
| `created_at` | timestamptz | NO |
| `updated_at` | timestamptz | NO |

UPSERT:

```text
ON CONFLICT (analysis_run_id, field_key)
DO UPDATE
```

`result_json` содержит полный `tender_field_final_v1`.

---

## 25. Основные инварианты Aggregator

1. Один execution Aggregator работает с одним `analysis_run_id`.
2. Run должен быть атомарно захвачен перед агрегацией.
3. Продолжение допускается только при `aggregation_claimed=true`.
4. В Semantic Aggregator попадают только `confirmed` и `requires_review`.
5. `rejected` facts не участвуют в candidate aggregation.
6. Перед первым бизнес-ветвлением создаются ровно 27 field items.
7. Каждый field item имеет стабильные `field_index` и `field_key`.
8. Неизвестный `field_key` является hard error.
9. Поле без candidates не исчезает.
10. Semantic Aggregator Round 1 не извлекает новые facts.
11. Каждый input candidate получает ровно одну semantic role.
12. `resolved` Round 1 требует ровно одного `primary`.
13. `resolved` Round 1 не допускает unresolved conflicts.
14. Недостаточный evidence должен приводить к Targeted Recheck, а не к выдуманному resolved.
15. TenderMeta Resolver не превращает отсутствие mapping/value в `not_found`.
16. Targeted Recheck вызывается только для незакрытого поля.
17. Поле, переданное в Targeted Recheck, больше не финализируется Aggregator.
18. Все локально resolved поля нормализуются в `tender_field_final_v1`.
19. FINAL field сохраняется идемпотентно через UPSERT.
20. Отсутствие candidate или metadata не является доказательством отрицательного факта.

---

## 26. Проверенные сценарии

| Сценарий | Статус | Путь |
|---|---|---|
| run успешно захвачен | ✅ | `ready_for_aggregation → aggregating` |
| duplicate Aggregator execution | ✅ архитектурно | `aggregation_claimed=false → stop` |
| candidate facts есть | ✅ | Round 1 |
| facts отсутствуют для поля | ✅ | TenderMeta |
| Round 1 resolved | ✅ | FINAL → DB |
| Round 1 requires_recheck | ✅ | Targeted Recheck |
| TenderMeta resolved | ✅ | FINAL → DB |
| TenderMeta unresolved | ✅ | Targeted Recheck |
| 27 field items создаются заранее | ✅ | grouped field contract |
| Round 1 FIELD_RULES на все 27 | ✅ | текущая реализация |
| FINAL contract `tender_field_final_v1` | ✅ | Round 1 / Metadata |
| completion barrier 27/27 | ❌ | `AG-0` |
| selective retry DeepSeek | ❌ | `AG-1` |
| missing run guard | ⚠️ не проверено | `AG-4` |

---

## 27. Known Technical Debt

### AG-0 — отсутствует completion barrier для 27 FINAL fields

**Severity:** Critical  
**Status:** Open

В начале Aggregator переводит:

```text
ready_for_aggregation
→ aggregating
```

Но workflow заканчивается после локальных UPSERT и вызовов Targeted Recheck.

Нет финальной проверки:

```text
COUNT(FINAL fields) = 27
```

и нет перехода:

```text
aggregating
→ completed
```

Колонка `completed_at` существует, но текущим Aggregator не заполняется.

Желаемое будущее поведение:

```text
каждый FINAL field UPSERT
        |
        v
проверка readiness по БД
        |
        v
27 / 27?
        |
       YES
        |
        v
analysis_run.status = completed
completed_at = NOW()
        |
        v
report generation
```

---

### AG-1 — отсутствует selective retry для Semantic Aggregator AI

**Severity:** Medium / High  
**Status:** Open

Один transient AI response сейчас может уронить execution.

Желаемое поведение:

```text
invalid AI response
→ retry только конкретного field item
→ retry limit
→ hard fail
```

---

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

---

### AG-3 — TenderMeta mappings захардкожены отдельно

**Severity:** Medium  
**Status:** Open / design debt

Mappings:

```text
platform
application_deadline
procurement_subject
customer
```

живут отдельно от остальных field semantics.

Будущее направление — единый versioned `FIELD_CATALOG`.

---

### AG-4 — нет явного guard для несуществующего `analysis_run_id`

**Severity:** Medium  
**Status:** To verify

Если run отсутствует, atomic claim может вернуть 0 rows, и execution потенциально тихо закончится.

Желаемое поведение:

```text
unknown analysis_run_id
→ explicit hard error
```

---

### AG-5 — field semantics распределены по нескольким workflow

**Severity:** Medium  
**Status:** Open / cross-workflow design debt

Правила одного поля сейчас могут находиться в:

```text
Aggregator Round 1 FIELD_RULES
Aggregator TenderMeta Resolver
Targeted Recheck RECHECK_PROFILES
Targeted Recheck Round 2 FIELD_RULES
```

Целевое направление — единый versioned field catalog.

---

### AG-6 — устаревший комментарий в Round 1 FIELD_RULES

**Severity:** Low  
**Status:** Open

Комментарий говорит, что отлаживаются только `procurement_subject` и `delivery_term`, хотя фактически правила уже есть для всех 27 полей.

---

## 28. Safe Modification Checklist

Перед изменением Aggregator проверить:

1. Не ломается ли atomic claim run.
2. Не может ли один run начать два Aggregator execution.
3. Сохраняется ли правило `27 field items`.
4. Не попадают ли rejected facts в Round 1.
5. Не меняется ли `field_key`.
6. Каждый ли candidate получает semantic decision.
7. Не разрешается ли `resolved` с unresolved conflict.
8. Не превращается ли отсутствие candidates/TenderMeta в ложный отрицательный факт.
9. Поля `needs_recheck=true` действительно уходят только в Targeted Recheck.
10. Поле, переданное в Targeted Recheck, не финализируется повторно Aggregator.
11. Локальный FINAL соответствует `tender_field_final_v1`.
12. UPSERT остаётся идемпотентным.
13. При изменении field semantics проверить Round 1 / Metadata / Recheck / Round 2.
14. После появления completion barrier проверять ровно 27 уникальных `field_key`.

---

## 29. Regression Checklist

### A1 — normal claim

Ожидание:

```text
aggregation_claimed=true
run.status=aggregating
```

### A2 — duplicate claim

Ожидание:

```text
aggregation_claimed=false
дальнейшая агрегация не запускается
```

### A3 — load facts

Ожидание:

```text
facts[] содержит только confirmed/requires_review
rejected_count считается отдельно
```

### A4 — grouping

Ожидание:

```text
ровно 27 output items
field_index = 1..27
```

### A5 — unknown field_key

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
semantic_aggregator_round_1
→ tender_field_final_v1
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
deterministic_metadata
→ resolved
→ UPSERT
```

### A10 — no candidates + unsupported/unavailable metadata

Ожидание:

```text
metadata_resolved=false
→ TENDER - Targeted Recheck
```

### A11 — completion barrier

После `AG-0`:

```text
27 unique FINAL fields
→ run.status=completed
→ completed_at set
```

### A12 — transient DeepSeek response

После `AG-1`:

```text
retry только проблемного field item
```

---

## 30. Ближайший план работ

1. Закрыть критичные `TR-0`, `TR-1`, `TR-2`, `TR-3`.
2. Реализовать `AG-0` — readiness/completion barrier 27/27.
3. После `AG-0`:
   - собрать 27 FINAL fields;
   - сформировать tender result object;
   - Markdown;
   - XLSX;
   - Telegram.
4. Добавить selective retries:
   - `AG-1`;
   - `TR-6`.
5. Затем технический refactoring:
   - `AG-2`;
   - `AG-3`;
   - `AG-5`;
   - связанные `TR-*`.

---

## 31. Краткое резюме для быстрого восстановления контекста

`TENDER — Агрегация закупки` — fan-out workflow, который принимает готовый `analysis_run`, атомарно захватывает его, загружает candidate facts и создаёт 27 field items.

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
tender_field_final_v1
```

и сохраняются в:

```text
tender_analysis_field_results
```

Поля, требующие дополнительной проверки, передаются в:

```text
TENDER - Targeted Recheck
```

который сам сохраняет их FINAL-результат.

Главный незакрытый lifecycle gap Aggregator:

```text
run переводится в aggregating,
но пока нет barrier:
27 FINAL fields → completed.
```

Критичный следующий системный шаг после стабилизации Targeted Recheck — `AG-0`.
