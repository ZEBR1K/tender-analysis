# Client Confirmed Field Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the four canonical semantic/presentation workflows with Dmitry's 2026-09-07 decisions while preserving all 27 field keys, evidence grounding, fail-closed behavior and audit data.

**Architecture:** Treat `FIELD_CATALOG.md` as the business source of truth and encode one checked-in decision fixture used by focused contract tests. Update the canonical Document Worker, Aggregator, Targeted Recheck and Report Generation exports in sequence; do not change live n8n or PostgreSQL during local implementation. Keep platform-tariff acquisition outside this plan because its source and temporal contract are not yet designed.

**Tech Stack:** n8n workflow JSON, JavaScript Code nodes, Node.js `node:test`, PostgreSQL-backed FINAL contract (unchanged), Markdown documentation.

---

### Task 1: Add one machine-readable client-decision regression fixture

**Files:**
- Create: `tests/fixtures/field-semantics/client-confirmed-2026-09-07.json`
- Create: `tests/client-confirmed-field-semantics.test.mjs`
- Read: `FIELD_CATALOG.md`
- Read: `REPORT_FIELD_MAPPING.md`

- [ ] **Step 1: Write the decision fixture**

The fixture must contain all 27 existing `field_key` values and a `changed_contracts`
object with these exact high-risk expectations:

```json
{
  "contract_version": "client_confirmed_field_semantics_2026_09_07",
  "field_count": 27,
  "changed_contracts": {
    "application_review_date": { "presentation": "terminal_date" },
    "results_date": { "scope": "all_winner_selection_events" },
    "customer": { "identity": "contracting_legal_entity" },
    "customer_contacts": { "roles": ["procurement", "technical"] },
    "delivery_term": { "fallback": "general_contract_term_when_direct_absent", "must_label_fallback": true },
    "government_contract": { "categories": ["state_contract", "municipal_contract", "state_defence_order", "performed_under_these_contracts", "ordinary_contract"] },
    "national_regime": { "values": ["Запрет", "Ограничение", "Преимущество", "Не применяется"], "negative_requires_direct_evidence": true },
    "licenses_certificates": { "literal_types_only": ["лицензия", "сертификат"] },
    "similar_supply_experience": { "classes": ["mandatory", "scored"] },
    "application_documents": { "presentation": "concise", "retrieval": "complete" }
  }
}
```

Add the unchanged 27-key ordered list from the canonical workflow rather than
deriving it from the document under test.

- [ ] **Step 2: Write RED documentation/runtime-alignment tests**

The test must:

```javascript
assert.equal(fixture.field_keys.length, 27);
assert.equal(new Set(fixture.field_keys).size, 27);
assert.match(fieldCatalog, /CLIENT_CONFIRMED/u);
assert.match(reportMapping, /Подтверждённый клиентский формат 2026-09-07/u);
```

It must then load the four canonical workflow JSON files, find nodes by exact
name, and assert the high-risk phrases/contracts listed in Tasks 2-5. At this
checkpoint the workflow assertions must fail while the documentation assertions
pass.

- [ ] **Step 3: Run the focused test and record RED**

Run:

```powershell
node --test tests/client-confirmed-field-semantics.test.mjs
```

Expected: documentation/27-key checks pass; runtime alignment checks fail on
the first unchanged semantic node.

- [ ] **Step 4: Commit the fixture and RED test**

```powershell
git add tests/fixtures/field-semantics/client-confirmed-2026-09-07.json tests/client-confirmed-field-semantics.test.mjs
git commit -m "test: pin client-confirmed field semantics"
```

---

### Task 2: Align Document Worker extraction without weakening grounding

**Files:**
- Modify: `workflows/n8n-exports/TENDER — Обработать документ.json`
- Test: `tests/client-confirmed-field-semantics.test.mjs`
- Test: `tests/document-worker-evidence-repair.test.mjs`
- Test: `tests/document-worker-docx-option-state.test.mjs`

**Node:** `Подготовить запрос для AI`

- [ ] **Step 1: Extend the RED assertions for Extractor definitions**

Assert the node's embedded field catalog requires:

```text
results_date → every winner-selection event, not an arbitrary stage date
customer → legal entity that concludes the contract; organizer alone is insufficient
customer_contacts → procurement and technical roles remain distinguishable
delivery_term → direct delivery/work/service term first; general contract term only as labelled fallback
government_contract → state / municipal / GOZ / performed-under categories
national_regime → four client values; Не применяется requires direct evidence
licenses_certificates → only literal licence/certificate requirements
similar_supply_experience → mandatory and scored experience classified separately
```

Also assert that excluded declarations/permits remain eligible for
`application_documents` when the source requires them in the application.

- [ ] **Step 2: Run the focused test and verify Extractor RED**

```powershell
node --test tests/client-confirmed-field-semantics.test.mjs
```

Expected: Extractor assertions fail; documentation checks remain green.

- [ ] **Step 3: Make the minimal field-definition edit**

