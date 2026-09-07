# TenderPlan Mark Intake and Resumable Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically start or resume a tender analysis when TenderPlan reports that a procurement was marked, while reusing the same `analysis_run_id`, processing only unfinished documents, allowing one automatic document retry, and providing an explicit manual resume path.

**Architecture:** A scheduled TenderPlan intake workflow normalizes mark notifications and calls one typed `Intake / Resume` dispatcher. PostgreSQL is the durable state and concurrency boundary: an intake-event ledger deduplicates source events, a partial unique index prevents two unfinished runs for the same tender, and compare-and-set updates protect stale-document recovery. The existing Orchestrator is narrowed to new-run creation; existing Worker, Aggregator and Finalization workflows remain the execution stages.

**Tech Stack:** n8n workflow JSON, PostgreSQL/Supabase, TenderPlan REST API, n8n REST API, modern JavaScript in Code nodes, Node.js `node:test` contract tests.

---

## Scope and non-goals

This plan implements the approved design in `docs/superpowers/specs/2026-09-07-tenderplan-mark-intake-resume-design.md`.

In scope:

- TenderPlan mark polling every 10 minutes;
- event deduplication and audit ledger;
- one unfinished run per `(source, tender_id)`;
- same-run resume by `analysis_run_id`;
- maximum two automatic Document Worker claims in total;
- one-hour stale-processing recovery after n8n execution verification;
- manual resume, including documents that exhausted the automatic attempt budget;
- safe continuation into Aggregator or Finalization;
- offline contract tests and documentation.

Out of scope:

- company/tender matching;
- changing the 27-field semantics;
- automatically repairing a partial `aggregating` run with fewer than 27 valid FINAL rows;
- production workflow activation, production migration application, or credential changes without a separate explicit authorization;
- broad refactoring of existing workflows.

## Implementation order and safety gates

The order is deliberate. Do not enable Recovery Scan or TenderPlan polling before Tasks 1–6 pass. In particular, automatic document retries remain disabled until the Worker persistence fix in Task 2 is verified.

Every workflow export edit must be validated against the local official n8n documentation at `F:/Vibe-projects/n8n/references/n8n-docs`. Never invent node parameters, operation names, retry settings, or sub-workflow input syntax.

Because the worktree already contains unrelated user edits, every task must begin with `git status --short` and must stage only the files named by that task.

---

### Task 1: Add the PostgreSQL concurrency and intake-ledger migration

**Files:**

- Create: `migrations/README.md`
- Create: `migrations/2026-09-07_tender_intake_resume.sql`
- Create: `tests/tender-intake-migration.test.mjs`
- Modify: `AGENTS.md`
- Modify: `DATA_MODEL.md`

- [ ] **Step 1: Write the failing migration contract test**

Create `tests/tender-intake-migration.test.mjs`. Read the SQL as text and assert that it contains all structural safety boundaries:

```js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL(
  '../migrations/2026-09-07_tender_intake_resume.sql',
  import.meta.url,
);

test('migration rejects duplicate unfinished runs before adding uniqueness', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /GROUP BY\s+source\s*,\s*tender_id/i);
  assert.match(sql, /HAVING\s+count\(\*\)\s*>\s*1/i);
  assert.match(sql, /RAISE EXCEPTION/i);
});

test('migration enforces one unfinished run and durable event ownership', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /CREATE UNIQUE INDEX[\s\S]+ON\s+tender_analysis_runs\s*\(\s*source\s*,\s*tender_id\s*\)/i);
  assert.match(sql, /WHERE\s+status\s*<>\s*'completed'/i);
  assert.match(sql, /CREATE TABLE[\s\S]+tender_analysis_intake_events/i);
  for (const column of ['event_key', 'analysis_run_id', 'status', 'attempts', 'n8n_execution_id', 'processing_started_at']) {
    assert.match(sql, new RegExp(`\\b${column}\\b`, 'i'));
  }
  assert.match(sql, /UNIQUE\s*\(\s*source\s*,\s*event_key\s*\)/i);
});
```

- [ ] **Step 2: Run the test and confirm the expected failure**

Run:

```powershell
node --test tests/tender-intake-migration.test.mjs
```

Expected: FAIL because the migration file does not exist.

- [ ] **Step 3: Write the migration with a fail-closed preflight**

Create `migrations/2026-09-07_tender_intake_resume.sql` as an explicit transaction. The first executable block must detect duplicate unfinished rows and abort without choosing or deleting either run:

```sql
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.tender_analysis_runs
    WHERE status <> 'completed'
    GROUP BY source, tender_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce one unfinished run: duplicate (source, tender_id) rows exist';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tender_analysis_runs_one_unfinished
  ON public.tender_analysis_runs (source, tender_id)
  WHERE status <> 'completed';
```

Then create the event ledger:

```sql
CREATE TABLE IF NOT EXISTS public.tender_analysis_intake_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'tenderplan',
  event_key text NOT NULL,
  event_type text NOT NULL,
  tender_id text NOT NULL,
  observed_at timestamptz,
  trigger_kind text NOT NULL CHECK (
    trigger_kind IN ('tenderplan_mark', 'recovery_scan', 'manual')
  ),
  analysis_run_id uuid REFERENCES public.tender_analysis_runs(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'processing' CHECK (
    status IN ('processing', 'completed', 'failed')
  ),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  n8n_execution_id text,
  processing_started_at timestamptz,
  action text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, event_key)
);

CREATE INDEX IF NOT EXISTS idx_tender_analysis_intake_events_run
  ON public.tender_analysis_intake_events (analysis_run_id);

CREATE INDEX IF NOT EXISTS idx_tender_analysis_intake_events_status_started
  ON public.tender_analysis_intake_events (status, processing_started_at);

COMMIT;
```

