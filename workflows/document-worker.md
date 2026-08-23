# TENDER — Обработать документ

**Статус:** Active development / MVP  
**Последнее обновление:** 2026-08-22  
**Тип:** child workflow / Document Worker  
**Точное имя workflow:** `TENDER — Обработать документ`  
**Workflow ID:** `1Pw61ZY3HgBSvcUr`  
**Вызывается:** `ТЕНДЕРЫ ОРКЕСТРАТОР`  
**Вызывает:** `TENDER — Агрегация закупки` — только когда текущий Worker атомарно переводит run в `ready_for_aggregation`  
**Error Workflow:** `TENDER — Ошибка обработки документа`  
**PostgreSQL credential:** `KITATEH Tenders`  
**Docling:** IBM Docling async API  
**AI Extractor:** `deepseek-v4-pro`
**AI Validator:** `deepseek-v4-pro`

---

## 1. Назначение

`TENDER — Обработать документ` обрабатывает **ровно один зарегистрированный документ** конкретного `analysis_run`.

Основной путь:

```text
registered document
→ atomic claim
→ download
→ Docling parsing
→ universal normalization
→ semantic sections
→ analysis units
→ save units
→ AI Extractor
→ deterministic evidence validation
→ independent AI Validator
→ deterministic validator-response validation
→ save facts
→ deterministic document completion
→ run readiness check
→ при необходимости Aggregator
```

Worker не агрегирует закупку целиком и не формирует FINAL 27-field result.

---

## 2. Место в системе

```text
ТЕНДЕРЫ ОРКЕСТРАТОР
        ↓
все documents зарегистрированы
        ↓
1 document item
        ↓
TENDER — Обработать документ
        ↓
Document parsing + AI analysis
        ↓
document completed
        ↓
run readiness
        ↓
если последний document → TENDER — Агрегация закупки
```

Ключевой invariant:

```text
1 Worker execution = 1 document
```

Внутри одного document может быть `1..N analysis units`.

---

## 3. RAW input contract

Фактический input приходит из Orchestrator после `Split Out`:

```json
{
  "attachments": {
    "status": "pending",
    "file_name": "...xlsx",
    "document_id": "uuid",
    "document_index": 1,
    "file_extension": "xlsx",
    "download_url": "https://..."
  },
  "analysis_run_id": "uuid",
  "tender_meta": {}
}
```

Критичные identifiers:

```text
analysis_run_id
attachments.document_id
```

---

## 4. Полная архитектура happy path

```text
When Executed by Another Workflow
→ Проверить вход Worker
→ Захватить документ в обработку
→ Документ захвачен?
→ скачать документы RU PROXY
→ Связать метаданные и файл
→ определить тип файла
→ Загрузка файла в Docling
→ Wait 3 sec
→ Docling Проверить статус задачи
→ Задача завершена?
   ├─ processing → Wait 3 sec → poll
   ├─ pending    → Wait 3 sec → poll
   └─ success
      → Docling получить результат задачи
      → связать результат Docling и метаданные
      → Скачать текст документа Docling
      → Нормализовать документ Docling
      → подготовить блоки к анализу
      → Собрать смысловые разделы v1.4
      → подготовить части для анализа v1.3
      → Развернуть части для AI v1.2
      → Сохранить analysis unit
      → Подготовить запрос для AI
      → AI Extractor v1.0
      → Проверить и привязать evidence
      → AI Validator v1
      → Проверить ответ AI Validator
      → Собрать факты документа
      → Сохранить факты документа
      → Завершить обработку документа
      → Проверить готовность к агрегации
      → Проверить готовность к агрегации1
          ├─ FALSE → END
          └─ TRUE  → TENDER — Агрегация закупки
```

---

## 5. Atomic document claim

`Захватить документ в обработку` переводит документ:

```text
pending | failed
→ processing
```

При успешном claim:

```text
attempts += 1
n8n_execution_id = current execution
started_at = NOW()
completed_at = NULL
error_message = NULL
```

