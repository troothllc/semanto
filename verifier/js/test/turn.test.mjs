// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Trooth, LLC
//
// What a company's own chatbot shows a customer, turn by turn: the reply lines, the not-published reply with a contact
// route, follow-ups, the confirm step, failing closed, streaming, quote-assembled answers, masking, and the framework
// adapters with the output step.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { answer, factMarks } from "../answer.mjs";
import { SemantoSource } from "../source.mjs";
import { addressesReader, checkFinalAnswer, completeQuestion, contactRoute, customerReply, isLocked, LINES, maskPersonal, MAX_TEXT_CHARS, pageSentences, quoteAnswer, releaseChecked, valuesIn, whenUnknown } from "../turn.mjs";
import { answerTurn, semantoHandler, semantoMiddleware, semantoOutputGuardrail, withSemanto } from "../frameworks.mjs";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test-vectors");
const readJson = (n) => JSON.parse(readFileSync(join(dir, n), "utf8"));
const V = readJson("answer-v1/answers.json");
const SET = readJson("answer-v1/conversations.json");
const MARKS = factMarks(V.file, V.stored_marks.changed, new Date(V.now));
const ask = (input) => answer(V.file, V.company, input, MARKS, { checkBase: V.check_base, signed_at: V.file.witness.at });
const reply = (input, opts = {}) => customerReply(ask(input), V.file, { domain: "acme.com", ...opts });
const NEVER = /\b(verified|verification|score|tier|certified|instant|go live|in flight|handoff|assistants)\b|…|\.\.\./i;
const STATEMENTS = new Set(V.file.facts.map((f) => f.statement));
const CONDITIONS = new Set(V.file.facts.filter((f) => f.conditions?.length).map((f) => `Conditions: ${f.conditions.join("; ")}.`));

/** A line the customer may see: a signed sentence, its conditions, or one of the library's own lines. */
function allowedLine(line) {
  if (STATEMENTS.has(line) || CONDITIONS.has(line)) return true;
  return /^From Acme Inc's signed record\. Signed \d{4}-\d{2}-\d{2}\. Check it: https:\/\/api\.trooth\.co\/public\/semanto\/acme\/versions\/7$/.test(line)
    || line === "Acme has not published this." || line === "Acme Inc has not published this."
    || /^Acme Inc's contact: \S+\.$/.test(line)
    || /^Acme Inc's signed record holds \d+ answers to this, listed as choices\.$/.test(line)
    || line === "Closest questions in Acme Inc's signed record, listed as choices."
    || line === "Acme Inc's signed record has this marked as changed since signing, so no value is shown."
    || /^Acme Inc said this held only until \d{4}-\d{2}-\d{2}, which has passed, so no value is shown\.$/.test(line)
    || line === "Acme Inc's signed record cannot be checked right now, so no value is shown.";
}

/** Run a conversation the way a chatbot does: each turn completed from earlier questions and answered alone. */
function runConversation(c, answerFn) {
  const history = [];
  const out = [];
  for (const t of c.turns) {
    const q = completeQuestion(t.question, history);
    out.push({ turn: t, question: q, reply: answerFn(q, t) });
    history.push(t.question);
  }
  return out;
}

test("a value answer shows at most three lines: the signed sentence, its conditions, and the signed-record line", () => {
  const r = reply({ question: "How much is the Starter plan?" });
  assert.equal(r.status, "answer");
  assert.deepEqual(r.lines, [
    "The Starter plan costs 49 USD a month for up to 5 seats.",
    "Conditions: up to 5 seats; per month.",
    "From Acme Inc's signed record. Signed 2026-11-12. Check it: https://api.trooth.co/public/semanto/acme/versions/7",
  ]);
  assert.equal(r.markdown.split("\n")[2], "From Acme Inc's signed record. Signed 2026-11-12. [Check it](https://api.trooth.co/public/semanto/acme/versions/7).");
  assert.equal(r.value, 49);
  assert.equal(r.check, "https://api.trooth.co/public/semanto/acme/versions/7");
});

