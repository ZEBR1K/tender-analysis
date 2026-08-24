# DATA_MODEL — Tender Analysis

**Статус:** Active development / MVP  
**Последнее обновление:** 2026-08-23
**База данных:** PostgreSQL  
**Основной credential в n8n:** `KITATEH Tenders`  
**Назначение:** зафиксировать физическую модель данных тендерного анализа, связи между таблицами, lifecycle сущностей, ограничения и индексы.

---

# 1. Общая модель

## Live verification snapshot — 23.08.2026

Read-only audit run `f9d8e1d7-f01a-4d91-8eac-89c8376535c2` подтвердил текущую физическую модель и lifecycle:

```text
documents = 3
units = 18
facts = 38
FINAL rows = 27
run.status = completed
completed_at заполнен Finalization workflow
```

Распределение facts: `20 confirmed`, `10 requires_review`, `8 rejected`.
Распределение FINAL: `11 resolved`, `3 requires_review`, `13 not_found`.

Все 27 FINAL rows в проверенном run имели `field_catalog_version=tender_fields_v1`, `result_contract_version=tender_field_final_v1` и audit metadata.

Текущая модель данных состоит из пяти основных таблиц:

```text
tender_analysis_runs
        |
        +-- tender_analysis_documents
        |        |
        |        +-- tender_analysis_units
        |                 |
        |                 +-- tender_analysis_facts
        |
        `-- tender_analysis_field_results
```

Логический поток данных:

```text
analysis run
    ↓
documents
    ↓
analysis units
    ↓
candidate facts
    ↓
27 final field results
```

---

# 2. Назначение таблиц

| Таблица | Назначение |
|---|---|
| `tender_analysis_runs` | Корневая сущность одного запуска анализа закупки |
| `tender_analysis_documents` | Все документы, зарегистрированные в рамках run |
| `tender_analysis_units` | Нормализованные смысловые части документов, отправляемые в AI |
| `tender_analysis_facts` | Candidate facts, найденные Extractor и проверенные Validator |
| `tender_analysis_field_results` | Финальные результаты 27 полей после Aggregator / Targeted Recheck |

---

# 3. Связи между сущностями

```text
tender_analysis_runs.id
    |
    +-- 1:N --> tender_analysis_documents.analysis_run_id
    |
    +-- 1:N --> tender_analysis_units.analysis_run_id
    |
    +-- 1:N --> tender_analysis_facts.analysis_run_id
    |
    `-- logical 1:N --> tender_analysis_field_results.analysis_run_id
```

Документы и units связаны composite FK:

```text
tender_analysis_units
(document_id, analysis_run_id)
    ↓
tender_analysis_documents
(id, analysis_run_id)
```

Facts связаны с units composite FK:

```text
tender_analysis_facts
(document_id, analysis_unit_id, analysis_run_id)
    ↓
tender_analysis_units
(document_id, analysis_unit_id, analysis_run_id)
```

Важно:

```text
tender_analysis_field_results.analysis_run_id
```

логически относится к:

```text
tender_analysis_runs.id
```

но в текущей схеме **FOREIGN KEY отсутствует**.

См. `DM-0`.

---

# 4. `tender_analysis_runs`

## 4.1. Назначение

Одна строка = один полный анализ одной закупки.

Это root entity всей системы.

В ней хранятся:

- идентификаторы закупки;
- lifecycle status анализа;
- число документов;
- structured TenderMeta;
- run-level error;
- lifecycle timestamps.

---

## 4.2. Колонки

| # | Колонка | Тип | Nullable | Default |
|---:|---|---|---:|---|
| 1 | `id` | uuid | NO | `gen_random_uuid()` |
| 2 | `source` | text | NO | `'tenderplan'` |
| 3 | `tender_id` | text | NO | — |
| 4 | `tender_number` | text | YES | — |
| 5 | `tender_external_id` | text | YES | — |
| 6 | `status` | text | NO | `'created'` |
| 7 | `documents_total` | integer | NO | `0` |
| 8 | `tender_meta` | jsonb | NO | `'{}'::jsonb` |
| 9 | `error_message` | text | YES | — |
| 10 | `created_at` | timestamptz | NO | `now()` |
| 11 | `started_at` | timestamptz | NO | `now()` |
| 12 | `updated_at` | timestamptz | NO | `now()` |
| 13 | `ready_at` | timestamptz | YES | — |
| 14 | `aggregation_started_at` | timestamptz | YES | — |
| 15 | `completed_at` | timestamptz | YES | — |

