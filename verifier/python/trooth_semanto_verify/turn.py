# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 Trooth, LLC
"""What a company's own chatbot shows a customer, built by code from the signed copy, one turn at a time.

The same functions, lines and results as the JavaScript kit's turn.mjs:

    customer_reply(a, file)          a value answer, the not-published reply, a confirm step or a fail-closed reply
    complete_question(q, history)    a follow-up rewritten into a complete question; earlier turns are never evidence
    values_in, check_sentence, check_final_answer
                                     the value check: a price, phone, email, percent or counted value in a sentence must
                                     equal a value the company signed, or the sentence is held
    page_sentences, quote_answer     quote-assembled answers: the company's model picks sentence IDs, code prints them
    release_checked(tokens, check)   streaming that releases a sentence only after its check returns
    mask_personal(text, file)        emails, phone numbers and names that are not in the record, masked before any send
"""
from __future__ import annotations

import re
from typing import Any, Callable, Dict, Iterable, Iterator, List, Optional, Set, Tuple

from .answer import MARK_WORDS

DEFAULT_WHEN_UNKNOWN = "The company has not published this."
MAX_TEXT_CHARS = 600
MAX_CHOICES = 3


def _signed_record(org: str, date: Optional[str]) -> str:
    return f"From {org}'s signed record.{' Signed ' + date + '.' if date else ''} Check it:"


LINES: Dict[str, Callable[..., str]] = {
    "signed_record": _signed_record,
    "contact": lambda org, route: f"{org}'s contact: {route}.",
    "changed_since_signing": lambda org: f"{org}'s signed record has this marked as changed since signing, so no value is shown.",
    "expired": lambda org, to=None: f"{org} said this held only until {to or 'a date'}, which has passed, so no value is shown.",
    "choose": lambda org, n: f"{org}'s signed record holds {n} answers to this, listed as choices.",
    "confirm": lambda org: f"Closest questions in {org}'s signed record, listed as choices.",
    "closed": lambda org: f"{org}'s signed record cannot be checked right now, so no value is shown.",
}

_READER = re.compile(r"\b(you|your|you're|yours|yourself)\b", re.I)
_IMPERATIVE = re.compile(r"^(ask|call|contact|please|visit|note|write|email|try|see|go|click|tap)\b", re.I)


def addresses_reader(line: str) -> bool:
    """True when a line speaks to the reader ("you", "your", or an instruction such as "Ask", "Call", "Please")."""
    s = str(line).strip()
    return bool(_READER.search(s) or _IMPERATIVE.search(s))


_LOCKED_KEY = re.compile(r"^(pricing|commercial|contact|hours|privacy|policy|offer|terms|local)\b|price")


def is_locked(f: Optional[dict]) -> bool:
    """A fact whose value is answered only by code: anything typed, and prices, contacts, hours, policies and privacy."""
    if not f:
        return False
    if f.get("typed"):
        return True
    return bool(_LOCKED_KEY.search(str(f.get("key") or "")))


# ------------------------------------------------------------------ contact route and the not-published line

def when_unknown(file: Optional[dict], org: str) -> str:
    """The company's own not-published line, made a statement (a "Say that ..." control is read as the sentence it asks for)."""
    w = str(((file or {}).get("controls") or {}).get("when_unknown") or DEFAULT_WHEN_UNKNOWN).strip()
    m = re.match(r"say that\s+", w, re.I)
    if m:
        w = w[m.end():]
    w = re.sub(r"^the company\b", org, w, flags=re.I)
    w = w[:1].upper() + w[1:]
    if not re.search(r"[.!?]$", w):
        w += "."
    return w


EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")


def _value_of(f: dict) -> Any:
    t = f.get("typed") or {}
    return t.get("value") if t.get("value") is not None else f.get("value")


