# DW-23 and ActiveX reconciliation design

## Context

The live workflow `[DW-23 TEST CODEX] TENDER — Обработать документ` is the operational test workflow, but its shared ActiveX implementation is older than the tested Worker already present in `main` at commit `4334b4f`.

The clean `main` Worker already combines:

- JSONB-safe ActiveX identities;
- group-local option ownership and fail-closed guards;
- DW-22 bounded Evidence Repair overflow handling;
- DW-23 selective AI Validator retry.

Replacing that Worker wholesale with the live export introduced new Worker regression failures. Live n8n remains read-only during reconciliation.

## Decision

Use the Worker from commit `4334b4f` as the implementation base. Apply only intentional operational differences from the current live DW-23 export.

Do not use the live export as the code base and do not replay the historical implementation commits manually.

## Operational overlay

Review and preserve only these live-specific settings when they do not violate tested contracts:

- the call route to the current test Aggregator;
- the configured Error Workflow;
- the current Extractor model/provider selection;
- the additional Wait node and its connection, if it is still required by the live execution path;
- workflow metadata required for a valid import.

Pinned data and detached test nodes must not be introduced.

## Invariants

- ActiveX persisted identities remain versioned JSON tuples and NUL-free.
- Option applicability remains group-local and fail-closed.
- The primary AI Validator runs once and stays outside the retry loop.
- Only contract-invalid facts enter retry attempts 2 and 3.
- Valid sibling facts are preserved without another AI request.
- Three failed attempts produce an audited `requires_review` fallback rather than failing the document.
- Evidence Repair overflow remains bounded and fail-closed.
- The Worker continues to invoke the test Aggregator, not a production route.
- No live n8n workflow is modified during implementation or verification.

## Verification

Run focused regression tests for:

- ActiveX option state and owner binding;
- JSONB-safe structural identities;
- Extractor envelope and recovery;
- Evidence Repair overflow;
- selective Validator retry and terminal fallback.

Then run the complete repository test suite. The reconciled Worker must introduce no Worker failures relative to the clean `4334b4f` baseline. Existing unrelated RED tests must be reported separately and must not be hidden or weakened.

## Delivery

Implement the reconciliation in the isolated `codex/sync-n8n-test-v2` worktree. Update project status only after verification. Commit the reconciled local export and documentation without changing or publishing live n8n.
