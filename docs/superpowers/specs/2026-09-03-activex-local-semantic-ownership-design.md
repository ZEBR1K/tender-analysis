# DOCX ActiveX Local Semantic Ownership Design

**Status:** proposed for independent logic review
**Runtime basis:** manual parent execution `14409`, Document Worker child
execution `14410`
**Scope:** canonical Document Worker export and regression artifacts only

## Problem statement

The parser correctly decodes ActiveX state and the Normalizer correctly attaches
the two business-critical option groups to their exact tables. Nevertheless,
unrelated unresolved controls elsewhere in the document set a document-wide
semantic status to `unknown`. Downstream then caps locally exact selected
negative facts to review. Grounding and applicability are being conflated.

The design separates three questions:

1. Was the control state decoded from its canonical OOXML/ActiveX source?
2. Was that control deterministically owned by one exact semantic block and row?
3. Is the option group locally complete and non-conflicting for applicability?

A positive or negative fact is applicable only when all three answers are
locally proven. Unrelated failures remain in the document audit but cannot
invalidate a proven local group.

## Stable identities and coordinates

Each source control retains its lossless canonical fields. With the current v1
upstream contract, its immutable `control_identity_key` is the tuple:

```text
document_part
+ control_rel_target
```

Both values must be non-empty canonical OPC paths. A missing relationship target
is unidentifiable and therefore `unknown`; it cannot be deduplicated by name or
label. A separate observed snapshot contains:

```text
control_name + control_type + binary_rel_target + source_row_ref
+ exact_label + state + raw_value + group_context
```

`source_row_ref` in that snapshot is parsed structurally as
`word/document.xml#table[n]/row[m]`; it is never inferred from a label. The
semantic owner identity is the canonical Docling `block_id`/table reference plus
the normalized semantic block id. A binding record carries both source and
semantic coordinates and never substitutes one for the other.

Repeated `control_identity_key` values with unequal observed snapshots are
`conflict`, including any changed state, binary target, label, group or
coordinate. Missing, malformed, orphaned or cyclic relationships are `unknown`.
No control number, client text or expected result participates in identity or
state calculation. If a future parser adds relationship IDs, it may introduce a
new versioned identity contract; v2 semantic code must not assume fields absent
from `docx_option_state_v1`.

## Deterministic ownership algorithm

1. Decode the OOXML `w:control` relationship chain and MS-OFORMS `Value` using
   the existing bounded parser. Preserve every raw relationship and warning.
2. Partition controls by exact source table coordinate. Reject the whole source
   table partition when one stable identity has contradictory coordinates.
3. Build a source-row signature from ordered, canonical row labels. Matching may
   normalize Unicode whitespace only; canonical source text is unchanged.
4. Compare the ordered signature against each normalized Docling table using a
   single relative row offset. Nested tables are matched only against their own
   rows; ancestor-cell text must not absorb descendant-table labels.
5. Accept ownership only when exactly one Docling table and one row mapping fit
   the entire source-table partition. Zero or multiple owners are unresolved.
6. Attach each accepted control once to the exact normalized table and carry the
   binding through its semantic block. Duplicate labels elsewhere are irrelevant.
7. Classify local groups using the versioned rules below. Group identity is
   structural and cannot be label-only.

One-control/multiple-label and multiple-control/one-label mappings are
unresolved unless the complete ordered row mapping remains one-to-one. Repeated
or nested tables require a unique structural owner. Orphan or cyclic relations
never enter ownership matching.

### Deterministic group classification v1

`group_context` is only the exact MS-OFORMS GroupName decoded by the bounded
parser. Matching trims leading/trailing Unicode whitespace but does not case-fold
or infer aliases; the original value remains in audit. Empty, malformed or
contradictory GroupName observations are unresolved.

The structural group key always includes the unique semantic owner, exact source
table, control type and classification discriminator:

```text
option_button + non-empty GroupName
→ owner/source-table/type/GroupName

checkbox + non-empty GroupName
→ owner/source-table/type/GroupName

checkbox + absent GroupName
→ owner/source-table/type/control_identity_key (independent singleton)

option_button + absent GroupName
→ unresolved (radio membership cannot be inferred from table or label)
```

