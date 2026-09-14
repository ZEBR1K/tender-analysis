# Agent visual inspection and office rendering design

## Goal

Remove two observed sources of semantic error in the agentic tender analysis path without adding a field-specific parser or blocking semantic validator:

1. the agent rendered scan pages but never opened the PNGs with vision;
2. LibreOffice 7.4.7 rendered a selected DOCX control as visually blank.

## Verified failure

The production execution for job `ad4aea11-04b8-4d26-a9a1-5d694c5584d8` rendered relevant PDF/DOCX pages, but its Codex event log contains no `view_image` invocation. OCR was not used either. The final result therefore claimed visual inspection that did not happen and misread the scan notation `Епи → Еш` as `Епр → Еп`.

The same run used LibreOffice 7.4.7.2. Its render of the national-regime DOCX page showed all choices blank, while a render made with LibreOffice 26.2.5.2 showed the selected `Не применимо` option.

## Design

- Keep document-method selection with Codex; do not pre-index pages or introduce a coverage parser.
- Strengthen the existing tender skill with an operational definition: creating a PNG is not visual inspection. Every PNG relied upon for a conclusion must be opened with `view_image`; for a scan PDF that is being fully inspected, every rendered page must be opened.
- The agent may still use text extraction or OCR as navigation aids, but visual claims about marks, diagrams, signatures, layout, and scan text require `view_image`.
- If `view_image` is unavailable or a page cannot be opened, the agent records a limitation and must not claim visual inspection.
- Upgrade the runner's LibreOffice to a reproducibly pinned current build close to the known-working local 26.2 series.
- Verify behavior with two narrow canaries: the DOCX page must visibly select `Не применимо`; scan page 4 must be read as `Епи → Еш` through `view_image`.

## Boundaries

No JSON-contract changes, field-specific checks, OOXML selection parser, quote validator, evidence-sufficiency validator, page-coverage counter, or full blind-test execution are included.

## Acceptance criteria

1. The real runner Codex can invoke `view_image` inside its production permission boundary.
2. Tests lock the skill's visual-inspection rule.
3. The runner image reports the pinned upgraded LibreOffice version.
4. The known DOCX render visibly preserves the selected `Не применимо` control.
5. A targeted Codex vision canary reads scan page 4 as `Епи → Еш`.

