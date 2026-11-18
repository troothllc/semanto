# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 Trooth, LLC
"""What a company's own chatbot shows a customer, turn by turn; the same results as the JavaScript kit's turn tests."""
import asyncio
import hashlib
import io
import json
import re
from datetime import datetime
from pathlib import Path

import pytest

from trooth import SemantoSource
from trooth.integrations.answer_path import answer_turn, wsgi_app
from trooth_semanto_verify.answer import answer, fact_marks
from trooth_semanto_verify.turn import (LINES, MAX_TEXT_CHARS, addresses_reader, check_final_answer, complete_question, contact_route, customer_reply,
                                        is_locked, mask_personal, page_sentences, quote_answer, release_checked, values_in, when_unknown)

T = Path(__file__).resolve().parent.parent / "test-vectors"
read = lambda n: json.loads((T / n).read_text())  # noqa: E731
V = read("answer-v1/answers.json")
SET = read("answer-v1/conversations.json")
NOW_V = datetime.fromisoformat(V["now"].replace("Z", "+00:00"))
MARKS = fact_marks(V["file"], V["stored_marks"]["changed"], NOW_V)
NEVER = re.compile(r"\b(verified|verification|score|tier|certified|instant|go live|in flight|handoff|assistants)\b|…|\.\.\.", re.I)
STATEMENTS = {f["statement"] for f in V["file"]["facts"]}
CONDITIONS = {f"Conditions: {'; '.join(f['conditions'])}." for f in V["file"]["facts"] if f.get("conditions")}
TAIL = re.compile(r"^From Acme Inc's signed record\. Signed \d{4}-\d{2}-\d{2}\. Check it: https://api\.trooth\.co/public/semanto/acme/versions/7$")
FIXED = {"Acme Inc has not published this.", "Closest questions in Acme Inc's signed record, listed as choices.",
         "Acme Inc's signed record has this marked as changed since signing, so no value is shown.", "Acme Inc's signed record cannot be checked right now, so no value is shown."}


def ask(**kw):
    return answer(V["file"], V["company"], marks=MARKS, check_base=V["check_base"], signed_at=V["file"]["witness"]["at"], **kw)


def reply(confirmed=False, **kw):
    return customer_reply(ask(**kw), V["file"], domain="acme.com", confirmed=confirmed)


def allowed(line):
    return (line in STATEMENTS or line in CONDITIONS or line in FIXED or bool(TAIL.match(line)) or bool(re.match(r"^Acme Inc's contact: \S+\.$", line))
            or bool(re.match(r"^Acme Inc's signed record holds \d+ answers to this, listed as choices\.$", line))
            or bool(re.match(r"^Acme Inc said this held only until \d{4}-\d{2}-\d{2}, which has passed, so no value is shown\.$", line)))


def test_value_answer_lines():
    r = reply(fact_id="smf_parity08")
    assert r["lines"] == ["The Starter plan costs 49 USD a month for up to 5 seats.", "Conditions: up to 5 seats; per month.",
                          "From Acme Inc's signed record. Signed 2026-11-12. Check it: https://api.trooth.co/public/semanto/acme/versions/7"]
    assert r["markdown"].split("\n")[2] == "From Acme Inc's signed record. Signed 2026-11-12. [Check it](https://api.trooth.co/public/semanto/acme/versions/7)."
    assert r["value"] == 49
    assert reply(question="How much is the Starter plan?")["status"] == "answer"


def test_every_reply_is_short_signed_and_never_addresses_the_reader():
    inputs = [c["input"] for c in V["cases"]] + [{"question": t["question"]} for c in SET["conversations"] for t in c["turns"]]
    for i in inputs:
        for r in (reply(**i), reply(confirmed=True, **i)):
            assert len(r["text"]) <= MAX_TEXT_CHARS and len(r["lines"]) <= 3
            for line in r["lines"]:
                assert allowed(line), line
                assert line in STATEMENTS or not addresses_reader(line), line
                assert not NEVER.search(line), line
    for line in (LINES["signed_record"]("Acme", "2026-01-01"), LINES["contact"]("Acme", "a@b.co"), LINES["choose"]("Acme", 2), LINES["confirm"]("Acme"), LINES["closed"]("Acme")):
        assert not addresses_reader(line) and not NEVER.search(line)