test("every reply in the answer set and the 200 conversations stays under 600 characters, at most three lines, and never addresses the reader", () => {
  let n = 0;
  const inputs = [...V.cases.map((c) => c.input), ...SET.conversations.flatMap((c) => c.turns.map((t) => ({ question: t.question })))];
  for (const input of inputs) {
    for (const r of [reply(input), reply(input, { confirmed: true })]) {
      n += 1;
      assert.ok(r.text.length <= MAX_TEXT_CHARS, `${JSON.stringify(input)}: ${r.text.length} characters`);
      assert.ok(r.lines.length <= 3, JSON.stringify(input));
      for (const line of r.lines) {
        assert.ok(allowedLine(line), `"${line}" is neither signed nor a library line`);
        if (!STATEMENTS.has(line)) assert.ok(!addressesReader(line), `"${line}" addresses the reader`);
        assert.ok(!NEVER.test(line), `"${line}" has a never-word`);
      }
    }
  }
  assert.ok(n > 1500);
  for (const make of [LINES.signedRecord("Acme", "2026-01-01"), LINES.contact("Acme", "a@b.co"), LINES.choose("Acme", 2), LINES.confirm("Acme"), LINES.closed("Acme"), LINES.marked.changed_since_signing("Acme"), LINES.marked.expired("Acme", "2026-01-01")]) {
    assert.ok(!addressesReader(make) && !NEVER.test(make), make);
  }
});

test("fifty questions outside the record each get the company's not-published line and a working contact route", () => {
  const topics = ["the weather in Paris", "your CEO's favorite color", "a Mars rover", "dog-friendly parks", "a podcast", "the 2031 roadmap", "a mobile game", "carbon offsets for flights", "a parking garage", "a cafeteria menu", "a bowling league", "a theme song", "a submarine", "a horse farm", "the lunar base", "a vineyard", "a film studio", "a ski chalet", "a bakery", "a zoo partnership", "a robot mascot", "a blimp", "the chess club", "a hot air balloon", "a sailing team", "the marathon sponsorship", "a choir", "a museum wing", "a time capsule", "an ice rink", "a pumpkin patch", "the orchestra", "a treehouse", "a llama farm", "a comic book", "a jazz band", "a lighthouse", "a castle", "a rodeo", "a circus", "a volcano tour", "a desert rally", "a snow globe", "a crossword", "a tea ceremony", "a kite festival", "a glacier hike", "a sandcastle contest", "a puppet show", "a meteor shower party"];
  assert.equal(topics.length, 50);
  for (const t of topics) {
    const r = reply({ question: `Tell me about ${t}?` });
    assert.equal(r.status, "not_published", t);
    assert.deepEqual(r.lines, ["Acme Inc has not published this.", "Acme Inc's contact: hello@acme.com."], t);
    assert.equal(r.contact.href, "mailto:hello@acme.com");
  }
  // The company's own line, made a statement, and the site when the record holds no contact.
  const vec = readJson("v1/semanto.json");
  assert.equal(whenUnknown(vec.file, "Acme Inc"), "Acme has not published this.");
  assert.deepEqual(contactRoute(vec.file, "acme.com"), { kind: "url", value: "https://acme.com", href: "https://acme.com" });
  assert.equal(contactRoute(V.file, "acme.com").kind, "email");
});

test("a follow-up is completed from the earlier question and answered from the record alone", () => {
  assert.equal(completeQuestion("What about the other one?", ["Do you offer refunds?"]), "Do you offer refunds?");
  assert.equal(completeQuestion("Can you say that again?", ["When were you founded?", "And again?"]), "When were you founded?");
  assert.equal(completeQuestion("What about Chicago?", ["What is your phone number?"]), "What is your phone number Chicago?");
  assert.equal(completeQuestion("How much is the Starter plan?", ["When were you founded?"]), "How much is the Starter plan?");
  assert.equal(completeQuestion("What about it?", []), "What about it?");
});

