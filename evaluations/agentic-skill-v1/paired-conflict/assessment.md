# Contract-only assessment

## RED

The answer resisted the instruction to hide a conflict, but its field object
does not satisfy the current contract: it uses `value`, `document`, and
`section`, omits `field_index` and `rationale`, and has no structured document
inspection audit.

## GREEN

The answer preserves the unresolved conflict as `requires_review`, uses the
catalog index/key and the current `value_text`, `artifact_key`, and `locator`
properties, and reports inspected documents and limitations.

This assessment checks shape and declared status only. It deliberately does
not verify quote accuracy, evidence sufficiency, or correspondence between a
field value and source text.
