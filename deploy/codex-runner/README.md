# Tender Codex runner

Internal-only service that runs the agentic tender analysis beside n8n, never inside the n8n process. n8n stages an immutable job through the authenticated HTTP API and later polls the asynchronous lifecycle.

## Security and runtime boundary

- The service has no host-published port. n8n reaches `http://tender-codex-runner:8080` through the external `n8n_default` network.
- The container runs as UID/GID `10001:10001` with a read-only root filesystem, all Linux capabilities dropped, and `no-new-privileges` enabled. It does not install or use a setuid `bubblewrap` helper.
- Docker's outer seccomp profile is unconfined only for this container so the bundled Codex sandbox can create its restricted namespaces and install its own seccomp filter. A named AppArmor profile grants only the `userns` exception required on Ubuntu while the host-wide unprivileged-user-namespace restriction stays enabled.
- `/opt/tender-codex-runner/jobs` is the only writable host mount and appears as `/data/jobs`. For each invocation the runner creates a private job-local `codex-home`, copies only `auth.json` into it with mode `0600`, keeps it outside the agent workspace, and removes it after the Codex process exits.
- The runner Header Auth token is mounted read-only at `/run/secrets/runner-auth-token`. The dedicated Codex auth directory is mounted read-only at `/run/codex-auth`; never mount a user's complete Codex home, home directory or the n8n filesystem.
- The service receives only its own Header Auth token and Codex credential at deployment time. It must never receive TenderPlan, n8n, PostgreSQL, Supabase or Telegram credentials.
- Exactly one Codex process may run at a time. The initial queue accepts at most two waiting jobs and fails closed beyond that bound.
- JSON bodies are limited to 2 MiB and may be buffered. Document bodies are limited to 50 MiB, are exposed to the route handler as a bounded `AsyncIterable`, and are never concatenated in memory. The raw HTTP stream is not exposed to route handlers. The server retains the single global document-upload slot until full EOF, drains an early handler return/error without retaining bytes, and lets an eventual size overflow override apparent success. Overlap is rejected with `503 RUNNER_UPLOAD_BUSY`; Task 5 must consume the stream completely while computing SHA-256 and performing an atomic rename.

`GET /health` is unauthenticated but internal-only. It returns schema `tender_codex_runner_health_v1`, component versions, boolean readiness flags, and runner-owned `tender_codex_runner_execution_profile_v1` provenance. The profile pins `gpt-5.6-sol`, reasoning effort `high`, Codex CLI `0.153.4`, and SHA-256 hashes read from the image-owned field catalog, prompt, result schema, legacy skill entry point, and the complete allowlisted agent template. The aggregate template hash covers `AGENTS.md`, `SKILL.md`, the focused recipes, and every staged helper script. A timed-out, failed or non-zero tool probe leaves that tool version `null` and readiness false; bounded probe diagnostics stay internal. Health never returns credential values. Every `/v1/*` route requires `X-Tender-Codex-Token` Header Auth.

## Immutable source staging

The authenticated staging API is deliberately small:

- `PUT /v1/jobs` creates one closed `tender_source_manifest_v1` declaration.
  It may include one sealed TenderPlan metadata source with reserved identity
  `tenderplan-metadata` / `tender_metadata`.
- `PUT /v1/jobs/{job_id}/documents/{artifact_key}` streams one declared source file.
- `POST /v1/jobs/{job_id}/seal` rechecks every file hash and size, copies the pinned field catalog, and freezes the input manifest.
- `POST /v1/jobs/{job_id}/start` idempotently claims an executable job and queues Codex without holding the caller connection.
- `GET /v1/jobs/{job_id}` returns bounded identity, state, counts, and the sealed manifest hash.
- `GET /v1/jobs/{job_id}/result` returns the completed result and its validation envelope after persisted artifact hashes are rechecked.

