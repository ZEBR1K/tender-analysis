# TENDER - Targeted Recheck

**Статус:** Active development / MVP  
**Последнее обновление:** 2026-08-22  
**Тип:** sub-workflow n8n  
**Родительский workflow:** `TENDER — Агрегация закупки`  
**Финальный контракт поля:** `tender_field_final_v1`  
**Основная модель:** `deepseek-v4-pro`

---

## 1. Назначение

`TENDER - Targeted Recheck` выполняет углублённую повторную проверку **одного field item** тендера, если первичный анализ не смог надёжно закрыть поле.

Важно различать:

- **один item = одно поле**;
- **один execution workflow может одновременно получить несколько field items**.

Workflow не анализирует тендер целиком. Он обрабатывает только поля, которые уже дошли до состояния, требующего повторного поиска и проверки.

Главная задача workflow:

1. определить, почему поле отправлено на Recheck;
2. выбрать профиль поиска для `field_key`;
3. найти дополнительный релевантный контекст;
4. попросить AI сформировать новые candidate facts;
5. детерминированно проверить evidence;
6. независимо проверить candidate через отдельный AI Validator;
7. при необходимости отправить validated candidates в Semantic Aggregator Round 2;
8. сформировать один из финальных статусов:
   - resolved;
   - requires_review;
   - not_found;
9. нормализовать результат в tender_field_final_v1;
10. выполнить UPSERT финального результата в PostgreSQL.

Round 2 является последним semantic этапом.
После Round 2 повторный Targeted Recheck не запускается.

---

## 2. Место в общей системе

```text
TENDER — Агрегация закупки
        |
        |-- поле закрыто через Round 1 ----------------------> FINAL -> DB
        |
        |-- поле закрыто через TenderMeta ------------------> FINAL -> DB
        |
        `-- поле требует повторной проверки
                    |
                    v
          TENDER - Targeted Recheck
                    |
                    v
          resolved / requires_review / not_found
                    |
                    v
          tender_field_final_v1
                    |
                    v
          tender_analysis_field_results
```

### Где вызывается

`TENDER - Targeted Recheck` вызывается из `TENDER — Агрегация закупки` в двух местах.

#### Вызов A — после Semantic Aggregator Round 1

```text
Есть кандидаты?
    |
   TRUE
    |
Подготовить запрос Semantic Aggregator
    |
Semantic Aggregator
    |
Проверить ответ Semantic Aggregator
    |
Нужен Targeted Recheck?
    |
   TRUE
    |
TENDER - Targeted Recheck
```

Смысл: candidates существуют, но Round 1 вернул `requires_recheck`.

Внутренний trigger:

```text
aggregation_recheck
```

#### Вызов B — после TenderMeta Resolver

```text
Есть кандидаты?
    |
   FALSE
    |
Разрешить поле из TenderMeta
    |
Поле закрыто из TenderMeta?
    |
   FALSE
    |
TENDER - Targeted Recheck
```

Смысл: первичный анализ не сформировал candidates, а TenderMeta не позволил закрыть поле детерминированно.

Внутренний trigger:

```text
no_initial_candidates
```

### Инвариант вызова

Targeted Recheck не должен вызываться для поля, которое уже окончательно закрыто:

- Semantic Aggregator Round 1;
- TenderMeta Resolver;
- предыдущим FINAL-результатом.

---

## 3. Контракт завершения workflow

`TENDER - Targeted Recheck` является **side-effect sub-workflow**.

Он не обязан возвращать FINAL-поле родительскому workflow для дальнейшей финализации.

Для каждого входного field item workflow должен:

1. либо завершиться записью **ровно одного канонического FINAL-результата** в `tender_analysis_field_results`;
2. либо завершиться явной ошибкой.

Молчаливая потеря поля недопустима.


### Финальные ветки завершения

Targeted Recheck должен завершаться одним из вариантов:

| Ветка | Итог |
|---|---|
| direct_final | resolved |
| semantic_aggregator_round_2 | resolved / requires_review |
| existing_candidate_preserved | requires_review |
| no usable evidence | not_found |

Каждая ветка обязана привести результат к контракту:

`tender_field_final_v1`

и сохранить его через UPSERT:

`tender_analysis_field_results`

Финальный UPSERT выполняется по ключу:

```text
(analysis_run_id, field_key)
```

---

## 4. RAW INPUT CONTRACT

На вход `When Executed by Another Workflow` поступают два разных формата field item.

Первая Code-нода `Подготовить #2 Targeted Recheck Request` является adapter layer и приводит оба формата к единому внутреннему контракту.

### 4.1. Сценарий `no_initial_candidates`

Приходит из FALSE-ветки `Поле закрыто из TenderMeta?`.

Наблюдавшийся реальный execution содержал сразу 15 field items.

Типичный item:

```json
{
  "analysis_run_id": "uuid",
  "field_catalog_version": "tender_fields_v1",
  "field_index": 21,
  "field_key": "warranty_obligations_guarantee",

  "metadata_resolved": false,
  "aggregation_status": null,
  "final_value_text": null,
  "confidence": null,
  "resolution_method": null,
  "evidence": [],

  "original_field": {
    "analysis_run_id": "uuid",
    "field_catalog_version": "tender_fields_v1",
    "field_index": 21,
    "field_key": "warranty_obligations_guarantee",

    "has_candidates": false,
    "candidates_count": 0,
    "confirmed_count": 0,
    "requires_review_count": 0,

    "source_documents_count": 0,
    "source_documents": [],
    "candidates": []
  }
}
```