def contact_route(file: Optional[dict], domain: str) -> dict:
    """The contact route from the record: an email, then a phone number, then a contact page, then the company's site."""
    facts = (file or {}).get("facts") or []
    by = lambda rx: [f for f in facts if re.search(rx, f.get("key") or "") and _value_of(f) is not None]  # noqa: E731
    for f in by(r"^contact\.support_email$") + by(r"^contact\.(email|sales_email)$"):
        m = EMAIL.search(str(_value_of(f)))
        if m:
            return {"kind": "email", "value": m.group(0), "href": f"mailto:{m.group(0)}"}
    for f in by(r"^contact\.phone$|\.telephone$"):
        v = str(_value_of(f))
        digits = re.sub(r"[^\d+]", "", v)
        if len(re.sub(r"\D", "", digits)) >= 7:
            return {"kind": "phone", "value": v, "href": f"tel:{digits}"}
    for f in by(r"^contact\.(page_url|url|form_url)$"):
        u = str(_value_of(f))
        if u.startswith("https://"):
            return {"kind": "url", "value": u, "href": u}
    site = f"https://{domain}"
    return {"kind": "url", "value": site, "href": site}


# ------------------------------------------------------------------ the reply a customer sees

def _raw_fact(file: Optional[dict], fid: Optional[str]) -> Optional[dict]:
    return next((x for x in (file or {}).get("facts") or [] if x.get("id") == fid), None)


def _label_of(f: dict, file: Optional[dict]) -> str:
    for e in (file or {}).get("question_map") or []:
        if f["fact_id"] in (e.get("fact_ids") or []):
            return e["question"]
    if f.get("statement"):
        return f["statement"]
    return re.sub(r"[._]", " ", str(f.get("key") or f["fact_id"]))


def customer_reply(a: dict, file: Optional[dict], draft: Optional[str] = None, closed: Optional[str] = None, domain: Optional[str] = None, confirmed: bool = False) -> dict:
    """What the customer sees for one answer, built by code; the model's draft is never part of it. Statuses: answer,
    marked, not_published, choose, confirm, closed (see turn.mjs)."""
    company = a.get("company") or {}
    header = (file or {}).get("header") or {}
    org = company.get("name") or header.get("org") or domain or "The company"
    dom = company.get("domain") or domain or ((header.get("domains") or [""])[0])
    route = contact_route(file, dom)
    signed_on = str(a["signed_at"])[:10] if a.get("signed_at") else None
    discarded = isinstance(draft, str) and len(draft) > 0
    base = {"object": "semanto.reply", "company": a.get("company"), "version": a.get("version"), "matched_by": a.get("matched_by"), "signed_on": signed_on,
            "check": a.get("check"), "contact": route, "discarded": discarded, "choices": []}

    def out(status: str, lines: List[str], **extra: Any) -> dict:
        md = extra.pop("markdown", lines)
        r = {**base, "status": status, "fact_id": None, "statement": None, "conditions": [], "value": None, **extra}
        r.update({"lines": lines, "text": "\n".join(lines), "markdown": "\n".join(md)})
        return r

    if closed or a.get("status") == "not_read":
        return out("closed", [LINES["closed"](org), LINES["contact"](org, route["value"])], reason=closed or "not_read")
    facts = a.get("facts") or []
    if a.get("status") == "not_published" or not facts:
        return out("not_published", [when_unknown(file, org), LINES["contact"](org, route["value"])])
    if a.get("status") == "candidates":
        current = [f for f in facts if f.get("mark") != "expired"]
        if len(current) == 1:
            return customer_reply({**a, "status": "answer", "facts": current}, file, draft=draft, closed=closed, domain=domain, confirmed=confirmed)
        choices = [{"fact_id": f["fact_id"], "label": _label_of(f, file), "mark": f.get("mark")} for f in facts[:MAX_CHOICES]]
        return out("choose", [LINES["choose"](org, len(facts))], choices=choices)
    f = facts[0]
    if a.get("matched_by") == "similarity" and is_locked(_raw_fact(file, f["fact_id"]) or f) and not confirmed:
        choices = [{"fact_id": x["fact_id"], "label": _label_of(x, file), "mark": x.get("mark")} for x in facts[:MAX_CHOICES]]
        return out("confirm", [LINES["confirm"](org)], choices=choices)
    raw = _raw_fact(file, f["fact_id"]) or {}
    if f.get("mark"):
        line = LINES["expired"](org, f.get("valid_to") or raw.get("valid_to")) if f["mark"] == "expired" else LINES["changed_since_signing"](org)
        return out("marked", [line, LINES["contact"](org, route["value"])], fact_id=f["fact_id"], mark=f["mark"], mark_words=MARK_WORDS[f["mark"]])
    conditions = f.get("conditions") or []
    tail = _signed_record(org, signed_on)
    cond = [f"Conditions: {'; '.join(conditions)}."] if conditions else []
    lines = [f["statement"], *cond, f"{tail} {a['check']}"]
    md = [f["statement"], *cond, f"{tail[:-len('Check it:')]}[Check it]({a['check']})."]
    typed = f.get("typed") or {}
    value = typed.get("value") if typed.get("value") is not None else _value_of(raw) if raw else None
    return out("answer", lines, fact_id=f["fact_id"], statement=f["statement"], conditions=conditions, value=value,
               provenance=f.get("provenance"), source_url=f.get("source_url"), markdown=md)


