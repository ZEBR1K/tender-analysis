# TENDER — Обработать документ

**Статус:** Active development / MVP  
**Последнее обновление:** 2026-09-05
**Тип:** child workflow / Document Worker  
**Точное имя workflow:** `TENDER — Обработать документ`  
**Workflow ID:** `1Pw61ZY3HgBSvcUr`  
**Вызывается:** `ТЕНДЕРЫ ОРКЕСТРАТОР`  
**Вызывает:** `TENDER — Агрегация закупки` — только когда текущий Worker атомарно переводит run в `ready_for_aggregation`  
**Error Workflow:** `TENDER — Ошибка обработки документа`  
**PostgreSQL credential:** `KITATEH Tenders`  
**Docling:** IBM Docling async API  
**AI transport:** Polza AI (`https://polza.ai/api/v1/chat/completions`)
**AI Extractor:** `deepseek/deepseek-v4-pro-0813@reasoning_effort=none`
**AI Validator:** `deepseek/deepseek-v4-pro-0813@reasoning_effort=low`

> Production metadata выше относится к неизменённому live workflow `1Pw61ZY3HgBSvcUr`. Test/calibration workflow `2T7szFpiGcfNpKkB` сохранён локально как immutable beta snapshot `workflows/n8n-exports/beta/[3 TEST] TENDER — Обработать документ.json`. Canonical path содержит clean inactive offline production candidate с именем `TENDER — Обработать документ`, без top-level instance identity и test state. Candidate ещё не promoted/wired и не прошёл runtime canary; точная граница зафиксирована в `PROJECT_STATUS.md`.

Beta snapshot и clean candidate используют GLM 5.3 Flash с `reasoning_effort=low` для primary Extractor и Gemini 3.7 Flash с `reasoning_effort=low` для Validator. Canonical local candidate дополнительно использует Gemini 3.7 Flash low как максимум один Extractor fallback после typed primary contract failure. Он содержит bounded evidence repair, lossless fact partition, document-level Validator dispatch, field-specific profiles и fact-local literal guard. Extractor выбран как provisional baseline после model benchmark на одинаковых 16 pinned units; сводный отчёт находится в `evaluations/EXTRACTOR_MODEL_COMPARISON_2026-08-29.md`. Offline packaging/completeness tests GREEN; выбор модели и offline tests не доказывают full runtime behavior.

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
      → AI Extractor v1.0 (primary GLM, multi-item batch 16 / interval 1000 ms)
      → explicit primary attempt envelope
      → shared strict Extractor validator
      → Обработать evidence units по одной (batchSize=1)
            ├─ accepted → primary attempt audit
            └─ typed fallback_required → AI Extractor fallback v1.0 (Gemini, max 1)
               → explicit fallback attempt envelope
               → тот же strict Extractor validator
               → fallback attempt audit
         → существующие evidence repair / fact partition tails
      → done-only Extractor recovery completeness barrier
      → Собрать units после evidence validation
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

## 9A. DOCX ActiveX option-state boundary (`DW-18`)

Для DOCX между file-type route и существующим Docling route добавлена параллельная deterministic ветка. Исходный `binary.data` не переименовывается и не изменяется: `Подготовить DOCX archive alias` создаёт отдельный binary alias с `.zip` descriptor только для native `Compression / Decompress`. PDF и XLSX обходят эту ветку с прежним JSON/binary contract.

OOXML извлекается native `Compression`, XML parts структурно разбираются native `XML` node. Code nodes выполняют только:

```text
OPC relationship joining
→ bounded CFB directory/FAT/miniFAT traversal
→ MS-OFORMS Value decoding
→ fail-closed audit records
```

`Value = 1` означает `selected`, `Value = 0` — `unselected`; иное значение остаётся `indeterminate`. Отсутствующие, malformed, unsupported или неоднозначные structures дают `unknown`/`indeterminate` с audit warning, а не synthetic negative. `contents` принимается только среди stream entries, достижимых bounded traversal от `Root Entry.child`; orphan/stale stream не authoritative.

