# GPT-5.6 Luna Pro — Extractor low evaluation

**Дата:** 2026-08-29
**Workflow:** `[3 TEST] TENDER — Обработать документ` (`2T7szFpiGcfNpKkB`)
**Документ:** `Блок_9_Требования.docx`
**Набор:** одинаковые 16 pinned analysis units (`doc_11_au_0001`–`doc_11_au_0016`)
**Request alias:** `openai/gpt-5.6-luna-pro@provider=openai/flex&reasoning_effort=low`
**Response model:** `openai/gpt-5.6-luna-pro`

## 1. Границы проверки

Во всех трёх executions реально исполнились только:

```text
When clicking ‘Execute workflow’
→ Подготовить запрос для AI
→ AI Extractor v1.0
→ Проверить и привязать evidence
```

Evidence Repair, AI Validator, persistence, Aggregator и production workflows не запускались. Статус n8n `success` относится к ручному частичному запуску и не подтверждает полный Document Worker.

Источники:

- live execution data n8n;
- raw response ID, provider/model и usage каждого item;
- deterministic evidence checker output;
- `FIELD_CATALOG.md` как authoritative semantic source.

## 2. Независимость samples

| Sample | Execution | Начало UTC | Классификация |
|---|---:|---|---|
| P1 | `14132` | `2026-08-29T11:16:14.610Z` | независимый provider sample |
| P2 | `14133` | `2026-08-29T11:18:19.712Z` | независимый provider sample |
| P3 | `14134` | `2026-08-29T11:19:36.336Z` | независимый provider sample |

Все три набора содержат по 16 различных response ID. Cached/manual rerun среди них отсутствует.

## 3. Технические метрики

| Sample | AI time, s | Facts | Empty units | Schema/JSON | Evidence pass | Verified facts | Violations | Reasoning tokens | Total tokens | Cached prompt | Cost, RUB |
|---|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|
| P1 / `14132` | 63.958 | 96 | 0 | 16/16 | 14/16 | 94 | 2 × `quote_not_found` | 15,141 | 745,155 | 292,089 | 11.896878 |
| P2 / `14133` | 63.386 | 93 | 0 | 16/16 | 16/16 | 93 | 0 | 14,819 | 742,799 | 379,287 | 10.780613 |
| P3 / `14134` | 60.289 | 93 | 0 | 16/16 | 16/16 | 93 | 0 | 13,883 | 748,674 | 377,955 | 11.005628 |

Среднее по трём независимым samples:

```text
AI time:          62.544 s
facts:            94.0
empty units:       0
evidence pass:    15.333 / 16
verified facts:   93.333
reasoning tokens: 14,614.3
prompt tokens:    643,631
total tokens:     745,542.7
cached prompt:    349,777
observed cost:    11.227706 RUB
```

Все 48 responses:

- завершились с `finish_reason=stop`;
- были parseable JSON;
- соблюдали `schema_version=ai_extractor_v1`;
- соблюдали `field_catalog_version=tender_fields_v1`;
- вернули корректный `analysis_unit_id`.

По schema compliance Luna Pro стабильна.

## 4. Evidence failures P1

Deterministic checker правильно остановил два неточных facts.

### `doc_11_au_0002`, licenses

Модель изменила регистр заголовка таблицы:

```text
source: ТРЕБОВАНИЯ К НАЛИЧИЮ РАЗРЕШЕНИЙ ...
quote:  Требования к наличию разрешений ...
```

Это не дословная подстрока source, поэтому `quote_not_found` корректен.

### `doc_11_au_0004`, evaluation criteria candidate

Модель объединила значения четырёх строк таблицы в одну quote, удалив промежуточные `Строка Rn:`. Даже после разрешённого удаления coordinate markers `[C2]` такой quote не существует как непрерывная подстрока source.

Ослаблять exact evidence matching для обоих случаев нельзя.

## 5. Semantic quality

### `procurement_subject`

Все 3/3 samples правильно нашли:

```text
стандартные закрытия палуб для ледокола-лидера пр.10510 зав № 056001
```

Evidence exact-grounded в `sb_0003`.

### Критический дефект: `evaluation_criteria`

`FIELD_CATALOG.md` определяет это поле как критерии, показатели, веса, баллы и правила оценки или сравнения **заявок**. Требования допуска, квалификации и внутренней due-diligence проверки поставщика сюда не относятся, даже если используют баллы и пороги.

Фактический результат:

| Sample | `evaluation_criteria` facts | Semantic verdict |
|---|---:|---|
| P1 | 11 | 11 false positives |
| P2 | 15 | 15 false positives |
| P3 | 19 | 19 false positives |

Всего: **45/45 false positives**.

Модель классифицировала как клиентские критерии оценки:

- финансовую устойчивость участника;
- внутренние risk scores должной осмотрительности;
- наличие судимостей и административной ответственности;
- массовый адрес;
- срок существования организации;
- численность персонала;
- задолженность и банкротные признаки.

В P2 Luna пошла ещё шире и назвала `evaluation_criteria` даже требования об отсутствии судимостей без scoring. Значения возвращались преимущественно как `found` с confidence `0.98–0.99`, поэтому downstream получает уверенные, exact-grounded, но семантически неверные candidates.

Это прямой риск false-resolved, если независимый Validator или Aggregator повторит ту же ошибку.

### Explicit negative facts

P1 и P3 корректно нашли прямые утверждения:

```text
licenses/permissions: не установлено, не требуется
similar supply experience: не установлено, не требуется
```

