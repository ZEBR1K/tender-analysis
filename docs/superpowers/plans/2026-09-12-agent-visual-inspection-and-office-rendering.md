# Agent visual inspection and office rendering implementation plan

**Goal:** Make visual inspection truthful and restore correct DOCX-control rendering in the production Codex runner.

**Architecture:** Preserve the current manifest-led agentic pipeline. Tighten only the tender-analysis skill and the pinned runner toolchain, then validate the two reproduced failures with targeted canaries.

**Tech stack:** Codex CLI, Markdown skill, Node test runner, Docker, LibreOffice, Poppler.

### Task 1: Prove runner vision availability

1. Create a temporary sealed-style runner workspace with a synthetic PNG containing an unknown token.
2. Start Codex with the same permission boundary and runtime environment as a production job.
3. Require `view_image`, inspect JSONL evidence, and compare the returned token with the image.
4. Remove the temporary workspace.

### Task 2: Make visual inspection explicit

1. Add failing assertions to `tests/agentic-document-toolkit.test.mjs` for the operational `view_image` requirements.
2. Run the focused test and confirm RED.
3. Minimally update `deploy/codex-runner/agent-template/.agents/skills/tender-document-analysis/SKILL.md` and its tool recipes.
4. Run the focused test and confirm GREEN.

### Task 3: Upgrade and pin LibreOffice

1. Add failing deployment assertions for the new pinned LibreOffice artifact/version.
2. Run the focused deployment test and confirm RED.
3. Update the runner Dockerfile with a checksum-pinned LibreOffice 26.2 package while retaining the existing least-privilege runtime.
4. Build the candidate image and verify `libreoffice --version`.

### Task 4: Verify the DOCX control render

1. Render the known DOCX with the candidate image.
2. Render the relevant PDF page to PNG.
3. Visually verify that `Не применимо` is selected.

### Task 5: Deploy and verify scan vision

1. Sync the minimal runner changes, rebuild, and restart only the runner service.
2. Run the isolation attestation and focused repository tests.
3. Use the production runner boundary to open scan page 4 with `view_image`.
4. Confirm the exact notation `Епи → Еш` and record the evidence.
5. Review `git diff` and report results; do not start a full procurement analysis.