Resource gates ограничивают число extracted parts, суммарный размер нужных parts, допустимые CFB sector sizes/indexes, FAT/miniFAT/directory-tree chain length, cycles и размер `contents`. Compression descriptor поддерживается в обеих наблюдаемых формах: полный OPC path в `fileName` и split `directory + fileName`. До нормализации обе формы fail-closed отклоняют absolute/UNC, drive/URI prefixes и `.`/`..` segments; затем проходят единый OPC normalization/traversal guard. Source state с подписью строится через OOXML relationships и exact direct row/cell structure. Вложенные `w:tbl` не считаются содержимым ancestor cell, поэтому один control не дублируется на внешней строке.

Semantic owner после Docling определяется отдельно и структурно: controls группируются по строгому `word/document.xml#table[n]/row[m]`; один normalized table должен содержать всю группу с единым relative row offset. Это сохраняет relative row geometry при wrapper/nested shifts и не приравнивает OOXML table ordinal к Docling ordinal. Label validation локальная и точная; Unicode whitespace normalizes только matching key, не canonical block text и не evidence quote. Missing coordinate, conflicting stable control identity, duplicate source row, ноль или несколько `table + offset` matches дают fail-closed mapping issue. Byte offsets, control names, ActiveX part numbers, fixed block/table IDs, fixture labels и tender-specific literals не используются как production mapping rules.

После нормализации canonical block text остаётся неизменным. State/provenance передаются отдельно в source/semantic blocks и AI-visible marker; evidence validators принимают quotes только из canonical text. Полный document-level mapping audit и scalar `docx_option_state_semantic_status` сохраняются без изменений, но больше не служат applicability veto для независимо доказанной локальной группы.

Normalizer добавляет к каждому block versioned container `docx_option_state_semantic_v2`. Persisted/public stable control identity определяется только парой canonical `document_part + control_rel_target` и кодируется collision-safe строкой `'v2i:' + JSON.stringify([document_part, control_rel_target])`; несовпадающие observed snapshots одной identity дают `conflict`. Public group identity кодируется как `'v2g:' + JSON.stringify([block_id, source_table_ref, control_type, discriminator])`. Эти identity JSONB-safe и не содержат literal U+0000; downstream вычисляет то же encoding без decoder. Миграция старых persisted identities не предусмотрена, поскольку старого persisted контракта нет. Structural group включает unique semantic owner, exact source table, control type и exact trimmed `GroupName`; checkbox без GroupName является singleton, option button без GroupName остаётся unresolved. Radio group требует ровно один `selected`; zero selected даёт `unknown`, multiple selected — `conflict`, а caller-supplied all-cleared flag не учитывается. Distinct GroupName в одной таблице остаются разными группами.

V2 container сохраняется через semantic blocks, AI segments и persisted analysis unit/provenance. Для byte-stable shared evidence validator соответствующий group verdict также вложен в semantic-layer копию control record и доходит через существующий evidence context до `Подготовить dispatch AI Validator`. Для `national_regime` и `participation_guarantee` каждый option-bearing evidence item должен по exact canonical label/control identity разрешиться ровно в одну локальную группу. `selected` в `resolved` group остаётся applicable даже при постороннем document-wide `unknown`; `unselected` становится audited rejected fact с `unselected_option_not_applicable`; target group `unknown`/`conflict`, zero/multiple group match и mixed resolved/unresolved evidence дают `requires_review`. AI Validator не может повысить review-only или вернуть rejected unselected alternative. Issues другой группы остаются в document audit и не отравляют resolved group.

Raw `docx_option_state_v1`, canonical text, document-wide warnings, rejected alternatives и bounded issue references сохраняются для audit. Binary decoder этим изменением не менялся. Offline TDD подтверждает только local candidate behavior; production n8n/runtime этим checkpoint не изменялись и runtime verification не заявлена.

