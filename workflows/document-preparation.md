# TENDER — Подготовить документацию

**Тип:** reusable sub-workflow / ingestion preparation

**Workflow ID в n8n:** `0scTZu1aBKsMd6AM`

**Статус:** inactive repository candidate; подключён в inactive canonical Orchestrator export, production deployment не выполнен

**Repository export:** `workflows/n8n-exports/TENDER — Подготовить документацию.json`

## Назначение

Workflow принимает metadata всех вложений одного `analysis_run` и строит полный детерминированный manifest для последующей массовой регистрации документов.

```text
analysis_run_id + attachments
→ классификация всех source attachments
→ последовательная загрузка прямых PDF/DOCX/XLSX
→ byte size + MIME + SHA-256 исходных bytes
→ последовательная загрузка и распаковка архивов
→ обычные extracted files
→ skipped records для неподдерживаемых файлов и контейнеров
→ единый manifest либо typed failure
```

В canonical repository export Orchestrator вызывает workflow один раз после TenderPlan normalization и до единственного atomic run/document INSERT. Caller синхронно ждёт полный manifest; typed failure или invalid contract останавливают путь до создания run и до первого Worker. Это repository-only изменение: live deployment и runtime verification не выполнялись.

## Входной контракт

Execute Workflow Trigger принимает:

```text
analysis_run_id: string UUID
attachments: array
```

Каждый attachment должен иметь уникальный положительный `document_index`. Для архива обязателен `download_url`; при известном `source_size` значение проверяется до загрузки.

## Поддерживаемые типы

Напрямую в Worker:

```text
pdf / docx / xlsx
```

Архивы:

```text
zip / 7z / rar / tar / gz / tar.gz / tgz
```

Все остальные файлы сохраняются в manifest со статусом `skipped` и `skip_reason=unsupported_file_type`.

## Лимиты и безопасность

```text
source archive: 100 MiB
one extracted file: 50 MiB
all extracted bytes per source archive: 300 MiB
entries per source archive: 500
nested archive depth: 3
deadline per source archive: 5 minutes
```

Прямые документы и архивы обрабатываются отдельными последовательными `Loop Over Items` с `batchSize=1`, чтобы ограничить нагрузку и прекратить run на первой ошибке. Для прямого документа HTTP Request держит тело только в `binary.data`; Code node читает bytes только для размера, а native Crypto node вычисляет SHA-256. Binary не переносится в JSON/manifest. Реальная распаковка архивов выполняется внутренним сервисом `deploy/archive-extractor`.

Extractor отклоняет абсолютные, UNC, drive, URI, `.`/`..`, control/NUL paths, normalized collisions, symlink, hardlink и special entries. Антивирусная проверка не предусмотрена по принятому scope.

## Выходной контракт

Успех:

```json
{
  "success": true,
  "schema_version": "tender_document_ingestion_v1",
  "analysis_run_id": "<uuid>",
  "manifest": {
    "documents": []
  }
}
```

Каждый `manifest.documents[]` получает новый последовательный `document_index`, source provenance и `ingestion_metadata`. Каждый `pending` PDF/DOCX/XLSX обязан иметь непустые `file_name`, `mime_type`, целый неотрицательный `file_size` и 64-hex `ingestion_metadata.content_sha256`. Архив-контейнер и неподдерживаемые entries сохраняются как `skipped` и не dispatch-ятся.

Ошибка:

```json
{
  "success": false,
  "schema_version": "tender_document_ingestion_v1",
  "analysis_run_id": "<uuid>",
  "failure": {
    "error_code": "<typed code>",
    "error_message": "<safe message>
  }
}
```

`failure` также содержит `source_attachment_index` и `extractor_job_id`. Любая ошибка direct download/hash или одного архива завершает preparation до регистрации manifest и до запуска первого Worker. Частичный manifest не возвращается.

## Проверка

Локальные regression tests:

```powershell
node --test tests/document-preparation-workflow.test.mjs
```

MCP pin-tests на live n8n:

- execution `14672`: direct PDF + unsupported TXT, success;
- execution `14673`: ZIP с двумя PDF одинакового basename в разных путях + TXT, success;
- execution `14674`: typed `ARCHIVE_TOTAL_TOO_LARGE`, fail-closed output.

Эти executions относятся к предыдущему archive-only draft: HTTP Request nodes были заменены pin data. Они не подтверждают новый direct download/hash path, текущую Orchestrator integration или сетевую доступность внутреннего 7-Zip сервиса.

Production extractor runtime-check от 2026-09-08:

- отдельный Compose-проект развёрнут в `/opt/tender-archive-extractor` как контейнер `tender-archive-extractor`, image `tender-archive-extractor:26.03-1`;
- контейнер `healthy`, `restart_count=0`, без опубликованных host ports, подключён к `n8n_default`;
- health endpoint вернул `tender_archive_extractor_health_v1` из `n8n-n8n-1` и `n8n-n8n-worker-1`;
- реальный ZIP-canary создал manifest для одного файла, download из обоих n8n-контейнеров вернул точные bytes, exact-run cleanup удалил artifact и последующий GET вернул `404`;
- nested-canary `ZIP → 7Z → file` распознал два archive container level, вернул `archive_depth=2`, скачал точные bytes из n8n и был очищен exact-run cleanup;
- IDs, `StartedAt` и restart counts всех восьми существовавших до deployment контейнеров не изменились;
- RAR/TAR/GZIP и реальный TenderPlan archive ещё не проходили runtime-canary; это остаётся отдельным verification gate и не отменяет local regression coverage.

## Оставшиеся rollout-шаги

1. применить additive migration `deploy/postgres/migrations/2026-09-07-add-document-ingestion-metadata.sql`;
2. импортировать согласованные inactive Orchestrator, Preparation, Worker и Intake Resume exports;
3. оставить вызов preparation синхронным и запускать Workers только для зарегистрированных документов со статусом `pending`;
4. на `success=false` не создавать run и не запускать Workers;
5. очищать artifacts exact-run cleanup после terminal state, сохраняя TTL fallback;
6. выполнить bounded runtime-canary для direct file и реального TenderPlan archive до production activation.
