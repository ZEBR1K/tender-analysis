# Targeted Recheck — DeepSeek runtime evaluation

**Дата:** 2026-08-30  
**Test workflow:** `[TEST CODEX] TENDER - Targeted Recheck` (`nI47FcgzYwGzwGqy`)  
**Execution IDs:** `14204`, `14205`, `14207`, `14209`  
**Поле:** `tender_fields_v1/application_documents`, `field_index=27`  
**Analysis run:** `5605dbf4-ac39-4225-b11a-ae2dc17b3a56`  
**Фактическая модель всех исполненных AI-нод:** `deepseek/deepseek-v4-pro-0813`

## Scope и ограничения доказательства

Отчёт основан на read-only execution data n8n: фактически исполненные ноды, outputs, deterministic checker results, FINAL payloads, token usage, стоимость и длительность. Все четыре execution использовали один trigger input: `28` исходных candidates, `10` найденных context units и исходный статус `requires_recheck`.

Это не full procurement run. Все executions работали с одним `analysis_run_id` и одним `field_key`, выполняли UPSERT одной и той же строки FINAL и вызывали Finalization. Finalization во всех terminal executions видел только `3/27` полей, возвращал `barrier_ready=false`, `completion_claimed=false`, `finalization_state=waiting_for_final_fields`.

Execution log сохраняет отдельный audit каждого запуска, но текущее состояние строки в PostgreSQL отражает последний UPSERT, а не четыре независимых результата.

## Итоговый verdict

```text
DeepSeek / DeepSeek / DeepSeek
REJECT как схема для автоматического клиентского отчёта.

Допустимо использовать только как контрольный baseline
для сравнения с GLM / Gemini / GLM.
```

Причины:

1. Только `2/4` запусков прошли все три AI-этапа и создали terminal FINAL.
2. `14204` завершился ошибкой после schema-invalid ответа Semantic Aggregator.
3. `14205` не нашёл ни одного нового candidate и обошёл Validator/Round 2, несмотря на тот же retrieval context.
4. Extractor вернул соответственно `5 / 0 / 1 / 1` candidates на одинаковом входном контракте.
5. В `14207` и `14209` Semantic Aggregator дважды сообщил raw `resolved`; только deterministic TR-10 containment преобразовал его в effective `requires_review`.
6. Оба полных terminal результата не проходят строгую semantic проверку unresolved ЕГРИП clause: candidate с `validator_verdict=requires_review` был принят как material (`complement` в `14207`, `supporting` в `14209`).

TR-10 предотвращает `false_resolved`, но не превращает provisional `final_value_text` в доказанно полный и корректный клиентский ответ.

## Результаты executions

| ID | Workflow status | Исполненный путь | Результат | Wall time | Tokens | Cost, RUB |
|---|---|---|---|---:|---:|---:|
| `14204` | `error` | Extractor → Validator → Round 2 | Aggregator вернул `{"result":" "}`; checker fail-closed: `field_key=undefined`; FINAL и DB UPSERT отсутствуют | 388.701 s | 101,587 | 16.22960261 |
| `14205` | `success` | Extractor → safe fallback | Extractor: `insufficient_evidence`, `0` candidates; terminal `requires_review/ambiguous_scope`; Validator и Aggregator не вызывались | 13.384 s | 56,503 | 4.45252026 |
| `14207` | `success` | Extractor → Validator → Round 2 → FINAL → DB → Finalizer | raw `resolved` → TR-10 effective `requires_review/insufficient_evidence`; strict semantic oracle failed | 133.215 s | 95,360 | 18.60965935 |
| `14209` | `success` | Extractor → Validator → Round 2 → FINAL → DB → Finalizer | raw `resolved` → TR-10 effective `requires_review/insufficient_evidence`; strict semantic oracle failed | 313.630 s | 90,108 | 10.74375208 |

Общий observed расход:

```text
4 executions
343,558 tokens
50.03553430 RUB
848.930 s суммарного wall time
824.828 s суммарного времени AI-нод
```

Средняя стоимость попытки: `12.508883575 RUB`. Это measurements данного fixture/provider, а не общая оценка цены модели.

## Execution 14204 — schema failure после полного AI path

### Extractor

- `finish_reason=stop`;
- `5` grounded candidates;
- evidence checker: `evidence_validated=true`;
- latency `33.705 s`;
- `59,028` tokens;
- `8.54404811 RUB`.

### Validator

- `finish_reason=stop`;
- deterministic checker принял точную cardinality `5/5`;
- `2 confirmed / 2 requires_review / 1 rejected`;
- `validator_validated=true`;
- latency `158.881 s`;
- `17,401` tokens;
- `3.71081018 RUB`.

После Validator в Round 2 поступили `32` candidates: `23 confirmed / 9 requires_review`.

### Semantic Aggregator

- `finish_reason=stop`, но content был только `{"result":" "}`;
- latency `191.016 s`;
- `25,158` tokens;
- `3.97474432 RUB`;
- deterministic checker остановил workflow: ожидался `field_key=application_documents`, получен `undefined`.

Положительный факт: malformed response не был принят и не создал ложный FINAL. Отрицательный факт: terminal field result не материализован; это соответствует открытому operational gap TR-11.

## Execution 14205 — safe fallback, но не полный трёхэтапный тест

Extractor на том же контракте вернул:

```text
recheck_outcome = insufficient_evidence
candidates = 0
```

