# Agentic Tender Analysis Stages 3–5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** добавить изолированный shadow-контур, который получает полный зарегистрированный комплект документов одной закупки, запускает по нему одного Codex-агента и сохраняет детерминированно проверенные результаты ровно по 27 полям, не заменяя и не перезаписывая существующий legacy-анализ.

**Architecture:** archive-aware Orchestrator сначала формирует и атомарно регистрирует полный `tender_document_ingestion_v1` manifest. После commit отдельный n8n sub-workflow последовательно копирует processable files во внутренний `tender-codex-runner`, запечатывает manifest по SHA-256 и запускает асинхронный `codex exec`. Runner создаёт механический source index, предоставляет агенту только job-local инструкции и документы, сохраняет JSONL audit и применяет downgrade-only validator. Scheduled n8n monitor забирает validated envelope и одной транзакцией сохраняет ровно 27 shadow rows. Существующие Worker, Aggregator, Targeted Recheck, Finalization и Report Generation продолжают работать без изменений.

**Tech Stack:** n8n (`Execute Workflow Trigger`, `Schedule Trigger`, `Code`, `If`, `Loop Over Items`, `HTTP Request`, `Postgres`, `Error Trigger`), PostgreSQL, Node.js 24, Codex CLI 0.153.4+, JSON Schema, Docker Compose, Poppler, LibreOffice headless, Tesseract OCR (`rus` + `eng`), OOXML ZIP/XML inspection, Node.js built-in test runner.

---

## 1. Граница плана и итоговая схема

Этот план реализует только ранее согласованные пункты 3–5:

```text
3. Подготовить одну полную папку закупки
4. Выполнить один полный агентский анализ Codex
5. Проверить, нормализовать и сохранить результат
```

Он опирается на аудит:

```text
docs/superpowers/specs/2026-09-08-agentic-analysis-integration-audit.md
```

Итог этапа:

```text
TenderPlan mark
→ Intake Resume
→ archive-aware Orchestrator
→ full manifest committed
→ TENDER — Агентский анализ — Запуск
→ tender-codex-runner
→ one Codex run
→ downgrade-only validation
→ TENDER — Агентский анализ — Монитор
→ exactly 27 tender_agentic_field_results
```

Одновременно сохраняется старый путь:

```text
full manifest committed
→ current Document Workers
→ Aggregator
→ Targeted Recheck
→ canonical 27 FINAL
→ Finalization
→ HTML/PDF report
```

Shadow path не пишет в `tender_analysis_field_results`, не меняет `analysis_run.status` и не вызывает production Report Generation.

## 2. Зафиксированные решения

1. Первый MVP использует одного агента без subagents и второго AI-reviewer.
2. Первый model baseline — `gpt-5.6-sol`, `model_reasoning_effort=high`, чтобы повторить условия blind test. Если этот model ID недоступен в выбранном auth mode, canary завершается `CODEX_MODEL_UNAVAILABLE`; автоматической подмены модели нет.
3. Agent не получает интернет, MCP-серверы, пользовательские skills/config или данные соседних jobs.
4. `FIELD_CATALOG.md` копируется в job как read-only snapshot; его SHA-256 сохраняется в БД и результате.
5. Agent ведёт `workspace/field-ledger.json` с самого начала и обновляет его по мере чтения документов. Финальный JSON формируется из ledger.
6. Runner не использует legacy facts, units или FINAL rows как вход анализа.
7. Механический source index применяется для навигации и проверки evidence, но не делает семантическое извлечение полей.
8. Validator может только подтвердить reported result или понизить его до `requires_review`. Он не повышает статус и не создаёт значение.
9. Сокращённая цитата с многоточием не считается ошибкой сама по себе. Она проверяется как последовательность точных фрагментов в одном location.
10. `not_found` допустим только после полной подтверждённой inspection coverage всех processable documents.
11. Большие binary и полные тексты документов не сохраняются в PostgreSQL или n8n execution JSON.
12. Codex runner не получает TenderPlan, n8n или PostgreSQL credentials.

## 3. Полная карта файлов

### Создать

```text
deploy/codex-runner/Dockerfile
deploy/codex-runner/compose.yaml
deploy/codex-runner/package.json
deploy/codex-runner/package-lock.json
deploy/codex-runner/README.md
deploy/codex-runner/src/config.mjs
deploy/codex-runner/src/errors.mjs
deploy/codex-runner/src/http-auth.mjs
deploy/codex-runner/src/job-store.mjs
deploy/codex-runner/src/manifest.mjs
deploy/codex-runner/src/source-index.mjs
deploy/codex-runner/src/source-index/pdf.mjs
deploy/codex-runner/src/source-index/docx.mjs
deploy/codex-runner/src/source-index/xlsx.mjs
deploy/codex-runner/src/codex-command.mjs
deploy/codex-runner/src/codex-events.mjs
deploy/codex-runner/src/schema-validation.mjs
deploy/codex-runner/src/result-validator.mjs
deploy/codex-runner/src/server.mjs
deploy/codex-runner/agent-template/AGENTS.md
deploy/codex-runner/agent-template/.agents/skills/tender-document-analysis/SKILL.md
deploy/codex-runner/prompts/tender-analysis-v1.txt
deploy/codex-runner/schemas/tender-agent-result-v1.schema.json
deploy/codex-runner/schemas/tender-agent-validation-v1.schema.json
deploy/codex-runner/policies/tender-fields-v1.json
deploy/postgres/migrations/2026-09-08-add-agentic-shadow-analysis.sql
workflows/n8n-exports/TENDER — Агентский анализ — Запуск.json
workflows/n8n-exports/TENDER — Агентский анализ — Монитор.json
workflows/n8n-exports/TENDER — Ошибка агентского анализа.json
workflows/agentic-analysis-dispatch.md
workflows/agentic-analysis-monitor.md
workflows/agentic-analysis-error.md
scripts/evaluate-agentic-result.mjs
tests/agentic-job-migration.test.mjs
tests/agentic-result-schema.test.mjs
tests/agentic-runner-manifest.test.mjs
tests/agentic-source-index-pdf.test.mjs
tests/agentic-source-index-docx.test.mjs
tests/agentic-source-index-xlsx.test.mjs
tests/agentic-codex-command.test.mjs
tests/agentic-result-validator.test.mjs
tests/agentic-runner-http.test.mjs
tests/agentic-runner-deployment.test.mjs
tests/agentic-dispatch-workflow.test.mjs
tests/agentic-monitor-workflow.test.mjs
tests/agentic-error-workflow.test.mjs
tests/intake-agentic-shadow-routing.test.mjs
tests/agentic-eval-harness.test.mjs
tests/fixtures/agentic/manifest-12-documents.json
tests/fixtures/agentic/source-index-minimal.json
tests/fixtures/agentic/results/valid-27.json
tests/fixtures/agentic/results/duplicate-field.json
tests/fixtures/agentic/results/conflict-resolved.json
tests/fixtures/agentic/results/ellipsis-valid.json
tests/fixtures/agentic/results/ellipsis-material-gap.json
tests/fixtures/agentic/results/absence-negative.json
tests/fixtures/agentic/results/incomplete-not-found.json
evaluations/agentic-baseline-v0/README.md
evaluations/agentic-baseline-v0/adjudication.json
evaluations/agentic-baseline-v0/source-manifest.sha256
```