Условие claim включает одновременно:

```text
document.id
analysis_run_id
status IN ('pending', 'failed')
```

Это защищает один document от двойной параллельной обработки.

После claim canonical metadata документа перечитываются из PostgreSQL. Downstream не должен слепо доверять устаревшему object из Orchestrator.

### Known issue `DW-1`

При неуспешном claim SQL потенциально возвращает `0 items`, поэтому IF `Документ захвачен?` может не увидеть FALSE. Фактическая семантика тогда — silent idempotent stop.

---

## 6. Download boundary

Рабочий download path:

```text
скачать документы RU PROXY
```

Результат:

```text
binary.data
```

`Связать метаданные и файл` требует одновременно:

```text
binary.data
canonical document metadata
```

и восстанавливает оригинальный filename:

```text
binary.data.fileName = document.file_name
```

### `DW-2`

Proxy authentication сейчас хранится непосредственно в HTTP node config. Перед production вынести в Credentials / environment secrets.

---

## 7. File type routing

Логически предусмотрены ветки:

```text
docx/pdf/xlsx
doc
zip/rar
```

Фактически подключён только путь:

```text
pdf
docx
xlsx
```

Это согласуется с текущим временным фильтром Orchestrator.

---

## 8. Docling async parsing

Файл отправляется в Docling multipart-запросом.

Запрашиваются:

```text
json
md
```

Приоритет:

```text
JSON = primary structured artifact
Markdown = auxiliary artifact
```

После upload приходит `task_id`, затем выполняется polling с задержкой 3 секунды.

Switch сейчас знает состояния:

```text
success
processing
pending
```

`processing` и `pending` возвращаются в цикл polling.

### `DW-3` — Critical

Явная terminal-failure ветка Docling не реализована. Неизвестный/ошибочный terminal status способен оставить document в `processing`.

### `DW-4` — Medium/High

Нет явного `max_poll_attempts` / absolute deadline для polling.

Финальный GET результата имеет retry:

```text
maxTries = 5
waitBetweenTries = 5000 ms
```

---

## 9. Docling result boundary

`связать результат Docling и метаданные` требует:

```text
documents[0] exists
documents[0].status = success
JSON artifact exists
```

Markdown optional.

Docling artifact URL имеет ограниченный TTL и не является долговременным storage (`DW-7`). JSON скачивается сразу.

---

## 10. Universal Docling Normalizer

`Нормализовать документ Docling` принимает `DoclingDocument` и превращает provider-specific структуру в наш универсальный document representation.

Поддерживаются:

```text
texts
tables
pictures
groups
key_value_items
form_items
```

Traversal рекурсивный по `$ref`.

### Таблицы

Используется:

```text
data.table_cells
```

а не `data.grid`, чтобы не размножать merged cells.

Сохраняются logical cell coordinates, row/column spans и flags headers/fillable.

### Excel provenance

Sheet восстанавливается через Docling groups и сохраняется как `sheet_name` / group path.

### Body + furniture

Обрабатываются оба слоя. Furniture не удаляется на parser stage.

### Anti-data-loss metrics

Считаются:

```text
visitedRefs
unknownRefs
unvisitedContentRefs
coverage
```

Для полностью покрытого документа ожидается:

```text
unknown_refs_count = 0
unvisited_content_refs_count = 0
coverage = 1
```

---

## 11. Подготовка blocks к анализу

`подготовить блоки к анализу` не удаляет blocks физически, а добавляет:

```text
analysis.include
analysis.exclude_reason
analysis.analysis_order
```

Текущие исключения:

```text
empty_text
page_footer
probable_page_number
empty_table
visual_content
```

`page_header` не удаляется автоматически — Docling может ошибочно классифицировать смысловой текст как header.

Для простого PDF layout порядок может восстанавливаться как page → top-to-bottom → left-to-right. Для complex/multicolumn layout агрессивная перестановка не выполняется.

---

## 12. Semantic sections v1.4

`Собрать смысловые разделы v1.4` выполняет переход:

```text
physical/layout blocks
→ semantic_blocks
→ sections
```

Создаются стабильные:

```text
semantic_block_id = sb_XXXX
section_id = sec_XXX
section_path
```

Основные semantic roles:

```text
section_heading
subsection_heading
paragraph
table
```

Semantic corrections сохраняются в audit `semantic_corrections[]`.

Для structured tables AI получает coordinate rendering вида:

```text
Строка R2:
[C1] ...
[C5] ...
[C7] ...
```

Разные Excel sheets не должны смешиваться в одной analysis unit.

---

## 13. Chunking v1.3

Текущая production-конфигурация:

```text
approxCharsPerToken = 3
maxPrimaryApproxTokens = 3200
overlapSemanticBlocks = 1
```

Chunking hierarchy-aware:

```text
sheet
→ section
→ subsection
→ semantic blocks
→ token budget
```

Один semantic block не режется внутри. Oversized block остаётся атомарным:

```text
oversized_atomic_block = true
```

Overlap допускается только внутри совместимого section/sheet/subsection context. Table не должен использоваться как overlap.

### Primary coverage invariant

Каждый semantic block должен быть primary **ровно в одной** unit.

Контроль:

```text
missing_semantic_blocks
duplicated_primary_semantic_blocks
primary_coverage
data_loss
```

---

## 14. Expand for AI v1.2

`Развернуть части для AI v1.2` делает:

```text
1 document object
→ N items
```

где:

```text
1 item = 1 analysis_unit
```

Создаются компактные структуры:

### `ai_segments[]`

```json
{
  "semantic_block_id": "sb_0001",
  "scope": "primary",
  "type": "table",
  "role": "table",
  "text": "..."
}
```

### `provenance.index`

```text
semantic_block_id
→ source block
→ section
→ sheet
→ page
→ bbox
```

Это центральная anti-hallucination связка системы.

---

## 15. Save analysis units

Каждая unit сохраняется в:

```text
tender_analysis_units
```

до вызова AI.

UPSERT identity:

```text
(document_id, analysis_unit_id)
```

Сохраняются:

```text
analysis_run_id
document_id
analysis_unit_id
unit_index
units_total
section_id
section_title
section_kind
part_index
parts_total
source_pages
analysis_unit
ai_segments
provenance
```

Также document получает `units_total`.

Это позволяет Extractor, Targeted Recheck и audit читать контекст из DB без повторного Docling parsing.

### `DW-8` — High

UPSERT не удаляет analysis units, которые существовали в прошлой попытке, но исчезли в новой. Это может вызвать:

```text
units_total = 2
stored_units_count = 3
→ units_count_mismatch
→ document не completed
```

---

## 16. Extractor request preparation

`Подготовить запрос для AI` использует:

```text
prompt_version = tender_extractor_prompt_v1
schema_version = ai_extractor_v1
field_catalog_version = tender_fields_v1
```

До вызова AI выполняется fail-fast проверка:

```text
analysis_unit exists
primary / overlap IDs valid
primary not empty
no duplicates
primary ∩ overlap = ∅
ai_segments = primary + overlap в том же порядке
provenance.index = тот же набор IDs
scope consistent
provenance counters consistent
```

---

## 17. Runtime field catalog

Extractor получает descriptions всех 27 `field_key`.

Главный human-readable semantic source of truth:

```text
FIELD_CATALOG.md
```

Extractor — первый runtime AI layer, который определяет, какой fragment является candidate конкретного поля.

---

## 18. Extractor semantics

Extractor:

```text
не формирует FINAL
не формирует global not_found
```

Если в unit нет фактов:

```json
{
  "facts": []
}
```

Ключевой принцип:

```text
не найдено в одной unit
≠
отсутствует во всей закупке
```

Metadata документа/тендера — context, но не evidence.

---

## 19. Extractor fact contract

