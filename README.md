# Semanto by Trooth

[![PyPI version](https://img.shields.io/pypi/v/trooth.svg?label=pypi)](https://pypi.org/project/trooth/)

Semanto turns a company's website into one signed copy that AI agents can read and check. Each page carries a signature from the company's own key, and every published version is entered in a public log, so anyone can confirm what a company said and when it said it.

This repository holds the open readers for Python, JavaScript and Go with their shared test vectors, and the Cloudflare adapter a company deploys on its own domain. The Semanto service itself is Trooth's and is not here.

## Documentation

The documentation is at [trooth.co/docs/semanto](https://trooth.co/docs/semanto), with [install guides](https://trooth.co/docs/semanto#install) for Cloudflare, Vercel, Netlify, Fastly, Akamai, Gcore, nginx, Apache, WordPress, Shopify, Webflow and Squarespace.

## Readers

| Reader | Path | Install |
| --- | --- | --- |
| Python | [`verifier/python`](verifier/python) | `pip install trooth` |
| JavaScript | [`verifier/js`](verifier/js) | Copy `verify.mjs`; Node 20 or newer, no dependencies |
| Go | [`verifier/go`](verifier/go) | `go install github.com/troothllc/semanto/verifier/go/cmd/semanto-verify@latest` |

```python
from trooth import SemantoClient

r = SemantoClient().read("https://acme.com/pricing")
print(r["ok"], r["reason"])
```

All three share the same functions, reason codes and the vectors in [`verifier/test-vectors/v1`](verifier/test-vectors/v1).

## Cloudflare

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/troothllc/semanto/tree/main/deploy/cloudflare)

See [`deploy/cloudflare`](deploy/cloudflare).

## Licenses

The readers are Apache-2.0. The Cloudflare adapter is under the Trooth Adapter License 1.0: run and change it to serve Semanto for domains you control. [LICENSE.md](LICENSE.md) has both.

## Security

Report a vulnerability to security@trooth.co. Please do not open a public issue for it.
