# Archive Ingestion Node-Level Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** встроить в текущую цепочку точный fail-closed этап подготовки документации, который раскрывает архивы до регистрации документов, сохраняет provenance и передаёт в существующий Document Worker только поддерживаемые конечные файлы.

**Architecture:** Orchestrator после создания `analysis_run` один раз вызывает новый sub-workflow `TENDER — Подготовить документацию`. Sub-workflow последовательно скачивает только архивы, передаёт binary внутреннему `tender-archive-extractor`, строит один детерминированный `tender_document_ingestion_v1` manifest и возвращает его Orchestrator; только после успешной атомарной регистрации manifest начинается fan-out Workers. Извлечённые binary доступны Worker по внутреннему HTTP URL и удаляются после terminal run или по TTL.

**Tech Stack:** n8n (`Execute Workflow Trigger` 1.2, `Execute Workflow` 1.3, `Code` 2, `If` 2.3, `Split Out` 1, `Loop Over Items` 3, `HTTP Request` 4.4, `Postgres` 2.6/2.7, `Stop And Error` 1), PostgreSQL, Node.js 22.23.2 LTS, 7-Zip 26.03, Docker Compose, Node.js built-in test runner.

---

## 1. Статус и границы этого плана

Это точное техническое продолжение:

- `docs/superpowers/specs/2026-09-07-archive-ingestion-design.md`;
- `docs/superpowers/plans/2026-09-07-archive-ingestion.md`.

Согласованные решения не пересматриваются. Этот документ фиксирует конкретные workflow, ноды, связи, SQL, API, файлы и проверки.

В план не входят:

- изменение production n8n;
- применение production PostgreSQL migration;
- публикация или активация production workflow;
- антивирус;
- новые форматы документов для Document Worker;
- изменение AI prompts, facts, Aggregator semantics или 27 FINAL fields.

Production promotion остаётся отдельным действием после offline и isolated runtime GREEN и отдельного подтверждения владельца.

## 2. Подтверждённый baseline и обязательное reconciliation

На 2026-09-07 локальный canonical Orchestrator и live workflow расходятся в одной существенной точке:

| Источник | Orchestrator | Target ноды `Запустить обработку документа` |
|---|---|---|
| local export | `workflows/n8n-exports/ТЕНДЕРЫ ОРКЕСТРАТОР.json` | `URFdslUfULtOLv9B`, `[DW-23 TEST CODEX] TENDER — Обработать документ` |
| live read-only | `Q1RWSrB0jaTA6Dmx` | `W4mNOUkdsFtNENpI`, production Worker |

Live n8n является authoritative для фактического production state. Поэтому archive diff нельзя строить поверх локального test target. Первый implementation step обязан взять live Orchestrator как baseline и сохранить target `W4mNOUkdsFtNENpI` в production candidate. Это reconciliation локального snapshot, а не изменение production.

Также подтверждено:

- live Orchestrator неактивен и содержит 12 нод;
- отдельного archive/preparation workflow в live n8n нет;
- `Создать запуск анализа` сейчас записывает `documents_total = attachments.length`;
- `Зарегистрировать документы` регистрирует все source attachments как `pending`;
- временный фильтр пропускает только PDF/DOCX/XLSX;
- Worker скачивает файл по `attachments.download_url`, поэтому для internal artifact URL отдельная download-нода не нужна;
- readiness Worker сейчас требует `completed_documents_count = documents_total` и не допускает terminal `skipped`.

Локальная попытка read-only проверки live PostgreSQL schema остановилась до соединения, потому что `psql` отсутствует в рабочей среде. Перед migration нужен указанный ниже read-only schema preflight; до него `DATA_MODEL.md` остаётся документированным source of truth.

## 3. Точная карта файлов

### Создать

```text
deploy/archive-extractor/Dockerfile
deploy/archive-extractor/compose.yaml
deploy/archive-extractor/package.json
deploy/archive-extractor/README.md
deploy/archive-extractor/src/config.mjs
deploy/archive-extractor/src/errors.mjs
deploy/archive-extractor/src/path-policy.mjs
deploy/archive-extractor/src/sevenzip.mjs
deploy/archive-extractor/src/store.mjs
deploy/archive-extractor/src/extract-job.mjs
deploy/archive-extractor/src/server.mjs
deploy/postgres/migrations/2026-09-07-add-document-ingestion-metadata.sql
workflows/n8n-exports/TENDER — Подготовить документацию.json
workflows/document-preparation.md
tests/archive-extractor-core.test.mjs
tests/archive-extractor-http.test.mjs
tests/archive-extractor-deployment.test.mjs
tests/archive-extractor-corpus.test.mjs
tests/archive-ingestion-migration.test.mjs
tests/document-preparation-workflow.test.mjs
tests/orchestrator-archive-ingestion.test.mjs
tests/document-worker-readiness-skipped.test.mjs
tests/finalization-archive-cleanup.test.mjs
```

### Изменить

```text
workflows/n8n-exports/ТЕНДЕРЫ ОРКЕСТРАТОР.json
workflows/n8n-exports/TENDER — Обработать документ.json
workflows/n8n-exports/TENDER — Финализация анализа.json
workflows/orchestrator.md
workflows/document-worker.md
DATA_MODEL.md
ARCHITECTURE.md
README.md
PROJECT_STATUS.md
TECH_DEBT.md
DEVELOPMENT_LOG.md
AGENTS.md
```

`AGENTS.md` меняется только в file index: добавить новый production workflow documentation/export и категорию PostgreSQL migrations. `FIELD_CATALOG.md`, `REPORT_FIELD_MAPPING.md` и prompts не меняются.

## 4. Зафиксированные контракты

### 4.1. Вход preparation sub-workflow

`Execute Workflow Trigger` принимает один item:

```json
{
  "analysis_run_id": "uuid",
  "attachments": [
    {
      "document_index": 1,
      "file_name": "documents.zip",
      "file_extension": "zip",
      "display_name": "documents.zip",
      "download_url": "https://source.example/download/archive-1",
      "publication_at": "2026-09-07T00:00:00.000Z",
      "source_size": 12582912
    }
  ]
}
```

`attachments` обязателен как array. `document_index` каждого source attachment — положительное уникальное целое. Порядок TenderPlan восстанавливается сортировкой по нему.

### 4.2. Успешный выход preparation

```json
{
  "success": true,
  "schema_version": "tender_document_ingestion_v1",
  "analysis_run_id": "uuid",
  "manifest": {
    "schema_version": "tender_document_ingestion_v1",
    "analysis_run_id": "uuid",
    "source_attachment_count": 2,
    "registered_document_count": 5,
    "processable_document_count": 3,
    "skipped_document_count": 2,
    "archive_count": 1,
    "documents": []
  }
}
```

### 4.3. Ошибочный выход preparation

```json
{
  "success": false,
  "schema_version": "tender_document_ingestion_v1",
  "analysis_run_id": "uuid",
  "source_attachments": [],
  "failure": {
    "error_code": "ARCHIVE_CORRUPT",
    "error_message": "Archive cannot be read",
    "source_attachment_index": 2,
    "extractor_job_id": "uuid--source-000002"
  }
}
```

`error_message` не содержит source URL, binary, document text или credentials и ограничивается 500 символами.

### 4.4. Internal extractor API

Сервис слушает только Docker network на `8080` и реализует:

```text
GET    /health
POST   /v1/extractions/{job_id}
GET    /v1/artifacts/{analysis_run_id}/{artifact_id}
DELETE /v1/runs/{analysis_run_id}
```

`POST /v1/extractions/{job_id}`:

- body: raw `application/octet-stream`;
- query: `run_id`, `source_attachment_index`, `declared_extension`, `deadline_epoch_ms`;
- `job_id`: `{analysis_run_id}--source-{source_attachment_index padded to 6 digits}`;
- success: HTTP 200 и `tender_archive_extraction_v1`;
- typed archive failure: HTTP 4xx и JSON с `success=false`;
- service failure/busy: HTTP 503;
- response никогда не содержит binary.

Success body:

```json
{
  "schema_version": "tender_archive_extraction_v1",
  "success": true,
  "job_id": "uuid--source-000002",
  "analysis_run_id": "uuid",
  "source_attachment_index": 2,
  "source": {
    "declared_extension": "zip",
    "detected_format": "zip",
    "size_bytes": 1200,
    "sha256": "hex"
  },
  "stats": {
    "entry_count": 4,
    "unpacked_total_bytes": 4200,
    "archive_count": 2,
    "duration_ms": 120
  },
  "entries": [
    {
      "kind": "file",
      "logical_path": "folder/specification.pdf",
      "file_name": "specification.pdf",
      "file_extension": "pdf",
      "archive_depth": 1,
      "archive_chain": [],
      "mime_type": "application/pdf",
      "size_bytes": 4200,
      "sha256": "hex",
      "artifact_id": "64-char-hex",
      "download_url": "http://tender-archive-extractor:8080/v1/artifacts/uuid/64-char-hex"
    }
  ]
}
```

`kind` равен `file` или `archive_container`. Source archive container добавляет n8n, поэтому extractor не дублирует его в `entries`.

### 4.5. Лимиты и константы

```js
export const LIMITS = Object.freeze({
  maxArchiveBytes: 100 * 1024 * 1024,
  maxFileBytes: 50 * 1024 * 1024,
  maxTotalBytes: 300 * 1024 * 1024,
  maxEntries: 500,
  maxArchiveDepth: 3,
  maxDurationMs: 5 * 60 * 1000,
});

export const SUPPORTED_DOCUMENT_EXTENSIONS = new Set(['pdf', 'docx', 'xlsx']);
export const SUPPORTED_ARCHIVE_EXTENSIONS = new Set([
  'zip', '7z', 'rar', 'tar', 'gz', 'tar.gz', 'tgz',
]);
```

OOXML `.docx` и `.xlsx` являются terminal documents, хотя внутри используют ZIP. Их запрещено рекурсивно раскрывать как archives.

Declared/detected mapping:

| Declared extension | Допустимый root format |
|---|---|
| `zip` | ZIP |
| `7z` | 7z |
| `rar` | RAR |
| `tar` | TAR |
| `gz` | GZIP; payload может быть одним обычным файлом или TAR |
| `tar.gz` | GZIP с TAR payload |
| `tgz` | GZIP с TAR payload |

Любая другая пара даёт `ARCHIVE_FORMAT_MISMATCH`. Вложенные archives определяются по signature/7-Zip listing, а не только по имени.

## 5. Точный graph нового preparation workflow

Workflow: `TENDER — Подготовить документацию`.