Original file names are metadata only. Physical source names are generated from the validated document index and artifact key, and no caller-supplied name is ever resolved as a path. Uploads are written to a same-filesystem temporary file, hashed while streaming, fsynced, and atomically renamed only when SHA-256 and byte size match the declaration. Exact repeated uploads are idempotent before sealing; conflicting uploads and every post-seal upload are rejected.

An idempotent seal revalidates the pinned catalog copy, every staged source file, and the exact sealed manifest/hash before reporting `ready`. The store exposes the same `verifySealedInput(job_id)` integrity primitive for the future pre-start gate. Recovery removes only exact job-local `.write-<uuid>.tmp`, `.upload-<uuid>.tmp`, and `.create-<job>-<uuid>.tmp` files created by the runner; unknown files and directories are never recursively treated as write residue.

The manifest contains job/run/catalog identity, source-file identity
(`artifact_key`, document index/source ID, name, MIME type, size, and SHA-256),
and optionally one independent TenderPlan metadata source. That source has a
closed shape, fixed artifact/type identity, a nonblank display name and a plain
JSON object payload capped at 2 MiB of canonical UTF-8 JSON. Its bytes are
covered by the same canonical manifest SHA-256. The complete JSON request has a
separate 16 MiB transport limit, leaving room for the enclosing manifest and
the maximum declared JSON-escaped document identity set.
`expected_documents` and
`documents[]` still count only immutable original files. The runner does not
extract or index pages, sheets, OOXML parts, text, OCR, or metadata meaning;
Codex chooses how to inspect each source.

## Per-job Codex permissions

The runner builds a fresh permission profile for each job and supplies it through CLI `-c` overrides after `--ignore-user-config`. It never passes the legacy `--sandbox` flag because current Codex permission profiles and the legacy sandbox do not compose. The profile denies the filesystem root by default, restores only `:minimal` read access, writes to the exact current `workspace` (including its job-local `.tmp`) and one short-lived per-job `/dev/shm/tc-*` LibreOffice runtime directory, reads only that job's immutable original `input`, and explicitly denies both Codex auth locations, runner secrets, global `/tmp` and the complete `/proc` tree. The runner creates the Office runtime before an attempt and removes it afterward. The inner sandbox exposes only the synthetic ancestor path to the current job; the canary verifies that neither a sibling job nor its Office runtime is accessible. No generated source-index tree is mounted or granted.

Spawned shell commands inherit no process environment. The runner supplies only fixed `PATH`, job-local `HOME`/`TMPDIR`, `LANG` and `LC_ALL`; credential-like variables are not forwarded. The actual Codex service process may read the dedicated auth mount, while its sandboxed shell may not.

## Agent-led analysis boundary

Codex receives the immutable originals, plus the optional sealed TenderPlan
metadata payload, and chooses its own inspection methods. The metadata may be
cited as evidence through `tenderplan-metadata`, but it is not an original file
and is never accepted in `inspected_documents`. The runner does not pre-index
documents or verify business meaning. Runtime checks are restricted to
security, original-file size/SHA and manifest identity, and the closed JSON
contract: exact 27-key/index mapping, allowed statuses, evidence artifact
membership, and a nonblank human locator for `resolved` or `requires_review`.
`not_found` may have no evidence; absent or null metadata does not imply a
negative fact. Agent-reported inspected documents, parts, methods, limitations
and constraints remain audit context rather than a completeness claim.

For every new job, the runner copies one fixed, hash-attested toolkit from the
container image into the private workspace. It contains the short `AGENTS.md`,
the focused tender-analysis skill, usage recipes, and bounded helpers for PDF
text search/rendering, image OCR, Office rendering, and read-only OOXML
inspection. The allowlist is closed: an added, missing, symlinked, or changed
template file fails staging or changes the execution-profile attestation. The
helpers are optional navigation aids; Codex remains responsible for choosing
the inspection method and for the semantic conclusions.

## Execution lifecycle

The persistent states are `staging → ready → running → validating → completed`,
with typed `failed` terminals. Repeated start while a job is running,
validating, completed, or terminally failed is a structured no-op. A runner
restart changes orphaned `running`/`validating` work to a typed recoverable
failure; the same job may then claim attempt 2. Attempt 1 remains in audit.