### Изменить только после branch reconciliation

```text
workflows/n8n-exports/ТЕНДЕРЫ ОРКЕСТРАТОР.json
workflows/n8n-exports/TENDER — Intake Resume.json
workflows/orchestrator.md
workflows/intake-resume.md
DATA_MODEL.md
ARCHITECTURE.md
README.md
PROJECT_STATUS.md
TECH_DEBT.md
DEVELOPMENT_LOG.md
AGENTS.md
```

### Не изменять в stages 3–5

```text
FIELD_CATALOG.md
REPORT_FIELD_MAPPING.md
workflows/n8n-exports/TENDER — Обработать документ.json
workflows/n8n-exports/TENDER — Агрегация закупки.json
workflows/n8n-exports/TENDER - Targeted Recheck.json
workflows/n8n-exports/TENDER — Финализация анализа.json
workflows/n8n-exports/TENDER — Генерация отчета.json
```

## 4. Контракты данных

### 4.1. Runner job workspace

Физический путь формируется только из server-generated UUID:

```text
/data/jobs/<agentic_job_id>/
├── input/
│   ├── manifest.json
│   ├── FIELD_CATALOG.md
│   └── documents/<document_index>__<opaque_artifact_key>
├── source-index/
│   ├── source-index.json
│   ├── text/
│   ├── ooxml/
│   └── pages/
├── workspace/
│   ├── AGENTS.md
│   ├── .agents/skills/tender-document-analysis/SKILL.md
│   ├── field-ledger.json
│   └── output/result.json
└── audit/
    ├── runner-events.jsonl
    ├── codex-events.jsonl
    ├── validation.json
    └── status.json
```

`input/` и `source-index/` находятся вне writable Codex CWD. Codex запускается с `-C .../workspace`; после завершения runner атомарно копирует validated artifacts в `audit/` и делает job immutable.

### 4.2. Agent result

Top-level `tender_agent_result_v1`:

```json
{
  "schema_version": "tender_agent_result_v1",
  "field_catalog_version": "tender_fields_v1",
  "field_catalog_sha256": "64-char hex",
  "input_manifest_sha256": "64-char hex",
  "inspection_coverage": [],
  "fields": []
}
```

Каждый `inspection_coverage[]` содержит:

```text
artifact_key
source_file
inspection_status = complete | incomplete | unreadable
methods[] = text_layer | rendered_pages | ooxml | controls | sheets
expected_pages / inspected_pages
notes
```

Каждый из ровно 27 `fields[]` содержит:

```text
field_index
field_key
status = resolved | requires_review | not_found
value_text = string | null
claim_basis = explicit_positive | explicit_negative | selected_control |
              aggregated_explicit | absence_only | unresolved_conflict
evidence[]
conflicts[]
rationale
```

Evidence использует stable `artifact_key`, а не свободное имя файла:

```json
{
  "artifact_key": "doc-0007",
  "location": {
    "kind": "pdf_page | docx_page | docx_ooxml | xlsx_cell | metadata",
    "page": 3,
    "page_to": 3,
    "section": null,
    "structural_element": null,
    "sheet": null,
    "cell_range": null
  },
  "quote_mode": "exact | ordered_fragments",
  "quote": "display form preserved for audit",
  "fragments": ["first exact fragment", "second exact fragment"]
}
```

Для `quote_mode=exact` `fragments` пуст. Для `ordered_fragments` требуется минимум два непустых фрагмента; многоточие в `quote` — только presentation, проверка выполняется по `fragments`.

### 4.3. Validation envelope

```text
schema_version = tender_agent_validation_v1
job_id
valid = true | false
job_issues[]
fields[27]
  reported_status
  effective_status
  reported_value_text
  effective_value_text
  validation_level = pass | warning | downgraded
  issues[]
raw_result_sha256
validated_result_sha256
```

`valid=true` означает, что envelope имеет точные 27 rows и может быть сохранён в shadow tables. Это не означает, что все 27 полей `resolved`.

### 4.4. Runner HTTP API

Сервис слушает только internal Docker network `:8080` и требует Header Auth `X-Tender-Runner-Key` для всех `/v1/*` endpoints:

```text
GET    /health
PUT    /v1/jobs/{job_id}
PUT    /v1/jobs/{job_id}/documents/{artifact_key}
POST   /v1/jobs/{job_id}/seal
POST   /v1/jobs/{job_id}/start
GET    /v1/jobs/{job_id}
GET    /v1/jobs/{job_id}/result
DELETE /v1/jobs/{job_id}
```

Document upload is raw binary. Required headers are `X-Content-SHA256`, `X-Source-Document-Id`, `X-File-Name-Base64`, `Content-Type`. Repeating identical bytes is an idempotent success; a different hash for the same `artifact_key` returns `409 JOB_ARTIFACT_CONFLICT`.

`POST /start` returns `202` after the child process is created. It never waits for Codex completion.

### 4.5. PostgreSQL shadow schema

`tender_agentic_jobs` owns lifecycle:

```text
id uuid PK
analysis_run_id uuid FK → tender_analysis_runs(id) ON DELETE CASCADE
pipeline_version text NOT NULL
replicate_index smallint NOT NULL DEFAULT 1 CHECK >= 1
status text CHECK created|staging|ready|running|validating|completed|failed|canceled
model text NOT NULL
reasoning_effort text NOT NULL
field_catalog_version text NOT NULL
field_catalog_sha256 text NOT NULL
input_manifest_sha256 text
expected_documents integer NOT NULL CHECK >= 0
staged_documents integer NOT NULL DEFAULT 0 CHECK >= 0
attempts smallint NOT NULL DEFAULT 0 CHECK BETWEEN 0 AND 2
dispatch_execution_id text
poll_owner_execution_id text
poll_claimed_at timestamptz
runner_started_at / heartbeat_at / completed_at timestamptz
input_tokens / cached_input_tokens / output_tokens / reasoning_output_tokens bigint
artifacts jsonb NOT NULL DEFAULT '{}'
validation_summary jsonb NOT NULL DEFAULT '{}'
error_code / error_message text
created_at / updated_at timestamptz NOT NULL
UNIQUE (analysis_run_id, pipeline_version, replicate_index)
UNIQUE (id, analysis_run_id)
UNIQUE (id, analysis_run_id, field_catalog_version)
```

