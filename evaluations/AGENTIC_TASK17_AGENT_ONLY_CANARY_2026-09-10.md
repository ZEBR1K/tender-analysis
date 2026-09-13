# Task 17 — temporary agent-only routing canary

Date: 2026-09-10

## Outcome

Task 17 is runtime GREEN for the temporary agent-only contour. The legacy
Document Worker/Aggregator nodes remain in the Orchestrator and Intake Resume
graphs but are unreachable. A real marked TenderPlan procurement completed one
Codex run over its DOCX and legacy XLS source files, passed the closed JSON and
source-identity contract, and committed exactly 27 shadow field rows.

TenderPlan Mark Intake was published only after that terminal canary passed.
Its first scheduled production execution `15393` then completed successfully,
called Intake Resume executions `15394–15396` for the three currently marked
tenders, and all three finished through the existing event no-op path. No
duplicate analysis run or agentic job was created.

## Live workflow state

| Role | Workflow ID | State | Active version |
|---|---|---|---|
| Document Preparation | `0scTZu1aBKsMd6AM` | published | `3a275083-4656-489e-ab4b-3d8da849ca5e` |
| Orchestrator | `TRLYuU7mVyE1bjjr` | published, temporary agent-only | `e8a085a9-6a7e-4230-9026-2839f48ba359` |
| Intake Resume | `VO8Ml0sfO65w2Jiz` | published, temporary agent-only | `51f567d2-4100-4d81-9a17-29b7df7eeb6c` |
| Agentic Dispatch | `gP29fv0rq4MoON9a` | published | `b2b0c229-d313-4531-b3a4-60698dfcbf85` |
| Agentic Monitor | `CALcBEXvQsO1AcfP` | published | `4a27f13d-4fd7-421c-ab9c-016e4a3c11d9` |
| Agentic Error | `6ccedae778a14176` | published | `537c0acf-559e-4cb2-941e-67b0f4940437` |
| TenderPlan Mark Intake | `biYC4OvWBlfJRmnj` | published | `3a89a0bd-5fa7-4758-a3f1-a894d8aa232f` |

All published workflows were read back with `versionId=activeVersionId`.
Dispatch and Monitor use the dedicated ownership-guarded Agentic Error
workflow. Orchestrator and Intake Resume retain the shared Intake error handler.

The Orchestrator read-back contains 19 nodes. Its supported branch is exactly:

```text
Document Preparation
→ atomic run/document registration
→ Agentic Dispatch
→ terminal Orchestrator result
```

`разделить документы`, `ВРЕМЕННЫЙ ФИЛЬТР РАСШИРЕНИЯ` and
`Запустить обработку документа` remain in the workflow but have no reachable
incoming edge. Intake Resume likewise cannot reach its legacy Worker,
Aggregator or Finalization calls. The marker `TASK17_TEMPORARY_AGENT_ONLY`
documents this intended temporary state.

## Source-format decision

Legacy `.xls` is accepted as an untouched source file. Document Preparation
records only file name, MIME type, byte size and SHA-256; Dispatch stages the
same bytes. Codex chooses how to inspect the file. No XLS parser, sheet index,
semantic validator or field-specific rule was added.

## Runtime findings and fixes

### Existing pre-Task17 run

Intake Resume execution `15296` targeted old run
`a5e765d7-52a3-42d9-833a-7ab52ec07d10` and failed closed with
`agentic_shadow.reason=manifest_incomplete`. It created no agentic job and ran
no legacy node because that run predated source byte identity. The exact run was
later set to `superseded` under an owner-authorized guarded update; its audit
rows were retained.

### Multi-document manifest collection

Fresh Orchestrator execution `15332` / Document Preparation `15333` downloaded,
hashed and identified both direct files, but the manifest builder read the
per-iteration identity node and observed only one of two results. The minimal
fix added one aggregate collector on the `Loop Over Items` done output. No page,
sheet or OOXML parsing was introduced. Regression tests cover the two-direct-
document case.

### Seal hash representation

