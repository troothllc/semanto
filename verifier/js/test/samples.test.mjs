// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Trooth, LLC
//
// The sample chatbots in examples/answer-path, each run over the 200 fixed conversations in Checked mode, and each
// with an altered value seeded in Source only mode that the output step must catch.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SemantoSource } from "../source.mjs";
import { build as vercel } from "../../examples/answer-path/vercel-ai.mjs";
import { build as langchain } from "../../examples/answer-path/langchain.mjs";
import { build as agents } from "../../examples/answer-path/openai-agents.mjs";
import { build as https } from "../../examples/answer-path/https.mjs";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test-vectors");
const V = JSON.parse(readFileSync(join(dir, "answer-v1/answers.json"), "utf8"));
const SET = JSON.parse(readFileSync(join(dir, "answer-v1/conversations.json"), "utf8"));
const statements = new Set(V.file.facts.map((f) => f.statement));
const conditions = new Set(V.file.facts.filter((f) => f.conditions?.length).map((f) => `Conditions: ${f.conditions.join("; ")}.`));
const library = /^(From Acme Inc's signed record\. Signed \d{4}-\d{2}-\d{2}\. Check it: \S+|Acme Inc has not published this\.|Acme Inc's contact: \S+\.|Acme Inc's signed record holds \d+ answers to this, listed as choices\.|Closest questions in Acme Inc's signed record, listed as choices\.|Acme Inc's signed record has this marked as changed since signing, so no value is shown\.|Acme Inc said this held only until \d{4}-\d{2}-\d{2}, which has passed, so no value is shown\.)$/;
const source = (mode) => SemantoSource.fromChecked(V.file, { domain: "acme.com", now: () => Date.parse(V.now), changed: V.stored_marks.changed, mode });
const ALTERED = "The Starter plan costs 19 USD a month for up to 5 seats.";

// Stand-ins for the frameworks' own objects, shaped as each SDK shapes them.
const wrapLanguageModel = ({ model, middleware }) => ({ generate: (prompt) => middleware.wrapGenerate({ doGenerate: () => model.doGenerate(), params: { prompt } }) });
const fakeModel = (text) => ({ doGenerate: async () => ({ content: [{ type: "text", text }], finishReason: "stop" }) });
class Agent { constructor(o) { Object.assign(this, o); } }
class Tripwire extends Error { constructor(result) { super("tripwire"); this.result = result; } }
const fakeRun = (text) => async (agent, input, { context }) => {
  for (const g of agent.outputGuardrails) {
    const output = await g.execute({ agentOutput: text, context: { context }, agent });
    if (output.tripwireTriggered) throw new Tripwire({ output });
  }
  return { finalOutput: text };
};

const SAMPLES = {
  "vercel-ai": (s, draft) => async (q, history) => (await vercel(s, fakeModel(draft), wrapLanguageModel).generate([...history.map((h) => ({ role: "user", content: h })), { role: "user", content: q }])).text,
  langchain: (s, draft) => async (q, history) => langchain(s, { invoke: async () => ({ content: draft }) }).invoke([...history.map((h) => ({ role: "user", content: h })), { role: "user", content: q }]),
  llamaindex: (s, draft) => async (q) => (await langchain(s, { query: async () => ({ response: draft }) }).query({ query: q })).response,
  "openai-agents": (s, draft) => async (q) => agents(s, Agent, fakeRun(draft), Tripwire).ask(q),
  https: (s, draft) => async (q, history) => (await (await https(s, async () => draft)(new Request("https://bot.acme.com/", { method: "POST", body: JSON.stringify({ question: q, history }) }))).json()).text,
};

for (const [name, make] of Object.entries(SAMPLES)) {
  test(`${name} sample: Checked mode over the 200 conversations shows only signed sentences and library lines`, async () => {
    const s = source("checked");
    let n = 0;
    for (const c of SET.conversations) {
      const history = [];
      for (const t of c.turns) {
        const text = await make(s, t.draft)(t.question, history);
        n += 1;
        assert.ok(!text.includes(t.draft), `${c.id}: draft shown`);
        for (const line of text.split("\n")) assert.ok(statements.has(line) || conditions.has(line) || library.test(line), `${c.id}: "${line}"`);
        history.push(t.question);
      }
    }
    assert.equal(n, 796);
  });

  test(`${name} sample: with the output step on, a seeded altered value is caught before the answer is returned`, async () => {
    const s = source("source_only");
    const text = await make(s, ALTERED)("How much is the Starter plan?", []);
    assert.ok(!text.includes("19 USD"), text);
    assert.ok(text.startsWith("The Starter plan costs 49 USD a month for up to 5 seats."), text);
    assert.equal(await make(s, "Acme was founded in 2012.")("When were you founded?", []), "Acme was founded in 2012.");
  });
}
