# ARCHITECTURE — Tender Analysis System

**Статус:** Active development / MVP  
**Последнее обновление:** 2026-08-22  
**Назначение:** верхнеуровневая архитектурная спецификация всей системы анализа тендеров в n8n.

---

# 1. Цель системы

Система принимает одну закупку из TenderPlan, обрабатывает все приложенные документы, извлекает подтверждённые candidate facts по фиксированному каталогу из 27 полей, агрегирует их и должна сформировать финальный результат анализа закупки.

Текущая MVP-цель:

```text
tender_id
→ получить TenderPlan FullInfo
→ зарегистрировать все документы
→ обработать каждый документ
→ извлечь и проверить facts
→ агрегировать 27 полей
→ для каждого поля получить:
   resolved / not_found / requires_review
→ сохранить 27 FINAL field results
→ Markdown
→ XLSX
→ Telegram
```

На текущем этапе реализовано всё до:

```text
27 FINAL field results сохраняются в PostgreSQL
```

Но ещё не реализованы:

```text
27/27 completion barrier
→ run completed
→ Markdown
→ XLSX
→ Telegram
```

---

# 2. Что MVP НЕ делает

Текущий MVP не принимает бизнес-решение:

```text
"Подходит ли тендер компании?"
```

Он не сравнивает закупку с профилем компании Дмитрия.

Цель MVP:

> достоверно извлечь и структурировать 27 полей тендера с evidence и понятным статусом результата.

Company matching — отдельный будущий слой.

---

# 3. Основные компоненты

Система состоит из пяти n8n workflow:

```text
1. ТЕНДЕРЫ ОРКЕСТРАТОР
2. TENDER — Обработать документ
3. TENDER — Ошибка обработки документа
4. TENDER — Агрегация закупки
5. TENDER - Targeted Recheck
```

И пяти основных PostgreSQL таблиц:

```text
tender_analysis_runs
tender_analysis_documents
tender_analysis_units
tender_analysis_facts
tender_analysis_field_results
```

---

# 4. Общая архитектура

```text
                ┌─────────────────────┐
                │     TenderPlan      │
                │      FullInfo       │
                └──────────┬──────────┘
                           │
                           v
                ┌─────────────────────┐
                │ ТЕНДЕРЫ ОРКЕСТРАТОР │
                └──────────┬──────────┘
                           │
                 create analysis_run
                 register ALL documents
                           │
                           v
                ┌─────────────────────┐
                │  Document Workers   │
                │  one per document   │
                └──────────┬──────────┘
                           │
                 Docling + AI pipeline
                           │
                           v
                ┌─────────────────────┐
                │ tender_analysis_    │
                │       facts         │
                └──────────┬──────────┘
                           │
                 all documents completed
                           │
                           v
                ┌─────────────────────┐
                │ TENDER — Агрегация  │
                │      закупки        │
                └──────────┬──────────┘
                           │
                 exactly 27 field items
                     /             \
                    /               \
                   v                 v
        Semantic Aggregator       TenderMeta
             Round 1              Resolver
                   \                 /
                    \               /
                     v             v
                   Targeted Recheck
                   where necessary
                          │
                          v
                ┌─────────────────────┐
                │ field_results       │     
                │ tender_field_final  │	    
                │        _v1          │
                └──────────┬──────────┘
                           │
                 27 / 27 FINAL fields
                           │
                           v
                     CURRENT GAP
                           │
                           v
               DB-backed completion
                       barrier
                           │
                           v
                 run.status=completed
                           │
                           v
                    Markdown / XLSX
                           │
                           v
                       Telegram

---

# 5. Workflow responsibility matrix

| Workflow | Главная ответственность | Что не делает |
|---|---|---|
| `ТЕНДЕРЫ ОРКЕСТРАТОР` | Создать run, зарегистрировать документы, запустить Workers | Не анализирует содержимое документов |
| `TENDER — Обработать документ` | Полностью обработать один документ и сохранить facts | Не агрегирует факты между документами |
| `TENDER — Ошибка обработки документа` | Пометить упавший processing-document как failed | Не решает retry policy всего run |
| `TENDER — Агрегация закупки` | Свести candidate facts в 27 field items | Пока не завершает run после 27 FINAL |
| `TENDER - Targeted Recheck` | Повторно проверить проблемное поле | Не является глобальным Aggregator |

---

# 6. Основной data flow

```text
TenderPlan FullInfo
        ↓
