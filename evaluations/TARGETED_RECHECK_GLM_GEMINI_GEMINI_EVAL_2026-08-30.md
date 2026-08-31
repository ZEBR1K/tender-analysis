# Targeted Recheck — GLM / Gemini / Gemini runtime evaluation

**Дата:** 2026-08-30  
**Test workflow:** `[TEST CODEX] TENDER - Targeted Recheck` (`nI47FcgzYwGzwGqy`)  
**Workflow version:** `a6190915-8c5c-4fa7-88b1-fff58d35080e`  
**Workflow updated:** `2026-08-30T10:09:00.793Z`  
**Execution IDs:** `14216`, `14218`, `14220`, `14222`  
**Поле:** `tender_fields_v1/application_documents`, `field_index=27`  
**Analysis run:** `5605dbf4-ac39-4225-b11a-ae2dc17b3a56`

## Проверенная конфигурация

Read-back test workflow после запусков подтвердил:

```text
Targeted Recheck Extractor
z-ai/glm-5.3-flash@provider=cloudflare&reasoning_effort=low
max_tokens=8192

Targeted Recheck Validator
google/gemini-3.7-flash@provider=google-ai-studio/flex&reasoning_effort=low
max_tokens=8192

Semantic Aggregator Round 2
google/gemini-3.7-flash@provider=google-ai-studio/flex&reasoning_effort=low
max_tokens=16384

HTTP timeout каждого AI-вызова: 180000 ms
```

Workflow был inactive/unpublished. Фактические response metadata исполненных AI-нод подтвердили base models `z-ai/glm-5.3-flash` и `google/gemini-3.7-flash`.

Каждый execution был отдельно назначен Sol-рецензенту для независимого read-only аудита. Главный reviewer повторно сопоставил результаты с live workflow read-back, execution data, deterministic contracts и двумя предыдущими model evaluations. Workflow и PostgreSQL не изменялись.

## Scope и ограничения доказательства

Все четыре запуска получили один и тот же исходный контракт:

```text
field_key = application_documents
aggregation_status = requires_recheck
existing candidates = 28
context_found = true
context units = 10
```

Это не full procurement run. Запуски тестировали один Targeted Recheck для одного поля на одном `analysis_run_id`. Они многократно UPSERT-или одну строку FINAL. Finalizer во всех terminal executions видел только `3/27`, возвращал `barrier_ready=false`, `completion_claimed=false`, `waiting_for_final_fields`.

Execution `14216` прошёл safe fallback после нулевого результата Extractor и поэтому не исполнял Validator и Aggregator. Это полезный reliability case, но не полноценный трёхэтапный model sample.

## Итоговый verdict

```text
GLM / Gemini / Gemini

PASS как текущий model stack для следующего полного TEST-прогона.

REJECT для автоматической отправки клиентского отчёта
без fresh 27/27 run и ручной проверки application_documents.
```

Основания:

1. Все `4/4` workflow executions завершились terminal success.
2. Все `3/3` фактически вызванных Gemini Aggregator ответов прошли exact-reference, allow-list и cardinality checker; у GLM Aggregator было только `1/4`.
3. Safe fallback `14216` сохранил unresolved state как `requires_review`, не создавая `not_found` или ложный отрицательный факт.
4. Во всех трёх Round 2 ответах Gemini сообщил raw `resolved`, но TR-10 containment детерминированно сохранил effective `requires_review/insufficient_evidence`.
5. Конфликт ЕГРИП не разрешён: исходный candidate утверждает `не позднее 6 месяцев`, evidence указывает `не более 1 месяца`. Во всех трёх Round 2 ответах этот `requires_review` candidate получил material role `complement`.
6. Due-diligence scope по-прежнему классифицируется нестабильно и местами возвращается в application scope.
7. Ни один запуск не проверяет полный run, 27/27 barrier или итоговый клиентский отчёт.

