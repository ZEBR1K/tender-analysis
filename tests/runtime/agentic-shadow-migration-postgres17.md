# Agentic shadow migration — raw PostgreSQL 17 evidence

recorded_at_utc: 2026-09-08T22:49:56Z
server_version: 17.9
server_version_num: 170009
migration_sha256_lf: dc5cac97ae8aeb928f4f4d27fc5149bcf68dc5d48f2ed688e369d416d60fa08d
execution_mode: embedded-postgres-local-disposable
command: node "$env:TEMP\agentic-embedded-pg17\verify-agentic-runtime.mjs"
exit_code: 0

The command ran against a temporary local database directory created for this
execution. No production database was accessed. The SHA-256 is calculated from
the exact migration under test after normalizing CRLF to LF, so the repository
test can compare it with the current migration on Windows and Unix checkouts.

## Raw stdout

```text
server_version|17.9
server_version_num|170009
migration_sha256_lf|dc5cac97ae8aeb928f4f4d27fc5149bcf68dc5d48f2ed688e369d416d60fa08d
fixtures|empty,populated,documented-variant
double-apply|3 passed
ownership|4 cross-run/cross-catalog rejects passed
drift|5 fail-closed rollbacks passed
```

The runtime contract covers schema and audit ownership integrity only. It adds
no semantic decision logic for the 27 tender fields.