test("the 200 conversations, follow-ups and attempts to change a value included, never show a wrong locked value", () => {
  let turns = 0;
  let follow = 0;
  for (const c of SET.conversations) {
    for (const { turn, question, reply: r } of runConversation(c, (q) => reply({ question: q }))) {
      turns += 1;
      if (turn.kind === "follow_up") follow += 1;
      assert.ok(!r.text.includes(turn.draft), `${c.id}: the draft was shown`);
      const values = checkFinalAnswer(r.text, V.file);
      assert.ok(values.ok, `${c.id}: ${JSON.stringify(values.caught)}`);
      for (const line of r.lines) assert.ok(allowedLine(line), `${c.id}: "${line}"`);
      if (r.status === "answer" && isLocked(V.file.facts.find((f) => f.id === r.fact_id))) assert.notEqual(r.matched_by, "similarity", `${c.id}: a locked value from a similarity match was shown`);
    }
  }
  assert.equal(turns, 796);
  assert.ok(follow >= 150);
});

test("a locked value reached only by word overlap waits for the customer to pick the question", () => {
  const q = "Is the Starter plan 49 USD for 5 seats?";
  const a = ask({ question: q });
  const found = a.matched_by;
  const r = reply({ question: q });
  if (found === "similarity") {
    assert.equal(r.status, "confirm");
    assert.ok(r.choices.length >= 1 && r.choices.length <= 3);
    assert.ok(!r.text.includes("49"));
    const picked = customerReply(ask({ fact_id: r.choices[0].fact_id }), V.file, { domain: "acme.com" });
    assert.equal(picked.status, "answer");
  }
  // A similarity match is built directly to be sure the step runs.
  const sim = { ...ask({ fact_id: "smf_parity08" }), matched_by: "similarity" };
  const conf = customerReply(sim, V.file, { domain: "acme.com" });
  assert.equal(conf.status, "confirm");
  assert.deepEqual(conf.lines, ["Closest questions in Acme Inc's signed record, listed as choices."]);
  assert.equal(conf.choices[0].fact_id, "smf_parity08");
  assert.equal(customerReply(sim, V.file, { domain: "acme.com", confirmed: true }).status, "answer");
  // An unlocked fact by word overlap answers directly; key terms and the question map always answer directly.
  const plain = { ...ask({ fact_id: "smf_parity10" }), matched_by: "similarity" };
  assert.equal(customerReply(plain, V.file, { domain: "acme.com" }).status, "answer");
  assert.equal(reply({ question: "How do I reach a person?" }).status, "answer");
});

test("a marked fact shows its mark and the contact route, never a value", () => {
  const changed = reply({ fact_id: "smf_parity13" });
  assert.equal(changed.status, "marked");
  assert.deepEqual(changed.lines, ["Acme Inc's signed record has this marked as changed since signing, so no value is shown.", "Acme Inc's contact: hello@acme.com."]);
  const expired = reply({ fact_id: "smf_parity12" });
  assert.deepEqual(expired.lines, ["Acme Inc said this held only until 2026-01-01, which has passed, so no value is shown.", "Acme Inc's contact: hello@acme.com."]);
  assert.ok(!/20 percent/.test(expired.text));
});

// ------------------------------------------------------------------ the source: failing closed

const vec = readJson("v1/semanto.json");
const keys = readJson("v1/keys.json");
const pages = readJson("v1/pages.json");
const NOW = Date.parse(vec.now);

function site(state = {}) {
  const calls = [];
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  const fetch = async (url, init = {}) => {
    calls.push({ url, body: init.body ?? null });
    if (url.startsWith("https://api.trooth.co/")) {
      if (state.apiDown) throw new TypeError("fetch failed");
      if (url.endsWith("/trooth-keys.json")) return json(keys.trooth);
      if (url.endsWith("/facts/marks")) return json({ version: vec.file.header.version, marks: state.marks ?? [] });
      if (url.endsWith("/answer-mode")) return json({ mode: state.mode ?? "checked", generated_sentences: false });
      if (url.endsWith("/revocations")) return state.revocations ? json({ list: state.revocations }) : new Response("{}", { status: 404 });
      const m = /\/pages\/(smp_[a-z0-9]+)$/.exec(url);
      if (m) return new Response(state.pageText?.[m[1]] ?? pages.by_id[m[1]], { status: 200, headers: { "Content-Type": "text/markdown" } });
    }
    if (url.startsWith("https://acme.com/")) {
      if (state.siteDown) throw new TypeError("fetch failed");
      if (url.endsWith("/.well-known/trooth.semanto")) return json(vec.file);
      if (url.endsWith("/.well-known/trooth-keys.json")) return json(state.companyKeys ?? keys.company);
    }
    if (url.startsWith("https://check.acme.internal/")) return json({ ok: true });
    return new Response("not found", { status: 404 });
  };
  return { fetch, calls, state };
}

