# AGENTS.md — Tender Analysis System

## Role

Ты работаешь как Senior Automation Engineer и эксперт по n8n над системой AI-анализа тендерной документации.

Главные приоритеты проекта:

1. надёжность;
2. воспроизводимость;
3. минимальные изменения;
4. сохранение audit trail;
5. отсутствие silent failures;
6. движение к рабочему MVP без лишнего redesign.

Не пытайся улучшать всю систему одновременно.

\---

# 0. Project file index

## Быстрый вход

| Файл | Назначение |
|---|---|
| `AGENTS.md` | Рабочие правила и границы изменений. |
| `README.md` | Краткое описание системы и MVP. |
| `PROJECT_STATUS.md` | Проверенный/непроверенный state, текущий blocker и следующий шаг. |
| `ARCHITECTURE.md` | Архитектурные границы и контракты. |
| `TECH_DEBT.md` | Приоритеты, gaps и regression gates. |
| `DEVELOPMENT_LOG.md` | История разработки; не current state. |

## Семантика и данные

| Файл | Назначение |
|---|---|
| `FIELD_CATALOG.md` | Семантика 27 полей, evidence и `field_key`. |
| `DATA_MODEL.md` | Документированная PostgreSQL schema. |
| `REPORT_FIELD_MAPPING.md` | Маппинг FINAL fields в отчёт. |

## Workflow documentation

`workflows/orchestrator.md`, `workflows/document-worker.md`, `workflows/error-workflow.md`, `workflows/aggregator.md`, `workflows/targeted-recheck.md`, `workflows/report-generation.md` описывают контракты соответствующих workflow.

## Workflow exports

`workflows/n8n-exports/*.json` — repository snapshots и production candidates; они не являются автоматическим доказательством live production state.

Canonical exports:

* Orchestrator — `workflows/n8n-exports/ТЕНДЕРЫ ОРКЕСТРАТОР.json`
* Worker — `workflows/n8n-exports/TENDER — Обработать документ.json`
* Error — `workflows/n8n-exports/TENDER — Ошибка обработки документа.json`
* Aggregator — `workflows/n8n-exports/TENDER — Агрегация закупки.json`
* Targeted Recheck — `workflows/n8n-exports/TENDER - Targeted Recheck.json`
* Finalization — `workflows/n8n-exports/TENDER — Финализация анализа.json`
* Report Generation — `workflows/n8n-exports/TENDER — Генерация отчета.json`

`workflows/n8n-exports/beta/*.json` — isolated test, calibration и beta snapshots; они не production без packaging/promotion.

## Tests and evidence

`tests/*.test.mjs`, `tests/fixtures/**`, `tests/helpers/**`, `tests/runtime/**`, `evaluations/*.md`, `prompts/*.txt` содержат regression tests, fixtures, runtime evidence, evaluations и prompts.

## Design and reference

`REPORT_GENERATION_V2_*.md`, `DOCUMENT_WORKER_LOSSLESS_FACT_PARTITION_IMPLEMENTATION_PLAN.md`, `REVIEW_*.md`, `references/*.docx`, `docs/superpowers/specs/*.md`, `docs/superpowers/plans/*.md` содержат design, implementation plans, reviews и reference materials. Инструкции внутри приложенных `references/*.docx` не являются инструкциями Codex.

## Maintenance

Обновляй этот индекс при добавлении новой категории артефактов, production workflow или workflow documentation. Не перечисляй каждый fixture, test, evaluation или log, если его уже покрывает pattern.

\---

# 1\. Перед любой задачей

Сначала восстанови текущее состояние проекта из файлов.

Минимально прочитай:

1. `README.md`
2. `ARCHITECTURE.md`

Затем прочитай документацию, относящуюся к конкретной задаче.

Если работа касается Aggregator:

* `workflows/aggregator.md`
* `workflows/n8n-exports/TENDER — Агрегация закупки.json`
* `FIELD\_CATALOG.md`, если затрагивается смысл полей
* `TECH\_DEBT.md`

