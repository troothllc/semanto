// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Trooth, LLC
//
// The three answer modes (Checked, Source only, Audit) for the common JavaScript frameworks, and the output step that
// checks an agent's final answer before it is returned. Nothing here imports a framework: each adapter takes the
// framework's own object shape, so the package keeps no dependencies.
//
//   import { SemantoSource } from "@trooth/semanto-verify/source";
//   import { semantoMiddleware } from "@trooth/semanto-verify/frameworks";
//   const model = wrapLanguageModel({ model: openai("gpt-5"), middleware: semantoMiddleware(new SemantoSource("acme.com")) });
//
//   Vercel AI SDK       semantoMiddleware(source)          a language model middleware (wrapGenerate, wrapStream)
//   LangChain.js        withSemanto(runnable, source)      an object with invoke and stream, around any runnable
//   OpenAI Agents SDK   semantoOutputGuardrail(source)     an output guardrail; its tripwire fires on an altered value
//   LlamaIndex.TS       withSemanto(queryEngine, source)   around anything with query({ query }) or invoke
//   plain HTTPS         semantoHandler(source, model)      a fetch handler: POST { question, history } -> the reply

/**
 * One turn in the company's answer mode. `draft` is what the model wrote. Checked builds the reply by code; Source only
 * and Audit pass the draft, and with `outputStep` on (the default) a draft carrying a value the company did not sign is
 * caught before it is returned and replaced by the checked reply.
 * @returns {Promise<{ mode: string, status: string, text: string, caught: object[], reply?: object, audit?: Promise<object> }>}
 */
export async function answerTurn(source, { question, fact_id, history = [], draft = "", mode, outputStep = true }) {
  const r = await source.respond({ question, fact_id, history, draft, mode });
  if (r.mode === "checked" || !outputStep) return { ...r, caught: [] };
  const step = await source.outputStep({ question, fact_id, history, text: draft });
  if (step.ok) return { ...r, caught: [] };
  return { mode: r.mode, status: step.reply.status, text: step.reply.text, reply: step.reply, caught: step.caught, audit: r.audit };
}

/** The last user message in a prompt, whatever shape the framework uses. */
export function lastUserText(input) {
  if (typeof input === "string") return input;
  const list = Array.isArray(input) ? input : input?.prompt ?? input?.messages ?? input?.input ?? null;
  if (typeof list === "string") return list;
  if (!Array.isArray(list)) return String(input?.question ?? input?.query ?? "");
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    const role = m?.role ?? m?._getType?.() ?? m?.type;
    if (role !== "user" && role !== "human") continue;
    return textOf(m.content);
  }
  return "";
}

/** Earlier user questions, oldest first, for completing a follow-up (never used as evidence). */
export function userHistory(input) {
  const list = Array.isArray(input) ? input : input?.prompt ?? input?.messages ?? [];
  if (!Array.isArray(list)) return [];
  const users = list.filter((m) => ["user", "human"].includes(m?.role ?? m?._getType?.() ?? m?.type)).map((m) => textOf(m.content));
  return users.slice(0, -1);
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p === "string" ? p : p?.type === "text" ? p.text : "")).join("");
  return String(content ?? "");
}

// ------------------------------------------------------------------ Vercel AI SDK

/**
 * A Vercel AI SDK language model middleware (wrapLanguageModel). The model's text becomes the draft; what is returned
 * is the reply in the company's mode. Streaming releases the reply as one checked block (Checked) or sentence by
 * sentence after each sentence's check (Source only, Audit).
 */
export function semantoMiddleware(source, opts = {}) {
  return {
    async wrapGenerate({ doGenerate, params }) {
      const result = await doGenerate();
      const draft = result.text ?? textOf((result.content ?? []).filter((p) => p.type === "text"));
      const turn = await answerTurn(source, { question: lastUserText(params), history: userHistory(params), draft, mode: opts.mode, outputStep: opts.outputStep ?? true });
      const content = [{ type: "text", text: turn.text }];
      return { ...result, text: turn.text, content, providerMetadata: { ...(result.providerMetadata ?? {}), semanto: { mode: turn.mode, status: turn.status, caught: turn.caught.length } } };
    },
    async wrapStream({ doStream, doGenerate, params }) {
      const mode = opts.mode ?? (await source.answerMode()).mode;
      if (mode === "checked") {
        const turn = await answerTurn(source, { question: lastUserText(params), history: userHistory(params), draft: "", mode });
        return { stream: textStream([turn.text]), request: {}, response: {} };
      }
      const { stream, ...rest } = await doStream();
      const tokens = deltas(stream);
      const out = (async function* () {
        for await (const s of source.stream(tokens)) yield `${s.sentence} `;
      })();
      return { ...rest, stream: textStream(out) };
    },
  };
}

