# GPT-5.4 Nano low — Extractor evaluation

**Дата:** 2026-08-29
**Workflow:** `[3 TEST] TENDER — Обработать документ` (`2T7szFpiGcfNpKkB`)
**Документ:** `Блок_9_Требования.docx`
**Набор:** одни и те же 16 pinned analysis units (`doc_11_au_0001`–`doc_11_au_0016`)
**Response model:** `openai/gpt-5.4-nano`
**Наблюдаемый response provider:** `openrouter`
**Текущая request-конфигурация тестового workflow:** `openai/gpt-5.4-nano@provider=openai/flex&reasoning_effort=low`
**Проверенные executions:** `14157`, `14158`

## 1. Границы проверки

Проверялись только:

```text
When clicking ‘Execute workflow’
→ Подготовить запрос для AI
→ AI Extractor v1.0
→ Проверить и привязать evidence
```

Evidence Repair, AI Validator, PostgreSQL persistence, Aggregator и production workflows не запускались.

Источники данных:

- live execution data n8n;
- raw provider responses и `usage`;
- output deterministic Extractor/evidence checker;
- live read-back тестового workflow после запусков;
- `FIELD_CATALOG.md` как authoritative источник семантики полей.

Количество facts не считается самостоятельной метрикой качества. Больше facts может означать semantic overreach, неправильный `field_key`, избыточное дробление или дублирование.

## 2. Итог двух запусков

| Sample | Execution | n8n status | AI time, s | Raw facts | Empty units | Strict JSON | Evidence pass | Verified facts | Reasoning tokens | Total tokens | Cached prompt tokens | Cost, RUB |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| N1 | `14157` | error | 49.337 | 133 | 2 | 16/16 | не достигнута | не сформированы | 5,115 | 165,876 | 33,792 | 3.916116 |
| N2 | `14158` | success | 43.851 | 118 | 3 | 16/16 | 11/16 | 113 | 4,540 | 165,210 | 97,280 | 3.187319 |

Среднее по двум полным provider batches:

```text
AI time:               46.594 s
raw facts:             125.5
reasoning tokens:      4,827.5
total tokens:          165,543
observed cost:         3.551718 RUB
```

Суммарная зафиксированная стоимость двух batches:

```text
7.103435 RUB
```

Оба запуска получили все 16 AI responses с:

```text
response.model = openai/gpt-5.4-nano
response.provider = openrouter
finish_reason = stop
```

Зелёный n8n status execution `14158` не означает успешную evidence validation всего набора. Тестовая ветка заканчивается на checker и не содержит production gate, который обязан остановить дальнейшую обработку unit с `validation_passed=false`. Фактически first-pass evidence прошли только `11/16` units.

## 3. Execution 14157 — schema contract failure

AI вернул строгий JSON для всех 16 units, но checker остановил workflow на обязательном fact contract:

```text
[Evidence validator] facts[3]
review fields должны быть null для found
```

Raw sweep всего batch обнаружил пять facts со статусом `found`, у которых модель одновременно заполнила `review_reason_code` и `review_note`:

```text
doc_11_au_0003: 2 facts
doc_11_au_0011: 3 facts
```

Использованные model values включали:

```text
incomplete_value
other
source_quality_issue
```

Контракт требует:

```text
status = found
→ review_reason_code = null
→ review_note = null
```

Если модель считает факт неполным или качество source сомнительным, она должна использовать `status="requires_review"`. Смешанная комбинация неоднозначна для downstream audit, поэтому checker корректно завершил workflow явной ошибкой.

Ослаблять checker, молча удалять review fields или автоматически менять status ради этой модели нельзя.

## 4. Execution 14158 — partial evidence failure

В этом запуске top-level и fact schema были формально валидны, поэтому checker обработал все 16 units.

Результат:

```text
validation_passed=true:   11 units
validation_passed=false:   5 units
verified_facts:           113
```

Нарушения:

| Unit | Нарушения |
|---|---|
| `doc_11_au_0002` | `missing_primary_evidence`, `quote_not_found` |
| `doc_11_au_0003` | `duplicate_evidence` |
| `doc_11_au_0011` | `missing_primary_evidence`, `quote_not_found` |
| `doc_11_au_0013` | `missing_primary_evidence`, `quote_not_found` |
| `doc_11_au_0016` | `missing_primary_evidence`, `quote_not_found` |