Обязательные признаки этого сценария:

```text
metadata_resolved = false
original_field.has_candidates = false
original_field.candidates.length = 0
```

### 4.2. Сценарий `aggregation_recheck`

Приходит из TRUE-ветки `Нужен Targeted Recheck?`.

Типичный item:

```json
{
  "analysis_run_id": "uuid",
  "field_catalog_version": "tender_fields_v1",
  "field_index": 2,
  "field_key": "nm_price_with_vat",

  "aggregation_status": "requires_recheck",
  "final_value_text": "85000.00 руб (в т.ч. НДС)",
  "confidence": 0.4,

  "candidate_decisions": [],
  "supporting_fact_ids": [],
  "conflict_fact_ids": [],

  "needs_recheck": true,
  "recheck_reason_code": "ambiguous_scope",
  "recheck_note": "...",

  "aggregation_input": {
    "field_key": "nm_price_with_vat",
    "field_definition": {
      "title": "...",
      "definition": "...",
      "rules": []
    },
    "candidates": []
  },

  "semantic_aggregator_meta": {},
  "aggregation_validated": true
}
```

Обязательные признаки:

```text
aggregation_status = requires_recheck
needs_recheck = true
aggregation_validated = true
aggregation_input.candidates = [...]
```

`final_value_text` в этом сценарии **может быть строкой или null**. Это предварительное значение, а не гарантированный FINAL.

---

## 5. INTERNAL NORMALIZED RECHECK CONTRACT

Нода `Подготовить #2 Targeted Recheck Request` превращает оба RAW-формата в единый внутренний объект.

Пример структуры:

```json
{
  "analysis_run_id": "uuid",
  "field_catalog_version": "tender_fields_v1",
  "field_index": 2,
  "field_key": "nm_price_with_vat",

  "recheck_trigger": "aggregation_recheck",

  "original_aggregation": {
    "status": "requires_recheck",
    "preliminary_value": "85000.00 руб (в т.ч. НДС)",
    "confidence": 0.4,
    "recheck_reason_code": "ambiguous_scope",
    "recheck_note": "..."
  },

  "recheck_profile": {
    "title": "...",
    "objective": "...",
    "search_terms": [],
    "rules": []
  },

  "tender_metadata": {},
  "existing_candidates": [],
  "recheck_attempt": 1
}
```

### `recheck_trigger`

Допустимы только:

```text
aggregation_recheck
no_initial_candidates
```

### `existing_candidates`

Для `aggregation_recheck` берутся из:

```text
aggregation_input.candidates
```

Для `no_initial_candidates` берутся из:

```text
original_field.candidates
```

и в текущем сценарии ожидаются пустыми.

### `original_aggregation`

Для `aggregation_recheck` содержит реальный результат Round 1:

```text
status
preliminary_value
confidence
recheck_reason_code
recheck_note
```

Для `no_initial_candidates` формируется внутренний объект:

```text
status = no_initial_candidates
preliminary_value = null
confidence = null
recheck_reason_code = no_initial_candidates
```

---

## 6. RECHECK_PROFILES

`Подготовить #2 Targeted Recheck Request` содержит `RECHECK_PROFILES` для всех 27 полей.

Структура одного профиля:

```json
{
  "title": "Человеческое название поля",
  "objective": "Что именно нужно установить",
  "search_terms": [
    "термин 1",
    "термин 2"
  ],
  "metadata_keys": [
    "разрешённый ключ TenderMeta"
  ],
  "rules": [
    "смысловое правило 1",
    "смысловое правило 2"
  ]
}
```

### Назначение элементов

- `title` — название поля для AI;
- `objective` — узкая задача Targeted Recheck;
- `search_terms` — retrieval-термины;
- `metadata_keys` — allow-list structured TenderMeta для данного поля;
- `rules` — запреты и правила интерпретации.

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

### Проверенные structured TenderMeta keys

На текущем этапе осознанно используются только подтверждённые ключи:

```text
nm_price_with_vat     -> max_price
platform              -> platform
application_deadline  -> submission_close_at
```

Для остальных профилей `metadata_keys` сейчас в основном пуст.

---

## 7. Полная архитектура workflow