tender_meta + attachments
        ↓
analysis_run
        ↓
registered documents
        ↓
normalized document
        ↓
semantic blocks
        ↓
analysis units
        ↓
Extractor candidate facts
        ↓
grounded evidence candidates
        ↓
Validator verdicts
        ↓
tender_analysis_facts
        ↓
27 grouped fields
        ↓
Round 1 / TenderMeta / Recheck
        ↓
tender_field_final_v1
        ↓
tender_analysis_field_results
```

---

# 7. Корневая сущность — `analysis_run`

Каждый полный анализ закупки имеет:

```text
analysis_run_id UUID
```

Он является главным correlation ID всей системы.

Все основные сущности привязаны к нему:

```text
run
├── documents
├── units
├── facts
└── final field results
```

---

# 8. Lifecycle analysis run

Разрешённые статусы:

```text
created
processing
ready_for_aggregation
aggregating
completed
failed
```

Intended happy path:

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

В current production topology claim nodes существуют, но execution graph их обходит и идёт напрямую к загрузке фактов. Поэтому фактическое выполнение перехода:

```text
ready_for_aggregation → aggregating
```

через Aggregator claim не подтверждено текущим export. Система может записывать FINAL fields, но пока не выполняет переход:

```text
aggregating → completed
```

Это `AG-0`.

---

# 9. Lifecycle документа

Разрешённые статусы:

```text
pending
processing
completed
failed
skipped
```

Happy path:

```text
pending
   ↓
processing
   ↓
completed
```

Error path:

```text
processing
   ↓
failed
```

Retry path:

```text
failed
   ↓
processing
```

`skipped` существует в DB schema, но текущая readiness semantics не считает его эквивалентом completed.

---

# 10. Архитектурный принцип №1 — зарегистрировать все документы заранее

Orchestrator сначала выполняет:

```text
INSERT / UPSERT ALL tender documents
```

и только после этого:

```text
Split Out
→ Worker per document
```

Это критичный invariant.

Почему:

```text
readiness
=
сколько документов существует вообще
vs
сколько уже completed
```

Если документы появлялись бы в БД постепенно по мере Worker execution, невозможно было бы надёжно определить, что анализ всех документов завершён.

---

# 11. Orchestrator

Текущий путь:

```text
Manual Trigger
→ hardcoded tender_id
→ TenderPlan FullInfo
→ normalize
→ create run
→ register all documents
→ split
→ temporary extension filter
→ Execute Document Worker
```

На текущем MVP Orchestrator поддерживает запуск Worker только для:

```text
pdf
docx
xlsx
```

Это временное ограничение.

---

# 12. Orchestrator input / production boundary

Сейчас точка входа:

```text
Manual Trigger
+
hardcoded tender_id
```

Это development-only.

В будущем можно заменить trigger на:

```text
Webhook
Telegram
Bitrix
Scheduler
API
another workflow
```

без изменения downstream architecture, если сохраняется контракт:

```text
tender_id
```

---

# 13. TenderMeta

Orchestrator нормализует structured TenderPlan metadata в:

```text
tender_meta
```

Примеры:

```text
title
max_price
platform
submission_close_at
primary_customer
customers
guarantee_application
guarantee_contract
prepayment
...
```

TenderMeta используется как:

```text
structured trusted context
```

но deterministic разрешение FINAL-полей допускается только для явно разрешённых mappings.

---

# 14. Document Worker — one execution = one document

Главный execution invariant:

```text
1 Worker execution
=
1 document
```

Документ может содержать:

```text
1..N analysis units
```

но Worker execution не должен смешивать разные:

```text
document_id
analysis_run_id
```

---

# 15. Atomic document claim

Перед обработкой:

```text
pending / failed
→ processing
```

через conditional PostgreSQL UPDATE.

Это предотвращает:

```text
двойную параллельную обработку одного документа
```

При claim сохраняется:

```text
n8n_execution_id
```

который позже используется Error Workflow для correlation.

---

# 16. Download layer

Текущий Worker скачивает файл через RU proxy.

Boundary:

```text
registered document metadata
+
binary file
```

После download canonical metadata перечитываются из PostgreSQL, а не доверяются старому Orchestrator payload.

---

# 17. Docling parser layer

Поддерживаемый рабочий путь:

```text
pdf / docx / xlsx
→ IBM Docling async
→ JSON artifact
→ Markdown artifact optional
```

Primary source:

```text
Docling JSON
```

Markdown используется как дополнительный artifact.

---

# 18. Docling async lifecycle

```text
upload
→ task_id
→ pending
→ Wait
→ poll
→ processing / pending
→ Wait
→ ...
→ success
→ download result
```

Текущие gaps:

```text
нет явной terminal-failure ветки
нет polling deadline
```

---

# 19. Universal Normalization

Docling-specific structure преобразуется в собственный normalized representation.

Поддерживаются:

```text
texts
tables
pictures
groups
key_value_items
form_items
```

Ключевой принцип:

> downstream AI pipeline не должен зависеть от внутреннего формата Docling сильнее необходимого.

---

# 20. Anti-data-loss parsing

Normalizer считает:

```text
visited refs
unknown refs
unvisited refs
coverage
```

Целевое состояние:

```text
unknown_refs = 0
unvisited_content_refs = 0
coverage = 1
```

Это первый системный anti-data-loss barrier.

---

# 21. Semantic layer

После physical parsing:

```text
blocks
→ semantic_blocks
→ sections
```

Каждому semantic block назначается:

```text
semantic_block_id
```

например:

```text
sb_0001
```

Semantic block является основной evidence-unit системы.

---

# 22. Chunking

Текущая настройка:

```text
maxPrimaryApproxTokens = 3200
approxCharsPerToken = 3
overlapSemanticBlocks = 1
```

Chunking учитывает:

```text
sheet
section
subsection
semantic block
token budget
```

а не просто длину текста.

---

# 23. Chunking invariants

1. Один semantic block не режется посередине.
2. Каждый semantic block primary ровно в одной analysis unit.
3. Overlap не считается primary.
4. Table block не используется как overlap.
5. Разные XLSX sheets не смешиваются в одной unit.

---

# 24. Analysis unit

Каждая unit содержит:

```text
analysis_unit_id
section context
primary semantic block IDs
overlap semantic block IDs
source pages
flags
ai_segments
provenance
```

После fan-out:

```text
1 n8n item = 1 analysis_unit
```

---

# 25. Persistence units before AI

До первого AI вызова analysis units сохраняются в:

```text
tender_analysis_units
```

Это очень важное архитектурное решение.

Преимущества:

```text
Docling/chunking выполняются один раз
Targeted Recheck может перечитать units из DB
evidence audit не зависит от памяти execution
повторный AI анализ не требует повторного parsing
```

---

# 26. AI trust model

Система не доверяет одному LLM-проходу.

Используется layered validation:

```text
AI Extractor
        ↓
