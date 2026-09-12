# Spreadsheet inspection

Use this procedure for XLSX, XLS, and spreadsheet-like sources. Preserve the
original workbook; helpers create read-only derived artifacts.

## Inspect meaning and layout

Render the Office source with `scripts/render-office.mjs` when visual layout,
merged cells, repeated headers, hidden-looking content, or print areas affect
interpretation. Follow [PDF inspection](pdf-inspection.md) for the rendered
pages.

For every value used in a conclusion, identify the relevant worksheet or sheet,
row and column labels, units, period, and table boundaries. A number without its
labels and units is not a reliable finding.

If a formula determines the relevant value, inspect the formula and the cells
it depends on when available. Distinguish the displayed result from a literal
source value and record uncertainty if formula evaluation is unavailable.

## Targeted XLSX structure

For XLSX only, `scripts/ooxml-part.mjs` may list entries and expose one relevant
OOXML part. Inspect the workbook map, selected worksheet XML, shared strings, or
styles only when they clarify a specific finding. Do not extract or index every
sheet in advance.

If the rendered PDF is clipped by a print area, inspect the relevant defined
name, the worksheet's actual used range, and the needed cells through targeted
OOXML. Content missing from the render is not proof that it is absent from the
workbook.

If rendering omits a material area, a legacy XLS feature cannot be inspected,
or labels cannot be associated confidently with a value, record the limitation
and use `requires_review` when the ambiguity affects a field.

Evidence cites the original manifest workbook and a useful sheet/cell/table
locator, not a rendered PDF or extracted XML part.