def test_fifty_questions_outside_the_record():
    topics = ["the weather in Paris", "a Mars rover", "dog-friendly parks", "a podcast", "the 2031 roadmap", "a mobile game", "carbon offsets for flights", "a parking garage",
              "a cafeteria menu", "a bowling league", "a theme song", "a submarine", "a horse farm", "the lunar base", "a vineyard", "a film studio", "a ski chalet", "a bakery",
              "a zoo partnership", "a robot mascot", "a blimp", "the chess club", "a hot air balloon", "a sailing team", "the marathon sponsorship", "a choir", "a museum wing",
              "a time capsule", "an ice rink", "a pumpkin patch", "the orchestra", "a treehouse", "a llama farm", "a comic book", "a jazz band", "a lighthouse", "a castle",
              "a rodeo", "a circus", "a volcano tour", "a desert rally", "a snow globe", "a crossword", "a tea ceremony", "a kite festival", "a glacier hike",
              "a sandcastle contest", "a puppet show", "a meteor shower party", "your CEO's favorite color"]
    assert len(topics) == 50
    for t in topics:
        r = reply(question=f"Tell me about {t}?")
        assert r["status"] == "not_published", t
        assert r["lines"] == ["Acme Inc has not published this.", "Acme Inc's contact: hello@acme.com."]
        assert r["contact"]["href"] == "mailto:hello@acme.com"
    vec = read("v1/semanto.json")
    assert when_unknown(vec["file"], "Acme Inc") == "Acme has not published this."
    assert contact_route(vec["file"], "acme.com") == {"kind": "url", "value": "https://acme.com", "href": "https://acme.com"}


def test_follow_ups():
    assert complete_question("What about the other one?", ["Do you offer refunds?"]) == "Do you offer refunds?"
    assert complete_question("Can you say that again?", ["When were you founded?", "And again?"]) == "When were you founded?"
    assert complete_question("What about Chicago?", ["What is your phone number?"]) == "What is your phone number Chicago?"
    assert complete_question("What about it?", []) == "What about it?"


def test_conversation_set_never_shows_a_wrong_locked_value():
    turns = 0
    for c in SET["conversations"]:
        history = []
        for t in c["turns"]:
            q = complete_question(t["question"], history)
            r = reply(question=q)
            turns += 1
            assert t["draft"] not in r["text"]
            assert check_final_answer(r["text"], V["file"])["ok"], (c["id"], r["text"])
            assert all(allowed(x) for x in r["lines"])
            if r["status"] == "answer" and is_locked(next(f for f in V["file"]["facts"] if f["id"] == r["fact_id"])):
                assert r["matched_by"] != "similarity"
            history.append(t["question"])
    assert turns == 796


def test_confirm_on_similarity_and_marks():
    sim = {**ask(fact_id="smf_parity08"), "matched_by": "similarity"}
    conf = customer_reply(sim, V["file"], domain="acme.com")
    assert conf["status"] == "confirm" and conf["choices"][0]["fact_id"] == "smf_parity08" and "49" not in conf["text"]
    assert customer_reply(sim, V["file"], domain="acme.com", confirmed=True)["status"] == "answer"
    assert customer_reply({**ask(fact_id="smf_parity10"), "matched_by": "similarity"}, V["file"], domain="acme.com")["status"] == "answer"
    assert reply(fact_id="smf_parity13")["lines"] == ["Acme Inc's signed record has this marked as changed since signing, so no value is shown.", "Acme Inc's contact: hello@acme.com."]
    assert reply(fact_id="smf_parity12")["lines"][0] == "Acme Inc said this held only until 2026-01-01, which has passed, so no value is shown."


VEC = read("v1/semanto.json")
KEYS = read("v1/keys.json")
PAGES = read("v1/pages.json")
NOW = datetime.fromisoformat(VEC["now"].replace("Z", "+00:00")).timestamp()


