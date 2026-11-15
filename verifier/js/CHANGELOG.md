<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 Trooth, LLC -->

# Changelog: @trooth/semanto-verify (npm)

Every change to this reader, newest first. The three readers (JavaScript, Python, Go) run the same shared test vectors in `verifier/test-vectors/v1`, so a change lands in all three together.

## 1.4.0 (2026-11-15)

- Answer modes. `SemantoSource.respond({ question, draft })` sends a reply in the company's answer mode, chosen on trooth.co and read from `/public/semanto/{id}/answer-mode`. Checked builds the reply by code and discards the model's draft. Source only sends the draft unchecked. Audit sends the draft and checks it right after: supported, differs (with the signed sentence), marked, not in record, or not checked. When the mode has never been read, Checked is used.
- `verifier/test-vectors/answer-v1/conversations.json`: 200 fixed conversations with follow-ups and attempts to change a value by instruction. In Checked mode every line shown is a signed sentence or a fixed library line.

## 1.3.0 (2026-11-15)

- `assembleReply(answer, draft)` and `SemantoSource.reply({ question, draft })` build what the customer is shown by code: for a value answer the signed sentence exactly as signed, its conditions, the day it was signed and the check link. A model's draft is discarded and never appears. A marked fact shows its mark and no value. 1,000 replayed value questions show the signed sentence byte for byte.

## 1.2.0 (2026-11-15)

- `SemantoSource` (`@trooth/semanto-verify/source`): loads a company's signed copy from its own site (`/.well-known/trooth.semanto` and its keys), checks it once for each new body, reads it again at most every 15 minutes, and answers fact IDs and plain questions in process. When Trooth's API cannot be reached it keeps answering from the last version that checked out and logs a `trooth_api_unreachable` event; a new version that does not check out is refused and logged, and the last good one stays in use.
- `answer()` (`@trooth/semanto-verify/answer`): the answer matcher Trooth's service runs (`matcher-1-a75202e1`), with the same answers to every case in `test-vectors/answer-v1`. A fact marked changed since signing or expired returns its mark and no value.

## 1.1.1 (2026-11-15)

- The first release built and published from this repository's workflow, with npm provenance and a keyless signature. The code is the same as 1.1.0.

## 1.1.0 (2026-11-15)

- A signed response read after its signature's lifetime ended still fails with reason `expired`, and now says in `state` whether the signature checked out while it was valid and the body still matches it: `valid_header_signature_expired` for a cached copy, nothing for a forged or altered one. New vector: `response-header-expired.json`.

- `verifyEvidence(bundle)` checks an evidence bundle (`GET /os/semanto/{id}/evidence`) with no network call: the signed copy and its pages, its log entry, inclusion path and the tree head Trooth signed, and each day's signed read digest.

- The version in this repository on 2026-11-13: checks Semanto files, pages and page proofs, signed responses (RFC 9421 with RFC 9530 Content-Digest), Web Bot Auth requests, witness statements, offers, revocation lists and the log (RFC 6962 inclusion and consistency, signed checkpoints), against keys.json with no call to Trooth. Earlier history is not kept in this repository.
