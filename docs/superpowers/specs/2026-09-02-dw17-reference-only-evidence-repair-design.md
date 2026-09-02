# DW-17 Reference-Only Evidence Repair Design

**Status:** owner-approved implementation design
**Scope:** canonical local Document Worker only; no live n8n/DB access

## Problem and boundary

Attempt 1 correctly rejects Extractor evidence whose model-written `quote` is not exactly grounded. The current `ai_evidence_repair_v1` asks a second model to rewrite `{semantic_block_id, quote}`, so it can repeat the same transcription failure. Exact validation must remain strict; the repair boundary, not grounding semantics, must change.

Primary Extractor request, response, prompt, model and schema remain unchanged. AI Validator, collector, persistence, terminal exhaustion, field semantics, models and workflow topology also remain unchanged.

## Chosen architecture

`Подготовить Evidence Repair` deterministically derives a bounded canonical evidence catalog from the current analysis unit. Each entry contains:

```json
{
  "evidence_ref": "er2:<semantic_block_id>:<fragment_ordinal>",
  "semantic_block_id": "sb_...",
  "scope": "primary|overlap",
  "type": "text|table|...",
  "role": "...",
  "canonical_quote": "exact contiguous canonical fragment",
  "context_before": "bounded source-derived context or null",
  "context_after": "bounded source-derived context or null"
}
```

Candidate IDs depend only on the validated source block ID and deterministic fragment ordinal. Identical canonical text in different blocks remains distinct because identity is `(semantic_block_id, fragment_ordinal)`; it is not a collision and never mixes scope or provenance. Duplicate block IDs, duplicate refs, unsupported scope/provenance, empty/non-contiguous candidates, catalog overflows and ref collisions throw before the provider call.

Fragments are produced without fuzzy matching. The same whitespace/table-coordinate canonicalization used by strict validation defines the searchable text. Every nonempty structural line/sentence becomes its own candidate; adjacent independent units are never packed. Offset-based splitting is used only when one structural unit exceeds the existing `1500`-character quote limit. The catalog preserves source order and has hard limits of `256` candidates, `250000` catalog characters including contexts, and `100000` canonical-source characters. Limits are enforced incrementally, so candidate 257 fails before the remainder is accumulated. The exact serialized HTTP request, including catalog, contexts, invalid facts, violations, field catalog, response schema and prompt overhead, is capped at `360000` characters. Every overflow fails closed rather than truncating.

`Object.freeze` is not treated as a trust boundary between Code-node sandboxes. Both Prepare and attempt 2 contain byte-identical catalog-builder logic. Attempt 2 rebuilds the expected catalog from source, then exact-compares candidate order, refs, block identity, scope/type/role, quote, contexts and every catalog count/bound before accepting any selected ref.

The Repair model receives invalid facts, violation diagnostics and the allow-listed catalog. It returns `ai_evidence_repair_v2` only:

```json
{
  "schema_version": "ai_evidence_repair_v2",
  "field_catalog_version": "tender_fields_v1",
  "analysis_unit_id": "...",
  "repairs": [
    {
      "fact_index": 0,
      "violation_codes": ["quote_not_found"],
      "selected_evidence_refs": ["er2:sb_0019:0001"]
    }
  ]
}
```

The model cannot provide quote, block, scope or provenance. One repair entry is required for every and only expected invalid fact index. Refs must be exact allow-list members, unique within a repair, and belong to the current unit/catalog.

## Materialization and lossless merge

`Проверить evidence — попытка 2` validates the provider envelope and v2 response before materialization. For every repaired fact it partitions original evidence using attempt-1 violations:

- evidence indexes named by evidence-specific violations are invalid and are not propagated;
- evidence proven exact-grounded from the current immutable source is retained;
- model-selected refs are materialized to `{semantic_block_id, quote}` from the catalog;
- exact `(semantic_block_id, quote)` duplicates are removed deterministically, preserving retained-evidence order followed by selected-ref order;
- model input never supplies provenance; existing `validateFacts(..., 2)` re-derives downstream provenance/context from source.

Missing-primary and overlap rules are preserved. A fact with only overlap candidates still follows the existing deterministic rejection behavior. Attempt 2 applies the unchanged evidence count, quote length, total quote characters, exact grounding and Primary requirements. The existing `repair_dropped_grounded_evidence` protection remains as a post-merge invariant and must reject any loss of previously grounded evidence. If it adds an attempt-2 violation, `violations_by_code`, unresolved/resolved counts and outward diagnostics/audit counts are resynchronized before output.

Untouched valid facts are passed unchanged into attempt 2. The successful output remains the current downstream validated fact/evidence shape, including source-derived provenance fields. Invalid Primary quotes never appear in successful `verified_facts` or `evidence_context`.

## Failure semantics

Unknown, malformed, foreign, duplicate or out-of-unit refs; duplicate fact indexes; incomplete repair cardinality; non-allow-listed violation codes; scope/provenance mismatch; catalog collision/overflow; and non-canonical materialization all throw or fail strict attempt 2. No fuzzy acceptance or fallback repair call is added. Unsuccessful attempt 2 reaches the existing explicit `[Evidence validation exhausted]` route.

## Resource and topology invariants

There is still at most one Evidence Repair call per invalid unit. Existing fact/evidence/quote limits remain authoritative. Candidate generation adds explicit bounded catalog limits and never silently truncates. No Merge node, loop, model, credential, Extractor, Validator, persistence, DB schema or downstream contract changes.

## Verification

Regression coverage must prove stable refs, exact canonical materialization, identical-text block isolation, structural sentence boundaries, strict rebuild parity under catalog/contract tampering, table-coordinate behavior, multi-ref merge, retained grounded evidence, invalid quote non-leakage, synchronized post-invariant metrics, unknown/foreign/duplicate refs, missing-primary/overlap behavior, resource/request bounds, exact downstream shape, unchanged Extractor contract and unchanged terminal exhaustion.

Offline `rg` plus `git log -S`/history inspection found no safe sanitized fixtures for executions `14234` or `14238`; their exact replay gate is therefore pending and no content is invented. The `14371` artifact is explicitly a synthetic sanitized structural-class fixture (`runtime_replay=false`), not execution replay evidence.

Only local GREEN may be claimed. Runtime validation remains a future operator-authorized canary.