`tender_agentic_documents` owns staging barrier:

```text
job_id uuid NOT NULL
analysis_run_id uuid NOT NULL
source_document_id uuid NOT NULL
artifact_key text NOT NULL
document_index integer NOT NULL
file_name text
mime_type text
source_sha256 text
staged_sha256 text
byte_size bigint
status text CHECK pending|uploading|staged|failed
runner_storage_key text
error_code / error_message text
created_at / updated_at timestamptz NOT NULL
PRIMARY KEY (job_id, source_document_id)
UNIQUE (job_id, artifact_key)
UNIQUE (job_id, document_index)
FOREIGN KEY (job_id, analysis_run_id) → tender_agentic_jobs(id, analysis_run_id) ON DELETE CASCADE
FOREIGN KEY (source_document_id, analysis_run_id) → tender_analysis_documents(id, analysis_run_id) ON DELETE CASCADE
```

`tender_agentic_field_results` owns the 27 shadow rows:

```text
job_id uuid NOT NULL
analysis_run_id uuid FK → tender_analysis_runs(id) ON DELETE CASCADE
field_catalog_version text NOT NULL
field_index smallint CHECK BETWEEN 1 AND 27
field_key text NOT NULL
reported_status text CHECK resolved|requires_review|not_found
effective_status text CHECK resolved|requires_review|not_found
reported_value_text text
effective_value_text text
requires_human_review boolean NOT NULL
validation_level text CHECK pass|warning|downgraded
result_json jsonb NOT NULL
created_at / updated_at timestamptz NOT NULL
PRIMARY KEY (job_id, field_key)
UNIQUE (job_id, field_index)
FOREIGN KEY (job_id, analysis_run_id, field_catalog_version) → tender_agentic_jobs(id, analysis_run_id, field_catalog_version) ON DELETE CASCADE
```

The migration adds no column or constraint to the existing canonical five tables.

## 5. Validation policy

Validation executes in this order:

1. JSON Schema and immutable hash checks.
2. Exact 27 `field_index`/`field_key` catalog mapping and uniqueness.
3. Status/value invariants.
4. Complete source coverage and document identity checks.
5. Location and quote verification.
6. Conflict and negative-conclusion safety.
7. Field-specific completeness and arithmetic checks.
8. Downgrade-only normalization.
9. Atomic 27-row persistence check.

Exact/fragment matching normalizes only:

```text
Unicode NFC
line endings
repeated whitespace
non-breaking spaces
typographic/straight quotation marks
hyphen/dash presentation variants
```

It does not normalize away digits, currency, percentages, signs, `не`, selected/unselected markers or option values.

For ordered fragments, all fragments must occur in order inside the same indexed location. The result becomes a warning, not an error, when the skipped interval is short and contains no competing number/date/negation/control marker. It is downgraded when the gap contains such a material token or crosses a page/block boundary.

Required issue codes:

```text
FIELD_SET_MISMATCH
DUPLICATE_FIELD
STATUS_INVALID
VALUE_REQUIRED
SOURCE_UNKNOWN
INSPECTION_INCOMPLETE
LOCATOR_INVALID
QUOTE_NOT_VERIFIED
ELLIPSIS_FRAGMENT_MISMATCH
ELLIPSIS_MATERIAL_GAP
CONFLICT_BLOCKS_RESOLVED
NEGATIVE_BASIS_MISSING
NOT_FOUND_WITH_INCOMPLETE_COVERAGE
COMPLETENESS_PROOF_MISSING
ARITHMETIC_MISMATCH
CATALOG_HASH_MISMATCH
MANIFEST_HASH_MISMATCH
```

## 6. Implementation tasks

### Parallel execution lanes

Работу не нужно полностью останавливать до объединения текущих веток:

```text
Lane A — можно начинать сейчас, независимо
Tasks 1–10: provisional evaluation baseline, schema, shadow migration, runner, source index,
skill, Codex execution, validator and runner lifecycle

Lane B — требует завершённого reconciliation
Task 0: объединить актуальные intake + archive + report baselines

Lane C — только после A + B
Tasks 11–14: n8n Dispatch, Monitor, Error и shadow wiring

Lane D — после готовой реализации
Tasks 15–17: repeatability eval, isolated deployment, controlled activation
```

Lane A не редактирует существующие workflow и поэтому может идти параллельно с завершением TenderPlan intake. Lane C не начинается на устаревшем Orchestrator export.

### Task 0: Reconcile the implementation baseline before touching shared workflows

**Files:** no implementation file changes; create the integration branch/worktree only.

- [ ] Start a fresh `codex/agentic-analysis-integration` worktree from the reviewed commit that contains current `main` Report PDF changes.
- [ ] Merge or cherry-pick the final `codex/tenderplan-intake-resume` series through `2701bc8`; this current sibling tip supersedes the earlier `cec69c0` plan reference. Resolve only documented conflicts.
- [ ] Merge or cherry-pick `codex/archive-ingestion` through `f596755`.
- [ ] Confirm the resulting tree contains the latest intake migration, archive service, `TENDER — Подготовить документацию`, current PDF report export and blind-test evaluation archive.
- [ ] Compare every shared workflow export with live n8n again. Record exact workflow IDs, active flags, node counts, version IDs and downstream targets in `PROJECT_STATUS.md`.
- [ ] Resolve the Worker routing conflict explicitly before any canary: choose one inactive test Worker and one matching test Aggregator; do not preserve a route to inactive legacy Aggregator by accident.
- [ ] Run the focused intake, archive and report suites.

Run:

```powershell
node --test tests/tender*.test.mjs tests/archive-*.test.mjs tests/document-preparation-workflow.test.mjs tests/report-generation-pdf.test.mjs
```

Expected: all current tests pass with no new failure signature. If accepted historical failures still exist in the integrated branch, record their exact names and counts before agentic changes.

**Commit:**

- [ ] Commit only the reconciliation:

```text
chore: reconcile intake archive and report baselines
```

**Gate:** one clean integration branch contains all three prerequisites; no production workflow or DB state changed.

### Task 1: Build a provisional four-run evaluation baseline v0

**Files:**

```text
evaluations/agentic-baseline-v0/README.md
evaluations/agentic-baseline-v0/adjudication.json
evaluations/agentic-baseline-v0/source-manifest.sha256
tests/agentic-eval-harness.test.mjs
scripts/evaluate-agentic-result.mjs
```

