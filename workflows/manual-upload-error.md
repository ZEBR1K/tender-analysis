# TENDER — Ошибка ручной загрузки

**Тип:** production error workflow / ownership guard ручного входа

**Live workflow ID:** `xW4DHtnBYddbaU14`

**Repository export:** `workflows/n8n-exports/TENDER — Ошибка ручной загрузки.json`

## Назначение

Workflow запускается Error Trigger только при падении production execution
`TENDER — Ручная загрузка закупки`. Он не повторяет анализ и не интерпретирует
содержание документов.

```text
Error Trigger
→ bounded sanitization execution id и сообщения
→ ownership-guarded UPDATE одного manual run
```

Manual Upload заранее сохраняет свой `$execution.id` в
`tender_meta.source_payload.n8n_execution_id`. Error workflow ищет только
`source='manual_upload'` с точным совпадением этого ID.

Допустимая мутация:

```text
created / processing / ready_for_aggregation / aggregating
→ failed
```

Если ID отсутствует, найдено больше одного владельца, ownership потерян либо run
уже terminal, база не изменяется. Сообщение ограничено 500 символами и
заменяется безопасным общим текстом при признаках URL, токена или секрета.

## Границы

Этот workflow защищает audit trail и lifecycle целостность после регистрации
run. Он не является parser, semantic validator или средством проверки evidence.
