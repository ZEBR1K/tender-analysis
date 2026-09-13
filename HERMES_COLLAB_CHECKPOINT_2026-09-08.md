# Hermes Collaboration Checkpoint — 2026-09-08

## Назначение

Это отдельный checkpoint совместной работы **Константина и Hermes Agent** после того, как Константин завершил работу за компьютером и продолжил управление проектом через Telegram с телефона.

Файл не заменяет и не изменяет прежний пользовательский checkpoint. Для актуального project state по-прежнему используются `PROJECT_STATUS.md` и `TECH_DEBT.md`.

## Git-контекст

```text
Ветка: codex/tenderplan-intake-resume
Стартовая точка телефонной сессии: ba4edee08ba1a21b0393cedfeecacaa8cde6c77f
Текущий HEAD перед созданием этого checkpoint: 4d92151600cc46f1d6e6d15bbaffb62da693ed55
```

Ветка остаётся отдельной. Merge в `main` и push после стартовой точки не выполнялись.

## Состояние на момент завершения работы за компьютером

К стартовой точке уже были реализованы и offline-проверены:

- `TENDER — Intake Resume`;
- `TENDER — Manual Resume`;
- `TENDER — Recovery Scan`;
- `TENDER — Ошибка Intake Resume`;
- migration для intake ledger и unique unfinished-run rule;
- сохранение прежнего `analysis_run_id` при resume;
- запрет повторной обработки `completed` и `skipped` documents;
- automatic retry cap, manual override и stale-processing recovery;
- persistence-safe Document Worker retry;
- typed new-run-only Orchestrator contract.

Безопасный pre-DB runtime smoke был пройден, но автоматический источник тендеров по пользовательской метке TenderPlan ещё не был установлен. Следующим необходимым действием владельца было поставить реальную метку на тендер.

## Что сделали совместно после перехода на телефон

### 1. Проверили реальную метку TenderPlan

Константин поставил метку `Проверить` на тендер:

```text
TenderPlan tender ID: 6a9edb435b7165804b33d53f
Procurement number: 0372200191126000011
Mark ID: 6a732cd00c61629cf1d3c144
```

Read-only runtime execution `14683` подтвердил соответствие mark ID метке `Проверить` и membership целевого тендера.

### 2. Установили рабочий intake source contract

Notification type `5` не оказался надёжным источником: execution `14682` вернул пустой type-5 feed даже при наличии метки.

Подтверждённый источник:

```text
GET /api/tenders/v2/getlist?type=1&id=6a732cd00c61629cf1d3c144
```

Архитектурное решение: использовать polling текущего состава метки и обеспечивать идемпотентность через DB identity `source + tender_id`, не изобретая отсутствующий API cursor.

### 3. Реализовали `TENDER — TenderPlan Mark Intake`

Создан inactive repository candidate:

```text
workflows/n8n-exports/TENDER — TenderPlan Mark Intake.json
```

Контур:

```text
каждые 10 минут
→ GET current tenders for mark «Проверить»
→ fail-closed shape validation
→ dedupe tender.id и tenders[].id
→ deterministic ordering и source_event_key
→ asynchronous dispatch в TENDER — Intake Resume
```

`observed_at` не выдумывается и передаётся как `null` там, где источник не предоставляет доверенный event timestamp.

### 4. Добавили тесты и независимый review

Проверено:

```text
Focused Task 9 suite: 28/28 PASS
Candidate full suite: 521/522
Parent baseline: 517/518
Independent review: PASS
New Task 9 regressions: 0
```

Единственный full-suite failure — прежний unrelated ActiveX fixture mismatch:

```text
word/activeX/_rels/activeX5.xml.rels
actual: 286
expected: 287
```

Первый review нашёл риск silent-empty при неизвестной структуре API. Normalizer исправлен: populated response без `tender` и `tenders` теперь hard-fails. После исправления повторный review завершился PASS.

Результат зафиксирован commit:

```text
dfbdca98bfe875da7ef4f9cb486b14d42b314d1a
[verified] implement TenderPlan mark intake poller
```

### 5. Выполнили full read-only DB preflight

Создан отдельный inactive/unpublished diagnostic workflow:

```text
Workflow ID: fbjRXqyQ71toBhZK
Execution ID: 14684
```

Единственный разрешённый execution выполнил aggregate PostgreSQL `SELECT`, после чего fail-closed sanitizer остановил workflow из-за небезопасных preconditions.

Sanitized результат:

```text
current_user: postgres
transaction_read_only: off
connection_uses_ssl: false
total_run_count: 97
unfinished_run_count: 86
duplicate_unfinished_group_count: 3
intake_events_table_exists: false
unfinished_run_unique_index_exists: false
intake_run_index_exists: false
intake_status_started_index_exists: false
```

Вердикт:

```text
DB migration: NO-GO
Inactive intake stack import: NO-GO
Production activation: NO-GO
```

Причины:

- диагностическое подключение не использует роль `tender_codex_ro`;
- transaction не read-only;
- SSL отключён;
- существуют три duplicate unfinished `(source, tender_id)` groups;
- intake ledger и необходимые indexes ещё отсутствуют.

Данные и schema PostgreSQL не изменялись. Retry execution не выполнялся.

Evidence и project status зафиксированы commit:

```text
4d92151600cc46f1d6e6d15bbaffb62da693ed55
docs: record intake DB preflight 14684
```

## Текущий итог относительно стартовой точки

На старте телефонной сессии intake/resume repository candidate существовал, но автоматический вход по метке TenderPlan отсутствовал.

Сейчас:

```text
TenderPlan mark source contract: подтверждён runtime
Automatic mark poller: реализован и offline-проверен
Independent review: PASS
DB deployment preflight: выполнен
Фактические DB blockers: установлены
Production deployment: не начат
```

Последняя крупная дыра repository-реализации — автоматическое обнаружение тендера по метке — закрыта. Оставшиеся шаги относятся преимущественно к безопасному DB reconciliation, migration, inactive import/wiring и runtime rollout.

## Что требуется от владельца дальше

Пока Константин работает только с телефона, немедленных действий не требуется.

Когда будет доступ к компьютеру, нужен один следующий prerequisite:

1. Создать в n8n отдельный PostgreSQL credential, например `kitatech tenders READONLY`.
2. Использовать роль `tender_codex_ro`.
3. Включить CA-verified TLS.
4. Не заменять production credential `kitatech tenders`.
5. Сообщить Hermes только имя созданного credential; пароль, connection string и CA содержимое в чат не передавать.

После отдельного согласования следующий безопасный контур:

```text
read-only forensic трёх duplicate groups
→ owner-approved reconciliation decision
→ повторный preflight с exactly 0 duplicates
→ отдельное разрешение на migration
→ inactive workflow import и binding
→ controlled runtime matrix
→ отдельное разрешение на activation
```

## Production boundary

За время этой совместной телефонной сессии не выполнялись:

- PostgreSQL writes или migration;
- изменение production workflows;
- activation/publication candidate workflows;
- изменение credentials;
- Worker/AI production canary;
- delivery;
- merge в `main`;
- push текущих локальных commits.

Единственные n8n mutations были отдельно разрешёнными созданием inactive/unpublished diagnostic probe и его однократным execution для read-only preflight.
