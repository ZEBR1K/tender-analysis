# Tender document analysis skill pressure tests

Date: 2026-09-09
Mode: offline synthetic review plus the archived four-run baseline
External paid Codex calls: none
Runtime blocking: no

## RED baseline without the dedicated skill

The four archived runs already produced 27 fields each, so the skill does not
add field-specific extraction rules. The reusable gaps were:

- results did not use the structured `inspected_documents` audit;
- some `not_found` fields carried nearby but irrelevant citations;
- a disclosed cross-document conflict could still be marked `resolved`;
- a pressure scenario preserved both conflict sources but used free
  `document`/`section` properties instead of manifest `artifact_key` and
  contract `locator`.

The archived runs also show agents building broad document conversion helpers.
That observation does not justify a runner parser; the skill now says to choose
the useful inspection method per document without a mechanical coverage count.

## GREEN pressure test with the dedicated skill

The following scenarios define the pressure matrix. Only the conflict row has
versioned raw paired outputs; the other rows remain planned checks and must not
be treated as execution evidence:

| Case | Expected behavior | Result |
|---|---|---|
| Only two fields found | Return 27 unique keys; remaining values are `not_found` without invented evidence | PLANNED |
| Conflicting A/B sources | Keep `requires_review` with both manifest artifact keys and locators | PASS |
| Old template demands a citation for absence | Keep `not_found` with null value and empty evidence | PLANNED |
| Encrypted XLSX | Record the open attempt and limitation without claiming sheet inspection | PLANNED |
| Demand to pre-index every page/part | Choose document-specific methods and create no mechanical index | PLANNED |

The exact paired conflict scenario and both raw answers are preserved under
[`paired-conflict`](./paired-conflict/). Without the skill, the agent correctly
kept the conflict open but returned the legacy `document`/`section` evidence
shape. With the skill, it kept `requires_review`, used manifest
`artifact_key` plus nonblank `locator`, and produced the required inspection
audit. The comparison is contract-only; it does not score the meaning or
sufficiency of evidence. It is a focused field-fragment check, not a complete
27-field `tender_agent_result_v1` conformance run.

The skill also passed the repository contract tests. `quick_validate.py` from
the installed `skill-creator` package printed `Skill is valid!` when run with a
temporary PyYAML dependency directory; this is development evidence, not a
runtime dependency of the runner. The current real corpus still contains one procurement only. This
GREEN result validates prompt behavior, not cross-procurement semantic
accuracy; the nonblocking gate in `evaluations/agentic-blind-tests-v1` remains
`awaiting_additional_procurements`.
