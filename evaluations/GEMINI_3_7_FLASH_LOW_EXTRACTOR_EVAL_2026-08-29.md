# Gemini 3.7 Flash — Extractor low evaluation

**Дата:** 2026-08-29
**Workflow:** `[3 TEST] TENDER — Обработать документ` (`2T7szFpiGcfNpKkB`)
**Документ:** `Блок_9_Требования.docx`
**Набор:** одинаковые 16 pinned analysis units (`doc_11_au_0001`–`doc_11_au_0016`)
**Request alias:** `google/gemini-3.7-flash@provider=google-ai-studio/flex&reasoning_effort=low`
**Response model:** `google/gemini-3.7-flash`

## 1. Границы проверки

Проверялись только четыре реально исполненные ноды:

```text
When clicking ‘Execute workflow’
→ Подготовить запрос для AI
→ AI Extractor v1.0
→ Проверить и привязать evidence
```

Evidence Repair, AI Validator, persistence, Aggregator и production workflows не запускались. Статус n8n `success` здесь означает успешное завершение этого ручного частичного запуска, а не успешное завершение полного Document Worker.

Источники:

- live execution data n8n;
- raw response ID, model/provider и usage каждого item;
- deterministic evidence checker output;
- `FIELD_CATALOG.md` как authoritative источник смысла полей.

## 2. Классификация executions

| Execution | Конфигурация | Результат | Классификация |
|---|---|---|---|
| `14129` | Gemini, `reasoning_effort=none` | HTTP 400: `Reasoning is mandatory for this endpoint and cannot be disabled.` | configuration failure; не model sample |
| `14130` | Gemini, `reasoning_effort=low` | 16 responses, checker завершён | независимый sample G1 |
| `14131` | Gemini, `reasoning_effort=low` | 16 responses, checker завершён | независимый sample G2 |

G1 и G2 имеют полностью разные наборы из 16 response ID. Cached/manual rerun среди них отсутствует.

## 3. Технические метрики

| Sample | Execution | AI time, s | Facts | Empty units | Schema/JSON | Evidence pass | Verified facts | Violations | Reasoning tokens | Total tokens | Cached prompt | Cost, RUB |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|
| G1 | `14130` | 15.139 | 62 | 0 | 16/16 | 16/16 | 62 | 0 | 4,360 | 175,071 | 0 | 14.005676 |
| G2 | `14131` | 23.086 | 65 | 1 | 16/16 | 15/16 | 64 | `missing_primary_evidence` + `quote_not_found` для одного fact | 3,876 | 176,454 | 52,624 | 12.202461 |

Среднее по двум независимым samples:

```text
AI time:          19.113 s
facts:            63.5
empty units:       0.5
evidence pass:    15.5 / 16
verified facts:   63.0
reasoning tokens: 4,118
total tokens:     175,762.5
observed cost:    13.104069 RUB
```

Все 32 responses:

- завершились с `finish_reason=stop`;
- содержали parseable JSON;
- соблюдали top-level `ai_extractor_v1` contract;
- вернули правильные `analysis_unit_id`.

## 4. Что поймал deterministic checker

В G2 модель изменила одно слово внутри quote:

```text
source: актуальные (достоверные) сведения
quote:  актуальные (достоверных) сведения
```

Это не допустимая нормализация, а несуществующая в source подстрока. Checker корректно зарегистрировал для `doc_11_au_0006`, `fact_index=3`:

```text
quote_not_found
missing_primary_evidence
```

Fact не был принят в `verified_facts`. Ослаблять exact matching для такого случая нельзя.

G1 прошёл evidence layer полностью. Следовательно, Gemini low не гарантирует exact quoting, но текущая deterministic защита обнаруживает наблюдавшийся дефект.

## 5. Семантическая проверка

### `procurement_subject`

Оба samples корректно нашли:

```text
стандартные закрытия палуб для ледокола-лидера пр.10510 зав № 056001
```

Evidence exact-grounded в `sb_0003`.

### `evaluation_criteria`

По `FIELD_CATALOG.md` поле относится к критериям, весам, баллам и правилам оценки/сравнения заявок. Внутренняя qualification/due-diligence проверка участника не является этим полем.

| Sample | Candidates | Оценка |
|---|---:|---|
| G1 | 2 | оба false positive: пороги внутренней должной осмотрительности и банкротные risk scores |
| G2 | 1 | false positive: банкротные risk scores внутренней проверки |

Таким образом, ни один Gemini sample не прошёл эту semantic boundary чисто. Exact evidence не защищает от неправильного выбора `field_key`.

