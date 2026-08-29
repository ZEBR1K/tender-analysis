# DeepSeek V4 Flash 0731 — Extractor evaluation

**Дата:** 2026-08-29
**Workflow:** `[3 TEST] TENDER — Обработать документ` (`2T7szFpiGcfNpKkB`)
**Документ:** `Блок_9_Требования.docx`
**Набор:** одни и те же 16 pinned analysis units (`doc_11_au_0001`–`doc_11_au_0016`)
**Response model:** `deepseek/deepseek-v4-flash-0731`
**Наблюдаемый response provider:** `openrouter`
**Проверенные executions:** `14149`, `14150`, `14151`, `14152`

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
- raw provider responses и `usage`, когда они сохранились;
- deterministic Extractor/evidence checker;
- `FIELD_CATALOG.md` как authoritative источник семантики полей.

Количество facts не считается самостоятельной метрикой качества. Больше facts может означать как лучший recall, так и semantic overreach, дублирование или неправильный `field_key`.

## 2. Итог четырёх запусков

| Execution | Reasoning evidence | Status | Первая ошибка | Evidence validation |
|---|---|---|---|---|
| `14149` | reasoning включён; точный effort не сохранён | error | `review_ason_code` вместо `review_reason_code` | fact-level evidence не достигнута |
| `14150` | reasoning включён; точный effort не сохранён | error | `analysis_Unit_id` вместо `analysis_unit_id` | fact-level evidence не достигнута |
| `14151` | `reasoning_effort=none` подтверждён request alias | error | HTTP `429` на первом item | checker не вызывался |
| `14152` | reasoning выключен; `reasoning_tokens=0` | error | Markdown-fenced JSON | fact-level evidence не достигнута |

Результат серии:

```text
0 / 4 workflow executions прошли
0 / 3 полных AI batches прошли обязательный Extractor contract
1 / 4 остановился до получения первого AI response
```

Формулировка «все четыре не прошли evidence» требует уточнения: `14149`, `14150` и `14152` дошли до checker, но упали на JSON/schema boundary до проверки exact grounding. `14151` не дошёл до checker вообще из-за HTTP 429.

## 3. Метрики полных AI batches

| Sample | Execution | AI time, s | Facts | Empty units | Strict JSON | Full contract valid | Evidence pass | Reasoning tokens | Total tokens | Cached prompt tokens | Cost, RUB |
|---|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|
| R1 | `14149` | 61.914 | 73 | 2 | 16/16 | 13/16 | not reached | 87,342 | 260,676 | 48,640 | 1.809611 |
| R2 | `14150` | 68.199 | 61 | 4 | 16/16 | 14/16 | not reached | 63,772 | 233,579 | 109,568 | 1.259644 |
| N1 | `14152` | 25.744 | 62 | 3 | 14/16 | 14/16 | not reached | 0 | 174,606 | 134,144 | 0.524441 |

Все 48 сохранённых provider responses имели:

```text
response.model = deepseek/deepseek-v4-flash-0731
response.provider = openrouter
finish_reason = stop
```

Суммарная зафиксированная стоимость трёх полных, но непригодных batches:

```text
3.593696 RUB
```

Стоимость `14151` по execution data не зафиксирована. Ответ модели не был получен; запрос закончился HTTP 429 на `itemIndex=0`.

### Reasoning-enabled samples

Среднее R1/R2:

```text
AI time:               65.057 s
facts:                  67.0
full contract valid:    13.5 / 16
reasoning tokens:       75,557
total tokens:          247,127.5
observed cost:           1.534628 RUB
```

Несмотря на высокое число reasoning tokens, обязательный schema contract не был соблюдён ни в одном sample.

### No-reasoning attempts

`14151` завершился HTTP 429 на первом item:

```text
The service is receiving too many requests from you
Слишком много запросов. Попробуйте через несколько секунд.
```

Execution сохранил точный request alias:

```text
deepseek/deepseek-v4-flash-0731@provider=baidu/fp8&reasoning_effort=none
```

