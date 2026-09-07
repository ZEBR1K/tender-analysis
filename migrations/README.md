# Database migrations

Files in this directory are versioned repository artifacts. Their presence in Git is not evidence that a migration was applied to any live PostgreSQL environment.

Applying a migration to production requires separate explicit approval and an operator with write access. Codex read-only credentials must never be used or extended for migration application.

Before applying `2026-09-07_tender_intake_resume.sql`, run its duplicate-unfinished-run preflight as a read-only query:

```sql
SELECT source, tender_id, count(*) AS unfinished_run_count
FROM public.tender_analysis_runs
WHERE status <> 'completed'
GROUP BY source, tender_id
HAVING count(*) > 1;
```

Application must stop if the query returns any row. Do not choose, update, or delete a duplicate automatically.

Rollback would remove the intake ledger and/or uniqueness boundary and can be destructive. No automated rollback script is provided; any rollback requires a separately reviewed operator procedure and explicit approval.
