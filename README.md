# AI-анализ тендерной документации — n8n

**Статус:** Active development / MVP  
**Последнее обновление:** 2026-08-23
**Основной стек:** n8n + PostgreSQL + TenderPlan + IBM Docling + Polza AI (модель DeepSeek)
**Каталог полей:** `tender_fields_v1`  
**FINAL-контракт:** `tender_field_final_v1`

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
TENDER — Генерация отчета (stub)
    ↓
будущие Markdown / XLSX / Telegram
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
→ direct FINAL / Round 2 / not_found / requires_review
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
→ вызов report generation stub
```

Workflow ID: `cSsh9yjpS7t5p0OO`.

---

## `TENDER — Генерация отчета`

Текущий workflow является stub: фиксирует вызов report stage, но ещё не создаёт Markdown/XLSX и не отправляет Telegram.

Workflow ID: `ckPnP3hRhKu4Mf9u`.

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

## Уже работает

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
✓ rules для всех 27 field_key
⚠ полный per-field regression Round 2 ещё не выполнен

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

---

## Текущий остаток MVP

После закрытия AG-0 текущая последовательность выглядит так:

```text
run.status = aggregating
        ↓
TENDER — Финализация анализа
        ↓
27/27 + atomic run completion
        ↓
run.status = completed
        ↓
report generation stub
        ↓
реальная генерация Markdown / XLSX / Telegram — следующий этап
```

---

# 9. Главный текущий backlog

Полный backlog:

```text
TECH_DEBT.md
```

Критический путь MVP:

```text
TR-0 ✅ Closed
TR-1 ✅ Closed
TR-2 ✅ Closed (MVP)
TR-3 ✅ Closed


Текущий путь до законченного MVP:
report generation stage
→ ordered FINAL 1..27
→ Markdown
→ XLSX
→ Telegram
```

---

# 10. Следующая задача

Текущая точка продолжения:

```text
реализовать фактический report stage:
load ordered FINAL 1..27
→ Markdown
→ XLSX
→ Telegram
```

DB-backed completion уже подтверждён execution `13863`: `27/27`, `completion_claimed=true`, `run.status=completed`.

После этого добавить regression test и обновить:

```text
TECH_DEBT.md
DEVELOPMENT_LOG.md
```

---

# 11. Куда смотреть

## Нужно быстро понять весь проект

```text
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