Do not add a trigger that silently rewrites `updated_at`; the workflows set it explicitly so ownership changes remain obvious in SQL.

- [ ] **Step 4: Document application and rollback boundaries**

In `migrations/README.md`, state:

- migrations are repository artifacts, not proof they were applied;
- production application requires explicit approval and an operator with write access;
- the preflight query must be run read-only first;
- rollback of the table/index is destructive and is not included in an automatic script.

Add a migration category to the file index in `AGENTS.md`. Add the table and partial-index contract to `DATA_MODEL.md`, without claiming live deployment.

- [ ] **Step 5: Run the focused test**

Run:

```powershell
node --test tests/tender-intake-migration.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit only Task 1 files**

```powershell
git add -- AGENTS.md DATA_MODEL.md migrations/README.md migrations/2026-09-07_tender_intake_resume.sql tests/tender-intake-migration.test.mjs
git commit -m "feat: add tender intake persistence migration"
```

---

### Task 2: Make Document Worker retries persistence-safe (DW-8)

**Files:**

- Modify: `workflows/n8n-exports/TENDER — Обработать документ.json`
- Modify: `workflows/n8n-exports/beta/[DW-23 TEST CODEX] TENDER — Обработать документ.json`
- Create: `tests/document-worker-retry-persistence.test.mjs`
- Modify: `workflows/document-worker.md`
- Modify: `TECH_DEBT.md`

- [ ] **Step 1: Write the failing retry-persistence regression test**

Create a test that loads both Worker exports, finds `Сохранить факты документа`, and checks its SQL contract. It must fail until the SQL removes only units absent from the current deterministic list:

```js
test('worker deletes stale units only within the retried document', () => {
  for (const workflow of [canonical, beta]) {
    const node = workflow.nodes.find((item) => item.name === 'Сохранить факты документа');
    const sql = node.parameters.query;
    assert.match(sql, /analysis_summary[\s\S]+analysis_unit_ids/i);
    assert.match(sql, /DELETE FROM\s+tender_analysis_units/i);
    assert.match(sql, /analysis_run_id\s*=\s*\$1/i);
    assert.match(sql, /document_id\s*=\s*\$2/i);
    assert.match(sql, /NOT EXISTS/i);
  }
});