```text
When Executed by Another Workflow
        |
        v
Подготовить #2 Targeted Recheck Request
        |
        v
Найти контекст для #2 Targeted Recheck
        |
        v
Подготовить контекст #2 Targeted Recheck
        |
        v
Контекст для Targeted Recheck найден?
   /                               \
FALSE                              TRUE
 |                                  |
 |                         Подготовить запрос #2
 |                         AI Targeted Recheck
 |                                  |
 |                                  v
 |                         #2 AI Targeted Recheck v1
 |                                  |
 |                                  v
 |                         Проверить #2 evidence
 |                         Targeted Recheck
 |                                  |
 |                                  v
 |                         Есть candidate после
 |                         Targeted Recheck?
 |                           /             \
 |                        FALSE            TRUE
 |                          |                |
 |                 Есть исходный            v
 |                 candidate после     Подготовить запрос #2
 |                 неудачного Recheck? Validator Targeted Recheck
 |                    /       \             |
 |                  TRUE      FALSE          v
 |                   |          |       #2 AI Validator
 |                   |          |       Targeted Recheck
 |                   |          |             |
 |                   |          |             v
 |                   |          |       Проверить ответ #2
 |                   |          |       Validator Targeted Recheck
 |                   |          |             |
 |                   |          |             v
 |                   |          |       Есть пригодные candidates
 |                   |          |       после Validator?
 |                   |          |          /          \
 |                   |          |       FALSE         TRUE
 |                   |          |         |             |
 |                   |          |         |             v
 |                   |          |         |       Определить путь
 |                   |          |         |       после Validator
 |                   |          |         |             |
 |                   |          |         |             v
 |                   |          |         |       Путь = direct_final?
 |                   |          |         |          /        \
 |                   |          |         |       TRUE        FALSE
 |                   |          |         |        |            |
 |                   |          |         |        |            v
 |                   |          |         |        |      Собрать candidates
 |                   |          |         |        |      для Round 2
 |                   |          |         |        |            |
 |                   |          |         |        |            v
 |                   |          |         |        |      Semantic Aggregator
 |                   |          |         |        |      Round 2
 |                   |          |         |        |            |
 |                   |          |         |        |            v
 |                   |          |         |        |      FINAL Round 2
 |                   |          |         |        |
 v                   v          v         v        v
not_found        requires_review / not_found / direct FINAL / Round 2 FINAL
        \            |             |          /
         \           |             |         /
          `----------+-------------+--------'
                     |
                     v
             Normalize FINAL
                     |
                     v
               UPSERT PostgreSQL
```

Примечание: физически в workflow сейчас несколько копий `Normalize FINAL` и `Save FINAL`, поэтому схема выше показывает **логическую**, а не буквально одну общую ноду.

---

## 8. Этапы и ключевые ноды

### Stage 0 — Trigger

#### `When Executed by Another Workflow`

**Получает:** массив field items из `TENDER — Агрегация закупки`.  
**Делает:** передаёт items дальше без собственной бизнес-логики.  
**Выход:** RAW input одного из двух допустимых форматов.

---

### Stage 1 — Нормализация запроса

#### `Подготовить #2 Targeted Recheck Request`

**Получает:**

- RAW item `aggregation_recheck`; либо
- RAW item `no_initial_candidates`.

**Делает:**

1. проверяет `analysis_run_id` и `field_key`;
2. определяет `recheck_trigger`;
3. выбирает `RECHECK_PROFILE`;
4. получает TenderMeta;
5. ограничивает metadata через `metadata_keys`;
6. нормализует старые candidates;
7. формирует `original_aggregation`;
8. выставляет `recheck_attempt = 1`.

**Выход:** единый INTERNAL NORMALIZED RECHECK CONTRACT.

**Ключевые guards:**

- неизвестный сценарий Recheck -> error;
- неизвестный `field_key` / отсутствующий profile -> error.

**Current state:** скрытая зависимость от parent workflow устранена (`TR-3`).

Targeted Recheck получает необходимые данные через входной JSON и больше не обращается к нодам родительского workflow.

Это позволяет запускать и тестировать `TENDER - Targeted Recheck` автономно.

---

### Stage 2 — Targeted Retrieval

#### `Найти контекст для #2 Targeted Recheck`

**Получает:**

- `analysis_run_id`;
- `recheck_profile.search_terms`;
- разрешённые metadata;
- existing candidate provenance.

**Делает:**

- читает `tender_analysis_units`;
- ищет units по ключевым терминам;
- учитывает metadata values;
- повышает приоритет units, в которых находилось existing evidence;
- ранжирует найденные units;
- ограничивает объём контекста.

**Выход:** релевантные analysis units для поля.

---

#### `Подготовить контекст #2 Targeted Recheck`

**Получает:** найденные analysis units.

**Делает:**

- уменьшает retrieval output;
- оставляет релевантные semantic blocks;
- при необходимости добавляет соседние блоки;
- сохраняет provenance поиска;
- формирует `recheck_context`.

**Выход:**

```text
context_found
recheck_context
```

и служебные данные Targeted Recheck.

---

### Stage 3 — Проверка наличия контекста

#### `Контекст для Targeted Recheck найден?`

Проверяет:

```text
context_found === true
```

**TRUE:** переход к AI Extractor.

**FALSE:** итог зависит от наличия существующего usable candidate:

```text
existing candidate есть
→ requires_review
→ existing candidate сохраняется

existing candidate отсутствует
→ not_found
→ targeted_recheck_no_context
---

### Stage 4 — AI Targeted Recheck Extractor

#### `Подготовить запрос #2 AI Targeted Recheck`

**Получает:**

- `field_key`;
- `recheck_profile`;
- `recheck_context`;
- `existing_candidates`;
- разрешённую TenderMeta.

**Делает:**

- формирует компактный AI-контекст;
- убирает лишний retrieval noise;
- задаёт строгие правила поля;
- запрещает использовать внешние знания;
- запрещает считать отсутствие упоминания доказательством отрицательного факта;
- требует evidence для candidate.

