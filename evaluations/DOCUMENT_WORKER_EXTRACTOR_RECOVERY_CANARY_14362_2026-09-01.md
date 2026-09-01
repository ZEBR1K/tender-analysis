# Document Worker recovery canary 14362

Date: 2026-09-01

Workflow: isolated test Worker `pDTFwbq6B19qNAVI`

Result: `RECOVERY_ITEMS_COMPLETED_BUT_CANARY_BARRIER_REJECTED`

## Pre-run gate

The approved execution-14361 Code-node correction was synced first as draft `0800032b-ab17-40cf-b128-d4231383deab`. Read-back proved that the only changed node was `Подготовить DOCX archive alias`: it retained `runOnceForEachItem`, node identity, position, connections and all remaining JavaScript, while line 1 became `const item = $input.item;`.

The temporary corrected canary draft was `a175b809-f76b-48c1-8c7a-1a65f3475a09`:

- `74` nodes / `69` connection sources and exactly three `[CANARY]` nodes;
- `57` nodes reachable from the Webhook connected directly to the pinned claim;
- only pinned `Захватить документ в обработку` reachable among PostgreSQL nodes;
- no path to non-pinned DB nodes, collector, Validator dispatch, persistence or Aggregator;
- recovery barrier connected only to the bounded summary terminal;
- maximum paid-call bound `<=48`: `12`–`16` source units were possible from the preserved document path, with at most one primary, one fallback and one mutually exclusive Evidence Repair/Lossless Fact Partition call per unit. The approved conservative cap remained `16 + 16 + 16`.

Preserved state before execution:

- pin-data SHA-256 `a851048395c4925dbe9397e191751bc8e928c8f68929a960c56dc3a610a09769`;
- exact claim pin key present with one item;
- credential-node count `13`, credential-reference hash unchanged;
- published version `a7d04a95-a7d4-4098-aaa9-4a5955920f7b` unchanged.

## Runtime result

Exactly one manual execution ran: `14362`, from `18:07:07.341Z` to `18:16:08.727Z`. No patch, retry or second execution was attempted.

The execution passed the previously failing node:

```text
Подготовить DOCX archive alias
mode = runOnceForEachItem
line 1 = const item = $input.item;
result = success, one JSON+binary item
```

DOCX OOXML parsing, Docling normalization and analysis-unit preparation completed. Runtime generated `12` source units, not the historical `16`: after `Подготовить запрос для AI` they had unique ordered identities `au_0001` through `au_0012`.

Extractor/evidence audit:

- Loop Over Items: `13` runs = `12` loop batches + one done run;
- primary GLM calls: `12`;
- strict primary decisions: `12 accepted`;
- Gemini fallback calls: `0`;
- every bounded attempt audit used `ai_extractor_attempt_audit_v1`, `attempt_count=1`, `final_source=primary`, null primary failure class/code and the exact eight-key allow-list;
- direct evidence-validation success tails: `7`;
- Evidence Repair calls and successful tails: `5`;
- Lossless Fact Partition calls: `0`;
- actual paid model calls: `17`, below the pre-run cap `48`.

The Loop done output reached `Проверить полноту Extractor recovery` with all `12` items. The bounded summary did not run because the barrier hard-stopped first:

```text
[Extractor recovery barrier] Expected item 0 missing analysis_unit_id. [line 3]
```

## First incorrect node and root cause

First incorrect node: the temporary canary version of `Проверить полноту Extractor recovery`.

The canary changed its expected-ID source from persisted `Сохранить analysis unit` to `[CANARY] Bypass analysis-unit persistence`. Exact runtime shapes show why this was invalid:

```text
[CANARY] Bypass analysis-unit persistence:
  12 items
  keys include analysis_unit
  analysis_unit_meta present = false

Подготовить запрос для AI:
  12 items
  keys include analysis_unit_meta
  12/12 unique analysis_unit_id values present
```

Therefore the recovery loop itself completed, but the temporary barrier asked the pre-preparation bypass for a field that is materialized only by the next node. This is a canary-harness expected-identity source defect. It is not a GLM/Gemini contract failure and was not patched live.

## Semantic and persistence observations

Normalizer output retained fail-closed document state:

- `docx_option_state_status = partial`;
- `docx_option_state_semantic_status = unknown`;
- `290` controls, `33` semantic warning groups, `126` parser-resolved controls, `647` normalized blocks;
- activeX5/6/7/8 mapped only to `#/tables/2` as `unselected/unselected/unselected/selected`;
- activeX55/56 mapped only to `#/tables/25` as `selected/unselected`.

Evidence-tail outputs contained `requires_review` observations for both `national_regime` and `participation_guarantee`, but Validator and persistence were intentionally unreachable. Other text-grounded unit facts also existed, so this boundary does not prove final field-level fail-closed behavior. No FINAL or database state was produced.

Database proof:

- pinned claim run count `1`, execution time `1 ms`;
- current pin JSON and claim output JSON were byte-for-byte equal after canonical serialization, SHA-256 `9b1e73b85bfa21e089b13bc5c46daac5a6989043eb16c698337ef169c724e954`;
- every non-pinned PostgreSQL node run count `0`;
- DB writes `0` and partial persistence `0`.

## Restoration proof

The temporary graph was restored from corrected rollback version `0800032b-ab17-40cf-b128-d4231383deab` to new draft `50f43b3d-6117-4cb9-bc1d-4e08a8598b5e`.

Read-back proved:

- exact nodes, connections and node groups equality with the corrected rollback version;
- `71` nodes / `68` connection sources;
- no `[CANARY]` nodes;
- `Подготовить DOCX archive alias` still uses `$input.item` in per-item mode;
- pin-data SHA-256, one-item claim pin, credential references and published `a7d04a95-…` unchanged.

Runtime recovery remains incomplete. A future canary requires a separately reviewed/TDD expected-identity source contract; this run does not authorize an ad-hoc patch or retry. This artifact omits client text, filenames, source URLs, document/run UUIDs, provider responses, chain-of-thought and credential values.
