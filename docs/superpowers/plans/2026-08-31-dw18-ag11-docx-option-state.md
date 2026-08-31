# DW-18 / AG-11 DOCX Option-State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve deterministic DOCX ActiveX checkbox/OptionButton state through Document Worker semantic blocks and prevent `national_regime` from becoming a positive `resolved` result when applicability is not grounded.

**Architecture:** Add a source-aware, fail-closed option-state boundary before Document Worker semantic analysis. Prefer an already structured state from raw Docling if execution evidence proves it exists; otherwise decode OOXML relationships plus the MS-OFORMS `Value` property from the related ActiveX CFB stream without byte-offset or document-specific hardcoding. Propagate versioned option-state records into semantic blocks, then add an independent Aggregator applicability guard.

**Tech Stack:** n8n workflow JSON, JavaScript Code nodes, native n8n binary/archive/XML capabilities where available, OOXML OPC relationships, Microsoft CFB/MS-OFORMS specifications, Node.js `node:test`, execution-derived fixtures.

---

## Confirmed safety contract

- `Value="1"` means selected, `Value="0"` means cleared, any other value means indeterminate; missing or malformed state is `unknown`.
- Never infer state from a control name, ActiveX part number, exact tender phrase, image hash, majority vote, or physical byte offset.
- Never ask an LLM to infer a selected option from adjacent text.
- `unknown`, `indeterminate`, missing relationship, unsupported persistence, and ambiguous label mapping fail closed; none can prove positive or negative applicability.
- Preserve original source text and evidence quotes. Machine-readable option metadata augments provenance and must not rewrite canonical text.
- Do not commit the full client DOCX without explicit approval. Use a minimal derived fixture after content/secret review and record the full-source SHA-256.
- Do not change production workflows, production PostgreSQL, credentials, prompts, or the 27 canonical `field_key` values.

## Exact source evidence

Source file outside the repository:

```text
C:\Users\kosty\Desktop\проект тендеры\тестовая закупка\ДЛЯ ТЕСТА ЗАКУПКА\КТ172 документы\Блок_2_Информационная_карта.docx
```

Known control mapping:

```text
national_regime / row 3.3.1
CommonSupplierCheckBox11 -> activeX5  -> unselected
CommonSupplierCheckBox12 -> activeX6  -> unselected
CommonSupplierCheckBox13 -> activeX7  -> unselected
CommonSupplierCheckBox14 -> activeX8  -> selected -> «Не применимо.»

participation_guarantee / row 3.7.1
OptionButton25221111131  -> activeX55 -> selected -> «Не предусмотрены;»
OptionButton252211111211 -> activeX56 -> unselected -> «Предусмотрены…»
```

Relevant Microsoft specifications:

- `MS-OFORMS Value`: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-oforms/0992cd3a-9a63-4e95-91ae-43c025082847
- Full `MS-OFORMS`: https://officeprotocoldoc.z19.web.core.windows.net/files/MS-OFORMS/%5BMS-OFORMS%5D.pdf
- Use the Microsoft CFB specification for compound-stream traversal; do not replace it with observed offsets.

---

### Task 1: Freeze authoritative implementation and execution evidence

**Files:**

- Read: `AGENTS.md`
- Read: `README.md`
- Read: `ARCHITECTURE.md`
- Read: `PROJECT_STATUS.md`
- Read: `TECH_DEBT.md`
- Read: `DATA_MODEL.md`
- Read: `FIELD_CATALOG.md`
- Read: `workflows/document-worker.md`
- Read: `workflows/aggregator.md`
- Read: `workflows/n8n-exports/TENDER — Обработать документ.json`
- Read: `workflows/n8n-exports/TENDER — Агрегация закупки.json`

- [ ] **Step 1: Create an isolated worktree**

Create branch `codex/dw18-ag11-option-state` from commit `da7bb7aaa929db94ac1c0b27a2aba00d140f0a5c` using the `using-git-worktrees` skill. Do not edit the source checkout.

- [ ] **Step 2: Record initial Git state**

Run:

```powershell
git status -sb
git log --oneline --decorate -5
```

Expected: isolated feature branch based on `da7bb7a`, no unrelated changes.

- [ ] **Step 3: Refresh live test Worker read-only**

Inspect workflow `csnDg78NzN1nIjUT` and compare:

```text
published active version c5977af5-c263-4846-8af2-762b85edcc87
current draft version 778dfb50-72be-434d-ba82-2f8fcf90daec
```

Explain the draft-only 52nd node before using either graph as an implementation base. If the live API remains unavailable after bounded retries, continue only with offline fixtures/tests and do not mutate n8n.

- [ ] **Step 4: Inspect execution-derived parser data**

Read execution `14234` and the raw Docling response for the source document. Search structurally for `checked`, `selected`, `value`, form/control objects, ActiveX identifiers, and source coordinates.

Decision:

```text
structured state exists -> extend current normalizer minimally
structured state absent -> use standards-based OOXML/CFB/MS-OFORMS parser
```

Do not implement both paths.

- [ ] **Step 5: Confirm first incorrect state**

Document the exact node where state first disappears and confirm Aggregator execution `14336` created `national_regime/resolved` from generic/conditional PP 1875 candidates after the loss.

---

### Task 2: Create a safe exact-source regression fixture

**Files:**

- Create: `tests/fixtures/document-worker-docx-option-state/manifest.json`
- Create: minimal files under `tests/fixtures/document-worker-docx-option-state/ooxml/`
- Create: `tests/document-worker-docx-option-state.test.mjs`

- [ ] **Step 1: Hash and inventory the source**

Compute SHA-256 of the full DOCX and inventory only the required OPC parts:

```text
word/document.xml
word/_rels/document.xml.rels
word/activeX/activeX5.xml + rels + bin
word/activeX/activeX6.xml + rels + bin
word/activeX/activeX7.xml + rels + bin
word/activeX/activeX8.xml + rels + bin
word/activeX/activeX55.xml + rels + bin
word/activeX/activeX56.xml + rels + bin
the minimal table-row/control-label XML necessary for mapping
```

- [ ] **Step 2: Create a minimal derived fixture**

The manifest must record:

```json
{
  "contract_version": "docx_option_state_fixture_v1",
  "source_file_name": "Блок_2_Информационная_карта.docx",
  "source_sha256": "32f79d377ad3b775497e70754bdfdce8ec0928cfeb2626d60ca65ef519f7437b",
  "derived_parts": [],
  "expected_controls": []
}
```

Before staging, scan the derived fixture for credentials, personal data, unrelated procurement content, and excessive source text. Do not place the full DOCX in the repository.

- [ ] **Step 3: Write the initial failing parser test**

The test must load the actual workflow Code-node boundary, not a mock implementation. Assert:

```text
activeX8  -> selected
activeX5/6/7 -> unselected
activeX55 -> selected
activeX56 -> unselected
selected labels map to the exact source rows
```

- [ ] **Step 4: Write fail-closed controls**

Add separate tests for:

```text
missing document relationship
missing ActiveX relationship
unknown CLSID
malformed CFB
unsupported persistence
missing Value
Value other than 0/1
one control mapping to multiple labels
one label mapping to multiple controls
```

Expected output is `unknown` or `indeterminate` with audit warnings; none may be `selected`.

- [ ] **Step 5: Verify RED**

Run:

```powershell
node --test tests/document-worker-docx-option-state.test.mjs
```

Expected: assertion failure caused by missing option-state behavior, not fixture or syntax errors. Capture the RED output in the development log only after confirming it is the intended failure.

---

### Task 3: Implement deterministic source parsing

**Files:**

- Modify: `workflows/n8n-exports/TENDER — Обработать документ.json`
- Modify: only the corresponding explicit test/beta Worker export chosen after live diff
- Test: `tests/document-worker-docx-option-state.test.mjs`

- [ ] **Step 1: Define the output contract**

Every record must match:

```json
{
  "contract_version": "docx_option_state_v1",
  "control_name": "string",
  "control_type": "checkbox|option_button|unsupported",
  "state": "selected|unselected|indeterminate|unknown",
  "exact_label": "string|null",
  "group_context": "string|null",
  "document_part": "word/document.xml",
  "control_rel_target": "string|null",
  "binary_rel_target": "string|null",
  "source_row_ref": "string|null",
  "warnings": []
}
```

- [ ] **Step 2: Reuse existing structured state if proven**

If Task 1 proves raw Docling already contains an authoritative state, extend `Нормализовать документ Docling` while preserving every existing guard and provenance field. Add tests proving the state is source-provided rather than inferred.