- [ ] Write `tests/agentic-eval-harness.test.mjs` first. It must fail because the complete baseline v0 and evaluator do not yet exist.
- [ ] Build `adjudication.json` from the four immutable archived runs plus the already completed `comparison.md` spot-check. Record exactly 27 `FIELD_CATALOG.md` keys, every reported status, accepted status set, `source_checked|cross_run_consensus|known_disagreement` confidence, mandatory material facts, forbidden conclusions, source anchors and notes.
- [ ] Mark every field not checked against a source as `source_check_status=not_source_verified` with empty source anchors. Do not promote run agreement or citation presence into source truth.
- [ ] Preserve the reviewed decisions: 22/27 unanimous statuses; `customer_contacts=resolved`; `participation_cost=not_found`; `national_regime=requires_review`; conservative `similar_supply_experience=requires_review`; `application_documents=requires_review`; derived `procurement_subject` count 11 rather than 10; strict `licenses_certificates` scope.
- [ ] Pin the SHA-256 of all 12 archived source files and the archived `inputs/FIELD_CATALOG.md` in `source-manifest.sha256`.
- [ ] Implement `scripts/evaluate-agentic-result.mjs` with explicit typed adapters for all four archived Markdown label variants and future `tender_agent_result_v1` JSON. Report structural pass, status agreement, critical false-resolved count, unsupported negative count, evidence verification rate, field-level diffs and baseline limitations as machine-readable JSON.
- [ ] Return a typed unsupported-format error with nonzero exit for unexpected input. Do not use fuzzy semantics or treat an archived citation as source verification.
- [ ] Document that baseline v0 is provisional, is not full source-grounded manual truth and cannot be a production acceptance gate.

Run:

```powershell
node --test tests/agentic-eval-harness.test.mjs
node scripts/evaluate-agentic-result.mjs evaluations/codex-agentic-blind-test-2026-09-08/raw/exec/codex-result.md
```

Expected: all four historical Markdown reports produce exact 27-field typed evaluations, future JSON uses its own adapter, and unsupported input fails with a typed nonzero result.

- [ ] Commit:

```text
test(agentic): add provisional four-run evaluation baseline
```

**Gate:** shadow-MVP regressions can be measured against an explicitly limited four-run baseline. A complete source-grounded manual adjudication of all 27 fields remains a separate future production gate and does not block stages 3–5 shadow MVP work.

### Task 2: Define and test the agent result schemas and field policy mirror

**Files:**

```text
deploy/codex-runner/package.json
deploy/codex-runner/package-lock.json
deploy/codex-runner/src/schema-validation.mjs
deploy/codex-runner/schemas/tender-agent-result-v1.schema.json
deploy/codex-runner/schemas/tender-agent-validation-v1.schema.json
deploy/codex-runner/policies/tender-fields-v1.json
tests/agentic-result-schema.test.mjs
tests/fixtures/agentic/results/*.json
```

- [ ] Write failing schema tests for missing field, duplicate key/index, unknown status, `resolved` without value/evidence, `not_found` with value, invalid evidence location and malformed ordered fragments.
- [ ] Add one valid exact-quote fixture and one valid ellipsized/ordered-fragment fixture.
- [ ] Pin `ajv@8.20.0` and `ajv-formats@3.0.1` exactly, commit the lockfile and compile both Draft 2020-12 schemas through the reusable strict Ajv boundary used later by Task 9.
- [ ] Implement the two JSON Schemas with `additionalProperties=false` at every controlled object level.
- [ ] Build `tender-fields-v1.json` as an executable validation-policy mirror keyed by all 27 `field_key` values. Store the expected catalog SHA and only mechanical guards: negative-result sensitivity, completeness requirement, arithmetic/date type, selected-control requirement.
- [ ] Add a test proving exact one-to-one mapping with `FIELD_CATALOG.md`; a missing or extra policy key is a hard failure.

Run:

```powershell
node --test tests/agentic-result-schema.test.mjs
```

Expected: all schema/policy cases pass and the valid ellipsis fixture remains accepted.

- [ ] Commit:

```text
feat(agentic): define structured 27-field result contracts
```

**Gate:** `codex exec --output-schema` can target one closed versioned schema and no presentation difference is confused with a semantic error.

### Task 3: Add additive shadow persistence

**Files:**

```text
deploy/postgres/migrations/2026-09-08-add-agentic-shadow-analysis.sql
tests/agentic-job-migration.test.mjs
```

- [ ] Write failing migration contract tests for all columns, FKs, unique keys, status checks, field range and idempotent reapplication.
- [ ] Add fail-closed preconditions confirming the five canonical tables have not changed unexpectedly.
- [ ] Acquire fixed-order `SHARE UPDATE EXCLUSIVE` locks on all five canonical parents and safely lock every pre-existing ordinary shadow table before catalog inspection. This blocks concurrent schema changes such as `ADD FOREIGN KEY` and `VALIDATE CONSTRAINT` while allowing normal `RowExclusiveLock` DML.
- [ ] Implement the three new tables and their indexes in one transaction.
- [ ] Enforce job/document/result ownership with composite run identity FKs, and enforce result `field_catalog_version` against its owning job in PostgreSQL.
- [ ] Add indexes for monitor queries: `(status, heartbeat_at)`, `(poll_claimed_at)` and `(analysis_run_id)`.
- [ ] Add a transaction-level postcondition that inspects catalogs and aborts if any table/constraint differs from the planned contract.
- [ ] Test against an empty fixture schema and a populated fixture schema without updating existing rows.

Run:

```powershell
node --test tests/agentic-job-migration.test.mjs
```

Expected: migration contract passes twice; canonical table definitions remain byte-identical in the fixture snapshot.

The default local run may explicitly skip the real PostgreSQL fixture when neither
`psql` nor Docker is available. CI/promotion uses
`AGENTIC_REQUIRE_POSTGRES_RUNTIME=1`, which turns that condition into a failure.
An external fixture URL additionally requires a database named exactly
`agentic_shadow_test_<8-64 lowercase hex>` and
`AGENTIC_TEST_ALLOW_DESTRUCTIVE_RESET=DROP_PUBLIC_SCHEMA_FOR_AGENTIC_SHADOW_TEST_ONLY`;
the harness refuses to reset it unless the complete `public` object inventory is empty.

- [ ] Commit:

```text
feat(db): add isolated agentic shadow persistence
```

**Gate:** agentic jobs/results cannot collide with legacy facts or FINAL rows.

### Task 4: Build the isolated runner shell and deployment boundary

**Files:**

```text
deploy/codex-runner/package.json
deploy/codex-runner/Dockerfile
deploy/codex-runner/compose.yaml
deploy/codex-runner/README.md
deploy/codex-runner/src/config.mjs
deploy/codex-runner/src/errors.mjs
deploy/codex-runner/src/http-auth.mjs
deploy/codex-runner/src/server.mjs
tests/agentic-runner-deployment.test.mjs
tests/agentic-runner-http.test.mjs
```

