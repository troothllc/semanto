<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 Trooth, LLC -->

# Changelog: github.com/troothllc/semanto/verifier/go

Every change to this reader, newest first. The three readers (JavaScript, Python, Go) run the same shared test vectors in `verifier/test-vectors/v1`, so a change lands in all three together.

## Unreleased

- A signed response read after its signature's lifetime ended still fails with reason `expired`, and now says in `state` whether the signature checked out while it was valid and the body still matches it: `valid_header_signature_expired` for a cached copy, nothing for a forged or altered one. New vector: `response-header-expired.json`.

## First version (not tagged yet)

- The version in this repository on 2026-11-13: checks Semanto files, pages and page proofs, signed responses (RFC 9421 with RFC 9530 Content-Digest), Web Bot Auth requests, witness statements, offers, revocation lists and the log (RFC 6962 inclusion and consistency, signed checkpoints), against keys.json with no call to Trooth. Earlier history is not kept in this repository.
