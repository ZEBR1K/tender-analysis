# TENDER — Агентский анализ — Запуск

The Task 11 repository export remains identity-neutral and inactive by default.
The corrected live workflow `gP29fv0rq4MoON9a` is published in the temporary
Task 17 agent-only route.
The earlier imported `d37251e524754e1f` is a pre-fix inactive copy and must not
be promoted. The workflow accepts the typed
`analysis_run_id`, `pipeline_version=tender_agentic_pipeline_v1`, and positive
`replicate_index` contract.

The first PostgreSQL operation serializes and claims the logical job identity
with the exact dispatch execution ID, creates or loads its shadow job, verifies
the registered manifest and source-identity barrier, and inserts all processable
document ownership rows before any runner side effect. Existing
`running`, `validating`, `completed`, and `canceled` jobs are structured no-ops.
A failed job is eligible only when the synchronized runner audit says the
failure is retryable, the runner attempt is below two, and its code is one of
`RUNNER_ORPHANED_EXECUTION`, `CODEX_PROCESS_FAILED`,
`CODEX_TRANSPORT_ERROR`, or `CODEX_TIMEOUT`. Contract failures cannot retry.
There is one separate pre-start transport recovery: an unstarted, unsealed job
may be restaged once only after the source HTTP branch emits the fixed bounded
code `AGENTIC_SOURCE_DOWNLOAD_FAILED`. The audit flag
`prestart_retry_used=true` prevents repetition. Identity, ownership, CAS, seal,
runner-create and all other contract/integrity failures stay on the ordinary
terminal route and cannot enter this recovery path.

Documents are processed by `Loop Over Items` with batch size 1. The source HTTP
node returns the file in n8n binary property `data`; the next HTTP node streams
that binary property to the authenticated internal runner. No Code node reads,
copies, serializes, or logs document bytes. The repository export contains only
the runner Header Auth import placeholder and no token. In the live inactive
copy the expected credential types are bound; no credential value or bound ID
is recorded in the repository documentation.

Runner JSON HTTP nodes use response auto-detection because n8n `2.35.3` can
otherwise leave an explicit-JSON `fullResponse` body as an unresolved stream.
The binary upload keeps `application/octet-stream` in its header and does not
use the raw-body-only `rawContentType` parameter. The source allow-list is
PDF/DOCX/XLSX/XLS; XLS is staged unchanged and interpreted only by Codex.
Guarded SQL casts UUID values
through text before aggregate selection because PostgreSQL has no `max(uuid)`.

After every upload response matches the owned artifact/hash, PostgreSQL marks
that document staged. An exact DB barrier requires the expected total, all
staged, no incomplete state, and unique document indexes and artifact keys.
The job remains `staging` and dispatch-owned through that barrier and runner
`/seal`; only the verified seal moves it to `ready`. Monitor therefore cannot
claim a pre-start job. A verified `/start` response guardedly moves the exact
owned job from `ready` to `running` and synchronizes the runner attempt. If the
start response is lost or cannot be identified, the workflow records bounded
`START_OUTCOME_UNKNOWN`, releases dispatch ownership, and leaves the job
`ready` so Monitor can reconcile the idempotent runner job without issuing a
second paid start. Every guarded update emits an explicit updated/no-op or
ownership-lost result; a zero-row CAS cannot silently end the branch. Other
errors are reduced to bounded typed code/message fields; source URLs and binary
content are never persisted in the error record.

The export is identity-neutral, inactive, and has empty `pinData`. The pinned
shadow-v0 catalog hash is repository-known and included in the closed manifest.

The preflight also reads the run's sealed `tender_meta` and sends it to the
runner as the reserved root source `tenderplan-metadata` with
`source_type=tender_metadata`. It remains outside `documents[]` and
`expected_documents`, so file staging, file hashes and the document completion
barrier still describe original attachments only. The runner manifest hash
binds the metadata bytes. Codex may cite this source with a nonblank locator;
the workflow adds no TenderPlan parser, field mapping, semantic evidence check,
or negative inference from absent/null metadata.

Normalized read-back confirms that the corrected live workflow matches
the repository nodes and connections and has the exact PostgreSQL/runner
credentials bound. Integrated execution `15257` staged one verified source,
sealed the fake-runner manifest and moved shadow job
`79149bb3-0028-413a-bbb9-813de64b6052` to `running`; the following inactive
Monitor canary completed it with 27 rows. The live workflow is now published and
linked to ownership-guarded Agentic Error workflow `6ccedae778a14176`.
Real Dispatch execution `15373` staged and sealed both DOCX and raw XLS sources,
accepted the runner's uppercase 64-hex manifest SHA-256, and started job
`13b090b5-38fc-432a-a235-90ae43f609fe`. The job completed on attempt 1 and
TenderPlan Mark Intake was subsequently published. The earlier case-sensitive
seal check is covered by a regression test; no parser or semantic rule was
added.

## Fresh mark-to-report canary — 2026-09-11

The separate source-staging boundary reproduced the direct-source timeout in
execution `15815`. The source download node now uses the same live-only proxy,
three native attempts and five-second interval as Document Preparation; the
portable export contains only `=`. After runner authorization was renewed with
operator approval, Dispatch execution `16385` staged both registered DOCX
files, verified their identities, sealed the manifest and started job
`70d699d2-b469-40b0-a8cc-de5b38fa6374`, which completed on attempt 1.

Independent review narrowed the one-time recovery from a generic Dispatch code
to `AGENTIC_SOURCE_DOWNLOAD_FAILED`. Published/read-back live version
`4c49ed54-c2ca-40e2-9e8a-7958f84dbdbd` contains 31 nodes, no validation
warnings and active/draft parity. This hardening changes future failure routing
only; it adds no semantic or field-specific validation.
