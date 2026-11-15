// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Trooth, LLC
//
// The answer matcher, run in process on a company's signed copy: a fact ID or a plain question goes in, and out comes
// the signed fact word for word with its typed value, conditions, date and check link, or the candidates when more than
// one fact fits, or the not-published reply when none does. No model and no generated wording: the same question
// against the same version gives the same answer as Trooth's service. MATCHER.id names the matcher; it equals the
// `matcher` field of the service's answers, and test-vectors/answer-v1/answers.json holds the service's answers to compare.
//
// The order is fixed, and each answer names the step that matched (matched_by):
//   1. fact_id       the ID itself
//   2. question_map  the record's own question map entry for that question
//   3. key_terms     the words that name a fact type (phone, hours, price, refund, SOC 2, founded)
//   4. similarity    word overlap with the signed sentence, at or above SIMILARITY_THRESHOLD

/** The matcher's data, the same as test-vectors/answer-v1/matcher.json. */
export const MATCHER = Object.freeze({"id": "matcher-1-a75202e1", "order": ["fact_id", "question_map", "key_terms", "similarity"], "SIMILARITY_THRESHOLD": 0.34, "SIMILARITY_MARGIN": 0.05, "KEY_TERMS": [["^contact\\.phone$|\\.telephone$", ["phone", "call", "telephone", "number"]], ["^contact\\.(support_)?email$", ["email", "e-mail", "mail"]], ["^contact\\.address", ["address", "located", "location", "office", "headquarters"]], ["^hours\\.", ["open", "hours", "close", "opening", "closing"]], ["price|pricing|offer", ["price", "cost", "how much", "plan", "pricing", "fee"]], ["^identity\\.founding_date$", ["founded", "started", "established", "since"]], ["^identity\\.legal_name$", ["legal name", "legal entity", "company name", "registered"]], ["refund|return", ["refund", "return", "money back"]], ["shipping|delivery", ["shipping", "delivery", "ship"]]], "catalog": [["security.mfa", ["multi-factor", "multifactor", "two-factor", "2FA", "MFA"]], ["security.mfa_methods", ["authenticator", "TOTP", "passkey", "SMS", "security key", "WebAuthn", "FIDO"]], ["security.encryption_at_rest", ["encrypted at rest", "encryption at rest", "at rest"]], ["security.encryption_in_transit", ["in transit", "TLS"]], ["security.soc2", ["SOC 2", "SOC2", "SOC-2"]], ["security.iso27001", ["ISO 27001", "ISO/IEC 27001", "ISO27001"]], ["security.data_residency", ["data residency", "stored in", "hosted in", "data center", "region"]], ["security.page_url", ["security page", "trust center", "trust page"]], ["privacy.subprocessors", ["subprocessor", "sub-processor"]], ["privacy.data_deletion_days", ["delet", "purge", "retention"]], ["terms.uptime_commitment", ["uptime", "availability", "SLA"]], ["terms.sla_credits", ["service credit", "SLA credit", "credits"]], ["terms.minimum_term", ["minimum term", "contract term", "commitment", "annual contract", "month-to-month"]], ["terms.cancellation_notice", ["cancel", "notice"]], ["support.hours", ["support hours", "support is available", "support team", "support"]], ["support.channels", ["email", "chat", "phone", "ticket", "portal"]], ["commercial.pricing_model", ["per seat", "per user", "usage-based", "flat", "tiered", "pricing model", "priced"]], ["commercial.starting_price", ["starts at", "starting at", "from", "per month", "per user", "per seat"]], ["commercial.free_trial", ["free trial", "trial"]], ["commercial.returns_window_days", ["return", "refund"]], ["commercial.authorized_sellers", ["buy", "sold", "retailer", "available at", "stockist"]], ["commercial.shipping_free_over", ["free shipping", "shipping"]], ["commercial.ships_international", ["international", "worldwide", "outside the"]], ["products.{slug}.price", ["price", "cost", "costs", "priced", "retails"]], ["products.{slug}.sale_price", ["sale", "discount", "off", "deal"]], ["products.{slug}.availability", ["in stock", "out of stock", "available", "sold out", "backorder", "pre-order", "preorder"]], ["products.{slug}.sizes", ["size", "sizes"]], ["products.{slug}.variants", ["color", "colour", "variant", "option", "finish"]], ["products.{slug}.variant_differences", ["difference", "differs", "compared", "versus", "vs"]], ["products.{slug}.materials", ["made of", "made from", "material", "ingredient", "contains"]], ["products.{slug}.warranty", ["warranty", "guarantee"]], ["products.{slug}.safety_warnings", ["warning", "caution", "not suitable", "choking", "hazard"]], ["products.{slug}.safety_standards", ["standard", "tested to", "complies", "compliant", "EN ", "ASTM", "CPSC", "UL "]], ["products.{slug}.dimensions", ["weigh", "weight", "dimension", "measures", "cm", "inches", "kg", "lb"]], ["local.hours", ["open", "hours", "opening"]], ["local.hours_sunday", ["sunday"]], ["local.holiday_hours", ["holiday", "christmas", "thanksgiving", "closed on"]], ["local.address", ["located", "address", "find us", "at "]], ["local.phone", ["phone", "call", "telephone", "reach"]], ["local.email", ["email", "e-mail", "@"]], ["local.services", ["service", "offer", "provide"]], ["local.service_price", ["cost", "price", "charge", "fee"]], ["local.parking", ["parking", "park", "garage", "lot"]], ["local.accessibility", ["wheelchair", "accessible", "step-free", "ramp", "elevator"]], ["local.appointment_policy", ["appointment", "book", "reservation"]], ["local.walk_ins", ["walk-in", "walk in", "walk-ins", "without an appointment"]], ["local.payment_methods", ["accept", "payment", "cash", "card", "Apple Pay", "Google Pay"]], ["local.delivery", ["deliver", "delivery", "pickup", "pick-up", "curbside"]], ["local.languages", ["language", "speak", "spoken", "Spanish", "French", "Mandarin"]]]});

