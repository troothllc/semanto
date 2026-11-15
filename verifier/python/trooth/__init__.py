# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 Trooth, LLC
"""Trooth for Python: read a company's Semanto signed copy and check it.

    from trooth import SemantoClient
    r = SemantoClient().read("https://acme.com/pricing")

    from trooth import SemantoSource
    a = SemantoSource("acme.com").answer(question="What is your phone number?")

The checks themselves live in trooth_semanto_verify (the same functions and reason codes as the JavaScript and Go
kits). Framework integrations are optional extras: trooth[langchain], trooth[llama-index], trooth[openai-agents].
"""
from trooth_semanto_verify.client import SemantoClient
from trooth_semanto_verify.source import SemantoSource

__version__ = "0.3.0"
__all__ = ["SemantoClient", "SemantoSource", "__version__"]
