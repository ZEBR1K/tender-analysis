# Local document tool recipes

Run helpers from the job workspace. They write derived artifacts only below
`.tmp/document-tools`. Run `--help` for the accepted arguments.

Derived text, OCR, PNG, PDF, and XML files are inspection aids. They are not
manifest sources and must never be cited as evidence instead of the immutable
original. A failed search, empty text layer, OCR miss, or unavailable tool does
not prove that information is absent.

## Search a PDF text layer

```bash
node .agents/skills/tender-document-analysis/scripts/search-pdf-text.mjs \
  ../input/documents/0001-source.pdf "обеспечение заявки" "срок поставки"
```

`search-pdf-text.mjs` uses Poppler `pdftotext` and returns page numbers plus
bounded snippets. Use it first when a PDF has a useful text layer. It does not
OCR scan-only pages. Inspect a reported page visually before relying on layout,
tables, signs, amounts, or marks.

## Render selected PDF pages

```bash
node .agents/skills/tender-document-analysis/scripts/render-pdf-pages.mjs \
  ../input/documents/0001-source.pdf 43 45 --dpi=250
```

`render-pdf-pages.mjs` uses Poppler `pdftoppm`. One invocation accepts an
explicit range of at most 20 pages and DPI from 96 to 400. Request another
bounded range only when the investigation needs it; do not render a long
document wholesale by default.

## OCR one selected image

```bash
node .agents/skills/tender-document-analysis/scripts/ocr-image.mjs \
  .tmp/document-tools/pdf-render-XXXX/page-43.png --lang=rus+eng
```

`ocr-image.mjs` runs local Tesseract on one image. Use its text to locate likely
content, not as a substitute for viewing the page. Visually confirm negations,
digits, dates, percentages, table associations, checkbox glyphs, and drawings.

## Render one Office source

```bash
node .agents/skills/tender-document-analysis/scripts/render-office.mjs \
  ../input/documents/0002-form.docx
```

`render-office.mjs` uses headless LibreOffice and returns one derived PDF. Search
or render that PDF with the PDF helpers. The conversion may differ from the
authoring application when fonts or interactive controls are involved; record
that limitation and inspect OOXML only when it can clarify a relevant control.

## Inspect one OOXML package part

```bash
node .agents/skills/tender-document-analysis/scripts/ooxml-part.mjs list \
  ../input/documents/0002-form.docx

node .agents/skills/tender-document-analysis/scripts/ooxml-part.mjs extract \
  ../input/documents/0002-form.docx word/document.xml
```

`ooxml-part.mjs` uses local `unzip`. `list` shows package entry names;
`extract` exposes one exact part. Do not extract every part as a coverage ritual.
The helper does not decode ActiveX binary state or decide whether a checkbox is
selected. Compare relevant structure with the rendered source. If the state
cannot be established honestly, use `requires_review` or record a limitation.
