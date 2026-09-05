# Document Worker Evidence Catalog Overflow Design

**Scope:** local canonical Document Worker only. Execution `14487` is read-only runtime evidence; this change is offline and is not a production promotion.

## Defect and corrected root cause

`Подготовить Evidence Repair` enumerates exact canonical structural candidates. The catalog is intentionally bounded at 256 entries and execution `14487` stopped at candidate 257 before the repair AI call.

The first proposed repair assumed that normalized `value_text` or the invalid quote exactly equalled one structural candidate. Independent sanitized runtime inspection disproved that assumption:

- canonical source characters: `44,375`;
- structural candidates: `2,016`;
- `sb_0714` candidates: `2,015`;
- target scope: `primary`;
- normalized `value_text`: length `256`, SHA-256 `ac570e483cf554d17ab77236846650015dcb9b833d259cba04bd4378399b2bc9`;
- normalized invalid quote: length `216`, SHA-256 `5e08b00f605d705b0fa2e8ba345d6138a00ca6071b1e3616092a42e105ec2752`;
- exact whole-candidate matches for either material string: none.

The proven runtime class is therefore an oversized, violation-bound target block for which whole-candidate equality is not available as a retrieval prerequisite. The bounded lexical-overlap strategy below is an offline hypothesis: the available runtime projection did not establish actual token-overlap scores, ranked ordinals, or whether all useful material will fit in the selected windows. Those properties require a fresh runtime canary.

## Sanitized derivative boundary

The checked-in fixture is a deterministic sanitized structural derivative, not raw execution output. It preserves the observed `2,016 / 2,015 / 44,375` geometry, primary target `sb_0714`, part `2/3`, oversized-table flags, the two violations, and no whole-candidate equality. Its material distributed over three late target candidates is synthetic test geometry chosen to exercise the proposed retrieval strategy; it is not a runtime observation. The fixture records runtime lengths and hashes as observations while using different synthetic material and hashes. It excludes client text, tender/run/document identifiers, URLs, credentials, and unrelated execution data.

## Selected design

The byte-identical shared builder in preparation and attempt 2 has two modes:

1. **Full mode:** if the source has `<=256` candidates and fits existing budgets, output remains byte-compatible: same candidates, refs, order, context, contract keys, and materialization.
2. **Target-ranked-windows mode:** only on candidate overflow and only when there is exactly one invalid fact with exactly one repaired-fact context, derive target block IDs from that fact and its violation details. Scan at most `4096` exact structural candidates with stable original ordinal refs. Build bounded lexical tokens from normalized invalid `value_text` and quotes, discard empty/short/stop tokens, and discard tokens with document frequency above `64`. Rank only candidates in known violation-bound target blocks by deterministic weighted token overlap; ties resolve by original source order. Retain at most `8` ranked anchors and their fixed `±2` same-block neighbours. Multi-fact overflow hard-fails before ranking because a merged catalog has no fact-local relevance contract and could expose a primary candidate relevant to fact A as selectable evidence for fact B.

Lexical overlap is used **only for bounded retrieval**. It is never accepted as evidence and never changes a quote. Every outgoing catalog entry remains an exact canonical source candidate with its original `er2:<block>:<ordinal>` ref and source/provenance binding. AI can select refs only. Attempt 2 materializes those exact candidates and runs the unchanged strict evidence validator. A future multi-fact overflow path requires a fact-local catalog/selection contract before this fail-closed boundary can be relaxed.

For `missing_primary_evidence`, selected target candidates already having `scope=primary` satisfy retrieval coverage. Otherwise the same bounded deterministic scoring must select a relevant primary candidate; absence fails closed.

## Bounds and fail-closed rules

Existing outbound bounds remain:

- `maxCandidates=256`;
- `maxTotalChars=250000`;
- `maxQuoteLength=1500`;
- `maxSerializedRequestChars=360000`.

Retrieval adds explicit bounds:

- scan candidates: `4096`;
- target blocks: `8`;
- normalized anchor material: `3000` characters;
- unique anchor tokens: `64`;
- unique tokens per candidate: `256`;
- scoring operations: `1,048,576`;
- ranked anchors: `8`;
- neighbour radius: `2`.

No fuzzy edit distance, embeddings, model retrieval, arbitrary prefix sampling, unbounded prompt, or second paid call is introduced. Empty anchors, fewer than two useful tokens, only high-frequency ambiguous tokens, zero target overlap, absent target blocks, missing relevant primary coverage, any scan/scoring/outbound overflow, and attempt-2 parity mismatch all fail closed.

## Audit and parity

Overflow contracts record mode, configured bounds, observed/target/retained/omitted counts and characters, bounded token and scoring metrics, ranked refs, target IDs, primary coverage mode, and retained ordinal ranges. They contain no raw anchor text. Attempt 2 independently rebuilds and exact-compares the catalog and selection contract before accepting any ref.

## Contracts preserved

- AI returns refs only and cannot author evidence strings.
- Catalog quotes are exact canonical source candidates.
- Refs retain original block-local ordinals.
- Strict evidence validation/materialization are unchanged and authoritative.
- Existing valid evidence is merged losslessly.
- Attempt-2 catalog and audit parity remain mandatory.
- `requests_count` remains at most one.
- Models, prompts by meaning, credentials, graph, persistence, ActiveX handling, Aggregator, Targeted Recheck, DB schema, and the 27-field catalog are unchanged.

## Acceptance matrix

| Case | Expected result |
|---|---|
| Multi-fact overflow with different target/primary material | Hard-fail before ranked retrieval; a merged catalog must not expose fact-A material to fact B. Future support requires a fact-local catalog contract. |
| Execution-14487-shaped sanitized derivative | `2,016 / 2,015 / 44,375`, no whole exact anchor; bounded catalog includes all three synthetic late relevant exact fragments. This proves the algorithmic class offline, not the real runtime token distribution. |
| Constructed valid repair | Selected refs materialize exact canonical strings and pass unchanged validator. |
| `<=256` candidates | Full-mode output and contract keys remain byte-compatible. |
| Zero overlap | Fail closed before AI. |
| Generic/high-frequency anchor | Fail closed as low-information/ambiguous. |
| Violation-bound target absent | Fail closed. |
| `missing_primary_evidence` with primary target | Target candidates satisfy retrieval coverage. |
| Overlap target with no relevant primary | Fail closed; relevant primary candidate succeeds deterministically. |
| Equal scores | Stable source-order tie-breaking. |
| Old adversarial 300-candidate input | Still fails closed; no arbitrary prefix catalog. |
| Request pressure | Serialized projection remains `<=360000` or fails closed. |
| Attempt-2 tamper | Exact catalog/selection parity rejects it. |
| Exact-equality-selection mutation | Corrected 14487 regression turns RED. |

## Verification boundary

Strict TDD evidence: the multi-fact overflow regression first failed against the review-blocked implementation with `AssertionError: Missing expected rejection.` The minimal overflow-only guard then made it pass with the explicit error containing `Multi-fact Evidence Repair catalog overflow is unsupported: invalid_facts=2; repaired_fact_contexts=2.` The earlier corrected fixture separately failed against the initially blocked implementation with `[Prepare Evidence Repair] Target-window exact material anchor missing for sb_0714.` The actual canonical jsCode now passes the focused `tests/document-worker-evidence-repair.test.mjs` suite (`108/108`). The in-test production-code mutation replacing lexical candidate overlap with whole-candidate equality fails the corrected sanitized path as required. No full repository suite was run by the implementation executor. Runtime token coverage, runtime GREEN, workflow import, publication, promotion, and live writes remain unverified and out of scope.
