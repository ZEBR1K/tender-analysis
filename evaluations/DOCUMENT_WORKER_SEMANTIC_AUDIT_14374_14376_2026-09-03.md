# Document Worker semantic audit — executions 14374 and 14376

**Audit date:** 2026-09-03

**Workflow:** `[DW-17 MANUAL REVIEW — INACTIVE] TENDER — Обработать документ` (`8dEt6A8IwTybFuIq`)

**Scope:** read-only review of existing execution metadata and selected node outputs

**Overall verdict:** technical runtime GREEN through readiness; exact grounding PASS; semantic applicability FAIL

## Safety and evidence boundary

The audit performed no workflow update, publish/unpublish, activation, execution, retry, database mutation, credential operation, or external delivery. The report retains only bounded counts, identifiers needed for regression, verdicts, and semantic defect classes. It does not retain client document text, quotes, complete `runData`, provider payloads, credentials, source/download URLs, secrets, document/run UUIDs, or model reasoning.

The workflow was observed as inactive and unpublished (`activeVersionId=null`), with `71` nodes and current draft `62041fec-78c3-493a-9d2e-df648b51d1c9`. `Call 'TENDER — Агрегация закупки'` was disabled. Its pass-through node entry appeared in both run traces, but no Aggregator child execution was created.

## Execution metadata

| Execution | Mode | Status | Started (UTC) | Stopped (UTC) | Retry |
|---:|---|---|---|---|---|
| `14374` | `manual` | `success` | `2026-09-03T04:08:53.303Z` | `2026-09-03T04:11:41.004Z` | none |
| `14376` | `integrated` | `success` | `2026-09-03T04:26:26.887Z` | `2026-09-03T04:29:26.883Z` | none |

n8n execution metadata does not expose an immutable executed version ID for these runs. Draft `62041fec-78c3-493a-9d2e-df648b51d1c9` is the current observed workflow state, not cryptographic proof of the exact graph executed by either immutable execution.

## Technical result

Both executions completed the same bounded document path:

```text
12 analysis units
→ Extractor recovery barrier 12/12
→ Validator dispatch 9/9
→ facts persisted with DB count parity
→ document.status = completed
→ run.status = ready_for_aggregation
```

| Metric | `14374` | `14376` |
|---|---:|---:|
| Persisted facts | 46 | 42 |
| Persisted evidence items | 179 | 171 |
| `confirmed` | 20 | 20 |
| `requires_review` | 13 | 13 |
| `rejected` | 13 | 9 |
| Stored units / expected units | 12 / 12 | 12 / 12 |
| Stored facts / expected facts | 46 / 46 | 42 / 42 |
| Aggregator child executions | 0 | 0 |

The `46 → 42` fact and `179 → 171` evidence drift occurred on identical normalized/semantic input cardinalities. The stable aggregate count of `confirmed` and `requires_review` does not imply stable field semantics.

## Field distributions

Cells show `facts / evidence (confirmed, requires_review, rejected)`.

| `field_key` | `14374` | `14376` |
|---|---:|---:|
| `national_regime` | 6 / 18 (0, 6, 0) | 5 / 19 (0, 5, 0) |
| `application_documents` | 16 / 60 (8, 1, 7) | 10 / 46 (7, 2, 1) |
| `payment_terms` | 5 / 12 (3, 2, 0) | 7 / 15 (3, 3, 1) |
| `evaluation_criteria` | 12 / 68 (6, 0, 6) | 10 / 47 (5, 0, 5) |
| `analog_allowed` | 1 / 2 (1, 0, 0) | 0 / 0 (0, 0, 0) |
| `participation_guarantee` | 3 / 11 (0, 3, 0) | 2 / 8 (0, 2, 0) |
| `advance_contract_guarantee` | 1 / 6 (1, 0, 0) | 4 / 25 (3, 1, 0) |
| `rebidding` | 1 / 1 (1, 0, 0) | 2 / 6 (2, 0, 0) |
| `delivery_term` | 1 / 1 (0, 1, 0) | 1 / 2 (0, 0, 1) |
| `platform` | 0 / 0 (0, 0, 0) | 1 / 3 (0, 0, 1) |
| **Total** | **46 / 179 (20, 13, 13)** | **42 / 171 (20, 13, 9)** |

## Reference-only repair audit

All attempt-2 evidence returned by `Проверить evidence — попытка 2` passed the deterministic exact-grounding validator. The tables identify only the repaired target fact and the final evidence count for that fact; no evidence text is reproduced.

### Execution 14374

