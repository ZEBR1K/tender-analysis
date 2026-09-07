# Gotenberg HTML-to-PDF design

**Date:** 2026-09-07

**Status:** implemented and runtime-tested in inactive workflow `[PDF TEST] TENDER — Генерация отчета`; not promoted to production

**Runtime evidence:** `evaluations/report-generation-pdf-execution-14649.md`

**Scope:** convert the existing validated tender report HTML artifact to PDF without regenerating or reinterpreting report content.

## 1. Current state

Production `TENDER — Финализация анализа` calls `TENDER — Генерация отчета` only after the PostgreSQL-backed 27/27 FINAL barrier is complete and the completion claim succeeds.

`TENDER — Генерация отчета` currently performs:

```text
Finalization event
→ read-only Report Snapshot
→ snapshot validation
→ Report Adapter
→ Report Model
→ model validation
→ deterministic self-contained HTML
→ binary.report_html
```

The report workflow does not call AI, extract new facts, change FINAL results, or write report data to PostgreSQL. The live workflows and canonical local exports were checked on 2026-09-07 and matched in node configuration and connections. The latest inspected successful Report execution was `14631`; it produced a `598452` byte `report_html` artifact.

The built-in n8n Convert to File node does not support PDF output. A browser-based converter is therefore required.

## 2. Selected approach

Use the Chromium-only Gotenberg image as an internal HTML-to-PDF service on the existing n8n server.

Gotenberg will run in its own Compose project rather than being added to `/opt/beget/n8n/docker-compose.yml`. The separate project will join the existing external Docker network `n8n_default`, allowing n8n and its worker to call Gotenberg without publishing a host port.

Selected service boundary:

```text
n8n / n8n-worker
    |
    |  http://tender-pdf-gotenberg:3000
    v
Gotenberg Chromium
```

The service must not be exposed through Traefik or a host `ports` mapping.

## 3. Alternatives considered

### 3.1. Add Gotenberg to the existing n8n Compose project

This gives simple service discovery but modifies the production n8n deployment definition. An incorrect Compose command could recreate or restart unrelated n8n services. This was rejected in favor of stronger operational isolation.

### 3.2. Run Gotenberg on a second server

This removes local memory contention but requires a private network or an authenticated TLS boundary. The user rejected introducing that network dependency for this step.

### 3.3. Use a public HTML-to-PDF API

This avoids local resource use but sends tender report content to a third party and introduces credentials, cost, and an external availability dependency. This was rejected for the current scope.

## 4. Infrastructure design

Create a standalone file:

```text
/opt/tender-pdf/compose.yaml
```

The Compose project name is `tender-pdf`. It contains one service and connects only to the pre-existing external network `n8n_default`.

Use:

```text
gotenberg/gotenberg:8.36.0-chromium
```

The Chromium-only variant is sufficient for HTML-to-PDF and avoids the unused LibreOffice component.

Resource and concurrency boundaries:

```text
memory limit                 512 MiB
CPU limit                    0.5 CPU
PIDs limit                   128
shared memory                128 MiB
Chromium max concurrency     1
Chromium max queue size      1
Chromium auto-start          false
Chromium idle shutdown       30 seconds
restart policy               unless-stopped
```

The server currently has approximately `1.9 GiB` RAM, `518 MiB` available memory, `2 GiB` swap with about `704 MiB` in use, and `5.2 GiB` free disk space. The 512 MiB cgroup limit is intentionally strict: if a large conversion exceeds the budget, the conversion must fail rather than allowing Chromium to consume memory without a boundary. Runtime memory and swap must be observed during the first real conversion.

Because the report HTML is self-contained, Chromium outbound access to both public and private network resources will be disabled. Uploaded `index.html` and inline CSS/data remain available to the renderer.

The image digest must be recorded after the first pull. Subsequent upgrades are explicit; no automatic updater is introduced.

## 5. Workflow design

Extend the existing `TENDER — Генерация отчета` workflow after `Создать HTML artifact`:

```text
Создать HTML artifact
→ Подготовить HTML для Gotenberg
→ Конвертировать HTML в PDF
→ Проверить PDF artifact
```

### 5.1. `Подготовить HTML для Gotenberg`

Input contract:

```text
json.analysis_run_id
json.filename
json.mime_type = text/html
json.template_version
json.artifact_validation.valid = true
binary.report_html
```

Responsibilities:

- require the validated `report_html` binary;
- preserve the original HTML artifact and JSON metadata;
- create a binary alias for upload with filename exactly `index.html`, as required by the Gotenberg HTML endpoint;
- do not decode the HTML into JSON or generate new report content.

### 5.2. `Конвертировать HTML в PDF`

Use the n8n HTTP Request node:

```text
POST http://tender-pdf-gotenberg:3000/forms/chromium/convert/html
Content-Type: multipart/form-data
files: binary index.html alias
response format: file
output binary property: report_pdf
```

Rendering options:

```text
paper width       8.27in
paper height      11.7in
orientation       portrait
margin top        0.39in
margin bottom     0.39in
margin left       0.39in
margin right      0.39in
media type        print
print background  true
single page       false
```

The existing HTML and `@media print` rules remain the only presentation template. No header, footer, watermark, or additional textual content is introduced by the converter.

The request uses one attempt with an explicit `120000 ms` timeout. Non-2xx responses remain errors; `Never Error` and automatic retry are disabled. Retry policy may be reconsidered only after runtime evidence identifies a transient converter failure.

### 5.3. `Проверить PDF artifact`

The final guard must fail unless all of the following hold:

- `report_pdf` exists;
- decoded binary begins with the PDF signature `%PDF-`;
- MIME type is `application/pdf`;
- byte size is positive;
- filename is the original safe report basename with `.pdf`;
- `analysis_run_id` and HTML template metadata are preserved;
- the original `report_html` artifact remains available.

If the HTTP Request node returns only the response binary, this guard restores the original `report_html` binary from the directly linked `Создать HTML artifact` item. It must not serialize the HTML bytes into JSON or resolve data from a different item/execution.

Successful terminal output:

```text
binary.report_html
binary.report_pdf
json.artifact_validation
json.pdf_artifact_validation.valid = true
```

## 6. Contracts and invariants

The change must not alter:

- Finalization input or the DB-backed 27/27 barrier;
- any of the 27 `field_key` values or FINAL rows;
- Report Snapshot, Report Adapter, Report Model, or their validators;
- HTML content or `tender_report_html_v1` semantics, except for a separately reviewed print-only CSS correction if runtime visual QA proves one is necessary;
- PostgreSQL schema or persisted analysis data;
- `analysis_run.status` lifecycle;
- source/evidence resolution;
- production n8n credentials.

One report execution still corresponds to one `analysis_run_id`. The PDF is a derived presentation artifact from the exact HTML produced in that execution.

## 7. Failure behavior

Failures must be visible and terminal for Report Generation:

- Gotenberg unavailable or unhealthy;
- connection timeout;
- Gotenberg HTTP 4xx/5xx;
- container OOM caused by the 512 MiB limit;
- missing HTML binary;
- response missing the PDF signature;
- wrong MIME type, empty response, or lost HTML artifact.

The workflow must not silently return only HTML while declaring PDF success. Report Generation begins after the run is already completed, so a conversion failure does not roll back `analysis_run.status=completed`. The current workflow has no configured workflow-level error workflow; adding alert delivery is explicitly outside this change and should be tracked separately if required.

## 8. Deployment and rollback

Deployment is staged:

1. Create the separate Compose file without touching the n8n Compose file.
2. Validate the Compose file.
3. Pull only the Gotenberg Chromium image.
4. Start only the `tender-pdf` project.
5. Verify container health, internal-only networking, limits, and idle memory.
6. Convert a small self-contained test HTML while monitoring memory and swap.
7. Implement and test the workflow change in a non-production draft or isolated copy.
8. Run a saved completed report through the exact HTML-to-PDF path.
9. Inspect the rendered PDF visually and verify page count, text extraction, filename, both binary artifacts, and execution failure behavior.
10. Promote the workflow only after the runtime gate passes.

Infrastructure rollback stops and removes only the `tender-pdf` Compose project. The external `n8n_default` network and every existing n8n/bot container remain untouched. Workflow rollback restores the previous Report Generation version.

## 9. Verification criteria

The change is accepted only when all of these are true:

- existing report regressions remain green;
- Report Generation still reads one validated 27-field snapshot;
- HTML output is byte-identical before and after adding the converter;
- a valid PDF is produced from that exact HTML;
- PDF uses A4 portrait pages and preserves Russian text, tables, sources, statuses, and background colors;
- no row, quote, or heading is clipped or overlaps another element;
- both HTML and PDF artifacts are downloadable from the successful execution;
- Gotenberg is not reachable from a host/public port;
- container limits and single-conversion concurrency are effective;
- a forced converter failure produces a failed Report execution rather than silent success;
- n8n, worker, PostgreSQL, Redis, Traefik, calibration files, and bot containers are not recreated or restarted during Gotenberg deployment.

## 10. Out of scope

- changing report semantics or client field names;
- regenerating the report with AI;
- PDF/A or PDF/UA post-processing;
- DOCX or XLSX generation;
- Telegram or email delivery;
- server resizing or reconfiguring existing n8n resource limits;
- cleanup of Docker images, build cache, executions, or production data;
- adding a global Report Generation error-notification workflow.