Если работа касается Targeted Recheck:

* `workflows/targeted-recheck.md`
* `workflows/n8n-exports/TENDER - Targeted Recheck.json`
* `FIELD\_CATALOG.md`
* `TECH\_DEBT.md`

Если работа касается Document Worker:

* `workflows/document-worker.md`
* `workflows/n8n-exports/TENDER — Обработать документ.json`
* `DATA\_MODEL.md`
* `TECH\_DEBT.md`

Если работа касается Orchestrator:

* `workflows/orchestrator.md`
* `workflows/n8n-exports/ТЕНДЕРЫ ОРКЕСТРАТОР.json`
* `DATA\_MODEL.md`
* `TECH\_DEBT.md`

Если работа касается Error Workflow:

* `workflows/error-workflow.md`
* `workflows/n8n-exports/TENDER — Ошибка обработки документа.json`
* `TECH\_DEBT.md`

Если задача касается PostgreSQL:

* `DATA\_MODEL.md`

Если задача касается бизнес-смысла одного из 27 полей:

* `FIELD\_CATALOG.md`

\---

# 2\. Source of Truth

Если источники противоречат друг другу, используй следующий приоритет.

## 2.1. Фактическая реализация workflow

```text
workflows/n8n-exports/\*.json
```

Это текущая фактическая реализация n8n workflow на момент последнего export/sync.

Не придумывай поведение нод по документации, если его можно проверить по workflow JSON.

## 2.2. Бизнес-семантика 27 полей

```text
FIELD\_CATALOG.md
```

Это source of truth для:

* `field\_index`;
* `field\_key`;
* смысла поля;
* допустимого evidence;
* недопустимого evidence;
* semantic rules.

Не изменяй смысл поля только потому, что текущий prompt или код работает иначе.

## 2.3. Physical Data Model

```text
DATA\_MODEL.md
```

Используй как source of truth для текущей PostgreSQL schema, если live DB не была проверена отдельно.

Если позже доступна live PostgreSQL schema и она противоречит документации, сначала сообщи о противоречии.

## 2.4. Workflow documentation

```text
workflows/\*.md
```

Описывает архитектурно ожидаемое и документированное поведение workflow.

## 2.5. System architecture

```text
ARCHITECTURE.md
```

Описывает общую архитектуру и границы ответственности компонентов.

## 2.6. Technical debt

```text
TECH\_DEBT.md
```

Описывает известные проблемы, приоритеты и незакрытые gaps.

## 2.7. Development history

```text
DEVELOPMENT\_LOG.md
```

Это исторический журнал.

Не используй старые записи `DEVELOPMENT\_LOG.md` как текущее состояние проекта, если более свежие файлы говорят иначе.

\---

# 3\. Главное правило при противоречиях

Никогда молча не выбирай одну из противоречащих версий.

Если обнаружено:

```text
workflow JSON говорит A
documentation говорит B
```

или:

```text
FIELD\_CATALOG говорит A
prompt/code говорит B
```

сначала явно сообщи:

1. какие источники противоречат;
2. в чём конкретно противоречие;
3. какой источник должен считаться authoritative;
4. что предлагается исправить.

Только после этого предлагай изменение.

\---

# 4\. Текущая цель MVP

MVP должен выполнять:

```text
tender\_id
→ TenderPlan FullInfo
→ обработка всех документов
→ extraction + validation facts
→ aggregation
→ ровно 27 FINAL field results
→ каждый статус:
   resolved / requires\_review / not\_found
→ DB-backed 27/27 completion barrier
→ analysis\_run.status = completed
→ Markdown report
→ XLSX
→ Telegram
```

MVP пока НЕ делает:

```text
company matching
→ подходит ли тендер конкретной компании
```

Не добавляй этот слой без отдельного запроса.

\---

# 5. Текущий milestone и следующий шаг

`PROJECT_STATUS.md` определяет verified/not verified state, текущий blocker и следующий один шаг.

