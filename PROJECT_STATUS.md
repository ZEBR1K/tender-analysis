# PROJECT STATUS — Tender Analysis

**Snapshot date:** 2026-09-01
**Status:** Active development / test hardening before client report
**Branch at snapshot:** `codex/dw18-ag11-option-state`

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
| `TENDER - Targeted Recheck` | `9uDOU31DGo30fGXX` | yes | read-only refresh 2026-08-30: 64 nodes, version `4e0858c9-…`; local export отстаёт на одну disconnected test-ноду |
| `TENDER — Финализация анализа` | `cSsh9yjpS7t5p0OO` | yes | 5 nodes; protected workflow, не менялся в текущем цикле |
| `TENDER — Генерация отчета` | `ckPnP3hRhKu4Mf9u` | yes | 9 nodes; protected workflow, не менялся в текущем цикле |

Production PostgreSQL и published production workflows в текущем цикле Codex не изменялись намеренно. Read-only API подтвердил, что новый 24-нoded Aggregator draft не опубликован: production executions продолжают использовать 38-нoded active version `c4bbee79-…`.

### MCP-enabled test workflows

| Workflow | ID | Active | Current purpose |
|---|---|---:|---|
| `[3 TEST] TENDER — Обработать документ` | `2T7szFpiGcfNpKkB` | no | legacy calibration/runtime workflow, 60 nodes, current unpublished version `55664cef-…`; последние executions `14147–14158`, в клиентском 12-document run не участвовал |
| `[PROD CANDIDATE] TENDER — Обработать документ` | `csnDg78NzN1nIjUT` | yes | фактический Worker клиентского 12-document run; published active version `c5977af5-…` с 51-node execution graph, current unpublished draft `778dfb50-…` содержит 52 nodes; executions `14234/14238` воспроизводят `DW-17` |
| `[TEST CODEX] TENDER — Агрегация закупки` | `ftvmrEHoMbPOAqZG` | yes | published containment candidate `91c17313-…`; fresh canary и consecutive series `3/3` GREEN |
| `[TEST CODEX] TENDER - Targeted Recheck` | `nI47FcgzYwGzwGqy` | yes | technical fallback candidate `13b3c124-…`; fresh canary и consecutive series `3/3` GREEN |

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

Gemini 3.7 Flash low был выбран benchmark fallback-кандидатом; canonical local Worker теперь использует его в bounded one-fallback contour, runtime canary которого ещё не выполнен. Поиск новых моделей на этом fixture остановлен; сводный evidence-backed отчёт находится в `evaluations/EXTRACTOR_MODEL_COMPARISON_2026-08-29.md`.

MCP read-back тестового Worker подтвердил атомарное изменение только `AI Extractor v1.0`: alias приведён с временного `@provider=deepinfra/fp8` к протестированному `@provider=cloudflare`; workflow остался inactive/unpublished, node count `60`, connections, settings, pin data и credentials не изменились.

Этот выбор подтверждает только сравнительный Extractor result. Full path Evidence Repair → AI Validator → persistence с выбранной связкой ещё требует отдельного runtime canary.

### Extractor envelope recovery checkpoint — local GREEN, runtime pending

Read-only diagnosis execution `14359` классифицировал все `16/16` primary GLM responses как nonrecoverable для deterministic attachment: каждый ответ нарушал обязательный exact `field_catalog_version` contract; часть ответов также не сообщала `schema_version` и/или `analysis_unit_id`. Сравнение exact request/system prompt и workflow version с canonical и последним known-good Extractor contract не выявило prompt/version drift. Root cause на этом execution — model contract noncompliance; безопасно attachable responses: `0/16`.

Canonical local Worker теперь имеет bounded recovery contour:

```text
persisted analysis unit
→ Loop Over Items, batchSize=1
→ primary GLM response → explicit attempt envelope → shared strict validator v3
   ├─ accepted → primary attempt audit
   └─ exact allow-listed model contract failure → максимум один Gemini 3.7 Flash low fallback
      → explicit fallback envelope → тот же strict validator → fallback attempt audit
→ existing evidence repair / fact partition tails
→ Loop done-only cardinality/order/identity barrier
→ existing Validator dispatch and persistence
```

Primary/fallback transport и internal errors hard-stop; accepted primary items не вызывают fallback. Разрешены только семь typed primary model failures: invalid JSON, root contract, conflicting identity, field catalog, schema, fact contract и evidence contract. Safe deterministic attachment для отсутствующего `schema_version`/`analysis_unit_id` сохраняется только при exact catalog/root/source и полном strict facts/evidence validation. Audit bounded, не является evidence и не изменяет semantic fields.

Implementation chain: RED `dff07a9`, safe-attachment GREEN `507e12e`, recovery RED `581ed5c`, explicit-source RED `e690528`, fail-closed/parity RED `78935b8`, local GREEN `58556f6`. Focused recovery/envelope suite: `23/23`. Relevant Worker suite: `171 total / 170 pass / 1` accepted immutable-beta-hash failure. Full suite: `370 total / 364 pass / 6` exact accepted failures, без нового failure signature.

Это не runtime GREEN. Canonical candidate не promoted; production n8n, PostgreSQL и credentials не изменялись, paid AI не запускался. Post-fix canary должен доказать fallback cardinality/order, максимум две попытки, strict acceptance и отсутствие partial persistence на реальном execution path.

### Extractor recovery runtime diagnostic 14360 — blocked before AI

