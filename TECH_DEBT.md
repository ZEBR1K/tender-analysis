# TECH\_DEBT — Tender Analysis System

**Статус:** Active backlog  
**Последнее обновление:** 2026-08-29
**Назначение:** единый приоритизированный список технического долга всей системы тендерного анализа.

\---

# 1\. Как пользоваться этим документом

Этот файл не дублирует подробное описание каждой проблемы из workflow-документов.

Он отвечает на четыре вопроса:

```text
1. Что реально может сломать MVP?
2. Что может оставить run/document в зависшем состоянии?
3. Что влияет на качество анализа?
4. В каком порядке это исправлять?
```

Подробности реализации остаются в:

```text
workflows/orchestrator.md
workflows/document-worker.md
workflows/aggregator.md
workflows/targeted-recheck.md
workflows/error-workflow.md
DATA\\\\\\\\\\\\\\\_MODEL.md
FIELD\\\\\\\\\\\\\\\_CATALOG.md
```

\---

# 2\. Уровни приоритета

## P0 — Critical

Может:

* ломать end-to-end pipeline;
* оставлять run/document в зависшем состоянии;
* приводить к неправильному FINAL;
* блокировать 27/27;
* ломать произвольные поля.

Исправлять до production и желательно до первого стабильного MVP.

\---

## Accuracy improvements

### `nm_price_with_vat`

**Проблема:** поле сейчас объединяет несколько разных сущностей:

- НМЦК;
- цену договора;
- наличие НДС.

**Текущее поведение:** система корректно переводит поле в `requires_review`, если найдено значение цены с НДС, но нет прямого подтверждения, что это именно НМЦК.

**Будущее улучшение:** рассмотреть разделение на:

- `nm_price`;
- `contract_price`;
- `vat_status`.

### `government_contract`

Упоминания ЕАИСТ, реестров договоров и государственных заказчиков не считаются доказательством наличия государственного контракта. Текущая строгая логика считается корректной.

### `warranty_obligations_guarantee`

Текущая логика корректно разделяет гарантийные обязательства по качеству товара и обеспечение гарантийных обязательств. Изменение не требуется.

---

## P1 — High

Не всегда ломает happy path, но:

* делает retry ненадёжным;
* создаёт silent failure;
* снижает качество анализа;
* создаёт опасные edge cases;
* усложняет диагностику.

Исправлять сразу после P0.

\---

## P2 — Medium

Не блокирует текущий MVP, но:

* ухудшает поддержку;
* создаёт semantic drift;
* увеличивает стоимость ошибок;
* делает систему менее безопасной или менее наблюдаемой.

\---

## P3 — Low

Naming, comments, cleanup, future hardening.

Не должно отвлекать от end-to-end MVP.

\---

# 3\. Сводка по приоритетам

## P0 — Critical

|ID|Проблема|Компонент|
|-|-|-|
|TR-0|✅ Closed|Реализован сценарий existing candidate + no usable recheck context. Поле не уходит в not\_found, сохраняется исходный candidate и формируется requires\_review.|
|TR-1|✅ Closed|Реализован lifecycle existing candidates + Targeted Recheck candidates. Round 2 Aggregator умеет объединять исходные и новые candidates, сохраняя candidate\_ref и evidence. Требуется отдельный regression-тест негативного сценария.|
|TR-2|✅ Closed (MVP)<br />|✅ закрыто частично или полностью для MVP:<br /><br />все 27 field\_key прошли через Semantic Aggregator;<br />выполнен полный прогон закупки;<br />получены 27 final fields;<br />Round 1 Aggregator отработал.<br /><br />Остаётся:<br />- улучшение качества отдельных semantic rules;<br />- regression dataset;<br />- ручная проверка сложных полей.|
|TR-3|✅ Closed|Исправлены зависимости дочернего workflow от parent workflow nodes. Targeted Recheck workflow теперь получает необходимые данные через входной JSON и успешно выполняется отдельно.|
|`DW-14 / EW-3`|handled evidence error может тихо закончить ветку и не вызвать Error Workflow|Document Worker / Error Workflow|
|`DW-15`|реальный false-confirmed факт `customer="не указан"`|Document Worker / semantic safety|
|`DW-3`|Docling terminal failure statuses не обработаны|Document Worker|
|`DW-8`|stale analysis units после retry могут блокировать completion|Document Worker|
|`OR-0`|unsupported documents регистрируются, но не получают terminal status|Orchestrator|
|`AG-0`|✅ Closed (verified 23.08.2026)<br />Live E2E подтвердил atomic aggregation claim, DB-backed 27/27 barrier и `run.status=completed`.|Execution `13856` установил `aggregation_claimed=true`; executions `13858–13863` записали 27 FINAL rows; execution `13863` установил `barrier_ready=true` и `completion_claimed=true`. Текущий downstream — Report Generation V2: read-only snapshot → HTML artifact; PDF/DOCX/XLSX/delivery остаются future work.|
|`AG-7`|✅ Closed (MVP)<br />Semantic Aggregator E2E validation завершена|Aggregator<br /><br />Проверено на полном прогоне закупки:<br />- все 27 field\_key обработаны;<br />- создано 27 записей в tender\_analysis\_field\_results;<br />- Semantic Aggregator Round 1 успешно завершён;<br />- результаты сохранены в FINAL contract.<br /><br />Остаётся:<br />- regression dataset;<br />- улучшение semantic rules для сложных полей.|
|`AG-8`|⚠ Mitigated / verified in test: universal `procurement_subject` current-scope boundary прошла offline beta contract, MCP read-back и один paid runtime canary `14104`. Остаётся открытой до production promotion и fresh full 27/27 run.|Aggregator semantic safety|
|`AG-9`|⚠ Mitigated / safe-deferred in test: `application_documents` execution `14173` покрыт offline oracle и paid runtime canary, который вернул `requires_recheck/ambiguous_scope` без Round 1 FINAL. Остаётся открытой до Targeted Recheck verification, production promotion и fresh full run.|Aggregator / Targeted Recheck semantic safety|