test('canonical and beta worker keep the same retry SQL', () => {
  assert.equal(canonicalSql, betaSql);
});
```

Also assert that the deletion predicate uses the current `analysis_unit_ids`, and that no query deletes all facts or all units for the run.

- [ ] **Step 2: Run focused Worker tests and confirm the new test fails**

```powershell
node --test tests/document-worker-retry-persistence.test.mjs tests/document-worker-live-test-overlay.test.mjs
```

Expected: the new stale-unit assertion FAILS; existing parity tests remain PASS.

- [ ] **Step 3: Apply the minimal SQL change to both exports**

Edit only the query of `Сохранить факты документа`. Preserve its current fact upsert, rejected-fact audit persistence, stale-fact cleanup, document completion update, and return contract.

Add a CTE based on the already supplied `$6::jsonb` summary:

```sql
current_unit_ids AS (
  SELECT jsonb_array_elements_text(
    COALESCE($6::jsonb -> 'analysis_unit_ids', '[]'::jsonb)
  ) AS analysis_unit_id
),
```

Narrow the existing `deleted_stale_facts` CTE to units that remain in the current attempt. This prevents it from racing the foreign-key cascade for a unit that is about to be removed:

```sql
AND EXISTS (
  SELECT 1
  FROM current_unit_ids AS current_unit
  WHERE current_unit.analysis_unit_id = f.analysis_unit_id
)
```

Then delete only units belonging to this run/document and missing from `current_unit_ids`; their facts are removed by the existing foreign-key cascade:

```sql
deleted_stale_units AS (
  DELETE FROM tender_analysis_units AS unit
  WHERE unit.analysis_run_id = $1::uuid
    AND unit.document_id = $2::uuid
    AND NOT EXISTS (
      SELECT 1
      FROM current_unit_ids AS current_unit
      WHERE current_unit.analysis_unit_id = unit.analysis_unit_id
    )
  RETURNING unit.id
),
```

Include `deleted_stale_units_count` in the final diagnostic result. Do not add a broad fact purge. Apply the exact same query to canonical and beta exports. The test must verify that surviving units receive current-fact cleanup while removed units rely only on cascade, so two data-modifying CTEs never target the same fact rows.

- [ ] **Step 4: Run Worker regression tests**

```powershell
node --test tests/document-worker-retry-persistence.test.mjs tests/document-worker-live-test-overlay.test.mjs tests/document-worker-*.test.mjs
```

Expected: PASS, including canonical/beta parity and unchanged node topology.

- [ ] **Step 5: Update documentation and debt status conservatively**

In `workflows/document-worker.md`, document retry replacement semantics: current deterministic units survive, stale units from the same document are removed, facts cascade only for those stale units, and all current confirmed/requires-review/rejected facts remain persisted.

In `TECH_DEBT.md`, mark DW-8 as implementation-complete only if the tests pass. Keep runtime verification open until a controlled retry execution proves the database result.

- [ ] **Step 6: Commit Task 2**

```powershell
git add -- "workflows/n8n-exports/TENDER — Обработать документ.json" "workflows/n8n-exports/beta/[DW-23 TEST CODEX] TENDER — Обработать документ.json" workflows/document-worker.md TECH_DEBT.md tests/document-worker-retry-persistence.test.mjs
git commit -m "fix: make document retries persistence safe"
```

---

### Task 3: Convert Orchestrator into a typed new-run-only sub-workflow

**Checkpoint 2026-09-07:** implementation and structural review complete in the feature branch. The canonical export is an inactive 14-node repository candidate. Evidence is offline tests only; non-production import/read-back, migration runtime verification, wiring and promotion remain pending.

**Files:**

- Modify: `workflows/n8n-exports/ТЕНДЕРЫ ОРКЕСТРАТОР.json`
- Create: `tests/tender-orchestrator-input.test.mjs`
- Modify: `workflows/orchestrator.md`

- [x] **Step 1: Verify n8n sub-workflow syntax from local official docs**

Run:

```powershell
rg -n "Execute Sub-workflow Trigger|Execute Workflow Trigger|workflowInputs|waitForSubWorkflow" "F:/Vibe-projects/n8n/references/n8n-docs"
```

Read the matching trigger and Execute Sub-workflow pages completely enough to confirm the installed-version JSON fields. Record the exact source path in the implementation notes; do not change `n8n-docs`.

- [x] **Step 2: Write the failing Orchestrator contract test**

The test must assert:

- trigger is typed and accepts `tender_id`, `source`, `source_event_key`, and `trigger_kind`;
- there is no hardcoded tender ID;
- run creation uses a partial-index conflict target;
- the query returns a boolean equivalent of `created_new_run`;
- the same data-modifying SQL statement both creates the run and registers every normalized document;
- document registration and Worker dispatch are reachable only when `created_new_run=true`;
- all Worker calls pass the newly returned `analysis_run_id` and one document.

Use structural JSON assertions rather than whole-file snapshots.

- [x] **Step 3: Run the test and confirm the current export fails**

```powershell
node --test tests/tender-orchestrator-input.test.mjs
```

Expected: FAIL because the export still has a Manual Trigger and hardcoded tender input.

- [x] **Step 4: Replace only the Orchestrator entry and run-creation boundary**

Use the typed input syntax verified in Step 1. Validate non-empty `tender_id`, fixed/allowed `source`, and bounded strings before the TenderPlan FullInfo request.

Replace the separate run insertion and document-registration nodes with one conflict-aware data-modifying SQL statement. Preserve all current run metadata and document columns:

```sql
WITH input_documents AS (
  SELECT
    (document->>'document_index')::integer AS document_index,
    NULLIF(document->>'file_name', '') AS file_name,
    NULLIF(document->>'file_extension', '') AS file_extension,
    NULLIF(document->>'display_name', '') AS display_name,
    NULLIF(document->>'download_url', '') AS download_url,
    NULLIF(document->>'publication_at', '')::timestamptz AS publication_at,
    NULLIF(document->>'source_size', '')::bigint AS source_size
  FROM jsonb_array_elements($7::jsonb) AS document
),
inserted_run AS (
  INSERT INTO tender_analysis_runs (
    source,
    tender_id,
    tender_number,
    tender_external_id,
    status,
    documents_total,
    tender_meta
  )
  VALUES ($1, $2, NULLIF($3, ''), NULLIF($4, ''), 'processing', $5::integer, $6::jsonb)
  ON CONFLICT (source, tender_id) WHERE status <> 'completed'
  DO NOTHING
  RETURNING *
),
registered_documents AS (
  INSERT INTO tender_analysis_documents (
    analysis_run_id,
    document_index,
    file_name,
    file_extension,
    display_name,
    download_url,
    publication_at,
    source_size,
    status
  )
  SELECT
    run.id,
    document.document_index,
    document.file_name,
    document.file_extension,
    document.display_name,
    document.download_url,
    document.publication_at,
    document.source_size,
    'pending'
  FROM inserted_run AS run
  CROSS JOIN input_documents AS document
  ON CONFLICT (analysis_run_id, document_index) DO UPDATE SET
    file_name = EXCLUDED.file_name,
    file_extension = EXCLUDED.file_extension,
    display_name = EXCLUDED.display_name,
    download_url = EXCLUDED.download_url,
    publication_at = EXCLUDED.publication_at,
    source_size = EXCLUDED.source_size
  RETURNING
    id AS document_id,
    analysis_run_id,
    document_index,
    file_name,
    file_extension,
    display_name,
    download_url,
    publication_at,
    source_size,
    status
),
document_stats AS (
  SELECT
    count(*)::integer AS registered_documents_count,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'document_id', document_id,
          'document_index', document_index,
          'file_name', file_name,
          'file_extension', file_extension,
          'display_name', display_name,
          'download_url', download_url,
          'publication_at', publication_at,
          'source_size', source_size,
          'status', status
        ) ORDER BY document_index
      ),
      '[]'::jsonb
    ) AS attachments
  FROM registered_documents
),
activated_run AS (
  SELECT
    inserted.*,
    stats.registered_documents_count,
    stats.attachments
  FROM inserted_run AS inserted
  CROSS JOIN document_stats AS stats
)
SELECT
  run.id AS analysis_run_id,
  run.source,
  run.tender_id,
  run.tender_number,
  run.tender_external_id,
  run.status,
  run.documents_total,
  run.registered_documents_count,
  run.tender_meta,
  run.attachments,
  run.created_at,
  run.updated_at,
  true AS created_new_run
