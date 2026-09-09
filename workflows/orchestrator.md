# ТЕНДЕРЫ ОРКЕСТРАТОР

**Статус:** inactive repository candidate / offline-tested / pre-DB runtime smoke GREEN
**Последнее обновление:** 2026-09-10
**Тип:** reusable new-run-only sub-workflow
**Точное имя workflow в n8n:** `ТЕНДЕРЫ ОРКЕСТРАТОР`
**Canonical export:** `workflows/n8n-exports/ТЕНДЕРЫ ОРКЕСТРАТОР.json`
**Точка входа:** `Execute Sub-workflow Trigger`
**Вызывает:** текущий выбранный repository/test candidate `TENDER — Обработать документ`
**Error Workflow:** не настроен
**Основной источник:** TenderPlan FullInfo API

Этот документ описывает текущий canonical JSON в repository. Export содержит 17 нод, включая Sticky Note, имеет `active=false`, `availableInMCP=false` и `executionOrder=v1`.

Canonical export сам по себе не доказывает live installation, публикацию,
корректность credentials или production runtime. Task 3 подтверждён offline
tests и bounded pre-DB runtime smoke: exact input validation, TenderPlan FullInfo
identity и normalization выполнены, после чего execution остановлен до DB
registration. DB registration, Worker dispatch, complete runtime и promotion
остаются непроверенными.

Archive-aware preparation, direct-file identity collection и skipped-aware
readiness подтверждены только local regression tests; production runtime ими не
подтверждён.

---

# 1. Ответственность

Orchestrator создаёт только новый `analysis_run`:

```text
typed intake input
→ TenderPlan FullInfo
→ validate response identity
→ normalize tender metadata and attachments
→ generate one analysis_run_id
→ synchronously prepare and validate the complete manifest
→ atomically create run as processing
→ register all pending/skipped manifest rows
→ synchronously stage/seal/start one additive agentic shadow job
→ asynchronously dispatch only pending PDF/DOCX/XLSX
→ return one structured result
```

Orchestrator не владеет повторным запуском существующего run. Он не:

- выбирает retryable documents;
- переоткрывает failed run;
- проверяет stale `processing` executions;
- применяет лимит автоматических attempts;
- повторно запускает Aggregator или Finalization;
- анализирует документы или агрегирует 27 полей.

Эти resume-решения принадлежат реализованному и offline-tested inactive
repository candidate `TENDER — Intake Resume`. При конфликте создания
Orchestrator только возвращает уже существующий незавершённый run и не запускает
его документы. Deployment и runtime promotion dispatcher остаются pending.

---

# 2. Typed input contract

`When Executed by Another Workflow` использует `executeWorkflowTrigger` v1.2 и принимает четыре обязательных string input в указанном порядке:

| Поле | Проверка |
|---|---|
| `tender_id` | trim; непустая строка; максимум 128 символов |
| `source` | trim + lowercase; только `tenderplan`; максимум 64 символа |
| `source_event_key` | trim; непустая строка; максимум 512 символов |
| `trigger_kind` | trim; максимум 64 символа; одно из `tenderplan_mark`, `recovery_scan`, `manual` |

Проверка выполняется до TenderPlan HTTP и до любой записи в PostgreSQL. Нарушение контракта — hard error.

Manual Trigger и hardcoded `tender_id` в canonical candidate отсутствуют. Upstream caller должен передать все четыре поля. `source_event_key` и `trigger_kind` сохраняются в data flow и terminal result, но текущий Orchestrator не пишет их в `tender_analysis_runs`.

---

# 3. Текущий 17-node graph

Исполняемый путь:

```text
When Executed by Another Workflow
→ Проверить вход Orchestrator
→ получить полную информацию о тендере
→ нормализовать карточку
→ Сформировать analysis_run_id
→ Подготовить документацию
→ Проверить результат подготовки
→ Создать запуск и зарегистрировать документы
→ Создан новый запуск?
```

Новый run:

```text
created_new_run=true
→ Есть поддерживаемые документы?
   ├─ true
   │  → Запустить агентский shadow-анализ
   │  → Восстановить контекст после agentic dispatch
   │  ├─ разделить документы
   │  │  → ВРЕМЕННЫЙ ФИЛЬТР РАСШИРЕНИЯ
   │  │  → Запустить обработку документа
   │  └─ Вернуть результат Orchestrator
   └─ false
      → Вернуть результат Orchestrator
```

Concurrent conflict:

```text
created_new_run=false
→ Загрузить существующий незавершённый запуск
→ Проверить существующий запуск
→ Вернуть результат Orchestrator
```

Семнадцатая нода — `Sticky Note`; она не участвует в execution graph.

---

# 4. TenderPlan FullInfo и identity boundary

HTTP Request выполняет запрос:

```text
GET https://tenderplan.ru/api/tenders/v2/fullinfo
query id = validated tender_id
```

Authentication остаётся в n8n Credential. Явная retry/backoff policy не настроена; это открытый `OR-6`.

`нормализовать карточку` читает validated request из `Проверить вход Orchestrator` и требует:

```text
response.tender существует
response.tender._id является непустой string после trim
response.tender._id === validated tender_id
```

Несовпадение response identity — hard error. Поэтому кэшированный или ошибочный FullInfo response не может создать run под другим `tender_id`.

Нормализатор возвращает:

```text
source
source_event_key
trigger_kind
tender_meta
attachments[]
raw_source
```

`tender_meta.source` и `tender_meta.tender_id` берутся из validated request. Полный `raw_source` существует только на этом этапе и дальше не сохраняется; `OR-3` остаётся открытым.

---

# 5. Normalized document contract

Каждый TenderPlan attachment нормализуется в:

```json
{
  "document_index": 1,
  "file_name": "Проект договора.pdf",
  "file_extension": "pdf",
  "display_name": "Проект договора.pdf",
  "download_url": "https://...",
  "publication_at": "2026-08-14T11:05:03.000Z",
  "source_size": null
}
```

`document_index` начинается с 1. Расширение извлекается только из фактического имени файла и приводится к lowercase; неизвестное расширение остаётся `null`.

Orchestrator также сохраняет существующий normalized `tender_meta` contract: идентификаторы, основные данные, даты, всех customers и `primary_customer`, platform, structured guarantees, classifiers и `documents_count`. Валюта не додумывается: если TenderPlan её не сообщил, используется `null`.

После normalization native Crypto создаёт `analysis_run_id`. Нода `Подготовить документацию` получает этот ID и полный `attachments[]` ровно один раз, работает в `mode=all` и синхронно ждёт sub-workflow. `Проверить результат подготовки` fail-closed проверяет `success=true`, schema/run identity, полные counts и последовательные document indices. Каждый `pending` документ обязан иметь `file_name`, `mime_type`, целый неотрицательный `file_size` и 64-hex `ingestion_metadata.content_sha256`. Typed failure, partial manifest или identity defect останавливают execution до DB INSERT.

---

# 6. Snapshot-safe atomic run creation

Нода `Создать запуск и зарегистрировать документы` выполняет один PostgreSQL statement с CTE:

```text
input_documents
→ inserted_run
→ registered_documents
→ document_stats
→ activated_run
→ result / conflict sentinel
```

Основные свойства:

1. `inserted_run` использует заранее созданный `analysis_run_id` и сразу вставляет run со `status='processing'`.
2. `registered_documents` вставляет все подготовленные `manifest.documents` и сохраняет их `status`, `mime_type`, `file_size`, `error_message` и полное `ingestion_metadata` с hash/provenance.
3. `(analysis_run_id, document_index)` остаётся document UPSERT boundary.
4. `document_stats` считает зарегистрированные строки и собирает их обратно в `attachments` с внутренними `document_id`.
5. Ошибка statement откатывает и run, и регистрацию документов вместе.

Критичная PostgreSQL semantics:

> Data-modifying CTE одного statement используют один snapshot. Поэтому нельзя вставить run в одном CTE, а затем обновить эту же новую строку через sibling `UPDATE`.

Поэтому промежуточный `created → processing` внутри statement отсутствует. Run вставляется сразу как `processing`, а `activated_run` является read-only `SELECT` из `inserted_run CROSS JOIN document_stats`.

Это сохраняет invariant:

```text
все документы зарегистрированы
ДО первого Worker dispatch
```

---

# 7. Concurrent active-run policy

Run INSERT использует partial unique conflict target:

```sql
ON CONFLICT (source, tender_id) WHERE status NOT IN ('completed', 'superseded')
DO NOTHING
```

Этот контракт требует migration с partial unique index на active runs;
`completed` и terminal `superseded` не участвуют в conflict boundary. Repository
migration и тесты не являются доказательством, что индекс уже применён в
production.

Если INSERT проиграл concurrent conflict, atomic statement возвращает sentinel:

```text
created_new_run=false
analysis_run_id=null
```

После этого `Загрузить существующий незавершённый запуск` выполняет отдельный fresh PostgreSQL statement:

```sql
SELECT ...
FROM tender_analysis_runs
WHERE source = $1
  AND tender_id = $2
  AND status NOT IN ('completed', 'superseded')
ORDER BY created_at DESC;
```

`LIMIT 1` намеренно отсутствует. Отдельный statement видит transaction, которая выиграла `ON CONFLICT`; все найденные строки передаются в `Проверить существующий запуск`.

Guard требует ровно одну строку, обязательные identity/status поля, active status
и точное совпадение `(source, tender_id)` с conflict sentinel. `completed` или
`superseded` не могут владеть этим conflict. Ноль или несколько строк — hard
error, а не выбор произвольного run. Для корректной единственной строки
возвращается:

```text
created_new_run=false
action=concurrent_existing_run
```

Conflict branch не регистрирует документы повторно и не достигает ни agentic Dispatch, ни Worker. Возобновление существующего run остаётся обязанностью `TENDER — Intake Resume`.

---

# 8. Supported-document dispatch

Перед `Split Out` нода `Есть поддерживаемые документы?` проверяет, содержит ли зарегистрированный массив хотя бы один документ со статусом `pending` и расширением:

```text
pdf
docx
xlsx
```

Успешный preparation contract гарантирует хотя бы один processable документ; false-ветка остаётся defense-in-depth и обходит `Split Out` с `documents_dispatched=0`.

Если поддерживаемый документ есть:

1. `Запустить агентский shadow-анализ` ровно один раз синхронно вызывает identity-neutral `TENDER — Агентский анализ — Запуск` в `mode=all` с `analysis_run_id`, `pipeline_version=tender_agentic_pipeline_v1`, `replicate_index=1`. Ожидание заканчивается после staging/seal/start acknowledgement sub-workflow, а не после завершения Codex.
2. `Восстановить контекст после agentic dispatch` возвращает исходный run/manifest context и добавляет bounded `agentic_shadow`; bodies документов в metadata не сохраняются.
3. `разделить документы` создаёт один item на attachment и сохраняет `analysis_run_id`, `tender_meta`, `created_new_run`.
4. `ВРЕМЕННЫЙ ФИЛЬТР РАСШИРЕНИЯ` пропускает только `pending` `pdf`, `docx`, `xlsx`; `skipped` audit rows до Worker не доходят.
5. `Запустить обработку документа` работает в `mode=each`; `waitForSubWorkflow=false`, поэтому legacy calls остаются fire-and-forget.

Вызов shadow стоит после atomic registration и до legacy fan-out. Поэтому archive cleanup, достижимый только через последующие legacy stages, причинно следует за завершением Dispatch; после успешного seal runner владеет независимыми копиями. Concurrent conflict и defense-in-depth zero-processable branch Dispatch не достигают. Export остаётся inactive, а placeholder `AGENTIC_DISPATCH_WORKFLOW_ID` должен быть заменён реальным ID только при отдельном packaging/read-back шаге.

