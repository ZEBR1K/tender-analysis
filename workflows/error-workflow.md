# TENDER — Ошибка обработки документа

**Статус:** Active development / MVP  
**Последнее обновление:** 2026-08-22  
**Тип:** Error Workflow n8n  
**Точное имя workflow:** `TENDER — Ошибка обработки документа`  
**Используется:** workflow `TENDER — Обработать документ`  
**Trigger:** `Error Trigger`  
**PostgreSQL credential:** `KITATEH Tenders`

---

# 1. Назначение

`TENDER — Ошибка обработки документа` — централизованный workflow-level error handler для `TENDER — Обработать документ`.

Его текущая задача очень узкая:

```text
Document Worker execution падает
        ↓
Error Trigger получает execution metadata
        ↓
по execution.id найти document
        ↓
processing → failed
        ↓
сохранить error_message
```

Workflow не:

- повторяет документ автоматически;
- переводит весь analysis run в `failed`;
- запускает readiness check;
- отправляет уведомление;
- сохраняет полный stack/error audit в отдельную таблицу.

---

# 2. Архитектура

```text
Error Trigger
    |
    v
Пометить документ failed
```

Всего:

```text
2 nodes
```

---

# 3. `Error Trigger`

Тип:

```text
n8n Error Trigger
```

Он получает metadata упавшего execution.

Реальный пример:

```json
{
  "execution": {
    "id": "13663",
    "url": "https://.../executions/13663",
    "error": {
      "description": "facts[1]",
      "lineNumber": 92,
      "message": "для status=found review_reason_code должен быть null. [line 92]",
      "stack": "..."
    },
    "lastNodeExecuted": "Проверить и привязать evidence",
    "mode": "integrated",
    "executionContext": {
      "parentExecutionId": "13661"
    }
  },
  "workflow": {
    "id": "1Pw61ZY3HgBSvcUr",
    "name": "TENDER — Обработать документ"
  }
}
```

Критичное поле для текущей логики:

```text
execution.id
```

---

# 4. Почему `execution.id` позволяет найти документ

При atomic claim Document Worker записывает в:

```text
tender_analysis_documents.n8n_execution_id
```

ID текущего Worker execution.

Поэтому связь выглядит так:

```text
Worker execution id
        ↓
tender_analysis_documents.n8n_execution_id
        ↓
конкретный document
```

Реальный pin data подтверждает:

```text
Error Trigger execution.id = 13663

↓

document.n8n_execution_id = 13663
```

---

# 5. `Пометить документ failed`

Тип:

```text
PostgreSQL / Execute Query
```

SQL:

```sql
UPDATE tender_analysis_documents
SET
    status = 'failed',
    error_message = $2
WHERE n8n_execution_id = $1
  AND status = 'processing'
RETURNING ...;
```

---

# 6. Error message selection

Query replacement использует:

```text
execution.error.message
```

если его нет:

```text
execution.error.description
```

если нет обоих:

```text
Unknown Document Worker error
```

Логика:

```text
message
→ description
→ fallback
```

---

# 7. Status transition

Error Workflow разрешает только:

```text
processing
→ failed
```

Если document уже:

```text
pending
completed
failed
skipped
```

UPDATE его не изменит.

Это защищает terminal/other states от случайной перезаписи.

---

# 8. Реальный проверенный сценарий

Document:

```text
document_index = 2
file_name = Проект договора.pdf
```

Worker упал в:

```text
Проверить и привязать evidence
```

Ошибка:

```text
для status=found review_reason_code должен быть null
```

Error Workflow нашёл document по:

```text
n8n_execution_id = 13663
```

и выполнил:

```text
processing → failed
```

Результат:

```json
{
  "status": "failed",
  "attempts": 1,
  "n8n_execution_id": "13663",
  "error_message": "для status=found review_reason_code должен быть null. [line 92]"
}
```

То есть основной happy-path error handling подтверждён реальным execution.

---

# 9. Retry semantics

Document Worker atomic claim допускает:

```text
failed
→ processing
```

Поэтому `failed` здесь является не обязательно окончательным состоянием документа.

Логика уже позволяет повторную обработку:

```text
processing
→ failed
→ retry
→ processing
```

При retry:

```text
attempts += 1
```

---

# 10. Что происходит с analysis run после document failure

