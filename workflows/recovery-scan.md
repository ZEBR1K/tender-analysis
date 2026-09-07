# TENDER — Recovery Scan

- **Статус:** repository candidate / inactive
- **Тип:** scheduled recovery workflow
- **Интервал:** каждые 10 минут

## Назначение

`TENDER — Recovery Scan` находит незавершённые `analysis_run`, которым нужно повторно передать управление в `TENDER — Intake Resume`. Он не принимает решений о конкретном действии и ничего не изменяет в PostgreSQL.

```text
Schedule Trigger
→ SELECT DISTINCT recovery candidates
→ Execute TENDER — Intake Resume (async, once per item)
```

## Кандидаты

Единственный PostgreSQL-запрос возвращает `analysis_run_id`, если run ещё не `completed` и выполняется хотя бы одно условие:

- есть документ `pending`;
- есть документ `failed` с `attempts < 2`;
- документ остаётся `processing` не менее одного часа;
- run находится в `ready_for_aggregation` или `aggregating`;
- run имеет статус `processing`, содержит документы, и все они уже `completed`/`skipped` — восстановление пропущенного readiness-перехода.

Документы `failed` с `attempts >= 2` сами по себе не создают automatic retry candidate. SQL выполняет только `SELECT`; mutation и повторная классификация принадлежат dispatcher’у.

## Вызов dispatcher

Каждая строка PostgreSQL является отдельным n8n item и запускает отдельный асинхронный вызов `TENDER — Intake Resume`:

```json
{
  "analysis_run_id": "<existing run UUID>",
  "trigger_kind": "recovery_scan",
  "manual_override": false,
  "source_event_key": "recovery:<current execution ID>:<analysis_run_id>"
}
```

Recovery Scan не вызывает Orchestrator, Document Worker, Aggregator или Finalization напрямую.

## Packaging и activation

Repository export намеренно неактивен и не содержит live workflow IDs.

Перед controlled activation нужно:

1. импортировать и опубликовать `TENDER — Intake Resume`;
2. привязать `Execute TENDER — Intake Resume` к его реальному ID;
3. импортировать и опубликовать `TENDER — Ошибка Intake Resume`;
4. записать прочитанный после импорта ID error workflow в `settings.errorWorkflow`;
5. read-back проверить обе привязки и PostgreSQL credential `KITATEH Tenders`;
6. выполнить runtime regression в изолированных тестовых workflow.

Schedule Trigger и Error Trigger работают как production executions только для опубликованного workflow; ручной запуск не подтверждает срабатывание error workflow.

До прохождения runtime gates workflow должен оставаться inactive.
