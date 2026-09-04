# AI-анализ тендерной документации — n8n

**Статус:** Active development / MVP  
**Последнее обновление:** 2026-09-03
**Основной стек:** n8n + PostgreSQL + TenderPlan + IBM Docling + Polza AI
**Каталог полей:** `tender_fields_v1`  
**FINAL-контракт:** `tender_field_final_v1`

Короткий актуальный снимок production/test границ, runtime evidence и открытых gates:

```text
PROJECT_STATUS.md
```

Последний Document Worker handoff: executions `14374/14376` технически GREEN только до `ready_for_aggregation`; semantic applicability gate FAIL. Sanitized audit: `evaluations/DOCUMENT_WORKER_SEMANTIC_AUDIT_14374_14376_2026-09-03.md`.

---

# 1. Что это за проект

Система автоматически анализирует тендерную документацию.

На входе:

```text
tender_id
```

На выходе MVP должен сформировать:

```text
27 финальных полей закупки
+
Markdown-отчёт
+
XLSX
+
отправку в Telegram
```

Для каждого из 27 полей итоговый статус:

```text
resolved
requires_review
not_found
```

Важно:

```text
not_found
```

означает:

> значение не удалось надёжно установить по предоставленным источникам после полного анализа и Targeted Recheck.

Это **не** означает:

```text
нет
не требуется
не предусмотрено
```

---

# 2. Что MVP НЕ делает

Текущий MVP не отвечает на вопрос:

```text
"Подходит ли этот тендер нашей компании?"
```

Он пока не сравнивает закупку с:

- документами компании;
- лицензиями компании;
- возможностями поставщика;
- внутренними критериями участия.

Текущая задача:

> максимально надёжно извлечь и проверить 27 полей самой закупки.

---

# 3. Текущая архитектура

```text
TenderPlan
    ↓
ТЕНДЕРЫ ОРКЕСТРАТОР
    ↓
создать analysis_run
    ↓
зарегистрировать ВСЕ документы
    ↓
TENDER — Обработать документ
    ↓
Docling
    ↓
Universal Normalizer
    ↓
semantic blocks
    ↓
analysis units
    ↓
AI Extractor
    ↓
deterministic evidence validation
    ↓
independent AI Validator
    ↓
save facts
    ↓
all documents completed
    ↓
TENDER — Агрегация закупки
    ↓
27 field items
    ↓
Round 1 / TenderMeta / Targeted Recheck
    ↓
tender_field_final_v1
    ↓
tender_analysis_field_results
    ↓
27 / 27 FINAL fields
    ↓
TENDER — Финализация анализа
    ↓
DB-backed 27/27 barrier
    ↓
run.status = completed
    ↓
TENDER — Генерация отчета V2
    ↓
self-contained HTML + binary report_html
    ↓
будущие PDF / DOCX / XLSX / delivery
```

---

# 4. Основные workflow

## `ТЕНДЕРЫ ОРКЕСТРАТОР`

Отвечает за:

```text
tender_id
→ TenderPlan FullInfo
→ normalize tender
→ create run
→ register ALL documents
→ launch Document Workers
```

Документация:

```text
workflows/orchestrator.md
```

---

## `TENDER — Обработать документ`

Один execution обрабатывает один документ:

```text
claim
→ download
→ Docling
→ normalize
→ semantic structure
→ analysis units
→ Extractor
→ evidence validator
→ AI Validator
→ facts
→ document completed
→ run readiness
```

Документация:

```text
workflows/document-worker.md
```

---

## `TENDER — Ошибка обработки документа`

Workflow-level error handler Document Worker.

```text
Worker failed
→ Error Trigger
→ найти document по n8n_execution_id
→ processing → failed
→ сохранить error_message
```

Документация:

```text
workflows/error-workflow.md
```

---

## `TENDER — Агрегация закупки`

Работает после завершения всех документов.

```text
facts всех документов
→ ровно 27 field items
→ Semantic Aggregator Round 1
или
→ TenderMeta Resolver
→ Targeted Recheck при необходимости
→ FINAL field
```

Документация:

```text
workflows/aggregator.md
```

---

## `TENDER - Targeted Recheck`

Повторно исследует одно проблемное поле.

```text
targeted retrieval
→ Recheck Extractor
→ evidence validation
→ Validator
→ direct FINAL
  / общий Round 2 только для 4 разрешённых field_key
  / terminal requires_review для остальных 23 field_key
  / not_found при отсутствии usable evidence
→ save FINAL
```

Документация:

```text
workflows/targeted-recheck.md
```

---

## `TENDER — Финализация анализа`