FROM activated_run AS run

UNION ALL

SELECT
  NULL::uuid AS analysis_run_id,
  $1::text AS source,
  $2::text AS tender_id,
  NULL::text AS tender_number,
  NULL::text AS tender_external_id,
  NULL::text AS status,
  0::integer AS documents_total,
  0::integer AS registered_documents_count,
  $6::jsonb AS tender_meta,
  '[]'::jsonb AS attachments,
  NULL::timestamptz AS created_at,
  NULL::timestamptz AS updated_at,
  false AS created_new_run
WHERE NOT EXISTS (SELECT 1 FROM inserted_run);
```

PostgreSQL data-modifying CTEs keep run creation and registration in one statement, so an error rolls both back. All CTEs in the statement use one snapshot: a sibling `UPDATE` cannot see the row inserted by `inserted_run`. Therefore insert the run directly with `status='processing'`; `activated_run` must be a read-only `SELECT` from `inserted_run` joined with `document_stats`, not an `UPDATE` of `tender_analysis_runs`.

A conflict returns the sentinel row with `created_new_run=false`. In that branch, run a new PostgreSQL statement selecting all unfinished rows by `(source, tender_id)` without `LIMIT 1`; the fresh statement is required so it can see a concurrent transaction that caused `ON CONFLICT DO NOTHING`. Assert exactly one result and return it without registering or dispatching documents.

Branch immediately on `created_new_run`:

- `true`: the SQL has already registered all documents; dispatch the returned documents;
- `false`: return the existing `analysis_run_id`, `action='concurrent_existing_run'`, and do not register or dispatch documents.

Preserve the invariant that every document is registered before the first Worker starts. Replace hardcoded workflow IDs with the selected production-candidate Worker ID only at packaging time; repository tests must assert that every call points to the same declared Worker and carries its input contract.

- [x] **Step 5: Run Orchestrator and relevant Worker contract tests**

```powershell
node --test tests/tender-orchestrator-input.test.mjs tests/document-worker-live-test-overlay.test.mjs
```

Expected: PASS.

- [x] **Step 6: Update Orchestrator documentation**

Document upstream typed inputs, the conflict result, the new-run-only responsibility, and downstream Worker contract. Explicitly state that resume logic belongs to `TENDER — Intake Resume`.

- [x] **Step 7: Commit Task 3**

```powershell
git add -- "workflows/n8n-exports/ТЕНДЕРЫ ОРКЕСТРАТОР.json" workflows/orchestrator.md tests/tender-orchestrator-input.test.mjs
git commit -m "refactor: make orchestrator a typed new-run workflow"
```

---

### Task 4: Add a reusable intake error workflow

**Files:**

- Create: `workflows/n8n-exports/TENDER — Ошибка Intake Resume.json`
- Create: `workflows/intake-error-workflow.md`
- Create: `tests/tender-intake-error-workflow.test.mjs`

- [ ] **Step 1: Verify Error Trigger and error-workflow settings in official docs**

```powershell
rg -n "Error Trigger|error workflow|Save execution progress|execution.id" "F:/Vibe-projects/n8n/references/n8n-docs"
```

Use only documented payload fields for the installed n8n version.

- [ ] **Step 2: Write the failing error-workflow test**

Assert that the new export:

- begins with Error Trigger;
- extracts a bounded error message and failed execution ID;
- attempts a guarded update of `tender_analysis_intake_events` by `n8n_execution_id` only when an owning event exists;
- sets `status='failed'`, clears no audit fields, and updates `updated_at`;
- has no document-status update and cannot accidentally behave like the existing document error workflow.

- [ ] **Step 3: Create the minimal workflow**

Topology:

```text
Error Trigger
→ Normalize Intake Error
→ Mark Owned Intake Event Failed
→ Return Error Audit Result
```

The PostgreSQL update must be guarded:

```sql
UPDATE tender_analysis_intake_events
SET status = 'failed',
    error_message = left($2, 2000),
    updated_at = now()
WHERE n8n_execution_id = $1
  AND status = 'processing'
RETURNING id, event_key, analysis_run_id, status;
```

If failure occurred before an event was claimed, leave the failed n8n execution visible and return `event_updated=false`; do not invent an event row without a tender identity.

- [ ] **Step 4: Validate and test**

Run the repository workflow validator used by existing tests, then:

```powershell
node --test tests/tender-intake-error-workflow.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Document and commit**

Document the ownership guard and the limitation for pre-claim failures.

```powershell
git add -- "workflows/n8n-exports/TENDER — Ошибка Intake Resume.json" workflows/intake-error-workflow.md tests/tender-intake-error-workflow.test.mjs
git commit -m "feat: add intake error audit workflow"
```

---

### Task 5: Build the typed `TENDER — Intake Resume` dispatcher

**Files:**

- Create: `workflows/n8n-exports/TENDER — Intake Resume.json`
- Create: `workflows/intake-resume.md`
- Create: `tests/helpers/intake-resume-model.mjs`
- Create: `tests/tender-intake-resume.test.mjs`
- Create: `tests/fixtures/intake-resume/run-states.json`

- [ ] **Step 1: Encode the approved decision table as a pure test model**