Deterministic Evidence Validator
        ↓
Independent AI Validator
        ↓
Deterministic Validator Response Checker
        ↓
Persist facts
```

---

# 27. AI Extractor

Модель:

```text
deepseek-v4-pro
```

Задача:

```text
извлечь candidate facts
```

Extractor не имеет права создавать:

```text
global not_found
```

Если факт в unit не найден:

```json
{
  "facts": []
}
```

---

# 28. Почему Extractor не создаёт `not_found`

Одна analysis unit видит только часть документа.

Следовательно:

```text
не найдено здесь
≠
не существует в закупке
```

`not_found` допускается только после полного анализа и Targeted Recheck.

---

# 29. Evidence contract

AI evidence минимально содержит:

```text
semantic_block_id
quote
```

Модель не определяет самостоятельно:

```text
page
bbox
sheet
source block
```

Эти данные восстанавливаются deterministic layer из provenance.

---

# 30. Grounding barrier

Deterministic Evidence Validator проверяет:

```text
semantic_block существует
quote действительно содержится в block
есть primary evidence
provenance существует
field_key разрешён
schema корректна
```

Это защищает от:

```text
fake quote
fake block id
fabricated provenance
overlap-only candidate
```

---

# 31. Independent AI Validator

Модель:

```text
deepseek-v4-pro
```

Он не ищет новые факты.

Он проверяет:

```text
правильный field_key?
value_text реально доказан?
нет overinterpretation?
не потеряна qualification?
не перепутана близкая бизнес-сущность?
```

Verdicts:

```text
confirmed
requires_review
rejected
```

---

# 32. Важное ограничение AI Validator

Наличие второго AI не гарантирует semantic correctness.

Реальный подтверждённый regression:

```text
customer = "не указан"
```

был ошибочно подтверждён Validator на основании отсутствия customer в evidence.

Это `DW-15`.

Следствие:

> semantic safety не может быть полностью делегирована LLM; необходимы deterministic guards для известных классов ошибок.

---

# 33. Facts layer

После двух AI-проходов сохраняются:

```text
confirmed
requires_review
rejected
```

в:

```text
tender_analysis_facts
```

Rejected facts не используются Aggregator как candidates, но остаются для audit.

---

# 34. Почему Worker не агрегирует по field_key

В разных:

```text
units
documents
```

могут существовать:

```text
duplicate
complementary
conflicting
```

facts одного поля.

Поэтому Worker намеренно не:

```text
deduplicate
choose best
resolve conflict
create final value
```

Это обязанность Aggregator.

---

# 35. Deterministic document completion

Document становится `completed` только если:

```text
units_total = stored_units_count
facts_count = stored_facts_count
status = processing
```

Это второй важный anti-data-loss barrier.

---

# 36. Run readiness

Каждый Worker после завершения документа считает:

```text
registered
completed
pending
processing
failed
skipped
```

Run переводится:

```text
processing
→ ready_for_aggregation
```

только если:

```text
documents_total > 0
registered = documents_total
completed = documents_total
```

---

# 37. Concurrency pattern readiness

Все Workers могут одновременно проверять readiness.

Но UPDATE разрешён только:

```text
WHERE run.status = 'processing'
```

Поэтому только один Worker может получить:

```text
should_start_aggregation = true
```

и вызвать Aggregator.

---

# 38. Error Workflow

Document Worker имеет настроенный:

```text
TENDER — Ошибка обработки документа
```

Handler:

```text
Error Trigger
→ execution.id
→ document.n8n_execution_id
→ processing → failed
→ error_message
```

---

# 39. Error lifecycle limitation

Error Workflow ловит только workflow-level failure.

В актуальном export у ноды `Проверить и привязать evidence` отсутствуют `onError` и `continueOnFail`; regular output подключён к `AI Validator v1`.

Механизм configuration-level bypass через `continueErrorOutput` не подтверждается актуальным export. Поведение invalid/error response требует runtime regression; это остаётся вопросом `DW-14 / EW-3`.

---

# 40. Aggregator entry

Aggregator получает readiness payload:

```text
analysis_run_id
documents_total
completed_documents_count
...
should_start_aggregation
readiness_reason
```

В intended architecture Aggregator должен дополнительно делать собственный atomic claim:

```text
ready_for_aggregation
→ aggregating
```

Это intended второй concurrency barrier. Current production state: nodes claim физически существуют, но execution graph их обходит; trigger подключён напрямую к загрузке фактов. Восстановление reachable claim является prerequisite для `AG-0`.

---

# 41. Aggregator dataset

Aggregator читает:

```text
tender_analysis_runs
tender_analysis_documents
tender_analysis_facts
```

Из facts в candidates допускаются только:

```text
confirmed
requires_review
```

`rejected` не участвуют в semantic aggregation.

---

# 42. Exactly 27 fields

Aggregator всегда создаёт:

```text
ровно 27 field items
```

из каталога:

```text
tender_fields_v1
```

Даже если для поля:

```text
0 candidates
```

field item всё равно существует.

Это critical invariant будущего:

```text
27/27 readiness
```

---

# 43. First Aggregator split

```text
has_candidates?
```

### YES

```text
Semantic Aggregator Round 1
```

### NO

```text
TenderMeta Resolver
```

---

# 44. Semantic Aggregator Round 1

Модель:

```text
deepseek-v4-pro
```

Она не извлекает новые facts.

Она получает только существующие candidate facts и классифицирует их роли:

```text
primary
duplicate
supporting
complement
conflict
not_applicable
```

Result:

```text
resolved
или
requires_recheck
```

---

# 45. Deterministic Round 1 validation

AI response проверяется на:

```text
exact field_key
known fact IDs
each candidate exactly once
role consistency
one primary for resolved
no unresolved conflicts for resolved
valid recheck reason
```

Только после этого поле может стать FINAL или уйти в Targeted Recheck.

---

# 46. TenderMeta Resolver

Если candidate facts нет, система пробует deterministic structured source.

Текущие mappings:

```text
procurement_subject
→ tender_meta.title

