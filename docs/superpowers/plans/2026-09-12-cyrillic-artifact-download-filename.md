# Cyrillic Artifact Download Filename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make artifact downloads succeed with readable Cyrillic source filenames without changing stored bytes or manifest metadata.

**Architecture:** Build one standards-compliant `Content-Disposition` value at the archive extractor HTTP boundary. Keep an ASCII legacy fallback and add the RFC 5987 UTF-8 extended filename.

**Tech Stack:** Node.js HTTP server, `node:test`, Fetch API.

---

### Task 1: Standards-compliant artifact download header

**Files:**
- Modify: `tests/archive-extractor-http.test.mjs`
- Modify: `deploy/archive-extractor/src/server.mjs`

- [ ] **Step 1: Write the failing regression test**

Add a test that resolves an artifact named `0_Общая_часть_зо.docx`, downloads
it through the real HTTP server, and asserts HTTP 200, byte-identical content,
an ASCII-only `filename="artifact-<id-prefix>.docx"`, and an RFC 5987
`filename*=UTF-8''...` parameter that decodes to the original name.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test --test-name-pattern="Cyrillic artifact filename" tests/archive-extractor-http.test.mjs
```

Expected: FAIL because the current server raises `ERR_INVALID_CHAR` and returns
an unsuccessful response.

- [ ] **Step 3: Implement the minimal header builder**

In `deploy/archive-extractor/src/server.mjs`, sanitize header controls, preserve
the original name for UTF-8 encoding, derive a deterministic ASCII fallback
from the artifact id plus a safe extension, and return:

```text
attachment; filename="<ascii-fallback>"; filename*=UTF-8''<encoded-original>
```

Use that builder only in the artifact GET response.

- [ ] **Step 4: Verify GREEN and regression safety**

Run:

```powershell
node --test tests/archive-extractor-http.test.mjs
npm test
git diff --check
```

Expected: all tests pass, the Cyrillic download body is byte-identical, and no
whitespace errors are reported.

- [ ] **Step 5: Review the scoped diff**

Run:

```powershell
git diff -- deploy/archive-extractor/src/server.mjs tests/archive-extractor-http.test.mjs
```

Expected: only the HTTP header helper, its call site, and the regression test
have changed.