Edit only the relevant definitions/rules inside `Подготовить запрос для AI`.
Do not change model, token limits, analysis-unit partitioning, evidence schema,
Validator prompts, retries, persistence or connections.

The `national_regime` rule must include this exact semantic branch:

```javascript
absence_of_applicability_evidence !== 'Не применяется'
```

The prompt prose must express the equivalent Russian rule; the JavaScript line
is a regression marker, not executable inference logic.

- [ ] **Step 4: Run focused Worker tests**

```powershell
node --test tests/client-confirmed-field-semantics.test.mjs tests/document-worker-docx-option-state.test.mjs tests/document-worker-evidence-repair.test.mjs
```

Expected: new Extractor checks pass and no previously green Worker behavior test
regresses. Existing exact byte/hash pins may remain only if their baseline
signature is unchanged and is documented before this task.

- [ ] **Step 5: Commit Worker alignment**

```powershell
git add "workflows/n8n-exports/TENDER — Обработать документ.json" tests/client-confirmed-field-semantics.test.mjs
git commit -m "fix(worker): align client-confirmed field semantics"
```

---

### Task 3: Align Aggregator Round 1 and preserve false-resolved containment

**Files:**
- Modify: `workflows/n8n-exports/TENDER — Агрегация закупки.json`
- Test: `tests/client-confirmed-field-semantics.test.mjs`
- Test: `tests/aggregator-national-regime-option-state.test.mjs`
- Test: `tests/semantic-containment-execution-14260.test.mjs`

**Node:** `Подготовить запрос Semantic Aggregator`

- [ ] **Step 1: Add RED assertions for the Round 1 field rules**

Require the Aggregator to:

```text
results_date → retain multiple distinct confirmed winner-selection events
application_review_date → present the terminal date when a period is evidenced
customer_contacts → retain both role-labelled contacts without inventing a missing role
delivery_term → prefer direct term and label general-contract fallback
government_contract → preserve the exact confirmed category
national_regime → output one allowed client value and reject absence-as-not-applicable
advance_contract_guarantee → present two labelled subparts without treating a missing subpart as Нет
similar_supply_experience → keep mandatory and scored requirements separated
application_documents → concise presentation only after material-clause completeness
```

- [ ] **Step 2: Run and verify Round 1 RED**

```powershell
node --test tests/client-confirmed-field-semantics.test.mjs tests/aggregator-national-regime-option-state.test.mjs
```

Expected: new Round 1 contract checks fail before the workflow edit.

- [ ] **Step 3: Update only affected `FIELD_RULES` entries**

Keep all candidate allow-list, cardinality, primary-role, conflict and existing
containment checks. `participation_guarantee` and
`required_official_certificates` must continue to defer unsafe `resolved` to
recheck/review. Do not relax a checker merely to accept the new prompt output.

- [ ] **Step 4: Run focused Aggregator tests**

```powershell
node --test tests/client-confirmed-field-semantics.test.mjs tests/aggregator-national-regime-option-state.test.mjs tests/semantic-containment-execution-14260.test.mjs
```

Expected: all new semantic assertions and existing containment scenarios pass.

- [ ] **Step 5: Commit Aggregator alignment**

```powershell
git add "workflows/n8n-exports/TENDER — Агрегация закупки.json" tests/client-confirmed-field-semantics.test.mjs
git commit -m "fix(aggregator): apply confirmed field semantics"
```

---

### Task 4: Align Targeted Recheck while retaining the four-key Round 2 gate

**Files:**
- Modify: `workflows/n8n-exports/TENDER - Targeted Recheck.json`
- Test: `tests/client-confirmed-field-semantics.test.mjs`
- Test: `tests/targeted-recheck-application-documents-route-execution-14429.test.mjs`
- Test: `tests/targeted-recheck-application-documents-execution-14173.test.mjs`

**Nodes:**
- `Подготовить #2 Targeted Recheck Request`
- `Подготовить запрос #2 Semantic Aggregator`
- `Определить путь после Validator`

- [ ] **Step 1: Add RED assertions for recheck profiles**

For each changed field, require search terms and rules that match the confirmed
scope. Assert separately that the Round 2 allow-list remains exactly:

```javascript
[
  'procurement_subject',
  'nm_price_with_vat',
  'delivery_term',
  'warranty_obligations_guarantee'
]
```

- [ ] **Step 2: Run and verify Targeted Recheck RED**

```powershell
node --test tests/client-confirmed-field-semantics.test.mjs tests/targeted-recheck-application-documents-route-execution-14429.test.mjs
```

Expected: profile assertions fail; route-guard baseline remains green.

- [ ] **Step 3: Update recheck profiles and only allowed Round 2 rules**

Do not route any additional key into Round 2. Non-allowlisted fields continue to
terminal audited `requires_review` when direct resolution is unsafe. Preserve
existing evidence validation, candidate identity and technical fallback.

- [ ] **Step 4: Run focused Targeted Recheck tests**

