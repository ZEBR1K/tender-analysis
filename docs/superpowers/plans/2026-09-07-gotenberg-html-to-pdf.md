# Gotenberg HTML-to-PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an internal, resource-bounded Gotenberg service and convert the existing validated `binary.report_html` artifact into a verified `binary.report_pdf` artifact without regenerating report content.

**Architecture:** Run Gotenberg as a separate Compose project in `/opt/tender-pdf`, attach it to the existing external `n8n_default` network, and expose no host port. Extend only the terminal portion of `TENDER — Генерация отчета` with an HTML upload alias, one HTTP conversion request, and a fail-fast PDF artifact guard; preserve the existing HTML and all upstream analysis contracts.

**Tech Stack:** Docker Compose v5, `gotenberg/gotenberg:8.36.0-chromium`, n8n 2.35.3, n8n HTTP Request 4.4, n8n Code 2, Node.js built-in test runner, PostgreSQL read-only report snapshot.

---

## File map

- Create `deploy/gotenberg/compose.yaml`: reproducible, resource-bounded Gotenberg service definition.
- Create `deploy/gotenberg/README.md`: copy, validate, start, verify, and rollback commands for the server.
- Create `tests/gotenberg-deployment.test.mjs`: static security and resource-boundary regression for the Compose file.
- Create `tests/report-generation-pdf.test.mjs`: workflow topology, HTTP request, binary preservation, PDF signature, and failure regressions.
- Modify `workflows/n8n-exports/TENDER — Генерация отчета.json`: add exactly three terminal PDF nodes and three connections.
- Modify `workflows/report-generation.md`: document the PDF artifact and failure contract.
- Modify `README.md` and `ARCHITECTURE.md`: replace the HTML-only future-work statement with the verified HTML-plus-PDF boundary after runtime proof.
- Modify `TECH_DEBT.md`, `PROJECT_STATUS.md`, and `DEVELOPMENT_LOG.md`: record only the actual verification level reached; preserve unrelated user edits.
- Modify `AGENTS.md`: add the new `deploy/gotenberg/**` artifact category to the project index.

## Safety boundaries

- Never edit `/opt/beget/n8n/docker-compose.yml`.
- Never run `docker compose up` without both `-p tender-pdf` and `-f /opt/tender-pdf/compose.yaml` for Gotenberg operations.
- Never publish Gotenberg with `ports:` or a Traefik label.
- Never prune images, volumes, executions, or build cache as part of this work.
- Never change production n8n, PostgreSQL, credentials, or workflow activation until the isolated service and workflow candidate both pass their gates.
- Stop after each server checkpoint and inspect output before continuing.

### Task 1: Add the isolated Gotenberg deployment artifact

**Files:**
- Create: `tests/gotenberg-deployment.test.mjs`
- Create: `deploy/gotenberg/compose.yaml`
- Create: `deploy/gotenberg/README.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Write the failing deployment contract test**

Create `tests/gotenberg-deployment.test.mjs`:

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..');
const composePath = path.join(repositoryRoot, 'deploy', 'gotenberg', 'compose.yaml');

function loadCompose() {
  return fs.readFileSync(composePath, 'utf8');
}

test('Gotenberg deployment is isolated and resource bounded', () => {
  const compose = loadCompose();

  assert.match(compose, /^name: tender-pdf$/mu);
  assert.match(compose, /image: gotenberg\/gotenberg:8\.36\.0-chromium/u);
  assert.match(compose, /container_name: tender-pdf-gotenberg/u);
  assert.doesNotMatch(compose, /^\s+ports:/mu);
  assert.doesNotMatch(compose, /traefik/u);
  assert.match(compose, /mem_limit: 512m/u);
  assert.match(compose, /mem_reservation: 256m/u);
  assert.match(compose, /cpus: 0\.50/u);
  assert.match(compose, /pids_limit: 128/u);
  assert.match(compose, /shm_size: 128m/u);
  assert.match(compose, /CHROMIUM_MAX_CONCURRENCY: "1"/u);
  assert.match(compose, /CHROMIUM_MAX_QUEUE_SIZE: "1"/u);
  assert.match(compose, /CHROMIUM_IDLE_SHUTDOWN_TIMEOUT: "30s"/u);
  assert.match(compose, /CHROMIUM_DENY_PUBLIC_IPS: "true"/u);
  assert.match(compose, /CHROMIUM_DENY_PRIVATE_IPS: "true"/u);
  assert.match(compose, /CHROMIUM_DISABLE_JAVASCRIPT: "true"/u);
  assert.match(compose, /API_DISABLE_DOWNLOAD_FROM: "true"/u);
  assert.match(compose, /WEBHOOK_DISABLE: "true"/u);
  assert.match(compose, /max-size: "10m"/u);
  assert.match(compose, /max-file: "3"/u);
  assert.match(compose, /external: true/u);
  assert.match(compose, /name: n8n_default/u);
});
```