Implement only the test oracle first in `tests/helpers/intake-resume-model.mjs`. It accepts:

```js
{
  triggerKind,
  manualOverride,
  runStatus,
  finalCount,
  documents: [{ id, status, attempts, startedAt, executionState }],
}
```

and returns document actions plus one stage action. Cover at least:

| State | Automatic action | Manual action |
|---|---|---|
| `completed` document | skip | skip |
| `pending`, attempts 0 | dispatch | dispatch |
| `pending`, attempts 1 | dispatch | dispatch |
| `failed`, attempts 1 | dispatch | dispatch |
| `failed`, attempts 2 | exhausted | dispatch |
| fresh `processing` | leave owned | leave owned |
| stale `processing`, execution running | leave owned | leave owned |
| stale `processing`, execution terminal/not found | CAS to failed, then budget gate | CAS to failed, then dispatch |
| run `ready_for_aggregation` | Aggregator | Aggregator |
| run `aggregating`, 27 valid FINAL | Finalization | Finalization |
| run `aggregating`, fewer than 27 | manual attention | manual attention |
| run `completed` | no-op | no-op |

- [ ] **Step 2: Write failing workflow-structure and decision tests**

`tests/tender-intake-resume.test.mjs` must assert:

- typed inputs: `trigger_kind`, `source_event_key`, optional `tender_id`, optional `analysis_run_id`, `manual_override`;
- manual/recovery inputs treat `analysis_run_id` as authoritative;
- event claim is atomic and records owner execution, incremented attempts, and processing start;
- completed duplicate events exit without stage calls;
- new TenderPlan run calls Orchestrator;
- existing run loads documents and FINAL count;
- automatic dispatch predicate is exactly `pending` or `failed AND attempts < 2`;
- manual dispatch may include failed/exhausted documents but still skips completed;
- stale recovery verifies the recorded n8n execution before any document update;
- stale update uses compare-and-set on `id`, `status`, `n8n_execution_id`, and the observed timestamp;
- API unavailability performs no stale state mutation;
- Aggregator and Finalization routing follows the table;
- event is marked completed with a structured `action`, or failed by the error workflow.

Include fixtures for all rows in the table and a race fixture where a Worker claims the document between scan and CAS.

- [ ] **Step 3: Run tests and confirm failure**

```powershell
node --test tests/tender-intake-resume.test.mjs
```

Expected: decision-table unit tests PASS, workflow export assertions FAIL because the export is absent.

- [ ] **Step 4: Implement typed validation and event claim**

Workflow entry contract:

```text
trigger_kind: tenderplan_mark | recovery_scan | manual
source_event_key: non-empty bounded string
tender_id: required only for tenderplan_mark
analysis_run_id: required for recovery_scan/manual
manual_override: true only for manual
observed_at: optional ISO timestamp
```

Every dispatcher invocation must have a ledger row. For TenderPlan, claim the event before run resolution because `tender_id` is already known. For manual/recovery, first load the authoritative `analysis_run_id`, derive its `tender_id`, and then claim the synthetic event. Insert one `processing` row with the current n8n execution as owner. On conflict:

- `completed`: return duplicate no-op;
- fresh `processing`: return owned no-op;
- `failed`, or stale `processing` whose owner was separately confirmed terminal: guarded claim, increment `attempts`, replace owner and start time;
- otherwise fail closed.

Do not use an advisory lock across nodes.

- [ ] **Step 5: Implement run resolution**

For `tenderplan_mark`, query by `(source='tenderplan', tender_id)`:

- latest completed and no unfinished run → complete event as `already_completed`;
- one unfinished run → reuse it;
- no run → call Orchestrator;
- more than one unfinished run → fail loudly as invariant violation.

For `manual` and `recovery_scan`, load exactly `analysis_run_id`, derive `tender_id` from the run, and reject conflicting caller identity.

If the Orchestrator loses the unique-index race and returns `created_new_run=false`, continue with the returned existing run and never register documents again.

- [ ] **Step 6: Implement document classification and dispatch**

Load all documents in one PostgreSQL query. A Code node classifies but does not mutate state. For each stale `processing` document (`started_at < now() - interval '1 hour'`), call the documented read-only n8n execution endpoint using an n8n credential; never embed an API key.

Only after the endpoint confirms terminal failure, terminal success without a document completion write, or not-found may PostgreSQL run this shape of CAS:

```sql
UPDATE tender_analysis_documents
SET status = 'failed',
    error_message = left($5, 2000),
    updated_at = now()
WHERE id = $1::uuid
  AND status = 'processing'
  AND n8n_execution_id = $2
  AND started_at = $3::timestamptz
  AND started_at < $4::timestamptz
RETURNING *;
```

Re-read the returned document and apply the attempt gate. Do not increment `attempts` in the dispatcher; the Worker's atomic claim remains the only document-attempt increment.

Dispatch one item per document with async Execute Sub-workflow and the same `analysis_run_id`. Completed documents are never dispatched.

- [ ] **Step 7: Implement stage continuation**

When no document dispatch is required:

- if documents are still legitimately processing, return `waiting_for_workers`;
- if all documents are terminal, run the same DB-backed readiness predicate used by Worker completion and call Aggregator only if the run is claimed/ready;
- if `ready_for_aggregation`, call Aggregator;
- if `aggregating` and valid FINAL count is 27, call Finalization;
- if `aggregating` and valid FINAL count is below 27, return `manual_attention_required` without mutating the run;
- if `completed`, return `already_completed`.