Document Worker packaging checkpoint 2026-08-29:

- immutable 60-node beta snapshot сохранён по пути `workflows/n8n-exports/beta/[3 TEST] TENDER — Обработать документ.json`, SHA-256 `02e4e5ccc761ecf78771c2ae4a3c4e529f3536533de2d9e7a5ef2084fe0459dd`;
- canonical JSON является clean 51-node offline production candidate и защищён beta→canonical regression;
- packaging gate закрыт локально, но live production Worker не изменён;
- promotion/wiring и runtime canary candidate остаются открытыми verification gates.

Extractor model-selection checkpoint 2026-08-29:

- текущий provisional baseline test/canonical candidate: `z-ai/glm-5.3-flash@provider=cloudflare&reasoning_effort=low`;
- Gemini 3.7 Flash low оставлен fallback-кандидатом;
- model search на текущих 16 pinned units остановлен после сравнительного отчёта `evaluations/EXTRACTOR_MODEL_COMPARISON_2026-08-29.md`;
- full Worker runtime canary с выбранной связкой Extractor + Validator не выполнен и остаётся gate;
- A/B подтвердил, что exact evidence validation не защищает от неверного `field_key`; universal semantic boundary `evaluation_criteria` остаётся предметом runtime наблюдения, но новый redesign до canary не открывается.

\---

## P1 — High

|ID|Проблема|Компонент|
|-|-|-|
|`DW-4`|polling Docling без лимита / deadline|Document Worker|
|`DW-16`|AI Validator видит только Extractor-selected evidence blocks|Document Worker|
|`EW-0`|failed document не переводит run в terminal/error policy|Error Workflow|
|`EW-1`|Error Workflow может UPDATE 0 rows и завершиться без явной ошибки|Error Workflow|
|`EW-2`|ошибка до claim не может быть привязана к document через execution id|Error Workflow|
|`AG-1`|нет selective retry для Round 1 AI|Aggregator|
|`TR-6`|нет selective retry для Recheck AI anomaly|Targeted Recheck|

\---

## P2 — Medium

|ID|Проблема|Компонент|
|-|-|-|
|`OR-1`|zero-documents edge case|Orchestrator|
|`OR-4`|поддерживаются только pdf/docx/xlsx|Orchestrator / Worker|
|`OR-5`|Orchestrator без Error Workflow|Orchestrator|
|`OR-6`|TenderPlan HTTP без retry/backoff policy|Orchestrator|
|`DW-2`|proxy auth хранится в node config|Document Worker|
|`DW-11`|visual content не анализируется|Document Worker|
|`AG-2 / TR-5`|дублируются Normalize FINAL + Save|Aggregator / Recheck|
|`AG-3`|TenderMeta mappings захардкожены отдельно|Aggregator|
|`AG-4`|unknown run может тихо завершить Aggregator|Aggregator|
|`AG-5 / TR-8`|semantic rules размазаны между несколькими слоями|System-wide|
|`TR-7`|requires\_review fallback может брать произвольный candidate|Targeted Recheck|
|`DM-0`|`field\\\\\\\\\\\\\\\_results` не имеет FK на run|Data model|
|`EW-5`|нет alert/notification на document failure|Error Workflow|
|`EW-4`|сохраняется только короткий `error\\\\\\\\\\\\\\\_message`|Error Workflow|

\---

## P3 — Low

|ID|Проблема|Компонент|
|-|-|-|
|`OR-2`|manual trigger + hardcoded tender\_id|Orchestrator|
|`OR-3`|`raw\\\\\\\\\\\\\\\_source` нормализуется, но не сохраняется|Orchestrator|
|`OR-7`|policy повторных runs одного tender не зафиксирована|Orchestrator|
|`DW-0`|node `Проверить вход Worker` не валидирует input строго|Document Worker|
|`DW-1`|claim false может выражаться как 0 items|Document Worker|
|`DW-5`|stale comment про Limit|Document Worker|
|`DW-6`|stale reference на старую Docling node|Document Worker|
|`DW-7`|artifact URLs временные|Document Worker|
|`DW-9`|stale comment про 600 tokens|Document Worker|
|`DW-10`|approximate tokenizer `chars/3`|Document Worker|
|`DW-12`|provider не enforce-ит JSON Schema|Document Worker|
|`DW-13`|`verified\\\\\\\\\\\\\\\_facts` — слишком сильное название|Document Worker|
|`AG-6`|stale comment в Round 1 FIELD\_RULES|Aggregator|
|`TR-9`|keyword top-N retrieval|Targeted Recheck|
|`DM-1`|дублирующий UNIQUE index|Data model|
|`DM-2`|field\_results.field\_key без CHECK каталога|Data model|
|`DM-3`|version field не связан с физическим catalog|Data model|
|`DM-4`|JSONB contracts валидируются application-side|Data model|
|`EW-6`|timestamps failed-state не полностью формализованы|Error Workflow|