**Выход:**

```text
system_prompt
user_prompt
```

и provenance текущего Recheck.

---

#### `#2 AI Targeted Recheck v1`

**Модель:** `deepseek-v4-pro`.

**Задача:** Extractor.

Допустимый смысловой результат:

```text
candidate_found
insufficient_evidence
```

AI не принимает окончательное решение по FINAL-полю.

---

### Stage 5 — Deterministic Evidence Validation

#### `Проверить #2 evidence Targeted Recheck`

**Получает:** JSON ответа Extractor + исходный разрешённый контекст.

**Проверяет:**

- schema;
- `field_key`;
- `recheck_outcome`;
- candidate structure;
- существование `analysis_unit_id`;
- существование `semantic_block_id`;
- наличие `quote` в реальном тексте блока;
- TenderMeta key allow-list;
- совпадение metadata value с реальным входом.

**Главный принцип:** AI не может сам доказать существование своего evidence.

Для semantic block должно выполняться:

```text
block существует
+
quote действительно содержится в block
```

Для TenderMeta:

```text
metadata_key разрешён
+
value соответствует реальному TenderMeta
```

**Выход:** технически валидированные candidates или `insufficient_evidence`.

---

### Stage 6 — Candidate branch

#### `Есть candidate после Targeted Recheck?`

TRUE только если:

```text
recheck_outcome = candidate_found
и
candidates.length > 0
```

**TRUE:** candidate идёт в Independent AI Validator.  
**FALSE:** проверяется наличие исходного candidate.

---

### Stage 7A — Recheck не сформировал новый candidate

#### `Есть исходный candidate после неудачного Recheck?`

Определяет, существовал ли usable candidate до Targeted Recheck.

##### TRUE

#### `Сформировать requires_review после неудачного Targeted Recheck`

Используется для:

```text
Round 1 имел candidate
+
Targeted Recheck не получил достаточно нового evidence
```

Финальный смысл:

```text
status = requires_review
resolution_method = targeted_recheck_unresolved_existing_candidate
```

Исходный candidate не теряется.

##### FALSE

Используется `not_found Finalizer`.

---

### Stage 7B — Independent AI Validator

#### `Подготовить запрос #2 Validator Targeted Recheck`

**Получает:** только candidates Extractor и контекст, на который они реально сослались.

**Делает:**

- не ищет новые facts;
- подготавливает кандидатов для независимой смысловой проверки;
- ограничивает контекст referenced analysis units.

---

#### `#2 AI Validator Targeted Recheck`

**Модель:** `deepseek-v4-pro`.

**Задача:** проверить, действительно ли реальное evidence доказывает именно целевое поле.

Допустимые verdict:

```text
confirmed
requires_review
rejected
```

---

#### `Проверить ответ #2 Validator Targeted Recheck`

Детерминированно проверяет:

- JSON schema;
- candidate indexes;
- что каждый входной candidate получил ровно одну validation;
- verdict;
- confidence;
- reason codes;
- отсутствие придуманных candidate indexes.

Добавляет к candidates:

```text
validator_verdict
validator_confidence
validator_reason_code
validator_reason_note
```

Считает:

```text
confirmed_count
requires_review_count
rejected_count
```

---

### Stage 8 — Проверка usable candidates

#### `Есть пригодные candidates после Validator?`

TRUE если:

```text
confirmed_count + requires_review_count > 0
```

**TRUE:** route selection.

**FALSE:** все новые candidates rejected / unusable.

Финальный путь зависит от существовавших до Recheck candidates:

```text
existing candidate есть
→ requires_review
→ existing candidate сохраняется

existing candidate отсутствует
→ not_found
→ all_recheck_candidates_rejected

---

### Stage 9 — Route selection

#### `Определить путь после Validator`

Определяет:

```text
direct_final
или
round_2
```

`direct_final` разрешён только когда одновременно:

1. Recheck стартовал из `no_initial_candidates`;
2. `existing_candidates.length === 0`;
3. пригодный candidate ровно один;
4. его `validator_verdict === confirmed`.

Все остальные usable cases отправляются в Round 2.

---

#### `Путь = direct_final?`

##### TRUE -> direct FINAL

#### `Сформировать FINAL из Recheck candidate`

Проверяет:

- route действительно `direct_final`;
- candidate существует;
- candidate `confirmed`;
- есть `value_text`;
- есть evidence;
- extractor confidence валиден;
- validator confidence валиден.

Финальная confidence:

```text
min(extractor_confidence, validator_confidence)
```

Результат:

```text
aggregation_status = resolved
resolution_method = targeted_recheck_single_confirmed_candidate
```

---

##### FALSE -> Round 2

#### `Собрать candidates для Round 2`

Объединяет:

**Старые candidates:**

```text
candidate_ref = fact:<fact_id>
origin = initial_analysis
```

**Новые candidates:**

```text
candidate_ref = recheck:<recheck_attempt>:<candidate_index>
origin = targeted_recheck
```

Rejected candidates в Round 2 не участвуют.

Проверяет:

- наличие `fact_id` у старых candidates;
- допустимый validator verdict;
- непустой `value_text`;
- корректный `candidate_index`;
- уникальность `candidate_ref`.

Выход:

```text
aggregation_round = 2
candidates = [...]
candidate_stats = ...
```

---

### Stage 10 — Semantic Aggregator Round 2

#### `Подготовить запрос #2 Semantic Aggregator`

