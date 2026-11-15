# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 Trooth, LLC
"""A function tool for the OpenAI Agents SDK (pip install "trooth[openai-agents]")."""
from __future__ import annotations

import json
from typing import Any, Optional

from agents import FunctionTool, GuardrailFunctionOutput, OutputGuardrail, function_tool, output_guardrail
from trooth_semanto_verify.client import SemantoClient

from .answer_path import text_of


def read_as_json(client: Any, url: str, max_chars: int = 20_000) -> str:
    """The tool's answer: whether the copy checked out, and the text, as one JSON string."""
    r = client.read(url)
    text = r["text"]
    return json.dumps({
        "url": url,
        "ok": bool(r["ok"]),
        "reason": r.get("reason"),
        "version": r.get("version"),
        "signed_by": r.get("signed_by") or ("company" if r.get("keyid") else None),
        "dns": r.get("dns"),
        "text": text[:max_chars],
        "cut": len(text) > max_chars,
    })


def semanto_read_tool(client: Optional[Any] = None, max_chars: int = 20_000) -> FunctionTool:
    c = client or SemantoClient()

    @function_tool(name_override="semanto_read")
    def semanto_read(url: str) -> str:
        """Read a page from a company's website as its signed Semanto copy, and say whether the signature checked out.

        Args:
            url: The page's address on the company's own domain, for example https://acme.com/pricing.
        """
        return read_as_json(c, url, max_chars)

    return semanto_read


def semanto_output_guardrail(source: Any, question_of: Optional[Any] = None) -> OutputGuardrail:
    """An output guardrail: its tripwire fires when the agent's final answer carries a value the company did not sign, so
    the answer is never returned; output_info carries the checked reply to send instead. The question is read from the
    run context's `question` (a dict key or attribute), or from question_of(ctx)."""

    @output_guardrail(name="semanto_output_step")
    async def semanto_output_step(ctx: Any, agent: Any, output: Any) -> GuardrailFunctionOutput:
        c = getattr(ctx, "context", None)
        question = question_of(ctx) if question_of else (c.get("question") if isinstance(c, dict) else getattr(c, "question", None))
        step = source.output_step(text_of(output), question=question)
        info = {"ok": True} if step["ok"] else {"ok": False, "caught": step["caught"], "reply": step["reply"]}
        return GuardrailFunctionOutput(output_info=info, tripwire_triggered=not step["ok"])

    return semanto_output_step


__all__ = ["semanto_read_tool", "read_as_json", "semanto_output_guardrail"]
