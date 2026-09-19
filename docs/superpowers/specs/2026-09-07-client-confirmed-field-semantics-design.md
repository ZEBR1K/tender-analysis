# Client Confirmed Field Semantics Design

**Date:** 2026-09-07

**Status:** Approved business decisions recorded; runtime implementation pending

## Purpose

Record Dmitry's answers about the 27 report fields as the business contract for
`tender_fields_v1`, without changing the number of fields, their `field_key`
values, PostgreSQL schema or `tender_field_final_v1`.

The client DOCX is not copied into the repository. `FIELD_CATALOG.md` contains
the normalized decisions and remains the human-readable semantic source of
truth.

## Confirmed decisions that change runtime behavior

| field_key | Confirmed behavior |
|---|---|
| `application_review_date` | For a period, present its terminal date. |
| `results_date` | Preserve all confirmed winner-selection events. |
| `customer` | Use the legal entity that concludes the contract, not a non-contracting organizer. |
| `customer_contacts` | Distinguish procurement and technical contacts when both are present. |
| `participation_guarantee` | Include any bid security and preserve form, amount and terms. |
| `delivery_term` | Use the general contract-performance term only when a direct delivery/work/service term is absent, and label the fallback honestly. |
| `government_contract` | Cover state contract, municipal contract, GOZ and a contract performed under those contracts. |
| `national_regime` | Client value is `Запрет`, `Ограничение`, `Преимущество` or `Не применяется`; the last value requires direct proof. |
| `advance_contract_guarantee` | Describe contract-performance security and advance-related security separately inside the existing field. |
| `warranty_obligations_guarantee` | Include any allowed form of warranty-obligation security. |
| `licenses_certificates` | Include only documents explicitly called a licence or certificate. |
| `required_official_certificates` | Keep official authority/registry certificates and extracts separate from licences/certificates. |
| `similar_supply_experience` | Include mandatory and scored experience and label which is which. |

## Confirmed presentation behavior

- show the procurement/notice number in report metadata, not as a 28th field and
  not inside `platform`;
- present NMC and VAT separately;
- show evaluation criteria as a concise list;
- show payment terms as structured advance/balance plus the full confirmed text;
- show special account/treasury as yes/no plus type;
- show rebidding as yes/no without conditions;
- omit the national-regime legal basis from the client table while retaining it
  in evidence/audit;
- show a concise analog definition;
- show a concise application-document list only after complete semantic
  retrieval; presentation brevity must not weaken completeness guards.

## Safety invariants

1. `not_found` is unknown after full analysis, not a negative answer.
2. `Не применяется`, `Нет` and equivalent negative values require direct
   evidence; absence is not proof.
3. A report formatter may shorten confirmed content but may not change status,
   invent facts or discard material conditional clauses.
4. Narrowing `licenses_certificates` must not lose declarations, permits or
   other mandatory application documents; they remain eligible for
   `application_documents` where applicable.
5. The existing four-key Targeted Recheck Round 2 allow-list remains in force.
   Client confirmation does not authorize the generic Round 2 resolver for the
   other fields.
6. Existing containment for `participation_guarantee` and
   `required_official_certificates` remains until deterministic completeness is
   proven by regression and runtime evidence.

## Separate unresolved implementation questions

- `participation_cost` needs a reliable, temporally valid platform-tariff source
  and a deterministic link between a tariff and a procurement. This is a
  separate integration design, not a prompt-only change.
- The rare case of multiple legal entities concluding separate contracts has no
  confirmed presentation policy. It must fail safely to `requires_review`
  rather than silently choosing one.
- Dmitry may later provide an exhaustive list of official certificates. Current
  examples are search guidance, not a closed allow-list.

## Acceptance boundary

Documentation is complete when `FIELD_CATALOG.md`, `REPORT_FIELD_MAPPING.md`,
`PROJECT_STATUS.md`, `TECH_DEBT.md` and `DEVELOPMENT_LOG.md` identify the same
client decision date and clearly distinguish target semantics from current
runtime behavior.

Runtime implementation is complete only after the canonical Worker,
Aggregator, Targeted Recheck and Report Generation exports are aligned, focused
regressions pass, the full offline suite has no new failures, and a fresh test
run reaches 27/27 with manual semantic review.