Проверяет PostgreSQL-backed barrier для одного `analysis_run`:

```text
27 уникальных FINAL fields
→ atomic completion claim
→ aggregating → completed
→ вызов Report Generation V2
```

Workflow ID: `cSsh9yjpS7t5p0OO`.

---

## `TENDER — Генерация отчета`

Workflow строит read-only snapshot завершённого run, адаптирует 27 FINAL fields, валидирует Report Model, генерирует self-contained HTML и создаёт binary artifact `report_html`. Он не отправляет файл наружу и не создаёт PDF, DOCX, XLSX или Telegram delivery.

Workflow ID: `ckPnP3hRhKu4Mf9u`.

Подробный фактический контракт: `workflows/report-generation.md`.

---

# 5. PostgreSQL

Основные таблицы:

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

Логический путь данных:

```text
run
→ documents
→ units
→ facts
→ FINAL fields
```

Подробно:

```text
DATA_MODEL.md
```

---

# 6. 27 полей

Единый semantic source of truth:

```text
FIELD_CATALOG.md
```

Там зафиксировано:

- `field_index`;
- `field_key`;
- бизнес-смысл;
- что считается evidence;
- что нельзя считать evidence;
- expected output;
- TenderMeta mapping;
- Round 1 coverage;
- Targeted Recheck coverage;
- Round 2 coverage;
- поля, которые ещё требуют уточнения у клиента.

При изменении смысла поля сначала обновлять:

```text
FIELD_CATALOG.md
```

а затем соответствующие AI-preparation nodes.

---

# 7. Главные архитектурные принципы

## 1. PostgreSQL — persistent state и synchronization layer

Не полагаться на Merge между условными ветками, если часть веток может вообще не исполниться.

Состояние синхронизируется через БД.

---

## 2. Все документы регистрируются до запуска первого Worker

Это необходимо, чтобы корректно определить:

```text
когда обработаны ВСЕ документы закупки
```

---

## 3. Один Worker execution = один document

Это упрощает:

- retry;
- concurrency;
- error handling;
- масштабирование.

---

## 4. AI не создаёт provenance

AI возвращает только:

```text
semantic_block_id
quote
```

Страница, bbox, sheet и source block восстанавливаются системой.

---

## 5. Один AI-проход не считается достаточным

Pipeline:

```text
AI Extractor
→ deterministic evidence validator
→ independent AI Validator
→ deterministic Validator response checker
```

---

## 6. Extractor не создаёт global `not_found`

```text
нет факта в одной analysis unit
≠
нет факта во всей закупке
```

---

## 7. Targeted Recheck выполняется до `not_found`

Только после полного анализа и повторного targeted retrieval поле может безопасно стать:

```text
not_found
```

---

# 8. Текущее состояние

## Подтверждённый production baseline

```text
TenderPlan FullInfo
✓

Normalize tender
✓

Create analysis_run
✓

Register all documents
✓

Atomic document claim
✓

Docling parsing
✓

Universal normalization
✓

Semantic sections
✓

Analysis units
✓

Persist units
✓

AI Extractor
✓

Deterministic evidence validation
✓

Independent AI Validator
✓

Persist facts
✓

Document completion barrier
✓

Run readiness
✓

Aggregator atomic claim
✓ подтверждён execution `13856`

Exactly 27 field items
✓

Semantic Aggregator Round 1
✓

TenderMeta Resolver
✓

Targeted Recheck
✓

Semantic Aggregator Round 2
✓ historical FIELD_RULES inventory для всех 27 field_key
✓ executable route только для 4 canonical field_key
✓ terminal route regression для остальных 23 field_key

FINAL contract
✓

FINAL field persistence
✓

Full E2E aggregation run
✓

Проверенный результат:
3 documents
→ 38 persisted facts
→ 20 confirmed
→ 10 requires_review
→ 8 rejected
→ 27/27 FINAL field results
```

Это исторически подтверждённый baseline executions `13852–13864`, а не доказательство корректности текущих test-кандидатов.

---

## Текущий test-hardening

В изолированном `[3 TEST]` Document Worker реализованы и покрыты execution-derived tests:

```text
bounded evidence repair
lossless fact partition
deterministic overlap-only rejection
document-level Validator dispatch
27 field-specific Validator profiles
fact-local material literal guard
```

Execution `14104` подтвердил `66/66` units и сохранение `61` facts, но run был уже завершён, поэтому Aggregator для нового snapshot не запускался.

Extractor model benchmark на одинаковых 16 pinned units завершён. Текущий test/canonical baseline зафиксирован как:

```text
z-ai/glm-5.3-flash
reasoning_effort = low
```