В isolated test Worker `pDTFwbq6B19qNAVI` был выполнен ровно один manual draft run на сохранённых PIN data, без publish. Временный canary contour статически имел zero reachability к PostgreSQL, Validator, persistence и Aggregator; его верхняя граница была `16` primary + до `16` fallback + до `16` mutually exclusive evidence-repair/partition calls (`<=48`). Фактически execution `14360` остановился до parser и AI, поэтому paid calls = `0`, PostgreSQL node runs = `0`.

Первый incorrect node — `Связать метаданные и файл`. Его pre-existing expression `$('Захватить документ в обработку').item.json` запросил paired-item ancestry для pinned, но не исполнявшейся в этом временном пути claim-ноды. n8n завершил node в `workflow-data-proxy getPairedItem`; это canary-harness linking defect, а не verdict по GLM/Gemini recovery contract. Live-патч и повторный run не выполнялись.

Временный graph восстановлен из approved snapshot `a9e13672-…` в draft `3016111f-…`: exact version comparison подтверждает равенство nodes/connections/nodeGroups, `71` nodes / `68` connection sources, отсутствие `[CANARY]` nodes, прежний pin-data SHA-256 и credentials. Published version `a7d04a95-…` не менялась. Runtime gate остаётся открытым: execution не дал ни primary decisions, ни fallback calls, ни barrier output. Sanitized audit: `evaluations/DOCUMENT_WORKER_EXTRACTOR_RECOVERY_CANARY_14360_2026-09-01.md`.

### Corrected pinned-claim canary 14361 — blocked before parser/AI

Один исправленный manual run подключил временный Webhook непосредственно к pinned `Захватить документ в обработку`, поэтому claim стал executed ancestor. Execution evidence подтвердил pin substitution: claim присутствовал в execution `pinData`, его output JSON exact совпал с сохранённым pin, а canary execution ID не был записан в claim output. `Связать метаданные и файл` после этого прошёл.

Новый первый incorrect node — `Подготовить DOCX archive alias`: node настроена как `runOnceForEachItem`, но line 1 вызывала `$input.first()`. Installed runtime execution `14361` hard-stop с `Can't use .first() here` до parser и AI; все AI nodes и все non-pinned PostgreSQL nodes отсутствуют в runData, поэтому paid calls = `0`, DB writes = `0`. Execution-derived TDD commits `bdba85e` / `a4c3853` сохранили per-item mode и заменили только current-item access на `$input.item`; focused `70/70`, Worker `203/201` с двумя известными baseline failures, full `371/365` с exact six accepted failures. Test draft и повторный run после local GREEN не выполнялись, поэтому runtime canary остаётся pending.

Временный draft восстановлен из `3016111f-…` в `b8a06968-…`; exact nodes/connections/nodeGroups равны, итог `71/68`, `[CANARY]` nodes отсутствуют, pin-data SHA-256/credentials/published `a7d04a95-…` неизменны. Stage 2 runtime gate всё ещё открыт. Sanitized audit: `evaluations/DOCUMENT_WORKER_EXTRACTOR_RECOVERY_CANARY_14361_2026-09-01.md`.

### Post-fix recovery canary 14362 — Loop complete, temporary barrier rejected

Approved local `$input.item` fix был синхронизирован только в isolated test draft и runtime прошёл прежний hard-stop: DOCX archive alias, OOXML parser, Docling normalization и подготовка units завершились. Execution `14362` обработал `12` units: `12/12` strict primary GLM decisions accepted, Gemini fallback `0`, Evidence Repair `5`, partition `0`, всего `17` paid calls при cap `<=48`. Loop выполнил `12` batches и done-run; non-pinned PostgreSQL nodes не исполнялись, DB writes `0`.

Первый incorrect node — временная canary-версия `Проверить полноту Extractor recovery`. Barrier искал `analysis_unit_meta.analysis_unit_id` в `[CANARY] Bypass analysis-unit persistence`, но bypass сохраняет pre-preparation shape с `analysis_unit`; все `12` unique IDs материализуются только следующей `Подготовить запрос для AI`. Hard-stop произошёл до bounded summary, Validator и persistence. Это canary-harness expected-ID source defect, не model-contract failure; live patch/retry/second run не выполнялись.

Normalizer runtime сохранил fail-closed `docx_option_state_semantic_status=unknown`, `33` warning groups и exact target bindings activeX5/6/7/8 → `#/tables/2`, activeX55/56 → `#/tables/25`. Final guarded-field behavior не доказан, потому что Validator/persistence были недостижимы. Draft восстановлен в `50f43b3d-…`, exact равный corrected rollback `0800032b-…`: `71/68`, no `[CANARY]`, `$input.item` сохранён, pin/credentials/published неизменны. Sanitized audit: `evaluations/DOCUMENT_WORKER_EXTRACTOR_RECOVERY_CANARY_14362_2026-09-01.md`.

Offline canary-contract TDD `b7b5987` / `b0255d1` теперь фиксирует правильную границу: persistence-bypassed barrier получает expected IDs только из post-materialization `Подготовить запрос для AI`, сохраняет exact order/cardinality и hard-fails missing/duplicate IDs. Focused `3/3`, recovery/envelope `26/26`, Worker `206/204` с двумя известными failures, full `374/368` с exact six baseline failures. Это harness-only GREEN: draft `50f43b3d-…`, production workflow, pinData, credentials и DB не изменялись; новый runtime canary не выполнялся.

