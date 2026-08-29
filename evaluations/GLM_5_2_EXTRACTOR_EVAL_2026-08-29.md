# GLM 5.2 — Extractor evaluation

**Дата:** 2026-08-29
**Workflow:** `[3 TEST] TENDER — Обработать документ` (`2T7szFpiGcfNpKkB`)
**Документ:** `Блок_9_Требования.docx`
**Набор:** одни и те же 16 pinned analysis units (`doc_11_au_0001`–`doc_11_au_0016`)
**Response model:** `z-ai/glm-5.2`
**Наблюдаемый response provider:** `openrouter`
**Проверяемая переменная:** reasoning выключен против `reasoning_effort=low`

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

- live execution data n8n для executions `14135`–`14139`, `14142`, `14143`;
- raw provider responses и `usage`, когда они сохранились в execution data;
- output deterministic evidence checker;
- `FIELD_CATALOG.md` как authoritative источник семантики полей.

Количество извлечённых facts не считается самостоятельной метрикой качества: больше facts может означать как лучший recall, так и semantic overreach, лишнее дробление или false positives.

## 2. Классификация семи executions

| Execution | Reasoning | Status | Классификация | Основание |
|---|---|---|---|---|
| `14135` | выключен | error | полный provider sample, contract failure | 16 AI responses получены; 3 ответа обёрнуты в Markdown fences; checker остановился на первом |
| `14136` | выключен | error | полный provider sample, contract failure | 16 AI responses получены; 2 ответа обёрнуты в Markdown fences; checker остановился на первом |
| `14137` | не подтверждён execution data | error | transport/availability failure | HTTP node упал на `itemIndex=4` с `ECONNABORTED`; timeout `180000 ms`; output и usage не сохранены |
| `14138` | не подтверждён execution data | canceled | исключён | отменён вручную через 299 секунд; `runData` отсутствует |
| `14139` | не подтверждён execution data | canceled | исключён | отменён вручную через 145 секунд; `runData` отсутствует |
| `14142` | low | success | уникальный provider sample L1 | 16 новых AI responses; checker исполнился для всех units |
| `14143` | low | success | уникальный provider sample L2 | 16 новых AI responses; checker исполнился для всех units |

Для `14135` и `14136` выключенный reasoning подтверждается `reasoning_tokens=0`. Для `14142` и `14143` low подтверждается наличием `58,173` и `46,841` reasoning tokens соответственно. У `14137`–`14139` provider response/usage отсутствуют, поэтому execution data независимо не подтверждает reasoning setting; эти запуски нельзя включать в сравнение качества или стоимости.

## 3. Reasoning выключен

### 3.1. Метрики завершённых provider batches

| Sample | Execution | AI time, s | Raw facts | Empty units | Strict JSON | Fenced but recoverable JSON | Reasoning tokens | Total tokens | Cached prompt tokens | Cost, RUB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| N1 | `14135` | 134.024 | 88 | 0 | 13/16 | 3 | 0 | 172,836 | 18,816 | 9.951926 |
| N2 | `14136` | 136.701 | 84 | 0 | 14/16 | 2 | 0 | 171,856 | 131,136 | 6.112463 |

Среднее по двум полным provider batches:

```text
AI time:              135.363 s
raw facts:             86.0
strict JSON:           13.5 / 16
reasoning tokens:       0
total tokens:         172,346
cached prompt tokens:  74,976
observed cost:          8.032195 RUB
```

Суммарная зафиксированная стоимость N1 и N2: `16.064389 RUB`.

### 3.2. JSON contract failure

Все пять нестандартных ответов содержали синтаксически корректный JSON внутри:

````text
```json
{ ... }
```
````

Нарушения распределились так:

```text
14135:
doc_11_au_0002
doc_11_au_0003
doc_11_au_0016

14136:
doc_11_au_0002
doc_11_au_0016
```

Prompt прямо требует возвращать только JSON без Markdown. Production checker не обязан угадывать намерение модели или снимать произвольные wrappers. Он корректно завершил оба workflow явной ошибкой:

```text
[Evidence validator] Ответ не является валидным JSON
```

Ослаблять checker или автоматически принимать Markdown-fenced output ради этой модели нельзя.

### 3.3. Availability failure

Execution `14137` остановился в `AI Extractor v1.0`:

```text
itemIndex = 4
timeout = 180000 ms
httpCode = ECONNABORTED
retryOnFail = true
waitBetweenTries = 5000 ms
AI node execution time = 550.465 s
```

Продолжительность согласуется с повторными попытками одного item. Поскольку HTTP node завершился ошибкой, частичные ответы и usage предыдущих items не были сохранены. Поэтому реальная стоимость `14137` по n8n execution data неизвестна и может быть больше нуля.

