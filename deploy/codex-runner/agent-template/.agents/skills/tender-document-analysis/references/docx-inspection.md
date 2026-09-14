# DOCX and OOXML inspection

Use both the rendered document and targeted package structure when controls,
embedded objects, or layout affect the answer.

## Render first

Render the DOCX or Office source with `scripts/render-office.mjs`. Treat the
derived PDF as a viewing aid and follow [PDF inspection](pdf-inspection.md) for
its pages. Confirm tables, page layout, signatures, handwritten content, and
the visible state of any checkbox, radio control, or selected option.

Nearby option text does not prove that an option was selected. A LibreOffice
render can differ from the authoring application when fonts, comments, content
controls, or interactive objects are involved; record that limitation.

## Inspect OOXML only when needed

Use `scripts/ooxml-part.mjs list` to locate a relevant OOXML package part, then
extract only that exact part. Do not unpack every part as a coverage ritual.
Typical relevant parts include `word/document.xml`, relationships, settings,
content-control properties, and an explicitly identified embedded workbook.

The presence of checkbox, radio, or option text in OOXML does not by itself
prove its selected state. Compare structural state with the rendered source.
The helper does not decode ActiveX binary state.

If the visible state and OOXML disagree, or the selected state cannot be
established reliably, use `requires_review` rather than silently choosing one.

For an embedded spreadsheet, extract only the identified package entry and
follow [spreadsheet inspection](spreadsheet-inspection.md). Evidence still cites
the original manifest DOCX and a useful locator, never the derived artifact.
