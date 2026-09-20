# Bitrix24 One-Way Report Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Prepare a fully testable local n8n integration that sends one validated tender PDF with a short summary to one fixed Bitrix24 group chat and automatically retries only explicit temporary non-delivery responses.

**Architecture:** Finalization continues to call the existing pure Report Generation workflow, then passes its terminal JSON and binary.report_pdf to a dedicated stateful delivery sub-workflow. PostgreSQL owns the delivery state and atomic send claim; a one-minute scheduled worker regenerates the deterministic report only for due retry_wait rows, while a fail-closed error workflow changes an unhandled sending execution to terminal unknown. The repository contains inactive workflow candidates with exact configuration sentinels; by explicit owner decision, the real inbound-webhook URL and botToken are entered directly into the live n8n nodes only during connection.

**Tech Stack:** n8n workflow JSON, JavaScript Code nodes, PostgreSQL, Node.js node:test, Bitrix24 Chatbots 2.0 imbot.v2.File.upload.

---

## Scope and safety boundaries

- Execute this plan in an isolated Git worktree created with the using-git-worktrees skill. The current project worktree contains unrelated owner changes that must not enter any task commit.
- Before each commit, require git diff --cached --name-only to contain only the files listed by that task.
- If a listed documentation file already has unrelated changes in the execution worktree, stage only the intended hunks with git add -p.

- This plan creates and tests local repository artifacts only.
- Do not modify, publish, activate, or deactivate live n8n workflows while executing this plan.
- Do not run DDL against production PostgreSQL without separate write authorization.
- Do not place a real webhook URL, webhook code, botToken, botId, or dialogId in Git.
- Repository candidates must contain these exact sentinels:
  - __BITRIX_WEBHOOK_FILE_UPLOAD_URL__
  - __BITRIX_BOT_TOKEN__
  - __BITRIX_BOT_ID__
  - __BITRIX_DIALOG_ID__
  - __BITRIX_DELIVERY_WORKFLOW_ID__
  - __BITRIX_ERROR_WORKFLOW_ID__
- The production webhook URL and botToken will be visible to users who can inspect the live workflow. This is an explicitly accepted owner decision.
- The HTTP Request node must have retryOnFail disabled. n8n engine retries cannot distinguish an explicit Bitrix rejection from an ambiguous transport result and could duplicate a message.
- A timeout, connection reset, node transport error, malformed response, or successful-looking response without both messageId and file.id becomes unknown and is never retried automatically.
- One initial HTTP call plus at most three retry calls are allowed: delays 1, 5, and 15 minutes.
- There is no operator workflow and no incoming Bitrix processing.

## File map

Create:

- database/migrations/20260920_create_tender_analysis_deliveries.sql — versioned DDL for the delivery journal.
- tests/bitrix-delivery-migration.test.mjs — static migration contract.
- tests/fixtures/bitrix-delivery/report-input.json — validated Report Generation JSON fixture.
- tests/fixtures/bitrix-delivery/file-upload-success.json — confirmed Bitrix success.
- tests/fixtures/bitrix-delivery/file-upload-retryable.json — explicit temporary non-delivery.
- tests/fixtures/bitrix-delivery/file-upload-permanent.json — permanent authorization failure.
- tests/fixtures/bitrix-delivery/file-upload-malformed.json — ambiguous response.
- tests/bitrix-delivery-workflow.test.mjs — delivery topology, request, classifier, and state-transition regressions.
- tests/bitrix-retry-workflow.test.mjs — scheduler, 27/27 regeneration gate, and terminal-state exclusion regressions.
- tests/bitrix-error-workflow.test.mjs — fail-closed unknown transition regression.
- tests/bitrix-finalization-wiring.test.mjs — minimal caller-wiring regression.
- tests/bitrix-secret-safety.test.mjs — sentinel and sanitizer regression.
- workflows/n8n-exports/beta/[BITRIX] TENDER — Отправить отчёт в Bitrix.json — inactive delivery candidate.
- workflows/n8n-exports/beta/[BITRIX] TENDER — Повторить доставки Bitrix.json — inactive retry worker candidate.
- workflows/n8n-exports/beta/[BITRIX] TENDER — Ошибка доставки Bitrix.json — inactive fail-closed error candidate.
- workflows/n8n-exports/beta/[BITRIX] TENDER — Финализация анализа.json — inactive caller candidate derived from the canonical five-node Finalization export.
- scripts/sanitize-bitrix-workflow-export.mjs — mandatory redaction of live webhook configuration before repository storage.
- workflows/bitrix-delivery.md — exact workflow and state-machine contract.
- workflows/bitrix-retry.md — scheduled retry contract.
- deploy/bitrix/README.md — credential-time registration, connection, canary, and rollback runbook.

Modify:

- docs/superpowers/specs/2026-09-20-bitrix-report-delivery-design.md — retain the approved direct-webhook exception and fail-closed execution ownership.
- DATA_MODEL.md — document tender_analysis_deliveries.
- ARCHITECTURE.md — add the post-report delivery boundary without changing Report Generation responsibility.
- README.md — describe local candidate status and production boundary.
- AGENTS.md — add the new workflow documentation and beta candidates to the project index.
- PROJECT_STATUS.md — record local verification only after all tests pass.
- TECH_DEBT.md — record the accepted secret-in-live-workflow limitation.
- DEVELOPMENT_LOG.md — append the implementation checkpoint after verification.

Do not modify:

- FIELD_CATALOG.md
- REPORT_FIELD_MAPPING.md
- the 27-field semantics
- workflows/n8n-exports/TENDER — Генерация отчета.json
- workflows/n8n-exports/TENDER — Финализация анализа.json
- any live n8n workflow or production database object

### Task 1: Add the delivery journal migration and data-model contract

**Files:**

- Create: database/migrations/20260920_create_tender_analysis_deliveries.sql
- Create: tests/bitrix-delivery-migration.test.mjs
- Modify: DATA_MODEL.md

- [ ] **Step 1: Write the failing migration contract test**

Create tests/bitrix-delivery-migration.test.mjs with this complete content:

~~~js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testsDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testsDirectory, '..');
const migrationPath = path.join(
  repositoryRoot,
  'database',
  'migrations',
  '20260920_create_tender_analysis_deliveries.sql',
);

function sql() {
  return fs.readFileSync(migrationPath, 'utf8');
}

test('delivery migration creates the journal with the approved statuses', () => {
  const source = sql();
  assert.match(source, /CREATE TABLE public[.]tender_analysis_deliveries/u);
  for (const status of [
    'pending',
    'sending',
    'retry_wait',
    'sent',
    'failed',
    'unknown',
  ]) {
    assert.match(source, new RegExp("'" + status + "'", 'u'));
  }
});

test('delivery identity is unique per run, channel, and dialog', () => {
  assert.match(
    sql(),
    /UNIQUE [(]analysis_run_id, channel, dialog_id[)]/u,
  );
});

test('delivery migration preserves fail-closed and success invariants', () => {
  const source = sql();
  assert.match(source, /n8n_execution_id text/u);
  assert.match(source, /status <> 'sent'[\s\S]+message_id IS NOT NULL[\s\S]+file_id IS NOT NULL/u);
  assert.match(source, /status <> 'retry_wait'[\s\S]+next_attempt_at IS NOT NULL/u);
  assert.match(source, /status = 'retry_wait'[\s\S]+next_attempt_at IS NULL/u);
  assert.match(source, /attempt_count BETWEEN 0 AND 4/u);
  assert.match(source, /file_size BETWEEN 6 AND 104857600/u);
});