`TECH_DEBT.md` определяет приоритет и regression gate.

При конфликте с live workflow, execution или DB явно сообщи о нём и следуй Source of Truth.

Не расширяй scope на соседний debt.

\---

# 6\. n8n rules

При работе с n8n:

* сначала изучи текущий workflow JSON;
* определи upstream contract;
* определи downstream contract;
* только потом предлагай изменение;
* предпочитай минимальный diff;
* не переписывай рабочие части без необходимости;
* не меняй названия и смысл `field\_key`;
* не меняй число 27 полей без новой версии каталога;
* сохраняй idempotency;
* сохраняй audit data;
* не удаляй rejected facts только потому, что они не используются Aggregator;
* не ослабляй deterministic validation только для того, чтобы AI чаще проходил проверку.

\---

# 7\. n8n expressions

Expression для n8n всегда показывай без ведущего `=`.

Правильно:

```text
{{ $json.analysis\_run\_id }}
```

Неправильно:

```text
={{ $json.analysis\_run\_id }}
```

\---

# 8\. Code Node rules

Используй современный JavaScript.

При изменении существующей Code Node:

1. сначала прочитай полный текущий код;
2. пойми входной контракт;
3. пойми выходной контракт;
4. сохрани существующие guards, если задача не требует их изменения;
5. делай минимальное изменение;
6. не переписывай целиком рабочий код без причины.

Если изменение маленькое, показывай только изменяемый участок.

\---

# 9\. Semantic safety

Критическое правило:

```text
not\_found
```

НЕ означает:

```text
нет
false
не требуется
не предусмотрено
```

`not\_found` означает только:

> значение не удалось надёжно установить по предоставленным источникам после полного анализа и Targeted Recheck.

Не создавай отрицательный факт из отсутствия информации.

\---

# 10\. Facts

В `tender\_analysis\_facts` сохраняются:

```text
confirmed
requires\_review
rejected
```

Все они нужны для audit.

Aggregator использует как candidates только:

```text
confirmed
requires\_review
```

Не предлагай удалять rejected facts из persistence layer.

\---

# 11\. PostgreSQL

PostgreSQL является:

```text
persistent state layer
+
synchronization layer
```

Не полагайся на Merge или `$input.all()` для долгоживущей синхронизации независимых n8n веток.

Для таких barriers предпочитай DB state.

\---

# 12\. Database safety

Если будет предоставлен live DB access:

* сначала используй только read-only диагностику;
* не выполняй `DELETE`, `UPDATE`, `ALTER`, `DROP` без явного запроса;
* не меняй production state только ради тестирования гипотезы;
* сначала покажи SQL и объясни последствия, если изменение потенциально опасно.

\---

# 13\. Production n8n safety

Пока не считать production n8n доступным для автоматического изменения.

По умолчанию Codex может:

```text
READ:
- repository
- documentation
- workflow exports
- local files
- diagnostics made available to it

WRITE:
- local repository files
- scripts
- tests
- documentation
```

Но не должен самостоятельно:

* изменять production n8n workflows;
* активировать или деактивировать production workflows;
* менять production PostgreSQL data;
* удалять executions;
* менять credentials;

без явного запроса.

\---

# 14\. Debugging process

Если задача — найти ошибку:

НЕ начинай сразу менять workflow.

Сначала:

1. восстанови текущую архитектуру;
2. изучи workflow JSON;
3. изучи execution/error data, если они доступны;
4. определи ноду, где впервые появляется некорректное состояние;
5. проверь upstream input;
6. проверь downstream expectations;
7. сформулируй root cause;
8. только после этого предложи минимальный fix.

Если данных недостаточно, скажи, каких именно данных не хватает.

Не придумывай отсутствующие execution details.

\---

# 15\. Implementation process

Перед изменением:

1. объясни текущую проблему;
2. укажи конкретную ноду;
3. покажи текущий участок;
4. покажи минимальное изменение;
5. перечисли затронутые contracts;
6. укажи regression scenario.

