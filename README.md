<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 Trooth, LLC -->

# Semanto

[![npm](https://img.shields.io/npm/v/@trooth/semanto-verify.svg)](https://www.npmjs.com/package/@trooth/semanto-verify)
[![PyPI](https://img.shields.io/pypi/v/trooth.svg)](https://pypi.org/project/trooth/)
[![Go Reference](https://pkg.go.dev/badge/github.com/troothllc/semanto/verifier/go.svg)](https://pkg.go.dev/github.com/troothllc/semanto/verifier/go)
[![CI](https://github.com/troothllc/semanto/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/troothllc/semanto/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/troothllc/semanto/badge)](https://scorecard.dev/viewer/?uri=github.com/troothllc/semanto)

Semanto turns a company's website into one signed copy that AI agents can read and check. This repository holds the open parts: the verifiers that check a signed copy with no account and no call to Trooth, the shared test vectors they all pass, the GitHub Action that builds a new version after each deploy, and the Cloudflare adapter a company deploys on its own domain.

A check says who published a page, when, that it has not changed since, and that it was recorded in Trooth's public log. It does not say the content is true.

## Documentation

See the [Semanto docs](https://trooth.co/docs/semanto) on trooth.co, with [install guides](https://trooth.co/docs/semanto#install) for Cloudflare, Vercel, Netlify, Fastly, Akamai, Gcore, nginx, Apache, WordPress, Shopify, Webflow and Squarespace.

## Directory

| Package | What it is | Install |
| --- | --- | --- |
| [`verifier/js`](verifier/js) | `@trooth/semanto-verify`: the JavaScript verifier and the `semanto-verify` command. No dependencies, WebCrypto only. | `npm install @trooth/semanto-verify` |
| [`verifier/python`](verifier/python) | `trooth`: the Python verifier, `SemantoClient`, the `semanto-verify` command and LangChain, LlamaIndex and OpenAI Agents extras. | `pip install trooth` |
| [`verifier/go`](verifier/go) | `github.com/troothllc/semanto/verifier/go`: the Go verifier and `cmd/semanto-verify`. Standard library only. | `go get github.com/troothllc/semanto/verifier/go` |
| [`verifier/test-vectors/v1`](verifier/test-vectors/v1) | The vectors every verifier runs, positive and negative, each with what it must conclude. | |
| [`verifier/test-vectors/answer-v1`](verifier/test-vectors/answer-v1) | The answer matcher and the answers Trooth's service gives with it; every library that answers in process must give the same ones. | |
| [`deploy/cloudflare`](deploy/cloudflare) | The Cloudflare adapter: serves the signed copy on your own domain. | [Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/troothllc/semanto/tree/main/deploy/cloudflare) |
| [`action.yml`](action.yml) | Semanto on deploy: after a push, Semanto reads the site again and builds a new version, which waits for a person to sign it. | `uses: troothllc/semanto@v1` |

## Requirements

Node.js 20 or later, Python 3.11 or later, or Go 1.22 or later.

## Quick start

Check a signed page from the command line:

```sh
npx @trooth/semanto-verify page https://trooth.co/about
```

Or in code:

```js
import { verifySemanto } from "@trooth/semanto-verify";
```

```python
from trooth_semanto_verify import verify_semanto
```

```go
import "github.com/troothllc/semanto/verifier/go/semanto"
```

Each verifier checks, in order: the page bytes against the signed manifest, the page's inclusion proof, the company's signature with a key bound to its domain by `_trooth` DNS, Trooth's witness statement, the public log's inclusion and consistency proofs, the response signature (RFC 9421), and the version's window and revocation state. [`verifier/README.md`](verifier/README.md) says what each step proves.

## Semanto on deploy

```yaml
- uses: troothllc/semanto@v1
  with:
    trooth-id: your-trooth-id
    api-key: ${{ secrets.TROOTH_API_KEY }}
```

The key is an agent key from [trooth.co/dashboard/api-keys](https://trooth.co/dashboard/api-keys). Building is an agent's step; signing stays a person's, on trooth.co. Nothing is published from CI.

## Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/troothllc/semanto/tree/main/deploy/cloudflare)

The deploy page asks for one value, your Trooth ID. See [`deploy/cloudflare`](deploy/cloudflare).

## Versioning

Each package follows Semantic Versioning and keeps its own changelog: [JavaScript](verifier/js/CHANGELOG.md), [Python](verifier/python/CHANGELOG.md), [Go](verifier/go/CHANGELOG.md). A release is a merged pull request that bumps a version and its changelog: the release workflow then tags it and publishes it. Releases are tagged `js-v<version>`, `python-v<version>` and `verifier/go/v<version>`, published from this repository's workflows with provenance, and signed. npm releases are staged and go out only after a maintainer approves them with 2FA.

## Support

Ask on [trooth.co/contact](https://trooth.co/contact). Report a bug in this repository's [issues](https://github.com/troothllc/semanto/issues/new/choose).

## Security

Do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

The verifiers, the test vectors, the Action and the repository tooling are Apache License 2.0 ([`verifier/LICENSE`](verifier/LICENSE)). The Cloudflare adapter is under the Trooth Adapter License 1.0: run and change it to serve Semanto for domains you control. [LICENSE.md](LICENSE.md) has the full table. The Semanto service, its dashboard and its build pipeline are proprietary to Trooth, LLC and are not in this repository.