**Получает:** старые + новые usable candidates.

**Делает:**

- нормализует evidence;
- использует `candidate_ref` вместо `fact_id`;
- объясняет AI, что это второй и финальный раунд;
- запрещает новый Targeted Recheck;
- разрешает только:
  - `resolved`;
  - `requires_review`.

`FIELD_RULES` Round 2 содержит правила для всех 27 `field_key`.

`TR-2` закрыт для MVP на уровне code coverage:

```text
любой field_key из tender_fields_v1
→ имеет Round 2 semantic rule
→ не должен падать с ошибкой "Пока нет правил для field_key"
---

#### `Semantic Aggregator1`

**Модель:** `deepseek-v4-pro`.

Сопоставляет старые и новые candidates и решает их роли:

```text
primary
duplicate
supporting
complement
conflict
not_applicable
```

---

#### `Проверить ответ #2 Semantic Aggregator`

Детерминированно проверяет:

- status;
- confidence;
- полный allow-list candidates;
- что каждый candidate рассмотрен ровно один раз;
- допустимые role;
- supporting/conflict lists;
- ровно один `primary` для resolved;
- отсутствие unresolved conflict у resolved;
- `needs_recheck = false` для Round 2;
- обязательный `review_reason_code` + `review_note` для `requires_review`.

---

#### `Сформировать FINAL после Round 2`

Допустимые статусы:

```text
resolved
requires_review
```

Формирует:

- `final_value_text`;
- `confidence`;
- final evidence;
- conflict evidence;
- candidate decisions;
- Recheck provenance;
- Validator provenance;
- Semantic Aggregator provenance.

Метод:

```text
resolution_method = semantic_aggregator_round_2
```

---

## 9. Финализация `not_found`

### Ограничение

`not_found` нельзя использовать, если до Targeted Recheck существовал пригодный initial candidate.

В таком случае итог:

```text
requires_review

Сейчас в workflow несколько физических копий `Сформировать not_found после Targeted Recheck...`, но логика у них одна.

`not_found` допустим только когда до Targeted Recheck не существовало usable initial candidate.

### Причина A — retrieval не нашёл контекст

```text
reason_code =
no_relevant_context_after_targeted_retrieval

resolution_method =
targeted_recheck_no_context
```

### Причина B — контекст найден, но evidence недостаточно

```text
reason_code =
insufficient_evidence_after_targeted_recheck

resolution_method =
targeted_recheck_insufficient_evidence
```

### Причина C — новые candidates полностью отклонены Validator

```text
reason_code =
all_recheck_candidates_rejected

resolution_method =
targeted_recheck_all_candidates_rejected
```

### Критическая семантика

`not_found` означает:

> После полного анализа предоставленных источников значение поля надёжно установить не удалось.

`not_found` **НЕ означает**:

- `нет`;
- `не требуется`;
- `не предусмотрено`;
- `false`.

---

## 10. FINAL CONTRACT — `tender_field_final_v1`

Все финальные ветки проходят через `Нормализовать FINAL поле...`.

Каноническая структура:

```json
{
  "result_contract_version": "tender_field_final_v1",

  "analysis_run_id": "uuid",
  "field_catalog_version": "tender_fields_v1",
  "field_index": 1,
  "field_key": "string",

  "status": "resolved | requires_review | not_found",
  "value_text": "string | null",
  "confidence": 0.0,
  "requires_human_review": false,

  "resolution_method": "string",
  "evidence": [],

  "review": null,
  "not_found": null,

  "audit": {
    "aggregation_round": null,
    "recheck_attempt": null,
    "original_aggregation": null,
    "recheck_profile": null,
    "targeted_recheck_result": null,
    "selected_candidate": null,
    "candidate_decisions": [],
    "supporting_candidate_refs": [],
    "conflict_candidate_refs": [],
    "conflict_evidence": [],
    "validator_summary": null,
    "rejected_candidates": [],
    "semantic_aggregator_meta": null
  }
}
```

### `resolved`

Требования:

```text
value_text != null
confidence in [0,1]
requires_human_review = false
review = null
not_found = null
```

### `requires_review`

Требования:

```text
confidence = null или число [0,1]
requires_human_review = true
review.reason_code != null
review.note != null
not_found = null
```

### `not_found`

Требования:

```text
value_text = null
confidence = null
requires_human_review = false
review = null
not_found.reason_code != null
not_found.note != null
```

---

## 11. PostgreSQL

### 11.1. Чтение — `tender_analysis_units`

Targeted Retrieval читает units текущего анализа.

| Колонка | Тип | Nullable | Роль |
|---|---|---:|---|
| `id` | uuid | NO | PK/internal id |
| `analysis_run_id` | uuid | NO | фильтр текущего анализа |
| `document_id` | uuid | NO | документ |
| `analysis_unit_id` | text | NO | стабильный ID analysis unit |
| `unit_index` | integer | YES | индекс unit |
| `units_total` | integer | YES | число units |
| `section_id` | text | YES | section id |
| `section_title` | text | YES | заголовок секции |
| `section_kind` | text | YES | тип секции |
| `part_index` | integer | YES | часть секции |
| `parts_total` | integer | YES | число частей |
| `source_pages` | jsonb | NO | страницы источника |
| `analysis_unit` | jsonb | NO | содержимое unit |
| `ai_segments` | jsonb | NO | semantic/AI segments |
| `provenance` | jsonb | NO | происхождение |
| `created_at` | timestamptz | NO | created |
| `updated_at` | timestamptz | NO | updated |

---

### 11.2. Запись — `tender_analysis_field_results`

| Колонка | Тип | Nullable | Роль |
|---|---|---:|---|
| `analysis_run_id` | uuid | NO | analysis |
| `field_catalog_version` | text | NO | версия каталога |
| `result_contract_version` | text | NO | `tender_field_final_v1` |
| `field_index` | smallint | NO | 1–27 |
| `field_key` | text | NO | ключ поля |
| `status` | text | NO | FINAL status |
| `value_text` | text | YES | значение |
| `confidence` | numeric | YES | confidence |
| `requires_human_review` | boolean | NO | требуется ли человек |
| `resolution_method` | text | NO | путь разрешения |
| `result_json` | jsonb | NO | полный FINAL + audit |
| `created_at` | timestamptz | NO | created |
| `updated_at` | timestamptz | NO | updated |

UPSERT:

```text
ON CONFLICT (analysis_run_id, field_key)
DO UPDATE
```

Цель:

- повторный execution не создаёт дубль;
- для одного `analysis_run_id + field_key` существует один актуальный FINAL-result.

---

## 12. Evidence и защита от галлюцинаций

Ключевая схема доверия:

```text
AI Extractor
    |
    v
