# Archive Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** добавить перед Document Worker детерминированную подготовку вложений, которая раскрывает архивы, регистрирует полный набор документов и не допускает частичного анализа при ошибке распаковки.

**Architecture:** Orchestrator перед регистрацией документов вызывает отдельный preparation sub-workflow. Тот скачивает только архивы, передаёт их внутреннему Docker-сервису с 7-Zip, строит полный manifest и после успешной подготовки атомарно регистрирует документы; прямые PDF/DOCX/XLSX сохраняют исходные URL. Извлечённые файлы временно доступны Worker по внутренним URL и удаляются после terminal state run.

**Tech Stack:** n8n, PostgreSQL, Docker Compose, 7-Zip, внутренний HTTP API, Node.js regression tests.

**Plan level:** логический план без проектирования конкретных n8n-нод и их параметров. Node-by-node change set составляется отдельным шагом после утверждения этой спецификации.

---

## Карта будущих изменений

Ожидаемые зоны изменений:

```text
deploy/archive-extractor/**
tests/archive-extractor-*.test.mjs
tests/orchestrator-archive-ingestion.test.mjs
workflows/n8n-exports/ТЕНДЕРЫ ОРКЕСТРАТОР.json
workflows/n8n-exports/TENDER — Обработать документ.json
новый export TENDER — Подготовить документацию.json
workflows/orchestrator.md
workflows/document-worker.md
DATA_MODEL.md
ARCHITECTURE.md
README.md
PROJECT_STATUS.md
TECH_DEBT.md
DEVELOPMENT_LOG.md
```

Точный список документации обновляется только после фактического изменения поведения. `FIELD_CATALOG.md` и prompts не меняются.

### Task 1: Зафиксировать regression baseline и контракты

- [ ] Снять `git status` и отделить существующие пользовательские изменения от scope этой задачи.
- [ ] Повторно сравнить canonical Orchestrator/Worker exports с live read-only n8n. При расхождении считать live workflow authoritative и остановить проектирование diff до reconciliation.
- [ ] Зафиксировать текущий upstream attachment contract TenderPlan и downstream input contract Document Worker.
- [ ] Добавить RED regression на текущий дефект: archive attachment не создаёт processable leaf documents.
- [ ] Добавить RED regression на `OR-0`: `skipped` не входит в текущий terminal readiness barrier.
- [ ] Выполнить существующие Orchestrator/Worker tests и сохранить baseline failures отдельно от новых.

**Gate:** подтверждены точные текущие contracts и две новые проверки падают только из-за отсутствующей archive ingestion semantics.

### Task 2: Зафиксировать persistence и migration contract

- [ ] Подготовить additive migration для `tender_analysis_documents.ingestion_metadata jsonb NOT NULL DEFAULT '{}'::jsonb`.
- [ ] Зафиксировать schema `tender_document_ingestion_v1`, допустимые `artifact_kind` и обязательные provenance fields.
- [ ] Зафиксировать детерминированное упорядочивание source attachments и archive entries.
- [ ] Добавить DB-level regression на повторный UPSERT одного manifest без дубликатов `(analysis_run_id, document_index)`.
- [ ] Добавить regression на сохранение разных файлов с одинаковым basename.
- [ ] Проверить migration на пустой и заполненной локальной fixture DB без изменения существующих строк.

**Gate:** migration обратимо добавляет audit metadata, старые документы остаются валидными с `{}`, повторная регистрация manifest идемпотентна.

### Task 3: Реализовать изолированный archive-extractor

- [ ] Создать отдельный сервисный пакет и Compose project, не изменяя существующий n8n Compose project.
- [ ] Установить и pin версию 7-Zip внутри образа.
- [ ] Реализовать внутренний health contract.
- [ ] Реализовать idempotent extraction job по `analysis_run_id + source_attachment_key`.
- [ ] Реализовать приём одного archive binary и возврат versioned JSON manifest.
- [ ] Реализовать выдачу опубликованного leaf artifact по opaque `artifact_id` только во внутренней Docker-сети.
- [ ] Реализовать cleanup всего workspace по `analysis_run_id` и TTL-cleanup orphaned workspaces.
- [ ] Запретить публикацию host port, запуск от root и доступ к каталогам за пределами выделенной папки.
- [ ] Ограничить concurrency одной распаковкой и задать обязательные CPU, memory и process limits после server capacity check.

**Gate:** сервис изолирован от n8n, не доступен снаружи, переживает собственный restart без потери уже опубликованного job и удаляет только workspace точного run.

### Task 4: Реализовать безопасную рекурсивную распаковку

