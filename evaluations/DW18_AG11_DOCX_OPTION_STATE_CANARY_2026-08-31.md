# DW-18 / AG-11 DOCX option-state canary — 2026-08-31

## Status

```text
OFFLINE GREEN / RUNTIME GATE UNAVAILABLE
```

Этот файл не является runtime success evidence. Native Worker path не запускался, execution IDs не создавались, test Aggregator draft не публиковался.

## Offline evidence

Source-derived minimal fixture SHA-256:

```text
32f79d377ad3b775497e70754bdfdce8ec0928cfeb2626d60ca65ef519f7437b
```

Verified focused contracts:

```text
node --test tests/document-worker-docx-option-state.test.mjs
44/44 PASS

node --test tests/aggregator-national-regime-option-state.test.mjs
31/31 PASS
```

The fixture proves:

```text
ActiveX5 / 6 / 7 = unselected
ActiveX8 = selected, exact label "Не применимо"
ActiveX55 = selected, exact label "Не предусмотрены"
ActiveX56 = unselected
```

Negative cases prove fail-closed `unknown`/`indeterminate` with audit warnings for missing relationships, unsupported persistence/CLSID, malformed or oversized CFB, invalid sector indexes, excessive/cyclic FAT/miniFAT chains, orphan `contents`, invalid root child/sibling indexes and directory-tree cycles.

## Test Aggregator packaging evidence

```text
workflow ID: ftvmrEHoMbPOAqZG
pre/active version: 91c17313-a593-4fb9-9072-79320a958dd7
post draft version: f11906df-f760-4c54-a59e-16f4423ab534
applied operations: 3/3
node count: 24
connection drift: none
unexpected node drift: none
published during this task: no
executed during this task: no
```

Snapshot SHA-256:

```text
pre:  017093e027f781864b7fe261e77f8a704ccbcca5524102136300d65121e1063d
post: 4d1b737efe64fe1fb870917c48f7d6d799c76cbd9b40bc1266db38a4cea06d7f
```

The draft contains the AG-11 fail-closed rule, but its native execution is not claimed. Offline tests prove that generic/conditional PP 1875 candidates cannot authorize positive `national_regime/resolved` without a confirmed primary and exact-bound structured applicability proof.

## Final offline repository verification

```text
document-worker focused: 44/44 PASS
aggregator focused: 31/31 PASS
document-worker related: 154 total / 152 pass / 2 accepted pre-existing failures
full suite: 322 total / 316 pass / 6 accepted baseline failures
new failures: 0
```

The six full-suite failures are the previously accepted boundary: one intentional AG-8 promotion RED plus five additional pre-existing failures (two execution-14104 artifact/hash gates, immutable Worker beta hash, validator prompt line-ending mismatch, and Targeted Recheck evidence-coordinate mismatch).

## Unavailable Worker gate

Required Worker candidate:

```text
workflow ID: csnDg78NzN1nIjUT
name: [PROD CANDIDATE] TENDER — Обработать документ
MCP visibility: availableInMCP=false
```

Both `get_workflow_details` and version-history access returned:

```text
Workflow is not available in MCP. Enable MCP access from the workflow card in the workflows list, or from the workflow settings.
```

The n8n UI further states that workflow MCP access is available only to published workflows with webhook, form, schedule or chat triggers. This Worker is a subworkflow/manual candidate. Enabling access would require changing its trigger/access topology; that is outside the approved minimal graph and was not performed. The old `[3 TEST]` Worker was not substituted because it is a different historical workflow and not the exact candidate selected by the plan.

## Exact remaining runtime gate

Provide non-production read/write test access to the exact Worker candidate without altering production or adding an unrelated trigger. Then:

1. read back and snapshot its exact draft;
2. transplant only the reviewed DW-18 node/parameter/connection delta;
3. read back, validate and snapshot the saved draft;
4. execute the source document in the isolated contour;
5. verify selected negative facts, exclusion of unselected positives, exact provenance and terminal document state;
6. run the test Aggregator and verify no positive `national_regime/resolved` from generic PP 1875 clauses;
7. record Worker/Aggregator execution IDs and version IDs here.

Production n8n, production PostgreSQL and credentials were not changed.