Детерминированный Evidence Validator
    |
    |-- существует ли analysis_unit?
    |-- существует ли semantic_block?
    |-- quote реально содержится в block?
    |-- metadata key разрешён?
    `-- metadata value совпадает?
    |
    v
Independent AI Validator
    |
    v
Детерминированный Validator-response Validator
    |
    v
confirmed / requires_review / rejected
```

Таким образом:

- AI Extractor не может сам объявить invented quote доказательством;
- AI Validator не может потерять candidate без ошибки;
- rejected evidence не становится FINAL evidence;
- Round 2 работает только с candidates, прошедшими предыдущие проверки.

---

## 13. Основные ветвления
| IF / route | TRUE | FALSE |
|---|---|---|
| `Контекст для Targeted Recheck найден?` | AI Extractor | existing candidate → `requires_review`; без candidate → `not_found` |
| `Есть candidate после Targeted Recheck?` | Independent Validator | проверить existing candidate |
| `Есть исходный candidate после неудачного Recheck?` | `requires_review` | `not_found` |
| `Есть пригодные candidates после Validator?` | route selection | existing candidate → `requires_review`; без candidate → `not_found` |
| `Путь = direct_final?` | direct `resolved` | Semantic Aggregator Round 2 |

Edge cases `TR-0` и `TR-1` закрыты: existing candidate не теряется ни при отсутствии нового context, ни при отклонении всех новых Recheck candidates.

---

## 14. Инварианты workflow

Эти правила нельзя нарушать при изменениях.

1. **Один item = одно поле.**
2. Один execution может содержать несколько items.
3. `field_key` не должен меняться внутри обработки.
4. Targeted Recheck вызывается только для поля, которое не закрыто окончательно.
5. Отсутствие информации не является доказательством отрицательного факта.
6. `not_found` запрещён, если существует пригодный исходный candidate.
7. AI Extractor обязан возвращать evidence для candidate.
8. Semantic-block evidence должен существовать во входном allow-list.
9. Quote должен быть verbatim-фрагментом реального блока.
10. TenderMeta используется только через разрешённые `metadata_keys`.
11. Independent Validator не извлекает новые facts.
12. Rejected candidate не участвует в FINAL evidence.
13. Round 2 — последний Semantic Aggregator round.
14. После Round 2 `needs_recheck` всегда `false`.
15. Direct FINAL допустим только для одного нового `confirmed` candidate без старых candidates.
16. Все финальные ветки обязаны привести результат к `tender_field_final_v1`.
17. Каждый успешно обработанный item должен завершиться UPSERT в `tender_analysis_field_results`.
18. Повторный execution того же поля не должен создавать дубль.

---

## 15. Проверенные сценарии

| Сценарий | Состояние | Результат |
|---|---|---|
| no initial candidates + retrieval context отсутствует | ✅ проверено | `not_found` / `targeted_recheck_no_context` |
| no initial candidates + context есть + Extractor `insufficient_evidence` | ✅ проверено | `not_found` |
| no initial candidates + candidate найден + Validator rejected all | ✅ проверено | `not_found` |
| existing candidate + Recheck `insufficient_evidence` | ✅ проверено | `requires_review` |
| один новый confirmed candidate без старых | ✅ структурно проверено | direct FINAL / `resolved` |
| existing + новый usable candidate | ✅ проверено | Round 2 |
| Round 2 смог закрыть поле | ✅ проверено | `resolved` |
| Round 2 всё ещё не уверен | ✅ проверено | `requires_review` |
| no context + existing candidate | ✅ закрыто | existing candidate сохраняется → `requires_review` |
| новые candidates all rejected + existing candidate | ✅ закрыто | existing candidate сохраняется → `requires_review` |
| Round 2 для любого `field_key` каталога | ✅ закрыто для MVP на уровне code coverage | `FIELD_RULES` существуют для всех 27 полей; полный per-field regression ещё не выполнен |
| DeepSeek `finish_reason=stop`, но `message.content=""` | ⚠️ наблюдалось | сейчас execution падает |