```powershell
node --test tests/client-confirmed-field-semantics.test.mjs tests/targeted-recheck-application-documents-route-execution-14429.test.mjs tests/targeted-recheck-application-documents-execution-14173.test.mjs
```

Expected: all pass.

- [ ] **Step 5: Commit Targeted Recheck alignment**

```powershell
git add "workflows/n8n-exports/TENDER - Targeted Recheck.json" tests/client-confirmed-field-semantics.test.mjs
git commit -m "fix(recheck): align confirmed field profiles"
```

---

### Task 5: Align report presentation without reinterpreting FINAL

**Files:**
- Modify: `workflows/n8n-exports/TENDER — Генерация отчета.json`
- Modify: `workflows/report-generation.md`
- Test: `tests/client-confirmed-field-semantics.test.mjs`
- Create: `tests/report-generation-client-confirmed-semantics.test.mjs`

**Nodes:**
- `Адаптировать поля отчёта3`
- `Проверить Report Model2`
- `Сгенерировать HTML1`

- [ ] **Step 1: Add RED report-model assertions**

Require the adapter/model to expose the procurement/notice number from existing
tender metadata and the confirmed presentation modes. The test must prove the
report still has exactly 27 field rows and that the number is report metadata,
not field 28 or part of `platform`.

Use explicit presentation metadata such as:

```javascript
{
  nm_price_with_vat: 'amount_and_vat_separate',
  payment_terms: 'structured_and_full_text',
  national_regime: 'four_way_without_legal_basis',
  application_documents: 'concise_from_complete_final'
}
```

- [ ] **Step 2: Run and verify report RED**

```powershell
node --test tests/client-confirmed-field-semantics.test.mjs tests/report-generation-client-confirmed-semantics.test.mjs
```

Expected: new presentation assertions fail before the workflow edit.

- [ ] **Step 3: Implement deterministic presentation**

The adapter may transform only already-confirmed FINAL text and metadata. It may
not use AI, change FINAL status, add a fact, infer a missing subvalue, or turn
`not_found` into `Нет`/`Не применяется`. If the legacy `value_text` cannot be
split deterministically, show the full text and retain `requires_review` rather
than guessing a structure.

- [ ] **Step 4: Run report tests**

```powershell
node --test tests/client-confirmed-field-semantics.test.mjs tests/report-generation-client-confirmed-semantics.test.mjs
```

Expected: all pass and the report row count remains 27.

- [ ] **Step 5: Commit report alignment**

```powershell
git add "workflows/n8n-exports/TENDER — Генерация отчета.json" workflows/report-generation.md tests/client-confirmed-field-semantics.test.mjs tests/report-generation-client-confirmed-semantics.test.mjs
git commit -m "fix(report): apply confirmed client presentation"
```

---

### Task 6: Verify the complete local candidate and prepare runtime canary

**Files:**
- Modify: `PROJECT_STATUS.md`
- Modify: `TECH_DEBT.md`
- Modify: `DEVELOPMENT_LOG.md`
- Create: `evaluations/CLIENT_FIELD_SEMANTICS_RUNTIME_<execution-id>_2026-09-07.md` only after an owner-started runtime execution exists

- [ ] **Step 1: Run the focused cross-workflow gate**

```powershell
node --test tests/client-confirmed-field-semantics.test.mjs
```

Expected: all decision-contract checks pass.

- [ ] **Step 2: Run the full offline suite**

```powershell
node --test tests/*.test.mjs
```

Expected: no new failure beyond exact pre-existing baseline signatures recorded
before Task 1. Compare test names and error signatures, not only counts.

- [ ] **Step 3: Validate package integrity**

Check all four JSON exports parse, all connection endpoints resolve, workflow
node names remain unique, canonical exports contain no `pinData`, top-level live
instance identity or credential literals, and the field-key list is still
exactly 27 unique values.

- [ ] **Step 4: Update project state before any live action**

Record local GREEN separately from runtime status. Explicitly keep these gates
open:

```text
test workflow import/read-back
fresh 27/27 runtime canary
manual semantic review of all 27 values
participation_cost platform-tariff source
production promotion
```

- [ ] **Step 5: Stop for owner-controlled test import and execution**

Do not modify or activate live n8n, change PostgreSQL data, or start a paid model
run without an explicit owner instruction. After the owner supplies execution
IDs, review exact model outputs, deterministic checks, FINAL values, report
presentation and DB 27/27 state.

- [ ] **Step 6: Commit documentation of the verified local candidate**

```powershell
git add PROJECT_STATUS.md TECH_DEBT.md DEVELOPMENT_LOG.md
git commit -m "docs: record client semantics implementation gate"
```

---

## Explicitly separate follow-up

`participation_cost` platform-tariff acquisition is not implemented by this
plan. Before building it, define and approve:

```text
authoritative tariff source
platform/procedure matching key
tariff effective-at date
winner-only applicability
source snapshot/audit retention
failure behavior when tariff lookup is unavailable
```

Until then, document-only absence remains `not_found` or `requires_review`, never
`бесплатно`.