Текущий `[PROD CANDIDATE]` Worker является отдельным live test contour и не равен ни `[3 TEST]`, ни canonical repository export. Перед исправлением `DW-17` или `DW-18` нужно сначала получить exact active/draft diff `c5977af5-… → 778dfb50-…` и определить назначение draft-only 52-й ноды; молчаливо редактировать draft как эквивалент execution `14234` нельзя.

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
71 nodes after local DW-18 + Extractor recovery checkpoints
active = false
settings.availableInMCP = false
pinData = {}
```

Initial packaging удалил из beta девять test/calibration nodes. Последующие `DW-18` и Stage 2 checkpoints добавили только reviewed deterministic/recovery nodes и selective graph changes; beta→canonical regression разрешает именно этот перечисленный drift, сохраняя остальные parameters, credentials, types и runtime settings. Canonical persistence path подключён к done-only completeness barriers, Manual Trigger отсутствует, top-level `id`, `versionId` и `meta` удалены.

Это только import packaging: live production Worker `1Pw61ZY3HgBSvcUr` не изменён, candidate ещё не promoted/wired и runtime canary для него не выполнялся.

## 4. Aggregator semantic test mitigation

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

The current beta artifact SHA-256 is `dc214110d3086d9e147f0b2c7fe983ee0e93543ca31f7d82c2c52ef3a1f04484`. On the exact `14104` fixture (SHA-256 `6392f9c882a211f20cf1f13777f7002b8c8628270d025df5fdf46492f2adbd75`), a request-model-only A/B accepted both GLM 5.3 Flash low and Gemini 3.7 Flash low with `round1_final` and a 6/6 oracle. Both assigned `doc_7_au_0031` `not_applicable`; GLM selected `doc_7_au_0001`, Gemini selected `doc_7_au_0008`.

GLM is the recommended Aggregator beta baseline for observed reliability/correctness/cost (0.08151487 RUB, 12911 ms, 3290 tokens); Gemini is the latency/provider fallback (0.25840089 RUB, 3711 ms, 3732 tokens). The detailed bounded comparison is `evaluations/AGGREGATOR_MODEL_COMPARISON_2026-08-29.md`.

Это **не** означает, что production исправлен: production Aggregator и canonical production export не менялись, production promotion test остаётся отдельным RED gate, а fresh 27/27 run ещё не выполнен. Backlog ID `AG-8` остаётся открытым до promotion и fresh full-run verification.

### `application_documents` execution 14173

Execution `14173` выявил отдельный schema-valid `false_resolved`: Round 1 включил в FINAL неоднозначные и не полностью подтверждённые требования, потерял существенные условия и расширил scope за пределы документов, подаваемых именно в составе заявки.

В `[TEST CODEX]` усилен только field-specific профиль `application_documents`. Execution-derived regression, neutral anti-overfit controls и route-aware oracle проходят offline. Paid runtime canary на точном beta artifact подтвердил безопасный результат:

```text
ai_called = true
checker_accepted = true
route = targeted_recheck
status = requires_recheck
recheck_reason_code = ambiguous_scope
final_status = null
false_resolved_prevented = true
semantic_oracle_passed = true
expected exit code = 3
```

Canary artifact SHA-256: `dc214110d3086d9e147f0b2c7fe983ee0e93543ca31f7d82c2c52ef3a1f04484`. HTTP `max_tokens` для beta runtime поднят `8192 → 16384` после подтверждённого `finish_reason=length`; model alias и timeout не менялись.

Это подтверждает только безопасную границу Round 1: ложный FINAL не создан. Полнота и окончательная семантика `application_documents` остаются не подтверждены до проверки Targeted Recheck. Production Aggregator и Targeted Recheck не изменялись.

### Targeted Recheck read-only audit and local TR-10 containment — 2026-08-30

Live workflow `9uDOU31DGo30fGXX` является authoritative production implementation: active, 64 nodes, version `4e0858c9-6ca2-42c7-969b-e74a2f91b8c6`. Canonical local export содержит 63 nodes/version `7f82ae43-2ddc-4568-8d76-a6d460c13924`; live-only node `Проверить #2 evidence Targeted Recheck ТЕСТОВАЯ` отключена от production path. До local containment параметры четырёх критических Round 2 нод совпадали между live и local:

```text
Собрать candidates для Round 2
Подготовить запрос #2 Semantic Aggregator
Проверить ответ #2 Semantic Aggregator
Сформировать FINAL после Round 2
```

Audit подтвердил сильные structural guards: evidence grounding, allow-list candidate linking, cardinality и hard error для malformed/empty AI response. Но LIVE для составного `application_documents` не имеет terminal completeness barrier: Round 2 может структурно принять частичный `resolved`, если один новый candidate подтверждён, хотя другие существенные clauses исходного набора не закрыты.

В local canonical candidate изменена только Code-нода `Проверить ответ #2 Semantic Aggregator`. После всех raw validations комбинация `tender_fields_v1 + Round 2 + application_documents + reported resolved` получает effective terminal `requires_review`, `review_reason_code=insufficient_evidence`, непустой universal note и audit policy `application_documents_round2_requires_review_v1`. `needs_recheck=false`; decisions, lists, provisional text, evidence и upstream audit сохраняются. Другие поля не затронуты, raw `application_documents/requires_review` сохраняет исходные reason/note.

Отдельный operational gap (`TR-11`): provider/checker failure fail-closed и не создаёт ложный FINAL, но текущая ветка не доказывает обязательный terminal field result или гарантированный alert. Это может оставить run незавершённым; исправление не смешивается с semantic regression.

Есть явное source conflict:

```text
FIELD_CATALOG.md: application_documents Round 2 = ❌
live/local Targeted Recheck: общий Round 2 profile реализован
```

