# TenderPlan Saved Search Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить автоматический опрос одного или нескольких сохранённых ключей TenderPlan раз в 10 минут так, чтобы существующие закупки стали baseline, а только появившиеся после включения закупки проходили текущий агентский путь до PDF.

**Architecture:** Новый небольшой входной workflow последовательно читает полную выдачу каждого включённого ключа, хранит baseline и события в существующем PostgreSQL intake ledger и передаёт только новые либо ранее failed-события в существующий `Intake Resume`. Текущий вход по метке, ручная загрузка, агентский runner, контракт 27 полей, финализация и PDF не меняются; существующие Intake Resume и Orchestrator получают только новый допустимый `trigger_kind`.

**Tech Stack:** n8n Schedule Trigger, Loop Over Items, HTTP Request и Execute Sub-workflow; TenderPlan REST API; PostgreSQL; JavaScript Code nodes; Node.js `node:test`; Git worktree.

---

## Зафиксированные решения и границы

- База реализации — актуальная ветка `codex/agentic-analysis-integration`, а не устаревший export из `main`.
- Новый workflow называется `TENDER — TenderPlan Saved Key Intake`; человекопонятное назначение — «Получение новых закупок из сохранённого поиска TenderPlan».
- Один workflow обслуживает несколько ключей; ключи обрабатываются последовательно.
- Первый успешный полный проход нового ключа создаёт только baseline и не запускает анализ.
- Рабочий event key: `tenderplan:key:{saved_key_id}:tender:{tender_id}`.
- Marker: `tenderplan:key:{saved_key_id}:baseline:v1`, его `tender_id` — `baseline:{saved_key_id}`.
- `failed` intake event разрешено повторно отправлять; `processing` и `completed` подавляются.
- Partial API result никогда не dispatch-ится.
- Новый deterministic разбор документов, semantic validator или field-specific rule не создаётся.
- Live n8n, live PostgreSQL и активация расписания меняются только после отдельного явного разрешения владельца.
- TenderPlan token и PostgreSQL password не попадают в exports, tests, docs или Git.

## Source of truth и расхождение, которое план устраняет

Read-only audit live n8n от 2026-09-13 подтвердил:

- Mark Intake: `biYC4OvWBlfJRmnj`;
- Intake Resume: `VO8Ml0sfO65w2Jiz`;
- Orchestrator: `TRLYuU7mVyE1bjjr`;
- credential TenderPlan: `E9gI5Mur0c8eFsN0`;
- credential PostgreSQL: `RFpUr3McElcwyoxy`.

Canonical Orchestrator export текущей design-ветки отстаёт от live workflow. Кроме того, актуальная `DATA_MODEL.md` в агентской ветке фиксирует CHECK, разрешающий только `tenderplan_mark`, `recovery_scan`, `manual`. Поэтому implementation сначала берёт актуальную агентскую ветку и live snapshots, а затем отдельной fail-closed migration добавляет `tenderplan_key` в существующий CHECK.

## Карта файлов

**Создать:**

- `migrations/2026-09-13_tenderplan_saved_key_intake.sql` — единственное изменение schema: новый допустимый `trigger_kind`.
- `tests/tenderplan-saved-key-migration.test.mjs` — статический fail-closed контракт migration.
- `tests/fixtures/tenderplan-saved-key-intake/pages.json` — synthetic многостраничные ответы двух ключей.
- `tests/helpers/n8n-code-node-runner.mjs` — переиспользуемый исполнитель Code node для offline tests.
- `tests/tenderplan-saved-key-intake.test.mjs` — workflow, pagination, baseline, retry и dispatch contracts.
- `workflows/n8n-exports/TENDER — TenderPlan Saved Key Intake.json` — canonical export после runtime-проверки.
- `workflows/n8n-exports/beta/[INACTIVE] TENDER — TenderPlan Saved Key Intake.json` — до runtime-проверки.
- `workflows/n8n-exports/beta/[LIVE PRECHANGE] TENDER — Intake Resume.json` — очищенный live snapshot.
- `workflows/n8n-exports/beta/[LIVE PRECHANGE] ТЕНДЕРЫ ОРКЕСТРАТОР.json` — очищенный live snapshot.
- `workflows/tenderplan-saved-key-intake.md` — назначение, контракты, эксплуатация и rollback.
- `evaluations/TENDERPLAN_SAVED_KEY_INTAKE_CANARY_2026-09-13.md` — runtime evidence.

**Изменить на актуальной агентской базе:**

- `tests/tender-intake-resume.test.mjs` — новый automatic intent.
- `tests/tender-orchestrator-input.test.mjs` — acceptance нового входа.
- `workflows/n8n-exports/TENDER — Intake Resume.json` — две Code nodes.
- `workflows/n8n-exports/ТЕНДЕРЫ ОРКЕСТРАТОР.json` — один allow-list.
- `workflows/intake-resume.md`, `workflows/orchestrator.md` — документированный вход.
- `DATA_MODEL.md` — четвёртое допустимое значение CHECK.
- `README.md`, `ARCHITECTURE.md`, `PROJECT_STATUS.md`, `TECH_DEBT.md`, `DEVELOPMENT_LOG.md` — только подтверждённый итог rollout.
- `AGENTS.md` — добавить новый production workflow в индекс canonical exports.

### Task 0: Подготовить чистую актуальную базу и live snapshots

**Files:**

- Create worktree: `.worktrees/tenderplan-saved-search-intake-implementation`
- Create: `workflows/n8n-exports/beta/[LIVE PRECHANGE] TENDER — Intake Resume.json`
- Create: `workflows/n8n-exports/beta/[LIVE PRECHANGE] ТЕНДЕРЫ ОРКЕСТРАТОР.json`
- Copy from design branch: `docs/superpowers/specs/2026-09-13-tenderplan-saved-search-intake-design.md`
- Copy from design branch: `docs/superpowers/plans/2026-09-13-tenderplan-saved-search-intake.md`

- [ ] **Step 1: Создать отдельный worktree от актуальной агентской ветки**

```powershell
git fetch origin
git worktree add -b codex/tenderplan-saved-search-intake-implementation `
  .worktrees/tenderplan-saved-search-intake-implementation `
  origin/codex/agentic-analysis-integration
Set-Location .worktrees/tenderplan-saved-search-intake-implementation
```

Expected: создана чистая implementation-ветка, `git status --short` ничего не выводит.

- [ ] **Step 2: Перенести только утверждённые design и plan**

```powershell
git restore --source=codex/tenderplan-saved-search-intake -- `
  docs/superpowers/specs/2026-09-13-tenderplan-saved-search-intake-design.md `
  docs/superpowers/plans/2026-09-13-tenderplan-saved-search-intake.md
git add docs/superpowers/specs/2026-09-13-tenderplan-saved-search-intake-design.md `
  docs/superpowers/plans/2026-09-13-tenderplan-saved-search-intake.md
git commit -m "docs(intake): carry saved-key design onto agentic base"
```

Expected: один docs-only commit, никаких файлов старой ветки поверх агентской базы.

- [ ] **Step 3: Снять безопасные pre-change snapshots двух live workflows**

Выполнить этот PowerShell только при наличии read-only env vars; он не печатает API key и исключает `pinData`:

```powershell
$baseUrl = $env:N8N_TENDER_BASE_URL.TrimEnd('/')
$headers = @{ 'X-N8N-API-KEY' = $env:N8N_TENDER_READONLY_API_KEY }
$targets = @(
  @{ Id = 'VO8Ml0sfO65w2Jiz'; File = '[LIVE PRECHANGE] TENDER — Intake Resume.json' },
  @{ Id = 'TRLYuU7mVyE1bjjr'; File = '[LIVE PRECHANGE] ТЕНДЕРЫ ОРКЕСТРАТОР.json' }
)
foreach ($target in $targets) {
  $workflow = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/v1/workflows/$($target.Id)" -Headers $headers
  $safe = [ordered]@{
    id = $workflow.id
    name = $workflow.name
    active = $workflow.active
    nodes = $workflow.nodes
    connections = $workflow.connections
    settings = $workflow.settings
    versionId = $workflow.versionId
  }
  $json = $safe | ConvertTo-Json -Depth 100
  $path = Join-Path 'workflows/n8n-exports/beta' $target.File
  [System.IO.File]::WriteAllText((Join-Path $PWD $path), $json, [System.Text.UTF8Encoding]::new($false))
}
```

Expected: оба JSON parse-ятся, `pinData` отсутствует, credential содержит только ссылку `id/name`, не секрет.

- [ ] **Step 4: Подтвердить точные live boundaries**

```powershell
node -e "const fs=require('fs');for(const f of process.argv.slice(1)){const w=JSON.parse(fs.readFileSync(f,'utf8'));console.log(w.id,w.name,w.nodes.length)}" `
  "workflows/n8n-exports/beta/[LIVE PRECHANGE] TENDER — Intake Resume.json" `
  "workflows/n8n-exports/beta/[LIVE PRECHANGE] ТЕНДЕРЫ ОРКЕСТРАТОР.json"
