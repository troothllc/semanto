# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 Trooth, LLC
"""The answer matcher, run in process on a company's signed copy.

A fact ID or a plain question goes in; out comes the signed fact word for word with its typed value, conditions, date
and check link, or the candidates when more than one fact fits, or the not-published reply when none does. No model and
no generated wording: the same question against the same version gives the same answer as Trooth's service. MATCHER["id"]
names the matcher and equals the `matcher` field of the service's answers; test-vectors/answer-v1 holds the service's
answers to compare. The steps, in order: fact_id, question_map, key_terms, similarity.
"""
from __future__ import annotations

import json
import re
import unicodedata
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

MATCHER: Dict[str, Any] = json.loads('{"id":"matcher-1-a75202e1","order":["fact_id","question_map","key_terms","similarity"],"SIMILARITY_THRESHOLD":0.34,"SIMILARITY_MARGIN":0.05,"KEY_TERMS":[["^contact\\\\.phone$|\\\\.telephone$",["phone","call","telephone","number"]],["^contact\\\\.(support_)?email$",["email","e-mail","mail"]],["^contact\\\\.address",["address","located","location","office","headquarters"]],["^hours\\\\.",["open","hours","close","opening","closing"]],["price|pricing|offer",["price","cost","how much","plan","pricing","fee"]],["^identity\\\\.founding_date$",["founded","started","established","since"]],["^identity\\\\.legal_name$",["legal name","legal entity","company name","registered"]],["refund|return",["refund","return","money back"]],["shipping|delivery",["shipping","delivery","ship"]]],"catalog":[["security.mfa",["multi-factor","multifactor","two-factor","2FA","MFA"]],["security.mfa_methods",["authenticator","TOTP","passkey","SMS","security key","WebAuthn","FIDO"]],["security.encryption_at_rest",["encrypted at rest","encryption at rest","at rest"]],["security.encryption_in_transit",["in transit","TLS"]],["security.soc2",["SOC 2","SOC2","SOC-2"]],["security.iso27001",["ISO 27001","ISO/IEC 27001","ISO27001"]],["security.data_residency",["data residency","stored in","hosted in","data center","region"]],["security.page_url",["security page","trust center","trust page"]],["privacy.subprocessors",["subprocessor","sub-processor"]],["privacy.data_deletion_days",["delet","purge","retention"]],["terms.uptime_commitment",["uptime","availability","SLA"]],["terms.sla_credits",["service credit","SLA credit","credits"]],["terms.minimum_term",["minimum term","contract term","commitment","annual contract","month-to-month"]],["terms.cancellation_notice",["cancel","notice"]],["support.hours",["support hours","support is available","support team","support"]],["support.channels",["email","chat","phone","ticket","portal"]],["commercial.pricing_model",["per seat","per user","usage-based","flat","tiered","pricing model","priced"]],["commercial.starting_price",["starts at","starting at","from","per month","per user","per seat"]],["commercial.free_trial",["free trial","trial"]],["commercial.returns_window_days",["return","refund"]],["commercial.authorized_sellers",["buy","sold","retailer","available at","stockist"]],["commercial.shipping_free_over",["free shipping","shipping"]],["commercial.ships_international",["international","worldwide","outside the"]],["products.{slug}.price",["price","cost","costs","priced","retails"]],["products.{slug}.sale_price",["sale","discount","off","deal"]],["products.{slug}.availability",["in stock","out of stock","available","sold out","backorder","pre-order","preorder"]],["products.{slug}.sizes",["size","sizes"]],["products.{slug}.variants",["color","colour","variant","option","finish"]],["products.{slug}.variant_differences",["difference","differs","compared","versus","vs"]],["products.{slug}.materials",["made of","made from","material","ingredient","contains"]],["products.{slug}.warranty",["warranty","guarantee"]],["products.{slug}.safety_warnings",["warning","caution","not suitable","choking","hazard"]],["products.{slug}.safety_standards",["standard","tested to","complies","compliant","EN ","ASTM","CPSC","UL "]],["products.{slug}.dimensions",["weigh","weight","dimension","measures","cm","inches","kg","lb"]],["local.hours",["open","hours","opening"]],["local.hours_sunday",["sunday"]],["local.holiday_hours",["holiday","christmas","thanksgiving","closed on"]],["local.address",["located","address","find us","at "]],["local.phone",["phone","call","telephone","reach"]],["local.email",["email","e-mail","@"]],["local.services",["service","offer","provide"]],["local.service_price",["cost","price","charge","fee"]],["local.parking",["parking","park","garage","lot"]],["local.accessibility",["wheelchair","accessible","step-free","ramp","elevator"]],["local.appointment_policy",["appointment","book","reservation"]],["local.walk_ins",["walk-in","walk in","walk-ins","without an appointment"]],["local.payment_methods",["accept","payment","cash","card","Apple Pay","Google Pay"]],["local.delivery",["deliver","delivery","pickup","pick-up","curbside"]],["local.languages",["language","speak","spoken","Spanish","French","Mandarin"]]]}')