# ------------------------------------------------------------------ follow-ups

_REFERRING = {"what", "about", "how", "and", "also", "the", "other", "one", "ones", "that", "this", "it", "its", "again", "say", "can", "could", "you", "repeat", "same", "for", "then", "too", "is", "are", "there", "so", "ok", "okay", "please", "tell", "me", "more", "a", "an", "of", "do", "does", "what's", "whats"}
_FOLLOW = re.compile(r"^(what|how) about\b|^(and|also|so)\b|\b(again|that one|the other one|the same|this one)\b|^(can|could) you (say|repeat)\b|^(it|that|this)\b", re.I)
_WORD = re.compile(r"[^\W_]+(?:'[^\W_]+)*")
_WORD_DASH = re.compile(r"[^\W_]+(?:['-][^\W_]+)*")


def is_follow_up(question: str) -> bool:
    """True when a turn leans on an earlier one and needs the earlier question to be complete."""
    q = str(question).strip()
    if _FOLLOW.search(q):
        return True
    return not [w for w in _WORD.findall(q.lower()) if w not in _REFERRING]


def complete_question(question: Optional[str], history: Iterable[str] = ()) -> str:
    """A follow-up rewritten into a complete question from the last complete question in `history` (questions only,
    oldest first). Earlier answers, drafts and claims are never used."""
    q = str(question or "").strip()
    if not is_follow_up(q):
        return q
    prev = None
    for h in reversed(list(history)):
        h = str(h or "").strip()
        if h and not is_follow_up(h):
            prev = h
            break
    if prev is None:
        return q
    extra = [w for w in _WORD_DASH.findall(q) if w.lower() not in _REFERRING]
    return f"{re.sub(r'[?.!]+$', '', prev)} {' '.join(extra)}?" if extra else prev


# ------------------------------------------------------------------ the value check

_CURRENCY = {"$": "USD", "usd": "USD", "dollars": "USD", "dollar": "USD", "€": "EUR", "eur": "EUR", "euros": "EUR", "euro": "EUR", "£": "GBP", "gbp": "GBP", "pounds": "GBP",
             "cad": "CAD", "aud": "AUD", "jpy": "JPY", "¥": "JPY", "chf": "CHF", "inr": "INR", "₹": "INR"}
