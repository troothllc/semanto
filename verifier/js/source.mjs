// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Trooth, LLC
//
// SemantoSource: a company's signed copy, loaded from the company's own site and answered from in process.
//
//   import { SemantoSource } from "@trooth/semanto-verify/source";
//   const acme = new SemantoSource("acme.com");
//   const a = await acme.answer({ question: "What is your phone number?" });
//   if (a.status === "answer") show(a.text);
//
// It reads https://<domain>/.well-known/trooth.semanto and the company's keys from the same site, checks the file
// (signature, witness, roots, window) once for each new body it serves, and answers value questions with the same matcher as Trooth's
// service (answer.mjs). It reads the site again at most every `refreshSeconds` (900 at most, so a new version is used
// within 15 minutes), and the marks (changed since signing, expired) with each refresh.
//
// Trooth's API is used only for Trooth's witness keys and the monitor's marks. When it cannot be reached the source
// keeps answering from the last version that checked out, keeps the last keys and marks, applies the date marks
// itself, and logs a "trooth_api_unreachable" event. A new version is adopted only when it checks out; until then the
// last good one stays in use and the failure is logged. No dependencies; runs wherever fetch and WebCrypto do.

import { sha256Hex, stateOf, trimEnd, verifySemanto } from "./verify.mjs";

/** "acme.com" from "acme.com", "https://acme.com/" or "acme.com/path"; no regex on the caller's string. */
function hostOf(domain) {
  let d = String(domain).toLowerCase();
  for (const p of ["https://", "http://"]) if (d.startsWith(p)) d = d.slice(p.length);
  const slash = d.indexOf("/");
  return slash < 0 ? d : d.slice(0, slash);
}
import { answer as answerFrom, factMarks, MARK_WORDS } from "./answer.mjs";
import { checkFinalAnswer, checkSentence, completeQuestion, customerReply, isLocked, maskPersonal, pageSentences, quoteAnswer, releaseChecked, signedValues } from "./turn.mjs";

export const TROOTH_API = "https://api.trooth.co";
export const MAX_REFRESH_SECONDS = 900;
/** The answer modes a company chooses on trooth.co. */
export const ANSWER_MODES = ["checked", "source_only", "audit"];

export class SemantoSource {
  /**
   * @param {string} domain the company's domain, for example "acme.com"
   * @param {{ fetch?: typeof fetch, apiBase?: string, refreshSeconds?: number, timeoutMs?: number, now?: () => number, onEvent?: (e: object) => void }} [opts]
   */
  constructor(domain, opts = {}) {
    this.domain = hostOf(domain);
    this.fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.apiBase = trimEnd(opts.apiBase ?? TROOTH_API, "/");
    this.refreshMs = Math.min(Math.max(opts.refreshSeconds ?? MAX_REFRESH_SECONDS, 1), MAX_REFRESH_SECONDS) * 1000;
    this.timeoutMs = opts.timeoutMs ?? 5000;
    this.now = opts.now ?? (() => Date.now());
    this.onEvent = opts.onEvent ?? null;
    /** Everything that happened, oldest first: { at, event, detail }. */
    this.events = [];
    this.file = null;
    this.body = null;
    this.company = null;
    this.troothKeys = null;
    this.changed = [];
    this.checkedAt = 0;
    this.checks = 0;
    this.inflight = null;
    this.modeSetting = null;
    this.modeReadAt = 0;
    /** Why no value may be shown (not_read, withdrawn, key_revoked, recheck_failed), or null. */
    this.closed = null;
    this.revocations = null;
    this.alerted = new Set();
    this.onAlert = opts.onAlert ?? null;
    this.supportCheck = opts.supportCheck ?? null;
    this.pageCache = new Map();
  }

  /**
   * A source over a copy the caller already checked (verifySemanto) and keeps up to date itself: no site reads, no
   * refresh. The marks are the date marks plus `changed`; the mode is `mode` (Checked when not given).
   */
  static fromChecked(file, opts = {}) {
    const s = new SemantoSource(opts.domain ?? file.header?.domains?.[0] ?? file.header?.identity?.domain ?? "localhost", { ...opts, fetch: opts.fetch ?? (async () => { throw new Error("this source does not read the network"); }) });
    s.file = file;
    s.body = JSON.stringify(file);
    s.company = { trooth_id: file.header.trooth_id, org: file.header.org, domain: s.domain };
    s.changed = opts.changed ?? [];
    s.checkedAt = Number.POSITIVE_INFINITY;
    s.modeSetting = { mode: opts.mode ?? "checked", generated_sentences: false, free_form: "not_published" };
    s.modeReadAt = Number.POSITIVE_INFINITY;
    s.modeFresh = true;
    return s;
  }

