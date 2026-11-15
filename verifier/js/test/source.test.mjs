// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Trooth, LLC
//
// The in-process answer path: the matcher gives the service's answers (test-vectors/v1/answers.json), and
// SemantoSource reads the company's site, checks each version once, refreshes within 15 minutes, and keeps answering
// from the last good version when Trooth's API cannot be reached.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { answer, assembleReply, factMarks, MATCHER, matcherId } from "../answer.mjs";
import { SemantoSource, MAX_REFRESH_SECONDS } from "../source.mjs";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test-vectors");
const readJson = (n) => JSON.parse(readFileSync(join(dir, n), "utf8"));

test("the matcher data is the shared one and its id is worked out from it", () => {
  const shared = readJson("answer-v1/matcher.json");
  assert.deepEqual(JSON.parse(JSON.stringify(MATCHER)), shared);
  assert.equal(matcherId(), shared.id);
});

test("every answer equals the service's answer for the same file, marks and time", () => {
  const v = readJson("answer-v1/answers.json");
  const marks = factMarks(v.file, v.stored_marks.changed, new Date(v.now));
  for (const c of v.cases) {
    const got = answer(v.file, v.company, c.input, marks, { checkBase: v.check_base, signed_at: v.file.witness.at });
    assert.deepEqual(got, c.expect, JSON.stringify(c.input));
  }
});

const vec = readJson("v1/semanto.json");
const keys = readJson("v1/keys.json");
const NOW = Date.parse(vec.now);

function site({ file = vec.file, apiDown = false, siteDown = false } = {}) {
  const calls = [];
  const state = { file, apiDown, siteDown };
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  const fetch = async (url) => {
    calls.push(url);
    if (url.startsWith("https://api.trooth.co/")) {
      if (state.apiDown) throw new TypeError("fetch failed");
      if (url.endsWith("/trooth-keys.json")) return json(keys.trooth);
      if (url.endsWith("/facts/marks")) return json({ object: "semanto.fact_marks", version: state.file.header.version, marks: state.marks ?? [] });
    }
    if (url.startsWith("https://acme.com/")) {
      if (state.siteDown) throw new TypeError("fetch failed");
      if (url.endsWith("/.well-known/trooth.semanto")) return json(state.file);
      if (url.endsWith("/.well-known/trooth-keys.json")) return json(keys.company);
    }
    return new Response("not found", { status: 404 });
  };
  return { fetch, calls, state };
}

const settle = (s) => s.inflight;

test("loads the company's own signed copy, checks it once, and answers in process", async () => {
  const net = site();
  let t = NOW;
  const s = new SemantoSource("acme.com", { fetch: net.fetch, now: () => t });
  const a = await s.answer({ question: "What does the Starter plan cost?" });
  assert.equal(a.status, "answer");
  assert.equal(a.facts[0].statement, "The Starter plan costs 49 USD a month for up to 5 seats.");
  assert.equal(s.checks, 1);
  const before = net.calls.length;
  t += 60_000;
  await s.answer({ question: "What is your legal name?" });
  assert.equal(net.calls.length, before, "no network inside the refresh interval");
  t += MAX_REFRESH_SECONDS * 1000;
  await s.answer({ question: "What is your legal name?" });
  await settle(s);
  assert.ok(net.calls.length > before, "reads the site again after 15 minutes");
  assert.equal(s.checks, 1, "the same version is not checked again");
});

test("the refresh interval is never longer than 15 minutes", () => {
  const s = new SemantoSource("acme.com", { fetch: async () => null, refreshSeconds: 86400 });
  assert.equal(s.refreshMs, MAX_REFRESH_SECONDS * 1000);
});

test("with Trooth's API blocked, answers come from the last signed version and the block is logged", async () => {
  const net = site();
  let t = NOW;
  const s = new SemantoSource("acme.com", { fetch: net.fetch, now: () => t });
  await s.answer({ question: "What is your legal name?" });
  net.state.apiDown = true;
  t += MAX_REFRESH_SECONDS * 1000;
  await s.answer({ question: "What is your legal name?" });
  await settle(s);
  const a = await s.answer({ question: "What does the Starter plan cost?" });
  assert.equal(a.status, "answer");
  assert.equal(a.version, vec.file.header.version);
  assert.ok(s.events.some((e) => e.event === "trooth_api_unreachable"), JSON.stringify(s.events));
});

test("with the site down too, the last version stays in use and that is logged", async () => {
  const net = site();
  let t = NOW;
  const s = new SemantoSource("acme.com", { fetch: net.fetch, now: () => t });
  await s.answer({ question: "What is your legal name?" });
  net.state.siteDown = true;
  net.state.apiDown = true;
  t += MAX_REFRESH_SECONDS * 1000;
  await s.answer({ question: "x" });
  await settle(s);
  const a = await s.answer({ question: "What is your legal name?" });
  assert.equal(a.status, "answer");
  assert.ok(s.events.some((e) => e.event === "site_unreachable"));
});