Offline source-derived nested-table fixture подтверждает cleared controls 5/6/7/56 и selected controls 8 (`Не применимо`) / 55 (`Не предусмотрены`). Executions `14350–14352` подтвердили native Compression descriptor shape, потерю metadata после Extract From File/XML и ancestor-table ambiguity прежнего mapper. Stage 1 semantic-binding commits: RED `4f6f23f`, GREEN `a5a1cb7`, Critical RED `e7e1987`, Critical GREEN `3643b29`, fixture correction `e8db92b`. Focused suite проходит `69/69`; full suite — `347 total / 341 pass / 6` exact pre-existing failures.

Exact read-only replay полного execution `14359` input связал activeX5/6/7/8 только с `#/tables/2` и activeX55/56 только с `#/tables/25`, сохранив состояния `0/0/0/1` и `1/0`. Общий `docx_option_state_semantic_status` при этом остаётся `unknown`: `33` warning groups, semantic owners `83/290`. В local candidate этот global audit status больше не понижает независимо resolved target group; affected target group всё ещё fail-closed остаётся `requires_review`. Execution `14425` затем подтвердил полный изолированный runtime-контур: `0` literal U+0000 в `12` persistable units, PostgreSQL persistence `12/12`, exact selected labels в model-visible evidence и persisted `confirmed` facts для `national_regime = «Не применимо»` и `participation_guarantee = «Не предусмотрены»`. Aggregator был disabled и реально не вызывался; production runtime этим тестом не изменялся.

Promotion follow-up: checked-in semantic replay сокращён до `6` controls и `4` meaningful tables, хотя fixture хранит observed source counts (`290` controls, `64` raw tables, `6` raw body children, `647` normalized blocks, `528` semantic blocks). Изолированный post-fix Worker runtime gate закрыт execution `14425`; Aggregator/27 FINAL и production promotion остаются отдельными непроверенными gates. Перед promotion по-прежнему нужен reproducible sanitized full-payload replay либо точное переименование сокращённого fixture/replay contract.

---

## 9B. AI Extractor envelope and bounded fallback boundary (`DW-19`)

Execution `14359` дал `16/16` transport-success responses, но `0/16` были безопасно attachable: каждый model payload нарушал exact `field_catalog_version`; missing `schema_version`/`analysis_unit_id` не разрешает attachment без exact catalog/root, unique explicit source identity и полного strict facts/evidence validation. Exact request/system prompt и workflow version совпали с canonical/known-good contract, поэтому это model noncompliance, а не prompt/version drift.

Analysis units сохраняются до AI как и раньше. Primary GLM запускается до `Loop Over Items` как multi-item node run с `options.batching.batch.batchSize=16`, `options.batching.batch.batchInterval=1000` и timeout `180000`; HTTP transport errors hard-stop, `retryOnFail=false`, error outputs отсутствуют. Regular-success wrapper немедленно формирует explicit `ai_extractor_attempt_transport_v1` с source, attempt и provider response; он разрешает source через paired-item lineage, а strict classifier не восстанавливает source через error-output item linking. Локальный harness доказывает wrapper mapping на непозиционной перестановке 16 `pairedItem`; isolated execution `14367` подтвердил installed-runtime propagation `pairedItem=0..11` для ordered 12-item batch. Только уже проверенные primary decisions поступают в `Loop Over Items` с `batchSize=1`.

Execution `14365` зафиксировал несовместимость прежнего flat shape: установленный HTTP Request `4.4` hard-stop-нулся на `Cannot read properties of undefined (reading 'batchInterval')`. Live type definition описывает nested `options.batching.batch`, поэтому прежние canonical JSON/documentation/test (`options.batching.batchSize/batchInterval`) противоречили platform source of truth. Nested shape исправлен локально execution-derived TDD; значения `16/1000`, timeout, модель/provider, credentials, retry/onError, connections, paired-item wrapper, Loop и completion barrier не менялись. На checkpoint `14365` это был local GREEN без runtime-подтверждения; последующее execution `14367` описано отдельно ниже.

