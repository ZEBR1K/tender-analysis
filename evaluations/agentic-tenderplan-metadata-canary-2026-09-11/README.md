# Sealed TenderPlan metadata canary — 2026-09-11

## Verdict

**Technical GREEN.** The unchanged TenderPlan FullInfo snapshot reached Codex as
the separate sealed source `tenderplan-metadata`, remained outside the source
document barrier, passed the runner JSON contract, was promoted into canonical
FINAL evidence and appeared in the generated report.

This is not an isolated semantic A/B or a gold score. The earlier baseline had
two DOCX files; the repeated live run had three because TenderPlan now also
returned `Краткое описание КС 10293451.docx`. The live FullInfo snapshot also
contained later winner/notification state. Both repeated filenames also had
different source SHA-256 values from the baseline; the contract file retained
the same byte size while the technical specification did not. This proves byte
identity changed, not what semantic content changed. Changes not grounded in
`tenderplan-metadata` cannot be attributed to this feature.

No credential, proxy value, source download URL or full TenderPlan payload is
stored in this evidence directory.

## Published runtime

| Component | Live ID / image | Published/read-back version |
|---|---|---|
| Orchestrator | `TRLYuU7mVyE1bjjr` | `28d0126c-f546-4c02-9bee-3a0dda7febc0` |
| Agentic Dispatch | `gP29fv0rq4MoON9a` | `e4ea9636-1d5d-4772-ac5c-033864014b3e` |
| Finalization | `cSsh9yjpS7t5p0OO` | `e44fff3f-c0b0-4616-93c1-bda41405cb07` |
| Monitor | `CALcBEXvQsO1AcfP` | `0ce151f8-99bb-40d7-a426-097a01de97fd` |
| Report Generation | `ckPnP3hRhKu4Mf9u` | `e21c7675-916a-4fd3-8499-e11444484b68` |
| Codex runner | `sha256:db6c8e7eaf0537145a06eff6501bd32b0588e187e8a30f2f43f58898f09ba672` | running / healthy / execute-ready |

The Finalization live package was exported before change and mechanically
checked to differ in exactly the SQL parameter of `Продвинуть agentic FINAL`.
Node identity, credentials, graph, settings and active flag were preserved. The
CLI import intentionally deactivated only this workflow because the server is
configured with `EXECUTIONS_MODE=regular`; it was immediately published in the
n8n UI and then read back as active with draft/active parity.

## Execution chain

```text
Orchestrator 16923
→ Dispatch 16925
→ runner job 7f89e330-1011-458f-8b28-286d32d742c9
→ Monitor 16944
→ Finalization 16945
→ Report Generation 16946
```

- Tender: `6aa2c2ad5b7165804b8c4ff7` / `10293451`.
- New run: `e996c707-aa09-41c2-9fd7-d49337182c70`.
- Manifest: three source DOCX files plus the separate root source
  `tenderplan-metadata`; metadata was absent from `documents[]` and the document
  count remained `3`.
- Manifest SHA-256:
  `696F8E74FE61DC07D4B69630A5715C70988C48F4F99AE6DA6B49B0234DBD7656`.
- Runner: attempt 1, exit success, validation `valid=true`, zero contract
  issues, exact 27 fields.
- Usage: `1,349,001` input tokens (`1,270,016` cached), `30,105` output tokens
  and `5,090` reasoning-output tokens.
- TLS-verified read-only PostgreSQL check: run `completed`, no error, three
  documents, 27 rows, 27 unique `field_key`, 27 unique indexes,
  `8 resolved / 6 requires_review / 13 not_found`.
- HTML: `Анализ закупки_10293451.html`, `30,457` bytes, 27 field rows,
  metadata sources rendered, no `undefined`.
- PDF: `Анализ закупки_10293451.pdf`, `100,012` bytes, `%PDF-`.

## Comparison with the pre-metadata run

Baseline run `6c36e5da-f9e2-48d9-a062-0493f0c2bf73`, runner job
`70d699d2-b469-40b0-a8cc-de5b38fa6374`, had
`7 resolved / 2 requires_review / 18 not_found` and no metadata source.

The new result cites TenderPlan metadata in eight fields:

| Field | Before | After | Observed effect |
|---|---|---|---|
| `procurement_subject` | `requires_review` | `resolved` | TenderPlan title corroborated the technical specification and removed the misleading draft-contract heading conflict. |
| `nm_price_with_vat` | `not_found` | `requires_review` | `593 539,08` became a price candidate, but missing VAT information correctly prevented resolution. |
| `platform` | `resolved` | `resolved` | Metadata corroborated the existing portal evidence. |
| `procedure_type` | `resolved` | `resolved` | The existing `Котировочная сессия` was supplemented with the explicit small-volume label. |
| `application_deadline` | `not_found` | `resolved` | Direct `submission_close_at` supplied the deadline. |
| `results_date` | `not_found` | `requires_review` | Winner and notification timestamps were retained without silently choosing which is the formal result date. |
| `customer` | `resolved` | `resolved` | Metadata corroborated the full legal name from the contract. |
| `delivery_term` | `resolved` | `requires_review` | The agent surfaced a material conflict: TenderPlan says working days while the draft says calendar days. |

Two additional status changes, `analog_allowed` and `analog_definition`, do not
cite metadata. They are retained in the raw result but are not evidence that the
TenderPlan source caused an improvement.

## Safety boundary

- No TenderPlan parser, field mapping or field-specific runtime rule was added.
- No programmatic quote-accuracy or evidence-sufficiency check was added.
- Null/absent metadata never becomes a negative fact.
- Metadata instructions are untrusted source content and are never executable
  instructions for Codex.
- Runtime validation remains limited to source identity, file/integrity
  boundaries and the closed JSON contract.

The sanitized raw baseline and canary result envelopes are stored beside this
file for offline review. Their exact file SHA-256 values are
`A024DC2AAFC61C7CDD325562C2C0D66CB1819C1EE707F4852ABEC5FF6D5AA7D6`
and `45A54E42030E969671FA669A1824767F7E6A18A885789FC5953DD12406E688BB`
respectively.