| # | Нода | Type/version | Режим / ключевые параметры |
|---:|---|---|---|
| 1 | `When Executed by Another Workflow` | Execute Workflow Trigger 1.2 | Define using fields below: `analysis_run_id:string`, `attachments:array` |
| 2 | `Проверить и классифицировать вход` | Code 2 | Run Once for All Items; прямые records + `archive_jobs[]`; hard deadline `Date.now()+300000` |
| 3 | `Есть архивы?` | If 2.3 | `{{ $json.archive_jobs.length > 0 }}` |
| 4 | `Развернуть очередь архивов` | Split Out 1 | Field `archive_jobs`; include `analysis_run_id` |
| 5 | `Обработать архивы по одному` | Loop Over Items 3 | Batch Size `1`; Reset выключен |
| 6 | `Начать обработку архива` | Code 2 | Для текущего loop item установить отдельный `deadline_epoch_ms = Date.now() + 300000`; error output включён |
| 7 | `Скачать архив` | HTTP Request 4.4 | GET; URL `{{ $json.job.download_url }}`; response File → binary `archive`; timeout до deadline этого архива; no retry; error output включён |
| 8 | `Нормализовать скачивание архива` | Code 2 | Проверить binary, фактический размер ≤100 MiB и deadline |
| 9 | `Архив скачан?` | If 2.3 | `{{ $json.archive_ok === true }}` |
| 10 | `Распаковать архив` | HTTP Request 4.4 | POST; raw binary `archive`; JSON full response; Never Error=true; no retry; timeout = remaining deadline + 5 s transport grace; error output включён |
| 11 | `Нормализовать распаковку` | Code 2 | Проверить HTTP status, schema, job identity и entries array |
| 12 | `Архив обработан?` | If 2.3 | `{{ $json.archive_ok === true }}` |
| 13 | `Сформировать полный manifest` | Code 2 | Run Once for All Items; deterministic sort; final indices; counts; zero-processable guard |
| 14 | `Сформировать ошибку подготовки` | Code 2 | Единый terminal failure contract |

Точные connections:

```text
When Executed by Another Workflow
→ Проверить и классифицировать вход
→ Есть архивы?

Есть архивы? [false]
→ Сформировать полный manifest

Есть архивы? [true]
→ Развернуть очередь архивов
→ Обработать архивы по одному

Обработать архивы по одному [loop output 1]
→ Начать обработку архива
→ Скачать архив

Начать обработку архива [error output 1]
→ Сформировать ошибку подготовки

Скачать архив [success output 0]
→ Нормализовать скачивание архива

Скачать архив [error output 1]
→ Нормализовать скачивание архива

Нормализовать скачивание архива
→ Архив скачан?

Архив скачан? [false]
→ Сформировать ошибку подготовки

Архив скачан? [true]
→ Распаковать архив

Распаковать архив [success output 0]
→ Нормализовать распаковку

Распаковать архив [error output 1]
→ Нормализовать распаковку

Нормализовать распаковку
→ Архив обработан?

Архив обработан? [false]
→ Сформировать ошибку подготовки

Архив обработан? [true]
→ Обработать архивы по одному

Обработать архивы по одному [done output 0]
→ Сформировать полный manifest
```

Failure branch не возвращается в Loop. Поэтому после первой ошибки следующий архив не запускается, а done output не формирует partial success.

### 5.1. `Проверить и классифицировать вход`

Code node содержит этот алгоритм целиком; имена полей далее считаются fixed contract:

```js
const input = $input.first().json;
const analysisRunId = String(input.analysis_run_id ?? '').trim();
const sourceAttachments = Array.isArray(input.attachments) ? input.attachments : null;
const supportedDocuments = new Set(['pdf', 'docx', 'xlsx']);
const supportedArchives = new Set(['zip', '7z', 'rar', 'tar', 'gz', 'tar.gz', 'tgz']);
const maxArchiveBytes = 100 * 1024 * 1024;

function extensionOf(attachment) {
  const explicit = String(attachment.file_extension ?? '')
    .trim().toLowerCase().replace(/^\./u, '');
  const name = String(attachment.file_name ?? '').trim().toLowerCase();
  if (explicit === 'tar.gz' || name.endsWith('.tar.gz')) return 'tar.gz';
  if (explicit) return explicit;
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1) : '';
}

function failure(errorCode, errorMessage, sourceAttachmentIndex = null, extractorJobId = null) {
  return [{ json: {
    schema_version: 'tender_document_ingestion_v1',
    analysis_run_id: analysisRunId || null,
    source_attachments: sourceAttachments ?? [],
    base_documents: [],
    archive_jobs: [],
    preliminary_failure: {
      error_code: errorCode,
      error_message: String(errorMessage).slice(0, 500),
      source_attachment_index: sourceAttachmentIndex,
      extractor_job_id: extractorJobId,
    },
  } }];
}

if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(analysisRunId)) {
  return failure('INGESTION_CONTRACT_INVALID', 'analysis_run_id must be a UUID');
}
if (!sourceAttachments) {
  return failure('INGESTION_CONTRACT_INVALID', 'attachments must be an array');
}

const normalized = sourceAttachments.map((attachment) => {
  const sourceAttachmentIndex = Number(attachment.document_index);
  const fileName = String(attachment.file_name ?? '').trim();
  return {
    document_index: sourceAttachmentIndex,
    file_name: fileName || null,
    file_extension: extensionOf(attachment),
    display_name: String(attachment.display_name ?? fileName).trim() || fileName || null,
    download_url: String(attachment.download_url ?? '').trim() || null,
    publication_at: attachment.publication_at ?? null,
    source_size: Number.isFinite(Number(attachment.source_size))
      ? Number(attachment.source_size)
      : null,
  };
}).sort((left, right) => left.document_index - right.document_index);

const indexes = normalized.map((attachment) => attachment.document_index);
if (indexes.some((value) => !Number.isInteger(value) || value < 1)) {
  return failure('INGESTION_CONTRACT_INVALID', 'Every source document_index must be a positive integer');
}
if (new Set(indexes).size !== indexes.length) {
  return failure('INGESTION_CONTRACT_INVALID', 'Source document_index values must be unique');
}

const baseDocuments = [];
const archiveJobs = [];

for (const attachment of normalized) {
  const index = attachment.document_index;
  const extension = attachment.file_extension;

  if (supportedArchives.has(extension)) {
    const extractorJobId = `${analysisRunId}--source-${String(index).padStart(6, '0')}`;
    if (!attachment.download_url) {
      return failure('SOURCE_ARCHIVE_DOWNLOAD_FAILED', 'Archive download URL is missing', index, extractorJobId);
    }
    if (attachment.source_size !== null && attachment.source_size > maxArchiveBytes) {
      return failure('ARCHIVE_TOO_LARGE', 'Declared source archive size exceeds 100 MiB', index, extractorJobId);
    }
    archiveJobs.push({
      analysis_run_id: analysisRunId,
      source_attachment_index: index,
      extractor_job_id: extractorJobId,
      declared_extension: extension,
      source_attachment: attachment,
      download_url: attachment.download_url,
    });
    continue;
  }

  const processable = supportedDocuments.has(extension);
  baseDocuments.push({
    source_attachment_index: index,
    sort_path: '',
    file_name: attachment.file_name,
    file_extension: extension || null,
    display_name: attachment.display_name,
    download_url: attachment.download_url,
    publication_at: attachment.publication_at,
    source_size: attachment.source_size,
    mime_type: null,
    file_size: null,
    status: processable ? 'pending' : 'skipped',
    error_message: null,
    ingestion_metadata: {
      source_attachment_index: index,
      artifact_kind: processable ? 'direct_document' : 'unsupported_file',
      archive_chain: [],
      entry_path: null,
      archive_depth: 0,
      content_sha256: null,
      extractor_job_id: null,
      skip_reason: processable ? null : 'unsupported_file_type',
    },
  });
}

return [{ json: {
  schema_version: 'tender_document_ingestion_v1',
  analysis_run_id: analysisRunId,
  source_attachments: normalized,
  source_attachment_count: normalized.length,
  base_documents: baseDocuments,
  archive_jobs: archiveJobs,
  preliminary_failure: null,
} }];
```

### 5.2. HTTP nodes

`Скачать архив`:

```text
Method: GET
URL: {{ $json.job.download_url }}
Response Format: File
Put Output in Field: archive
Timeout: {{ Math.max(1000, $json.job.deadline_epoch_ms - Date.now()) }}
Retry On Fail: false
On Error: Continue (using error output)
```

`Начать обработку архива`:

```js
const archiveJob = $input.first().json.archive_jobs;
if (!archiveJob?.extractor_job_id) {
  throw new Error('[Начать обработку архива] Archive loop item has no extractor job');
}

return [{ json: {
  job: {
    ...archiveJob,
    deadline_epoch_ms: Date.now() + (5 * 60 * 1000),
  },
} }];
```

`Распаковать архив`:

```text
Method: POST
URL: {{ 'http://tender-archive-extractor:8080/v1/extractions/' + encodeURIComponent($json.job.extractor_job_id) }}
Query run_id: {{ $json.job.analysis_run_id }}
Query source_attachment_index: {{ $json.job.source_attachment_index }}
Query declared_extension: {{ $json.job.declared_extension }}
Query deadline_epoch_ms: {{ $json.job.deadline_epoch_ms }}
Send Body: true
Body Content Type: n8n Binary File
Input Data Field Name: archive
Response Format: JSON
Include Response Headers and Status: true
Never Error: true
Timeout: {{ Math.max(1000, $json.job.deadline_epoch_ms - Date.now() + 5000) }}
Retry On Fail: false
On Error: Continue (using error output)
```

Transport grace не продлевает распаковку: extractor сам проверяет исходный `deadline_epoch_ms` и убивает `7zz` не позднее него.

`Нормализовать скачивание архива`:

```js
const response = $input.first();
const job = $('Начать обработку архива').item.json.job ?? null;

function failed(errorCode, errorMessage) {
  return [{ json: {
    archive_ok: false,
    job,
    failure: {
      error_code: errorCode,
      error_message: String(errorMessage).slice(0, 500),
      source_attachment_index: job?.source_attachment_index ?? null,
      extractor_job_id: job?.extractor_job_id ?? null,
    },
  } }];
}

if (!job) {
  return failed('INGESTION_CONTRACT_INVALID', 'Archive loop item has no job');
}
if (Date.now() >= Number(job.deadline_epoch_ms)) {
  return failed('ARCHIVE_TIMEOUT', 'Archive preparation deadline expired during download');
}
if (response.json?.error) {
  return failed('SOURCE_ARCHIVE_DOWNLOAD_FAILED', 'Source archive download failed');
}
if (!response.binary?.archive) {
  return failed('SOURCE_ARCHIVE_DOWNLOAD_FAILED', 'Source archive binary is missing');
}

const buffer = await this.helpers.getBinaryDataBuffer(0, 'archive');
if (buffer.length > 100 * 1024 * 1024) {
  return failed('ARCHIVE_TOO_LARGE', 'Downloaded source archive exceeds 100 MiB');
}

return [{
  json: {
    archive_ok: true,
    job,
    downloaded_size_bytes: buffer.length,
  },
  binary: {
    archive: response.binary.archive,
  },
}];
```

