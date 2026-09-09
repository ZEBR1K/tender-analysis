# Agentic shadow migration — raw PostgreSQL 17 evidence

recorded_at_utc: 2026-09-09T00:58:19Z
server_version: 17.9
server_version_num: 170009
migration_sha256_lf: c3b4481c5d3372b04aba08743335d9d22840514e6d2da67cfd2b3458d70728cc
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
migration_sha256_lf|c3b4481c5d3372b04aba08743335d9d22840514e6d2da67cfd2b3458d70728cc
fixtures|empty,populated,documented-variant
double-apply|3 passed
ownership|4 cross-run/cross-catalog rejects passed
drift|5 fail-closed rollbacks passed
```

The runtime contract covers schema and audit ownership integrity only. It adds
no semantic decision logic for the 27 tender fields.
