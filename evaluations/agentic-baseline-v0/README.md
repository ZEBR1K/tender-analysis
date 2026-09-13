# Agentic evaluation baseline v0

`agentic_baseline_v0` is a **provisional** evaluation baseline assembled from
the four archived blind runs and the already completed spot-check in
`evaluations/codex-agentic-blind-test-2026-09-08/comparison.md`.

It is not a gold standard and is not a complete source-grounded manual truth
for all 27 fields. In particular, agreement between the four runs is recorded
as `cross_run_consensus`, not as proof that the value is correct. A citation in
an archived Markdown result is also not treated as mechanically verified
evidence.

This baseline cannot be used as a production acceptance gate. It is suitable
only for deterministic regression checks and for the stages 3–5 shadow MVP.
A separate, complete source-grounded adjudication of all 27 fields remains a
future production gate.

## Contents

- `adjudication.json` records all four reported statuses, the provisional
  accepted status set, known material constraints, forbidden conclusions and
  the limited source-check state for exactly 27 `FIELD_CATALOG.md` keys.
- `source-manifest.sha256` pins the 12 archived source documents and the
  archived `inputs/FIELD_CATALOG.md` snapshot.

`source_check_status=not_source_verified` and an empty `source_anchors` array
are intentional. They mean the earlier comparison did not preserve a source
check sufficient to claim manual source truth for that field.
