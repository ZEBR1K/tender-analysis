# AGENTS.md project file index — design

**Date:** 2026-08-30
**Scope:** documentation-only change to repository onboarding instructions

## Goal

Make `AGENTS.md` a reliable entry point for a new Codex task by showing where each class of project artifact lives and which file answers which question.

The index must complement, not duplicate, `README.md`, `PROJECT_STATUS.md`, and `ARCHITECTURE.md`.

## Current gap

`AGENTS.md` already routes several component-specific tasks to workflow documentation and canonical exports. It does not provide a complete map for:

- current operational status;
- tests, fixtures, helpers, and runtime evaluators;
- beta workflow exports;
- prompts and model evaluations;
- report-generation artifacts;
- external reference documents.

Its hard-coded milestone section is also stale: it still identifies `AG-0` as current even though the live project status has moved to `TR-10`.

## Chosen design

Add a compact `Project file index` near the beginning of `AGENTS.md`, before the task-specific reading rules.

The index will group paths by purpose:

1. onboarding and current state;
2. architecture, semantics, and physical data model;
3. workflow documentation;
4. canonical workflow exports;
5. beta/test workflow exports;
6. tests, fixtures, helpers, and runtime evaluators;
7. prompts and evaluation reports;
8. report-generation design artifacts;
9. external client/reference documents.

Each entry will explain what the path contains and when it should be read. Patterns such as `tests/fixtures/**` will be used instead of enumerating every fixture.

## State and source rules

- `PROJECT_STATUS.md` is the short current checkpoint.
- `TECH_DEBT.md` is the prioritized backlog.
- `DEVELOPMENT_LOG.md` is historical and must not override newer sources.
- `workflows/n8n-exports/*.json` is the last repository snapshot, not automatically the current live production state.
- `workflows/n8n-exports/beta/*.json` contains isolated test/calibration artifacts and must not be treated as production candidates without an explicit packaging/promotion decision.
- When live n8n or live PostgreSQL is checked and differs from repository files, the conflict must be reported explicitly under the existing Source of Truth rules.

## Milestone handling

Replace the stale hard-coded `AG-0` milestone section with a durable rule:

```text
Current milestone and next single step
→ PROJECT_STATUS.md

Prioritized unresolved risks
→ TECH_DEBT.md
```

`AGENTS.md` must not duplicate a changing ticket ID as the permanent current milestone.

## Maintenance rule

Update the index when:

- a new top-level documentation category is introduced;
- a new production workflow or workflow documentation file is added;
- a new artifact class or directory is introduced.

Do not update the index for every new fixture, test case, evaluation run, or dated log entry when its directory pattern is already covered.

## Out of scope

- no workflow JSON changes;
- no production or MCP changes;
- no changes to business semantics, PostgreSQL schema, or runtime behavior;
- no exhaustive generated filesystem manifest;
- no duplication of workflow IDs or volatile version IDs from `PROJECT_STATUS.md`.

## Acceptance criteria

1. A new task can locate the authoritative file for current state, architecture, field meaning, DB schema, each workflow, tests, and evaluations directly from `AGENTS.md`.
2. Canonical, beta, and live boundaries are explicit.
3. The stale `AG-0` current-milestone instruction is removed.
4. All referenced repository paths exist at implementation time.
5. Only `AGENTS.md` changes during implementation.
6. `git diff --check` passes and no secrets are introduced.
