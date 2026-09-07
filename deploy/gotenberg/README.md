# Internal Gotenberg service

This compose project runs the HTML-to-PDF converter used by the isolated report workflow candidate.

## Boundaries

- Project name: `tender-pdf`.
- Container: `tender-pdf-gotenberg`.
- Image: `gotenberg/gotenberg:8.36.0-chromium`.
- Pulled image digest recorded on 2026-09-07: `sha256:a40f92d7419adbf98fd2ab2e4211f6186c9fd44f196a5aadbd2769bf237faae6`.
- Network: the existing external Docker network `n8n_default`.
- No host port is published. Only containers on `n8n_default` can call port `3000`.
- Chromium concurrency and queue size are both `1`.
- Container limits: 512 MiB RAM, 0.5 CPU, 128 PIDs, 128 MiB shared memory.
- JavaScript, webhooks, remote downloads, private-IP navigation and public-IP navigation are disabled.

Gotenberg options are passed as CLI flags. Environment variables with the same names are not a supported replacement for these flags in the pinned v8.36.0 image.

## Install or reconcile

Copy `compose.yaml` to `/opt/tender-pdf/compose.yaml`, then run:

```bash
docker compose -p tender-pdf -f /opt/tender-pdf/compose.yaml config -q
docker compose -p tender-pdf -f /opt/tender-pdf/compose.yaml pull gotenberg
docker compose -p tender-pdf -f /opt/tender-pdf/compose.yaml up -d --no-deps gotenberg
docker compose -p tender-pdf -f /opt/tender-pdf/compose.yaml ps
```

This does not edit or recreate the n8n compose project.

## Verify

```bash
docker inspect tender-pdf-gotenberg \
  --format 'cmd={{json .Config.Cmd}} status={{.State.Status}} health={{.State.Health.Status}} memory={{.HostConfig.Memory}} reservation={{.HostConfig.MemoryReservation}} nano_cpus={{.HostConfig.NanoCpus}} pids={{.HostConfig.PidsLimit}} restarts={{.RestartCount}} oom={{.State.OOMKilled}} ports={{json .NetworkSettings.Ports}}'

docker exec n8n-n8n-worker-1 node -e 'fetch("http"+"://tender-pdf-gotenberg:3000/health").then(r=>{console.log("n8n-worker status:",r.status);process.exit(r.ok?0:1)}).catch(e=>{console.error(e.message);process.exit(1)})'

docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.CPUPerc}}\t{{.PIDs}}'
```

Expected steady state after the idle timeout is roughly 20–30 MiB with no Chromium process. A real 598,452-byte report canary completed in 17.7 seconds and produced a 909,642-byte PDF. Because the test server has only about 2 GiB RAM, retain concurrency `1` and do not enable automatic retries without a new resource test.

## Roll back this service only

```bash
docker compose -p tender-pdf -f /opt/tender-pdf/compose.yaml down
```

The command removes only the `tender-pdf` compose project's container. It does not remove the shared `n8n_default` network or any n8n container.
