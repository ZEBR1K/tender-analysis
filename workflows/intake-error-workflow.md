# TENDER — Ошибка Intake Resume

- **Статус:** inactive repository candidate; offline review PASS; runtime pending
- **Последнее обновление:** 2026-09-07
- **Тип:** reusable n8n Error Workflow
- **Точное имя workflow:** `TENDER — Ошибка Intake Resume`
- **Repository export:** `workflows/n8n-exports/TENDER — Ошибка Intake Resume.json`
- **PostgreSQL credential reference:** `KITATEH Tenders`

---

# 1. Назначение и граница ответственности

Workflow фиксирует ошибку только для уже принадлежащего intake event:

```text
failed n8n execution
→ Error Trigger
→ normalize documented error data
→ processing intake event → failed
→ structured audit result
```

Repository export содержит ровно четыре последовательно соединённые ноды:

```text
Error Trigger
→ Normalize Intake Error
→ Mark Owned Intake Event Failed
→ Return Error Audit Result
```

Export имеет `active=false`. Это repository candidate, а не доказательство импорта, подключения или работы в live n8n.

Workflow не:

- изменяет документы или `tender_analysis_runs`;
- создаёт отсутствующий intake event;
- выполняет retry;
- запускает Orchestrator, Dispatcher, Worker или Aggregator;
- отправляет уведомления;
- заменяет `TENDER — Ошибка обработки документа`.

---

# 2. Error Trigger contract

Из официального Error Trigger payload используются только:

```text
execution.id
execution.error.message
execution.error.description
```

Workflow не зависит от undocumented payload fields. `execution.id` является correlation key для:

```text
tender_analysis_intake_events.n8n_execution_id
```

---

# 3. Normalize Intake Error

Нода `Normalize Intake Error` — Code v2 в режиме:

```text
runOnceForEachItem
```

Поэтому она возвращает один item object, а не массив:

```javascript
{
  json: {
    n8n_execution_id,
    error_message,
  },
}
```

Правила для `execution.id`:

1. значение обязано быть string;
2. выполняется `trim()`;
3. пустая строка запрещена;
4. максимальная длина — 4096 символов;
5. нарушение контракта завершает workflow hard error.

Правила выбора сообщения:

```text
первый nonblank trimmed execution.error.message
→ execution.error.description
→ "Unknown Intake Resume error"
```

Результат дополнительно обрезается до 2000 символов.

---

# 4. Atomic ownership guard

`Mark Owned Intake Event Failed` выполняет один parameterized PostgreSQL statement:

```sql
UPDATE tender_analysis_intake_events AS event
SET status = 'failed',
    error_message = left($2, 2000),
    updated_at = now()
WHERE event.id = (
  SELECT owned.id
  FROM tender_analysis_intake_events AS owned
  WHERE owned.n8n_execution_id = $1
    AND owned.status = 'processing'
)
RETURNING
    event.id,
    event.event_key,
    event.analysis_run_id,
    event.status;
```

Параметры передаются как:

```text
$1 = n8n_execution_id
$2 = bounded error_message
```

Scalar subquery является pre-mutation cardinality guard:

- одна owned строка — разрешён только переход `processing → failed`;
- ноль строк — outer UPDATE не изменяет данные;
- больше одной строки — PostgreSQL выдаёт cardinality error до мутации;
- `LIMIT 1` запрещён, потому что он маскировал бы нарушение ownership invariant.

Statement меняет только:

```text
status
error_message
updated_at
```

Он сохраняет `id`, source/event identity, `tender_id`, `trigger_kind`, `analysis_run_id`, attempts, execution ownership, processing timestamps, action и остальные audit fields.

---

# 5. Zero-row и duplicate-owner semantics

PostgreSQL node имеет:

```text
alwaysOutputData=true
```

Поэтому zero-row UPDATE всё равно достигает `Return Error Audit Result`.

Если owned event не найден:

```text
event_updated=false
```

Новая ledger-строка не создаётся. Это ожидаемая граница для ошибки до claim: без tender/event identity workflow не имеет права придумывать intake event. Такая pre-claim failure остаётся видимой только как failed execution в n8n до появления отдельного механизма audit/notification.

Если один `n8n_execution_id` неожиданно принадлежит нескольким processing events, scalar subquery завершает statement cardinality error до изменения строк. Дополнительная проверка `rows.length > 1` в return node остаётся defense in depth, но не является основным atomic guard.

---

# 6. Structured result contract

`Return Error Audit Result` — Code v2 в режиме `runOnceForAllItems` и всегда возвращает массив ровно из одного item.

## Одна строка обновлена

```json
{
  "event_updated": true,
  "event_id": "string <= 128",
  "event_key": "string <= 512",
  "analysis_run_id": "string <= 128 | null",
  "status": "failed",
  "n8n_execution_id": "nonblank string <= 4096"
}
```

`status` обязан быть `failed`; неожиданный status вызывает hard error. Identifier strings trim/bound перед возвратом, отсутствующий `analysis_run_id` остаётся `null`; значения не синтезируются.

## Owned строка не найдена

```json
{
  "event_updated": false,
  "event_id": null,
  "event_key": null,
  "analysis_run_id": null,
  "status": null,
  "n8n_execution_id": "nonblank string <= 4096"
}
```

`error_message` сохраняется в ledger при успешном UPDATE, но не входит в terminal result.

---

# 7. Изоляция от document Error Workflow

Этот workflow работает только с:

```text
tender_analysis_intake_events
```

Он не читает и не обновляет:

```text
tender_analysis_documents
tender_analysis_runs
```

`TENDER — Ошибка обработки документа` сохраняет отдельную ответственность за post-claim ошибки Document Worker. Intake handler нельзя назначать вместо document handler без отдельного изменения error architecture.

---

# 8. Offline regression evidence

Структурный и embedded-Code regression test:

```text
tests/tender-intake-error-workflow.test.mjs
```

Он проверяет:

- точное имя, inactive state и линейную 4-node topology;
- только документированные Error Trigger fields;
- mode-aware Code return contracts;
- bounds и fail-closed execution identity;
- parameterized intake-ledger UPDATE;
- scalar-subquery cardinality guard без `LIMIT`;
- zero-row result и bounded audit output;
- отсутствие document/run mutations и embedded secrets.

Task 4 checkpoint:

```text
offline repository suite: 502 / 502 PASS
technical review: PASS
```

Это не runtime evidence.

---

# 9. Pending runtime gates

До production claim необходимо отдельно:

1. применить `migrations/2026-09-07_tender_intake_resume.sql` в non-production и проверить ledger schema;
2. импортировать inactive export и выполнить read-back topology, settings и credential binding;
3. назначить этот workflow через Error Workflow setting целевых intake workflows после определения окончательного wiring;
4. подтвердить runtime post-claim failure: одна owned processing строка становится failed;
5. подтвердить runtime pre-claim/unknown execution: данные не создаются, result содержит `event_updated=false`;
6. подтвердить в rollback-safe non-production scenario, что duplicate owners дают cardinality error без частичной мутации;
7. проверить message precedence/bounds и сохранение audit fields;
8. только после этих gates принимать решение об активации/promotion.

На текущем этапе migration application, import, Error Workflow setting, wiring и runtime verification остаются pending.