`Нормализовать распаковку`:

```js
const response = $input.first().json;
const job = $('Нормализовать скачивание архива').item.json.job;

function failed(errorCode, errorMessage) {
  return [{ json: {
    archive_ok: false,
    job,
    failure: {
      error_code: errorCode,
      error_message: String(errorMessage).slice(0, 500),
      source_attachment_index: job.source_attachment_index,
      extractor_job_id: job.extractor_job_id,
    },
  } }];
}

if (response.error) {
  const message = String(response.error.message ?? response.error);
  return failed(
    /timed?\s*out|timeout/iu.test(message) ? 'ARCHIVE_TIMEOUT' : 'EXTRACTOR_UNAVAILABLE',
    /timed?\s*out|timeout/iu.test(message)
      ? 'Archive extractor request timed out'
      : 'Archive extractor is unavailable',
  );
}

const statusCode = Number(response.statusCode ?? 200);
const body = response.body ?? response;
if (statusCode < 200 || statusCode >= 300 || body.success !== true) {
  return failed(
    String(body.error?.code ?? (statusCode === 408 ? 'ARCHIVE_TIMEOUT' : 'EXTRACTOR_UNAVAILABLE')),
    String(body.error?.message ?? 'Archive extractor rejected the job'),
  );
}

if (
  body.schema_version !== 'tender_archive_extraction_v1'
  || body.job_id !== job.extractor_job_id
  || body.analysis_run_id !== job.analysis_run_id
  || Number(body.source_attachment_index) !== job.source_attachment_index
  || !Array.isArray(body.entries)
) {
  return failed('INGESTION_CONTRACT_INVALID', 'Archive extractor response contract mismatch');
}

return [{ json: {
  archive_ok: true,
  job,
  extractor_result: body,
} }];
```

`Сформировать ошибку подготовки`:

```js
const context = $('Проверить и классифицировать вход').first().json;
const current = $input.first().json;
const failure = current.failure ?? context.preliminary_failure ?? (current.error ? {
  error_code: 'INGESTION_CONTRACT_INVALID',
  error_message: String(current.error.message ?? current.error),
  source_attachment_index: current.job?.source_attachment_index ?? null,
  extractor_job_id: current.job?.extractor_job_id ?? null,
} : {
  error_code: 'INGESTION_CONTRACT_INVALID',
  error_message: 'Preparation workflow reached failure branch without typed error',
  source_attachment_index: null,
  extractor_job_id: null,
});

return [{ json: {
  success: false,
  schema_version: 'tender_document_ingestion_v1',
  analysis_run_id: context.analysis_run_id,
  source_attachments: context.source_attachments,
  failure: {
    error_code: String(failure.error_code),
    error_message: String(failure.error_message).slice(0, 500),
    source_attachment_index: failure.source_attachment_index ?? null,
    extractor_job_id: failure.extractor_job_id ?? null,
  },
} }];
```

### 5.3. `Сформировать полный manifest`

Node обязан:

1. прочитать context из `$('Проверить и классифицировать вход').first().json`;
2. немедленно вернуть `success=false`, если присутствует `preliminary_failure`;
3. потребовать ровно один successful extractor result на каждый `archive_job`;
4. добавить source archive как `archive_container/skipped/archive_container_expanded`;
5. добавить nested containers с тем же terminal статусом;
6. добавить extracted PDF/DOCX/XLSX как `pending`;
7. добавить остальные leaf files как `skipped/unsupported_file_type`;
8. сортировать по `source_attachment_index`, затем root перед entries, затем по `logical_path.normalize('NFC').toLocaleLowerCase('en-US')`, затем по исходному `logical_path`;
9. назначить `document_index = array position + 1` только после полной сортировки;
10. вернуть `NO_PROCESSABLE_DOCUMENTS`, если `pending=0`.

Каждый extracted display name формируется точно так:

```js
`${sourceAttachment.display_name ?? sourceAttachment.file_name} :: ${entry.logical_path}`
```

Каждый extracted `ingestion_metadata`:

```js
{
  source_attachment_index: sourceAttachment.document_index,
  artifact_kind: processable ? 'extracted_document' : 'unsupported_file',
  archive_chain: [sourceAttachment.file_name, ...entry.archive_chain],
  entry_path: entry.logical_path,
  archive_depth: entry.archive_depth,
  content_sha256: entry.sha256,
  extractor_job_id: result.job_id,
  skip_reason: processable ? null : 'unsupported_file_type',
}
```

Source archive container использует `archive_depth=1`, `entry_path=null`, `content_sha256=result.source.sha256`; nested archive container использует `entry.archive_depth`, `entry.logical_path` и `skip_reason='archive_container_expanded'`.

Полный Code node:

```js
const context = $('Проверить и классифицировать вход').first().json;
const supportedDocuments = new Set(['pdf', 'docx', 'xlsx']);

function failure(errorCode, errorMessage, sourceAttachmentIndex = null, extractorJobId = null) {
  return [{ json: {
    success: false,
    schema_version: 'tender_document_ingestion_v1',
    analysis_run_id: context.analysis_run_id,
    source_attachments: context.source_attachments,
    failure: {
      error_code: errorCode,
      error_message: String(errorMessage).slice(0, 500),
      source_attachment_index: sourceAttachmentIndex,
      extractor_job_id: extractorJobId,
    },
  } }];
}

if (context.preliminary_failure) {
  const current = context.preliminary_failure;
  return failure(
    current.error_code,
    current.error_message,
    current.source_attachment_index,
    current.extractor_job_id,
  );
}

const archiveResults = $input.all()
  .map((item) => item.json)
  .filter((item) => item.extractor_result)
  .sort((left, right) => left.job.source_attachment_index - right.job.source_attachment_index);

if (archiveResults.length !== context.archive_jobs.length) {
  return failure(
    'INGESTION_CONTRACT_INVALID',
    `Expected ${context.archive_jobs.length} archive results, received ${archiveResults.length}`,
  );
}

const documents = structuredClone(context.base_documents);

for (const archiveItem of archiveResults) {
  const job = archiveItem.job;
  const result = archiveItem.extractor_result;
  const source = job.source_attachment;

  if (!result.source?.sha256 || !Number.isInteger(Number(result.source?.size_bytes))) {
    return failure(
      'INGESTION_CONTRACT_INVALID',
      'Extractor source metadata is invalid',
      job.source_attachment_index,
      job.extractor_job_id,
    );
  }

  documents.push({
    source_attachment_index: source.document_index,
    sort_path: '',
    file_name: source.file_name,
    file_extension: source.file_extension,
    display_name: source.display_name,
    download_url: source.download_url,
    publication_at: source.publication_at,
    source_size: source.source_size,
    mime_type: null,
    file_size: Number(result.source.size_bytes),
    status: 'skipped',
    error_message: null,
    ingestion_metadata: {
      source_attachment_index: source.document_index,
      artifact_kind: 'archive_container',
      archive_chain: [source.file_name],
      entry_path: null,
      archive_depth: 1,
      content_sha256: result.source.sha256,
      extractor_job_id: result.job_id,
      skip_reason: 'archive_container_expanded',
    },
  });

  for (const entry of result.entries) {
    if (!['file', 'archive_container'].includes(entry.kind)) {
      return failure(
        'INGESTION_CONTRACT_INVALID',
        `Unsupported extractor entry kind: ${String(entry.kind)}`,
        job.source_attachment_index,
        job.extractor_job_id,
      );
    }

    const extension = String(entry.file_extension ?? '').toLowerCase();
    const isContainer = entry.kind === 'archive_container';
    const processable = !isContainer && supportedDocuments.has(extension);
    const logicalPath = String(entry.logical_path ?? '');
    if (!logicalPath || !entry.file_name || !Number.isInteger(Number(entry.archive_depth))) {
      return failure(
        'INGESTION_CONTRACT_INVALID',
        'Extractor entry metadata is incomplete',
        job.source_attachment_index,
        job.extractor_job_id,
      );
    }
    if (processable && !entry.download_url) {
      return failure(
        'INGESTION_CONTRACT_INVALID',
        'Processable extracted file has no artifact URL',
        job.source_attachment_index,
        job.extractor_job_id,
      );
    }

    documents.push({
      source_attachment_index: source.document_index,
      sort_path: logicalPath,
      file_name: String(entry.file_name),
      file_extension: extension || null,
      display_name: `${source.display_name ?? source.file_name} :: ${logicalPath}`,
      download_url: processable ? String(entry.download_url) : null,
      publication_at: source.publication_at,
      source_size: source.source_size,
      mime_type: entry.mime_type ?? null,
      file_size: Number(entry.size_bytes ?? 0),
      status: processable ? 'pending' : 'skipped',
      error_message: null,
      ingestion_metadata: {
        source_attachment_index: source.document_index,
        artifact_kind: isContainer
          ? 'archive_container'
          : processable ? 'extracted_document' : 'unsupported_file',
        archive_chain: [source.file_name, ...(Array.isArray(entry.archive_chain) ? entry.archive_chain : [])],
        entry_path: logicalPath,
        archive_depth: Number(entry.archive_depth),
        content_sha256: entry.sha256 ?? null,
        extractor_job_id: result.job_id,
        skip_reason: processable
          ? null
          : isContainer ? 'archive_container_expanded' : 'unsupported_file_type',
      },
    });
  }
}

function compareText(left, right) {
  const leftFolded = left.normalize('NFC').toLocaleLowerCase('en-US');
  const rightFolded = right.normalize('NFC').toLocaleLowerCase('en-US');
  if (leftFolded < rightFolded) return -1;
  if (leftFolded > rightFolded) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

documents.sort((left, right) => {
  const sourceOrder = left.source_attachment_index - right.source_attachment_index;
  return sourceOrder !== 0 ? sourceOrder : compareText(left.sort_path, right.sort_path);
});

const finalDocuments = documents.map(({ sort_path: _sortPath, ...document }, index) => ({
  document_index: index + 1,
  ...document,
}));
const processableCount = finalDocuments.filter((document) => document.status === 'pending').length;
const skippedCount = finalDocuments.filter((document) => document.status === 'skipped').length;
const archiveCount = finalDocuments.filter(
  (document) => document.ingestion_metadata.artifact_kind === 'archive_container',
).length;

if (processableCount === 0) {
  return failure('NO_PROCESSABLE_DOCUMENTS', 'No PDF, DOCX or XLSX documents were found');
}

return [{ json: {
  success: true,
  schema_version: 'tender_document_ingestion_v1',
  analysis_run_id: context.analysis_run_id,
  manifest: {
    schema_version: 'tender_document_ingestion_v1',
    analysis_run_id: context.analysis_run_id,
    source_attachment_count: context.source_attachment_count,
    registered_document_count: finalDocuments.length,
    processable_document_count: processableCount,
    skipped_document_count: skippedCount,
    archive_count: archiveCount,
    documents: finalDocuments,
  },
} }];
```

