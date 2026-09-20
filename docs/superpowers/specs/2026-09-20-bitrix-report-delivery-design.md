# Bitrix Report Delivery Design

**Date:** 2026-09-20
**Status:** Implemented as inactive local beta candidates; credential-time setup, DB migration, canary, and production promotion pending
**Scope:** One-way automatic delivery of a short tender summary and the validated PDF report to one fixed Bitrix24 group chat.

## 1. Context

The current production report workflow deterministically builds a client-facing HTML report, converts the exact HTML bytes to PDF through Gotenberg, validates the resulting PDF, and returns both `binary.report_html` and `binary.report_pdf`. Delivery is deliberately outside the current Report Generation boundary.

Bitrix delivery must be prepared locally before production credentials are available. When access is provided, the remaining operational steps should be limited to configuring the credential, registering a regular bot, adding it to the target chat, recording `botId` and `dialogId`, running a controlled canary, and publishing the already validated integration.

## 2. Goals

- Automatically send a short summary and the validated PDF immediately after successful Report Generation.
- Send to one fixed Bitrix24 group chat through a regular, send-only bot.
- Keep Report Generation independent of Bitrix.
- Prevent the system from automatically sending the same completed delivery twice.
- Retry only when Bitrix explicitly confirms a temporary non-delivery.
- Persist delivery state and the Bitrix response identifiers in PostgreSQL.
- Support complete offline validation without real Bitrix credentials or external side effects.
- Keep real webhook values out of repository exports, logs, and test fixtures. By explicit owner decision, the production inbound-webhook URL and `botToken` are entered directly into the live n8n workflow nodes and therefore exist in the live workflow definition.

## 3. Non-goals

- Receiving or processing incoming chat messages.
- Bot commands, keyboards, conversational flows, or event polling.
- Supervisor or personal bot modes.
- Creating chats dynamically or routing reports to different chats.
- Human approval before sending.
- A separate operator workflow for resolving delivery states.
- Automatic retry after an ambiguous network outcome.
- Storing PDF bytes in PostgreSQL.
- Sending HTML, DOCX, or XLSX artifacts to Bitrix.

## 4. Selected Architecture

```text
Finalization: completed
    -> Report Generation
    -> PDF technical validation succeeds
    -> [BITRIX] TENDER — Отправить отчёт в Bitrix
        -> validate input and PDF
        -> claim delivery row atomically
        -> skip an already completed delivery
        -> build short summary
        -> imbot.v2.File.upload
        -> persist sent/retry_wait/failed/unknown

Scheduled trigger
    -> [BITRIX] TENDER — Повторить доставки Bitrix
        -> select due retry_wait rows
        -> rerun deterministic Report Generation by analysis_run_id
        -> call [BITRIX] TENDER — Отправить отчёт в Bitrix
```

Delivery is not appended inside Report Generation. The caller coordinates the sequence `Report Generation -> Bitrix Delivery`. This preserves the current report boundary and lets the retry workflow regenerate the same report without recursively triggering delivery.

## 5. Bitrix API Contract

The integration uses Bitrix24 Chatbots 2.0 and the `imbot.v2.File.upload` method. One API call uploads the PDF, attaches it to the selected chat, and creates the accompanying message.

Request inputs:

- `botId`: identifier returned by bot registration;
- `dialogId`: fixed group chat identifier in the form `chat{chatId}`;
- `fields.name`: validated readable PDF filename;
- `fields.content`: PDF bytes encoded as Base64 without a data-URL prefix;
- `fields.message`: the short summary;
- `botToken`: required for inbound-webhook authorization; by explicit owner decision it is entered in the live n8n configuration node, while repository exports retain only a sentinel and tests use synthetic values.

Successful response fields persisted by the system:

- `result.messageId`;
- `result.file.id`;
- `result.file.name`;
- `result.file.size`;
- `result.dialogId`.

The integration rejects an empty PDF, an invalid `%PDF-` signature, a missing readable filename, and files larger than 100 MB before making the API call.

Official references:

- <https://apidocs.bitrix24.com/api-reference/chat-bots/chat-bots-v2/quick-start.html>
- <https://apidocs.bitrix24.com/api-reference/chat-bots/chat-bots-v2/imbot.v2/files/file-upload.html>

## 6. Delivery Message

The message contains no internal UUIDs, field keys, confidence values, evidence coordinates, or technical diagnostics.

```text
Отчёт по закупке №{tender_number}
Предмет: {subject}
Заказчик: {customer}
Начальная цена: {initial_price}

Результаты: подтверждено — {resolved}; требуют проверки — {requires_review}; не найдено — {not_found}.
```

Rules:

- The three counters must sum to exactly 27.
- Missing presentation metadata is rendered with the same neutral missing-value convention already used by Report Generation; it is not invented.
- There is no second warning line for `requires_review`; the count appears only in the results line.
- The PDF is attached to the same Bitrix message through `imbot.v2.File.upload`.