### `required_official_certificates`

Оба samples вернули как необходимую справку текст, где прямо сказано, что участник **вправе** дополнительно её представить. Это optional document, а не доказанное обязательное требование. Такой candidate создаёт риск false-resolved downstream.

В G2 модель дополнительно классифицировала финансовую отчётность как `required_official_certificates`; в G1 этого не было. Граница между официальными справками и обычными application documents нестабильна.

### `application_documents`

Количество близко:

```text
G1: 53
G2: 55
```

Однако структура заметно плавает: совпадает cardinality только 55 unit+field slots из 62/65, а по нескольким units различается разбиение требований.

Наиболее показателен `doc_11_au_0015`:

- G1 создал 3 facts по одним названиям форм;
- G2 вернул `facts=[]`;
- сами процитированные заголовки не содержат явного требования включить форму в заявку.

Поэтому G2 здесь выглядит консервативнее, но окончательный recall verdict требует annotated oracle по application documents. Само количество facts нельзя считать качеством.

## 6. Сравнение с GLM 5.3 Flash low

GLM baseline взят из `GLM_5_3_FLASH_REASONING_EVAL_2026-08-29.md` и включает два независимых low samples на тех же 16 units.

| Метрика | Gemini low | GLM low | Оценка |
|---|---:|---:|---|
| AI time | 19.113 s | 83.684 s | Gemini примерно в 4.38 раза быстрее |
| Facts | 63.5 | 67.5 | близко; не quality metric |
| Evidence pass | 15.5/16 | 14/16 | Gemini лучше на этом малом sample |
| Verified facts | 63.0 | 65.5 | близко |
| Reasoning tokens | 4,118 | 1,287.5 | Gemini примерно в 3.20 раза больше |
| Total tokens | 175,762.5 | 163,023 | Gemini примерно на 7.8% больше |
| Observed cost | 13.104069 RUB | 3.043308 RUB | Gemini примерно в 4.31 раза дороже |
| False `evaluation_criteria` | 2/2 samples | 1/2 samples | Gemini хуже |
| Correct `procurement_subject` | 2/2 | 2/2 | одинаково |

Gemini значительно быстрее, но его observed cost на этом batch существенно выше. На стоимость влияет cache: у Gemini было в среднем 26,312 cached prompt tokens, у GLM — 80,704. Поэтому это фактическая стоимость этих запусков, а не чистое сравнение тарифов моделей.

## 7. Provider и audit discrepancy

Три источника расходятся:

```text
request alias:              provider=google-ai-studio/flex
raw response.provider:      openrouter
extractor audit.provider:   deepseek
```

Последнее значение точно является устаревшим hard-coded audit metadata в checker и не соответствует использованной модели. Это не повлияло на fact validation, но нарушает audit trail и должно быть исправлено до promotion нового Extractor в production.

Raw `response.provider=openrouter` сам по себе не доказывает, что provider pin проигнорирован: это может быть обозначение промежуточного маршрута Polza. Фактический backend нельзя молча считать подтверждённым.

## 8. Verdict

**NEED MORE EVIDENCE; Gemini low пока не заменяет GLM low baseline.**

Плюсы Gemini:

- 2/2 полных schema-compliant batches;
- примерно в 4.4 раза быстрее;
- 31/32 units прошли first-pass exact evidence;
- оба раза корректно найден `procurement_subject`.

Блокирующие сомнения:

- false `evaluation_criteria` в 2/2 samples;
- optional справка ошибочно представлена как обязательная в 2/2 samples;
- один hallucinated quote;
- нестабильная классификация application documents;
- примерно в 4.3 раза выше observed cost;
- audit metadata ошибочно записывает provider=`deepseek`.

Gemini выглядит сильным кандидатом по latency и техническому compliance, но семантически пока не превосходит GLM low. До решения по production нужен следующий model sample либо одинаковый semantic oracle, а не ещё один повтор Gemini на том же документе.

## 9. Следующий шаг

Сохранить результаты как Gemini-low baseline и перейти к следующей модели на тех же 16 units, не меняя prompt, hard limits или checker. После 2 независимых samples сравнить:

1. schema compliance;
2. exact evidence;
3. false `evaluation_criteria`;
4. optional-vs-required document boundary;
5. latency и фактическую стоимость.

Отдельно, до production promotion любой выбранной модели, исправить model/provider audit в Extractor минимальным изменением и regression test.

Этот отчёт не изменяет production decision и не подтверждает корректность полного Document Worker или итоговых 27 полей.
