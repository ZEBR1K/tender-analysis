# Document Worker Lossless Fact Partition Implementation Plan

**Checkpoint status (2026-08-28):** implemented in inactive `[3 TEST]` Document Worker and covered by offline regressions; execution `14104` exercised the surrounding evidence/dispatch path. Not promoted to production. Current promotion gates and source-of-truth boundaries are recorded in `PROJECT_STATUS.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: use `executing-plans` and execute this plan task-by-task. Do not use subagents. Do not import or change live n8n without separate explicit authorization.

**Goal:** добавить в `TENDER — Обработать документ` один bounded lossless Fact Partition Retry для exact-grounded facts, которые превышают resource contract `25 evidence / 1500 chars per quote / 5000 total quote chars per fact`, не ослабляя evidence grounding и не изменяя downstream workflows или PostgreSQL schema.

**Architecture:** первая deterministic evidence validation должна отличать исправимые ошибки evidence от структурного `grounded_resource_overflow`. Существующий Evidence Repair остаётся evidence-only. Для чистого exact-grounded resource overflow отдельная AI-нода только распределяет неизменённые части исходного `value_text` и неизменённые evidence между несколькими replacement facts; application-side validator доказывает lossless partition, повторно выполняет exact grounding и только после этого возвращает unit в существующий convergence Loop.

**Tech Stack:** n8n workflow JSON, n8n Code/IF/Switch/HTTP Request/Loop Over Items nodes, JavaScript, Polza OpenAI-compatible endpoint с `response_format.type = json_object`, PostgreSQL JSONB `extractor_meta`, Node.js `node:test` offline regression harness.

---

## 1. Scope и запреты

### 1.1. Разрешённый implementation scope

Изменять при реализации только:

- `workflows/n8n-exports/TENDER — Обработать документ.json`;
- `tests/document-worker-evidence-repair.test.mjs`;
- новый fixture `tests/fixtures/document-worker-evidence/doc-11-au-0004-grounded-resource-overflow.json`;
- после подтверждённого runtime behavior — только относящиеся к Document Worker разделы `workflows/document-worker.md`, `ARCHITECTURE.md`, `TECH_DEBT.md`, `DEVELOPMENT_LOG.md`.

Документацию обновлять отдельным последним этапом после offline regression и test canary. Не менять документацию в одной правке с первоначальным workflow prototype.

### 1.2. Явно вне scope

Не изменять:

- Aggregator;
- Targeted Recheck;
- Finalization;
- Report Generation;
- Orchestrator;
- Error Workflow;
- PostgreSQL schema;
- `DATA_MODEL.md`;
- `FIELD_CATALOG.md`;
- production n8n без отдельного разрешения;
- resource constants `25 / 1500 / 5000`;
- semantic meaning 27 `field_key`.

### 1.3. Инварианты безопасности

Нельзя добавлять:

- fuzzy quote matching;
- automatic semantic block rebind;
- исправление или дописывание quote;
- удаление части исходного `value_text`;
- перефразирование исходного `value_text`;
- silent drop evidence или facts;
- `slice(0, 25)` и иное truncation;
- withdrawal;
- второй AI retry для одной analysis unit;
- продолжение unit как успешной после невалидного partition;
- provider-side schema как единственный контроль.

Сохраняются:

- exact `semantic_block_id`;
- exact quote substring после whitespace normalization;
- минимум один primary evidence на каждый resulting fact;
- application-side schema enforcement;
- максимум один дополнительный AI request на invalid unit;
- explicit Worker error после неудачной второй validation;
- отсутствие AI Validator для невалидной unit;
- completeness barrier перед AI Validator;
- один Document Worker execution = один document.

---

## 2. Подтверждённая root cause fixture

Источник regression fixture:

```text
document: Блок_9_Требования.docx
document_index: 11
analysis_unit_id: doc_11_au_0004
unit_index: 4
field_key: application_documents
source ai_segments: 95
primary ai_segments: 94
overlap ai_segments: 1
```

Невалидный Extractor fact:

```text
fact_index: 1
value_text chars: 1509
evidence count: 56
distinct semantic_block_id: 56
total quote chars: 5869
duplicate evidence: 0
```

Нарушения attempt 1 и attempt 2:

```json
[
  {
    "code": "evidence_limit_exceeded",
    "fact_index": 1,
    "evidence_index": null,
    "details": { "actual": 56, "maximum": 25 }
  },
  {
    "code": "evidence_total_quote_chars_exceeded",
    "fact_index": 1,
    "evidence_index": null,
    "details": { "actual": 5869, "maximum": 5000 }
  }
]
```

Все 56 evidence относятся к разным blocks. При текущем запрете терять grounded evidence существующий Evidence Repair не может уменьшить их число до 25. Это не evidence-level correction; это необходимость lossless partition одного composite fact.

---

## 3. Текущее место участка в Document Worker

Полный Document Worker до проблемного участка сохраняется без redesign:

```text
Execute Workflow Trigger
→ atomic document claim
→ download
→ Docling
→ Universal Normalizer
→ semantic blocks
→ analysis units
→ Сохранить analysis unit
→ Подготовить запрос для AI
→ AI Extractor v1.0
→ Проверить и привязать evidence
→ Обработать evidence units по одной
→ Evidence validation passed?
→ bounded retry/convergence
→ Собрать units после evidence validation
→ AI Validator v1
→ Проверить ответ AI Validator
→ Собрать факты документа1
→ Сохранить факты документа
→ document completion/readiness
```

В актуальном JSON initial Extractor и validation attempt 1 выполняются обычным multi-item flow до `Loop Over Items`. Loop с `batchSize = 1` сериализует только convergence и retry. Это положение Loop сохраняется.

---

## 4. Target graph

```text
Подготовить запрос для AI                         [existing, modify prompt]
→ AI Extractor v1.0                             [existing, unchanged]
→ Проверить и привязать evidence                [existing, add retry_decision]
→ Обработать evidence units по одной            [existing Loop, batch=1]
→ Evidence validation passed?                   [existing]
   ├─ true
   │  → Обработать evidence units по одной
   │
   └─ false
      → Выбрать bounded retry route              [new Switch]
         ├─ evidence_repair
         │  → Подготовить Evidence Repair        [existing, narrow allowed codes]
         │  → AI Evidence Repair v1              [existing]
         │  → Проверить evidence — попытка 2     [existing, narrow allowed codes]
         │  → Evidence repair passed?            [existing]
         │     ├─ true  → Loop
         │     └─ false → explicit Worker error
         │
         ├─ fact_partition
         │  → Подготовить Lossless Fact Partition [new Code]
         │  → AI Lossless Fact Partition v1       [new HTTP]
         │  → Проверить Lossless Fact Partition   [new Code]
         │  → Fact partition passed?              [new IF]
         │     ├─ true  → Loop
         │     └─ false → explicit Worker error
         │
         └─ hard_error
            → Завершить unit: retry route unavailable [new Code]

