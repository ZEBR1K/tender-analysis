# Document Worker Extractor recovery canary 14360

Date: 2026-09-01

Workflow: isolated test Worker `pDTFwbq6B19qNAVI`

Result: `BLOCKED_BEFORE_AI`

## Scope and safety gate

The approved draft snapshot was `a9e13672-78fe-4570-8f92-aabeeb5f97be`. A temporary manual-only trigger reused preserved PIN data and routed the recovery completeness barrier to a bounded summary terminal. The workflow was not published, activated, deactivated, or connected to production persistence.

Static reachability from the temporary trigger proved:

- `57` reachable nodes;
- zero reachable PostgreSQL nodes;
- no path to analysis-unit persistence, collector, Validator dispatch, fact persistence, document completion, readiness check, or Aggregator;
- barrier output connected only to the temporary summary terminal.

The pre-run paid-call bound was `<=48`: `16` primary Extractor calls, at most `16` fallback calls, and at most `16` mutually exclusive Evidence Repair or Lossless Fact Partition calls. AI Validator was unreachable.

## Runtime result

Exactly one manual execution was started: `14360`.

The temporary trigger, preserved PIN snapshot loader, claim guard, and file download completed. The first incorrect node was `Связать метаданные и файл`. Its existing expression referenced:

```text
$('Захватить документ в обработку').item.json
```

The referenced claim node supplied pinned data but was not an executed ancestor of the temporary trigger path. n8n attempted paired-item reconstruction and stopped in `workflow-data-proxy getPairedItem` before parsing or any AI node.

Exact selected-node runData inspection showed:

- AI nodes executed: `0`;
- PostgreSQL nodes executed: `0`;
- paid model calls: `0`;
- database writes: `0`.

No primary GLM decisions, Gemini fallback calls, strict-validator outcomes, attempt audits, recovery barrier output, or guarded-field results were produced. Therefore this execution is diagnostic evidence only and does not make Stage 2 runtime GREEN.

## Failure classification

The failure is a canary-harness item-linking defect: `.item` requires valid paired-item ancestry and cannot use a pinned-but-unexecuted claim node as though it were an executed ancestor. It is not evidence for or against the local Extractor fallback behavior.

No live patch or second execution was attempted. A future canary requires a separately reviewed/TDD explicit source-carry contour before another paid run.

## Restoration proof

The temporary draft was restored from `a9e13672-78fe-4570-8f92-aabeeb5f97be` to new draft version `3016111f-5782-4984-8cc6-738351c211c5`.

Read-back proved:

- source/restored nodes: exact equal;
- source/restored connections: exact equal;
- source/restored node groups: exact equal;
- `71` nodes and `68` connection sources;
- no `[CANARY]` nodes;
- preserved pin-data SHA-256: `a851048395c4925dbe9397e191751bc8e928c8f68929a960c56dc3a610a09769`;
- credentials unchanged;
- published version remained `a7d04a95-a7d4-4098-aaa9-4a5955920f7b`.

This artifact intentionally omits client text, filenames, source URLs, document/run UUIDs, provider responses, chain-of-thought, and credentials.