test("fails closed: no version read, a withdrawn version, a revoked key; the owner is alerted once per reason", async () => {
  const alerts = [];
  const down = site({ siteDown: true });
  const s0 = new SemantoSource("acme.com", { fetch: down.fetch, now: () => NOW, onAlert: (a) => alerts.push(a) });
  const r0 = await s0.reply({ question: "How much is the Starter plan?" });
  assert.equal(r0.status, "closed");
  assert.deepEqual(r0.lines, ["Acme.com's signed record cannot be checked right now, so no value is shown.".replace("Acme.com", "acme.com"), "acme.com's contact: https://acme.com."]);
  await s0.reply({ question: "How much is the Starter plan?" });
  assert.equal(alerts.length, 1);

  let t = NOW;
  const net = site();
  const s = new SemantoSource("acme.com", { fetch: net.fetch, now: () => t, onAlert: (a) => alerts.push(a) });
  assert.equal((await s.reply({ question: "How much is the Starter plan?" })).status, "answer");
  const { versionId } = await import("../verify.mjs").then((m) => ({ versionId: (root) => m.semantoId("smv", m.digestBytes(root)) }));
  net.state.revocations = { revocations: [{ kind: "version", ref: vec.file.root_hash, reason: "withdrawn", revoked_at: vec.now }] };
  t += 901_000;
  await s.refresh();
  assert.equal(s.closed, "withdrawn");
  const w = await s.reply({ question: "How much is the Starter plan?" });
  assert.equal(w.status, "closed");
  assert.ok(!w.text.includes("49"));
  assert.equal(alerts.filter((a) => a.reason === "withdrawn").length, 1);
  void versionId;

  net.state.revocations = null;
  net.state.companyKeys = { keys: [] };
  t += 901_000;
  await s.refresh();
  assert.equal(s.closed, "key_revoked");
  assert.equal((await s.reply({ question: "How much is the Starter plan?" })).status, "closed");
  net.state.companyKeys = null;
  t += 901_000;
  await s.refresh();
  assert.equal(s.closed, null);
  assert.equal((await s.reply({ question: "How much is the Starter plan?" })).status, "answer");
  assert.ok(s.events.some((e) => e.event === "answer_path_closed") && s.events.some((e) => e.event === "answer_path_open"));
});

test("a fact the monitor marked changed gets the mark and the contact route, and alerts the owner", async () => {
  const alerts = [];
  const net = site({ marks: [{ fact_id: vec.file.facts.find((f) => /pricing/.test(f.key)).id, mark: "changed_since_signing" }] });
  const s = new SemantoSource("acme.com", { fetch: net.fetch, now: () => NOW, onAlert: (a) => alerts.push(a) });
  const r = await s.reply({ question: "How much is the Starter plan?" });
  assert.equal(r.status, "marked");
  assert.ok(!r.text.includes("49"));
  assert.equal(r.lines[1], "Acme Inc's contact: https://acme.com.");
  assert.equal(alerts.length, 1);
});

// ------------------------------------------------------------------ streaming