Loop DONE
→ Собрать units после evidence validation       [existing, modify metrics only]
→ AI Validator v1                               [existing, unchanged]
→ current downstream                            [unchanged]
```

Одна unit выбирает ровно один route. Branch `evidence_repair` никогда не переходит в `fact_partition`, и наоборот.

---

## 5. Общие версии и constants

Во всех затронутых prompt/schema/validator nodes использовать одинаковые constants:

```javascript
const EVIDENCE_RESOURCE_CONTRACT = Object.freeze({
  maxEvidencePerFact: 25,
  maxQuoteLength: 1500,
  maxTotalQuoteCharsPerFact: 5000,
});

const VERSIONS = Object.freeze({
  extractorSchema: 'ai_extractor_v1',
  fieldCatalog: 'tender_fields_v1',
  evidenceValidator: 'evidence_validator_v2',
  retryRouter: 'evidence_retry_router_v1',
  evidenceRepairSchema: 'ai_evidence_repair_v1',
  factPartitionSchema: 'ai_fact_partition_v1',
  factPartitionPrompt: 'tender_fact_partition_prompt_v1',
});
```

Constants физически остаются внутри Code nodes, поскольку n8n workflow сейчас не использует общий runtime module. Regression test обязан проверять их равенство во всех копиях.

---

## 6. Контракт после validation attempt 1

### 6.1. Existing output, который сохраняется

```json
{
  "tender": {},
  "document": {},
  "analysis_batch": {},
  "analysis_unit_meta": {},
  "validation_attempt": 1,
  "validation_passed": false,
  "violations": [],
  "verified_facts": [],
  "evidence_context": {},
  "extractor": {},
  "evidence_validation": {},
  "repair_context": {}
}
```

### 6.2. Additive `retry_decision`

```json
{
  "retry_decision": {
    "version": "evidence_retry_router_v1",
    "route": "fact_partition",
    "retry_budget": 1,
    "invalid_fact_indexes": [1],
    "evidence_repair_fact_indexes": [],
    "fact_partition_fact_indexes": [1],
    "violation_codes": [
      "evidence_limit_exceeded",
      "evidence_total_quote_chars_exceeded"
    ],
    "all_partition_evidence_exact_grounded": true,
    "reason": "pure_exact_grounded_resource_overflow"
  }
}
```

Дополнительное поле не передаётся как business fact и не меняет downstream contract. После успешной validation оно остаётся только diagnostic metadata.

### 6.3. Routing rules

```javascript
const RESOURCE_CODES = new Set([
  'evidence_limit_exceeded',
  'evidence_total_quote_chars_exceeded',
]);

const EVIDENCE_REPAIR_CODES = new Set([
  'duplicate_evidence',
  'quote_not_found',
  'wrong_semantic_block_id',
  'unknown_semantic_block_id',
  'overlap_only',
  'missing_primary_evidence',
]);
```

Детерминированный выбор:

```text
violations = []
→ route = pass

все violations принадлежат EVIDENCE_REPAIR_CODES
→ route = evidence_repair

все violations принадлежат RESOURCE_CODES
AND каждый evidence каждого invalid fact:
    - имеет известный semantic_block_id;
    - quote exact-grounded;
    - не является duplicate;
    - среди evidence есть primary;
→ route = fact_partition

любой mixed набор RESOURCE_CODES + EVIDENCE_REPAIR_CODES
→ route = hard_error

