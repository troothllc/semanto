# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 Trooth, LLC
"""SemantoSource: a company's signed copy, loaded from the company's own site and answered from in process.

    from trooth import SemantoSource
    acme = SemantoSource("acme.com")
    a = acme.answer(question="What is your phone number?")
    if a["status"] == "answer":
        show(a["text"])

It reads https://<domain>/.well-known/trooth.semanto and the company's keys from the same site, checks the file
(signature, witness, roots, window) once for each new body it serves, and answers value questions with the same matcher
as Trooth's service (answer.py). It reads the site again at most every refresh_seconds (900 at most, so a new version is
used within 15 minutes), and the marks (changed since signing, expired) with each refresh.

Trooth's API is used only for Trooth's witness keys and the monitor's marks. When it cannot be reached the source keeps
answering from the last version that checked out, keeps the last keys and marks, applies the date marks itself, and logs
a "trooth_api_unreachable" event. A new version is adopted only when it checks out; until then the last good one stays
in use and the failure is logged. The standard library does the HTTP; pass `fetch` to use your own.
"""
from __future__ import annotations

import json
import threading
import unicodedata
import time
import urllib.parse
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Iterable, List, Optional

from .answer import answer as _answer
from .answer import MARK_WORDS, fact_marks
from .client import Fetch, urllib_fetch
from .turn import (check_final_answer, check_sentence, complete_question, customer_reply, is_locked, mask_personal, page_sentences, quote_answer,
                   release_checked, signed_values)
from .verify import state_of, verify_semanto

TROOTH_API = "https://api.trooth.co"
MAX_REFRESH_SECONDS = 900
# The answer modes a company chooses on trooth.co.
ANSWER_MODES = ("checked", "source_only", "audit")


