# Document Worker DW-19 batch-first canary — execution 14367

## Verdict

Execution `14367` makes the bounded **runtime batch-first gate GREEN** for the primary Extractor topology, linked-item lineage, exact one-unit fallback and done-only recovery barrier. It does not promote a workflow and does not test the downstream Validator or persistence path.

The executed workflow `YqIfikaeWbrdwfL7` is a disposable inactive clone, not a production candidate. Read-back after the run showed draft `39247d00-0842-4e0e-823a-6727439b6f7f`, `active=false`, `activeVersionId=null`, `76` nodes, `72` connection sources, `87` edges, `13` credential references, no pin data and no published version.

## Acceptance evidence

- Manual execution status: `success`; `2026-09-02T08:47:02.113Z` through `08:47:10.583Z`.
- `AI Extractor v1.0` used HTTP Request `4.4`, nested `options.batching.batch={batchSize:16,batchInterval:1000}`, timeout `180000`, no retry and default hard-stop.
- Primary Extractor had exactly one node run, emitted `12` outputs and took `4339 ms`.
- IDs remained exact and ordered from `sanitized_au_0001` through `sanitized_au_0012`.
- `pairedItem.item` remained `0..11` at prepare, primary HTTP, primary wrapper, primary decision and recovery barrier. Wrapper source IDs matched the same 12 IDs.
- Loop performed `12` item runs plus one done run; done emitted all `12` items in source order.
- Only `sanitized_au_0007` produced `fallback_required / contract / invalid_field_catalog_version`; the fallback HTTP node ran once and emitted one item.
- Unit `0007` ended with `final_source=fallback`, `attempt_count=2`; all other units ended with `final_source=primary`, `attempt_count=1`.
- Evidence Repair and Lossless Fact Partition had zero runs.
- Recovery barrier ran once with `12` outputs. The terminal summary returned `accepted=true`, `fallback_count=1`, the exact target/code, `barrier_exact=true`, `paid_calls_observed=13` and cap `25`.

The paid-call count is independently consistent with `12 primary + 1 fallback + 0 repair + 0 partition = 13`.

## Safety evidence

Static reachability from the canary trigger covered `31` nodes and had zero path to every PostgreSQL node, `Собрать units после evidence validation`, the AI Validator branch, persistence, Aggregator, document download, Docling or delivery. Execution runData contained zero runs for the same forbidden set. The barrier was connected only to `[CANARY] DW-19 acceptance summary`.

The repository stores only the sanitized acceptance projection. Provider request/response content, model reasoning, client document text, credentials, secrets and the full execution payload are not checked in.

The recorded hashes pin the reviewed projections and local artifact, but the sanitized projection cannot independently authenticate MCP provenance because the raw workflow and execution payloads are intentionally not retained in the repository.

## Metrics boundary

The canary proves observed request counts through the terminal summary and bounded per-unit attempt audits. Persistence-facing `extractor_requests`, `extractor_fallback_requests` and `total_ai_requests_before_ai_validator` were **not materialized** because the collector is deliberately unreachable. Their implementation remains covered locally; full-path runtime verification belongs to a later separately authorized gate.

## Packaging boundary and next gate

Local canonical commit `2ffe1de6b92f147b3942f6ed18206fda8fce87fd` remains a clean repository candidate and has not been imported as a complete workflow candidate. The disposable Yq clone contains five canary-only nodes, rewired terminal isolation and clone-specific node IDs/positions/default serialization; it must not be treated as the production candidate.

The next gate is a separate reviewed packaging/import of the clean canonical workflow into a new inactive, unpublished candidate. Only after exact read-back comparison should any separately authorized full-path Validator/persistence test be considered.

No production workflow, published version, PostgreSQL data, credentials or repository workflow behavior was changed by this evidence capture.