---

## 16. Known Technical Debt

### TR-0 — existing candidate + no retrieval context

**Severity:** Critical  
**Status:** ✅ Closed

Исправлен сценарий:

```text
existing candidate
+
context_found = false
Теперь отсутствие нового retrieval context не приводит к not_found.
Результат:
existing candidate сохраняется
→ requires_review
TR-1 — existing candidate + all new candidates rejected
Severity: Critical
Status: ✅ Closed
Исправлен сценарий:
existing candidate
+
Targeted Recheck candidates
+
все новые candidates rejected
Новые rejected candidates не уничтожают исходный candidate.
Результат:
existing candidate сохраняется
→ requires_review
TR-2 — Round 2 semantic rules для всех 27 полей
Severity: Critical
Status: ✅ Closed (MVP)
В FIELD_RULES Semantic Aggregator Round 2 добавлены правила для всех 27 field_key.
Устранён архитектурный failure:
Пока нет правил для field_key=...
для полей каталога tender_fields_v1.
Что ещё остаётся как quality work:
отдельный regression каждого field_key через Round 2
→ проверка качества resolved / requires_review
Это больше не блокирует текущий MVP.
TR-3 — зависимость child workflow от parent nodes
Severity: Critical / architectural
Status: ✅ Closed
Убраны обращения Targeted Recheck к нодам родительского workflow.
Необходимые данные передаются через входной JSON.
Теперь child workflow:
TENDER - Targeted Recheck
может выполняться и тестироваться автономно без скрытых parent-node references.

---

### TR-5 — дублирование Normalize + Save

**Severity:** Medium  
**Status:** Open / refactoring

Сейчас различные финальные ветки физически содержат несколько копий:

```text
Нормализовать FINAL поле3
Нормализовать FINAL поле4
Нормализовать FINAL поле5
Нормализовать FINAL поле6
Нормализовать FINAL поле7
...
```

и соответствующие:

```text
Сохранить FINAL результат поля в БД3
Сохранить FINAL результат поля в БД4
...
```

Риск:

- логика копий может разъехаться;
- легко исправить одну ветку и забыть остальные.

Предпочтительное будущее решение без Merge:

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

Не блокирует текущий MVP.

---

### TR-6 — selective retry для DeepSeek отсутствует

**Severity:** Medium  
**Status:** Open

Наблюдался ответ API:

```text
finish_reason = stop
message.content = ""
reasoning_content != ""
```

Текущий deterministic validator правильно отклоняет пустой `message.content`.

Не следует использовать `reasoning_content` как финальный JSON.

Будущее поведение:

```text
invalid/empty content
    |
retry конкретного item
    |
retry limit
    |
hard fail
```

Нельзя перезапускать весь batch из-за одного transient AI response.

---

### TR-7 — fallback `existingCandidates[0]`

**Severity:** Medium  
**Status:** Open

В `Сформировать requires_review после неудачного Targeted Recheck` сначала ищется candidate, совпадающий с `original.preliminary_value`.

Если совпадение не найдено, используется:

```text
existingCandidates[0]
```

При нескольких реально разных candidates порядок массива не гарантирует, что первый — лучший.

Будущее решение должно быть детерминированным:

- match preliminary value;
- затем confidence / роли;
- либо `selected_candidate = null` при реальной неоднозначности.

---

### TR-8 — field rules размножены по нескольким слоям

**Severity:** Medium  
**Status:** Open / design debt

Смысловые правила поля сейчас присутствуют в нескольких местах:

- initial field catalog / Semantic Aggregator Round 1;
- `RECHECK_PROFILES`;
- Semantic Aggregator Round 2.

Риск — semantic drift: один слой обновили, другой забыли.

Будущее направление:

```text
единый versioned field catalog
        |
        |-- Round 1 rules
        |-- Recheck rules
        `-- Round 2 rules
```

---

### TR-9 — keyword-oriented retrieval

**Severity:** Low / future improvement  
**Status:** Open

Targeted Retrieval сейчас в основном основан на:

- `search_terms`;
- metadata values;
- existing evidence units;
- deterministic ranking;
- top-N units.

Для MVP это допустимо.

Позже можно рассмотреть гибридный retrieval:

```text
keyword
+
semantic/vector
+
field-aware ranking
```

только после измерения реальных miss cases.

---

## 17. Что уже не является открытой проблемой

### Side-effect contract

Ранее было неоднозначно, должен ли Targeted Recheck возвращать FINAL родителю.

Решение принято:

> Targeted Recheck сам нормализует и сохраняет FINAL field в PostgreSQL.

