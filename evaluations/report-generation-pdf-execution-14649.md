# Report Generation PDF runtime evidence — execution 14649

**Date:** 2026-09-07

**Workflow:** `[PDF TEST] TENDER — Генерация отчета`

**Workflow ID:** `1dQTcUnE5JIcrEfI`

**Version ID:** `0a0b6695-78e2-4f01-b26d-0555a3aea1db`

**Execution:** `14649`

**Mode:** `manual`

**Status:** `success`

## Scope

The test used the saved completed analysis run `83246cae-de1f-43f1-b7c8-2428aadc6e0c`. The Execute Workflow Trigger input was pinned; the Report Snapshot PostgreSQL query, all existing report Code nodes and the Gotenberg HTTP request executed normally.

The workflow has no write node and no delivery node. No production workflow was activated, published or modified.

## Result

| Node | Status | Time | Evidence |
|---|---:|---:|---|
| `Создать HTML artifact` | success | 74 ms | `report_html`, 598452 bytes, `text/html` |
| `Подготовить HTML для Gotenberg` | success | 65 ms | original HTML preserved; alias named `index.html` |
| `Конвертировать HTML в PDF` | success | 17686 ms | HTTP 200, `application/pdf`, 909642 bytes |
| `Проверить PDF artifact` | success | 2076 ms | signature `%PDF-`, final HTML and PDF binaries |

Final metadata:

```json
{
  "artifact_validation": {
    "valid": true,
    "property": "report_html",
    "size_bytes": 598452,
    "html_matches_renderer": true
  },
  "pdf_artifact_validation": {
    "valid": true,
    "property": "report_pdf",
    "size_bytes": 909642,
    "signature": "%PDF-",
    "source_property": "report_html"
  }
}
```

Final binaries:

```text
report_html: Анализ закупки_без_номера.html, text/html
report_pdf:  Анализ закупки_без_номера.pdf, application/pdf
```

## Negative runtime gate

Execution `14650` pinned only the HTTP node output to `not-a-pdf` bytes while retaining MIME `application/pdf`. The execution failed in `Проверить PDF artifact` with the expected explicit error:

```text
[Проверить PDF artifact] REPORT_PDF_SIGNATURE_INVALID
```

This confirms that a present binary and nominal MIME type cannot produce silent PDF success when the payload does not have the `%PDF-` signature.

## Remaining promotion gate

The MCP read-only interface exposes binary metadata but has no binary-download operation. The PDF must still be downloaded from execution `14649` in the n8n UI and visually checked for page count, Russian text, clipping, overlaps, table pagination and print colors before promotion to production.

The successful conversion proves that the real 598452-byte HTML fits within the configured converter limits for this run. It does not record peak host RAM/swap; repeat host-level resource observation if the 512 MiB or 128 PID limits are changed.