---

## 4.3. PRIMARY KEY

```sql
PRIMARY KEY (id)
```

---

## 4.4. CHECK constraints

### `documents_total`

```sql
CHECK (documents_total >= 0)
```

### `status`

Разрешены только:

```text
created
processing
ready_for_aggregation
aggregating
completed
failed
```

Constraint:

```sql
CHECK (
  status = ANY (
    ARRAY[
      'created',
      'processing',
      'ready_for_aggregation',
      'aggregating',
      'completed',
      'failed'
    ]
  )
)
```

---

## 4.5. Lifecycle

Текущий ожидаемый lifecycle:

```text
created
  ↓
processing
  ↓
ready_for_aggregation
  ↓
aggregating
  ↓
completed
```

Ошибка:

```text
created / processing / ready_for_aggregation / aggregating
  ↓
failed
```

### Семантика timestamps

```text
created_at
→ строка run создана

started_at
→ начало анализа

ready_at
→ все документы готовы к агрегации

aggregation_started_at
→ Aggregator атомарно захватил run

completed_at
→ полный анализ завершён
```

`completed_at` заполняется Finalization workflow после успешной DB-backed проверки 27/27 уникальных FINAL fields и atomic completion claim.

---

## 4.6. Индексы

```sql
CREATE INDEX idx_tender_analysis_runs_status
ON tender_analysis_runs (status);
```

```sql
CREATE INDEX idx_tender_analysis_runs_tender_id
ON tender_analysis_runs (tender_id);
```

```sql
CREATE INDEX idx_tender_analysis_runs_tender_status
ON tender_analysis_runs (tender_id, status);
```

PK index:

```text
tender_analysis_runs_pkey (id)
```

---

## 4.7. Кто пишет / читает

### Пишут

- Orchestrator:
  - создаёт run;
  - сохраняет TenderMeta;
  - задаёт `documents_total`;
  - переводит lifecycle до processing.
- Document Worker / readiness logic:
  - участвует в переходе к `ready_for_aggregation`.
- Aggregator:
  - `ready_for_aggregation → aggregating`;
  - выставляет `aggregation_started_at`.
- Finalization workflow:
  - `aggregating → completed`;
  - `completed_at = NOW()`.

### Читают

- Document Worker;
- Aggregator;
- Targeted Recheck;
- Report Generation V2;
- error handling.

---

# 5. `tender_analysis_documents`

## 5.1. Назначение

Одна строка = один документ конкретного `analysis_run`.

Документы регистрируются **до запуска Document Workers**, чтобы система заранее знала полный набор входных документов.

---

## 5.2. Колонки

| # | Колонка | Тип | Nullable | Default |
|---:|---|---|---:|---|
| 1 | `id` | uuid | NO | `gen_random_uuid()` |
| 2 | `analysis_run_id` | uuid | NO | — |
| 3 | `document_index` | integer | NO | — |
| 4 | `file_name` | text | YES | — |
| 5 | `file_extension` | text | YES | — |
| 6 | `display_name` | text | YES | — |
| 7 | `download_url` | text | YES | — |
| 8 | `publication_at` | timestamptz | YES | — |
| 9 | `source_size` | bigint | YES | — |
| 10 | `mime_type` | text | YES | — |
| 11 | `file_size` | bigint | YES | — |
| 12 | `status` | text | NO | `'pending'` |
| 13 | `attempts` | integer | NO | `0` |
| 14 | `n8n_execution_id` | text | YES | — |
| 15 | `units_total` | integer | YES | — |
| 16 | `facts_count` | integer | YES | — |
| 17 | `error_message` | text | YES | — |
| 18 | `created_at` | timestamptz | NO | `now()` |
| 19 | `updated_at` | timestamptz | NO | `now()` |
| 20 | `started_at` | timestamptz | YES | — |
| 21 | `completed_at` | timestamptz | YES | — |

---

## 5.3. PRIMARY KEY

