# Agentic Finalization Integration Design

## Goal

Extend the existing terminal pipeline so one successfully completed Codex job
produces the canonical 27 FINAL rows, completes the existing `analysis_run`, and
invokes the existing HTML/PDF report workflow. The closed
`tender_agent_result_v1` emitted by Codex remains unchanged.

## Scope

This change owns only the boundary:

```text
tender_agentic_field_results
→ tender_analysis_field_results
→ TENDER — Финализация анализа
→ TENDER — Генерация отчета
```

The legacy Document Worker, Aggregator, and Targeted Recheck remain disconnected
from the temporary agent-only route. No parser, field-specific rule, quote
checker, evidence sufficiency scorer, or semantic validator is added.

Report delivery beyond the existing HTML/PDF artifact remains outside this
change.

## Chosen Approach

`TENDER — Финализация анализа` accepts its existing legacy input and an optional
`agentic_job_id`. When the job ID is present, an agentic promotion step runs
before the existing 27/27 completion barrier. The legacy path remains unchanged.

This approach was chosen instead of making Report Generation read shadow tables
directly or duplicating Report Generation in a separate agentic workflow. It
keeps one canonical terminal store and one report renderer.

## Input Contracts

### Legacy invocation

```json
{
  "analysis_run_id": "uuid"
}
```

The current behavior is preserved.

### Agentic invocation

```json
{
  "analysis_run_id": "uuid",
  "agentic_job_id": "uuid"
}
```

The monitor supplies both identities after it has atomically persisted exactly
27 shadow rows and marked the exact Codex job completed.

## Promotion Preconditions

The promotion transaction fails closed unless all conditions of the following
contract are true:

1. `agentic_job_id` identifies exactly one completed job.
2. The job belongs to the supplied `analysis_run_id`.
3. The job uses `tender_fields_v1` and has valid runner identity hashes.
4. The job has exactly 27 shadow rows with the exact ordered catalog mapping.
5. Every `resolved` and `requires_review` evidence item references an
   `artifact_key` registered for that exact job.
6. The run is in an allowed agent-only pre-final state, or is an idempotent
   replay of this same promotion.
7. Existing canonical rows are either absent or were created by the same
   agentic job. Legacy and agentic producers are never mixed silently.

These checks protect source identity, database integrity, and the JSON/storage
contract. They do not judge the meaning of a value, quote, rationale, or
evidence.

## Canonical Projection

Each shadow row becomes one `tender_analysis_field_results` row. The projection
is mechanical:

| Canonical property | Source |
|---|---|
| `field_index` | unchanged agent value |
| `field_key` | unchanged agent value |
| `status` | unchanged agent value |
| `value_text` | unchanged agent value |
| `field_catalog_version` | job catalog version |
| `result_contract_version` | `tender_field_final_v1` |
| `confidence` | `null` |
| `requires_human_review` | `status === 'requires_review'` |
| `resolution_method` | `codex_agentic_v1` |
| `result_json` | canonical presentation projection plus the unchanged agent field and job identity audit |

No numeric confidence is invented. Report Snapshot validation permits
`confidence=null` only when `resolution_method=codex_agentic_v1`; legacy FINAL
rules remain unchanged.

## Evidence Projection

The shadow `result_json` remains byte-for-byte unchanged. The canonical report
projection preserves every agent evidence property:

```text
artifact_key
locator
quote
```

For presentation only, `artifact_key` is joined to the exact job document and
its original source filename is added. `locator` stays an opaque human-readable
string. It is not parsed into a page, sheet, OOXML part, or other synthetic
coordinate, and the quote is not checked semantically.

`not_found` keeps an empty presentation evidence list. Its rationale remains in
the canonical `result_json`; no source, locator, or quote is fabricated.

## Lifecycle and Data Flow

```text
Agentic Monitor
→ persist exact 27 shadow rows
→ call Finalization with analysis_run_id + agentic_job_id
→ atomic agentic promotion
→ analysis_run processing → aggregating
→ existing 27/27 barrier
→ analysis_run aggregating → completed
→ existing Report Generation
→ existing HTML artifact
→ existing Gotenberg PDF artifact
```

The transition to `aggregating` occurs only in the same successful transaction
that establishes the canonical 27/27 set. A failed promotion leaves the run and
canonical rows unchanged.

## Idempotency and Producer Isolation

The exact `(analysis_run_id, agentic_job_id)` pair owns the promotion. Repeating
the same call may update only canonical rows already attributed to that job and
must produce the same field projection. A different job or a legacy producer
cannot overwrite those rows.

The first successful Finalization execution owns report generation through the
existing completion claim. A report failure is an explicit failed execution;
the 27 canonical rows remain durable and can be replayed through an explicitly
authorized report retry without re-running Codex.

## Report Generation Changes

The existing workflow remains the only renderer. Its snapshot gains
`resolution_method` in the field projection and its source presentation accepts
the agentic `locator` property. It continues to:

- require the exact ordered set of 27 fields;
- preserve all statuses and values;
- render `not_found` neutrally;
- display only prepared client-safe source data;
- escape dynamic HTML;
- produce the existing HTML and PDF artifacts.

No document analysis or AI call is added to Report Generation.

## Error Handling

- Identity, catalog, field-count, field-order, artifact ownership, lifecycle, and
  producer conflicts are hard errors before report generation.
- PostgreSQL promotion is a single transaction, so partial canonical promotion
  cannot be committed.
- The Monitor does not infer `not_found` or change field semantics on failure.
- Report/Gotenberg failures remain explicit n8n execution failures and do not
  delete the source or canonical result.

## Verification

Implementation follows RED/GREEN tests for:

1. agentic invocation and legacy-path compatibility;
2. exact 27-row promotion and deterministic projection;
3. `confidence=null` only for `codex_agentic_v1`;
4. `artifact_key → source filename` and opaque locator preservation;
5. `not_found` without invented evidence;
6. mixed-producer, wrong-job, wrong-run, incomplete-set, and replay behavior;
7. Monitor-to-Finalization connection;
8. Report Snapshot, HTML, and PDF compatibility.

After local regression tests, the changed workflows are validated, published,
read back, and exercised with one controlled live agentic canary. Completion
requires authoritative evidence for exact 27 canonical rows, completed run,
successful Finalization and Report executions, and a valid `%PDF-` artifact.