Execution `14367` закрыл только bounded batch-first runtime gate на disposable inactive/unpublished clone: primary `1` run / `12` outputs / `4339 ms`, exact IDs/order и paired lineage, Loop `12 + done`, один fallback для injected `invalid_field_catalog_version`, barrier `12/12`, summary paid calls `13 <= 25`; forbidden downstream runs `0`. Persistence-facing metrics не materialized из-за deliberate collector isolation. Clone с пятью canary nodes не является production candidate; canonical `2ffe1de` ещё не импортирован как clean inactive candidate. Следующий gate — отдельный reviewed packaging/import, затем отдельное разрешение на full-path Validator/persistence test.

Primary classifier использует shared `ai_extractor_strict_validator_v3` и выдаёт только:

```text
accepted
fallback_required:
  invalid_json
  invalid_root_contract
  conflicting_analysis_unit_id
  invalid_field_catalog_version
  invalid_schema_version
  invalid_fact_contract
  invalid_evidence_contract
```

Unknown decision/code, internal/programmer error, malformed source/envelope и transport failure hard-stop. Safe attachment отсутствующего schema/identity сохраняет `ai_extractor_envelope_attachment_v1`, но не меняет facts/evidence/status/value/confidence, order или cardinality и не обходит downstream guards.

Только `fallback_required` вызывает один `AI Extractor fallback v1.0` с Gemini 3.7 Flash low, теми же original system/user prompts, response contract и credential family. Fallback снова проходит byte-identical shared validator; invalid fallback hard-stops document. `recovery_context` содержит только version, unit ID, две model aliases, primary failure class/code и next attempt. Он переносится через текущий input, валидируется вне semantic model payload и удаляется при materialization final audit.

Final `ai_extractor_attempt_audit_v1` bounded полями:

```text
version
analysis_unit_id
primary_model
fallback_model
primary_failure_class
primary_failure_code
attempt_count (1..2)
final_source (primary|fallback)
```

Audit не является evidence. После каждого successful evidence tail ровно один item возвращается в Loop; Loop output 0 — единственный input completeness barrier. Barrier проверяет исходную cardinality, unique IDs, deterministic order и audit до существующего collector, AI Validator dispatch и persistence. Partial batch не проходит дальше; Merge отсутствует. `extractor_requests` остаётся совместимым unit-level счётчиком primary запросов, `extractor_fallback_requests` отдельно считает fallback, а `total_ai_requests_before_ai_validator` суммирует primary + fallback + evidence repair + fact partition. Primary transport не сериализован Loop; сериализованы только per-unit convergence и bounded fallback/evidence retry routes.

TDD chain исходного recovery contour: `dff07a9` → `507e12e` → `581ed5c` → `e690528` → `78935b8` → `58556f6`. Локальный batch-first latency checkpoint добавил regression coverage для topology, HTTP batching, paired lineage, bounded fallback, completion barrier, hard-stop и request metrics; production JSON, prompts, models, credentials и semantic guards вне этой границы не менялись. На том local checkpoint production n8n/DB/credentials не изменялись и paid AI не запускался. Последующий execution `14367` закрыл bounded batch-first runtime gate на disposable clone; full-path Validator/persistence и persistence-facing metrics остаются pending.

Неблокирующий audit debt: pre-existing `extractor.provider` остаётся legacy `deepseek` даже для GLM/Gemini. Authoritative actual aliases и выбранный source находятся в `extractor.attempt_audit.primary_model`, `fallback_model`, `final_source`. Legacy field не исправлялся в этом checkpoint, чтобы не расширять downstream audit contract.

---

## 9C. Extractor recovery barrier — execution 14373 local repair

Execution `14373` прошёл `DW-17` Evidence Repair для всех `12` analysis units и остановился в `Проверить полноту Extractor recovery` с первым incorrect state:

```text
[Extractor recovery barrier] Expected item 0 missing analysis_unit_id.
```

`Сохранить analysis unit` фактически возвращает persisted identity как top-level `item.json.analysis_unit_id`; прежний barrier ошибочно ожидал `item.json.analysis_unit_meta.analysis_unit_id`. Recovered units сохраняют прежний downstream контракт `analysis_unit_meta.analysis_unit_id`, exact source order и bounded `ai_extractor_attempt_audit_v1`.