platform
→ tender_meta.platform

application_deadline
→ tender_meta.submission_close_at

customer
→ tender_meta.primary_customer.name
```

Отсутствие mapping/value:

```text
НЕ not_found
```

а:

```text
Targeted Recheck
```

---

# 47. Targeted Recheck

`TENDER - Targeted Recheck` является side-effect sub-workflow.

Он принимает одно или несколько problem field items и сам:

```text
retrieval
→ recheck extraction
→ evidence validation
→ validator
→ direct final / Round 2 / not_found / requires_review
→ tender_field_final_v1
→ DB UPSERT
```

Parent Aggregator не финализирует field повторно.

---

# 48. Targeted Recheck entry scenarios

### A. `no_initial_candidates`

```text
Aggregator facts = none
TenderMeta unresolved
```

### B. `aggregation_recheck`

```text
Round 1 candidates exist
но Semantic Aggregator требует recheck
```

---

# 49. Targeted retrieval

Recheck читает:

```text
tender_analysis_units
```

и ищет контекст по:

```text
RECHECK_PROFILES
search terms
metadata context
existing evidence units
```

Это позволяет повторно исследовать документ без повторного Docling parsing.

---

# 50. Recheck AI pipeline

```text
targeted retrieval
→ AI Recheck Extractor
→ deterministic evidence validation
→ AI Validator
→ deterministic Validator checker
```

Если есть usable candidates:

```text
direct final
или
Semantic Aggregator Round 2
```

---

# 51. Семантика `not_found`

`not_found` означает только:

> значение не удалось надёжно установить по предоставленным источникам после полного анализа и targeted recheck.

`not_found` НЕ означает:

```text
нет
не требуется
не предусмотрено
```

Основные not_found reason codes:

```text
no_relevant_context_after_targeted_retrieval
insufficient_evidence_after_targeted_recheck
all_recheck_candidates_rejected
```

---

# 52. FINAL contract

Все terminal field paths должны приводиться к:

```text
result_contract_version = tender_field_final_v1
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