любой неизвестный code
→ hard exception внутри validator
```

В версии v1 mixed failure не получает два AI retry. Это осознанный fail-safe.

---

## 7. Exact contract `ai_fact_partition_v1`

### 7.1. Provider response shape

```json
{
  "schema_version": "ai_fact_partition_v1",
  "field_catalog_version": "tender_fields_v1",
  "analysis_unit_id": "doc_11_au_0004",
  "partitions": [
    {
      "source_fact_index": 1,
      "violation_codes": [
        "evidence_limit_exceeded",
        "evidence_total_quote_chars_exceeded"
      ],
      "replacement_facts": [
        {
          "value_text": "Первая дословная непрерывная часть исходного value_text с сохранёнными пробелами.",
          "evidence": [
            {
              "semantic_block_id": "sb_0116",
              "quote": "Точная цитата"
            }
          ]
        },
        {
          "value_text": " Вторая часть, начинающаяся с исходного разделяющего пробела.",
          "evidence": [
            {
              "semantic_block_id": "sb_0131",
              "quote": "Другая точная цитата"
            }
          ]
        }
      ]
    }
  ]
}
```

### 7.2. Exact root keys

Разрешены только:

```text
schema_version
field_catalog_version
analysis_unit_id
partitions
```

### 7.3. Exact partition keys

Разрешены только:

```text
source_fact_index
violation_codes
replacement_facts
```

### 7.4. Exact replacement fact keys

Разрешены только:

```text
value_text
evidence
```

AI не возвращает и не может менять:

```text
field_key
status
confidence
review_reason_code
review_note
fact_index нового массива
```

Эти поля копируются application-side из source fact. Новые `fact_index` назначаются детерминированно после успешной partition validation.

### 7.5. Provider enforcement

HTTP request остаётся:

```javascript
response_format: { type: 'json_object' }
```

`response_schema` и `required_output_shape` передаются в user prompt. Поддержка provider-side `json_schema` для текущего Polza/model не доказана, поэтому вся shape и semantic validation остаётся application-side.

---

## 8. Lossless invariants partition validator

Для каждого `source_fact_index` validator обязан доказать все условия.

### 8.1. Identity

```text
response.analysis_unit_id === source.analysis_unit_meta.analysis_unit_id
response.analysis_unit_id === original_extractor_response.analysis_unit_id
```

### 8.2. Exact target set

```text
partitions содержит ровно по одному элементу
для каждого retry_decision.fact_partition_fact_indexes
```

Неизвестный, пропущенный или duplicate `source_fact_index` — hard contract error.

### 8.3. Value preservation

Для source fact:

```javascript
const reconstructedValue = replacementFacts
  .map((fact) => fact.value_text)
  .join('');

if (reconstructedValue !== originalFact.value_text) {
  addViolation(
    violations,
    'partition_value_text_not_lossless',
    sourceFactIndex,
    null,
    {
      original_length: originalFact.value_text.length,
      reconstructed_length: reconstructedValue.length,
    },
  );
}
```

Сравнение выполняется byte-for-byte по JavaScript string, без whitespace normalization. Это запрещает модели переписывать, исправлять или сокращать `value_text`.

### 8.4. Evidence preservation

Ключ evidence:

```javascript
function evidenceKey(evidence) {
  return evidence.semantic_block_id + '\u0000' + evidence.quote;
}
```

Требование:

```text
multiset(all replacement evidence keys)
===
multiset(original source fact evidence keys)
```

Поскольку route `fact_partition` разрешён только для исходного fact без duplicate evidence, каждый исходный key должен встретиться в replacement facts ровно один раз.

Violation codes:

```text
partition_dropped_evidence
partition_added_evidence
partition_duplicate_evidence
```

### 8.5. Fact resource contract

Каждый replacement fact:

```text
evidence.length >= 1
evidence.length <= 25
каждая quote.length <= 1500
sum(quote.length) <= 5000
есть минимум один exact-grounded primary evidence
```

### 8.6. Exact grounding

После lossless checks rebuilt facts проходят тот же validator core, что attempt 1:

```text
known semantic_block_id
exact normalized-whitespace substring
no auto-rebind
no fuzzy matching
no duplicate ID+quote
primary evidence required
```

### 8.7. Rebuild facts

Алгоритм:

```javascript
const rebuiltFacts = [];

originalFacts.forEach((fact, originalFactIndex) => {
  const partition = partitionMap.get(originalFactIndex);

  if (!partition) {
    rebuiltFacts.push(structuredClone(fact));
    return;
  }

  for (const replacement of partition.replacement_facts) {
    rebuiltFacts.push({
      ...structuredClone(fact),
      value_text: replacement.value_text,
      evidence: structuredClone(replacement.evidence),
    });
  }
});
```

После rebuild validator назначает итоговые `fact_index` по позиции `0..N-1`. Поле `fact_index` не входит в Extractor fact schema, а добавляется в `verified_facts`, как и сейчас.

Общий итоговый `facts.length` не должен превышать существующий `maxFactsPerUnit = 100`.

---

## 9. Node-by-node change plan

### Node 1 — `Подготовить запрос для AI`

**Type:** Code, Run Once for All Items.

**Status:** modify.

**Input:** persisted analysis unit items с `analysis_unit_meta`, `ai_segments`, `provenance`, tender/document context.

**Current output:** один HTTP request item на analysis unit, `ai_request.schema_version = ai_extractor_v1`, linked через `pairedItem: { item: index }`.

**Change:** усилить только prompt instructions; schema `ai_extractor_v1` не менять.

Добавить дословные правила:

```text
Перед возвратом каждого fact проверь resource contract.

Если один composite/list fact требует более 25 evidence или более 5000
символов quote, НЕ обрезай evidence и НЕ объединяй независимые условия.
Раздели содержание на несколько самостоятельных facts с тем же field_key.

Для application_documents разделяй как минимум по независимо применимым
категориям участников, условиям применимости или самостоятельным группам
документов. Условие применимости обязательно сохраняй в value_text того же fact.

