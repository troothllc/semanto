<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 Trooth, LLC -->

# semanto-verify (JavaScript)

One dependency-free ES module, `verify.mjs`, for Node 20+ and browsers (WebCrypto only), plus `cli.mjs`.

```
node verifier/js/cli.mjs file verifier/test-vectors/v1/semanto.json --pages verifier/test-vectors/v1/pages
node verifier/js/cli.mjs page https://acme.com/security
node verifier/js/cli.mjs response https://acme.com/security
node verifier/js/cli.mjs log --from 1200 --to 1340
```

`file` needs no network when `--keys` is given or a `keys.json` sits beside the file (the vectors ship one). `page` fetches the URL with `Accept: text/markdown`, the JWK Sets from the domain and from Trooth, the `_trooth` DNS TXT record, and the proof the response links to with `rel="proof"`, then prints every check in plain words. Exit code 0 means every check passed; 1 means at least one failed; 2 means the command was wrong.

In a browser:

```html
<script type="module">
  import { verifyResponse } from "https://trooth.co/verifier/verify.mjs";
  const r = await fetch("/security", { headers: { Accept: "text/markdown" } });
  const body = new Uint8Array(await r.arrayBuffer());
  const keys = await (await fetch("/.well-known/trooth-keys.json")).json();
  const result = await verifyResponse(r.status, Object.fromEntries(r.headers), body, keys);
  console.log(result.ok, result.checks);
</script>
```

Functions: `verifySemanto(file, pageBytesByUrl, keys, { now, revocations })`, `verifyPageProof(proof, pageBytes, keys, { now })`, `verifyResponse(status, headers, body, keys, { now })`, `verifyWebBotAuthRequest`, `verifyTreeHead`, `verifyInclusionInLog`, `verifyConsistency`, `verifyCheckpoint`, `verifyOffer`, `verifyRevocationList`, `stateOf(version, now, revocations)`, plus `canonicalize` (RFC 8785), `sha256`, the RFC 6962 primitives, `verifyJws` and `verifyMessage` (RFC 9421). Every result is `{ ok, reason, checks: [{ name, ok, detail }] }` with the reason codes listed in `verifier/test-vectors/v1/README.md`. Type declarations are in `verify.d.mts`.

## SemantoClient

`client.mjs` reads a page and checks it in one call: the markdown, both key sets, the response signature and the domain's `_trooth-keys` TXT record over DNS over HTTPS, with key sets and DNS answers kept five minutes.

```js
import { SemantoClient } from "@trooth/semanto-verify/client";
const r = await new SemantoClient().read("https://acme.com/pricing");
if (r.ok) console.log(r.text); else console.log(r.reason, r.checks);
```

`r.dns` is `true` when the domain's DNS names the signing key, `false` when it names another, `null` when DNS could not be asked.

## SemantoSource

`source.mjs` answers value questions from a company's own signed copy, in process. It loads `/.well-known/trooth.semanto` and the company's keys from the company's site, checks the file once for each new body, reads the site again at most every 15 minutes, and answers with the same matcher as Trooth's service (`answer.mjs`, whose answers are compared case by case with `verifier/test-vectors/answer-v1`).

```js
import { SemantoSource } from "@trooth/semanto-verify/source";
const acme = new SemantoSource("acme.com", { onEvent: (e) => console.log(e.event, e.detail) });
const a = await acme.answer({ question: "How much is the Starter plan?" });
// a.status: "answer" | "candidates" | "not_published" | "not_read"; a.text is the signed sentence and the check link
```

For a chatbot, `reply` builds the text the customer sees by code and discards the model's draft: the signed sentence exactly as signed, its conditions, the day it was signed and the check link.

```js
const r = await acme.reply({ question: userQuestion, draft: modelText });
show(r.text); // r.statement is the signed sentence; r.discarded says a draft was dropped
```

`respond` follows the company's answer mode, chosen on trooth.co: **Checked** builds the reply by code (as `reply` does), **Source only** sends the model's draft unchecked, and **Audit** sends the draft and checks it right after (`r.audit` resolves to supported, differs with the signed sentence, marked, not in record or not checked). Until the mode can be read, Checked is used.

```js
const r = await acme.respond({ question: userQuestion, draft: modelText });
show(r.text);
```

Trooth's API is used only for Trooth's witness keys, the monitor's marks and the answer mode. When it cannot be reached, answers keep coming from the last version that checked out and the source logs `trooth_api_unreachable`. A new version that does not check out is refused (`version_refused`) and the last good one stays in use. A fact marked changed since signing or expired returns its mark and no value.

## What the customer sees, turn by turn

`reply` returns what a company's own chatbot shows for one turn, built by code (`turn.mjs`):

| status | lines |
| --- | --- |
| `answer` | the signed sentence, its conditions, "From Acme Inc's signed record. Signed 2026-11-12. Check it: <link>" |
| `not_published` | the company's not-published line and its contact route from the record |
| `marked` | the mark (changed since signing, or expired) and the contact route; no value |
| `choose` | several signed answers, as up to three `choices` |
| `confirm` | a locked value found only by word overlap: up to three `choices` to pick before any value |
| `closed` | no checked version, a withdrawn version or a revoked key: no value, the contact route; `onAlert` is called once |

```js
const r = await acme.reply({ question, history }); // history: earlier questions, used only to complete a follow-up
if (r.status === "confirm") showChoices(r.choices); // then acme.reply({ fact_id, confirmed: true })
else show(r.text);
```

`outputStep({ question, text })` checks an agent's final answer and replaces it with the checked reply when it carries
a value the company did not sign. `quote({ question, select })` answers a free-form question with the company's own
signed sentences, picked by ID by the company's model and printed by code. `stream(tokens)` releases a sentence only
after its check. `maskPersonal(text, file)` masks emails, phone numbers and names that are not in the record.

## Frameworks

`frameworks.mjs` adds the three modes and the output step to the Vercel AI SDK (`semantoMiddleware`), LangChain.js and
LlamaIndex.TS (`withSemanto`), the OpenAI Agents SDK (`semantoOutputGuardrail`) and plain HTTPS (`semantoHandler`, a
fetch handler). Sample chatbots are in `verifier/examples/answer-path`.
