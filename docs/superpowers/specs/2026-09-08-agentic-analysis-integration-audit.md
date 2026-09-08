# Agentic Analysis Integration Audit — Stages 3–5

**Date:** 2026-09-08

**Status:** read-only architecture audit complete; implementation has not started

**Scope:** prepare a complete procurement document package, run one isolated Codex agent over the whole package, validate and persist exactly 27 shadow results without replacing the current production analysis path.

## 1. Executive conclusion

The correct insertion point is the committed document manifest, after every source attachment and extracted archive member has been registered and before any analysis result is considered final.

```text
TenderPlan mark
→ Intake Resume
→ Orchestrator
→ FullInfo + complete document preparation
→ atomic registration of the complete manifest
                    |
                    +→ current Document Worker → Aggregator → Finalization → report
                    |
                    `→ new Agentic Dispatch → isolated Codex runner → deterministic validation
                                                → shadow 27-field results
```

The current Document Worker, Aggregator, Targeted Recheck, Finalization and Report Generation must not be deleted or rewritten for stages 3–5. They remain the canonical path while the new contour is tested in shadow mode.

Codex must not run inside an n8n `Execute Command` node. It needs a separate internal runner service with its own job workspace and an asynchronous API. n8n remains the orchestrator and PostgreSQL remains the durable state and synchronization layer.

## 2. Sources examined

The audit followed the repository source-of-truth order and compared:

- `README.md`, `ARCHITECTURE.md`, `PROJECT_STATUS.md`, `TECH_DEBT.md`;
- `DATA_MODEL.md`, `FIELD_CATALOG.md`, `REPORT_FIELD_MAPPING.md`;
- current workflow exports and workflow documentation for Intake, Orchestrator, Document Worker, Aggregator, Targeted Recheck, Finalization and Report Generation;
- the current superseding intake tip at commit `2701bc81de1fdb48a61ad9c512aa5b39f3676f76` (supersedes the earlier sibling tip `cec69c0`);
- the archive-ingestion branch at commit `f596755`;
- read-only live n8n workflow metadata and graphs;
- the four-run blind-test archive in `evaluations/codex-agentic-blind-test-2026-09-08`;
- local official n8n documentation for Execute Command, queue mode and filesystem/binary behavior;
- official Codex documentation for non-interactive execution, structured output, sandboxing, authentication and repository skills.

No production workflow, PostgreSQL data, credential or external state was changed during the audit.

## 3. Current system relevant to stages 3–5

### 3.1. TenderPlan entry and recovery

The latest repository candidate polls the current members of TenderPlan mark `6a732cd00c61629cf1d3c144` every ten minutes and passes a stable mark+tender key to `TENDER — Intake Resume`.

`TENDER — Intake Resume` owns durable event deduplication, run reuse, stale-execution inspection, bounded Worker retry, readiness, Aggregator and Finalization recovery. It is the correct recovery owner for the future agentic job as well.

The intake migration is still unapplied in live PostgreSQL according to execution `14685`. The live run-status CHECK still contains only:

```text
created / processing / ready_for_aggregation / aggregating / completed / failed
```

The repository candidate adds `superseded`, its audit columns and the intake ledger, but production promotion is pending.

### 3.2. Orchestrator and document registration

The latest intake branch Orchestrator currently:

```text
tender_id
→ TenderPlan FullInfo
→ normalize card and attachments
→ create analysis_run and register source attachments in one SQL operation
→ start one Worker per supported document
```

Its current export still filters only `pdf`, `docx` and `xlsx` after registration. This is not yet the final archive-aware path.

The archive-ingestion branch already implements and deploys most of the missing preparation layer:

- internal `tender-archive-extractor` service is deployed and health-checked;
- direct ZIP and nested ZIP→7Z canaries are GREEN;
- inactive workflow `TENDER — Подготовить документацию` (`0scTZu1aBKsMd6AM`) builds `tender_document_ingestion_v1`;
- direct PDF/DOCX/XLSX pass through without an early binary download;
- archive members receive stable internal URLs and hashes;
- unsupported files and archive containers become audited `skipped` records;
- an additive `ingestion_metadata` migration exists;
- the workflow is not wired to the Orchestrator and the migration is not confirmed as applied.

This existing preparation contour should be integrated first and reused. A second archive downloader or unpacker must not be added to the agentic contour.

### 3.3. Current legacy analysis

The current Document Worker performs per-document parsing, unit creation, Extractor, deterministic evidence checks, independent Validator and fact persistence. Aggregator then groups facts into exactly 27 fields and Targeted Recheck performs field-specific terminal handling.

This path has extensive audit history and regression coverage, but its semantic hardening is unfinished. It remains valuable as:

- the production fallback;
- the comparison baseline for shadow evaluation;
- a source of proven field-specific safety rules;
- an independent signal when legacy and agentic results disagree.

It should not be called from the new agentic runner and the runner should not read its generated facts or FINAL results. The blind comparison must remain independent.

### 3.4. Finalization and report

The canonical final table is `tender_analysis_field_results`, keyed by `analysis_run_id + field_key`. Finalization completes a run only after a DB-backed exact 27/27 barrier. Report Generation reads that canonical table and does not reinterpret documents.

Live Report Generation has 12 nodes and returns both HTML and PDF. The agentic worktree copy has only the older 9-node HTML graph. The main branch/live export is authoritative for future integration.

Stages 3–5 must not write shadow agentic results into `tender_analysis_field_results`, because that would allow an unproven contour to satisfy production Finalization and overwrite or race the legacy FINAL rows. Shadow results need separate tables.

## 4. Existing artifacts to reuse

| Existing artifact | Decision |
|---|---|
| `TENDER — TenderPlan Mark Intake` | Keep unchanged; it remains only the entry adapter. |
| `TENDER — Intake Resume` | Extend later with idempotent agentic recovery/dispatch, after intake reconciliation. |
| `ТЕНДЕРЫ ОРКЕСТРАТОР` | Add one post-registration shadow dispatch point after archive-aware registration is complete. |
| `TENDER — Подготовить документацию` | Reuse as the only archive/full-manifest preparation layer. |
| `tender-archive-extractor` | Reuse; do not duplicate archive handling in the Codex runner. |
| Document Worker | No semantic change in stages 3–5. |
| Aggregator | No change in stages 3–5. |
| Targeted Recheck | No change in stages 3–5. |
| Finalization | No change in shadow mode. |
| Report Generation | No change in shadow mode; use only after later promotion to the canonical FINAL contract. |
| `FIELD_CATALOG.md` | Copy a hashed snapshot into each job; remains authoritative for all 27 meanings. |
| Blind-test archive | Use as the first repeatability and regression corpus; it is not itself a gold standard. |

## 5. New components required

### 5.1. Internal Codex runner

A separate non-public Docker service will:

1. receive documents from n8n one at a time;
2. verify SHA-256 and seal an immutable input manifest;
3. build mechanical text/OOXML/page-image indexes for navigation and evidence checks;
4. create one isolated job folder per procurement analysis;
5. run one non-interactive Codex process;
6. capture JSONL events and token usage;
7. validate the final JSON deterministically;
8. expose job status and validated artifacts to n8n.

The service will have no public host port and no PostgreSQL or TenderPlan credentials. n8n uploads bytes to it over the internal Docker network.

### 5.2. New n8n workflows

- `TENDER — Агентский анализ — Запуск`: claim a job, stage every processable document, seal the manifest and start Codex asynchronously.
- `TENDER — Агентский анализ — Монитор`: poll running jobs, ingest validated output and atomically persist 27 shadow fields.
- `TENDER — Ошибка агентского анализа`: release or fail exact owned jobs without losing audit data.

### 5.3. New shadow persistence

- `tender_agentic_jobs`: one durable job and its configuration, lifecycle, usage and artifact metadata.
- `tender_agentic_documents`: one staged source file per job with source document ID, hash, size and staging status.
- `tender_agentic_field_results`: exact 27 raw/effective results per job.

The three tables are additive. Existing five analysis tables and their contracts remain unchanged in shadow mode.

## 6. Why a sidecar instead of running Codex inside n8n

Official n8n behavior makes an in-process command unsuitable here:

- Execute Command is disabled by default in n8n 2.0 and carries significant security risk;
- in queue mode it runs on whichever worker owns the execution, while manual runs can execute on the main instance;
- filesystem paths inside Docker refer to that container, not automatically to the host or another worker;
- a multi-minute or multi-hour Codex process would hold an n8n execution and couple agent lifecycle to n8n worker lifecycle.

The already accepted archive-extractor architecture establishes the same project precedent: heavy stateful file work belongs in an isolated internal service, while n8n controls durable business state.

## 7. Codex execution boundary

The initial agentic baseline must match the blind test as closely as possible:

```text
one agent
model = gpt-5.6-sol
reasoning effort = high
no subagents
no web search
no user configuration or user skills
one dedicated tender-analysis skill
structured JSON output
```

The runner will use `codex exec` with:

- `--ephemeral` so Codex rollout files are not retained outside the job audit artifacts;
- `--ignore-user-config` and `--ignore-rules` for isolation from the owner's normal setup;
- `--sandbox workspace-write` with command-network access disabled;
- `--output-schema` for the final response contract;
- `--json` for event and token audit;
- `-o` for the final result artifact.

Development repeatability runs may use the same saved ChatGPT login as the blind test on a trusted local runner. The unattended server path should use a project-scoped API credential and standard API billing. These are different billing/limit regimes and must not be conflated. The server credential is available only to the Codex process and is filtered out of tool subprocess environments.

## 8. Deterministic validation boundary

The validator can prove structure and source correspondence; it cannot prove by itself that an agent understood every business nuance. Its role is to reject or downgrade unsafe outputs, never to invent or promote a value.

Hard job-level failures:

- final JSON does not conform to schema;
- the exact 27-key catalog set is missing, duplicated or reordered incompatibly;
- a source file identity is unknown;
- the input manifest or catalog hash changed during the run.

Field-level downgrade to `requires_review`:

- `resolved` has no usable evidence;
- an evidence fragment cannot be found at the declared source location;
- the agent reports a material unresolved conflict but still returns `resolved`;
- a negative conclusion is based only on absence;
- `not_found` is returned while any document/page/structural inspection is incomplete;
- a completeness-critical field lacks the field-specific completeness proof required by `FIELD_CATALOG.md`;
- numeric/date claims contradict their verified evidence.

Harmless presentation differences are not failures. Unicode, whitespace, punctuation and equivalent date formatting are normalized. An ellipsized citation is accepted as ordered verified fragments within the same source location when every supplied fragment exists and the omitted interval does not hide conflicting material tokens. The raw quote remains preserved in audit.

The persisted result keeps both:

```text
reported_status / reported_value
effective_status / effective_value
validation issues and downgrade reason
```

The validator may keep a value as provisional while downgrading the status. It may never change `not_found` into a negative fact or upgrade any field to `resolved`.

## 9. Reconciliation blockers found

Implementation must not begin by merging the current branches blindly.

1. `codex/agentic-analysis-mvp` is based on `26e8906` plus the blind-test archive, while the intake branch now has the superseding `2701bc81de1fdb48a61ad9c512aa5b39f3676f76` change; it supersedes the earlier sibling tip `cec69c0` rather than erasing that historical checkpoint.
2. `codex/archive-ingestion` is based on main and contains the deployed archive service and inactive preparation workflow, but not the latest intake work.
3. The intake migration remains unapplied in live PostgreSQL.
4. The archive `ingestion_metadata` migration and Orchestrator wiring are not production-complete.
5. Live Orchestrator, repository Orchestrator and their Worker targets differ.
6. Two plausible active Worker workflows route to different Aggregators; one route still points at an inactive legacy Aggregator.
7. The active Aggregator routes Targeted Recheck through an historically test-named workflow ID. This topology must be intentionally accepted or corrected before production promotion.
8. The agentic worktree Report export is stale relative to main/live PDF generation.

These conflicts do not block isolated runner, schema, validator and evaluation work. They block only final n8n wiring and production activation.

## 10. Scope boundary after stages 3–5

The result of this plan is a shadow system that can repeatedly produce and store a validated 27-field agentic result for the same registered document set.

It does not yet:

- replace the legacy Worker/Aggregator path;
- write agentic fields into canonical `tender_analysis_field_results`;
- complete `analysis_run.status` from the agentic path;
- send a client report automatically;
- add a second AI reviewer or subagents;
- remove any existing workflow, prompt, fact or audit table.

Promotion comes only after an adjudicated evaluation gate. At that later step an explicit `analysis_mode` router can select `legacy`, `shadow` or `agentic`, and a validated agentic result can be materialized into the existing `tender_field_final_v1` contract. Finalization and Report Generation can then be reused instead of rebuilt.
