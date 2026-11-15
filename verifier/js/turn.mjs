// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Trooth, LLC
//
// What a company's own chatbot shows a customer, built by code from the signed copy, one turn at a time.
//
//   customerReply(a, file)        a value answer, the not-published reply, a confirm step or a fail-closed reply
//   completeQuestion(q, history)  a follow-up rewritten into a complete question; earlier turns are never evidence
//   valuesIn(text), checkSentence(s, file), checkFinalAnswer(text, file)
//                                 the value check: a price, phone, email, percent or counted value in a sentence must
//                                 equal a value the company signed, or the sentence is held
//   pageSentences(page), quoteAnswer(file, pages, selection)
//                                 quote-assembled answers: the company's model picks sentence IDs, code prints them
//   releaseChecked(tokens, check) streaming that releases a sentence only after its check returns
//   maskPersonal(text, file)      emails, phone numbers and names that are not in the record, masked before any send
//
// Every line the library writes itself is in LINES below, and none of them addresses the reader (addressesReader).
// A signed sentence is shown exactly as the company signed it, whatever its wording.

import { MARK_WORDS } from "./answer.mjs";

export const DEFAULT_WHEN_UNKNOWN = "The company has not published this.";
/** The longest text part of a value answer (the structured result carries everything else). */
export const MAX_TEXT_CHARS = 600;
export const MAX_CHOICES = 3;

const FIXED = {
  signedRecord: (org, date) => `From ${org}'s signed record.${date ? ` Signed ${date}.` : ""} Check it:`,
  contact: (org, route) => `${org}'s contact: ${route}.`,
  marked: {
    changed_since_signing: (org) => `${org}'s signed record has this marked as changed since signing, so no value is shown.`,
    expired: (org, to) => `${org} said this held only until ${to ?? "a date"}, which has passed, so no value is shown.`,
  },
  choose: (org, n) => `${org}'s signed record holds ${n} answers to this, listed as choices.`,
  confirm: (org) => `Closest questions in ${org}'s signed record, listed as choices.`,
  closed: (org) => `${org}'s signed record cannot be checked right now, so no value is shown.`,
};
/** The library's own lines, for the never-words and reader lints. */
export const LINES = FIXED;

