# Document Preparation Proxy Design

## Problem

Fresh TenderPlan canary for tender `6aa2c2ad5b7165804b8c4ff7` reached
Document Preparation twice. Executions `15734` and `15754` both failed before
run registration while downloading document 1 from `zakupki.mos.ru` with
`ETIMEDOUT`. The two attempts resolved to different service IPs, so the failure
is reproducible at the direct n8n-to-source transport boundary.

The portable legacy Document Worker export contains only the non-secret `=`
proxy placeholder, so it did not provide a usable current credential. The user
supplied the current live proxy out of band. The new
`TENDER — Подготовить документацию` node `Скачать прямой документ` had no proxy
and no node-level retry.

## Approved change

- Keep the existing workflow graph, manifest contract and typed failure path.
- Bind the live direct-document download node to the user-supplied working RU
  proxy.
- Enable n8n node retry with `maxTries=3` and `waitBetweenTries=5000`.
- Keep `onError=continueErrorOutput`, binary output `data`, sequential download
  and all existing size/hash guards unchanged.
- Store only the established non-secret `=` packaging placeholder in the
  portable repository export; never commit or print the proxy URL.
- Do not add a parser, semantic validator or field-specific rule.

## Runtime-discovered continuation

After Document Preparation downloaded and hashed both DOCX files successfully,
Dispatch execution `15815` reproduced the same transport timeout in its separate
`Скачать оригинал` source-staging node. The same proxy/retry settings therefore
apply to that one node as well.

The failed job was still unstarted (`attempts=0`) and unsealed
(`input_manifest_sha256 IS NULL`). Dispatch may reclaim that exact pre-start
state once only when the source HTTP branch has assigned
`AGENTIC_SOURCE_DOWNLOAD_FAILED`, record `prestart_retry_used=true` in its
existing audit JSON and restage under the existing execution-ownership and
SHA-256 guards. Identity, ownership, CAS, seal and other contract failures do
not use this recovery path. The retry is unavailable after a runner start or
manifest seal and cannot repeat indefinitely. Successful Monitor completion
merges its validation summary with prior technical audit instead of replacing
the pre-start retry record.

## Verification

1. A regression test must fail against the current export because the proxy
   placeholder and retry settings are absent.
2. The focused and full repository suites must pass after the minimal export
   change.
3. Validate the live workflow, publish it, and read back exact settings and
   unchanged connections without exposing the proxy.
4. Allow the failed stable mark event to retry automatically and trace the new
   run through source manifest, Codex job, exact 27 FINAL rows, completed run
   and HTML/PDF report.

## Result

The full route completed technically GREEN. Exact execution, job, FINAL and
artifact evidence is recorded in
`evaluations/AGENTIC_MARK_TO_REPORT_CANARY_2026-09-11.md`. No semantic runtime
validator or field-specific rule was introduced.
