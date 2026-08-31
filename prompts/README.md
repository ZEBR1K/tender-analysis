# AI prompt artifacts

| File | Role |
|---|---|
| `AI validator prompt v1.txt` | historical baseline before universal semantic hardening |
| `AI validator prompt v1.1.txt` | intermediate universal semantic prompt |
| `AI validator prompt v1.2.txt` | current clean system-prompt artifact used by the `[3 TEST]` Validator preparation path |
| `targeted-recheck-extractor-system-prompt-v1.1-2026-08-31.txt` | full review and audit copy of the Targeted Recheck Extractor system prompt after the execution `14256` trusted-evidence alignment |

The runtime prompt is assembled dynamically:

```text
v1.2 system prompt
+ only field profiles used by the current analysis unit
```

`VALIDATOR_FIELD_PROFILES` is stored in the Document Worker Code node and versioned as `validator_field_profiles_v1`.

For Targeted Recheck, the versioned artifact is a complete review/archive copy, not an independently executed prompt. The executable runtime source of truth is the `parameters.jsCode` body of `Подготовить запрос #2 AI Targeted Recheck` in `workflows/n8n-exports/TENDER - Targeted Recheck.json` and, after draft synchronization, the corresponding live TEST workflow node. The execution-`14256` prompt exactness regression prevents drift between the artifact and the canonical export.

Workflow JSON remains the executable source of truth; this directory exists for review, audit and prompt-drift tests.

These artifacts contain no execution-specific IDs or tender-specific regression literals. Changes require the Validator regression suite and a runtime canary in `[3 TEST]` before production promotion.
