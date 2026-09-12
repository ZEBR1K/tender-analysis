# Report Header Final-Field Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заполнять недостающие данные шапки отчёта из уже готовых FINAL 27 fields, сохраняя приоритет TenderPlan metadata.

**Architecture:** Presentation-only fallback добавляется в существующую Code node `Собрать Report Model2`; canonical результаты агента остаются неизменными. Renderer получает готовую procurement-модель и отдельно корректно отображает отсутствие номера.

**Tech Stack:** n8n workflow JSON, JavaScript Code nodes, Node.js built-in test runner.

---

### Task 1: Зафиксировать fallback контракт тестами

**Files:**
- Modify: `tests/agentic-finalization-integration.test.mjs`
- Modify: `tests/report-generation-pdf.test.mjs`

- [x] **Step 1: Write the failing model test**

Добавить тест, который выполняет `Собрать Report Model2` с пустыми metadata и
проверяет fallback по четырём field keys, а также отдельный случай приоритета
непустых TenderPlan metadata.

- [x] **Step 2: Write the failing renderer test**

Проверить, что при `procurement.number = null` HTML содержит
`<h1>Анализ закупки без номера</h1>` и не содержит `№не указан`.

- [x] **Step 3: Run tests to verify failure**

Run: `node --test tests/agentic-finalization-integration.test.mjs tests/report-generation-pdf.test.mjs`

Expected: новые assertions падают на пустых header values и старом `№не указан`.

### Task 2: Реализовать минимальный presentation fallback

**Files:**
- Modify: `workflows/n8n-exports/TENDER — Генерация отчета.json`

- [x] **Step 1: Add final-field lookup**

В `Собрать Report Model2` создать lookup по `analysis_result.field_key` и helper,
который возвращает непустой `value_text` только для `resolved` и
`requires_review`.

- [x] **Step 2: Preserve metadata priority**

Собрать `procurement` через `metadata ?? final-field fallback ?? null`; номер и
дату публикации оставить без fallback.

- [x] **Step 3: Render a neutral missing-number title**

В `Сгенерировать HTML1` вычислить отображаемый суффикс как `№<number>` либо
`без номера` и использовать его в `<title>` и `<h1>`.

- [x] **Step 4: Run focused tests**

Run: `node --test tests/agentic-finalization-integration.test.mjs tests/report-generation-pdf.test.mjs`

Expected: PASS.

### Task 3: Документировать и проверить regression

**Files:**
- Modify: `workflows/report-generation.md`

- [x] **Step 1: Update the Report Model contract**

Описать приоритет metadata, ограниченный fallback и поля без fallback.

- [x] **Step 2: Inspect the diff**

Run: `git diff -- workflows/n8n-exports/TENDER\ —\ Генерация\ отчета.json tests/agentic-finalization-integration.test.mjs tests/report-generation-pdf.test.mjs workflows/report-generation.md`

Expected: только presentation mapping, renderer title, tests и документация.

- [x] **Step 3: Run the repository test suite**

Run: `npm test`

Expected: PASS, либо зафиксирована точная unrelated baseline failure.