| Unit / fact | `field_key` | Initial deterministic violation(s) | Final evidence | Exact grounding |
|---|---|---|---:|---|
| `doc_3_au_0003#0` | `national_regime` | `quote_not_found` | 5 | PASS |
| `doc_3_au_0007#1` | `application_documents` | `quote_not_found` | 6 | PASS |
| `doc_3_au_0008#2` | `application_documents` | `missing_primary_evidence`, 2 × `quote_not_found` | 7 | PASS |
| `doc_3_au_0009#1` | `evaluation_criteria` | 2 × `quote_not_found` | 17 | PASS |
| `doc_3_au_0012#0` | `advance_contract_guarantee` | `quote_not_found` | 6 | PASS grounding / FAIL applicability |

### Execution 14376

| Unit / fact | `field_key` | Initial deterministic violation(s) | Final evidence | Exact grounding |
|---|---|---|---:|---|
| `doc_3_au_0003#0` | `national_regime` | `quote_not_found` | 5 | PASS |
| `doc_3_au_0007#4` | `application_documents` | `duplicate_evidence` | 9 | PASS |
| `doc_3_au_0010#1` | `evaluation_criteria` | 2 × `quote_not_found` | 8 | PASS |
| `doc_3_au_0012#0` | `advance_contract_guarantee` | `quote_not_found` | 4 | PASS grounding / FAIL applicability |

## DOCX option-state boundary

Both executions expose the same deterministic parser metrics:

```text
647 normalized blocks
528 semantic blocks
290 DOCX controls
126 controls structurally resolved
33 semantic-mapping warnings
  ├─ 29 missing_structural_semantic_owner
  └─  4 conflicting_structural_option_coordinates
docx_option_state_status = partial
docx_option_state_semantic_status = unknown
```

The `33` warnings are not parser coverage loss: normalization reported full source-ref coverage. They mean that option selection cannot yet be assigned to a reliable semantic owner. Labels from mutually exclusive alternatives can therefore remain exact source substrings while their applicability is unknown.

## Semantic findings

### FAIL — `doc_3_au_0012#0 / advance_contract_guarantee`

The repaired evidence is byte-exact. Read-only semantic inspection linked its source context (`doc_3_au_0012`, repaired fact `0`, initial block `sb_0466`) to unresolved DOCX option ownership and mutually exclusive alternatives. Exact materialization proves where the text came from; it does not prove which alternative was selected or that the selected clause applies to `advance_contract_guarantee`. A `confirmed` verdict is therefore unsafe. Sensitive option labels, client text and raw coordinate payloads are intentionally omitted, so this linkage must be preserved as a new sanitized regression fixture before implementation; the report alone is not a byte-level replay. This is the concrete regression case for a deterministic review cap.

### FAIL — unresolved DOCX option ownership

`126/290` structural resolutions and `33` unresolved semantic mappings leave the overall semantic state `unknown`. Downstream validation did not consistently cap affected option-derived claims at `requires_review`. The existing exact-grounding guard must remain unchanged; the missing guard is semantic applicability.

### FAIL — cross-run stability

- `analog_allowed` was one confirmed fact in `14374` and disappeared entirely in `14376`.
- `application_documents` moved from `16` facts with verdicts `8/1/7` to `10` facts with verdicts `7/2/1`. This proves fact/verdict qualification instability; the sanitized aggregate alone does not establish whether deduplication, model variation, or another stage caused it.
- `delivery_term` changed from `requires_review` in `14374` to `rejected` in `14376` on the same source document.
- `advance_contract_guarantee` expanded from one confirmed candidate to four candidates (`3 confirmed / 1 requires_review`) while option ownership remained unresolved.

These observations do not redefine any `FIELD_CATALOG.md` meaning. They show that the current Worker can produce exact-grounded yet semantically unstable candidate facts.

## Gate decision and next bounded step

Technical runtime is GREEN only through Worker readiness:

```text
claim → DOCX/Docling → 12 units → Extractor recovery → Evidence Repair
→ AI Validator → fact persistence → document completion → ready_for_aggregation
```

Semantic gate is FAIL. The workflow is not production-ready, and this audit does not validate Aggregator, Targeted Recheck, 27/27 FINAL, report generation, or delivery.

The next single bounded step is to add an execution-derived regression and a minimal deterministic review cap: when a fact depends on a DOCX option whose semantic owner is unresolved or whose coordinates map to mutually exclusive alternatives, it may not become `confirmed`; preserve the candidate/evidence/audit and route it to `requires_review`. The regression must at minimum cover `doc_3_au_0012#0 / advance_contract_guarantee`, preserve exact grounding, and include neutral controls proving ordinary non-option evidence is unchanged. No new runtime execution or promotion should precede local RED/GREEN review of that narrow guard.