- [ ] **Step 3: Otherwise add a standards-based source boundary**

Use native n8n binary/archive/XML nodes where possible. Custom JavaScript is allowed only for OPC relationship joining, CFB stream traversal, and MS-OFORMS decoding that native nodes cannot perform.

Required behavior:

```text
original DOCX binary remains available for Docling upload
DOCX-only branch extracts required OPC parts
PDF/XLSX routes remain byte-for-byte behaviorally unchanged
CFB parser locates the named contents stream through the directory/FAT structures
MS-OFORMS parser reads the Value property by specification
parser enforces entry/size/resource limits
all unsupported states produce audit + unknown, not guessed state
```

Explicitly forbidden:

```text
buffer[2088]
activeX8 means selected
CommonSupplierCheckBox14 means selected
hash(image5.wmf) means selected
regex-only parsing of arbitrary XML without structural guards
new external runtime dependency without a separate approved infrastructure decision
```

- [ ] **Step 4: Verify focused GREEN**

Run the focused test. Expected: all exact-source and negative-control cases pass.

- [ ] **Step 5: Verify non-DOCX controls**

Add tests proving PDF and XLSX items bypass option parsing and retain the original JSON/binary contract.

---

### Task 4: Propagate option state into semantic blocks

**Files:**

- Modify: `workflows/n8n-exports/TENDER — Обработать документ.json`
- Modify: corresponding test/beta Worker export
- Test: `tests/document-worker-docx-option-state.test.mjs`

- [ ] **Step 1: Write semantic propagation RED**

Execute the real normalization and semantic-building Code nodes from workflow JSON. Assert that selected option records are absent from semantic blocks before the implementation.

- [ ] **Step 2: Add minimal propagation**

Attach `docx_option_state_v1` records to the normalized source element and semantic block that owns the exact label. Preserve original block text, table coordinates, source references, primary/overlap rules, and anti-data-loss coverage.

- [ ] **Step 3: Add an explicit human-readable marker**

The AI-visible representation may add a deterministic marker such as:

```text
[OPTION_STATE selected] Не применимо.
```

The marker is metadata, not a replacement quote. Evidence quotes must remain substrings of canonical source text.

- [ ] **Step 4: Enforce candidate applicability**

Prove that unselected positive national-regime options and unselected `Предусмотрены` for participation guarantee cannot become applicable candidates. `unknown` and `indeterminate` remain review context only.

- [ ] **Step 5: Verify focused GREEN and existing Worker regressions**

Run the new test and all existing `document-worker-*.test.mjs` suites.

---

### Task 5: Add AG-11 fail-closed Aggregator containment

**Files:**

- Create: `tests/aggregator-national-regime-option-state.test.mjs`
- Create: minimal anti-overfit fixture under `tests/fixtures/aggregator/`
- Modify: `workflows/n8n-exports/TENDER — Агрегация закупки.json`
- Modify: corresponding explicit test/beta Aggregator export
- Modify: `workflows/aggregator.md`

- [ ] **Step 1: Write execution-derived RED**

Reproduce the `14336` candidate shape without tender/run-specific literals. A schema-valid response that marks generic or conditional PP 1875 clauses primary and returns `national_regime/resolved` must currently fail the semantic oracle.

- [ ] **Step 2: Add anti-overfit controls**

Test at least:

```text
explicit selected «Не применимо» + provenance -> negative resolved allowed
concrete measure explicitly applicable to current procurement -> positive resolved allowed
generic legal boilerplate only -> requires_recheck
option labels present but no state -> requires_recheck
ambiguous/indeterminate state -> requires_recheck
raw requires_review remains requires_review
unrelated field resolved remains unchanged
```

- [ ] **Step 3: Verify RED**

Run the new Aggregator test and confirm failure is the observed false-resolved path.

- [ ] **Step 4: Implement the minimal guard**

Place the field-specific boundary after universal schema/cardinality/linking/status validation and before FINAL materialization. Preserve reported/effective status, candidates, decisions, evidence, provisional text, policy name, and containment reason.

Effective routing:

```text
reported positive resolved without applicability proof
  -> effective requires_recheck / insufficient_evidence

explicit selected negative with grounded option-state provenance
  -> resolved allowed

terminal unresolved after Targeted Recheck
  -> requires_review, never synthetic negative and never not_found from absence
```