`FIELD_CATALOG.md` остаётся authoritative для смысла поля, live workflow — для фактического production поведения, local canonical export — mutable promotion candidate. Каталог не изменялся.

`TR-10` mitigated/GREEN только в local canonical candidate. Immutable LIVE diagnostic продолжает воспроизводить partial `false_resolved`; production promotion/runtime result не подтверждены. Verdict готовности LIVE Targeted Recheck к автоматическому клиентскому отчёту остаётся `REJECT`.

### Targeted Recheck execution 14256 / TR-12 draft checkpoint — 2026-08-31

Execution `14256` подтвердил fail-closed prompt/checker mismatch: prompt разрешал exact evidence из `EXISTING CANDIDATES`, а evidence checker доверял только `allowed_semantic_blocks`. В local canonical export checker теперь строит exact trusted union и допускает только однозначное исправление `analysis_unit_id` при неизменных `semantic_block_id` и normalized exact quote; prompt явно запрещает изобретать или перепечатывать coordinates. Полная итоговая prompt-версия сохранена в `prompts/targeted-recheck-extractor-system-prompt-v1.1-2026-08-31.txt`.

Offline exact-execution harness сохранил 43/43 evidence для `application_documents`, принял 25 exact existing-only references и записал один audit repair `doc_3_au_0007 → doc_3_au_0006` для `sb_0227`. Все пять child items прошли реальный checker; текущая Validator preparation сохранила 43 evidence и repair audit. Related suite: `62/62`; полный offline suite: `208 total / 207 pass / 1 intentional AG-8 RED`.

После local GREEN обновлён только unpublished draft тестового workflow `nI47FcgzYwGzwGqy`:

```text
draft versionId = bca1746c-abcb-4490-a455-1daa6ac22092
activeVersionId = d74f1f17-c80f-4499-bf56-b0f7daab594b (unchanged)
prepare local/live SHA-256 = acb91d5136a0e063359bc36493dca6bcf60c04e490022a7728324cf5c8190ab3
checker local/live SHA-256 = 74c32f4d85b91e17665846346e02df492d827f7c86ddf70313627b4d8f064138
nodes = 63; graph/connections/credentials/settings/pinData unchanged
```

После независимого review версия `bca1746c-abcb-4490-a455-1daa6ac22092` опубликована только в тестовом workflow; `draft=active`. Это всё ещё **не runtime GREEN** до PIN-data canary. Production Targeted Recheck, PostgreSQL и credentials не изменялись; paid AI на этом checkpoint ещё не запускался.

### Test-only Aggregator E2E PIN runner — published, not executed — 2026-08-31

Для прямого запуска test Aggregator с Execute Workflow Trigger опубликован изолированный test harness:

```text
body: gsoPfP4PSjcJjPfa@18c770bb-70b5-4448-b3a5-d251057ea343
truthful replay Report: b4Ga1PoFmlS5ep6Y@8570c7ac-b01a-4421-a2e1-454e85cc7173
Webhook controller: U0S3Oyq5pYfiWVDE@90a69f3b-9c26-46a5-9fba-cb96eee23105
POST /webhook/test-codex-tender-aggregator-e2e-3caa7a89
```

Body fail closed принимает только exact audited contract для run `3caa7a89-b137-4cf6-b23d-941fb465c8f9` и двух сохранённых PIN payload. Он не повторяет atomic claim SQL, а inject-ит сохранённый claim output; все 22 business nodes и connections после claim совпадают с test Aggregator. Test Targeted Recheck, реальные LLM, FINAL persistence и production Finalization остаются в downstream graph.

Controller проверяет lifecycle и exact 27/27 DB barrier до/после body. Первый run со статусом `aggregating` оставляет единственный report production Finalization. Повторы уже `completed` используют отдельный test-only Report replay с truthful `completion_claimed=false`, `finalization_state=already_completed` и explicit authorization; восемь последующих Report nodes и connections совпадают с production Report.

Offline runner regression `8/8 PASS`; published structural parity: body `22/22`, Report downstream `8/8`, controller не вызывает production Report напрямую. Prompts не менялись. Paid E2E ещё не выполнялся; controller является временным публичным test endpoint и должен быть снят с публикации после серии испытаний.

#### Execution 14257 launch regression checkpoint

Первый canary controller `14257` / child body `14258` завершился fail-closed до LLM и downstream DB writes: body guard вернул `RUNNER_CONTRACT_MISMATCH`. Child trigger получил ровно 11 declared fields, но guard ошибочно сравнивал их с 9-полевым external request и не учитывал обязательные `controller_execution_id/contract_validated`.

Минимальный TDD fix опубликован только в test body/controller:

```text
body gsoPfP4PSjcJjPfa@18c770bb-70b5-4448-b3a5-d251057ea343
controller U0S3Oyq5pYfiWVDE@90a69f3b-9c26-46a5-9fba-cb96eee23105
```

Body guard теперь проверяет exact 11, numeric controller execution ID, `contract_validated=true` и hard-fail для missing/unknown keys. Lifecycle для post-run ownership читается отдельно из pre-run DB node. Изменены параметры одной body Code node и трёх controller Code nodes; topology, SQL, Aggregator/Targeted Recheck/Finalization/Report и prompts неизменны. Runner regression `10/10 PASS`; полный основной suite `218 total / 217 pass / 1 intentional AG-8 RED`. Повторный canary ещё не выполнялся.

## 5. Test status

### E2E PIN canary 14259 — technical success, semantic REJECT

Полная test chain завершилась:

```text
controller 14259 = success
Aggregator body 14260 = success
Targeted Recheck 14261 = success
completion-owning Finalization 14267 = success
Report 14268 = success; HTML artifact created
DB run = completed; exact 27/27
```

Semantic audit: `25/27 acceptable (92.6%)`, но найдены два critical `false_resolved`: `participation_guarantee` не устанавливает фактическую применимость/размер обеспечения заявки, а `required_official_certificates` неполно ограничен налоговой справкой при наличии обязательных ЕГРЮЛ/ЕГРИП и иных official documents в grounded facts. Critical `false_not_found` не обнаружены.

Verdict остаётся `REJECT` до минимального containment этих двух полей. Три confirmation runs не начаты. Подробный runtime audit: `evaluations/TENDER_E2E_PIN_CANARY_14259_2026-08-31.md`.

### AG-10 / TR-13 execution-derived containment — historical offline checkpoint

На fixture из body execution `14260` подтверждено, что оба critical поля проходили structural checks, но не имели независимого доказательства применимости/полноты. Минимальный field-specific containment добавлен без изменения prompts и без ослабления schema/linking/cardinality guards:

```text
Aggregator Round 1 reported resolved
→ effective requires_recheck / insufficient_evidence

Targeted Recheck terminal Round 2 reported resolved
→ effective requires_review / insufficient_evidence
→ needs_recheck=false / requires_human_review=true
```

Provisional value, candidates, evidence и reported/effective audit сохраняются. Изменены только unpublished test drafts:

```text
Aggregator ftvmrEHoMbPOAqZG
draft 91c17313-a593-4fb9-9072-79320a958dd7
active 01ff5e9d-30d2-4530-b2ff-4513224e9056

Targeted Recheck nI47FcgzYwGzwGqy
draft c43b4ed3-c384-41e9-b1d9-3636cff42ac5
active bca1746c-abcb-4490-a455-1daa6ac22092

E2E body gsoPfP4PSjcJjPfa
draft 7566262e-4c7a-4483-a5cd-9bdfd81a95aa
active 18c770bb-70b5-4448-b3a5-d251057ea343

E2E controller U0S3Oyq5pYfiWVDE
draft 03ac36e0-c4f8-44ea-bd52-bf41d5425012
active 90a69f3b-9c26-46a5-9fba-cb96eee23105
```

На этом историческом checkpoint live read-back подтвердил parameter-only diff четырёх Code nodes, неизменную topology и exact body downstream parity `22/22`. Позже drafts были опубликованы и проверены canary `14279`, описанным ниже.

### E2E PIN canary 14279 — technical and semantic GREEN

Test drafts опубликованы и новый canary завершился до HTML report:

```text
controller 14279 = success
Aggregator body 14280 = success
Targeted Recheck 14281 / 14285 = success
Report replay 14289 = success
DB = exact 27/27
16 resolved / 7 requires_review / 4 not_found
semantic audit = 27/27 acceptable
critical false_resolved = 0 observed
critical false_not_found = 0 observed
```

`participation_guarantee` и `required_official_certificates` теперь безопасно `requires_review`. HTML artifact валиден (`484540` bytes). Предыдущий attempt `14269` не засчитывается: replay `14278` fail-closed обнаружил stale source version UUID; TDD fix опубликован как `b4Ga1PoFmlS5ep6Y@80ad3549-998f-41a0-a973-f02ef5eae46a`, downstream parity `8/8`. Prompts не менялись. Audit: `evaluations/TENDER_E2E_PIN_CANARY_14279_2026-08-31.md`.

Canary gate пройден; три consecutive confirmation runs ещё pending.

### Confirmation attempt 14290 — fail-closed, серия 3/3 не начата

Первый post-canary confirmation attempt не засчитывается:

```text
controller 14290 = error
Aggregator body 14291 = error
Targeted Recheck 14292 = error
Report = не создан
```

Первый некорректный terminal state возник в `Проверить #2 evidence Targeted Recheck`: для `results_date` модель привязала точную цитату к неверной паре `doc_2_au_0002/sb_0048`, хотя цитата находится в trusted block `doc_2_au_0001/sb_0004`. В том же execution три других ответа нарушили extractor envelope/schema contract (`participation_guarantee`, `required_official_certificates`, `application_documents`). Checker корректно остановил workflow; provider/balance error не обнаружен.

Повторные paid runs приостановлены до TDD-fix: deterministic model-contract/evidence failure должен сохраняться в audit и завершать поле как technical `requires_review`, не принимая unvalidated candidate и не допуская `not_found`. Текущая последовательная серия остаётся `0/3`; canary `14279` сохраняется как отдельное успешное доказательство.

### Execution 14292 technical fallback — offline GREEN, test publish complete

Execution-derived TDD охватывает все семь AI envelopes `14292`. Четыре model contract/evidence violations теперь дают `technical_fallback_required=true`, `evidence_validated=false`, пустой validated candidate set и отдельный terminal `requires_review`; валидные ответы и валидный `insufficient_evidence → not_found` сохраняют прежнюю семантику. Неизвестные programming errors и отсутствующие upstream invariants продолжают hard-fail.

Root verification в authoritative main checkout: focused/related `60/60`, full suite `246 total / 245 pass / 1 intentional AG-8 RED`, graph `64/64` unique nodes, secret scan clean. Test Targeted Recheck `nI47FcgzYwGqy@13b3c124-4fef-4a6f-9d5f-8befa3725bc1` опубликован; production workflows/DB и prompts не изменялись. Следующий gate — fresh E2E canary; confirmation series остаётся `0/3` до его успешного semantic audit.