```json
{
  "field_key": "...",
  "value_text": "...",
  "status": "found | requires_review",
  "confidence": 0.0,
  "evidence": [
    {
      "semantic_block_id": "sb_XXXX",
      "quote": "..."
    }
  ],
  "review_reason_code": null,
  "review_note": null
}
```

Каждый fact должен иметь минимум одно evidence из `scope=primary`.

Overlap-only fact запрещён.

Quote должна быть непрерывной дословной подстрокой semantic block. Нельзя склеивать несмежные fragment в одну fake quote.

---

## 20. AI Extractor v1.0

Model:

```text
deepseek-v4-pro
```

Настройки:

```text
thinking = disabled
response_format = json_object
max_tokens = 4096
timeout = 180000 ms
```

Полный JSON Schema строится application-side, но provider получает только `json_object`.

### `DW-12`

Provider-side schema enforcement отсутствует; deterministic validation выполняется после AI. Для MVP это приемлемо.

---

## 21. Deterministic evidence validation

`Проверить и привязать evidence` проверяет:

```text
choices
finish_reason = stop
content non-empty
valid JSON
schema_version
field_catalog_version
analysis_unit_id
facts structure
field_key allow-list
status
confidence
review fields
evidence structure
semantic_block_id exists
provenance exists
scope consistency
primary evidence
quote grounding
```

Главная grounded-проверка:

```text
normalizedSegmentText.includes(normalizedQuote)
```

Нормализуется только whitespace.

После этого система сама привязывает настоящий provenance:

```text
page
bbox
sheet
source_block_ids
section
```

AI не создаёт provenance самостоятельно.

---

## 22. `verified_facts` semantics

Название `verified_facts` сильнее фактической гарантии.

На этом этапе подтверждено:

```text
schema
identity
quote exists
provenance exists
primary evidence exists
```

Но **ещё не гарантирована semantic correctness**.

Правильная трактовка:

```text
verified_facts = evidence-grounded candidates
```

См. `DW-13`.

---

## 23. Error behavior evidence validator

В актуальном export у ноды `Проверить и привязать evidence` отсутствуют:

```text
onError
continueOnFail
```

Её regular output подключён к `AI Validator v1`.

Следовательно, configuration-level silent bypass через `continueErrorOutput` текущим export не подтверждается. При этом invalid-response/error behavior требует runtime regression; риск `DW-14` не считается полностью закрытым.

---

## 24. Independent AI Validator

`AI Validator v1` использует:

```text
deepseek-v4-pro
thinking = enabled
reasoning_effort = low
response_format = json_object
```

Validator не ищет новые facts. Он проверяет каждый existing candidate независимо:

1. относится ли evidence к правильному field_key;
2. подтверждает ли `value_text`;
3. нет ли overinterpretation;
4. не потеряна ли оговорка;
5. не перепутаны ли похожие сущности;
6. не является ли источник template/placeholder;
7. нет ли conflict.

Verdicts:

```text
confirmed
requires_review
rejected
```

---

## 25. Deterministic Validator Response Check

`Проверить ответ AI Validator` проверяет:

```text
choices[0]
finish_reason = stop
content non-empty
valid JSON
schema_version = ai_validator_v1
analysis_unit_id exact match
validations count = facts count
каждый fact_index существует ровно один раз
нет unknown fact_index
нет missing fact
field_key не изменён
verdict allow-list
confidence 0..1
reason fields соответствуют verdict
```

После этого формируется `validated_facts[]`.

---

## 26. Observed semantic failure — `customer = "не указан"`

Реальный pin test выявил подтверждённую ошибку качества.

Extractor создал:

```text
field_key = customer
value_text = "не указан"
status = requires_review
```

Evidence:

```text
"Город Москва, улица Пресненский Вал, дом 23"
```

Это адрес поставки, а не customer.

Independent AI Validator затем ошибочно выдал:

```text
verdict = confirmed
confidence = 0.95
```

несмотря на прямое правило не считать отсутствие информации доказательством отрицательного ответа.

Deterministic response checker корректно пропустил этот response, потому что структура ответа была валидна.