Каждый resulting fact должен быть самостоятельно понятен и полностью
подтверждён собственным evidence в пределах 25 / 1500 / 5000.
```

**Unchanged:** field catalog, response schema, exact quote rules, pairedItem, provider payload.

### Node 2 — `AI Extractor v1.0`

**Type:** HTTP Request.

**Status:** unchanged.

**Input:** `ai_request` от `Подготовить запрос для AI`.

**Output:** OpenAI-compatible response, content должен быть JSON object `ai_extractor_v1`.

**Invariant:** Extractor остаётся до Loop и обрабатывает multi-item flow без последовательной сериализации.

### Node 3 — `Проверить и привязать evidence`

**Type:** Code, Run Once for Each Item.

**Status:** modify.

**Input:** HTTP response текущей analysis unit; linked source получать только через:

```javascript
const source = $('Подготовить запрос для AI').item.json;
```

**Change:** сохранить текущий full validator; во время `validateFacts` дополнительно сохранить per-fact признаки:

```text
all_evidence_known
all_quotes_exact
has_primary
has_duplicate
resource_violation_codes
non_resource_violation_codes
```

На их основе добавить `retry_decision` по правилам раздела 6.3.

**Output:** текущий structured validation result + additive `retry_decision`.

**Hard errors remain hard:** malformed JSON, schema versions, unknown keys, invalid field key/status/value shape, mismatched analysis unit ID, missing provenance.

### Node 4 — `Обработать evidence units по одной`

**Type:** Loop Over Items / Split in Batches.

**Status:** unchanged.

**Settings:** `batchSize = 1`, reset disabled.

**Input:** все attempt-1 validation results.

**Loop output:** один current item в convergence branch.

**Done output:** все успешно возвращённые items один раз в `Собрать units после evidence validation`.

### Node 5 — `Evidence validation passed?`

**Type:** IF.

**Status:** unchanged.

**Condition:**

```text
{{ $json.validation_passed === true }}
```

**True:** вернуть item в Loop.

**False:** направить в новый Switch `Выбрать bounded retry route`.

### Node 6 — `Выбрать bounded retry route`

**Type:** Switch.

**Status:** new.

**Run mode:** per item, стандартное n8n item flow.

**Input:** invalid structured result attempt 1.

**Route value:**

```text
{{ $json.retry_decision.route }}
```

**Outputs:**

```text
evidence_repair → Подготовить Evidence Repair
fact_partition  → Подготовить Lossless Fact Partition
hard_error      → Завершить unit: retry route unavailable
```

Switch не должен иметь fallback, который продолжает workflow. Неизвестное значение должно идти в explicit error output либо завершать Switch configuration error.

### Node 7 — `Подготовить Evidence Repair`

**Type:** Code, Run Once for Each Item.

**Status:** modify narrowly.

Удалить из `ALLOWED_CODES`:

```text
evidence_limit_exceeded
evidence_total_quote_chars_exceeded
```

Оставить:

```text
duplicate_evidence
quote_not_found
wrong_semantic_block_id
unknown_semantic_block_id
overlap_only
missing_primary_evidence
```

Добавить guard:

```javascript
if (input.retry_decision?.route !== 'evidence_repair') {
  throw new Error('[Prepare Evidence Repair] Invalid retry route.');
}
```

Остальной `ai_evidence_repair_v1` contract оставить без изменения.

### Node 8 — `AI Evidence Repair v1`

**Type:** HTTP Request.

**Status:** unchanged.

**Input:** existing `repair_request`.

**Output:** provider JSON object `ai_evidence_repair_v1`.

**Retry:** n8n retry disabled; это единственный AI repair request unit.

### Node 9 — `Проверить evidence — попытка 2`

**Type:** Code, Run Once for Each Item.

**Status:** modify narrowly.

Получать linked source только через:

```javascript
const repairSource = $('Подготовить Evidence Repair').item.json;
```

Удалить resource overflow codes из `allowedRepairCodes`. Добавить guard `retry_decision.route === 'evidence_repair'`.

Exact validator, immutable fact fields, no-drop grounded evidence guard и output contract сохраняются.

### Node 10 — `Evidence repair passed?`

**Type:** IF.

**Status:** unchanged.

**True:** Loop.

**False:** `Завершить unit: evidence validation failed`.

### Node 11 — `Подготовить Lossless Fact Partition`

**Type:** Code, Run Once for Each Item.

**Status:** new.

**Input contract:**

```text
validation_passed = false
retry_decision.route = fact_partition
violations non-empty
repair_context.original_extractor_response exists
repair_context.source.ai_segments exists
repair_context.source.provenance exists
```

**Guards:**

```javascript
if (input.retry_decision?.route !== 'fact_partition') hard(...);
if (input.retry_decision.retry_budget !== 1) hard(...);
if (!input.retry_decision.all_partition_evidence_exact_grounded) hard(...);
if (input.extractor?.repair?.requests_count !== 0) hard(...);
```

**Output:** исходный structured result без потерь + `partition_request`:

```json
{
  "partition_request": {
    "prompt_version": "tender_fact_partition_prompt_v1",
    "schema_version": "ai_fact_partition_v1",
    "system_prompt": "...",
    "user_prompt": "...",
    "response_schema": {},
    "source_fact_indexes": [1]
  }
}
```

**System prompt requirements:**

```text
Ты выполняешь lossless partition только перечисленных source facts.
Нельзя искать новые facts.
Нельзя менять символы, порядок или полный объём исходного value_text.
Конкатенация replacement value_text без separator должна точно равняться original value_text.
Нельзя добавлять, удалять, переписывать или исправлять evidence.
Каждая исходная пара semantic_block_id + quote должна встретиться ровно один раз.
Разрешено только распределить неизменённые value_text fragments и evidence между replacement facts.
Каждый replacement fact обязан соблюдать 25 / 1500 / 5000 и иметь primary evidence.
Верни только ai_fact_partition_v1 JSON.
```

**User payload:**

```json
{
  "required_output_shape": {},
  "response_schema": {},
  "analysis_unit_id": "...",
  "resource_contract": {},
  "source_facts": [
    {
      "source_fact_index": 1,
      "field_key": "application_documents",
      "value_text": "...",
      "status": "found",
      "confidence": 0.95,
      "review_reason_code": null,
      "review_note": null,
      "evidence": []
    }
  ],
  "violations": [],
  "ai_segments": [],
  "provenance": {}
}
```

### Node 12 — `AI Lossless Fact Partition v1`

**Type:** HTTP Request.

**Status:** new.

**Authentication/URL/model:** скопировать фактические transport, credentials и model alias из `AI Evidence Repair v1`.

**Request body:**

```javascript
{{ {
  model: 'deepseek/deepseek-v4-pro-0813@provider=deepseek&reasoning_effort=none',
  messages: [
    { role: 'system', content: $json.partition_request.system_prompt },
    { role: 'user', content: $json.partition_request.user_prompt },
  ],
  response_format: { type: 'json_object' },
  max_tokens: 8192,
  stream: false,
} }}
```

**Node settings:** `retryOnFail` и `onError` не включать. Provider/transport error должен завершить Worker явно.

### Node 13 — `Проверить Lossless Fact Partition`

**Type:** Code, Run Once for Each Item.

**Status:** new.

**Linked source:**

```javascript
const partitionSource = $('Подготовить Lossless Fact Partition').item.json;
```

Не использовать `itemMatching(0)`, `.first()` или positional item 0.

**Validation phases:**

```text
1. Provider envelope: choices, finish_reason=stop, content string.
2. JSON.parse.
3. Exact root/partition/replacement keys.
4. Versions and analysis_unit_id.
5. Exact set of source_fact_index.
6. Exact violation code set.
7. Byte-for-byte reconstruction of value_text.
8. Exact evidence multiset preservation.
9. Rebuild full facts array; unaffected facts unchanged.
10. Standard evidence validator v2 over every rebuilt fact.
11. maxFactsPerUnit=100.
12. Structured output; no throw for repairable result violations.
```

**Success output:** тот же downstream contract, что successful attempt 1/2:

```json
{
  "validation_attempt": 2,
  "validation_passed": true,
  "violations": [],
  "verified_facts": [],
  "evidence_context": {},
  "extractor": {
    "partition": {
      "attempted": true,
      "requests_count": 1,
      "schema_version": "ai_fact_partition_v1",
      "prompt_version": "tender_fact_partition_prompt_v1",
      "response_id": "...",
      "model": "...",
      "finish_reason": "stop",
      "source_fact_indexes": [1],
      "replacement_fact_count": 3,
      "original_invalid_facts": [],
      "initial_violations": [],
      "usage": {}
    }
  },
  "evidence_validation": {
    "version": "evidence_validator_v2",
    "attempt": 2,
    "passed": true,
    "resource_contract": {},
    "resource_metrics": {},
    "violations_count": 0
  },
  "repair_context": null
}
```

`original_invalid_facts` содержит только source facts, которые partition заменил. `ai_segments` не дублировать: они уже persist в `tender_analysis_units`.

**Failure output:**

```json
{
  "validation_attempt": 2,
  "validation_passed": false,
  "violations": [],
  "verified_facts": [],
  "evidence_context": {},
  "extractor": {
    "partition": {
      "attempted": true,
      "requests_count": 1
    }
  },
  "repair_context": {}
}
```

Malformed provider/contract response остаётся hard exception. Lossless/grounding violations возвращаются structured, чтобы следующий IF направил их в explicit error node с полным diagnostic list.

### Node 14 — `Fact partition passed?`

**Type:** IF.

**Status:** new.

**Condition:**

```text
{{ $json.validation_passed === true }}
```

**True:** Loop.

**False:** `Завершить unit: evidence validation failed`.

### Node 15 — `Завершить unit: retry route unavailable`

**Type:** Code, Run Once for Each Item.

**Status:** new.

**Purpose:** explicit error для mixed/unsupported evidence failure, когда v1 не может безопасно выбрать один bounded retry.

**Error contract:**

```javascript
const unitId = $json.analysis_unit_meta?.analysis_unit_id ?? 'unknown';
const decision = $json.retry_decision ?? null;
const violations = Array.isArray($json.violations) ? $json.violations : [];

