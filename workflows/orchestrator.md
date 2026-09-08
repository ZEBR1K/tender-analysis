# ТЕНДЕРЫ ОРКЕСТРАТОР

**Статус:** inactive repository candidate / offline-tested / pre-DB runtime smoke GREEN
**Последнее обновление:** 2026-09-08
**Тип:** reusable new-run-only sub-workflow
**Точное имя workflow в n8n:** `ТЕНДЕРЫ ОРКЕСТРАТОР`
**Canonical export:** `workflows/n8n-exports/ТЕНДЕРЫ ОРКЕСТРАТОР.json`
**Точка входа:** `Execute Sub-workflow Trigger`
**Вызывает:** текущий выбранный repository/test candidate `TENDER — Обработать документ`
**Error Workflow:** не настроен
**Основной источник:** TenderPlan FullInfo API

Этот документ описывает текущий canonical JSON в repository. Export содержит 14 нод, включая Sticky Note, имеет `active=false`, `availableInMCP=false` и `executionOrder=v1`.

Canonical export сам по себе не доказывает live installation, публикацию,
корректность credentials или production runtime. Task 3 подтверждён offline
tests и bounded pre-DB runtime smoke: exact input validation, TenderPlan FullInfo
identity и normalization выполнены, после чего execution остановлен до DB
registration. DB registration, Worker dispatch, complete runtime и promotion
остаются непроверенными.

---

# 1. Ответственность

Orchestrator создаёт только новый `analysis_run`:

```text
typed intake input
→ TenderPlan FullInfo
→ validate response identity
→ normalize tender metadata and attachments
→ atomically create run as processing
→ register every attachment as pending
→ asynchronously dispatch supported documents
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

# 3. Текущий 14-node graph

Исполняемый путь:

```text
When Executed by Another Workflow
→ Проверить вход Orchestrator
→ получить полную информацию о тендере
→ нормализовать карточку
→ Создать запуск и зарегистрировать документы
→ Создан новый запуск?
```

Новый run:

```text
created_new_run=true
→ Есть поддерживаемые документы?
   ├─ true
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

Четырнадцатая нода — `Sticky Note`; она не участвует в execution graph.

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

1. `inserted_run` сразу вставляет run со `status='processing'`.
2. `registered_documents` вставляет все normalized attachments из `input_documents` со `status='pending'` и ссылается только на новый `inserted_run`.
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

# 7. Concurrent unfinished-run policy

Run INSERT использует partial unique conflict target:

```sql
ON CONFLICT (source, tender_id) WHERE status <> 'completed'
DO NOTHING
```

Этот контракт требует migration с partial unique index на незавершённые runs. Repository migration и тесты не являются доказательством, что индекс уже применён в production.

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
  AND status <> 'completed'
ORDER BY created_at DESC;
```

`LIMIT 1` намеренно отсутствует. Отдельный statement видит transaction, которая выиграла `ON CONFLICT`; все найденные строки передаются в `Проверить существующий запуск`.

Guard требует ровно одну строку, обязательные identity/status поля, non-completed status и точное совпадение `(source, tender_id)` с conflict sentinel. Ноль или несколько строк — hard error, а не выбор произвольного run. Для корректной единственной строки возвращается:

```text
created_new_run=false
action=concurrent_existing_run
```

Conflict branch не регистрирует документы повторно и не достигает Worker. Возобновление существующего run остаётся обязанностью `TENDER — Intake Resume`.

---

# 8. Supported-document dispatch

Перед `Split Out` нода `Есть поддерживаемые документы?` проверяет, содержит ли зарегистрированный массив хотя бы один документ с расширением:

```text
pdf
docx
xlsx
```

Если поддерживаемых документов нет, путь обходит `Split Out` и всё равно возвращает structured result с `documents_dispatched=0`.

Если поддерживаемый документ есть:

1. `разделить документы` создаёт один item на attachment и сохраняет `analysis_run_id`, `tender_meta`, `created_new_run`.
2. `ВРЕМЕННЫЙ ФИЛЬТР РАСШИРЕНИЯ` пропускает только `pdf`, `docx`, `xlsx`.
3. `Запустить обработку документа` работает в `mode=each`.
4. Child workflow получает один зарегистрированный document item с внутренним `document_id` и общим `analysis_run_id`.
5. `waitForSubWorkflow=false`: вызовы fire-and-forget, Orchestrator не ждёт Worker output.

Текущий Execute Workflow node указывает на repository/test candidate `[DW-23 TEST CODEX] TENDER — Обработать документ`. Выбор production Worker ID выполняется только при отдельном packaging/promotion решении.

---

# 9. `executionOrder=v1` и terminal fan-out

На supported branch нода `Есть поддерживаемые документы?` имеет два direct targets в таком порядке на canvas:

```text
верхняя ветка: разделить документы → filter → async Worker dispatch
нижняя ветка: Вернуть результат Orchestrator
```

При `executionOrder=v1` n8n завершает верхнюю ветку до перехода к нижней, потому что ветви выполняются сверху вниз. Поэтому все поддерживаемые items сначала передаются fire-and-forget Worker calls, после чего запускается общий terminal result.

Terminal result не зависит от child Worker output и читает run напрямую из atomic creation node. Это важно: async Workers продолжаются независимо, а caller получает симметричный результат создания/конфликта.

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
  "documents_dispatched": 3
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
```

