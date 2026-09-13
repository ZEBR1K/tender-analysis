# TenderPlan Saved Key Intake Canary

## Scope

Runtime evidence для baseline, одного нового tender и repeat no-op.

## Acceptance gates

- Все включённые ключи имеют completed baseline marker.
- Baseline execution не вызывает Intake Resume.
- Новый tender создаёт один key event.
- Для `(source=tenderplan, tender_id)` существует не более одного active run.
- Repeat poll не создаёт второй run.
- Первый canary завершается PDF либо фиксированной диагностированной ошибкой.

## Evidence recording rule

Добавлять только фактически проверенные execution IDs, timestamps, counts и outcomes. Не обозначать непроверенное как PASS.

## Rollout preparation evidence

Проверено 2026-09-14 перед baseline:

- PostgreSQL migration workflow execution `26498` завершился `success`.
- `tender_analysis_intake_events_trigger_kind_check` validated и разрешает ровно
  `manual`, `recovery_scan`, `tenderplan_key`, `tenderplan_mark`.
- Ledger сохранил 17 колонок и четыре индекса; counts пяти доступных read-only
  analysis tables не изменились при migration postflight.
- Live Intake Resume `VO8Ml0sfO65w2Jiz` опубликован как version
  `4f4008f4-627b-494b-ae64-72aae7dbf11c` и остался active.
- Live Orchestrator `TRLYuU7mVyE1bjjr` опубликован как version
  `76888ada-d333-4093-a202-f9c0eaec2100` и остался active.
- Read-back подтвердил неизменные connections/settings обоих существующих
  workflow и только согласованные изменения трёх Code nodes.
- Новый workflow `5TVcGDDzz56CpmfF` создан с 19 nodes и остаётся inactive и
  unpublished (`activeVersionId = null`).
- Saved-key discovery execution `26564` завершился `success` и вернул три
  однозначные пары ID/name:
  - `6a732e6c0c61629cf1d3c4af` — `арматура`;
  - `6a734cce4a60de2dbf1dc032` — `Красное Сормово`;
  - `6a7ef6e3334239a03ce52a50` — `тест n8n`.
- Временные migration/probe workflow архивированы после использования.

Незакрытые gates:

- владелец ещё не выбрал, какие из трёх saved keys включить;
- baseline execution и repeat baseline no-op ещё не запускались;
- новая procurement для end-to-end canary ещё не наблюдалась;
- schedule не опубликован и не активирован;
- live workflow пока находится в personal-project root и имеет
  `availableInMCP = true`: официальный MCP create проигнорировал переданный
  folder ID и не предоставляет update-операцию для этого флага; исправление
  требует аутентифицированного n8n UI.
