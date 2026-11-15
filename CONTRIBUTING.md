<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 Trooth, LLC -->

# Contributing

We welcome bug reports, feature requests and code in a pull request. For most pull requests, open or find an issue first that gives the context.

## Ground rules

- The three verifiers implement the same checks with the same reason codes. A change to one is a change to all three, with the same test vectors passing in each.
- A new check comes with vectors in `verifier/test-vectors/v1`: one that passes and at least one that must fail, each naming what it must conclude.
- No new runtime dependencies. The JavaScript and Go verifiers use only their standard libraries; the Python verifier depends only on `cryptography`.
- Every file carries `SPDX-License-Identifier: Apache-2.0`.
- Security reports never go in an issue or a pull request. See [SECURITY.md](SECURITY.md).

## Set up and test

```sh
git clone https://github.com/troothllc/semanto
cd semanto
node --test verifier/js/test/vectors.test.mjs
(cd verifier/python && python3 -m pip install ".[langchain,llama-index,openai-agents]" pytest && python3 -m pytest -q)
(cd verifier/go && go test ./...)
```

## Pull requests

- Keep each pull request to one change, with a title that says what it does.
- Add a line to the changelog of each package you change.
- CI must pass on every verifier.
- Commits are signed off under the [Developer Certificate of Origin](https://developercertificate.org/) (`git commit -s`).

## Releases

Maintainers release from this repository: a tag `js-v<version>`, `python-v<version>` or `verifier/go/v<version>` on main runs the matching workflow, which tests, publishes with provenance, signs the files and makes the GitHub release.

## Pinned tools

CI and the releases install exactly what is locked, so a compromised upstream release cannot slip in:

- Python: `verifier/python/requirements-ci.txt`, with hashes, made from `requirements-ci.in` and `pyproject.toml` by the `uv pip compile` line at the top of `requirements-ci.in`, installed with `pip install --require-hashes`, and the package itself with `--no-deps`.
- npm: the CLI the release publishes with is `.github/npm-cli`, installed with `npm ci`.
- Actions: every `uses:` names a full commit, with its version in a comment.

Dependabot proposes each update as a pull request.
