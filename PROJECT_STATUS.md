# PROJECT STATUS — Tender Analysis

**Snapshot date:** 2026-08-29
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
| `[3 TEST] TENDER — Обработать документ` | `2T7szFpiGcfNpKkB` | no | runtime canary Document Worker, 60 nodes, version `2f3e1ea6-…`; Extractor alias синхронизирован с tested beta baseline |
| `[TEST CODEX] TENDER — Агрегация закупки` | `ftvmrEHoMbPOAqZG` | no | AG-8 verified test candidate, 24 nodes, version `0147805e-…` |

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
8. GLM 5.3 Flash low в тестовом Extractor;
9. Gemini 3.7 Flash low в тестовом AI Validator.

### Extractor model-selection checkpoint

На одинаковых 16 pinned units проверены:

```text
GLM 5.3 Flash low/high
GLM 5.2 low/without reasoning
Gemini 3.7 Flash low
GPT-5.6 Luna Pro low
GPT-5.4 Nano low
GPT-5 Mini low
DeepSeek V4 Flash 0731
```

По reliability-first приоритету текущим provisional baseline выбран:

```text
z-ai/glm-5.3-flash@provider=cloudflare&reasoning_effort=low
```

Gemini 3.7 Flash low оставлен fallback-кандидатом. Поиск новых моделей на этом fixture остановлен; сводный evidence-backed отчёт находится в `evaluations/EXTRACTOR_MODEL_COMPARISON_2026-08-29.md`.

MCP read-back тестового Worker подтвердил атомарное изменение только `AI Extractor v1.0`: alias приведён с временного `@provider=deepinfra/fp8` к протестированному `@provider=cloudflare`; workflow остался inactive/unpublished, node count `60`, connections, settings, pin data и credentials не изменились.

Этот выбор подтверждает только сравнительный Extractor result. Full path Evidence Repair → AI Validator → persistence с выбранной связкой ещё требует отдельного runtime canary.

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

### Offline production candidate packaging

Test/calibration workflow сохранён без изменений как immutable snapshot:

```text
workflows/n8n-exports/beta/[3 TEST] TENDER — Обработать документ.json
60 nodes
SHA-256: 02e4e5ccc761ecf78771c2ae4a3c4e529f3536533de2d9e7a5ef2084fe0459dd
```

Canonical path теперь содержит clean offline production candidate:

```text
workflows/n8n-exports/TENDER — Обработать документ.json
name = TENDER — Обработать документ
51 nodes
active = false
settings.availableInMCP = false
pinData = {}
```

Из beta удалены только девять test/calibration nodes; shared node parameters, credentials, types и runtime settings защищены beta→canonical regression. Canonical persistence path подключён к completeness barrier, Manual Trigger отсутствует, top-level `id`, `versionId` и `meta` удалены.

Это только import packaging: live production Worker `1Pw61ZY3HgBSvcUr` не изменён, candidate ещё не promoted/wired и runtime canary для него не выполнялся.

## 4. Aggregator AG-8 test mitigation

Execution-derived regression для `procurement_subject` показывает возможность schema-valid `false_resolved`:

- корректные candidates описывают закупаемые стандартные закрытия палуб;
- внутренний процесс поддержания технологического оборудования тоже пришёл как `confirmed`;
- текущий Round 1 checker проверяет IDs/cardinality/roles, но не может доказать semantic applicability;
- ложный AI response может выбрать внутренний процесс `primary` и сформировать FINAL.

Vulnerability остаётся production gate, но AG-8 теперь mitigated и verified в изолированном `[TEST CODEX]` workflow:

```text
universal procurement_subject FIELD_RULES
→ offline beta contract GREEN
→ MCP read-back workflow ftvmrEHoMbPOAqZG
→ один paid runtime canary на execution-derived fixture 14104
→ semantic oracle GREEN (6/6)
```

Runtime canary подтвердил:

```text
ai_called = true
checker_accepted = true
route = round1_final
final_status = resolved
doc_7_au_0031 = not_applicable
primary = doc_7_au_0001
semantic_oracle_passed = true
exit code = 0
```

Beta export SHA-256: `95a04f8f7c054fda00b55abed0338cc66ba6c3c90d52e10698265b03d05bdb0c`.

Это **не** означает, что production исправлен: production Aggregator и canonical production export не менялись, production promotion test остаётся отдельным RED gate, а fresh 27/27 run ещё не выполнен. Backlog ID `AG-8` остаётся открытым до promotion и fresh full-run verification.

## 5. Test status

Fresh full offline suite after Document Worker packaging on 2026-08-29:

```text
139 tests
138 passed
1 failed
```

Единственный падающий test — намеренный `AG-8` production promotion gate: canonical production Aggregator ещё не содержит verified test boundary. Document Worker suites теперь GREEN: Worker `78/78`, Validator `31/31`.

Этот checkpoint не является release-ready или production-ready состоянием.

## 6. Verified / not verified

### Verified

- execution-derived Document Worker regressions `14006–14017`, `14059`, `14061`, `14075`, `14103`, `14104`;
- exact evidence grounding не заменено fuzzy/OCR matching;
- lossless fact partition и item linking покрыты offline tests;
- Validator field profiles покрывают ровно 27 canonical keys;
- fact-local material literal guard не использует соседние facts или общий context как evidence;
- Aggregator candidate SQL по-прежнему исключает `rejected` и включает `confirmed`/`requires_review`;
- Aggregator route-aware harness не материализует Round 1 FINAL для `requires_recheck`;
- AG-8 offline beta contract, MCP read-back и один paid runtime canary execution-derived case `14104` прошли GREEN;
- runtime canary назначил `doc_7_au_0031` роль `not_applicable`, выбрал `doc_7_au_0001` primary и прошёл 6/6 semantic oracle checks.
- immutable Document Worker beta snapshot сохранён с ожидаемым SHA-256;
- canonical Document Worker JSON является clean offline production candidate, а beta→canonical packaging contract проходит regression.

### Not verified

- promotion/wiring clean Document Worker candidate в test/production contour;
- full runtime canary Document Worker candidate с зафиксированной связкой GLM Extractor + Gemini Validator;
- production promotion Aggregator AG-8 boundary;
- полный clean run новой закупки от Orchestrator до нового отчёта после текущего hardening;
- причина и дальнейшая судьба unpublished 24-нoded production Aggregator draft;
- ручная бизнес-проверка всех 27 полей клиентского результата.

## 7. Canonical export drift

На snapshot date exports имеют разные роли:

- `workflows/n8n-exports/beta/[3 TEST] TENDER — Обработать документ.json` — неизменяемый 60-node test/calibration snapshot;
- Document Worker canonical path — clean inactive 51-node offline production candidate без instance identity и test state;
- Aggregator local export содержит 38 nodes и совпадает с published active node set/connections; известное отличие параметров — provider pin в model alias ноды `Semantic Aggregator`;
- 24-нoded production Aggregator draft не опубликован и соответствует очищенному core graph без disabled legacy/test nodes;
- защищённые workflow JSON не изменялись автоматически в рамках этого checkpoint.

Для production поведения authoritative остаются live published workflows: локальный Document Worker candidate ещё не promoted и не прошёл runtime canary. Перед любой promotion нужен повторный live read-back; молчаливо подменять published workflow локальным candidate нельзя.

## 8. Next checkpoint criterion

Следующий статус можно считать лучше текущего только после:

```text
Aggregator AG-8 production-candidate audit / promotion decision
→ full Document Worker runtime canary
→ fresh full 27/27 run
→ 27/27 manual semantic review
→ client report
```