```

Expected: IDs `VO8Ml0sfO65w2Jiz` и `TRLYuU7mVyE1bjjr`; Intake Resume содержит `Validate Intake Input` и `Prepare Event Identity`; Orchestrator содержит `Проверить вход Orchestrator`.

- [ ] **Step 5: Commit snapshots**

```powershell
git add "workflows/n8n-exports/beta/[LIVE PRECHANGE] TENDER — Intake Resume.json" `
  "workflows/n8n-exports/beta/[LIVE PRECHANGE] ТЕНДЕРЫ ОРКЕСТРАТОР.json"
git commit -m "chore(intake): capture live prechange workflow snapshots"
```

### Task 1: Расширить CHECK `trigger_kind` fail-closed migration

**Files:**

- Create: `migrations/2026-09-13_tenderplan_saved_key_intake.sql`
- Create: `tests/tenderplan-saved-key-migration.test.mjs`
- Modify: `DATA_MODEL.md`
- Modify: `migrations/README.md`

- [ ] **Step 1: Написать RED test migration-контракта**

```javascript
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL(
  '../migrations/2026-09-13_tenderplan_saved_key_intake.sql',
  import.meta.url,
), 'utf8');
const normalized = sql.replace(/\s+/gu, ' ').toLowerCase();

test('migration changes only the existing trigger_kind CHECK and fails closed', () => {
  assert.match(normalized, /begin;/u);
  assert.match(normalized, /commit;/u);
  assert.match(normalized, /pg_constraint/u);
  assert.match(normalized, /pg_get_constraintdef/u);
  assert.match(normalized, /raise exception/u);
  assert.match(normalized, /drop constraint/u);
  assert.match(normalized, /add constraint/u);
  for (const value of ['manual', 'recovery_scan', 'tenderplan_mark', 'tenderplan_key']) {
    assert.match(normalized, new RegExp(`'${value}'`, 'u'));
  }
  assert.doesNotMatch(normalized, /create table|drop table|add column|drop column/u);
});
```

- [ ] **Step 2: Запустить test и подтвердить RED**

Run: `node --test tests/tenderplan-saved-key-migration.test.mjs`

Expected: FAIL с `ENOENT` для нового migration-файла.

- [ ] **Step 3: Создать точную forward-only migration**

```sql
BEGIN;

DO $migration$
DECLARE
  ledger_oid oid;
  trigger_attnum smallint;
  check_count integer;
  trigger_check record;
  current_values text[];
BEGIN
  SELECT table_row.oid, column_row.attnum
  INTO ledger_oid, trigger_attnum
  FROM pg_catalog.pg_class AS table_row
  JOIN pg_catalog.pg_namespace AS namespace_row
    ON namespace_row.oid = table_row.relnamespace
  JOIN pg_catalog.pg_attribute AS column_row
    ON column_row.attrelid = table_row.oid
   AND column_row.attname = 'trigger_kind'
   AND NOT column_row.attisdropped
  WHERE namespace_row.nspname = 'public'
    AND table_row.relname = 'tender_analysis_intake_events'
    AND table_row.relkind = 'r';

  IF ledger_oid IS NULL OR trigger_attnum IS NULL THEN
    RAISE EXCEPTION 'Saved-key intake migration requires public.tender_analysis_intake_events.trigger_kind';
  END IF;

  SELECT count(*)
  INTO check_count
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = ledger_oid
    AND constraint_row.contype = 'c'
    AND constraint_row.conkey = ARRAY[trigger_attnum]::smallint[];

  IF check_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one trigger_kind-only CHECK, found %', check_count;
  END IF;

  SELECT
    constraint_row.conname,
    constraint_row.convalidated,
    COALESCE((pg_catalog.to_jsonb(constraint_row) ->> 'conenforced')::boolean, true) AS conenforced,
    pg_catalog.pg_get_constraintdef(constraint_row.oid, true) AS definition
  INTO trigger_check
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = ledger_oid
    AND constraint_row.contype = 'c'
    AND constraint_row.conkey = ARRAY[trigger_attnum]::smallint[];

  SELECT ARRAY(
    SELECT (captured.value)[1]
    FROM pg_catalog.regexp_matches(lower(trigger_check.definition), '''([^'']+)''', 'g') AS captured(value)
    ORDER BY (captured.value)[1]
  ) INTO current_values;

  IF NOT trigger_check.convalidated
     OR NOT trigger_check.conenforced
     OR trigger_check.definition ~* '[[:<:]](AND|OR)[[:>:]]'
     OR (
       current_values <> ARRAY['manual', 'recovery_scan', 'tenderplan_mark']::text[]
       AND current_values <> ARRAY['manual', 'recovery_scan', 'tenderplan_key', 'tenderplan_mark']::text[]
     )
  THEN
    RAISE EXCEPTION 'Existing trigger_kind CHECK has unknown semantics: %', trigger_check.definition;
  END IF;

  IF current_values = ARRAY['manual', 'recovery_scan', 'tenderplan_mark']::text[] THEN
    EXECUTE format(
      'ALTER TABLE public.tender_analysis_intake_events DROP CONSTRAINT %I',
      trigger_check.conname
    );
    EXECUTE format(
      'ALTER TABLE public.tender_analysis_intake_events ADD CONSTRAINT %I CHECK (trigger_kind IN (%L, %L, %L, %L))',
      trigger_check.conname,
      'tenderplan_mark',
      'tenderplan_key',
      'recovery_scan',
      'manual'
    );
  END IF;
END
$migration$;

DO $postcondition$
DECLARE
  actual_values text[];
BEGIN
  SELECT ARRAY(
    SELECT (captured.value)[1]
    FROM pg_catalog.pg_constraint AS constraint_row
    JOIN pg_catalog.pg_class AS table_row
      ON table_row.oid = constraint_row.conrelid
    JOIN pg_catalog.pg_namespace AS namespace_row
      ON namespace_row.oid = table_row.relnamespace
    CROSS JOIN LATERAL pg_catalog.regexp_matches(
      lower(pg_catalog.pg_get_constraintdef(constraint_row.oid, true)),
      '''([^'']+)''',
      'g'
    ) AS captured(value)
    WHERE namespace_row.nspname = 'public'
      AND table_row.relname = 'tender_analysis_intake_events'
      AND constraint_row.contype = 'c'
      AND pg_catalog.pg_get_constraintdef(constraint_row.oid, true) ~* 'trigger_kind'
    ORDER BY (captured.value)[1]
  ) INTO actual_values;

  IF actual_values <> ARRAY['manual', 'recovery_scan', 'tenderplan_key', 'tenderplan_mark']::text[] THEN
    RAISE EXCEPTION 'Saved-key intake migration postcondition failed: %', actual_values;
  END IF;
END
$postcondition$;

COMMIT;
```

- [ ] **Step 4: Запустить test и проверить migration diff**

Run: `node --test tests/tenderplan-saved-key-migration.test.mjs`

Expected: PASS.

Run: `git diff --check`

Expected: no output.

- [ ] **Step 5: Обновить data-model documentation**

В `DATA_MODEL.md` заменить список разрешённых `trigger_kind` на:

```text
tenderplan_mark
tenderplan_key
recovery_scan
manual
```

В `migrations/README.md` добавить migration, precondition «ровно один проверенный CHECK с тремя прежними значениями» и postcondition «ровно четыре значения».

- [ ] **Step 6: Commit migration**

```powershell
git add migrations/2026-09-13_tenderplan_saved_key_intake.sql `
  tests/tenderplan-saved-key-migration.test.mjs DATA_MODEL.md migrations/README.md
