<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 Trooth, LLC -->

# Changelog: trooth-semanto-verify (PyPI)

Every change to this reader, newest first. The three readers (JavaScript, Python, Go) run the same shared test vectors in `verifier/test-vectors/v1`, so a change lands in all three together.

## 0.2.0 (2026-11-15)

- `SemantoSource` (`from trooth import SemantoSource`): loads a company's signed copy from its own site (`/.well-known/trooth.semanto` and its keys), checks it once for each new body, reads it again at most every 15 minutes, and answers fact IDs and plain questions in process. When Trooth's API cannot be reached it keeps answering from the last version that checked out and logs a `trooth_api_unreachable` event; a new version that does not check out is refused and logged, and the last good one stays in use.
- `trooth_semanto_verify.answer`: the answer matcher Trooth's service runs (`matcher-1-a75202e1`), with the same answers to every case in `test-vectors/answer-v1`. A fact marked changed since signing or expired returns its mark and no value.

## 0.1.1 (2026-11-15)

- A signed response read after its signature's lifetime ended still fails with reason `expired`, and now says in `state` whether the signature checked out while it was valid and the body still matches it: `valid_header_signature_expired` for a cached copy, nothing for a forged or altered one. New vector: `response-header-expired.json`.

## 0.1.0

- The version in this repository on 2026-11-13: checks Semanto files, pages and page proofs, signed responses (RFC 9421 with RFC 9530 Content-Digest), Web Bot Auth requests, witness statements, offers, revocation lists and the log (RFC 6962 inclusion and consistency, signed checkpoints), against keys.json with no call to Trooth. Earlier history is not kept in this repository.
