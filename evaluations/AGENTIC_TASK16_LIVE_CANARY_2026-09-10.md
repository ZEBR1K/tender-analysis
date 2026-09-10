# Task 16 live inactive canary — 2026-09-10

## Result

Task 16 is GREEN. The isolated runner is healthy, the additive PostgreSQL
prerequisite and shadow schema are present, and an inactive n8n
Dispatch-to-Monitor canary persisted exactly 27 shadow field rows. No agentic
workflow was activated and the legacy production lane was not changed.

The database write used an operator-approved additive migration. Independent
read-only verification confirmed:

- `tender_analysis_documents.ingestion_metadata` is `jsonb NOT NULL` with an
  empty-object default;
- the three agentic shadow tables, expected constraints and indexes exist;
- the scoped role can read the shadow jobs, documents and field results;
- the canonical source document used by the canary retained its original bytes
  and received only verified MIME, byte-size and SHA-256 metadata.

## Reproduced compatibility defects

The first inactive Dispatch execution (`15243`) stopped after creating the
runner job. It reproduced two non-semantic runtime defects:

1. n8n `2.35.3` left an explicit-JSON HTTP response body as a stream when
   `fullResponse=true`; the following identity guard therefore received no
   parsed body.
2. the failure persistence query called PostgreSQL `max(uuid)`, which does not
   exist, and masked the original transport error.

The minimal repository correction is limited to the transport/JSON and DB
contract:

- runner JSON requests use n8n response auto-detection, which resolves the
  response stream and then parses `application/json`;
- UUID values are aggregated through text and cast back to UUID;
- the binary upload node no longer carries `rawContentType`, which n8n permits
  only for raw request bodies.

Regression tests fail on the old exports and pass on the corrected exports.
No page/OOXML/XLSX parser, field-specific rule, quote check, evidence score or
semantic value validation was added.

## Successful inactive canary

The successful canary used a local fake runner only to exercise n8n transport,
identity, database ownership and exact-27 persistence without paying for a
second model execution. The fake runner was isolated, unprivileged, read-only,
had all Linux capabilities dropped, published no host port, and reported
`paid_execution=false`.

| Step | Workflow / execution | Result |
|---|---|---|
| protected one-shot wrapper | archived workflow `5CKvTBN3tv8lmplK`, execution `15256` | success |
| corrected inactive Dispatch | `gP29fv0rq4MoON9a`, execution `15257` | success; job `79149bb3-0028-413a-bbb9-813de64b6052` reached `running` |
| corrected one-shot Monitor | archived workflow `hmETk5CcMA4d28Bm`, execution `15258` | success; exact 27 rows committed and job completed |

The first reproduced job `3d5174e0-b99e-4bf0-bd47-13fe2355ebbc` was retained
as a typed failed audit row; it was not deleted or silently reused.

The final schedule-based corrected Monitor candidate is inactive as
`CALcBEXvQsO1AcfP`. Normalized node parameters and connections for the corrected
Dispatch and Monitor candidates match the repository exports. Their PostgreSQL
and runner credentials are bound to the existing exact credentials. The two
temporary one-shot wrappers were archived after the canary.

The earlier imported candidates remain inactive and must not be promoted:

- Dispatch `d37251e524754e1f` contains the pre-fix transport/UUID behavior;
- Monitor `47e6ede6c10349c0` contains the pre-fix transport/UUID behavior;
- Error workflow `6ccedae778a14176` remains the inactive error candidate.

Promotion, error-workflow publication/linking and production routing belong to
Task 17 and were not performed.

## Final runtime state

The fake runner was removed and the real runner was reconnected under its
canonical internal aliases. Authenticated health checks from both n8n main and
worker returned `tender_codex_runner_health_v1` with every readiness flag true.

| Container | Final restart count | State |
|---|---:|---|
| `tender-codex-runner` | 0 | healthy |
| `n8n-n8n-1` | 6 | healthy; unchanged from baseline |
| `n8n-n8n-worker-1` | 0 | healthy; unchanged from baseline |

The automatic restore timer is inactive and no fake-runner container remains.
The real runner has no queued or active job.

The four paid runner-direct blind runs reported separately remain the semantic
repeatability evidence. The n8n canary added zero model tokens and makes no new
semantic-accuracy claim.

Final repository verification: `751 tests / 745 passed / 0 failed / 6 explicit
platform/runtime skips`; `git diff --check` clean.