throw new Error(
  '[Evidence retry route unavailable] analysis_unit_id=' + unitId +
  '; decision=' + JSON.stringify(decision) +
  '; violations=' + JSON.stringify(violations),
);
```

### Node 16 — `Завершить unit: evidence validation failed`

**Type:** Code, Run Once for Each Item.

**Status:** modify diagnostic message only.

Использовать фактический retry type:

```javascript
const retryType = $json.extractor?.partition?.attempted
  ? 'fact_partition'
  : 'evidence_repair';
```

Error должен включать `analysis_unit_id`, `attempts=2`, `retry_type` и полный violations JSON. Поведение throw сохраняется.

### Node 17 — `Собрать units после evidence validation`

**Type:** Code, Run Once for All Items.

**Status:** modify metrics only.

Все текущие completeness guards сохраняются:

```text
saved units count === expected
validated units count === expected
unique analysis_unit_id
validation_passed === true
violations.length === 0
```

Расширить metrics:

```json
{
  "units_total": 16,
  "extractor_requests": 16,
  "evidence_repair_requests": 0,
  "fact_partition_requests": 1,
  "total_retry_requests": 1,
  "total_ai_requests_before_ai_validator": 17,
  "evidence_count": 75,
  "total_quote_chars": 7379,
  "loop_batch_size": 1,
  "extractor_flow": "normal multi-item flow before convergence loop",
  "latency_note": "Only convergence and one bounded retry per invalid unit are serialized by Loop Over Items batch=1."
}
```

Для обратной диагностической совместимости можно сохранить `repair_requests` как сумму evidence repair requests, но новые tests должны использовать однозначные поля выше.

### Node 18 — `AI Validator v1`

**Type:** HTTP Request.

**Status:** unchanged.

Получает только `verified_facts` и `evidence_context` после полного convergence barrier. Несколько facts с одним `field_key` уже являются допустимым текущим контрактом.

### Node 19 — `Проверить ответ AI Validator`

**Type:** Code.

**Status:** unchanged.

Проверяет один verdict на каждый новый deterministic `fact_index`.

### Node 20 — `Собрать факты документа1`

**Type:** Code, Run Once for All Items.

**Status:** unchanged, если regression докажет persistence `result.extractor.partition` через существующее поле `extractor_meta`.

Текущий код уже формирует:

```javascript
extractor_meta: result.extractor ?? {}
```

Поэтому `original_invalid_facts`, initial violations и partition provider metadata должны сохраниться без изменения PostgreSQL schema.

Если offline persistence test покажет, что metadata теряется до SQL, остановить implementation и отдельно согласовать минимальное изменение этой ноды; не продолжать без audit trail.

### Node 21 — `Сохранить факты документа`

**Type:** PostgreSQL.

**Status:** unchanged.

Текущий SQL уже сохраняет:

```text
evidence → jsonb
extractor_meta → jsonb
validator_meta → jsonb
```

Schema/SQL менять не требуется.

---

## 10. Item linking contract

Для mixed batch:

```text
unit A = valid
unit B = evidence repair
unit C = valid
unit D = fact partition
```

обязательны связи:

```text
attempt 1 response B
→ source B через $('Подготовить запрос для AI').item

