// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Trooth, LLC

import type { AnswerMode, SemantoSource } from "./source.mjs";
import type { CustomerReply, FoundValue } from "./turn.mjs";

export interface Turn { mode: AnswerMode; status: string; text: string; caught: FoundValue[]; reply?: CustomerReply; audit?: Promise<object> }
export function answerTurn(source: SemantoSource, input: { question?: string; fact_id?: string; history?: string[]; draft?: string; mode?: AnswerMode; outputStep?: boolean }): Promise<Turn>;
export function lastUserText(input: unknown): string;
export function userHistory(input: unknown): string[];
/** A Vercel AI SDK language model middleware (pass to wrapLanguageModel). */
export function semantoMiddleware(source: SemantoSource, opts?: { mode?: AnswerMode; outputStep?: boolean }): { wrapGenerate(o: any): Promise<any>; wrapStream(o: any): Promise<any> };
/** Around a LangChain runnable (invoke) or a LlamaIndex query engine (query). */
export function withSemanto(inner: { invoke?(input: unknown): unknown; query?(input: unknown): unknown }, source: SemantoSource, opts?: { mode?: AnswerMode; outputStep?: boolean }): {
  invoke(input: unknown): Promise<string>;
  query(input: unknown): Promise<{ response: string; semanto: Turn }>;
  stream(input: unknown): AsyncGenerator<string>;
  turn(input: unknown): Promise<Turn>;
};
/** An output guardrail for @openai/agents. */
export function semantoOutputGuardrail(source: SemantoSource, opts?: { name?: string; question?: (context: unknown) => string }): { name: string; execute(o: { agentOutput: unknown; context: any }): Promise<{ tripwireTriggered: boolean; outputInfo: unknown }> };
/** A fetch handler: POST { question, history?, fact_id?, confirmed? }. */
export function semantoHandler(source: SemantoSource, model: ((o: { question: string; history: string[] }) => Promise<string> | string) | null, opts?: { mode?: AnswerMode; outputStep?: boolean }): (request: Request) => Promise<Response>;