  /** Tell the owner, once per reason, that customers are getting the fail-closed or not-published reply. */
  alert(reason, detail) {
    if (this.alerted.has(reason)) return;
    this.alerted.add(reason);
    const e = { at: new Date(this.now()).toISOString(), event: "owner_alert", detail: `${reason}: ${detail}` };
    this.log("owner_alert", e.detail);
    if (this.onAlert) try { this.onAlert({ reason, detail, at: e.at }); } catch { /* the owner's hook must not stop a reply */ }
  }

  log(event, detail) {
    const e = { at: new Date(this.now()).toISOString(), event, detail };
    this.events.push(e);
    if (this.events.length > 200) this.events.shift();
    if (this.onEvent) try { this.onEvent(e); } catch { /* the caller's logger must not stop an answer */ }
  }

  async json(url) {
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), this.timeoutMs) : null;
    try {
      const r = await this.fetch(url, { headers: { Accept: "application/json" }, ...(ctl ? { signal: ctl.signal } : {}) });
      if (!r.ok) throw new Error(`answered ${r.status}`);
      return await r.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Trooth's witness keys, kept from the last read when Trooth's API cannot be reached. */
  async troothKeySet() {
    try {
      this.troothKeys = await this.json(`${this.apiBase}/public/semanto/.well-known/trooth-keys.json`);
    } catch (e) {
      this.log("trooth_api_unreachable", `Trooth's keys could not be read (${e.message}); ${this.troothKeys ? "the last ones are used" : "none are known yet"}.`);
    }
    return this.troothKeys;
  }

  /** Read the site again, adopt a new version that checks out, and read the marks. Never throws. */
  refresh() {
    if (!this.inflight) this.inflight = this.load().finally(() => (this.inflight = null));
    return this.inflight;
  }

  async load() {
    const started = this.now();
    let file;
    try {
      file = await this.json(`https://${this.domain}/.well-known/trooth.semanto`);
    } catch (e) {
      this.log("site_unreachable", `https://${this.domain}/.well-known/trooth.semanto could not be read (${e.message}); ${this.file ? `version ${this.file.header.version} stays in use` : "there is no version yet"}.`);
      this.checkedAt = started;
      return;
    }
    const body = JSON.stringify(file);
    if (body !== this.body) {
      let company;
      try {
        company = await this.json(`https://${this.domain}/.well-known/trooth-keys.json`);
      } catch (e) {
        this.log("site_unreachable", `The company's keys could not be read (${e.message}); the new version is not adopted.`);
        this.checkedAt = started;
        return;
      }
      const trooth = await this.troothKeySet();
      const res = await verifySemanto(file, {}, { company, trooth: trooth ?? { keys: [] } }, { now: new Date(this.now()) });
      this.checks += 1;
      const domains = file.header?.domains ?? [];
      if (res.ok && !domains.map((d) => String(d).toLowerCase()).includes(this.domain)) {
        this.log("version_refused", `Version ${file.header.version} is for ${domains.join(", ")}, not ${this.domain}.`);
      } else if (!res.ok) {
        this.log("version_refused", `Version ${file.header?.version} did not check out (${res.reason}); ${this.file ? `version ${this.file.header.version} stays in use` : "there is no version yet"}.`);
      } else {
        const before = this.file?.header.version;
        this.file = file;
        this.body = body;
        this.company = { trooth_id: file.header.trooth_id, org: file.header.org, domain: this.domain };
        this.changed = [];
        this.log("version_adopted", before === undefined ? `Version ${file.header.version} checked out and is in use.` : `Version ${file.header.version} checked out and replaces version ${before}.`);
      }
    }
    if (this.file) {
      await this.recheck(body);
      await this.readMarks();
    }
    this.checkedAt = started;
  }

  /**
   * Check the version in use again with the company's keys as served now and Trooth's revocation list: a withdrawn
   * version or a key that no longer checks out closes the answer path (no value is shown) until a version checks out.
   */
  async recheck(body) {
    const id = this.file.header.trooth_id;
    try {
      const r = await this.fetch(`${this.apiBase}/public/semanto/${encodeURIComponent(id)}/revocations`, { headers: { Accept: "application/json" } });
      if (r.ok) this.revocations = (await r.json()).list ?? null;
      else if (r.status === 404) this.revocations = null;
      else throw new Error(`answered ${r.status}`);
    } catch (e) {
      this.log("trooth_api_unreachable", `The revocation list could not be read (${e.message}); the last one is used.`);
    }
    let company = null;
    try {
      company = await this.json(`https://${this.domain}/.well-known/trooth-keys.json`);
    } catch {
      company = null; // the site is down: keep the last result, the version itself already checked out
    }
    let closed = null;
    if (stateOf(this.file, new Date(this.now()), this.revocations) === "withdrawn") closed = "withdrawn";
    else if (company) {
      const res = await verifySemanto(this.file, {}, { company, trooth: this.troothKeys ?? { keys: [] } }, { now: new Date(this.now()), revocations: this.revocations ?? undefined });
      if (!res.ok && res.reason !== "witness_unverified" && this.troothKeys) closed = /key/.test(String(res.reason)) ? "key_revoked" : "recheck_failed";
    } else closed = this.closed;
    if (closed !== this.closed) this.log(closed ? "answer_path_closed" : "answer_path_open", closed ? `Version ${this.file.header.version}: ${closed}; no value is shown until a version checks out.` : `Version ${this.file.header.version} checks out again.`);
    this.closed = closed;
    void body;
  }

  async readMarks() {
    const url = `${this.apiBase}/public/semanto/${encodeURIComponent(this.file.header.trooth_id)}/facts/marks`;
    try {
      const m = await this.json(url);
      if (Number(m.version) === Number(this.file.header.version)) this.changed = (m.marks ?? []).filter((x) => x.mark === "changed_since_signing").map((x) => x.fact_id);
    } catch (e) {
      this.log("trooth_api_unreachable", `The marks could not be read (${e.message}); the last ones and the date marks are used.`);
    }
  }

  /** Read the site again when the last read is older than the refresh interval. */
  async ensureFresh() {
    if (this.now() - this.checkedAt < this.refreshMs && this.file) return;
    const p = this.refresh();
    if (!this.file) await p; // with a version in hand the answer does not wait for the network
  }

  /** The marks in force now: the monitor's last marks for this version and the date marks. */
  marks() {
    return this.file ? factMarks(this.file, this.changed, new Date(this.now())) : new Map();
  }

  /**
   * Answer a fact ID or a plain question from the last version that checked out.
   * status "not_read" means no version has checked out yet; `events` says why.
   * @param {{ fact_id?: string, question?: string }} input
   */
  async answer(input) {
    await this.ensureFresh();
    if (!this.file) {
      return { object: "semanto.answer", status: "not_read", matched_by: null, company: { trooth_id: null, name: null, domain: this.domain }, version: null, facts: [], text: `No signed record of ${this.domain} could be read and checked yet.` };
    }
    return answerFrom(this.file, this.company, input, this.marks(), { checkBase: `${this.apiBase}/public/semanto` });
  }

  /**
   * The reply a chatbot shows a customer for one turn, built by code from the signed record (turn.mjs customerReply);
   * the model's draft is discarded. A follow-up is completed from `history` (earlier questions) and answered alone.
   * Fails closed: with no checked version, a withdrawn version or a revoked key, no value is shown and the owner is
   * alerted once. `confirmed: true` answers a locked value reached by word overlap (after the customer picked it).
   * @param {{ fact_id?: string, question?: string, draft?: string, history?: string[], confirmed?: boolean }} input
   */
  async reply(input) {
    const { draft, history, confirmed, ...q } = input;
    if (q.question !== undefined && !q.fact_id) q.question = completeQuestion(q.question, history ?? []);
    const a = await this.answer(q);
    const closed = this.file ? this.closed : "not_read";
    const r = customerReply(a, this.file, { draft, closed, domain: this.domain, confirmed });
    if (r.status === "closed") this.alert(r.reason, `customers get the fail-closed reply for ${this.domain}`);
    if (r.status === "marked") this.alert(`marked:${r.fact_id}`, `fact ${r.fact_id} is ${r.mark}; customers get the contact route instead of a value`);
    return { ...r, question: q.question ?? null };
  }

  /**
   * The company's answer mode, read from Trooth with the marks and kept between reads. When it has never been read
   * (Trooth's API unreachable from the start), Checked is used: the strictest mode, so nothing unchecked is shown.
   * @returns {Promise<{ mode: "checked" | "source_only" | "audit", generated_sentences: boolean, free_form: "quoted" | "not_published", source: "trooth" | "last_read" | "fail_closed" }>}
   */
  async answerMode() {
    await this.ensureFresh();
    if (this.file && this.now() - this.modeReadAt >= this.refreshMs) {
      try {
        const m = await this.json(`${this.apiBase}/public/semanto/${encodeURIComponent(this.file.header.trooth_id)}/answer-mode`);
        if (ANSWER_MODES.includes(m.mode)) this.modeSetting = { mode: m.mode, generated_sentences: m.generated_sentences === true, free_form: m.free_form === "quoted" ? "quoted" : "not_published" };
        this.modeReadAt = this.now();
        this.modeFresh = true;
      } catch (e) {
        this.modeFresh = false;
        this.modeReadAt = this.now();
        this.log("trooth_api_unreachable", `The answer mode could not be read (${e.message}); ${this.modeSetting ? `${this.modeSetting.mode} stays in force` : "Checked is used until it can be read"}.`);
      }
    }
    if (this.modeSetting) return { ...this.modeSetting, source: this.modeFresh ? "trooth" : "last_read" };
    return { mode: "checked", generated_sentences: false, free_form: "not_published", source: "fail_closed" };
  }

  /**
   * The reply a chatbot sends, in the company's answer mode (or `mode` when given):
   *   checked      built by code from the signed record (see reply); the draft is discarded.
   *   source_only  the draft as written; nothing is checked.
   *   audit        the draft as written; it is checked after it is sent, and the result arrives as an "audit" event and
   *                in `audit` (a promise).
   * @param {{ fact_id?: string, question?: string, draft?: string, mode?: "checked" | "source_only" | "audit" }} input
   */
  async respond(input) {
    const { mode: asked, draft = "", history, ...q } = input;
    if (q.question !== undefined && !q.fact_id) q.question = completeQuestion(q.question, history ?? []);
    const mode = asked && ANSWER_MODES.includes(asked) ? asked : (await this.answerMode()).mode;
    if (mode === "checked") return { mode, ...(await this.reply({ ...q, draft })) };
    if (q.confirmed !== undefined) delete q.confirmed;
    if (mode === "source_only") return { mode, status: "unchecked", text: draft };
    const audit = this.answer(q).then((a) => {
      const result = auditDraft(a, draft, this.file);
      this.log("audit", `${result.result}: ${q.question ?? q.fact_id ?? ""}`.trim());
      return result;
    });
    return { mode, status: "unchecked", text: draft, audit };
  }
  /**
   * The output step: run the value check on an agent's final answer before it is returned. When a value in it is not
   * one the company signed, the answer is replaced by the checked reply for the question and `caught` lists the values.
   * @param {{ question?: string, fact_id?: string, text: string, history?: string[] }} input
   */
  async outputStep(input) {
    await this.ensureFresh();
    if (!this.file || this.closed) return { ok: false, replaced: true, caught: [], reply: await this.reply({ question: input.question, fact_id: input.fact_id, history: input.history }), text: null };
    const check = checkFinalAnswer(input.text, this.file);
    if (check.ok) return { ok: true, replaced: false, caught: [], text: input.text };
    this.log("altered_value_caught", `${check.caught.map((v) => v.raw).join(", ") || "an instruction"} in an answer to ${input.question ?? input.fact_id ?? "a question"}`);
    const reply = await this.reply({ question: input.question, fact_id: input.fact_id, history: input.history, draft: input.text });
    return { ok: false, replaced: true, caught: check.caught, instructions: check.instructions, reply, text: reply.text };
  }

  /** The signed pages of the version in use ({ id, title, url, text }), each checked against its hash in the manifest. */
  async pages(ids = null) {
    await this.ensureFresh();
    if (!this.file) return [];
    const out = [];
    for (const p of this.file.header.pages_manifest ?? []) {
      if (ids && !ids.includes(p.id)) continue;
      const key = `${this.file.root_hash}|${p.id}`;
      if (!this.pageCache.has(key)) {
        try {
          const r = await this.fetch(`${this.apiBase}/public/semanto/${encodeURIComponent(this.file.header.trooth_id)}/pages/${p.id}`, { headers: { Accept: "text/markdown" } });
          if (!r.ok) throw new Error(`answered ${r.status}`);
          const bytes = new Uint8Array(await r.arrayBuffer());
          if (`sha256:${await sha256Hex(bytes)}` !== p.hash) throw new Error("its bytes do not match the signed hash");
          this.pageCache.set(key, { id: p.id, title: p.title ?? null, url: p.url, text: new TextDecoder().decode(bytes) });
        } catch (e) {
          this.log("page_unreadable", `Page ${p.url} could not be used (${e.message}); its sentences are not quoted.`);
          continue;
        }
      }
      out.push(this.pageCache.get(key));
    }
    return out;
  }

  /**
   * A free-form answer quoted from the company's signed pages: `select(question, sentences)` is the company's model,
   * given the question and the signed sentences ({ id, page_id, text }), returning only { runs: [{ from, to }] } under
   * SELECTION_SCHEMA. Code prints the runs unchanged and holds any sentence whose value is not the signed one.
   * Personal details in the question are masked before the model sees it.
   */
  async quote({ question, select, pages = null }) {
    await this.ensureFresh();
    if (!this.file || this.closed) return customerReply({ status: "not_read", company: this.company, facts: [] }, this.file, { closed: this.file ? this.closed : "not_read", domain: this.domain });
    // Free-form answers are quoted only while the company's gate G8 pass is on file (free_form "quoted" on the
    // answer mode); otherwise, and whenever the mode cannot be read, the not-published reply, with no model call.
    if ((await this.answerMode()).free_form !== "quoted") {
      this.log("free_form_off", "Gate G8 has no pass on file for this company, so free-form questions get the not-published reply.");
      return { ...quoteAnswer(this.file, [], null, { org: this.company.org, domain: this.domain }), problem: "gate_g8_not_met" };
    }
    const signedPages = pages ?? (await this.pages());
    const sentences = signedPages.flatMap((p) => pageSentences(p));
    let selection = null;
    try {
      selection = await select(maskPersonal(question, this.file), sentences);
    } catch (e) {
      this.log("model_failed", `The model gave no selection (${e.message}).`);
    }
    const q = quoteAnswer(this.file, signedPages, selection, { org: this.company.org, domain: this.domain });
    if (q.held.length) this.log("sentences_held", `${q.held.length} sentence(s) held: ${q.held.map((h) => `${h.id} (${h.reason})`).join(", ")}`);
    return q;
  }

  /**
   * Stream an answer sentence by sentence; each sentence is released only after its check returns. With `supportCheck`
   * set (opts), the masked sentence is sent there and must come back true as well.
   * @param {AsyncIterable<string> | Iterable<string>} tokens
   * @param {{ recording?: object[] }} [opts]
   */
  async *stream(tokens, opts = {}) {
    await this.ensureFresh();
    if (!this.file || this.closed) return;
    const signed = signedValues(this.file);
    const check = async (s) => {
      if (!checkSentence(s, this.file, signed).ok) return false;
      if (this.supportCheck) return (await this.supportCheck(maskPersonal(s, this.file))) === true;
      return true;
    };
    yield* releaseChecked(tokens, check, { now: this.now, recording: opts.recording });
  }

  /** Whether a fact is answered only by code. */
  locked(fact_id) {
    return isLocked(this.file?.facts?.find((f) => f.id === fact_id));
  }
}

