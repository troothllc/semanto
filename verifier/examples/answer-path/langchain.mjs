// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Trooth, LLC
//
// A sample chatbot on LangChain.js: any runnable (a chat model, a chain, an agent executor) is wrapped once.
//
//   import { ChatOpenAI } from "@langchain/openai";
//   const bot = build(new SemantoSource("acme.com"), new ChatOpenAI({ model: "gpt-5" }));
//   const text = await bot.invoke([{ role: "user", content: "How much is the Starter plan?" }]);

import { withSemanto } from "../../js/frameworks.mjs";

export function build(source, runnable) {
  return withSemanto(runnable, source);
}