Pin the duplicated readiness SQL in a contract test so the Worker and dispatcher cannot drift silently. Do not use Merge as a long-lived barrier.

- [ ] **Step 8: Wire workflow-level error handling and structured outcomes**

Set `TENDER — Ошибка Intake Resume` as the workflow error handler according to the verified n8n JSON schema. Expected business outcomes complete the ledger row with `processed_at=now()`, `status='completed'`, and one action such as:

```text
created_new_run
resumed_documents
waiting_for_workers
aggregation_started
finalization_started
already_completed
duplicate_event
manual_attention_required
automatic_attempts_exhausted
```

Unknown states throw and remain visible as failed executions.

- [ ] **Step 9: Run focused and full offline tests**

```powershell
node --test tests/tender-intake-resume.test.mjs tests/tender-orchestrator-input.test.mjs tests/document-worker-retry-persistence.test.mjs
node --test tests/*.test.mjs
```

Expected: PASS. If an existing unrelated test fails, record the exact pre-existing failure and do not weaken it.

- [ ] **Step 10: Document and commit**

Document inputs, state table, attempt semantics, one-hour stale verification, compare-and-set, stage routing, audit actions, and error behavior.

```powershell
git add -- "workflows/n8n-exports/TENDER — Intake Resume.json" workflows/intake-resume.md tests/helpers/intake-resume-model.mjs tests/tender-intake-resume.test.mjs tests/fixtures/intake-resume/run-states.json
git commit -m "feat: add resumable tender intake dispatcher"
```

---

### Task 6: Add explicit Manual Resume

**Files:**

- Create: `workflows/n8n-exports/TENDER — Manual Resume.json`
- Create: `workflows/manual-resume.md`
- Create: `tests/tender-manual-resume.test.mjs`

- [ ] **Step 1: Write the failing workflow contract test**

Assert:

- the entry is Manual Trigger;
- the operator must provide a non-empty UUID `analysis_run_id`;
- it calls only `TENDER — Intake Resume` with `trigger_kind='manual'` and `manual_override=true`;
- synthetic `source_event_key` includes the current n8n execution ID and analysis run ID;
- no production run ID is hardcoded;
- it cannot create a new run from `tender_id`.

- [ ] **Step 2: Run and confirm failure**

```powershell
node --test tests/tender-manual-resume.test.mjs
```

Expected: FAIL because the workflow is absent.

- [ ] **Step 3: Create the three-node operator workflow**

Topology:

```text
Manual Trigger
→ Set and Validate analysis_run_id
→ Execute TENDER — Intake Resume
```

Leave the editable `analysis_run_id` default empty. Validation must fail with a clear message until an operator supplies a UUID. Wait for the dispatcher result so the manual execution visibly reports dispatched, exhausted, aggregation, finalization, or manual-attention state.

- [ ] **Step 4: Test, document and commit**

```powershell
node --test tests/tender-manual-resume.test.mjs tests/tender-intake-resume.test.mjs
git add -- "workflows/n8n-exports/TENDER — Manual Resume.json" workflows/manual-resume.md tests/tender-manual-resume.test.mjs
git commit -m "feat: add manual tender analysis resume"
```

---

### Task 7: Add automatic Recovery Scan

**Files:**

- Create: `workflows/n8n-exports/TENDER — Recovery Scan.json`
- Create: `workflows/recovery-scan.md`
- Create: `tests/tender-recovery-scan.test.mjs`

- [ ] **Step 1: Write the failing Recovery Scan test**

Assert:

- Schedule Trigger runs every 10 minutes;
- candidate selection is PostgreSQL-backed;
- only unfinished runs are selected;
- documents qualify as `pending`, `failed AND attempts < 2`, or `processing` older than one hour;
- a `processing` run whose documents are all `completed`/`skipped` is selected so a missed readiness claim can be repaired;
- stage-only candidates include `ready_for_aggregation` and `aggregating`;
- exhausted failed documents do not enter automatic retry;
- each run calls dispatcher with `trigger_kind='recovery_scan'`, `manual_override=false`, and one synthetic event key;
- workflow-level error handling is configured.

- [ ] **Step 2: Confirm failure**

```powershell
node --test tests/tender-recovery-scan.test.mjs
```

Expected: FAIL because the workflow is absent.

- [ ] **Step 3: Implement one query and async per-run dispatch**

The candidate query must return distinct runs and must not update them:

```sql
SELECT DISTINCT run.id AS analysis_run_id
FROM tender_analysis_runs AS run
LEFT JOIN tender_analysis_documents AS document
  ON document.analysis_run_id = run.id
WHERE run.status <> 'completed'
  AND (
    document.status = 'pending'
    OR (document.status = 'failed' AND document.attempts < 2)
    OR (
      document.status = 'processing'
      AND document.started_at < now() - interval '1 hour'
    )
    OR run.status IN ('ready_for_aggregation', 'aggregating')
    OR (
      run.status = 'processing'
      AND EXISTS (
        SELECT 1
        FROM tender_analysis_documents AS any_document
        WHERE any_document.analysis_run_id = run.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM tender_analysis_documents AS nonterminal_document
        WHERE nonterminal_document.analysis_run_id = run.id
          AND nonterminal_document.status NOT IN ('completed', 'skipped')
      )
    )
  );
```

For each result call dispatcher asynchronously with a key like `recovery:<current execution id>:<analysis_run_id>`. Dispatcher owns all rechecks and mutations; Recovery Scan must not duplicate classification logic.

