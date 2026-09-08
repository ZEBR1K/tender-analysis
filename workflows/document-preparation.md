# TENDER — Подготовить документацию

**Тип:** reusable sub-workflow / ingestion preparation

**Workflow ID в n8n:** `0scTZu1aBKsMd6AM`

**Статус:** inactive draft; не подключён к production Orchestrator

**Repository export:** `workflows/n8n-exports/TENDER — Подготовить документацию.json`

## Назначение

Workflow принимает metadata всех вложений одного `analysis_run` и строит полный детерминированный manifest для последующей массовой регистрации документов.

```text
analysis_run_id + attachments
→ классификация всех source attachments
→ прямые PDF/DOCX/XLSX без скачивания
→ последовательная загрузка и распаковка архивов
→ обычные extracted files
→ skipped records для неподдерживаемых файлов и контейнеров
→ единый manifest либо typed failure
```

Он расположен логически между TenderPlan FullInfo и текущей нодой Orchestrator `Зарегистрировать документы`. До подключения caller-контракт Orchestrator остаётся без изменений.

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

Архивы обрабатываются последовательно через `Loop Over Items`, чтобы ограничить нагрузку и прекратить run на первой ошибке. Реальная распаковка выполняется внутренним сервисом `deploy/archive-extractor`; binary обычных файлов этот workflow не скачивает.

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

Каждый `manifest.documents[]` получает новый последовательный `document_index`, source provenance и `ingestion_metadata`. Архив-контейнер и неподдерживаемые entries сохраняются как `skipped`; только PDF/DOCX/XLSX получают `pending`.

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

`failure` также содержит `source_attachment_index` и `extractor_job_id`. Любая ошибка одного архива завершает preparation до регистрации manifest и до запуска первого Worker. Частичный manifest не возвращается.

## Проверка

Локальные regression tests:

```powershell
node --test tests/document-preparation-workflow.test.mjs
```

MCP pin-tests на live n8n:

- execution `14672`: direct PDF + unsupported TXT, success;
- execution `14673`: ZIP с двумя PDF одинакового basename в разных путях + TXT, success;
- execution `14674`: typed `ARCHIVE_TOTAL_TOO_LARGE`, fail-closed output.

В этих execution HTTP Request nodes были заменены pin data. Поэтому они подтверждают Code/IF/Split Out/Loop topology и output contracts, но сами по себе не подтверждают сетевую доступность или реальную распаковку внутренним 7-Zip сервисом.

Production extractor runtime-check от 2026-09-08:

- отдельный Compose-проект развёрнут в `/opt/tender-archive-extractor` как контейнер `tender-archive-extractor`, image `tender-archive-extractor:26.03-1`;
- контейнер `healthy`, `restart_count=0`, без опубликованных host ports, подключён к `n8n_default`;
- health endpoint вернул `tender_archive_extractor_health_v1` из `n8n-n8n-1` и `n8n-n8n-worker-1`;
- реальный ZIP-canary создал manifest для одного файла, download из обоих n8n-контейнеров вернул точные bytes, exact-run cleanup удалил artifact и последующий GET вернул `404`;
- nested-canary `ZIP → 7Z → file` распознал два archive container level, вернул `archive_depth=2`, скачал точные bytes из n8n и был очищен exact-run cleanup;
- IDs, `StartedAt` и restart counts всех восьми существовавших до deployment контейнеров не изменились;
- RAR/TAR/GZIP и реальный TenderPlan archive ещё не проходили runtime-canary; это остаётся отдельным verification gate и не отменяет local regression coverage.

## Следующий интеграционный шаг

После завершения параллельных изменений Orchestrator:

1. применить additive migration `deploy/postgres/migrations/2026-09-07-add-document-ingestion-metadata.sql`;
2. вызвать этот workflow после нормализации TenderPlan attachments;
3. регистрировать все `manifest.documents` одной DB-операцией;
4. запускать Workers только для зарегистрированных документов со статусом `pending`;
5. на `success=false` завершать run как failed и не запускать Workers;
6. очищать artifacts exact-run cleanup после terminal state, сохраняя TTL fallback;
7. выполнить bounded runtime-canary на реальном TenderPlan archive до production activation.