## 7. Delivery Sub-workflow Contract

Workflow name: `[BITRIX] TENDER — Отправить отчёт в Bitrix`.

The `Execute Workflow Trigger` uses passthrough mode because typed `Define Below` inputs cannot carry n8n binary data.

Expected item:

```text
json.analysis_run_id
or json.internal.analysis_run_id
json.procurement
json.statistics
json.pdf_artifact_validation.valid = true
binary.report_pdf
```

The sub-workflow:

1. Validates the JSON contract and the 27-field statistics.
2. Reads `binary.report_pdf` through n8n binary helpers, validates the bytes and produces Base64 for Bitrix.
3. Atomically claims the delivery row.
4. Returns an idempotent skip result when the row is already `sent`.
5. Rejects automatic execution for rows in `failed` or `unknown`.
6. Sends the summary and PDF through the directly configured HTTP Request node selected by the owner.
7. Validates the Bitrix response before marking the row `sent`.
8. Classifies explicit failures and persists the resulting state.

Return shape:

```json
{
  "delivery_status": "sent | skipped | retry_wait | failed | unknown",
  "analysis_run_id": "uuid",
  "delivery_id": "uuid",
  "attempt_count": 1,
  "message_id": null,
  "file_id": null,
  "error_code": null
}
```

## 8. PostgreSQL Delivery Journal

Add table `tender_analysis_deliveries`:

| Column | Type | Rule |
|---|---|---|
| `id` | `uuid` | Primary key, `gen_random_uuid()` |
| `analysis_run_id` | `uuid` | Required FK to `tender_analysis_runs(id)` |
| `channel` | `text` | Required, fixed to `bitrix` |
| `dialog_id` | `text` | Required fixed destination |
| `status` | `text` | `pending`, `sending`, `retry_wait`, `sent`, `failed`, or `unknown` |
| `attempt_count` | `integer` | Non-negative, starts at zero |
| `n8n_execution_id` | `text` | Current sending execution; used by the error workflow to fail closed to `unknown` |
| `next_attempt_at` | `timestamptz` | Only populated for `retry_wait` |
| `message_id` | `text` | Populated only after confirmed success |
| `file_id` | `text` | Populated only after confirmed success |
| `file_name` | `text` | Validated PDF filename |
| `file_size` | `bigint` | Validated PDF byte size |
| `last_error_code` | `text` | Sanitized provider or transport code |
| `last_error_message` | `text` | Sanitized bounded diagnostic, no secrets |
| `created_at` | `timestamptz` | Defaults to `now()` |
| `updated_at` | `timestamptz` | Updated on every transition |
| `sent_at` | `timestamptz` | Populated only for `sent` |

Required constraints:

- `UNIQUE (analysis_run_id, channel, dialog_id)`;
- status CHECK over the six allowed values;
- `attempt_count BETWEEN 0 AND 4`;
- `sent` requires `message_id`, `file_id`, and `sent_at`;
- `retry_wait` requires `next_attempt_at`;
- other terminal states must have `next_attempt_at IS NULL`.

The claim operation must be atomic so concurrent executions cannot both send the same report.

## 9. State Machine and Retry Policy

```text
pending -> sending
sending -> sent
sending -> retry_wait
sending -> failed
sending -> unknown
retry_wait -> sending
```

Automatic retries are permitted only when Bitrix returned an explicit response proving temporary non-delivery. The initial delay sequence is:

1. one minute;
2. five minutes;
3. fifteen minutes.

The initial send is followed by at most three retry attempts, so one delivery can make no more than four HTTP calls. The retry delays before those three attempts are 1, 5, and 15 minutes. If the third retry also receives an explicit temporary non-delivery response, the delivery becomes `failed`.

Classification rules:

- Confirmed successful response with valid `messageId` and `file.id` -> `sent`.
- Explicit retryable Bitrix rejection such as a documented rate-limit or temporary file-send failure -> `retry_wait` while attempts remain.
- Authentication, authorization, ownership, invalid input, invalid file, and other permanent rejections -> `failed`.
- Timeout, connection reset, malformed response after request transmission, or any outcome where acceptance cannot be disproved -> `unknown`.

`sent`, `failed`, and `unknown` are terminal for automation. No automatic workflow reads or resends them. This intentionally prefers avoiding duplicates over forcing delivery after an ambiguous outcome.

Bitrix does not document an idempotency key for `imbot.v2.File.upload`; therefore the design does not claim exactly-once delivery across ambiguous network failure. It guarantees that this system does not automatically initiate a second send after an ambiguous outcome.

## 10. Retry Worker

Workflow name: `[BITRIX] TENDER — Повторить доставки Bitrix`.

The scheduled workflow:

1. Selects only due rows with `status='retry_wait'` and `next_attempt_at <= now()`.
2. Invokes Report Generation with each `analysis_run_id` to regenerate the deterministic HTML/PDF artifact.
3. Calls the delivery sub-workflow with the regenerated binary.
4. Relies on the delivery sub-workflow's atomic `pending`/due-`retry_wait` to `sending` claim before any HTTP call; concurrent workers may regenerate the same PDF but cannot both send it.
5. Never selects `sent`, `failed`, or `unknown`.

The worker and delivery sub-workflow use `[BITRIX] TENDER — Ошибка доставки Bitrix` as their workflow-level error workflow. An unhandled delivery execution recorded in `n8n_execution_id` is changed from `sending` to terminal `unknown`, never back to an automatically retryable state.

## 11. Credentials and Configuration

The selected production authorization is a Bitrix24 inbound webhook. By explicit owner decision, the full webhook method URL is entered into the live HTTP Request node and `botToken` into the live configuration node instead of using an n8n credential. They must never be copied into repository exports, logs, fixtures, screenshots, or evaluation artifacts.

The repository workflow remains inactive and uses the exact configuration sentinels `__BITRIX_WEBHOOK_FILE_UPLOAD_URL__`, `__BITRIX_BOT_ID__`, `__BITRIX_DIALOG_ID__`, and `__BITRIX_BOT_TOKEN__`. Workflow-ID sentinels bind the imported error and delivery workflows. A sanitized export script must replace live values before writing any workflow JSON to the repository. When Bitrix access is provided:

1. Create an inbound webhook with the `imbot` scope and retain its secret URL outside the repository.
2. Register a regular bot with stable `fields.code`, set its `fields.botToken`, and retain the returned `botId`.
3. Add the bot to the existing fixed chat and obtain its `dialogId`.
4. Enter the full `imbot.v2.File.upload` webhook URL in the live HTTP Request node and `botToken` in the live configuration node.
5. Populate the non-secret `botId` and `dialogId` configuration.
6. Run one controlled canary and verify the returned message/file IDs and visible chat result.

This is an accepted security tradeoff: users with permission to inspect the live workflow can see the webhook URL and `botToken`. Repository safety is maintained through placeholder-only candidates, mandatory sanitization, and secret scans.

## 12. Offline Test Strategy

All local tests run without production credentials or Bitrix side effects.

Required scenarios:

1. Exact Russian summary formatting with complete metadata.
2. Neutral handling of missing presentation metadata.
3. Counter invariant: `resolved + requires_review + not_found = 27`.
4. Valid PDF binary, readable filename, Base64 encoding, and byte-size preservation.
5. Rejection of empty, non-PDF, oversized, or invalid artifacts before HTTP.
6. Successful mock response persists `message_id`, `file_id`, size, and `sent_at`.
7. A second call for the same sent delivery returns `skipped` without HTTP.
8. Explicit temporary non-delivery schedules retries at 1, 5, and 15 minutes.
9. Retry exhaustion becomes `failed`.
10. Permanent Bitrix rejection becomes `failed` without retry.
11. Timeout or malformed/ambiguous response becomes `unknown` without retry.
12. Concurrent claims cannot produce two send calls.
13. Retry worker selects only due `retry_wait` rows.
14. Workflow exports and test fixtures contain no secrets.

Before publication, validate all four inactive candidates, inspect their connection graphs, run pinned/mock tests, and keep real HTTP nodes controlled until the production canary is explicitly authorized.

## 13. Rollout

### Local preparation

- Add the PostgreSQL migration and migration contract tests.
- Create inactive local workflow exports for error, delivery, retry, and the Finalization caller candidate.
- Add mock Bitrix fixtures and deterministic workflow tests.
- Add the caller connection after validated Report Generation output in the local candidate only.
- Document credential setup, bot registration, chat membership, canary, rollback, and observability.

### Credential-time setup

- Create the inbound webhook with `imbot` scope and keep its full URL outside Git/chat.
- Generate and retain the bot token outside Git/chat; enter both values directly in the live nodes by owner decision.
- Register the regular bot idempotently using its stable code.
- Add the bot to the fixed chat.
- Set `botId` and `dialogId`.
- Validate the live Bitrix API revision and access.

### Production promotion

- Read back the current live caller and Report Generation workflows before mutation.
- Confirm no connection drift from the local candidate.
- Publish the delivery and retry workflows only after validation and offline tests pass.
- Run one real report canary in the fixed chat.
- Confirm visible summary, readable PDF filename, byte size, `messageId`, `fileId`, and the PostgreSQL `sent` row.
- Publish the caller wiring only after the canary succeeds.

## 14. Rollback

- Disable or unpublish the caller connection to Bitrix Delivery.
- Unpublish the retry worker.
- Leave Report Generation unchanged and operational.
- Preserve delivery journal rows for audit; do not delete confirmed message/file IDs.
- If needed, remove the bot from the chat or unregister it through Bitrix after the integration is disabled.

Rollback does not affect analysis runs, FINAL field results, HTML generation, PDF generation, or existing delivered chat messages.