test('delivery migration indexes only the scheduled retry queue', () => {
  assert.match(
    sql(),
    /CREATE INDEX idx_tender_analysis_deliveries_due_retry[\s\S]+WHERE status = 'retry_wait'/u,
  );
});
~~~

- [ ] **Step 2: Run the migration test and confirm RED**

Run:

~~~bash
node --test tests/bitrix-delivery-migration.test.mjs
~~~

Expected: FAIL with ENOENT for database/migrations/20260920_create_tender_analysis_deliveries.sql.

- [ ] **Step 3: Create the migration**

Create database/migrations/20260920_create_tender_analysis_deliveries.sql with this complete DDL:

~~~sql
BEGIN;

CREATE TABLE public.tender_analysis_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_run_id uuid NOT NULL
        REFERENCES public.tender_analysis_runs(id)
        ON DELETE CASCADE,
    channel text NOT NULL DEFAULT 'bitrix',
    dialog_id text NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    attempt_count integer NOT NULL DEFAULT 0,
    n8n_execution_id text,
    next_attempt_at timestamptz,
    message_id text,
    file_id text,
    file_name text NOT NULL,
    file_size bigint NOT NULL,
    last_error_code text,
    last_error_message text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz,

    CONSTRAINT tender_analysis_deliveries_identity_key
        UNIQUE (analysis_run_id, channel, dialog_id),

    CONSTRAINT tender_analysis_deliveries_channel_check
        CHECK (channel = 'bitrix'),

    CONSTRAINT tender_analysis_deliveries_status_check
        CHECK (
            status IN (
                'pending',
                'sending',
                'retry_wait',
                'sent',
                'failed',
                'unknown'
            )
        ),

    CONSTRAINT tender_analysis_deliveries_attempt_count_check
        CHECK (attempt_count BETWEEN 0 AND 4),

    CONSTRAINT tender_analysis_deliveries_file_size_check
        CHECK (file_size BETWEEN 6 AND 104857600),

    CONSTRAINT tender_analysis_deliveries_sent_check
        CHECK (
            status <> 'sent'
            OR (
                message_id IS NOT NULL
                AND file_id IS NOT NULL
                AND sent_at IS NOT NULL
            )
        ),

    CONSTRAINT tender_analysis_deliveries_retry_wait_check
        CHECK (
            status <> 'retry_wait'
            OR next_attempt_at IS NOT NULL
        ),

    CONSTRAINT tender_analysis_deliveries_non_retry_check
        CHECK (
            status = 'retry_wait'
            OR next_attempt_at IS NULL
        )
);

CREATE INDEX idx_tender_analysis_deliveries_due_retry
    ON public.tender_analysis_deliveries (next_attempt_at, id)
    WHERE status = 'retry_wait';

CREATE INDEX idx_tender_analysis_deliveries_execution
    ON public.tender_analysis_deliveries (n8n_execution_id)
    WHERE status = 'sending';

COMMIT;
~~~

- [ ] **Step 4: Document the physical table**

In DATA_MODEL.md, add tender_analysis_deliveries after tender_analysis_field_results. Document every column, the FK, the unique identity, six statuses, attempt_count meaning, due-retry index, and these transitions:

~~~text
pending -> sending
sending -> sent
sending -> retry_wait
sending -> failed
sending -> unknown
retry_wait -> sending
~~~

State explicitly that attempt_count counts HTTP calls, so values 1 through 4 mean the initial call plus three permitted retries.

- [ ] **Step 5: Run the migration test and confirm GREEN**

Run:

~~~bash
node --test tests/bitrix-delivery-migration.test.mjs
~~~

Expected: 4 tests pass, 0 fail.

- [ ] **Step 6: Commit the migration slice**

~~~bash
git add database/migrations/20260920_create_tender_analysis_deliveries.sql tests/bitrix-delivery-migration.test.mjs DATA_MODEL.md
git commit -m "feat(bitrix): add delivery journal schema"
~~~

### Task 2: Add deterministic Bitrix fixtures and the delivery test harness

**Files:**

- Create: tests/fixtures/bitrix-delivery/report-input.json
- Create: tests/fixtures/bitrix-delivery/file-upload-success.json
- Create: tests/fixtures/bitrix-delivery/file-upload-retryable.json
- Create: tests/fixtures/bitrix-delivery/file-upload-permanent.json
- Create: tests/fixtures/bitrix-delivery/file-upload-malformed.json
- Create: tests/bitrix-delivery-workflow.test.mjs

- [ ] **Step 1: Add the exact JSON fixtures**

Create report-input.json:

~~~json
{
  "internal": {
    "analysis_run_id": "11111111-1111-4111-8111-111111111111"
  },
  "procurement": {
    "number": "10293451",
    "subject": "Поставка мебели",
    "customer": "АО КИТА ТЕХ",
    "platform": "TenderPlan",
    "price": 1250000,
    "publication_at": "2026-09-19T09:00:00+03:00"
  },
  "statistics": {
    "total": 27,
    "resolved": 20,
    "requires_review": 4,
    "not_found": 3
  },
  "artifact_validation": {
    "valid": true
  },
  "pdf_artifact_validation": {
    "valid": true,
    "property": "report_pdf",
    "size_bytes": 12,
    "signature": "%PDF-"
  },
  "bitrix_bot_id": 456,
  "bitrix_dialog_id": "chat5",
  "bitrix_bot_token": "fixture-bot-token"
}
~~~

Create file-upload-success.json:

~~~json
{
  "statusCode": 200,
  "body": {
    "result": {
      "file": {
        "id": 138,
        "name": "Анализ закупки 10293451.pdf",
        "size": 12
      },
      "messageId": 123,
      "dialogId": "chat5"
    }
  }
}
~~~

Create file-upload-retryable.json:

~~~json
{
  "statusCode": 400,
  "body": {
    "error": "FILE_SEND_FAILED",
    "error_description": "Message sending error"
  }
}
~~~

Create file-upload-permanent.json:

~~~json
{
  "statusCode": 401,
  "body": {
    "error": "INVALID_CREDENTIALS",
    "error_description": "Invalid request credentials"
  }
}
~~~

Create file-upload-malformed.json:

~~~json
{
  "statusCode": 200,
  "body": {
    "result": {
      "dialogId": "chat5"
    }
  }
}
~~~

- [ ] **Step 2: Write the initial failing workflow test**

Create tests/bitrix-delivery-workflow.test.mjs. The file must define loadJson(), byName(), targets(), runCodeNode(), fixture(), and a mock this.helpers.getBinaryDataBuffer() that returns Buffer.from('%PDF-fixture'). Add tests that assert:

~~~js
test('delivery candidate is inactive, binary-passthrough, and credential free', () => {
  assert.equal(workflow.active, false);
  assert.equal(byName('When Executed by Another Workflow').parameters.inputSource, 'passthrough');
  assert.equal(byName('Отправить PDF в Bitrix').parameters.url, '__BITRIX_WEBHOOK_FILE_UPLOAD_URL__');
  assert.equal(Object.hasOwn(byName('Отправить PDF в Bitrix'), 'credentials'), false);
});

test('delivery request contains the approved short message and exact PDF bytes', async () => {
  const [result] = await runCodeNode('Проверить и подготовить доставку Bitrix', reportItem());
  assert.equal(result.json.analysis_run_id, '11111111-1111-4111-8111-111111111111');
  assert.equal(
    result.json.bitrix_request.fields.message,
    [
      'Отчёт по закупке №10293451',
      'Предмет: Поставка мебели',
      'Заказчик: АО КИТА ТЕХ',
      'Начальная цена: 1 250 000 ₽',
      '',
      'Результаты: подтверждено — 20; требуют проверки — 4; не найдено — 3.'
    ].join('\n'),
  );
  assert.equal(result.json.bitrix_request.fields.content, Buffer.from('%PDF-fixture').toString('base64'));
  assert.doesNotMatch(result.json.bitrix_request.fields.message, /UUID|confidence|field_key|Внимание/u);
});

