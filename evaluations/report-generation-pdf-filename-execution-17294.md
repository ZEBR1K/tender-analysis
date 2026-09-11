# Report Generation PDF filename runtime evidence — execution 17294

**Date:** 2026-09-11

**Workflow:** `TENDER — Генерация отчета`

**Workflow ID:** `ckPnP3hRhKu4Mf9u`

**Tested draft / published version:** `7bfa8d2a-a16e-47fe-ab80-56fd682e2b08`

**Execution:** `17294`


**Mode / status:** `manual / success`

## Scope

The regression addresses one storage-boundary defect: the n8n output showed a
readable PDF filename, but Download returned the UUID filename created by the
Gotenberg HTTP response.

The Execute Workflow Trigger and `Получить Report Snapshot4` were pinned to the
existing test inputs. Report transformation Code nodes and the internal
Gotenberg request ran normally. The workflow contains no database write or
delivery node.

## Change

`Проверить PDF artifact` still validates the original Gotenberg response bytes,
MIME type and `%PDF-` signature. After validation it now creates the terminal
binary with:

```text
prepareBinaryData(pdfBuffer, pdfFilename, application/pdf)
```

The terminal `report_pdf` therefore references a newly persisted
`filesystem-v2` object whose stored filename is the readable report filename.

## Result

| Check | Result |
|---|---|
| Execution | `17294`, success |
| Gotenberg `report_pdf.fileName` | UUID `.pdf` |
| Terminal `report_pdf.fileName` | `Анализ закупки 10293451 — Поставка мебели для образовательного процесса и административно-хозяйственных нужд, а также ремонтные комплекты для мебели.pdf` |
| MIME | `application/pdf` |
| Size | `100 kB` |
| Source / terminal binary IDs | different `filesystem-v2` objects |
| Browser Download basename | exact terminal readable filename |

The workflow was then published as version
`7bfa8d2a-a16e-47fe-ab80-56fd682e2b08`. Read-only API verification confirmed
that `versionId` equals `activeVersionId`, the workflow remains active, and the
graph still contains 12 nodes.