Only a typed transport/process failure with no valid JSON can receive one
automatic second attempt. Schema, source-identity, locator-contract, and file
integrity failures do not trigger a paid retry. Queue admission failure restores
an unstarted claim instead of leaving a false `running` state. Completed and
failed job directories are eligible for exact-job cleanup after seven days;
active jobs are never TTL-deleted.

The execution entry point carries explicit `requiresExecutionBoundary` route metadata and returns `503 RUNNER_ISOLATION_NOT_READY` until a real container canary proves that a sibling job, `/run/codex-auth`, `/run/secrets` and process environments are unreadable. Do not mark `readiness.execute=true` from configuration alone.

After each container start, wait until `GET /health` reports base `status: "ready"`, then run this command exactly once from the host:

```bash
docker exec tender-codex-runner npm run attest:isolation
```

This is a bounded, real Codex call and may consume paid usage. It creates two fresh canary jobs, runs the image-owned hash-pinned probe under the same model, reasoning effort, permission profile, environment policy and no-network controls as production execution, and accepts only Codex JSONL command-execution evidence. Agent prose or an agent-written claim cannot attest the runner. The probe must prove current-input read, workspace, job-local `.tmp`, and current Office-runtime write; current-input, sibling Office-runtime, sibling/job-parent, auth, runner-secret, global `/tmp`, and process-environment denial; and absence of credential-like environment names.

Only a successful probe is persisted atomically with restrictive permissions below `/data/jobs/.runner-isolation`. The record contains identifiers, timestamps and hashes only—never credentials, raw auth, host corpus paths or model reasoning. It is bound to the current process challenge, container identity, execution profile, command/permission contract, exact probe set and JSONL audit bytes. Missing, altered, older-than-24-hours, overlong or prior-container evidence keeps `readiness.isolation_canary` and `readiness.execute` false. The running server notices a newly valid record without restart or a configuration toggle; `/v1/jobs/{job_id}/start` remains fail-closed with `503 RUNNER_ISOLATION_NOT_READY` until then. Base health HTTP status semantics are unchanged: a base-ready runner can return HTTP 200 while these execution flags are false.

## Local checks

```powershell
node --test tests/agentic-runner-deployment.test.mjs tests/agentic-runner-http.test.mjs tests/agentic-runner-manifest.test.mjs tests/agentic-codex-command.test.mjs tests/agentic-result-validator.test.mjs tests/agentic-runner-lifecycle.test.mjs
$env:TENDER_CODEX_RUNNER_AUTH_TOKEN = 'local-validation-placeholder'
docker compose -p tender-codex-runner-test -f deploy/codex-runner/compose.yaml config -q
```

## Server deployment boundary

Create `/opt/tender-codex-runner/jobs` with owner `10001:10001` and mode `0700`. Create `/opt/tender-codex-runner/secrets/runner-auth-token` and `/opt/tender-codex-runner/secrets/codex-auth/auth.json` as UID/GID `10001:10001`, mode `0400`. They are mounted read-only. Do not write either value into this repository, Compose YAML, n8n workflow JSON or execution data.

Start or replace only this Compose project:

```bash
install -o root -g root -m 0644 /opt/tender-codex-runner/apparmor/tender-codex-runner /etc/apparmor.d/tender-codex-runner
apparmor_parser -r /etc/apparmor.d/tender-codex-runner
docker compose -p tender-codex-runner -f /opt/tender-codex-runner/compose.yaml config -q
docker compose -p tender-codex-runner -f /opt/tender-codex-runner/compose.yaml build codex-runner
docker compose -p tender-codex-runner -f /opt/tender-codex-runner/compose.yaml up -d --no-deps codex-runner
```

If auth, the writable store, or a required document tool is unavailable, health returns `503` and the container stays unready. The isolation command is an explicit post-start operator gate; it is not run during image build, startup, health checks or automated tests.