```sql
PRIMARY KEY (id)
```

---

## 5.4. FOREIGN KEY

```sql
FOREIGN KEY (analysis_run_id)
REFERENCES tender_analysis_runs(id)
ON DELETE CASCADE
```

Удаление run автоматически удаляет документы.

---

## 5.5. UNIQUE constraints

### Документ внутри run

```sql
UNIQUE (analysis_run_id, document_index)
```

Гарантирует один `document_index` на run.

### Composite identity

```sql
UNIQUE (id, analysis_run_id)
```

Нужен для composite FK из `tender_analysis_units`.

---

## 5.6. CHECK constraints

```sql
CHECK (document_index > 0)
```

```sql
CHECK (attempts >= 0)
```

```sql
CHECK (units_total IS NULL OR units_total >= 0)
```

```sql
CHECK (facts_count IS NULL OR facts_count >= 0)
```

Разрешённые document statuses:

```text
pending
processing
completed
failed
skipped
```

---

## 5.7. Lifecycle

```text
pending
  ↓
processing
  ↓
completed
```

Ошибочный путь:

```text
pending / processing
  ↓
failed
```

Отдельный терминальный путь:

```text
skipped
```

### Atomic claim

Document Worker должен атомарно захватывать только:

```text
pending
или
failed
```

и переводить в:

```text
processing
```

---

## 5.8. Индексы

```sql
CREATE INDEX idx_tender_analysis_documents_execution
ON tender_analysis_documents (n8n_execution_id);
```

```sql
CREATE INDEX idx_tender_analysis_documents_run
ON tender_analysis_documents (analysis_run_id);
```

```sql
CREATE INDEX idx_tender_analysis_documents_run_status
ON tender_analysis_documents (analysis_run_id, status);
```

Unique indexes:

```text
(id)
(id, analysis_run_id)
(analysis_run_id, document_index)
```

---

## 5.9. Кто пишет / читает

### Пишут

- Orchestrator:
  - регистрирует все документы;
  - задаёт `document_index`;
  - сохраняет URL и metadata.
- Document Worker:
  - claim;
  - attempts;
  - `n8n_execution_id`;
  - `units_total`;
  - `facts_count`;
  - error;
  - completed timestamps.

### Читают

- Document Worker;
- readiness check;
- Aggregator;
- error/debug pipeline.

---

# 6. `tender_analysis_units`

## 6.1. Назначение

Одна строка = одна `analysis_unit`, сформированная из нормализованного документа.

Это промежуточный слой между document parsing и AI extraction.

В таблице хранится не только текстовый chunk, а полный структурированный unit:

```text
section
part
source pages
analysis_unit JSON
ai_segments
provenance
```

---

## 6.2. Колонки

| # | Колонка | Тип | Nullable | Default |
|---:|---|---|---:|---|
| 1 | `id` | uuid | NO | `gen_random_uuid()` |
| 2 | `analysis_run_id` | uuid | NO | — |
| 3 | `document_id` | uuid | NO | — |
| 4 | `analysis_unit_id` | text | NO | — |
| 5 | `unit_index` | integer | YES | — |
| 6 | `units_total` | integer | YES | — |
| 7 | `section_id` | text | YES | — |
| 8 | `section_title` | text | YES | — |
| 9 | `section_kind` | text | YES | — |
| 10 | `part_index` | integer | YES | — |
| 11 | `parts_total` | integer | YES | — |
| 12 | `source_pages` | jsonb | NO | `'[]'::jsonb` |
| 13 | `analysis_unit` | jsonb | NO | `'{}'::jsonb` |
| 14 | `ai_segments` | jsonb | NO | `'[]'::jsonb` |
| 15 | `provenance` | jsonb | NO | `'{}'::jsonb` |
| 16 | `created_at` | timestamptz | NO | `now()` |
| 17 | `updated_at` | timestamptz | NO | `now()` |

---

## 6.3. PRIMARY KEY

```sql
PRIMARY KEY (id)
```

---

## 6.4. FOREIGN KEYS

### На run

```sql
FOREIGN KEY (analysis_run_id)
REFERENCES tender_analysis_runs(id)
ON DELETE CASCADE
```

### На документ того же run