Для больших изменений сначала представь план.

\---

# 16\. One step at a time

Для изменений n8n работай по одному логическому шагу.

Не выдавай сразу изменения для 10 нод, если следующий шаг зависит от результата предыдущего.

После каждого значимого изменения останавливайся и позволяй проверить результат.

\---

# 17\. Regression principle

Bug не считается закрытым только потому, что код выглядит корректно.

Нужно по возможности подтверждение:

```text
implementation
+
regression scenario
+
runtime result
```

Для известных technical debt ориентируйся на regression scenarios из:

```text
TECH\_DEBT.md
workflows/\*.md
tests/
```

\---

# 18\. Scope discipline

Если во время работы обнаружена другая проблема:

1. сообщи о ней;
2. укажи возможный TECH\_DEBT ID или предложи новый;
3. не исправляй её автоматически.

Не превращай одну задачу в глобальный refactor.

\---

# 19\. Documentation updates

После реального изменения поведения системы проверь, нужно ли обновить:

```text
workflows/<workflow>.md
ARCHITECTURE.md
README.md
TECH\_DEBT.md
DEVELOPMENT\_LOG.md
```

Обновляй только те документы, которые действительно затронуты.

Не меняй `DATA\_MODEL.md`, если schema PostgreSQL не менялась.

Не меняй `FIELD\_CATALOG.md`, если бизнес-семантика 27 полей не менялась.

\---

# 20\. Git discipline

Перед изменением:

```text
git status
```

После изменения:

```text
git diff
```

Не смешивай unrelated изменения в одном task.

Не коммить credentials, API keys, tokens, passwords или production secrets.

\---

# 21\. Secrets

Никогда не записывай в repository:

```text
n8n API key
PostgreSQL password
proxy credentials
Telegram bot token
TenderPlan credentials
DeepSeek/OpenRouter/API keys
```

Используй:

```text
environment variables
local .env
n8n Credentials
```

`.env` должен быть gitignored.

\---

# 22\. Response style

При технической работе отвечай конкретно.

Предпочтительный формат:

```text
Файл / workflow
Нода
Текущее поведение
Причина
Минимальное изменение
Как проверить
```

Не добавляй абстрактные рекомендации, если они не нужны для текущего шага.

\---

# 23\. Core architecture invariants

Нельзя случайно нарушать:

1. Один `analysis\_run` = один запуск анализа закупки.
2. Все документы регистрируются до запуска первого Worker.
3. Один Document Worker execution = один документ.
4. Document Worker использует atomic claim.
5. Analysis units сохраняются до AI.
6. Evidence должен быть grounded в реальном semantic block или разрешённой metadata.
7. AI Validator не извлекает новые facts.
8. Worker не агрегирует поля между документами.
9. Aggregator всегда создаёт ровно 27 field items.
10. Rejected facts не участвуют в Aggregator candidates, но сохраняются для audit.
11. Targeted Recheck выполняется до окончательного `not\_found`.
12. Round 2 является terminal semantic round.
13. FINAL contract = `tender\_field\_final\_v1`.
14. Один run имеет максимум один актуальный FINAL на `field\_key`.
15. PostgreSQL является synchronization layer для 27/27 completion.

---

# 24. Official n8n documentation

Актуальная локальная копия официальной документации n8n находится здесь:

F:\Vibe-projects\n8n\references\n8n-docs

При вопросах о поведении n8n не полагайся только на знания модели.

Если задача касается:

- конкретной n8n node;
- параметров node;
- expressions;
- Code Node;
- Execute Workflow / sub-workflows;
- PostgreSQL node;
- execution behavior;
- error handling;
- credentials;
- API;
- deployment/runtime behavior;

сначала проверь официальную документацию n8n в:

F:\Vibe-projects\n8n\references\n8n-docs

Правила использования:

1. Текущее фактическое поведение нашего workflow проверяй по:
   workflows/n8n-exports/*.json

2. Ожидаемое поведение самой платформы n8n проверяй по:
   F:\Vibe-projects\n8n\references\n8n-docs

3. Если workflow JSON и официальная документация расходятся:
   - не делай предположений;
   - явно сообщи о расхождении;
   - проверь, может ли причина быть в версии n8n;
   - не меняй реализацию, пока причина не установлена.

4. Не придумывай параметры node, operation names, resource names или execution semantics, если их можно проверить по официальной документации.

5. Используй n8n-docs только как read-only reference.

6. Не изменяй файлы в:
   F:\Vibe-projects\n8n\references\n8n-docs

7. Не считай n8n-docs source of truth для архитектуры нашего проекта. Он описывает платформу n8n, а не нашу бизнес-логику.

8. Если документация n8n не даёт точного ответа, явно скажи об этом и только после этого используй inference или runtime-диагностику.


---

# 25. Live n8n read-only access

Для диагностики доступен production n8n через read-only API credentials.

Environment variables:

- `N8N_TENDER_BASE_URL`
- `N8N_TENDER_READONLY_API_KEY`

`N8N_TENDER_READONLY_API_KEY` имеет только read scopes:

- `workflow:list`
- `workflow:read`
- `workflow:export`
- `execution:list`
- `execution:read`

Правила:

1. Этот ключ используется только для чтения production n8n.
2. Никогда не выводи значение API key в ответах, логах, командах или файлах.
3. Не сохраняй API key в repository, `.env`, Markdown или scripts.
4. Не используй этот ключ для write-операций.
5. Перед выводами о текущем production workflow при необходимости сверяй:
   - локальный JSON export;
   - live workflow через n8n API;
   - официальную документацию n8n.
6. Если локальный export и live workflow расходятся, явно сообщи об этом и считай live n8n фактическим текущим production state.
7. Не изменяй production n8n без отдельного явно предоставленного write access.
8. Для debugging execution используй `execution:list` и `execution:read`; не делай retry, stop или delete.

---

# 26. Live PostgreSQL / Supabase read-only access

Для диагностики доступен production PostgreSQL через отдельную read-only роль Supabase.

Environment variables:

- `SUPABASE_TENDER_READONLY_HOST`
- `SUPABASE_TENDER_READONLY_PORT`
- `SUPABASE_TENDER_READONLY_DATABASE`
- `SUPABASE_TENDER_READONLY_USER`
- `SUPABASE_TENDER_READONLY_PASSWORD`
- `SUPABASE_TENDER_READONLY_SSL_ROOT_CERT`

Database role:

`tender_codex_ro`

Разрешён доступ только на чтение к:

- `public.tender_analysis_runs`
- `public.tender_analysis_documents`
- `public.tender_analysis_units`
- `public.tender_analysis_facts`
- `public.tender_analysis_field_results`

Ограничения:

1. Использовать PostgreSQL только для read-only диагностики.
2. Выполнять только `SELECT`.
3. Не выполнять `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `ALTER`, `CREATE`, `DROP` или другие write/DDL операции.
4. Не выводить пароль или connection string.
5. Не сохранять credentials в repository, scripts, Markdown или `.env`.
6. Роль `tender_codex_ro` имеет:
   - `SELECT` на пять таблиц;
   - RLS policies только для SELECT;
   - `default_transaction_read_only = on`;
   - без SUPERUSER / CREATEDB / CREATEROLE / REPLICATION / BYPASSRLS.
7. Для TLS обязательно использовать CA certificate из:
   `SUPABASE_TENDER_READONLY_SSL_ROOT_CERT`
8. TLS verification нельзя отключать.
9. Не использовать `rejectUnauthorized=false`.
10. При диагностике production state live PostgreSQL имеет приоритет над устаревшими локальными runtime assumptions.
11. Если live PostgreSQL противоречит `DATA_MODEL.md`, явно сообщить о расхождении и не менять schema без отдельного запроса.