Иными словами, Gemini устранил observed structural unreliability GLM Aggregator и дал лучший из трёх протестированных технических профилей. Но смена модели не закрыла semantic completeness `application_documents`; безопасность сейчас обеспечивается deterministic containment, а не корректным raw `resolved` модели.

## Сводные результаты

| ID | Workflow status | Исполненный путь | Extractor candidates | Round 2 candidates | Raw Aggregator | Effective FINAL | Wall time | Tokens | Cost, RUB |
|---|---|---|---:|---:|---|---|---:|---:|---:|
| `14216` | `success` | Extractor → safe fallback → DB → Finalizer | 0 | — | не вызывался | `requires_review/ambiguous_scope` | 20.768 s | 53,504 | 0.98235139 |
| `14218` | `success` | Extractor → Validator → Round 2 → DB → Finalizer | 5 | 33 | `resolved` | TR-10 → `requires_review` | 120.792 s | 100,014 | 3.05322918 |
| `14220` | `success` | Extractor → Validator → Round 2 → DB → Finalizer | 1 | 29 | `resolved` | TR-10 → `requires_review` | 51.729 s | 99,328 | 2.89525809 |
| `14222` | `success` | Extractor → Validator → Round 2 → DB → Finalizer | 2 | 30 | `resolved` | TR-10 → `requires_review` | 72.782 s | 108,553 | 2.37961544 |

Observed total:

```text
4 executions
361,399 tokens
9.31045410 RUB
266.071 s суммарного wall time
241.110 s суммарного времени AI-нод
```

Средняя observed стоимость попытки: `2.327613525 RUB`. Для трёх full-path samples: `307,895` tokens, `8.32810271 RUB`, `245.303 s` wall time. Totals зависят от provider caching и различий model output, поэтому это не универсальный price benchmark.

## Execution 14216 — safe fallback

Execution завершился за `20.768 s`; было исполнено `16` нод.

GLM Extractor:

- `finish_reason=stop`;
- latency `15.295 s`;
- `52,826` prompt + `678` completion = `53,504` tokens;
- `0.98235139 RUB`;
- `recheck_outcome=insufficient_evidence`;
- `candidates=[]`;
- deterministic evidence checker PASS.

Validator, Round 2 Aggregator и TR-10 не вызывались. Fallback сохранил исходный unresolved conflict и создал:

```text
status = requires_review
confidence = 0.5
resolution_method = targeted_recheck_unresolved_existing_candidate
review_reason_code = ambiguous_scope
requires_human_review = true
```

Опциональность справки сохранилась; due-diligence material не был повышен; `not_found` не создавался. DB UPSERT прошёл, Finalizer вернул `3/27` и не завершил run.

Это PASS safe-fallback semantics, но не evidence Validator/Aggregator качества данной схемы.

## Execution 14218 — full path, медленный Aggregator sample

### AI stages

| Этап | Finish | Latency | Tokens | Cost, RUB |
|---|---:|---:|---:|---:|
| GLM Extractor | `stop` | 50.431 s | 55,833 | 0.36752727 |
| Gemini Validator | `stop` | 4.936 s | 11,456 | 0.59651552 |
| Gemini Aggregator | `stop` | 58.662 s | 32,725 | 2.08918639 |

Extractor вернул `5` grounded candidates. Validator вернул exact `5/5 confirmed`; deterministic checker принял cardinality и linking.

Round 2 содержал `33` candidates (`26 confirmed / 7 requires_review`). Aggregator вернул ровно `33` decisions:

```text
primary = 1
supporting = 11
complement = 18
not_applicable = 3
conflict = 0
```

Raw `resolved/confidence=0.95` был преобразован TR-10 в `requires_review/insufficient_evidence`. DB UPSERT и Finalizer прошли; completion barrier остался `3/27`.

Semantic RED: unresolved ЕГРИП candidate `fact:3c726103-0fb2-4b30-8df7-ab5da4764c1e` получил `complement`; raw FINAL опустил спорный срок вместо его разрешения. Optional налоговая справка сохранила `по желанию`, но due-diligence scope остался существенно неоднозначным.