class Net:
    def __init__(self, **state):
        self.state = state
        self.calls = []

    def __call__(self, url, headers):
        self.calls.append(url)
        ok = lambda b: (200, {}, json.dumps(b).encode())  # noqa: E731
        s = self.state
        if url.startswith("https://api.trooth.co/"):
            if url.endswith("/trooth-keys.json"):
                return ok(KEYS["trooth"])
            if url.endswith("/facts/marks"):
                return ok({"version": VEC["file"]["header"]["version"], "marks": s.get("marks", [])})
            if url.endswith("/answer-mode"):
                return ok({"mode": s.get("mode", "checked"), "generated_sentences": False, **({"free_form": s["free_form"]} if s.get("free_form") else {} if "free_form" in s else {"free_form": "quoted"})})
            if url.endswith("/revocations"):
                return ok({"list": s["revocations"]}) if s.get("revocations") else (404, {}, b"{}")
            m = re.search(r"/pages/(smp_[a-z0-9]+)$", url)
            if m:
                return 200, {}, (s.get("page_text", {}).get(m.group(1)) or PAGES["by_id"][m.group(1)]).encode()
        if url.startswith("https://acme.com/"):
            if s.get("site_down"):
                raise OSError("connection refused")
            if url.endswith("/.well-known/trooth.semanto"):
                return ok(VEC["file"])
            if url.endswith("/.well-known/trooth-keys.json"):
                return ok(s.get("company_keys") or KEYS["company"])
        return 404, {}, b"no"


class Clock:
    t = NOW

    def __call__(self):
        return self.t


def test_fails_closed_and_alerts_once():
    alerts = []
    s0 = SemantoSource("acme.com", fetch=Net(site_down=True), now=Clock(), on_alert=alerts.append)
    r0 = s0.reply(question="How much is the Starter plan?")
    assert r0["status"] == "closed" and r0["lines"] == ["acme.com's signed record cannot be checked right now, so no value is shown.", "acme.com's contact: https://acme.com."]
    s0.reply(question="How much is the Starter plan?")
    assert len(alerts) == 1
    net, clock = Net(), Clock()
    s = SemantoSource("acme.com", fetch=net, now=clock, on_alert=alerts.append)
    assert s.reply(question="How much is the Starter plan?")["status"] == "answer"
    net.state["revocations"] = {"revocations": [{"kind": "version", "ref": VEC["file"]["root_hash"], "reason": "withdrawn", "revoked_at": VEC["now"]}]}
    clock.t += 901
    s.refresh()
    assert s.closed == "withdrawn"
    w = s.reply(question="How much is the Starter plan?")
    assert w["status"] == "closed" and "49" not in w["text"]
    net.state["revocations"] = None
    net.state["company_keys"] = {"keys": []}
    clock.t += 901
    s.refresh()
    assert s.closed == "key_revoked"
    net.state["company_keys"] = None
    clock.t += 901
    s.refresh()
    assert s.closed is None and s.reply(question="How much is the Starter plan?")["status"] == "answer"
    price = next(f["id"] for f in VEC["file"]["facts"] if "pricing" in f["key"])
    m = SemantoSource("acme.com", fetch=Net(marks=[{"fact_id": price, "mark": "changed_since_signing"}]), now=Clock(), on_alert=alerts.append)
    r = m.reply(question="How much is the Starter plan?")
    assert r["status"] == "marked" and "49" not in r["text"] and r["lines"][1] == "Acme Inc's contact: https://acme.com."


def test_two_hundred_streamed_answers_release_only_checked_sentences():
    rec = []
    released = 0
    tick = iter(range(1, 10_000_000))
    for i in range(200):
        t = SET["conversations"][i % len(SET["conversations"])]["turns"][0]
        f = V["file"]["facts"][i % len(V["file"]["facts"])]
        for r in release_checked(iter((f["statement"] + " " + t["draft"]).split(" ")[0:1] + [" " + w for w in (f["statement"] + " " + t["draft"]).split(" ")[1:]]),
                                 lambda x: check_final_answer(x, V["file"])["ok"], now=lambda: next(tick), recording=rec):
            released += 1
            assert r["released_at"] > r["checked_at"]
    assert released > 0 and len(rec) >= 400
    for e in rec:
        if e["released_at"] is not None:
            assert e["ok"] and e["released_at"] > e["checked_at"]
        if not check_final_answer(e["sentence"], V["file"])["ok"]:
            assert e["released_at"] is None
    s = SemantoSource.from_checked(V["file"], domain="acme.com", now=lambda: NOW_V.timestamp())
    assert [x["sentence"] for x in s.stream(["Starter costs 49 USD a month. Starter costs 19 USD a month. ", "Acme was founded in 2012."])] == ["Starter costs 49 USD a month.", "Acme was founded in 2012."]


