# Agentic Finalization Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert one completed `tender_agent_result_v1` job into the canonical 27-row FINAL contract, complete the existing analysis run, and produce the existing HTML/PDF report without changing the Codex result format.

**Architecture:** Keep `tender_agentic_field_results` as the immutable shadow result and add one fail-closed, transactional promotion node at the start of the existing Finalization workflow. The Monitor calls Finalization only after its existing atomic 27-row shadow commit; Report Generation remains the sole renderer and learns only the mechanical agentic metadata needed to accept `confidence=null` and render `artifact_key` evidence through its source filename and opaque locator.

**Tech Stack:** n8n workflow JSON exports, PostgreSQL CTE/PL/pgSQL transaction, n8n Code and Execute Workflow nodes, Node.js built-in test runner, Gotenberg HTML-to-PDF.

---

## File map

- Create `tests/agentic-finalization-integration.test.mjs`: regression contract for promotion, lifecycle, producer isolation, Monitor handoff, and agentic report compatibility.
- Modify `tests/agentic-monitor-workflow.test.mjs`: replace the obsolete “no canonical downstream reference” assertion with a precise Monitor-to-Finalization assertion while retaining the ban on the legacy semantic pipeline.
- Modify `workflows/n8n-exports/TENDER — Финализация анализа.json`: add the optional transactional agentic promotion before the existing completion barrier.
- Modify `workflows/n8n-exports/TENDER — Агентский анализ — Монитор.json`: call Finalization with the exact run/job pair after the shadow transaction succeeds.
- Modify `workflows/n8n-exports/TENDER — Генерация отчета.json`: expose `resolution_method`, accept agentic null confidence, preserve opaque `locator`, and render it safely.
- Modify `workflows/n8n-exports/beta/[PDF TEST] TENDER — Генерация отчета.json`: keep the isolated PDF candidate semantically identical to canonical Report Generation.
- Modify `workflows/agentic-analysis-monitor.md`, `workflows/report-generation.md`, `ARCHITECTURE.md`, `README.md`, `PROJECT_STATUS.md`, `TECH_DEBT.md`, and `DEVELOPMENT_LOG.md`: record the implemented contract and verified runtime evidence.

### Task 1: Lock the integration contract in failing tests

**Files:**
- Create: `tests/agentic-finalization-integration.test.mjs`
- Modify: `tests/agentic-monitor-workflow.test.mjs`

- [ ] **Step 1: Add a structural test for the new Finalization promotion contract**

Create a test that loads the three canonical workflow exports and asserts the exact mechanical boundary:

```js
test('Finalization promotes an exact agentic job before the existing 27/27 barrier', () => {
  const promotion = byName(finalization, 'Продвинуть agentic FINAL');
  const sql = promotion.parameters.query;

  assert.deepEqual(targets(finalization, 'When Executed by Another Workflow'), ['Продвинуть agentic FINAL']);
  assert.deepEqual(targets(finalization, 'Продвинуть agentic FINAL'), ['Проверить 27 FINAL и завершить run']);
  assert.match(sql, /tender_agentic_jobs/);
  assert.match(sql, /status\s*=\s*'completed'/);
  assert.match(sql, /tender_agentic_field_results/);
  assert.match(sql, /tender_agentic_documents/);
  assert.match(sql, /tender_analysis_field_results/);
  assert.match(sql, /tender_field_final_v1/);
  assert.match(sql, /codex_agentic_v1/);
  assert.match(sql, /COUNT\(\*\)\s*<>\s*27/i);
  assert.match(sql, /artifact_key/);
  assert.match(sql, /agent_result/);
  assert.match(sql, /agentic_job_id/);
  assert.doesNotMatch(sql, /PRICE|VAT|NEGATIVE|quote_accuracy|evidence_sufficiency/i);
});
```

- [ ] **Step 2: Add lifecycle, replay, and presentation assertions**

Add assertions that the SQL:

```js
assert.match(sql, /FOR UPDATE/);
assert.match(sql, /BEGIN;/);
assert.match(sql, /COMMIT;/);
assert.match(sql, /processing[\s\S]*aggregating/);
assert.match(sql, /resolution_method/);
assert.match(sql, /ON CONFLICT \(analysis_run_id, field_key\)/);
assert.match(sql, /different_agentic_job|mixed_producer/i);
assert.match(sql, /jsonb_array_elements[\s\S]*evidence/);
assert.match(sql, /file_name/);
```

Also assert that the Report snapshot selects `resolution_method`, its validator contains the agentic confidence exception, and source adaptation/rendering retain a `locator` string.

- [ ] **Step 3: Replace the obsolete Monitor assertion**

