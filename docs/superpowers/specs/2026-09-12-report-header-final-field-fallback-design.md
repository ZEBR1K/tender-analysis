# Report Header Final-Field Fallback Design

## Problem

`Собрать Report Model2` формирует шапку только из `analysis_run.tender_meta`.
При ручной загрузке эти metadata могут не содержать заказчика, площадку и цену,
хотя агент уже установил их в canonical FINAL 27 fields. Поэтому готовый отчёт
показывает «Не указан(а)» над теми же значениями, которые присутствуют ниже в
таблице.

## Decision

- TenderPlan metadata остаются первым источником для шапки.
- Пустые `subject`, `customer`, `platform` и `price` дополняются из
  `procurement_subject`, `customer`, `platform` и `nm_price_with_vat`.
- Для fallback допустимы только непустые значения со статусом `resolved` или
  `requires_review`; `not_found` никогда не превращается в значение.
- `number` и `publication_at` остаются только metadata-полями: workflow их не
  выдумывает и не извлекает повторно.
- При отсутствии номера HTML-заголовок показывает «Анализ закупки без номера».
- Canonical FINAL objects не изменяются; enrichment существует только в
  presentation-модели отчёта.

## Scope

Изменяются только Code nodes `Собрать Report Model2` и `Сгенерировать HTML1` в
canonical Report Generation export, их регрессионные тесты и документация
workflow. Agent prompt, 27-field contract, Finalization, DB schema и source
validation не меняются.
