# DW-23 AI Validator selective retry design

## Problem

Execution `14491` reached `Проверить ответ AI Validator` with 22 unit responses. One response for `doc_7_au_0037` contained two validations: `fact_index=0` was valid, while `fact_index=1` (`licenses_certificates`) omitted mandatory `confidence`. The strict checker correctly failed closed, but the document lost all otherwise valid Validator work and never reached fact persistence or document completion.

## Required outcome

One contract-invalid Validator fact must not fail the document. Only the invalid fact is retried, identified by `analysis_unit_id + fact_index` with an exact `field_key` guard. Valid facts and valid units are never sent again. The primary `AI Validator v1` node remains outside the retry path.

The logical attempt budget is fixed at three calls per fact: one primary call plus at most two selective retry calls. Semantic verdicts (`confirmed`, `requires_review`, `rejected`) are terminal and are not retried.

## Workflow boundary

The change is local to the Document Worker between `AI Validator v1` and the existing strict `Проверить ответ AI Validator` node:

```text
AI Validator v1
→ classify primary responses
→ accepted facts remain buffered
→ contract-invalid facts only
→ Loop Over Items (batch 1)
   → retry attempt 2
   → if still invalid, retry attempt 3
   → if still invalid, deterministic technical fallback
→ reassemble one complete ai_validator_v1 response per original unit
→ Проверить ответ AI Validator
→ unchanged persistence/completion path
```

The loop iterates only the finite retry queue. It does not loop the primary Validator and does not reset itself. Two explicit retry stages make the three-attempt limit structural rather than state-dependent.

## Classification contract

The primary classifier validates source invariants before considering a model response recoverable. Missing/duplicate source unit identities, missing/duplicate source fact indexes, and a source `field_key` mismatch remain hard failures.

The following response failures are retryable:

- transport error;
- missing or invalid JSON content;
- invalid root/schema/unit identity;
- missing, duplicate, or unknown validation identity;
- `field_key` mismatch;
- invalid verdict, confidence, reason code, or reason note contract.

If the unit response cannot be safely parsed or attached, every fact in that unit enters the retry queue. If the root is attachable, valid sibling validations remain accepted and only invalid/missing facts enter the queue.

Each retry request contains exactly one original verified fact and only that field's Validator profile. It carries explicit `analysis_unit_id`, `fact_index`, `field_key`, attempt number, and the original source envelope; positional item order is not an identity contract.

## Exhaustion fallback

After retry attempt 3 remains contract-invalid, the workflow creates a deterministic result for that original fact:

- `verdict = requires_review`;
- `confidence = 0` as a system sentinel required by the current NOT NULL DB contract, not as model confidence;
- `reason_code = other`;
- `reason_note` states that the AI Validator contract failed after three attempts and manual review is required;
- original `value_text` and exact-grounded evidence remain unchanged.

Audit metadata records:

- `origin = deterministic_technical_fallback`;
- `version = ai_validator_retry_fallback_v1`;
- `confidence_origin = system_sentinel`;
- `reported_ai_confidence = null`;
- `contract_validated = false`;
- `retry_exhausted = true`;
- `attempt_count = 3`;
- final failure code;
- `analysis_unit_id`, `fact_index`, and `field_key`.

The fallback is not `not_found`, does not fabricate evidence, and cannot upgrade an existing review-only/rejected deterministic restriction. The existing final checker remains strict and outside the retry branch. Reassembly supplies a schema-valid terminal response while separately carrying the fallback provenance into persisted `validator_meta` so the technical result is not represented as model-authored confidence.

## Audit and transport

For every retried fact, retain bounded attempt audit: attempt number, outcome (`accepted`, `contract_invalid`, `transport_error`, or `technical_fallback`), failure code, and provider response/error where available. Existing credentials, models, prompt contract, fact semantics, evidence guards, DB schema, and downstream completion logic remain unchanged.

Provider-node automatic retry is disabled on the primary and retry nodes so the explicit three-attempt budget is exact and transport/contract failures share one audit path. Provider errors continue through the classifier instead of aborting the whole execution.

## Regression gates

An execution-`14491`-derived sanitized fixture must prove:

1. 22 primary unit responses are classified without resending valid units;
2. only `doc_7_au_0037#1 / licenses_certificates` is retried;
3. sibling `doc_7_au_0037#0 / application_documents` remains byte-equivalent and is never retried;
4. a valid second/third response is reassembled and passes the existing strict checker;
5. repeated missing `confidence` produces the audited deterministic fallback after exactly three total attempts;
6. the fallback preserves original fact/evidence and reaches document fact collection;
7. duplicate/unknown/mismatched identities and source invariant failures remain fail-closed;
8. no production workflow, credential, DB state, or 27-field semantics are changed.