### Fresh post-fix canary 14294 — technical and semantic GREEN

```text
controller 14294 success
Aggregator body 14295 success
Targeted Recheck 14296 / 14300 success
Report replay 14303 success
HTML valid: 482829 bytes
DB exact 27/27: 16 resolved / 6 requires_review / 5 not_found
semantic audit: 27/27 acceptable
critical false_resolved / false_not_found: 0 observed
```

Новый technical fallback в этом canary не потребовался: все Extractor envelopes/evidence были валидны. Единственное отличие статусов от `14279` — `government_contract` стал безопасным `not_found`: audit прямо фиксирует упоминание только upstream State Contract, отсутствие доказательства статуса текущего договора и запрет отрицательного вывода. Preflight `14293` исключён как root invocation-shape error, остановленный controller до body/LLM. Audit: `evaluations/TENDER_E2E_PIN_CANARY_14294_2026-08-31.md`. Confirmation series готова к старту с `0/3`.

### Consecutive confirmations — 1/3 GREEN

Confirmation 1 завершён цепочкой `14304 → 14305 → 14306/14310 → 14313`: все executions success, exact DB `27/27`, HTML valid `476893` bytes, semantic audit `27/27 acceptable`, zero observed critical false statuses. Распределение `16 resolved / 6 requires_review / 5 not_found`; strict checker принял все model responses, technical fallback не потребовался. Audit: `evaluations/TENDER_E2E_PIN_CONFIRMATIONS_2026-08-31.md`.

Confirmation 2 завершён цепочкой `14314 → 14315 → 14316/14320 → 14324`: все executions success, exact DB `27/27`, HTML valid `477940` bytes, semantic audit `27/27 acceptable`, zero observed critical false statuses. Распределение `16 resolved / 7 requires_review / 4 not_found`; `government_contract` безопасно вернулся в `requires_review/ambiguous_scope`. Consecutive count: `2/3`.

Confirmation 3 завершён цепочкой `14325 → 14326 → 14327/14331 → 14335`: все executions success, exact DB `27/27`, HTML valid `481901` bytes, semantic audit `27/27 acceptable`, zero observed critical false statuses. Распределение `16 resolved / 7 requires_review / 4 not_found`; `application_review_date` консервативно понижен в `requires_review`, а неполный `required_official_certificates` не был материализован как resolved.

Итоговая consecutive series: `3/3 GREEN`. Критерий текущей test PIN-data задачи выполнен. Это не означает автоматическую production promotion всех test candidates.

Temporary public controller `U0S3Oyq5pYfiWVDE` успешно unpublished после серии. Его draft/version `03ac36e0-…` сохранён для audit, но `activeVersionId=null`; внешний webhook больше не должен принимать production-вызовы.

Final verification после unpublish временного controller:

```text
246 tests
245 passed
1 failed
```

Единственный падающий test — намеренный `AG-8` production promotion gate. Focused E2E runner suite проходит `11/11`; live verifier подтверждает exact active versions/parity body, replay Report, source Aggregator и Targeted Recheck, а controller имеет `active=false`, `activeVersionId=null`. `git diff --check` не обнаружил whitespace errors (только ожидаемые предупреждения Git о будущей нормализации LF/CRLF).

Этот checkpoint не является release-ready или production-ready состоянием.

### Preliminary client report checkpoint 14336 / 14345 — partial and not client-final

После test PIN confirmation series пользователь вручную запустил текущий test Aggregator на том же сохранённом run:

```text
analysis_run_id = 3caa7a89-b137-4cf6-b23d-941fb465c8f9
Aggregator 14336 = success
Targeted Recheck 14337 / 14341 = success
Finalization calls 14338–14343 = success
test Report replay 14345 = success
```

Получен HTML по 27 полям и локально создан предварительный A4 PDF. Это не clean 12/12 run: документ `Приложение_к_Блоку_7._ИТТ.pdf` ранее был вручную переведён в `failed`, run агрегирован как `11 completed / 1 failed`, а report replay использовал уже существующий 27/27 DB snapshot.

Сравнение с исходными документами и краткой справкой сотрудника подтвердило:

1. площадка определена корректно: ЭТП ГПБ — основная площадка, «Стратег» — отдельная закрытая секция;
2. `national_regime` в отчёте является P0 `false_resolved`: оригинальный DOCX явно выбирает `Не применимо`, но pipeline потерял selected state и принял общие положения ПП 1875 как доказательство применимости;
3. `participation_guarantee` безопасно остался `requires_review`, но оригинальный DOCX явно выбирает `Не предусмотрены`; selected negative также потерян;
4. сумма `24 900` для `participation_cost` отсутствует в предоставленных DOCX, text-readable PDF, OCR execution `14234` и пустом TenderMeta. Найденное `Плата не предусмотрена` относится к плате за предоставление документации, а не к тарифу ЭТП.

Root cause для пунктов 2–3 подтверждён в source OOXML: отметки реализованы ActiveX controls (`w:control` и связанные `word/activeX/*`), тогда как semantic blocks содержат option labels без selected/unselected state. Это отдельный P0 `DW-18 / AG-11`; он не закрыт containment-серией `3/3`, потому что та воспроизводила уже сохранённые Aggregator PIN data после parsing.

