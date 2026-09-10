# Agentic shadow canary — 2026-09-10

## Outcome

The runner-direct Task 16 canary is GREEN for execution isolation, terminal
archive integrity and the JSON contract. Four blind runs completed: two
replicates each for `procurement-02` and `procurement-03`. Every result contains
exactly 27 unique `field_key` values and passed the independent offline
evaluator.

This is not a semantic-accuracy claim. Neither procurement has an
employee-authored gold report, so value differences are repeatability evidence
only. They do not block, rewrite or reject a structurally valid result.

The live n8n/DB canary portion of Task 16 remains closed. Three inactive live
workflow candidates exist, and PostgreSQL resolves three shadow relation names,
but the scoped read-only role cannot confirm their exact schema or row counts.
The required source-hash column is absent, and the execution-list endpoint
returned zero entries for each workflow. The legacy production pipeline was not
activated or modified.

## Fixed controls

All four runs used the same controls:

```text
model: gpt-5.6-sol
reasoning effort: high
Codex CLI: 0.153.4
replicates per procurement: 2
network inside the agent job: denied
```

The runner health profile bound the model, effort, CLI and SHA-256 hashes of the
catalog, prompt, skill and result schema. The batch driver rejected any control
drift before upload or paid execution.

## Structural and usage results

| Case | Replicate | Manifest docs reported inspected | Statuses R/RR/NF | Limitations | Constraints | Input | Cached input | Output | Reasoning output |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `procurement-02` | 1 | 5/5 | 17 / 2 / 8 | 0 | 3 | 2,739,048 | 2,627,072 | 35,814 | 6,877 |
| `procurement-02` | 2 | 5/5 | 14 / 6 / 7 | 0 | 2 | 1,940,942 | 1,829,248 | 33,521 | 6,600 |
| `procurement-03` | 1 | 6/6 | 18 / 0 / 9 | 2 | 2 | 2,836,551 | 2,626,816 | 26,579 | 5,104 |
| `procurement-03` | 2 | 6/6 | 18 / 0 / 9 | 2 | 2 | 2,876,361 | 2,760,448 | 29,709 | 4,334 |

Totals: 10,392,902 input tokens, of which 9,843,584 were reported cached;
125,623 output tokens and 22,915 reasoning-output tokens. Cached tokens are
reported separately for cost analysis but remain usage.

The final evaluator returned:

```text
ok=true
case_count=2
replicate_count=4
all_structural_pass=true
all_cases_adjudicated=false
```

`all_cases_adjudicated=false` is expected because no gold truth exists for
these cases.

## Repeatability review

An independent field-level comparison classified status and `value_text`
differences without reading the source documents and without choosing a winner.

| Case | Exact | Wording/format only | Substantive value difference | Status difference, same meaning | Indeterminate |
|---|---:|---:|---:|---:|---:|
| `procurement-02` | 5 | 15 | 3 | 4 | 0 |
| `procurement-03` | 5 | 15 | 7 | 0 | 0 |

For `procurement-02`, the substantive value differences were
`application_review_date`, `customer_contacts` and
`advance_contract_guarantee`. Status differed while the compared value was
semantically the same for `participation_guarantee`, `government_contract`,
`rebidding` and `required_official_certificates`.

For `procurement-03`, the substantive value differences were
`application_review_date`, `participation_guarantee`, `evaluation_criteria`,
`payment_terms`, `advance_contract_guarantee`, `licenses_certificates` and
`application_documents`.

These observations are insufficient to create a parser, validator,
field-specific rule or blocking semantic policy. The next accuracy step is
manual adjudication against originals, followed by a short skill revision and
another blind test only if a repeatable agent error is established.

## Fail-closed compatibility findings

Two preliminary batches stopped before model execution and consumed zero model
tokens:

1. Strict Structured Outputs rejected the first schema because `quote` was not
   required on every evidence object.
2. The second schema was rejected because properties using `const` did not also
   declare an explicit type.

The compatible schema keeps `quote` nullable, requires its JSON key, requires
evidence only for `resolved` and `requires_review`, and permits empty evidence
for `not_found`. Unsupported conditional composition was replaced with a closed
`anyOf`; no semantic validator was added.

Compatibility was checked against the official OpenAI Structured Outputs guide:
<https://developers.openai.com/api/docs/guides/structured-outputs>.

The first completed real job also exposed a safe internal relative symlink from
the workspace to an immutable input inside the same job. Archive collection
failed closed. The integrity boundary now preserves and inventories only
non-broken symlinks whose real target remains inside that exact job. Escape,
broken and special-file cases are rejected. Linux tests pass the complete
batch-to-evaluator path.

## Runtime boundary

The runner finished healthy with zero restarts. It remains non-root,
non-privileged, read-only, without published ports, with all capabilities
dropped and `no-new-privileges` retained. Its named AppArmor profile grants the
user-namespace operation needed by the Codex sandbox; Docker seccomp is
unconfined only for this container. The direct isolation attestation and
authenticated reachability from both n8n containers passed before the runs.

Existing n8n, worker, PostgreSQL, Redis, archive-extractor and Gotenberg
containers retained their observed start times and restart counts. The Task 16
watchdog recorded no pressure sample while the batch was active.

## Reconciled live state and gates not crossed

Fresh authoritative read-only checks superseded the preliminary claim that the
shadow objects were absent:

- PostgreSQL `to_regclass` resolves all three shadow relation names, but the
  scoped read-only role cannot confirm their exact schema or row counts;
- inactive Dispatch `d37251e524754e1f`, Monitor `47e6ede6c10349c0`, and Error
  `6ccedae778a14176` exist in live n8n;
- normalized graph read-back after masking instance workflow IDs and bound
  credential IDs matches the repository candidates, real error-workflow links
  are present, expected credential types are bound, and the execution-list
  endpoint returned zero entries for each workflow.

The server container `n8n-postgres-1` is n8n's internal database, not the
production tender database. A controlled execution of the existing shadow
migration there stopped at its first `LOCK` because
`public.tender_analysis_runs` is absent. Only `BEGIN`, `SET`, and `SET` ran; the
transaction aborted and created no DDL objects. The production tender database
is external Supabase and was accessible only through the scoped read-only role.

The production schema still lacks
`tender_analysis_documents.ingestion_metadata`. Because Dispatch requires the
verified `content_sha256` from that column, the following gates remain open:

- complete an authorized exact-schema preflight for the existing shadow
  relations;
- apply the additive `ingestion_metadata` prerequisite migration;
- prepare a dedicated canary source row with verified SHA-256 metadata;
- execute inactive Dispatch → Monitor → exact 27-row shadow persistence;
- independently read back the resulting shadow rows with an authorized
  least-privilege path;
- wire any agentic route into production intake.

Task 17 and production activation were not started.

## Raw evidence location

Raw client documents and full job audit archives stay outside Git at:

```text
F:\Vibe-projects\Tender-agentic-evals\agentic-shadow-v1\task16-server-results-2026-09-10
```

The directory contains both zero-token schema-failure batches, the four-run
successful batch, the final evaluator output and server-generated SHA-256
checksums. It contains no runner token, Codex credential or production secret.

## Verification

- Fresh full Windows suite: `747 tests / 741 passed / 0 failed / 6 explicit platform/runtime skips`.
- Targeted Linux `tests/agentic-shadow-batch.test.mjs`: `14/14 passed, 0 skipped`, including internal, escape, broken and special-target symlink cases and the offline evaluator path.
- `git diff --check`: clean.
