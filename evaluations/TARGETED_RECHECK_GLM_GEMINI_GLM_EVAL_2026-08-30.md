# Targeted Recheck — GLM / Gemini / GLM runtime evaluation

**Дата:** 2026-08-30  
**Test workflow:** `[TEST CODEX] TENDER - Targeted Recheck` (`nI47FcgzYwGzwGqy`)  
**Workflow version:** `b697cb34-3e0d-4b76-ab47-cb827dbe270c`  
**Execution IDs:** `14211`, `14213`, `14214`, `14215`  
**Поле:** `tender_fields_v1/application_documents`, `field_index=27`  
**Analysis run:** `5605dbf4-ac39-4225-b11a-ae2dc17b3a56`

## Проверенная конфигурация

Read-back test workflow перед review подтвердил:

```text
Targeted Recheck Extractor
z-ai/glm-5.3-flash@provider=cloudflare&reasoning_effort=low
max_tokens=8192

Targeted Recheck Validator
google/gemini-3.7-flash@provider=google-ai-studio/flex&reasoning_effort=low
max_tokens=8192

Semantic Aggregator Round 2
z-ai/glm-5.3-flash@provider=cloudflare&reasoning_effort=low
max_tokens=16384

HTTP timeout каждого AI-вызова: 180000 ms
```

Workflow inactive/unpublished. Четыре execution начались после сохранения указанной версии. Фактические response metadata подтвердили base models `z-ai/glm-5.3-flash`, `google/gemini-3.7-flash`, `z-ai/glm-5.3-flash` на исполненных этапах.

Каждый execution был независимо проверен отдельным Sol-рецензентом в read-only режиме; итоговые выводы повторно сопоставлены главным reviewer с workflow state, execution metadata, deterministic contracts и предыдущим DeepSeek baseline.

## Scope и ограничения

Все четыре запуска получили один и тот же входной контракт:

```text
field_key = application_documents
aggregation_status = requires_recheck
existing candidates = 28
context_found = true
context units = 10
```

Это не full procurement run. Все executions использовали один `analysis_run_id` и один `field_key`. Только `14211` дошёл до UPSERT/Finalizer; Finalizer увидел `3/27`, вернул `barrier_ready=false`, `completion_claimed=false`, `waiting_for_final_fields`. Остальные три не создали FINAL.

## Итоговый verdict

```text
GLM / Gemini / GLM
REJECT как схема для автоматического клиентского отчёта.

Extractor GLM и Validator Gemini можно оставить кандидатами.
Semantic Aggregator GLM текущий exact-reference contract не проходит.
```

Главные причины:

1. Terminal FINAL создан только в `1/4` executions.
2. В `3/4` executions GLM Semantic Aggregator нарушил deterministic candidate contract: неизвестный/synthetic ref, сокращённый UUID либо неполная cardinality.
3. Во всех `4/4` raw ответах Aggregator сообщил `resolved` и принял unresolved ЕГРИП candidate в material role.
4. Только `14211` дошёл до TR-10 containment и был безопасно преобразован в effective `requires_review`.
5. В трёх error executions false-resolved не попал в FINAL только потому, что structural checker остановил workflow раньше; это fail-closed, но одновременно подтверждение TR-11 terminal-result gap.
6. Round 2 систематически возвращал в application scope due-diligence clauses, ранее исключённые как `not_applicable`.

Экономия стоимости и времени существенна, но не компенсирует failure rate и semantic risk.

## Сводные результаты

| ID | Workflow status | Extractor candidates | Round 2 candidates | Aggregator raw | Effective/terminal | Wall time | Tokens | Cost, RUB |
|---|---|---:|---:|---|---|---:|---:|---:|
| `14211` | `success` | 4 | 32 | `resolved` | TR-10 → `requires_review`; FINAL/DB/Finalizer выполнены | 99.980 s | 100,966 | 2.58176495 |
| `14213` | `error` | 1 | 29 | `resolved` | checker error: unknown synthetic `candidate_ref`; no FINAL | 81.382 s | 104,447 | 1.72769798 |
| `14214` | `error` | 5 | 33 | `resolved` | checker error: truncated UUID; no FINAL | 150.264 s | 115,210 | 3.18783601 |
| `14215` | `error` | 2 | 30 | `resolved` | checker error: `29/30` decisions; no FINAL | 84.035 s | 94,178 | 1.32951273 |

Observed total:

```text
4 executions
414,801 tokens
8.82681167 RUB
415.661 s суммарного wall time
392.631 s суммарного времени AI-нод
```

