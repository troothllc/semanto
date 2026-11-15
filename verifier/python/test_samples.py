# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 Trooth, LLC
"""The Python sample chatbots in examples/answer-path, each over the 200 fixed conversations in Checked mode, and each
with an altered value seeded in Source only mode that the output step must catch."""
import asyncio
import importlib.util
import io
import json
import re
import sys
from datetime import datetime
from pathlib import Path

import pytest

from trooth import SemantoSource

ROOT = Path(__file__).resolve().parent.parent
V = json.loads((ROOT / "test-vectors/answer-v1/answers.json").read_text())
SET = json.loads((ROOT / "test-vectors/answer-v1/conversations.json").read_text())
STATEMENTS = {f["statement"] for f in V["file"]["facts"]}
CONDITIONS = {f"Conditions: {'; '.join(f['conditions'])}." for f in V["file"]["facts"] if f.get("conditions")}
LIBRARY = re.compile(r"^(From Acme Inc's signed record\. Signed \d{4}-\d{2}-\d{2}\. Check it: \S+|Acme Inc has not published this\.|Acme Inc's contact: \S+\.|"
                     r"Acme Inc's signed record holds \d+ answers to this, listed as choices\.|Closest questions in Acme Inc's signed record, listed as choices\.|"
                     r"Acme Inc's signed record has this marked as changed since signing, so no value is shown\.|"
                     r"Acme Inc said this held only until \d{4}-\d{2}-\d{2}, which has passed, so no value is shown\.)$")
ALTERED = "The Starter plan costs 19 USD a month for up to 5 seats."
NOW = datetime.fromisoformat(V["now"].replace("Z", "+00:00")).timestamp()


def sample(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "examples/answer-path" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def source(mode):
    return SemantoSource.from_checked(V["file"], domain="acme.com", now=lambda: NOW, changed=V["stored_marks"]["changed"], mode=mode)


def run_set(turn):
    n = 0
    for c in SET["conversations"]:
        history = []
        for t in c["turns"]:
            text = turn(t["draft"], t["question"], history)
            n += 1
            assert t["draft"] not in text
            for line in text.split("\n"):
                assert line in STATEMENTS or line in CONDITIONS or LIBRARY.match(line), (c["id"], line)
            history.append(t["question"])
    assert n == 796


def check_output_step(turn):
    text = turn(ALTERED, "How much is the Starter plan?", [])
    assert "19 USD" not in text and text.startswith("The Starter plan costs 49 USD a month for up to 5 seats.")
    assert turn("Acme was founded in 2012.", "When were you founded?", []) == "Acme was founded in 2012."


def test_https_sample():
    bot = sample("https_bot")

    def turn_for(s):
        def turn(draft, q, history):
            raw = json.dumps({"question": q, "history": history}).encode()
            out = bot.build(s, lambda question, h: draft)({"REQUEST_METHOD": "POST", "CONTENT_LENGTH": str(len(raw)), "wsgi.input": io.BytesIO(raw)}, lambda st, h: None)
            return json.loads(b"".join(out))["text"]
        return turn

    run_set(turn_for(source("checked")))
    check_output_step(turn_for(source("source_only")))


def test_langchain_sample():
    pytest.importorskip("langchain_core")
    from langchain_core.language_models.fake_chat_models import FakeListChatModel

    bot = sample("langchain_bot")

    def turn_for(s):
        return lambda draft, q, history: bot.build(s, FakeListChatModel(responses=[draft])).invoke([*[("human", h) for h in history], ("human", q)])

    run_set(turn_for(source("checked")))
    check_output_step(turn_for(source("source_only")))


def test_llama_index_sample():
    pytest.importorskip("llama_index.core")
    bot = sample("llama_index_bot")

    class Engine:
        def __init__(self, text):
            self.text = text

        def query(self, q):
            return type("Response", (), {"response": self.text})()

    def turn_for(s):
        return lambda draft, q, history: str(bot.build(s, Engine(draft)).query(q))

    run_set(turn_for(source("checked")))
    check_output_step(turn_for(source("source_only")))


def test_openai_agents_sample():
    pytest.importorskip("agents")
    from agents import Agent, RunContextWrapper

    bot = sample("openai_agents_bot")

    def turn_for(s):
        def turn(draft, q, history):
            agent = Agent(name="Acme support", instructions="x")
            ask = bot.build(s, agent)
            if s.answer_mode()["mode"] == "checked":
                return ask(q)
            # Run the agent's own guardrail on the draft as the Runner does on a final output.
            out = asyncio.run(agent.output_guardrails[0].run(RunContextWrapper(context={"question": q}), agent, draft))
            return out.output.output_info["reply"]["text"] if out.output.tripwire_triggered else draft
        return turn

    run_set(turn_for(source("checked")))
    check_output_step(turn_for(source("source_only")))