## 6. Точный Orchestrator graph после изменения

Существующая цепочка до `Создать запуск анализа` сохраняется. После неё graph становится:

```text
Создать запуск анализа
→ Подготовить документацию
→ Подготовка успешна?

Подготовка успешна? [true]
→ Зарегистрировать документы
→ Документы зарегистрированы?

Документы зарегистрированы? [true]
→ разделить документы
→ Запустить обработку документа

Подготовка успешна? [false]
→ Сформировать failure manifest
→ Зафиксировать ошибку подготовки
→ Подготовить cleanup failed run
→ Очистить workspace failed run
→ Остановить run с ошибкой

Подготовить документацию [error output]
→ Сформировать failure manifest

Зарегистрировать документы [error output]
→ Сформировать ошибку регистрации
→ Зафиксировать ошибку регистрации
→ Подготовить cleanup failed run
→ Очистить workspace failed run

Документы зарегистрированы? [false]
→ Сформировать ошибку регистрации
```

Удаляется нода `ВРЕМЕННЫЙ ФИЛЬТР РАСШИРЕНИЯ` и обе её connections. `разделить документы` получает уже только `pending` attachments из registration SQL.

### 6.1. Изменения существующих нод

`Создать запуск анализа`:

- SQL сохраняется;
- пятый `queryReplacement` меняется с `$json.attachments.length` на `0`;
- attachments продолжают возвращаться через `$7::jsonb`;
- созданный run остаётся в `created` до manifest commit.

`Запустить обработку документа`:

- type/version остаются Execute Workflow 1.3;
- mode остаётся `each`;
- wait остаётся `true`;
- production candidate сохраняет authoritative target `W4mNOUkdsFtNENpI`;
- input contract не меняется.

### 6.2. Новые ноды Orchestrator

| Нода | Type/version | Точная функция |
|---|---|---|
| `Подготовить документацию` | Execute Workflow 1.3 | mode `once`, wait `true`, typed inputs `analysis_run_id`, `attachments`; `onError=continueErrorOutput` |
| `Подготовка успешна?` | If 2.3 | `{{ $json.success === true && $json.manifest?.schema_version === 'tender_document_ingestion_v1' }}` |
| `Документы зарегистрированы?` | If 2.3 | `{{ $json.registration_committed === true }}` |
| `Сформировать failure manifest` | Code 2 | Сформировать source audit rows и safe failure |
| `Зафиксировать ошибку подготовки` | Postgres 2.6 | UPSERT source audit rows + run `failed` одной statement |
| `Сформировать ошибку регистрации` | Code 2 | `REGISTRATION_FAILED`, сохранить run id |
| `Зафиксировать ошибку регистрации` | Postgres 2.6 | Только atomic run transition в `failed` |
| `Подготовить cleanup failed run` | Code 2 | Восстановить единый `{analysis_run_id, failure}` из DB result |
| `Очистить workspace failed run` | HTTP Request 4.4 | DELETE exact run; Never Error=true; error output включён |
| `Остановить run с ошибкой` | Stop And Error 1 | Error message из safe failure contract |

ID нового preparation workflow нельзя придумать заранее: n8n создаёт его при импорте inactive workflow. В `Подготовить документацию.workflowId.value` записывается ровно `id`, возвращённый созданием workflow на предыдущем шаге; cached name — `TENDER — Подготовить документацию`. До получения этого ID Orchestrator candidate не импортируется.

Input mapping ноды `Подготовить документацию`:

```text
analysis_run_id: {{ $json.analysis_run_id }}
attachments: {{ $json.attachments }}
```

### 6.3. Success registration SQL

`Зарегистрировать документы` получает:

```text
$1 = analysis_run_id
$2 = JSON.stringify(manifest.documents)
$3 = manifest.registered_document_count
```

`queryReplacement`:

```text
{{ [$json.analysis_run_id, JSON.stringify($json.manifest.documents), $json.manifest.registered_document_count] }}
```

и использует этот SQL:

```sql
WITH run_state AS MATERIALIZED (
    SELECT id, status
    FROM tender_analysis_runs
    WHERE id = $1::uuid
    FOR UPDATE
),
input_documents AS MATERIALIZED (
    SELECT
        ordinality::integer AS ordinal_position,
        (doc->>'document_index')::integer AS document_index,
        NULLIF(doc->>'file_name', '') AS file_name,
        NULLIF(doc->>'file_extension', '') AS file_extension,
        NULLIF(doc->>'display_name', '') AS display_name,
        NULLIF(doc->>'download_url', '') AS download_url,
        NULLIF(doc->>'publication_at', '')::timestamptz AS publication_at,
        NULLIF(doc->>'source_size', '')::bigint AS source_size,
        NULLIF(doc->>'mime_type', '') AS mime_type,
        NULLIF(doc->>'file_size', '')::bigint AS file_size,
        doc->>'status' AS status,
        COALESCE(doc->'ingestion_metadata', '{}'::jsonb) AS ingestion_metadata
    FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS value(doc, ordinality)
),
input_stats AS (
    SELECT
        COUNT(*)::integer AS input_count,
        COUNT(*) FILTER (WHERE status = 'pending')::integer AS processable_count,
        BOOL_AND(document_index = ordinal_position)::boolean AS indexes_are_dense,
        BOOL_AND(status IN ('pending', 'skipped'))::boolean AS statuses_are_valid,
        BOOL_AND(jsonb_typeof(ingestion_metadata) = 'object')::boolean AS metadata_is_valid
    FROM input_documents
),
existing_compatibility AS (
    SELECT NOT EXISTS (
        SELECT 1
        FROM tender_analysis_documents d
        WHERE d.analysis_run_id = $1::uuid
          AND NOT EXISTS (
              SELECT 1
              FROM input_documents i
              WHERE i.document_index = d.document_index
          )
    ) AS has_no_extra_documents
),
upserted_documents AS (
    INSERT INTO tender_analysis_documents (
        analysis_run_id,
        document_index,
        file_name,
        file_extension,
        display_name,
        download_url,
        publication_at,
        source_size,
        mime_type,
        file_size,
        status,
        error_message,
        ingestion_metadata
    )
    SELECT
        $1::uuid,
        i.document_index,
        i.file_name,
        i.file_extension,
        i.display_name,
        i.download_url,
        i.publication_at,
        i.source_size,
        i.mime_type,
        i.file_size,
        i.status,
        NULL,
        i.ingestion_metadata
    FROM input_documents i
    CROSS JOIN input_stats s
    CROSS JOIN existing_compatibility e
    CROSS JOIN run_state r
    WHERE r.status IN ('created', 'processing')
      AND s.input_count = $3::integer
      AND s.input_count > 0
      AND s.processable_count > 0
      AND s.indexes_are_dense
      AND s.statuses_are_valid
      AND s.metadata_is_valid
      AND e.has_no_extra_documents
    ON CONFLICT (analysis_run_id, document_index)
    DO UPDATE SET
        file_name = EXCLUDED.file_name,
        file_extension = EXCLUDED.file_extension,
        display_name = EXCLUDED.display_name,
        download_url = EXCLUDED.download_url,
        publication_at = EXCLUDED.publication_at,
        source_size = EXCLUDED.source_size,
        mime_type = EXCLUDED.mime_type,
        file_size = EXCLUDED.file_size,
        ingestion_metadata = EXCLUDED.ingestion_metadata,
        status = CASE
            WHEN tender_analysis_documents.status IN ('pending', 'skipped')
                THEN EXCLUDED.status
            ELSE tender_analysis_documents.status
        END,
        updated_at = NOW()
    RETURNING
        id,
        analysis_run_id,
        document_index,
        file_name,
        file_extension,
        display_name,
        download_url,
        publication_at,
        source_size,
        mime_type,
        file_size,
        status,
        ingestion_metadata
),
registration_stats AS (
    SELECT
        COUNT(*)::integer AS registered_count,
        COUNT(*) FILTER (WHERE status = 'pending')::integer AS pending_dispatch_count
    FROM upserted_documents
),
pending_documents AS (
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'document_id', id,
                'document_index', document_index,
                'file_name', file_name,
                'file_extension', file_extension,
                'display_name', display_name,
                'download_url', download_url,
                'publication_at', publication_at,
                'source_size', source_size,
                'mime_type', mime_type,
                'file_size', file_size,
                'status', status,
                'ingestion_metadata', ingestion_metadata
            ) ORDER BY document_index
        ) FILTER (WHERE status = 'pending'),
        '[]'::jsonb
    ) AS attachments
    FROM upserted_documents
),
updated_run AS (
    UPDATE tender_analysis_runs r
    SET
        status = 'processing',
        documents_total = s.registered_count,
        error_message = NULL,
        updated_at = NOW()
    FROM registration_stats s, input_stats i
    WHERE r.id = $1::uuid
      AND r.status IN ('created', 'processing')
      AND s.registered_count = i.input_count
      AND s.registered_count = $3::integer
    RETURNING r.*
)
SELECT
    $1::uuid AS analysis_run_id,
    (r.id IS NOT NULL) AS registration_committed,
    COALESCE(r.status, (SELECT status FROM run_state LIMIT 1)) AS status,
    COALESCE(r.documents_total, 0) AS documents_total,
    s.registered_count AS registered_documents_count,
    i.processable_count,
    s.pending_dispatch_count,
    p.attachments,
    CASE
        WHEN r.id IS NOT NULL THEN 'manifest_committed'
        WHEN NOT EXISTS (SELECT 1 FROM run_state) THEN 'run_not_found'
        WHEN NOT (SELECT has_no_extra_documents FROM existing_compatibility) THEN 'unexpected_existing_documents'
        WHEN i.input_count <> $3::integer THEN 'manifest_count_mismatch'
        WHEN i.processable_count = 0 THEN 'no_processable_documents'
        WHEN NOT i.indexes_are_dense THEN 'document_indexes_not_dense'
        WHEN NOT i.statuses_are_valid THEN 'document_status_invalid'
        WHEN NOT i.metadata_is_valid THEN 'ingestion_metadata_invalid'
        ELSE 'registration_not_committed'
    END AS registration_reason
FROM input_stats i
CROSS JOIN registration_stats s
CROSS JOIN pending_documents p
LEFT JOIN updated_run r ON TRUE;
```

