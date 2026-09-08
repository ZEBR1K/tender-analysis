# Database migrations

Files in this directory are versioned repository artifacts. Their presence in Git is not evidence that a migration was applied to any live PostgreSQL environment.

Applying a migration to production requires separate explicit approval and an operator with write access. Codex read-only credentials must never be used or extended for migration application.

Before applying `2026-09-07_tender_intake_resume.sql`, run its duplicate-active-run preflight as a read-only query:

```sql
SELECT source, tender_id, count(*) AS unfinished_run_count
FROM public.tender_analysis_runs
WHERE status NOT IN ('completed', 'superseded')
GROUP BY source, tender_id
HAVING count(*) > 1;
```

The migration has one explicitly approved reconciliation for the legacy shape
confirmed by read-only execution `14685`: exactly `24`, `50`, and `12` active
rows for the three encoded `(source, tender_id)` groups, bounded by their exact
microsecond `created_at` cutoffs. When that complete shape is present, the same
transaction marks exactly 86 rows `superseded`, records `superseded_at` and a
fixed `superseded_reason`, and preserves every child row and existing
`error_message`. With no active duplicate group, reconciliation is a no-op.
Rows newer than a cutoff are never updated. Any missing/extra bounded legacy
shape or unexpected duplicate group aborts; if multiple newer active rows would
remain, the final duplicate preflight aborts and rolls back before index
creation.

The migration discovers the authoritative status-only CHECK from PostgreSQL
catalogs, validates its exact current or already-migrated allowed set, and only
then replaces the discovered constraint to add `superseded`. It does not rely
on a guessed constraint name. The final preflight and partial unique index both
use `status NOT IN ('completed', 'superseded')`.

Before reconciliation, the same transaction inspects any existing
`uq_tender_analysis_runs_one_unfinished` object. An exact valid legacy index on
`(source, tender_id)` with predicate `status <> 'completed'` is dropped only
after catalog validation, so it cannot reject the bounded transition to
`superseded`; an exact current index is retained, and no index is the fresh-DB
path. Any other same-name object or definition aborts without being dropped.
The current index is created after reconciliation and the final duplicate
preflight. A later failure rolls back the legacy-index drop with the rest of the
transaction.

## Operational application boundary

`CREATE UNIQUE INDEX` is intentionally non-concurrent because this migration is
one atomic transaction. Controlled application requires full quiescence, not
merely low traffic. Before both the rollback dry-run and the real application:

1. keep every autonomous or new-run producer inactive or absent, including all
   intake, recovery, manual-resume and Orchestrator entry paths;
2. immediately before execution, verify preferably system-wide that n8n has
   zero executions in `new`, `running` or `waiting` state;
3. verify that no execution targets any of the 86 bounded legacy runs.

If any active execution exists, or either check cannot be completed, abort. Do
not manually execute a producer, and keep entry workflows inactive, until the
migration postconditions and the import plus read-back verification of the
updated workflow candidates are complete. Read-only evidence from 2026-09-08
recorded live Orchestrator `Q1RWSrB0jaTA6Dmx` as inactive, Intake/Recovery as
not live, and the active execution count as zero. That evidence is historical:
runtime migration remains pending and all quiescence checks must be repeated
immediately before each database execution.

### Required rollback dry-run

Before any commit-capable execution, run the exact migration body against the
real target catalog with only its final `COMMIT;` replaced in memory by
`ROLLBACK;`. Source-regex tests are useful repository guards, but are not
PostgreSQL runtime proof. From the repository root, in an operator shell whose
`psql` connection already enforces the approved TLS and credential policy:

```powershell
$migrationPath = Resolve-Path '.\migrations\2026-09-07_tender_intake_resume.sql'
$migrationSql = Get-Content -Raw -LiteralPath $migrationPath
$terminalCommit = '(?is)\bCOMMIT\s*;\s*\z'

if ([regex]::Matches($migrationSql, $terminalCommit).Count -ne 1) {
  throw 'Expected exactly one terminal COMMIT in the migration source.'
}

$dryRunSql = [regex]::Replace($migrationSql, $terminalCommit, "ROLLBACK;`r`n")
$migrationBody = [regex]::Replace($migrationSql, $terminalCommit, '')
$dryRunBody = [regex]::Replace($dryRunSql, '(?is)\bROLLBACK\s*;\s*\z', '')

if ($migrationBody -cne $dryRunBody) {
  throw 'Dry-run body differs from the committed migration source.'
}

$dryRunSql | & psql --no-psqlrc --set=ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) {
  throw "Migration rollback dry-run failed with exit code $LASTEXITCODE."
}
```

After the command reports `ROLLBACK`, compare fresh read-only snapshots with
the snapshots taken immediately before it. All must be unchanged:

- status CHECK name, definition and allowed values;
- presence and exact definition (or absence) of the active-run index;
- absence/presence and schema of the two superseded columns and intake table;
- all 86 target run rows, including `status`, superseded audit fields,
  `error_message` and `updated_at`;
- child-row identities and counts for those 86 runs;
- the three exact active counts and microsecond maxima from preflight `14685`.

Any difference, SQL error, missing `ROLLBACK`, or failed quiescence check aborts
the rollout. This rollback dry-run has not yet been performed.

### Real application

Before execution, the operator must configure bounded `lock_timeout` and `statement_timeout` values appropriate to the target environment and expected table size. This repository does not prescribe universal timeout values. The migration client must stop on the first SQL error.

Only after the rollback dry-run and unchanged-state verification pass, repeat
the quiescence checks immediately and execute the committed migration without
transformation. Any lock timeout, statement timeout, postcondition failure, or
other SQL error aborts the transaction; the operator must roll it back and
verify that no partial schema change was committed. After a successful
application, verify the same catalog postconditions again with read-only
catalog queries, confirm exactly 86 rows have the bounded superseded audit
transition, and then import and read back the updated inactive workflow
candidates. Do not manually execute or activate entry workflows before those
checks complete.

Rollback would remove the intake ledger and/or uniqueness boundary and can be destructive. No automated rollback script is provided; any rollback requires a separately reviewed operator procedure and explicit approval.