```sql
FOREIGN KEY (document_id, analysis_run_id)
REFERENCES tender_analysis_documents(id, analysis_run_id)
ON DELETE CASCADE
```

Composite FK защищает от ошибки:

> unit одного run случайно привязали к документу другого run.

---

## 6.5. UNIQUE constraints

### Unit внутри документа

```sql
UNIQUE (document_id, analysis_unit_id)
```

### Unit + run identity

```sql
UNIQUE (
  document_id,
  analysis_unit_id,
  analysis_run_id
)
```

Второй UNIQUE нужен для FK из `tender_analysis_facts`.

---

## 6.6. CHECK constraints

```sql
CHECK (unit_index IS NULL OR unit_index > 0)
```

```sql
CHECK (units_total IS NULL OR units_total >= 0)
```

```sql
CHECK (part_index IS NULL OR part_index > 0)
```

```sql
CHECK (parts_total IS NULL OR parts_total > 0)
```

---

## 6.7. Важные JSONB поля

### `analysis_unit`

Полная нормализованная модель текущей analysis unit.

### `ai_segments`

Semantic blocks, которые отправляются Extractor.

Ожидаемая логика:

```text
primary semantic blocks
+
overlap semantic blocks
```

### `provenance`

Индекс для восстановления реального источника evidence:

```text
semantic_block_id
→ source/page/bbox/etc.
```

### `source_pages`

Список исходных страниц, связанных с unit.

---

## 6.8. Индексы

```sql
CREATE INDEX idx_tender_analysis_units_analysis_unit_id
ON tender_analysis_units (analysis_unit_id);
```

```sql
CREATE INDEX idx_tender_analysis_units_document
ON tender_analysis_units (document_id);
```

```sql
CREATE INDEX idx_tender_analysis_units_run
ON tender_analysis_units (analysis_run_id);
```

Unique indexes:

```text
(id)
(document_id, analysis_unit_id)
(document_id, analysis_unit_id, analysis_run_id)
```

---

## 6.9. Кто пишет / читает

### Пишет

Document Worker после:

```text
Docling
→ normalization
→ semantic sections
→ analysis units
```

### Читают

- Extractor pipeline;
- Evidence Validator;
- Targeted Recheck retrieval;
- debugging/audit.

---

# 7. `tender_analysis_facts`

## 7.1. Назначение

Одна строка = один candidate fact, найденный Extractor в одной analysis unit и прошедший Validator pipeline.

Это ещё **не FINAL result**.

Facts являются входом Aggregator.

---

## 7.2. Колонки

| # | Колонка | Тип | Nullable | Default |
|---:|---|---|---:|---|
| 1 | `id` | uuid | NO | `gen_random_uuid()` |
| 2 | `analysis_run_id` | uuid | NO | — |
| 3 | `document_id` | uuid | NO | — |
| 4 | `analysis_unit_id` | text | NO | — |
| 5 | `fact_index` | integer | NO | — |
| 6 | `field_catalog_version` | text | NO | `'tender_fields_v1'` |
| 7 | `field_key` | text | NO | — |
| 8 | `value_text` | text | NO | — |
| 9 | `extractor_status` | text | NO | — |
| 10 | `extractor_confidence` | double precision | NO | — |
| 11 | `extractor_review_reason_code` | text | YES | — |
| 12 | `extractor_review_note` | text | YES | — |
| 13 | `validator_verdict` | text | NO | — |
| 14 | `validator_confidence` | double precision | NO | — |
| 15 | `validator_reason_code` | text | YES | — |
| 16 | `validator_reason_note` | text | YES | — |
| 17 | `evidence` | jsonb | NO | `'[]'::jsonb` |
| 18 | `extractor_meta` | jsonb | NO | `'{}'::jsonb` |
| 19 | `validator_meta` | jsonb | NO | `'{}'::jsonb` |
| 20 | `created_at` | timestamptz | NO | `now()` |
| 21 | `updated_at` | timestamptz | NO | `now()` |

---

## 7.3. PRIMARY KEY

```sql
PRIMARY KEY (id)
```

---

## 7.4. FOREIGN KEYS

### На run

```sql
FOREIGN KEY (analysis_run_id)
REFERENCES tender_analysis_runs(id)
ON DELETE CASCADE
```