MARK_WORDS = {
    "changed_since_signing": "Changed since signing: the page this came from no longer says it the same way. Check the page before quoting a value.",
    "expired": "Expired: the company said this held only until a date that has passed.",
}

_STOP = {"the", "a", "an", "is", "are", "do", "does", "what", "whats", "how", "when", "where", "who", "which", "of", "to", "for", "in", "on", "at", "your", "you", "their", "they", "its", "it", "and", "or", "can", "i", "we", "our", "my", "me", "this", "that", "page", "lists", "gives", "says"}
_KEY_TERMS = [(re.compile(src), terms) for src, terms in MATCHER["KEY_TERMS"]]
_ALNUM = re.compile(r"[^\W_]+")
_NOT_ALNUM = re.compile(r"[\W_]+")


def not_published(org: str, domain: str) -> str:
    return f"{org}'s signed record does not answer this. Ask {org} at {domain}."


def _js_json(v: Any) -> str:
    return json.dumps(v, ensure_ascii=False, separators=(",", ":"))


def matcher_id(m: Optional[Dict[str, Any]] = None) -> str:
    """The matcher's identity, worked out from its data (FNV-1a over the UTF-16 code units of its JSON)."""
    m = m or MATCHER
    src = _js_json({"order": m["order"], "SIMILARITY_THRESHOLD": m["SIMILARITY_THRESHOLD"], "SIMILARITY_MARGIN": m["SIMILARITY_MARGIN"], "KEY_TERMS": m["KEY_TERMS"], "catalog": m["catalog"]})
    h = 0x811C9DC5
    units = src.encode("utf-16-le")
    for i in range(0, len(units), 2):
        h = ((h ^ (units[i] | units[i + 1] << 8)) * 0x01000193) & 0xFFFFFFFF
    return f"matcher-1-{h:08x}"


def _lower(s: str) -> str:
    return unicodedata.normalize("NFKC", s.lower())


def _words(s: str) -> set:
    out = set()
    for w in _ALNUM.findall(_lower(s)):
        if len(w) > 1 and w not in _STOP:
            out.add(re.sub(r"s$", "", re.sub(r"(ies)$", "y", w)))
    return out


def _norm(s: str) -> str:
    return _NOT_ALNUM.sub(" ", _lower(s)).strip()