Текущий Execute Workflow node указывает на repository/test candidate `[DW-23 TEST CODEX] TENDER — Обработать документ`. Выбор production Worker ID выполняется только при отдельном packaging/promotion решении.

---

# 9. `executionOrder=v1` и terminal fan-out

На supported branch нода `Есть поддерживаемые документы?` сначала синхронно проходит agentic shadow barrier. После восстановления исходного run context нода имеет два targets в таком порядке на canvas:

```text
верхняя ветка: разделить документы → filter → async Worker dispatch
нижняя ветка: Вернуть результат Orchestrator
```

При `executionOrder=v1` n8n завершает верхнюю ветку до перехода к нижней, потому что ветви выполняются сверху вниз. Поэтому все поддерживаемые items сначала передаются fire-and-forget Worker calls, после чего запускается общий terminal result.

Terminal result не зависит от child Worker output: новый run берётся из восстановленного atomic creation context, а conflict — из fresh existing-run row. Async Workers продолжаются независимо, а caller получает симметричный результат создания/конфликта с additive `agentic_shadow` metadata.

---

# 10. Structured output contract

Все ожидаемые исходы возвращают ровно один item через `Вернуть результат Orchestrator`:

```json
{
  "success": true,
  "analysis_run_id": "uuid",
  "source": "tenderplan",
  "tender_id": "string",
  "source_event_key": "string",
  "trigger_kind": "tenderplan_mark | recovery_scan | manual",
  "created_new_run": true,
  "action": "created_new_run",
  "status": "processing",
  "next_state": "processing",
  "documents_total": 3,
  "registered_documents_count": 3,
  "documents_dispatched": 3,
  "agentic_shadow": {
    "schema_version": "tender_agentic_dispatch_v1",
    "attempted": true,
    "dispatched": true,
    "acknowledged": true,
    "job_id": "uuid",
    "status": "running"
  }
}
```

Точный набор полей:

```text
success
analysis_run_id
source
tender_id
source_event_key
trigger_kind
created_new_run
action
status
next_state
documents_total
registered_documents_count
documents_dispatched
agentic_shadow
```

Семантика по исходам:

| Исход | `created_new_run` | `action` | `documents_dispatched` |
|---|---:|---|---:|
| Новый run, preparation success | `true` | `created_new_run` | число `pending` `pdf/docx/xlsx` |
| Concurrent active run | `false` | `concurrent_existing_run` | `0` |

`status` и `next_state` оба отражают фактический текущий run status. `next_state` не содержит action label.

Malformed identity, неожиданный zero/multiple conflict result или отсутствующий `analysis_run_id/status` завершаются hard error и не маскируются успешным output.

---

# 11. Открытые границы

## OR-0 — unsupported documents (локально закрыт)

Все source attachments представлены в подготовленном manifest. Unsupported files и archive containers регистрируются как `skipped`; Worker получает только `pending` PDF/DOCX/XLSX.

Canonical Worker и Intake Resume используют согласованный terminal barrier `completed + skipped = documents_total`; `failed` остаётся блокирующим. Изменение подтверждено offline tests, но не production runtime.

## OR-1 — zero documents / zero supported documents (локально закрыт)

Preparation возвращает typed `NO_PROCESSABLE_DOCUMENTS` до DB INSERT, если во всём manifest нет processable PDF/DOCX/XLSX.

Поэтому zero-processable вход не создаёт `analysis_run` и не dispatch-ит Worker. Runtime verification остаётся rollout gate.

## OR-4 — limited formats

Поддерживаются только `pdf`, `docx`, `xlsx`. Расширение набора форматов не входит в Task 3.

## OR-5 — no Error Workflow

У Orchestrator по-прежнему не настроен workflow-level Error Workflow. Hard errors видимы в execution, но централизованный intake error handler ещё не подключён.

## OR-6 — no TenderPlan retry/backoff

