# TENDER — Ошибка агентского анализа

**Статус:** identity-neutral repository candidate; imported live copy is inactive
**Тип:** n8n Error Workflow
**Repository export:** `workflows/n8n-exports/TENDER — Ошибка агентского анализа.json`
**Live workflow ID:** `6ccedae778a14176`

## Ответственность

Обработчик принимает documented payload `Error Trigger` и изменяет только
`public.tender_agentic_jobs`. Он не обращается к runner, не меняет исходные или
staged документы, artifacts и shadow field results, не запускает retry и не
затрагивает legacy pipeline.

Граф содержит три последовательные ноды:

```text
Error Trigger
→ Нормализовать agentic error
→ Применить ownership guard
```

## Безопасный вход

Classifier использует только `execution.id`, `execution.error.message`,
`execution.error.description` и `workflow.name`. Полный payload, URL, stack,
binary, headers и произвольные вложенные поля не передаются дальше. Execution ID
должен быть непустой строкой не длиннее 4096 символов. Сообщение очищается от
control characters и ограничивается 500 символами. Любая URI-схема/URL-like
token, маркированный secret и unlabeled JWT/prefix/long credential-shaped token
заменяются безопасным generic message.

Ошибки двух owner-workflow распознаются только по точным именам:

- `TENDER — Агентский анализ — Запуск` → `dispatch`;
- `TENDER — Агентский анализ — Монитор` → `monitor`.

Неизвестное имя и отсутствующий/некорректный execution ID дают typed no-op.
Официальная документация n8n допускает отсутствие `execution.id`, если ошибка
возникла в trigger node, поэтому это нормальный fail-closed исход.

## Atomic ownership statement

Одна parameterized PostgreSQL-нода выполняет mutually exclusive CTE:

- Dispatch может перевести в `failed` только job с точным
  `dispatch_execution_id` и статусом `created`, `staging` или `ready`.
  Меняются только job status/dispatch owner/bounded error/timestamp. Staged
  document rows и runner audit/artifacts сохраняются.
- Monitor может только очистить точные `poll_owner_execution_id` и
  `poll_claimed_at` у `ready`, `running` или `validating` job и записать bounded
  `validation_summary.monitor_error` и bounded counter
  `validation_summary.monitor_error_count` (cap 1,000,000). Status не меняется.
- Оба mutation predicate повторно проверяют exact execution owner и eligible
  status непосредственно в `UPDATE`, поэтому concurrent owner/status change
  превращается в explicit zero-update outcome.
- `completed`, `canceled` и `failed` не изменяются.

Dispatch сначала считает все строки exact owner. Ровно одна eligible строка
может измениться; ноль даёт no-op, а больше одной даёт
`ownership_ambiguous` без мутаций или SQL exception. Один Monitor execution
штатно владеет максимум двумя jobs: handler атомарно освобождает все его exact
eligible leases, а aggregate `update_count` и `job_ids` не размножают output
items. Corrupt Monitor cardinality больше двух возвращает
`ownership_ambiguous` и ничего не освобождает. Statement всегда возвращает
ровно одну строку с одним из исходов:

```text
dispatch_failed
monitor_lease_released
terminal_no_op
ownership_lost
invalid_identity
unsupported_workflow
ownership_ambiguous
```

`alwaysOutputData=true` является дополнительной защитой n8n, но zero-row
semantics не зависят от неё: финальный `SELECT` сам возвращает outcome.

## Packaging и runtime gates

Repository export inactive, не содержит top-level instance identity, `meta`, pin
data или секретов; PostgreSQL credential в нём остаётся import placeholder.
Read-only live reconciliation подтвердил, что импортированный inactive graph
после masking instance workflow ID и bound credential ID совпадает с repository
candidate, а ожидаемый PostgreSQL credential type связан. Live Dispatch и
Monitor указывают на этот workflow через реальные `settings.errorWorkflow`.
Execution-list endpoint вернул для Error workflow ноль executions.

Automatic-failure canary и activation gates не пройдены. Ручной запуск не
проверяет Error Trigger: по документации n8n handler вызывается только при
ошибке automatic execution. Workflow не активирован, legacy pipeline не
изменён.