In `tests/agentic-monitor-workflow.test.mjs`, keep the assertion that completed jobs cannot be claimed again, but replace the blanket ban on `tender_analysis_field_results` with:

```js
const finalize = find(workflow, 'Завершить agentic analysis');
assert.equal(finalize.type, 'n8n-nodes-base.executeWorkflow');
assert.deepEqual(targets(workflow, 'Сохранить ровно 27 shadow rows'), ['Завершить agentic analysis']);
assert.match(JSON.stringify(finalize.parameters), /analysis_run_id/);
assert.match(JSON.stringify(finalize.parameters), /agentic_job_id/);
assert.doesNotMatch(JSON.stringify(workflow), /tender_analysis_facts|Targeted Recheck|Обработать документ/);
```

- [ ] **Step 4: Run the focused tests and confirm RED**

Run:

```powershell
node --test tests/agentic-finalization-integration.test.mjs tests/agentic-monitor-workflow.test.mjs tests/report-generation-pdf.test.mjs
```

Expected: failure because `Продвинуть agentic FINAL` and `Завершить agentic analysis` do not yet exist and Report Generation does not yet expose the agentic contract.

- [ ] **Step 5: Commit the RED contract tests**

```powershell
git add -- tests/agentic-finalization-integration.test.mjs tests/agentic-monitor-workflow.test.mjs
git commit -m "test: define agentic finalization contract"
```

### Task 2: Add fail-closed transactional promotion to Finalization

**Files:**
- Modify: `workflows/n8n-exports/TENDER — Финализация анализа.json`
- Test: `tests/agentic-finalization-integration.test.mjs`

- [ ] **Step 1: Insert one PostgreSQL node before the existing barrier**

Add `Продвинуть agentic FINAL` between the Execute Workflow Trigger and `Проверить 27 FINAL и завершить run`. It always runs: without `agentic_job_id` it is a legacy no-op that passes `analysis_run_id`; with a job ID it opens a transaction and locks the exact job and run.

Its replacements are exactly:

```js
{{ [$('When Executed by Another Workflow').item.json.analysis_run_id, $('When Executed by Another Workflow').item.json.agentic_job_id ?? null] }}
```

Keep the Execute Workflow Trigger in `passthrough` mode so every existing legacy caller remains compatible. The first `SELECT` both initializes transaction-local settings and returns the downstream item, because n8n's PostgreSQL node exposes the first result set for this multi-statement query:

```sql
SELECT
  $1::uuid AS analysis_run_id,
  NULLIF($2::text, '')::uuid AS agentic_job_id,
  CASE WHEN NULLIF($2::text, '') IS NULL THEN false ELSE true END AS agentic_promoted,
  set_config('tender.analysis_run_id', $1::text, true) AS run_setting,
  set_config('tender.agentic_job_id', COALESCE($2::text, ''), true) AS job_setting;
```

- [ ] **Step 2: Implement the integrity guards inside the same transaction**

The PL/pgSQL block must raise and roll back unless these exact conditions hold:

```sql
SELECT * INTO v_job
FROM tender_agentic_jobs
WHERE id = v_job_id
FOR UPDATE;

IF v_job.status <> 'completed'
   OR v_job.analysis_run_id <> v_run_id
   OR v_job.field_catalog_version <> 'tender_fields_v1'
   OR v_job.pipeline_version <> 'tender_agentic_pipeline_v1'
   OR v_job.field_catalog_sha256 !~ '^[0-9a-f]{64}$'
   OR v_job.input_manifest_sha256 !~ '^[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'AGENTIC_PROMOTION_JOB_IDENTITY_INVALID';
END IF;
```

Validate exactly 27 rows, indexes `1..27`, the exact `FIELD_CATALOG.md` key order embedded as a PostgreSQL `VALUES` table, allowed statuses, and the job catalog version. For every evidence item of `resolved` and `requires_review`, require a nonblank `artifact_key` and a matching row in `tender_agentic_documents` for this job. Do not inspect quote contents, locator contents, or value semantics.

- [ ] **Step 3: Enforce producer isolation and deterministic replay**

Before writing, lock existing canonical rows for the run. Permit only zero rows or exactly 27 rows whose `resolution_method='codex_agentic_v1'` and whose `result_json.audit.agentic_job_id` equals this job. Raise `AGENTIC_PROMOTION_MIXED_PRODUCER` or `AGENTIC_PROMOTION_DIFFERENT_AGENTIC_JOB` for every other state.

Use:

```sql
INSERT INTO tender_analysis_field_results (...)
SELECT ...
FROM tender_agentic_field_results af
WHERE af.job_id = v_job_id
ON CONFLICT (analysis_run_id, field_key) DO UPDATE SET
  status = EXCLUDED.status,
  value_text = EXCLUDED.value_text,
  confidence = EXCLUDED.confidence,
  requires_human_review = EXCLUDED.requires_human_review,
  resolution_method = EXCLUDED.resolution_method,
  result_json = EXCLUDED.result_json,
  updated_at = NOW();
```

The conflict path is reachable only after the producer guard has accepted the same job.

- [ ] **Step 4: Build the canonical presentation projection without changing the shadow JSON**

Set `confidence=NULL`, `requires_human_review=(status='requires_review')`, and `resolution_method='codex_agentic_v1'`. Build top-level report evidence by joining each `artifact_key` to the exact job document and adding only `document: tender_analysis_documents.file_name`; preserve `artifact_key`, `locator`, and `quote`. Keep the original agent field under `result_json.agent_result` and provenance under:

```sql
jsonb_build_object(
  'producer', 'codex_agentic_v1',
  'agentic_job_id', v_job_id::text
)
```

For `not_found`, set top-level presentation evidence to `[]` and retain its rationale only through `agent_result`; do not fabricate a source.

- [ ] **Step 5: Transition lifecycle atomically and run the existing barrier**

Within the promotion transaction, change the same run from `processing` to `aggregating` only after the 27 canonical rows are established. Accept `aggregating` for same-job replay and `completed` only for a same-job idempotent replay. The existing `Проверить 27 FINAL и завершить run` query remains the sole `aggregating → completed` owner.

- [ ] **Step 6: Run focused tests and commit**

```powershell
node --test tests/agentic-finalization-integration.test.mjs
git add -- 'workflows/n8n-exports/TENDER — Финализация анализа.json'
git commit -m "feat: promote agentic results into finalization"
```

Expected: the Finalization assertions pass; Monitor and Report assertions remain RED.

### Task 3: Connect the Monitor to existing Finalization

**Files:**
- Modify: `workflows/n8n-exports/TENDER — Агентский анализ — Монитор.json`
- Modify: `workflows/agentic-analysis-monitor.md`
- Test: `tests/agentic-monitor-workflow.test.mjs`

- [ ] **Step 1: Add the Execute Workflow node**

Make the successful shadow-save query return the current item as its first result set:

```sql
SELECT
  $4::uuid AS analysis_run_id,
  $1::uuid AS agentic_job_id,
  set_config(...) AS ...;
```

Add `Завершить agentic analysis` after `Сохранить ровно 27 shadow rows`. Wait for completion and call live workflow `cSsh9yjpS7t5p0OO`. Because Finalization deliberately keeps a passthrough trigger for legacy compatibility, omit `workflowInputs`: the current `{ analysis_run_id, agentic_job_id }` item is passed unchanged. Do not connect any Worker, Aggregator, Targeted Recheck, or legacy facts node.

- [ ] **Step 2: Preserve explicit failure behavior**

The node must not use `continueOnFail`, `onError=continueRegularOutput`, or a detached fire-and-forget mode. A failed promotion/report must fail the Monitor execution and invoke the configured Agentic Error workflow.

- [ ] **Step 3: Update Monitor documentation**

Document the new terminal handoff, the exact two-ID input, same-job idempotency, and the fact that Monitor performs no semantic interpretation after Codex validation.

- [ ] **Step 4: Run focused tests and commit**

```powershell
node --test tests/agentic-monitor-workflow.test.mjs tests/agentic-finalization-integration.test.mjs
git add -- tests/agentic-monitor-workflow.test.mjs 'workflows/n8n-exports/TENDER — Агентский анализ — Монитор.json' workflows/agentic-analysis-monitor.md
git commit -m "feat: finalize completed agentic jobs"
```

Expected: Monitor-to-Finalization topology passes and no legacy semantic route becomes reachable.

### Task 4: Adapt the existing report renderer to agentic FINAL rows

**Files:**
- Modify: `workflows/n8n-exports/TENDER — Генерация отчета.json`
- Modify: `workflows/n8n-exports/beta/[PDF TEST] TENDER — Генерация отчета.json`
- Modify: `workflows/report-generation.md`
- Test: `tests/agentic-finalization-integration.test.mjs`
- Test: `tests/report-generation-pdf.test.mjs`

- [ ] **Step 1: Extend the read-only snapshot by one stored property**

Add `resolution_method` to each field object in `Собрать snapshot`. Keep all legacy properties and ordering unchanged otherwise.

- [ ] **Step 2: Make confidence validation producer-aware**

In `Проверить snapshot`, enforce:

```js
const isAgentic = field.resolution_method === 'codex_agentic_v1';
if (field.status === 'resolved') {
  if (typeof field.value_text !== 'string' || field.value_text.trim() === '') return false;
  if (field.requires_human_review !== false) return false;
  if (isAgentic ? field.confidence !== null : field.confidence === null) return false;
}
```