_NUM = r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?"
_MONEY_A = re.compile(r"(\$|€|£|¥|₹|\b(?:USD|EUR|GBP|CAD|AUD|JPY|CHF|INR)\b)\s?(" + _NUM + ")", re.I)
_MONEY_B = re.compile(r"(" + _NUM + r")\s?(USD|EUR|GBP|CAD|AUD|JPY|CHF|INR|dollars?|euros?|pounds)\b", re.I)
_PERCENT = re.compile(r"(" + _NUM + r")\s?(%|percent\b)", re.I)
_COUNTED = re.compile(r"\b(" + _NUM + r")\s?(days?|weeks?|months?|years?|hours?|minutes?|seats?|users?|GB|TB)\b", re.I)
_PHONE = re.compile(r"\+?\d[\d\s().-]{6,}\d")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}")


def _num(s: str) -> str:
    v = float(s.replace(",", ""))
    return str(int(v)) if v == int(v) else repr(v)


def values_in(text: Optional[str]) -> List[dict]:
    """The checkable values in a text: money, percent, counted values, phone numbers (digits) and emails."""
    t = str(text or "")
    out: List[dict] = []
    taken: List[Tuple[int, int]] = []

    def add(kind: str, norm: str, m: "re.Match[str]") -> None:
        i, j = m.start(), m.end()
        if any(i < b and j > a for a, b in taken):
            return
        taken.append((i, j))
        out.append({"kind": kind, "norm": norm, "raw": m.group(0)})

    for m in EMAIL.finditer(t):
        add("email", m.group(0).lower(), m)
    for m in _MONEY_A.finditer(t):
        add("money", f"{_num(m.group(2))} {_CURRENCY.get(m.group(1).lower(), m.group(1).upper())}", m)
    for m in _MONEY_B.finditer(t):
        add("money", f"{_num(m.group(1))} {_CURRENCY.get(m.group(2).lower(), m.group(2).upper())}", m)
    for m in _PERCENT.finditer(t):
        add("percent", _num(m.group(1)), m)
    for m in _PHONE.finditer(t):
        digits = re.sub(r"\D", "", m.group(0))
        if len(digits) >= 7 and not _DATE.match(m.group(0).strip()):
            add("phone", digits[-10:], m)
    for m in _COUNTED.finditer(t):
        add("counted", f"{_num(m.group(1))} {re.sub(r's$', '', m.group(2).lower())}", m)
    return out


def signed_values(file: Optional[dict]) -> Dict[str, Set[str]]:
    """Every value the company signed, by kind: from each fact's sentence, conditions and typed value."""
    out: Dict[str, Set[str]] = {}
    for f in (file or {}).get("facts") or []:
        for v in values_in(" \n ".join([f.get("statement") or "", *(f.get("conditions") or [])])):
            out.setdefault(v["kind"], set()).add(v["norm"])
        tv = _value_of(f)
        if (f.get("typed") or {}).get("kind") == "phone" and tv is not None:
            out.setdefault("phone", set()).add(re.sub(r"\D", "", str(tv))[-10:])
        if isinstance(tv, str):
            for m in EMAIL.finditer(tv):
                out.setdefault("email", set()).add(m.group(0).lower())
    return out


_INSTRUCTION = re.compile(r"\b(ignore (all |any |the )?(previous|prior|above)|disregard (the|all|any)|system prompt|you are now|as an ai|reveal (your|the) (prompt|instructions))\b", re.I)


def check_sentence(sentence: str, file: Optional[dict], signed: Optional[Dict[str, Set[str]]] = None) -> dict:
    """The rule every sentence passes before it is shown: each value in it equals a value the company signed, and it gives
    no instruction to a model."""
    signed = signed if signed is not None else signed_values(file)
    values = values_in(sentence)
    unsigned = [v for v in values if v["norm"] not in signed.get(v["kind"], set())]
    instruction = bool(_INSTRUCTION.search(str(sentence)))
    return {"ok": not unsigned and not instruction, "values": values, "unsigned": unsigned, "reason": "instruction" if instruction else "unsigned_value" if unsigned else None}


_MARKER = re.compile(r"^\s*(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)")
_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[\"“(]?[A-Z0-9À-ÖØ-Þ])")