def _parse_time(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def fact_marks(file: dict, changed: Iterable[str] = (), now: Optional[datetime] = None) -> Dict[str, str]:
    """The marks in force: "expired" past a fact's valid_to, "changed_since_signing" when the version passed its
    not_after or the monitor found the sentence changed (`changed`: fact IDs for this version)."""
    now = now or datetime.now(timezone.utc)
    today = now.astimezone(timezone.utc).strftime("%Y-%m-%d")
    na = file["header"].get("not_after")
    lapsed = na is not None and _parse_time(na) < now
    ch = set(changed)
    out: Dict[str, str] = {}
    for f in file["facts"]:
        if f.get("valid_to") and f["valid_to"] < today:
            out[f["id"]] = "expired"
        elif lapsed or f["id"] in ch:
            out[f["id"]] = "changed_since_signing"
    return out


def _nz(*vals: Any) -> Any:
    for v in vals:
        if v is not None:
            return v
    return None


def _as_answered(f: dict, mark: Optional[str]) -> dict:
    return {
        "fact_id": f["id"], "key": f["key"], "statement": None if mark else f["statement"], "typed": None if mark else f.get("typed"),
        "conditions": [] if mark else (f.get("conditions") or []), "location": f.get("location"), "valid_from": f.get("valid_from"),
        "valid_to": f.get("valid_to"), "provenance": f["provenance"], "source_url": f["evidence"]["url"], "mark": mark,
    }


def _distinct(facts: List[dict]) -> List[dict]:
    seen: Dict[str, dict] = {}
    for f in facts:
        typed = f.get("typed") or {}
        k = f"{_js_json(_nz(typed.get('value'), f.get('value'), f['statement']))}|{f.get('location') or ''}|{';'.join(f.get('conditions') or [])}"
        seen.setdefault(k, f)
    return list(seen.values())


def _match(file: dict, fact_id: Optional[str], question: Optional[str]):
    facts = file["facts"]
    if fact_id:
        f = next((x for x in facts if x["id"] == fact_id), None)
        return ("fact_id" if f else None), ([f] if f else [])
    q = question or ""
    nq = _norm(q)
    by_id = {f["id"]: f for f in facts}
    for e in file.get("question_map") or []:
        if _norm(e["question"]) == nq and e.get("fact_ids"):
            return "question_map", [by_id[i] for i in e["fact_ids"] if i in by_id]
    lq = f" {nq} "
    for rx, terms in _KEY_TERMS:
        if not any(f" {t} " in lq or f" {t}s " in lq for t in terms):
            continue
        hits = [f for f in facts if rx.search(f["key"])]
        if hits:
            return "key_terms", hits
    for key, terms in MATCHER["catalog"]:
        if not any(f" {_norm(t)} " in lq for t in terms):
            continue
        hits = [f for f in facts if f["key"] == key]
        if hits:
            return "key_terms", hits
    qw = _words(q)
    if not qw:
        return None, []
    ranked = []
    for f in facts:
        fw = _words(f["statement"])
        s = len(qw & fw) / len(qw | fw)
        if s >= MATCHER["SIMILARITY_THRESHOLD"]:
            ranked.append((s, f))
    if not ranked:
        return None, []
    ranked.sort(key=lambda x: -x[0])
    top = ranked[0][0]
    return "similarity", [f for s, f in ranked if top - s <= MATCHER["SIMILARITY_MARGIN"]]


def answer(file: dict, company: dict, fact_id: Optional[str] = None, question: Optional[str] = None, marks: Optional[Dict[str, str]] = None, check_base: str = "https://api.trooth.co/public/semanto", signed_at: Optional[str] = None) -> dict:
    """Answer a fact ID or a plain question from a checked signed copy, as Trooth's service does.

    company: {"trooth_id", "org", "domain"}; marks: from fact_marks()."""
    marks = marks or {}
    h = file["header"]
    check = f"{check_base.rstrip('/')}/{company['trooth_id']}/versions/{h['version']}"
    base = {"object": "semanto.answer", "matcher": MATCHER["id"], "company": {"trooth_id": company["trooth_id"], "name": company["org"], "domain": company["domain"]},
            "version": h["version"], "version_hash": file["root_hash"], "signed_at": _nz(signed_at, (file.get("witness") or {}).get("at")), "check": check}
    by, facts = _match(file, fact_id, question)
    found = _distinct(facts)
    if not found:
        return {**base, "status": "not_published", "matched_by": None, "facts": [], "text": not_published(company["org"], company["domain"])}
    if len(found) > 1:
        return {**base, "status": "candidates", "matched_by": by, "facts": [_as_answered(f, marks.get(f["id"])) for f in found[:10]],
                "text": f"{len(found)} signed facts of {company['org']} could answer this; none is picked. Ask about one of them by its fact ID."}
    f = found[0]
    mark = marks.get(f["id"])
    lines = [MARK_WORDS[mark]] if mark else [f["statement"], *([f"Conditions: {'; '.join(f['conditions'])}."] if f.get("conditions") else [])]
    lines.append(f"Check: {check}")
    return {**base, "status": "answer", "matched_by": by, "facts": [_as_answered(f, mark)], "text": "\n".join(lines[:3])}


def assemble_reply(a: dict, draft: Optional[str] = None) -> dict:
    """What the customer is shown, built by code from an answer; a model's own wording is never part of it.

    For a value answer the first line is the signed sentence exactly as signed, then its conditions if any, then the day
    it was signed and the check link. A marked fact shows its mark instead of a value. Candidates, the not-published
    reply and not_read show the answer's own fixed line. `draft` (what a model wrote) is accepted and discarded:
    `discarded` says whether one was given."""
    discarded = isinstance(draft, str) and len(draft) > 0
    signed_on = str(a["signed_at"])[:10] if a.get("signed_at") else None
    f = a["facts"][0] if a["status"] == "answer" else None
    if not f:
        return {"status": a["status"], "fact_id": None, "statement": None, "signed_on": signed_on, "check": a.get("check"), "text": a["text"], "discarded": discarded}
    tail = f"{f'Signed on {signed_on}. ' if signed_on else ''}Check: {a['check']}"
    lines = [MARK_WORDS[f["mark"]], tail] if f["mark"] else [f["statement"], *([f"Conditions: {'; '.join(f['conditions'])}."] if f["conditions"] else []), tail]
    return {"status": a["status"], "fact_id": f["fact_id"], "statement": f["statement"], "signed_on": signed_on, "check": a["check"], "text": "\n".join(lines), "discarded": discarded}
