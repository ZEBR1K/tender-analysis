# Cyrillic Artifact Download Filename Design

## Problem

The archive extractor currently writes the stored source name directly into the
legacy quoted `filename=` parameter of `Content-Disposition`. Node.js rejects
non-Latin-1 Cyrillic characters there with `ERR_INVALID_CHAR`, so an otherwise
valid stored artifact returns HTTP 500 before n8n can download it.

## Design

Keep the original Unicode filename unchanged in the manifest and artifact
metadata. For HTTP downloads, emit both:

- an ASCII-only deterministic fallback in `filename=`; and
- the original sanitized filename, UTF-8 percent-encoded according to RFC 5987,
  in `filename*=UTF-8''...`.

The fallback is derived from the artifact id and the original ASCII extension.
No document bytes, hashes, paths, n8n workflows, or Codex semantics change.

## Safety and error handling

Strip CR, LF, quotes, slashes, and control characters before building either
header parameter. Encode RFC 5987-reserved characters after
`encodeURIComponent`. The response body remains the exact stored file stream.

## Verification

An HTTP regression test downloads a stored artifact whose source name contains
Cyrillic characters. It must receive HTTP 200, byte-identical content, the
expected content type, an ASCII-only legacy fallback, and a UTF-8 extended
filename carrying the readable original name. The existing quote-sanitization
test remains green.