Controls of mixed type never share a group. Distinct GroupName values in one
table are distinct groups. The same GroupName in different source tables is not
the same group. Checkbox groups are independent-selection sets: zero, one or
multiple selected members are permitted when all members are decoded. Radio
groups require exactly one selected member. All-cleared radio groups are
`unknown` by default. The current v1 parser has no authoritative all-cleared
allowance, so no exception exists. A future allowance must be a separately
versioned, parser-proven source field; a caller or LLM flag is forbidden.

## State and verdict contracts

Source state remains:

```text
selected | unselected | indeterminate | unknown | conflict
```

Every semantic block receives a container of group-local verdicts independent
of the document audit:

```json
{
  "contract_version": "docx_option_state_semantic_v2",
  "docling_block_id": "#/tables/n",
  "semantic_block_id": "sb_...",
  "option_groups": [
    {
      "group_id": "stable structural id",
      "group_kind": "radio|checkbox_set|checkbox_singleton",
      "owner_status": "resolved|unknown|conflict",
      "group_status": "resolved|unknown|conflict",
      "applicability": "applicable|excluded|review_only",
      "source_table_ref": "word/document.xml#table[n]",
      "source_row_refs": [],
      "control_identity_keys": [],
      "selected_control_identity_keys": [],
      "issue_ids": []
    }
  ]
}
```

`group_status=resolved` requires unique ownership, no identity/state conflict,
all members of that exact `group_id` accounted for, and every
applicability-bearing member decoded as `selected` or `unselected`. Separately,
every control in the structural source-table partition must be assigned to
exactly one group or retained as an unassigned audited issue. An unassigned or
unknown control caps a group only when its type, non-empty GroupName or exact
row association links it to that group; otherwise it remains document audit and
cannot poison another group. Unknown decorative/nested controls may be outside
a group only when structural rows prove they are not group members.

For radio/option-button groups, more than one selected member is `conflict` and
zero selected members is `unknown`. For independent checkboxes, any number may
be selected, but each candidate is applicable only from its own resolved state.

The document-level status and full warning list remain unchanged for audit.
They are not an applicability veto for a locally resolved group.

## Semantic blocks, analysis units and model request

Canonical semantic text remains byte-for-byte source-derived. The AI-visible
text appends deterministic lines for each locally owned control:

```text
[OPTION_STATE selected] <exact label>
[OPTION_STATE unselected] <exact label>
[OPTION_STATE unknown] <exact label>
[OPTION_STATE conflict] <exact label>
```

The analysis segment also carries the structured v2 group array and the
lossless v1 control records. The model request must explicitly state that it may
use only `selected` controls as proof of selected applicability, must not treat
`unselected` as positive evidence, and must return review when the relevant
local verdict is unknown/conflict. The LLM must never guess state from label,
position, typography, majority or surrounding prose.

The marker is AI context, not canonical evidence. Evidence quotes remain exact
substrings of canonical semantic blocks; marker text is never valid evidence.

## Candidate and audit behavior

- A fact exactly grounded in a `selected` member of a locally resolved group is
  `applicable`, even when unrelated document groups are unresolved.
- A fact grounded only in an `unselected` alternative is deterministically
  rejected from candidates with reason `unselected_option_not_applicable`.
- Unknown, indeterminate, conflict or unresolved ownership is capped at
  `requires_review` and cannot be revived by AI Validator.
- Unselected and rejected facts remain in audit/persistence. They are not
  candidates for positive applicability.
- Generic prose outside a locally resolved option group cannot override a
  selected negative option. Existing Aggregator containment remains unchanged.

## Fail-closed review cap

The cap is group-local. Each option-bearing evidence item must resolve by exact
label and control identity to exactly one `group_id` in its semantic block. Zero
or multiple group matches are review-only. The cap also applies when evidence
references an issue belonging to that group, spans groups with different
verdicts, or claims a label not exactly represented by selected control evidence.
A locally resolved candidate may proceed only when every applicability-bearing
evidence item agrees. Mixed resolved/unresolved evidence is review-only. Issues
belonging exclusively to another group in the same block remain audit-visible
but do not poison the resolved group.