Executions `14138` и `14139` были отменены вручную и не содержат ни `runData`, ни usage. Их нельзя интерпретировать как независимые model samples.

### 3.4. Semantic quality без reasoning

Положительно:

- `procurement_subject` найден корректно в обоих полных samples;
- явные отрицательные требования по лицензиям и опыту найдены в обоих samples.

Критический дефект:

| Sample | False `evaluation_criteria` |
|---|---:|
| N1 | 8 |
| N2 | 6 |

Все 14 candidates описывали квалификационную проверку или финансовое состояние участника, а не критерии оценки/сравнения заявок.

`FIELD_CATALOG.md` определяет `evaluation_criteria` как:

> критерии, показатели, веса, баллы и правила оценки/сравнения заявок;

и прямо запрещает путать это поле с обязательными требованиями к участнику.

Также N1 дважды классифицировал необязательную справку со словами `участник вправе представить` как `required_official_certificates`. Канонический каталог относит к этому полю обязательные справки и выписки, поэтому такие optional candidates являются semantic false positives.

### Verdict для reasoning выключен

**REJECT.**

Причины:

- 2/2 полных batches завершили workflow ошибкой JSON contract;
- отдельный запуск закончился длительным timeout;
- ещё два запуска были отменены без сохранённого результата;
- 14 false `evaluation_criteria` в двух доступных samples;
- отсутствие reasoning не дало преимущества по latency относительно low.

## 4. GLM 5.2 low

### 4.1. Метрики

| Sample | Execution | AI time, s | Facts | Empty units | Correct JSON | Evidence pass | Verified facts | Violations | Reasoning tokens | Total tokens | Cached prompt tokens | Cost, RUB |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|
| L1 | `14142` | 110.291 | 88 | 0 | 16/16 | 15/16 | 87 | 1 × `quote_not_found` | 58,173 | 214,876 | 130,688 | 16.849952 |
| L2 | `14143` | 98.215 | 77 | 0 | 16/16 | 15/16 | 76 | 1 × `quote_not_found` | 46,841 | 200,734 | 130,560 | 14.233158 |

Среднее по двум low samples:

```text
AI time:              104.253 s
facts:                  82.5
evidence pass:          15 / 16
verified facts:         81.5
reasoning tokens:       52,507
total tokens:          207,805
cached prompt tokens:  130,624
observed cost:          15.541555 RUB
```

Суммарная зафиксированная стоимость L1 и L2: `31.083110 RUB`.

Наблюдаемая стоимость зависит от provider cache и не является чистой тарифной оценкой reasoning. Однако это фактическая стоимость данных executions.

### 4.2. Deterministic evidence

Оба low samples вернули строгий JSON 16/16. В каждом sample deterministic checker отклонил один fact:

```text
analysis_unit_id = doc_11_au_0002
field_key = licenses_certificates
code = quote_not_found
exact_match_candidate_ids = []
```

Модель использовала нормализованную формулировку заголовка вместо точного текста source provenance. Это тот же класс mismatch, который ранее воспроизводился на варианте `РАЗРЕШЕНЙ` / `РАЗРЕШЕНИЙ`: бизнес-смысл понятен, но exact quote изменён моделью.

Checker сработал правильно. Fuzzy matching, OCR correction и автоматическое принятие исправленной цитаты не применялись.

Эти partial manual executions заканчивались на первой evidence-проверке. Поэтому результат bounded Evidence Repair для данного ответа не проверялся.

### 4.3. Semantic quality

Положительно:

- `procurement_subject` корректен в 2/2 samples;
- явное `требования к наличию разрешений не установлены` найдено в 2/2;
- явное `требования к опыту не установлены` найдено в 2/2;
- top-level Extractor contract соблюдён 32/32 responses.

#### False `evaluation_criteria`

| Sample | Candidates | Semantic verdict |
|---|---:|---|
| L1 | 2 | оба false positive: qualification criteria, а не оценка/сравнение заявок |
| L2 | 1 | false positive: qualification criteria, а не оценка/сравнение заявок |

Таким образом, semantic boundary нарушена в 2/2 low samples.

#### Необязательные официальные справки

`required_official_certificates` по каталогу означает обязательные справки, выписки и официальные подтверждения. Модель создала candidates из формулировки `участник вправе представить`:

```text
L1: 2 optional candidates
L2: 1 optional candidate
```

Эти facts не доказывают обязательность и не должны становиться значением поля `required_official_certificates`.

#### Сомнительное обеспечение

L1 создал `participation_guarantee` со статусом `requires_review` из текста:

> При крайне неустойчивом финансовом состоянии участник допускается при условии предоставления обеспечения в соответствии с требованиями, указанными в п.п. 37, 38, 39 Блока 2.