- [ ] **Step 5: Verify GREEN and neutral controls**

Run AG-11 focused tests plus AG-8/AG-9/AG-10 and Targeted Recheck related suites. No existing safety guard may be weakened.

---

### Task 6: Package and validate test workflows

**Files:**

- Modify only the canonical/test exports proven authoritative during Task 1
- Modify: `workflows/document-worker.md`
- Modify: `PROJECT_STATUS.md`
- Modify: `TECH_DEBT.md`
- Modify: `DEVELOPMENT_LOG.md`

- [ ] **Step 1: Audit the workflow diff**

Confirm minimal node/connection changes, unique node IDs/names, no disabled reachable test nodes, no credentials or secrets, and preserved binary/data contracts.

- [ ] **Step 2: Validate offline workflow contracts**

Run graph validation and existing canonical-vs-beta packaging tests. If an n8n Code node is changed, test its exact `jsCode` from the JSON export.

- [ ] **Step 3: Update only clearly named test/candidate workflows**

After offline GREEN and successful live refresh, update only the isolated test/candidate Worker and Aggregator. Do not edit or publish production workflows. Read back the saved draft, validate connections, then publish the test version only if runtime canary requires it.

- [ ] **Step 4: Preserve immutable snapshots**

Save pre-change and post-change live test snapshots in `workflows/n8n-exports/beta/` with workflow/version IDs and SHA-256. Never overwrite a snapshot representing historical execution evidence.

---

### Task 7: Run bounded runtime canary

**Files:**

- Create: `evaluations/DW18_AG11_DOCX_OPTION_STATE_CANARY_2026-08-31.md`

- [ ] **Step 1: Execute the source document in the isolated test contour**

No manual DB status bypass. Capture Worker execution ID and verify:

```text
national_regime selected option = Не применимо
participation_guarantee selected option = Не предусмотрены
unselected positive options are not applicable candidates
exact evidence/provenance retained
document reaches completed or an explicitly diagnosed terminal error
```

- [ ] **Step 2: Execute test Aggregator**

Verify that generic PP 1875 clauses cannot produce positive `national_regime/resolved`, and that the selected negative state is used only when grounded provenance survives Worker persistence.

- [ ] **Step 3: Record runtime evidence**

Record workflow IDs, version IDs, execution IDs, source/fixture hashes, field statuses, selected candidates, and any review status. Do not claim a clean 12/12 run; this canary covers the focused source document and fields only.

---

### Task 8: Final verification and handoff

**Files:**

- Review every changed file
- Update documentation only to the actually verified state

- [ ] **Step 1: Run focused and related suites**

```powershell
node --test tests/document-worker-docx-option-state.test.mjs
node --test tests/aggregator-national-regime-option-state.test.mjs
node --test tests/document-worker-*.test.mjs
```

- [ ] **Step 2: Run the full offline suite**

```powershell
node --test tests/*.test.mjs
```

Any new failure blocks completion. The only acceptable known RED is the separately documented intentional AG-8 production-promotion gate if it still exists and was not accidentally weakened.

- [ ] **Step 3: Run repository checks**

```powershell
git diff --check
git status -sb
git diff --stat
```

Perform a secret scan without printing matched values.

- [ ] **Step 4: Self-review scope and semantics**

Confirm:

```text
no byte-offset/name/tender hardcoding
no fuzzy evidence relaxation
not_found semantics unchanged
27 field catalog unchanged
PDF/XLSX paths unchanged
production workflow/DB unchanged
runtime proof is focused, not overstated
```

- [ ] **Step 5: Commit feature branch**

Commit only related implementation, tests, derived fixture, evidence, and documentation. Do not merge or promote production.

- [ ] **Step 6: Report to orchestrator**

Provide root cause, exact changed files/nodes/contracts, RED and GREEN commands/results, runtime execution IDs, verified/not verified list, commit hash, and any production-promotion decision still pending.

## Stop condition

If reliable MS-OFORMS parsing cannot run in the current n8n environment without a new dependency or infrastructure component, stop after the exact RED and feasibility proof. Do not ship an offset hack. Present 2–3 bounded deployment options with reliability, operational, and migration trade-offs and recommend one for explicit approval.

