# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 Trooth, LLC
"""The in-process answer path: the matcher gives the service's answers (test-vectors/answer-v1), and SemantoSource reads
the company's site, checks each version once, refreshes within 15 minutes, and keeps answering from the last good
version when Trooth's API cannot be reached."""
import copy
import json
from datetime import datetime
from pathlib import Path

from trooth import SemantoSource
from trooth_semanto_verify.answer import MATCHER, answer, fact_marks, matcher_id
from trooth_semanto_verify.source import MAX_REFRESH_SECONDS

T = Path(__file__).resolve().parent.parent / "test-vectors"
read = lambda n: json.loads((T / n).read_text())  # noqa: E731
VEC = read("v1/semanto.json")
KEYS = read("v1/keys.json")
NOW = datetime.fromisoformat(VEC["now"].replace("Z", "+00:00")).timestamp()


def test_matcher_is_the_shared_one():
    assert MATCHER == read("answer-v1/matcher.json")
    assert matcher_id() == MATCHER["id"]


def test_every_answer_equals_the_service():
    v = read("answer-v1/answers.json")
    marks = fact_marks(v["file"], v["stored_marks"]["changed"], datetime.fromisoformat(v["now"].replace("Z", "+00:00")))
    for c in v["cases"]:
        i = c["input"]
        got = answer(v["file"], v["company"], fact_id=i.get("fact_id"), question=i.get("question"), marks=marks, check_base=v["check_base"], signed_at=v["file"]["witness"]["at"])
        assert got == c["expect"], i


class Net:
    def __init__(self, file=None):
        self.file = file or VEC["file"]
        self.api_down = False
        self.site_down = False
        self.marks = []
        self.calls = []

    def __call__(self, url, headers):
        self.calls.append(url)
        ok = lambda b: (200, {"content-type": "application/json"}, json.dumps(b).encode())  # noqa: E731
        if url.startswith("https://api.trooth.co/"):
            if self.api_down:
                raise OSError("connection refused")
            if url.endswith("/trooth-keys.json"):
                return ok(KEYS["trooth"])
            if url.endswith("/facts/marks"):
                return ok({"version": self.file["header"]["version"], "marks": self.marks})
        if url.startswith("https://acme.com/"):
            if self.site_down:
                raise OSError("connection refused")
            if url.endswith("/.well-known/trooth.semanto"):
                return ok(self.file)
            if url.endswith("/.well-known/trooth-keys.json"):
                return ok(KEYS["company"])
        return 404, {}, b"no"


class Clock:
    def __init__(self):
        self.t = NOW

    def __call__(self):
        return self.t


def test_loads_checks_once_and_answers_in_process():
    net, clock = Net(), Clock()
    s = SemantoSource("acme.com", fetch=net, now=clock)
    a = s.answer(question="What does the Starter plan cost?")
    assert a["status"] == "answer" and a["facts"][0]["statement"] == "The Starter plan costs 49 USD a month for up to 5 seats."
    n = len(net.calls)
    clock.t += 60
    s.answer(question="What is your legal name?")
    assert len(net.calls) == n
    clock.t += MAX_REFRESH_SECONDS
    s.answer(question="What is your legal name?")
    assert len(net.calls) > n and s.checks == 1


def test_refresh_never_longer_than_15_minutes():
    assert SemantoSource("acme.com", refresh_seconds=86400).refresh_seconds == MAX_REFRESH_SECONDS


def test_trooth_api_blocked_answers_from_last_version_and_logs():
    net, clock = Net(), Clock()
    s = SemantoSource("acme.com", fetch=net, now=clock)
    s.answer(question="What is your legal name?")
    net.api_down = True
    clock.t += MAX_REFRESH_SECONDS
    a = s.answer(question="What does the Starter plan cost?")
    assert a["status"] == "answer" and a["version"] == VEC["file"]["header"]["version"]
    assert any(e["event"] == "trooth_api_unreachable" for e in s.events)


def test_site_down_keeps_last_version():
    net, clock = Net(), Clock()
    s = SemantoSource("acme.com", fetch=net, now=clock)
    s.answer(question="What is your legal name?")
    net.site_down = net.api_down = True
    clock.t += MAX_REFRESH_SECONDS
    assert s.answer(question="What is your legal name?")["status"] == "answer"
    assert any(e["event"] == "site_unreachable" for e in s.events)


def test_forged_new_version_refused_good_one_stays():
    net, clock = Net(), Clock()
    s = SemantoSource("acme.com", fetch=net, now=clock)
    s.answer(question="What is your legal name?")
    forged = copy.deepcopy(VEC["file"])
    forged["facts"][2]["statement"] = "The Starter plan costs 1 USD a month for up to 5 seats."
    net.file = forged
    clock.t += MAX_REFRESH_SECONDS
    a = s.answer(question="What does the Starter plan cost?")
    assert a["facts"][0]["statement"] == "The Starter plan costs 49 USD a month for up to 5 seats."
    assert any(e["event"] == "version_refused" for e in s.events)


def test_nothing_checks_out_means_not_read():
    forged = copy.deepcopy(VEC["file"])
    forged["facts"][0]["statement"] = "The company's legal name is Evil Inc."
    a = SemantoSource("acme.com", fetch=Net(forged), now=Clock()).answer(question="What is your legal name?")
    assert a["status"] == "not_read" and a["facts"] == []


def test_copy_for_another_domain_refused():
    net = Net()
    s = SemantoSource("evil.example", fetch=lambda u, h: net(u.replace("https://evil.example/", "https://acme.com/"), h), now=Clock())
    assert s.answer(question="What is your legal name?")["status"] == "not_read"
    assert any(e["event"] == "version_refused" and "not evil.example" in e["detail"] for e in s.events)


def test_marked_fact_returns_mark_and_no_value():
    net = Net()
    fid = VEC["file"]["facts"][2]["id"]
    net.marks = [{"fact_id": fid, "mark": "changed_since_signing"}]
    a = SemantoSource("acme.com", fetch=net, now=Clock()).answer(fact_id=fid)
    assert a["facts"][0]["mark"] == "changed_since_signing" and a["facts"][0]["statement"] is None and "49" not in a["text"]
