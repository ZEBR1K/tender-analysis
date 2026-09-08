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

## Immutable source staging

The authenticated staging API is deliberately small:

- `PUT /v1/jobs` creates one closed `tender_source_manifest_v1` declaration.
- `PUT /v1/jobs/{job_id}/documents/{artifact_key}` streams one declared source file.
- `POST /v1/jobs/{job_id}/seal` rechecks every file hash and size, copies the pinned field catalog, and freezes the input manifest.
- `GET /v1/jobs/{job_id}` returns bounded identity, state, counts, and the sealed manifest hash.

Original file names are metadata only. Physical source names are generated from the validated document index and artifact key, and no caller-supplied name is ever resolved as a path. Uploads are written to a same-filesystem temporary file, hashed while streaming, fsynced, and atomically renamed only when SHA-256 and byte size match the declaration. Exact repeated uploads are idempotent before sealing; conflicting uploads and every post-seal upload are rejected.

The manifest intentionally contains only job/run/catalog identity and source-file identity (`artifact_key`, document index/source ID, name, MIME type, size, and SHA-256). It does not extract or index pages, sheets, OOXML parts, text, or OCR. Codex chooses how to inspect each source in a later task.

## Per-job Codex permissions

The runner builds a fresh permission profile for each job and supplies it through CLI `-c` overrides after `--ignore-user-config`. It never passes the legacy `--sandbox` flag because current Codex permission profiles and the legacy sandbox do not compose. The profile denies the filesystem root by default, restores only `:minimal` read access, writes only the exact current `workspace`, reads only that job's immutable original `input`, and explicitly denies the shared jobs parent, Codex auth, runner secrets, global temp paths and `/proc/*/environ`. No generated source-index tree is mounted or granted.

Spawned shell commands inherit no process environment. The runner supplies only fixed `PATH`, job-local `HOME`/`TMPDIR`, `LANG` and `LC_ALL`; credential-like variables are not forwarded. The actual Codex service process may read the dedicated auth mount, while its sandboxed shell may not.

## Agent-led analysis boundary

Codex receives the immutable originals and chooses its own text, visual, OCR or OOXML inspection methods. The runner does not pre-index documents or verify business meaning. Runtime checks are restricted to security, original-file size/SHA and manifest identity, and the closed JSON contract: exact 27-key/index mapping, allowed statuses, evidence artifact membership, and a nonblank human locator for `resolved` or `requires_review`. `not_found` may have no evidence; agent-reported inspected documents, parts, methods, limitations and constraints remain audit context rather than a completeness claim.

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
