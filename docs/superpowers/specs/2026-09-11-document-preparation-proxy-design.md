# Document Preparation Proxy Design

## Problem

Fresh TenderPlan canary for tender `6aa2c2ad5b7165804b8c4ff7` reached
Document Preparation twice. Executions `15734` and `15754` both failed before
run registration while downloading document 1 from `zakupki.mos.ru` with
`ETIMEDOUT`. The two attempts resolved to different service IPs, so the failure
is reproducible at the direct n8n-to-source transport boundary.

The legacy Document Worker download node has a working RU proxy configured.
The new `TENDER — Подготовить документацию` node `Скачать прямой документ`
has no proxy and no node-level retry.

## Approved change

- Keep the existing workflow graph, manifest contract and typed failure path.
- Bind the live direct-document download node to the already stored working RU
  proxy used by the legacy Worker.
- Enable n8n node retry with `maxTries=3` and `waitBetweenTries=5000`.
- Keep `onError=continueErrorOutput`, binary output `data`, sequential download
  and all existing size/hash guards unchanged.
- Store only the established non-secret `=` packaging placeholder in the
  portable repository export; never commit or print the proxy URL.
- Do not add a parser, semantic validator or field-specific rule.

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