### На конкретную analysis unit

```sql
FOREIGN KEY (
  document_id,
  analysis_unit_id,
  analysis_run_id
)
REFERENCES tender_analysis_units(
  document_id,
  analysis_unit_id,
  analysis_run_id
)
ON DELETE CASCADE
```

Это сильный инвариант:

```text
fact
→ должен принадлежать существующей unit
→ того же document
→ того же run
```

---

## 7.5. UNIQUE

```sql
UNIQUE (
  document_id,
  analysis_unit_id,
  fact_index
)
```

`fact_index` уникален только внутри конкретной analysis unit.

---

## 7.6. CHECK constraints

### `fact_index`

```sql
CHECK (fact_index >= 0)
```

### Extractor confidence

```sql
CHECK (
  extractor_confidence >= 0
  AND extractor_confidence <= 1
)
```

### Validator confidence

```sql
CHECK (
  validator_confidence >= 0
  AND validator_confidence <= 1
)
```

### Extractor status

Разрешены:

```text
found
requires_review
```

### Validator verdict

Разрешены:

```text
confirmed
requires_review
rejected
```

---

## 7.7. `field_key` CHECK

PostgreSQL физически фиксирует текущие 27 field keys.

Это означает:

```text
tender_fields_v1
```

защищён не только prompt/schema validation, но и DB constraint.

Разрешены:

```text
procurement_subject
nm_price_with_vat
platform
procedure_type
application_deadline
application_review_date
results_date
customer
customer_contacts
participation_cost
participation_guarantee
evaluation_criteria
delivery_term
payment_terms
special_account_or_treasury
bank_support
government_contract
rebidding
national_regime
advance_contract_guarantee
warranty_obligations_guarantee
licenses_certificates
required_official_certificates
similar_supply_experience
analog_allowed
analog_definition
application_documents
```

Следствие:

> добавление, удаление или переименование поля требует DB migration.

---

## 7.8. Evidence

`evidence` хранится как JSONB.

Основной смысл:

```text
fact
→ evidence[]
→ semantic_block_id / quote / provenance
```

Evidence Validator проверяет, что quote действительно присутствует в указанном semantic block.

---

## 7.9. Индексы

```sql
CREATE INDEX idx_tender_analysis_facts_document
ON tender_analysis_facts (document_id);
```

```sql
CREATE INDEX idx_tender_analysis_facts_run_field
ON tender_analysis_facts (analysis_run_id, field_key);
```

Это основной индекс для Aggregator grouping.

```sql
CREATE INDEX idx_tender_analysis_facts_unit
ON tender_analysis_facts (document_id, analysis_unit_id);
```

```sql
CREATE INDEX idx_tender_analysis_facts_verdict
ON tender_analysis_facts (analysis_run_id, validator_verdict);
```

Unique indexes:

```text
(id)
(document_id, analysis_unit_id, fact_index)
```

---

## 7.10. Кто пишет / читает

### Пишет

Document Worker после:

```text
Extractor
→ deterministic evidence validation
→ independent Validator
→ deterministic Validator response validation
```

### Читает

Aggregator.

Aggregator использует только:

```text
validator_verdict IN (
  confirmed,
  requires_review
)
```

Rejected facts сохраняются для audit/statistics, но не являются aggregation candidates.

---

# 8. `tender_analysis_field_results`

## 8.1. Назначение

Одна строка = финальный результат одного из 27 полей конкретного analysis run.

Это canonical terminal storage field-level анализа.

FINAL contract:

```text
tender_field_final_v1
```

---

## 8.2. Колонки

| # | Колонка | Тип | Nullable | Default |
|---:|---|---|---:|---|
| 1 | `analysis_run_id` | uuid | NO | — |
| 2 | `field_catalog_version` | text | NO | — |
| 3 | `result_contract_version` | text | NO | — |
| 4 | `field_index` | smallint | NO | — |
| 5 | `field_key` | text | NO | — |
| 6 | `status` | text | NO | — |
| 7 | `value_text` | text | YES | — |
| 8 | `confidence` | numeric | YES | — |
| 9 | `requires_human_review` | boolean | NO | `false` |
| 10 | `resolution_method` | text | NO | — |
| 11 | `result_json` | jsonb | NO | — |
| 12 | `created_at` | timestamptz | NO | `now()` |
| 13 | `updated_at` | timestamptz | NO | `now()` |

