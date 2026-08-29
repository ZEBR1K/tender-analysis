# Extractor model comparison

**Дата:** 2026-08-29
**Workflow:** `[3 TEST] TENDER — Обработать документ` (`2T7szFpiGcfNpKkB`)
**Основной fixture:** `Блок_9_Требования.docx`
**Набор:** одинаковые 16 pinned analysis units (`doc_11_au_0001`–`doc_11_au_0016`)
**Приоритет сравнения:** reliability → correctness → cost/latency

## 1. Scope

Сравнение относится только к Extractor path:

```text
When clicking ‘Execute workflow’
→ Подготовить запрос для AI
→ AI Extractor v1.0
→ Проверить и привязать evidence
```

Не проверялись в одинаковом A/B-контракте:

- Evidence Repair;
- AI Validator;
- persistence;
- Aggregator;
- Targeted Recheck;
- итоговые 27 FINAL fields.

Поэтому этот файл выбирает кандидата для следующего полного canary, а не объявляет production Document Worker полностью подтверждённым.

Основные источники:

- отдельные отчёты в `evaluations/`;
- live execution data n8n;
- `FIELD_CATALOG.md` как authoritative источник семантики полей.

Для GPT-5 Mini использованы напрямую executions `14153` и `14154`, поскольку отдельный model report для него не создавался.

## 2. Сводная таблица low-конфигураций

| Модель | Независимые samples | Full contract | First-pass evidence | Correct procurement subject | Основные semantic failures | AI time, s | Observed cost, RUB | Решение |
|---|---:|---:|---:|---:|---|---:|---:|---|
| **GLM 5.3 Flash low** | 2 | **2/2** | 14/16 | **2/2** | 1 documented false `evaluation_criteria` | 83.684 | **3.043308** | **CURRENT BASELINE** |
| Gemini 3.7 Flash low | 2 | **2/2** | **15.5/16** | **2/2** | 3 false `evaluation_criteria`; optional-as-required в 2/2 | **19.113** | 13.104069 | резервный кандидат |
| GLM 5.2 low | 2 | **2/2** | 15/16 | **2/2** | 3 false `evaluation_criteria`; optional certificates; extra guarantee | 104.253 | 15.541555 | REJECT |
| GPT-5.6 Luna Pro low | 3 | **3/3** | 15.333/16 | **3/3** | **45 false `evaluation_criteria`** | 62.544 | 11.227706 | REJECT |
| GPT-5.4 Nano low | 2 | **1/2** | 11/16 в прошедшем sample | 1/2 | 61 false `evaluation_criteria`; 12 false `national_regime` | 46.594 | 3.551718 | REJECT |
| GPT-5 Mini low | 2 | **2/2** | **10/16** | 2/2 | 52 false `evaluation_criteria`; 14 false `national_regime`; wrong contacts/platform | 38.841 | 6.251863 | REJECT |

Примечания:

1. `Full contract` означает, что полный batch дошёл через обязательный Extractor JSON/schema contract. Это не означает semantic correctness.
2. Для GPT-5.4 Nano evidence rate нельзя усреднять как обычные два samples: первый batch остановлен hard schema error до evidence output.
3. Observed cost зависит от provider cache, tokenizer и routing. Это фактическая стоимость executions, а не чистое тарифное сравнение.
4. Большее количество raw facts не считается преимуществом без semantic precision и annotated recall oracle.

## 3. Остальные проверенные конфигурации

| Модель / режим | Технический результат | Semantic result | Решение |
|---|---|---|---|
| GLM 5.3 Flash high | только 2/3 schema-valid batches; около 14.5/16 evidence среди пригодных | чаще false `evaluation_criteria`; `procurement_subject` только 1/3 | REJECT |
| GLM 5.2 без reasoning | 0/2 полных batches прошли checker; Markdown fences; отдельные timeout/cancelled runs | 14 false `evaluation_criteria` в двух полных samples | REJECT |
| DeepSeek V4 Flash 0731 | 0/4 executions прошли; schema typos, Markdown fences, HTTP 429 | 28 false `evaluation_criteria` в трёх полных raw batches | REJECT |
| Qwen variants | provider/model availability не позволила получить пригодную серию | не оценено | исключён по availability |