/**
 * Audit mode's check of a sent draft against the answer for the same question: "supported" when the draft carries the
 * signed sentence or its value, "differs" when a single signed fact answers and the draft carries neither (the signed
 * sentence comes with it), "marked" for a fact marked changed or expired, "not_in_record" when the record holds nothing
 * for it, and "not_checked" for candidates or no version. `file` (the checked signed copy) lets an untyped fact's value count.
 */
export function auditDraft(a, draft, file = null) {
  if (a.status !== "answer") return { result: a.status === "not_published" ? "not_in_record" : "not_checked", fact_id: null, statement: null };
  const f = a.facts[0];
  if (f.mark) return { result: "marked", fact_id: f.fact_id, statement: null, words: MARK_WORDS[f.mark] };
  const norm = (s) => String(s).toLowerCase().normalize("NFKC").replace(/\s+/g, " ");
  const d = norm(draft);
  const raw = file?.facts?.find((x) => x.id === f.fact_id);
  const value = f.typed?.value ?? raw?.typed?.value ?? raw?.value;
  const values = (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]).map(String);
  const supported = d.includes(norm(f.statement)) || (values.length > 0 && values.every((v) => d.includes(norm(v))));
  return { result: supported ? "supported" : "differs", fact_id: f.fact_id, statement: f.statement };
}