test('delivery preflight rejects invalid statistics and non-PDF bytes', async () => {
  await assert.rejects(
    runCodeNode('Проверить и подготовить доставку Bitrix', reportItem({
      statistics: { total: 27, resolved: 20, requires_review: 4, not_found: 2 },
    })),
    /BITRIX_STATISTICS_INVALID/u,
  );
  await assert.rejects(
    runCodeNode('Проверить и подготовить доставку Bitrix', reportItem({}, Buffer.from('not-a-pdf'))),
    /BITRIX_PDF_SIGNATURE_INVALID/u,
  );
});
~~~

Use the current project VM pattern from tests/aggregator-e2e-pin-runner.test.mjs: execute Code-node JavaScript inside an async wrapper and expose $input, $, Buffer, Intl, and this.helpers.

- [ ] **Step 3: Run the focused test and confirm RED**

Run:

~~~bash
node --test tests/bitrix-delivery-workflow.test.mjs
~~~

Expected: FAIL because the delivery workflow export does not exist.

- [ ] **Step 4: Commit only fixtures and the RED test**

~~~bash
git add tests/fixtures/bitrix-delivery tests/bitrix-delivery-workflow.test.mjs
git commit -m "test(bitrix): define delivery request contract"
~~~

### Task 3: Build the inactive delivery workflow through the atomic claim

**Files:**

- Create: workflows/n8n-exports/beta/[BITRIX] TENDER — Отправить отчёт в Bitrix.json
- Modify: tests/bitrix-delivery-workflow.test.mjs

- [ ] **Step 1: Create the workflow shell with exact node versions**

Create an inactive workflow named [BITRIX] TENDER — Отправить отчёт в Bitrix with this linear entry section:

~~~text
When Executed by Another Workflow
-> Конфигурация Bitrix
-> Проверить и подготовить доставку Bitrix
-> Зарегистрировать доставку
-> Захватить доставку
-> Доставка захвачена?
~~~

Use:

- Execute Workflow Trigger type n8n-nodes-base.executeWorkflowTrigger, version 1.2, inputSource passthrough.
- Edit Fields type n8n-nodes-base.set, version 3.4.
- Code type n8n-nodes-base.code, version 2, Run Once for All Items.
- PostgreSQL type n8n-nodes-base.postgres, version 2.7, operation executeQuery.
- IF type n8n-nodes-base.if, version 2.3.
- Existing PostgreSQL credential reference KITATEH Tenders / RFpUr3McElcwyoxy.
- availableInMCP false, active false, pinData empty.
- Workflow description: stateful one-way Bitrix delivery; input is one validated report item with binary.report_pdf; output is delivery_status, analysis_run_id, delivery_id, attempt_count, message_id, file_id, error_code.

Конфигурация Bitrix must preserve all incoming JSON and binary and add four fields:

~~~text
bitrix_bot_id = __BITRIX_BOT_ID__
bitrix_dialog_id = __BITRIX_DIALOG_ID__
bitrix_bot_token = __BITRIX_BOT_TOKEN__
bitrix_channel = bitrix
~~~

- [ ] **Step 2: Add the complete preflight Code-node implementation**

Set Проверить и подготовить доставку Bitrix to:

~~~js
const item = $input.first();
const input = item.json ?? {};
const pdf = item.binary?.report_pdf;
const analysisRunId = input.analysis_run_id ?? input.internal?.analysis_run_id;

function missingText(value, fallback) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return fallback;
  }
  return String(value).trim();
}

function formatPrice(value) {
  if (value === null || value === undefined || value === '') return 'Не указана';
  const numericValue = Number(value);
  return Number.isFinite(numericValue)
    ? new Intl.NumberFormat('ru-RU').format(numericValue) + ' ₽'
    : String(value).trim();
}

if (!analysisRunId) {
  throw new Error('BITRIX_ANALYSIS_RUN_ID_MISSING');
}
if (input.pdf_artifact_validation?.valid !== true) {
  throw new Error('BITRIX_PDF_NOT_VALIDATED');
}
if (!pdf || pdf.mimeType !== 'application/pdf') {
  throw new Error('BITRIX_PDF_BINARY_MISSING');
}
if (typeof pdf.fileName !== 'string' || !/[.]pdf$/iu.test(pdf.fileName.trim())) {
  throw new Error('BITRIX_PDF_FILENAME_INVALID');
}

const statistics = input.statistics;
const counts = [
  statistics?.resolved,
  statistics?.requires_review,
  statistics?.not_found,
];

if (
  statistics?.total !== 27
  || counts.some((value) => !Number.isInteger(value) || value < 0)
  || counts.reduce((sum, value) => sum + value, 0) !== 27
) {
  throw new Error('BITRIX_STATISTICS_INVALID');
}

const botId = Number(input.bitrix_bot_id);
const dialogId = String(input.bitrix_dialog_id ?? '');
const botToken = String(input.bitrix_bot_token ?? '');

if (!Number.isInteger(botId) || botId <= 0) {
  throw new Error('BITRIX_BOT_ID_NOT_CONFIGURED');
}
if (!/^chat[0-9]+$/u.test(dialogId)) {
  throw new Error('BITRIX_DIALOG_ID_NOT_CONFIGURED');
}
if (!botToken || botToken === '__BITRIX_BOT_TOKEN__') {
  throw new Error('BITRIX_BOT_TOKEN_NOT_CONFIGURED');
}

const pdfBuffer = await this.helpers.getBinaryDataBuffer(0, 'report_pdf');
if (pdfBuffer.length <= 5) {
  throw new Error('BITRIX_PDF_EMPTY');
}
if (pdfBuffer.length > 104857600) {
  throw new Error('BITRIX_PDF_TOO_LARGE');
}
if (pdfBuffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
  throw new Error('BITRIX_PDF_SIGNATURE_INVALID');
}
if (input.pdf_artifact_validation.size_bytes !== pdfBuffer.length) {
  throw new Error('BITRIX_PDF_SIZE_MISMATCH');
}

const procurement = input.procurement ?? {};
const message = [
  'Отчёт по закупке №' + missingText(procurement.number, 'не указан'),
  'Предмет: ' + missingText(procurement.subject, 'Не указано'),
  'Заказчик: ' + missingText(procurement.customer, 'Не указан'),
  'Начальная цена: ' + formatPrice(procurement.price),
  '',
  'Результаты: подтверждено — ' + statistics.resolved
    + '; требуют проверки — ' + statistics.requires_review
    + '; не найдено — ' + statistics.not_found + '.',
].join('\n');

return [{
  json: {
    analysis_run_id: analysisRunId,
    channel: 'bitrix',
    dialog_id: dialogId,
    file_name: pdf.fileName.trim(),
    file_size: pdfBuffer.length,
    statistics,
    procurement,
    bitrix_request: {
      botId,
      botToken,
      dialogId,
      fields: {
        name: pdf.fileName.trim(),
        content: pdfBuffer.toString('base64'),
        message,
      },
    },
  },
  binary: {
    report_pdf: pdf,
  },
}];
~~~

- [ ] **Step 3: Configure the row-registration query**