- [ ] Write failing deployment tests asserting no host port, non-root UID/GID, read-only root filesystem, dropped capabilities, `no-new-privileges`, healthcheck, exact writable data volume and explicit CPU/memory/PID limits.
- [ ] Pin Node, Codex CLI, Poppler, LibreOffice, Tesseract and language packages in the image.
- [ ] Expose `GET /health` with schema `tender_codex_runner_health_v1`, version, tool versions, auth readiness and writable-store readiness; never return secret values.
- [ ] Require constant-time Header Auth on `/v1/*`; health remains non-sensitive and internal-only.
- [ ] Configure maximum one running Codex process and bounded queued jobs for the first MVP.
- [ ] Set runner request body limits: document 50 MiB, JSON 2 MiB.
- [ ] Add typed errors and safe messages capped at 500 characters.

Run:

```powershell
node --test tests/agentic-runner-deployment.test.mjs tests/agentic-runner-http.test.mjs
docker compose -f deploy/codex-runner/compose.yaml config
```

Expected: tests pass; Compose has no published ports and only `/data/jobs` is writable.

- [ ] Commit:

```text
feat(agentic): scaffold isolated codex runner
```

**Gate:** service is isolated like the archive extractor and cannot read n8n/PostgreSQL/TenderPlan credentials.

### Task 5: Implement immutable manifest and one-folder staging

**Files:**

```text
deploy/codex-runner/src/job-store.mjs
deploy/codex-runner/src/manifest.mjs
tests/agentic-runner-manifest.test.mjs
tests/fixtures/agentic/manifest-12-documents.json
```

- [ ] Write failing tests for job path traversal, non-UUID job ID, duplicate artifact key, duplicate document index, source/hash mismatch, repeated identical upload, conflicting repeated upload, seal before full upload and mutation after seal.
- [ ] Implement exact job path resolution without glob or user-supplied path fragments.
- [ ] Implement `PUT /jobs`, per-document upload to a temporary file, streamed SHA-256/size verification and atomic rename.
- [ ] Generate physical names from `document_index + artifact_key`; store original file names only inside manifest metadata.
- [ ] Seal only when uploaded count and hashes exactly match the expected processable documents.
- [ ] Copy the current `FIELD_CATALOG.md` snapshot into `input/`, compute its SHA and reject a caller-provided mismatch.
- [ ] Make sealed inputs immutable to all later HTTP operations.

Run:

```powershell
node --test tests/agentic-runner-manifest.test.mjs tests/agentic-runner-http.test.mjs
```

Expected: all idempotency and traversal cases pass; a sealed 12-document fixture has stable manifest/catalog hashes.

- [ ] Commit:

```text
feat(agentic): stage immutable procurement job folders
```

**Gate:** one procurement job has one complete, hashed, isolated source folder before Codex starts.

### Task 6: Build the mechanical source index

**Files:**

```text
deploy/codex-runner/src/source-index.mjs
deploy/codex-runner/src/source-index/pdf.mjs
deploy/codex-runner/src/source-index/docx.mjs
deploy/codex-runner/src/source-index/xlsx.mjs
tests/agentic-source-index-pdf.test.mjs
tests/agentic-source-index-docx.test.mjs
tests/agentic-source-index-xlsx.test.mjs
tests/fixtures/agentic/source-index-minimal.json
```

- [ ] Write PDF tests for text-layer pages, scanned pages, mixed pages, exact page count, rendering of every page and OCR fallback.
- [ ] Write DOCX tests for paragraphs, tables, headers/footers, comments/footnotes, SDT, legacy form fields and ActiveX selected/unselected controls. Include the existing sanitized control fixtures instead of new client data.
- [ ] Write XLSX tests for visible/hidden sheets, cells, formulas, displayed values, merged ranges and stable cell coordinates.
- [ ] Implement one versioned `tender_source_index_v1` that maps every indexed unit back to `artifact_key` and page/OOXML/sheet coordinates.
- [ ] Render every PDF page and every DOCX page to PNG; retain page count and image hash. Run OCR only where the text layer is absent or below the configured character threshold.
- [ ] Extract OOXML structurally without treating a label as selected unless the related control state proves it.
- [ ] Record `complete`, `incomplete` or `unreadable` per document. Never silently omit a failed page or part.
- [ ] Fail job start if no processable document is readable. Allow partial indexing only with explicit coverage flags that later block `not_found` and unsafe `resolved` fields.

Run:

```powershell
node --test tests/agentic-source-index-pdf.test.mjs tests/agentic-source-index-docx.test.mjs tests/agentic-source-index-xlsx.test.mjs
```

Expected: every fixture page/sheet/control has stable provenance and no missing element is reported as successful coverage.

- [ ] Commit:

```text
feat(agentic): index complete document packages for audit
```

**Gate:** agent and validator can address the full document set without reusing legacy semantic facts.

### Task 7: Create the dedicated agent workspace, skill and prompt

**Files:**

```text
deploy/codex-runner/agent-template/AGENTS.md
deploy/codex-runner/agent-template/.agents/skills/tender-document-analysis/SKILL.md
deploy/codex-runner/prompts/tender-analysis-v1.txt
tests/agentic-codex-command.test.mjs
```

- [ ] Write failing tests proving the job workspace contains exactly one repository skill, no inherited project files, no user skill paths and no writable source document path.
- [ ] Write the skill with a document-by-document pass, incremental 27-field ledger updates, full page/control coverage, conflict handling and a final cross-document review.
- [ ] Require the agent to inspect the raw document when the mechanical index is ambiguous; the index is a navigation aid, not authoritative semantics.
- [ ] Require `claim_basis`, evidence fragments, conflicts and inspection coverage explicitly.
- [ ] Require a final self-check against the exact 27 catalog keys before returning JSON.
- [ ] Keep the runtime prompt short: identify job paths, schema and required output; put stable procedure in the skill.
- [ ] Add no generic work skills, n8n skills, browser tools or project development instructions to the job.

Run:

```powershell
node --test tests/agentic-codex-command.test.mjs
```

Expected: the isolation assertions pass and the prompt/skill contain no download URL, credential or client-specific answer.

- [ ] Commit:

```text
feat(agentic): add focused tender analysis skill
```

**Gate:** the agent sees only the rules needed for procurement analysis and the exact current job.

### Task 8: Implement auditable non-interactive Codex execution

**Files:**

```text
deploy/codex-runner/src/codex-command.mjs
deploy/codex-runner/src/codex-events.mjs
tests/agentic-codex-command.test.mjs
```