def sentences_of(text: Optional[str]) -> List[str]:
    """Split text into sentences: each line, then sentence ends, with markdown markers taken off."""
    out: List[str] = []
    for raw in re.split(r"\r?\n", str(text or "")):
        line = _MARKER.sub("", raw, count=1).strip()
        if not line:
            continue
        out.extend(s.strip() for s in _SPLIT.split(line) if s.strip())
    return out


def check_final_answer(text: str, file: Optional[dict]) -> dict:
    """The output step on an agent's final answer: `ok` is false when any value in it is not one the company signed."""
    signed = signed_values(file)
    sentences = [{"text": s, **check_sentence(s, file, signed)} for s in sentences_of(text)]
    caught = [{**v, "sentence": s["text"]} for s in sentences for v in s["unsigned"]]
    instructions = [s["text"] for s in sentences if s["reason"] == "instruction"]
    return {"ok": not caught and not instructions, "caught": caught, "instructions": instructions, "sentences": sentences}


# ------------------------------------------------------------------ quote-assembled answers

def page_sentences(page: dict) -> List[dict]:
    """A signed page's sentences with stable IDs "<page id>:<n>" (n from 1), in order."""
    return [{"id": f"{page['id']}:{i + 1}", "page_id": page["id"], "n": i + 1, "text": t} for i, t in enumerate(sentences_of(page.get("text")))]


SELECTION_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["runs"],
    "properties": {"runs": {"type": "array", "minItems": 1, "maxItems": 3, "items": {
        "type": "object", "additionalProperties": False, "required": ["from", "to"],
        "properties": {"from": {"type": "string", "description": "First sentence ID, <page id>:<n>"}, "to": {"type": "string", "description": "Last sentence ID on the same page"}}}}},
}


def _split_id(i: str) -> Tuple[Optional[str], float]:
    k = i.rfind(":")
    if k <= 0:
        return None, float("nan")
    try:
        return i[:k], float(i[k + 1:])
    except ValueError:
        return i[:k], float("nan")


def quote_answer(file: Optional[dict], pages: List[dict], selection: Any, org: Optional[str] = None, domain: Optional[str] = None) -> dict:
    """A free-form answer made only of the company's own signed sentences, picked by ID (see turn.mjs quoteAnswer)."""
    header = (file or {}).get("header") or {}
    org = org or header.get("org") or "The company"
    domain = domain or ((header.get("domains") or [""])[0])
    route = contact_route(file, domain)

    def refuse(problem: str, held: Optional[list] = None) -> dict:
        return {"object": "semanto.quote", "status": "not_published", "problem": problem, "runs": [], "held": held or [], "contact": route,
                "text": "\n".join([when_unknown(file, org), LINES["contact"](org, route["value"])])}

    runs = selection.get("runs") if isinstance(selection, dict) else None
    if not isinstance(runs, list) or not 1 <= len(runs) <= 3:
        return refuse("selection_shape")
    known = {p["id"] for p in header.get("pages_manifest") or []}
    by_page = {p["id"]: (p, page_sentences(p)) for p in pages if not known or p["id"] in known}
    signed = signed_values(file)
    held: List[dict] = []
    printed: List[dict] = []
    for r in runs:
        if not isinstance(r, dict) or not isinstance(r.get("from"), str) or not isinstance(r.get("to"), str) or set(r) - {"from", "to"}:
            return refuse("selection_shape")
        pf, nf = _split_id(r["from"])
        pt, nt = _split_id(r["to"])
        if not pf or pf != pt or not nf >= 1 or not nt >= nf or nf != int(nf) or nt != int(nt):
            return refuse("selection_shape")
        if pf not in by_page or nt > len(by_page[pf][1]):
            return refuse("unknown_sentence")
        page, sentences = by_page[pf]
        keep = []
        for s in sentences[int(nf) - 1:int(nt)]:
            c = check_sentence(s["text"], file, signed)
            if c["ok"]:
                keep.append(s)
            else:
                held.append({"id": s["id"], "reason": c["reason"], "unsigned": c["unsigned"]})
        if keep:
            printed.append({"page_id": pf, "title": page.get("title") or page.get("url") or pf, "url": page.get("url"), "sentences": keep})
    if not printed:
        return refuse("all_held", held)
    text = "\n\n".join(f"{r['title']}{' (' + r['url'] + ')' if r['url'] else ''}:\n{' '.join(s['text'] for s in r['sentences'])}" for r in printed)
    return {"object": "semanto.quote", "status": "quoted", "runs": printed, "held": held, "contact": route, "text": text}