Допустимые statuses:

```text
resolved
requires_review
not_found
```

---

# 53. FINAL persistence

Таблица:

```text
tender_analysis_field_results
```

PK:

```text
(analysis_run_id, field_key)
```

UNIQUE:

```text
(analysis_run_id, field_index)
```

Сохранение идемпотентно:

```text
INSERT
ON CONFLICT
DO UPDATE
```

---

# 54. Физическая data model

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

Важно:

у `field_results.analysis_run_id` сейчас отсутствует физический FK на `runs.id`.

Логическая связь существует, DB constraint — нет.

Это `DM-0`.

---

# 55. Main source-of-truth layers

Система разделяет разные виды истины.

### Business semantics

```text
FIELD_CATALOG.md
```

### Physical storage

```text
PostgreSQL schema
DATA_MODEL.md
```

### Workflow behavior

```text
workflows/*.md
actual n8n workflows
```

### Final field contract

```text
tender_field_final_v1
```

---

# 56. 27-field semantic source of truth

Версия:

```text
tender_fields_v1
```

Каталог содержит:

```text
27 exact field_key
```

Часть полей помечена:

```text
REQUIRES_BUSINESS_CONFIRMATION
```

Это означает:

- key пока не меняется;
- architecture не меняется;
- semantic rules позже можно уточнить в AI-preparation nodes.

---

# 57. Спорные бизнес-поля

Текущие поля с явной пометкой на уточнение:

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

До подтверждения:

```text
не дробить
не переименовывать
не менять количество 27
```

---

# 58. Cross-workflow versioning

Текущие важные versions:

```text
field_catalog_version
= tender_fields_v1

Extractor prompt
= tender_extractor_prompt_v1

Extractor output
= ai_extractor_v1

Evidence validator
= evidence_validator_v1

AI Validator
= ai_validator_v1

Validator response check
= ai_validator_response_check_v1

FINAL
= tender_field_final_v1
```

Versioning должно сохраняться при изменениях semantics/contracts.

---

# 59. Concurrency architecture

Система использует несколько atomic DB transitions вместо Merge-based synchronization.

### Document level

```text
pending/failed
→ processing
```

только один Worker.

### Run readiness

```text
processing
→ ready_for_aggregation
```

только один последний Worker.

### Aggregator claim — intended invariant и current production state

```text
ready_for_aggregation
→ aggregating
```

только один Aggregator в intended topology.