Средняя стоимость попытки: `2.2067029175 RUB`. Это measurements данного fixture/provider с observed caching, а не общая цена модели.

## Execution 14211 — единственный terminal run

### AI stages

| Этап | Finish | Latency | Tokens | Cost, RUB |
|---|---:|---:|---:|---:|
| GLM Extractor | `stop` | 41.394 s | 55,476 | 1.09957397 |
| Gemini Validator | `stop` | 4.120 s | 17,175 | 0.83864376 |
| GLM Aggregator | `stop` | 46.816 s | 28,315 | 0.64354722 |

Extractor вернул `4` grounded candidates; `evidence_validated=true`. Validator принял exact `4/4`: `4 confirmed / 0 requires_review / 0 rejected`; `validator_validated=true`.

Round 2 содержал `32` candidates. Aggregator выдал полный structural response:

```text
primary = 1
complement = 22
supporting = 6
duplicate = 2
not_applicable = 1
reported_status = resolved
```

TR-10 сработал:

```text
effective_status = requires_review
review_reason_code = insufficient_evidence
containment_policy = application_documents_round2_requires_review_v1
requires_human_review = true
```

DB UPSERT и Finalizer были выполнены. Finalizer корректно не завершил run: `final_count=3`, `barrier_ready=false`, отсутствуют `24` поля.

### Semantic oracle

Unresolved ИП candidate утверждал `ЕГРИП (не позднее 6 месяцев)`, при этом его evidence указывало `не более 1 месяца`; upstream verdict был `requires_review/insufficient_evidence`. Aggregator назначил ему accepted role `complement`.

Также broad due-diligence material был снова включён в raw resolved result. Опциональность справки ФНС была сохранена как «по желанию», но этого недостаточно для общего semantic PASS.

Итог: deterministic containment GREEN, strict semantic oracle RED. Provisional value нельзя считать клиентским подтверждённым перечнем.

## Execution 14213 — invented candidate reference

### AI stages

| Этап | Finish | Latency | Tokens | Cost, RUB |
|---|---:|---:|---:|---:|
| GLM Extractor | `stop` | 23.670 s | 54,451 | 0.28537635 |
| Gemini Validator | `stop` | 3.484 s | 23,194 | 1.05937234 |
| GLM Aggregator | `stop` | 49.529 s | 26,802 | 0.38294929 |

Extractor: `1` candidate, evidence checker PASS. Validator: `1/1 confirmed`, checker PASS. Round 2: `29` candidates (`22 confirmed / 7 requires_review`).

Raw Aggregator вернул `resolved`, `confidence=0.9`, но создал неизвестный ref:

```text
fact:27fa5ecc-2b0d-corrector
```

Allow-list checker fail-closed остановил execution. Effective status и TR-10 containment не были сформированы; FINAL, DB UPSERT и Finalizer отсутствуют.

Unresolved ЕГРИП candidate получил `complement` и вошёл в raw resolved text. Большинство due-diligence candidates также были повторно приняты. Это attempted false-resolved, остановленный structural linking guard.

## Execution 14214 — shortened UUID

### AI stages

| Этап | Finish | Latency | Tokens | Cost, RUB |
|---|---:|---:|---:|---:|
| GLM Extractor | `stop` | 90.022 s | 58,750 | 1.29419199 |
| Gemini Validator | `stop` | 3.699 s | 24,464 | 1.17858627 |
| GLM Aggregator | `stop` | 51.340 s | 31,996 | 0.71505775 |

Extractor: `5` candidates, evidence checker PASS. Validator: exact `5/5 confirmed`, checker PASS. Round 2: `33` candidates (`26 confirmed / 7 requires_review`).

Raw Aggregator вернул `resolved`, `confidence=0.93`, но сократил allow-listed UUID:

```text
expected: fact:47493464-d922-4db4-8c75-71fca01e357f
returned: fact:47493464
```

Checker остановил response как unknown candidate reference. TR-10 не был достигнут; FINAL/DB/Finalizer отсутствуют.

Recheck candidate исправил срок ЕГРИП на 1 месяц, однако Aggregator оставил ошибочный исходный `requires_review` candidate в accepted роли `supporting`, утверждая, что новый candidate исправил проблему. Это небезопасная audit semantics. Due-diligence candidates также были повышены до `supporting`.

## Execution 14215 — incomplete cardinality и shortened refs

### AI stages

| Этап | Finish | Latency | Tokens | Cost, RUB |
|---|---:|---:|---:|---:|
| GLM Extractor | `stop` | 26.684 s | 54,372 | 0.28068032 |
| Gemini Validator | `stop` | 2.687 s | 12,523 | 0.59968089 |
| GLM Aggregator | `stop` | 49.186 s | 27,283 | 0.44915152 |