Зарегистрировать доставку uses this SQL and query replacements from Проверить и подготовить доставку Bitrix:

~~~sql
WITH inserted AS (
    INSERT INTO public.tender_analysis_deliveries (
        analysis_run_id,
        channel,
        dialog_id,
        status,
        attempt_count,
        file_name,
        file_size
    )
    VALUES (
        $1::uuid,
        'bitrix',
        $2,
        'pending',
        0,
        $3,
        $4::bigint
    )
    ON CONFLICT (analysis_run_id, channel, dialog_id)
    DO NOTHING
    RETURNING *
)
SELECT * FROM inserted
UNION ALL
SELECT d.*
FROM public.tender_analysis_deliveries AS d
WHERE d.analysis_run_id = $1::uuid
  AND d.channel = 'bitrix'
  AND d.dialog_id = $2
  AND NOT EXISTS (SELECT 1 FROM inserted);
~~~

Query replacements:

~~~text
[
  {{ $('Проверить и подготовить доставку Bitrix').item.json.analysis_run_id }},
  {{ $('Проверить и подготовить доставку Bitrix').item.json.dialog_id }},
  {{ $('Проверить и подготовить доставку Bitrix').item.json.file_name }},
  {{ $('Проверить и подготовить доставку Bitrix').item.json.file_size }}
]
~~~

- [ ] **Step 4: Configure the atomic claim query**

Захватить доставку uses:

~~~sql
WITH claimed AS (
    UPDATE public.tender_analysis_deliveries
    SET
        status = 'sending',
        attempt_count = attempt_count + 1,
        n8n_execution_id = $3,
        next_attempt_at = NULL,
        last_error_code = NULL,
        last_error_message = NULL,
        updated_at = now()
    WHERE analysis_run_id = $1::uuid
      AND channel = 'bitrix'
      AND dialog_id = $2
      AND attempt_count < 4
      AND (
          status = 'pending'
          OR (
              status = 'retry_wait'
              AND next_attempt_at <= now()
          )
      )
    RETURNING *
)
SELECT
    c.*,
    true AS claim_succeeded,
    'send'::text AS claim_decision
FROM claimed AS c

UNION ALL

SELECT
    d.*,
    false AS claim_succeeded,
    CASE
        WHEN d.status = 'sent' THEN 'skip_sent'
        WHEN d.status = 'sending' THEN 'skip_in_progress'
        WHEN d.status = 'retry_wait' THEN 'skip_not_due'
        WHEN d.status = 'failed' THEN 'terminal_failed'
        WHEN d.status = 'unknown' THEN 'terminal_unknown'
        ELSE 'blocked'
    END AS claim_decision
FROM public.tender_analysis_deliveries AS d
WHERE d.analysis_run_id = $1::uuid
  AND d.channel = 'bitrix'
  AND d.dialog_id = $2
  AND NOT EXISTS (SELECT 1 FROM claimed);
~~~

Query replacements:

~~~text
[
  {{ $('Проверить и подготовить доставку Bitrix').item.json.analysis_run_id }},
  {{ $('Проверить и подготовить доставку Bitrix').item.json.dialog_id }},
  {{ $execution.id }}
]
~~~

Доставка захвачена? sends claim_succeeded=true to the HTTP branch and false to the no-send return branch.

- [ ] **Step 5: Add and run topology and SQL assertions**

Extend tests/bitrix-delivery-workflow.test.mjs to assert exact entry connections, the unique identity in registration SQL, status/attempt/due predicates in claim SQL, $execution.id persistence, and no HTTP path from the false IF output.

Run:

~~~bash
node --test tests/bitrix-delivery-workflow.test.mjs
~~~

Expected: message/preflight, topology, and claim tests pass; response-classification tests remain absent until Task 4.

- [ ] **Step 6: Commit the claim slice**

~~~bash
git add "workflows/n8n-exports/beta/[BITRIX] TENDER — Отправить отчёт в Bitrix.json" tests/bitrix-delivery-workflow.test.mjs
git commit -m "feat(bitrix): validate and claim report deliveries"
~~~

### Task 4: Complete HTTP sending, classification, persistence, and return shapes

**Files:**

- Modify: workflows/n8n-exports/beta/[BITRIX] TENDER — Отправить отчёт в Bitrix.json
- Modify: tests/bitrix-delivery-workflow.test.mjs

- [ ] **Step 1: Write failing response-state tests**

Add tests that execute Классифицировать ответ Bitrix against the four fixtures and claim attempt counts:

~~~js
test('confirmed response becomes sent with provider identifiers', async () => {
  const result = await classify('file-upload-success.json', 1);
  assert.equal(result.delivery_status, 'sent');
  assert.equal(result.message_id, '123');
  assert.equal(result.file_id, '138');
  assert.equal(result.provider_file_name, 'Анализ закупки 10293451.pdf');
  assert.equal(result.provider_file_size, 12);
  assert.equal(result.next_delay_minutes, null);
});

test('only documented explicit temporary failures schedule retries', async () => {
  assert.equal((await classify('file-upload-retryable.json', 1)).next_delay_minutes, 1);
  assert.equal((await classify('file-upload-retryable.json', 2)).next_delay_minutes, 5);
  assert.equal((await classify('file-upload-retryable.json', 3)).next_delay_minutes, 15);
  assert.equal((await classify('file-upload-retryable.json', 4)).delivery_status, 'failed');
});

test('permanent and ambiguous outcomes never schedule a retry', async () => {
  const permanent = await classify('file-upload-permanent.json', 1);
  assert.equal(permanent.delivery_status, 'failed');
  assert.equal(permanent.next_delay_minutes, null);

  const malformed = await classify('file-upload-malformed.json', 1);
  assert.equal(malformed.delivery_status, 'unknown');
  assert.equal(malformed.next_delay_minutes, null);
});
~~~

Also assert that the HTTP node has retryOnFail absent or false, onError equal to continueErrorOutput, fullResponse true, and neverError true.

- [ ] **Step 2: Run and confirm RED**

Run:

~~~bash
node --test tests/bitrix-delivery-workflow.test.mjs
~~~

Expected: FAIL because the HTTP/classifier/persistence nodes do not exist.

- [ ] **Step 3: Configure the HTTP Request node**

Create Отправить PDF в Bitrix with:

- type n8n-nodes-base.httpRequest, version 4.4;
- method POST;
- url __BITRIX_WEBHOOK_FILE_UPLOAD_URL__;
- authentication none;
- content type JSON;
- Accept and Content-Type application/json;
- JSON body equal to the named output bitrix_request from Проверить и подготовить доставку Bitrix;
- response fullResponse true;
- response neverError true;
- timeout 120000 ms;
- onError continueErrorOutput;
- no retryOnFail.

Wire output 0 to Классифицировать ответ Bitrix. Wire error output 1 to Сформировать unknown после transport error. Do not reconnect the error output to the HTTP node.

- [ ] **Step 4: Add the complete classifier Code**

Set Классифицировать ответ Bitrix to:

~~~js
const response = $input.first().json ?? {};
const claim = $('Захватить доставку').first().json;
const prepared = $('Проверить и подготовить доставку Bitrix').first().json;
const statusCode = Number(response.statusCode ?? 0);
const body = response.body && typeof response.body === 'object'
  ? response.body
  : response;
const result = body.result;
const messageId = result?.messageId;
const fileId = result?.file?.id;
const returnedDialogId = result?.dialogId;
const returnedFileName = result?.file?.name;
const returnedFileSize = Number(result?.file?.size);
const errorCode = typeof body.error === 'string' && body.error
  ? body.error
  : null;

