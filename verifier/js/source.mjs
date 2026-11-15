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

import { trimEnd, verifySemanto } from "./verify.mjs";

/** "acme.com" from "acme.com", "https://acme.com/" or "acme.com/path"; no regex on the caller's string. */
function hostOf(domain) {
  let d = String(domain).toLowerCase();
  for (const p of ["https://", "http://"]) if (d.startsWith(p)) d = d.slice(p.length);
  const slash = d.indexOf("/");
  return slash < 0 ? d : d.slice(0, slash);
}
import { answer as answerFrom, assembleReply, factMarks, MARK_WORDS } from "./answer.mjs";

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
    if (this.file) await this.readMarks();
    this.checkedAt = started;
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
   * The reply a chatbot shows for a question: built by code from the signed record, with the model's draft discarded.
   * @param {{ fact_id?: string, question?: string, draft?: string }} input
   */
  async reply(input) {
    const { draft, ...q } = input;
    return assembleReply(await this.answer(q), draft);
  }

  /**
   * The company's answer mode, read from Trooth with the marks and kept between reads. When it has never been read
   * (Trooth's API unreachable from the start), Checked is used: the strictest mode, so nothing unchecked is shown.
   * @returns {Promise<{ mode: "checked" | "source_only" | "audit", generated_sentences: boolean, source: "trooth" | "last_read" | "fail_closed" }>}
   */
  async answerMode() {
    await this.ensureFresh();
    if (this.file && this.now() - this.modeReadAt >= this.refreshMs) {
      try {
        const m = await this.json(`${this.apiBase}/public/semanto/${encodeURIComponent(this.file.header.trooth_id)}/answer-mode`);
        if (ANSWER_MODES.includes(m.mode)) this.modeSetting = { mode: m.mode, generated_sentences: m.generated_sentences === true };
        this.modeReadAt = this.now();
        this.modeFresh = true;
      } catch (e) {
        this.modeFresh = false;
        this.modeReadAt = this.now();
        this.log("trooth_api_unreachable", `The answer mode could not be read (${e.message}); ${this.modeSetting ? `${this.modeSetting.mode} stays in force` : "Checked is used until it can be read"}.`);
      }
    }
    if (this.modeSetting) return { ...this.modeSetting, source: this.modeFresh ? "trooth" : "last_read" };
    return { mode: "checked", generated_sentences: false, source: "fail_closed" };
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
    const { mode: asked, draft = "", ...q } = input;
    const mode = asked && ANSWER_MODES.includes(asked) ? asked : (await this.answerMode()).mode;
    if (mode === "checked") return { mode, ...(await this.reply({ ...q, draft })) };
    if (mode === "source_only") return { mode, status: "unchecked", text: draft };
    const audit = this.answer(q).then((a) => {
      const result = auditDraft(a, draft, this.file);
      this.log("audit", `${result.result}: ${q.question ?? q.fact_id ?? ""}`.trim());
      return result;
    });
    return { mode, status: "unchecked", text: draft, audit };
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