Extractor: `2` candidates, evidence checker PASS. Validator: exact `2/2 confirmed`, checker PASS. Round 2: `30` candidates (`23 confirmed / 7 requires_review`).

Raw Aggregator вернул `resolved`, `confidence=0.9`, но только `29` decisions для `30` candidates. Missing decision относился к registration/documents candidate `fact:a8f3c10d…`; fact references в output также систематически сокращались до коротких префиксов.

Cardinality checker остановил execution до linking и TR-10. FINAL/DB/Finalizer отсутствуют.

Unresolved ЕГРИП и optional tax-certificate candidates получили `supporting`, а due-diligence scope был возвращён в raw resolved result. False-resolved был предотвращён structural failure, не semantic correctness.

## Stage-level оценка

### GLM Extractor

```text
candidate counts: 4 / 1 / 5 / 2
evidence checker: 4/4 PASS
finish_reason: 4/4 stop
```

По этому небольшому fixture Extractor технически стабильнее DeepSeek: не было `0 candidates` и safe fallback. Но variability `1..5` остаётся существенной, а semantic completeness не доказана.

### Gemini Validator

```text
exact cardinality: 4/4 PASS
confirmed: 4/4, 1/1, 5/5, 2/2
finish_reason: 4/4 stop
latency: 2.687–4.120 s
```

Validator технически очень стабилен и быстр. Но `all confirmed` во всех повторениях не является самостоятельным доказательством semantic correctness; это нужно проверять по каждому candidate/evidence.

### GLM Semantic Aggregator

```text
raw resolved: 4/4
exact structural contract accepted: 1/4
unknown/truncated/missing refs: 3/4
unresolved ЕГРИП accepted as material: 4/4
due-diligence scope expansion: 4/4
```

Verdict: REJECT для текущего Round 2 contract. Необходимо сменить модель/стратегию Aggregator либо отдельно доказать исправление exact-reference compliance; ослаблять checker запрещено.

## Сравнение с DeepSeek baseline

DeepSeek evidence: `14204`, `14205`, `14207`, `14209`. Подробности находятся в `evaluations/TARGETED_RECHECK_DEEPSEEK_EVAL_2026-08-30.md`.

| Метрика | DeepSeek / DeepSeek / DeepSeek | GLM / Gemini / GLM |
|---|---:|---:|
| Workflow terminal success | 3/4 | 1/4 |
| Full 3-stage executions entered | 3/4 | 4/4 |
| Full 3-stage terminal success | 2/3 | 1/4 |
| Observed total cost | 50.03553430 RUB | 8.82681167 RUB |
| Observed total wall time | 848.930 s | 415.661 s |
| Strict semantic safety for raw resolved | RED | RED |

Наборы путей различаются (`14205` был одноэтапным DeepSeek fallback), поэтому totals не являются чистым price benchmark. В observed runs GLM/Gemini/GLM примерно на `82.4%` дешевле и на `51.0%` быстрее по total wall time, но заметно хуже по terminal reliability.

## Verified / not verified

### Verified

- GLM Extractor и Gemini Validator прошли deterministic grounding/cardinality checks во всех четырёх executions;
- structural checker не пропустил invented, shortened или missing candidate references;
- `14211` подтвердил runtime работу TR-10 containment и audit-preserving terminal `requires_review`;
- ни один execution не создал `not_found` из отсутствия evidence;
- incomplete `3/27` run не был ошибочно completed.

### Not verified

- semantic completeness `application_documents`;
- корректная классификация unresolved material clauses;
- стабильный exact-reference response GLM Aggregator;
- terminal fallback/alert после checker failure (TR-11);
- fresh `27/27` full run;
- клиентский report, XLSX и delivery.

## Следующий model gate

Не следует повторять ещё много запусков того же GLM Aggregator без изменения гипотезы: три разных structural failures уже показывают системный contract mismatch.

Минимальный следующий эксперимент:

```text
оставить GLM Extractor
оставить Gemini Validator
заменить только Semantic Aggregator
```

Первым кандидатом логично проверить Gemini 3.7 Flash low на том же frozen input. Gate:

1. exact candidate refs/cardinality `100%` минимум в двух независимых runs;
2. checker accepted;
3. `application_documents` effective `requires_review`;
4. unresolved ЕГРИП candidate не получает accepted material role;
5. due-diligence clauses не возвращаются в current application scope;
6. FINAL/audit/DB путь проходит без TR-11 failure.

До этого GLM/Gemini/GLM не готов к полному клиентскому прогону.