- [ ] Определять фактический archive format по содержимому и сверять его с заявленным типом.
- [ ] Поддержать ZIP, 7Z и RAR как обязательные форматы.
- [ ] Включить TAR, GZ, TAR.GZ и TGZ через тот же 7-Zip path.
- [ ] Перед извлечением отклонять absolute/UNC/drive/URI paths, `.`/`..`, NUL, links и special entries.
- [ ] После извлечения повторно проверить, что каждый filesystem object находится внутри workspace и является обычным файлом или каталогом.
- [ ] Отклонять path collisions после нормализации Unicode и регистра.
- [ ] Выполнять рекурсию до трёх уровней включительно.
- [ ] Контролировать лимиты во время записи: archive 100 МБ, leaf 50 МБ, unpacked total 300 МБ, 500 entries, 5 минут.
- [ ] При любой ошибке удалять partial output и возвращать один typed terminal error.
- [ ] Вычислять SHA-256 для каждого опубликованного leaf artifact.

**Gate:** corpus-тесты подтверждают корректный manifest и отсутствие partial publication для всех success/failure cases.

### Task 5: Построить preparation sub-workflow

- [ ] Создать отдельный stateful sub-workflow с явным JSON input/output contract и описанием side effects.
- [ ] Передавать через него metadata всех source attachments.
- [ ] Для прямых PDF/DOCX/XLSX сформировать passthrough records без скачивания binary.
- [ ] Для archive candidates скачать binary существующим TenderPlan/proxy path и передать extractor service.
- [ ] Объединить direct records, archive containers, extracted leaves и unsupported records в один manifest.
- [ ] Назначить `pending` только текущим Worker-supported документам.
- [ ] Назначить `skipped/unsupported_file_type` неподдерживаемым обычным файлам.
- [ ] Назначить `skipped/archive_container_expanded` успешно раскрытым archive containers.
- [ ] При нуле processable documents вернуть terminal `NO_PROCESSABLE_DOCUMENTS`.
- [ ] При ошибке любого архива прекратить подготовку всего run и не возвращать partial success.

**Gate:** sub-workflow детерминированно возвращает либо полный `tender_document_ingestion_v1`, либо typed failure; binary прямых документов через него не проходит.

### Task 6: Встроить preparation gate в Orchestrator

- [ ] Разместить preparation после создания `analysis_run` и до финальной регистрации полного набора документов.
- [ ] На success path регистрировать весь manifest и `documents_total` одной DB-транзакцией.
- [ ] Проверять `registered = documents_total` до первого Worker dispatch.
- [ ] Запускать Worker только для `pending` records после успешного commit.
- [ ] На preparation failure зарегистрировать исходные attachments для audit, пометить проблемный архив `failed`, остальные необработанные source records — `skipped/run_aborted_during_preparation`.
- [ ] На failure path атомарно перевести run в `failed`, сохранить typed run-level error и гарантировать нулевой Worker dispatch.
- [ ] Добавить workflow-level и per-operation error routing без silent branch termination.
- [ ] Сохранить существующий happy path тендера без архивов.

**Gate:** ни один Worker не может стартовать до успешного полного manifest commit; ошибка одного архива останавливает весь run.

### Task 7: Обновить terminal readiness semantics

- [ ] Заменить условие `completed = documents_total` на явный terminal barrier из спецификации.
- [ ] Требовать `pending = 0`, `processing = 0`, `failed = 0`.
- [ ] Требовать `completed + skipped = documents_total` и `completed > 0`.
- [ ] Сохранить atomic single-winner claim перехода в `ready_for_aggregation`.
- [ ] Проверить, что archive containers и unsupported files не попадают в Worker или Aggregator candidates.
- [ ] Добавить regressions на несколько одновременно завершившихся Workers и единственный запуск Aggregator.

**Gate:** mixed completed/skipped run завершается; failed/pending/processing или zero-completed run не проходит barrier.

### Task 8: Реализовать lifecycle cleanup

- [ ] Запускать cleanup только после terminal `analysis_run.status` и при отсутствии `processing` documents.
- [ ] Удалять workspace точного `analysis_run_id`, не используя glob или непроверенный пользовательский path.
- [ ] Сделать cleanup idempotent: повторное удаление уже отсутствующей папки считается успехом.
- [ ] Не удалять PostgreSQL audit metadata, document records и hashes.
- [ ] Настроить retry/alert для cleanup failure без изменения уже корректного анализа.
- [ ] Проверить TTL-cleanup для workspace, осиротевшего из-за аварии Orchestrator.

**Gate:** terminal run больше не хранит binary, активный run сохраняет доступность artifacts для retry, cleanup не затрагивает соседний run.

### Task 9: Выполнить offline regression suite

