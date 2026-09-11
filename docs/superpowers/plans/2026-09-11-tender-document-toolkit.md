# Tender Document Toolkit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local, repo-scoped skill toolkit that lets Codex search, render, OCR, convert, and selectively inspect procurement documents without mandatory pre-indexing or semantic parsing.

**Architecture:** Keep permanent job boundaries in the existing short `AGENTS.md`, keep method selection in `SKILL.md`, move command detail to one reference, and place five dependency-light Node.js helpers under the skill. Helpers call the already selected local document binaries, write only below workspace `.tmp`, emit bounded JSON, and never decide field values.

**Tech Stack:** Node.js 24 ESM, built-in `node:test`, Poppler CLI, Tesseract CLI, LibreOffice CLI, `unzip` CLI for deferred container enablement.

---

## File map

- Modify `deploy/codex-runner/agent-template/AGENTS.md`: concise always-on boundaries.
- Modify `deploy/codex-runner/agent-template/.agents/skills/tender-document-analysis/SKILL.md`: method selection and helper routing.
- Create `deploy/codex-runner/agent-template/.agents/skills/tender-document-analysis/references/tool-recipes.md`: exact usage and limitations.
- Create `deploy/codex-runner/agent-template/.agents/skills/tender-document-analysis/scripts/document-toolkit-lib.mjs`: shared bounded execution and workspace output utilities.
- Create five helper scripts beside the library: PDF text search, PDF page render, OCR, Office render, and selective OOXML part access.
- Create `tests/agentic-document-toolkit.test.mjs`: contract and unit coverage.
- Modify `evaluations/agentic-skill-v1/pressure-tests.md`: record the observed RED and local GREEN behavior without claiming a paid full-corpus run.

### Task 1: Establish the failing toolkit contract

- [x] Create `tests/agentic-document-toolkit.test.mjs` with assertions that the reference and five helper scripts exist, `SKILL.md` names them, `AGENTS.md` states the OCR/text-miss and visual-confirmation boundaries, and no instruction requires mechanical full-document indexing.
- [x] Add imports for the planned pure helpers and tests for: page-43 text matching, a maximum 20-page render request, DPI bounds, safe OOXML names, traversal rejection, fixed output root, and command argument construction.
- [x] Run `node --test tests/agentic-document-toolkit.test.mjs` and confirm RED because the new files/exports do not exist.

### Task 2: Implement deterministic document helpers

- [x] Create `document-toolkit-lib.mjs` with regular-file/symlink checks, `.tmp/document-tools` output directories, bounded shell-free process execution, and JSON CLI error handling.
- [x] Implement `search-pdf-text.mjs` using `pdftotext -layout -enc UTF-8 <source> -`, form-feed page splitting, case-insensitive plain-term matching, bounded snippets, and the explicit zero-hit warning.
- [x] Implement `render-pdf-pages.mjs` using `pdftoppm -png` for an explicit range of at most 20 pages and DPI 96–400.
- [x] Implement `ocr-image.mjs` using Tesseract on one image, default language `rus+eng`, and an advisory-only text artifact.
- [x] Implement `render-office.mjs` using headless LibreOffice for one DOCX/XLSX/XLS input and one unique derived PDF output directory.
- [x] Implement `ooxml-part.mjs` with `list` and `extract` operations using shell-free `unzip`, rejecting absolute, option-like, control-character, and traversal part names.
- [x] Run `node --test tests/agentic-document-toolkit.test.mjs` and keep changes minimal until GREEN.

### Task 3: Update layered instructions

- [x] Reduce `AGENTS.md` to always-on job, trust, source, visual-verification, write-boundary, and output rules.
- [x] Update `SKILL.md` with the approved document-method decision policy and link `references/tool-recipes.md`; keep field semantics and exact-27 output behavior unchanged.
- [x] Add `tool-recipes.md` with one entry per helper: purpose, command, output, when to use, and when not to trust it.
- [x] Re-run the focused test and the existing `tests/agentic-codex-command.test.mjs` suite; adjust the existing contract test only where it incorrectly assumes that a focused skill can never contain optional tools.

### Task 4: Validate the skill and behavioral boundary

- [x] Run the installed `quick_validate.py` against the skill directory and record its exact result.
- [x] Run the existing agentic runner suites that do not require Docker or production access.
- [x] Give the same long-PDF/ambiguous-DOCX scenario to the RED-baseline reviewer using the new skill and record whether it selects bounded helpers, treats OCR as navigation, and visually confirms relevant pages/controls.
- [x] Update `evaluations/agentic-skill-v1/pressure-tests.md` with the RED/GREEN comparison, explicitly separating local behavioral review from paid blind/runtime evidence.
- [x] Run `git diff --check`, inspect `git diff`, and leave server deployment, runner staging, Docker dependency installation, runtime attestation changes, n8n, and DB untouched.
