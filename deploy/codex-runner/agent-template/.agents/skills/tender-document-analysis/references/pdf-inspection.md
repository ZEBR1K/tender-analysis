# PDF and image inspection

Use this procedure for PDFs and standalone images. The goal is reliable source
inspection, not mechanical conversion coverage.

## Search before rendering

For a PDF with a text layer, use `scripts/search-pdf-text.mjs` to locate likely
pages. Text search is a navigation method. A missing match never proves that a
fact is absent, and extracted text does not preserve all layout, marks, or table
relationships.

Render relevant pages with `scripts/render-pdf-pages.mjs` and open every image
used for a conclusion with `view_image`.

## Scan-only PDFs

When the PDF is a scan and the document must be inspected completely, render
every page in bounded ranges and open each rendered page with `view_image`.
Creating the images is not inspection. Record any page that cannot be opened.

Use `scripts/ocr-image.mjs` only for OCR navigation: it can suggest a page or
region to inspect. Confirm the actual evidence visually. OCR errors and empty
OCR output do not establish absence.

## Fragile visual evidence

Inspect negations, selected marks, handwritten additions, amounts, dates,
percentages, units, table associations, diagrams, and drawings in the rendered
source.

For a short identifier, product mark, model, drawing index, or other value where
one character or symbol changes the meaning, zoom, crop, enlarge, or re-render
the region at higher DPI. Compare ambiguous characters one by one against their
visual form and context. Do not substitute OCR text for this check.

If the source remains unreadable or competing readings are materially
plausible, preserve the uncertainty as `requires_review` and describe the
limitation.