const retryableCodes = new Set([
  'FILE_FOLDER_ERROR',
  'FILE_UPLOAD_FAILED',
  'FILE_SEND_FAILED',
  'INTERNAL_SERVER_ERROR',
  'ERROR_UNEXPECTED_ANSWER',
  'QUERY_LIMIT_EXCEEDED',
  'OPERATION_TIME_LIMIT',
]);

function sanitizedMessage(value) {
  if (typeof value !== 'string') return null;
  return value
    .replace(/https?:[/][/][^\s]+/giu, '[redacted-url]')
    .slice(0, 500);
}

let deliveryStatus;
let nextDelayMinutes = null;

if (
  statusCode >= 200
  && statusCode < 300
  && !errorCode
  && messageId !== null
  && messageId !== undefined
  && fileId !== null
  && fileId !== undefined
  && returnedDialogId === prepared.dialog_id
  && returnedFileName === prepared.file_name
  && returnedFileSize === prepared.file_size
) {
  deliveryStatus = 'sent';
} else if (errorCode && retryableCodes.has(errorCode)) {
  if (claim.attempt_count >= 4) {
    deliveryStatus = 'failed';
  } else {
    deliveryStatus = 'retry_wait';
    nextDelayMinutes = [1, 5, 15][claim.attempt_count - 1];
  }
} else if (errorCode) {
  deliveryStatus = 'failed';
} else {
  deliveryStatus = 'unknown';
}

return [{
  json: {
    delivery_status: deliveryStatus,
    analysis_run_id: prepared.analysis_run_id,
    delivery_id: claim.id,
    attempt_count: claim.attempt_count,
    message_id: deliveryStatus === 'sent' ? String(messageId) : null,
    file_id: deliveryStatus === 'sent' ? String(fileId) : null,
    provider_file_name: deliveryStatus === 'sent' ? returnedFileName : null,
    provider_file_size: deliveryStatus === 'sent' ? returnedFileSize : null,
    error_code: deliveryStatus === 'sent'
      ? null
      : (errorCode ?? 'BITRIX_RESPONSE_AMBIGUOUS'),
    error_message: deliveryStatus === 'sent'
      ? null
      : sanitizedMessage(body.error_description),
    next_delay_minutes: nextDelayMinutes,
  },
}];
~~~

- [ ] **Step 5: Add the transport-error fail-closed Code**

Сформировать unknown после transport error must not copy the raw node error or request URL:

~~~js
const claim = $('Захватить доставку').first().json;
const prepared = $('Проверить и подготовить доставку Bitrix').first().json;

return [{
  json: {
    delivery_status: 'unknown',
    analysis_run_id: prepared.analysis_run_id,
    delivery_id: claim.id,
    attempt_count: claim.attempt_count,
    message_id: null,
    file_id: null,
    error_code: 'BITRIX_TRANSPORT_OUTCOME_UNKNOWN',
    error_message: 'Transport outcome is unknown; automatic retry is disabled',
    next_delay_minutes: null,
  },
}];
~~~

- [ ] **Step 6: Persist each classifier branch with its own guarded update**

Create two PostgreSQL nodes with identical SQL and separate inputs:

- `Сохранить результат ответа Bitrix` receives only `Классифицировать ответ Bitrix`;
- `Сохранить unknown transport` receives only `Сформировать unknown после transport error`.

Use this query in both nodes:

~~~sql
UPDATE public.tender_analysis_deliveries
SET
    status = $3,
    next_attempt_at = CASE
        WHEN $3 = 'retry_wait'
            THEN now() + make_interval(mins => $8::integer)
        ELSE NULL
    END,
    message_id = $4,
    file_id = $5,
    file_name = COALESCE($9, file_name),
    file_size = COALESCE($10::bigint, file_size),
    last_error_code = $6,
    last_error_message = $7,
    sent_at = CASE WHEN $3 = 'sent' THEN now() ELSE NULL END,
    updated_at = now()
WHERE id = $1::uuid
  AND n8n_execution_id = $2
  AND status = 'sending'
RETURNING
    id AS delivery_id,
    analysis_run_id,
    status AS delivery_status,
    attempt_count,
    message_id,
    file_id,
    last_error_code AS error_code;
~~~

Query replacements for `Сохранить результат ответа Bitrix`:

~~~text
[
  {{ $('Захватить доставку').item.json.id }},
  {{ $execution.id }},
  {{ $('Классифицировать ответ Bitrix').item.json.delivery_status }},
  {{ $('Классифицировать ответ Bitrix').item.json.message_id }},
  {{ $('Классифицировать ответ Bitrix').item.json.file_id }},
  {{ $('Классифицировать ответ Bitrix').item.json.error_code }},
  {{ $('Классифицировать ответ Bitrix').item.json.error_message }},
  {{ $('Классифицировать ответ Bitrix').item.json.next_delay_minutes ?? 0 }},
  {{ $('Классифицировать ответ Bitrix').item.json.provider_file_name }},
  {{ $('Классифицировать ответ Bitrix').item.json.provider_file_size }}
]
~~~

Query replacements for `Сохранить unknown transport`:

~~~text
[
  {{ $('Захватить доставку').item.json.id }},
  {{ $execution.id }},
  {{ $('Сформировать unknown после transport error').item.json.delivery_status }},
  null,
  null,
  {{ $('Сформировать unknown после transport error').item.json.error_code }},
  {{ $('Сформировать unknown после transport error').item.json.error_message }},
  0,
  null,
  null
]
~~~

Enable `Always Output Data` on both PostgreSQL nodes. After each one, add a Code guard that throws `BITRIX_DELIVERY_STATE_UPDATE_FAILED` unless both `delivery_id` and `delivery_status` are present. This makes a lost claim visible instead of returning a false success. Do not use a Merge node: the branches are mutually exclusive and each must persist independently.

- [ ] **Step 7: Add explicit no-send and return nodes**

The false output of Доставка захвачена? goes to Вернуть результат без отправки. It maps:

~~~text
claim_decision=skip_sent or skip_in_progress or skip_not_due -> delivery_status=skipped
claim_decision=terminal_failed -> delivery_status=failed
claim_decision=terminal_unknown -> delivery_status=unknown
~~~

Both persistence branches and the no-send branch must end with an Edit Fields return node exposing only:

~~~json
{
  "delivery_status": "sent | skipped | retry_wait | failed | unknown",
  "analysis_run_id": "uuid",
  "delivery_id": "uuid",
  "attempt_count": 1,
  "message_id": null,
  "file_id": null,
  "error_code": null
}
~~~

- [ ] **Step 8: Run delivery tests and confirm GREEN**

Run:

~~~bash
node --test tests/bitrix-delivery-workflow.test.mjs
~~~

Expected: all delivery tests pass, including success, three backoffs, exhaustion, permanent failure, malformed response, transport unknown, duplicate sent skip, and no node-level retry.

- [ ] **Step 9: Commit the completed delivery workflow**

~~~bash
git add "workflows/n8n-exports/beta/[BITRIX] TENDER — Отправить отчёт в Bitrix.json" tests/bitrix-delivery-workflow.test.mjs
git commit -m "feat(bitrix): classify and persist report delivery"
~~~

### Task 5: Add retry worker and fail-closed error workflow

**Files:**

- Create: workflows/n8n-exports/beta/[BITRIX] TENDER — Повторить доставки Bitrix.json
- Create: workflows/n8n-exports/beta/[BITRIX] TENDER — Ошибка доставки Bitrix.json
- Create: tests/bitrix-retry-workflow.test.mjs
- Create: tests/bitrix-error-workflow.test.mjs