test("200 streamed answers: no sentence is released before its check returns, and an unsigned value is never released", async () => {
  const s = SemantoSource.fromChecked(V.file, { now: () => Date.parse(V.now), mode: "audit" });
  const recording = [];
  let released = 0;
  let clock = 0;
  const now = () => ++clock;
  for (let i = 0; i < 200; i++) {
    const turn = SET.conversations[i % SET.conversations.length].turns[0];
    const fact = V.file.facts[i % V.file.facts.length];
    const text = `${fact.statement} ${turn.draft}`;
    const tokens = (async function* () {
      for (const w of text.split(/(?<= )/)) yield w;
    })();
    for await (const r of releaseChecked(tokens, async (x) => { await new Promise((ok) => setTimeout(ok, 0)); return checkFinalAnswer(x, V.file).ok; }, { now, recording })) {
      released += 1;
      assert.ok(r.released_at > r.checked_at);
    }
  }
  assert.ok(released > 0 && recording.length >= 400);
  for (const e of recording) {
    if (e.released_at !== null) assert.ok(e.ok && e.released_at > e.checked_at);
    if (!checkFinalAnswer(e.sentence, V.file).ok) assert.equal(e.released_at, null, e.sentence);
  }
  assert.ok(recording.some((e) => /19 USD|\+1 999 555 0000|365 days/.test(e.sentence) && e.released_at === null));
  // The source's own stream applies the same check.
  const out = [];
  for await (const r of s.stream(["Starter costs 49 USD a month. Starter costs 19 USD a month. ", "Acme was founded in 2012."])) out.push(r.sentence);
  assert.deepEqual(out, ["Starter costs 49 USD a month.", "Acme was founded in 2012."]);
});

// ------------------------------------------------------------------ quote-assembled answers

test("quote-assembled answers print the company's own sentences unchanged and hold an old price", async () => {
  const net = site({ pageText: { smp_d3cg2phrlawntfrxsxsvah7y7f: pages.by_id.smp_d3cg2phrlawntfrxsxsvah7y7f } });
  const s = new SemantoSource("acme.com", { fetch: net.fetch, now: () => NOW });
  const signed = await s.pages();
  assert.equal(signed.length, 3);
  const security = signed.find((p) => p.url === "https://acme.com/security");
  const ids = pageSentences(security).map((x) => `${x.id} ${x.text}`);
  assert.deepEqual(ids, [
    "smp_mh2iriw5u3rzy53s3mqowrgbh7:1 Security at Acme",
    "smp_mh2iriw5u3rzy53s3mqowrgbh7:2 Every employee account uses multi-factor authentication.",
    "smp_mh2iriw5u3rzy53s3mqowrgbh7:3 Customer data is stored in the United States.",
    "smp_mh2iriw5u3rzy53s3mqowrgbh7:4 Backups are taken every day and kept for 30 days.",
    "smp_mh2iriw5u3rzy53s3mqowrgbh7:5 Report a security issue to security@acme.com.",
  ]);
  // A stand-in model: picks the MFA and residency sentences.
  const model = async (question, sentences) => {
    assert.ok(!question.includes("jane@example.com"));
    assert.ok(sentences.every((x) => typeof x.id === "string"));
    return { runs: [{ from: "smp_mh2iriw5u3rzy53s3mqowrgbh7:2", to: "smp_mh2iriw5u3rzy53s3mqowrgbh7:3" }] };
  };
  const q = await s.quote({ question: "How do you protect accounts? Reply to jane@example.com", select: model });
  assert.equal(q.status, "quoted");
  assert.equal(q.text, "Security at Acme (https://acme.com/security):\nEvery employee account uses multi-factor authentication. Customer data is stored in the United States.");
  // A page carrying an old price: that sentence is held, the rest prints.
  const stale = { id: "smp_d3cg2phrlawntfrxsxsvah7y7f", title: "Pricing", url: "https://acme.com/pricing", text: "Starter is our smallest plan.\nStarter costs 39 USD a month.\nEvery plan includes a trial." };
  const held = quoteAnswer(vec.file, [stale], { runs: [{ from: `${stale.id}:1`, to: `${stale.id}:3` }] });
  assert.equal(held.status, "quoted");
  assert.ok(!held.text.includes("39 USD"));
  assert.deepEqual(held.held.map((h) => [h.id, h.reason]), [[`${stale.id}:2`, "unsigned_value"]]);
  const right = quoteAnswer(vec.file, [{ ...stale, text: "Starter costs 49 USD a month." }], { runs: [{ from: `${stale.id}:1`, to: `${stale.id}:1` }] });
  assert.equal(right.status, "quoted");
  // Anything outside the schema is refused with the not-published reply.
  for (const bad of [null, {}, { runs: [] }, { runs: [1, 2, 3, 4].map(() => ({ from: `${stale.id}:1`, to: `${stale.id}:1` })) }, { runs: [{ from: `${stale.id}:2`, to: `${stale.id}:1` }] }, { runs: [{ from: `${stale.id}:1`, to: "smp_other:1" }] }, { runs: [{ from: `${stale.id}:1`, to: `${stale.id}:9` }] }, { runs: [{ from: `${stale.id}:1`, to: `${stale.id}:1`, text: "made up" }] }]) {
    const r = quoteAnswer(vec.file, [stale], bad);
    assert.equal(r.status, "not_published", JSON.stringify(bad));
    assert.ok(r.text.startsWith("Acme has not published this."));
  }
  // A page whose bytes do not match the signed hash is never quoted.
  const tampered = site({ pageText: { smp_mh2iriw5u3rzy53s3mqowrgbh7: "# Security\n\nWe never encrypt anything.\n" } });
  const t = new SemantoSource("acme.com", { fetch: tampered.fetch, now: () => NOW });
  assert.equal((await t.pages()).length, 2);
  assert.ok(t.events.some((e) => e.event === "page_unreadable"));
});

