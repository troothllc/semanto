<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 Trooth, LLC -->

# Changelog: @trooth/semanto-verify (npm)

Every change to this reader, newest first. The three readers (JavaScript, Python, Go) run the same shared test vectors in `verifier/test-vectors/v1`, so a change lands in all three together.

## 1.5.0 (2026-11-15)

- What the customer sees. `SemantoSource.reply` now returns the reply built by `customerReply` (`@trooth/semanto-verify/turn`): a value answer is at most three lines, the signed sentence, its conditions, and "From <Company>'s signed record. Signed <date>. Check it: <link>" (`markdown` carries the link as a link), never more than 600 characters, and no library line speaks to the reader. The structured result carries the value, conditions, contact route and choices.
- The not-published reply: the company's own not-published line and a contact route taken from the record (an email, a phone number, a contact page, or the company's site).
- Follow-ups: `reply`, `respond` and every adapter take `history` (earlier questions); a follow-up is rewritten into a complete question and answered from the signed record alone. Earlier turns are never evidence.
- A locked value (prices, contacts, hours, policies, anything typed) reached only by word overlap is not shown until the customer picks the question from at most three choices (`status: "confirm"`, then `reply({ fact_id, confirmed: true })`).
- Fails closed. Each refresh checks the version in use again with the company's keys as served and Trooth's revocation list; a withdrawn version, a key that no longer checks out, or no version at all gives `status: "closed"` with no value and the contact route. A fact marked changed since signing or expired shows its mark and the contact route. `onAlert` is called once per reason.
- The output step: `outputStep({ question, text })` checks an agent's final answer; a price, phone number, email, percent or counted value the company did not sign is caught and the answer is replaced by the checked reply.
- Quote-assembled answers: `quote({ question, select })` lets the company's model pick one to three runs of sentence IDs from the signed pages (`SELECTION_SCHEMA`); code prints them unchanged under each page's title and link, and holds any sentence whose value is not the signed one. Pages are checked against their hashes in the manifest.
- Streaming: `stream(tokens)` and `releaseChecked` release a sentence only after its check returns; a held sentence is never released.
- Personal data: `maskPersonal` masks emails, phone numbers and names that are not in the record before a sentence leaves the company's server (the model's selection, the `supportCheck` hook). Value answers send nothing about the question to Trooth.
- Frameworks (`@trooth/semanto-verify/frameworks`, no dependencies): `semantoMiddleware` for the Vercel AI SDK, `withSemanto` for LangChain.js runnables and LlamaIndex.TS query engines, `semantoOutputGuardrail` for the OpenAI Agents SDK, and `semantoHandler`, a fetch handler for plain HTTPS. Sample chatbots in `verifier/examples/answer-path` pass the 200 fixed conversations in Checked mode, and each catches a seeded altered value with the output step on.
- `SemantoSource.fromChecked(file)` answers from a copy the caller already checked and keeps up to date itself.

## 1.4.1 (2026-11-15)

- The Signature-Input, Signature and Link header parsers, base64 trimming, field folding and URL trimming no longer use regular expressions that can backtrack: each reads its input in one pass, so a hostile header of any length is parsed in linear time (found by CodeQL). Every shared vector gives the same result.
- The command line fetches only https URLs (and http on this machine) and sends no credentials.

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
