# TenderPlan Orchestrator pre-DB smoke — execution 14678

## Scope

Read-only runtime smoke test for the two TenderPlan tender IDs supplied for the intake integration. The test reused the repository Orchestrator input validation, TenderPlan FullInfo request, and normalization Code node.

The test workflow deliberately stopped before PostgreSQL registration. It contained no PostgreSQL node and no Execute Workflow node, so it could not invoke Document Worker, Aggregator, Finalization, or any production workflow.

## Test workflow

- Workflow: `[CODEX TEST] Orchestrator pre-DB smoke — two tenders`
- Workflow ID: `yocBDh0nCvPPxItn`
- State: inactive, unpublished
- Execution: `14678`
- Execution mode: manual
- Result: success
- Started: `2026-09-07T22:24:41.652Z`
- Stopped: `2026-09-07T22:24:42.289Z`
- Terminal node: `TEST STOP — before DB registration`

The workflow was requested for project `YRzLcFnyCb57eVVm` and folder `U0XahCefnagOFXRx`. The n8n MCP server created it in the requested project but returned `parentFolderId: null`; folder placement therefore remains an MCP capability/instance drift item.

## Sanitized results

| Tender ID | Tender number | Attachments | Supported PDF/DOCX/XLSX |
|---|---:|---:|---:|
| `6a9edb435b7165804b33d53f` | `0372200191126000011` | 6 | 5 |
| `6a9edb415b7165804b3398bb` | `0372100008126000238` | 5 | 5 |

Both FullInfo responses matched the requested TenderPlan IDs, and the unmodified Orchestrator normalization code completed for both items.

## Mark-notification probe

The separate read-only workflow `[CODEX TEST] TenderPlan type-5 contract probe` was rerun as execution `14677` immediately before the smoke test.

- `GET /api/notifications/v2/getlist?types=5&page=0` returned an empty `tenders` array.
- Queries for both supplied IDs returned empty `tenders` arrays.
- FullInfo returned `marks: []` and an empty `notification` object for both tenders.

Consequently, no representative type-5 mark event was available to establish the notification ID, tender ID, timestamp, and ordering paths required by Task 8. No fixture or poller contract was fabricated.

## Safe Orchestrator copy

A second inactive workflow, `[CODEX TEST] ТЕНДЕРЫ ОРКЕСТРАТОР — NO WORKER` (`thE9gLyNTvxLWt8I`), preserves the repository Orchestrator topology and credentials but replaces `Запустить обработку документа` with the terminal NoOp `TEST STOP — Document Worker not invoked`.

It was validated and read back after creation. It has no `n8n-nodes-base.executeWorkflow` node and remains unexecuted because it contains PostgreSQL writes and the live intake migration preflight is not satisfied.

## Production impact

- Existing live workflows changed: none.
- Workflows published or activated: none.
- Production PostgreSQL writes: none.
- Document Worker executions: none.
- Repository branch: `codex/tenderplan-intake-resume`; no merge to `main`.