Нода Postgres получает `onError=continueErrorOutput`. `Документы зарегистрированы?` пропускает дальше только `registration_committed=true`. Таким образом ни SQL exception, ни validation result не запускают Worker.

### 6.4. Preparation failure audit

`Сформировать failure manifest` использует исходные attachments из `$('Создать запуск анализа').first().json.attachments`. Для routine archive failure source row с совпавшим `source_attachment_index` получает `failed`; все остальные source rows получают `skipped/run_aborted_during_preparation`. Для `NO_PROCESSABLE_DOCUMENTS` все source rows получают `skipped`, сохраняя собственный `unsupported_file_type` там, где тип неподдерживаем.

Code node:

```js
const current = $input.first().json;
const run = $('Создать запуск анализа').first().json;
const analysisRunId = String(run.analysis_run_id);
const sourceAttachments = Array.isArray(run.attachments) ? run.attachments : [];
const supportedDocuments = new Set(['pdf', 'docx', 'xlsx']);
const supportedArchives = new Set(['zip', '7z', 'rar', 'tar', 'gz', 'tar.gz', 'tgz']);
const receivedFailure = current.failure ?? current.error ?? {};
const failure = {
  error_code: String(receivedFailure.error_code ?? 'PREPARATION_WORKFLOW_FAILED'),
  error_message: String(
    receivedFailure.error_message
      ?? receivedFailure.message
      ?? 'Document preparation workflow failed',
  ).slice(0, 500),
  source_attachment_index: Number.isInteger(Number(receivedFailure.source_attachment_index))
    ? Number(receivedFailure.source_attachment_index)
    : null,
  extractor_job_id: receivedFailure.extractor_job_id ?? null,
};

function extensionOf(attachment) {
  const explicit = String(attachment.file_extension ?? '')
    .trim().toLowerCase().replace(/^\./u, '');
  const name = String(attachment.file_name ?? '').trim().toLowerCase();
  if (explicit === 'tar.gz' || name.endsWith('.tar.gz')) return 'tar.gz';
  if (explicit) return explicit;
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1) : '';
}

const noProcessable = failure.error_code === 'NO_PROCESSABLE_DOCUMENTS';
const failureDocuments = sourceAttachments
  .slice()
  .sort((left, right) => Number(left.document_index) - Number(right.document_index))
  .map((attachment, index) => {
    const sourceIndex = Number(attachment.document_index);
    const extension = extensionOf(attachment);
    const isFailedSource = !noProcessable && sourceIndex === failure.source_attachment_index;
    const processable = supportedDocuments.has(extension);
    const isArchive = supportedArchives.has(extension);
    const skipReason = noProcessable && !processable && !isArchive
      ? 'unsupported_file_type'
      : isFailedSource ? failure.error_code : 'run_aborted_during_preparation';

    return {
      document_index: index + 1,
      file_name: attachment.file_name ?? null,
      file_extension: extension || null,
      display_name: attachment.display_name ?? attachment.file_name ?? null,
      download_url: attachment.download_url ?? null,
      publication_at: attachment.publication_at ?? null,
      source_size: attachment.source_size ?? null,
      mime_type: null,
      file_size: null,
      status: isFailedSource ? 'failed' : 'skipped',
      error_message: isFailedSource
        ? `${failure.error_code}: ${failure.error_message}`.slice(0, 500)
        : null,
      ingestion_metadata: {
        source_attachment_index: sourceIndex,
        artifact_kind: isArchive
          ? 'archive_container'
          : processable ? 'direct_document' : 'unsupported_file',
        archive_chain: isArchive ? [attachment.file_name ?? null].filter(Boolean) : [],
        entry_path: null,
        archive_depth: isArchive ? 1 : 0,
        content_sha256: null,
        extractor_job_id: isFailedSource ? failure.extractor_job_id : null,
        skip_reason: skipReason,
      },
    };
  });

return [{ json: {
  analysis_run_id: analysisRunId,
  failure,
  failure_documents: failureDocuments,
} }];
```

`Зафиксировать ошибку подготовки` одной PostgreSQL statement:

1. UPSERT всех source audit rows по `(analysis_run_id, document_index)`;
2. сохраняет `ingestion_metadata` и document-level `error_message` только для failed source;
3. переводит run из `created` в `failed`;
4. устанавливает `documents_total` равным числу source audit rows;
5. сохраняет run-level `error_message` как `{error_code}: {safe message}`.

Parameters:

```text
$1 = analysis_run_id
$2 = JSON.stringify(failure_documents)
$3 = failure.error_code + ': ' + failure.error_message
```

`queryReplacement`:

```text
{{ [$json.analysis_run_id, JSON.stringify($json.failure_documents), $json.failure.error_code + ': ' + $json.failure.error_message] }}
```

SQL:

```sql
WITH input_documents AS (
    SELECT
        (doc->>'document_index')::integer AS document_index,
        NULLIF(doc->>'file_name', '') AS file_name,
        NULLIF(doc->>'file_extension', '') AS file_extension,
        NULLIF(doc->>'display_name', '') AS display_name,
        NULLIF(doc->>'download_url', '') AS download_url,
        NULLIF(doc->>'publication_at', '')::timestamptz AS publication_at,
        NULLIF(doc->>'source_size', '')::bigint AS source_size,
        NULLIF(doc->>'mime_type', '') AS mime_type,
        NULLIF(doc->>'file_size', '')::bigint AS file_size,
        doc->>'status' AS status,
        NULLIF(doc->>'error_message', '') AS error_message,
        COALESCE(doc->'ingestion_metadata', '{}'::jsonb) AS ingestion_metadata
    FROM jsonb_array_elements($2::jsonb) AS value(doc)
),
upserted_documents AS (
    INSERT INTO tender_analysis_documents (
        analysis_run_id,
        document_index,
        file_name,
        file_extension,
        display_name,
        download_url,
        publication_at,
        source_size,
        mime_type,
        file_size,
        status,
        error_message,
        ingestion_metadata
    )
    SELECT
        $1::uuid,
        document_index,
        file_name,
        file_extension,
        display_name,
        download_url,
        publication_at,
        source_size,
        mime_type,
        file_size,
        status,
        error_message,
        ingestion_metadata
    FROM input_documents
    WHERE status IN ('failed', 'skipped')
    ON CONFLICT (analysis_run_id, document_index)
    DO UPDATE SET
        file_name = EXCLUDED.file_name,
        file_extension = EXCLUDED.file_extension,
        display_name = EXCLUDED.display_name,
        download_url = EXCLUDED.download_url,
        publication_at = EXCLUDED.publication_at,
        source_size = EXCLUDED.source_size,
        mime_type = EXCLUDED.mime_type,
        file_size = EXCLUDED.file_size,
        status = CASE
            WHEN tender_analysis_documents.status IN ('pending', 'skipped')
                THEN EXCLUDED.status
            ELSE tender_analysis_documents.status
        END,
        error_message = CASE
            WHEN tender_analysis_documents.status IN ('pending', 'skipped')
                THEN EXCLUDED.error_message
            ELSE tender_analysis_documents.error_message
        END,
        ingestion_metadata = EXCLUDED.ingestion_metadata,
        updated_at = NOW()
    RETURNING id
),
failure_stats AS (
    SELECT COUNT(*)::integer AS documents_total
    FROM upserted_documents
),
updated_run AS (
    UPDATE tender_analysis_runs r
    SET
        status = 'failed',
        documents_total = s.documents_total,
        error_message = LEFT($3, 500),
        updated_at = NOW()
    FROM failure_stats s
    WHERE r.id = $1::uuid
      AND r.status IN ('created', 'failed')
    RETURNING r.id, r.status, r.documents_total, r.error_message
)
SELECT
    id AS analysis_run_id,
    status,
    documents_total,
    error_message
FROM updated_run;
```

Обе DB failure-ноды возвращают `analysis_run_id` и `error_message`. Общая нода `Подготовить cleanup failed run` содержит:

```js
const input = $input.first().json;
const safeMessage = String(input.error_message ?? 'INGESTION_FAILED: Analysis stopped').slice(0, 500);
const separator = safeMessage.indexOf(':');
const errorCode = separator >= 0 ? safeMessage.slice(0, separator).trim() : 'INGESTION_FAILED';
const errorMessage = separator >= 0 ? safeMessage.slice(separator + 1).trim() : safeMessage;

return [{ json: {
  analysis_run_id: String(input.analysis_run_id),
  failure: {
    error_code: errorCode,
    error_message: errorMessage,
  },
} }];
```

После неё выполняется:

```text
DELETE http://tender-archive-extractor:8080/v1/runs/{{ encodeURIComponent($json.analysis_run_id) }}
```

Success и error output cleanup соединяются с `Остановить run с ошибкой`. Stop message:

```text
{{ $('Подготовить cleanup failed run').item.json.failure.error_code + ': ' + $('Подготовить cleanup failed run').item.json.failure.error_message }}
```

### 6.5. Registration failure

Если success registration SQL вернул `registration_committed=false` или завершился node error, `Сформировать ошибку регистрации` возвращает:

```json
{
  "analysis_run_id": "uuid",
  "failure": {
    "error_code": "REGISTRATION_FAILED",
    "error_message": "Document manifest was not committed",
    "source_attachment_index": null,
    "extractor_job_id": null
  }
}
```

`Зафиксировать ошибку регистрации` выполняет только:

```sql
UPDATE tender_analysis_runs
SET
    status = 'failed',
    error_message = $2,
    updated_at = NOW()
WHERE id = $1::uuid
  AND status IN ('created', 'processing')
RETURNING id AS analysis_run_id, status, error_message;
```

`queryReplacement`:

```text
{{ [$json.analysis_run_id, $json.failure.error_code + ': ' + $json.failure.error_message] }}
```

Далее используется тот же cleanup и Stop path.

## 7. Точное изменение Worker

В `workflows/n8n-exports/TENDER — Обработать документ.json` меняется только SQL ноды `Проверить готовность к агрегации` и соответствующая документация/tests. Download, parsing, AI и fact persistence не меняются.

Условия atomic claim становятся:

```sql
AND s.documents_total > 0
AND s.registered_documents_count = s.documents_total
AND s.pending_documents_count = 0
AND s.processing_documents_count = 0
AND s.failed_documents_count = 0
AND s.completed_documents_count > 0
AND s.completed_documents_count + s.skipped_documents_count = s.documents_total
```

Success reason меняется:

```text
all_documents_terminal
```

Порядок failure reasons:

