# Tender Codex runner

Internal-only service that runs the agentic tender analysis beside n8n, never inside the n8n process. n8n will stage an immutable job through the authenticated HTTP API; later implementation tasks add the job manifest and lifecycle routes.

## Security and runtime boundary

- The service has no host-published port. n8n reaches `http://tender-codex-runner:8080` through the external `n8n_default` network.
- The container runs as UID/GID `10001:10001`, with a read-only root filesystem, all Linux capabilities dropped and `no-new-privileges` enabled.
- `/opt/tender-codex-runner/jobs` is the only writable host mount and appears as `/data/jobs`. Codex authentication and state are not stored below it.
- The runner Header Auth token is mounted read-only at `/run/secrets/runner-auth-token`. The dedicated Codex auth directory is mounted read-only at `/run/codex-auth`; never mount a user's complete Codex home, home directory or the n8n filesystem.
- The service receives only its own Header Auth token and Codex credential at deployment time. It must never receive TenderPlan, n8n, PostgreSQL, Supabase or Telegram credentials.
- Exactly one Codex process may run at a time. The initial queue accepts at most two waiting jobs and fails closed beyond that bound.
- JSON bodies are limited to 2 MiB and may be buffered. Document bodies are limited to 50 MiB, are exposed to the route handler as a bounded `AsyncIterable`, and are never concatenated in memory. The raw HTTP stream is not exposed to route handlers. The server retains the single global document-upload slot until full EOF, drains an early handler return/error without retaining bytes, and lets an eventual size overflow override apparent success. Overlap is rejected with `503 RUNNER_UPLOAD_BUSY`; Task 5 must consume the stream completely while computing SHA-256 and performing an atomic rename.

`GET /health` is unauthenticated but internal-only. It returns schema `tender_codex_runner_health_v1`, component versions and boolean readiness flags. A timed-out, failed or non-zero tool probe leaves that tool version `null` and readiness false; bounded probe diagnostics stay internal. Health never returns credential values. Every `/v1/*` route requires `X-Tender-Codex-Token` Header Auth.

## Per-job Codex permissions

The runner builds a fresh permission profile for each job and supplies it through CLI `-c` overrides after `--ignore-user-config`. It never passes the legacy `--sandbox` flag because current Codex permission profiles and the legacy sandbox do not compose. The profile denies the filesystem root by default, restores only `:minimal` read access, writes only the exact current `workspace`, reads only that job's `input` and `source-index`, and explicitly denies the shared jobs parent, Codex auth, runner secrets, global temp paths and `/proc/*/environ`.

Spawned shell commands inherit no process environment. The runner supplies only fixed `PATH`, job-local `HOME`/`TMPDIR`, `LANG` and `LC_ALL`; credential-like variables are not forwarded. The actual Codex service process may read the dedicated auth mount, while its sandboxed shell may not.

Task 4 provides a structural boundary builder and negative-canary contract only. The real execution entry point, `POST /v1/jobs/{uuid}/start`, carries explicit `requiresExecutionBoundary` route metadata and returns `503 RUNNER_ISOLATION_NOT_READY` until Task 8 runs a real sandbox canary proving that a sibling job, `/run/codex-auth`, `/run/secrets` and process environments are unreadable. Do not mark `readiness.execute=true` from configuration alone.

## Local checks

```powershell
node --test tests/agentic-runner-deployment.test.mjs tests/agentic-runner-http.test.mjs
$env:TENDER_CODEX_RUNNER_AUTH_TOKEN = 'local-validation-placeholder'
docker compose -p tender-codex-runner-test -f deploy/codex-runner/compose.yaml config -q
```

## Server deployment boundary

Create `/opt/tender-codex-runner/jobs` with owner `10001:10001` and mode `0700`. Create `/opt/tender-codex-runner/secrets/runner-auth-token` and `/opt/tender-codex-runner/secrets/codex-auth/auth.json` as UID/GID `10001:10001`, mode `0400`. They are mounted read-only. Do not write either value into this repository, Compose YAML, n8n workflow JSON or execution data.

Start or replace only this Compose project:

```bash
docker compose -p tender-codex-runner -f /opt/tender-codex-runner/compose.yaml config -q
docker compose -p tender-codex-runner -f /opt/tender-codex-runner/compose.yaml build codex-runner
docker compose -p tender-codex-runner -f /opt/tender-codex-runner/compose.yaml up -d --no-deps codex-runner
```

If auth, the writable store, or a required document tool is unavailable, health returns `503` and the container stays unready. Deployment and paid-call canaries remain separate later gates.