# ------------------------------------------------------------------ streaming

_STREAM_SPLIT = re.compile(r"(?<=[.!?])\s+|\n+")


def release_checked(tokens: Iterable[str], check: Callable[[str], bool], now: Optional[Callable[[], float]] = None, recording: Optional[list] = None) -> Iterator[dict]:
    """Release a stream of text one sentence at a time, each only after `check(sentence)` returns True. A sentence whose
    check fails (or raises) is held, never released."""
    import time
    clock = now or time.monotonic
    buf = ""

    def take(final: bool) -> Iterator[dict]:
        nonlocal buf
        parts = _STREAM_SPLIT.split(buf)
        done = parts if final else parts[:-1]
        buf = "" if final else parts[-1]
        for raw in done:
            s = raw.strip()
            if not s:
                continue
            try:
                ok = check(s) is True
            except Exception:  # noqa: BLE001 (a failed check holds the sentence)
                ok = False
            checked_at = clock()
            entry = {"sentence": s, "ok": ok, "checked_at": checked_at, "released_at": clock() if ok else None}
            if recording is not None:
                recording.append(entry)
            if ok:
                yield {"sentence": s, "checked_at": checked_at, "released_at": entry["released_at"]}

    for t in tokens:
        buf += t
        yield from take(False)
    yield from take(True)


# ------------------------------------------------------------------ personal data

_NAME = re.compile(r"\b([A-ZÀ-ÖØ-Þ][a-zß-öø-ÿ'’-]+)(\s+[A-ZÀ-ÖØ-Þ]\.?)?((?:\s+[A-ZÀ-ÖØ-Þ][a-zß-öø-ÿ'’-]+){1,2})\b")
_COMMON_START = {"the", "our", "we", "this", "that", "every", "each", "all", "it", "in", "on", "at", "for", "from", "with", "customer", "customers", "starter", "pro",
                 "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"}


def mask_personal(text: Optional[str], file: Optional[dict]) -> str:
    """Mask personal details before a sentence leaves the company's server: emails and phone numbers not in the signed
    record, and names (two or three capitalized words) that appear nowhere in it."""
    t = str(text or "")
    signed = signed_values(file)
    header = (file or {}).get("header") or {}
    parts = [header.get("org") or ""]
    for f in (file or {}).get("facts") or []:
        parts += [f.get("statement") or "", *(f.get("conditions") or []), f["value"] if isinstance(f.get("value"), str) else ""]
    parts += [p.get("title") or "" for p in header.get("pages_manifest") or []]
    record = " \n ".join(parts)
    out = EMAIL.sub(lambda m: m.group(0) if m.group(0).lower() in signed.get("email", set()) else "[email]", t)

    def phone(m: "re.Match[str]") -> str:
        d = re.sub(r"\D", "", m.group(0))
        if len(d) < 7:
            return m.group(0)
        return m.group(0) if d[-10:] in signed.get("phone", set()) else "[phone]"

    out = _PHONE.sub(phone, out)
    src = out

    def name(m: "re.Match[str]") -> str:
        s = m.group(0)
        if s in record:
            return s
        words = s.split()
        if all(w in record for w in words):
            return s
        before = src[:m.start()]
        if re.search(r"(^|[.!?]\s+)$", before) and words[0].lower() in _COMMON_START:
            return s
        return "[name]"

    return _NAME.sub(name, out)
