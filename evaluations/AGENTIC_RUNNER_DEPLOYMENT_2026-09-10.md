# Agentic runner deployment evidence — 2026-09-10

## Result

The isolated Codex runner is deployed on the current n8n host as a separate
Compose service. Its execution boundary is runtime GREEN. The legacy n8n,
PostgreSQL, Redis, archive-extractor and report containers were not recreated
or reconfigured.

This is still an inactive shadow deployment. No production workflow was
activated. Fresh read-only reconciliation found three already-imported inactive
agentic workflows and three resolvable shadow relation names; this supersedes the
preliminary observation recorded later in this report. The required canonical
document metadata prerequisite is still absent, so no n8n canary has run.

## Host and workload baseline

Observed host capacity during the Task 16 canary:

```text
CPU: 2 logical CPUs
RAM: 1967 MiB
Swap: 2047 MiB
Root filesystem: 29 GiB total, 4.9 GiB available, 83% used
```

The four-run driver is isolated in a transient systemd unit with
`MemoryMax=256M` and `CPUQuota=20%`. The runner itself is bounded to one active
Codex process, two queued jobs, 1 CPU, 1536 MiB and 192 PIDs. A Task 16 watchdog
stops only the runner after two consecutive low-memory, low-swap, unhealthy-n8n
or increased-n8n-restart samples.

The protected container state remained unchanged across runner deployment and
real canary start:

| Container | Restart count | Started at (UTC) |
|---|---:|---|
| `n8n-n8n-1` | 6 | `2026-09-05T07:21:49.931627526Z` |
| `n8n-n8n-worker-1` | 0 | `2026-08-28T08:03:08.946624301Z` |
| `n8n-postgres-1` | 0 | `2026-08-28T08:03:08.965583055Z` |
| `n8n-redis-1` | 0 | `2026-08-28T08:03:08.962459414Z` |
| `tender-archive-extractor` | 0 | `2026-09-08T15:46:34.454085641Z` |
| `tender-pdf-gotenberg` | 0 | `2026-09-07T06:54:18.218951350Z` |

## Permanent runner permissions

Runtime inspection after the final rebuild reported:

```text
user=10001:10001
privileged=false
read_only_rootfs=true
cap_add=null
cap_drop=["ALL"]
security=["no-new-privileges:true","seccomp=unconfined","apparmor=tender-codex-runner-userns"]
published_ports={}
```

The host keeps `kernel.apparmor_restrict_unprivileged_userns=1`. Only the named
runner AppArmor profile grants the `userns` operation needed by the bundled
Codex sandbox. Docker's outer seccomp is unconfined only for this container;
the container receives no Linux capability, is not privileged and retains
`no-new-privileges`. A direct `codex sandbox /bin/true` probe exited `0`.

The agent permission profile independently denies network access and the
filesystem root, then exposes only minimal runtime files, the current job's
read-only input and its writable workspace. It explicitly denies the sibling
jobs, runner secrets, Codex auth, global temporary directory and `/proc`.

## Terminal archive integrity

The first completed real job exposed one runtime-only compatibility case:
Codex created a relative symbolic link from its writable workspace to an
immutable source file inside the same job. The batch driver initially failed
closed with `RUNNER_ARCHIVE_INVALID`; it did not omit the job or continue to the
next replicate.

The archive boundary now accepts only non-broken links whose resolved target
remains inside that exact terminal job. It preserves the link verbatim and
records its path and target in the SHA-256 inventory. Links that resolve outside
the job, links to special files, and archive roots that are links remain
rejected. Linux regression tests prove both the accepted in-job case and the
blocked escape case. This is a file-integrity correction only; it adds no
document parser or semantic validation.

## Runtime attestation

The final image passed the real paid isolation attestation with challenge:

```text
5dd09684-cfd3-4f5a-b166-094fb3d22d81
```

The runner then reported every readiness flag `true`, including
`codex_auth`, `isolation_canary` and `execute`. The attestation is bound to the
container identity, execution profile, probe bytes and JSONL command audit; a
rebuild invalidates it and requires a fresh pass.

## n8n reachability and authentication

Both `n8n-n8n-1` and `n8n-n8n-worker-1` resolved the internal service name and
received `tender_codex_runner_health_v1`. From each container, an authenticated
request for a deliberately nonexistent job returned HTTP `404`; the same
request with the wrong header form returned `401`. No credential value was
printed, persisted in n8n or written to Git.

## Checks retained in runtime

Before each runtime check was retained, it was classified against the allowed
boundary:

| Check | Allowed reason |
|---|---|
| current-job path and denied sibling/auth/secret/network access | security |
| source byte size, SHA-256, sealed manifest and artifact hashes | file integrity |
| exact 27 unique keys, allowed statuses, required types/properties | JSON contract |
| manifest membership of reported files | JSON/source identity contract |
| nonblank locator for `resolved` and `requires_review` | JSON contract |

No page/OOXML/XLSX coverage parser, quote verifier, evidence-sufficiency score,
field-specific rule or semantic status rewriting is present in the runner.

## Reconciled live state and remaining gate

Fresh authoritative read-only checks superseded the preliminary absence claim:

- PostgreSQL resolves `tender_agentic_jobs`, `tender_agentic_documents`, and
  `tender_agentic_field_results` as existing relations. The scoped read-only
  role has no `SELECT` privilege on them, so row counts and exact live schema
  parity are not claimed.
- Live n8n contains inactive Dispatch `d37251e524754e1f`, Monitor
  `47e6ede6c10349c0`, and Error `6ccedae778a14176`. Normalized graph read-back
  matches the repository candidates. Dispatch and Monitor reference the real
  Error workflow and have bound PostgreSQL and runner credential types; no
  repository placeholder remains.
- The execution-list endpoint returned zero entries for each workflow.

The server container `n8n-postgres-1` is n8n's internal database, not the
production tender database. A controlled run of the existing shadow migration
there executed only `BEGIN`, `SET`, and `SET`, then failed at the first `LOCK`
because `public.tender_analysis_runs` is absent. The transaction aborted and
created no DDL objects. The production tender database is external Supabase;
only its scoped read-only role was available for this reconciliation.

The canonical `tender_analysis_documents.ingestion_metadata` prerequisite is
still absent. Dispatch requires its `content_sha256`, so an inactive workflow
canary cannot truthfully pass until the existing shadow relations receive an
authorized exact-schema preflight, the additive prerequisite migration is
applied, and a dedicated verified canary source is available. Dispatch →
Monitor → 27-row database persistence therefore remains unverified. No workflow
was activated, and the legacy production route was not changed.

## Final canary state

All four runner-direct blind runs completed. The offline evaluator returned
`ok=true`, `replicate_count=4` and `all_structural_pass=true`. The watchdog
recorded zero non-zero pressure samples. After completion the runner used about
141 MiB, the host reported 767 MiB available RAM and 1,040 MiB free swap, and
the root filesystem remained at 83% use with 4.9 GiB available.

The runner and protected containers retained the restart counts and start times
recorded above. A secret-value comparison found no runner authentication token
in container logs, and a basename comparison found no source-document filename
there. Complete blind-run metrics and repeatability limits are in
`evaluations/AGENTIC_SHADOW_CANARY_2026-09-10.md`.