Gemini 3.7 Flash low оставлен резервным Extractor candidate. GLM 5.2, GLM 5.3 high, GPT-5.6 Luna Pro, GPT-5.4 Nano, GPT-5 Mini и DeepSeek V4 Flash 0731 отклонены для текущего Extractor contract. Сводный отчёт: `evaluations/EXTRACTOR_MODEL_COMPARISON_2026-08-29.md`. Это model-selection checkpoint, а не подтверждение полного Worker runtime.

Test/calibration Worker сохранён как immutable beta snapshot `workflows/n8n-exports/beta/[3 TEST] TENDER — Обработать документ.json` с SHA-256 `02e4e5ccc761ecf78771c2ae4a3c4e529f3536533de2d9e7a5ef2084fe0459dd`.

Canonical `workflows/n8n-exports/TENDER — Обработать документ.json` теперь является clean offline production candidate: 51 node, production trigger/persistence connections, без Manual Trigger, calibration nodes, `pinData` и top-level instance identity. Beta→canonical regression проходит; live production Worker не менялся, candidate ещё не promoted/wired и не прошёл runtime canary.

Для Aggregator execution-derived risk по `procurement_subject` mitigated и verified в `[TEST CODEX]`: historical DeepSeek canary `14104` вернул `round1_final/resolved`, назначил внутреннему процессу `not_applicable`, выбрал fixture fact `14104000-0001-4000-8000-000000000001` primary и прошёл 6/6 semantic oracle. Subsequent bounded request-model-only A/B на fixture `14104` подтвердил, что GLM 5.3 Flash low и Gemini 3.7 Flash low оба проходят checker, `round1_final` и 6/6 semantic oracle; оба назначили внутреннему процессу `not_applicable`. GLM выбран текущим recommended Aggregator beta baseline по reliability/correctness/cost; Gemini остаётся fallback для latency/provider issues. Детали: `evaluations/AGGREGATOR_MODEL_COMPARISON_2026-08-29.md`.

Execution `14173` выявил отдельный `application_documents` false-resolved. В `[TEST CODEX]` field-specific Round 1 boundary прошла offline regressions и paid runtime canary. Owner-started run `14429` затем доказал P0 `TR-10`: validated `application_documents` ошибочно вошёл в общий Round 2. Current local canonical Targeted Recheck содержит `70/70` reachable nodes, допускает общий Round 2 только для четырёх canonical field key, а остальные 23 — включая `application_documents` — завершает через audited `terminal_requires_review` и отдельную Normalize8 / UPSERT8 / Finalizer8 chain. Execution `14449` подтвердил этот маршрут только в owner-modified inactive test topology: Recheck AI, exact evidence и Validator выполнились; общий Round 2 имел `0` runs; FINAL сохранился, barrier вернул `27/27`. Exact live parameter parity, production promotion и fresh full run этим не доказаны; LIVE production workflow не изменён.

Первый полный test E2E для run `3caa7a89-b137-4cf6-b23d-941fb465c8f9` технически завершился: controller `14259`, body Aggregator `14260`, Targeted Recheck `14261`, completion owner `14267` и Report `14268` успешны; DB содержит ровно 27 FINAL (`19 resolved / 3 requires_review / 5 not_found`) и HTML artifact. Semantic audit принял 25/27, но отклонил canary из-за двух critical `false_resolved`: `participation_guarantee` не доказал применимость/размер обеспечения, а `required_official_certificates` не доказал полноту обязательных документов о статусе участника. Для обоих полей test drafts теперь применяют один audited safety contract: Round 1 reported `resolved` → effective `requires_recheck`; terminal Round 2 reported `resolved` → effective `requires_review`, сохраняя provisional text, candidates/evidence и reported/effective audit.

Baseline canary `14279/14280/14281/14285/14289` затем дал exact 27/27 и semantic audit 27/27. Первая confirmation attempt `14290/14291/14292` не засчитана: четыре из семи Targeted Recheck AI payload нарушили contract/evidence validation, первым был точный mismatch `results_date candidate[0].evidence[4]`. Unpublished draft `nI47FcgzYwGzwGqy@13b3c124-4fef-4a6f-9d5f-8befa3725bc1` содержит typed technical fallback: только локальные model-validation errors становятся terminal `requires_review` через отдельный route; `evidence_validated=false`, AI candidates не принимаются, raw response/error/source/original candidates сохраняются. Валидный `insufficient_evidence` по-прежнему может завершиться безопасным `not_found`. Новая confirmation series ещё не начата.

