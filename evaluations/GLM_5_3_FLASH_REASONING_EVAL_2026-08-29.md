# GLM 5.3 Flash — Extractor reasoning evaluation

**Дата:** 2026-08-29
**Workflow:** `[3 TEST] TENDER — Обработать документ` (`2T7szFpiGcfNpKkB`)
**Документ:** `Блок_9_Требования.docx`
**Набор:** одни и те же 16 pinned analysis units (`doc_11_au_0001`–`doc_11_au_0016`)
**Модель в request alias:** `z-ai/glm-5.3-flash@provider=cloudflare`
**Проверяемая переменная:** `reasoning_effort=low` против `reasoning_effort=high`

## 1. Границы проверки

Проверялись только:

```text
AI Extractor v1.0
→ Проверить и привязать evidence
```

Validator, Evidence Repair, PostgreSQL persistence, Aggregator и production workflows не запускались.

Источники данных:

- live execution data n8n;
- raw provider response ID и `usage` каждого из 16 items;
- output deterministic evidence checker;
- `FIELD_CATALOG.md` как authoritative источник семантики полей.

Количество извлечённых facts не считается самостоятельной метрикой качества: больше facts может означать как лучший recall, так и больше false positives.

## 2. Классификация последних восьми executions

| Execution | Effort | Классификация | Основание |
|---|---|---|---|
| `14116` | low | исключён | отменён вручную; завершённого run data нет |
| `14117` | low | уникальный provider-вызов L1 | новый набор из 16 response ID |
| `14118` | low | повтор L1 | response ID и content hash полностью совпадают с `14117`; длительность execution около 1 секунды |
| `14119` | low | уникальный provider-вызов L2 | новый набор из 16 response ID |
| `14123` | high | уникальный provider-вызов H1 | новый набор из 16 response ID |
| `14124` | high | уникальный provider-вызов H2 | новый набор из 16 response ID; checker hard error |
| `14125` | high | повтор H2 | response ID и content hash полностью совпадают с `14124`; длительность execution около 1 секунды |
| `14126` | high | уникальный provider-вызов H3 | новый набор из 16 response ID |

Итого в последних восьми executions:

```text
2 уникальных low
3 уникальных high
2 cached checker rerun
1 cancelled execution
```

## 3. Метрики уникальных provider-вызовов

| Sample | Execution | AI time, s | Facts | Empty units | Correct JSON | Evidence pass | Verified facts | Violations | Reasoning tokens | Total tokens | Cached prompt tokens | Cost, RUB |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|
| L1 | `14117` | 85.434 | 72 | 2 | 16/16 | 14/16 | 70 | 2 × `quote_not_found` | 1,435 | 163,978 | 35,200 | 3.749256 |
| L2 | `14119` | 81.934 | 63 | 2 | 16/16 | 14/16 | 61 | 1 × `quote_not_found`; 1 × `wrong_semantic_block_id` | 1,140 | 162,068 | 126,208 | 2.337359 |
| H1 | `14123` | 152.810 | 75 | 0 | 16/16 | 15/16 | 74 | 1 × `quote_not_found` | 26,848 | 188,791 | 17,984 | 5.469839 |
| H2 | `14124` | 120.096 | 79 raw | 3 raw | **4/16** | not reached | 0 | hard schema error | 23,083 | 182,965 | 61,504 | 4.502645 |
| H3 | `14126` | 118.778 | 69 | 3 | 16/16 | 14/16 | 67 | 2 × `quote_not_found` | 22,463 | 180,885 | 61,504 | 4.379003 |

Во всех пяти уникальных вызовах:

- `prompt_tokens = 132,082`;
- 16/16 responses имели `finish_reason=stop`;
- JSON content был синтаксически parseable;
- response model был `z-ai/glm-5.3-flash`.

`Correct JSON` в таблице означает не только синтаксический JSON, но и наличие обязательного top-level контракта `ai_extractor_v1`.

### Усреднение

| Метрика | Low, 2 samples | High, все 3 samples | High, только 2 schema-valid samples |
|---|---:|---:|---:|
| AI time | 83.684 s | 130.561 s | 135.794 s |
| Raw facts | 67.5 | 74.3 | 72.0 |
| Verified facts | 65.5 | неприменимо из-за H2 | 70.5 |
| Reasoning tokens | 1,287.5 | 24,131.3 | 24,655.5 |
| Total tokens | 163,023 | 184,213.7 | 184,838 |
| Observed cost | 3.043308 RUB | 4.783829 RUB | 4.924421 RUB |

Для двух пригодных high samples относительно low:

```text
latency:        +62%
observed cost:  +62%
reasoning:      примерно ×19
verified facts: +7.6%
```

Стоимость заметно зависит от provider cache. Например, L2 получил `126,208` cached prompt tokens и поэтому оказался значительно дешевле L1 при одинаковом prompt size. Поэтому observed cost нельзя интерпретировать как чистый эффект reasoning level.

Суммарная зафиксированная стоимость пяти уникальных завершённых вызовов: `20.438102 RUB`. Возможная стоимость отменённого `14116` в execution data не зафиксирована. Cached reruns `14118` и `14125` не считаются новыми provider-вызовами.

## 4. H2: почему checker остановил high execution

Execution `14124` не прошёл не из-за обычного evidence mismatch.

Фактическая ошибка:

```text
[Evidence validator] Неверный field_catalog_version. [line 39]
```

Только 4 из 16 AI responses содержали полный правильный top-level контракт:

```json
{
  "schema_version": "ai_extractor_v1",
  "field_catalog_version": "tender_fields_v1",
  "analysis_unit_id": "...",
  "facts": []
}
```

В остальных 12 responses модель в разных комбинациях:

- пропустила `field_catalog_version`;
- пропустила `schema_version`;
- пропустила `analysis_unit_id`;
- использовала `schema` вместо `schema_version`;
- использовала `unit_id` вместо `analysis_unit_id`;
- иногда вернула только `facts`.

Это LLM contract-compliance failure. Deterministic checker сработал правильно: остановил malformed batch до Evidence Repair, Validator и persistence. Ослаблять этот guard нельзя.

Повторный execution `14125` использовал те же response ID и закономерно воспроизвёл ту же ошибку; это не независимый model sample.

## 5. Semantic quality

### `evaluation_criteria`

`FIELD_CATALOG.md` определяет поле как:

> критерии, показатели, веса, баллы и правила оценки/сравнения заявок;

и прямо запрещает путать его с обязательными требованиями к участнику.

Наблюдение:

| Sample | `evaluation_criteria` candidates | Оценка |
|---|---:|---|
| L1 | 0 | корректно для этого документа |
| L2 | 1 | false positive: оценка финансовой устойчивости участника в рамках qualification/due diligence |
| H1 | 1 | false positive: баллы внутренней проверки должной осмотрительности, а не сравнение заявок |
| H2 | 1 | raw false positive; batch всё равно непригоден из-за schema failure |
| H3 | 3 | false positives: финансовая устойчивость и её внутренняя методика |

High reasoning не улучшил semantic boundary. Напротив, он чаще интерпретировал внутреннюю квалификационную оценку участника как клиентское поле `evaluation_criteria`.

### `procurement_subject`

| Sample | Candidate найден |
|---|---|
| L1 | да |
| L2 | да |
| H1 | да |
| H2 | нет в raw output |
| H3 | нет |

High reasoning не дал стабильного преимущества по основному предмету закупки: два из трёх high samples его пропустили.

### Application documents и qualification facts

High обычно возвращал больше `application_documents`:

```text
L1 61
L2 55
H1 65
H2 58 raw
H3 59
```

Однако ручной смысловой просмотр показывает одновременно более агрессивную классификацию соседних qualification/due-diligence правил. Поэтому увеличение количества candidates нельзя считать доказанным ростом полезного recall без отдельного annotated oracle по каждому документу.

## 6. Deterministic evidence layer

Deterministic validation не была ослаблена и корректно обнаружила:

- неточные quote (`quote_not_found`);
- ошибочную привязку к semantic block (`wrong_semantic_block_id`);
- malformed top-level Extractor contract до fact-level validation.

Schema-valid high дал только небольшое улучшение среднего unit pass rate:

```text
low:  14.0 / 16
high: 14.5 / 16
```

Это улучшение слишком мало, чтобы компенсировать schema instability, semantic false positives, latency и стоимость.

## 7. Provider discrepancy

Источники расходятся:

```text
request alias:     @provider=cloudflare
response.provider: openrouter
```

Расхождение наблюдается во всех пяти уникальных вызовах. Поэтому результаты достоверно относятся к response model `z-ai/glm-5.3-flash`, но execution data не подтверждает, что фактический model provider был Cloudflare. До отдельной проверки нельзя молча считать alias pin выполненным.

## 8. Verdict

Read-back после эксперимента показывает ещё одно ожидаемое test/local расхождение:

```text
live test draft 2T7szFpiGcfNpKkB:
reasoning_effort=high
version ab7f4e87-626d-426c-8605-8822f141bfe5
active=false

local beta/canonical Extractor baseline:
reasoning_effort=low
```

Это следствие последнего ручного A/B-запуска, а не production change. Перед продолжением тестов GLM test workflow следует вернуть на `low` либо явно сменить на конфигурацию следующей модели.

### GLM 5.3 Flash `low`

**ACCEPT как текущий A/B baseline**, но не как окончательно выбранный production Extractor.

Плюсы:

- 2/2 samples сохранили полный top-level contract;
- существенно быстрее и дешевле;
- меньше semantic overreach;
- стабильно находил `procurement_subject`.

Открытые проблемы:

- variability facts `63–72`;
- два evidence-invalid units в каждом sample;
- один false `evaluation_criteria` в L2;
- recall ещё не измерен по annotated ground truth.

### GLM 5.3 Flash `high`

**REJECT как default Extractor configuration для текущего MVP.**

Причины:

- 1 из 3 уникальных samples массово нарушил обязательную JSON-схему;
- примерно на 62% медленнее и дороже среди schema-valid samples;
- около ×19 reasoning tokens;
- чаще создаёт false `evaluation_criteria`;
- не обеспечивает стабильное извлечение `procurement_subject`;
- evidence pass улучшился лишь на 0.5 unit из 16 в среднем.

## 9. Следующий минимальный шаг

Сохранить `low` как GLM baseline и сравнивать следующие модели на тех же 16 units с тем же prompt, hard limits и deterministic checker.

Для выбора production Extractor нужны как минимум:

1. одинаковый fixture и независимые response ID;
2. schema compliance 16/16;
3. exact evidence pass;
4. semantic oracle для non-`application_documents` fields;
5. отдельная оценка recall по application documents;
6. затем canary на более крупном наборе 66 units.

Этот отчёт не изменяет production decision и не является доказательством корректности полного Document Worker или итоговых 27 полей.