- [ ] Build an argv array without shell interpolation. Never compose a shell command string.
- [ ] Import `buildCodexPermissionBoundary` and include `buildCodexPermissionBoundary({ jobId }).cliArgs` unchanged in every invocation. Explicitly forbid both legacy forms: reject `--sandbox`/`-s` and every `sandbox_workspace_write.*` override before spawn. Callers cannot append permission or shell-environment overrides after the boundary arguments.
- [ ] Pin the baseline invocation semantically equivalent to:

```text
codex exec
  <...buildCodexPermissionBoundary({ jobId }).cliArgs>
  --ephemeral
  --ignore-rules
  --model gpt-5.6-sol
  -c model_reasoning_effort="high"
  -c tools.web_search=false
  -c tools.view_image=true
  -C <job>/workspace
  --skip-git-repo-check
  --output-schema <runner>/schemas/tender-agent-result-v1.schema.json
  --json
  -o output/result.json
  -
```

- [ ] Pipe the prompt over stdin, capture stdout line-by-line to `audit/codex-events.jsonl`, and keep stderr in a bounded safe runner log.
- [ ] Verify in an isolated canary that the sandbox can read the sibling read-only `input/` and `source-index/` trees, can inspect rendered page images, and cannot modify them.
- [ ] Parse `thread.started`, `turn.completed`, `turn.failed` and `error`; persist input, cached-input, output and reasoning-output token counts.
- [ ] Enforce wall-clock timeout of 90 minutes and graceful termination followed by forced termination after 30 seconds.
- [ ] Permit one automatic second attempt only for typed transport/process failures with no valid result. Preserve attempt-1 artifacts. Schema/semantic validation never triggers a paid retry automatically.
- [ ] Redact environment keys containing `KEY`, `SECRET`, `TOKEN`, `PASSWORD` and exact credentials from any subprocess tool environment and log.
- [ ] Add a fake Codex executable fixture to test success, invalid JSONL, nonzero exit, timeout and token accounting without paid calls.

Run:

```powershell
node --test tests/agentic-codex-command.test.mjs
```

Expected: fake runs produce deterministic audit artifacts; no secret-like environment variable reaches the fake agent shell.

- [ ] Commit:

```text
feat(agentic): run codex with structured audited output
```

**Gate:** Codex can run for a long time without holding an n8n execution and every attempt has complete technical audit.

### Task 9: Implement downgrade-only result validation

**Files:**

```text
deploy/codex-runner/src/result-validator.mjs
tests/agentic-result-validator.test.mjs
tests/fixtures/agentic/results/*.json
```

- [ ] Write one failing test per required issue code before implementation.
- [ ] Validate immutable catalog and manifest hashes before reading fields.
- [ ] Validate exact 27 keys and indexes before field-level processing; a structural mismatch fails the whole job.
- [ ] Keep inspection-coverage artifact uniqueness, `page <= page_to` ordering and evidence-to-artifact/manifest linkage in this Task 9 validation layer; the Task 2 schema boundary validates their closed structural shapes only.
- [ ] Resolve evidence only through `artifact_key` and indexed location; never accept a free filename match.
- [ ] Implement exact and ordered-fragment verification with the normalization boundary in section 5.
- [ ] Preserve shortened quotes when verified; do not require a whole source sentence or reject a harmless ellipsis.
- [ ] Block `resolved` when `conflicts[]` contains an unresolved material conflict or `claim_basis=unresolved_conflict`.
- [ ] Block absence-derived negative conclusions. `explicit_negative` and `selected_control` require supporting negative/control evidence at the declared location.
- [ ] Convert `not_found` to effective `requires_review` whenever inspection coverage is incomplete or unreadable.
- [ ] Implement field-specific containment from the policy mirror, including completeness-critical list/guarantee fields and exact arithmetic for price/VAT.
- [ ] Keep `reported_*` intact and add only `effective_*`, issue codes and review flag.
- [ ] Validate the generated `tender_agent_validation_v1` envelope against its own schema.

Run:

```powershell
node --test tests/agentic-result-validator.test.mjs tests/agentic-result-schema.test.mjs
```

Expected: all unsafe fixtures are downgraded or rejected at the documented level; `ellipsis-valid.json` passes and `ellipsis-material-gap.json` is downgraded.

- [ ] Commit:

```text
feat(agentic): validate evidence and downgrade unsafe fields
```

**Gate:** known blind-test false-resolved patterns cannot pass straight through as effective `resolved`.

### Task 10: Complete runner job lifecycle API

**Files:**

```text
deploy/codex-runner/src/job-store.mjs
deploy/codex-runner/src/server.mjs
tests/agentic-runner-http.test.mjs
```

- [ ] Write failing state-transition tests for create→staging→ready→running→validating→completed and every invalid transition.
- [ ] Make `/seal` build source index before marking `ready`.
- [ ] Make `/start` idempotent: repeated start of running/completed returns current state; it never starts a second child.
- [ ] After Codex exit, validate the result before marking completed.
- [ ] Return only bounded metadata from `/jobs/{id}`; return result/validation artifacts only from `/result`.
- [ ] On runner restart, mark an orphaned `running` child as typed recoverable failure. n8n may start attempt 2 under the same job; the service must never guess that the child still runs.
- [ ] Implement exact-job cleanup only for completed/failed jobs older than seven days; TTL cleanup must not touch active jobs.

Run:

```powershell
node --test tests/agentic-runner-http.test.mjs tests/agentic-runner-manifest.test.mjs tests/agentic-result-validator.test.mjs
```

Expected: lifecycle and restart simulations pass with one child maximum and preserved prior-attempt audit.

- [ ] Commit:

```text
feat(agentic): complete asynchronous runner lifecycle
```

**Gate:** runner status is restart-safe, idempotent and consumable by a polling n8n workflow.

### Task 11: Build `TENDER — Агентский анализ — Запуск`

**Files:**

```text
workflows/n8n-exports/TENDER — Агентский анализ — Запуск.json
workflows/agentic-analysis-dispatch.md
tests/agentic-dispatch-workflow.test.mjs
```

Required typed input:

```json
{
  "analysis_run_id": "uuid",
  "pipeline_version": "tender_agentic_pipeline_v1",
  "replicate_index": 1
}
```

- [ ] Write failing topology and Code-node contract tests first.
- [ ] Use a typed Execute Workflow Trigger and validate UUID/version/index.
- [ ] Atomically create or load one `tender_agentic_jobs` row. A completed/running job is a structured no-op; a failed job is not restarted unless its attempt policy explicitly permits it.
- [ ] Load the run and all processable registered documents from PostgreSQL only after `registered_count=documents_total`. Reject failed, missing or zero-processable manifests.
- [ ] Insert one `tender_agentic_documents` row per processable source document before the first upload.
- [ ] Loop with batch size 1. Download each source with the same proven HTTP Request binary settings as the current Worker, then stream it to the runner.
- [ ] Never store the binary in a Code node JSON field or execution log.
- [ ] Verify upload response identity/hash, then update that one staging row to `staged`.
- [ ] Apply a DB-backed barrier: exact expected count, all `staged`, zero pending/uploading/failed, unique index/artifact key.
- [ ] Call `/seal`, verify manifest/catalog hashes, call `/start`, then atomically mark DB job `running` with the dispatch execution ID.
- [ ] Route every download/upload/seal/start error to a typed failure branch that records job/document error without exposing URL or binary.
- [ ] Bind runner Header Auth through n8n Credentials; store no secret in the export.