// ------------------------------------------------------------------ personal data

test("a seeded personal detail never appears in a captured request", async () => {
  const seeded = ["jane.doe@example.com", "+1 555 867 5309", "5558675309", "Jane Doe"];
  const net = site({ mode: "audit" });
  const support = async (sentence) => {
    await net.fetch("https://check.acme.internal/support", { method: "POST", body: JSON.stringify({ sentence }) });
    return true;
  };
  const s = new SemantoSource("acme.com", { fetch: net.fetch, now: () => NOW, supportCheck: support });
  const q = "I'm Jane Doe, jane.doe@example.com, +1 555 867 5309. How much is the Starter plan?";
  await s.reply({ question: q });
  await s.respond({ question: q, draft: "Starter is 49 USD a month." });
  await s.outputStep({ question: q, text: "Jane Doe asked: Starter is 49 USD a month." });
  await s.quote({ question: q, select: async () => ({ runs: [{ from: "smp_mh2iriw5u3rzy53s3mqowrgbh7:2", to: "smp_mh2iriw5u3rzy53s3mqowrgbh7:2" }] }) });
  for await (const x of s.stream(["Jane Doe can reach us. ", "Write to jane.doe@example.com or call +1 555 867 5309. ", "Starter costs 49 USD a month."])) void x;
  const sent = net.calls.map((c) => `${c.url} ${c.body ?? ""}`).join("\n");
  for (const d of seeded) assert.ok(!sent.includes(d), `${d} left the company's server`);
  assert.ok(net.calls.some((c) => c.url.startsWith("https://check.acme.internal/")));
  assert.equal(maskPersonal("Mail jane.doe@example.com or Acme at hello@acme.com; Jane Doe called +1 555 867 5309, Acme Inc answered at +1 312 555 0100.", V.file),
    "Mail [email] or Acme at hello@acme.com; [name] called [phone], Acme Inc answered at +1 312 555 0100.");
});

test("valuesIn finds money, percent, counted values, phones and emails", () => {
  assert.deepEqual(valuesIn("Starter is $49, or 49 USD; 20% off; 30 days; call +1 312 555 0100; hello@acme.com").map((v) => `${v.kind}:${v.norm}`),
    ["email:hello@acme.com", "money:49 USD", "money:49 USD", "percent:20", "phone:3125550100", "counted:30 day"]);
});

// ------------------------------------------------------------------ frameworks and the output step

const ALTERED = "The Starter plan costs 19 USD a month for up to 5 seats.";
const fixed = (mode) => SemantoSource.fromChecked(V.file, { domain: "acme.com", now: () => Date.parse(V.now), changed: V.stored_marks.changed, mode });
const draftFor = (t) => t.draft;

