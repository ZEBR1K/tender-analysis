# Agentic TenderPlan Metadata Source Design

**Date:** 2026-09-11  
**Status:** approved by the user for implementation and live canary

## Goal

Give the Codex procurement analyst the TenderPlan FullInfo data for the same
procurement as a sealed, auditable source alongside the immutable source
documents. This closes the reproduced input gap without adding a page parser,
OOXML/XLSX indexer, field-specific resolver, quote verifier or semantic runtime
validator.

## Current gap

The Orchestrator receives the complete TenderPlan FullInfo response but persists
only a normalized subset in `tender_analysis_runs.tender_meta`. Agentic Dispatch
then builds a runner manifest containing only original documents. As a result,
Codex cannot use platform-only facts even though the upstream system already
received them.

## Chosen design

1. The Orchestrator keeps its existing normalized `tender_meta` properties and
   additionally stores the unchanged FullInfo response as
   `tender_meta.source_payload`.
2. Agentic Dispatch reads `tender_meta` from the existing run and sends it as a
   separate root-level `tender_metadata` source in the runner manifest:

   ```json
   {
     "tender_metadata": {
       "artifact_key": "tenderplan-metadata",
       "source_type": "tender_metadata",
       "source_name": "TenderPlan — карточка закупки",
       "data": {}
     }
   }
   ```

3. `documents[]` and `expected_documents` continue to describe only original
   procurement files. No synthetic document row is created in PostgreSQL and no
   document parser or coverage index is added.
4. The runner validates only the metadata source's closed JSON shape, bounded
   size, reserved identity and collision-free artifact key. The metadata bytes
   are covered by the existing canonical manifest SHA-256. The runner does not
   interpret metadata semantics.
5. Codex may cite the sealed metadata with
   `artifact_key=tenderplan-metadata`, a nonblank JSON-path-like locator and an
   optional honest quote. Null or absent metadata never implies a negative fact.
6. Finalization accepts the reserved metadata artifact only for a run with a
   non-empty `tender_meta`, marks promoted evidence as
   `source_type=tender_metadata`, and leaves the existing report adapter to
   render it as `TenderPlan — карточка закупки`.

## Runtime checks allowed by this change

| Check | Boundary protected |
|---|---|
| Closed manifest shape and bounded JSON size | JSON contract / availability |
| Reserved source identity and no artifact-key collision | JSON contract / source identity |
| Manifest SHA-256 includes metadata | Input integrity |
| Evidence artifact belongs to documents or sealed metadata | JSON contract / source identity |
| Nonblank locator for resolved/review evidence | Existing JSON contract |

No check decides whether a TenderPlan value is sufficient evidence for a field,
whether a quote is exact, or whether the agent's conclusion is correct. Those
remain agent semantics and offline evaluation concerns.

## Rejected alternatives

- **Synthetic PostgreSQL document:** would corrupt the meaning of
  `documents_total` and source-document audit.
- **Deterministic field mappings:** would recreate the field-specific resolver
  architecture the agentic lane is intended to replace.
- **Passing only selected TenderPlan fields:** risks silently dropping future
  useful platform data and requires ongoing field-specific parsing.
- **Semantic validation in Finalization:** duplicates Codex reasoning and is not
  justified by repeated multi-procurement evidence.

## Canary

After local regression and live publication, create a fresh run for previously
marked tender `6aa2c2ad5b7165804b8c4ff7`. Verify through read-only execution and
database checks that the run reaches `completed`, contains exactly 27 unique
FINAL fields, produces HTML/PDF, and that any metadata evidence is represented
as `source_type=tender_metadata`. Compare the new 27-field result with previous
run `6c36e5da-f9e2-48d9-a062-0493f0c2bf73` without turning semantic differences
into blocking runtime rules.
