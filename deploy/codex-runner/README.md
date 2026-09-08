# Tender Codex runner

Internal-only service that runs the agentic tender analysis beside n8n, never inside the n8n process. n8n will stage an immutable job through the authenticated HTTP API; later implementation tasks add the job manifest and lifecycle routes.

## Security and runtime boundary

- The service has no host-published port. n8n reaches `http://tender-codex-runner:8080` through the external `n8n_default` network.
- The container runs as UID/GID `10001:10001`, with a read-only root filesystem, all Linux capabilities dropped and `no-new-privileges` enabled.
- `/opt/tender-codex-runner/jobs` is the only writable host mount and appears as `/data/jobs`. It contains job workspaces plus the dedicated Codex home; do not mount a user's home or the n8n filesystem.
- The service receives only its own Header Auth token and Codex credential at deployment time. It must never receive TenderPlan, n8n, PostgreSQL, Supabase or Telegram credentials.
- Exactly one Codex process may run at a time. The initial queue accepts at most two waiting jobs and fails closed beyond that bound.
- JSON bodies are limited to 2 MiB and document bodies to 50 MiB.

`GET /health` is unauthenticated but internal-only. It returns schema `tender_codex_runner_health_v1`, component versions and boolean readiness flags. It never returns credential values. Every `/v1/*` route requires `X-Tender-Codex-Token` Header Auth.

## Local checks

```powershell
node --test tests/agentic-runner-deployment.test.mjs tests/agentic-runner-http.test.mjs
$env:TENDER_CODEX_RUNNER_AUTH_TOKEN = 'local-validation-placeholder'
docker compose -p tender-codex-runner-test -f deploy/codex-runner/compose.yaml config -q
```

## Server deployment boundary

Create `/opt/tender-codex-runner/jobs` with owner `10001:10001` and mode `0700`. Put the runner Header Auth token and the chosen Codex credential in server-side secret storage, then inject them at Compose runtime. Do not write either value into this repository, Compose YAML, n8n workflow JSON or execution data.

Start or replace only this Compose project:

```bash
docker compose -p tender-codex-runner -f /opt/tender-codex-runner/compose.yaml config -q
docker compose -p tender-codex-runner -f /opt/tender-codex-runner/compose.yaml build codex-runner
docker compose -p tender-codex-runner -f /opt/tender-codex-runner/compose.yaml up -d --no-deps codex-runner
```

If auth, the writable store, or a required document tool is unavailable, health returns `503` and the container stays unready. Deployment and paid-call canaries remain separate later gates.