Run:

```powershell
node --test tests/agentic-dispatch-workflow.test.mjs
```

Expected: synthetic 12-document input produces 12 staged rows, one seal and one start; duplicate invocation performs zero duplicate upload/start side effects.

- [ ] Commit:

```text
feat(n8n): add idempotent agentic dispatch workflow
```

**Gate:** a complete registered procurement becomes one sealed runner job; incomplete registration can never start Codex.

### Task 12: Build `TENDER — Агентский анализ — Монитор`

**Files:**

```text
workflows/n8n-exports/TENDER — Агентский анализ — Монитор.json
workflows/agentic-analysis-monitor.md
tests/agentic-monitor-workflow.test.mjs
```

- [ ] Write failing tests for poll lease ownership, running heartbeat, completed result ingestion, invalid envelope, runner failure, stale lease reclaim and duplicate polling.
- [ ] Trigger every minute and select at most two pollable jobs.
- [ ] Claim each job with `FOR UPDATE SKIP LOCKED`, `poll_owner_execution_id` and a five-minute stale lease.
- [ ] Poll the runner without holding a PostgreSQL transaction open.
- [ ] For `ready/running/validating`, update only heartbeat/usage/artifact metadata and release the lease.
- [ ] For runner failure, persist typed error and all available audit metadata; do not generate 27 fake `not_found` rows.
- [ ] For completed runner jobs, fetch the validation envelope, verify job/run/version/hash identity and exact 27 items.
- [ ] In one SQL transaction UPSERT all 27 shadow field rows, assert exact `count=27` and exact catalog set, then mark the job completed. Roll back the entire transaction on any mismatch.
- [ ] A repeated completed poll must be a byte-compatible no-op.
- [ ] Store only bounded validation/audit metadata in DB; retain full JSONL in runner artifacts.

Run:

```powershell
node --test tests/agentic-monitor-workflow.test.mjs
```

Expected: exact 27 rows and completed job appear atomically; no partial field set survives an injected failure.

- [ ] Commit:

```text
feat(n8n): persist validated agentic shadow results
```

**Gate:** PostgreSQL, not n8n Merge state, proves completion of the shadow 27/27 result.

### Task 13: Build the agentic workflow-level error handler

**Files:**

```text
workflows/n8n-exports/TENDER — Ошибка агентского анализа.json
workflows/agentic-analysis-error.md
tests/agentic-error-workflow.test.mjs
```

- [ ] Write failing tests for Dispatch owner failure, Monitor owner failure, missing execution identity and already-terminal job.
- [ ] For Dispatch failure in `created/staging/ready`, guarded-update only jobs owned by that exact execution to `failed`; preserve staged document rows and runner artifacts.
- [ ] For Monitor failure, release only the exact poll lease and increment bounded monitor error audit. Do not mark a still-running Codex job failed merely because polling failed.
- [ ] Never alter completed/canceled jobs.
- [ ] Configure both new workflows with the real imported error-workflow ID only during packaging; repository exports remain inactive until that binding is verified.

Run:

```powershell
node --test tests/agentic-error-workflow.test.mjs
```

Expected: exact-owner rows change and unrelated jobs remain byte-identical.

- [ ] Commit:

```text
feat(n8n): add agentic analysis error ownership
```

**Gate:** no failed execution leaves an invisible staging lock or destroys a valid running job.

### Task 14: Wire shadow dispatch after the complete manifest barrier

**Files:**

```text
workflows/n8n-exports/ТЕНДЕРЫ ОРКЕСТРАТОР.json
workflows/n8n-exports/TENDER — Intake Resume.json
workflows/orchestrator.md
workflows/intake-resume.md
tests/intake-agentic-shadow-routing.test.mjs
```

- [ ] Start only after Task 0 reconciliation and archive Orchestrator integration are GREEN.
- [ ] Write failing graph tests proving agentic dispatch is unreachable before the full document manifest commit.
- [ ] In Orchestrator new-run path, insert one `TENDER — Агентский анализ — Запуск` call after atomic manifest registration and before legacy Worker dispatch. Wait only for staging/seal/start acknowledgement, not Codex completion.
- [ ] Preserve existing legacy Worker fan-out and downstream contracts unchanged.
- [ ] In Intake Resume existing-run recovery path, call the same idempotent Dispatch when a registered run has no agentic job or a recoverable technical attempt. Do not dispatch for `failed`, `completed`, `superseded` or structurally incomplete runs unless the documented operator mode explicitly requests a shadow backfill.
- [ ] Preserve the existing stable intake event key and analysis run identity.
- [ ] Ensure archive artifacts cannot be cleaned before runner staging is sealed. After sealing, runner owns independent copies and legacy Finalization may clean archive storage safely.
- [ ] Add `agentic_shadow` outcome metadata to the Intake structured result without changing existing action/status meanings.

Run:

```powershell
node --test tests/intake-agentic-shadow-routing.test.mjs tests/tender-intake-resume.test.mjs tests/tender-orchestrator-input.test.mjs tests/document-preparation-workflow.test.mjs
```

Expected: new and resumed paths start at most one agentic job; all pre-existing legacy routing tests remain GREEN.

- [ ] Commit:

```text
feat(n8n): launch agentic analysis in shadow mode
```

**Gate:** the new contour is additive and recoverable; no existing analysis node or FINAL route is replaced.

### Task 15: Run offline blind-test evaluation before server deployment

**Files:**

```text
evaluations/agentic-shadow-v1/<run-id>/...
PROJECT_STATUS.md
```

- [ ] Run the complete 12-document blind corpus through the local runner four times with identical model, effort, prompt, skill, schema, tool versions and source hashes.
- [ ] Store raw result, validation, source coverage, JSONL and token usage for every replicate.
- [ ] Evaluate all four against provisional `agentic-baseline-v0`; keep its status metrics diagnostic rather than treating them as production truth.
- [ ] Compare reported and effective statuses separately so validator containment is visible.
- [ ] Record cached input tokens but do not equate them with zero cost or subscription usage.
- [ ] Do not tune model/effort until all four baseline runs are archived.

Run:

```powershell
node --test tests/agentic-*.test.mjs
node scripts/evaluate-agentic-result.mjs evaluations/agentic-shadow-v1
```

Expected / required acceptance:

```text
4/4 valid structured results
4/4 exact 27 effective fields
0 critical false_resolved after validation
0 absence-derived negative effective resolved
100% source artifact identities valid
100% resolved evidence mechanically verified or downgraded
all incomplete-inspection not_found downgraded
known ellipsized-but-valid quotes accepted
no secret/client document text in runner service logs
```

Status agreement against baseline v0 is diagnostic, not a release gate. Validator containment and mechanical evidence checks remain the shadow gate. Any critical false-resolved returns implementation to Task 9; it does not justify adding a second agent automatically. Full source-grounded 27-field adjudication remains a separate future production-promotion gate.

**Commit:**

- [ ] Commit only sanitized evaluation summaries and approved raw artifacts:

```text
test(agentic): record four-run shadow evaluation
```

**Gate:** the one-agent design has evidence of accuracy and containment before any production server change.

### Task 16: Deploy isolated runner and conduct inactive n8n canaries

**Files:**

```text
deploy/codex-runner/README.md
PROJECT_STATUS.md
evaluations/AGENTIC_RUNNER_DEPLOYMENT_2026-09-08.md
evaluations/AGENTIC_SHADOW_CANARY_2026-09-08.md
```

- [ ] Record server CPU/RAM/swap/disk/container baseline and current restart counts.
- [ ] Create runner API credential and Codex credential in server secret storage; do not place either in repository, Compose YAML, n8n variables or execution data.
- [ ] Deploy only the new Compose project. Confirm no existing n8n/PostgreSQL/Redis/archive/Gotenberg container restarts.
- [ ] Verify health and authenticated API reachability from n8n main and worker containers.
- [ ] Apply the additive shadow migration only after SELECT-only live schema preflight exactly matches Task 3 assumptions and an operator approves the migration.
- [ ] Import the three agentic workflows inactive, bind PostgreSQL and runner Header Auth credentials, set the real Error Workflow ID, read back and compare exact node configuration.
- [ ] Run a synthetic no-paid-call fake-runner canary through Dispatch→Monitor→27-row shadow persistence.
- [ ] Run one bounded real Codex canary on the blind corpus while legacy production workflows remain unwired.
- [ ] Verify container resource use, token audit, exact file isolation, restart behavior and seven-day cleanup boundary.

Run on the server without printing environment or secret values:

```bash
docker compose -f /opt/tender-codex-runner/compose.yaml ps
docker inspect tender-codex-runner --format '{{json .NetworkSettings.Ports}} {{.State.Status}} {{.RestartCount}}'
docker exec n8n-n8n-1 wget -qO- http://tender-codex-runner:8080/health
docker exec n8n-n8n-worker-1 wget -qO- http://tender-codex-runner:8080/health
```

Expected: runner stays healthy, exact 27 shadow rows persist, existing containers keep their IDs/start times/restart counts, and no canonical FINAL row changes.

**Commit:**

- [ ] Commit deployment evidence only after redaction review:

```text
docs(agentic): record isolated shadow runtime canary
```

**Gate:** isolated infrastructure and inactive n8n workflows are runtime GREEN; production intake remains unchanged.

### Task 17: Controlled shadow activation and documentation closure

**Files:**

```text
AGENTS.md
README.md
ARCHITECTURE.md
DATA_MODEL.md
PROJECT_STATUS.md
TECH_DEBT.md
DEVELOPMENT_LOG.md
workflows/agentic-analysis-dispatch.md
workflows/agentic-analysis-monitor.md
workflows/agentic-analysis-error.md
```

- [ ] Update the AGENTS file index with the three new workflow exports/docs, runner service and migration category.
- [ ] Update `DATA_MODEL.md` only after the live migration is actually applied and re-read.
- [ ] Document exact runner/n8n ownership, state transitions, retry limits, retention and failure semantics.
- [ ] Package Orchestrator/Intake changes inactive first; run read-back and a controlled marked-tender canary.
- [ ] Confirm the same tender produces legacy canonical output and separate agentic shadow output under one source manifest.
- [ ] Produce a field-by-field comparison; disagreements automatically remain review material and do not change the client report.
- [ ] Activate shadow routing only after the controlled canary and explicit owner decision.
- [ ] Run the full repository suite and `git diff --check`.

Run:

```powershell
node --test tests/*.test.mjs
git diff --check
git status --short
```

Expected: full suite has no new failure signature, diff check is clean, and only intentional plan artifacts/workflows/service/schema/docs are changed.

- [ ] Commit:

```text
docs(agentic): complete stages 3 to 5 shadow rollout
```

**Gate:** marked procurement runs automatically produce both the current canonical result and a separate validated agentic result with complete audit.

## 7. Production promotion is a separate plan

Stages 3–5 do not switch the client-facing source of truth. After at least several real shadow procurements and manual review, a separate approved plan may add:

```text
analysis_mode = legacy | shadow | agentic
```

In `agentic` mode only:

1. create a normal `analysis_run` with the full registered manifest;
2. run the validated agentic contour instead of Document Worker/Aggregator;
3. materialize the 27 effective results into `tender_field_final_v1`;
4. use the existing Finalization 27/27 barrier;
5. use the current HTML/PDF Report Generation unchanged;
6. keep `legacy` as an explicit fallback route.

That later promotion must not delete legacy workflows, tables, facts or audit history. Removing the old system is not a consequence of merging this plan.

## 8. Token/cost optimization order

Do not optimize cost before the Task 15 accuracy gate. After the high-effort baseline is GREEN, test one change at a time on the same adjudicated corpus:

1. keep one agent and reduce duplicated prompt text through the dedicated skill;
2. compare `high` with `medium` reasoning under identical inputs;
3. compare a cheaper model only after the reasoning-effort experiment;
4. retain the same schema, validator and provisional baseline v0 for like-for-like shadow comparison;
5. accept an optimization only when critical false-resolved remains zero and evidence/coverage gates remain unchanged.

Cached input tokens are recorded separately because they may reduce API price, but they still count as usage and do not guarantee lower ChatGPT subscription limits. Server API-key usage follows API billing; local ChatGPT-auth runs follow the applicable ChatGPT plan/workspace limits.

## 9. Rollback boundary

Shadow rollback is additive and recoverable:

1. deactivate only the agentic Dispatch/Monitor workflows or remove their calls from inactive Orchestrator/Intake candidates;
2. stop only the `tender-codex-runner` Compose project;
3. leave legacy Worker/Aggregator/Finalization/Report routing intact;
4. keep shadow DB rows and runner audit until the retention decision is explicit;
5. do not drop additive tables during an operational rollback;
6. never delete source documents, canonical facts or FINAL results.

No rollback step restarts or recreates n8n, PostgreSQL, Redis, archive extractor, Gotenberg or delivery services.