git commit -m "feat(intake): allow saved-key trigger in intake ledger"
```

### Task 2: Расширить Intake Resume и Orchestrator минимальным новым входом

**Files:**

- Modify: `tests/tender-intake-resume.test.mjs`
- Modify: `tests/tender-orchestrator-input.test.mjs`
- Modify: `workflows/n8n-exports/TENDER — Intake Resume.json`
- Modify: `workflows/n8n-exports/ТЕНДЕРЫ ОРКЕСТРАТОР.json`
- Modify: `workflows/intake-resume.md`
- Modify: `workflows/orchestrator.md`

- [ ] **Step 1: Добавить RED cases в Intake Resume tests**

В `automaticIntents` добавить:

```javascript
{ triggerKind: 'tenderplan_key', manualOverride: false },
```

Добавить отдельный test:

```javascript
test('Intake Resume maps tenderplan_key to TenderPlan identity', async () => {
  const workflow = JSON.parse(fs.readFileSync(workflowExportPath, 'utf8'));
  const validate = requireNode(workflow, 'Validate Intake Input');
  const identity = requireNode(workflow, 'Prepare Event Identity');
  const input = {
    trigger_kind: 'tenderplan_key',
    source_event_key: 'tenderplan:key:64f000000000000000000001:tender:66a000000000000000000002',
    tender_id: '66a000000000000000000002',
    analysis_run_id: '',
    manual_override: false,
    observed_at: '2026-09-13T10:00:00+03:00',
  };
  const validated = await executeSingleCodeJson(validate, input);
  assert.equal(validated.source, 'tenderplan');
  assert.equal(validated.intent, 'automatic');
  assert.equal(validated.run_authoritative, false);
  const identified = await executeSingleCodeJson(identity, validated);
  assert.equal(identified.source, 'tenderplan');
  assert.equal(identified.event_type, 'key_match_added');
});
```

- [ ] **Step 2: Добавить RED case в Orchestrator input test**

```javascript
test('Orchestrator accepts tenderplan_key without relaxing the other input guards', () => {
  const guard = nodesByName.get('Проверить вход Orchestrator');
  assert.ok(guard);
  const source = codeSource(guard);
  assert.match(source, /tenderplan_key/u);
  assert.match(source, /source\s*!==\s*['"]tenderplan['"]/u);
  assert.match(source, /source_event_key/u);
  assert.match(source, /tender_id/u);
});
```

- [ ] **Step 3: Запустить два tests и подтвердить RED**

Run:

```powershell
node --test tests/tender-intake-resume.test.mjs tests/tender-orchestrator-input.test.mjs
```

Expected: FAIL только на отсутствии поддержки `tenderplan_key`.

- [ ] **Step 4: Изменить только `Validate Intake Input`**

В canonical Intake Resume заменить ветку `tenderplan_mark` и вычисление `source` на:

```javascript
const isTenderPlanAutomatic = trigger_kind === 'tenderplan_mark'
  || trigger_kind === 'tenderplan_key';

if (isTenderPlanAutomatic) {
  if (!tender_id || analysis_run_id) {
    fail(`${trigger_kind} requires tender_id and forbids analysis_run_id`);
  }
  if (value.manual_override) {
    fail(`manual override forbidden for ${trigger_kind}`);
  }
  intent = 'automatic';
  run_authoritative = false;
}
else if (trigger_kind === 'recovery_scan') {
  if (!analysis_run_id || tender_id) fail('recovery_scan requires analysis_run_id and forbids tender_id');
  if (value.manual_override) fail('manual override forbidden for recovery_scan');
  intent = 'automatic';
  run_authoritative = true;
}
else if (trigger_kind === 'manual') {
  if (!analysis_run_id || tender_id) fail('manual requires analysis_run_id and forbids tender_id');
  if (!value.manual_override) fail('manual requires manual_override=true');
  intent = 'manual';
  run_authoritative = true;
}
else {
  fail(`unknown trigger_kind ${trigger_kind}`);
}

const source = isTenderPlanAutomatic ? 'tenderplan' : trigger_kind;
```

Остальной text/bounds/timestamp validation этой ноды оставить буквально без изменений.

- [ ] **Step 5: Изменить только `Prepare Event Identity`**

```javascript
const eventTypes = {
  tenderplan_mark: 'mark_added',
  tenderplan_key: 'key_match_added',
};
const isTenderPlanAutomatic = Object.hasOwn(eventTypes, $json.trigger_kind);
const source = isTenderPlanAutomatic ? 'tenderplan' : $json.trigger_kind;

return {
  json: {
    ...$json,
    source,
    event_type: eventTypes[$json.trigger_kind] ?? $json.trigger_kind,
    stale_cutoff: new Date(Date.now() - 3600000).toISOString(),
  },
};
```

- [ ] **Step 6: Расширить один allow-list Orchestrator**

В `Проверить вход Orchestrator` заменить только строку набора:

```javascript
const allowedTriggerKinds = new Set([
  'tenderplan_mark',
  'tenderplan_key',
  'recovery_scan',
  'manual',
]);
```

Все остальные guards и весь downstream Orchestrator оставить без изменений.

- [ ] **Step 7: Запустить tests**

Run:

```powershell
node --test tests/tender-intake-resume.test.mjs tests/tender-orchestrator-input.test.mjs tests/intake-agentic-shadow-routing.test.mjs
```

Expected: PASS; старые три `trigger_kind` и новый `tenderplan_key` проходят свои прежние ограничения.

- [ ] **Step 8: Обновить две workflow docs и commit**

В `workflows/intake-resume.md` добавить exact input/output mapping. В `workflows/orchestrator.md` обновить только перечисление допустимых `trigger_kind`; 27-field и agentic downstream contracts не менять.

```powershell
git add tests/tender-intake-resume.test.mjs tests/tender-orchestrator-input.test.mjs `
  "workflows/n8n-exports/TENDER — Intake Resume.json" `
  "workflows/n8n-exports/ТЕНДЕРЫ ОРКЕСТРАТОР.json" `
  workflows/intake-resume.md workflows/orchestrator.md
git commit -m "feat(intake): accept TenderPlan saved-key events"
```

### Task 3: Зафиксировать synthetic pagination и baseline cases

**Files:**

- Create: `tests/fixtures/tenderplan-saved-key-intake/pages.json`
- Create: `tests/helpers/n8n-code-node-runner.mjs`
- Create: `tests/tenderplan-saved-key-intake.test.mjs`

- [ ] **Step 1: Создать deterministic fixture двух ключей**

```json
{
  "keys": [
    {
      "saved_key_id": "64f000000000000000000001",
      "name": "Основной сохранённый поиск",
      "enabled": true
    },
    {
      "saved_key_id": "64f000000000000000000002",
      "name": "Второй сохранённый поиск",
      "enabled": true
    }
  ],
  "completePages": [
    {
      "tenders": [
        { "_id": "66a000000000000000000001" },
        { "_id": "66a000000000000000000002" }
      ],
      "tender": null
    },
    {
      "tenders": [
        { "_id": "66a000000000000000000002" },
        { "_id": "66a000000000000000000003" }
      ]
    },
    {
      "tenders": []
    }
  ],
  "expectedTenderIds": [
    "66a000000000000000000001",
    "66a000000000000000000002",
    "66a000000000000000000003"
  ],
  "existingStates": [
    { "tender_id": "66a000000000000000000001", "existing_status": "completed" },
    { "tender_id": "66a000000000000000000002", "existing_status": "failed" },
    { "tender_id": "66a000000000000000000003", "existing_status": null }
  ],
  "expectedDispatchTenderIds": [
    "66a000000000000000000002",
    "66a000000000000000000003"
  ]
}
```

- [ ] **Step 2: Создать общий Code node runner**

```javascript
import assert from 'node:assert/strict';
import vm from 'node:vm';

function normalizeResult(raw, nodeName) {
  assert.notEqual(raw, undefined, `${nodeName} returned no data`);
  const items = Array.isArray(raw) ? raw : [raw];
  return items.map((item) => (
    item && typeof item === 'object' && Object.hasOwn(item, 'json')
      ? item
      : { json: item }
  ));
}

export async function executeCodeNode(node, inputJson, globals = {}) {
  assert.equal(node.type, 'n8n-nodes-base.code');
  const inputItems = inputJson.map((json) => ({ json: structuredClone(json) }));
  const mode = node.parameters.mode ?? 'runOnceForAllItems';
  const run = async (currentItem) => {
    const context = vm.createContext({
      $input: {
        all: () => structuredClone(inputItems),
        first: () => structuredClone(inputItems[0]),
        item: structuredClone(currentItem),
      },
      $json: structuredClone(currentItem?.json ?? {}),
      $execution: { id: 'saved-key-contract-test' },
      structuredClone,
      console,
      ...globals,
    });
    const script = new vm.Script(
      `(async () => {\n${node.parameters.jsCode}\n})()`,
      { filename: `${node.name}.code-node.js` },
    );
    return normalizeResult(await script.runInContext(context, { timeout: 1000 }), node.name);
  };
  if (mode === 'runOnceForEachItem') {
    const output = [];
    for (const item of inputItems) output.push(...await run(item));
    return structuredClone(output);
  }
  return structuredClone(await run(inputItems[0]));
}
```

- [ ] **Step 3: Написать RED structural tests нового export**

Создать начало test-файла и structural contract:

```javascript
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { executeCodeNode } from './helpers/n8n-code-node-runner.mjs';

const workflow = JSON.parse(readFileSync(new URL(
  '../workflows/n8n-exports/beta/[INACTIVE] TENDER — TenderPlan Saved Key Intake.json',
  import.meta.url,
), 'utf8').replace(/^\uFEFF/u, ''));
const fixture = JSON.parse(readFileSync(new URL(
  './fixtures/tenderplan-saved-key-intake/pages.json',
  import.meta.url,
), 'utf8'));
const nodesByName = new Map(workflow.nodes.map((node) => [node.name, node]));

function requireNode(currentWorkflow, name) {
  const node = currentWorkflow.nodes.find((candidate) => candidate.name === name);
  assert.ok(node, `missing ${name}`);
  return node;
}

function directTargets(currentWorkflow, name, outputIndex = 0) {
  return (currentWorkflow.connections?.[name]?.main?.[outputIndex] ?? [])
    .map((connection) => connection.node);
}

function canReach(currentWorkflow, startName, targetName) {
  const queue = [startName];
  const visited = new Set();
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === targetName) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const output of currentWorkflow.connections?.[current]?.main ?? []) {
      for (const connection of output ?? []) queue.push(connection.node);
    }
  }
  return false;
}

test('workflow contains the bounded sequential polling topology', () => {
const requiredNodes = [
  'Manual Trigger',
  'Every 10 Minutes',
  'Define Saved Keys',
  'Loop Over Saved Keys',
  'Load Baseline State',
  'Validate Baseline State',
  'Get Complete Saved Key Pages',
  'Normalize Complete Page Set',
  'Initialize Baseline',
  'Load Existing Event States',
  'Build Dispatch Queue',
  'Execute TENDER — Intake Resume',
  'Assert Poll Completed',
];
for (const name of requiredNodes) assert.ok(nodesByName.has(name), `missing ${name}`);
assert.equal(nodesByName.get('Every 10 Minutes').parameters.rule.interval[0].minutesInterval, 10);
assert.equal(nodesByName.get('Loop Over Saved Keys').parameters.batchSize, 1);
assert.equal(nodesByName.get('Execute TENDER — Intake Resume').parameters.options.waitForSubWorkflow, false);
assert.equal(workflow.settings.executionOrder, 'v1');
assert.equal(workflow.settings.timezone, 'Europe/Moscow');
assert.equal(workflow.settings.errorWorkflow, 'kff8KIrSHzo5Mmt1');
});
```

Добавить exact behavioral tests:

```javascript
test('complete page set is deduplicated and requires a final empty page', async () => {
  const node = requireNode(workflow, 'Normalize Complete Page Set');
  const key = {
    saved_key_id: fixture.keys[0].saved_key_id,
    saved_key_name: fixture.keys[0].name,
    baseline_exists: true,
  };
  const globals = {
    $: (name) => {
      assert.equal(name, 'Validate Baseline State');
      return { first: () => ({ json: structuredClone(key) }) };
    },
  };
  const result = await executeCodeNode(node, fixture.completePages, globals);
  assert.deepEqual(result[0].json.tender_ids, fixture.expectedTenderIds);
  assert.equal(result[0].json.page_count, fixture.completePages.length);

  await assert.rejects(
    executeCodeNode(node, fixture.completePages.slice(0, -1), globals),
    /TENDERPLAN_PAGINATION_INCOMPLETE/u,
  );
  const malformed = structuredClone(fixture.completePages);
  malformed[0].tenders[0]._id = 'invalid';
  await assert.rejects(
    executeCodeNode(node, malformed, globals),
    /TENDERPLAN_TENDER_ID_INVALID/u,
  );
});

test('queue suppresses processing/completed and dispatches failed/missing', async () => {
  const node = requireNode(workflow, 'Build Dispatch Queue');
  const result = await executeCodeNode(node, [{
    saved_key_id: fixture.keys[0].saved_key_id,
    saved_key_name: fixture.keys[0].name,
    observed_at: '2026-09-13T10:00:00.000Z',
    event_states: fixture.existingStates,
  }]);
  const dispatched = result.map((item) => item.json.tender_id);
  assert.deepEqual(dispatched, fixture.expectedDispatchTenderIds);
  for (const item of result) {
    assert.equal(item.json.trigger_kind, 'tenderplan_key');
    assert.equal(item.json.manual_override, false);
    assert.equal(item.json.analysis_run_id, '');
    assert.match(
      item.json.source_event_key,
      new RegExp(`^tenderplan:key:${fixture.keys[0].saved_key_id}:tender:`, 'u'),
    );
  }
});

test('the same tender under two keys receives distinct event keys', async () => {
  const node = requireNode(workflow, 'Build Dispatch Queue');
  const outputs = [];
  for (const key of fixture.keys) {
    const result = await executeCodeNode(node, [{
      saved_key_id: key.saved_key_id,
      saved_key_name: key.name,
      observed_at: '2026-09-13T10:00:00.000Z',
      event_states: [{ tender_id: fixture.expectedTenderIds[0], existing_status: null }],
    }]);
    outputs.push(result[0].json.source_event_key);
  }
  assert.equal(new Set(outputs).size, 2);
});
```

- [ ] **Step 4: Запустить RED tests**

Run: `node --test tests/tenderplan-saved-key-intake.test.mjs`

Expected: FAIL с `ENOENT` для inactive workflow export.

- [ ] **Step 5: Commit RED baseline**

```powershell
git add tests/fixtures/tenderplan-saved-key-intake/pages.json `
  tests/helpers/n8n-code-node-runner.mjs tests/tenderplan-saved-key-intake.test.mjs
git commit -m "test(intake): define saved-key polling contract"
```

### Task 4: Собрать inactive workflow без live-активации

**Files:**

- Create: `workflows/n8n-exports/beta/[INACTIVE] TENDER — TenderPlan Saved Key Intake.json`
- Create: `workflows/tenderplan-saved-key-intake.md`
- Test: `tests/tenderplan-saved-key-intake.test.mjs`

- [ ] **Step 1: Создать workflow с фиксированной топологией**

Использовать следующие ноды и только эти функциональные связи:

| Нода | Тип | Ключевая настройка |
|---|---|---|
| `Manual Trigger` | Manual Trigger | ручной preflight/baseline |
| `Every 10 Minutes` | Schedule Trigger 1.3 | каждые 10 минут |
| `Define Saved Keys` | Code 2 | run once for all |
| `Loop Over Saved Keys` | Split in Batches 3 | batch size `1` |
| `Load Baseline State` | PostgreSQL 2.6 | credential `KITATEH Tenders` |
| `Validate Baseline State` | Code 2 | отвергает повреждённый marker |
| `Get Complete Saved Key Pages` | HTTP Request 4.4 | credential `Тендерплан kitateh n8n автоматизация тендеров` |
| `Normalize Complete Page Set` | Code 2 | run once for all |
| `Baseline Exists?` | IF 2.3 | exact boolean |
| `Initialize Baseline` | PostgreSQL 2.6 | одна atomic statement |
| `Baseline Summary` | Code 2 | один итоговый item |
| `Load Existing Event States` | PostgreSQL 2.6 | один batch query |
| `Build Dispatch Queue` | Code 2 | failed/missing only |
| `Has Dispatch?` | IF 2.3 | exact boolean |
| `Execute TENDER — Intake Resume` | Execute Workflow 1.3 | workflow `VO8Ml0sfO65w2Jiz`, each, no wait |
| `Dispatch Summary` | Code 2 | один итоговый item |
| `No New Tenders` | Code 2 | один итоговый item |
| `Key Failure` | Code 2 | один auditable failure item |
| `Assert Poll Completed` | Code 2 | hard error после завершения остальных ключей |

Workflow settings:

```text
executionOrder = v1
timezone = Europe/Moscow
errorWorkflow = kff8KIrSHzo5Mmt1
```

Главные main-output connections:

```text
Manual Trigger ─┐
                ├→ Define Saved Keys → Loop Over Saved Keys
Schedule Trigger┘                         │ loop output
                                         ↓
Load Baseline State → Validate Baseline State → Get Complete Saved Key Pages → Normalize Complete Page Set
→ Baseline Exists?
   false → Initialize Baseline → Baseline Summary ─┐
   true  → Load Existing Event States              │
           → Build Dispatch Queue → Has Dispatch?  │
               false → No New Tenders ─────────────┤
               true  → Execute Intake Resume       │
                       → Dispatch Summary ──────────┤
                                                    └→ Loop Over Saved Keys
Loop Over Saved Keys done output → Assert Poll Completed
```

Error outputs `Load Baseline State`, `Validate Baseline State`, `Get Complete Saved Key Pages`, `Normalize Complete Page Set`, `Initialize Baseline`, `Load Existing Event States`, `Build Dispatch Queue` и `Execute TENDER — Intake Resume` направить в `Key Failure`, затем вернуть один failure item в `Loop Over Saved Keys`. Так ошибка одного ключа не лишает остальные ключи попытки, но финальная нода всё равно делает execution failed.

- [ ] **Step 2: Добавить строгую конфигурацию ключей**

До runtime preflight canonical candidate хранит пустой явный список и падает с понятной ошибкой. Реальные IDs добавляются только после получения списка через credential в Task 7.

```javascript
const SAVED_KEYS = Object.freeze([]);
const objectId = /^[0-9a-f]{24}$/u;

if (!Array.isArray(SAVED_KEYS) || SAVED_KEYS.length === 0) {
  throw new Error('SAVED_KEYS_NOT_CONFIGURED');
}

const ids = new Set();
const enabled = [];
for (const raw of SAVED_KEYS) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('SAVED_KEY_CONFIG_INVALID: entry must be an object');
  }
  const saved_key_id = typeof raw.saved_key_id === 'string'
    ? raw.saved_key_id.trim().toLowerCase()
    : '';
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!objectId.test(saved_key_id)) {
    throw new Error(`SAVED_KEY_CONFIG_INVALID: id=${saved_key_id || 'empty'}`);
  }
  if (!name || name.length > 200 || typeof raw.enabled !== 'boolean') {
    throw new Error(`SAVED_KEY_CONFIG_INVALID: metadata for ${saved_key_id}`);
  }
  if (ids.has(saved_key_id)) {
    throw new Error(`SAVED_KEY_CONFIG_DUPLICATE: ${saved_key_id}`);
  }
  ids.add(saved_key_id);
  if (raw.enabled) enabled.push({ saved_key_id, saved_key_name: name });
}