Fresh Orchestrator `15355` / Document Preparation `15356` created run
`b731f861-4df6-40df-a8c5-67b8564f3f03` with two registered documents. Dispatch
`15357` staged `2/2` and sealed the runner job, but its identity guard accepted
only lowercase SHA-256 while the runner contract returns uppercase hex. A RED
test reproduced the mismatch. The one-line fix made the SHA-256 representation
case-insensitive without weakening its 64-hex identity requirement.

The failed job `a646d4df-3573-49db-bc24-ba78094d3c51` remains as audit evidence.
It was not rewritten.

## Successful real Codex canary

A controlled manual Intake call used the same analysis run with
`replicate_index=2`, leaving the failed first job unchanged. Temporary canary
inputs were restored immediately after dispatch; normal Intake operation again
uses `replicate_index=1`.

| Layer | Evidence |
|---|---|
| Mark wrapper | execution `15371` |
| Intake Resume | execution `15372` |
| Agentic Dispatch | execution `15373` |
| Agentic job | `13b090b5-38fc-432a-a235-90ae43f609fe` |
| Terminal Monitor | execution `15387` |
| Analysis run | `b731f861-4df6-40df-a8c5-67b8564f3f03` |

Terminal result:

```text
runner status=completed
attempt=1
expected/staged documents=2/2
inspected documents=2
result fields=27
unique field_key=27
validation.valid=true
validation job issues=0
persisted shadow rows=27 (transactional DB postcondition)
legacy Orchestrator Worker nodes=0 runs
legacy Intake Worker/Aggregator/Finalization nodes=0 runs
```

Field statuses:

```text
resolved=7
requires_review=4
not_found=16
```

The result reported inspection of both `doc-0001` and `doc-0002`. All 14
evidence items reference one of those manifest artifacts and have a nonblank
human locator. This verifies only the source/locator JSON contract; quote
accuracy, evidence sufficiency and field semantics were not scored at runtime.

Usage reported by the runner:

```text
input_tokens=1,628,854
cached_input_tokens=1,530,112
output_tokens=27,594
reasoning_output_tokens=4,544
```

Artifact identities:

```text
input_manifest_sha256=E67FF357E56FEFE4E924767D40D6B6D397935F480E7D227D175B31ABB4B9BD01
raw_result_sha256=04F59F5DFFB8F54E01BF33FCA8A460C06832B89444269FFD789B344339FCC819
validated_result_sha256=F4873A05295339F83311DC9EEA77E512B0155052FCBB142DE3CF62B3DCDC062A
```

## Post-canary review corrections

Independent final review found two non-semantic contract issues. Intake Resume
preserved the Dispatch action only inside `agentic_shadow`, so its top-level
completion fallback could label an acknowledged launch as
`manual_attention_required`. The restore node now emits the explicit structural
actions `agentic_dispatched` or `agentic_no_op`, while retaining the child action
inside the audit object. The terminal allowlist was extended by exactly those
two values.

The disconnected legacy Orchestrator filter also briefly included `.xls` in
the repository candidate. It is restored to pending PDF/DOCX/XLSX only, so a
future reconnection cannot send legacy XLS into the old Worker. `.xls` remains
accepted solely by source preparation and the agentic path. Both defects were
reproduced by focused RED tests, corrected, published and read back at the live
versions listed above. No parser or semantic rule was added.

## Verification

Focused routing/manifest/Dispatch suite: `46/46` passed.

Full repository suite on Node.js: `753` total, `747` passed, `0` failed,
`6` skipped for documented host/runtime prerequisites.

Post-activation scheduler check: Mark Intake `15393` and child Intake Resume
executions `15394–15396` all succeeded; each child ended at `Return Event No-op`.

## Remaining boundary

Task 17 proves intake, source staging, Codex execution, monitoring and exact
27-row shadow persistence. It does not promote shadow fields into the canonical
FINAL/report tables. Semantic comparison with employee-authored gold reports
remains offline evaluation work and must not become a runtime blocker without
repeated cross-procurement evidence.