- [ ] **Step 4: Test, document and commit**

```powershell
node --test tests/tender-recovery-scan.test.mjs tests/tender-intake-resume.test.mjs
git add -- "workflows/n8n-exports/TENDER — Recovery Scan.json" workflows/recovery-scan.md tests/tender-recovery-scan.test.mjs
git commit -m "feat: add tender analysis recovery scan"
```

Keep the workflow inactive in repository packaging until Task 10 runtime gates are completed.

---

### Task 8: Capture the real TenderPlan mark contract before building the poller

**Files:**

- Create: `tests/fixtures/tenderplan-mark-intake/notification-type-5-sanitized.json`
- Create: `tests/fixtures/tenderplan-mark-intake/swagger-contract.md`
- Create: `tests/tenderplan-notification-contract.test.mjs`

- [ ] **Step 1: Inspect the live Swagger/read-only response without storing secrets**

Use the TenderPlan Swagger page and the documented endpoint `GET /api/notifications/v2/getlist`. Confirm from primary runtime evidence:

- authentication mechanism as configured in n8n Credentials;
- request parameters and pagination;
- exact path for notification ID;
- exact path for notification type and confirmation that type `5` means the mark event;
- exact path for TenderPlan procurement ID;
- timestamp path and ordering semantics;
- whether acknowledged/read state changes are required (the poller must remain read-only unless separately approved).

If a stable notification ID or stable tender ID cannot be established, stop this task and report the missing contract. Do not derive a key from guessed fields.

- [ ] **Step 2: Commit a sanitized representative fixture**

Remove credentials, employee identity, customer data, document URLs with tokens, and unrelated notification content. Keep the original JSON shape and the minimum fields needed for normalization. In `swagger-contract.md`, record endpoint, observed field paths, pagination, capture date, and which sensitive values were redacted.

- [ ] **Step 3: Write and run the contract test**

The test must prove the fixture supplies:

- a stable non-empty event key;
- type `5`;
- a stable non-empty `tender_id`;
- a valid timestamp when supplied;
- no known secret-shaped keys or bearer values.

```powershell
node --test tests/tenderplan-notification-contract.test.mjs
```

Expected: PASS only against confirmed field paths.

- [ ] **Step 4: Commit evidence separately**

```powershell
git add -- tests/fixtures/tenderplan-mark-intake/notification-type-5-sanitized.json tests/fixtures/tenderplan-mark-intake/swagger-contract.md tests/tenderplan-notification-contract.test.mjs
git commit -m "test: capture TenderPlan mark notification contract"
```

---

### Task 9: Build the TenderPlan Mark Intake poller

**Files:**

- Create: `workflows/n8n-exports/TENDER — TenderPlan Mark Intake.json`
- Create: `workflows/tenderplan-mark-intake.md`
- Create: `tests/tenderplan-mark-intake.test.mjs`

- [ ] **Step 1: Verify HTTP pagination, retries and loop behavior in official docs**

Read the local docs for HTTP Request pagination, Schedule Trigger, Loop Over Items, Execute Sub-workflow, retry-on-fail, and node error outputs. Use the smallest topology supported by the verified API contract.

- [ ] **Step 2: Write the failing poller test**

Assert:

- Schedule Trigger interval is 10 minutes;
- HTTP Request uses n8n Credentials and has no literal secret headers;
- endpoint and pagination match `swagger-contract.md`;
- normalization uses only confirmed fixture paths;
- only type `5` items continue;
- event key and `tender_id` are non-empty before dispatch;
- each notification calls dispatcher with `trigger_kind='tenderplan_mark'` and `manual_override=false`;
- network retries are bounded and distinct from document attempt counting;
- the intake error workflow is configured;
- no API operation acknowledges, deletes, or mutates TenderPlan notifications.

- [ ] **Step 3: Confirm failure**

```powershell
node --test tests/tenderplan-mark-intake.test.mjs tests/tenderplan-notification-contract.test.mjs
```

Expected: poller test FAILS because the export is absent; source-contract test PASSES.

- [ ] **Step 4: Implement the poller**

Topology, adjusted only where official docs or captured pagination require it:

```text
Schedule Trigger (10 minutes)
→ GET TenderPlan notifications pages
→ Normalize confirmed notification fields
→ Filter type 5
→ Validate event_key and tender_id
→ Execute TENDER — Intake Resume once per notification
```

Use async sub-workflow dispatch per event so one long tender does not block later notifications. The persistent event claim in Dispatcher is the deduplication boundary. Do not use n8n static data as the only cursor or dedup store.

HTTP transport retries may use the documented bounded retry setting; they do not increment document `attempts`. Exhausted HTTP failures remain visible and are retried on the next schedule because notifications are read-only and ledger dedup is durable.

- [ ] **Step 5: Test, document and commit**

```powershell
node --test tests/tenderplan-mark-intake.test.mjs tests/tenderplan-notification-contract.test.mjs tests/tender-intake-resume.test.mjs
git add -- "workflows/n8n-exports/TENDER — TenderPlan Mark Intake.json" workflows/tenderplan-mark-intake.md tests/tenderplan-mark-intake.test.mjs
git commit -m "feat: add TenderPlan mark intake poller"
```

Keep it inactive until Task 10.

---

### Task 10: Integrate documentation and run deployment gates

**Files:**

