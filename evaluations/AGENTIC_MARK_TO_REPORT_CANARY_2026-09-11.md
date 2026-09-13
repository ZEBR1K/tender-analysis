# Agentic mark-to-report canary — 2026-09-11

## Verdict

**Technical GREEN.** Fresh TenderPlan tender `6aa2c2ad5b7165804b8c4ff7` passed
the published temporary agent-only route from mark ingestion through real Codex,
exact-27 FINAL promotion and report generation. This verdict covers transport,
identity, file/artifact integrity, JSON contract and workflow completion. It is
not a gold semantic score: this procurement has no employee-authored reference
report, so manual review of the 27 values remains non-blocking follow-up.

No source document, signed URL, proxy credential or Codex credential is stored
in this evidence file.

## Source download and recovery

- Mark Intake executions `15728` and `15748` reached the target tender.
- Document Preparation executions `15734` and `15754` reproduced direct
  `zakupki.mos.ru` timeouts on different service IPs before run creation.
- Published Document Preparation version
  `a87bffe7-52b9-4832-891a-8b441a980833` routes only
  `Скачать прямой документ` through the live proxy and uses three native
  attempts with a five-second interval.
- Retry chain `15808 → 15811 → 15813 → 15814` downloaded, byte-counted and
  SHA-256-verified both DOCX files and created analysis run
  `6c36e5da-f9e2-48d9-a062-0493f0c2bf73` with two registered documents.
- Dispatch execution `15815` reproduced the same timeout at its separate
  `Скачать оригинал` staging boundary. The job was still unstarted and
  unsealed. Scheduled recovery `15853 → 15854 → 15855` restaged it, but its two
  Codex attempts then failed because the mounted refresh token had been revoked.
  This failed job remains in the audit trail as
  `9eff73af-6436-4fb2-af8d-292942ae18f0`; it was not deleted or rewritten.
- With explicit operator approval, the newer local Codex authorization was
  installed atomically into the existing read-only runner mount. The prior file
  was retained as a root-only backup outside the repository and mount. Runner
  health, zero restarts and `codex login status` were verified without printing
  credential content.
- One controlled recovery used replicate 2 only for the new attempt, then the
  normal live Intake setting was immediately restored to replicate 1. Recovery
  execution `16383`, Intake `16384` and Dispatch `16385` created and started job
  `70d699d2-b469-40b0-a8cc-de5b38fa6374`.

Repository exports contain only the non-secret `=` proxy packaging placeholder.
The live proxy value remains only in n8n configuration.

## Successful terminal chain

The new job completed on runner attempt 1 with exit code 0 and a valid 27-field
JSON envelope. Observed usage was `740150` input tokens, of which `671488` were
cached, plus `23087` output and `4085` reasoning-output tokens.

```text
Monitor 16402
→ Finalization 16403
→ Report Generation 16404
```

- Monitor accepted the identity/hash envelope with zero validation issues and
  atomically persisted exactly 27 shadow rows.
- Finalization promoted exactly 27 canonical rows, passed the existing 27/27
  barrier and claimed run completion once.
- Report Generation received 27 fields and produced valid artifacts:
  - `Анализ закупки_10293451.html` — `26794` bytes;
  - `Анализ закупки_10293451.pdf` — `92267` bytes with `%PDF-` signature.
- The result distribution is `7 resolved / 2 requires_review / 18 not_found`.
- TLS-verified read-only PostgreSQL checks independently confirmed:
  - `run.status=completed` and `documents_total=2`;
  - exactly 27 FINAL rows and 27 unique `field_key` values;
  - all 27 rows use `tender_field_final_v1`;
  - the failed replicate-1 job and completed replicate-2 job both remain in the
    audit trail.

## Post-canary review hardening

Independent review found that the first recovery predicate used the broad
`AGENTIC_DISPATCH_FAILED` code and could therefore retry a non-download
contract/integrity failure. It also found that successful Monitor completion
replaced, rather than merged, existing technical audit JSON.

The reviewed live and repository workflows now:

- classify only the source HTTP error as
  `AGENTIC_SOURCE_DOWNLOAD_FAILED` with a fixed safe message;
- permit the one-time pre-start restage only for that narrow code, while
  identity, ownership, CAS, seal and other contract failures remain terminal;
- preserve prior technical audit when adding the successful validation summary.

Published/read-back versions are Dispatch
`4c49ed54-c2ca-40e2-9e8a-7958f84dbdbd` and Monitor
`0ce151f8-99bb-40d7-a426-097a01de97fd`. These changes affect only future
technical failure routing and audit retention; they do not alter the already
successful semantic path. Focused Dispatch/Monitor regression tests pass
`30/30`.

## Safety boundary

- No parser, page/OOXML/XLSX index, quote checker, evidence scoring,
  field-specific rule or semantic status rewrite was added.
- Runtime checks remain limited to security, source/artifact integrity and the
  closed JSON contract.
- No direct production PostgreSQL write was performed during verification;
  database evidence used the dedicated read-only role and TLS verification.
- Manual semantic review is informative and must not block or rewrite this
  technically valid result automatically.
- Final repository regression: `761 total / 755 pass / 0 fail / 6 skipped`.