class SemantoSource:
    def __init__(self, domain: str, fetch: Optional[Fetch] = None, api_base: str = TROOTH_API, refresh_seconds: float = MAX_REFRESH_SECONDS,
                 now: Optional[Callable[[], float]] = None, on_event: Optional[Callable[[dict], None]] = None,
                 on_alert: Optional[Callable[[dict], None]] = None, support_check: Optional[Callable[[str], bool]] = None):
        d = domain.lower()
        for p in ("https://", "http://"):
            if d.startswith(p):
                d = d[len(p):]
        self.domain = d.split("/")[0]
        self.fetch: Fetch = fetch or urllib_fetch
        self.api_base = api_base.rstrip("/")
        self.refresh_seconds = min(max(refresh_seconds, 1), MAX_REFRESH_SECONDS)
        self.now = now or time.time
        self.on_event = on_event
        self.events: List[dict] = []
        self.file: Optional[dict] = None
        self.company: Optional[dict] = None
        self.trooth_keys: Optional[dict] = None
        self.changed: List[str] = []
        self.checked_at: Optional[float] = None
        self.checks = 0
        self._body: Optional[str] = None
        self._lock = threading.Lock()
        self._mode: Optional[dict] = None
        self._mode_read_at: Optional[float] = None
        self._mode_fresh = False
        # Why no value may be shown (not_read, withdrawn, key_revoked, recheck_failed), or None.
        self.closed: Optional[str] = None
        self.revocations: Optional[dict] = None
        self._alerted: set = set()
        self.on_alert = on_alert
        self.support_check = support_check
        self._pages: Dict[str, dict] = {}

    @classmethod
    def from_checked(cls, file: dict, domain: Optional[str] = None, now: Optional[Callable[[], float]] = None, changed: Optional[List[str]] = None,
                     mode: str = "checked", **kw: Any) -> "SemantoSource":
        """A source over a copy the caller already checked (verify_semanto) and keeps up to date itself: no site reads, no
        refresh. The marks are the date marks plus `changed`; the mode is `mode`."""
        h = file.get("header") or {}

        def no_network(url: str, headers: Dict[str, str]):
            raise OSError("this source does not read the network")

        s = cls(domain or (h.get("domains") or [None])[0] or (h.get("identity") or {}).get("domain") or "localhost", fetch=kw.pop("fetch", None) or no_network, now=now, **kw)
        s.file = file
        s._body = json.dumps(file, sort_keys=True, separators=(",", ":"))
        s.company = {"trooth_id": h["trooth_id"], "org": h["org"], "domain": s.domain}
        s.changed = list(changed or [])
        s.checked_at = float("inf")
        s._mode = {"mode": mode, "generated_sentences": False, "free_form": "not_published"}
        s._mode_read_at = float("inf")
        s._mode_fresh = True
        return s

    def _alert(self, reason: str, detail: str) -> None:
        """Tell the owner, once per reason, that customers are getting the fail-closed or contact-route reply."""
        if reason in self._alerted:
            return
        self._alerted.add(reason)
        self._log("owner_alert", f"{reason}: {detail}")
        if self.on_alert:
            try:
                self.on_alert({"reason": reason, "detail": detail})
            except Exception:  # noqa: BLE001 (the owner's hook must not stop a reply)
                pass

    def _log(self, event: str, detail: str) -> None:
        e = {"at": datetime.fromtimestamp(self.now(), timezone.utc).isoformat().replace("+00:00", "Z"), "event": event, "detail": detail}
        self.events.append(e)
        del self.events[:-200]
        if self.on_event:
            try:
                self.on_event(e)
            except Exception:  # noqa: BLE001 (the caller's logger must not stop an answer)
                pass

    def _json(self, url: str) -> Any:
        status, _, body = self.fetch(url, {"Accept": "application/json"})
        if status != 200:
            raise RuntimeError(f"answered {status}")
        return json.loads(body)

    def _trooth_key_set(self) -> Optional[dict]:
        try:
            self.trooth_keys = self._json(f"{self.api_base}/public/semanto/.well-known/trooth-keys.json")
        except Exception as e:  # noqa: BLE001
            self._log("trooth_api_unreachable", f"Trooth's keys could not be read ({e}); {'the last ones are used' if self.trooth_keys else 'none are known yet'}.")
        return self.trooth_keys

    def _in_use(self) -> str:
        return f"version {self.file['header']['version']} stays in use" if self.file else "there is no version yet"

    def refresh(self) -> None:
        """Read the site again, adopt a new version that checks out, and read the marks. Never raises."""
        with self._lock:
            started = self.now()
            try:
                self._load()
            finally:
                self.checked_at = started

    def _load(self) -> None:
        try:
            file = self._json(f"https://{self.domain}/.well-known/trooth.semanto")
        except Exception as e:  # noqa: BLE001
            self._log("site_unreachable", f"https://{self.domain}/.well-known/trooth.semanto could not be read ({e}); {self._in_use()}.")
            return
        body = json.dumps(file, sort_keys=True, separators=(",", ":"))
        if body != self._body:
            try:
                company = self._json(f"https://{self.domain}/.well-known/trooth-keys.json")
            except Exception as e:  # noqa: BLE001
                self._log("site_unreachable", f"The company's keys could not be read ({e}); the new version is not adopted.")
                return
            trooth = self._trooth_key_set()
            res = verify_semanto(file, None, {"company": company, "trooth": trooth or {"keys": []}}, now=datetime.fromtimestamp(self.now(), timezone.utc))
            self.checks += 1
            h = file.get("header") or {}
            domains = [str(d).lower() for d in h.get("domains") or []]
            if res.get("ok") and self.domain not in domains:
                self._log("version_refused", f"Version {h.get('version')} is for {', '.join(domains)}, not {self.domain}.")
            elif not res.get("ok"):
                self._log("version_refused", f"Version {h.get('version')} did not check out ({res.get('reason')}); {self._in_use()}.")
            else:
                before = self.file["header"]["version"] if self.file else None
                self.file, self._body = file, body
                self.company = {"trooth_id": h["trooth_id"], "org": h["org"], "domain": self.domain}
                self.changed = []
                self._log("version_adopted", f"Version {h['version']} checked out and is in use." if before is None else f"Version {h['version']} checked out and replaces version {before}.")
        if self.file:
            self._recheck()
            self._read_marks()

    def _recheck(self) -> None:
        """Check the version in use again with the company's keys as served now and Trooth's revocation list: a withdrawn
        version or a key that no longer checks out closes the answer path until a version checks out."""
        tid = urllib.parse.quote(self.file["header"]["trooth_id"], safe="")
        try:
            status, _, body = self.fetch(f"{self.api_base}/public/semanto/{tid}/revocations", {"Accept": "application/json"})
            if status == 200:
                self.revocations = json.loads(body).get("list")
            elif status == 404:
                self.revocations = None
            else:
                raise RuntimeError(f"answered {status}")
        except Exception as e:  # noqa: BLE001
            self._log("trooth_api_unreachable", f"The revocation list could not be read ({e}); the last one is used.")
        try:
            company = self._json(f"https://{self.domain}/.well-known/trooth-keys.json")
        except Exception:  # noqa: BLE001 (the site is down: keep the last result)
            company = None
        at = datetime.fromtimestamp(self.now(), timezone.utc)
        closed: Optional[str]
        if state_of(self.file, at, self.revocations) == "withdrawn":
            closed = "withdrawn"
        elif company is not None:
            res = verify_semanto(self.file, None, {"company": company, "trooth": self.trooth_keys or {"keys": []}}, now=at, revocations=self.revocations)
            closed = None
            if not res.get("ok") and res.get("reason") != "witness_unverified" and self.trooth_keys:
                closed = "key_revoked" if "key" in str(res.get("reason")) else "recheck_failed"
        else:
            closed = self.closed
        if closed != self.closed:
            v = self.file["header"]["version"]
            self._log("answer_path_closed" if closed else "answer_path_open", f"Version {v}: {closed}; no value is shown until a version checks out." if closed else f"Version {v} checks out again.")
        self.closed = closed

    def _read_marks(self) -> None:
        tid = urllib.parse.quote(self.file["header"]["trooth_id"], safe="")
        try:
            m = self._json(f"{self.api_base}/public/semanto/{tid}/facts/marks")
            if int(m.get("version", -1)) == int(self.file["header"]["version"]):
                self.changed = [x["fact_id"] for x in m.get("marks") or [] if x.get("mark") == "changed_since_signing"]
        except Exception as e:  # noqa: BLE001
            self._log("trooth_api_unreachable", f"The marks could not be read ({e}); the last ones and the date marks are used.")

    def ensure_fresh(self) -> None:
        """Read the site again when the last read is older than the refresh interval."""
        if self.file is not None and self.checked_at is not None and self.now() - self.checked_at < self.refresh_seconds:
            return
        self.refresh()

    def marks(self) -> Dict[str, str]:
        """The marks in force now: the monitor's last marks for this version and the date marks."""
        return fact_marks(self.file, self.changed, datetime.fromtimestamp(self.now(), timezone.utc)) if self.file else {}

    def answer(self, fact_id: Optional[str] = None, question: Optional[str] = None) -> dict:
        """Answer a fact ID or a plain question from the last version that checked out.
        status "not_read" means no version has checked out yet; `events` says why."""
        self.ensure_fresh()
        if not self.file:
            return {"object": "semanto.answer", "status": "not_read", "matched_by": None, "company": {"trooth_id": None, "name": None, "domain": self.domain},
                    "version": None, "facts": [], "text": f"No signed record of {self.domain} could be read and checked yet."}
        return _answer(self.file, self.company, fact_id=fact_id, question=question, marks=self.marks(), check_base=f"{self.api_base}/public/semanto")

    def reply(self, fact_id: Optional[str] = None, question: Optional[str] = None, draft: Optional[str] = None, history: Optional[List[str]] = None,
              confirmed: bool = False) -> dict:
        """The reply a chatbot shows a customer for one turn, built by code from the signed record (turn.customer_reply);
        the draft is discarded. A follow-up is completed from `history` and answered alone. Fails closed: with no checked
        version, a withdrawn version or a revoked key, no value is shown and the owner is alerted once."""
        if question is not None and not fact_id:
            question = complete_question(question, history or [])
        a = self.answer(fact_id=fact_id, question=question)
        closed = self.closed if self.file else "not_read"
        r = customer_reply(a, self.file, draft=draft, closed=closed, domain=self.domain, confirmed=confirmed)
        if r["status"] == "closed":
            self._alert(r["reason"], f"customers get the fail-closed reply for {self.domain}")
        if r["status"] == "marked":
            self._alert(f"marked:{r['fact_id']}", f"fact {r['fact_id']} is {r['mark']}; customers get the contact route instead of a value")
        return {**r, "question": question}

    def answer_mode(self) -> dict:
        """The company's answer mode, read from Trooth and kept between reads. When it has never been read (Trooth's API
        unreachable from the start), Checked is used: the strictest mode, so nothing unchecked is shown."""
        self.ensure_fresh()
        if self.file and (self._mode_read_at is None or self.now() - self._mode_read_at >= self.refresh_seconds):
            tid = urllib.parse.quote(self.file["header"]["trooth_id"], safe="")
            try:
                m = self._json(f"{self.api_base}/public/semanto/{tid}/answer-mode")
                if m.get("mode") in ANSWER_MODES:
                    self._mode = {"mode": m["mode"], "generated_sentences": m.get("generated_sentences") is True, "free_form": "quoted" if m.get("free_form") == "quoted" else "not_published"}
                self._mode_fresh = True
            except Exception as e:  # noqa: BLE001
                self._mode_fresh = False
                self._log("trooth_api_unreachable", f"The answer mode could not be read ({e}); {self._mode['mode'] + ' stays in force' if self._mode else 'Checked is used until it can be read'}.")
            self._mode_read_at = self.now()
        if self._mode:
            return {**self._mode, "source": "trooth" if self._mode_fresh else "last_read"}
        return {"mode": "checked", "generated_sentences": False, "free_form": "not_published", "source": "fail_closed"}

    def respond(self, question: Optional[str] = None, draft: str = "", fact_id: Optional[str] = None, mode: Optional[str] = None,
                history: Optional[List[str]] = None) -> dict:
        """The reply a chatbot sends, in the company's answer mode (or `mode` when given). checked: built by code from the
        signed record, the draft discarded. source_only: the draft as written, nothing checked. audit: the draft as
        written, checked right after; the result is in "audit" and in an "audit" event."""
        if question is not None and not fact_id:
            question = complete_question(question, history or [])
        m = mode if mode in ANSWER_MODES else self.answer_mode()["mode"]
        if m == "checked":
            return {"mode": m, **self.reply(fact_id=fact_id, question=question, draft=draft)}
        if m == "source_only":
            return {"mode": m, "status": "unchecked", "text": draft}
        result = audit_draft(self.answer(fact_id=fact_id, question=question), draft, self.file)
        self._log("audit", f"{result['result']}: {question or fact_id or ''}".strip())
        return {"mode": m, "status": "unchecked", "text": draft, "audit": result}

    def output_step(self, text: str, question: Optional[str] = None, fact_id: Optional[str] = None, history: Optional[List[str]] = None) -> dict:
        """Run the value check on an agent's final answer before it is returned. When a value in it is not one the company
        signed, the answer is replaced by the checked reply for the question and `caught` lists the values."""
        self.ensure_fresh()
        if not self.file or self.closed:
            r = self.reply(fact_id=fact_id, question=question, history=history)
            return {"ok": False, "replaced": True, "caught": [], "reply": r, "text": r["text"]}
        check = check_final_answer(text, self.file)
        if check["ok"]:
            return {"ok": True, "replaced": False, "caught": [], "text": text}
        self._log("altered_value_caught", f"{', '.join(v['raw'] for v in check['caught']) or 'an instruction'} in an answer to {question or fact_id or 'a question'}")
        r = self.reply(fact_id=fact_id, question=question, history=history, draft=text)
        return {"ok": False, "replaced": True, "caught": check["caught"], "instructions": check["instructions"], "reply": r, "text": r["text"]}

    def pages(self, ids: Optional[List[str]] = None) -> List[dict]:
        """The signed pages of the version in use ({id, title, url, text}), each checked against its hash in the manifest."""
        import hashlib
        self.ensure_fresh()
        if not self.file:
            return []
        out = []
        tid = urllib.parse.quote(self.file["header"]["trooth_id"], safe="")
        for p in self.file["header"].get("pages_manifest") or []:
            if ids and p["id"] not in ids:
                continue
            key = f"{self.file['root_hash']}|{p['id']}"
            if key not in self._pages:
                try:
                    status, _, body = self.fetch(f"{self.api_base}/public/semanto/{tid}/pages/{p['id']}", {"Accept": "text/markdown"})
                    if status != 200:
                        raise RuntimeError(f"answered {status}")
                    b = body if isinstance(body, (bytes, bytearray)) else str(body).encode()
                    if "sha256:" + hashlib.sha256(b).hexdigest() != p["hash"]:
                        raise RuntimeError("its bytes do not match the signed hash")
                    self._pages[key] = {"id": p["id"], "title": p.get("title"), "url": p["url"], "text": bytes(b).decode()}
                except Exception as e:  # noqa: BLE001
                    self._log("page_unreadable", f"Page {p['url']} could not be used ({e}); its sentences are not quoted.")
                    continue
            out.append(self._pages[key])
        return out

    def quote(self, question: str, select: Callable[[str, List[dict]], Any], pages: Optional[List[dict]] = None) -> dict:
        """A free-form answer quoted from the company's signed pages. `select(question, sentences)` is the company's model,
        returning only {"runs": [{"from", "to"}]} under SELECTION_SCHEMA; personal details are masked before it sees the
        question, and code prints the runs unchanged, holding any sentence whose value is not the signed one."""
        self.ensure_fresh()
        if not self.file or self.closed:
            return customer_reply({"status": "not_read", "company": self.company, "facts": []}, self.file, closed=self.closed if self.file else "not_read", domain=self.domain)
        # AP75: free-form answers are quoted only while the company's gate G8 pass is on file; otherwise the
        # not-published reply, with no model call.
        if self.answer_mode().get("free_form") != "quoted":
            self._log("free_form_off", "Gate G8 has no pass on file for this company, so free-form questions get the not-published reply.")
            return {**quote_answer(self.file, [], None, org=self.company["org"], domain=self.domain), "problem": "gate_g8_not_met"}
        signed_pages = pages if pages is not None else self.pages()
        sentences = [s for p in signed_pages for s in page_sentences(p)]
        try:
            selection = select(mask_personal(question, self.file), sentences)
        except Exception as e:  # noqa: BLE001
            self._log("model_failed", f"The model gave no selection ({e}).")
            selection = None
        q = quote_answer(self.file, signed_pages, selection, org=self.company["org"], domain=self.domain)
        if q["held"]:
            self._log("sentences_held", f"{len(q['held'])} sentence(s) held: " + ", ".join(f"{h['id']} ({h['reason']})" for h in q["held"]))
        return q

    def stream(self, tokens: Iterable[str], recording: Optional[list] = None):
        """Stream an answer sentence by sentence; each sentence is released only after its check returns. With
        support_check set, the masked sentence is sent there and must come back True as well."""
        self.ensure_fresh()
        if not self.file or self.closed:
            return iter(())
        signed = signed_values(self.file)

        def check(s: str) -> bool:
            if not check_sentence(s, self.file, signed)["ok"]:
                return False
            if self.support_check:
                return self.support_check(mask_personal(s, self.file)) is True
            return True

        return release_checked(tokens, check, now=self.now, recording=recording)

    def locked(self, fact_id: str) -> bool:
        """Whether a fact is answered only by code."""
        return is_locked(next((f for f in (self.file or {}).get("facts") or [] if f.get("id") == fact_id), None))