if (enabled.length === 0) throw new Error('NO_ENABLED_SAVED_KEYS');
return enabled.map((json) => ({ json }));
```

- [ ] **Step 3: Настроить HTTP pagination**

`Get Complete Saved Key Pages`:

```text
GET https://tenderplan.ru/api/tenders/v2/getlist
authentication = genericCredentialType/httpHeaderAuth
query type = 0
query id = {{ $json.saved_key_id }}
query page = 0
pagination mode = Update a Parameter in Each Request
pagination parameter type = Query
pagination parameter name = page
pagination parameter value = {{ $pageCount + 1 }}
pagination complete when = {{ !Array.isArray($response.body?.tenders) || $response.body.tenders.length === 0 }}
limit pages fetched = 100
interval between requests = 1100 ms
retryOnFail = true
maxTries = 3
waitBetweenTries = 5000 ms
```

Не считать достижение лимита успешным: это отдельно проверяет normalizer.

- [ ] **Step 4: Реализовать `Normalize Complete Page Set`**

```javascript
const key = $('Validate Baseline State').first().json;
const pages = $input.all().map((item) => item.json);
const objectId = /^[0-9a-f]{24}$/u;

if (pages.length === 0) throw new Error('TENDERPLAN_EMPTY_PAGE_SET');
if (pages.length > 100) throw new Error(`TENDERPLAN_PAGE_LIMIT_EXCEEDED: ${pages.length}`);