- Modify: `README.md`
- Modify: `ARCHITECTURE.md`
- Modify: `PROJECT_STATUS.md`
- Modify: `TECH_DEBT.md`
- Modify: `DEVELOPMENT_LOG.md`
- Modify: relevant workflow docs from Tasks 2–9

- [ ] **Step 1: Re-read all overlapping user changes before editing**

Run:

```powershell
git status --short
git diff -- README.md ARCHITECTURE.md PROJECT_STATUS.md TECH_DEBT.md DEVELOPMENT_LOG.md
```

Preserve unrelated edits. Add only intake/resume state, evidence and next-step information.

- [ ] **Step 2: Update system documentation without overstating deployment**

Document this path:

```text
TenderPlan mark poll
→ durable event claim
→ resolve/create one unfinished run
→ dispatch only eligible documents with same analysis_run_id
→ DB readiness barrier
→ Aggregator
→ Finalization
```

Record:

- two automatic claims total per document;
- manual resume can dispatch exhausted failed documents;
- one-hour stale threshold plus execution verification and CAS;
- `aggregating` with fewer than 27 valid FINAL rows requires manual attention;
- migration/workflow exports are candidates until runtime verification;
- local export/live workflow differences, especially current Orchestrator and Worker wiring.

- [ ] **Step 3: Run the complete offline regression suite**

```powershell
node --test tests/*.test.mjs
```

Expected: all tests PASS. Save the exact command, counts and timestamp in `DEVELOPMENT_LOG.md`.

- [ ] **Step 4: Review the complete diff for secrets and accidental scope**

```powershell
git diff --check
git diff --stat
git grep -n -I -E "(Bearer [A-Za-z0-9._-]+|api[_-]?key[[:space:]]*[:=][[:space:]]*['\"][^'\"]+|password[[:space:]]*[:=])" -- . ":(exclude)tests/fixtures/**"
```

Inspect every match manually. Also confirm no node contains the value of `N8N_TENDER_READONLY_API_KEY`, Supabase passwords, TenderPlan credentials, proxy credentials, or Telegram tokens.

- [ ] **Step 5: Perform read-only production preflight**

Using only the provided read-only roles:

1. compare local workflow candidates with live Orchestrator, active Worker, Error, Aggregator and Finalization;
2. run a `SELECT` version of the duplicate-unfinished-run preflight;
3. confirm current table/column names against live PostgreSQL;
4. identify exact workflow IDs that must be wired during controlled import;
5. record every local/live mismatch before any write request.

Do not apply the migration, import workflows, modify workflow settings, activate schedules, or change credentials in this task without separate explicit authorization.

- [ ] **Step 6: Define the controlled non-production runtime matrix**

Before production activation, prove these scenarios in an isolated n8n project/database or explicitly approved test rows:

1. first mark creates one run and registers documents once;
2. duplicate notification is a no-op;
3. concurrent distinct mark events create one unfinished run;
4. retry keeps the same `analysis_run_id` and skips completed documents;
5. attempts 1 automatically retries once; attempts 2 does not;
6. manual resume dispatches an exhausted failed document;
7. live execution prevents stale reclaim;
8. confirmed terminal execution permits guarded stale reclaim;
9. CAS race updates zero rows and dispatches nothing;
10. n8n API outage mutates no stale document;
11. ready run calls Aggregator once;
12. `aggregating` plus 27 valid FINAL calls Finalization;
13. partial `aggregating` returns manual attention;
14. completed tender mark is a no-op.

Runtime proof must include execution IDs, selected database rows before/after, and confirmation that only the intended document changed. Sanitize evidence before committing it.

- [ ] **Step 7: Commit documentation integration**

Stage only the hunks belonging to this feature. If files contain unrelated user edits, use interactive staging and verify the staged diff:

```powershell
git add -p README.md ARCHITECTURE.md PROJECT_STATUS.md TECH_DEBT.md DEVELOPMENT_LOG.md
git diff --cached
git commit -m "docs: integrate tender intake and resume architecture"
```

- [ ] **Step 8: Stop at the production-change boundary**

Report:

- offline test result;
- migration preflight result;
- live/local workflow mismatches;
- non-production runtime evidence available or missing;
- exact production writes still requiring approval;
- recommended activation order: migration → error workflow → Worker → Orchestrator → Dispatcher → Manual Resume → Recovery Scan → TenderPlan poller.

Do not call the feature production-complete until migration application, workflow import/wiring, runtime matrix and controlled schedule activation are separately verified.

---

## Final acceptance checklist

- [ ] No hardcoded tender or analysis-run IDs remain in production-candidate entry workflows.
- [ ] No secrets are stored in workflow JSON, tests, docs or fixtures.
- [ ] One unfinished run per `(source, tender_id)` is enforced by PostgreSQL.
- [ ] Intake events are atomically owned, deduplicated and auditable.
- [ ] Same-run resume never reprocesses a completed document.
- [ ] Automatic attempt cap is exactly two claims total.
- [ ] Manual resume can explicitly exceed the automatic cap without resetting `attempts`.
- [ ] Stale documents are changed only after n8n execution verification and guarded CAS.
- [ ] Worker retry persistence cannot leave stale units/facts from the previous attempt.
- [ ] Aggregation/finalization routing preserves the 27/27 DB barrier.
- [ ] Every unattended workflow has visible, auditable failure behavior.
- [ ] Full offline regression suite passes.
- [ ] Production remains unchanged until separately authorized.
