// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Trooth, LLC
//
// A sample chatbot on the Vercel AI SDK. The model is wrapped once; every answer then follows the company's mode, and
// the output step catches a value the company did not sign before it reaches the customer.
//
//   import { wrapLanguageModel, generateText } from "ai";
//   import { openai } from "@ai-sdk/openai";
//   const bot = build(new SemantoSource("acme.com"), openai("gpt-5"), wrapLanguageModel);
//   const { text } = await generateText({ model: bot, prompt: "How much is the Starter plan?" });

import { semantoMiddleware } from "../../js/frameworks.mjs";

/** The company's model wrapped with Semanto; `wrap` is the AI SDK's wrapLanguageModel. */
export function build(source, model, wrap) {
  return wrap({ model, middleware: semantoMiddleware(source) });
}