Current production state: claim nodes существуют и включены, но не входят в reachable execution graph. Поэтому текущий production execution не подтверждает фактическое выполнение перехода `ready_for_aggregation → aggregating` через этот claim.

### Final completion

Следующий незавершённый concurrency barrier:

```text
ANY FINAL UPSERT
        ↓
DB-backed 27/27 validation
        ↓
atomic completion claim
        ↓
aggregating → completed
```

только один completion claimant после 27/27.

---

# 60. Почему synchronization через PostgreSQL

n8n conditional branches могут завершаться независимо.

Обычный Merge ненадёжен для архитектуры, где:

```text
часть веток может вообще не исполниться
```

Поэтому долгоживущие synchronization barriers должны опираться на:

```text
PostgreSQL state
```

а не на ожидание всех веток одного execution.

---

# 61. Current finalization gap

После сохранения одного FINAL field:

```text
UPSERT tender_analysis_field_results
```

ветка заканчивается.

Нет общей логики:

```text
COUNT(unique field_key)=27?
```

Это `AG-0`.

Следствие:

```text
run может оставаться aggregating
```

даже когда фактически все 27 FINAL уже существуют.

---

# 62. Planned 27/27 barrier

Целевая архитектура:

```text
ANY FINAL FIELD UPSERT
        |
        v
DB readiness check
        |
        v
COUNT(unique FINAL fields) = 27?
      /     \
    NO       YES
    |         |
   END        v
        atomic completion claim
              |
              v
      aggregating → completed
              |
              v
      load ordered 27 fields
              |
              v
      report generation
```

---

# 63. Planned report stage

После completion:

```text
load 27 FINAL fields
→ deterministic tender result object
→ Markdown report
→ XLSX table
→ Telegram
```

Report generator не должен повторно интерпретировать документы AI-моделью.

Он должен использовать уже финальные:

```text
tender_field_final_v1
```

---

# 64. Error architecture — current state

### Orchestrator

```text
Error Workflow не настроен
```

### Document Worker

```text
Error Workflow = TENDER — Ошибка обработки документа
```

### Aggregator / Targeted Recheck

Отдельная централизованная error policy пока не считается завершённой.

---

# 65. Critical known issues across system

## Document ingestion

```text
OR-0
unsupported document registered pending
but Worker not started
```

## Worker error handling

```text
DW-14 / EW-3
configuration-level bypass not confirmed by current export;
invalid/error response behavior requires runtime regression
```

## Worker semantic safety

```text
DW-15
observed false confirmed:
customer = "не указан"
```

## Worker retry correctness

```text
DW-8
stale analysis units can block completion
```

## Docling lifecycle

```text
DW-3
terminal failure not handled
```

## Targeted Recheck

MVP-critical проблемы закрыты:

```text
TR-0 ✅
existing candidate + no retrieval context
→ requires_review

TR-1 ✅
existing candidate + all new rejected
→ requires_review

TR-2 ✅ Closed (MVP)
Round 2 FIELD_RULES существуют для всех 27 field_key

TR-3 ✅
child workflow больше не зависит от parent-node references```

## Aggregator completion

```text
AG-0
no 27/27 completion barrier
```

---

# 66. Highest-priority implementation sequence

Полный integration run уже подтвердил:

```text
TenderPlan
→ Documents
→ Workers
→ Facts
→ Validator
→ Aggregator
→ Targeted Recheck
→ 27 / 27 FINAL field results
Поэтому текущий MVP-critical путь:
1. AG-0
   DB-backed 27/27 completion barrier

2. atomic:
   aggregating → completed

3. Load ordered FINAL fields 1..27

4. Markdown report

5. XLSX

6. Telegram
После первого законченного end-to-end report:
7. regression dataset на нескольких закупках

8. ручная проверка качества 27 полей

9. reliability / hardening:
   DW-14 / EW-3
   DW-3
   DW-8
   OR-0
   AG-1
   TR-6
```

Часть worker/error fixes может быть переставлена местами после первого полного integration test, но critical silent-stuck paths нельзя оставлять для production.

---

# 67. MVP success criterion

MVP считается функционально достигнутым, когда один входной:

```text
tender_id
```

автоматически проходит до:

```text
analysis_run.status = completed
```

и для него существуют:

```text
ровно 27 tender_analysis_field_results
```

где каждый имеет:

```text
resolved
или
requires_review
или
not_found
```

после чего пользователь получает:

