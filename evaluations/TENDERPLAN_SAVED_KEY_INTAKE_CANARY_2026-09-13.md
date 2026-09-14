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

## Owner selection and baseline evidence

Проверено 2026-09-14:

- Владелец выбрал только `6a734cce4a60de2dbf1dc032` — `Красное Сормово`.
- Exact live read-back `5TVcGDDzz56CpmfF` подтвердил этот единственный enabled
  key; workflow остаётся inactive и unpublished (`activeVersionId = null`).
- Первый manual baseline execution `26611` успешно выполнил atomic
  `Initialize Baseline`, не вызвал Intake Resume, но затем завершился `error` в
  `Baseline Summary`: per-item Code node возвращал массив вместо одного item.
- Regression fix сохраняет четыре nodes в `runOnceForEachItem` с object return,
  а `Build Dispatch Queue`, который может эмитить несколько items, выполняется
  в `runOnceForAllItems` через `$input.first().json`. Focused tests `15/15` и
  official validation всех пяти изменённых Code nodes GREEN.
- Повторный manual execution `26640` завершился `success`: marker count `1`,
  valid marker count `1`, `306` event states имеют `completed`, queue вернула
  `should_dispatch=false`, итог `dispatched=0`.
- В execution `26640` не выполнялись `Initialize Baseline`,
  `Baseline Summary`, `Execute TENDER — Intake Resume` и `Dispatch Summary`.
- Временный SELECT-only audit execution `26646` подтвердил persisted state:
  `markers=1`, `baseline_tenders=306`, `linked_runs=0`,
  `all_completed=true`. Audit workflow `lLV5F6JPlHugpkhM` архивирован.
- Read-only delta preflight execution `28212` завершился `success` и подтвердил
  неизменный полный result: `current_tenders=306`, `completed=306`,
  `processing=0`, `new=0`, `failed=0`. В графе не было dispatch/Intake Resume
  и DB writes; временный workflow `M0osEV8s7GWTjEmL` архивирован.
- Beta export синхронизирован с exact live draft version
  `2b27a678-02f2-4c23-a750-1c4d3dbda967`: workflow ID, все 19 live node IDs,
  parameters, credential references, settings и connections совпадают;
  `pinData` отсутствует.
- Владелец сообщил, что перенёс workflow в `TEST AGENTIC TENDER ANALYSIS` и
  выключил MCP access. Read-only API независимо подтвердил
  `availableInMCP=false`, `active=false`, `activeVersionId=null`; этот endpoint
  не возвращает folder metadata, поэтому folder placement остаётся
  owner-reported.

Незакрытые gates:

- новая procurement для end-to-end canary ещё не наблюдалась;
- schedule намеренно не опубликован и не активирован по решению владельца;