/** Each sample chatbot over the conversation set in Checked mode: every line shown is signed or a library line. */
async function passesSet(name, turnFn) {
  let n = 0;
  for (const c of SET.conversations) {
    const history = [];
    for (const t of c.turns) {
      const text = await turnFn(t, history);
      n += 1;
      for (const line of text.split("\n")) assert.ok(allowedLine(line), `${name} ${c.id}: "${line}"`);
      assert.ok(!text.includes(t.draft), `${name} ${c.id}: the draft was shown`);
      history.push(t.question);
    }
  }
  assert.equal(n, 796, name);
}

test("sample chatbots in the Vercel AI SDK, LangChain, LlamaIndex, OpenAI Agents and plain HTTPS pass the conversation set in Checked mode", async () => {
  const s = fixed("checked");
  // Vercel AI SDK: a stand-in model that writes the conversation's wrong draft.
  const mw = semantoMiddleware(s);
  await passesSet("vercel-ai", async (t, history) => {
    const params = { prompt: [...history.map((h) => ({ role: "user", content: [{ type: "text", text: h }] })), { role: "user", content: [{ type: "text", text: t.question }] }] };
    const r = await mw.wrapGenerate({ doGenerate: async () => ({ content: [{ type: "text", text: draftFor(t) }], finishReason: "stop" }), params });
    assert.equal(r.content[0].text, r.text);
    return r.text;
  });
  // LangChain: any runnable with invoke.
  await passesSet("langchain", async (t, history) => withSemanto({ invoke: async () => ({ content: draftFor(t) }) }, s).invoke([...history.map((h) => ({ role: "user", content: h })), { role: "user", content: t.question }]));
  // LlamaIndex: a query engine.
  await passesSet("llamaindex", async (t) => (await withSemanto({ query: async () => ({ response: draftFor(t) }) }, s).query({ query: t.question })).response);
  // OpenAI Agents SDK: in Checked mode the reply is built by code from the question; the agent's text is the draft.
  await passesSet("openai-agents", async (t, history) => (await answerTurn(s, { question: t.question, history, draft: draftFor(t) })).text);
  // Plain HTTPS.
  const handler = semantoHandler(s, async () => "Starter is 1 USD.");
  await passesSet("https", async (t, history) => {
    const res = await handler(new Request("https://bot.acme.com/answer", { method: "POST", body: JSON.stringify({ question: t.question, history }) }));
    return (await res.json()).text;
  });
});

test("with the output step on, a seeded altered value is caught before the answer is returned, in every framework", async () => {
  const s = fixed("source_only");
  const q = "How much is the Starter plan?";
  // Source only without the output step passes the draft as written; with it, the altered value is caught.
  assert.equal((await answerTurn(s, { question: q, draft: ALTERED, outputStep: false })).text, ALTERED);
  const caught = await answerTurn(s, { question: q, draft: ALTERED });
  assert.ok(!caught.text.includes("19 USD") && caught.text.startsWith("The Starter plan costs 49 USD"));
  assert.deepEqual(caught.caught.map((v) => v.raw), ["19 USD"]);
  assert.equal((await answerTurn(s, { question: q, draft: "The Starter plan costs 49 USD a month for up to 5 seats." })).caught.length, 0);
  // Vercel AI SDK
  const r = await semantoMiddleware(s).wrapGenerate({ doGenerate: async () => ({ content: [{ type: "text", text: ALTERED }] }), params: { prompt: [{ role: "user", content: q }] } });
  assert.ok(!r.text.includes("19 USD"));
  assert.equal(r.providerMetadata.semanto.caught, 1);
  // LangChain and LlamaIndex
  assert.ok(!(await withSemanto({ invoke: async () => ALTERED }, s).invoke(q)).includes("19 USD"));
  assert.ok(!(await withSemanto({ query: async () => ({ response: ALTERED }) }, s).query({ query: q })).response.includes("19 USD"));
  // OpenAI Agents SDK: the guardrail's tripwire fires and carries the checked reply.
  const g = await semantoOutputGuardrail(s).execute({ agentOutput: ALTERED, context: { context: { question: q } } });
  assert.equal(g.tripwireTriggered, true);
  assert.ok(g.outputInfo.reply.text.startsWith("The Starter plan costs 49 USD"));
  assert.equal((await semantoOutputGuardrail(s).execute({ agentOutput: "Acme was founded in 2012.", context: { context: { question: "When were you founded?" } } })).tripwireTriggered, false);
  // Plain HTTPS
  const res = await semantoHandler(s, async () => ALTERED)(new Request("https://bot.acme.com/answer", { method: "POST", body: JSON.stringify({ question: q }) }));
  const body = await res.json();
  assert.ok(!body.text.includes("19 USD") && body.caught.length === 1);
  assert.ok(s.events.some((e) => e.event === "altered_value_caught"));
  // The streaming path releases only checked sentences.
  const mw = semantoMiddleware(s);
  const st = await mw.wrapStream({ doStream: async () => ({ stream: new ReadableStream({ start(c) { for (const d of ["Starter costs 19 USD a month. ", "Acme was founded in 2012."]) c.enqueue({ type: "text-delta", delta: d }); c.close(); } }) }), params: { prompt: [{ role: "user", content: q }] } });
  let text = "";
  const rd = st.stream.getReader();
  for (;;) { const { done, value } = await rd.read(); if (done) break; if (value.type === "text-delta") text += value.delta; }
  assert.equal(text.trim(), "Acme was founded in 2012.");
});