```text
Markdown
XLSX
Telegram delivery
```

---

# 68. Что можно отложить после первого MVP

Не блокируют первый end-to-end результат:

```text
единый runtime FIELD_CATALOG refactor
deduplicated Persist Final Field subworkflow
advanced telemetry
frontend
Bitrix integration
full production retry framework
real tokenizer
visual-image analysis
full source snapshot storage
perfect notification system
```

Главный принцип:

> сначала получить надёжный end-to-end MVP, затем устранять поддерживаемость и production-hardening debt.

---

# 69. Anti-hallucination architecture summary

Система специально использует несколько независимых ограничителей:

```text
1. Fixed 27-field catalog

2. Semantic blocks with stable IDs

3. AI evidence must reference block ID

4. Quote must literally exist in block

5. Provenance generated by system, not AI

6. Primary evidence required

7. Independent second AI Validator

8. Deterministic validator-response checker

9. Aggregator may only use persisted candidate facts

10. Targeted Recheck before not_found

11. not_found ≠ negative answer

12. FINAL result is versioned and persisted
```

Это является центральной архитектурной защитой от пропусков и галлюцинаций.

---

# 70. Data loss protection summary

На разных этапах действуют разные barriers.

### Parsing

```text
coverage / unknown refs / unvisited refs
```

### Chunking

```text
each semantic block primary exactly once
```

### AI unit processing

```text
validatedItems count = units_total
```

### Document completion

```text
stored units = units_total
stored facts = facts_count
```

### Run readiness

```text
completed documents = documents_total
```

### Future finalization

```text
FINAL fields = exactly 27
```

То есть data-completeness проверяется не одним механизмом, а цепочкой barriers.

---

# 71. Idempotency summary

### Documents

```text
atomic claim
```

### Analysis units

```text
UPSERT (document_id, analysis_unit_id)
```

Пока требует stale cleanup fix.

### Facts

```text
UPSERT
+
delete stale facts
```

### FINAL fields

```text
UPSERT (analysis_run_id, field_key)
```

### Run transitions

Conditional atomic UPDATE based on current status.

---

# 72. Auditability

Система сохраняет достаточно данных для восстановления происхождения результата:

```text
FINAL
→ evidence
→ semantic_block_id
→ analysis_unit
→ provenance
→ original Docling source block/page/bbox
```

Дополнительно сохраняются:

```text
Extractor metadata
Validator metadata
confidence
reason codes
semantic aggregator decisions
recheck audit
```

---

# 73. Main architecture invariants

1. Один run = один запуск анализа закупки.
2. Все documents регистрируются до первого Worker.
3. Один Worker execution = один document.
4. Document processing начинается только после atomic claim.
5. Parser output проходит coverage validation.
6. Semantic blocks имеют стабильные IDs.
7. Каждый semantic block primary ровно в одной unit.
8. Units сохраняются до AI.
9. Extractor не создаёт global not_found.
10. Evidence quote должна существовать дословно.
11. Provenance не создаётся AI.
12. AI Validator не извлекает новые facts.
13. Worker не агрегирует поля.
14. Aggregator создаёт ровно 27 field items.
15. `not_found` не означает отрицательный ответ.
16. Targeted Recheck сам сохраняет FINAL field.
17. FINAL contract всегда `tender_field_final_v1`.
18. Один run имеет максимум один FINAL на field_key.
19. Run readiness определяется DB state.
20. Future completion должен определяться DB count 27/27.

---

# 74. Архитектурные границы изменения

## Можно менять без redesign системы

Если сохраняются:

```text
field_key
27 fields
tender_field_final_v1
DB identities
```

можно менять:

```text
field definitions
AI prompts
search terms
Recheck rules
Round 1 rules
Round 2 rules
TenderMeta mappings
```

---

# 75. Что требует новой версии архитектурного контракта

Например:

```text
27 → 28 fields
```

или:

```text
advance_contract_guarantee
→ split into two separate keys
```

потребует изменения:

```text
FIELD_CATALOG version
DB CHECK constraints
Aggregator FIELD_KEYS
27/27 readiness
prompts
report format
tests
possibly migrations
```

Такое изменение нельзя делать как обычную prompt-правку.

---

# 76. Документация как source of truth

Предлагаемая структура:

