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
