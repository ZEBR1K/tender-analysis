# DW-23 ActiveX Three-Way Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan with specification and quality reviews.

**Goal:** Create one Worker that simultaneously passes the current group-local ActiveX, JSONB-safe identity, DW-22 overflow, and DW-23 selective-retry contracts, then add only the approved live-test operational settings.

**Architecture:** Use `03fee9b` as the functional base because it passes the current ActiveX owner suite and contains DW-22. Semantically merge the selective-retry contour from `012bcff` and the JSON-tuple identity rules from `689859e`; never replace a complete `03fee9b` owner-aware Code node wholesale with an older branch version. Existing regression tests are the merge oracle.

**Tech Stack:** n8n workflow JSON, JavaScript Code nodes, Node.js built-in test runner, Git.

---

## File map

- Modify: `workflows/n8n-exports/TENDER — Обработать документ.json` — reconciled Worker.
- Create: `tests/document-worker-live-test-overlay.test.mjs` — operational-overlay contract.
- Modify: `workflows/document-worker.md` — reconciled candidate boundary.
- Modify: `PROJECT_STATUS.md` — verified state and pending runtime step.

### Task 1: Establish the three source boundaries

**Files:**
- Modify: `workflows/n8n-exports/TENDER — Обработать документ.json`

- [ ] Record current RED results with:

```powershell
node --test tests/document-worker-docx-option-owner.test.mjs tests/document-worker-docx-option-state.test.mjs tests/document-worker-evidence-repair.test.mjs tests/document-worker-extractor-envelope.test.mjs tests/document-worker-extractor-recovery.test.mjs tests/document-worker-validator-selective-retry.test.mjs
```

- [ ] Restore only the Worker from `03fee9b`:

```powershell
git restore --source=03fee9b -- 'workflows/n8n-exports/TENDER — Обработать документ.json'
```

- [ ] Run the ActiveX and Evidence Repair suites:

```powershell
node --test tests/document-worker-docx-option-owner.test.mjs tests/document-worker-docx-option-state.test.mjs tests/document-worker-evidence-repair.test.mjs
```

Expected: all option-owner behavior tests pass. Remaining failures must be limited to the known fixture/package pins and tests requiring the not-yet-integrated DW-23 graph.

### Task 2: Integrate JSONB-safe identities without replacing owner logic

**Files:**
- Modify: `workflows/n8n-exports/TENDER — Обработать документ.json`
- Test: `tests/document-worker-docx-option-owner.test.mjs`
- Test: `tests/document-worker-docx-option-state.test.mjs`
- Test: `tests/document-worker-validator-selective-retry.test.mjs`

- [ ] Compare the relevant Code nodes between `03fee9b` and `689859e`, but edit the `03fee9b` bodies rather than copying the older bodies wholesale:

```text
Нормализовать документ Docling
Разобрать состояния DOCX ActiveX
Развернуть части для AI v1.2
Собрать смысловые разделы v1.4
```

- [ ] Encode every persisted structural identity as a versioned JSON tuple:

```javascript
const controlIdentity = `v2i:${JSON.stringify([
  documentPart,
  controlRelationshipTarget,
])}`;

const questionIdentity = `v2q:${JSON.stringify([
  sourceTableRef,
  sourceRowIndex,
  normalizedQuestionLabel,
])}`;

const groupIdentity = `v2g:${JSON.stringify([
  ownerBlockId,
  sourceTableRef,
  controlType,
  groupDiscriminator,
])}`;
```

Internal composite keys that can flow into persisted audit/envelopes must use JSON tuples as well; do not use `.join('\\u0000')` or concatenated NUL separators. Preserve all `owner_status`, group-local applicability, exact-label, and fail-closed behavior from `03fee9b`.

- [ ] Run:

```powershell
node --test tests/document-worker-docx-option-owner.test.mjs tests/document-worker-docx-option-state.test.mjs tests/document-worker-validator-selective-retry.test.mjs
```

Expected: JSONB identity checks and all ActiveX owner behavior checks pass; selective-retry topology tests may still fail because Task 3 has not added that graph.

### Task 3: Integrate selective Validator retry into the owner-aware Worker

**Files:**
- Modify: `workflows/n8n-exports/TENDER — Обработать документ.json`
- Test: `tests/document-worker-validator-selective-retry.test.mjs`
- Test: `tests/document-worker-evidence-repair.test.mjs`

- [ ] Add the 14 retry-only nodes from `012bcff` with their exact tested parameters and edges:

```text
Классифицировать primary AI Validator
Есть contract-invalid Validator facts?
Развернуть Validator retry queue
Обработать Validator retry facts по одной
AI Validator retry attempt 2
Классифицировать Validator retry attempt 2
Validator retry attempt 2 accepted?
Wait before Validator retry attempt 3
AI Validator retry attempt 3
Классифицировать Validator retry attempt 3
Validator retry attempt 3 accepted?
Сформировать Validator technical fallback
Собрать ответы AI Validator после retry
Собрать ответы AI Validator без retry
```