Evidence не устанавливает, что это обеспечение заявки на участие. Candidate не является доказанным false-resolved, потому что модель поставила `requires_review`, но он создаёт лишний downstream candidate и риск ошибочного повышения статуса.

### 4.4. Reproducibility

Распределение facts:

| Field | L1 | L2 |
|---|---:|---:|
| `procurement_subject` | 1 | 1 |
| `application_documents` | 75 | 67 |
| `required_official_certificates` | 7 | 6 |
| `licenses_certificates` | 1 | 1 |
| `similar_supply_experience` | 1 | 1 |
| `evaluation_criteria` | 2 | 1 |
| `participation_guarantee` | 1 | 0 |

Сравнение двух low samples:

```text
exact evidence-signature overlap:
44 common из 121 union
Jaccard = 0.364

exact normalized value-signature overlap:
12 common из 153 union
Jaccard = 0.078

application_documents source-block coverage:
Jaccard = 0.756
```

Низкое совпадение exact signatures частично объясняется разным разбиением composite facts и различной формулировкой `value_text`. Поэтому оно не доказывает само по себе пропуск обязательных документов. Однако разница `88 → 77` facts, `75 → 67` application-document facts и различный набор охваченных source blocks показывают слабую воспроизводимость.

## 5. Сравнение с текущим GLM 5.3 Flash low baseline

| Метрика | GLM 5.3 Flash low | GLM 5.2 low | Сравнение |
|---|---:|---:|---|
| Samples | 2 | 2 | одинаково |
| AI time | 83.684 s | 104.253 s | GLM 5.2 примерно на 25% медленнее |
| Raw facts | 67.5 | 82.5 | больше facts, но без доказанного роста полезного recall |
| Evidence pass | 14/16 | 15/16 | GLM 5.2 лучше на 1 unit |
| Observed cost | 3.043308 RUB | 15.541555 RUB | GLM 5.2 примерно в 5.1 раза дороже |
| Samples с false `evaluation_criteria` | 1/2 | 2/2 | GLM 5.2 хуже |
| Всего false `evaluation_criteria` | 1 | 3 | GLM 5.2 хуже |

GLM 5.2 дал небольшое улучшение first-pass exact evidence, но оно не компенсирует:

- более высокую latency;
- стоимость;
- semantic false positives;
- нестабильность набора facts;
- отсутствие преимуществ по основным business fields.

## 6. Provider and audit boundary

В сохранённых AI responses наблюдается:

```text
response.model = z-ai/glm-5.2
response.provider = openrouter
```

Execution payload, доступный через MCP, не сохраняет отдельный надёжный per-execution request alias для всех семи запусков. Поэтому отчёт подтверждает фактическую response model, но не объявляет independently verified конкретный provider pin.

Отдельно остаётся известный audit defect Document Worker: checker исторически записывает статический `extractor.provider="deepseek"`. Это поле нельзя использовать как доказательство фактического provider для данного A/B-теста.

## 7. Verdict

### GLM 5.2 без reasoning

**REJECT.**

Режим не обеспечивает обязательный JSON contract и показал плохую transport stability и semantic precision.

### GLM 5.2 low

**REJECT как production Extractor и как замена GLM 5.3 Flash low.**

Low технически существенно лучше режима без reasoning:

- strict JSON 32/32;
- checker исполнился для всех units;
- 30/32 units прошли first-pass evidence.

Но production decision отрицательный:

- примерно ×5.1 observed cost относительно GLM 5.3 Flash low;
- примерно +25% latency;
- false `evaluation_criteria` в 2/2 samples;
- optional certificates ошибочно становятся required candidates;
- лишний ambiguous guarantee candidate;
- слабая reproducibility.

Дополнительные повторы GLM 5.2 на этом fixture не требуются: они вряд ли изменят решение о модели и приведут только к дополнительным затратам.

## 8. Следующий минимальный шаг

Продолжить A/B на тех же 16 pinned units, не меняя:

- Extractor prompt;
- `max_tokens`;
- resource limits;
- deterministic checker;
- source pin data.

Следующий дешёвый candidate — один пробный запуск DeepSeek V4 Flash 0731 с low reasoning. При provider/availability failure не повторять серию многократно, а перейти к GPT-5 Mini.

Критерии stop/go следующей модели:

1. strict schema 16/16;
2. first-pass evidence не хуже 15/16;
3. корректный `procurement_subject`;
4. сохранение явных отрицательных licenses/experience facts;
5. zero false `evaluation_criteria`;
6. отсутствие optional-as-required certificates;
7. отсутствие необоснованных guarantee candidates;
8. приемлемая latency и фактическая стоимость.

Этот отчёт не изменяет production decision и не подтверждает корректность полного Document Worker, AI Validator, Aggregator или итоговых 27 полей.
