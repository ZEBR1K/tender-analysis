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

---

# 1. Перед любой задачей

Сначала восстанови текущее состояние проекта из файлов.

Минимально прочитай:

1. `README.md`
2. `ARCHITECTURE.md`

Затем прочитай документацию, относящуюся к конкретной задаче.

Если работа касается Aggregator:

- `workflows/aggregator.md`
- `workflows/n8n-exports/TENDER — Агрегация закупки.json`
- `FIELD_CATALOG.md`, если затрагивается смысл полей
- `TECH_DEBT.md`

Если работа касается Targeted Recheck:

- `workflows/targeted-recheck.md`
- `workflows/n8n-exports/TENDER - Targeted Recheck.json`
- `FIELD_CATALOG.md`
- `TECH_DEBT.md`

Если работа касается Document Worker:

- `workflows/document-worker.md`
- `workflows/n8n-exports/TENDER — Обработать документ.json`
- `DATA_MODEL.md`
- `TECH_DEBT.md`

Если работа касается Orchestrator:

- `workflows/orchestrator.md`
- `workflows/n8n-exports/ТЕНДЕРЫ ОРКЕСТРАТОР.json`
- `DATA_MODEL.md`
- `TECH_DEBT.md`

Если работа касается Error Workflow:

- `workflows/error-workflow.md`
- `workflows/n8n-exports/TENDER — Ошибка обработки документа.json`
- `TECH_DEBT.md`

Если задача касается PostgreSQL:

- `DATA_MODEL.md`

Если задача касается бизнес-смысла одного из 27 полей:

- `FIELD_CATALOG.md`

---

# 2. Source of Truth

Если источники противоречат друг другу, используй следующий приоритет.

## 2.1. Фактическая реализация workflow

```text
workflows/n8n-exports/*.json
```

Это текущая фактическая реализация n8n workflow на момент последнего export/sync.

Не придумывай поведение нод по документации, если его можно проверить по workflow JSON.

## 2.2. Бизнес-семантика 27 полей

```text
FIELD_CATALOG.md
```

Это source of truth для:

- `field_index`;
- `field_key`;
- смысла поля;
- допустимого evidence;
- недопустимого evidence;
- semantic rules.

Не изменяй смысл поля только потому, что текущий prompt или код работает иначе.

## 2.3. Physical Data Model

```text
DATA_MODEL.md
```

Используй как source of truth для текущей PostgreSQL schema, если live DB не была проверена отдельно.

Если позже доступна live PostgreSQL schema и она противоречит документации, сначала сообщи о противоречии.

## 2.4. Workflow documentation

```text
workflows/*.md
```

Описывает архитектурно ожидаемое и документированное поведение workflow.

## 2.5. System architecture

```text
ARCHITECTURE.md
```

Описывает общую архитектуру и границы ответственности компонентов.

## 2.6. Technical debt

```text
TECH_DEBT.md
```

Описывает известные проблемы, приоритеты и незакрытые gaps.

## 2.7. Development history

```text
DEVELOPMENT_LOG.md
```

Это исторический журнал.

Не используй старые записи `DEVELOPMENT_LOG.md` как текущее состояние проекта, если более свежие файлы говорят иначе.

---

# 3. Главное правило при противоречиях

Никогда молча не выбирай одну из противоречащих версий.

Если обнаружено:

```text
workflow JSON говорит A
documentation говорит B
```

или:

```text
FIELD_CATALOG говорит A
prompt/code говорит B
```

сначала явно сообщи:

1. какие источники противоречат;
2. в чём конкретно противоречие;
3. какой источник должен считаться authoritative;
4. что предлагается исправить.

Только после этого предлагай изменение.

---

# 4. Текущая цель MVP

MVP должен выполнять:

```text
tender_id
→ TenderPlan FullInfo
→ обработка всех документов
→ extraction + validation facts
→ aggregation
→ ровно 27 FINAL field results
→ каждый статус:
   resolved / requires_review / not_found
→ DB-backed 27/27 completion barrier
→ analysis_run.status = completed
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

---

# 5. Текущий следующий milestone

Текущая главная задача проекта:

```text
AG-0
```

Нужно реализовать:

```text
FINAL field UPSERT
        ↓
DB-backed проверка 27/27
        ↓
atomic completion claim
        ↓
aggregating → completed
        ↓