Evidence Repair B response
→ repair source B через $('Подготовить Evidence Repair').item

Fact Partition D response
→ partition source D через $('Подготовить Lossless Fact Partition').item
```

Каждая validation проверяет `analysis_unit_id` provider response против linked source. Cross-link B/D обязан завершаться hard error до применения response.

Все Code nodes Run Once for Each Item возвращают один item без ручного `pairedItem: { item: 0 }`. `Подготовить запрос для AI` и completeness barrier, создающие массив items, используют `pairedItem: { item: index }`.

---

## 11. Failure semantics

### 11.1. Partition provider/shape failure

```text
invalid JSON
wrong root keys
wrong schema version
wrong analysis_unit_id
missing source_fact_index
unknown source_fact_index
```

→ hard Code node error → Document Worker error workflow.

### 11.2. Partition semantic/lossless failure

```text
value_text reconstruction mismatch
dropped/added/duplicate evidence
replacement resource overflow
quote/block exact grounding failure
missing primary evidence
```

→ structured `validation_passed=false` → `Fact partition passed?` false → explicit Worker error.

### 11.3. Downstream guarantees

При любой неудаче:

- item не возвращается в Loop;
- Loop DONE не наступает;
- completeness barrier не проходит;
- AI Validator не вызывается;
- facts не сохраняются частично;
- document не становится `completed`;
- Aggregator не запускается для незавершённого набора документов;
- partial FINAL results этим изменением не создаются.

---

## 12. Audit contract без изменения DB schema

`extractor_meta.partition` должен содержать:

```json
{
  "attempted": true,
  "requests_count": 1,
  "prompt_version": "tender_fact_partition_prompt_v1",
  "schema_version": "ai_fact_partition_v1",
  "response_id": "provider-response-id",
  "model": "deepseek/deepseek-v4-pro-0813",
  "finish_reason": "stop",
  "source_fact_indexes": [1],
  "original_invalid_facts": [],
  "initial_violations": [],
  "replacement_fact_count": 3,
  "value_text_lossless": true,
  "evidence_multiset_lossless": true,
  "usage": {}
}
```

Не сохранять второй раз `ai_segments` и `provenance` в каждой fact row: они уже находятся в `tender_analysis_units`. Связь обеспечивается `analysis_run_id + document_id + analysis_unit_id`.

Перед test canary offline test должен доказать, что объект доходит по пути:

```text
Проверить Lossless Fact Partition
→ AI Validator
→ Проверить ответ AI Validator
→ Собрать факты документа1
→ facts[*].extractor_meta.partition
→ SQL parameter JSON
```

---

## 13. TDD implementation tasks

### Task 1 — Зафиксировать canary fixture и failing behavior

**Files:**

- Create: `tests/fixtures/document-worker-evidence/doc-11-au-0004-grounded-resource-overflow.json`
- Modify: `tests/document-worker-evidence-repair.test.mjs`

- [ ] Добавить fixture только из фактического attached/runtime output: analysis unit identity, исходные facts, 95 `ai_segments`, provenance, resource metrics и violations. Не придумывать отсутствующие source text.
- [ ] Добавить test: attempt 1 возвращает ровно два resource codes для `fact_index=1`.
- [ ] Добавить test: 56 evidence exact-grounded, 56 distinct blocks, duplicates=0.
- [ ] Добавить failing test: `retry_decision.route === 'fact_partition'`.
- [ ] Запустить:

```powershell
node --test tests/document-worker-evidence-repair.test.mjs
```

Expected before implementation: новый routing test FAIL; существующие 30 tests PASS.

### Task 2 — Усилить proactive Extractor contract

**File:** `workflows/n8n-exports/TENDER — Обработать документ.json`

- [ ] Добавить failing source-code assertions для prompt rules `application_documents`, `несколько facts`, `25`, `5000`, `не обрезай`.
- [ ] Изменить только prompt string ноды `Подготовить запрос для AI`.
- [ ] Проверить, что response schema и HTTP node не изменились.
- [ ] Запустить test suite; expected PASS для prompt contract tests.

### Task 3 — Добавить deterministic retry classification

**Files:** workflow JSON и test file.

- [ ] Добавить tests для routes `pass`, `evidence_repair`, `fact_partition`, `hard_error`.
- [ ] Добавить mixed violation test: resource + quote error → `hard_error`.
- [ ] Добавить unknown violation test → hard validator error.
- [ ] Реализовать `retry_decision` в `Проверить и привязать evidence` без изменения exact validation.
- [ ] Запустить suite; expected all routing tests PASS.

### Task 4 — Вставить Switch и сузить Evidence Repair

**Files:** workflow JSON и test file.

- [ ] Добавить topology tests для `Выбрать bounded retry route` и трёх outputs.
- [ ] Добавить test: pure resource overflow не может достичь `Подготовить Evidence Repair`.
- [ ] Добавить test: quote/id violations по-прежнему достигают Evidence Repair.
- [ ] Добавить Switch и connections.
- [ ] Удалить два resource code из Prepare Repair и attempt-2 allowed sets.
- [ ] Запустить suite; expected existing 14008/14009/14012/14014 cases сохраняют прежний результат.

### Task 5 — Реализовать Prepare Lossless Fact Partition contract

**Files:** workflow JSON и test file.

- [ ] Добавить failing tests exact schema/root keys и forbidden keys.
- [ ] Добавить test: `value_text`, `field_key`, `status`, `confidence` не могут находиться на partition root.
- [ ] Добавить test: user payload содержит только target source facts и полный source context.
- [ ] Добавить Code node с guards, prompt, schema и `source_fact_indexes`.
- [ ] Запустить suite; expected contract tests PASS.

### Task 6 — Добавить AI Lossless Fact Partition HTTP node

**Files:** workflow JSON и test file.

- [ ] Добавить topology/config test: transport/model совпадает с Evidence Repair, `json_object`, no retry/onError.
- [ ] Добавить HTTP node и connection Prepare → AI.
- [ ] Проверить отсутствие credentials/secrets diff.
- [ ] Запустить suite; expected JSON/config tests PASS.

### Task 7 — Реализовать application-side lossless validator

**Files:** workflow JSON и test file.

- [ ] Test valid split: exact value concatenation, exact evidence union, each part in budget → PASS.
- [ ] Test changed value character → `partition_value_text_not_lossless`.
- [ ] Test reordered value fragments → rejection.
- [ ] Test omitted value fragment → rejection.
- [ ] Test dropped evidence → `partition_dropped_evidence`.
- [ ] Test invented evidence → `partition_added_evidence`.
- [ ] Test evidence repeated across parts → `partition_duplicate_evidence`.
- [ ] Test replacement with 26 evidence → `evidence_limit_exceeded`.
- [ ] Test replacement total quote chars 5001 → `evidence_total_quote_chars_exceeded`.
- [ ] Test wrong block ID/quote → exact validator rejection.
- [ ] Test overlap-only replacement → rejection.
- [ ] Test wrong analysis unit ID → hard error.
- [ ] Test crossed unit B/D linked source → hard error.
- [ ] Реализовать node `Проверить Lossless Fact Partition`.
- [ ] Запустить suite; expected all partition tests PASS.

### Task 8 — Подключить convergence и explicit errors

**Files:** workflow JSON и test file.

- [ ] Добавить `Fact partition passed?` и обе connections.
- [ ] Добавить `Завершить unit: retry route unavailable`.
- [ ] Расширить diagnostic текущего exhausted error retry type.
- [ ] Test: successful partition возвращает item в Loop ровно один раз.
- [ ] Test: failed partition не имеет пути в Loop или AI Validator.
- [ ] Test: mixed route вызывает explicit error без AI request.
- [ ] Test: unit получает максимум один из `repair.requests_count` или `partition.requests_count`, никогда оба.

### Task 9 — Completeness metrics и audit persistence

**Files:** workflow JSON и test file.

- [ ] Добавить metrics tests для all-valid, evidence-repair, fact-partition и mixed batch.
- [ ] Изменить только additive metrics в completeness barrier.
- [ ] Прогнать offline path до `Собрать факты документа1` и проверить `facts[*].extractor_meta.partition.original_invalid_facts`.
- [ ] Если metadata теряется, остановить работу и запросить согласование изменения `Собрать факты документа1`; SQL и schema не менять.
- [ ] Test: original invalid fact, violations и provider IDs присутствуют в persistent SQL parameter JSON.

### Task 10 — Полная regression и topology verification

**Files:** test file, fixtures, workflow JSON.

- [ ] Запустить полный suite:

```powershell
node --test tests/document-worker-evidence-repair.test.mjs
```

Expected: все существующие 30 tests и новые partition tests PASS.

- [ ] Проверить production fixtures `14006–14017` без изменения expected outcomes.
- [ ] Проверить canary fixture `doc_11_au_0004`: Evidence Repair calls=0, Fact Partition calls=1, validation attempt 2 PASS на валидном partition fixture.
- [ ] Проверить unique node names/IDs и разрешение всех connections.
- [ ] Проверить `analysis_unit_id` end-to-end mixed batch A/B/C/D.
- [ ] Проверить JSON parse:

```powershell
Get-Content -LiteralPath 'workflows\n8n-exports\TENDER — Обработать документ.json' -Raw |
  ConvertFrom-Json -Depth 100 |
  Out-Null