## Upstream and downstream contracts

Upstream remains `docx_option_state_v1`; parser cardinality and identities are
unchanged. Normalizer adds v2 ownership verdicts without removing v1 records or
document audit. Semantic builder and analysis-unit builder must preserve v1 and
v2 fields and stable ids. Extractor evidence validation remains exact-substring
grounding. AI Validator may confirm/reject but cannot create facts or elevate a
review-only option fact. Fact persistence retains selected, unselected,
review-only and rejected audit metadata. PostgreSQL schema/query contracts,
models, credentials, 27 fields and Aggregator behavior are unchanged.

## Invariants

1. Every accepted control has exactly one source identity and one semantic owner.
2. Ownership is structural; label-only/global search is forbidden.
3. Canonical source/evidence text is never rewritten by option metadata.
4. Unselected alternatives cannot establish positive applicability.
5. Unknown/conflict cannot become confirmed through an LLM response.
6. Unrelated unresolved groups do not poison a locally resolved group.
7. All warnings and rejected alternatives remain available for audit.
8. No tender-specific control id, label, table number or expected answer is used
   by implementation logic.
9. Every option-bearing candidate maps to exactly one local `group_id`; block-wide
   or document-wide status cannot substitute for group resolution.

## Regression and runtime acceptance matrix

| Case | Grounding | Local applicability | Expected terminal behavior |
|---|---|---|---|
| activeX5/6/7 unselected + activeX8 selected | exact `#/tables/2` | resolved | `national_regime = Не применимо`, eligible for confirmation |
| activeX55 selected + activeX56 unselected | exact `#/tables/25` | resolved | `participation_guarantee = Не предусмотрены`, eligible for confirmation |
| unselected positive alternative | exact | excluded | rejected/audited, never positive candidate |
| unrelated orphan/ambiguous controls | unrelated block | no effect on resolved group | document audit unknown; target group unchanged |
| missing owner for target member | unresolved target block | review_only | no confirmed applicability |
| duplicate table signature | ambiguous owner | review_only | no attachment to either table |
| duplicate label in unique table | exact structural owner | resolved | attach only to the unique owner |
| one-control/multi-label or multi-control/one-label | non-bijective | review_only | issue id retained |
| radio group with two selected | exact but conflicting | conflict | review_only |
| radio group with zero selected | exact but incomplete | unknown | review_only |
| radio group with caller-supplied all-cleared flag | untrusted flag | unknown | review_only |
| distinct GroupName values in one table | exact | separate group verdicts | no cross-poisoning |
| resolved and unresolved groups in one semantic block | exact group mapping | per-group | resolved fact proceeds; unresolved fact review-only |
| repeated identity with changed state/target/coordinate | conflicting snapshot | conflict | review_only everywhere for that identity |
| neutral resolved option group | exact | resolved | current unrelated field behavior unchanged |
| AI cites marker text | not canonical | invalid | exact evidence validator rejects |
| AI promotes unknown/conflict | grounded but unsafe | review_only | Validator output cannot elevate |

Execution `14410` is the runtime prerequisite for the second oracle: both
`activeX55` and `activeX56` carry the same non-empty parser-decoded GroupName
`IC_Group_14`. The sanitized RED must preserve a non-client-specific non-empty
GroupName for that pair and assert equality. If a future source lacks that
signal, the option-button absent-GroupName rule remains unresolved; the oracle
must not be forced through a table-only fallback.

Offline acceptance requires an execution-derived sanitized RED that reproduces
the current global-poisoning behavior, focused GREEN, all Document Worker tests,
and full-suite comparison against the base commit. Runtime acceptance, if later
authorized and statically side-effect-safe, requires exact target read-back and
one new test execution proving both oracle facts plus a neutral control. It must
not reach PostgreSQL writes, Aggregator, delivery or unnecessary paid AI calls.

## Explicit non-goals

No new n8n node count/name/layout is specified here. No model, prompt schema,
credential, database schema/query, field catalog, Validator semantics,
Aggregator workflow or other workflow changes are authorized by this design.