Предварительный PDF допустим только с явным сопроводительным предупреждением об `11/12`, OCR gap и известных корректировках. Автоматически клиентским финальным отчётом его считать нельзя.

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
- exact beta `14104` A/B accepted GLM and Gemini with the same safe scope decision; GLM is the beta baseline and Gemini is fallback only.
- `application_documents` execution `14173` воспроизводит production false-resolved как diagnostic control;
- beta field-specific boundary и neutral controls для `application_documents` проходят offline;
- paid runtime canary точного beta artifact безопасно выбрал `targeted_recheck/ambiguous_scope`, не создал Round 1 FINAL и прошёл route-aware oracle;
- read-only refresh live Targeted Recheck подтвердил active version `4e0858c9-…`, 64 nodes и точное совпадение параметров четырёх core Round 2 нод с local export;
- deterministic Targeted Recheck guards fail closed по schema/cardinality/linking/evidence; это не доказывает semantic completeness составного FINAL;
- mutable canonical Targeted Recheck gate детерминированно понижает `application_documents` Round 2 reported `resolved` до effective terminal `requires_review/insufficient_evidence`, сохраняя audit/evidence;
- neutral `procurement_subject/resolved` и raw `application_documents/requires_review` controls проходят без containment;
- execution-derived `AG-10/TR-13` containment для `participation_guarantee` и `required_official_certificates` проходит offline tests и не ослабляет universal structural guards;
- E2E runner drafts сохраняют exact post-claim Aggregator parity `22/22` после переноса containment;
- immutable Document Worker beta snapshot сохранён, но его старая expected-hash assertion остаётся принятым pre-existing RED baseline;
- canonical Document Worker JSON сохраняет beta packaging вне reviewed `DW-18` nodes; соответствующая selective packaging regression проходит.
- executions `14336`, `14337`, `14341` и report replay `14345` успешно завершили сохранённый partial `11/12` contour до HTML;
- визуальный и OOXML audit исходного `Блок_2_Информационная_карта.docx` подтвердил explicit selections `national_regime = Не применимо` и `participation_guarantee = Не предусмотрены`;
- Aggregator execution `14336` подтвердил первый incorrect terminal state для `national_regime`: Round 1 accepted `resolved` по generic/conditional PP 1875 candidates;
- Targeted Recheck `14337` корректно зафиксировал `insufficient_evidence` для `participation_guarantee`, потому что его context уже не содержал option-state.
- `DW-18` source-derived nested-table fixture и 61 focused regression offline подтверждают standards-based OOXML relationships → bounded CFB → MS-OFORMS parsing: controls 5/6/7/56 cleared, 8 selected `Не применимо`, 55 selected `Не предусмотрены`; parser input загружается из checked-in OOXML независимо от manifest; malformed/orphan/cyclic/out-of-range structures и unsafe archive paths fail closed.
- executions `14350–14352` локализовали три runtime gaps прежнего canonical candidate: split `directory + fileName`, потерю `docx_part_path/docx_part_kind` после Extract From File/XML и ancestor-table duplicate mapping (`578 controls / 126 decoded / partial`). Canonical Worker исправляет только эти boundaries и сохраняет настоящую ambiguity fail-closed.
- execution `14359` локализовал следующий первый incorrect state после корректного raw parser: global label-only normalizer не связывал selected state с нужным semantic owner при повторяющихся labels. Stage 1 TDD checkpoints: RED `4f6f23f`, GREEN `a5a1cb7`, Critical RED `e7e1987`, Critical GREEN `3643b29`, fixture-geometry correction `e8db92b`.
- exact read-only replay полного input execution `14359` после local fix подтвердил: activeX5/6/7/8 привязаны только к `#/tables/2` как `unselected/unselected/unselected/selected`, activeX55/56 — только к `#/tables/25` как `selected/unselected`. Replay остаётся fail-closed: `docx_option_state_semantic_status = unknown`, `33` warning groups и semantic owners только для `83/290` controls; guarded fields должны оставаться `requires_review` до post-fix canary.
- Worker semantic chain offline сохраняет option-state/audit до `validator_meta`, исключает exact-grounded unselected guarded facts, ограничивает unknown/indeterminate review-only и не разрешает AI Validator создавать новые facts.
- `AG-11` offline matrix проходит `31/31`: positive `national_regime/resolved` требует confirmed primary и exact-bound structured applicability proof; generic/conditional ПП 1875 clauses без proof понижаются до effective `requires_recheck/insufficient_evidence`.
- test Aggregator `ftvmrEHoMbPOAqZG` обновлён только в draft `f11906df-f760-4c54-a59e-16f4423ab534`: read-back 24 nodes, ровно три изменённые AG-11-ноды, connections сохранены, unexpected drift отсутствует. Published active остаётся `91c17313-a593-4fb9-9072-79320a958dd7`.
- fresh Stage 1 branch verification: focused `DW-18 69/69`; full suite `347 total / 341 pass / 6 fail`. Все шесть RED совпадают с принятым baseline: `RED actionable: procurement_subject FIELD_RULES contain the universal current-scope boundary`; `RED A/B runtime report contains the full execution, artifact, response, oracle, and exit audit`; `RED A/B harness refuses canonical production workflow and preserves fixture and beta SHA-256`; `immutable beta Worker snapshot retains its reviewed packaging hash`; `v1.2 prompt artifact is an exact clean copy of the imported validator system prompt`; `Targeted Recheck prompt aligns evidence coordinates with both trusted sources`. Новых failures нет.
- Stage 2 exact execution diagnosis подтвердил `0/16` safely attachable primary responses без prompt/version drift; local recovery chain `dff07a9 → 507e12e → 581ed5c → e690528 → 78935b8 → 58556f6` сохраняет strict validator parity, делает максимум один Gemini fallback и допускает persistence только после done-only completeness barrier. Focused `23/23`; relevant Worker `171/170` с единственным known beta-hash failure; full `370/364` с теми же шестью baseline failures.

