# AI prompt artifacts

| File | Role |
|---|---|
| `AI validator prompt v1.txt` | historical baseline before universal semantic hardening |
| `AI validator prompt v1.1.txt` | intermediate universal semantic prompt |
| `AI validator prompt v1.2.txt` | current clean system-prompt artifact used by the `[3 TEST]` Validator preparation path |
| `targeted-recheck-extractor-system-prompt-v1.1-2026-08-31.txt` | historical review copy after the execution `14256` trusted-evidence alignment |
| `targeted-recheck-extractor-system-prompt-v1.2-2026-09-03.txt` | current exact sanitized runtime render for the execution `14391` continuous-quote regression |

The runtime prompt is assembled dynamically:

```text
v1.2 system prompt
+ only field profiles used by the current analysis unit
```

`VALIDATOR_FIELD_PROFILES` is stored in the Document Worker Code node and versioned as `validator_field_profiles_v1`.

For Targeted Recheck, v1.1 is the historical template review copy. V1.2 is the exact system-prompt render produced by the sanitized `advance_contract_guarantee` regression input; its test proves that the executable system prompt owns the continuous-quote invariant and the user prompt does not duplicate it. The executable runtime source of truth remains the `parameters.jsCode` body of `Подготовить запрос #2 AI Targeted Recheck` in `workflows/n8n-exports/TENDER - Targeted Recheck.json` and, after draft synchronization, the corresponding live TEST workflow node.

Workflow JSON remains the executable source of truth; this directory exists for review, audit and prompt-drift tests.

These artifacts contain no execution-specific IDs or tender-specific regression literals. Changes require the Validator regression suite and a runtime canary in `[3 TEST]` before production promotion.