export const MARK_WORDS = Object.freeze({
  changed_since_signing: "Changed since signing: the page this came from no longer says it the same way. Check the page before quoting a value.",
  expired: "Expired: the company said this held only until a date that has passed.",
});

/** The one sentence a negative carries. */
export const notPublished = (org, domain) => `${org}'s signed record does not answer this. Ask ${org} at ${domain}.`;

/** The matcher's identity, worked out from its data; equals MATCHER.id. */
export function matcherId(m = MATCHER) {
  const src = JSON.stringify({ order: m.order, SIMILARITY_THRESHOLD: m.SIMILARITY_THRESHOLD, SIMILARITY_MARGIN: m.SIMILARITY_MARGIN, KEY_TERMS: m.KEY_TERMS, catalog: m.catalog });
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) h = Math.imul(h ^ src.charCodeAt(i), 0x01000193) >>> 0;
  return `matcher-1-${h.toString(16).padStart(8, "0")}`;
}

const KEY_TERMS = MATCHER.KEY_TERMS.map(([re, terms]) => [new RegExp(re), terms]);
const STOP = new Set(["the", "a", "an", "is", "are", "do", "does", "what", "whats", "how", "when", "where", "who", "which", "of", "to", "for", "in", "on", "at", "your", "you", "their", "they", "its", "it", "and", "or", "can", "i", "we", "our", "my", "me", "this", "that", "page", "lists", "gives", "says"]);
const words = (s) => new Set((s.toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 1 && !STOP.has(w)).map((w) => w.replace(/(ies)$/, "y").replace(/s$/, "")));
const norm = (s) => s.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * The marks on a version's facts: "expired" past a fact's valid_to, "changed_since_signing" when the version passed its
 * not_after or the monitor found the sentence changed (`changed`, fact IDs for this version from the service's marks).
 */
export function factMarks(file, changed = [], now = new Date()) {
  const out = new Map();
  const today = now.toISOString().slice(0, 10);
  const lapsed = file.header.not_after != null && Date.parse(file.header.not_after) < now.getTime();
  const ch = new Set(changed);
  for (const f of file.facts) {
    if (f.valid_to && f.valid_to < today) out.set(f.id, "expired");
    else if (lapsed || ch.has(f.id)) out.set(f.id, "changed_since_signing");
  }
  return out;
}

function asAnswered(f, mark) {
  return {
    fact_id: f.id, key: f.key, statement: mark ? null : f.statement, typed: mark ? null : (f.typed ?? null), conditions: mark ? [] : (f.conditions ?? []),
    location: f.location ?? null, valid_from: f.valid_from ?? null, valid_to: f.valid_to ?? null, provenance: f.provenance, source_url: f.evidence.url, mark,
  };
}

const valueKey = (f) => JSON.stringify(f.typed?.value ?? f.value ?? f.statement);
function distinct(facts) {
  const seen = new Map();
  for (const f of facts) {
    const k = `${valueKey(f)}|${f.location ?? ""}|${(f.conditions ?? []).join(";")}`;
    if (!seen.has(k)) seen.set(k, f);
  }
  return [...seen.values()];
}

function match(file, input) {
  if (input.fact_id) {
    const f = file.facts.find((x) => x.id === input.fact_id);
    return { by: f ? "fact_id" : null, facts: f ? [f] : [] };
  }
  const q = input.question ?? "";
  const nq = norm(q);
  const byId = new Map(file.facts.map((f) => [f.id, f]));
  const entry = (file.question_map ?? []).find((e) => norm(e.question) === nq && (e.fact_ids ?? []).length);
  if (entry) return { by: "question_map", facts: (entry.fact_ids ?? []).map((id) => byId.get(id)).filter(Boolean) };
  const lq = ` ${nq} `;
  for (const [re, terms] of KEY_TERMS) {
    if (!terms.some((t) => lq.includes(` ${t} `) || lq.includes(` ${t}s `))) continue;
    const hits = file.facts.filter((f) => re.test(f.key));
    if (hits.length) return { by: "key_terms", facts: hits };
  }
  for (const [key, terms] of MATCHER.catalog) {
    if (!terms.some((t) => lq.includes(` ${norm(t)} `))) continue;
    const hits = file.facts.filter((f) => f.key === key);
    if (hits.length) return { by: "key_terms", facts: hits };
  }
  const qw = words(q);
  if (!qw.size) return { by: null, facts: [] };
  const ranked = file.facts
    .map((f) => {
      const fw = words(f.statement);
      const both = [...qw].filter((w) => fw.has(w)).length;
      return { f, s: both / new Set([...qw, ...fw]).size };
    })
    .filter((x) => x.s >= MATCHER.SIMILARITY_THRESHOLD)
    .sort((a, b) => b.s - a.s);
  if (!ranked.length) return { by: null, facts: [] };
  return { by: "similarity", facts: ranked.filter((x) => ranked[0].s - x.s <= MATCHER.SIMILARITY_MARGIN).map((x) => x.f) };
}

/**
 * Answer a fact ID or a plain question from a signed copy, as Trooth's service does.
 * @param {object} file the Semanto file (already checked)
 * @param {{ trooth_id: string, org: string, domain: string }} company
 * @param {{ fact_id?: string, question?: string }} input
 * @param {Map<string, "changed_since_signing" | "expired">} marks from factMarks()
 * @param {{ checkBase?: string, signed_at?: string | null }} [ctx]
 */
export function answer(file, company, input, marks = new Map(), ctx = {}) {
  const checkBase = (ctx.checkBase ?? "https://api.trooth.co/public/semanto").replace(/\/$/, "");
  const check = `${checkBase}/${company.trooth_id}/versions/${file.header.version}`;
  const base = { object: "semanto.answer", matcher: MATCHER.id, company: { trooth_id: company.trooth_id, name: company.org, domain: company.domain }, version: file.header.version, version_hash: file.root_hash, signed_at: ctx.signed_at ?? file.witness?.at ?? null, check };
  const { by, facts } = match(file, input);
  const found = distinct(facts);
  if (!found.length) return { ...base, status: "not_published", matched_by: null, facts: [], text: notPublished(company.org, company.domain) };
  if (found.length > 1) {
    const list = found.slice(0, 10).map((f) => asAnswered(f, marks.get(f.id) ?? null));
    return { ...base, status: "candidates", matched_by: by, facts: list, text: `${found.length} signed facts of ${company.org} could answer this; none is picked. Ask about one of them by its fact ID.` };
  }
  const f = found[0];
  const mark = marks.get(f.id) ?? null;
  const lines = mark ? [MARK_WORDS[mark]] : [f.statement, ...(f.conditions?.length ? [`Conditions: ${f.conditions.join("; ")}.`] : [])];
  lines.push(`Check: ${check}`);
  return { ...base, status: "answer", matched_by: by, facts: [asAnswered(f, mark)], text: lines.slice(0, 3).join("\n") };
}

/**
 * What the customer is shown, built by code from an answer; a model's own wording is never part of it.
 *
 * For a value answer the first line is the signed sentence exactly as signed, then its conditions if any, then the day
 * it was signed and the check link. A marked fact shows its mark instead of a value. Candidates, the not-published
 * reply and not_read show the answer's own fixed line. `draft` (what a model wrote) is accepted so a caller can pass
 * it, and is discarded: `discarded` says whether one was given.
 * @param {ReturnType<typeof answer>} a
 * @param {string} [draft]
 */
export function assembleReply(a, draft) {
  const discarded = typeof draft === "string" && draft.length > 0;
  const signed_on = a.signed_at ? String(a.signed_at).slice(0, 10) : null;
  const f = a.status === "answer" ? a.facts[0] : null;
  if (!f) return { status: a.status, fact_id: null, statement: null, signed_on, check: a.check ?? null, text: a.text, discarded };
  const tail = `${signed_on ? `Signed on ${signed_on}. ` : ""}Check: ${a.check}`;
  const lines = f.mark ? [MARK_WORDS[f.mark], tail] : [f.statement, ...(f.conditions.length ? [`Conditions: ${f.conditions.join("; ")}.`] : []), tail];
  return { status: a.status, fact_id: f.fact_id, statement: f.statement, signed_on, check: a.check, text: lines.join("\n"), discarded };
}