Canonical local repair меняет только expected-ID access в barrier:

```text
item.json.analysis_unit_meta.analysis_unit_id
→ item.json.analysis_unit_id
```

Все fail-closed проверки output cardinality, duplicate/unknown identity, order, `analysis_batch.units_total` и bounded audit сохранены. Sanitized execution-derived fixture покрывает `doc_3_au_0001…doc_3_au_0012`; focused Extractor recovery/envelope/evidence-repair suites проходят `132/132`. File-isolated Document Worker suite: `10 files / 8 pass / 2` unchanged baseline failures; full repository suite: `23 files / 19 pass / 4` exact baseline failures против base `22 / 18 / 4`.

Это local-only GREEN. Canonical candidate не импортирован и не выполнялся; runtime recheck полного `DW-17 → recovery barrier → Validator → persistence` остаётся pending. Production n8n/PostgreSQL/credentials не читались и не изменялись.

---

## 9D. Exact grounding versus semantic applicability — executions 14374 / 14376

Read-only audit of the inactive/unpublished 71-node test workflow `8dEt6A8IwTybFuIq` observed current draft `62041fec-78c3-493a-9d2e-df648b51d1c9`; the Aggregator call was disabled. Existing executions `14374` and `14376` completed `12/12` Extractor recovery, `9/9` Validator dispatch, fact persistence, document completion and transition to `ready_for_aggregation`. No Aggregator child was created. This is bounded runtime evidence through readiness for the observed executions; it does not close the canonical candidate promotion/runtime gate because an immutable executed version was not exposed, and it does not prove production promotion, Aggregator, 27/27 FINAL, report or delivery.

The audit separates two different guarantees:

```text
exact grounding
= materialized evidence is an exact canonical source fragment

semantic applicability
= that fragment supports this field/value under the resolved option owner,
  selection state, scope, modality and mutually exclusive alternatives
```

Reference-only repair passed exact grounding in both runs. Semantic applicability failed for `doc_3_au_0012#0 / advance_contract_guarantee`: the evidence was exact, but option ownership remained unresolved and mutually exclusive alternatives could not establish which clause applied. The fact still received an unsafe confirmed verdict.

Observed DOCX metrics were identical in both runs:

```text
647 normalized blocks
528 semantic blocks
290 controls
126 structurally resolved
33 semantic-mapping warnings
  29 missing owner
   4 conflicting coordinates
semantic status = unknown
```

Cross-run instability was also material: `46 → 42` facts, `179 → 171` evidence, loss of `analog_allowed` in `14376`, a changed `application_documents` fact/verdict qualification distribution, and `delivery_term` changing from `requires_review` to `rejected`. The aggregate audit does not establish the cause of the `application_documents` change. Exact grounding must remain strict; it is necessary but insufficient for a final semantic verdict.

Current unresolved gate is `DW-21`: add an execution-derived deterministic review cap for option-derived facts with unresolved owner or conflicting mutually exclusive coordinates. Preserve candidate/evidence/provenance and audit, route unsafe confirmation to `requires_review`, and prove neutral non-option/fully-resolved controls are unchanged. Detailed sanitized audit: `evaluations/DOCUMENT_WORKER_SEMANTIC_AUDIT_14374_14376_2026-09-03.md`.

---

## 9E. Evidence Repair catalog overflow — execution 14487 local repair

Execution `14487` stopped in `Подготовить Evidence Repair` at structural candidate
`257` for unit `doc_7_au_0022`: the oversized table target `sb_0714` appeared in
two-segment provenance and the invalid fact carried `missing_primary_evidence` plus
`quote_not_found`. No repair AI call, attempt-2 validation, or fact persistence ran.
The checked-in regression is an explicitly labelled deterministic sanitized
derivative; it contains no raw client text or production identifiers beyond the
execution/unit/block coordinates needed to reproduce the geometry.

