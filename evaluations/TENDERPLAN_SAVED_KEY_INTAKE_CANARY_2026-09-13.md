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