### `DW-15` — Critical / observed

Это обязательный regression scenario до production.

---

## 27. Ограничение context второго Validator

AI Validator получает:

```text
verified_facts
+
evidence_context
```

`evidence_context` содержит только semantic blocks, которые Extractor уже выбрал в evidence.

Если важная qualification/conflict находится в другом block той же unit, Validator может её не увидеть.

### `DW-16` — Medium

Ослабляет detection `missing_qualification` и `conflicting_evidence`.

---

## 28. Collect document facts

`Собрать факты документа` делает barrier:

```text
N validated unit items
→ 1 document item
```

Проверяет:

```text
все units одного run
все units одного document
saved units count = expectedUnits
validated items count = expectedUnits
каждая validated unit существует в DB saved units
```

Намеренно НЕ выполняет:

```text
group by field_key
dedup
best candidate selection
conflict resolution
global not_found
```

Это ответственность Aggregator.

---

## 29. Persist facts

`Сохранить факты документа` сохраняет в:

```text
tender_analysis_facts
```

все verdict:

```text
confirmed
requires_review
rejected
```

UPSERT identity:

```text
(document_id, analysis_unit_id, fact_index)
```

Также реализован `deleted_stale_facts`: старые facts данного document, которых больше нет в новом input, удаляются.

После сохранения:

```text
tender_analysis_documents.facts_count = current facts count
```

---

## 30. Deterministic document completion

`Завершить обработку документа` переводит:

```text
processing
→ completed
```

только если одновременно:

```text
units_total IS NOT NULL
units_total = stored_units_count
facts_count IS NOT NULL
facts_count = stored_facts_count
```

При success:

```text
completed_at = NOW()
error_message = NULL
```

Возможные причины отказа:

```text
document_not_processing
units_total_is_null
units_count_mismatch
facts_count_is_null
facts_count_mismatch
unknown
```

Это сильный deterministic completion barrier.

---

## 31. Run readiness

После completion каждый Worker считает:

```text
registered_documents_count
completed_documents_count
pending_documents_count
processing_documents_count
failed_documents_count
skipped_documents_count
```

Run атомарно переводится:

```text
processing
→ ready_for_aggregation
```

только если:

```text
documents_total > 0
registered_documents_count = documents_total
completed_documents_count = documents_total
```

Это означает, что текущая readiness semantics требует **все documents = completed**.

---

## 32. Concurrency readiness pattern

Пример трёх Workers:

```text
Worker 1 → 1/3 completed → false
Worker 2 → 2/3 completed → false
Worker 3 → 3/3 completed
          → atomic UPDATE processing→ready_for_aggregation
          → should_start_aggregation=true
```

Условие `WHERE run.status='processing'` гарантирует, что Aggregator должен запустить только один Worker.

---

## 33. Readiness reasons

Текущие reason codes:

```text
all_documents_completed
documents_count_mismatch
failed_documents_exist
documents_still_processing
documents_still_pending
skipped_documents_exist
not_all_documents_completed
run_not_claimed
```

---

## 34. Start Aggregator

IF `Проверить готовность к агрегации1` проверяет:

```text
should_start_aggregation === true
```

TRUE:

```text
Call 'TENDER — Агрегация закупки'
```

FALSE:

```text
Worker ends
```

Именно readiness node формирует RAW input Aggregator.

---

## 35. Workflow-level Error Handler

В Workflow Settings настроен:

```text
TENDER — Ошибка обработки документа
```

Это внешний error handler Worker.

Его внутреннее поведение в этом документе не описывается и должно быть зафиксировано отдельно в `error-workflow.md`.

Важно: актуальный export не подтверждает configuration-level bypass через `continueErrorOutput`. Поведение invalid/error response требует runtime regression, поэтому наличие Error Workflow **не закрывает `DW-14`**.

---

## 36. Основные invariants

