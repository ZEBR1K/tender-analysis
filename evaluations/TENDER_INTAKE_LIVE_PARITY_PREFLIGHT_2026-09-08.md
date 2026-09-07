# Tender intake live parity preflight — 2026-09-08

## Scope

Sanitized read-only comparison of current live n8n workflow definitions against
their canonical local repository exports. The comparison did not modify,
publish, activate or execute any live workflow.

## Method

Each live workflow was fetched with an HTTP `GET` using the read-only credential
referenced by environment variable `N8N_TENDER_READONLY_API_KEY`.

Local inputs were the canonical exports in `workflows/n8n-exports/` for
Orchestrator, Document Worker, Document Error, Aggregator and Finalization.

For local and live definitions, the comparison normalized:

- node name;
- node type and `typeVersion`;
- node parameters;
- credential references;
- node execution settings;
- connections.

Canvas positions and top-level instance metadata were excluded. Credential
secrets, API-key values and request header values were never recorded in the
comparison output or this artifact.

This is a read-only snapshot of the current workflow definition returned by the
API. It does not establish active-version parity beyond the state returned by
that API response.

## Exact results

| Workflow comparison | Live state | Local/live nodes | Normalized result |
|---|---|---:|---|
| Orchestrator: local canonical vs live `Q1RWSrB0jaTA6Dmx` | inactive | `14 / 12` | Node shape, configuration and connections differ. |
| Canonical Worker vs exact-name live `1Pw61ZY3HgBSvcUr` | active | `85 / 37` | Node shape, configuration and connections all differ. |
| Canonical Worker vs Orchestrator-wired live `URFdslUfULtOLv9B` | active | `85 / 86` | Node shape, configuration and connections all differ. |
| Document Error local/live `jYzQ8RtNmnTM2PGz` | active | `2 / 2` | Exact normalized configuration and connections equal. |
| Aggregator local/live canonical `ftvmrEHoMbPOAqZG` | active | `31 / 31` | Exact normalized configuration and connections equal. |
| Finalization local/live `cSsh9yjpS7t5p0OO` | active | `5 / 5` | Exact normalized configuration and connections equal. |

The live Orchestrator dispatch target is `URFdslUfULtOLv9B`, named
`LEGACY [DW-23 TEST CODEX] TENDER — Обработать документ`. Relative to the
85-node canonical Worker, the 86-node wired live definition adds:

```text
Call '[TEST CODEX] TENDER — Агрегация закупки'
Wait
```

and lacks:

```text
Call 'TENDER — Агрегация закупки'
```

## Conclusions

- Orchestrator and both plausible live Worker targets differ from their canonical
  local exports under the defined normalization.
- Document Error, Aggregator and Finalization are exact under that normalization.
- Existing live workflows changed: none.
- This comparison does not prove production runtime behavior or promotion
  readiness.