---

## 8.3. PRIMARY KEY

```sql
PRIMARY KEY (
  analysis_run_id,
  field_key
)
```

Это обеспечивает:

```text
один FINAL result
на один field_key
внутри одного analysis_run
```

---

## 8.4. UNIQUE

```sql
UNIQUE (
  analysis_run_id,
  field_index
)
```

Это дополнительно запрещает:

```text
одному run иметь два разных поля с одним field_index
```

---

## 8.5. CHECK constraints

### `field_index`

```sql
CHECK (
  field_index >= 1
  AND field_index <= 27
)
```

### `confidence`

```sql
CHECK (
  confidence IS NULL
  OR (
    confidence >= 0
    AND confidence <= 1
  )
)
```

### `status`

Разрешены:

```text
resolved
not_found
requires_review
```

---

## 8.6. FINAL semantics

### `resolved`

```text
value_text != null
confidence != null
requires_human_review = false
```

### `not_found`

Семантически:

```text
value_text = null
confidence = null
```

Причина находится внутри:

```text
result_json.not_found
```

`not_found` не означает отрицательный ответ.

### `requires_review`

```text
requires_human_review = true
```

Подробности находятся в:

```text
result_json.review
```

---

## 8.7. `result_json`

Хранит полный canonical объект:

```text
tender_field_final_v1
```

Включая:

```text
status
value_text
confidence
resolution_method
evidence
review
not_found
audit
```

Отдельные колонки таблицы являются индексируемой / удобной для отчётов projection финального JSON.

---

## 8.8. UPSERT

Используемая модель сохранения:

```sql
INSERT ...
ON CONFLICT (analysis_run_id, field_key)
DO UPDATE ...
```

Это делает final field persistence идемпотентным.

---

## 8.9. Индексы

PK:

```text
(analysis_run_id, field_key)
```

UNIQUE:

```text
(analysis_run_id, field_index)
```

Также существует отдельный индекс:

```text
tender_analysis_field_results_unique
(analysis_run_id, field_key)
```

который дублирует PK по тем же колонкам.

См. `DM-1`.

---

## 8.10. Кто пишет / читает

### Пишут

- Aggregator:
  - Round 1 resolved;
  - deterministic TenderMeta resolved.
- `TENDER - Targeted Recheck`:
  - resolved;
  - not_found;
  - requires_review.

### Читают / будут читать

- Finalization workflow для 27/27 completion barrier;
- Report Generation V2 для immutable snapshot и Report Model;
- будущие PDF/DOCX/XLSX builders;
- будущая delivery-интеграция;
- future audit/frontend.

---

# 9. Referential integrity

## 9.1. Реальные FK

```text
runs
  ↓
documents
  ↓
units
  ↓
facts
```

Все эти связи имеют:

```text
ON DELETE CASCADE
```

Следовательно, удаление run каскадно удаляет:

```text
documents
units
facts
```

---

## 9.2. `field_results` — исключение

В текущей схеме нет:

```sql
FOREIGN KEY (analysis_run_id)
REFERENCES tender_analysis_runs(id)
ON DELETE CASCADE
```

Поэтому теоретически возможен orphan:

```text
field_result.analysis_run_id
→ run отсутствует
```

Это не соответствует логической модели.

См. `DM-0`.

---

# 10. Основные DB invariants

1. Один `analysis_run` идентифицируется UUID `runs.id`.
2. Один document принадлежит ровно одному run.
3. `document_index > 0`.
4. `(analysis_run_id, document_index)` уникален.
5. Unit принадлежит конкретному document и тому же run.
6. `(document_id, analysis_unit_id)` уникален.
7. Fact принадлежит существующей unit того же document/run.
8. Fact имеет только один из 27 разрешённых `field_key`.
9. Extractor confidence всегда `[0,1]`.
10. Validator confidence всегда `[0,1]`.
11. Один `(document_id, analysis_unit_id, fact_index)` уникален.
12. Один run имеет максимум один FINAL по `field_key`.
13. Один run имеет максимум один FINAL по `field_index`.
14. `field_index` FINAL ограничен диапазоном `1..27`.
15. FINAL status только:
    - resolved;
    - not_found;
    - requires_review.
