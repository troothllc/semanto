<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 Trooth, LLC -->

# Security policy

## Reporting a vulnerability

Report a vulnerability privately, never in a public issue:

- Use GitHub's [private vulnerability reporting](https://github.com/troothllc/semanto/security/advisories/new) for this repository, or
- email security@trooth.co.

Trooth's [vulnerability disclosure policy](https://trooth.co/security/vulnerability-disclosure-policy) applies, and its contact file is [trooth.co/.well-known/security.txt](https://trooth.co/.well-known/security.txt).

Say what you found, the package and version, and the steps to reproduce it. Trooth acknowledges every report within three business days and responds substantively within ten business days, with its assessment and an expected remediation timeline, as the policy states.

## Supported versions

The latest release of each package receives security fixes.

| Package | Supported |
| --- | --- |
| `@trooth/semanto-verify` | latest 1.x |
| `trooth` (PyPI) | latest 0.x |
| `github.com/troothllc/semanto/verifier/go` | latest 0.x |
| `deploy/cloudflare` (the adapter) | `main` |
| `action.yml` (Semanto on deploy) | latest `v1` |

## What counts

A verifier that accepts what it should refuse is a vulnerability: a forged or altered page passing, a key accepted for a role it does not hold, a revoked or expired version passing, or a log proof accepted that does not prove inclusion or consistency. Add a negative test vector to your report if you can.