Production Aggregator не менялся. Production promotion остаётся отдельным intentional RED gate, а fresh full 27/27 run после hardening ещё не выполнен. A/B harness не обращался к БД/n8n, менял только `request.model` и не изменял workflow/fixture.

---

# 9. Главный текущий backlog

Полный backlog:

```text
TECH_DEBT.md
```

Текущие P0 gates перед клиентским отчётом:

```text
AG-8 production promotion
verified test boundary → canonical production candidate

application_documents production promotion
reviewed 70-node canonical candidate → отдельное решение о promotion

application_documents Targeted Recheck
owner-modified test topology GREEN → после promotion fresh full run

participation_guarantee / required_official_certificates containment
baseline canary GREEN → technical fallback review → fresh confirmation

Document Worker promotion
clean offline candidate → test workflow promotion / wiring → runtime canary

test workflow promotion / wiring
→ fresh full run
→ 27/27 semantic review
→ client report
```

---

# 10. Следующая задача

Текущая точка продолжения после `application_documents` owner-modified test
topology GREEN, local canonical hardening, Document Worker packaging и Extractor
model-selection checkpoint:

```text
application_documents Targeted Recheck 70-node canonical review
→ отдельное решение о production promotion
→ после promotion fresh full-path runtime validation
→ Aggregator AG-8 / application_documents production-candidate audit
→ затем full Document Worker runtime canary
→ fresh full run
→ manual semantic review 27/27
→ client report
```

Не считать local GREEN автоматическим production promotion. Production Aggregator, LIVE Targeted Recheck, PostgreSQL, Finalization и Report Generation этим containment checkpoint не менялись.

---

# 11. Куда смотреть

## Нужно быстро понять весь проект

```text
PROJECT_STATUS.md
ARCHITECTURE.md
```

---

## Нужно понять смысл 27 полей

```text
FIELD_CATALOG.md
```

---

## Нужно понять PostgreSQL

```text
DATA_MODEL.md
```

---

## Нужно изменить конкретный workflow

```text
workflows/orchestrator.md
workflows/document-worker.md
workflows/aggregator.md
workflows/targeted-recheck.md
workflows/error-workflow.md
```

---

## Нужно понять, что чинить и в каком порядке

```text
TECH_DEBT.md
```

---

## Нужно восстановить историю разработки

```text
DEVELOPMENT_LOG.md
```

---

# 12. Структура документации

```text
.
├── README.md
├── PROJECT_STATUS.md
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

# 13. Правила изменения системы

Перед изменением workflow:

1. Понять, какой контракт меняется.
2. Не менять `field_key` без необходимости.
3. Не менять число 27 полей без новой версии каталога.
4. Не ослаблять deterministic validation ради того, чтобы AI «чаще проходил».
5. Не трактовать отсутствие evidence как отрицательный факт.
6. Не добавлять Merge как synchronization mechanism без проверки реального поведения всех веток.
7. Сохранять DB idempotency.
8. Добавлять regression scenario для исправленного bug.
9. Обновлять документацию после изменения.

---

# 14. Версии и стабильные контракты

```text
field catalog:
tender_fields_v1

Extractor output:
ai_extractor_v1

Validator output:
ai_validator_v1

FINAL:
tender_field_final_v1
```

Стабильная chunking configuration:

```text
Собрать смысловые разделы v1.4
Подготовить части для анализа v1.3
Развернуть части для AI v1.2

maxPrimaryApproxTokens = 3200
overlapSemanticBlocks = 1
```

Не менять без конкретной причины и regression test.

---

# 15. Definition of MVP Done

MVP считается завершённым, когда:

```text
1 tender_id
```

автоматически приводит к:

```text
analysis_run.status = completed
```

и в БД существуют:

```text
ровно 27 FINAL field results
```

с допустимыми статусами:

```text
resolved
requires_review
not_found
```

после чего автоматически создаются:

```text
Markdown
XLSX
```

и отправляются:

```text
Telegram
```

---

# 16. Что оставить на после MVP

Не блокируют первый стабильный end-to-end результат:

```text
company matching
Bitrix integration
frontend
полный runtime FIELD_CATALOG refactor
идеальный retry framework
visual AI
real tokenizer
OCR fallback
raw-source archive
advanced monitoring
full error audit
```

---

# 17. Ключевой принцип проекта

Главная идея системы:

> Не просить одну нейронку прочитать весь тендер и поверить её ответу.

Вместо этого:

```text
документ
→ детерминированная структура
→ semantic blocks
→ analysis units
→ candidate facts
→ evidence grounding
→ independent validation
→ cross-document aggregation
→ targeted recheck
→ FINAL fields
→ DB synchronization
→ report
```

Именно эта цепочка является основой надёжности проекта.
