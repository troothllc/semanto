// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Trooth, LLC

import type { Answer, FactMark } from "./answer.mjs";
import type { CustomerReply, FoundValue, PageSentence, Quote, Released, SignedPage } from "./turn.mjs";

export const TROOTH_API: string;
export const MAX_REFRESH_SECONDS: 900;
export type AnswerMode = "checked" | "source_only" | "audit";
export const ANSWER_MODES: AnswerMode[];

export interface AuditResult {
  result: "supported" | "differs" | "marked" | "not_in_record" | "not_checked";
  fact_id: string | null;
  /** The signed sentence, for "supported" and "differs". */
  statement: string | null;
  words?: string;
}
export function auditDraft(a: Answer, draft: string, file?: object | null): AuditResult;

export type Responded =
  | ({ mode: "checked" } & CustomerReply)
  | { mode: "source_only"; status: "unchecked"; text: string }
  | { mode: "audit"; status: "unchecked"; text: string; audit: Promise<AuditResult> };

export interface SourceEvent {
  at: string;
  event: "version_adopted" | "version_refused" | "site_unreachable" | "trooth_api_unreachable" | "audit" | "owner_alert" | "answer_path_closed" | "answer_path_open" | "altered_value_caught" | "page_unreadable" | "sentences_held" | "model_failed";
  detail: string;
}

export class SemantoSource {
  constructor(domain: string, opts?: { fetch?: typeof fetch; apiBase?: string; refreshSeconds?: number; timeoutMs?: number; now?: () => number; onEvent?: (e: SourceEvent) => void; onAlert?: (a: { reason: string; detail: string; at: string }) => void; supportCheck?: (maskedSentence: string) => Promise<boolean> | boolean });
  /** A source over a copy the caller already checked and keeps up to date itself. */
  static fromChecked(file: object, opts?: { domain?: string; now?: () => number; changed?: string[]; mode?: AnswerMode; onEvent?: (e: SourceEvent) => void; onAlert?: (a: object) => void; supportCheck?: (s: string) => Promise<boolean> | boolean }): SemantoSource;
  /** Why no value may be shown (withdrawn, key_revoked, recheck_failed), or null. */
  readonly closed: string | null;
  readonly domain: string;
  /** Everything that happened, oldest first. */
  readonly events: SourceEvent[];
  /** The last version that checked out, or null. */
  readonly file: object | null;
  /** How many times a file was checked. */
  readonly checks: number;
  refresh(): Promise<void>;
  ensureFresh(): Promise<void>;
  marks(): Map<string, FactMark>;
  answer(input: { fact_id?: string; question?: string }): Promise<Answer>;
  /** The reply a customer sees for one turn, built by code; the model's draft is discarded. Fails closed. */
  reply(input: { fact_id?: string; question?: string; draft?: string; history?: string[]; confirmed?: boolean }): Promise<CustomerReply>;
  /** The company's answer mode; Checked when it has never been read. */
  answerMode(): Promise<{ mode: AnswerMode; generated_sentences: boolean; free_form: "quoted" | "not_published"; source: "trooth" | "last_read" | "fail_closed" }>;
  /** The reply a chatbot sends, in the company's mode or the one given. */
  respond(input: { fact_id?: string; question?: string; draft?: string; mode?: AnswerMode; history?: string[] }): Promise<Responded>;
  /** The output step on an agent's final answer. */
  outputStep(input: { question?: string; fact_id?: string; text: string; history?: string[] }): Promise<{ ok: boolean; replaced: boolean; caught: FoundValue[]; text: string | null; reply?: CustomerReply }>;
  /** The signed pages of the version in use, each checked against its hash. */
  pages(ids?: string[] | null): Promise<SignedPage[]>;
  /** A free-form answer quoted from the company's signed pages; `select` is the company's model. */
  quote(input: { question: string; select: (question: string, sentences: PageSentence[]) => Promise<unknown> | unknown; pages?: SignedPage[] }): Promise<Quote | CustomerReply>;
  /** Release a stream sentence by sentence, each after its check. */
  stream(tokens: AsyncIterable<string> | Iterable<string>, opts?: { recording?: object[] }): AsyncGenerator<Released>;
  locked(fact_id: string): boolean;
}