## Execution 14220 — full path, наиболее быстрый terminal sample

### AI stages

| Этап | Finish | Latency | Tokens | Cost, RUB |
|---|---:|---:|---:|---:|
| GLM Extractor | `stop` | 30.322 s | 54,569 | 0.29239069 |
| Gemini Validator | `stop` | 7.000 s | 14,147 | 0.65995660 |
| Gemini Aggregator | `stop` | 7.606 s | 30,612 | 1.94291080 |

Extractor вернул один grounded candidate; Validator принял exact `1/1 confirmed`. Round 2 содержал `29` candidates (`22 confirmed / 7 requires_review`). Aggregator вернул ровно `29` decisions:

```text
primary = 1
supporting = 16
complement = 11
not_applicable = 1
conflict = 0
```

TR-10 выполнил `resolved/confidence=0.95 → requires_review/insufficient_evidence`. Optional налоговая справка сохранила явное `по желанию`.

Semantic RED: тот же unresolved ЕГРИП candidate получил `complement`. Несколько due-diligence candidates также получили `complement`, хотя не вошли в `supporting_candidate_refs` и не были дословно материализованы в FINAL. Это безопаснее прямого false-resolved, но не доказывает правильную границу поля.

DB UPSERT прошёл; Finalizer корректно остался в `waiting_for_final_fields`, `3/27`.

## Execution 14222 — full path, повтор structural PASS

### AI stages

| Этап | Finish | Latency | Prompt | Completion | Tokens | Cost, RUB |
|---|---:|---:|---:|---:|---:|---:|
| GLM Extractor | `stop` | 50.499 s | 52,826 | 3,417 | 56,243 | 0.39189911 |
| Gemini Validator | `stop` | 2.721 s | 19,392 | 252 | 19,644 | 0.92072037 |
| Gemini Aggregator | `stop` | 13.638 s | 29,339 | 3,327 | 32,666 | 1.06699596 |

Extractor вернул `2` grounded candidates; Validator вернул exact `2/2 confirmed`. Round 2 содержал `30` candidates (`23 confirmed / 7 requires_review`). Aggregator вернул ровно `30` allow-listed decisions:

```text
primary = 1
supporting = 15
complement = 13
not_applicable = 1
conflict = 0
```

Raw `resolved/confidence=0.9` был преобразован в effective `requires_review/insufficient_evidence`; `containment_applied=true`, policy `application_documents_round2_requires_review_v1`.

Semantic RED:

- unresolved ЕГРИП candidate получил `complement`;
- optional candidate `fact:68392135-add3-42bd-9dc0-db7b912421e4` получил `supporting`; текст сохранил факультативность, но uncertainty не разрешена;
- explicit due-diligence questionnaire `fact:a953b44f-8830-46b0-a5be-1f3380cf3f83` получил `supporting`, то есть scope expansion повторился.

Нормализованный FINAL: `requires_review`, `requires_human_review=true`, `30` decisions, `133` evidence items. DB UPSERT прошёл; Finalizer увидел `3/27`, `24` missing fields и не заявил completion.

## Stage-level оценка

### GLM Extractor

```text
candidate counts: 0 / 5 / 1 / 2
evidence checker: 4/4 PASS
finish_reason: 4/4 stop
```

Технически Extractor не нарушил contract и safe fallback корректно обработал нулевой результат. Но variability `0..5` на одинаковом input остаётся значительной и не доказывает стабильную semantic completeness.

### Gemini Validator

```text
вызван в 3/4 executions
exact cardinality: 3/3 PASS
verdicts: 5/5, 1/1, 2/2 confirmed
finish_reason: 3/3 stop
latency: 2.721–7.000 s
```

Validator технически стабилен. Одновременное подтверждение всех кандидатов не является самостоятельным доказательством их полноты или корректной field boundary.

### Gemini Semantic Aggregator

