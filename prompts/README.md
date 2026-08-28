# AI Validator prompt artifacts

| File | Role |
|---|---|
| `AI validator prompt v1.txt` | historical baseline before universal semantic hardening |
| `AI validator prompt v1.1.txt` | intermediate universal semantic prompt |
| `AI validator prompt v1.2.txt` | current clean system-prompt artifact used by the `[3 TEST]` Validator preparation path |

The runtime prompt is assembled dynamically:

```text
v1.2 system prompt
+ only field profiles used by the current analysis unit
```

`VALIDATOR_FIELD_PROFILES` is stored in the Document Worker Code node and versioned as `validator_field_profiles_v1`. The runtime workflow JSON remains the executable source of truth; this directory exists for review and prompt-drift tests.

These artifacts contain no execution-specific IDs or tender-specific regression literals. Changes require the Validator regression suite and a runtime canary in `[3 TEST]` before production promotion.