```text
.
├── README.md
├── ARCHITECTURE.md
├── FIELD_CATALOG.md
├── DATA_MODEL.md
├── TECH_DEBT.md
├── DEVELOPMENT_LOG.md
└── workflows/
    ├── orchestrator.md
    ├── document-worker.md
    ├── aggregator.md
    ├── targeted-recheck.md
    └── error-workflow.md
```

---

# 77. Назначение документов

### `ARCHITECTURE.md`

```text
как вся система устроена вместе
```

### `FIELD_CATALOG.md`

```text
что означают 27 полей
```

### `DATA_MODEL.md`

```text
где данные физически хранятся
```

### `workflows/*.md`

```text
как работает каждый workflow
```

### `TECH_DEBT.md`

```text
единый приоритизированный backlog проблем
```

### `DEVELOPMENT_LOG.md`

```text
что и когда менялось
```

### `README.md`

```text
быстрый вход в проект
```

---

# 78. Проверенная end-to-end часть

На последнем полном integration run подтверждена цепочка:

```text
TenderPlan
→ Orchestrator
→ 3 registered documents
→ Document Workers
→ Docling
→ semantic units
→ Extractor
→ deterministic evidence validation
→ AI Validator
→ facts
→ document completion
→ run ready_for_aggregation
→ Aggregator
→ Targeted Recheck where required
→ tender_field_final_v1
→ tender_analysis_field_results
Фактический результат PostgreSQL:
documents = 3

persisted facts = 36

validator verdicts = 36 / 36

confirmed = 23
requires_review = 0
rejected = 13

FINAL field results = 27 / 27
Это подтверждает работоспособность:
document processing
→ fact persistence
→ semantic filtering
→ field aggregation
→ targeted recheck
→ FINAL persistence
Также подтверждено, что FINAL fields могут сохраняться независимыми branch/sub-workflow executions.
Поэтому centralized in-memory synchronization через:
Merge
или
$input.all()
не подходит.
Финальная синхронизация должна происходить через PostgreSQL
---

# 79. Текущая граница end-to-end

Сейчас реальная система заканчивается примерно здесь:

```text
Aggregator / Targeted Recheck
→ UPSERT FINAL field result
→ branch end
```

Целевая следующая граница:

```text
UPSERT FINAL
→ 27/27
→ run completed
→ report
```

---

# 80. Следующий архитектурный milestone

MVP-critical Targeted Recheck issues:

```text
TR-0
TR-1
TR-2
TR-3
закрыты.
Полный integration run уже дал:
27 / 27 FINAL field results
Следующий архитектурный milestone:
AG-0
Final Field Completion Barrier
Он должен стать системной точкой перехода:
fan-out field processing
        ↓
independent FINAL UPSERTs
        ↓
PostgreSQL 27/27 barrier
        ↓
single completion claimant
        ↓
run.status = completed
        ↓
single report generation
После этого впервые появится полностью замкнутый lifecycle:
tender_id
→ analysis
→ 27 FINAL
→ completed
→ Markdown
→ XLSX
→ Telegram
---

# 81. Краткая схема будущего завершённого MVP

```text
tender_id
   |
   v
TenderPlan
   |
   v
Orchestrator
   |
   v
Register ALL docs
   |
   v
Workers in parallel
   |
   v
Facts
   |
   v
Run ready_for_aggregation
   |
   v
Aggregator
   |
   +-- Round 1
   +-- TenderMeta
   `-- Targeted Recheck
          |
          v
    FINAL field UPSERT
          |
          v
      DB 27/27 Barrier
          |
          v
        completed
          |
          v
   Load FINAL 1..27
          |
          v
       Markdown
          |
          v
         XLSX
          |
          v
       Telegram
```

---

# 82. Краткое резюме

Текущая архитектура построена вокруг трёх принципов:

```text
1. PostgreSQL как persistent state и synchronization layer.

2. AI как semantic engine,
   но каждый AI-этап ограничен deterministic validation.

3. Финальный анализ строится не напрямую из документов,
   а через контролируемую цепочку:
   document → unit → fact → field → FINAL.
```

Система уже имеет достаточно сильную структуру для MVP:

```text
registered documents
atomic claims
persistent units
grounded evidence
independent validation
field-level recheck
versioned final contract
```

Главная незавершённая архитектурная часть:

```text
fan-out 27 FINAL fields
→ single completion/report stage
```

То есть следующий системный шаг — не новый AI-слой, а корректная DB-backed синхронизация:

```text
27 / 27
→ completed
→ report
```
