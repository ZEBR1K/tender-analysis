# Document Worker exactly-one fallback canary 14363

Date: 2026-09-01

Workflow: isolated test Worker `pDTFwbq6B19qNAVI`

Result: `TEMPORARY_INJECTOR_RUNTIME_ERROR_BEFORE_STRICT_CLASSIFIER`

## Pre-run gate

Corrected rollback draft `50f43b3d-6117-4cb9-bc1d-4e08a8598b5e` was exact-equal to reviewed version `0800032b-ab17-40cf-b128-d4231383deab`: `71` nodes / `68` connection sources, no canary nodes, `Подготовить DOCX archive alias` in `runOnceForEachItem` mode with `$input.item`, `13` credential-bearing nodes and unchanged node groups.

The temporary draft was `b96333fa-ce5f-4885-8b73-b040da4e9964`:

- `75` nodes / `70` connection sources;
- Webhook connected directly to the pinned `Захватить документ в обработку` claim;
- only the pinned claim reachable among PostgreSQL nodes;
- `Сохранить analysis unit` bypassed;
- no path to collector, Validator dispatch, facts/completion persistence or Aggregator;
- one temporary per-item injector between the primary-response wrapper and the unmodified production strict classifier;
- recovery barrier expected IDs derived from post-materialization `Подготовить запрос для AI` and connected only to a bounded summary;
- approved paid-call bound `<=33`: at most `16` primary, exactly one forced fallback and at most `16` mutually exclusive Evidence Repair / Lossless Fact Partition calls.

Read-back proved exact intended connections and no unexpected modification of existing nodes other than the temporary recovery barrier. Pin-data SHA-256 remained `a851048395c4925dbe9397e191751bc8e928c8f68929a960c56dc3a610a09769`, with one pinned claim item. Credential references and published version `a7d04a95-a7d4-4098-aaa9-4a5955920f7b` were unchanged.

## Single execution result

Exactly one manual execution ran: `14363`, from `18:45:43.501Z` to `18:46:17.138Z`. No live patch, retry or second execution followed.

The execution confirmed the corrected document path before the canary injector:

- pinned claim output exactly equalled its execution pin and had `0 ms` execution time;
- `Подготовить DOCX archive alias` succeeded with both original `data` and `docx_archive` binary properties;
- parser returned `290` controls, `126` resolved controls, status `partial`;
- Normalizer returned `647` blocks, semantic status `unknown` and `33` bounded semantic warning groups;
- ActiveX 5/6/7/8 bound only to `#/tables/2` as unselected/unselected/unselected/selected;
- ActiveX 55/56 bound only to `#/tables/25` as selected/unselected;
- `Подготовить запрос для AI` emitted `12` ordered, unique analysis units.

One primary GLM request completed and its explicit response wrapper succeeded. The first incorrect node was the temporary `[CANARY] Inject one invalid primary envelope`:

```text
structuredClone is not defined [line 46]
ReferenceError
```

The installed n8n Code sandbox therefore did not expose the `structuredClone` global used by the offline Node helper. Local n8n documentation describes Code-node APIs but does not guarantee this global. The offline regression supplied Node's global and did not reproduce the installed sandbox boundary; this is a temporary-harness compatibility defect, not a production strict-validator or fallback result.

Runtime counts at the hard-stop:

```text
primary GLM calls: 1
primary strict classifier runs: 0
Gemini fallback calls: 0
Evidence Repair calls: 0
Lossless Fact Partition calls: 0
Loop done / recovery barrier / bounded summary: 0
```

No fallback decision, fallback checker, attempt audit or recovery convergence result was produced. The Stage 2 runtime gate remains pending.

## Database and restoration proof

The only PostgreSQL-type run was the pin-substituted claim. Execution pin and claim output were exact-equal; all non-pinned PostgreSQL node run counts were `0`. DB writes and partial persistence were `0`.

The temporary graph was restored from corrected rollback `50f43b3d-…` to draft `a62a7f29-9f3b-4ac0-b36b-33a664427c39`. Read-back proved exact nodes, connections and node groups equality, `71` nodes / `68` connection sources, no canary nodes, `$input.item` retained, pin SHA/credential references unchanged and published `a7d04a95-…` unchanged.

This artifact omits the client payload, identifying source metadata, provider response content, chain-of-thought and credential values. Stage 4 was not started.