report stage
```

Не расширяй scope этой задачи на unrelated technical debt.

---

# 6. n8n rules

При работе с n8n:

- сначала изучи текущий workflow JSON;
- определи upstream contract;
- определи downstream contract;
- только потом предлагай изменение;
- предпочитай минимальный diff;
- не переписывай рабочие части без необходимости;
- не меняй названия и смысл `field_key`;
- не меняй число 27 полей без новой версии каталога;
- сохраняй idempotency;
- сохраняй audit data;
- не удаляй rejected facts только потому, что они не используются Aggregator;
- не ослабляй deterministic validation только для того, чтобы AI чаще проходил проверку.

---

# 7. n8n expressions

Expression для n8n всегда показывай без ведущего `=`.

Правильно:

```text
{{ $json.analysis_run_id }}
```

Неправильно:

```text
={{ $json.analysis_run_id }}
```

---

# 8. Code Node rules

Используй современный JavaScript.

При изменении существующей Code Node:

1. сначала прочитай полный текущий код;
2. пойми входной контракт;
3. пойми выходной контракт;
4. сохрани существующие guards, если задача не требует их изменения;
5. делай минимальное изменение;
6. не переписывай целиком рабочий код без причины.

Если изменение маленькое, показывай только изменяемый участок.

---

# 9. Semantic safety

Критическое правило:

```text
not_found
```

НЕ означает:

```text
нет
false
не требуется
не предусмотрено
```

`not_found` означает только:

> значение не удалось надёжно установить по предоставленным источникам после полного анализа и Targeted Recheck.

Не создавай отрицательный факт из отсутствия информации.

---

# 10. Facts

В `tender_analysis_facts` сохраняются:

```text
confirmed
requires_review
rejected
```

Все они нужны для audit.

Aggregator использует как candidates только:

```text
confirmed
requires_review
```

Не предлагай удалять rejected facts из persistence layer.

---

# 11. PostgreSQL

PostgreSQL является:

```text
persistent state layer
+
synchronization layer
```

Не полагайся на Merge или `$input.all()` для долгоживущей синхронизации независимых n8n веток.

Для таких barriers предпочитай DB state.

---

# 12. Database safety

Если будет предоставлен live DB access:

- сначала используй только read-only диагностику;
- не выполняй `DELETE`, `UPDATE`, `ALTER`, `DROP` без явного запроса;
- не меняй production state только ради тестирования гипотезы;
- сначала покажи SQL и объясни последствия, если изменение потенциально опасно.

---

# 13. Production n8n safety

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

- изменять production n8n workflows;
- активировать или деактивировать production workflows;
- менять production PostgreSQL data;
- удалять executions;
- менять credentials;

без явного запроса.

---

# 14. Debugging process

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

---

# 15. Implementation process

Перед изменением:

1. объясни текущую проблему;
2. укажи конкретную ноду;
3. покажи текущий участок;
4. покажи минимальное изменение;
5. перечисли затронутые contracts;
6. укажи regression scenario.

Для больших изменений сначала представь план.

---

# 16. One step at a time

Для изменений n8n работай по одному логическому шагу.

Не выдавай сразу изменения для 10 нод, если следующий шаг зависит от результата предыдущего.

После каждого значимого изменения останавливайся и позволяй проверить результат.

---

# 17. Regression principle

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
TECH_DEBT.md
workflows/*.md
tests/
```

---

# 18. Scope discipline

Если во время работы обнаружена другая проблема:

1. сообщи о ней;
2. укажи возможный TECH_DEBT ID или предложи новый;
3. не исправляй её автоматически.

Не превращай одну задачу в глобальный refactor.

---

# 19. Documentation updates

После реального изменения поведения системы проверь, нужно ли обновить:

```text
workflows/<workflow>.md
ARCHITECTURE.md
README.md
TECH_DEBT.md
DEVELOPMENT_LOG.md
```

Обновляй только те документы, которые действительно затронуты.

Не меняй `DATA_MODEL.md`, если schema PostgreSQL не менялась.

Не меняй `FIELD_CATALOG.md`, если бизнес-семантика 27 полей не менялась.

---

# 20. Git discipline

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

---

# 21. Secrets

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

---

# 22. Response style

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

---

# 23. Core architecture invariants

Нельзя случайно нарушать:

1. Один `analysis_run` = один запуск анализа закупки.
2. Все документы регистрируются до запуска первого Worker.
3. Один Document Worker execution = один документ.
4. Document Worker использует atomic claim.
5. Analysis units сохраняются до AI.
6. Evidence должен быть grounded в реальном semantic block или разрешённой metadata.
7. AI Validator не извлекает новые facts.
8. Worker не агрегирует поля между документами.
9. Aggregator всегда создаёт ровно 27 field items.
10. Rejected facts не участвуют в Aggregator candidates, но сохраняются для audit.
11. Targeted Recheck выполняется до окончательного `not_found`.
12. Round 2 является terminal semantic round.
13. FINAL contract = `tender_field_final_v1`.
14. Один run имеет максимум один актуальный FINAL на `field_key`.
15. PostgreSQL является synchronization layer для 27/27 completion.