/** True when a line speaks to the reader ("you", "your", or an instruction such as "Ask", "Call", "Please"). */
export function addressesReader(line) {
  const s = String(line).trim();
  if (/\b(you|your|you're|yours|yourself)\b/i.test(s)) return true;
  return /^(ask|call|contact|please|visit|note|write|email|try|see|go|click|tap)\b/i.test(s);
}

/** A fact whose value is answered only by code: anything typed, and prices, contacts, hours, policies and privacy. */
export function isLocked(f) {
  if (!f) return false;
  if (f.typed) return true;
  const key = String(f.key ?? "");
  return /^(?:pricing|commercial|contact|hours|privacy|policy|offer|terms|local)\b/.test(key) || key.includes("price");
}

// ------------------------------------------------------------------ contact route and the not-published line

/** The company's own not-published line, made a statement (a "Say that ..." control is read as the sentence it asks for). */
export function whenUnknown(file, org) {
  let w = String(file?.controls?.when_unknown ?? DEFAULT_WHEN_UNKNOWN).trim();
  const say = /^say that\s+/i.exec(w);
  if (say) w = w.slice(say[0].length);
  w = w.replace(/^the company\b/i, org);
  w = w.charAt(0).toUpperCase() + w.slice(1);
  if (!/[.!?]$/.test(w)) w += ".";
  return w;
}

const LOCAL = /[A-Za-z0-9._%+-]/;
const HOST = /[A-Za-z0-9.-]/;

/**
 * The email addresses in a text, found in one pass (no backtracking): each "@" is widened to the characters an address
 * may hold on either side, and kept when the part after it is a host name with a dot and a top-level name of letters.
 * @returns {{ index: number, 0: string }[]}
 */
export function findEmails(text) {
  const t = String(text ?? "");
  const out = [];
  let from = 0;
  for (let at = t.indexOf("@"); at >= 0; at = t.indexOf("@", at + 1)) {
    let i = at;
    while (i > from && LOCAL.test(t[i - 1])) i--;
    let j = at + 1;
    while (j < t.length && HOST.test(t[j])) j++;
    let host = t.slice(at + 1, j);
    while (host.endsWith(".") || host.endsWith("-")) host = host.slice(0, -1);
    const dot = host.lastIndexOf(".");
    const tld = dot > 0 ? host.slice(dot + 1) : "";
    if (i === at || dot <= 0 || tld.length < 2 || !/^[A-Za-z]+$/.test(tld) || host.startsWith(".") || host.includes("..")) continue;
    const m = [t.slice(i, at + 1 + host.length)];
    m.index = i;
    out.push(m);
    from = at + 1 + host.length;
  }
  return out;
}

/** Replace each email address in a text with fn(address). */
function replaceEmails(text, fn) {
  let out = "";
  let at = 0;
  for (const m of findEmails(text)) {
    out += text.slice(at, m.index) + fn(m[0]);
    at = m.index + m[0].length;
  }
  return out + text.slice(at);
}

/** "abc?!" without its trailing "?", "." and "!" (in one pass). */
function trimMarks(s) {
  let end = s.length;
  while (end > 0 && "?.!".includes(s[end - 1])) end--;
  return s.slice(0, end);
}

/**
 * The contact route from the record: an email, then a phone number, then a contact page, then the company's site.
 * @returns {{ kind: "email" | "phone" | "url", value: string, href: string }}
 */
export function contactRoute(file, domain) {
  const facts = file?.facts ?? [];
  const valueOf = (f) => f.typed?.value ?? f.value;
  const by = (re) => facts.filter((f) => re.test(f.key) && valueOf(f) != null);
  for (const f of [...by(/^contact\.support_email$/), ...by(/^contact\.(email|sales_email)$/)]) {
    const m = findEmails(String(valueOf(f)))[0];
    if (m) return { kind: "email", value: m[0], href: `mailto:${m[0]}` };
  }
  for (const f of by(/^contact\.phone$|\.telephone$/)) {
    const digits = String(valueOf(f)).replace(/[^\d+]/g, "");
    if (digits.replace(/\D/g, "").length >= 7) return { kind: "phone", value: String(valueOf(f)), href: `tel:${digits}` };
  }
  for (const f of by(/^contact\.(page_url|url|form_url)$/)) {
    const u = String(valueOf(f));
    if (u.startsWith("https://")) return { kind: "url", value: u, href: u };
  }
  const site = `https://${domain}`;
  return { kind: "url", value: site, href: site };
}

// ------------------------------------------------------------------ the reply a customer sees

const dayOf = (a) => (a.signed_at ? String(a.signed_at).slice(0, 10) : null);

/**
 * What the customer sees for one answer, built by code; the model's draft is never part of it.
 *
 *   answer       the signed sentence, its conditions, and "From <Company>'s signed record. Signed <date>. Check it: <link>"
 *   marked       one line that states the mark, then the contact route; no value
 *   not_published the company's own not-published line and the contact route from the record
 *   choose       several signed answers; up to three choices, each answered by its fact ID
 *   confirm      a locked value reached only by word overlap: up to three questions to pick from before any value
 *   closed       the check cannot run (no version, withdrawn, key revoked): no value, the contact route
 *
 * @param {object} a an answer from answer() (or SemantoSource.answer)
 * @param {object | null} file the checked signed copy (for the contact route, the not-published line, question labels)
 * @param {{ draft?: string, closed?: string | null, domain?: string }} [opts]
 */
export function customerReply(a, file, opts = {}) {
  const org = a.company?.name ?? file?.header?.org ?? opts.domain ?? "The company";
  const domain = a.company?.domain ?? opts.domain ?? file?.header?.domains?.[0] ?? "";
  const route = contactRoute(file, domain);
  const signed_on = dayOf(a);
  const discarded = typeof opts.draft === "string" && opts.draft.length > 0;
  const base = { object: "semanto.reply", company: a.company ?? null, version: a.version ?? null, matched_by: a.matched_by ?? null, signed_on, check: a.check ?? null, contact: route, discarded, choices: [] };
  const out = (status, lines, extra = {}) => ({ ...base, status, fact_id: null, statement: null, conditions: [], value: null, ...extra, lines, text: lines.join("\n"), markdown: (extra.markdown ?? lines).join("\n") });

  if (opts.closed || a.status === "not_read") {
    return out("closed", [FIXED.closed(org), FIXED.contact(org, route.value)], { reason: opts.closed ?? "not_read" });
  }
  if (a.status === "not_published" || !a.facts?.length) {
    return out("not_published", [whenUnknown(file, org), FIXED.contact(org, route.value)]);
  }
  if (a.status === "candidates") {
    // A fact past its valid-through date is no longer an answer; when one current fact remains, it is the answer.
    const current = a.facts.filter((f) => f.mark !== "expired");
    if (current.length === 1) return customerReply({ ...a, status: "answer", facts: current }, file, opts);
  }
  if (a.status === "candidates") {
    const choices = a.facts.slice(0, MAX_CHOICES).map((f) => ({ fact_id: f.fact_id, label: labelOf(f, file), mark: f.mark }));
    return out("choose", [FIXED.choose(org, a.facts.length)], { choices });
  }
  const f = a.facts[0];
  if (a.matched_by === "similarity" && isLocked(rawFact(file, f.fact_id) ?? f) && !opts.confirmed) {
    const choices = a.facts.slice(0, MAX_CHOICES).map((x) => ({ fact_id: x.fact_id, label: labelOf(x, file), mark: x.mark }));
    return out("confirm", [FIXED.confirm(org)], { choices });
  }
  if (f.mark) {
    const raw = rawFact(file, f.fact_id);
    const line = f.mark === "expired" ? FIXED.marked.expired(org, f.valid_to ?? raw?.valid_to) : FIXED.marked.changed_since_signing(org);
    return out("marked", [line, FIXED.contact(org, route.value)], { fact_id: f.fact_id, mark: f.mark, mark_words: MARK_WORDS[f.mark] });
  }
  const conditions = f.conditions ?? [];
  const tail = FIXED.signedRecord(org, signed_on);
  const lines = [f.statement, ...(conditions.length ? [`Conditions: ${conditions.join("; ")}.`] : []), `${tail} ${a.check}`];
  const markdown = [f.statement, ...(conditions.length ? [`Conditions: ${conditions.join("; ")}.`] : []), `${tail.slice(0, -"Check it:".length)}[Check it](${a.check}).`];
  const raw = rawFact(file, f.fact_id);
  return out("answer", lines, { fact_id: f.fact_id, statement: f.statement, conditions, value: f.typed?.value ?? raw?.typed?.value ?? raw?.value ?? null, provenance: f.provenance ?? null, source_url: f.source_url ?? null, markdown });
}

function rawFact(file, id) {
  return file?.facts?.find((x) => x.id === id) ?? null;
}

/** A choice's label: the record's own question for that fact, else its signed sentence (or its key when marked). */
function labelOf(f, file) {
  const q = (file?.question_map ?? []).find((e) => (e.fact_ids ?? []).includes(f.fact_id));
  if (q) return q.question;
  if (f.statement) return f.statement;
  return String(f.key ?? f.fact_id).replace(/[._]/g, " ");
}

// ------------------------------------------------------------------ follow-ups

const REFERRING = new Set(["what", "about", "how", "and", "also", "the", "other", "one", "ones", "that", "this", "it", "its", "again", "say", "can", "could", "you", "repeat", "same", "for", "then", "too", "is", "are", "there", "so", "ok", "okay", "please", "tell", "me", "more", "a", "an", "of", "do", "does", "what's", "whats"]);
const FOLLOW = /^(what|how) about\b|^(and|also|so)\b|\b(again|that one|the other one|the same|this one)\b|^(can|could) you (say|repeat)\b|^(it|that|this)\b/i;

/** True when a turn leans on an earlier one and needs the earlier question to be complete. */
export function isFollowUp(question) {
  const q = String(question).trim();
  if (FOLLOW.test(q)) return true;
  const content = (q.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).filter((w) => !REFERRING.has(w));
  return content.length === 0;
}

/**
 * A follow-up rewritten into a complete question from the last complete question in `history` (questions only,
 * oldest first). Earlier answers, drafts and claims are never used: a turn is answered from the signed record alone.
 * A follow-up with new words keeps them ("What about Chicago?" after "What is your phone number?" asks the phone
 * number in Chicago).
 */
export function completeQuestion(question, history = []) {
  const q = String(question ?? "").trim();
  if (!isFollowUp(q)) return q;
  let prev = null;
  for (let i = history.length - 1; i >= 0 && prev === null; i--) {
    const h = String(history[i] ?? "").trim();
    if (h && !isFollowUp(h)) prev = h;
  }
  if (prev === null) return q;
  const extra = (q.match(/[\p{L}\p{N}'-]+/gu) ?? []).filter((w) => !REFERRING.has(w.toLowerCase()));
  return extra.length ? `${trimMarks(prev)} ${extra.join(" ")}?` : prev;
}

// ------------------------------------------------------------------ the value check

const CURRENCY = { $: "USD", usd: "USD", dollars: "USD", dollar: "USD", "€": "EUR", eur: "EUR", euros: "EUR", euro: "EUR", "£": "GBP", gbp: "GBP", pounds: "GBP", cad: "CAD", aud: "AUD", jpy: "JPY", "¥": "JPY", chf: "CHF", inr: "INR", "₹": "INR" };
const NUM = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;
const MONEY_A = new RegExp(String.raw`(\$|€|£|¥|₹|\b(?:USD|EUR|GBP|CAD|AUD|JPY|CHF|INR)\b)\s?(${NUM})`, "gi");
const MONEY_B = new RegExp(String.raw`(${NUM})\s?(USD|EUR|GBP|CAD|AUD|JPY|CHF|INR|dollars?|euros?|pounds)\b`, "gi");
const PERCENT = new RegExp(String.raw`(${NUM})\s?(%|percent\b)`, "gi");
const COUNTED = new RegExp(String.raw`\b(${NUM})\s?(days?|weeks?|months?|years?|hours?|minutes?|seats?|users?|GB|TB)\b`, "gi");
const PHONE = /\+?\d[\d\s().-]{6,}\d/g;

const num = (s) => String(Number(String(s).replace(/,/g, "")));
const unit = (u) => u.toLowerCase().replace(/s$/, "");

/**
 * The checkable values in a text: money (amount and currency), percent, counted values (30 days, 5 seats), phone
 * numbers (digits) and emails. Each is { kind, norm, raw }.
 */
export function valuesIn(text) {
  const t = String(text ?? "");
  const out = [];
  const taken = [];
  const free = (i, j) => !taken.some(([a, b]) => i < b && j > a);
  const add = (kind, norm, m) => {
    const i = m.index;
    const j = i + m[0].length;
    if (!free(i, j)) return;
    taken.push([i, j]);
    out.push({ kind, norm, raw: m[0] });
  };
  for (const m of findEmails(t)) add("email", m[0].toLowerCase(), m);
  for (const m of t.matchAll(MONEY_A)) add("money", `${num(m[2])} ${CURRENCY[m[1].toLowerCase()] ?? m[1].toUpperCase()}`, m);
  for (const m of t.matchAll(MONEY_B)) add("money", `${num(m[1])} ${CURRENCY[m[2].toLowerCase()] ?? m[2].toUpperCase()}`, m);
  for (const m of t.matchAll(PERCENT)) add("percent", num(m[1]), m);
  for (const m of t.matchAll(PHONE)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 7 && !/^\d{4}-\d{2}-\d{2}/.test(m[0].trim())) add("phone", digits.slice(-10), m);
  }
  for (const m of t.matchAll(COUNTED)) add("counted", `${num(m[1])} ${unit(m[2])}`, m);
  return out;
}

/** Every value the company signed, by kind: from each fact's sentence, conditions and typed value. */
export function signedValues(file) {
  const set = new Map();
  const put = (v) => {
    if (!set.has(v.kind)) set.set(v.kind, new Set());
    set.get(v.kind).add(v.norm);
  };
  for (const f of file?.facts ?? []) {
    for (const v of valuesIn([f.statement, ...(f.conditions ?? [])].join(" \n "))) put(v);
    const tv = f.typed?.value ?? f.value;
    const kind = f.typed?.kind;
    if (kind === "phone" && tv != null) put({ kind: "phone", norm: String(tv).replace(/\D/g, "").slice(-10) });
    if (typeof tv === "string") for (const m of findEmails(tv)) put({ kind: "email", norm: m[0].toLowerCase() });
  }
  return set;
}

/**
 * The rule every sentence passes before it is shown: each value in it equals a value the company signed, and it gives
 * no instruction to a model. Returns { ok, values, unsigned, reason }.
 */
export function checkSentence(sentence, file, signed = signedValues(file)) {
  const values = valuesIn(sentence);
  const unsigned = values.filter((v) => !(signed.get(v.kind)?.has(v.norm)));
  const instruction = INSTRUCTION.test(String(sentence));
  return { ok: unsigned.length === 0 && !instruction, values, unsigned, reason: instruction ? "instruction" : unsigned.length ? "unsigned_value" : null };
}

const INSTRUCTION = /\b(ignore (all |any |the )?(previous|prior|above)|disregard (the|all|any)|system prompt|you are now|as an ai|reveal (your|the) (prompt|instructions))\b/i;

/** Split text into sentences: each line, then sentence ends, with markdown markers taken off. */
export function sentencesOf(text) {
  const out = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.replace(/^\s*(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/, "").trim();
    if (!line) continue;
    for (const s of line.split(/(?<=[.!?])\s+(?=["“(]?[\p{Lu}\p{N}])/u)) if (s.trim()) out.push(s.trim());
  }
  return out;
}

/**
 * The output step on an agent's final answer: every sentence passes checkSentence. `ok` is false when any value in the
 * answer is not one the company signed (an altered price, a wrong phone number); `caught` lists them.
 */
export function checkFinalAnswer(text, file) {
  const signed = signedValues(file);
  const sentences = sentencesOf(text).map((s) => ({ text: s, ...checkSentence(s, file, signed) }));
  const caught = sentences.flatMap((s) => s.unsigned.map((v) => ({ ...v, sentence: s.text })));
  const instructions = sentences.filter((s) => s.reason === "instruction").map((s) => s.text);
  return { ok: caught.length === 0 && instructions.length === 0, caught, instructions, sentences };
}

// ------------------------------------------------------------------ quote-assembled answers

/**
 * A signed page's sentences with stable IDs "<page id>:<n>" (n from 1), in order.
 * @param {{ id: string, title?: string, url?: string, text: string }} page
 */
export function pageSentences(page) {
  return sentencesOf(page.text).map((text, i) => ({ id: `${page.id}:${i + 1}`, page_id: page.id, n: i + 1, text }));
}

/** The fixed output schema the company's model fills: one to three runs of consecutive sentences. */
export const SELECTION_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["runs"],
  properties: {
    runs: {
      type: "array", minItems: 1, maxItems: 3,
      items: { type: "object", additionalProperties: false, required: ["from", "to"], properties: { from: { type: "string", description: "First sentence ID, <page id>:<n>" }, to: { type: "string", description: "Last sentence ID on the same page" } } },
    },
  },
});

/**
 * A free-form answer made only of the company's own signed sentences, picked by ID.
 *
 * `pages` are the signed pages of the current version ({ id, title, url, text }); `selection` is what the company's
 * model returned under SELECTION_SCHEMA. Code checks the shape, prints each run unchanged under its page's title and
 * link, and holds any sentence that fails checkSentence (an old price on a page is never printed). A selection that
 * does not fit the schema, or leaves nothing to print, gives the not-published reply.
 * @returns {{ status: "quoted" | "not_published", runs: object[], held: object[], text: string, problem?: string }}
 */
export function quoteAnswer(file, pages, selection, ctx = {}) {
  const org = ctx.org ?? file?.header?.org ?? "The company";
  const domain = ctx.domain ?? file?.header?.domains?.[0] ?? "";
  const route = contactRoute(file, domain);
  const refuse = (problem) => ({ object: "semanto.quote", status: "not_published", problem, runs: [], held: [], contact: route, text: [whenUnknown(file, org), FIXED.contact(org, route.value)].join("\n") });
  const runs = selection?.runs;
  if (!Array.isArray(runs) || runs.length < 1 || runs.length > 3) return refuse("selection_shape");
  const known = new Set((file?.header?.pages_manifest ?? []).map((p) => p.id));
  const byPage = new Map(pages.filter((p) => known.size === 0 || known.has(p.id)).map((p) => [p.id, { page: p, sentences: pageSentences(p) }]));
  const signed = signedValues(file);
  const held = [];
  const printed = [];
  for (const r of runs) {
    if (!r || typeof r.from !== "string" || typeof r.to !== "string" || Object.keys(r).some((k) => k !== "from" && k !== "to")) return refuse("selection_shape");
    const [pf, nf] = splitId(r.from);
    const [pt, nt] = splitId(r.to);
    if (!pf || pf !== pt || !(nf >= 1) || !(nt >= nf)) return refuse("selection_shape");
    const pg = byPage.get(pf);
    if (!pg || nt > pg.sentences.length) return refuse("unknown_sentence");
    const keep = [];
    for (const s of pg.sentences.slice(nf - 1, nt)) {
      const c = checkSentence(s.text, file, signed);
      if (c.ok) keep.push(s);
      else held.push({ id: s.id, reason: c.reason, unsigned: c.unsigned });
    }
    if (keep.length) printed.push({ page_id: pf, title: pg.page.title ?? pg.page.url ?? pf, url: pg.page.url ?? null, sentences: keep });
  }
  if (!printed.length) return { ...refuse("all_held"), held };
  const text = printed.map((r) => `${r.title}${r.url ? ` (${r.url})` : ""}:\n${r.sentences.map((s) => s.text).join(" ")}`).join("\n\n");
  return { object: "semanto.quote", status: "quoted", runs: printed, held, contact: route, text };
}

function splitId(id) {
  const i = id.lastIndexOf(":");
  if (i <= 0) return [null, NaN];
  return [id.slice(0, i), Number(id.slice(i + 1))];
}

// ------------------------------------------------------------------ streaming

/**
 * Release a stream of text one sentence at a time, each only after `check(sentence)` resolves true. A sentence whose
 * check fails (or throws) is held, never released. Yields { sentence, checked_at, released_at } for each released one;
 * `recording` (pass an array) also gets { sentence, ok, checked_at, released_at } for every sentence, released or held.
 * @param {AsyncIterable<string> | Iterable<string>} tokens
 * @param {(s: string) => Promise<boolean> | boolean} check
 * @param {{ now?: () => number, recording?: object[] }} [opts]
 */
export async function* releaseChecked(tokens, check, opts = {}) {
  const now = opts.now ?? (() => Date.now());
  const rec = opts.recording ?? null;
  let buf = "";
  const take = async function* (final) {
    const parts = buf.split(/(?<=[.!?])\s+|\n+/);
    const done = final ? parts : parts.slice(0, -1);
    buf = final ? "" : parts[parts.length - 1];
    for (const raw of done) {
      const s = raw.trim();
      if (!s) continue;
      let ok = false;
      try { ok = (await check(s)) === true; } catch { ok = false; }
      const checked_at = now();
      const entry = { sentence: s, ok, checked_at, released_at: ok ? now() : null };
      if (rec) rec.push(entry);
      if (ok) yield { sentence: s, checked_at, released_at: entry.released_at };
    }
  };
  for await (const t of tokens) {
    buf += t;
    yield* take(false);
  }
  yield* take(true);
}

// ------------------------------------------------------------------ personal data

/**
 * Mask personal details before a sentence leaves the company's server: emails and phone numbers that are not in the
 * signed record, and names (two or three capitalized words) that appear nowhere in it. Values the company signed
 * (its own support email, its phone numbers, product and company names) stay as they are.
 */
export function maskPersonal(text, file) {
  const t = String(text ?? "");
  const signed = signedValues(file);
  const recordText = [file?.header?.org ?? "", ...(file?.facts ?? []).flatMap((f) => [f.statement, ...(f.conditions ?? []), typeof f.value === "string" ? f.value : ""]), ...(file?.header?.pages_manifest ?? []).map((p) => p.title ?? "")].join(" \n ");
  let out = replaceEmails(t, (m) => (signed.get("email")?.has(m.toLowerCase()) ? m : "[email]"));
  out = out.replace(PHONE, (m) => {
    const d = m.replace(/\D/g, "");
    if (d.length < 7) return m;
    return signed.get("phone")?.has(d.slice(-10)) ? m : "[phone]";
  });
  out = out.replace(/\b(\p{Lu}[\p{Ll}'’-]+)(\s+\p{Lu}\.?)?(\s+\p{Lu}[\p{Ll}'’-]+){1,2}\b/gu, (m, _a, _b, _c, offset) => {
    if (recordText.includes(m)) return m;
    const words = m.split(/\s+/);
    if (words.every((w) => recordText.includes(w))) return m;
    const before = out.slice(0, offset);
    if (/(^|[.!?]\s+)$/.test(before) && COMMON_START.has(words[0].toLowerCase())) return m;
    return "[name]";
  });
  return out;
}

const COMMON_START = new Set(["the", "our", "we", "this", "that", "every", "each", "all", "it", "in", "on", "at", "for", "from", "with", "customer", "customers", "starter", "pro", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);