\---

# 4\. Consolidated Issue Groups

Ниже одинаковые или связанные проблемы объединены в системные группы.

\---

# 5\. GROUP A — Targeted Recheck correctness

## A1 — `TR-0` (historical / resolved)

**Status:** ✅ Closed

### Историческая проблема

Сценарий:

```text
existing candidate
+
targeted retrieval не нашёл context
```

Исторически path уходил в not\_found finalizer, guard которого ожидал:

```text
no\\\\\\\\\\\\\\\_initial\\\\\\\\\\\\\\\_candidates
+
existing\\\\\\\\\\\\\\\_candidates = \\\\\\\\\\\\\\\[]
```

Это неверно.

### Правильная семантика

Если старый candidate уже есть:

```text
нет нового context
≠
not\\\\\\\\\\\\\\\_found
```

Желаемое:

```text
requires\\\\\\\\\\\\\\\_review
resolution\\\\\\\\\\\\\\\_method =
targeted\\\\\\\\\\\\\\\_recheck\\\\\\\\\\\\\\\_unresolved\\\\\\\\\\\\\\\_existing\\\\\\\\\\\\\\\_candidate
```

### Приоритет

```text
P0
```

\---

## A2 — `TR-1` (historical / resolved)

**Status:** ✅ Closed

### Историческая проблема

Сценарий:

```text
existing candidate
+
новые recheck candidates
+
все новые rejected
```

Исторически path мог уйти в not\_found branch и сломать guard.

### Правильная семантика

Старый candidate всё ещё существует.

Желаемое:

```text
requires\\\\\\\\\\\\\\\_review
```

а не:

```text
not\\\\\\\\\\\\\\\_found
```

### Приоритет

```text
P0
```

\---

## A3 — `TR-2` (historical / resolved)

**Status:** ✅ Closed (MVP)

### Историческая проблема

Исторически Round 2 field-specific rules были только для:

```text
procurement\\\\\\\\\\\\\\\_subject
nm\\\\\\\\\\\\\\\_price\\\\\\\\\\\\\\\_with\\\\\\\\\\\\\\\_vat
delivery\\\\\\\\\\\\\\\_term
warranty\\\\\\\\\\\\\\\_obligations\\\\\\\\\\\\\\\_guarantee
```

Остальные 23 field\_key могли упасть при попадании в Round 2. Сейчас rules существуют для всех 27 `field_key`; полный per-field regression ещё не выполнен.

### Приоритет

```text
P0
```

### Историческое требование

Исторически требовалось расширить Round 2 на все 27 полей в соответствии с:

```text
FIELD\\\\\\\\\\\\\\\_CATALOG.md
```

Не придумывать новые semantics отдельно от каталога.

Требование выполнено; незакрытым остаётся только полный per-field regression.

\---

## A4 — `TR-3` (historical / resolved)

**Status:** ✅ Closed

### Историческая проблема

Исторически child workflow обращался к parent node:

```javascript
$('Загрузить факты закупки').first().json
```

для получения:

```text
tender\\\\\\\\\\\\\\\_meta
```

Это было ненадёжно через sub-workflow boundary. Сейчас необходимые данные передаются через входной JSON, и child workflow может выполняться автономно.

### Исторические варианты решения

#### Вариант A — parent передаёт `tender\\\\\\\\\\\\\\\_meta`

Плюсы:

```text
просто
дёшево
без DB query
```

Минус:

```text
контракт child становится шире
```

#### Вариант B — child загружает TenderMeta по `analysis\\\\\\\\\\\\\\\_run\\\\\\\\\\\\\\\_id`

Плюсы:

```text
child автономен
DB source of truth
```

Минус:

```text
дополнительный query
```

### Принятое решение

Для надёжной модульности принято:

```text
child DB load by analysis\\\\\\\\\\\\\\\_run\\\\\\\\\\\\\\\_id
```

### Приоритет

```text
P0
```

\---

# 6\. GROUP B — Silent-stuck document paths

## B1 — `DW-14 / EW-3`

### Проблема

Нода:

```text
Проверить и привязать evidence
```

В актуальном export у ноды отсутствуют `onError` и `continueOnFail`; её regular output подключён к `AI Validator v1`.

Поэтому configuration-level silent bypass через `continueErrorOutput` не подтверждён текущей реализацией. Остаётся runtime risk: invalid/error behavior требует regression и может привести к silent-stuck состоянию, если фактическая ошибка не будет обработана корректно.

### Почему критично

Это возможный runtime silent-stuck state, который требует regression.

Run затем никогда не станет:

```text
ready\\\\\\\\\\\\\\\_for\\\\\\\\\\\\\\\_aggregation
```

### Правильная архитектура

Handled error должен приводить к одному из двух вариантов:

```text
A. явно mark document failed
```

или:

```text
B. rethrow real workflow error
→ Error Workflow
→ mark document failed
```

### Рекомендация

Для простоты:

```text
не гасить критическую validation error
```

а давать ей падать в workflow-level Error Workflow.

