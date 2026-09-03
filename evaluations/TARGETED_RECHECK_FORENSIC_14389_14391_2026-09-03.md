# Targeted Recheck forensic report — executions 14389–14391

**Дата:** 2026-09-03  
**Статус:** read-only owner-supplied runtime evidence / sanitized  
**Scope:** parent `14389`, Aggregator `14390`, Targeted Recheck `14391`

## 1. Граница доказательств

Этот отчёт фиксирует переданный владельцем read-only forensic package. Live n8n и PostgreSQL повторно не запрашивались; executions не перезапускались. Выводы по `14386/14387` приняты как owner-supplied факт без повторного аудита.

Не сохранены client payload, исходный клиентский текст таблицы, `analysis_run_id`, fact UUID, provider response ID, credentials или URLs. Текстовый пример ниже — синтетическая структурная реконструкция класса ошибки, а не цитата из документа клиента.

## 2. Runtime chain

| Execution | Workflow | Mode | Result | Retry |
|---:|---|---|---|---:|
| `14389` | parent `DJtWSqTcUmQo0xWv` | manual | error | 0 |
| `14390` | Aggregator `iLt7wLLfueg8qffZ` | integrated | error | 0 |
| `14391` | Targeted Recheck `9uDOU31DGo30fGXX` | integrated | error | 0 |

Runtime chain:

```text
14389 parent
→ 14390 Aggregator
→ atomic claim ready_for_aggregation → aggregating
→ 14391 Targeted Recheck
→ first failure in Проверить #2 evidence Targeted Recheck
→ no downstream FINAL path
```

## 3. Aggregator `14390`

До запуска Targeted Recheck execution подтвердил:

| Metric | Value |
|---|---:|
| completed documents loaded | 1 |
| persisted facts loaded | 84 |
| persisted analysis units loaded | 28 |
| grouped fields | 27 |
| fields with candidates | 10 |
| fields without candidates | 17 |
| Round 1 AI calls | 10 / 10 |
| Round 1 `requires_recheck` | 9 |
| Round 1 `resolved` | 1 (`evaluation_criteria`) |

Atomic claim write succeeded and changed the run from `ready_for_aggregation` to `aggregating`. Aggregator FINAL UPSERT, TenderMeta no-candidate path and Finalization did not execute. Поэтому `run.status=aggregating` после сбоя является inference из runData и отсутствия последующего transition, а не результатом отдельного DB `SELECT`.

## 4. Targeted Recheck `14391`

Retrieval и prompt preparation завершились для всех `9` items. `#2 AI Targeted Recheck v1` вернул `9/9` структурно корректных ответов. Первый failure появился на item `6/9` в deterministic evidence validator.

| Field | AI outcome | Candidates |
|---|---|---:|
| `platform` | `insufficient_evidence` | 0 |
| `customer_contacts` | `insufficient_evidence` | 0 |
| `participation_guarantee` | `candidate_found` | 2 |
| `payment_terms` | `insufficient_evidence` | 0 |
| `rebidding` | `candidate_found` | 1 |
| `national_regime` | `candidate_found` | 1 |
| `advance_contract_guarantee` | `candidate_found` | 1 |
| `licenses_certificates` | `candidate_found` | 1 |
| `application_documents` | `candidate_found` | 4 |

AI totals:

```text
calls = 9
prompt_tokens = 170873
completion_tokens = 10448
total_tokens = 181321
```

Execution выполнил только два PostgreSQL read node и не выполнял DB write. Downstream AI Validator, Round 2, FINAL UPSERT и Finalization: `0` runs. В цепочке создано `0` FINAL results.

## 5. Exact failure class

Первый failure:

```text
node = Проверить #2 evidence Targeted Recheck
line = 458
item = 6/9
field_index = 20
field_key = advance_contract_guarantee
analysis_unit_id = doc_3_au_0024
semantic_block_id = sb_0459
recheck_attempt = 1
existing_candidates = 13
allowed_semantic_blocks = 51
AI outcome = candidate_found
AI candidates = 1
candidate status = requires_review
review_reason_code = ambiguous_scope
evidence = 12
```

Exact error class/message:

```text
[Targeted Recheck Evidence Validator] candidate[0].evidence[1]: quote отсутствует в semantic block после нормализации пробелов
```

### Sanitized structural reconstruction

`sb_0459` содержал table header, промежуточные cells и четыре отдельные строки с labels `Строка R2`, `Строка R3`, `Строка R4`, `Строка R5`. AI собрал один `evidence.quote` из header и четырёх удалённых друг от друга row fragments, пропустив промежуточные cells и row labels.

Синтетический эквивалент класса ошибки:

```text
source semantic block:
Условия обеспечения | Применимость: выбрать один вариант |
Строка R2 | Вариант A | промежуточное условие A |
Строка R3 | Вариант B | промежуточное условие B |
Строка R4 | Вариант C | промежуточное условие C |
Строка R5 | Вариант D | промежуточное условие D

invalid stitched quote:
Условия обеспечения Вариант A Вариант B Вариант C Вариант D
```

Каждый fragment существует отдельно, но combined quote не является одной непрерывной подстрокой `sb_0459`. `evidence[2]` повторял тот же defect на другом table block.

Root cause boundary:

```text
retrieval/full semantic block correct
→ first incorrect state: #2 AI Targeted Recheck v1 stitched noncontiguous table fragments
→ deterministic validator correctly rejected the quote
```

Evidence Validator менять или ослаблять нельзя.

## 6. Workflow drift at forensic checkpoint

### Aggregator

Owner-supplied live read-back:

```text
live active nodes = 24
versionId = activeVersionId = 89b33d04-8fd2-4efa-b363-8ba7b9263d46
sameAsDraft = true
```

Local canonical export содержит `38` nodes и version `1c9019de-…`. Предыдущее описание `active=38 / 24-node unpublished draft` устарело: live 24-node graph уже active.

### Targeted Recheck

Owner-supplied live read-back:

```text
live active nodes = 64
live version = 4e0858c9-6ca2-42c7-969b-e74a2f91b8c6
owner comparison local core nodes = 63
local version = 7f82ae43-2ddc-4568-8d76-a6d460c13924
```

Owner comparison классифицировал одну disconnected test-validator node как live-only. Main live evidence validator удаляет table-coordinate markers `[C…]` перед exact containment, а local comparison использовал whitespace-only normalization. Этот drift не объясняет failure: stitched quote пропускал содержательные промежуточные cells/labels и не является continuous substring при обеих normalization semantics.

Прямой parse repository export на base commit показывает `64` JSON nodes, хотя owner comparison сообщает `63` local core nodes. Поэтому node-count convention явно зафиксирован как расхождение; version drift и различие main validator semantics не скрываются. Для локального изменения authoritative остаётся repository JSON, для live runtime — owner-supplied read-back.

## 7. Связанный DW-21 owner handoff

DW-21 implementation сделан пользователем вне текущей Git branch и здесь недоступен. Выводы `14386/14387` не переаудировались:

- `14386`: Docling PASS; `28/28` primary responses contract-valid; третий Evidence Repair получил `429`.
- `14387`: Docling PASS; primary `6/28`, fallback `22/28`; четвёртый fallback получил `429`.
- ActiveX state для `national_regime` прошёл: `290` controls = `38 selected / 88 unselected / 164 unknown`, `126` reliable; critical group содержал три unselected alternatives и selected `Не применимо`; grounded fact сформирован.
- overall semantic mapping остался partial/unknown: `51 exact / 189 missing_owner / 50 conflicting`.
- пользователь позже добавил Wait; Worker portion execution `14389` завершился успешно до parent/Aggregator/Recheck failure chain.

## 8. Minimal local fix boundary

Следующее изменение ограничено prompt ноды `Подготовить запрос #2 AI Targeted Recheck`:

```text
каждый semantic_block evidence.quote
= одна непрерывная дословная подстрока одного block

нельзя stitch строки/ячейки с пропуском промежуточного текста

несколько раздельных fragments
→ несколько evidence objects
→ те же analysis_unit_id + semantic_block_id
```

Retrieval, Evidence Validator, models, schemas, DB, FIELD_CATALOG и остальные workflow nodes не меняются. Runtime promotion/canary остаётся отдельным operator action.
