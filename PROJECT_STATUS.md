# PROJECT STATUS — Tender Analysis

**Snapshot date:** 2026-08-28
**Status:** Active development / test hardening before client report
**Branch at snapshot:** `main`

Этот файл — короткий оперативный снимок. Он не заменяет:

- live n8n export как фактическое состояние workflow;
- `FIELD_CATALOG.md` как source of truth для смысла 27 полей;
- `DATA_MODEL.md` как описание PostgreSQL schema;
- `TECH_DEBT.md` как полный backlog;
- `DEVELOPMENT_LOG.md` как историю.

## 1. Current business goal

```text
полный корректный анализ тестовой закупки по всем документам
→ ручная проверка итоговых 27 полей
→ клиентский отчёт для Дмитрия
```

До отправки отчёта должны быть закрыты P0-риски, способные дать `false_resolved`, `false_not_found` или неполный результат.

## 2. Production / test boundary

### Production workflows

| Workflow | ID | Active | Read-only snapshot 2026-08-28 |
|---|---|---:|---|
| `TENDER — Обработать документ` | `1Pw61ZY3HgBSvcUr` | yes | API вернул 37 nodes, version `f3d9fdb3-…`; test hardening ниже не promoted |
| `TENDER — Агрегация закупки` | `iLt7wLLfueg8qffZ` | yes | published active: 38 nodes/version `c4bbee79-…`; current unpublished draft: 24 nodes/version `89b33d04-…` |
| `TENDER — Финализация анализа` | `cSsh9yjpS7t5p0OO` | yes | 5 nodes; protected workflow, не менялся в текущем цикле |
| `TENDER — Генерация отчета` | `ckPnP3hRhKu4Mf9u` | yes | 9 nodes; protected workflow, не менялся в текущем цикле |

Production PostgreSQL и published production workflows в текущем цикле Codex не изменялись намеренно. Read-only API подтвердил, что новый 24-нoded Aggregator draft не опубликован: production executions продолжают использовать 38-нoded active version `c4bbee79-…`.

### MCP-enabled test workflows

| Workflow | ID | Active | Current purpose |
|---|---|---:|---|
| `[3 TEST] TENDER — Обработать документ` | `2T7szFpiGcfNpKkB` | no | runtime canary Document Worker, 60 nodes, version `71d69ab3-…` |
| `[TEST CODEX] TENDER — Агрегация закупки` | `ftvmrEHoMbPOAqZG` | no | isolated Aggregator prompt work, 24 nodes, version `98d8c2ed-…` |

MCP доступ включён только для тестового контура. Это не является разрешением менять production workflows.

Repository также содержит inactive local-only export `[TEMP] TENDER — Ручная загрузка файлов` (`tmpManual16726ZO`, 8 nodes). Несмотря на имя, его текущая роль — сформировать calibration fixture, зарегистрировать test run/documents и вызвать test Worker; это не production manual-upload feature.

## 3. Document Worker test candidate

В `[3 TEST]` реализованы:

1. bounded Evidence Repair и lossless Fact Partition;
2. одинаковая exact-grounding semantics на validation attempt 1/2;
3. audited deterministic rejection для pure exact-grounded `overlap_only`;
4. document-level dispatch:
   - `units_for_ai` при `verified_facts.length > 0`;
   - `units_without_ai` при `verified_facts.length === 0`;
   - exact unit-set convergence без per-unit Validator loop и без Merge;
5. `VALIDATOR_FIELD_PROFILES` версии `validator_field_profiles_v1` для ровно 27 canonical `field_key`;
6. hard error для unknown/missing Validator profile до HTTP;
7. fact-local material literal guard `fact_local_material_literals_v1`;
8. Gemini 3.7 Flash в тестовом AI Validator.

### Runtime evidence

Execution `14104` подтвердил:

```text
66 analysis units
65 passed evidence attempt 1
1 passed bounded repair
20 units_for_ai + 46 units_without_ai = 66
61 persisted facts
41 confirmed / 2 requires_review / 18 rejected
```

Fact-local guard изменил ровно один AI verdict:

```text
doc_7_au_0001 / fact_index=4 / advance_contract_guarantee
confirmed → requires_review
missing literal: 30%
```

Pure `overlap_only` fact был сохранён как audited `rejected`, а не потерян и не отправлен в AI Validator.

### Promotion blockers

Локальный файл `workflows/n8n-exports/TENDER — Обработать документ.json` сейчас является export тестового workflow, а не production import candidate:

- workflow name содержит `[3 TEST]`;
- присутствуют Manual Trigger, calibration persistence nodes и `pinData`;
- canonical production persistence path не подключён к completeness barrier.

Поэтому он **не должен импортироваться поверх production** до отдельной promotion-задачи и GREEN двух production-packaging tests.

## 4. Aggregator current blocker

Execution-derived regression для `procurement_subject` показывает возможность schema-valid `false_resolved`:

- корректные candidates описывают закупаемые стандартные закрытия палуб;
- внутренний процесс поддержания технологического оборудования тоже пришёл как `confirmed`;
- текущий Round 1 checker проверяет IDs/cardinality/roles, но не может доказать semantic applicability;
- ложный AI response может выбрать внутренний процесс `primary` и сформировать FINAL.

Создан route-aware offline harness с execution `14104` и neutral anti-overfit controls. Реализация Aggregator ещё не менялась.

Следующий согласованный минимальный шаг:

```text
усилить только universal procurement_subject FIELD_RULES
в [TEST CODEX] Aggregator
→ runtime eval
→ проверить, что ambiguous scope уходит в Targeted Recheck
→ не менять checker/topology/SQL/protected production workflow
```

Backlog ID: `AG-8`.

## 5. Test status

Fresh full offline suite on 2026-08-28:

```text
127 tests
124 passed
3 failed
```

Падающие tests являются открытыми gates, а не случайными regression failures:

1. `AG-8`: отсутствует universal current-scope boundary в `procurement_subject FIELD_RULES`;
2. Document Worker completeness barrier не подключён к canonical `Сохранить analysis unit`;
3. Document Worker export пока содержит test/calibration topology и `pinData`.

Этот checkpoint не является release-ready или production-ready состоянием.

## 6. Verified / not verified

### Verified

- execution-derived Document Worker regressions `14006–14017`, `14059`, `14061`, `14075`, `14103`, `14104`;
- exact evidence grounding не заменено fuzzy/OCR matching;
- lossless fact partition и item linking покрыты offline tests;
- Validator field profiles покрывают ровно 27 canonical keys;
- fact-local material literal guard не использует соседние facts или общий context как evidence;
- Aggregator candidate SQL по-прежнему исключает `rejected` и включает `confirmed`/`requires_review`;
- Aggregator route-aware harness не материализует Round 1 FINAL для `requires_recheck`.

### Not verified

- production promotion Document Worker;
- полный clean run новой закупки от Orchestrator до нового отчёта после текущего hardening;
- runtime semantic GREEN Aggregator для execution `14104` candidate set;
- причина и дальнейшая судьба unpublished 24-нoded production Aggregator draft;
- ручная бизнес-проверка всех 27 полей клиентского результата.

## 7. Canonical export drift

На snapshot date exports имеют разные роли:

- Document Worker canonical path содержит `[3 TEST]` export;
- Aggregator local export содержит 38 nodes и совпадает с published active node set/connections; известное отличие параметров — provider pin в model alias ноды `Semantic Aggregator`;
- 24-нoded production Aggregator draft не опубликован и соответствует очищенному core graph без disabled legacy/test nodes;
- защищённые workflow JSON не изменялись автоматически в рамках этого checkpoint.

Для production поведения authoritative остаётся published active version, а не current draft. Перед любой promotion всё равно нужен повторный live read-back; молчаливо подменять published export draft-версией нельзя.

## 8. Next checkpoint criterion

Следующий статус можно считать лучше текущего только после:

```text
AG-8 prompt GREEN offline
→ Aggregator runtime canary в [TEST CODEX]
→ clean Document Worker promotion candidate
→ полный новый test run
→ 27/27 manual semantic review
→ client report
```