Canonical local jsCode preserves byte-compatible full-catalog behavior for
`<=256`. Independent sanitized inspection showed the real unit has `44,375`
canonical characters, `2,016` structural candidates, `2,015` candidates in
primary target `sb_0714`, and no structural candidate exactly equal to the
normalized 256-character value or 216-character invalid quote. This proves
that exact whole-candidate equality is unavailable as a retrieval prerequisite;
the available runtime projection did not establish actual lexical-overlap
scores or ranked candidate ordinals.

Only on overflow the builder scans at most `4096` exact structural candidates
and, only for exactly one invalid fact / one repaired-fact context, derives target
block IDs from that fact and its violation details. Multi-fact overflow hard-fails
before ranking with an explicit audited error: the current merged catalog has no
fact-local relevance contract and could expose primary material relevant to one
fact as selectable for another. A future multi-fact path requires a fact-local
catalog contract. Bounded normalized material (`3000` chars, `64` anchor tokens)
is used for deterministic token-overlap ranking inside those known targets;
empty/short/stop and high-frequency (`>64` candidates) tokens are ignored.
Candidate tokenization, scoring work, target blocks, ranked anchors (`8`) and
fixed `±2` neighbours are all bounded. Ties resolve by original source order.
Original block-local ordinals remain in refs (`er2:<block>:<original ordinal>`).

This lexical score is retrieval-only, never evidence acceptance. Every outgoing
catalog quote is still an exact canonical source candidate; AI can select refs
only; attempt 2 materializes those exact strings and runs the unchanged strict
validator. For `missing_primary_evidence`, selected target candidates with
`scope=primary` satisfy retrieval coverage; otherwise a deterministically
relevant primary candidate is required. Zero useful overlap, generic/ambiguous
anchors, absent targets, missing primary coverage, scan/scoring/outbound budget
overflow, and attempt-2 catalog/selection parity mismatch fail closed.

The outgoing limits remain unchanged: `256` candidates, `250000` catalog chars,
`1500` chars per quote, and `360000` serialized request chars. Selection audit
records only bounds, counts, scores/refs, omissions, targets, primary coverage
and ordinal ranges—never raw anchor text. Materialization, exact grounding,
one-call topology, models, prompts by meaning, persistence, and downstream
workflows are unchanged.

The corrected sanitized derivative preserves the observed `2,016 / 2,015 / 44,375`
geometry and adds explicitly synthetic distributed late fragments to exercise
the bounded retrieval hypothesis. It first made the blocked implementation
RED with `Target-window exact material anchor missing for sb_0714`; the added
multi-fact overflow regression separately made the review-blocked implementation
RED with `Missing expected rejection`. Focused actual-jsCode tests now pass
`108/108`, including multi-fact overflow fail-closed before ranking, zero/ambiguous
overlap, target/primary guards, deterministic tie-break, attempt-2 tamper parity,
request size, old adversarial overflow, exact materialization, and mutation back
to whole-candidate equality. This is **offline-only**: real runtime token/window
coverage is not yet proven, and no workflow import/publication, production
execution, database write, or runtime GREEN is claimed.

---

## 9F. Selective AI Validator contract retry — execution 14491 local repair

Execution `14491` passed the DW-22 Evidence Repair contour and later stopped in
`Проверить ответ AI Validator`: unit `doc_7_au_0037` contained two facts, but the
response for fact `1 / licenses_certificates` omitted mandatory `confidence`.
Fact `0 / application_documents` was contract-valid. The strict checker behaved
correctly, but its unit-level hard stop prevented all document persistence and
completion.

Canonical local topology now separates classification from the existing final
strict checker, whose source intake is minimally adapted to the explicit
envelope:

```text
AI Validator v1 (primary, outside Loop)
→ classify every response fact against its exact source unit
→ no invalid facts: reassemble original unit responses
→ invalid facts: queue exact analysis_unit_id + fact_index + field_key
   → Loop Over Items, batchSize=1
   → attempt 2
   → accepted semantic verdict returns to Loop
   → contract-invalid response waits 1 second and runs attempt 3
   → accepted semantic verdict returns to Loop
   → exhausted contract failure becomes deterministic technical fallback
→ done-only reassembly of every original unit and fact
→ existing strict Проверить ответ AI Validator
```

