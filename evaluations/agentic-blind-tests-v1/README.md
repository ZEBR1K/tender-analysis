# Agentic blind skill gate v1

This directory defines an offline, skill-first evaluation gate. It does not block
a structurally valid runner result and it does not authorize semantic
runtime validation.

Only one real procurement is currently available in the repository. Its four
blind runs are useful as provisional repeatability evidence, but they are not
cross-procurement evidence and are not a source-grounded gold set. Do not
fabricate another procurement or promote a one-case observation into code.

## Admission sequence

1. Add sanitized immutable originals from at least one genuinely different
   procurement and record their hashes without parsed or indexed derivatives.
2. Run the same model, reasoning effort, prompt, skill, schema and original
   hashes repeatedly for every case.
3. Record the agent-reported inspected documents, parts, methods, limitations
   and constraints as audit statements, not as mechanically proven coverage.
4. When Codex can recognize an analysis error while reading the originals,
   revise the short skill first and rerun every case.
5. Consider a programmatic rule only if the failure recurs across distinct
   procurements, survives skill-only remediation, does not duplicate Codex
   reasoning, and protects security, file integrity or the JSON contract.

Semantic comparisons produced by the evaluator remain diagnostic offline
material. They never rewrite or reject a runner result.

## External multi-procurement batch harness

`scripts/run-agentic-shadow-batch.mjs` stages direct PDF, DOCX and XLSX
originals through the existing runner API one file and one replicate at a time.
It does not extract text, enumerate pages, inspect OOXML or add semantic checks.
The source folders, runner job store, auth-token file and output root must remain
outside this repository.

The external config has this shape:

```json
{
  "schema_version": "agentic_shadow_batch_v1",
  "batch_id": "shadow-baseline-v1",
  "controls": {
    "model": "gpt-5.6-sol",
    "reasoning_effort": "high",
    "codex_cli_version": "0.153.4",
    "field_catalog_path": "<path to the runner catalog snapshot>",
    "prompt_path": "<path to the pinned prompt>",
    "skill_path": "<path to the pinned skill>",
    "result_schema_path": "<path to the pinned result schema>"
  },
  "cases": [
    {
      "case_id": "procurement-02",
      "procurement_key": "procurement-02",
      "source_root": "<external documents directory>",
      "replicates": 2,
      "adjudication": null
    },
    {
      "case_id": "procurement-03",
      "procurement_key": "procurement-03",
      "source_root": "<external documents directory>",
      "replicates": 2,
      "adjudication": null
    }
  ]
}
```

The declared model, effort and CLI version must exactly match the currently
pinned runner. This prevents an evaluation archive from claiming controls that
the runner did not use. The driver also requires `/health` to expose a
runner-owned `tender_codex_runner_execution_profile_v1` matching all four
pinned artifact hashes. The current repository runner does not expose that
profile yet, so a real batch deliberately stops with
`RUNNER_PROVENANCE_NOT_READY`; only the fake-server path is verified in Task
15. Run the batch only after that fail-closed Task 16 gate is implemented and
the Linux isolation canary passes:

```powershell
node scripts/run-agentic-shadow-batch.mjs `
  --config <external-config.json> `
  --output-root <external-evaluation-root> `
  --runner-url <internal-runner-url> `
  --runner-jobs-root <external-runner-jobs-root> `
  --auth-token-file <external-token-file>
```

Every terminal replicate keeps bounded API status, raw result and validation
envelope when completed, deterministic case/replicate identity, token usage,
an exact copy of the terminal runner job directory (including JSONL audit), and
a SHA-256 inventory. Failed replicates remain in `evaluation-index.json` and
are not silently omitted. Neither the auth token nor source paths are written
to batch metadata.

Evaluate a complete external root with:

```powershell
node scripts/evaluate-agentic-result.mjs <external-evaluation-root>
```

Each case may point to its own manual adjudication. A case with
`adjudication: null` receives structural diagnostics only; the evaluator never
substitutes `agentic-baseline-v0` as truth for a different procurement.

## Isolation gate

The batch harness does not activate execution isolation. `/start` remains
fail-closed with `RUNNER_ISOLATION_NOT_READY` until a real Linux container
canary proves the exact filesystem, auth, secret and process-environment
boundaries described in the runner README. A Windows or repository-only fake
test cannot prove that boundary, so no local bypass or configuration flag is
provided. That runtime canary remains part of Task 16, before any paid call.
