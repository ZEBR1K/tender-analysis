# Manual Upload Runtime Canary — 2026-09-12

## Scope

Authorized production test of the new n8n Form entry using all 12 files from
`F:\Vibe-projects\Tender-blind-test-2\documents`.

The test covers only the technical path:

```text
browser form
→ source artifact storage
→ document preparation
→ atomic run/document registration
→ agentic dispatch
```

It does not claim semantic correctness of the 27 field values until the Codex
job and report complete and are reviewed.

## Final successful dispatch

```text
manual workflow execution: 18796 (success)
analysis_run_id: 0ac0b487-71b7-4a35-8412-e587f608aeca
tender_id: manual:0ac0b487-71b7-4a35-8412-e587f608aeca
registered documents: 12 / 12
agentic job_id: ad4aea11-04b8-4d26-a9a1-5d694c5584d8
dispatch status: running
```

The n8n completion page displayed the same `analysis_run_id`.

## Terminal result

Monitor execution `18857` observed the same job as `completed` on attempt 1,
validated exactly 27 unique field keys with no job issue codes, persisted the
result and completed the existing Finalization/Report path.

```text
field status distribution: 23 resolved / 1 requires_review / 3 not_found
input tokens: 9,981,910
cached input tokens: 9,670,656
output tokens: 46,062
reasoning output tokens: 6,085
HTML: 34,361 bytes, renderer validation true
PDF: 101,076 bytes, %PDF- signature
```

Report filename:

```text
Анализ закупки без номера — Blind Test 2 — ручная загрузка, успешный canary.html
```

## Reproduced defects and minimal fixes

1. Execution `17975` stopped at source upload because the internal endpoint
   required `application/octet-stream`, while n8n Binary Data correctly sent the
   native DOCX MIME type. The endpoint now accepts either octet-stream or a
   media type exactly matching the declared upload metadata.
2. Execution `18762` showed `502 Host Not Found` when Document Preparation sent
   an internal artifact URL through the external proxy. A fixed-prefix route now
   sends internal artifacts directly and preserves the existing TenderPlan proxy
   node for external URLs.
3. Execution `18779` registered `12/12` documents but Dispatch then reproduced
   the same proxy leak while staging runner inputs. Dispatch received the same
   fixed-prefix direct route.
4. A source larger than its per-file limit reproduced a closed TCP socket instead
   of a typed response. The uploader now drains the bounded request before
   failing. A live request from the n8n network returned exact HTTP `413
   SOURCE_FILE_TOO_LARGE`.
5. Execution `18780` proved that the Intake Resume error workflow returned
   `event_updated=false` for a failed manual run. Manual Upload now records its
   own n8n execution ID in immutable run metadata and is bound to dedicated
   ownership-guarded workflow `xW4DHtnBYddbaU14`.

All failed attempts retained typed execution/job audit. No production database
row was deleted or rewritten to hide these failures.

## Runtime infrastructure

- `tender-archive-extractor` rebuilt in place as image
  `tender-archive-extractor:26.03-1`;
- container health: `healthy`, restart count `0` after deployment;
- no host port published;
- n8n main and worker were not restarted;
- server backup retained at
  `/opt/tender-archive-extractor.backup-20260911-manual-upload` and image tag
  `tender-archive-extractor:backup-20260911-manual-upload`.

## Validation boundary

Implemented guards protect only:

- file/path/type safety and bounded upload sizes;
- source byte integrity and idempotent artifact identity;
- complete run/document registration;
- existing JSON and dispatch contracts.

There is no page/OOXML/XLSX parser, full mechanical coverage checker,
field-specific rule, citation verifier or programmatic evidence sufficiency
assessment in this path.

## Accepted access risk

The Form Trigger currently uses `authentication=none`, as selected for this MVP.
Anyone with the URL can initiate a paid run and upload up to 200 MiB. The link
must remain restricted to trusted users until n8n User Auth or an external
access-control layer is explicitly approved.
