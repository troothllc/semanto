// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Trooth, LLC

import type { Answer, AssembledReply, FactMark } from "./answer.mjs";

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
  | ({ mode: "checked" } & AssembledReply)
  | { mode: "source_only"; status: "unchecked"; text: string }
  | { mode: "audit"; status: "unchecked"; text: string; audit: Promise<AuditResult> };

export interface SourceEvent {
  at: string;
  event: "version_adopted" | "version_refused" | "site_unreachable" | "trooth_api_unreachable" | "audit";
  detail: string;
}

export class SemantoSource {
  constructor(domain: string, opts?: { fetch?: typeof fetch; apiBase?: string; refreshSeconds?: number; timeoutMs?: number; now?: () => number; onEvent?: (e: SourceEvent) => void });
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
  /** The reply a chatbot shows, built by code; the model's draft is discarded. */
  reply(input: { fact_id?: string; question?: string; draft?: string }): Promise<AssembledReply>;
  /** The company's answer mode; Checked when it has never been read. */
  answerMode(): Promise<{ mode: AnswerMode; generated_sentences: boolean; source: "trooth" | "last_read" | "fail_closed" }>;
  /** The reply a chatbot sends, in the company's mode or the one given. */
  respond(input: { fact_id?: string; question?: string; draft?: string; mode?: AnswerMode }): Promise<Responded>;
}