const ids = new Set();
const addTender = (candidate, location, optional = false) => {
  if (candidate == null && optional) return;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error(`TENDERPLAN_RESPONSE_INVALID: ${location}`);
  }
  const tenderId = typeof candidate._id === 'string'
    ? candidate._id.trim().toLowerCase()
    : '';
  if (!objectId.test(tenderId)) {
    throw new Error(`TENDERPLAN_TENDER_ID_INVALID: ${location}`);
  }
  ids.add(tenderId);
};

pages.forEach((body, pageIndex) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error(`TENDERPLAN_RESPONSE_INVALID: page=${pageIndex}`);
  }
  if (!Array.isArray(body.tenders)) {
    throw new Error(`TENDERPLAN_TENDERS_INVALID: page=${pageIndex}`);
  }
  body.tenders.forEach((candidate, index) => {
    addTender(candidate, `page=${pageIndex}.tenders[${index}]`);
  });
  if (Object.hasOwn(body, 'tender')) addTender(body.tender, `page=${pageIndex}.tender`, true);
});

if (pages.at(-1).tenders.length !== 0) {
  throw new Error(`TENDERPLAN_PAGINATION_INCOMPLETE: pages=${pages.length}`);
}

return [{
  json: {
    ...key,
    tender_ids: [...ids].sort(),
    page_count: pages.length,
    observed_at: new Date().toISOString(),
  },
}];
```

- [ ] **Step 5: Реализовать единый failure summary и финальную ошибку**

`Key Failure`:

```javascript
const key = $('Loop Over Saved Keys').item.json;
const detail = $json.error?.message ?? $json.message ?? 'unknown key-processing error';
return [{
  json: {
    saved_key_id: key.saved_key_id,
    saved_key_name: key.saved_key_name,
    outcome: 'failed',
    error_message: String(detail).slice(0, 2000),
  },
}];
```

`Assert Poll Completed`:

```javascript
const summaries = $input.all().map((item) => item.json);
const failed = summaries.filter((item) => item.outcome === 'failed');
if (failed.length > 0) {
  const ids = failed.map((item) => item.saved_key_id).join(',');
  throw new Error(`TENDERPLAN_SAVED_KEY_POLL_FAILED: ${ids}`);
}
return [{
  json: {
    success: true,
    keys_total: summaries.length,
    baseline_initialized: summaries.filter((item) => item.outcome === 'baseline_initialized').length,
    polled: summaries.filter((item) => item.outcome === 'polled').length,
    dispatched: summaries.reduce((sum, item) => sum + Number(item.dispatched_count ?? 0), 0),
    summaries,
  },
}];
```

- [ ] **Step 6: Сохранить inactive export и написать workflow doc**

`workflows/tenderplan-saved-key-intake.md` должен содержать: список настроенных ключей, baseline contract, event-key format, pagination stop condition, failure behavior, credential names, способ добавить/отключить ключ и rollback «деактивировать только этот workflow».

- [ ] **Step 7: Запустить structural tests**

Run: `node --test tests/tenderplan-saved-key-intake.test.mjs`

Expected: structural tests PASS; behavioral tests SQL/queue остаются RED до Task 5.

- [ ] **Step 8: Commit inactive skeleton**

```powershell
git add "workflows/n8n-exports/beta/[INACTIVE] TENDER — TenderPlan Saved Key Intake.json" `
  workflows/tenderplan-saved-key-intake.md tests/tenderplan-saved-key-intake.test.mjs
git commit -m "feat(intake): add inactive saved-key polling workflow"
```

### Task 5: Реализовать baseline, prefilter и dispatch без частичного состояния

**Files:**

- Modify: `workflows/n8n-exports/beta/[INACTIVE] TENDER — TenderPlan Saved Key Intake.json`
- Modify: `tests/tenderplan-saved-key-intake.test.mjs`
- Modify: `workflows/tenderplan-saved-key-intake.md`

- [ ] **Step 1: Настроить `Load Baseline State` и его validator**

SQL:

```sql
SELECT
  $1::text AS saved_key_id,
  $2::text AS saved_key_name,
  count(*)::integer AS marker_count,
  count(*) FILTER (
    WHERE event_type = 'key_baseline_completed'
      AND tender_id = 'baseline:' || $1::text
      AND trigger_kind = 'tenderplan_key'
      AND status = 'completed'
      AND action = 'baseline_initialized'
      AND processed_at IS NOT NULL
  )::integer AS valid_marker_count
FROM public.tender_analysis_intake_events
WHERE source = 'tenderplan'
  AND event_key = 'tenderplan:key:' || $1::text || ':baseline:v1';
```

Query replacements:

```text
{{ [ $json.saved_key_id, $json.saved_key_name ] }}
```

`Validate Baseline State`:

```javascript
const markerCount = Number($json.marker_count);
const validMarkerCount = Number($json.valid_marker_count);
if (!Number.isInteger(markerCount) || !Number.isInteger(validMarkerCount)) {
  throw new Error('BASELINE_STATE_INVALID: counts');
}
if (markerCount > 1 || validMarkerCount > markerCount) {
  throw new Error('BASELINE_STATE_INVALID: multiplicity');
}
if (markerCount === 1 && validMarkerCount !== 1) {
  throw new Error(`BASELINE_MARKER_INVALID: ${$json.saved_key_id}`);
}
return [{
  json: {
    saved_key_id: $json.saved_key_id,
    saved_key_name: $json.saved_key_name,
    baseline_exists: validMarkerCount === 1,
  },
}];
```

- [ ] **Step 2: Настроить atomic `Initialize Baseline`**

