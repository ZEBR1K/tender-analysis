# TENDER — TenderPlan Saved Key Intake

**Назначение:** получение новых закупок из сохранённого поиска TenderPlan.

**Статус repository candidate:** inactive; до runtime preflight список ключей
пуст и `Define Saved Keys` завершается с `SAVED_KEYS_NOT_CONFIGURED`.

## Contract

Workflow запускается вручную либо каждые 10 минут, обрабатывает включённые
saved keys последовательно (`Loop Over Saved Keys`, batch size `1`) и для каждого
ключа полностью читает `GET /api/tenders/v2/getlist?type=0&id=<key>&page=N`.
Pagination завершается только ответом с пустым массивом `tenders`; максимум —
100 страниц, интервал между запросами — 1100 ms, до трёх попыток HTTP с паузой
5000 ms. Отсутствие финальной пустой страницы, malformed body или неверный
24-символьный TenderPlan ID — hard error; partial result не dispatch-ится.

Первый полный успешный poll каждого ключа выполняет одну atomic PostgreSQL
statement. Она сохраняет все найденные tender rows как completed baseline events
и затем marker:

```text
tenderplan:key:<saved_key_id>:tender:<tender_id>
tenderplan:key:<saved_key_id>:baseline:v1
```

Marker имеет `tender_id=baseline:<saved_key_id>`,
`event_type=key_baseline_completed`, `action=baseline_initialized`. Baseline
tenders получают `event_type=key_match_baseline` и
`action=baseline_existing_skipped`. Ни одна baseline row не связывается с
`analysis_run_id` и не вызывает Intake Resume.

После baseline workflow одним batch query читает event states. Только missing и
`failed` события передаются асинхронно в `TENDER — Intake Resume` с:

```text
trigger_kind=tenderplan_key
source_event_key=tenderplan:key:<saved_key_id>:tender:<tender_id>
tender_id=<tender_id>
analysis_run_id=""
manual_override=false
observed_at=<UTC instant полного poll>
```

`processing` и `completed` подавляются. Intake Resume сохраняет idempotency и
active-run uniqueness для `(source=tenderplan, tender_id)`.

## Failure behavior

Ошибки одного ключа направляются в `Key Failure`, после чего внешний loop даёт
остальным ключам отдельную попытку. `Assert Poll Completed` агрегирует итоги и
делает execution failed, если хотя бы один ключ завершился ошибкой. Workflow
использует shared Error Workflow `kff8KIrSHzo5Mmt1`. Silent partial success не
считается успешным poll.

## Credentials and configured keys

- TenderPlan Header Auth: credential `E9gI5Mur0c8eFsN0`,
  `Тендерплан kitateh n8n автоматизация тендеров`;
- PostgreSQL: credential `RFpUr3McElcwyoxy`, `KITATEH Tenders`;
- Intake Resume: workflow `VO8Ml0sfO65w2Jiz`.

Текущий repository candidate не содержит configured keys. После credentialed
runtime preflight список фиксируется здесь и в `Define Saved Keys` exact live
read-back. Чтобы добавить или отключить ключ, изменить только `SAVED_KEYS`,
сохраняя уникальный 24-символьный `saved_key_id`, исходное display name и
boolean `enabled`; порядок — по `saved_key_id`.

## Rollback

Деактивировать только `TENDER — TenderPlan Saved Key Intake`. Baseline и key
events не удалять: это audit trail и защита от повторного запуска старых
закупок. Поддержка `tenderplan_key` в Intake Resume, Orchestrator и CHECK может
остаться — без producer она не меняет остальные входы.