1. Один execution = один document.
2. Document существует в DB до Worker.
3. Worker начинает processing только после atomic claim.
4. `pending` и `failed` допускаются к claim.
5. Canonical document metadata после claim читаются из DB.
6. Binary обязателен до parser stage.
7. Docling JSON — primary parser artifact.
8. Normalizer контролирует traversal coverage.
9. Исходные blocks не удаляются до semantic layer.
10. Каждый semantic block имеет стабильный ID.
11. Каждый semantic block primary ровно в одной unit.
12. Different XLSX sheets не объединяются в одну unit.
13. Atomic semantic block не режется.
14. Units сохраняются до AI.
15. Extractor не создаёт global `not_found`.
16. Metadata не являются document evidence.
17. Fact имеет >=1 grounded evidence.
18. Fact имеет >=1 primary evidence.
19. Quote реально существует в semantic block.
20. AI не создаёт provenance.
21. Independent Validator не ищет новые facts.
22. Validator возвращает ровно один verdict на candidate.
23. Facts не агрегируются внутри Worker.
24. Rejected facts сохраняются для audit.
25. Document completed только при DB count equality.
26. Aggregator запускается только после atomic run readiness claim.
27. Только один Worker получает `should_start_aggregation=true`.

---

## 37. Known Technical Debt

| ID | Severity | Проблема |
|---|---|---|
| `DW-0` | Low/Medium | `Проверить вход Worker` не делает строгую validation |
| `DW-1` | Low | failed claim может закончиться через 0 items до IF |
| `DW-2` | Medium | proxy auth находится в HTTP node config |
| `DW-3` | **Critical** | нет Docling terminal-failure path |
| `DW-4` | Medium/High | polling без явного лимита |
| `DW-5` | Low | stale comment про старый Limit |
| `DW-6` | Low | stale reference на `Подготовить результат Docling` |
| `DW-7` | Info | Docling artifact URLs временные |
| `DW-8` | **High** | stale analysis units могут сломать retry completion |
| `DW-9` | Low | stale comment про 600 tokens, фактически 3200 |
| `DW-10` | Info | approximate tokenizer `chars/3` |
| `DW-11` | Medium | visual content не анализируется |
| `DW-12` | Low | JSON Schema не enforced provider-side |
| `DW-13` | Low | `verified_facts` = grounded candidates, а не final semantic truth |
| `DW-14` | **Critical** | configuration-level bypass не подтверждён export; invalid/error behavior требует runtime regression |
| `DW-15` | **Critical / observed** | Validator реально подтвердил `customer="не указан"` по absence |
| `DW-16` | Medium | Validator видит только Extractor-selected evidence blocks |

---

## 38. Cross-workflow issue: skipped documents

Будущий fix Orchestrator:

```text
unsupported → skipped
```

нельзя внедрять изолированно.

Текущий readiness требует:

```text
completed_documents_count = documents_total
```

Поэтому:

```text
2 completed + 1 skipped
```

не считается ready.

Если `skipped` станет допустимым terminal status, readiness semantics Worker нужно менять одновременно.

---

## 39. Проверенные реальные сценарии

| Сценарий | Статус |
|---|---|
| pending document → processing claim | ✅ |
| Worker использует DB document identity | ✅ |
| XLSX → Docling → normalized table | ✅ |
| normalization coverage = 1 на тесте | ✅ |
| analysis unit persisted before AI | ✅ |
| grounded quote validation | ✅ |
| provenance restoration | ✅ |
| Validator structural response check | ✅ |
| facts persisted | ✅ |
| stale facts cleanup | ✅ |
| deterministic document completion | ✅ |
| 1/3 completed → run not ready | ✅ |
| last completed Worker → Aggregator | архитектурно подтверждено |
| Extractor false absence candidate | ❌ observed |
| Validator false confirmation | ❌ observed |
| evidence validator Error branch handling | ❌ |
| Docling terminal failure handling | ❌ |
| stale units retry safety | ❌ |

---

## 40. Regression checklist

### W1 — normal claim

```text
pending → processing
attempts += 1
```

### W2 — duplicate claim