## 4. Ranking по reliability-first приоритету

### 1. GLM 5.3 Flash low

Почему занимает первое место:

- 2/2 полных batches сохранили обязательный contract;
- корректный `procurement_subject` в 2/2;
- наименьший зафиксированный semantic overreach среди пригодных low-кандидатов;
- минимальная наблюдаемая стоимость среди пригодных low-кандидатов;
- нет доказанного преимущества high reasoning;
- ошибки exact evidence детерминированно обнаруживаются существующим checker.

Ограничения:

- 14/16 units проходят evidence с первой попытки, а не 16/16;
- один false `evaluation_criteria` в двух samples;
- variability raw facts `63–72`;
- recall application documents не измерен по annotated oracle;
- полный путь Repair → Validator не входил в A/B.

Verdict:

**ACCEPT как provisional Extractor baseline для следующего end-to-end canary.**

Это не означает автоматическую production promotion.

### 2. Gemini 3.7 Flash low

Сильные стороны:

- лучший first-pass evidence результат: 31/32 units;
- 2/2 schema-compliant batches;
- корректный предмет закупки;
- примерно в 4.4 раза быстрее GLM 5.3 low.

Почему не выбран default:

- примерно в 4.3 раза дороже по observed executions;
- false `evaluation_criteria` в 2/2;
- optional document ошибочно повышен до required в 2/2;
- один hallucinated exact quote;
- не доказано семантическое преимущество над GLM.

Verdict:

**KEEP AS FALLBACK.** Возвращаться к Gemini Extractor имеет смысл только если latency GLM окажется неприемлемой на полном 66-unit canary или если новый prompt/eval покажет явное semantic improvement.

### 3. GLM 5.2 low

Технически стабилен по schema и чуть лучше GLM 5.3 по first-pass evidence, но:

- примерно на 25% медленнее;
- примерно в 5.1 раза дороже;
- semantic boundary хуже;
- дополнительный useful recall не доказан.

Verdict:

**REJECT.** Размер модели сам по себе не дал практического преимущества.

### 4. GPT-5.6 Luna Pro low

Schema и evidence технически сильны, но модель систематически принимает qualification/due-diligence scoring за клиентские критерии оценки:

```text
45 false evaluation_criteria
3/3 samples
```

Verdict:

**REJECT.** Exact-grounded false facts опаснее небольшого технического evidence deficit, потому что способны пройти deterministic grounding.

### 5. GPT-5.4 Nano low

Преимущество:

- быстрее GLM 5.3;
- стоимость близка к GLM baseline.

Блокирующие проблемы:

- один hard contract failure из двух;
- только 11/16 evidence units в прошедшем sample;
- предмет закупки пропущен в одном sample;
- 61 false `evaluation_criteria`;
- 12 false `national_regime`;
- exact signature reproducibility ниже 11%.

Verdict:

**REJECT.**

### 6. GPT-5 Mini low

Live execution metrics:

| Execution | Facts | Evidence pass | Verified | Cost, RUB | AI time |
|---|---:|---:|---:|---:|---:|
| `14153` | 110 | 8/16 | 96 | 6.820000 | 38.735 s |
| `14154` | 130 | 12/16 | 122 | 5.683726 | 38.947 s |

Среднее:

```text
facts:          120
evidence pass:  10 / 16
cost:            6.251863 RUB
AI time:        38.841 s
```

Semantic failures:

- 52 false `evaluation_criteria`;
- 14 false `national_regime`;
- 3 supplier/participant contacts ошибочно отнесены к `customer_contacts`;
- сайт Картотеки арбитражных дел ошибочно отнесён к `platform`.

Verdict:

**REJECT.** Быстрая генерация большого количества facts не компенсирует низкую evidence и semantic precision.

### 7. DeepSeek V4 Flash 0731

Ни один из четырёх запусков не прошёл тестовый путь. Причины включали:

- разные schema typos;
- Markdown wrappers;
- HTTP 429;
- 28 false `evaluation_criteria` в raw outputs.

Verdict:

**REJECT по reliability, contract compliance и semantics.**

## 5. Общий технический вывод

### Reasoning level

Больше reasoning не улучшает Extractor автоматически.

На GLM 5.3 high:

- latency и observed cost выросли примерно на 62%;
- один из трёх batches массово нарушил schema;
- semantic overreach увеличился;
- `procurement_subject` стал менее стабильным.

Для текущего Extractor следует использовать `reasoning_effort=low`.

### Model size

Более крупная или дорогая модель также не гарантирует качество:

- GLM 5.2 дороже и медленнее GLM 5.3 Flash;
- Luna Pro хорошо копирует evidence, но систематически выбирает неверный `field_key`;
- GPT-5 Mini и Nano генерируют больше candidates, но резко повышают false-positive surface.

### Deterministic checker

Checker доказал ценность:

- отклонял schema-invalid outputs;
- ловил `quote_not_found`;
- ловил `missing_primary_evidence`;
- ловил `wrong_semantic_block_id`;
- ловил duplicate evidence;
- не маскировал provider/model failures.

Но exact grounding не может определить, правильно ли выбран `field_key`. Exact quote о due diligence остаётся exact, даже если модель ошибочно назвала её `evaluation_criteria`.

Поэтому semantic model comparison нельзя заменять только evidence pass rate.

## 6. Нужно ли продолжать искать модели

### Решение

**На текущем fixture поиск моделей остановить.**

Причины:

1. Уже проверены разные семейства и ценовые уровни.
2. Ни одна новая модель не превзошла GLM 5.3 low одновременно по reliability, semantic precision и cost.
3. Главная повторяющаяся ошибка — универсальная граница `evaluation_criteria`, а не недостаток размера модели.
4. Повторы на том же документе имеют уменьшающуюся диагностическую ценность.
5. Бизнес-цель требует полного корректного client run, а не бесконечного model benchmark.

Не нужно сейчас:

- искать ещё несколько моделей только ради расширения списка;
- тестировать high reasoning;
- ослаблять deterministic checker;
- выбирать модель только по latency или количеству facts.

## 7. Следующий шаг

Зафиксировать тестовую связку:

```text
Extractor:
z-ai/glm-5.3-flash
reasoning_effort=low

AI Validator:
текущая уже выбранная и усиленная конфигурация
```

Затем выполнить один полный Document Worker canary на документе из 16 units:

```text
Extractor
→ deterministic evidence
→ bounded repair
→ validation attempt 2
→ AI Validator
→ fact-local literal guard
→ document completeness
```

Проверить:

1. все 16 units учтены;
2. ни один unit не silent-dropped;
3. bounded repair обрабатывает observed exact-evidence failures;
4. false `evaluation_criteria` не становится `confirmed`;
5. корректный `procurement_subject` сохраняется;
6. explicit licenses/experience facts сохраняются;
7. validator linking и audit корректны;
8. document facts успешно сохраняются.

Если 16-unit canary проходит, следующий gate:

```text
66-unit document canary
→ full tender run
→ Aggregator
→ проверка 27/27 FINAL fields
```

Только если GLM 5.3 low провалит полный Worker canary по latency, availability или систематической семантике, следует вернуться к Gemini 3.7 Flash low как резервному Extractor candidate.

## 8. Final decision

```text
Current Extractor baseline:
GLM 5.3 Flash
reasoning_effort=low

Model search on current fixture:
STOP

Production promotion:
NOT YET VERIFIED

Next gate:
full 16-unit Document Worker runtime canary
```

Этот выбор минимизирует риск и прекращает model churn, но сохраняет обязательный runtime gate перед production.
