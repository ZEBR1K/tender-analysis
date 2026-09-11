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

## Local document-toolkit RED/GREEN — 2026-09-11

This check covers local skill behavior and helper contracts only. It is not a
paid Codex blind run, container smoke, or production deployment result.

The RED reviewer used the previous skill against a pressure scenario with a
100-page mixed PDF, a scan-only candidate on page 43, and an ambiguous DOCX
checkbox. The agent had to invent text extraction, page rendering, OCR loops,
and OOXML access. The likely path could render and OCR all 100 pages, offered no
reproducible fallback after a text miss, and did not clearly separate OCR
navigation from visual confirmation.

The GREEN reviewer read the updated `AGENTS.md`, skill, recipes, and helpers and
confirmed:

- no mandatory full-document index or conversion;
- PDF rendering is one explicit range of at most 20 pages;
- OCR runs on one selected image and is navigation only;
- text/OCR misses do not prove absence;
- relevant OCR candidates are confirmed visually;
- OOXML access lists entries or extracts one exact part without interpreting a
  field or control state;
- a material render/OOXML mismatch remains `requires_review`;
- derived artifacts are never promoted to manifest evidence.

The focused local suites finished with `28 pass / 0 fail / 1 Windows-only
skip`. The complete `tests/agentic-*.test.mjs` suite finished with `207 pass /
0 fail / 6 environment-specific skips`. The installed skill validator printed
`Skill is valid!` via an ephemeral `uv run --with pyyaml` environment.

A separate code-safety review reproduced path escape through a workspace
junction, unbounded generated artifacts, incomplete PDF-range acceptance, and
missing subprocess timeouts in the first GREEN implementation. The helpers now
resolve canonical job roots, reject symlink/junction escape, limit individual
and total derived output, fail on a partial page range, and terminate timed-out
process trees. These checks protect job boundaries and file integrity; they do
not score document meaning or evidence quality.

A local real-binary smoke rendered page 1 of the archived `РАСЧЕТ_НМЦ.pdf` at
96 DPI through `pdftoppm`, returned an exact page-to-PNG mapping, and removed
the derived smoke directory through the guarded cleanup helper. The remaining
external binaries were not available on this Windows host and are still part
of the later container smoke.

Runtime caveat: `ooxml-part.mjs` deliberately depends on the system `unzip`
binary, which the current runner image does not yet install. The local
instruction and unit contract are GREEN, but executable OOXML support remains
unverified until the separate image/staging phase adds the dependency and runs
a real container smoke. Current `stageAgentTemplate` also still copies only
`AGENTS.md` and `SKILL.md`, so none of the new helper resources reach a live job
in this local-only phase.
