# Handoff для Hermes Agent

## Цель продолжения

Спроектировать минимальный следующий шаг перехода от текущей n8n-системы к
гибридному агентскому анализу, не теряя audit trail, 27/27 barrier и semantic
safety.

## Authoritative context

Внутри этого evaluation bundle:

1. `comparison.md` — выводы проверки.
2. `status-matrix.csv` — полная матрица статусов.
3. `inputs/FIELD_CATALOG.md` — snapshot семантического контракта теста.
4. `common-prompt.txt` — prompt четырёх запусков.
5. `raw/*/codex-result.md` — неизменённые результаты.
6. `raw/*/*log*` — неизменённые логи.
7. `SHA256SUMS.txt` — контроль целостности пакета.

Для текущего состояния проекта дополнительно обязательно читать корневые:

```text
PROJECT_STATUS.md
ARCHITECTURE.md
TECH_DEBT.md
FIELD_CATALOG.md
```

Корневой `FIELD_CATALOG.md` может быть новее snapshot в этом bundle. Snapshot
нужен для воспроизводимости теста; текущая разработка должна следовать корневому
authoritative каталогу и явно фиксировать отличия версий.

## Зафиксированные проблемы, которые нельзя потерять

1. `resolved` при уже обнаруженном конфликте (`national_regime`, run-3/exec).
2. Арифметическая ошибка в производном количестве (`10` вместо `11`, run-1).
3. Общий семантический дрейф границы `licenses_certificates` во всех запусках.
4. Неустойчивое различение `not_found` и `requires_review`.
5. Неустойчивый статус `application_documents` при конфликтующих формах.
6. Majority vote не защищает от общей ошибки нескольких одинаковых моделей.

## Рекомендуемый один следующий шаг

Не заменять сразу существующие workflow. Сначала создать offline evaluator для
результата одного агентского запуска:

```text
agent JSON
→ ровно 27 уникальных field_key
→ valid status enum
→ literal quote/source check
→ conflict-in-rationale blocks resolved
→ arithmetic checks
→ field-specific allow/deny checks
→ evaluation artifact
```

Минимальный regression dataset на первом этапе — четыре результата этого bundle.
Evaluator должен как минимум обнаружить:

- неправильное количество run-1;
- false-resolved `national_regime` run-3 и exec;
- false-resolved `application_documents` run-3;
- запрещённые типы документов в `licenses_certificates` всех четырёх запусков.

Только после прохождения offline gate следует выбирать место в n8n, где агентский
анализ подключается параллельно текущему pipeline в shadow mode.

## Scope boundary

На первом шаге не менять production n8n, production PostgreSQL и существующий
27-field contract. Не превращать evaluation work в redesign всей системы.

