# Tender archive extractor

Internal-only HTTP service used by `TENDER — Подготовить документацию`. It expands ZIP, 7Z, RAR, TAR and GZIP-family archives with 7-Zip while enforcing path, recursion, size, count and time limits outside the n8n process.

## Runtime contract

- No host port is published; n8n calls `http://tender-archive-extractor:8080` on the external `n8n_default` Docker network.
- The only persistent path is `/opt/tender-archive-extractor/data`, owned by UID/GID `10001` and mounted at `/var/lib/archive-extractor`.
- One extraction may run at a time. Concurrent POST requests receive `503 EXTRACTOR_BUSY`.
- Completed runs are deleted explicitly by Finalization or by the 72-hour TTL cleanup.

## Local checks

```powershell
node --test tests/archive-extractor-core.test.mjs tests/archive-extractor-http.test.mjs tests/archive-extractor-deployment.test.mjs
docker compose -p tender-archive-extractor-test -f deploy/archive-extractor/compose.yaml config -q
docker build -t tender-archive-extractor:test deploy/archive-extractor
```

## Server deployment

Create `/opt/tender-archive-extractor/data` with owner `10001:10001` and mode `0700`, copy this directory to `/opt/tender-archive-extractor`, validate the Compose file, then start only `archive-extractor`. Do not restart n8n, PostgreSQL, Redis, Traefik or other Compose projects.

The service never logs request bodies. Audit manifests contain logical archive paths and hashes; extracted bytes remain in opaque artifact files until exact-run cleanup.