P2 пропустил оба explicit negative facts и вернул только два требования к разрешениям нерезидентов. Это recall instability.

### `required_official_certificates`

Все три samples вернули только обязательную налоговую справку из `doc_11_au_0010`. В отличие от Gemini low, Luna не повысила optional формулировку «вправе дополнительно представить» до обязательной справки. Здесь Luna точнее.

### `application_documents`

```text
P1: 79
P2: 74
P3: 68
```

Luna обычно сохраняет больше деталей форм и условных требований, чем GLM/Gemini. Некоторые candidates выглядят полезными, например состав сведений о цепочке собственников и согласие на обработку персональных данных.

Но стабильность разбиения низкая:

- `doc_11_au_0002`: `10 / 4 / 4` facts;
- `doc_11_au_0011`: `5 / 9 / 5`;
- `doc_11_au_0015`: `8 / 4 / 5`.

Только два `unit + field + normalized value_text` facts совпали дословно по смысловой формулировке во всех трёх samples. Это не доказывает плохую семантику само по себе, но показывает сильную variability формулировок и granularity.

Без annotated application-document oracle большее число facts нельзя считать лучшим recall.

## 6. Сравнение low configurations

| Метрика | GLM 5.3 Flash | Gemini 3.7 Flash | GPT-5.6 Luna Pro |
|---|---:|---:|---:|
| Samples | 2 | 2 | 3 |
| AI time | 83.684 s | 19.113 s | 62.544 s |
| Facts | 67.5 | 63.5 | 94.0 |
| Evidence pass | 14/16 | 15.5/16 | 15.333/16 |
| Verified facts | 65.5 | 63.0 | 93.333 |
| Reasoning tokens | 1,287.5 | 4,118 | 14,614.3 |
| Total tokens | 163,023 | 175,762.5 | 745,542.7 |
| Observed cost | 3.043308 RUB | 13.104069 RUB | 11.227706 RUB |
| Samples with false `evaluation_criteria` | 1/2 | 2/2 | **3/3** |
| Total false `evaluation_criteria` | 1 | 3 | **45** |
| Correct `procurement_subject` | 2/2 | 2/2 | 3/3 |

Практический вывод:

- Luna примерно на 25% быстрее GLM, но в 3.69 раза дороже;
- Luna примерно в 3.27 раза медленнее Gemini, но на 14% дешевле по observed cost;
- технический evidence pass Luna хороший;
- semantic precision по `evaluation_criteria` несопоставимо хуже обеих альтернатив.

Объём токенов нельзя напрямую сравнивать как объём одного и того же текста: у моделей различаются tokenizer и provider usage semantics. Стоимость в таблице — фактическое `cost_rub` этих executions.

## 7. Prompt boundary

Наблюдение показывает не только модельную ошибку, но и общий prompt gap. Текущая краткая Extractor-инструкция для `evaluation_criteria` говорит про критерии, веса и порядок оценки, но не формулирует достаточный универсальный запрет на:

```text
qualification / admission / compliance / due-diligence criteria
```

GLM и Gemini тоже иногда ошибались на этой границе, а Luna систематически выбрала поверхностный сигнал «есть баллы/критерий». Это универсальная проблема semantic boundary, а не исключение конкретного документа.

Workflow в рамках evaluation не изменялся. Усиление prompt должно быть отдельной задачей с model-neutral regression oracle.

## 8. Provider и audit discrepancy

Источники расходятся:

```text
request alias:             provider=openai/flex
raw response.provider:     openrouter
extractor audit.provider:  deepseek
```

`extractor.provider=deepseek` — доказанно устаревшее hard-coded значение checker, не соответствующее response model Luna. Оно не меняет fact validation, но нарушает audit trail и должно быть исправлено до production promotion выбранной модели.

Raw `response.provider=openrouter` может обозначать промежуточный маршрут Polza и сам по себе не доказывает, что provider pin был проигнорирован.

## 9. Verdict

**REJECT GPT-5.6 Luna Pro как default Extractor для текущего prompt.**

Положительное:

- 48/48 schema-compliant responses;
- 46/48 units прошли exact evidence с первой попытки;
- правильный `procurement_subject` в 3/3;
- хорошая детализация application documents;
- optional налоговая справка не была ошибочно названа обязательной.

Причины отклонения:

- 45 false `evaluation_criteria` в трёх samples;
- почти все они `found` с confidence `0.98–0.99`;
- 2 exact quote failures;
- пропуск explicit negative facts в P2;
- сильная variability granularity `application_documents`;
- примерно в 3.69 раза дороже GLM low.

Downstream AI Validator в этих tests не запускался, поэтому отчёт не утверждает, что все 45 candidates дошли бы до Aggregator. Но выбирать более шумный Extractor в надежде, что следующий AI исправит систематическую ошибку, противоречит reliability-first архитектуре.

## 10. Следующий шаг

Не выполнять дополнительные Luna repeats на этом документе. Они уже доказали стабильную schema compliance и воспроизводимую semantic failure.

Следующий model comparison следует проводить на тех же 16 units без изменения prompt/checker. Отдельно после завершения model shortlist подготовить model-neutral RED для границы:

```text
bid/application evaluation
vs
qualification, admission, compliance and due diligence
```

и только затем решать, нужен ли универсальный prompt diff.

Этот отчёт не изменяет production decision и не подтверждает корректность полного Document Worker или итоговых 27 полей.