```sql
WITH input_rows AS (
  SELECT DISTINCT value::text AS tender_id
  FROM jsonb_array_elements_text($3::jsonb) AS value
),
baseline_events AS (
  INSERT INTO public.tender_analysis_intake_events (
    source,
    event_key,
    event_type,
    tender_id,
    observed_at,
    trigger_kind,
    status,
    attempts,
    n8n_execution_id,
    action,
    processed_at,
    updated_at
  )
  SELECT
    'tenderplan',
    'tenderplan:key:' || $1::text || ':tender:' || input_rows.tender_id,
    'key_match_baseline',
    input_rows.tender_id,
    $5::timestamptz,
    'tenderplan_key',
    'completed',
    1,
    $4::text,
    'baseline_existing_skipped',
    now(),
    now()
  FROM input_rows
  ON CONFLICT (source, event_key) DO NOTHING
  RETURNING id
),
baseline_marker AS (
  INSERT INTO public.tender_analysis_intake_events (
    source,
    event_key,
    event_type,
    tender_id,
    observed_at,
    trigger_kind,
    status,
    attempts,
    n8n_execution_id,
    action,
    processed_at,
    updated_at
  )
  VALUES (
    'tenderplan',
    'tenderplan:key:' || $1::text || ':baseline:v1',
    'key_baseline_completed',
    'baseline:' || $1::text,
    $5::timestamptz,
    'tenderplan_key',
    'completed',
    1,
    $4::text,
    'baseline_initialized',
    now(),
    now()
  )
  ON CONFLICT (source, event_key) DO NOTHING
  RETURNING id
)
SELECT
  $1::text AS saved_key_id,
  $2::text AS saved_key_name,
  (SELECT count(*)::integer FROM input_rows) AS baseline_tenders_total,
  (SELECT count(*)::integer FROM baseline_events) AS baseline_events_inserted,
  (SELECT count(*)::integer FROM baseline_marker) AS baseline_marker_inserted;
```

Query replacements:

```text
{{ [
  $json.saved_key_id,
  $json.saved_key_name,
  JSON.stringify($json.tender_ids),
  $execution.id,
  $json.observed_at
] }}
```

Это одна PostgreSQL statement: marker не может появиться без завершённой вставки всего baseline в той же транзакции statement.

- [ ] **Step 3: Реализовать `Baseline Summary`**

```javascript
const markerInserted = Number($json.baseline_marker_inserted);
if (![0, 1].includes(markerInserted)) {
  throw new Error('BASELINE_INSERT_RESULT_INVALID');
}
return [{
  json: {
    saved_key_id: $json.saved_key_id,
    saved_key_name: $json.saved_key_name,
    outcome: markerInserted === 1 ? 'baseline_initialized' : 'baseline_race_noop',
    baseline_tenders_total: Number($json.baseline_tenders_total),
    baseline_events_inserted: Number($json.baseline_events_inserted),
    dispatched_count: 0,
  },
}];
```

- [ ] **Step 4: Настроить один batch query `Load Existing Event States`**

```sql
WITH requested AS (
  SELECT DISTINCT value::text AS tender_id
  FROM jsonb_array_elements_text($3::jsonb) AS value
),
classified AS (
  SELECT
    requested.tender_id,
    event_row.status AS existing_status
  FROM requested
  LEFT JOIN public.tender_analysis_intake_events AS event_row
    ON event_row.source = 'tenderplan'
   AND event_row.event_key = 'tenderplan:key:' || $1::text || ':tender:' || requested.tender_id
)
SELECT
  $1::text AS saved_key_id,
  $2::text AS saved_key_name,
  $4::timestamptz AS observed_at,
  COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'tender_id', classified.tender_id,
        'existing_status', classified.existing_status
      )
      ORDER BY classified.tender_id
    ) FILTER (WHERE classified.tender_id IS NOT NULL),
    '[]'::jsonb
  ) AS event_states
FROM classified;
```

Query replacements:

```text
{{ [
  $json.saved_key_id,
  $json.saved_key_name,
  JSON.stringify($json.tender_ids),
  $json.observed_at
] }}
```

- [ ] **Step 5: Реализовать `Build Dispatch Queue`**

```javascript
const rawStates = typeof $json.event_states === 'string'
  ? JSON.parse($json.event_states)
  : $json.event_states;
if (!Array.isArray(rawStates)) throw new Error('EVENT_STATES_INVALID');

const dispatchable = [];
for (const state of rawStates) {
  const status = state.existing_status ?? null;
  if (status === null || status === 'failed') {
    dispatchable.push(state.tender_id);
    continue;
  }
  if (status === 'processing' || status === 'completed') continue;
  throw new Error(`INTAKE_EVENT_STATUS_INVALID: ${String(status)}`);
}

if (dispatchable.length === 0) {
  return [{
    json: {
      saved_key_id: $json.saved_key_id,
      saved_key_name: $json.saved_key_name,
      should_dispatch: false,
      tender_id: null,
      observed_at: $json.observed_at,
      suppressed_count: rawStates.length,
    },
  }];
}

return dispatchable.map((tender_id) => ({
  json: {
    saved_key_id: $json.saved_key_id,
    saved_key_name: $json.saved_key_name,
    should_dispatch: true,
    trigger_kind: 'tenderplan_key',
    source_event_key: `tenderplan:key:${$json.saved_key_id}:tender:${tender_id}`,
    tender_id,
    analysis_run_id: '',
    manual_override: false,
    observed_at: $json.observed_at,
    total_count: rawStates.length,
    suppressed_count: rawStates.length - dispatchable.length,
  },
}));
```

- [ ] **Step 6: Настроить точный dispatch contract**

`Has Dispatch?` проверяет только `{{ $json.should_dispatch }}` через boolean `is true`.

`Execute TENDER — Intake Resume`:

```text
workflow = VO8Ml0sfO65w2Jiz
mode = Run once for each item
wait for sub-workflow completion = false
always output data = true
trigger_kind = {{ $json.trigger_kind }}
source_event_key = {{ $json.source_event_key }}
tender_id = {{ $json.tender_id }}
analysis_run_id = {{ $json.analysis_run_id }}
manual_override = {{ $json.manual_override }}
observed_at = {{ $json.observed_at }}
```

`No New Tenders`:

```javascript
return [{
  json: {
    saved_key_id: $json.saved_key_id,
    saved_key_name: $json.saved_key_name,
    outcome: 'polled',
    discovered_count: Number($json.suppressed_count ?? 0),
    dispatched_count: 0,
  },
}];
```

`Dispatch Summary`:

```javascript
const dispatched = $input.all()
  .map((item) => item.json)
  .filter((item) => item.should_dispatch === true);
const key = dispatched[0];
if (!key) throw new Error('DISPATCH_SUMMARY_WITHOUT_EVENTS');
return [{
  json: {
    saved_key_id: key.saved_key_id,
    saved_key_name: key.saved_key_name,
    outcome: 'polled',
    discovered_count: Number(key.total_count),
    dispatched_count: dispatched.length,
    suppressed_count: Number(key.suppressed_count),
  },
}];
```

- [ ] **Step 7: Завершить behavioral tests**

Проверить через `n8n-code-node-runner.mjs`:

- три страницы дают три уникальных `tender_id`;
- отсутствие финальной пустой страницы даёт `TENDERPLAN_PAGINATION_INCOMPLETE`;
- malformed `tenders` и malformed `_id` дают hard error;
- `completed` и `processing` не dispatch-ятся;
- `failed` и отсутствующий event dispatch-ятся;
- каждый dispatch item имеет ровно согласованный Intake Resume contract;
- два key IDs дают разные event keys;
- baseline SQL содержит marker и per-tender rows в одной statement;
- SQL не создаёт таблицы, parser, validator или field-specific rule.

Run: `node --test tests/tenderplan-saved-key-intake.test.mjs`

Expected: PASS.

- [ ] **Step 8: Commit complete inactive workflow**

```powershell
git add "workflows/n8n-exports/beta/[INACTIVE] TENDER — TenderPlan Saved Key Intake.json" `
  tests/tenderplan-saved-key-intake.test.mjs workflows/tenderplan-saved-key-intake.md
git commit -m "feat(intake): implement atomic saved-key baseline and dispatch"
```

### Task 6: Провести полный offline regression и подготовить deployment package

**Files:**

- Modify: `tests/tenderplan-saved-key-intake.test.mjs`
- Modify: `workflows/tenderplan-saved-key-intake.md`
- Create: `evaluations/TENDERPLAN_SAVED_KEY_INTAKE_CANARY_2026-09-13.md`

- [ ] **Step 1: Добавить cross-workflow static gates**

В `tests/tenderplan-saved-key-intake.test.mjs` проверить:

```javascript
test('saved-key workflow reaches Intake Resume only from the dispatch=true branch', () => {
  const hasDispatch = requireNode(workflow, 'Has Dispatch?');
  assert.equal(hasDispatch.type, 'n8n-nodes-base.if');
  assert.deepEqual(directTargets(workflow, 'Has Dispatch?', 0), ['Execute TENDER — Intake Resume']);
  assert.deepEqual(directTargets(workflow, 'Has Dispatch?', 1), ['No New Tenders']);
  assert.equal(canReach(workflow, 'Initialize Baseline', 'Execute TENDER — Intake Resume'), false);
});