def test_quote_assembled_answers():
    net = Net()
    s = SemantoSource("acme.com", fetch=net, now=Clock())
    pages = s.pages()
    assert len(pages) == 3
    sec = next(p for p in pages if p["url"] == "https://acme.com/security")
    assert [x["text"] for x in page_sentences(sec)][1:3] == ["Every employee account uses multi-factor authentication.", "Customer data is stored in the United States."]
    pid = "smp_mh2iriw5u3rzy53s3mqowrgbh7"
    seen = {}

    def model(question, sentences):
        seen["q"] = question
        return {"runs": [{"from": f"{pid}:2", "to": f"{pid}:3"}]}

    q = s.quote("How do you protect accounts? Reply to jane@example.com", model)
    assert "jane@example.com" not in seen["q"]
    assert q["text"] == "Security at Acme (https://acme.com/security):\nEvery employee account uses multi-factor authentication. Customer data is stored in the United States."
    stale = {"id": "smp_d3cg2phrlawntfrxsxsvah7y7f", "title": "Pricing", "url": "https://acme.com/pricing", "text": "Starter is our smallest plan.\nStarter costs 39 USD a month.\nEvery plan includes a trial."}
    h = quote_answer(VEC["file"], [stale], {"runs": [{"from": f"{stale['id']}:1", "to": f"{stale['id']}:3"}]})
    assert h["status"] == "quoted" and "39 USD" not in h["text"] and [(x["id"], x["reason"]) for x in h["held"]] == [(f"{stale['id']}:2", "unsigned_value")]
    for bad in (None, {}, {"runs": []}, {"runs": [{"from": f"{stale['id']}:2", "to": f"{stale['id']}:1"}]}, {"runs": [{"from": f"{stale['id']}:1", "to": "smp_other:1"}]},
                {"runs": [{"from": f"{stale['id']}:1", "to": f"{stale['id']}:9"}]}, {"runs": [{"from": f"{stale['id']}:1", "to": f"{stale['id']}:1", "text": "x"}]}):
        assert quote_answer(VEC["file"], [stale], bad)["status"] == "not_published"
    t = SemantoSource("acme.com", fetch=Net(page_text={pid: "# Security\n\nWe never encrypt anything.\n"}), now=Clock())
    assert len(t.pages()) == 2 and any(e["event"] == "page_unreadable" for e in t.events)


def test_seeded_personal_detail_never_leaves():
    seeded = ["jane.doe@example.com", "+1 555 867 5309", "5558675309", "Jane Doe"]
    net = Net(mode="audit")
    sent = []
    s = SemantoSource("acme.com", fetch=net, now=Clock(), support_check=lambda x: sent.append(x) or True)
    q = "I'm Jane Doe, jane.doe@example.com, +1 555 867 5309. How much is the Starter plan?"
    s.reply(question=q)
    s.respond(question=q, draft="Starter is 49 USD a month.")
    s.output_step("Jane Doe asked: Starter is 49 USD a month.", question=q)
    s.quote(q, lambda question, sentences: (sent.append(question), {"runs": [{"from": "smp_mh2iriw5u3rzy53s3mqowrgbh7:2", "to": "smp_mh2iriw5u3rzy53s3mqowrgbh7:2"}]})[1])
    list(s.stream(["Jane Doe can reach us. ", "Write to jane.doe@example.com or call +1 555 867 5309. ", "Starter costs 49 USD a month."]))
    out = "\n".join(net.calls + sent)
    for d in seeded:
        assert d not in out
    assert sent
    assert mask_personal("Mail jane.doe@example.com or Acme at hello@acme.com; Jane Doe called +1 555 867 5309, Acme Inc answered at +1 312 555 0100.", V["file"]) == \
        "Mail [email] or Acme at hello@acme.com; [name] called [phone], Acme Inc answered at +1 312 555 0100."
    assert [f"{v['kind']}:{v['norm']}" for v in values_in("Starter is $49, or 49 USD; 20% off; 30 days; call +1 312 555 0100; hello@acme.com")] == \
        ["email:hello@acme.com", "money:49 USD", "money:49 USD", "percent:20", "phone:3125550100", "counted:30 day"]