Это **не technical debt**.

---

### RECHECK_PROFILES

Профили Targeted Recheck уже существуют для всех 27 `field_key`.

Открытая проблема относится не к ним, а к Round 2 `FIELD_RULES`.

---

## 18. Safe Modification Checklist

Перед изменением `TENDER - Targeted Recheck` проверить:

1. Какой из двух RAW input-сценариев затрагивается:
   - `aggregation_recheck`;
   - `no_initial_candidates`.
2. Не меняется ли `field_key`.
3. Не нарушается ли `not_found` semantics.
4. Не теряется ли existing candidate.
5. Не допускается ли rejected candidate в FINAL evidence.
6. Все ли candidate IDs проверяются against allow-list.
7. Не разрешается ли повторный Targeted Recheck после Round 2.
8. Сохраняется ли `recheck_attempt`.
9. Сохраняются ли:
   - `original_aggregation`;
   - `recheck_profile`;
   - Validator provenance;
   - rejected candidates.
10. Выходит ли финальная ветка в:
    ```text
    tender_field_final_v1
    ```
11. Сохраняется ли FINAL через UPSERT.
12. При добавлении нового field:
    - добавить/проверить `RECHECK_PROFILE`;
    - добавить/проверить Round 2 `FIELD_RULES`;
    - проверить field semantics в Round 1.
13. После изменения прогнать regression scenarios из следующего раздела.

---

## 19. Regression Checklist

Минимальный набор тестов перед признанием изменений стабильными.

### R1 — no context / no initial candidates

Ожидание:

```text
not_found
reason_code = no_relevant_context_after_targeted_retrieval
```

### R2 — context exists / insufficient evidence / no initial candidates

Ожидание:

```text
not_found
reason_code = insufficient_evidence_after_targeted_recheck
```

### R3 — candidate found / all rejected / no initial candidates

Ожидание:

```text
not_found
reason_code = all_recheck_candidates_rejected
```

### R4 — existing candidate / unsuccessful Recheck

Ожидание:

```text
requires_review
resolution_method =
targeted_recheck_unresolved_existing_candidate
```

### R5 — one new confirmed candidate / no existing candidates

Ожидание:

```text
direct_final
resolved
resolution_method =
targeted_recheck_single_confirmed_candidate
```

### R6 — existing + new usable candidate

Ожидание:

```text
round_2
```

### R7 — Round 2 resolved

Ожидание:

```text
resolved
resolution_method =
semantic_aggregator_round_2
needs_recheck = false
```

### R8 — Round 2 unresolved

Ожидание:

```text
requires_review
resolution_method =
semantic_aggregator_round_2
needs_recheck = false
```

### R9 — existing candidate + no new retrieval context

Статус:

```text
✅ TR-0 closed
```

### R10 — existing candidate + all new candidates rejected

Статус:

```text
✅ TR-1 closed
```

### R11 — Round 2 на любом из 27 field_key

Статус:

```text
✅ code coverage реализован для всех 27 field_key
⚠️ полный per-field regression ещё не выполнен
```

### R12 — transient DeepSeek empty content

Ожидание после исправления `TR-6`:

```text
selective retry только данного item
```

---

## 20. Ближайший план работ по этому workflow

MVP-critical архитектурные проблемы Targeted Recheck:

```text
TR-0
TR-1
TR-2
TR-3
закрыты.
На текущем этапе Targeted Recheck не требует новых архитектурных изменений перед следующим системным milestone.
Следующий общий шаг проекта находится уже вне этого workflow:
AG-0
→ DB-backed 27/27 completion barrier
→ run completed
→ report
После первого законченного MVP вернуться к hardening Targeted Recheck:
1. TR-6 — selective AI retry.
2. TR-7 — убрать недетерминированный fallback existingCandidates[0].
3. расширить regression coverage Round 2 для всех 27 полей.
4. TR-5 — централизовать Normalize + UPSERT.
5. TR-8 — централизовать versioned field rules.
6. TR-9 — улучшать retrieval только на основании реальных miss cases.

---

## 21. Краткое резюме для быстрого восстановления контекста

`TENDER - Targeted Recheck` — дочерний workflow финальной перепроверки проблемных полей тендера.

Он принимает field items из `TENDER — Агрегация закупки` в двух случаях:

```text
aggregation_recheck
no_initial_candidates
```

Затем выполняет:

```text
field-aware retrieval
→ AI Extractor
→ deterministic evidence validation
→ independent AI Validator
→ deterministic Validator validation
→ direct FINAL или Semantic Aggregator Round 2
→ tender_field_final_v1
→ UPSERT PostgreSQL
```

Основной принцип качества:

> ни одно AI-утверждение не считается надёжным только потому, что его сформировала модель; evidence и структура ответа проверяются отдельными детерминированными слоями.

MVP-critical проблемы:

```text
TR-0
TR-1
TR-2
TR-3
закрыты.
Targeted Recheck можно считать архитектурно завершённым для текущего MVP.
Оставшийся долг относится в основном к reliability и maintainability:
TR-5
TR-6
TR-7
TR-8
TR-9
и не должен блокировать следующий системный milestone:
AG-0
→ 27/27 DB barrier
→ run completed
→ report