- [ ] **Step 1: Write failing retry-worker tests**

Assert:

- inactive workflow;
- Schedule Trigger uses n8n-nodes-base.scheduleTrigger version 1.2 and runs every minute;
- PostgreSQL nodes use n8n-nodes-base.postgres version 2.7;
- selection SQL contains status='retry_wait' and next_attempt_at <= now();
- selection SQL excludes sent, failed, and unknown by construction;
- selection SQL rechecks run.status='completed' and exact 27/27 FINAL fields;
- Report Generation Execute Workflow uses mode each and workflow ID ckPnP3hRhKu4Mf9u;
- Delivery Execute Workflow uses mode each and sentinel __BITRIX_DELIVERY_WORKFLOW_ID__;
- the workflow settings contain errorWorkflow sentinel __BITRIX_ERROR_WORKFLOW_ID__.

- [ ] **Step 2: Write failing error-workflow tests**

Assert:

- the first node is n8n-nodes-base.errorTrigger version 1;
- the PostgreSQL node uses n8n-nodes-base.postgres version 2.7;
- the PostgreSQL query updates only status='sending';
- it sets status='unknown' and next_attempt_at=NULL;
- it matches n8n_execution_id to the failed execution ID;
- it never changes unknown, failed, sent, pending, or retry_wait;
- it does not contain communication, webhook, email, or operator nodes.

- [ ] **Step 3: Run both tests and confirm RED**

~~~bash
node --test tests/bitrix-retry-workflow.test.mjs tests/bitrix-error-workflow.test.mjs
~~~

Expected: both files fail because their workflow exports do not exist.

- [ ] **Step 4: Build the retry worker**

Create [BITRIX] TENDER — Повторить доставки Bitrix with:

~~~text
Каждую минуту
-> Выбрать доставки для повтора
-> Call 'TENDER — Генерация отчета'
-> Call 'TENDER — Отправить отчёт в Bitrix'
~~~

Use n8n-nodes-base.scheduleTrigger version 1.2 for Каждую минуту and n8n-nodes-base.postgres version 2.7 for Выбрать доставки для повтора.

Schedule Trigger rule:

~~~json
{
  "interval": [
    {
      "field": "minutes",
      "minutesInterval": 1
    }
  ]
}
~~~

Выбрать доставки для повтора SQL:

~~~sql
WITH expected_fields(field_index, field_key) AS (
    VALUES
        (1, 'procurement_subject'),
        (2, 'nm_price_with_vat'),
        (3, 'platform'),
        (4, 'procedure_type'),
        (5, 'application_deadline'),
        (6, 'application_review_date'),
        (7, 'results_date'),
        (8, 'customer'),
        (9, 'customer_contacts'),
        (10, 'participation_cost'),
        (11, 'participation_guarantee'),
        (12, 'evaluation_criteria'),
        (13, 'delivery_term'),
        (14, 'payment_terms'),
        (15, 'special_account_or_treasury'),
        (16, 'bank_support'),
        (17, 'government_contract'),
        (18, 'rebidding'),
        (19, 'national_regime'),
        (20, 'advance_contract_guarantee'),
        (21, 'warranty_obligations_guarantee'),
        (22, 'licenses_certificates'),
        (23, 'required_official_certificates'),
        (24, 'similar_supply_experience'),
        (25, 'analog_allowed'),
        (26, 'analog_definition'),
        (27, 'application_documents')
),
due AS (
    SELECT d.id, d.analysis_run_id, d.dialog_id
    FROM public.tender_analysis_deliveries AS d
    WHERE d.channel = 'bitrix'
      AND d.status = 'retry_wait'
      AND d.next_attempt_at <= now()
    ORDER BY d.next_attempt_at, d.id
    LIMIT 10
),
valid_runs AS (
    SELECT
        due.id AS delivery_id,
        due.analysis_run_id,
        due.dialog_id,
        COUNT(fr.field_key)::integer AS final_count,
        COUNT(*) FILTER (
            WHERE fr.status IN ('resolved', 'requires_review', 'not_found')
        )::integer AS valid_status_count,
        COUNT(*) FILTER (
            WHERE fr.field_catalog_version = 'tender_fields_v1'
              AND fr.result_contract_version = 'tender_field_final_v1'
        )::integer AS valid_contract_count
    FROM due
    JOIN public.tender_analysis_runs AS r
      ON r.id = due.analysis_run_id
     AND r.status = 'completed'
    JOIN public.tender_analysis_field_results AS fr
      ON fr.analysis_run_id = due.analysis_run_id
    JOIN expected_fields AS e
      ON e.field_index = fr.field_index
     AND e.field_key = fr.field_key
    GROUP BY due.id, due.analysis_run_id, due.dialog_id
)
SELECT
    delivery_id,
    analysis_run_id,
    dialog_id,
    final_count,
    true AS barrier_ready,
    true AS completion_claimed,
    'retry_regeneration'::text AS finalization_state
FROM valid_runs
WHERE final_count = 27
  AND valid_status_count = 27
  AND valid_contract_count = 27;
~~~

Set both Execute Workflow nodes to n8n-nodes-base.executeWorkflow version 1.3, mode each, and waitForSubWorkflow true. The delivery workflow receives the Report Generation output unchanged, including binary.report_pdf.

- [ ] **Step 5: Build the error workflow**

Create [BITRIX] TENDER — Ошибка доставки Bitrix with n8n-nodes-base.errorTrigger version 1 and n8n-nodes-base.postgres version 2.7:

~~~text
Error Trigger
-> Зафиксировать неоднозначный исход доставки
~~~

Use this guarded SQL. Its only query replacement is `{{ $('Error Trigger').item.json.execution.id }}`, the failed execution ID from Error Trigger:

~~~sql
UPDATE public.tender_analysis_deliveries
SET
    status = 'unknown',
    next_attempt_at = NULL,
    last_error_code = 'BITRIX_UNHANDLED_WORKFLOW_FAILURE',
    last_error_message = 'Unhandled delivery workflow failure; automatic retry is disabled',
    updated_at = now()
WHERE n8n_execution_id = $1
  AND status = 'sending'
RETURNING
    id AS delivery_id,
    analysis_run_id,
    status AS delivery_status,
    attempt_count;
~~~

Do not persist stack traces, node parameters, request URLs, or raw error objects.

- [ ] **Step 6: Run the retry and error tests**

~~~bash
node --test tests/bitrix-retry-workflow.test.mjs tests/bitrix-error-workflow.test.mjs
~~~

Expected: all retry and fail-closed tests pass.

- [ ] **Step 7: Commit the unattended-workflow slice**

~~~bash
git add "workflows/n8n-exports/beta/[BITRIX] TENDER — Повторить доставки Bitrix.json" "workflows/n8n-exports/beta/[BITRIX] TENDER — Ошибка доставки Bitrix.json" tests/bitrix-retry-workflow.test.mjs tests/bitrix-error-workflow.test.mjs
git commit -m "feat(bitrix): add bounded retry and fail-closed workflows"
~~~

### Task 6: Wire the local Finalization candidate without changing production exports

**Files:**

- Create: workflows/n8n-exports/beta/[BITRIX] TENDER — Финализация анализа.json
- Create: tests/bitrix-finalization-wiring.test.mjs

- [ ] **Step 1: Write the failing wiring test**

The test loads the canonical and beta Finalization exports and asserts:

~~~js
test('Bitrix Finalization candidate changes only the post-report boundary', () => {
  assert.equal(canonical.nodes.length, 5);
  assert.equal(candidate.nodes.length, 6);
  assert.equal(candidate.active, false);

  for (const canonicalNode of canonical.nodes) {
    const candidateNode = candidate.nodes.find(({ name }) => name === canonicalNode.name);
    assert.ok(candidateNode, canonicalNode.name);
    assert.deepEqual(candidateNode.parameters, canonicalNode.parameters);
    assert.equal(candidateNode.type, canonicalNode.type);
    assert.equal(candidateNode.typeVersion, canonicalNode.typeVersion);
  }

  assert.deepEqual(
    targets(candidate, "Call 'TENDER — Генерация отчета'"),
    ["Call 'TENDER — Отправить отчёт в Bitrix'"],
  );
  assert.deepEqual(
    targets(candidate, "Call 'TENDER — Отправить отчёт в Bitrix'"),
    [],
  );
});
~~~

Also assert the new node uses workflow ID sentinel __BITRIX_DELIVERY_WORKFLOW_ID__, waits for completion, and passes the report item without defining JSON-only typed fields.

- [ ] **Step 2: Run and confirm RED**

~~~bash
node --test tests/bitrix-finalization-wiring.test.mjs
~~~

Expected: FAIL because the beta Finalization candidate does not exist.

- [ ] **Step 3: Create the beta candidate**

Copy the canonical five-node Finalization export to the beta filename, remove live identity metadata, set name to [BITRIX] TENDER — Финализация анализа, set active false, and add one Execute Workflow node:

~~~text
name: Call 'TENDER — Отправить отчёт в Bitrix'
type: n8n-nodes-base.executeWorkflow
typeVersion: 1.3
workflowId: __BITRIX_DELIVERY_WORKFLOW_ID__
mode: all
waitForSubWorkflow: true
~~~

Connect the existing Report Generation call directly to this new node. Do not add a Code, Set, Merge, or retry node. The existing report output already contains procurement, statistics, internal.analysis_run_id, pdf_artifact_validation, and binary.report_pdf; the delivery preflight normalizes internal.analysis_run_id.

- [ ] **Step 4: Run the wiring test and existing PDF regression**

~~~bash
node --test tests/bitrix-finalization-wiring.test.mjs tests/report-generation-pdf.test.mjs
~~~

Expected: the new wiring test passes and all existing Report Generation PDF tests remain green.

- [ ] **Step 5: Commit the caller candidate**

~~~bash
git add "workflows/n8n-exports/beta/[BITRIX] TENDER — Финализация анализа.json" tests/bitrix-finalization-wiring.test.mjs
git commit -m "feat(bitrix): add local finalization delivery candidate"
~~~

### Task 7: Add mandatory secret sanitization and repository guards

**Files:**

- Create: scripts/sanitize-bitrix-workflow-export.mjs
- Create: tests/bitrix-secret-safety.test.mjs
- Modify: workflows/n8n-exports/beta/[BITRIX] TENDER — Отправить отчёт в Bitrix.json

- [ ] **Step 1: Write the failing secret-safety tests**

Tests must:

- scan all tracked JSON, Markdown, JavaScript, and SQL files outside graphify-out and require zero inbound-webhook URL patterns;
- require the delivery export to contain all four configuration sentinels;
- clone the delivery export in a temporary directory, inject a fake webhook URL and botToken, run the sanitizer, and assert neither fake secret remains;
- assert sanitizer refuses any workflow whose name does not contain Отправить отчёт в Bitrix.

Use this webhook detector:

~~~js
const webhookPattern = /https:\/\/[^\s"'<>]+\/rest\/\d+\/[^/\s"'<>]+\/imbot[.]v2[.]File[.]upload/giu;
~~~

- [ ] **Step 2: Run and confirm RED**

~~~bash
node --test tests/bitrix-secret-safety.test.mjs
~~~

Expected: FAIL because the sanitizer script does not exist.

- [ ] **Step 3: Create the sanitizer**

Create scripts/sanitize-bitrix-workflow-export.mjs with this behavior:

~~~js
import fs from 'node:fs/promises';
import path from 'node:path';

const [inputArgument, outputArgument] = process.argv.slice(2);
if (!inputArgument || !outputArgument) {
  throw new Error(
    'Usage: node scripts/sanitize-bitrix-workflow-export.mjs <input.json> <output.json>',
  );
}

const inputPath = path.resolve(inputArgument);
const outputPath = path.resolve(outputArgument);
const workflow = JSON.parse(await fs.readFile(inputPath, 'utf8'));

if (!String(workflow.name ?? '').includes('Отправить отчёт в Bitrix')) {
  throw new Error('Refusing to sanitize an unexpected workflow');
}

const httpNode = workflow.nodes.find(
  ({ name }) => name === 'Отправить PDF в Bitrix',
);
const configNode = workflow.nodes.find(
  ({ name }) => name === 'Конфигурация Bitrix',
);

if (!httpNode || !configNode) {
  throw new Error('Expected Bitrix configuration nodes are missing');
}

httpNode.parameters.url = '__BITRIX_WEBHOOK_FILE_UPLOAD_URL__';

const assignments = configNode.parameters.assignments?.assignments;
if (!Array.isArray(assignments)) {
  throw new Error('Bitrix configuration assignments are missing');
}

const sentinels = {
  bitrix_bot_id: '__BITRIX_BOT_ID__',
  bitrix_dialog_id: '__BITRIX_DIALOG_ID__',
  bitrix_bot_token: '__BITRIX_BOT_TOKEN__',
};

for (const [name, value] of Object.entries(sentinels)) {
  const assignment = assignments.find((candidate) => candidate.name === name);
  if (!assignment) {
    throw new Error('Missing Bitrix configuration field: ' + name);
  }
  assignment.value = value;
  assignment.type = 'string';
}

workflow.active = false;
workflow.pinData = {};

for (const key of [
  'id',
  'versionId',
  'activeVersionId',
  'shared',
  'meta',
  'workflowPublishHistory',
]) {
  delete workflow[key];
}

const serialized = JSON.stringify(workflow, null, 2) + '\n';
const webhookPattern = /https:\/\/[^\s"'<>]+\/rest\/\d+\/[^/\s"'<>]+\/imbot[.]v2[.]File[.]upload/giu;

if (webhookPattern.test(serialized)) {
  throw new Error('Sanitized workflow still contains an inbound webhook URL');
}
if (!serialized.includes('__BITRIX_BOT_TOKEN__')) {
  throw new Error('Sanitized workflow lost the bot-token sentinel');
}

await fs.writeFile(outputPath, serialized, 'utf8');
~~~

- [ ] **Step 4: Run the secret tests**

~~~bash
node --test tests/bitrix-secret-safety.test.mjs
~~~

Expected: all sanitizer and repository scans pass.

- [ ] **Step 5: Commit the safety boundary**

~~~bash
git add scripts/sanitize-bitrix-workflow-export.mjs tests/bitrix-secret-safety.test.mjs "workflows/n8n-exports/beta/[BITRIX] TENDER — Отправить отчёт в Bitrix.json"
git commit -m "chore(bitrix): sanitize live workflow exports"
~~~

### Task 8: Document operations, architecture, and the accepted limitation

**Files:**

- Create: workflows/bitrix-delivery.md
- Create: workflows/bitrix-retry.md
- Create: deploy/bitrix/README.md
- Modify: AGENTS.md
- Modify: README.md
- Modify: ARCHITECTURE.md
- Modify: PROJECT_STATUS.md
- Modify: TECH_DEBT.md
- Modify: DEVELOPMENT_LOG.md
- Modify: docs/superpowers/specs/2026-09-20-bitrix-report-delivery-design.md

- [ ] **Step 1: Write the workflow documentation**

workflows/bitrix-delivery.md must document:

- binary passthrough input;
- acceptance of analysis_run_id or internal.analysis_run_id;
- exact message template;
- exact 27-count invariant;
- PDF signature, MIME, filename, and 100 MB guards;
- atomic claim SQL semantics;
- six database statuses;
- explicit retryable allowlist:
  FILE_FOLDER_ERROR, FILE_UPLOAD_FAILED, FILE_SEND_FAILED, INTERNAL_SERVER_ERROR, ERROR_UNEXPECTED_ANSWER, QUERY_LIMIT_EXCEEDED, OPERATION_TIME_LIMIT;
- permanent failure and ambiguous unknown rules;
- maximum four HTTP calls;
- exact return shape;
- absence of inbound messages and operator workflow.

workflows/bitrix-retry.md must document:

- one-minute schedule;
- due retry_wait selection only;
- completed-run and 27/27 regeneration barrier;
- mode each Report Generation and Delivery calls;
- duplicate PDF regeneration is acceptable, duplicate send is prevented by the delivery claim;
- fail-closed error workflow.

- [ ] **Step 2: Write the credential-time runbook**

deploy/bitrix/README.md must contain this ordered procedure:

1. Create a Bitrix24 inbound webhook with imbot scope.
2. Generate a random botToken up to 40 characters and keep it outside Git/chat.
3. Call imbot.v2.Bot.register with stable fields.code and fields.botToken.
4. Record returned botId.
5. Add the bot to the existing target group chat.
6. Record dialogId as chat plus the numeric chat ID.
7. Import the three inactive candidates in this order: error, delivery, retry.
8. Replace workflow ID sentinels with imported IDs.
9. Enter the complete imbot.v2.File.upload webhook URL directly in Отправить PDF в Bitrix.
10. Enter botId, dialogId, and botToken directly in Конфигурация Bitrix.
11. Set the delivery and retry workflow errorWorkflow to the imported error workflow.
12. Apply the reviewed SQL migration only after separate DB write authorization.
13. Keep every workflow inactive while running pinned/mock validation.
14. Publish the error workflow, then delivery workflow, then run one controlled manual canary.
15. Verify the visible message, readable PDF, messageId, file.id, file size, and one sent journal row.
16. Publish the retry worker.
17. Replace the production Finalization post-report connection only after the canary succeeds.
18. Sanitize any later live export before it enters the repository.
19. Roll back by disconnecting Finalization from delivery and unpublishing the retry worker; do not delete journal rows or already delivered chat messages.

Include the exact approved message and state that there is no second warning line.

- [ ] **Step 3: Update architecture and project indexes**

Make these bounded edits:

- AGENTS.md: add workflows/bitrix-delivery.md and workflows/bitrix-retry.md; label all four [BITRIX] exports as inactive beta candidates.
- README.md: add the intended completed -> report -> Bitrix flow and state that production remains unchanged.
- ARCHITECTURE.md: add Bitrix Delivery as a post-report side effect; Report Generation remains pure.
- PROJECT_STATUS.md: add a dated local-only checkpoint only after the full verification command passes.
- TECH_DEBT.md: add a security limitation stating that the live inbound-webhook URL and botToken are stored in the workflow by explicit owner decision and must be sanitized from exports.
- DEVELOPMENT_LOG.md: append the test evidence, file list, and production-not-modified boundary.
- Design spec: ensure n8n_execution_id, the fail-closed error workflow, direct live-node webhook storage, and mandatory sanitization match the implemented names.

Do not rewrite unrelated status or debt sections.

- [ ] **Step 4: Run documentation and secret checks**

~~~bash
grep -RIn --exclude-dir=.git --exclude-dir=.worktrees --exclude-dir=graphify-out -E 'https://[^[:space:]]+/rest/[0-9]+/[^/[:space:]]+/imbot[.]v2[.]File[.]upload' .
node --test tests/bitrix-secret-safety.test.mjs
git diff --check
~~~

Expected: grep prints nothing; the secret test passes; git diff --check exits 0.

- [ ] **Step 5: Commit documentation**

~~~bash
git add AGENTS.md README.md ARCHITECTURE.md PROJECT_STATUS.md TECH_DEBT.md DEVELOPMENT_LOG.md DATA_MODEL.md workflows/bitrix-delivery.md workflows/bitrix-retry.md deploy/bitrix/README.md docs/superpowers/specs/2026-09-20-bitrix-report-delivery-design.md
git commit -m "docs(bitrix): document report delivery operations"
~~~

### Task 9: Run the complete local acceptance gate and refresh the project graph

**Files:**

- Verify all files from Tasks 1 through 8.
- Update: graphify-out generated artifacts through the supported incremental command.

- [ ] **Step 1: Parse every candidate export**

~~~bash
jq empty   "workflows/n8n-exports/beta/[BITRIX] TENDER — Отправить отчёт в Bitrix.json"   "workflows/n8n-exports/beta/[BITRIX] TENDER — Повторить доставки Bitrix.json"   "workflows/n8n-exports/beta/[BITRIX] TENDER — Ошибка доставки Bitrix.json"   "workflows/n8n-exports/beta/[BITRIX] TENDER — Финализация анализа.json"
~~~

Expected: exit 0 with no output.

- [ ] **Step 2: Run the focused Bitrix and report regressions**

~~~bash
node --test   tests/bitrix-delivery-migration.test.mjs   tests/bitrix-delivery-workflow.test.mjs   tests/bitrix-retry-workflow.test.mjs   tests/bitrix-error-workflow.test.mjs   tests/bitrix-finalization-wiring.test.mjs   tests/bitrix-secret-safety.test.mjs   tests/report-generation-pdf.test.mjs
~~~

Expected: 0 failures.

- [ ] **Step 3: Run the full repository regression suite**

~~~bash
node --test tests/*.test.mjs
~~~

Expected: 0 failures. If an unrelated pre-existing test fails, record its exact name and output; do not change unrelated code in this task.

- [ ] **Step 4: Verify no real Bitrix secret can be committed**

~~~bash
git grep -n -E 'https://[^[:space:]]+/rest/[0-9]+/[^/[:space:]]+/imbot[.]v2[.]File[.]upload|bitrix_bot_token[^_].*[A-Za-z0-9]{16,}' -- ':!docs/superpowers/plans/2026-09-20-bitrix-report-delivery.md'
~~~

Expected: no matches.

- [ ] **Step 5: Refresh Graphify incrementally**

From the project root, run:

~~~bash
graphify . --update
~~~

Expected: graphify reports the changed/new project files, writes graphify-out/graph.json and GRAPH_REPORT.md, and completes without a graph-health corruption warning. If the graph emits an integrity warning, preserve it and report it rather than hiding it.

- [ ] **Step 6: Inspect the final diff and status**

~~~bash
git diff --check
git status --short
git log --oneline -10
~~~

Expected: no whitespace errors; status contains only intended implementation artifacts plus unrelated changes that were already present before this plan.

- [ ] **Step 7: Commit the refreshed graph separately**

~~~bash
git add graphify-out
git commit -m "docs(graphify): refresh Bitrix delivery graph"
~~~

- [ ] **Step 8: Stop before any live mutation**

Report:

- focused test count and result;
- full-suite result;
- candidate node counts;
- migration filename;
- sanitizer result;
- graph update result;
- exact remaining credential-time actions.

Do not apply the migration, import workflows, register the bot, send a canary, or change production Finalization without the user's next explicit authorization.