```

- [ ] Проверить whitespace errors:

```powershell
git diff --check
```

### Task 11 — Test workflow canary, только после отдельного разрешения

Production workflow не импортировать.

- [ ] Экспортировать изменённый JSON как отдельный TEST workflow вручную.
- [ ] Выполнить canary на `Блок_9_Требования.docx`.
- [ ] Зафиксировать:

```text
units_total
Extractor requests
Evidence Repair requests
Fact Partition requests
total execution duration
doc_11_au_0004 partition response
lossless validation result
AI Validator invocation count
document terminal status
```

- [ ] Ожидаемый результат для проблемной unit: один partition request, исходные 56 evidence сохранены и распределены, resulting facts в resource limits.
- [ ] Если partition attempt 2 invalid — Document Worker должен завершиться explicit error; не ослаблять validator.

### Task 12 — Документация после подтверждённого canary

Только после отдельного согласования:

- [ ] Обновить фактический graph и версии в `workflows/document-worker.md`.
- [ ] Исправить устаревшее прямое описание evidence validator → AI Validator в `ARCHITECTURE.md`.
- [ ] Зафиксировать runtime failure и resolution в `TECH_DEBT.md`.
- [ ] Добавить проверенный execution/canary result в `DEVELOPMENT_LOG.md`.
- [ ] Не менять `DATA_MODEL.md` и `FIELD_CATALOG.md`.

---

## 14. Regression matrix

| Case | Expected route | Expected result |
|---|---|---|
| Все units valid | pass | 0 retry, Loop DONE, barrier PASS |
| 14010 / 14016, evidence >5 но ≤25 | pass | no retry |
| 14008 wrong block ID | evidence_repair | exact repair → attempt 2 PASS |
| 14009 ellipsis quote | evidence_repair | только exact replacement может PASS |
| 14012 overlap-only | evidence_repair | без primary attempt 2 FAIL |
| 14014 OCR/paraphrase | evidence_repair | fuzzy/auto-rebind отсутствуют, FAIL без exact quote |
| doc_11_au_0004, 56 exact grounded evidence | fact_partition | lossless partition → attempt 2 PASS |
| Partition меняет один символ value_text | fact_partition | explicit FAIL |
| Partition теряет один evidence | fact_partition | explicit FAIL |
| Partition добавляет evidence | fact_partition | explicit FAIL |
| Partition возвращает один part с 26 evidence | fact_partition | explicit FAIL |
| Resource overflow + quote_not_found | hard_error | 0 retry, explicit FAIL |
| Cross-linked partition B response к D source | fact_partition | hard analysis_unit_id error |
| Provider возвращает invalid JSON/schema | выбранный retry | hard Worker error |
| Attempt 2 invalid | выбранный retry | AI Validator не вызывается |

---

## 15. Latency и resource expectations

Initial Extractor остаётся multi-item и не сериализуется Loop.

Для документа с 66 units:

```text
Extractor requests = 66
Fact Partition requests = только число pure grounded resource overflow units
Evidence Repair requests = только число evidence-level invalid units
max additional requests per unit = 1
```

Loop `batchSize=1` добавляет последовательную latency только для convergence branch. Для all-valid документа AI retry latency отсутствует. Для текущего canary ожидается один дополнительный Polza request.

После test canary сравнить с baseline execution 14012:

```text
units: 66
total_execution_ms: 119717
extractor_node_ms: 40573
evidence_validator_ms: 3843
```

Не менять correctness ради latency. Если partition response велик или выполняется слишком долго, зафиксировать риск и остановить rollout.

---

## 16. Известные риски и mitigations

### AI не может выполнить byte-exact split

Риск: модель меняет пробел или знак препинания.

Mitigation: deterministic byte equality; explicit failure. Prompt показывает, что leading/trailing separators должны оставаться внутри fragments.

### Evidence распределено к неправильному value fragment

Риск: evidence exact, но семантически относится к другому replacement fact.

Mitigation: independent AI Validator проверяет каждый rebuilt fact; никакой fact не минует его.

### Mixed resource и grounding violations

Риск: одного retry недостаточно для двух repair modes.

Mitigation v1: hard error без AI retry. Не запускать последовательно Evidence Repair и Partition.

### Audit metadata duplication

Риск: `extractor_meta.partition` повторяется в нескольких fact rows.

Mitigation: сохранять только invalid source facts и violations, не копировать ai_segments/provenance. Принять небольшую JSONB duplication как минимальный diff без schema change.

### Provider игнорирует response schema

Риск: `json_object` гарантирует только JSON object.

Mitigation: exact application-side keys/schema/version/value/evidence validation.

### Документация сейчас устарела

Риск: `workflows/document-worker.md` всё ещё описывает старый direct path и validator v1.

Mitigation: JSON остаётся source of truth; документацию синхронизировать только после подтверждённого canary.

---

## 17. Definition of Done

Implementation готова к test canary только если одновременно выполнено:

```text
1. Existing 30 regression tests PASS.
2. Все новые lossless partition tests PASS.
3. Fixtures 14006–14017 сохраняют expected behavior.
4. doc_11_au_0004 route = fact_partition.
5. Evidence Repair не вызывается для pure grounded resource overflow.
6. Original value_text восстанавливается byte-for-byte.
7. Original evidence multiset сохраняется полностью.
8. Каждый resulting fact соблюдает 25 / 1500 / 5000.
9. Exact grounding и primary evidence проходят для каждого fact.
10. Один unit получает максимум один retry request.
11. Attempt 2 failure не достигает AI Validator.
12. Completeness barrier получает каждую unit ровно один раз.
13. Original invalid fact и violations доходят до extractor_meta persistence payload.
14. Workflow JSON valid, connections valid, node IDs/names unique.
15. git diff --check PASS.
16. Нет изменений других workflows или PostgreSQL schema.
```

Production promotion не входит в Definition of Done этого implementation этапа и требует отдельного согласования после test canary.

---

## 18. Review checkpoints

Останавливаться для review после каждого логического этапа:

```text
Checkpoint 1: fixture + retry classification
Checkpoint 2: Switch + narrowed Evidence Repair
Checkpoint 3: partition prompt/schema
Checkpoint 4: lossless application validator
Checkpoint 5: convergence + audit persistence
Checkpoint 6: offline full regression
Checkpoint 7: отдельный TEST canary
```

Не делать commit, import в live n8n или production execution без отдельного явного разрешения владельца проекта.