test("a new version that does not check out is refused and the good one stays", async () => {
  const net = site();
  let t = NOW;
  const s = new SemantoSource("acme.com", { fetch: net.fetch, now: () => t });
  await s.answer({ question: "What is your legal name?" });
  const forged = structuredClone(vec.file);
  forged.facts[2].statement = "The Starter plan costs 1 USD a month for up to 5 seats.";
  net.state.file = forged;
  t += MAX_REFRESH_SECONDS * 1000;
  await s.answer({ question: "x" });
  await settle(s);
  const a = await s.answer({ question: "What does the Starter plan cost?" });
  assert.equal(a.facts[0].statement, "The Starter plan costs 49 USD a month for up to 5 seats.");
  assert.ok(s.events.some((e) => e.event === "version_refused"));
});

test("no version that checks out means not_read, never a value", async () => {
  const forged = structuredClone(vec.file);
  forged.facts[0].statement = "The company's legal name is Evil Inc.";
  const net = site({ file: forged });
  const s = new SemantoSource("acme.com", { fetch: net.fetch, now: () => NOW });
  const a = await s.answer({ question: "What is your legal name?" });
  assert.equal(a.status, "not_read");
  assert.equal(a.facts.length, 0);
});

test("a copy signed for another domain is refused", async () => {
  const net = site();
  const s = new SemantoSource("evil.example", { fetch: async (u) => net.fetch(u.replace("https://evil.example/", "https://acme.com/")), now: () => NOW });
  const a = await s.answer({ question: "What is your legal name?" });
  assert.equal(a.status, "not_read");
  assert.ok(s.events.some((e) => e.event === "version_refused" && /not evil\.example/.test(e.detail)));
});

test("a fact the monitor marked changed returns its mark and no value", async () => {
  const net = site();
  net.state.marks = [{ fact_id: vec.file.facts[2].id, mark: "changed_since_signing" }];
  const s = new SemantoSource("acme.com", { fetch: net.fetch, now: () => NOW });
  const a = await s.answer({ fact_id: vec.file.facts[2].id });
  assert.equal(a.facts[0].mark, "changed_since_signing");
  assert.equal(a.facts[0].statement, null);
  assert.doesNotMatch(a.text, /49/);
});

test("1,000 replayed value questions show the signed sentence byte for byte and never the model's draft", () => {
  const v = readJson("answer-v1/answers.json");
  const marks = factMarks(v.file, v.stored_marks.changed, new Date(v.now));
  const byId = new Map(v.file.facts.map((f) => [f.id, f]));
  const pre = ["", "Tell me: ", "Quick question, ", "Is it true that ", "Can you confirm ", "I read that ", "Please check: ", "Hi! ", "So ", "Remind me, "];
  const post = ["", "?", ".", " right?", " please", "!!"];
  const cases = [(s) => s, (s) => s.toLowerCase(), (s) => s.toUpperCase()];
  const enc = new TextEncoder();
  let shown = 0;
  let marked = 0;
  for (const f of v.file.facts) for (const p of pre) for (const q of post) for (const c of cases) {
    const draft = `Sure! ${f.statement.replace(/[0-9]+/g, "99")} (the model's own wording)`;
    const r = assembleReply(answer(v.file, v.company, { question: c(p + f.statement + q) }, marks, { checkBase: v.check_base }), draft);
    assert.ok(r.discarded);
    assert.ok(!r.text.includes("model's own wording"));
    if (r.status !== "answer") continue;
    const fact = byId.get(r.fact_id);
    if (marks.has(fact.id)) {
      marked += 1;
      assert.equal(r.statement, null);
      assert.ok(!r.text.includes(fact.statement));
      continue;
    }
    const first = r.text.split("\n")[0];
    assert.deepEqual(enc.encode(first), enc.encode(fact.statement), `byte for byte: ${fact.id}`);
    assert.equal(r.statement, fact.statement);
    assert.match(r.text, /\nSigned on \d{4}-\d{2}-\d{2}\. Check: https:\/\/api\.trooth\.co\/public\/semanto\/acme\/versions\/7$/);
    shown += 1;
  }
  assert.ok(shown >= 1000, `${shown} value answers replayed`);
  assert.ok(marked > 0, "marked facts were replayed too");
});

test("reply() builds the shown text from the signed copy and discards the draft", async () => {
  const net = site();
  const s = new SemantoSource("acme.com", { fetch: net.fetch, now: () => NOW });
  const r = await s.reply({ question: "What does the Starter plan cost?", draft: "It is 19 USD a month." });
  assert.equal(r.text.split("\n")[0], "The Starter plan costs 49 USD a month for up to 5 seats.");
  assert.ok(r.discarded && !r.text.includes("19 USD"));
  const none = await s.reply({ question: "What is the weather?", draft: "Sunny." });
  assert.equal(none.status, "not_published");
  assert.ok(!none.text.includes("Sunny"));
});