FullInfo HTTP не имеет явной retry/backoff policy. Retry должен оставаться до atomic run creation, чтобы transient HTTP failure не создавал run.

## OR-2 / OR-7 — local boundary implemented, rollout pending

Manual/hardcoded entry удалён из canonical repository candidate, а concurrent new-run conflict теперь fail-closed и возвращает существующий active run без повторного dispatch. Это только локальная Task 3 boundary.

Политика stable mark-membership dedup, completed tender, same-run recovery и
manual/recovery routing реализована и offline-tested в inactive repository
candidate `TENDER — Intake Resume`. Dispatcher сохраняет исходный
`analysis_run_id`, не повторяет `completed`/`skipped` documents, ограничивает
automatic path двумя Worker claims total и разрешает повтор exhausted failed
только через manual override. Stale `processing` после одного часа reclaim-ится
только после read-only n8n execution observation и guarded CAS; недоступность API
ничего не мутирует.

История только из `superseded` runs не блокирует first new mark after rollout:
Orchestrator может создать новый active run. Сам `superseded` run остаётся
terminal и не возобновляется ни automatic, ни manual/recovery path.

Production import, migration application, wiring и runtime verification всё ещё
не выполнены. TenderPlan type-5 contract superseded: execution `14683`
подтвердил mark-relation source, а poller реализован как inactive repository
candidate. Deployment и runtime verification остаются pending.

---

# 12. Regression gates

Offline contract test:

```text
tests/tender-orchestrator-input.test.mjs
tests/intake-agentic-shadow-routing.test.mjs
```

Он проверяет:

- exact typed trigger и отсутствие Manual Trigger/hardcoded tender ID;
- input validation до FullInfo;
- strict equality requested `tender_id` и response `tender._id`;
- сохранение intake provenance;
- один snapshot-safe atomic SQL без sibling run UPDATE;
- partial-index conflict target и boolean `created_new_run`;
- fresh active-run SELECT без `LIMIT 1` и exactly-one guard;
- регистрацию всех документов до первого Worker;
- `mode=each`, passthrough Worker input и `waitForSubWorkflow=false`;
- единый structured terminal result;
- synchronous preparation dominance, fail-closed manifest identity и pending-only Worker dispatch;
- один synchronous agentic shadow barrier после atomic registration, отсутствие agentic dispatch на conflict/zero-processable path и восстановление legacy run context до fan-out.

Read-only execution `14678` отдельно подтвердил exact input validation,
TenderPlan FullInfo identity и normalization для двух tender IDs. Smoke был
намеренно остановлен до PostgreSQL registration: DB writes и Worker calls
отсутствовали. Evidence:
`evaluations/TENDERPLAN_ORCHESTRATOR_PRE_DB_SMOKE_14678_2026-09-08.md`.

До production нужны отдельные runtime gates:

1. применить migration в non-production и проверить partial unique index;
2. импортировать/read back inactive workflow и проверить connections/settings;
3. подтвердить credentials и выбранный Worker package;
4. выполнить new-run, concurrent conflict, mixed unsupported и zero-document scenarios;
5. отдельно решить `OR-5`, `OR-6` и production rollout gates;
6. только после этого принимать решение о promotion.

---

# 13. Safe modification checklist

1. Сохранять exact typed input contract или версионировать caller/child одновременно.
2. Не создавать run, если FullInfo identity не равна validated `tender_id`.
3. Не разделять atomic run creation и полную document registration.
4. Не добавлять sibling `UPDATE` новой строки, вставленной data-modifying CTE того же statement.
5. Не добавлять `LIMIT 1` в active-run conflict SELECT.
6. Не отправлять conflict branch в Worker.
7. Не запускать первый Worker до регистрации всех документов.
8. Сохранять `document_id`, `analysis_run_id` и `tender_meta` в Worker input.
9. Сохранять один terminal result независимо от Worker child output.
10. Не объявлять local export production без import/read-back/runtime evidence.