Повтор `14152` получил все 16 responses быстро и дёшево, но 2 из 16 были обёрнуты в Markdown fences, поэтому checker корректно остановил workflow.

## 4. Contract failures

### 4.1. Execution 14149

Первый checker error:

```text
[Evidence validator] facts[1]
недопустимое поле review_ason_code
```

Полный raw sweep выявил три malformed units:

```text
doc_11_au_0005:
4 facts используют review_ason_code
вместо review_reason_code

doc_11_au_0007:
2 facts используют review_ason_code
вместо review_reason_code

doc_11_au_0016:
field_catalog_version = tander_fields_v1
вместо tender_fields_v1
```

Итого полный обязательный contract сохранили только `13/16` responses.

### 4.2. Execution 14150

Первый checker error:

```text
[Evidence validator] AIExtractorV1
недопустимое поле analysis_Unit_id
```

Полный raw sweep выявил:

```text
doc_11_au_0003:
analysis_Unit_id
вместо analysis_unit_id

doc_11_au_0012:
field_catalog_verssion
вместо field_catalog_version
```

Итого полный обязательный contract сохранили `14/16` responses.

### 4.3. Execution 14152

Первый checker error:

```text
[Evidence validator] Ответ не является валидным JSON
Unexpected token '`', "```json
```

Markdown fences получили:

```text
doc_11_au_0008
doc_11_au_0014
```

Оба внутренних объекта были parseable и содержали `facts=[]`, но prompt прямо требует только JSON без Markdown. Принимать такие wrappers автоматически или ослаблять checker ради модели нельзя.

## 5. Deterministic validation verdict

Checker сработал правильно во всех доступных случаях:

- неизвестные и опечатанные property names не были молча проигнорированы;
- typo в `field_catalog_version` не был нормализован автоматически;
- неверный `analysis_unit_id` property не был принят;
- Markdown wrapper не был снят эвристически;
- rate-limit failure не был замаскирован пустым ответом.

Exact evidence grounding для raw facts не было доказано ни в одном execution, потому что каждый полный batch остановился раньше на schema/JSON validation. Нельзя сообщать evidence pass rate для этих запусков.

Исправлять ответы модели внутри checker опасно:

```text
schema typo correction
→ скрывает contract failure
→ создаёт неоднозначность audit
→ может принять неизвестное поле не с тем смыслом
```

## 6. Semantic quality raw outputs

Даже если мысленно исправить schema typos и снять Markdown wrappers, модель не проходит semantic quality gate.

### 6.1. `procurement_subject`

Положительно:

- предмет закупки найден корректно во всех трёх полных batches;
- значение описывает стандартные закрытия палуб для ледокола-лидера проекта 10510.

### 6.2. False `evaluation_criteria`

| Sample | Raw `evaluation_criteria` | Semantic verdict |
|---|---:|---|
| R1 | 10 | false positives |
| R2 | 15 | false positives |
| N1 | 3 | false positives |

Итого:

```text
28 false evaluation_criteria
в 3 из 3 полных batches
```

Candidates описывали:

- финансовую устойчивость участника;
- коэффициенты финансового состояния;
- internal due-diligence scoring;
- банкротство;
- численность персонала;
- массовый адрес;
- задолженность;
- другие qualification/compliance checks.

`FIELD_CATALOG.md` определяет поле как критерии, показатели, веса, баллы и правила оценки/сравнения заявок и прямо запрещает путать его с обязательными требованиями к участнику. Наличие баллов во внутренней проверке контрагента не делает такую проверку клиентским `evaluation_criteria`.

### 6.3. Нестабильность field classification

| Field | R1 | R2 | N1 |
|---|---:|---:|---:|
| `procurement_subject` | 1 | 1 | 1 |
| `application_documents` | 58 | 41 | 26 |
| `evaluation_criteria` | 10 | 15 | 3 |
| `required_official_certificates` | 3 | 3 | 24 |
| `licenses_certificates` | 1 | 1 | 3 |
| `similar_supply_experience` | 0 | 0 | 3 |

Это не просто различное разбиение composite facts:

- `required_official_certificates` меняется `3 → 3 → 24`;
- `application_documents` меняется `58 → 41 → 26`;
- явное отрицательное требование по опыту пропущено в R1/R2, но возвращено трижды в N1;
- N1 снова классифицировал необязательную справку со словами `участник вправе предоставить` как `required_official_certificates`.

### 6.4. Source fidelity

В raw `value_text` R1/R2 наблюдались модельные искажения и смешение алфавитов, например:

```text
финнансового
учреждлений
инстitутов
оснокая оценка
```

Это дополнительный признак низкой дисциплины копирования source text. Поскольку checker остановился раньше, полный exact-evidence sweep production-кодом не был выполнен.

## 7. Provider and availability

Источники расходятся:

```text
request alias 14151:
@provider=baidu/fp8