def audit_draft(a: dict, draft: str, file: Optional[dict] = None) -> dict:
    """Audit mode's check of a sent draft against the answer for the same question: "supported" when the draft carries the
    signed sentence or its value, "differs" when a single signed fact answers and the draft carries neither (the signed
    sentence comes with it), "marked" for a fact marked changed or expired, "not_in_record" when the record holds nothing
    for it, and "not_checked" for candidates or no version."""
    if a["status"] != "answer":
        return {"result": "not_in_record" if a["status"] == "not_published" else "not_checked", "fact_id": None, "statement": None}
    f = a["facts"][0]
    if f["mark"]:
        return {"result": "marked", "fact_id": f["fact_id"], "statement": None, "words": MARK_WORDS[f["mark"]]}
    norm = lambda s: " ".join(unicodedata.normalize("NFKC", str(s).lower()).split())  # noqa: E731
    d = norm(draft)
    raw = next((x for x in (file or {}).get("facts", []) if x["id"] == f["fact_id"]), None) or {}
    typed = f.get("typed") or raw.get("typed") or {}
    value = typed.get("value") if typed.get("value") is not None else raw.get("value")
    values = [str(x) for x in (value if isinstance(value, list) else [] if value is None else [value])]
    supported = norm(f["statement"]) in d or (len(values) > 0 and all(norm(v) in d for v in values))
    return {"result": "supported" if supported else "differs", "fact_id": f["fact_id"], "statement": f["statement"]}
