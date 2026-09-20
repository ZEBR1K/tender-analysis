# Bitrix retry workflow

Статус: локальный неактивный beta-кандидат. Production n8n не изменён.

Экспорт: `workflows/n8n-exports/beta/[BITRIX] TENDER — Повторить доставки Bitrix.json`.

## Назначение

Worker выполняется каждую минуту и обрабатывает только доставки, для которых Bitrix ранее явно подтвердил временную недоставку.

```text
Каждую минуту
-> Выбрать доставки для повтора
-> Call 'TENDER — Генерация отчета'
-> Call 'TENDER — Отправить отчёт в Bitrix'
```

## Выбор строк

SQL выбирает максимум 10 строк, одновременно удовлетворяющих условиям:

```text
channel = 'bitrix'
status = 'retry_wait'
next_attempt_at <= now()
```

`sent`, `failed`, `unknown`, `pending` и `sending` не читаются этим worker по конструкции.

Перед регенерацией повторно проверяется:

- `tender_analysis_runs.status = 'completed'`;
- ровно 27 ожидаемых `field_index + field_key`;
- все 27 FINAL имеют допустимый status;
- все 27 используют `tender_fields_v1` и `tender_field_final_v1`.

## Регенерация и отправка

Оба Execute Sub-workflow работают в режиме `each` и ждут завершения. Report Generation получает `analysis_run_id`, заново строит детерминированные HTML/PDF artifacts, а его полный выход вместе с `binary.report_pdf` без JSON-only mapping передаётся Delivery.

Повторная генерация PDF допустима. Повторная отправка защищена atomic claim в Delivery: конкурирующие executions могут создать одинаковый PDF, но только один переведёт due `retry_wait` в `sending`.

Delivery увеличивает `attempt_count`; суммарный предел — четыре HTTP-вызова. Только новый явный временный отказ Bitrix может снова вернуть строку в `retry_wait`.

## Fail-closed

Retry и Delivery используют `[BITRIX] TENDER — Ошибка доставки Bitrix` как workflow-level error workflow. Он обновляет только строку с совпадающим `n8n_execution_id` и `status='sending'`:

```text
sending -> unknown
next_attempt_at = NULL
```

Stack trace, raw error, параметры нод и request URL в PostgreSQL не сохраняются. `unknown` автоматически не повторяется.
