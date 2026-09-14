# Tender Document Toolkit Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved local document toolkit into every new runner job and deploy the attested runner update on the existing server.

**Architecture:** One explicit allowlist defines every trusted agent-template file. The same list drives immutable per-job staging and one aggregate execution-profile hash, so missing, altered, or extra template resources cannot be silently promoted. The runner image installs and health-checks the one missing `unzip` dependency; no semantic validation, n8n workflow, database, or result-schema behavior changes.

**Tech Stack:** Node.js 24 ESM, built-in `node:test`, Docker Compose, Debian Bookworm packages, Codex runner isolation attestation.

---

### Task 1: Lock the deployment contract with failing tests

**Files:**
- Modify: `tests/agentic-codex-command.test.mjs`
- Modify: `tests/agentic-runner-attestation.test.mjs`
- Modify: `tests/agentic-runner-deployment.test.mjs`
- Modify: `tests/agentic-runner-http.test.mjs`

- [ ] Assert that `stageAgentTemplate()` copies the complete exact toolkit and rejects drift in a helper file.
- [ ] Assert that the execution profile contains an aggregate SHA-256 bound to all allowlisted template files.
- [ ] Assert that the Docker image pins `unzip=6.0-28+deb12u1` and runner health requires/probes `unzip`.
- [ ] Run the four focused suites and confirm RED for missing staging, hash, package, and health behavior.

### Task 2: Implement the minimal runner integration

**Files:**
- Create: `deploy/codex-runner/src/agent-template.mjs`
- Modify: `deploy/codex-runner/src/codex-command.mjs`
- Modify: `deploy/codex-runner/src/runtime-attestation.mjs`
- Modify: `deploy/codex-runner/src/server.mjs`
- Modify: `deploy/codex-runner/Dockerfile`
- Modify: `deploy/codex-runner/README.md`

- [ ] Define the nine trusted template-relative paths once and reject non-regular or symlink sources.
- [ ] Stage each trusted file read-only under its exact workspace-relative path, creating only allowlisted parent directories.
- [ ] Hash ordered relative paths and bytes into `agent_template_sha256` while retaining the existing `skill_sha256` compatibility field.
- [ ] Install and probe the pinned `unzip` binary; make readiness fail closed when it is absent.
- [ ] Run focused suites, the complete agentic suite, skill validation, Compose validation, diff checks, and secret scan.

### Task 3: Promote and verify on the existing server

**Files:**
- Modify: `PROJECT_STATUS.md`
- Modify: `evaluations/AGENTIC_DOCUMENT_TOOLKIT_DEPLOYMENT_2026-09-11.md`

- [ ] Commit and push the reviewed runner integration to `codex/agentic-analysis-integration`.
- [ ] Confirm the runner queue is idle and record host/container restart baselines without reading secrets.
- [ ] Transfer only the version-controlled runner build context through a private staging directory, keep a recoverable backup of overwritten runner files, validate Compose, build, and replace only `tender-codex-runner`.
- [ ] Wait for base health, run the required paid isolation attestation, and confirm `readiness.execute=true` with the new template hash and `unzip` version.
- [ ] Run a bounded real-container smoke proving complete template staging plus PDF search/render, selected-image OCR, Office render, and selective OOXML listing on copied test inputs.
- [ ] Confirm n8n/PostgreSQL/Redis restart counts did not change, record redacted evidence, commit, and push the deployment record.