# ------------------------------------------------------------------ frameworks

ALTERED = "The Starter plan costs 19 USD a month for up to 5 seats."


def fixed(mode):
    return SemantoSource.from_checked(V["file"], domain="acme.com", now=lambda: NOW_V.timestamp(), changed=V["stored_marks"]["changed"], mode=mode)


def passes_set(name, turn):
    n = 0
    for c in SET["conversations"]:
        history = []
        for t in c["turns"]:
            text = turn(t, history)
            n += 1
            assert t["draft"] not in text, name
            for line in text.split("\n"):
                assert allowed(line), (name, c["id"], line)
            history.append(t["question"])
    assert n == 796


def post(app, body):
    raw = json.dumps(body).encode() if not isinstance(body, bytes) else body
    got = {}
    out = app({"REQUEST_METHOD": "POST", "CONTENT_LENGTH": str(len(raw)), "wsgi.input": io.BytesIO(raw)}, lambda s, h: got.update(status=s))
    return got["status"], json.loads(b"".join(out))


def test_plain_https_and_the_output_step():
    s = fixed("checked")
    app = wsgi_app(s, lambda q, h: ALTERED)
    passes_set("https", lambda t, h: post(app, {"question": t["question"], "history": h})[1]["text"])
    passes_set("turn", lambda t, h: answer_turn(s, question=t["question"], history=h, draft=t["draft"])["text"])
    o = fixed("source_only")
    q = "How much is the Starter plan?"
    assert answer_turn(o, question=q, draft=ALTERED, output_step=False)["text"] == ALTERED
    c = answer_turn(o, question=q, draft=ALTERED)
    assert "19 USD" not in c["text"] and c["text"].startswith("The Starter plan costs 49 USD") and [v["raw"] for v in c["caught"]] == ["19 USD"]
    st, body = post(wsgi_app(o, lambda q, h: ALTERED), {"question": q})
    assert st == "200 OK" and "19 USD" not in body["text"] and len(body["caught"]) == 1
    got = {}
    wsgi_app(o)({"REQUEST_METHOD": "GET"}, lambda s_, h: got.update(status=s_))
    assert got["status"].startswith("405")
    assert post(wsgi_app(o), b"nope")[0].startswith("400")


def test_langchain_sample_and_output_step():
    pytest.importorskip("langchain_core")
    from langchain_core.language_models.fake_chat_models import FakeListChatModel
    from langchain_core.messages import AIMessage, HumanMessage

    from trooth.integrations.langchain import semanto_runnable

    s = fixed("checked")

    def turn(t, history):
        bot = semanto_runnable(FakeListChatModel(responses=[t["draft"]]), s)
        return bot.invoke([*[HumanMessage(h) for h in history], HumanMessage(t["question"])])

    passes_set("langchain", turn)
    bot = semanto_runnable(FakeListChatModel(responses=[ALTERED]), fixed("source_only"))
    out = bot.invoke([HumanMessage("How much is the Starter plan?")])
    assert "19 USD" not in out and out.startswith("The Starter plan costs 49 USD")
    assert isinstance(AIMessage("x").content, str)


def test_llama_index_sample_and_output_step():
    pytest.importorskip("llama_index.core")
    from trooth.integrations.llama_index import SemantoQueryEngine

    class Inner:
        def __init__(self, text):
            self.text = text

        def query(self, q):
            return type("R", (), {"response": self.text})()

    s = fixed("checked")
    passes_set("llama-index", lambda t, h: str(SemantoQueryEngine(inner=Inner(t["draft"]), source=s).query(t["question"])))
    out = str(SemantoQueryEngine(inner=Inner(ALTERED), source=fixed("source_only")).query("How much is the Starter plan?"))
    assert "19 USD" not in out and out.startswith("The Starter plan costs 49 USD")