### Приоритет

```text
P0
```

\---

## B2 — `DW-3`

### Проблема

Docling Switch знает:

```text
success
processing
pending
```

но не имеет terminal failure branch.

### Риск

```text
Docling = failed/error
→ no branch
→ document processing forever
```

### Требуемое поведение

```text
terminal Docling error
→ workflow failure
→ Error Workflow
→ document failed
```

или явный DB fail path.

### Приоритет

```text
P0
```

\---

## B3 — `OR-0`

### Проблема

Порядок:

```text
register ALL docs
→ filter extensions
→ Worker only pdf/docx/xlsx
```

Unsupported document остаётся:

```text
pending
```

навсегда.

### Нельзя просто исключить его из регистрации

Потому что это скрывает реальный документ закупки.

### Нужна terminal semantics

Варианты:

```text
unsupported → skipped
```

или:

```text
unsupported → failed
```

Но текущий readiness требует:

```text
completed = documents\\\\\\\\\\\\\\\_total
```

поэтому `skipped` надо проектировать вместе с readiness.

### Приоритет

```text
P0
```

\---

# 7\. GROUP C — Semantic false positives

## C1 — `DW-15`

### Реальный observed case

Extractor создал:

```text
field\\\\\\\\\\\\\\\_key = customer
value\\\\\\\\\\\\\\\_text = "не указан"
```

с evidence:

```text
delivery address
```

AI Validator затем подтвердил:

```text
confirmed
confidence = 0.95
```

хотя prompt прямо запрещает:

```text
absence → negative fact
```

### Почему это критично

Это не malformed JSON.

Это семантически неправильный факт, который прошёл:

```text
Extractor
Evidence Validator
AI Validator
Validator Response Checker
DB persistence
```

### Главный вывод

Два LLM-прохода не заменяют deterministic business guards.

### Возможный deterministic guard

До persistence / до Validator запрещать pseudo-values вроде:

```text
не указан
не указано
не найден
нет данных
отсутствует информация
```

если это значение не является прямым утверждением источника.

### Важно

Нельзя просто глобально запрещать слово:

```text
"нет"
```

потому что некоторые поля имеют legitimate direct negative evidence:

```text
"Аналоги не допускаются"
```

Guard должен быть semantic-aware.

### Приоритет

```text
P0
```

\---

## C2 — `DW-16`

### Проблема

Validator видит только:

```text
semantic blocks,
которые Extractor сам выбрал как evidence
```

Он может не увидеть соседний block с:

```text
qualification
exception
conflict
```

### Возможное улучшение

Передавать Validator:

```text
full analysis\\\\\\\\\\\\\\\_unit ai\\\\\\\\\\\\\\\_segments
```

или:

```text
evidence blocks
+
adjacent/relevant context
```

### Приоритет

```text
P1
```

\---

## C3 — `AG-8`

### Observed execution-derived risk

Execution `14104` дал четыре `confirmed` candidates для `procurement_subject`:

```text
3 candidates — объект текущей закупки
1 candidate — внутренний процесс поддержания оборудования
```

Production Round 1 prompt не содержит полной universal current-scope boundary. Structural checker проверяет IDs, cardinality и role consistency, но schema-valid response может назначить внутренний процесс `primary` и материализовать неправильный FINAL.

### Почему P0

Это прямой путь к:

```text
false_resolved
→ неправильное поле в клиентском отчёте
```

Самодекларируемая AI semantic-axis matrix не является независимым proof: модель может одновременно ошибиться в primary и назвать его `current_procurement_object`.

### Требуемое минимальное решение

```text
universal field-specific prompt boundary
→ current procurement / contract scope
→ internal process / auxiliary obligation / separate agreement = not_applicable
→ ambiguous scope = requires_recheck
```

В `[TEST CODEX]` минимальная prompt boundary реализована и проверена:

```text
offline beta contract = GREEN
MCP read-back = exact test artifact
paid runtime canary fixture 14104 = exit 0
checker_accepted = true
route = round1_final
semantic oracle = 6/6 GREEN
doc_7_au_0031 = not_applicable
primary = doc_7_au_0001
```