```text
вызван в 3/4 executions
schema + exact refs + cardinality: 3/3 PASS
terminal FINAL path: 3/3 PASS
raw resolved: 3/3
TR-10 effective requires_review: 3/3
unresolved ЕГРИП accepted as material: 3/3
due-diligence scope expansion: 3/3
```

Verdict: технический contract PASS; strict semantic oracle RED. Модель годится для следующего full test run только вместе с текущим fail-closed checker и TR-10 containment.

## False-status и persistence audit

### Подтверждено

- `false_not_found` не создан ни в одном execution;
- safe fallback не потерял существующий unresolved candidate;
- все Gemini Validator/Aggregator outputs прошли deterministic cardinality/linking checks там, где были вызваны;
- все три raw false-resolved были перехвачены до persistence;
- persisted FINAL во всех четырёх executions имел `requires_review` и `requires_human_review=true`;
- FINAL contract и DB UPSERT были достигнуты `4/4`;
- DB-backed Finalizer не завершил неполный run и не запустил клиентский report path.

### Не подтверждено

- semantic completeness `application_documents`;
- корректное разрешение ЕГРИП clause;
- стабильная граница application documents против due diligence;
- пригодность provisional `final_value_text` для клиентской отправки;
- свежий full procurement run;
- 27/27 semantic review;
- report generation, XLSX и Telegram delivery на этих результатах.

## Сравнение трёх схем

| Метрика | DeepSeek / DeepSeek / DeepSeek | GLM / Gemini / GLM | GLM / Gemini / Gemini |
|---|---:|---:|---:|
| Workflow terminal success | 3/4 | 1/4 | **4/4** |
| Full 3-stage executions entered | 3/4 | 4/4 | 3/4 |
| Full 3-stage terminal success | 2/3 | 1/4 | **3/3** |
| Aggregator structural acceptance | 2/3 | 1/4 | **3/3** |
| Observed total tokens | 343,558 | 414,801 | 361,399 |
| Observed total cost, RUB | 50.03553430 | **8.82681167** | 9.31045410 |
| Observed total wall time | 848.930 s | 415.661 s | **266.071 s** |
| Strict semantic safety raw result | RED | RED | RED |
| TR-10 terminal containment | 2/2 | 1/1 | **3/3** |

Пути различаются: DeepSeek и GLM/Gemini/Gemini содержат safe fallback executions, а error paths заканчиваются на разных нодах. Поэтому totals — observed operational comparison, не чистый benchmark моделей.

Относительно GLM/Gemini/GLM новая схема в этих четырёх attempts:

- увеличила стоимость на `5.5%`;
- сократила wall time на `36.0%`;
- сократила tokens на `12.9%`;
- повысила terminal success с `1/4` до `4/4`;
- повысила exact Aggregator acceptance с `1/4` до `3/3` вызовов.

## Решение и следующий gate

Не следует продолжать model A/B на этом одном fixture перед full test run: техническое преимущество Gemini Aggregator уже подтверждено тремя независимыми structural PASS, а общий semantic defect одинаков для всех схем и модельной заменой не закрыт.

Следующий шаг:

```text
зафиксировать GLM / Gemini / Gemini как TEST baseline
→ провести один fresh полный прогон закупки по всем документам
→ проверить DB-backed 27/27 barrier
→ вручную проверить все 27 FINAL fields
→ отдельно разрешить application_documents / ЕГРИП
→ только затем принимать решение об отправке отчёта Дмитрию
```

Gate для клиентской отправки:

1. fresh run действительно обрабатывает все документы;
2. Finalizer подтверждает ровно `27/27` и `analysis_run.status=completed`;
3. каждый `requires_review` проверен человеком;
4. `application_documents` не публикуется как полный перечень, пока ЕГРИП и due-diligence boundary не разрешены;
5. итоговый report artifact сверяется с FINAL rows, а не только с текстом AI.

До выполнения этого gate verdict остаётся `REJECT_FOR_AUTOMATIC_CLIENT_REPORT`.