16. Один run считается логически готовым к report stage только после появления **27 уникальных FINAL fields**.
17. Удаление run должно логически удалять все дочерние сущности.

Пункт 17 сейчас физически выполняется для documents/units/facts, но не для field_results.

---

# 11. Типичный путь записи данных

```text
1. Orchestrator
   ↓
INSERT tender_analysis_runs

2. Orchestrator
   ↓
INSERT all tender_analysis_documents

3. Document Worker
   ↓
UPDATE document → processing

4. Document parsing / chunking
   ↓
INSERT tender_analysis_units

5. Extractor + Validator
   ↓
INSERT tender_analysis_facts

6. Document Worker
   ↓
UPDATE document → completed

7. Readiness logic
   ↓
UPDATE run → ready_for_aggregation

8. Aggregator
   ↓
UPDATE run → aggregating

9. Aggregator / Targeted Recheck
   ↓
UPSERT tender_analysis_field_results

10. Finalization workflow
   ↓
COUNT(unique FINAL fields) = 27

11. Atomic completion claim
   ↓
UPDATE run → completed
completed_at = NOW()
```

---

# 12. Типичный путь чтения данных

## Document Worker

```text
runs
documents
units
```

## Extractor / Validator

```text
units
```

## Aggregator

```text
runs
documents
facts
```

## Targeted Recheck

```text
units
facts / existing candidates
TenderMeta
```

## Report Generation V2

```text
runs
field_results
documents
facts
units
```

Workflow читает эти таблицы одним read-only snapshot query. PDF/DOCX/XLSX и delivery остаются future consumers.

---

# 13. Индексная стратегия — текущая оценка

Для MVP текущие индексы в целом соответствуют основным query patterns:

### Run lookup

```text
status
tender_id
(tender_id, status)
```

### Document worker/readiness

```text
analysis_run_id
(analysis_run_id, status)
n8n_execution_id
```

### Unit retrieval

```text
analysis_run_id
document_id
analysis_unit_id
```

### Aggregator

```text
(analysis_run_id, field_key)
(analysis_run_id, validator_verdict)
```

### FINAL results

PK начинается с:

```text
analysis_run_id
```

поэтому запросы:

```sql
WHERE analysis_run_id = ...
```

могут использовать PK btree.

Отдельный index только на `analysis_run_id` для `field_results` на MVP не обязателен.

---

# 14. Known Data Model Technical Debt

## DM-0 — у `tender_analysis_field_results` отсутствует FK на run

**Severity:** Medium / architectural integrity  
**Status:** Open

Сейчас:

```text
field_results.analysis_run_id
```

не защищён FOREIGN KEY.

Риск:

- orphan final results;
- delete run не удалит field results;
- логическая модель расходится с физической.

Ожидаемая связь:

```sql
FOREIGN KEY (analysis_run_id)
REFERENCES tender_analysis_runs(id)
ON DELETE CASCADE
```

Не обязательно чинить до первого MVP, если текущие workflows всегда используют существующий run, но это нужно не забыть.

---

## DM-1 — дублирующий UNIQUE index на `field_results`

**Severity:** Low  
**Status:** Open

Существуют одновременно:

```text
PRIMARY KEY (analysis_run_id, field_key)
```

и индекс:

```text
tender_analysis_field_results_unique
(analysis_run_id, field_key)
```

Они индексируют одинаковый набор колонок.

Дополнительный UNIQUE index функционально избыточен и создаёт лишнюю работу на INSERT/UPDATE.

Можно удалить после проверки, что он не используется каким-либо нестандартным tooling.

---

## DM-2 — `field_results` не имеет DB CHECK по допустимым `field_key`

**Severity:** Low / Medium  
**Status:** Open

`tender_analysis_facts.field_key` физически ограничен 27 значениями.

Но `tender_analysis_field_results.field_key` такого CHECK сейчас не имеет.

Система защищает это на уровне workflow и `field_index`, однако БД технически может принять:

```text
field_key = typo_or_unknown_field
```

если `field_index` валиден.

В будущем возможно:

- добавить аналогичный CHECK;
- либо перейти на отдельную versioned catalog table.

До стабилизации каталога не является MVP blocker.

---

## DM-3 — `field_catalog_version` физически не связан с набором `field_key`

**Severity:** Low / future design  
**Status:** Open

Сейчас:

```text
field_catalog_version = tender_fields_v1
```

хранится текстом.

Но БД не проверяет:

> соответствует ли конкретный field_key указанной версии каталога.

На MVP допустимо.

При появлении `tender_fields_v2` лучше рассмотреть полноценный versioned catalog.

---

## DM-4 — JSONB contracts проверяются application layer, не PostgreSQL

**Severity:** Low  
**Status:** Accepted for MVP

Например:

```text
result_json
analysis_unit
ai_segments
provenance
evidence
```

имеют тип `jsonb`, но PostgreSQL не валидирует их внутреннюю JSON Schema.

Эта ответственность сейчас лежит на deterministic Code Nodes.

Это сознательно приемлемо для MVP.

---

# 15. Safe DB Change Checklist

Перед изменением схемы:

1. Проверить все n8n SQL nodes, которые пишут таблицу.
2. Проверить `queryReplacement` expressions.
3. Проверить `ON CONFLICT` keys.
4. Проверить composite FK.
5. Проверить cascading delete.
6. Проверить старые rows на соответствие новому constraint.
7. Не менять `field_key` без новой версии каталога.
8. Не менять диапазон 27 полей без изменения:
   - FIELD_CATALOG;
   - grouping;
   - readiness;
   - report generation.
9. Перед удалением индекса проверить query plan / его уникальность.
10. Все schema migrations сохранять отдельно в проекте.

---

# 16. Regression Checklist после DB migration

### DB1 — create run

Ожидание:

```text
status=created
documents_total>=0
```

### DB2 — register documents

Ожидание:

```text
unique (analysis_run_id, document_index)
```

### DB3 — invalid document status

Ожидание:

```text
DB reject
```

### DB4 — unit чужого run

Ожидание:

```text
composite FK reject
```

### DB5 — fact чужой unit

Ожидание:

```text
composite FK reject
```

### DB6 — unknown fact field_key

Ожидание:

```text
DB reject
```

### DB7 — confidence > 1

Ожидание:

```text
DB reject
```

### DB8 — duplicate fact index in one unit

Ожидание:

```text
DB reject
```

### DB9 — duplicate FINAL field_key in run

Ожидание:

```text
UPSERT / PK conflict
```

### DB10 — duplicate FINAL field_index in run

Ожидание:

```text
UNIQUE reject
```

### DB11 — final field status invalid

Ожидание:

```text
DB reject
```

### DB12 — delete run

Текущее ожидание:

```text
documents deleted
units deleted
facts deleted
field_results currently NOT guaranteed by FK
```

После `DM-0`:

```text
field_results deleted too
```

---

# 17. Что считать source of truth

### Physical database source of truth

```text
PostgreSQL schema
constraints
indexes
```

### Semantic field source of truth

```text
FIELD_CATALOG.md
```

### Final field application contract

```text
tender_field_final_v1
```

### Workflow behavior

```text
workflows/*.md
+
actual n8n workflow source
```

Если документация расходится с реальной PostgreSQL schema, физическая schema считается фактом, а документация должна быть обновлена.

---

# 18. Краткое резюме

Текущая модель построена вокруг:

```text
run
→ documents
→ units
→ facts
→ final fields
```

Основные сильные стороны:

- UUID root identity;
- documents зарегистрированы заранее;
- composite FK защищают соответствие run/document/unit;
- facts ограничены 27 `field_key`;
- confidence/status валидируются на уровне БД;
- FINAL имеет уникальность и по `field_key`, и по `field_index`;
- основные query paths индексированы.

Главные открытые вопросы:

```text
DM-0
field_results не имеет FK на runs

DM-1
дублирующий UNIQUE index field_results

DM-2
field_results.field_key не имеет DB CHECK каталога
```

Для текущего MVP ни один из `DM-1..DM-4` не блокирует дальнейшую разработку.

`DM-0` желательно исправить до production hardening, но он не обязан останавливать текущую работу над TR/AG pipeline.