Он классифицировал весь найденный контекст как due diligence и заявил, что прямые документы заявки отсутствуют. Workflow безопасно сохранил исходный candidate и создал:

```text
status = requires_review
review_reason_code = ambiguous_scope
confidence = 0.5
requires_human_review = true
```

Validator и Semantic Aggregator не исполнялись. Поэтому `14205` доказывает safe fallback, но не может считаться успешным прогоном схемы DeepSeek/DeepSeek/DeepSeek и не является apples-to-apples control для трёхэтапного model comparison.

## Execution 14207 — TR-10 GREEN, semantic oracle RED

### AI path

- Extractor: `1` candidate, `finish_reason=stop`, `57,286` tokens, `9.28026215 RUB`, `9.826 s`;
- Validator: `1/1 confirmed`, `validator_validated=true`, `3,706` tokens, `0.72111290 RUB`, `13.719 s`;
- Round 2: `29` candidates, `29/29` unique decisions;
- Semantic Aggregator: raw `resolved`, `confidence=0.85`, `finish_reason=stop`, `34,368` tokens, `8.60828430 RUB`, `102.959 s`.

### Deterministic result

```text
reported_status = resolved
effective_status = requires_review
containment_applied = true
containment_policy = application_documents_round2_requires_review_v1
review_reason_code = insufficient_evidence
requires_human_review = true
```

Candidate decisions и audit были сохранены полностью: `29/29`; accepted evidence — `111/111`.

### Semantic failure

Material candidate для ИП содержит `ЕГРИП (не позднее 6 месяцев)`, имеет `validator_verdict=requires_review`, но Aggregator назначил ему роль `complement`. Это accepted material role. Следовательно, unresolved material clause попала в provisional FINAL как будто поддерживающая результат.

Размер provisional `value_text`: `1509` символов. Он не должен использоваться как автоматически подтверждённый клиентский перечень.

## Execution 14209 — повторный TR-10 GREEN, semantic oracle RED

### AI path

- Extractor: `1` candidate, `finish_reason=stop`, `56,750` tokens, `4.51066313 RUB`, `10.935 s`;
- Validator: `1/1 confirmed`, `validator_validated=true`, `2,896` tokens, `0.31825574 RUB`, `10.362 s`;
- Round 2: `29` candidates, `29/29` unique decisions;
- Semantic Aggregator: raw `resolved`, `confidence=0.85`, `finish_reason=stop`, `30,462` tokens, `5.91483321 RUB`, `284.632 s`.

### Deterministic result

```text
reported_status = resolved
effective_status = requires_review
containment_applied = true
containment_policy = application_documents_round2_requires_review_v1
review_reason_code = insufficient_evidence
requires_human_review = true
```

Candidate decisions и audit были сохранены полностью: `29/29`; accepted evidence — `110/110`.

### Semantic failure

Тот же unresolved ЕГРИП candidate с `validator_verdict=requires_review` получил роль `supporting`. Дополнительно optional справка, прямо описанная как предоставляемая «по желанию участника», получила `supporting`, а не `not_applicable`.

Размер provisional `value_text`: `848` символов — на `661` символ короче результата `14207`. Это дополнительное доказательство нестабильности полноты и детализации между повторными запусками.

## Reliability и semantic safety

### Что подтверждено

- evidence checker принимал только grounded Extractor candidates;
- Validator checker сохранял cardinality и candidate linking;
- malformed Aggregator response в `14204` был отклонён fail-closed;
- TR-10 containment дважды предотвратил автоматический `resolved`;
- effective FINAL в `14205`, `14207`, `14209` имел `requires_human_review=true`;
- DB-backed Finalization корректно не завершил неполный run `3/27`.

### Что не подтверждено

- стабильное обнаружение Targeted Recheck candidates;
- стабильный schema-valid ответ Semantic Aggregator;
- semantic completeness `application_documents`;
- корректное обращение с каждым `requires_review` material clause;
- пригодность provisional `final_value_text` для клиентского отчёта;
- полный analysis run и итоговые `27/27` fields.

## Source-state boundary после executions

Execution data является authoritative для фактически использованной модели и показывает DeepSeek на всех вызванных AI-этапах.

После этих запусков test workflow был обновлён. Read-back на `2026-08-30T09:34:22.230Z` показывает текущую draft version `b697cb34-3e0d-4b76-ab47-cb827dbe270c`:

```text
Extractor            = z-ai/glm-5.3-flash@provider=cloudflare&reasoning_effort=low
Validator            = google/gemini-3.7-flash@provider=google-ai-studio/flex&reasoning_effort=low
Semantic Aggregator  = z-ai/glm-5.3-flash@provider=cloudflare&reasoning_effort=low
```

Следовательно, IDs `14204/14205/14207/14209` — DeepSeek baseline, а не evidence текущей GLM/Gemini/GLM конфигурации. Current test workflow остаётся inactive/unpublished.

## Следующий comparison gate

Для GLM/Gemini/GLM необходимо повторить тот же input минимум двумя независимыми full-path executions и сравнить:

1. terminal success без schema failure;
2. Extractor candidate count и его стабильность;
3. exact Validator cardinality;
4. raw Aggregator status;
5. TR-10 containment;
6. роль unresolved ЕГРИП candidate — accepted material role считается semantic RED;
7. provisional FINAL content, tokens, latency и стоимость.

До прохождения этого gate и ручной проверки поле `application_documents` не готово к автоматическому клиентскому отчёту.