Итого:

```text
4 × missing_primary_evidence
4 × quote_not_found
1 × duplicate_evidence
```

Deterministic checker сработал правильно:

- не принял quote, отсутствующий в указанном semantic block;
- не разрешил evidence только из недопустимого scope;
- не проигнорировал дублированную пару `semantic_block_id + quote`;
- не применил fuzzy matching или автоматическое исправление текста.

## 5. Semantic quality

### 5.1. Нестабильный `procurement_subject`

Execution `14157` корректно извлёк:

> стандартные закрытия палуб для ледокола-лидера пр.10510 зав № 056001

Execution `14158` на тех же pinned data вернул для `doc_11_au_0001`:

```json
{"facts": []}
```

В reasoning модель прямо решила, что предмет закупки «не относится» к квалификационному разделу, хотя semantic block явно устанавливает объект текущей закупки. Это false negative по одному из основных клиентских полей.

### 5.2. False `evaluation_criteria`

| Sample | Candidates |
|---|---:|
| N1 / `14157` | 27 |
| N2 / `14158` | 34 |

Итого модель создала `61` candidate под `evaluation_criteria`.

Они описывали:

- обязательные квалификационные требования к участнику;
- отсутствие задолженности, конфликтов интересов и судебных разбирательств;
- финансовое состояние участника;
- внутреннюю due-diligence проверку контрагента;
- массового руководителя, юридический адрес и численность персонала;
- баллы внутренней проверки поставщика.

`FIELD_CATALOG.md` определяет `evaluation_criteria` как критерии, показатели, веса, баллы и правила оценки/сравнения заявок и прямо запрещает путать это поле с обязательными требованиями к участнику. Наличие слов `баллы`, `соответствует` или внутренних числовых оценок не превращает qualification/due-diligence проверку в клиентское поле оценки конкурсных заявок.

Таким образом, серия показывает систематический semantic overreach, а не единичную ошибку формулировки.

### 5.3. False `national_regime`

| Sample | Candidates |
|---|---:|
| N1 / `14157` | 8 |
| N2 / `14158` | 4 |

Все 12 candidates относились к общей проверке участника:

- соблюдение законодательства;
- коррупция, экстремизм и терроризм;
- недействительные паспорта;
- принадлежность к МСП;
- офшорные и льготные налоговые юрисдикции.

Они не устанавливают применимые к текущей закупке запреты, ограничения или преимущества национального режима. Это неправильный `field_key`.

### 5.4. `required_official_certificates`

Распределение нестабильно:

```text
14157:  5 candidates
14158: 13 candidates
```

Среди них модель относила к обязательным официальным справкам:

- бухгалтерский баланс и финансовую отчётность;
- формы бухгалтерской отчётности;
- правила языка и количества экземпляров;
- необязательную справку с формулировкой `участник вправе представить`.

Это смешивает официальные справки/выписки о самом участнике с application documents и необязательными подтверждениями.

### 5.5. Overconfidence

Execution `14158` вернул все 118 facts со статусом `found`:

```text
requires_review = 0
```

При этом checker обнаружил quote и scope failures в пяти units, а semantic audit выявил неправильные field boundaries. Модель не использовала `requires_review` даже там, где собственное evidence не обеспечивало точное подтверждение.

## 6. Reproducibility

Распределение facts:

| Field | `14157` | `14158` |
|---|---:|---:|
| `procurement_subject` | 1 | 0 |
| `application_documents` | 89 | 66 |
| `evaluation_criteria` | 27 | 34 |
| `required_official_certificates` | 5 | 13 |
| `licenses_certificates` | 2 | 1 |
| `similar_supply_experience` | 1 | 0 |
| `national_regime` | 8 | 4 |

Сравнение двух samples:

```text
normalized value signatures:
24 common из 226 union
Jaccard = 0.106

exact evidence signatures:
20 common из 231 union
Jaccard = 0.087
```

Низкое совпадение частично может объясняться разным разбиением composite facts. Однако одновременно меняются:

- наличие `procurement_subject`;
- наличие `similar_supply_experience`;
- количество `application_documents` на 23 facts;
- количество справок более чем в 2.5 раза;
- набор qualification checks, ошибочно попавших в соседние поля.

Это подтверждает слабую воспроизводимость не только формулировок, но и field classification.

## 7. Сравнение с GLM 5.3 Flash low baseline

| Метрика | GLM 5.3 Flash low | GPT-5.4 Nano low | Сравнение |
|---|---:|---:|---|
| Samples | 2 | 2 | одинаково |
| AI time | 83.684 s | 46.594 s | Nano примерно на 44% быстрее |
| Raw facts | 67.5 | 125.5 | почти в 1.9 раза больше, преимущественно из-за semantic overreach |
| Complete workflow contract | 2/2 | 1/2 | Nano хуже |
| First-pass evidence | 14/16 в обоих samples | 11/16 в единственном прошедшем sample | Nano хуже |
| Observed cost | 3.043308 RUB | 3.551718 RUB | Nano примерно на 17% дороже |
| False `evaluation_criteria` | 1 total | 61 total | Nano значительно хуже |
| `procurement_subject` | 2/2 | 1/2 | Nano хуже |

Преимущество Nano по latency не компенсирует:

- schema failure в одном из двух запусков;
- более слабый exact evidence result;
- false negative по предмету закупки;
- систематические false positives;
- крайне низкую reproducibility.

## 8. Provider and audit boundary

В сохранённых responses наблюдается:

```text
response.model = openai/gpt-5.4-nano
response.provider = openrouter
```

Read-back тестового workflow после запусков показывает request alias:

```text
openai/gpt-5.4-nano@provider=openai/flex&reasoning_effort=low
```

Execution output не содержит независимого надёжного поля, доказывающего фактически выбранный upstream provider route для каждого item. Поэтому отчёт подтверждает response model и observed response provider, но не объявляет provider pin независимо подтверждённым.

Отдельно остаётся известный audit defect Document Worker: checker записывает статический `extractor.provider="deepseek"`. Это поле нельзя использовать как доказательство фактической модели или provider для A/B-теста.

## 9. Verdict

**REJECT. GPT-5.4 Nano low не использовать как Extractor.**

Причины:

1. Только 1 из 2 executions завершился без hard error.
2. В failed batch модель нарушила обязательную согласованность `status` и review fields.
3. В формально успешном execution только 11 из 16 units прошли first-pass evidence.
4. `procurement_subject` найден нестабильно: 1/2.
5. Создан 61 false `evaluation_criteria` candidate.
6. Созданы 12 false `national_regime` candidates.
7. Обязательные официальные справки смешиваются с финансовой отчётностью, application documents и необязательными документами.
8. Exact value/evidence reproducibility ниже 11%.
9. Более высокая стоимость относительно GLM 5.3 Flash low.
10. Преимущество по скорости не компенсирует reliability и semantic precision failures.

Не рекомендуется:

- повторять серию GPT-5.4 Nano на этом fixture;
- ослаблять status/review contract;
- автоматически удалять review fields из `found`;
- расширять fuzzy evidence matching;
- полагаться на downstream AI Validator для исправления массово неверных `field_key`.

## 10. Следующий шаг

GPT-5.4 Nano исключить из списка кандидатов Extractor.

До проверки следующей модели сохранить неизменными:

- Extractor prompt;
- response schema;
- `max_tokens=16384`;
- `reasoning_effort=low` для сопоставимого режима;
- evidence resource limits;
- deterministic checker;
- 16 pinned analysis units.

Текущий сравнительный baseline остаётся GLM 5.3 Flash low. Новая модель должна как минимум показать два независимых samples со следующими свойствами:

1. strict Extractor contract 16/16;
2. first-pass evidence не хуже 15/16;
3. корректный `procurement_subject` в 2/2;
4. сохранение явных licenses/experience facts;
5. zero false `evaluation_criteria`;
6. zero false `national_regime`;
7. отсутствие optional-as-required certificates;
8. приемлемая latency и фактическая стоимость.

Этот отчёт не изменяет production decision и не подтверждает корректность полного Document Worker, Evidence Repair, AI Validator, Aggregator или итоговых 27 полей.
