# Agentic shadow migration — PostgreSQL 17.9 runtime evidence

Date: 2026-09-09
Migration commit under test: `f1261a164fe6fd430ef0bc183930552bc03bb63a`

## Execution boundary

The migration was exercised against a disposable local PostgreSQL 17.9 instance. No production database was accessed or changed. The executable repository gate is:

```powershell
$env:AGENTIC_REQUIRE_POSTGRES_RUNTIME = '1'
node --test tests/agentic-job-migration.test.mjs
```

The version-controlled harness automatically uses Docker PostgreSQL 17 when available. Its guarded external-fixture mode additionally requires the explicit reset sentinel, a disposable allow-listed database name, and an empty `public` namespace.

For this recorded run, a temporary local embedded PostgreSQL 17.9 server executed the same canonical fixtures and migration SQL used by the test. This avoided production access while Docker and native `psql` were unavailable on the host.

## Result

- Empty, populated, and documented-variant canonical fixtures: double-apply passed.
- Canonical catalog and populated-row snapshots: unchanged after both applications.
- Cross-run document/job ownership and cross-catalog result ownership: all four invalid inserts rejected by the expected composite foreign keys.
- Representative default, CHECK, foreign-key, UNIQUE, and index drift: all five migrations failed closed; rollback left no shadow tables.
- PostgreSQL 17 parser accepted the migration and all fixture statements.

This evidence complements the executable test and does not replace it. The checked database contract covers schema and audit ownership integrity only; it adds no semantic decision logic for the 27 tender fields.