Семантика по исходам:

| Исход | `created_new_run` | `action` | `documents_dispatched` |
|---|---:|---|---:|
| Новый run, есть supported documents | `true` | `created_new_run` | число `pdf/docx/xlsx` |
| Новый run, нет supported documents | `true` | `created_new_run` | `0` |
| Concurrent unfinished run | `false` | `concurrent_existing_run` | `0` |

`status` и `next_state` оба отражают фактический текущий run status. `next_state` не содержит action label.

Malformed identity, неожиданный zero/multiple conflict result или отсутствующий `analysis_run_id/status` завершаются hard error и не маскируются успешным output.

---

# 11. Открытые границы

## OR-0 — unsupported documents

Все attachments регистрируются до dispatch, но только `pdf/docx/xlsx` получают Worker call. Unsupported document остаётся `pending`. Даже при смешанном наборе supported и unsupported документов это может навсегда удержать run в `processing`.

Structured Orchestrator output устраняет silent zero-item return, но не решает lifecycle unsupported document. Нужны явный terminal status/reason и согласованное изменение readiness semantics.

## OR-1 — zero documents / zero supported documents

Новый run без supported documents теперь возвращает structured result с `documents_dispatched=0`; caller не теряет `analysis_run_id`.

Но run уже имеет `status='processing'`, а Worker completion не произойдёт. Поэтому run всё ещё может остаться в `processing`. Выбор terminal semantics (`failed`, metadata-only path или другой явный outcome) остаётся открытым.

## OR-4 — limited formats

Поддерживаются только `pdf`, `docx`, `xlsx`. Расширение набора форматов не входит в Task 3.

## OR-5 — no Error Workflow

У Orchestrator по-прежнему не настроен workflow-level Error Workflow. Hard errors видимы в execution, но централизованный intake error handler ещё не подключён.

## OR-6 — no TenderPlan retry/backoff

FullInfo HTTP не имеет явной retry/backoff policy. Retry должен оставаться до atomic run creation, чтобы transient HTTP failure не создавал run.

## OR-2 / OR-7 — local boundary implemented, rollout pending

Manual/hardcoded entry удалён из canonical repository candidate, а concurrent new-run conflict теперь fail-closed и возвращает существующий unfinished run без повторного dispatch. Это только локальная Task 3 boundary.

Политика stable mark-membership dedup, completed tender, same-run recovery и
manual/recovery routing реализована и offline-tested в inactive repository
candidate `TENDER — Intake Resume`. Dispatcher сохраняет исходный
`analysis_run_id`, не повторяет `completed`/`skipped` documents, ограничивает
automatic path двумя Worker claims total и разрешает повтор exhausted failed
только через manual override. Stale `processing` после одного часа reclaim-ится
только после read-only n8n execution observation и guarded CAS; недоступность API
ничего не мутирует.

Production import, migration application, wiring и runtime verification всё ещё
не выполнены. TenderPlan type-5 contract superseded: execution `14683`
подтвердил mark-relation source, а poller реализован как inactive repository
candidate. Deployment и runtime verification остаются pending.

---

# 12. Regression gates

Offline contract test:

```text
tests/tender-orchestrator-input.test.mjs
```

Он проверяет:

- exact typed trigger и отсутствие Manual Trigger/hardcoded tender ID;
- input validation до FullInfo;
- strict equality requested `tender_id` и response `tender._id`;
- сохранение intake provenance;
- один snapshot-safe atomic SQL без sibling run UPDATE;
- partial-index conflict target и boolean `created_new_run`;
- fresh unfinished-run SELECT без `LIMIT 1` и exactly-one guard;
- регистрацию всех документов до первого Worker;
- `mode=each`, passthrough Worker input и `waitForSubWorkflow=false`;
- единый structured terminal result;
- прямой terminal path при zero supported documents.

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
5. отдельно решить `OR-0`, `OR-1`, `OR-5`, `OR-6`;
6. только после этого принимать решение о promotion.

---

# 13. Safe modification checklist

1. Сохранять exact typed input contract или версионировать caller/child одновременно.
2. Не создавать run, если FullInfo identity не равна validated `tender_id`.
3. Не разделять atomic run creation и полную document registration.
4. Не добавлять sibling `UPDATE` новой строки, вставленной data-modifying CTE того же statement.
5. Не добавлять `LIMIT 1` в unfinished-run conflict SELECT.
6. Не отправлять conflict branch в Worker.
7. Не запускать первый Worker до регистрации всех документов.
8. Сохранять `document_id`, `analysis_run_id` и `tender_meta` в Worker input.
9. Сохранять один terminal result независимо от Worker child output.
10. Не объявлять local export production без import/read-back/runtime evidence.
