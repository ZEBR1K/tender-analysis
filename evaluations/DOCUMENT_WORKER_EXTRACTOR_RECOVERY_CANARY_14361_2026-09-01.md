# Document Worker corrected pinned-claim canary 14361

Date: 2026-09-01

Workflow: isolated test Worker `pDTFwbq6B19qNAVI`

Result: `BLOCKED_BEFORE_PARSER_AND_AI`

## Pre-run gate

Source draft: `3016111f-5782-4984-8cc6-738351c211c5`.

The preserved PIN contract was read before mutation:

- pin-data SHA-256: `a851048395c4925dbe9397e191751bc8e928c8f68929a960c56dc3a610a09769`;
- exact key `Захватить документ в обработку` present;
- pinned claim item count: `1`.

Official local n8n documentation states that manual executions substitute an executed pinned node with its saved output instead of executing its external operation. The corrected temporary contour therefore connected the Webhook directly to the pinned claim node, making it an executed ancestor for downstream `.item` pairing.

The atomic temporary draft `c5fef07d-2fd7-4a17-bfe2-c425a1650d3d` had:

- `74` nodes and `69` connection sources;
- exactly three temporary `[CANARY]` nodes;
- `57` nodes reachable from the temporary trigger;
- only the pinned claim reachable among PostgreSQL nodes;
- no path to analysis-unit persistence, collector, Validator dispatch, fact/document persistence, readiness check, or Aggregator;
- recovery barrier routed only to a bounded summary terminal.

The maximum paid-call bound remained `<=48`: `16` primary Extractor calls, at most `16` fallback calls, and at most `16` mutually exclusive Evidence Repair or Lossless Fact Partition calls. AI Validator was unreachable.

## Runtime result

Exactly one manual execution was started: `14361`.

The corrected claim ancestry worked:

- execution mode was `manual`;
- execution `pinData` contained the claim node;
- claim output item count was `1`;
- claim output JSON exactly matched preserved pin JSON;
- pin/output JSON SHA-256 was `a82201da19a18b99c4751a725ca5f87bad83501fd800df2d43bcd6bc05df1509`;
- the claim output retained its saved execution identity instead of the canary execution ID;
- downstream `Связать метаданные и файл` completed successfully.

This is the documented pin-substitution path: the Postgres-type node appears in runData as an executed ancestor, but its saved output is substituted and its external query is not performed.

The first incorrect node was `Подготовить DOCX archive alias`:

```text
mode = runOnceForEachItem
line 1 = const item = $input.first();
error = Can't use .first() here; it is only available in Run Once for All Items mode
```

The workflow stopped before parser and AI. Exact selected-node runData showed:

- executed PostgreSQL-type nodes: pinned claim only;
- executed non-pinned PostgreSQL nodes: `0`;
- executed AI nodes: `0`;
- paid model calls: `0`;
- database writes: `0`.

No primary decisions, fallback calls, strict-validator outcomes, recovery attempt audits, Loop completion, barrier output, or guarded-field results were produced. This is a runtime contract failure in the local candidate Code node, not a recovery GREEN result.

No live patch or second execution was attempted.

## Restoration proof

The temporary draft was restored from `3016111f-5782-4984-8cc6-738351c211c5` to new draft version `b8a06968-b2e3-48cc-884e-2db4360e51c3`.

Read-back proved:

- source/restored nodes: exact equal;
- source/restored connections: exact equal;
- source/restored node groups: exact equal;
- `71` nodes and `68` connection sources;
- no `[CANARY]` nodes;
- preserved pin-data SHA-256 unchanged;
- credentials unchanged;
- published version remained `a7d04a95-a7d4-4098-aaa9-4a5955920f7b`.

The next runtime attempt requires a separate execution-derived TDD fix for the Code-node mode/input API mismatch. This artifact intentionally omits client text, filenames, source URLs, document/run UUIDs, provider responses, chain-of-thought, and credentials.