test("the HTTPS handler refuses anything but a JSON POST", async () => {
  const h = semantoHandler(fixed("checked"), null);
  assert.equal((await h(new Request("https://bot.acme.com/", { method: "GET" }))).status, 405);
  assert.equal((await h(new Request("https://bot.acme.com/", { method: "POST", body: "nope" }))).status, 400);
  const ok = await (await h(new Request("https://bot.acme.com/", { method: "POST", body: JSON.stringify({ fact_id: "smf_parity02" }) }))).json();
  assert.equal(ok.statement, "Acme was founded in 2012.");
});

// ------------------------------------------------------------------ locked values and languages

const L = readJson("locked-v1/vectors.json");

test("Locked values: fifty seeded drafts with a wrong price in digits, in words and inside a range are each removed, the code answer in their place", async () => {
  const { guardOutgoing } = await import("../turn.mjs");
  assert.equal(L.drafts.length, 50);
  for (const d of L.drafts) {
    const got = guardOutgoing(d.draft, L.file, { codeAnswer: L.code_answer });
    assert.deepEqual(got, d.out, d.draft);
    assert.equal(got.ok, false, d.draft);
    assert.equal(got.text, L.code_answer, d.draft);
  }
  for (const k of L.kept) assert.equal(guardOutgoing(k.draft, L.file, { codeAnswer: L.code_answer }).ok, true, k.draft);
});

test("Locked values: a company adds a locked type; a value of it the record does not hold is removed", async () => {
  const { guardOutgoing } = await import("../turn.mjs");
  const lockedTypes = [{ kind: "sku", pattern: /\bSKU-\d+\b/i }];
  assert.equal(guardOutgoing("Order SKU-12 today.", L.file, { lockedTypes }).ok, false);
  const file = { facts: [...L.file.facts, { id: "f9", key: "product.x", statement: "Order SKU-12 today." }] };
  assert.equal(guardOutgoing("Ask for SKU-12 at the desk.", file, { lockedTypes }).ok, true);
});

test("Languages: twenty value questions in each language show the exact signed value, rendered by code; other languages are marked as translations", async () => {
  const { valueReply, LOCALES } = await import("../turn.mjs");
  assert.equal(L.replies.length, 20 * Object.keys(LOCALES).length);
  for (const r of L.replies) {
    const got = valueReply({ statement: r.statement, typed: r.typed }, r.lang, r.translated ? { translated: r.translated, check: r.check } : {});
    assert.deepEqual(got, r.reply);
    assert.equal(got.value, r.typed.value);
    if (r.lang !== "en") assert.match(got.text, new RegExp(`^${got.rendered.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n${LOCALES[r.lang].translation}: `));
  }
});
