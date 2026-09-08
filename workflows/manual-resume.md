# TENDER — Manual Resume

Inactive repository-only operator adapter for explicitly resuming one existing tender analysis run.

## Contract

The workflow is intentionally limited to three nodes:

```text
Manual Trigger
→ Set and Validate analysis_run_id
→ Execute TENDER — Intake Resume
```

The operator edits `ANALYSIS_RUN_ID` in `Set and Validate analysis_run_id`. Its repository default is empty, so execution fails with a clear validation error until the value is a non-empty canonical UUID.

The adapter sends exactly:

```json
{
  "analysis_run_id": "<operator-supplied UUID>",
  "trigger_kind": "manual",
  "manual_override": true,
  "source_event_key": "manual:<analysis_run_id>:<current n8n execution ID>"
}
```

It never accepts or sends `tender_id`, cannot create a new run, and contains no run/document classification. `TENDER — Intake Resume` remains the only dispatcher and owns all run, document, aggregation, and finalization decisions.

If the selected run is terminal `superseded`, the dispatcher returns
`superseded_no_op`. Manual override never reopens that status and dispatches no
Worker, Aggregator, or Finalization work.

`Execute TENDER — Intake Resume` waits for sub-workflow completion. The manual execution therefore exposes the dispatcher's structured result unchanged, including dispatched, exhausted, aggregation-started, finalization-started, manual-attention, and no-op outcomes.

## Operator procedure

1. Open `Set and Validate analysis_run_id`.
2. Replace the empty `ANALYSIS_RUN_ID` value with the existing run UUID.
3. Select **Execute Workflow**.
4. Read the terminal `Execute TENDER — Intake Resume` output for `action`, `analysis_run_id`, `documents_dispatched`, and `next_state`.

Do not add `tender_id` or bypass the validation node. Manual Resume is only for an already existing `analysis_run_id`.

## Packaging required

The repository export deliberately contains no live workflow ID. After importing `TENDER — Intake Resume`, bind `Execute TENDER — Intake Resume` to that imported dispatcher and read the node back before use. Keep **Wait for Sub-Workflow Completion** enabled.

The export is inactive and must not be treated as proof of production installation or runtime validation.
