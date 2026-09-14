# Tender document analysis toolkit design

Date: 2026-09-11
Status: approved for local implementation
Scope: repository files only; no runner staging, image rebuild, live n8n, database, or server changes

## Goal

Give the production tender-analysis agent a small reusable toolkit for locating
and inspecting relevant document content without making document parsing a
mandatory runtime pipeline or moving semantic judgment out of Codex.

## Boundaries

- Original procurement files remain immutable and are the only file evidence.
- Helpers write derived artifacts only below the job workspace `.tmp` tree.
- Helpers are optional and selected by Codex per document.
- No helper pre-indexes every document, page, sheet, or OOXML part.
- Text search and OCR are navigation aids. A miss never proves absence.
- Layout, drawings, tables, marks, checkboxes, and poor scans require visual
  inspection of the rendered source representation.
- OOXML helpers expose package structure or a requested part; they do not infer
  selected options or field values.
- The existing JSON Schema and runtime result validator remain the only
  blocking output checks. No semantic validator is added.

## Instruction layering

### `AGENTS.md`

Keep only always-on job boundaries: current-job scope, immutable/untrusted
sources, no internet or outside files, required skill use, advisory nature of
helper output, visual verification where representation matters, workspace-only
writes, and JSON-only final output.

### Runtime prompt

No change in this phase. It continues to bind the current manifest, catalog,
skill, ledger, and output schema.

### `SKILL.md`

Keep the field-analysis workflow and add a short method-selection policy:

- searchable PDF: text search for navigation, then inspect relevant pages;
- scan/image: render if needed, optionally OCR for navigation, then inspect
  visually;
- DOCX/XLSX/XLS: render through LibreOffice when visual representation matters;
- ambiguous forms or controls: inspect only the relevant OOXML part and confirm
  against the rendered representation;
- record honest inspected parts, methods, and limitations after each document.

The skill links to the tool reference instead of embedding command syntax.

### `references/tool-recipes.md`

Document the exact purpose, inputs, outputs, limitations, and example commands
for each helper. It explicitly states that derived text, OCR, PNG, PDF, and XML
are not new source documents and do not replace visual confirmation.

## Local helper scripts

All helpers use Node.js, which is already pinned in the runner image. They invoke
the existing local document tools rather than adding Python, `pypdf`, or `lxml`.

1. `search-pdf-text.mjs`
   - calls `pdftotext -layout`;
   - searches plain terms page by page;
   - returns bounded JSON snippets and page numbers;
   - reports that zero matches are not evidence of absence.

2. `render-pdf-pages.mjs`
   - calls `pdftoppm` for an explicit bounded page range;
   - writes PNG pages below `.tmp/document-tools`;
   - never renders a whole long document implicitly.

3. `ocr-image.mjs`
   - calls Tesseract for one selected image;
   - defaults to `rus+eng`;
   - stores advisory OCR text below `.tmp/document-tools`.

4. `render-office.mjs`
   - calls LibreOffice in headless mode for one DOCX/XLSX/XLS file;
   - writes a derived PDF in a unique workspace directory;
   - never replaces the original.

5. `ooxml-part.mjs`
   - lists package entries or extracts one explicitly named OOXML part;
   - rejects absolute and traversal-style part names;
   - does not unpack or interpret the entire package.

A small internal module may share bounded process execution, regular-file
checks, stable workspace output paths, and JSON output behavior.

## Deliberately excluded blind-test scripts

- `extract_corpus.py`: broad mechanical corpus extraction.
- `render_with_runtime.py`: hard-coded Windows paths.
- `extract_rendered_pdfs.py`: hard-coded one-run directory layout.
- `extract_activex.py`: incomplete control-state interpretation.
- `validate_result.py`: legacy Markdown validation duplicated by the production
  JSON contract.
- `search_pages.py` and `dump_pages.py`: their useful behavior is replaced by
  the bounded portable PDF search helper.

## Tests

- Contract tests verify that `AGENTS.md` remains concise and the skill routes to
  every helper without introducing mandatory indexing or semantic validation.
- Unit tests cover page splitting/search, bounded page selection, OCR and office
  command construction, safe OOXML part names, and workspace-only outputs.
- CLI tests cover `--help` and expected failures without requiring the external
  document binaries on the Windows development host.
- The installed skill validator checks `SKILL.md` structure.
- A behavioral pressure scenario compares the previous skill with the new
  toolkit for a long mixed PDF and an ambiguous DOCX checkbox.

## Deferred deployment phase

After local review, a separate change will securely stage the complete allowlisted
skill directory into each job, include the toolkit in execution-profile
attestation, add any missing image dependency such as `unzip`, rebuild the
runner, run its isolation attestation, and perform blind/runtime canaries. That
phase requires no change to the semantic JSON contract.