- [ ] Set `Обработать Validator retry facts по одной.parameters.batchSize` explicitly to `1`. The primary `AI Validator v1` must remain outside this loop.

- [ ] Semantically merge, rather than wholesale replace, these shared nodes:

```text
Подготовить dispatch AI Validator
Развернуть units для AI Validator
Проверить ответ AI Validator
Собрать факты документа1
```

The combined bodies must preserve the `03fee9b` option-owner caps and audits while adding the `012bcff` immutable `ai_validator_source_envelope_v1`, system-owned `validator_retry_audit`, fact-identity reassembly, three-attempt bound, and deterministic `requires_review` terminal fallback.

- [ ] Preserve DW-22 `target_ranked_windows` code from `03fee9b`. Do not copy Evidence Repair nodes from `012bcff` unless a selective-retry test proves a specific shared-contract change is required.

- [ ] Run:

```powershell
node --test tests/document-worker-docx-option-owner.test.mjs tests/document-worker-docx-option-state.test.mjs tests/document-worker-evidence-repair.test.mjs tests/document-worker-validator-selective-retry.test.mjs
```

Expected: all behavioral ActiveX, DW-22, and DW-23 tests pass. Only immutable fixture/package hash pins already present independently of this implementation may remain RED.

### Task 4: Preserve Extractor recovery contracts

**Files:**
- Modify only if required: `workflows/n8n-exports/TENDER — Обработать документ.json`
- Test: `tests/document-worker-extractor-envelope.test.mjs`
- Test: `tests/document-worker-extractor-recovery.test.mjs`

- [ ] Run:

```powershell
node --test tests/document-worker-extractor-envelope.test.mjs tests/document-worker-extractor-recovery.test.mjs
```

- [ ] If a failure is caused by the base boundary, restore the failing Extractor node or connection from the latest commit that made that named test GREEN, while preserving the merged ActiveX and Validator nodes. Do not change prompts, fallback cardinality, evidence semantics, or provider settings merely to satisfy a hash.

Expected: all behavioral Extractor envelope/recovery tests pass. Any immutable byte-pin mismatch must be reported separately.

### Task 5: Add the approved live-test operational overlay

**Files:**
- Create: `tests/document-worker-live-test-overlay.test.mjs`
- Modify: `workflows/n8n-exports/TENDER — Обработать документ.json`

- [ ] Add a test asserting:

```text
id = URFdslUfULtOLv9B
name = [DW-23 TEST CODEX] TENDER — Обработать документ
active = true
pinData is empty
errorWorkflow = jYzQ8RtNmnTM2PGz
Aggregator workflowId = ftvmrEHoMbPOAqZG
Extractor model = z-ai/glm-5.3-flash@provider=novita/fp8&reasoning_effort=low
Обработать evidence units по одной output 1 -> Wait(amount=2) -> Primary Extractor accepted?
```

Do not assert or copy volatile `versionId` or `meta`. Run the test first and confirm RED.

- [ ] Apply only those fields and edges. Preserve the merged Code-node bodies, base node IDs where possible, credentials, prompts, batching, timeout, and response format.

- [ ] Run the overlay test and the complete focused Worker suite. Expected: overlay passes and no behavioral regression is introduced.

### Task 6: Final verification, documentation, and commit

**Files:**
- Modify: `workflows/document-worker.md`
- Modify: `PROJECT_STATUS.md`
- Modify: `workflows/n8n-exports/TENDER — Обработать документ.json`
- Create: `tests/document-worker-live-test-overlay.test.mjs`

- [ ] Validate JSON structure: exactly 86 unique node names after adding the operational Wait; every connection source and target resolves.

- [ ] Run the full suite:

```powershell
node --test
```

Report exact totals and exact remaining failure names. Do not weaken or relabel tests. Any new behavioral Worker failure blocks completion.

- [ ] Update documentation with the actual three-way sources (`03fee9b`, `689859e`, `012bcff`), the operational overlay, verification totals, and the explicit statement that live n8n/PostgreSQL were not modified. Next runtime step is manual import, read-back comparison, and canary.

- [ ] Run `git diff --check`, structural checks, focused tests, full tests, and a filename-only secret-pattern scan.

- [ ] Commit only the Worker export, overlay test, `workflows/document-worker.md`, and `PROJECT_STATUS.md`:

```powershell
git add -- 'workflows/n8n-exports/TENDER — Обработать документ.json' 'tests/document-worker-live-test-overlay.test.mjs' 'workflows/document-worker.md' 'PROJECT_STATUS.md'
git commit -m "fix(worker): reconcile DW-23 with ActiveX ownership"
```

Do not stage other workflow exports. Do not push, merge, import, publish, activate, or write to live n8n or PostgreSQL.