response.provider полных batches:
openrouter
```

Поэтому executions подтверждают response model `deepseek/deepseek-v4-flash-0731`, но не подтверждают, что requested provider pin был фактически соблюдён.

HTTP 429 на первом item показывает дополнительный availability/rate-limit risk. В сочетании с предыдущими проблемами DeepSeek provider это делает модель ненадёжной для текущего Document Worker, даже несмотря на низкую наблюдаемую стоимость успешных HTTP batches.

## 8. Сравнение с GLM 5.3 Flash low baseline

| Метрика | GLM 5.3 Flash low | DeepSeek V4 Flash 0731 |
|---|---:|---:|
| Полные samples | 2 | 3 |
| Workflow contract success | 2/2 | 0/3 |
| Дополнительный provider failure | нет в выбранных baseline samples | 1 × HTTP 429 |
| Evidence pass | 14/16 в каждом sample | не достигнута |
| False `evaluation_criteria` | 1 total | 28 total |
| Средняя observed cost | 3.043308 RUB | 1.197899 RUB по трём полным failed batches |

DeepSeek был дешевле по recorded cost, но стоимость непригодного результата не является преимуществом. Reliability и semantic precision значительно хуже baseline.

## 9. Verdict

**REJECT. DeepSeek V4 Flash 0731 не использовать для Extractor.**

Причины:

1. 0/4 executions прошли тестовый путь.
2. 0/3 полных AI batches прошли обязательный JSON/schema contract.
3. Один execution получил HTTP 429 на первом item.
4. Schema typos разнообразны и не сводятся к одному детерминированному дефекту.
5. Reasoning не устранил contract failures.
6. No-reasoning также нарушил JSON-only contract.
7. 28 false `evaluation_criteria` в трёх raw samples.
8. Сильная нестабильность `application_documents`, справок, лицензий и опыта.
9. Наблюдались искажения исходного текста.
10. Фактический provider не подтверждает requested provider pin.

Не рекомендуется:

- повторять DeepSeek серию;
- добавлять retry только ради model evaluation;
- снимать Markdown fences в checker;
- исправлять опечатки property names автоматически;
- ослаблять schema или exact evidence validation.

## 10. Следующий шаг

Перейти к GPT-кандидату на тех же 16 pinned units, не меняя:

- Extractor prompt;
- response schema;
- `max_tokens`;
- evidence resource limits;
- deterministic checker;
- source pin data.

Критерии stop/go:

1. strict Extractor contract 16/16;
2. first-pass exact evidence не хуже 15/16;
3. корректный `procurement_subject`;
4. сохранение явных отрицательных licenses/experience facts;
5. zero false `evaluation_criteria`;
6. отсутствие optional-as-required certificates;
7. отсутствие schema typos и Markdown wrappers;
8. два независимых provider samples без rate-limit/timeout failure;
9. приемлемая latency и фактическая стоимость.

Этот отчёт не изменяет production decision и не подтверждает корректность полного Document Worker, AI Validator, Aggregator или итоговых 27 полей.
