# Aggregator model comparison

**Date:** 2026-08-29
**Test workflow:** `[TEST CODEX] TENDER — Агрегация закупки` (`ftvmrEHoMbPOAqZG`; local beta artifact; the A/B harness did not verify or change live activation/publication state)
**Exact beta artifact SHA-256:** `dc214110d3086d9e147f0b2c7fe983ee0e93543ca31f7d82c2c52ef3a1f04484`
**Fixture:** execution `14104`, SHA-256 `6392f9c882a211f20cf1f13777f7002b8c8628270d025df5fdf46492f2adbd75`
**Field:** `procurement_subject`

## Scope and boundaries

The A/B runtime harness replayed the same execution-derived fixture against the exact beta artifact. It changed **only** `request.model`; it did not access PostgreSQL or n8n and did not modify the workflow or fixture. Both outputs were accepted by the existing checker and evaluated by the same route-aware semantic oracle.

This is a narrow test-candidate comparison. It does not promote the beta or production Aggregator, demonstrate correctness of all 27 fields, or replace the required fresh full run and manual semantic review.

## `procurement_subject` results

| Request model alias | Exit / finish | Checker / route / oracle | Selected primary | `doc_7_au_0031` | Cost, RUB | Latency | Tokens |
|---|---|---|---|---|---:|---:|---:|
| `google/gemini-3.7-flash@provider=google-ai-studio/flex&reasoning_effort=low` | `0` / `stop` | accepted / `round1_final` / 6/6 | `doc_7_au_0008` | `not_applicable` | 0.25840089 | 3711 ms | 3732 |
| `z-ai/glm-5.3-flash@provider=cloudflare&reasoning_effort=low` | `0` / `stop` | accepted / `round1_final` / 6/6 | `doc_7_au_0001` | `not_applicable` | 0.08151487 | 12911 ms | 3290 |

Both models safely rejected the auxiliary/internal candidate `doc_7_au_0031` for the current-procurement boundary. The fixture oracle accepts either documented correct current-procurement primary; this A/B therefore establishes the boundary rather than a requirement for one exact primary among equivalent valid candidates.

## Comparison decision

- GLM is 68.5% cheaper on this fixture.
- Gemini is 71.3% faster on this fixture.
- Current recommended **Aggregator beta baseline**: GLM 5.3 Flash low, based on observed reliability, correctness, and cost.
- Fallback for latency or provider issues: Gemini 3.7 Flash low.

Observed cost, latency, and tokens are fixture/provider measurements, not general price or performance guarantees.

## Related `application_documents` evidence

The preceding runtime evidence for `application_documents` found that both models safely returned `requires_recheck` with `ambiguous_scope`; GLM was cheaper and more scope-sensitive, while Gemini was faster. That evidence proves only safe Round 1 deferral. It does **not** establish terminal correctness: actual Targeted Recheck remains the P0 gate before a full client run.

## Status

The production Aggregator remains unchanged and its intentional production-promotion RED remains open. The beta workflow, fixture, SQL, checker, topology, Targeted Recheck, and PostgreSQL were not changed by this A/B harness.

The full offline suite after the harness was:

```text
170 total
169 passed
1 intentional production-promotion RED
```