test('saved-key workflow preserves the exact Intake Resume input schema', () => {
  const execute = requireNode(workflow, 'Execute TENDER — Intake Resume');
  assert.equal(execute.parameters.workflowId.value, 'VO8Ml0sfO65w2Jiz');
  assert.equal(execute.parameters.options.waitForSubWorkflow, false);
  assert.deepEqual(
    Object.keys(execute.parameters.workflowInputs.value).sort(),
    [
      'analysis_run_id',
      'manual_override',
      'observed_at',
      'source_event_key',
      'tender_id',
      'trigger_kind',
    ],
  );
});
```

Использовать существующие `requireNode`, `directTargets` и `canReach` из этого test-файла; не добавлять runtime semantic assertions для 27 полей.

- [ ] **Step 2: Запустить целевой regression набор**

```powershell
node --test `
  tests/tenderplan-saved-key-migration.test.mjs `
  tests/tenderplan-saved-key-intake.test.mjs `
  tests/tender-intake-resume.test.mjs `
  tests/tender-orchestrator-input.test.mjs `
  tests/tenderplan-mark-intake.test.mjs `
  tests/tender-manual-resume.test.mjs `
  tests/tender-recovery-scan.test.mjs `
  tests/intake-agentic-shadow-routing.test.mjs
```

Expected: все tests PASS.

- [ ] **Step 3: Запустить весь repository suite**

Run: `node --test tests/*.test.mjs`

Expected: PASS без новых failures. Если существует заранее известный unrelated failure, сохранить точный вывод, подтвердить его на base commit и не маскировать как результат этой функции.

- [ ] **Step 4: Проверить exports и отсутствие secrets**

```powershell
node -e "const fs=require('fs');for(const f of process.argv.slice(1)){JSON.parse(fs.readFileSync(f,'utf8'));console.log('OK',f)}" `
  "workflows/n8n-exports/beta/[INACTIVE] TENDER — TenderPlan Saved Key Intake.json" `
  "workflows/n8n-exports/TENDER — Intake Resume.json" `
  "workflows/n8n-exports/ТЕНДЕРЫ ОРКЕСТРАТОР.json"
rg -n -i "authorization:|bearer [a-z0-9._-]+|password\s*[=:]|proxy.*@" `
  workflows/n8n-exports tests migrations docs/superpowers
git diff --check
```

Expected: три `OK`; secret scan не показывает secret literal в затронутых файлах; `git diff --check` без вывода.

- [ ] **Step 5: Создать canary evidence template без незаполненных утверждений**

В `evaluations/TENDERPLAN_SAVED_KEY_INTAKE_CANARY_2026-09-13.md` заранее записать только:

```markdown
# TenderPlan Saved Key Intake Canary

## Scope

Runtime evidence для baseline, одного нового tender и repeat no-op.

## Acceptance gates

- Все включённые ключи имеют completed baseline marker.
- Baseline execution не вызывает Intake Resume.
- Новый tender создаёт один key event.
- Для `(source=tenderplan, tender_id)` существует не более одного active run.
- Repeat poll не создаёт второй run.
- Первый canary завершается PDF либо фиксированной диагностированной ошибкой.

## Evidence recording rule

Добавлять только фактически проверенные execution IDs, timestamps, counts и outcomes. Не обозначать непроверенное как PASS.
```

- [ ] **Step 6: Commit offline-ready package**

```powershell
git add tests/tenderplan-saved-key-intake.test.mjs `
  workflows/tenderplan-saved-key-intake.md `
  evaluations/TENDERPLAN_SAVED_KEY_INTAKE_CANARY_2026-09-13.md
git commit -m "test(intake): verify saved-key workflow offline"
```

### Task 7: Развернуть изменения в live в неактивном состоянии

**Files:**

- Runtime change: PostgreSQL CHECK only
- Runtime change: live `VO8Ml0sfO65w2Jiz`, two Code nodes only
- Runtime change: live `TRLYuU7mVyE1bjjr`, one allow-list only
- Runtime create: `TENDER — TenderPlan Saved Key Intake`, inactive
- Modify after read-back: repository workflow exports

**Gate:** начинать только после отдельного явного разрешения на live n8n и PostgreSQL. GitHub push сам по себе такого разрешения не даёт.

- [ ] **Step 1: Проверить отсутствие live drift**

Read-only получить оба workflow по ID и сравнить `versionId`, node names, connections и полный код трёх изменяемых Code nodes с Task 0 snapshots.

Expected: live state совпадает со snapshots. При расхождении остановиться, показать diff и перенести минимальный change поверх свежего live export; stale repository JSON не импортировать.

- [ ] **Step 2: Выполнить SQL preflight trigger CHECK**

```sql
SELECT
  constraint_row.conname,
  constraint_row.convalidated,
  pg_catalog.pg_get_constraintdef(constraint_row.oid, true) AS definition
FROM pg_catalog.pg_constraint AS constraint_row
JOIN pg_catalog.pg_class AS table_row
  ON table_row.oid = constraint_row.conrelid
JOIN pg_catalog.pg_namespace AS namespace_row
  ON namespace_row.oid = table_row.relnamespace
WHERE namespace_row.nspname = 'public'
  AND table_row.relname = 'tender_analysis_intake_events'
  AND constraint_row.contype = 'c';
```

Expected: среди трёх CHECK ровно один относится только к `trigger_kind` и разрешает либо точный прежний набор `manual`, `recovery_scan`, `tenderplan_mark`, либо уже применённый точный набор с дополнительным `tenderplan_key`. Любая третья форма блокирует rollout.

- [ ] **Step 3: Применить migration и выполнить postflight**

Через тот же контролируемый SQL path, который применял migration intake-resume, выполнить целиком `migrations/2026-09-13_tenderplan_saved_key_intake.sql`. Затем повторить Step 2 query.

Expected: транзакция committed; trigger CHECK содержит ровно `manual`, `recovery_scan`, `tenderplan_key`, `tenderplan_mark`; таблицы, колонки и индексы не изменились.

- [ ] **Step 4: Обновить Intake Resume и Orchestrator минимальным patch**

Применить только код из Task 2 поверх свежих live objects. Не менять IDs, names, active state, credentials, settings, connections, pinData или другие nodes.

Expected: оба workflow остаются active; read-back показывает только согласованные Code-node diffs.

- [ ] **Step 5: Создать новый workflow inactive**

Импортировать Task 5 candidate, привязать credential references:

```text
TenderPlan Header Auth: E9gI5Mur0c8eFsN0
PostgreSQL: RFpUr3McElcwyoxy
Intake Resume workflow: VO8Ml0sfO65w2Jiz
```

Поместить workflow в существующую папку `TEST AGENTIC TENDER ANALYSIS`. Не publish/activate.

- [ ] **Step 6: Получить реальный список saved keys без раскрытия token**

Создать временный inactive manual-only workflow из двух nodes:

```text
Manual Trigger
→ GET https://tenderplan.ru/api/keys/getall
   authentication = credential E9gI5Mur0c8eFsN0
```

Запустить один раз, записать из response только ID и человекопонятные названия тех saved keys, которые владелец предназначил для автоматизации. Если credential возвращает `403`, не менять его молча: запросить право `keys:read` либо взять ID из интерфейса TenderPlan. После фиксации IDs удалить временный workflow; response не сохранять в repository.

- [ ] **Step 7: Заполнить `Define Saved Keys` фактическим списком**

Для каждого выбранного API-объекта из Step 6 скопировать его 24-символьный ID в `saved_key_id`, отображаемое название без изменения — в `name`, и установить `enabled: true`. Порядок записей — по `saved_key_id`; дубли запрещены. Если API не позволяет однозначно сопоставить ID и название, остановить rollout и показать raw shape без token, а не угадывать mapping. Это единственный runtime-specific edit; реальные ID и названия затем попадают в canonical export, так как не являются secrets.

- [ ] **Step 8: Validate и read-back inactive workflow**

Expected:

- workflow inactive;
- schedule every 10 minutes;
- `Loop Over Saved Keys` batch size `1`;
- HTTP pagination/limit/retry совпадают с Task 4;
- credential IDs совпадают с Step 5;
- error outputs и outer loop connections совпадают с topology;
- config содержит только выбранные enabled keys.

- [ ] **Step 9: Сохранить live read-back в beta export**

Экспортировать live inactive workflow обратно в:

```text
workflows/n8n-exports/beta/[INACTIVE] TENDER — TenderPlan Saved Key Intake.json
```

Удалить `pinData`, но сохранить workflow ID, node IDs, credential references и connections.

### Task 8: Создать baseline и доказать нулевой dispatch

**Files:**

- Modify: `evaluations/TENDERPLAN_SAVED_KEY_INTAKE_CANARY_2026-09-13.md`

- [ ] **Step 1: Запустить inactive workflow вручную один раз**

Expected: execution проходит каждый enabled key, читает все страницы и возвращает по ключу `outcome=baseline_initialized` либо безопасный `baseline_race_noop`; общий `dispatched=0`.

- [ ] **Step 2: Проверить execution path**

Через execution read убедиться, что в первом проходе:

```text
Initialize Baseline executed = true для новых ключей
Execute TENDER — Intake Resume executed = false для новых ключей
Assert Poll Completed success = true
```

- [ ] **Step 3: Проверить persisted baseline SQL-запросом**

```sql
SELECT
  split_part(event_key, ':', 3) AS saved_key_id,
  count(*) FILTER (WHERE event_type = 'key_baseline_completed') AS markers,
  count(*) FILTER (WHERE action = 'baseline_existing_skipped') AS baseline_tenders,
  count(*) FILTER (WHERE analysis_run_id IS NOT NULL) AS linked_runs,
  bool_and(status = 'completed') AS all_completed
FROM public.tender_analysis_intake_events
WHERE source = 'tenderplan'
  AND trigger_kind = 'tenderplan_key'
GROUP BY split_part(event_key, ':', 3)
ORDER BY saved_key_id;
```

Expected per configured key: `markers=1`, `linked_runs=0`, `all_completed=true`; `baseline_tenders` совпадает с execution summary.

- [ ] **Step 4: Выполнить второй ручной poll без изменения saved searches**

Expected: `baseline_initialized=0`, `dispatched=0`, Intake Resume не вызывается, новые ledger rows не появляются.

- [ ] **Step 5: Зафиксировать evidence**

В canary document записать два execution ID, UTC/Moscow timestamps, каждый key ID/name, page count, baseline count, marker count, linked runs и repeat no-op. Не записывать token или response bodies.

### Task 9: Провести один end-to-end canary и только затем включить расписание

**Files:**

- Modify: `evaluations/TENDERPLAN_SAVED_KEY_INTAKE_CANARY_2026-09-13.md`

- [ ] **Step 1: Получить одну новую закупку после baseline**

Добавить контролируемую закупку в один сохранённый поиск штатным действием TenderPlan либо дождаться естественного нового совпадения. Зафиксировать её точный `tender_id` и время первого появления. Не удалять baseline rows и не подделывать API response.

- [ ] **Step 2: Выполнить ручной poll**

Expected: ровно один dispatch item для canary tender; его event key соответствует `tenderplan:key:{saved_key_id}:tender:{tender_id}`.

- [ ] **Step 3: Проверить intake и run uniqueness**

Для точного canary `tender_id`, записанного в Step 1, выполнить:

```sql
SELECT source, tender_id, status, count(*)
FROM public.tender_analysis_runs
WHERE source = 'tenderplan'
  AND tender_id = $1
GROUP BY source, tender_id, status
ORDER BY status;
```

Expected: не более одного run со статусом, отличным от `completed` и `superseded`; key event имеет `attempts=1` после первого успешного claim.

- [ ] **Step 4: Дождаться terminal результата**

Проверить существующую цепочку без изменения её контрактов:

```text
Intake Resume
→ Orchestrator
→ подготовка документов
→ Codex agentic analysis
→ ровно 27 FINAL
→ Finalization
→ PDF
```

Expected: run `completed`, 27 уникальных `field_key`, готовый PDF с читаемым именем. Если run failed, расписание не активировать; диагностировать первую failed node отдельно.

- [ ] **Step 5: Повторить poll**

Expected: второй event не создаётся, второй active/completed run не создаётся, `dispatched=0`.

- [ ] **Step 6: Получить отдельное разрешение на schedule activation**

Показать владельцу baseline evidence, canary execution/run/PDF и repeat no-op. Только после явного подтверждения publish/activate новый workflow.

- [ ] **Step 7: Активировать и проверить следующий scheduled execution**

Expected: расписание действительно выполняется через 10 минут, не создаёт дубли и оставляет Mark Intake активным и неизменённым.

### Task 10: Синхронизировать canonical exports, документацию и handoff

**Files:**

- Create: `workflows/n8n-exports/TENDER — TenderPlan Saved Key Intake.json`
- Modify: `workflows/n8n-exports/TENDER — Intake Resume.json`
- Modify: `workflows/n8n-exports/ТЕНДЕРЫ ОРКЕСТРАТОР.json`
- Modify: `README.md`
- Modify: `ARCHITECTURE.md`
- Modify: `PROJECT_STATUS.md`
- Modify: `TECH_DEBT.md`
- Modify: `DEVELOPMENT_LOG.md`
- Modify: `AGENTS.md`
- Modify: `evaluations/TENDERPLAN_SAVED_KEY_INTAKE_CANARY_2026-09-13.md`

- [ ] **Step 1: Сделать финальный read-back трёх live workflows**

Экспортировать exact active live versions нового workflow, Intake Resume и Orchestrator. Удалить только `pinData` и execution payloads; не реконструировать JSON вручную.

- [ ] **Step 2: Обновить canonical exports**

Новый live export сохранить как `workflows/n8n-exports/TENDER — TenderPlan Saved Key Intake.json`; два существующих canonical exports заменить свежими read-back версиями. Beta pre-change snapshots оставить для audit.

- [ ] **Step 3: Обновить только затронутую документацию**

Зафиксировать:

- новый intake в `README.md` и `ARCHITECTURE.md`;
- проверенный active/inactive state и execution IDs в `PROJECT_STATUS.md`;
- закрытый regression gate или оставшийся blocker в `TECH_DEBT.md`;
- factual chronology в `DEVELOPMENT_LOG.md`;
- фактические PASS/FAIL evidence в canary document.
- новый canonical workflow в project index `AGENTS.md`.

Не менять `FIELD_CATALOG.md`, `REPORT_FIELD_MAPPING.md`, agent skill, runner, document parser или JSON schema 27 полей.

- [ ] **Step 4: Запустить финальную verification**

```powershell
node --test `
  tests/tenderplan-saved-key-migration.test.mjs `
  tests/tenderplan-saved-key-intake.test.mjs `
  tests/tender-intake-resume.test.mjs `
  tests/tender-orchestrator-input.test.mjs `
  tests/tenderplan-mark-intake.test.mjs `
  tests/intake-agentic-shadow-routing.test.mjs
node --test tests/*.test.mjs
git diff --check
git status --short
```

Expected: tests PASS, diff check clean, status содержит только файлы этой функции.

- [ ] **Step 5: Commit финального verified state**

```powershell
git add migrations/2026-09-13_tenderplan_saved_key_intake.sql `
  tests/tenderplan-saved-key-migration.test.mjs `
  tests/tenderplan-saved-key-intake.test.mjs `
  tests/fixtures/tenderplan-saved-key-intake/pages.json `
  tests/helpers/n8n-code-node-runner.mjs `
  "workflows/n8n-exports/TENDER — TenderPlan Saved Key Intake.json" `
  "workflows/n8n-exports/TENDER — Intake Resume.json" `
  "workflows/n8n-exports/ТЕНДЕРЫ ОРКЕСТРАТОР.json" `
  workflows/tenderplan-saved-key-intake.md workflows/intake-resume.md workflows/orchestrator.md `
  DATA_MODEL.md README.md ARCHITECTURE.md PROJECT_STATUS.md TECH_DEBT.md DEVELOPMENT_LOG.md AGENTS.md `
  evaluations/TENDERPLAN_SAVED_KEY_INTAKE_CANARY_2026-09-13.md
git commit -m "feat(intake): activate TenderPlan saved-search capture"
```

- [ ] **Step 6: Подготовить handoff; push только по отдельной команде владельца**

Handoff должен содержать branch, commit hashes, live workflow IDs/version IDs, configured key IDs/names, baseline counts, canary run/PDF, полный test output, rollback и незакрытые ограничения. Не выполнять merge в `main` и не push-ить без явной команды.

## Rollback

1. Деактивировать только `TENDER — TenderPlan Saved Key Intake`.
2. Не удалять baseline и key events: это audit trail и защита от повторного запуска старых закупок.
3. Intake Resume и Orchestrator могут оставить поддержку `tenderplan_key`; без активного producer она не меняет поведение остальных входов.
4. CHECK с новым допустимым значением можно оставить: оно не создаёт события само по себе. Обратную migration делать только отдельным решением после доказательства отсутствия строк `trigger_kind='tenderplan_key'`.
5. Mark Intake, ручная загрузка и текущая агентская цепочка продолжают работать.

## Definition of Done

- Все включённые saved keys имеют по одному valid baseline marker.
- Ноль закупок первоначального baseline отправлено в анализ.
- Новый tender после baseline проходит до готового PDF.
- Повторный poll не создаёт второй event или run.
- Совпадение tender в нескольких keys не создаёт два active run.
- Ошибка страницы или ключа видна как failed execution и не даёт partial dispatch для этого ключа.
- Mark Intake и manual upload не изменили поведение.
- Live read-back совпадает с canonical exports.
- В repository нет secrets, новых document parsers, semantic validators или field-specific rules.