def test_openai_agents_guardrail():
    pytest.importorskip("agents")
    from agents import Agent, RunContextWrapper

    from trooth.integrations.openai_agents import semanto_output_guardrail

    g = semanto_output_guardrail(fixed("source_only"))
    agent = Agent(name="acme", instructions="x")
    ctx = RunContextWrapper(context={"question": "How much is the Starter plan?"})
    out = asyncio.run(g.run(ctx, agent, ALTERED))
    assert out.output.tripwire_triggered is True and out.output.output_info["reply"]["text"].startswith("The Starter plan costs 49 USD")
    ok = asyncio.run(g.run(RunContextWrapper(context={"question": "When were you founded?"}), agent, "Acme was founded in 2012."))
    assert ok.output.tripwire_triggered is False
    s = fixed("checked")
    passes_set("openai-agents", lambda t, h: answer_turn(s, question=t["question"], history=h, draft=t["draft"])["text"])


def test_page_hashes_match_the_manifest():
    for p in VEC["file"]["header"]["pages_manifest"]:
        assert "sha256:" + hashlib.sha256(PAGES["by_id"][p["id"]].encode()).hexdigest() == p["hash"]


# ------------------------------------------------------------------ locked values and languages

def _locked():
    return json.loads((Path(__file__).resolve().parent.parent / "test-vectors" / "locked-v1" / "vectors.json").read_text(encoding="utf-8"))


def test_locked_fifty_seeded_drafts_are_removed_as_the_javascript_kit_removes_them():
    from trooth_semanto_verify.turn import guard_outgoing
    v = _locked()
    assert len(v["drafts"]) == 50
    for d in v["drafts"]:
        got = guard_outgoing(d["draft"], v["file"], code_answer=v["code_answer"])
        assert got == d["out"], d["draft"]
        assert got["ok"] is False and got["text"] == v["code_answer"]
    for k in v["kept"]:
        assert guard_outgoing(k["draft"], v["file"], code_answer=v["code_answer"])["ok"] is True, k["draft"]


def test_locked_a_company_added_locked_type():
    from trooth_semanto_verify.turn import guard_outgoing
    v = _locked()
    types = [{"kind": "sku", "pattern": re.compile(r"\bSKU-\d+\b", re.I)}]
    assert guard_outgoing("Order SKU-12 today.", v["file"], locked_types=types)["ok"] is False
    f = {"facts": [*v["file"]["facts"], {"id": "f9", "key": "product.x", "statement": "Order SKU-12 today."}]}
    assert guard_outgoing("Ask for SKU-12 at the desk.", f, locked_types=types)["ok"] is True


def test_languages_values_rendered_by_code_in_each_language_as_the_javascript_kit_renders_them():
    from trooth_semanto_verify.turn import LOCALES, value_reply
    v = _locked()
    assert len(v["replies"]) == 20 * len(LOCALES)
    for r in v["replies"]:
        got = value_reply({"statement": r["statement"], "typed": r["typed"]}, r["lang"], translated=r.get("translated"), check=r.get("check"))
        assert got == r["reply"], (r["lang"], r["typed"])
        assert got["value"] == r["typed"]["value"]


def test_ap75_no_g8_pass_gives_the_not_published_reply_without_asking_the_model():
    for free_form in ("not_published", None):
        net = Net(free_form=free_form)
        s = SemantoSource("acme.com", fetch=net, now=Clock())
        asked = []
        q = s.quote("How do you protect accounts?", lambda question, sentences: (asked.append(1), {"runs": [{"from": "smp_mh2iriw5u3rzy53s3mqowrgbh7:2", "to": "smp_mh2iriw5u3rzy53s3mqowrgbh7:2"}]})[1])
        assert q["status"] == "not_published"
        assert q["problem"] == "gate_g8_not_met"
        assert q["text"].startswith("Acme has not published this.")
        assert asked == []
