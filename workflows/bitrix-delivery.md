# Bitrix delivery workflow

Статус: локальный неактивный beta-кандидат. Production n8n не изменён.

Экспорт: `workflows/n8n-exports/beta/[BITRIX] TENDER — Отправить отчёт в Bitrix.json`.

## Назначение и граница

Workflow односторонне отправляет короткое сообщение и уже сформированный PDF в один фиксированный групповой чат Bitrix24. Он не принимает сообщения, не обрабатывает команды и не содержит отдельного операторского процесса.

Report Generation остаётся чистым генератором артефактов. Вызов доставки выполняет caller после успешного Report Generation.

## Вход

`Execute Workflow Trigger` работает в `passthrough`, поэтому сохраняются JSON и `binary.report_pdf`.

Workflow принимает идентификатор run в одном из двух мест:

```text
json.analysis_run_id
json.internal.analysis_run_id
```

Обязательные данные:

```text
json.procurement
json.statistics
json.pdf_artifact_validation.valid = true
binary.report_pdf
```

## Сообщение

```text
Отчёт по закупке №{tender_number}
Предмет: {subject}
Заказчик: {customer}
Начальная цена: {initial_price}

Результаты: подтверждено — {resolved}; требуют проверки — {requires_review}; не найдено — {not_found}.
```

В сообщении нет UUID, `field_key`, confidence, evidence и технической диагностики. Для полей, требующих внимания, используется только короткий счётчик в строке результатов. Второй строки-предупреждения нет.

## Preflight

До HTTP-вызова проверяются:

- `resolved + requires_review + not_found = 27`, и каждый счётчик — неотрицательное целое;
- `statistics.total = 27`;
- `pdf_artifact_validation.valid = true`;
- binary-свойство называется `report_pdf`;
- MIME равен `application/pdf`;
- имя непустое и заканчивается на `.pdf`;
- первые пять байтов равны `%PDF-`;
- фактический размер совпадает с `pdf_artifact_validation.size_bytes`;
- размер находится в диапазоне 6–104857600 байт;
- настроены `botId`, `dialogId=chat{number}` и `botToken`.

PDF кодируется в Base64 без data-URL prefix и передаётся в `imbot.v2.File.upload` вместе с сообщением.

## Journal и atomic claim

Таблица `tender_analysis_deliveries` имеет неизменную identity:

```text
(analysis_run_id, channel='bitrix', dialog_id)
```

Перед HTTP выполняется атомарный переход только из `pending` или due `retry_wait`:

```text
pending/retry_wait -> sending
attempt_count = attempt_count + 1
n8n_execution_id = $execution.id
attempt_count < 4
```

Повторный вызов для `sent`, текущего `sending`, ещё не due `retry_wait`, `failed` или `unknown` не вызывает HTTP. Таким образом сообщение не отправляется второй раз без нового допустимого claim.

Шесть состояний:

```text
pending
sending
retry_wait
sent
failed
unknown
```

## Классификация ответа

`sent` возможен только при согласованном 2xx-ответе с `messageId`, `file.id`, ожидаемыми `dialogId`, именем и размером файла.

Автоматический повтор разрешён только при явном коде временной недоставки Bitrix из allowlist:

```text
FILE_FOLDER_ERROR
FILE_UPLOAD_FAILED
FILE_SEND_FAILED
INTERNAL_SERVER_ERROR
ERROR_UNEXPECTED_ANSWER
QUERY_LIMIT_EXCEEDED
OPERATION_TIME_LIMIT
```

Backoff: 1, 5 и 15 минут. Вместе с первоначальной попыткой допускается не более четырёх HTTP-вызовов. После исчерпания лимита состояние становится `failed`.

Постоянный явный отказ Bitrix даёт `failed` без повтора. Timeout, connection reset, transport error, malformed или любой неоднозначный ответ даёт terminal `unknown` без повтора.

У HTTP-ноды отключён node-level retry. Ветки ответа и transport error сохраняются отдельными guarded UPDATE, привязанными к `n8n_execution_id` и `status='sending'`. Потерянный UPDATE завершает execution ошибкой. Workflow-level error workflow переводит оставшуюся `sending`-строку в `unknown`.

## Выход

Все terminal paths возвращают только:

```json
{
  "delivery_status": "sent | skipped | retry_wait | failed | unknown",
  "analysis_run_id": "uuid",
  "delivery_id": "uuid",
  "attempt_count": 1,
  "message_id": null,
  "file_id": null,
  "error_code": null
}
```

## Конфигурация и безопасность

Repository export содержит только:

```text
__BITRIX_WEBHOOK_FILE_UPLOAD_URL__
__BITRIX_BOT_ID__
__BITRIX_DIALOG_ID__
__BITRIX_BOT_TOKEN__
__BITRIX_ERROR_WORKFLOW_ID__
```

По решению владельца полный webhook URL и `botToken` вводятся прямо в live-ноды. Любой последующий export обязан пройти `scripts/sanitize-bitrix-workflow-export.mjs` до добавления в Git.
