# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 Trooth, LLC
"""The three answer modes (Checked, Source only, Audit) and the output step, for any Python chatbot.

No framework is imported here; the framework adapters (langchain.semanto_runnable, llama_index.SemantoQueryEngine,
openai_agents.semanto_output_guardrail) build on answer_turn, and wsgi_app serves plain HTTPS.

    from trooth import SemantoSource
    from trooth.integrations.answer_path import answer_turn
    acme = SemantoSource("acme.com")
    turn = answer_turn(acme, question="How much is Starter?", draft=my_model(question))
    send(turn["text"])
"""
from __future__ import annotations

import json
from typing import Any, Callable, Iterable, List, Optional


def answer_turn(source: Any, question: Optional[str] = None, draft: str = "", history: Optional[List[str]] = None, fact_id: Optional[str] = None,
                mode: Optional[str] = None, output_step: bool = True) -> dict:
    """One turn in the company's answer mode. Checked builds the reply by code; Source only and Audit pass the draft, and
    with the output step on (the default) a draft carrying a value the company did not sign is caught before it is
    returned and replaced by the checked reply."""
    r = source.respond(question=question, draft=draft, fact_id=fact_id, mode=mode, history=history or [])
    if r["mode"] == "checked" or not output_step:
        return {**r, "caught": []}
    step = source.output_step(draft, question=question, fact_id=fact_id, history=history or [])
    if step["ok"]:
        return {**r, "caught": []}
    return {"mode": r["mode"], "status": step["reply"]["status"], "text": step["reply"]["text"], "reply": step["reply"], "caught": step["caught"], "audit": r.get("audit")}


def text_of(out: Any) -> str:
    """The text of whatever a framework returned: a string, a message (content), a response object (response) or a dict."""
    if isinstance(out, str):
        return out
    for attr in ("content", "response", "output", "text", "final_output"):
        v = out.get(attr) if isinstance(out, dict) else getattr(out, attr, None)
        if v is not None:
            if isinstance(v, list):
                return "".join(p if isinstance(p, str) else (p.get("text", "") if isinstance(p, dict) else getattr(p, "text", "")) for p in v)
            return str(v)
    return str(out)


def user_turns(messages: Any) -> List[str]:
    """The user messages in a chat input, oldest first (a string is one message)."""
    if isinstance(messages, str):
        return [messages]
    if isinstance(messages, dict):
        if "question" in messages or "input" in messages or "query" in messages:
            q = messages.get("question") or messages.get("input") or messages.get("query")
            return [*list(messages.get("history") or []), str(q)]
        messages = messages.get("messages") or []
    out = []
    for m in messages or []:
        if isinstance(m, tuple) and len(m) == 2:
            role, content = m
        elif isinstance(m, dict):
            role, content = m.get("role"), m.get("content")
        else:
            role, content = getattr(m, "type", None) or getattr(m, "role", None), getattr(m, "content", None)
        if role in ("user", "human"):
            out.append(text_of({"content": content}) if not isinstance(content, str) else content)
    return out


def wsgi_app(source: Any, model: Optional[Callable[[str, List[str]], str]] = None, mode: Optional[str] = None, output_step: bool = True) -> Callable:
    """A WSGI app for plain HTTPS (gunicorn, uWSGI, any WSGI server): POST JSON {question, history?, fact_id?, confirmed?}.
    `model(question, history)` is the company's own model; it is not called in Checked mode."""

    def app(environ: dict, start_response: Callable) -> Iterable[bytes]:
        def send(status: str, body: dict, extra: Optional[list] = None) -> List[bytes]:
            data = json.dumps(body).encode()
            start_response(status, [("Content-Type", "application/json"), ("Content-Length", str(len(data))), *(extra or [])])
            return [data]

        if environ.get("REQUEST_METHOD") != "POST":
            return send("405 Method Not Allowed", {"error": "POST a JSON body with a question."}, [("Allow", "POST")])
        try:
            n = min(int(environ.get("CONTENT_LENGTH") or 0), 64_000)
            body = json.loads(environ["wsgi.input"].read(n) or b"null")
        except (ValueError, KeyError):
            return send("400 Bad Request", {"error": "The body is not JSON."})
        if not isinstance(body, dict):
            return send("400 Bad Request", {"error": "The body is not a JSON object."})
        question = str(body.get("question") or "")[:2000]
        history = [h for h in body.get("history") or [] if isinstance(h, str)][-20:]
        fact_id = body.get("fact_id") if isinstance(body.get("fact_id"), str) else None
        m = mode or source.answer_mode()["mode"]
        if fact_id or m == "checked":
            return send("200 OK", {"mode": m, **source.reply(fact_id=fact_id, question=question, history=history, confirmed=body.get("confirmed") is True)})
        draft = str(model(question, history)) if model else ""
        t = answer_turn(source, question=question, draft=draft, history=history, mode=m, output_step=output_step)
        t.pop("audit", None)
        return send("200 OK", t)

    return app


__all__ = ["answer_turn", "text_of", "user_turns", "wsgi_app"]