- [ ] **Step 2: Run the deployment test and confirm RED**

Run:

```powershell
node --test tests/gotenberg-deployment.test.mjs
```

Expected: FAIL with `ENOENT` for `deploy/gotenberg/compose.yaml`.

- [ ] **Step 3: Create the minimal Compose file**

Create `deploy/gotenberg/compose.yaml` exactly as follows:

```yaml
name: tender-pdf

services:
  gotenberg:
    image: gotenberg/gotenberg:8.36.0-chromium
    container_name: tender-pdf-gotenberg
    restart: unless-stopped
    mem_limit: 512m
    mem_reservation: 256m
    cpus: 0.50
    pids_limit: 128
    shm_size: 128m
    oom_score_adj: 500
    stop_grace_period: 30s
    environment:
      API_TIMEOUT: "120s"
      API_BODY_LIMIT: "5MB"
      API_DISABLE_DOWNLOAD_FROM: "true"
      WEBHOOK_DISABLE: "true"
      CHROMIUM_MAX_CONCURRENCY: "1"
      CHROMIUM_MAX_QUEUE_SIZE: "1"
      CHROMIUM_AUTO_START: "false"
      CHROMIUM_START_TIMEOUT: "30s"
      CHROMIUM_IDLE_SHUTDOWN_TIMEOUT: "30s"
      CHROMIUM_DENY_PUBLIC_IPS: "true"
      CHROMIUM_DENY_PRIVATE_IPS: "true"
      CHROMIUM_DISABLE_JAVASCRIPT: "true"
      CHROMIUM_CLEAR_CACHE: "true"
      CHROMIUM_CLEAR_COOKIES: "true"
      CHROMIUM_CLEAR_STORAGE: "true"
      TZ: Europe/Moscow
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    healthcheck:
      test: ["CMD", "curl", "--fail", "--silent", "http://localhost:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
    networks:
      n8n_default:
        aliases:
          - tender-pdf-gotenberg

networks:
  n8n_default:
    external: true
    name: n8n_default
```

- [ ] **Step 4: Create the operator runbook**

Create `deploy/gotenberg/README.md` with the exact server path, staged commands from Task 2, expected checks, and rollback command. State that the file contains no credentials and that `/opt/beget/n8n/docker-compose.yml` must not be edited.

- [ ] **Step 5: Add the deployment category to the project index**

Under the maintenance section of `AGENTS.md`, add:

```markdown
| `deploy/gotenberg/**` | Isolated internal HTML-to-PDF service definition and operator runbook; not part of the n8n Compose project. |
```

- [ ] **Step 6: Run focused tests and inspect the diff**

Run:

```powershell
node --test tests/gotenberg-deployment.test.mjs
git diff --check
git diff -- deploy/gotenberg tests/gotenberg-deployment.test.mjs AGENTS.md
```

Expected: one passing test, no whitespace errors, and no unrelated file changes in the diff.

- [ ] **Step 7: Commit the deployment artifact**

```powershell
git add -- deploy/gotenberg/compose.yaml deploy/gotenberg/README.md tests/gotenberg-deployment.test.mjs AGENTS.md
git commit -m "infra(report): add isolated Gotenberg service"
```

### Task 2: Install only the Gotenberg service on the server

**Server files:**
- Create: `/opt/tender-pdf/compose.yaml`
- Do not modify: `/opt/beget/n8n/docker-compose.yml`

- [ ] **Step 1: Capture the pre-install container state**

Run on the Ubuntu server:

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Networks}}'
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.CPUPerc}}\t{{.PIDs}}'
df -h /
```

Expected: the existing n8n containers remain healthy; root has at least 4 GiB free before the image pull.

- [ ] **Step 2: Create the isolated directory**

```bash
install -d -m 0755 /opt/tender-pdf
```

Expected: `ls -ld /opt/tender-pdf` shows the new directory and does not change `/opt/beget/n8n`.

- [ ] **Step 3: Copy the reviewed Compose file**

Open the server file:

```bash
nano /opt/tender-pdf/compose.yaml
```

Paste the exact contents of repository file `deploy/gotenberg/compose.yaml`, save, and exit.

- [ ] **Step 4: Validate without creating containers**

```bash
docker compose -p tender-pdf -f /opt/tender-pdf/compose.yaml config -q
docker compose -p tender-pdf -f /opt/tender-pdf/compose.yaml config --services
```

Expected: the first command exits silently with code `0`; the second prints only `gotenberg`.

- [ ] **Step 5: Pull only the pinned Chromium image**

```bash
docker compose -p tender-pdf -f /opt/tender-pdf/compose.yaml pull gotenberg
```

Expected: only `gotenberg/gotenberg:8.36.0-chromium` is pulled. Do not run any prune command.

- [ ] **Step 6: Record the immutable image digest**

```bash
docker image inspect gotenberg/gotenberg:8.36.0-chromium --format '{{index .RepoDigests 0}}'
```

Expected: one `gotenberg/gotenberg@sha256:...` value. Record it in the deployment verification notes; do not replace the reviewed Compose image until the first canary passes.

- [ ] **Step 7: Start only the new service**

```bash
docker compose -p tender-pdf -f /opt/tender-pdf/compose.yaml up -d --no-deps gotenberg
```

Expected: Compose creates or starts only `tender-pdf-gotenberg`.

- [ ] **Step 8: Verify isolation and resource limits**

```bash
docker compose -p tender-pdf -f /opt/tender-pdf/compose.yaml ps
docker inspect --format 'name={{.Name}} memory={{.HostConfig.Memory}} reservation={{.HostConfig.MemoryReservation}} nano_cpus={{.HostConfig.NanoCpus}} pids={{.HostConfig.PidsLimit}} ports={{json .NetworkSettings.Ports}} networks={{json .NetworkSettings.Networks}}' tender-pdf-gotenberg
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Networks}}'
```

Expected:

```text
tender-pdf-gotenberg = healthy
memory = 536870912
reservation = 268435456
nano_cpus = 500000000
pids = 128
3000/tcp has no host binding
network includes n8n_default
existing n8n container uptimes are unchanged
```

- [ ] **Step 9: Stop on any mismatch**

If Gotenberg is unhealthy, has a host port, or any existing container restarted, run only:

```bash
docker compose -p tender-pdf -f /opt/tender-pdf/compose.yaml down
```

Then inspect `docker logs --tail 200 tender-pdf-gotenberg` only if the container still exists. Do not restart n8n.

### Task 3: Run an isolated conversion canary

**Server state:**
- Read/execute only inside `n8n-n8n-1` and `tender-pdf-gotenberg`.
- Do not modify n8n workflows.

- [ ] **Step 1: Verify health from the same Docker network as n8n**

```bash
docker exec n8n-n8n-1 node -e "fetch('http://tender-pdf-gotenberg:3000/health').then(async r=>{const t=await r.text();if(!r.ok)throw new Error('health '+r.status);console.log(t)}).catch(e=>{console.error(e.message);process.exit(1)})"
```

Expected: JSON with `status` equal to `up`.

- [ ] **Step 2: Convert a self-contained Cyrillic HTML without writing a file**

```bash
docker exec n8n-n8n-1 node -e "const f=new FormData();const h='<!doctype html><html lang=\"ru\"><meta charset=\"utf-8\"><style>@page{size:A4;margin:10mm}body{font-family:Arial,sans-serif}h1{color:#12633a}</style><h1>Проверка PDF</h1><p>Тендерный отчёт</p></html>';f.append('files',new Blob([h],{type:'text/html'}),'index.html');f.append('paperWidth','8.27');f.append('paperHeight','11.7');f.append('printBackground','true');fetch('http://tender-pdf-gotenberg:3000/forms/chromium/convert/html',{method:'POST',body:f}).then(async r=>{const b=Buffer.from(await r.arrayBuffer());if(!r.ok)throw new Error('convert '+r.status+' '+b.toString('utf8'));if(b.subarray(0,5).toString('ascii')!=='%PDF-')throw new Error('missing PDF signature');console.log(JSON.stringify({status:r.status,contentType:r.headers.get('content-type'),bytes:b.length,signature:b.subarray(0,5).toString('ascii')}))}).catch(e=>{console.error(e.message);process.exit(1)})"
```

Expected: status `200`, content type `application/pdf`, positive byte count, signature `%PDF-`.

- [ ] **Step 3: Measure the bounded impact**

Run immediately after the canary:

```bash
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.CPUPerc}}\t{{.PIDs}}'
free -h
docker inspect --format 'oom_killed={{.State.OOMKilled}} restart_count={{.RestartCount}} health={{.State.Health.Status}}' tender-pdf-gotenberg
```

Expected: Gotenberg remains below 512 MiB, `oom_killed=false`, `restart_count=0`, and n8n containers remain healthy. If Gotenberg OOMs, stop it and require a server RAM increase; do not increase the container limit on the 2 GiB host.

- [ ] **Step 4: Verify Chromium releases idle memory**

Wait at least 40 seconds after the conversion, then run:

```bash
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.CPUPerc}}\t{{.PIDs}}'
```

Expected: Gotenberg idle memory drops after the configured 30-second Chromium shutdown.

### Task 4: Add offline workflow regressions

**Files:**
- Create: `tests/report-generation-pdf.test.mjs`
- Read: `workflows/n8n-exports/TENDER — Генерация отчета.json`

- [ ] **Step 1: Write a RED topology and HTTP contract test**

The test must load the canonical report export and require exactly these new nodes:

```text
Подготовить HTML для Gotenberg
Конвертировать HTML в PDF
Проверить PDF artifact
```

It must assert:

```text
Создать HTML artifact → Подготовить HTML для Gotenberg
Подготовить HTML для Gotenberg → Конвертировать HTML в PDF
Конвертировать HTML в PDF → Проверить PDF artifact
```

It must require HTTP Request node version `4.4`, URL `http://tender-pdf-gotenberg:3000/forms/chromium/convert/html`, `multipart-form-data`, binary form field `files` from `gotenberg_html`, file response property `report_pdf`, timeout `120000`, `neverError=false`, and no retry settings.

- [ ] **Step 2: Add executable Code-node tests**

Use an async VM harness:

```js
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function runCodeNode(jsCode, { inputItem, nodeItems = {}, buffers = {} }) {
  const execute = new AsyncFunction('$input', '$', 'Buffer', jsCode);
  return execute.call(
    {
      helpers: {
        getBinaryDataBuffer: async (_itemIndex, property) => buffers[property],
      },
    },
    { first: () => structuredClone(inputItem) },
    (name) => ({ item: structuredClone(nodeItems[name]) }),
    Buffer,
  );
}
```

Cover these exact cases:

- validated HTML becomes a `gotenberg_html` alias named `index.html` while `report_html` stays unchanged;
- invalid/missing `report_html` fails before HTTP;
- `%PDF-` response produces `report_pdf` with the original basename and `.pdf`;
- final output contains only `report_html` and `report_pdf`, not the upload alias;
- missing signature, empty PDF, wrong MIME, or lost HTML fails;
- renderer hashes remain unchanged:
  - `Сгенерировать HTML1`: `e0df597cbe8b3a44dcb1a3a1a38ce6301274e0053f89e6634c1ae31ec1425f3d`
  - `Создать HTML artifact`: `3f7544fc855abd0c9164b86094b5aa07676a76cc993bc57b225fe5c0d0150305`

- [ ] **Step 3: Run the focused test and confirm RED**

```powershell
node --test tests/report-generation-pdf.test.mjs
```

Expected: FAIL because the three PDF nodes do not exist.

- [ ] **Step 4: Commit the RED regression**

```powershell
git add -- tests/report-generation-pdf.test.mjs
git commit -m "test(report): require verified PDF artifact"
```

### Task 5: Implement the minimal workflow extension

**Files:**
- Modify: `workflows/n8n-exports/TENDER — Генерация отчета.json`
- Test: `tests/report-generation-pdf.test.mjs`

- [ ] **Step 1: Add `Подготовить HTML для Gotenberg`**

Use Code node version 2 with this JavaScript:

```js
const input = $input.first();
const reportHtml = input.binary?.report_html;

if (input.json?.artifact_validation?.valid !== true) {
  throw new Error('[Подготовить HTML для Gotenberg] REPORT_HTML_NOT_VALIDATED');
}
if (!reportHtml || reportHtml.mimeType !== 'text/html') {
  throw new Error('[Подготовить HTML для Gotenberg] REPORT_HTML_BINARY_INVALID');
}
if (typeof reportHtml.fileName !== 'string' || !/\.html$/i.test(reportHtml.fileName)) {
  throw new Error('[Подготовить HTML для Gotenberg] REPORT_HTML_FILENAME_INVALID');
}

const pdfFilename = reportHtml.fileName.replace(/\.html$/i, '.pdf');

return [{
  json: {
    ...input.json,
    pdf_filename: pdfFilename,
    pdf_mime_type: 'application/pdf',
  },
  binary: {
    ...input.binary,
    gotenberg_html: {
      ...reportHtml,
      fileName: 'index.html',
      fileExtension: 'html',
      mimeType: 'text/html',
    },
  },
}];
```

- [ ] **Step 2: Add `Конвертировать HTML в PDF`**

Use `n8n-nodes-base.httpRequest` version `4.4`. Configure POST, the internal Gotenberg URL, multipart form data, `files` from `gotenberg_html`, A4 fields from the design, response format `file`, output property `report_pdf`, timeout `120000`, `Never Error=false`, and retry disabled.

- [ ] **Step 3: Add `Проверить PDF artifact`**

Use Code node version 2 with this JavaScript:

```js
const response = $input.first();
const prepared = $('Подготовить HTML для Gotenberg').item;
const reportHtml = prepared.binary?.report_html;
const reportPdf = response.binary?.report_pdf;

if (!reportHtml || reportHtml.mimeType !== 'text/html') {
  throw new Error('[Проверить PDF artifact] REPORT_HTML_BINARY_LOST');
}
if (!reportPdf) {
  throw new Error('[Проверить PDF artifact] REPORT_PDF_BINARY_MISSING');
}

const pdfBuffer = await this.helpers.getBinaryDataBuffer(0, 'report_pdf');
const signature = pdfBuffer.subarray(0, 5).toString('ascii');

if (pdfBuffer.length <= 5 || signature !== '%PDF-') {
  throw new Error('[Проверить PDF artifact] REPORT_PDF_SIGNATURE_INVALID');
}
if (reportPdf.mimeType !== 'application/pdf') {
  throw new Error('[Проверить PDF artifact] REPORT_PDF_MIME_INVALID');
}
if (typeof prepared.json?.pdf_filename !== 'string' || !/\.pdf$/i.test(prepared.json.pdf_filename)) {
  throw new Error('[Проверить PDF artifact] REPORT_PDF_FILENAME_INVALID');
}

return [{
  json: {
    ...prepared.json,
    pdf_artifact_validation: {
      valid: true,
      property: 'report_pdf',
      size_bytes: pdfBuffer.length,
      signature,
      source_property: 'report_html',
    },
  },
  binary: {
    report_html: reportHtml,
    report_pdf: {
      ...reportPdf,
      mimeType: 'application/pdf',
      fileName: prepared.json.pdf_filename,
      fileExtension: 'pdf',
    },
  },
}];
```

- [ ] **Step 4: Connect only the terminal chain**

Replace the current terminal edge with:

```text
Сгенерировать HTML1
→ Создать HTML artifact
→ Подготовить HTML для Gotenberg
→ Конвертировать HTML в PDF
→ Проверить PDF artifact
```

Do not change the eight upstream edges or any existing node parameters.

- [ ] **Step 5: Run focused and full regressions**

```powershell
node --test tests/report-generation-pdf.test.mjs
node --test tests/gotenberg-deployment.test.mjs
node --test
git diff --check
```

Expected: focused tests pass; the full suite introduces no new failure signature. Any pre-existing dirty-worktree baseline failures must be reported separately and must not be fixed in this task.

- [ ] **Step 6: Inspect the exact workflow diff**

```powershell
git diff -- 'workflows/n8n-exports/TENDER — Генерация отчета.json' tests/report-generation-pdf.test.mjs
```

Expected: exactly three nodes, three connections, and the regression file; the two renderer hashes remain unchanged.

- [ ] **Step 7: Commit the workflow candidate**

```powershell
git add -- 'workflows/n8n-exports/TENDER — Генерация отчета.json' tests/report-generation-pdf.test.mjs
git commit -m "feat(report): convert validated HTML to PDF"
```

### Task 6: Validate in n8n without production promotion

**n8n artifact:**
- Import or apply the local candidate as an inactive test copy or unpublished draft.
- Do not publish the production workflow in this task.

- [ ] **Step 1: Verify live baseline again with read-only access**

Fetch workflow `ckPnP3hRhKu4Mf9u` and require active version `9d095af6-b60d-4ad9-8061-432201ec0e8e` unless the user explicitly reports a newer reviewed version. If it changed, stop and reconcile the conflict before applying the candidate.

- [ ] **Step 2: Import the candidate into an isolated test workflow**

Keep PostgreSQL read-only snapshot behavior and existing credential references. Do not change the production workflow ID or active version. Verify the imported test workflow has 12 nodes and the exact terminal connections.

- [ ] **Step 3: Run a saved completed `analysis_run_id`**

Use a previously approved completed report snapshot. The execution must reach `Проверить PDF artifact` and return:

```text
artifact_validation.valid = true
pdf_artifact_validation.valid = true
binary.report_html
binary.report_pdf
```

- [ ] **Step 4: Download and verify the PDF**

Save the candidate PDF under `output/pdf/` locally. Before authoring/inspection, follow the PDF skill operation marker requirement. Verify with `pdfinfo`, extract text with `pdftotext` or `pdfplumber`, render every page with `pdftoppm`, and visually inspect the PNGs for clipping, overlapping rows, missing Cyrillic glyphs, missing backgrounds, and broken page transitions.

- [ ] **Step 5: Observe production-server resources during the real report**

```bash
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.CPUPerc}}\t{{.PIDs}}'
free -h
docker inspect --format 'oom_killed={{.State.OOMKilled}} restart_count={{.RestartCount}} health={{.State.Health.Status}}' tender-pdf-gotenberg
```

Expected: no OOM, no restart, Gotenberg below 512 MiB, and all existing n8n services remain healthy.

- [ ] **Step 6: Exercise a converter failure**

In the isolated test copy only, temporarily point the HTTP node to an unused internal hostname. Run it and require a failed Report execution. Restore the reviewed URL immediately. Do not perform this negative test in the active production workflow.

### Task 7: Document verified behavior and decide promotion

**Files:**
- Modify: `workflows/report-generation.md`
- Modify: `README.md`
- Modify: `ARCHITECTURE.md`
- Modify carefully around user changes: `PROJECT_STATUS.md`, `TECH_DEBT.md`, `DEVELOPMENT_LOG.md`

- [ ] **Step 1: Update factual report documentation**

Document the three new nodes, `report_pdf`, the internal Gotenberg dependency, A4 settings, both artifact validations, and explicit failure semantics. Remove PDF from future work only after the real runtime and visual gates pass.

- [ ] **Step 2: Record verification state precisely**

If only offline tests pass, say `offline candidate`; if the isolated n8n run passes, say `isolated runtime GREEN`; only after an active production execution may documentation say `production verified`. Do not imply that PDF correctness validates the semantic correctness of the 27 fields.

- [ ] **Step 3: Run final verification**

```powershell
node --test tests/gotenberg-deployment.test.mjs tests/report-generation-pdf.test.mjs
node --test
git diff --check
git status --short
```

Expected: no new failures and only scoped report/deployment files plus pre-existing user changes.

- [ ] **Step 4: Commit documentation separately**

```powershell
git add -- workflows/report-generation.md README.md ARCHITECTURE.md PROJECT_STATUS.md TECH_DEBT.md DEVELOPMENT_LOG.md
git commit -m "docs(report): record HTML-to-PDF pipeline"
```

- [ ] **Step 5: Present the production promotion gate**

Before production activation, show the exact workflow/version diff, isolated execution ID, PDF page count, artifact sizes, resource measurements, and rollback workflow version. Production publication remains a separate explicit user-approved action.