```sql
CASE
    WHEN c.id IS NOT NULL THEN 'all_documents_terminal'
    WHEN s.registered_documents_count <> s.documents_total THEN 'documents_count_mismatch'
    WHEN s.failed_documents_count > 0 THEN 'failed_documents_exist'
    WHEN s.processing_documents_count > 0 THEN 'documents_still_processing'
    WHEN s.pending_documents_count > 0 THEN 'documents_still_pending'
    WHEN s.completed_documents_count = 0 THEN 'no_completed_documents'
    WHEN s.completed_documents_count + s.skipped_documents_count <> s.documents_total
        THEN 'documents_not_terminal'
    ELSE 'run_not_claimed'
END
```

Существующий `WHERE r.status='processing'` и single-winner transition в `ready_for_aggregation` сохраняются. `Проверить готовность к агрегации1` и вызов Aggregator не меняются.

## 8. Точный cleanup completed run

В `workflows/n8n-exports/TENDER — Финализация анализа.json` true branch существующей ноды `If` меняется с прямого вызова Report на:

```text
If [true]
→ Очистить workspace completed run
→ Продолжить после cleanup
→ Call 'TENDER — Генерация отчета'
```

`Очистить workspace completed run`:

```text
Type/version: HTTP Request 4.4
Method: DELETE
URL: {{ 'http://tender-archive-extractor:8080/v1/runs/' + encodeURIComponent($json.analysis_run_id) }}
Response Format: JSON
Include Response Headers and Status: true
Never Error: true
Timeout: 10000
Retry On Fail: false
On Error: Continue (using error output)
```

Оба выхода соединяются с `Продолжить после cleanup` (Code 2). Code возвращает исходный finalization payload и observability field:

```js
const finalization = $('Проверить результат финализации').first().json;
const cleanupResponse = $input.first().json;
const statusCode = Number(cleanupResponse.statusCode ?? 0);
const transportError = cleanupResponse.error ?? null;

return [{ json: {
  ...finalization,
  archive_workspace_cleanup: {
    attempted: true,
    success: !transportError && statusCode >= 200 && statusCode < 300,
    status_code: statusCode || null,
    error: transportError ? String(transportError.message ?? transportError).slice(0, 300) : null,
  },
} }];
```

Cleanup failure не отменяет уже корректный `completed` и не блокирует Report, но остаётся видимым в execution data. TTL-cleanup является резервным механизмом.

## 9. Extractor implementation contract

### 9.1. Storage layout

Physical paths никогда не строятся из archive entry names:

```text
/var/lib/archive-extractor/
└── runs/
    └── {validated-analysis-run-uuid}/
        └── jobs/
            └── {validated-job-id}/
                ├── source.bin
                ├── manifest.json
                ├── work/
                └── artifacts/
                    └── {artifact-id}.bin
```

В manifest логический `entry_path` хранится отдельно. GET artifact разрешает только exact UUID + exact 64-hex artifact id, находит запись в `manifest.json`, затем открывает только соответствующий opaque path.

### 9.2. Required exported functions

```js
// config.mjs
export const config;

// errors.mjs
export class ArchiveError extends Error {
  constructor(code, message, httpStatus = 422, details = {}) {}
}
export function toSafeError(error) {}

// path-policy.mjs
export function normalizeLogicalPath(rawPath) {}
export function assertSafeLogicalPath(rawPath) {}
export function collisionKey(rawPath) {}

// sevenzip.mjs
export async function listArchive({ archivePath, signal }) {}
export async function streamEntry({ archivePath, entryPath, outputPath, byteBudget, signal }) {}

// store.mjs
export function pathsForJob({ analysisRunId, jobId }) {}
export async function readCommittedManifest({ analysisRunId, jobId }) {}
export async function commitJob({ analysisRunId, jobId, stagingDirectory, manifest }) {}
export async function resolveArtifact({ analysisRunId, artifactId }) {}
export async function deleteRun(analysisRunId) {}
export async function cleanupExpiredRuns({ now }) {}

// extract-job.mjs
export async function extractJob({
  inputStream,
  analysisRunId,
  sourceAttachmentIndex,
  declaredExtension,
  jobId,
  deadlineEpochMs,
}) {}

// server.mjs
export function createServer(dependencies = {}) {}
```

### 9.3. Extraction algorithm

Порядок внутри `extractJob` фиксирован:

1. проверить UUID, job id, positive source index, extension и deadline;
2. stream request в `source.bin`, одновременно SHA-256 и hard stop после `100 MiB`;
3. если committed job уже существует: тот же source SHA → вернуть сохранённый manifest; другой SHA → `JOB_INPUT_MISMATCH`;
4. определить фактический формат через `7zz l -slt` и сверить с declared extension;
5. создать очередь `{archivePath, archiveDepth, archiveChain, logicalPrefix}` с root depth `1`;
6. для каждого archive list entries до extraction;
7. увеличить общий `entry_count` для каждого file/directory/archive entry и остановить после `500`;
8. для каждого entry проверить path policy, link/special flags и normalized collision;
9. directory не извлекать;
10. regular entry извлекать через `7zz x -so` в назначенный сервисом opaque temp path, считая actual bytes;
11. остановить stream после `50 MiB` для одного entry или `300 MiB` общего actual output;
12. `.docx`/`.xlsx` считать terminal document до archive-signature detection;
13. другой archive по signature поставить в очередь; depth `4` → `ARCHIVE_DEPTH_EXCEEDED`;
14. GZIP→TAR для `.tar.gz`/`.tgz` считать одним logical archive level;
15. для terminal leaf вычислить SHA-256 и stable `artifact_id = sha256(job_id + "\n" + normalized logical path + "\n" + content sha256)`;
16. отсортировать entries детерминированно;
17. записать `manifest.json.tmp`, fsync, затем atomic rename в `manifest.json`;
18. только после rename job считается опубликованным;
19. при ошибке удалить staging directory и не публиковать partial artifacts;
20. AbortController останавливает `7zz` и streams при достижении `deadline_epoch_ms`.

7-Zip не получает original entry path как output path. Он пишет entry в stdout, а Node.js сохраняет поток в opaque file. Поэтому `../../`, абсолютный путь или symlink не могут управлять файловой системой даже до post-check; такие entries всё равно отклоняются typed error.

### 9.4. Typed errors

```text
INGESTION_CONTRACT_INVALID       400
SOURCE_ARCHIVE_DOWNLOAD_FAILED  n8n-side
PREPARATION_WORKFLOW_FAILED     n8n-side
JOB_INPUT_MISMATCH              409
ARCHIVE_TOO_LARGE               413
ARCHIVE_FORMAT_MISMATCH         422
ARCHIVE_ENCRYPTED               422
ARCHIVE_CORRUPT                 422
ARCHIVE_PATH_UNSAFE             422
ARCHIVE_ENTRY_LIMIT             413
ARCHIVE_FILE_TOO_LARGE          413
ARCHIVE_TOTAL_TOO_LARGE         413
ARCHIVE_DEPTH_EXCEEDED          422
ARCHIVE_TIMEOUT                 408
ARTIFACT_NOT_FOUND              404
ARTIFACT_STORE_ERROR            500
EXTRACTOR_BUSY                  503
EXTRACTOR_UNAVAILABLE           n8n-side
NO_PROCESSABLE_DOCUMENTS        n8n-side
REGISTRATION_FAILED             n8n-side
```

### 9.5. Container contract

`Dockerfile` pins:

```text
node:22.23.2-bookworm-slim
7-Zip 26.03 Linux x64
https://github.com/ip7z/7zip/releases/download/26.03/7z2603-linux-x64.tar.xz
sha256 dc99eff5008f1ab79bd7084c68513701547a808a89502bf4133683535ab3c695
```

`compose.yaml`:

```yaml
services:
  archive-extractor:
    build:
      context: .
    image: tender-archive-extractor:26.03-1
    container_name: tender-archive-extractor
    restart: unless-stopped
    read_only: true
    user: "10001:10001"
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    environment:
      ARCHIVE_EXTRACTOR_HOST: 0.0.0.0
      ARCHIVE_EXTRACTOR_PORT: "8080"
      ARCHIVE_EXTRACTOR_ROOT: /var/lib/archive-extractor
      ARCHIVE_EXTRACTOR_TTL_HOURS: "72"
      ARCHIVE_EXTRACTOR_CLEANUP_INTERVAL_MINUTES: "15"
      TZ: Europe/Moscow
    volumes:
      - /opt/tender-archive-extractor/data:/var/lib/archive-extractor
    tmpfs:
      - /tmp:size=64m,mode=1777
    networks:
      - n8n_default
    pids_limit: 64
    deploy:
      resources:
        limits:
          cpus: 0.50
          memory: 512M
          pids: 64
        reservations:
          memory: 128M
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

networks:
  n8n_default:
    external: true
```

Host port отсутствует. HTTP server допускает ровно один active extraction job; второй POST получает `503 EXTRACTOR_BUSY`. GET artifact и DELETE exact run не занимают extraction slot.

## 10. Persistence migration

Создать `deploy/postgres/migrations/2026-09-07-add-document-ingestion-metadata.sql`:

```sql
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.tender_analysis_documents
    ADD COLUMN IF NOT EXISTS ingestion_metadata jsonb
    NOT NULL
    DEFAULT '{}'::jsonb;

COMMIT;
```

До применения выполнить только read-only preflight:

```sql
SELECT
    ordinal_position,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'tender_analysis_documents'
ORDER BY ordinal_position;
```

Если `ingestion_metadata` уже существует с другим type/nullability/default, migration не выполнять и явно оформить conflict. Колонка additive; автоматический rollback через `DROP COLUMN` не предусмотрен, потому что он уничтожил бы audit metadata.

## 11. Implementation tasks

### Task 1: Reconcile baseline и добавить RED topology tests

**Files:**
- Modify: `workflows/n8n-exports/ТЕНДЕРЫ ОРКЕСТРАТОР.json`
- Create: `tests/document-preparation-workflow.test.mjs`
- Create: `tests/orchestrator-archive-ingestion.test.mjs`
- Create: `tests/document-worker-readiness-skipped.test.mjs`
- Create: `tests/finalization-archive-cleanup.test.mjs`

- [ ] **Step 1: Сохранить dirty-worktree baseline**

```powershell
git status --short
git diff --name-only
```

Expected: существующие пользовательские изменения перечислены отдельно; ни один из них не перезаписывается.

- [ ] **Step 2: Повторно прочитать live Orchestrator `Q1RWSrB0jaTA6Dmx`**

Проверить 12 нод, `active=false` и Worker target `W4mNOUkdsFtNENpI`. Если live version/target изменились после 2026-09-07, остановить Task 1 и зафиксировать новый conflict.