- [ ] Проверить baseline без архивов.
- [ ] Проверить отдельные ZIP, 7Z, RAR, TAR, GZ, TAR.GZ и TGZ fixtures.
- [ ] Проверить смешанный архив с PDF/DOCX/XLSX и unsupported entries.
- [ ] Проверить nested archives уровней 1–3 и отказ на уровне 4.
- [ ] Проверить encrypted/corrupt/extension-mismatch archives.
- [ ] Проверить unsafe paths, links, special entries и normalized path collisions.
- [ ] Проверить каждый лимит на точной границе и на превышении.
- [ ] Проверить duplicate basenames, stable ordering, hashes и повтор одного job.
- [ ] Проверить extractor restart, transient request retry и terminal service unavailability.
- [ ] Запустить полный repository test suite и `git diff --check`.

**Gate:** все новые проверки GREEN; существующая test suite не получила новых failure signatures.

### Task 10: Развернуть сервис и провести изолированный runtime canary

- [ ] Снять server baseline по RAM, swap, CPU, disk и состоянию контейнеров.
- [ ] Проверить, что свободного диска достаточно для одного 300 МБ workspace с operational reserve.
- [ ] Развернуть только новый Compose project и выделенную host-папку, не перезапуская n8n/PostgreSQL/Redis/Traefik.
- [ ] Проверить внутреннюю доступность health/artifact endpoints из main и worker контейнеров n8n.
- [ ] Выполнить canary каждого обязательного archive format с synthetic documents.
- [ ] Наблюдать memory, CPU, disk и timeout во время 300 МБ boundary canary.
- [ ] Перезапустить только extractor service и подтвердить доступность опубликованного job.
- [ ] Проверить отсутствие host/public port.

**Gate:** сервис стабилен в заданных лимитах, существующие контейнеры не рестартовали, артефакт доступен Worker из внутренней сети.

### Task 11: Провести n8n test workflow canary

- [ ] Импортировать изменения только в inactive/test workflows.
- [ ] Проверить no-archive тендер и сравнить downstream input с текущим baseline.
- [ ] Проверить tender с прямым документом, архивом, вложенным архивом и unsupported file.
- [ ] Подтвердить в PostgreSQL полный manifest, provenance, terminal statuses и правильный `documents_total`.
- [ ] Подтвердить по execution data, что каждый pending leaf вызвал ровно один Worker.
- [ ] Подтвердить один Aggregator claim после `completed + skipped` barrier.
- [ ] Выполнить negative canary повреждённого архива и подтвердить `run.failed`, typed error и нулевой Worker dispatch.
- [ ] Проверить cleanup после completed и failed runs.

**Gate:** isolated E2E подтверждает полный и ошибочный paths; production workflows и production data не изменены.

### Task 12: Обновить документацию и подготовить promotion gate

- [ ] Обновить `workflows/orchestrator.md` фактическим preparation/registration contract.
- [ ] Обновить `workflows/document-worker.md` внутренним artifact URL и новой readiness semantics.
- [ ] Обновить `DATA_MODEL.md` только после применённой schema migration.
- [ ] Обновить `ARCHITECTURE.md` и `README.md` новым ingestion stage.
- [ ] Обновить `TECH_DEBT.md`: закрывать `OR-0` только после runtime GREEN, отдельно записать оставшиеся ограничения.
- [ ] Обновить `PROJECT_STATUS.md` и `DEVELOPMENT_LOG.md` точным уровнем доказательств: local, isolated runtime или production.
- [ ] Экспортировать и проверить canonical workflow snapshots после test promotion.
- [ ] Представить владельцу exact production diff, execution evidence, server metrics и rollback procedure.

**Gate:** спецификация, реализация, exports, документация и runtime evidence согласованы; production promotion остаётся отдельным явно подтверждаемым действием.

## Production acceptance sequence

```text
offline tests GREEN
→ extractor isolated runtime GREEN
→ inactive n8n canary GREEN
→ negative fail-closed canary GREEN
→ full tender E2E GREEN
→ DB/readiness/audit review GREEN
→ explicit production promotion decision
→ post-promotion canary
```

## Rollback boundary

Rollback должен состоять из независимых действий:

1. вернуть предыдущую версию Orchestrator/Worker;
2. остановить только Compose project archive-extractor;
3. не удалять document audit records и не откатывать другие workflows;
4. schema column `ingestion_metadata` оставить как безопасное additive поле, если её удаление не было отдельно спроектировано и подтверждено.

Ни один rollback-шаг не должен перезапускать или пересоздавать существующие n8n, PostgreSQL, Redis, Traefik, Gotenberg или bot containers.