Текущий Error Workflow **не изменяет**:

```text
tender_analysis_runs.status
```

То есть:

```text
run.status = processing
```

может сохраниться даже если один document уже:

```text
failed
```

Также Error Workflow не выполняет:

```text
Проверить готовность к агрегации
```

Сам readiness SQL знает причину:

```text
failed_documents_exist
```

но Error Workflow его не вызывает.

---

# 11. Взаимодействие с readiness

Текущий readiness Aggregator запускает только если:

```text
completed_documents_count = documents_total
```

Следовательно:

```text
2 completed
1 failed
documents_total = 3
```

не может стать:

```text
ready_for_aggregation
```

Run останется незавершённым до retry или отдельного решения об ошибке.

---

# 12. Важное ограничение — invalid/error behavior

Этот Error Workflow ловит workflow-level failures.

В актуальном export у ноды `Проверить и привязать evidence` отсутствуют:

```text
onError
continueOnFail
```

Её regular output подключён к `AI Validator v1`. Поэтому configuration-level silent bypass через `continueErrorOutput` текущим export не подтверждается.

При этом поведение invalid/error response требует runtime regression. Это cross-workflow issue `DW-14 / EW-3` и оно не считается полностью закрытым.

---

# 13. Основные invariants

1. Error Workflow используется для `TENDER — Обработать документ`.
2. Worker должен сохранить `n8n_execution_id` при claim.
3. Ошибка связывается с document по `execution.id`.
4. Обновлять можно только document со `status='processing'`.
5. Error Workflow не должен менять completed document на failed.
6. `failed` document должен оставаться retryable.
7. Error message сохраняется в `tender_analysis_documents.error_message`.
8. Один document failure не должен запускать Aggregator.
9. Поведение invalid/error response требует отдельного runtime regression; configuration-level bypass через `continueErrorOutput` текущим export не подтверждён.

---

# 14. Known Technical Debt

## EW-0 — analysis run не получает terminal/error state

**Severity:** High  
**Status:** Open

После:

```text
document → failed
```

run остаётся:

```text
processing
```

Если автоматического retry нет, такой run может оставаться `processing` неограниченно долго.

Нужно позже определить бизнес-семантику:

### Вариант A — document failure делает run failed

```text
document failed
→ run failed
```

### Вариант B — run остаётся processing до retry budget

```text
document failed
→ retry
→ после N попыток run failed
```

### Вариант C — часть документов допускается skipped

Тогда нужно изменить readiness semantics.

До выбора retry/error policy не менять автоматически.

---

## EW-1 — UPDATE может вернуть 0 rows без явной ошибки

**Severity:** High  
**Status:** Open

SQL:

```text
WHERE n8n_execution_id = execution.id
AND status = processing
```

Если document не найден, PostgreSQL UPDATE просто вернёт:

```text
0 rows
```

Error Workflow может завершиться технически успешно, хотя документ так и не был помечен failed.

Возможные причины:

- ошибка произошла до atomic claim;
- `n8n_execution_id` не успел записаться;
- document уже имеет другой status;
- execution correlation нарушена.

Желаемое будущее поведение:

```text
updated rows = 0
→ explicit handler error / alert
```

---

## EW-2 — ошибка до document claim не может быть связана с document

**Severity:** Medium / High  
**Status:** Open

Связь строится только через:

```text
n8n_execution_id
```

который записывает claim node.

Если Worker упал до успешного claim:

```text
Error Trigger есть
но document.n8n_execution_id ещё отсутствует
```

и handler не сможет определить document.

Это особенно важно при будущей строгой input validation до claim.

---

## EW-3 — runtime behavior invalid/error response требует regression

**Severity:** Critical / cross-workflow  
**Status:** Open

Связано с `DW-14`.

В актуальном export у ноды `Проверить и привязать evidence` нет `onError` и `continueOnFail`; regular output подключён к `AI Validator v1`.

Следовательно, configuration-level silent bypass через `continueErrorOutput` не подтверждён. Остаётся незакрытым вопрос фактического поведения invalid/error response — его нужно проверить runtime regression до production.

---

## EW-4 — сохраняется только короткий `error_message`

**Severity:** Low / Medium  
**Status:** Open

Error Trigger содержит больше полезной информации:

```text
lastNodeExecuted
execution.url
error.description
error.stack
lineNumber
parentExecutionId
```

Но в document table сохраняется только:

```text
error_message
```

Для MVP этого достаточно для основной диагностики, но production audit лучше расширить отдельным error log.

---

## EW-5 — нет уведомлений

**Severity:** Medium / operational  
**Status:** Open

Сейчас Document Worker failure:

```text
→ DB status failed
```

но не отправляет:

```text
Telegram
email
Slack
или другое alert
```

Для production желательно уведомлять о terminal failures / exhausted retries.

---

## EW-6 — query не устанавливает timestamps явно

**Severity:** Low / To verify  
**Status:** Open

UPDATE явно меняет:

```text
status
error_message
```

но не задаёт:

```text
updated_at = NOW()
completed_at
```

По текущим данным нельзя утверждать, существует ли DB trigger, автоматически обновляющий `updated_at`.

Перед изменением нужно проверить trigger definitions.

Для `failed` также стоит решить семантику `completed_at`:

- оставлять NULL;
- или иметь отдельный `failed_at`.

---

# 15. Что НЕ является проблемой

## Correlation по execution ID

Для post-claim failures это хороший и простой способ найти document.

## `failed` остаётся retryable

Это соответствует Document Worker claim:

```text
status IN ('pending', 'failed')
```

## Error Workflow не агрегирует run

Само по себе это не ошибка — policy run failure/retry ещё должна быть определена отдельно.

---

# 16. Safe Modification Checklist

Перед изменением Error Workflow:

1. Не связывать ошибку с document только по filename.
2. Сохранять exact Worker execution identity.
3. Не переводить completed document обратно в failed.
4. Не ломать retry `failed → processing`.
5. Явно обрабатывать zero-row UPDATE.
6. Если добавляется run failure — согласовать retry policy.
7. Если вводится `skipped`, синхронно менять readiness.
8. Не хранить credentials/секреты из Error Trigger payload.
9. Для alert не отправлять полный stack без необходимости.
10. Не создавать retry loop между Error Workflow и Worker.

---

# 17. Regression Checklist

## E1 — normal Worker crash after claim

Input:

```text
execution.id matches processing document
```

Ожидание:

```text
document.status = failed
error_message set
```

## E2 — completed document

Ожидание:

```text
не изменяется
```

## E3 — already failed document

Ожидание:

```text
не изменяется
```

## E4 — unknown execution id

Текущее поведение:

```text
0 rows
```

После `EW-1`:

```text
explicit diagnostic/alert
```

## E5 — error before claim

После будущего решения `EW-2`:

```text
ошибка не должна теряться молча
```

## E6 — node handled error

После fix `DW-14 / EW-3`:

```text
document гарантированно получает failed
или workflow реально fails и Error Workflow срабатывает
```

## E7 — retry failed document

Ожидание:

```text
failed → processing
attempts += 1
error_message cleared by claim
```

## E8 — failed document + remaining completed docs

Ожидание по текущей архитектуре:

```text
run не становится ready_for_aggregation
```

---

# 18. Ближайший план

Перед production наиболее важны:

```text
EW-3 / DW-14
закрыть silent handled errors

EW-1
проверять zero-row update

EW-0
определить retry budget и terminal run semantics
```

После этого:

```text
EW-4
error audit/logging

EW-5
notifications

EW-6
timestamps
```

---

# 19. Краткое резюме

`TENDER — Ошибка обработки документа` — минимальный, но рабочий Error Workflow.

Текущий happy path:

```text
Worker execution failed
→ Error Trigger
→ execution.id
→ найти processing document
→ status = failed
→ сохранить error_message
```

Реальный pin execution подтвердил, что correlation:

```text
execution.id
↔
document.n8n_execution_id
```

работает.

Главные ограничения:

```text
1. run после failed document остаётся processing;
2. UPDATE 0 rows не считается ошибкой;
3. ошибки до claim не могут быть связаны с document;
4. configuration-level bypass через continueErrorOutput не подтверждён текущим export; invalid/error behavior требует runtime regression;
5. нет alert/retry policy.
```

На текущем этапе workflow выполняет основную задачу — не оставлять обычный упавший post-claim Document Worker в `processing` — но error lifecycle ещё не завершён до production-level состояния.
