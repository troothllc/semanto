// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Trooth, LLC

import type { Answer, FactMark } from "./answer.mjs";

export const DEFAULT_WHEN_UNKNOWN: string;
export const MAX_TEXT_CHARS: 600;
export const MAX_CHOICES: 3;
export const LINES: {
  signedRecord(org: string, date: string | null): string;
  contact(org: string, route: string): string;
  marked: { changed_since_signing(org: string): string; expired(org: string, to?: string | null): string };
  choose(org: string, n: number): string;
  confirm(org: string): string;
  closed(org: string): string;
};
export function addressesReader(line: string): boolean;
export function isLocked(fact: object | null | undefined): boolean;
export function whenUnknown(file: object | null, org: string): string;

export interface ContactRoute { kind: "email" | "phone" | "url"; value: string; href: string }
export function contactRoute(file: object | null, domain: string): ContactRoute;

export interface Choice { fact_id: string; label: string; mark: FactMark | null }
export interface CustomerReply {
  object: "semanto.reply";
  status: "answer" | "marked" | "not_published" | "choose" | "confirm" | "closed";
  fact_id: string | null;
  statement: string | null;
  conditions: string[];
  value: unknown;
  signed_on: string | null;
  check: string | null;
  contact: ContactRoute;
  choices: Choice[];
  /** At most three lines; never more than 600 characters for a value answer. */
  lines: string[];
  text: string;
  /** The same lines with the check link as a markdown link. */
  markdown: string;
  discarded: boolean;
  matched_by: string | null;
  mark?: FactMark;
  reason?: string;
  question?: string | null;
}
export function customerReply(a: Answer, file: object | null, opts?: { draft?: string; closed?: string | null; domain?: string; confirmed?: boolean }): CustomerReply;

export function isFollowUp(question: string): boolean;
export function completeQuestion(question: string, history?: string[]): string;

export interface FoundValue { kind: "money" | "percent" | "counted" | "phone" | "email"; norm: string; raw: string }
export function valuesIn(text: string): FoundValue[];
export function signedValues(file: object | null): Map<string, Set<string>>;
export function checkSentence(sentence: string, file: object | null, signed?: Map<string, Set<string>>): { ok: boolean; values: FoundValue[]; unsigned: FoundValue[]; reason: "instruction" | "unsigned_value" | null };
export function sentencesOf(text: string): string[];
export function checkFinalAnswer(text: string, file: object | null): { ok: boolean; caught: (FoundValue & { sentence: string })[]; instructions: string[]; sentences: object[] };

export interface SignedPage { id: string; title?: string | null; url?: string; text: string }
export interface PageSentence { id: string; page_id: string; n: number; text: string }
export function pageSentences(page: SignedPage): PageSentence[];
export const SELECTION_SCHEMA: object;
export interface Selection { runs: { from: string; to: string }[] }
export interface Quote {
  object: "semanto.quote";
  status: "quoted" | "not_published";
  runs: { page_id: string; title: string; url: string | null; sentences: PageSentence[] }[];
  held: { id: string; reason: string; unsigned: FoundValue[] }[];
  contact: ContactRoute;
  text: string;
  problem?: string;
}
export function quoteAnswer(file: object | null, pages: SignedPage[], selection: unknown, ctx?: { org?: string; domain?: string }): Quote;

export interface Released { sentence: string; checked_at: number; released_at: number }
export function releaseChecked(tokens: AsyncIterable<string> | Iterable<string>, check: (s: string) => Promise<boolean> | boolean, opts?: { now?: () => number; recording?: object[] }): AsyncGenerator<Released>;
export function maskPersonal(text: string, file: object | null): string;