Current beta artifact SHA-256: `dc214110d3086d9e147f0b2c7fe983ee0e93543ca31f7d82c2c52ef3a1f04484`. A request-model-only A/B on fixture `14104` (fixture SHA-256 `6392f9c882a211f20cf1f13777f7002b8c8628270d025df5fdf46492f2adbd75) returned exit `0`, `finish_reason=stop`, checker acceptance, `round1_final`, and oracle 6/6 for both GLM and Gemini. Both assigned `doc_7_au_0031` `not_applicable`; GLM chose `doc_7_au_0001`, Gemini `doc_7_au_0008`. GLM is the recommended Aggregator beta baseline (0.08151487 RUB; 12911 ms; 3290 tokens); Gemini is fallback for latency/provider issues (0.25840089 RUB; 3711 ms; 3732 tokens). Evidence: `evaluations/AGGREGATOR_MODEL_COMPARISON_2026-08-29.md`.

Статус остаётся **open**: A/B harness не обращался к БД/n8n и менял только `request.model`; workflow/fixture не менялись. Production Aggregator, checker, SQL и topology не менялись; нужны отдельный production promotion gate и fresh full 27/27 run с manual semantic review.

Первый transient TLS `ECONNRESET` зафиксирован как transport incident, а не semantic failure. Неблокирующий follow-up test harness: необработанный network exception сейчас возвращает exit `1`, который может выглядеть как semantic failure; нужно позже развести transport и semantic exit semantics без redesign Aggregator.

### Приоритет

```text
P0 before client report
```

\---

## C4 — `AG-9`

### Observed execution-derived risk

Execution `14173` для `application_documents` дал schema-valid `resolved`, который прошёл production checker и материализовал FINAL, но semantic oracle выявил неверный scope, потерю существенных participant-type/period/deadline/format clauses, расплывчатые обобщения и использование неподтверждённых material requirements.

### Test mitigation

В beta Aggregator усилен только field-specific профиль. Recorded response сохранён как diagnostic false-resolved control; neutral controls не вводят blanket recheck и допускают `resolved` при прямом current-application evidence или независимом confirmed corroboration.

Paid runtime canary exact artifact:

```text
SHA-256 = dc214110d3086d9e147f0b2c7fe983ee0e93543ca31f7d82c2c52ef3a1f04484
checker_accepted = true
route = targeted_recheck
status = requires_recheck
recheck_reason_code = ambiguous_scope
final = null
false_resolved_prevented = true
semantic_oracle = GREEN
```

После первого `finish_reason=length` beta `max_tokens` увеличен `8192 → 16384`; повторный canary завершился структурно корректным ответом. Это не доказательство terminal correctness: Targeted Recheck не запускался, production workflow не менялся.

### Remaining gate

```text
Targeted Recheck audit/runtime verification
→ production promotion decision
→ fresh full 27/27 run
→ manual semantic review
```

### Приоритет

```text
P0 before client report
```

\---

# 8\. GROUP D — Retry correctness

## D1 — `DW-8`

### Проблема

Analysis units сохраняются UPSERT-ом, но stale units не удаляются.

Пример:

```text
attempt 1:
au\\\\\\\\\\\\\\\_1
au\\\\\\\\\\\\\\\_2
au\\\\\\\\\\\\\\\_3

attempt 2:
au\\\\\\\\\\\\\\\_1
au\\\\\\\\\\\\\\\_2
```

В БД остаётся:

```text
au\\\\\\\\\\\\\\\_3
```

Document completion затем видит:

```text
units\\\\\\\\\\\\\\\_total = 2
stored\\\\\\\\\\\\\\\_units\\\\\\\\\\\\\\\_count = 3
```

и блокирует:

```text
completed
```

### Почему P0

Retry уже поддерживается через:

```text
failed → processing
```

но persistence layer пока не полностью retry-safe.

### Требуемое решение

После сохранения текущего набора units:

```text
DELETE stale units
WHERE document\\\\\\\\\\\\\\\_id = ...
AND analysis\\\\\\\\\\\\\\\_unit\\\\\\\\\\\\\\\_id NOT IN current set
```

С учётом FK cascade это также может очищать stale facts.

### Приоритет

```text
P0
```

\---

## D2 — `AG-1 / TR-6`

Одинаковый паттерн на разных AI-этапах:

```text
finish\\\\\\\\\\\\\\\_reason=stop
content=""
```

или другой transient invalid model response.

### Текущая проблема

Один плохой AI response может уронить:

```text
целый batch / execution
```

### Желаемое поведение

```text
retry только конкретного field/item
```

с:

```text
max attempts
backoff
final hard error
```

### Никогда не делать

```text
reasoning\\\\\\\\\\\\\\\_content
→ считать финальным JSON
```

### Приоритет

```text
P1
```

\---

# 9\. GROUP E — Run lifecycle completeness

## E1 — `AG-0`

### Проблема

В intended architecture Aggregator начинает:

```text
ready\\\\\\\\\\\\\\\_for\\\\\\\\\\\\\\\_aggregation
→ aggregating
```

Live execution `13856` подтвердил исполняемый переход через atomic claim. После всех field UPSERT выполняется проверка:

```text
27/27?
→ completed
```

### Историческое следствие

До внедрения Finalization workflow run мог остаться в `aggregating` даже после записи всех FINAL fields. Это закрыто для проверенного MVP execution; сценарий остаётся regression case.

### Текущий статус

После любого FINAL field persistence:

```text
UPSERT
→ DB readiness check
→ 27 unique fields?
```

Только один claimant должен сделать:

```text
aggregating
→ completed
completed\\\\\\\\\\\\\\\_at = NOW()
```

a затем запускается report stage. Execution `13863` подтвердил успешный completion claim; execution `13864` исторически подтвердил вызов тогдашнего stub. Текущая реализация Report Generation V2 создаёт HTML artifact; подробности — `workflows/report-generation.md`.

### Приоритет

```text
P2 — report extensions и regression hardening
```

\---

## E2 — `EW-0`

### Проблема

После:

```text
document = failed
```

run остаётся:

```text
processing
```

### Пока не определено

* сколько retry допустимо;
* когда run считается failed;
* может ли часть документов быть skipped.

### Нужна explicit policy

Пример:

```text
attempts < MAX
→ retryable failed

attempts >= MAX
→ run failed
```

или manual retry policy.

### Приоритет

```text
P1
```

\---

## E3 — `OR-1`

### Zero documents

Если:

```text
documents\\\\\\\\\\\\\\\_total = 0
```

Worker не запускается.

Текущий readiness требует:

```text
documents\\\\\\\\\\\\\\\_total > 0
```

Run потенциально остаётся:

```text
processing
```

### Нужно решить семантику

```text
0 documents
→ failed?
→ completed with no docs?
→ continue using TenderMeta only?
```

На MVP решение должно быть явным.

### Приоритет

```text
P2
```

\---

# 10\. GROUP F — Error observability

## F1 — `EW-1`

### Проблема

Error Workflow:

```sql
UPDATE ...
WHERE n8n\\\\\\\\\\\\\\\_execution\\\\\\\\\\\\\\\_id = ...
AND status='processing'
```

может вернуть 0 rows.

Но handler не проверяет, что document реально найден.

### Желаемое

```text
updated row count = 0
→ explicit diagnostic failure / alert
```

### Приоритет

```text
P1
```

\---

## F2 — `EW-2`

Ошибка до successful claim:

```text
execution.id есть
document.n8n\\\\\\\\\\\\\\\_execution\\\\\\\\\\\\\\\_id ещё нет
```

Поэтому Error Workflow не может найти document.

### Возможные решения

* передавать `document\\\\\\\\\\\\\\\_id` в execution context/log;
* более ранняя correlation запись;
* separate error log independent of document update.

### Приоритет

```text
P1
```

\---

## F3 — `EW-4`

Сейчас сохраняется только:

```text
error\\\\\\\\\\\\\\\_message
```

Но Error Trigger знает:

```text
lastNodeExecuted
stack
execution.url
lineNumber
parentExecutionId
```

### Future

Отдельная:

```text
tender\\\\\\\\\\\\\\\_analysis\\\\\\\\\\\\\\\_errors
```

или structured JSON error log.

### Приоритет

```text
P2
```

\---

## F4 — `EW-5`

Нет alert:

```text
Telegram
email
Slack
```

### Для production

Нужен alert как минимум для:

```text
terminal run failure
exhausted retries
handler failure
```

### Приоритет

```text
P2
```

\---

# 11\. GROUP G — Semantic source duplication

## G1 — `AG-5 / TR-8`

Field semantics сейчас распределены по:

```text
Extractor FIELD\\\\\\\\\\\\\\\_CATALOG
Aggregator Round 1 FIELD\\\\\\\\\\\\\\\_RULES
TenderMeta Resolver
Targeted Recheck RECHECK\\\\\\\\\\\\\\\_PROFILES
Round 2 FIELD\\\\\\\\\\\\\\\_RULES
```

### Риск

Один field можно исправить в одном месте и забыть другое.

### Сейчас источник истины

```text
FIELD\\\\\\\\\\\\\\\_CATALOG.md
```

### Future architecture

Один runtime versioned catalog:

```javascript
FIELD\\\\\\\\\\\\\\\_CATALOG = {
  field\\\\\\\\\\\\\\\_key: {
    definition,
    extractor\\\\\\\\\\\\\\\_rules,
    round1\\\\\\\\\\\\\\\_rules,
    metadata\\\\\\\\\\\\\\\_mapping,
    recheck\\\\\\\\\\\\\\\_profile,
    round2\\\\\\\\\\\\\\\_rules
  }
}
```

### Не делать прямо сейчас

Это refactor, а не MVP blocker.

Сначала:

```text
TR-2
и critical correctness
```

### Приоритет

```text
P2
```

\---

# 12\. GROUP H — Duplicate FINAL persistence

## H1 — `AG-2 / TR-5`

Сейчас несколько веток имеют копии:

```text
Normalize FINAL
→ Save FINAL
```

### Риск

При изменении contract можно обновить одну копию и забыть другую.

### Future

Sub-workflow:

```text
TENDER - Persist Final Field
```

который делает:

```text
Normalize
→ validate
→ UPSERT
→ optional 27/27 readiness
```

### Важное ограничение

Не пытаться решать это обычным Merge conditional branches.

### Приоритет

```text
P2
```

\---

# 13\. GROUP I — Data model integrity

## I1 — `DM-0`

`field\\\\\\\\\\\\\\\_results.analysis\\\\\\\\\\\\\\\_run\\\\\\\\\\\\\\\_id` логически относится к:

```text
runs.id
```

но физический FK отсутствует.

### Риск

Orphan FINAL results.

### Future migration

```sql
FOREIGN KEY (analysis\\\\\\\\\\\\\\\_run\\\\\\\\\\\\\\\_id)
REFERENCES tender\\\\\\\\\\\\\\\_analysis\\\\\\\\\\\\\\\_runs(id)
ON DELETE CASCADE
```

### Приоритет

```text
P2
```

\---

## I2 — `DM-1`

Дублирующий unique index:

```text
PK (analysis\\\\\\\\\\\\\\\_run\\\\\\\\\\\\\\\_id, field\\\\\\\\\\\\\\\_key)
```

и отдельный:

```text
UNIQUE INDEX (analysis\\\\\\\\\\\\\\\_run\\\\\\\\\\\\\\\_id, field\\\\\\\\\\\\\\\_key)
```

### Результат

Лишняя стоимость INSERT/UPDATE.

### Приоритет

```text
P3
```

\---

## I3 — `DM-2`

Facts имеют DB CHECK на 27 field\_key.

Field results — нет.

### Риск

DB может принять typo field\_key при валидном field\_index.

### Future

* CHECK;
* или отдельная catalog table.

### Приоритет

```text
P3
```

\---

# 14\. GROUP J — Infrastructure / security

## J1 — `DW-2`

Proxy credentials находятся непосредственно в HTTP node configuration.

### Future

```text
Credentials
или
environment secrets
```

### Приоритет

```text
P2
```

\---

## J2 — `OR-5`

Orchestrator не имеет Error Workflow.

### Риск

TenderPlan / DB error остаётся только на execution-level.

### Future

Подключить central handler после определения run-level error policy.

### Приоритет

```text
P2
```

\---

## J3 — `OR-6`

TenderPlan FullInfo не имеет explicit retry/backoff.

### Важно

Retry должен происходить:

```text
до создания analysis\\\\\\\\\\\\\\\_run
```

чтобы transient HTTP failure не создавал лишние runs.

### Приоритет

```text
P2
```

\---

# 15\. Known non-blocking limitations

Эти пункты не должны отвлекать от MVP.

\---

## `OR-2` — manual trigger

Текущий hardcoded input допустим для разработки.

\---

## `OR-3` — raw TenderPlan snapshot не хранится

Полезно для audit, но не блокирует анализ.

\---

## `DW-10` — approximate token count

```text
chars / 3
```

достаточно безопасен при текущем budget 3200.

\---

## `DW-11` — visual content

Изображения пока не анализируются напрямую.

Это capability expansion, не текущий blocker.

\---

## `DW-12` — provider-side JSON Schema

Application-side validators уже существуют.

\---

## `TR-9` — keyword retrieval

Для MVP приемлемо, если retrieval regression проходит.

\---

# 15. MVP milestone — Semantic Aggregator E2E validation

## Completed

2026-08-23 выполнен полный E2E прогон:

```text
Tender
 ↓
Document Worker
 ↓
AI Extractor
 ↓
Evidence Validator
 ↓
AI Validator
 ↓
tender_analysis_facts
 ↓
Semantic Aggregator
 ↓
tender_analysis_field_results


# 16\. Что исправлять до первого стабильного end-to-end MVP

TR-0…TR-3 уже закрыты и не являются текущими открытыми пунктами. Полный per-field Round 2 regression остаётся отдельной quality-задачей.

Минимальный текущий обязательный пакет:

```text
DW-14 / EW-3
DW-15
DW-8
DW-3

OR-0

AG-0
```

После этого система уже должна значительно надёжнее проходить:

```text
tender\\\\\\\\\\\\\\\_id
→ 27 FINAL
→ completed
```

\---

# 17\. Рекомендуемый порядок реализации

## Этап 1 — Targeted Recheck correctness (completed)

```text
1. TR-0 ✅
2. TR-1 ✅
3. TR-2 ✅ (MVP)
4. TR-3 ✅
```

TR-0…TR-3 закрыты. Aggregator уже зависит от этого стабильного Targeted Recheck для значительной части 27 полей; полный per-field Round 2 regression остаётся quality work.

\---

## Этап 2 — закрыть silent Worker failures

```text
5. DW-14 / EW-3
6. DW-3
```

Цель:

> ни одна ошибка после claim не должна оставлять document в `processing` молча.

\---

## Этап 3 — semantic safety Worker

```text
7. DW-15
```

Добавить deterministic protection против known absence-as-fact класса.

\---

## Этап 4 — retry correctness

```text
8. DW-8
```

После этого:

```text
failed → retry
```

становится существенно безопаснее.

\---

## Этап 5 — unsupported documents

```text
9. OR-0
```

Одновременно определить:

```text
skipped vs failed
```

и обновить readiness semantics, если используется skipped.

\---

## Этап 6 — завершение run (закрыт для MVP)

```text
10. AG-0 ✅ verified 23.08.2026
```

Реализованный путь:

```text
FINAL UPSERT
→ 27/27
→ completed
→ Report Generation V2 HTML artifact
```

\---

## Этап 7 — Report extensions

```text
✅ Load immutable Report Snapshot → Report Model → HTML artifact
future: PDF
future: DOCX
future: XLSX
future: manual upload / automatic delivery
```

HTML report path реализован. Завершение полного delivery-MVP зависит от отдельных будущих интеграций.

\---

# 18\. Что НЕ делать до завершения MVP

Не тратить время сейчас на:

```text
единый runtime field catalog refactor
frontend
Bitrix integration
perfect retry framework
full monitoring stack
real tokenizer
image AI analysis
source snapshots
идеальный refactor всех duplicate nodes
```

Если конкретная проблема не блокирует:

```text
27 FINAL + report
```

она должна ждать.

\---

# 19\. Definition of Done для P0 issue

Любой Critical считается закрытым только если выполнены все три пункта:

```text
1. Код/SQL исправлен.
2. Есть regression scenario.
3. Документация обновлена.
```

Просто изменение Code Node без теста не считается закрытием.

\---

# 20\. Regression policy

Для каждого fix использовать короткий сценарий.

Пример:

```text
TR-0

Input:
existing candidate
retrieval\\\\\\\\\\\\\\\_context = none

Expected:
requires\\\\\\\\\\\\\\\_review
NOT not\\\\\\\\\\\\\\\_found
NO guard crash
```

\---

# 21\. Изменение приоритета

Priority можно менять только если появился новый факт:

```text
реальный execution
новый failure mode
новая бизнес-семантика
integration test
```

Не по ощущению.

\---

# 22\. Текущий критический путь MVP

```text
Targeted Recheck correctness
        ↓
Worker cannot silently stick
        ↓
Worker semantic false-positive guard
        ↓
Retry-safe units
        ↓
Unsupported document terminal state
        ↓
AG-0 ✅ reachable claim + 27/27 DB barrier
        ↓
Report implementation
```

\---

# 23\. Dependency graph

```text
TR-0
TR-1
TR-2
TR-3
  |
  v
Targeted Recheck stable
  |
  +-------------------------+
  |                         |
  v                         v
DW-14 / DW-3             DW-15
  |                         |
  v                         v
document failures       semantic safety
don't silently stick
  |
  v
DW-8
retry-safe units
  |
  v
OR-0
all registered docs reach terminal state
   |
   v
AG-0 ✅
27/27 completion + run completed
  |
  v
Report Generation V2 HTML artifact
  |
  v
future: PDF / DOCX / XLSX / delivery
```

\---

# 24\. Quick Backlog

## Critical

```text
\\\\\\\\\\\\\\\[x] TR-0 — resolved
\\\\\\\\\\\\\\\[x] TR-1 — resolved
\\\\\\\\\\\\\\\[x] TR-2 — resolved (MVP; per-field regression pending)
\\\\\\\\\\\\\\\[x] TR-3 — resolved
\\\\\\\\\\\\\\\[ ] DW-14 / EW-3
\\\\\\\\\\\\\\\[ ] DW-15
\\\\\\\\\\\\\\\[ ] DW-3
\\\\\\\\\\\\\\\[ ] DW-8
\\\\\\\\\\\\\\\[ ] OR-0
\\\\\\\\\\\\\\\[x] AG-0 — verified 23.08.2026; report implementation remains
```

Дополнительные Critical gates: `AG-8 — procurement_subject current-scope false-resolved` mitigated/verified в test, но остаётся открытым до production promotion и fresh full run; `AG-9 — application_documents` остаётся P0 до Targeted Recheck terminal verification, production promotion и full run.

## High

```text
\\\\\\\\\\\\\\\[ ] DW-4
\\\\\\\\\\\\\\\[ ] DW-16
\\\\\\\\\\\\\\\[ ] EW-0
\\\\\\\\\\\\\\\[ ] EW-1
\\\\\\\\\\\\\\\[ ] EW-2
\\\\\\\\\\\\\\\[ ] AG-1
\\\\\\\\\\\\\\\[ ] TR-6
```

## Medium

```text
\\\\\\\\\\\\\\\[ ] OR-1
\\\\\\\\\\\\\\\[ ] OR-4
\\\\\\\\\\\\\\\[ ] OR-5
\\\\\\\\\\\\\\\[ ] OR-6
\\\\\\\\\\\\\\\[ ] DW-2
\\\\\\\\\\\\\\\[ ] DW-11
\\\\\\\\\\\\\\\[ ] AG-2 / TR-5
\\\\\\\\\\\\\\\[ ] AG-3
\\\\\\\\\\\\\\\[ ] AG-4
\\\\\\\\\\\\\\\[ ] AG-5 / TR-8
\\\\\\\\\\\\\\\[ ] TR-7
\\\\\\\\\\\\\\\[ ] DM-0
\\\\\\\\\\\\\\\[ ] EW-4
\\\\\\\\\\\\\\\[ ] EW-5
```

## Low

```text
\\\\\\\\\\\\\\\[ ] OR-2
\\\\\\\\\\\\\\\[ ] OR-3
\\\\\\\\\\\\\\\[ ] OR-7
\\\\\\\\\\\\\\\[ ] DW-0
\\\\\\\\\\\\\\\[ ] DW-1
\\\\\\\\\\\\\\\[ ] DW-5
\\\\\\\\\\\\\\\[ ] DW-6
\\\\\\\\\\\\\\\[ ] DW-9
\\\\\\\\\\\\\\\[ ] DW-12
\\\\\\\\\\\\\\\[ ] DW-13
\\\\\\\\\\\\\\\[ ] AG-6
\\\\\\\\\\\\\\\[ ] TR-9
\\\\\\\\\\\\\\\[ ] DM-1
\\\\\\\\\\\\\\\[ ] DM-2
\\\\\\\\\\\\\\\[ ] DM-3
\\\\\\\\\\\\\\\[ ] DM-4
\\\\\\\\\\\\\\\[ ] EW-6
```

\---

# 25\. Краткое резюме

Главная проблема проекта сейчас не в отсутствии ещё одного AI-слоя.

Основной долг находится в:

```text
1. test workflow promotion / wiring clean Document Worker candidate, включая runtime canary;
2. отдельный AG-8 production promotion gate;
3. fresh full run;
4. manual semantic review 27/27;
5. client report.
```

После закрытия этих пунктов архитектура уже достаточно зрелая, чтобы закончить MVP без большого redesign.

Главный финальный milestone:

```text
tender\\\\\\\\\\\\\\\_id
→ all documents terminal
→ 27 FINAL fields
→ run completed
→ Markdown
→ XLSX
→ Telegram
```
