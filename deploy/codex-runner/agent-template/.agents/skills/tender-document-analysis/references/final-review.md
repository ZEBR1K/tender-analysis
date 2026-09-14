# Final semantic and contract review

Perform this review after all attempted source documents are represented in the
ledger.

## Semantic review

- Compare findings across documents. Keep an unresolved material conflict as
  `requires_review`, name the competing sources, and explain the disagreement.
  Cite each competing source with its manifest `artifact_key` and locator.
- Revisit fragile evidence: selected controls, negations, table associations,
  amounts, dates, units, and short identifiers where one character or symbol
  changes the result. Confirm them from the visual source, not OCR alone.
- Use `not_found` only after attempting the manifest documents that could
  contain the field. Missing information or absence of a search hit does not
  mean “no”, `false`, “not required”, or “not applicable”.
- Never invent a quote, source, locator, inspected method, or successful visual
  check.

## JSON contract review

- Return exactly 27 unique catalog `field_key` values.
- Use only `resolved`, `requires_review`, and `not_found`.
- For `resolved` and `requires_review`, provide evidence with an existing
  manifest `artifact_key` and a filled human locator. Keep `quote`; use `null`
  if an exact quotation is not honestly available.
- For `not_found`, `value_text` may be `null` and evidence may be empty.
- Include the top-level `inspected_documents`, `limitations`, and `constraints`
  audit lists.
- Keep every cited source inside the sealed manifest or the sealed
  `tenderplan-metadata` source.
- Return one JSON object matching `tender_agent_result_v1`, with no surrounding
  prose or Markdown fence.
