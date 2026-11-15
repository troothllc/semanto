// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Trooth, LLC

export type FactMark = "changed_since_signing" | "expired";
export type MatchedBy = "fact_id" | "question_map" | "key_terms" | "similarity";
export type AnswerStatus = "answer" | "candidates" | "not_published" | "not_read";

export interface AnsweredFact {
  fact_id: string;
  key: string;
  /** The signed sentence, word for word; null when the fact carries a mark. */
  statement: string | null;
  typed: { kind: string; value: unknown; [k: string]: unknown } | null;
  conditions: string[];
  location: string | null;
  valid_from: string | null;
  valid_to: string | null;
  provenance: string;
  source_url: string;
  mark: FactMark | null;
}

export interface Answer {
  object: "semanto.answer";
  status: AnswerStatus;
  matched_by: MatchedBy | null;
  matcher?: string;
  company: { trooth_id: string | null; name: string | null; domain: string };
  version: number | null;
  version_hash?: string;
  signed_at?: string | null;
  check?: string;
  facts: AnsweredFact[];
  /** At most three lines: the signed sentence, its condition and the check link; the mark instead of a value. */
  text: string;
}

export const MATCHER: Readonly<{ id: string; order: string[]; SIMILARITY_THRESHOLD: number; SIMILARITY_MARGIN: number; KEY_TERMS: [string, string[]][]; catalog: [string, string[]][] }>;
export const MARK_WORDS: Readonly<Record<FactMark, string>>;
export function notPublished(org: string, domain: string): string;
export function matcherId(m?: typeof MATCHER): string;
export function factMarks(file: object, changed?: string[], now?: Date): Map<string, FactMark>;
export function answer(file: object, company: { trooth_id: string; org: string; domain: string }, input: { fact_id?: string; question?: string }, marks?: Map<string, FactMark>, ctx?: { checkBase?: string; signed_at?: string | null }): Answer;

export interface AssembledReply {
  status: AnswerStatus;
  fact_id: string | null;
  /** The signed sentence exactly as signed; null when there is no single fact or it carries a mark. */
  statement: string | null;
  signed_on: string | null;
  check: string | null;
  /** What the customer is shown; its first line is the signed sentence for a value answer. */
  text: string;
  /** Whether a model's draft was given; it is never part of `text`. */
  discarded: boolean;
}
export function assembleReply(a: Answer, draft?: string): AssembledReply;
