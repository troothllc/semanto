// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Trooth, LLC
//
// A sample agent on the OpenAI Agents SDK: the output guardrail's tripwire fires when the final answer carries a value
// the company did not sign, and the checked reply is sent instead.
//
//   import { Agent, run, OutputGuardrailTripwireTriggered } from "@openai/agents";
//   const { agent, ask } = build(new SemantoSource("acme.com"), Agent, run, OutputGuardrailTripwireTriggered);
//   const text = await ask("How much is the Starter plan?");

import { semantoOutputGuardrail } from "../../js/frameworks.mjs";

export function build(source, Agent, run, Tripwire) {
  const agent = new Agent({ name: "Acme support", instructions: "Answer questions about Acme.", outputGuardrails: [semantoOutputGuardrail(source)] });
  async function ask(question) {
    const mode = (await source.answerMode()).mode;
    if (mode === "checked") return (await source.reply({ question })).text;
    try {
      const r = await run(agent, question, { context: { question } });
      return String(r.finalOutput);
    } catch (e) {
      if (e instanceof Tripwire) return e.result.output.outputInfo.reply.text;
      throw e;
    }
  }
  return { agent, ask };
}