Не должно быть двойной обработки одного document.

### W3 — failed retry

```text
failed → processing
```

### W4 — Docling success

JSON artifact обязателен.

### W5 — Docling failure

После `DW-3`:

```text
document → failed
error_message set
```

### W6 — normalization coverage

Для полностью поддержанного файла:

```text
unknown refs = 0
unvisited refs = 0
```

### W7 — chunking coverage

Каждый semantic block primary ровно один раз.

### W8 — fake quote

Deterministic evidence validator reject.

### W9 — overlap-only fact

Reject.

### W10 — Validator changed field_key

Reject response.

### W11 — Validator omitted fact

Reject response.

### W12 — `customer = не указан`

После `DW-15` не должен становиться `confirmed`.

### W13 — stale facts

Retry удаляет obsolete facts.

### W14 — stale units

После `DW-8` obsolete units не остаются в DB.

### W15 — document completion

```text
stored units = units_total
stored facts = facts_count
→ completed
```

### W16 — run not ready

```text
1 completed / 2 pending
→ should_start_aggregation=false
```

### W17 — last document

```text
run processing → ready_for_aggregation
should_start_aggregation=true
one Aggregator start
```

### W18 — handled node error

После `DW-14` document не должен молча оставаться `processing`.

---

## 41. Safe Modification Checklist

Перед изменением Worker:

1. Не ломать `1 execution = 1 document`.
2. Не убирать atomic document claim.
3. Не заменять DB canonical state старыми input metadata.
4. Не менять semantic block IDs после persistence.
5. Не смешивать XLSX sheets.
6. Не резать atomic semantic blocks.
7. Не допускать primary duplication.
8. Не разрешать overlap-only fact.
9. Не позволять AI создавать provenance.
10. Не превращать absence в global `not_found`.
11. Не пропускать deterministic evidence validation.
12. Не пропускать independent Validator.
13. Не доверять Validator response без deterministic checker.
14. Сохранять rejected facts для audit.
15. При retry синхронизировать units и facts.
16. Перед completion сверять DB counts.
17. Не запускать Aggregator без atomic readiness claim.
18. Любой handled error path должен либо переводить document в `failed`, либо пробрасывать настоящий workflow error в Error Workflow.
19. Semantic definitions менять синхронно с `FIELD_CATALOG.md`.

---

## 42. Приоритет дальнейших исправлений Worker

До production критично закрыть:

```text
DW-14 — handled evidence errors
DW-15 — absence-as-fact / semantic false confirmation
DW-3  — Docling terminal failure
DW-8  — stale units on retry
```

Следующий приоритет:

```text
DW-4  — polling deadline
DW-16 — Validator context completeness
DW-2  — proxy credentials hardening
```

Остальное не блокирует первый MVP.

---

## 43. Краткое резюме

`TENDER — Обработать документ` — независимый Document Worker с несколькими слоями защиты:

```text
DB identity
→ atomic claim
→ parser
→ normalization
→ semantic coverage
→ chunking coverage
→ persisted units
→ AI Extractor
→ deterministic grounding
→ independent AI Validator
→ deterministic response check
→ persisted facts
→ deterministic document completion
→ atomic run readiness
```

Главные сильные стороны:

- документы зарегистрированы заранее;
- atomic claim;
- semantic provenance;
- anti-data-loss coverage;
- hierarchy-aware chunking;
- grounded quote validation;
- независимый Validator;
- deterministic Validator response check;
- stale facts cleanup;
- DB completion barrier;
- atomic Aggregator start.

Главные подтверждённые риски:

```text
DW-14
configuration-level bypass не подтверждён актуальным export;
invalid/error behavior требует runtime regression

DW-15
реальный false-confirmed fact: customer="не указан"

DW-8
stale units могут сломать retry completion

DW-3
Docling terminal failure path отсутствует
```

Workflow-level Error Workflow настроен:

```text
TENDER — Ошибка обработки документа
```

Его внутреннюю архитектуру нужно документировать отдельно.