Only the failed fact is present in each retry request, together with its exact
field profile. Valid siblings and unrelated units are preserved from the primary
response and never sent again. Retry eligibility is limited to transport and
response-contract failures; `confirmed`, `requires_review` and `rejected` are
terminal semantic verdicts and never trigger retry. The provider response cannot
supply or change source identity: classifiers use explicit paired source and
hard-fail missing/crossed identity, duplicate source facts, exact `field_key`
mismatch and programming invariants.

After three invalid attempts, fallback preserves the original `value_text` and
evidence and emits `requires_review`, `confidence=0`, `reason_code=other`, with
`confidence_origin=system_sentinel`, `reported_ai_confidence=null`,
`retry_exhausted=true`, attempt count, final failure code and all three attempt
outcomes in `validator_meta`. It never emits `not_found` and does not pretend the
sentinel is model confidence. The final strict checker remains outside the Loop,
validates complete cardinality/linking and carries the retry audit into persisted
fact metadata.

The first local implementation was rejected by independent review: its
assemblers produced many outputs from one aggregate/terminal stream while using
`pairedItem.item` values that did not exist on the immediate input, and a mixed
known-invalid plus unknown response identity could partially clear a unit. The
remediation makes an unattributable validation identity a unit-level contract
failure: every source fact in that unit is retried with
`unattributable_validation_identity`. Both reassembly paths now attach an
immutable top-level `validator_source_envelope` versioned
`ai_validator_source_envelope_v1`, containing the complete source and exact
`analysis_unit_id + ordered fact_index + field_key` identity list. The strict
checker reads only this envelope, hard-validates its keys/version/cardinality and
exact identities, and performs no positional lookup into `Развернуть units для
AI Validator`. Reassembly emits no invalid `pairedItem`; the checker retains only
its valid 1:1 link to the immediate provider item.

The sanitized execution-derived fixture is labelled `runtime_replay=false` and
preserves only the 22-unit identity/cardinality boundary and target/sibling
geometry. TDD first failed on the missing retry topology; current focused result
is `8/8 PASS`. Related Worker suite is `263 / 260 / 3` with only known baseline
fixture/hash/prompt-line-ending failures. Full repository suite is
`457 / 449 / 8`, all eight signatures pre-existing and outside DW-23. Structural
validation reports `85` unique nodes, `82` connection sources and `101` resolved
edges. This remains a local inactive export candidate: no n8n import/publish,
runtime canary, PostgreSQL write, schema/catalog change or production promotion
has occurred.

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

В test candidate validation является двухпопыточной и bounded:

```text
attempt 1
→ pure exact-grounded overlap_only: audited deterministic rejected
→ repairable evidence violation: Evidence Repair
→ pure resource overflow: Lossless Fact Partition
→ mixed/non-repairable violation: hard error
→ attempt 2
→ explicit pass or explicit Worker failure
```

Exact grounding не заменяется fuzzy matching. Одинаковая table-coordinate canonicalization используется в attempt 1, attempt 2, classifier и lossless partition checker.

Canonical local candidate использует внутренний reference-only contract `ai_evidence_repair_v2`. Нода `Подготовить Evidence Repair` валидирует source IDs/provenance/scope и детерминированно строит bounded allow-listed catalog `evidence_repair_catalog_v2`: stable `evidence_ref = er2:<semantic_block_id>:<fragment_ordinal>`, каждая structural line/sentence остаётся отдельным candidate, а offset split применяется только к единице длиннее `1500`. Одинаковый canonical text в разных blocks получает разные identity-safe refs и не смешивает scope/provenance. Hard bounds: `256` candidates, `250000` catalog+context characters, `100000` canonical-source characters и `360000` characters полного serialized HTTP request. Bounds проверяются инкрементально; overflow, duplicate block/ref collision, пустой/non-canonical source и несогласованный provenance fail closed без truncation и без provider call.