- [ ] **Step 3: Синхронизировать local Orchestrator baseline**

Заменить только stale Worker locator локального canonical export на live locator. Не добавлять archive nodes в этот commit.

- [ ] **Step 4: Добавить RED tests**

Tests должны требовать точные node names/types/versions/connections из разделов 5–8, отсутствие `ВРЕМЕННЫЙ ФИЛЬТР РАСШИРЕНИЯ`, preparation call mode `once`, Worker call mode `each`, authoritative Worker ID и новый readiness barrier.

- [ ] **Step 5: Подтвердить RED**

```powershell
node --test tests/document-preparation-workflow.test.mjs tests/orchestrator-archive-ingestion.test.mjs tests/document-worker-readiness-skipped.test.mjs tests/finalization-archive-cleanup.test.mjs
```

Expected: FAIL только из-за отсутствующих preparation/cleanup nodes, export и старого readiness SQL.

- [ ] **Step 6: Commit**

```powershell
git add -- 'workflows/n8n-exports/ТЕНДЕРЫ ОРКЕСТРАТОР.json' tests/document-preparation-workflow.test.mjs tests/orchestrator-archive-ingestion.test.mjs tests/document-worker-readiness-skipped.test.mjs tests/finalization-archive-cleanup.test.mjs
git commit -m "test(ingestion): define archive workflow contracts"
```

### Task 2: Реализовать extractor core через TDD

**Files:**
- Create: `deploy/archive-extractor/package.json`
- Create: `deploy/archive-extractor/src/config.mjs`
- Create: `deploy/archive-extractor/src/errors.mjs`
- Create: `deploy/archive-extractor/src/path-policy.mjs`
- Create: `deploy/archive-extractor/src/sevenzip.mjs`
- Create: `deploy/archive-extractor/src/store.mjs`
- Create: `deploy/archive-extractor/src/extract-job.mjs`
- Create: `tests/archive-extractor-core.test.mjs`

- [ ] **Step 1: Написать path-policy и limit RED tests**

Покрыть exact cases:

```text
ok/folder/spec.pdf                accepted
../escape.pdf                     ARCHIVE_PATH_UNSAFE
/absolute.pdf                     ARCHIVE_PATH_UNSAFE
C:\escape.pdf                    ARCHIVE_PATH_UNSAFE
\\server\share\file.pdf          ARCHIVE_PATH_UNSAFE
folder/./file.pdf                 ARCHIVE_PATH_UNSAFE
folder/../file.pdf                ARCHIVE_PATH_UNSAFE
NUL                               ARCHIVE_PATH_UNSAFE
А/Файл.pdf vs а/файл.pdf         normalized collision
501st entry                       ARCHIVE_ENTRY_LIMIT
50 MiB exactly                    accepted
50 MiB + 1 byte                   ARCHIVE_FILE_TOO_LARGE
300 MiB exactly                   accepted
300 MiB + 1 byte                  ARCHIVE_TOTAL_TOO_LARGE
depth 3                           accepted
depth 4                           ARCHIVE_DEPTH_EXCEEDED
```

- [ ] **Step 2: Run RED**

```powershell
node --test tests/archive-extractor-core.test.mjs
```

Expected: FAIL because extractor modules do not exist.

- [ ] **Step 3: Реализовать exported functions и algorithm раздела 9**

Не использовать shell-constructed paths. Все `spawn` arguments передаются array; shell выключен. На deadline/limit вызывать `child.kill('SIGKILL')`, закрывать streams и удалять staging directory.

- [ ] **Step 4: Run GREEN**

```powershell
node --test tests/archive-extractor-core.test.mjs
```

Expected: все pure core tests PASS с fake `sevenzip` adapter.

- [ ] **Step 5: Commit**

```powershell
git add -- deploy/archive-extractor/package.json deploy/archive-extractor/src tests/archive-extractor-core.test.mjs
git commit -m "feat(ingestion): add bounded archive extraction core"
```

### Task 3: Реализовать HTTP service и container

**Files:**
- Create: `deploy/archive-extractor/src/server.mjs`
- Create: `deploy/archive-extractor/Dockerfile`
- Create: `deploy/archive-extractor/compose.yaml`
- Create: `deploy/archive-extractor/README.md`
- Create: `tests/archive-extractor-http.test.mjs`
- Create: `tests/archive-extractor-deployment.test.mjs`

- [ ] **Step 1: Написать HTTP RED tests**

Проверить `/health`, raw streaming limit, successful POST contract, typed 4xx body, idempotent same job, 409 mismatch, artifact GET, exact-run DELETE, invalid ID rejection и second concurrent POST → 503.

- [ ] **Step 2: Реализовать server routes**

Server принимает только перечисленные routes/methods, ставит `Content-Type: application/json; charset=utf-8`, `Cache-Control: no-store` для manifests/errors и `Content-Disposition: attachment` для artifacts. Request body не логируется.

- [ ] **Step 3: Добавить pinned Docker/Compose contract**

Docker build скачивает exact 7-Zip asset и проверяет SHA-256 до extraction. Runtime user `10001`, read-only root filesystem, только dedicated bind mount.

- [ ] **Step 4: Проверить service tests**

```powershell
node --test tests/archive-extractor-http.test.mjs tests/archive-extractor-deployment.test.mjs
docker compose -p tender-archive-extractor-test -f deploy/archive-extractor/compose.yaml config -q
```

Expected: PASS; Compose parser exits 0; test подтверждает отсутствие `ports:`.

- [ ] **Step 5: Commit**

```powershell
git add -- deploy/archive-extractor tests/archive-extractor-http.test.mjs tests/archive-extractor-deployment.test.mjs
git commit -m "feat(ingestion): add internal archive extractor service"
```

### Task 4: Добавить additive persistence migration

**Files:**
- Create: `deploy/postgres/migrations/2026-09-07-add-document-ingestion-metadata.sql`
- Create: `tests/archive-ingestion-migration.test.mjs`

- [ ] **Step 1: Написать RED static migration test**

Test требует exact table/column/type/default/not-null, transaction, lock timeout, statement timeout и запрещает destructive statements.

- [ ] **Step 2: Создать migration из раздела 10**

- [ ] **Step 3: Run GREEN**

```powershell
node --test tests/archive-ingestion-migration.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add -- deploy/postgres/migrations/2026-09-07-add-document-ingestion-metadata.sql tests/archive-ingestion-migration.test.mjs
git commit -m "feat(db): add document ingestion metadata"
```

Применение migration к production в этот Task запрещено.

### Task 5: Создать preparation workflow export

**Files:**
- Create: `workflows/n8n-exports/TENDER — Подготовить документацию.json`
- Test: `tests/document-preparation-workflow.test.mjs`

- [ ] **Step 1: Реализовать 14 нод и exact connections из раздела 5**

Использовать Code из 5.1, HTTP параметры из 5.2 и manifest rules из 5.3. Sticky Note должен фиксировать цель, вход/выход, hard limits и fail-closed rule.

- [ ] **Step 2: Добавить executable Code-node cases**

VM harness проверяет:

```text
no archives → direct/unsupported manifest without binary download
one ZIP result → root container + extracted leaf
same basename/different entry path → two documents
source order + normalized path order → stable document_index
zero pending → NO_PROCESSABLE_DOCUMENTS
source declared >100 MiB → ARCHIVE_TOO_LARGE before HTTP
download binary >100 MiB → ARCHIVE_TOO_LARGE
extractor schema/job/index mismatch → INGESTION_CONTRACT_INVALID
first archive error → single failure output, no partial manifest
```

- [ ] **Step 3: Run focused tests**

```powershell
node --test tests/document-preparation-workflow.test.mjs
```

Expected: PASS; export содержит ровно 14 executable nodes плюс Sticky Notes.

- [ ] **Step 4: Commit**

```powershell
git add -- 'workflows/n8n-exports/TENDER — Подготовить документацию.json' tests/document-preparation-workflow.test.mjs
git commit -m "feat(ingestion): add document preparation workflow"
```

### Task 6: Встроить preparation и registration gates в Orchestrator

**Files:**
- Modify: `workflows/n8n-exports/ТЕНДЕРЫ ОРКЕСТРАТОР.json`
- Test: `tests/orchestrator-archive-ingestion.test.mjs`

- [ ] **Step 1: Создать inactive preparation workflow**

Импортировать Task 5 только как inactive workflow и сохранить возвращённый n8n `id`. Production workflow не изменять и не активировать.

- [ ] **Step 2: Добавить exact Orchestrator nodes/connections из раздела 6**

Execute Workflow node получает exact ID из Step 1. `Создать запуск анализа` initial total = 0. Success registration использует SQL 6.3. Failure paths используют 6.4–6.5. Удалить temporary filter.

- [ ] **Step 3: Проверить topology и SQL tests**

```powershell
node --test tests/orchestrator-archive-ingestion.test.mjs tests/document-preparation-workflow.test.mjs
```

Expected: PASS; ни один edge не достигает Worker до `registration_committed=true`.

- [ ] **Step 4: Inspect exact diff**

```powershell
git diff -- 'workflows/n8n-exports/ТЕНДЕРЫ ОРКЕСТРАТОР.json' tests/orchestrator-archive-ingestion.test.mjs
```

Expected: upstream FullInfo/normalization nodes unchanged; authoritative Worker target preserved.

- [ ] **Step 5: Commit**

```powershell
git add -- 'workflows/n8n-exports/ТЕНДЕРЫ ОРКЕСТРАТОР.json' tests/orchestrator-archive-ingestion.test.mjs
git commit -m "feat(orchestrator): gate workers on ingestion manifest"
```

### Task 7: Обновить Worker readiness

**Files:**
- Modify: `workflows/n8n-exports/TENDER — Обработать документ.json`
- Test: `tests/document-worker-readiness-skipped.test.mjs`

- [ ] **Step 1: Заменить только readiness predicate/reason из раздела 7**

Не менять ни одну другую Worker node, code hash, connection или credential reference.

- [ ] **Step 2: Проверить regression matrix**

```text
completed=2 skipped=1 total=3 → one claim
completed=0 skipped=3 total=3 → no claim
completed=2 pending=1 total=3 → no claim
completed=2 processing=1 total=3 → no claim
completed=2 failed=1 total=3 → no claim
registered=4 total=3 → no claim
two concurrent final Workers → exactly one claim
```

- [ ] **Step 3: Run focused tests**

```powershell
node --test tests/document-worker-readiness-skipped.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add -- 'workflows/n8n-exports/TENDER — Обработать документ.json' tests/document-worker-readiness-skipped.test.mjs
git commit -m "fix(worker): treat skipped documents as terminal"
```