Keep existing `requires_review` and `not_found` invariants. Do not infer a confidence value and do not change legacy FINAL acceptance.

- [ ] **Step 3: Preserve and validate opaque locator presentation**

In `Адаптировать snapshot`, copy `evidence.locator` to each client-safe source as `locator` without parsing it. Add `locator` to the exact allowed source-property set in `Проверить модель отчета` and require it to be either `null` or a string.

- [ ] **Step 4: Render locator safely**

In `Сгенерировать HTML1`, append a nonblank locator to the same escaped location list:

```js
if (source.locator !== null && source.locator !== undefined && source.locator !== '') {
  locations.push(escapeHtml(source.locator));
}
```

Do not attempt to interpret page, sheet, OOXML, or quote semantics.

- [ ] **Step 5: Mirror the canonical renderer into the isolated PDF candidate**

Apply the same node parameters to `[PDF TEST] TENDER — Генерация отчета.json` so `tests/report-generation-pdf.test.mjs` continues proving semantic parity while the candidate remains inactive.

- [ ] **Step 6: Run focused tests and commit**

```powershell
node --test tests/agentic-finalization-integration.test.mjs tests/report-generation-pdf.test.mjs
git add -- 'workflows/n8n-exports/TENDER — Генерация отчета.json' 'workflows/n8n-exports/beta/[PDF TEST] TENDER — Генерация отчета.json' workflows/report-generation.md
git commit -m "feat: render agentic final results"
```

Expected: canonical/candidate parity, fail-fast Gotenberg chain, agentic null-confidence, locator, and HTML escaping assertions all pass.

### Task 5: Verify, publish, run one controlled canary, and record evidence

**Files:**
- Modify: `ARCHITECTURE.md`
- Modify: `README.md`
- Modify: `PROJECT_STATUS.md`
- Modify: `TECH_DEBT.md`
- Modify: `DEVELOPMENT_LOG.md`

- [ ] **Step 1: Run the full offline regression suite**

```powershell
node --test
git diff --check
```

Expected: all tests pass and `git diff --check` is silent. If a pre-existing unrelated test fails, record the exact test and prove it also fails at the pre-change commit before continuing.

- [ ] **Step 2: Validate the three changed workflow exports**

Parse all JSON exports, verify unique node names/IDs, validate connection targets, and compare the canonical and `[PDF TEST]` Report node parameters/connections. Confirm that no credential value or API key appears in the diff.

- [ ] **Step 3: Publish in dependency order and read back**

Update and publish:

```text
TENDER — Генерация отчета
TENDER — Финализация анализа
TENDER — Агентский анализ — Монитор
```

Bind repository workflow aliases to the existing live workflow and credential IDs only in the live payload. Read each workflow back and verify `versionId=activeVersionId`, expected node count, and exact changed topology before running a canary.

- [ ] **Step 4: Run the completed-job canary**

Execute Finalization once with the existing controlled pair:

```json
{
  "analysis_run_id": "b731f861-4df6-40df-a8c5-67b8564f3f03",
  "agentic_job_id": "13b090b5-38fc-432a-a235-90ae43f609fe"
}
```

Verify from authoritative execution/DB evidence: 27 unique canonical keys, producer `codex_agentic_v1`, run `completed`, successful Finalization and Report executions, HTML artifact, and PDF signature `%PDF-`. Then replay the same Finalization input and verify no duplicate canonical rows and no second completion claim/report launch.

- [ ] **Step 5: Record only observed state**

Update the five documentation files with workflow versions, execution IDs, 27/27 counts, PDF validation, replay outcome, and any observed limitation. Mark the runtime gate GREEN only if every item in Step 4 is evidenced; otherwise leave it open with the exact first failing node.

- [ ] **Step 6: Re-run verification and commit**

```powershell
node --test
git diff --check
git status --short
git add -- ARCHITECTURE.md README.md PROJECT_STATUS.md TECH_DEBT.md DEVELOPMENT_LOG.md tests workflows docs/superpowers/plans/2026-09-10-agentic-finalization-integration.md docs/superpowers/specs/2026-09-10-agentic-finalization-integration-design.md
git commit -m "docs: verify agentic report completion"
```

Expected: the final commit excludes all unrelated `graphify-out/` runtime changes.

- [ ] **Step 7: Push and verify the remote branch**

```powershell
git push origin codex/agentic-analysis-integration
git rev-parse HEAD
git ls-remote origin refs/heads/codex/agentic-analysis-integration
```

Expected: local HEAD and the remote branch hash are identical.