Repair model получает catalog, но возвращает только `selected_evidence_refs`; `quote`, `semantic_block_id`, scope и provenance в AI output запрещены schema/application checks. Поскольку `Object.freeze` не является границей между Code-node sandboxes, `Проверить evidence — попытка 2` тем же byte-identical builder заново строит catalog из source и exact-сравнивает order, refs, block identity, scope/type/role, quote, contexts и все counts/bounds до materialization. Затем нода exact-validates unit, cardinality, fact indexes и refs и материализует `{semantic_block_id, quote}` только из rebuilt catalog/source. Уже exact-grounded original evidence сохраняется byte-for-byte, attempt-1 invalid evidence исключается, а retained evidence и выбранные refs exact-dedupe-ятся в deterministic order. После merge выполняется неизменный `validateFacts(repairedFacts, source, 2)`; усиленный `repair_dropped_grounded_evidence` invariant также resync-ит `violations_by_code` и unresolved/resolved audit counts.

Primary Extractor, AI Validator, persistence, missing-primary/overlap semantics, один Repair call, terminal exhaustion route, model/credentials/HTTP parameters и graph topology не менялись. Этот contract подтверждён только локальными offline tests. Репозиторий и git history не содержат safe sanitized fixtures executions `14234`/`14238`, поэтому exact replay gate остаётся pending; fixture `14371` — только synthetic structural class (`runtime_replay=false`). Production promotion и runtime canary для `DW-17` также pending.

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

В production baseline у ноды `Проверить и привязать evidence` отсутствуют:

```text
onError
continueOnFail
```

В test candidate regular output сначала проходит через per-unit bounded retry classification. Невалидный attempt 2 приходит в `Завершить unit: evidence validation failed` и завершает Worker явной ошибкой.

Configuration-level silent bypass через `continueErrorOutput` не используется. При этом production promotion и workflow-level Error Workflow behavior остаются отдельными runtime gates; риск `DW-14 / EW-3` не считается закрытым автоматически.

---

## 24. Independent AI Validator

Production baseline `AI Validator v1` использует:

```text
deepseek-v4-pro
thinking = enabled
reasoning_effort = low
response_format = json_object
```

Test candidate использует:

```text
google/gemini-3.7-flash
reasoning_effort = low
response_format = json_object
max_tokens = 8192
timeout = 180000 ms
```

`VALIDATOR_FIELD_PROFILES` версии `validator_field_profiles_v1` покрывает ровно 27 canonical `field_key`. В prompt каждой unit передаются только реально используемые profiles в стабильном порядке; unit не делится на отдельные facts и остаётся одним HTTP item. Unknown `field_key` или missing profile дают hard error до HTTP.

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

В test candidate checker дополнительно применяет `fact_local_material_literals_v1` только к исходному `AI verdict=confirmed`:

- проценты, даты, суммы, сроки и контекстные идентификаторы проверяются только по `evidence[]` этого fact;
- соседние facts и общий `evidence_context` не могут закрыть missing literal;
- отсутствующий material literal понижает verdict только до `requires_review / insufficient_evidence`;
- guard не создаёт `rejected` и не меняет исходные `requires_review`/`rejected`;
- audit сохраняет original verdict и список missing literals.

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

Production baseline `Собрать факты документа` делает barrier. В test candidate перед AI Validator добавлен document-level dispatch:

```text
all validated units
→ units_for_ai: verified_facts.length > 0
→ units_without_ai: verified_facts.length === 0
→ one batch AI call for units_for_ai
→ exact unit-set reassembly
```

Это не per-unit Validator loop и не conditional Merge. Zero-fact units сохраняются для completeness, но не создают synthetic facts и не вызывают AI.

Финальный collector делает barrier:

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
| execution 14104: evidence convergence | ✅ 66/66 units |
| execution 14104: Validator dispatch | ✅ 20 AI + 46 without AI |
| execution 14104: facts persistence output | ✅ 61 facts |
| fact-local literal downgrade | ✅ exactly one verdict changed |
| pure overlap-only audit preservation | ✅ rejected, no silent drop |
| clean offline production import candidate | ✅ Worker 78/78, Validator 31/31 |
| candidate promotion/wiring and runtime canary | ❌ not executed |

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
