# Cyrillic artifact filename fix — 2026-09-12

## Reproduced failure

The artifact GET route passed a Cyrillic source name directly to the legacy
quoted `filename=` parameter. Node.js rejected that HTTP header with
`ERR_INVALID_CHAR`, returning HTTP 500 before n8n could download the stored
source.

The regression test reproduced the boundary as HTTP `500 !== 200` before the
implementation changed.

## Minimal change

The archive extractor now returns a deterministic ASCII fallback in
`filename=` and the sanitized original name as RFC 5987 UTF-8 in `filename*`.
No source bytes, manifest values, workflow, database contract, or Codex semantic
rule changed.

## Verification

- Focused Cyrillic regression: `1/1` pass after the fix.
- Archive extractor suite: `25/25` pass.
- Full repository suite: `792` pass, `0` fail, `6` platform/runtime skips.
- Docker Compose configuration: valid.
- Local Docker build was unavailable because Docker Desktop was not running.
- The image was built successfully on the deployment server and only
  `tender-archive-extractor` was recreated.
- Post-deployment state: `running`, `healthy`, restart count `0`.
- Local source, server source, and running-container source have identical
  SHA-256 `bbb751904755f838fde016eb73fad740b114a5f9195ca5e964a8f7f896f7cd13`.
- A disposable live smoke uploaded and downloaded
  `Проверка кириллического имени.txt`; HTTP status was 200, the RFC 5987 name
  decoded exactly to the original Cyrillic value, and body SHA-256 matched.
- The disposable run and staging directory were deleted. The previous image and
  previous `server.mjs` remain backed up for rollback.
- n8n main and worker retained their existing container identities and remained
  healthy; PostgreSQL and other services were not recreated.