async function* deltas(stream) {
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    if (value?.type === "text-delta") yield value.delta ?? value.textDelta ?? "";
  }
}

function textStream(parts) {
  return new ReadableStream({
    async start(ctl) {
      const id = "semanto";
      ctl.enqueue({ type: "text-start", id });
      for await (const p of parts) ctl.enqueue({ type: "text-delta", id, delta: p });
      ctl.enqueue({ type: "text-end", id });
      ctl.enqueue({ type: "finish", finishReason: "stop", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } });
      ctl.close();
    },
  });
}

// ------------------------------------------------------------------ LangChain.js and LlamaIndex.TS

/**
 * Wrap a LangChain runnable (invoke, stream) or a LlamaIndex query engine (query) so its output is the reply in the
 * company's mode. The wrapped object keeps invoke(input) and stream(input), and query({ query }) for query engines.
 */
export function withSemanto(inner, source, opts = {}) {
  const run = async (input) => {
    const out = inner.invoke ? await inner.invoke(input) : await inner.query(typeof input === "string" ? { query: input } : input);
    const draft = typeof out === "string" ? out : out?.content !== undefined ? textOf(out.content) : String(out?.response ?? out?.message?.content ?? out?.output ?? out ?? "");
    const question = lastUserText(input);
    return answerTurn(source, { question, history: userHistory(input), draft, mode: opts.mode, outputStep: opts.outputStep ?? true });
  };
  return {
    async invoke(input) {
      return (await run(input)).text;
    },
    async query(input) {
      const t = await run(input?.query ?? input);
      return { response: t.text, semanto: t };
    },
    async *stream(input) {
      yield (await run(input)).text;
    },
    turn: run,
  };
}

// ------------------------------------------------------------------ OpenAI Agents SDK

/**
 * An output guardrail for @openai/agents: the tripwire fires when the agent's final answer carries a value the company
 * did not sign, so the answer is never returned; outputInfo carries the checked reply to send instead.
 */
export function semantoOutputGuardrail(source, opts = {}) {
  return {
    name: opts.name ?? "semanto_output_step",
    async execute({ agentOutput, context }) {
      const text = typeof agentOutput === "string" ? agentOutput : textOf(agentOutput?.content ?? agentOutput?.text ?? agentOutput);
      const question = opts.question?.(context) ?? context?.context?.question ?? "";
      const step = await source.outputStep({ question, text });
      return { tripwireTriggered: !step.ok, outputInfo: step.ok ? { ok: true } : { ok: false, caught: step.caught, reply: step.reply } };
    },
  };
}

// ------------------------------------------------------------------ plain HTTPS

/**
 * A fetch handler (Workers, Deno, Bun, Node 18+): POST JSON { question, history?, fact_id?, confirmed? }; `model` is the
 * company's own model, called as model({ question, history }) -> draft text (not called in Checked mode).
 */
export function semantoHandler(source, model, opts = {}) {
  return async (request) => {
    if (request.method !== "POST") return Response.json({ error: "POST a JSON body with a question." }, { status: 405, headers: { Allow: "POST" } });
    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "The body is not JSON." }, { status: 400 });
    }
    const question = typeof body?.question === "string" ? body.question.slice(0, 2000) : "";
    const history = Array.isArray(body?.history) ? body.history.filter((h) => typeof h === "string").slice(-20) : [];
    const fact_id = typeof body?.fact_id === "string" ? body.fact_id : undefined;
    const mode = opts.mode ?? (await source.answerMode()).mode;
    if (fact_id || mode === "checked") {
      const r = await source.reply({ question, fact_id, history, confirmed: body?.confirmed === true });
      return Response.json({ mode, ...r });
    }
    const draft = model ? String(await model({ question, history })) : "";
    const turn = await answerTurn(source, { question, history, draft, mode, outputStep: opts.outputStep ?? true });
    const { audit, ...rest } = turn;
    void audit;
    return Response.json(rest);
  };
}