### Not verified

- promotion/wiring clean Document Worker candidate в test/production contour;
- full runtime canary Document Worker candidate с зафиксированной связкой GLM Extractor + Gemini Validator;
- production promotion Aggregator AG-8 boundary;
- production promotion `application_documents` boundary;
- promotion и runtime canary local Targeted Recheck candidate в LIVE contour;
- terminal production Targeted Recheck и окончательный полный FINAL для `application_documents` после safe deferred route;
- terminal error/alert semantics для provider/checker failure в Targeted Recheck;
- полный clean run новой закупки от Orchestrator до нового отчёта после текущего hardening;
- причина и дальнейшая судьба unpublished 24-нoded production Aggregator draft;
- ручная бизнес-проверка всех 27 полей клиентского результата.
- post-fix runtime extraction/preservation DOCX ActiveX state в isolated Worker candidate; executions `14350–14352` являются pre-fix diagnostic evidence, а не GREEN canary;
- post-fix runtime verification bounded Extractor fallback: execution `14359` остаётся `0/16` safely attachable по primary evidence, а local GREEN `58556f6` ещё не доказывает успешный Gemini fallback, exact batch convergence или отсутствие partial persistence в n8n runtime;
- isolated execution `14360` не закрыл этот gate: canary harness остановился до AI на missing paired-item ancestry в `Связать метаданные и файл`; следующий run допустим только после отдельного reviewed source-carry design, который не зависит от `.item` к pinned-but-unexecuted claim node;
- corrected pinned-claim execution `14361` выявил hard-stop в `Подготовить DOCX archive alias`, а execution `14362` подтвердил `$input.item` fix и завершение `12` recovery loop items; temporary barrier source исправлен только offline TDD `b7b5987` / `b0255d1`, live draft не обновлялся и повторный canary не выполнялся;
- reproducible sanitized full-payload replay для semantic binding execution `14359`: checked-in regression намеренно сокращён до `6` controls и `4` meaningful tables, хотя отдельно хранит observed source counts (`290` controls, `64` raw tables, `6` raw body children, `647` normalized blocks, `528` semantic blocks). Перед promotion нужен воспроизводимый sanitized full-payload replay либо точное переименование fixture/replay contract, исключающее впечатление полного replay;
- published/runtime verification Aggregator fail-closed applicability boundary; `AG-11` пока находится только в test draft и offline GREEN;
- grounded внешний источник для суммы `participation_cost = 24 900`; в текущем source bundle это значение не подтверждено;
- финальный клиентский отчёт без известных `national_regime`/option-state расхождений.

## 7. Canonical export drift

На snapshot date exports имеют разные роли:

- `workflows/n8n-exports/beta/[3 TEST] TENDER — Обработать документ.json` — неизменяемый 60-node test/calibration snapshot;
- Document Worker canonical path — clean inactive 71-node offline candidate с `DW-18` и bounded Extractor recovery, без instance identity и test state;
- test Aggregator published active `91c17313-…` содержит execution-derived `AG-10`; unpublished test draft `f11906df-…` добавляет ровно три `AG-11` parameter changes без connection drift;
- test Targeted Recheck published active `13b3c124-…` содержит `TR-10/TR-13` containment и audited technical `requires_review` fallback для execution `14292`;
- 24-нoded production Aggregator draft не опубликован и соответствует очищенному core graph без disabled legacy/test nodes;
- защищённые workflow JSON не изменялись автоматически в рамках этого checkpoint.

Для production поведения authoritative остаются live published workflows: локальный Document Worker candidate ещё не promoted и не прошёл runtime canary. Перед любой promotion нужен повторный live read-back; молчаливо подменять published workflow локальным candidate нельзя.

## 8. Next checkpoint criterion

Следующий статус можно считать лучше текущего только после:

```text
DW-18 / AG-11 execution-derived RED на исходном DOCX (14350–14352)
→ canonical runtime hardening + offline deterministic contract (61/61 GREEN)
→ execution 14359 semantic binding: structural local owner + bounded fail-closed audit (69/69 GREEN)
→ execution 14359 Extractor envelope: 0/16 safely attachable primary; bounded one-fallback local contract (23/23 GREEN)
→ sanitized full-payload replay или точное переименование сокращённого replay contract
→ read back and update isolated Worker candidate `csnDg78NzN1nIjUT`
→ Worker/Aggregator runtime canary на national_regime и participation_guarantee
→ DW-17 reference-only evidence repair для failed OCR document
→ clean 12/12 document run from Orchestrator
→ exact 27/27 FINAL
→ ручная клиентская проверка и отправка отчёта Дмитрию
```

Текущий test PIN-data contour готов по согласованному gate: fresh canary и три последовательных подтверждения дошли до отчёта, каждый semantic audit дал `27/27 acceptable` и zero observed critical false statuses. Ограничение: это replay сохранённых Aggregator PIN data, сформированных после ранее согласованного обхода одного failed документа; это не новый clean full run всех `12/12` документов.

Immediate business state: предварительный отчёт можно отправить Дмитрию только как partial `11/12` с перечислением известных ограничений. Технический следующий шаг для Hermes — не новый model benchmark, а promotion-grade sanitized full-payload replay и post-fix Worker/Aggregator canary `DW-18 / AG-11`; local Stage 1 GREEN не является production runtime GREEN.