### Task 8: Добавить terminal cleanup в Finalization

**Files:**
- Modify: `workflows/n8n-exports/TENDER — Финализация анализа.json`
- Test: `tests/finalization-archive-cleanup.test.mjs`

- [ ] **Step 1: Добавить две ноды и connections из раздела 8**

Не менять 27/27 SQL, result validator и Report workflow locator.

- [ ] **Step 2: Проверить success/error cleanup paths**

Test требует, чтобы оба HTTP outputs достигали `Продолжить после cleanup`, а Report получал исходный `analysis_run_id` даже при cleanup transport error.

- [ ] **Step 3: Run focused tests**

```powershell
node --test tests/finalization-archive-cleanup.test.mjs
```

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add -- 'workflows/n8n-exports/TENDER — Финализация анализа.json' tests/finalization-archive-cleanup.test.mjs
git commit -m "feat(finalization): clean archive workspaces"
```

### Task 9: Offline suite и real archive corpus

**Files:**
- Modify: `tests/archive-extractor-core.test.mjs`
- Modify: `tests/archive-extractor-http.test.mjs`
- Create: `tests/archive-extractor-corpus.test.mjs`
- Create test fixtures only under: `tests/fixtures/archive-ingestion/**`

- [ ] **Step 1: Build extractor image**

```powershell
docker build -t tender-archive-extractor:test deploy/archive-extractor
```

Expected: exact 7-Zip SHA check passes; image build exits 0.

- [ ] **Step 2: Generate or commit corpus**

Нужны fixtures: ZIP, 7Z, RAR, TAR, GZ, TAR.GZ, TGZ; mixed supported/unsupported; nested depths 1–4; encrypted; corrupt; extension mismatch; unsafe path; link; normalized collision; exact/over limit; duplicate basename. RAR fixture является статическим test asset, потому что 7-Zip читает, но не создаёт RAR.

`tests/archive-extractor-corpus.test.mjs` импортирует implementation через `file:///app/src/extract-job.mjs`, а fixtures читает из `/repo-tests/fixtures/archive-ingestion`; эти paths соответствуют следующему `docker run` mount.

- [ ] **Step 3: Run corpus in container**

```powershell
docker run --rm --entrypoint node -v "${PWD}/tests:/repo-tests:ro" tender-archive-extractor:test --test /repo-tests/archive-extractor-corpus.test.mjs
```

Expected: все success manifests и typed failures совпадают с matrix; ни один failure job не имеет committed `manifest.json`.

- [ ] **Step 4: Run repository suite**

```powershell
node --test tests/archive-*.test.mjs tests/document-preparation-workflow.test.mjs tests/orchestrator-archive-ingestion.test.mjs tests/document-worker-readiness-skipped.test.mjs tests/finalization-archive-cleanup.test.mjs
node --test
git diff --check
```

Expected: focused suite GREEN; full suite не получает новых failure signatures. Pre-existing failures записать отдельно, не исправлять в этой feature.

- [ ] **Step 5: Commit corpus**

```powershell
git add -- tests/fixtures/archive-ingestion tests/archive-extractor-core.test.mjs tests/archive-extractor-http.test.mjs tests/archive-extractor-corpus.test.mjs
git commit -m "test(ingestion): cover archive safety corpus"
```

### Task 10: Isolated service canary

**Deployment artifacts:**
- `deploy/archive-extractor/compose.yaml`
- `deploy/archive-extractor/README.md`

- [ ] **Step 1: Снять server capacity baseline**

```bash
free -h
df -h /opt
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.CPUPerc}}\t{{.PIDs}}'
docker ps --format 'table {{.Names}}\t{{.Status}}'
```

Gate: на `/opt` есть минимум 2 GiB свободного места сверх текущего использования; существующие контейнеры healthy.

- [ ] **Step 2: Создать exact host directory**

```bash
sudo install -d -o 10001 -g 10001 -m 0700 /opt/tender-archive-extractor/data
```

- [ ] **Step 3: Deploy только новый Compose project**

```bash
docker compose -p tender-archive-extractor -f /opt/tender-archive-extractor/compose.yaml config -q
docker compose -p tender-archive-extractor -f /opt/tender-archive-extractor/compose.yaml build --pull archive-extractor
docker compose -p tender-archive-extractor -f /opt/tender-archive-extractor/compose.yaml up -d --no-deps archive-extractor
```

Не перезапускать n8n, PostgreSQL, Redis, Traefik, Gotenberg или bot.

- [ ] **Step 4: Проверить internal-only доступ из main и worker**

```bash
docker exec n8n-n8n-1 node -e 'fetch("http://tender-archive-extractor:8080/health").then(async r=>{console.log(r.status,await r.text());process.exit(r.ok?0:1)}).catch(e=>{console.error(e.message);process.exit(1)})'
docker exec n8n-n8n-worker-1 node -e 'fetch("http://tender-archive-extractor:8080/health").then(async r=>{console.log(r.status,await r.text());process.exit(r.ok?0:1)}).catch(e=>{console.error(e.message);process.exit(1)})'
```

Expected: HTTP 200 из обоих контейнеров; `docker port tender-archive-extractor` выводит пусто.

- [ ] **Step 5: Boundary canary**

Проверить 100 MiB source, 50 MiB leaf, 300 MiB total, 500 entries и 5-minute kill; одновременно наблюдать memory/CPU/disk. OOM/restart или выход за 512 MiB блокирует n8n canary; лимит контейнера не повышать без отдельного capacity decision.

### Task 11: Isolated n8n + DB canary

- [ ] **Step 1: Выполнить read-only DB schema preflight из раздела 10**

При conflict остановиться. При ожидаемой схеме получить отдельное разрешение на additive migration и только затем применить её.

- [ ] **Step 2: Создать inactive copies**

Создать inactive preparation, Orchestrator, Worker и Finalization candidates. Не перезаписывать и не активировать production IDs.

- [ ] **Step 3: No-archive canary**

Ожидание: direct PDF/DOCX/XLSX не скачиваются в preparation; registration input совпадает с прежними metadata плюс `ingestion_metadata`; каждый pending документ вызывает один Worker.

- [ ] **Step 4: Mixed/nested canary**

Один tender содержит direct PDF, ZIP, nested archive depth 3 и unsupported file. Проверить полный DB manifest, provenance, `documents_total`, terminal skipped и один Aggregator claim.

- [ ] **Step 5: Negative canary**

Повреждённый или encrypted archive должен дать run `failed`, typed error, source audit rows, нулевой Worker dispatch и cleanup workspace.

- [ ] **Step 6: Completed cleanup canary**

После 27/27 finalization artifact GET возвращает 404, audit metadata остаётся в PostgreSQL, Report запускается независимо от cleanup response payload.

### Task 12: Documentation и promotion gate

**Files:**
- Create: `workflows/document-preparation.md`
- Modify: `workflows/orchestrator.md`
- Modify: `workflows/document-worker.md`
- Modify: `DATA_MODEL.md`
- Modify: `ARCHITECTURE.md`
- Modify: `README.md`
- Modify carefully around user changes: `PROJECT_STATUS.md`, `TECH_DEBT.md`, `DEVELOPMENT_LOG.md`, `AGENTS.md`

- [ ] **Step 1: Обновить factual workflow docs**

Описать actual node names, input/output schemas, error codes, internal service dependency, readiness и cleanup. `DATA_MODEL.md` обновлять только после фактически применённой migration.

- [ ] **Step 2: Обновить state без завышения доказательств**

Использовать только один из уровней:

```text
offline candidate
isolated runtime GREEN
production verified
```

`OR-0` закрывать только после runtime GREEN mixed completed/skipped case.

- [ ] **Step 3: Final verification**

```powershell
node --test
git diff --check
git status --short
```

Expected: no new failures; scoped archive files отделены от pre-existing user changes.

- [ ] **Step 4: Commit documentation**

```powershell
git add -- workflows/document-preparation.md workflows/orchestrator.md workflows/document-worker.md DATA_MODEL.md ARCHITECTURE.md README.md PROJECT_STATUS.md TECH_DEBT.md DEVELOPMENT_LOG.md AGENTS.md
git commit -m "docs(ingestion): record archive preparation pipeline"
```

- [ ] **Step 5: Представить production promotion gate**

До отдельного решения показать:

```text
exact workflow/version diff
inactive preparation workflow ID
isolated execution IDs
DB migration evidence
archive corpus result
mixed and negative canary result
CPU/RAM/disk measurements
cleanup evidence
rollback workflow versions
```

## 12. Acceptance matrix

| Scenario | Preparation | DB documents | Workers | Run outcome |
|---|---|---|---:|---|
| PDF/DOCX/XLSX only | success, no binary download | all pending | one per doc | normal |
| supported + unsupported ordinary | success | pending + skipped | pending only | normal |
| ZIP/7Z/RAR | success | container skipped + leaves | supported leaves | normal |
| TAR/GZ/TAR.GZ/TGZ | success | same contract | supported leaves | normal |
| nested depth 3 | success | all containers/leaves audited | supported leaves | normal |
| nested depth 4 | typed failure | source audit only | 0 | failed |
| corrupt/encrypted/mismatch | typed failure | failed source + aborted source rows | 0 | failed |
| unsafe path/link/collision | typed failure | failed source + aborted source rows | 0 | failed |
| any limit exceeded | typed failure | failed source + aborted source rows | 0 | failed |
| no processable leaf | `NO_PROCESSABLE_DOCUMENTS` | all source skipped | 0 | failed |
| same job/same SHA | same committed manifest | no duplicates | no duplicate claim | idempotent |
| same job/different SHA | `JOB_INPUT_MISMATCH` | failure audit | 0 | failed |
| 2 completed + 1 skipped | already prepared | terminal mix | complete | one Aggregator |
| 0 completed + N skipped | already prepared | skipped only | 0 | never aggregate; failed earlier |
| cleanup unavailable | analysis unaffected | audit retained | unaffected | TTL fallback |

## 13. Rollback

Rollback выполняется независимо:

1. вернуть предыдущие inactive/active versions Orchestrator, Worker и Finalization;
2. остановить только `tender-archive-extractor` Compose project;
3. не удалять `ingestion_metadata` и document audit rows;
4. не удалять рабочие каталоги активных runs вручную;
5. не перезапускать соседние containers;
6. если artifacts ещё нужны active Workers, сначала вернуть workflow routing, дождаться отсутствия `processing`, затем остановить extractor.

Production activation допустима только после всей последовательности:

```text
offline GREEN
→ extractor canary GREEN
→ inactive n8n canary GREEN
→ negative fail-closed canary GREEN
→ DB/readiness/cleanup review GREEN
→ explicit production promotion approval
→ post-promotion canary
```
