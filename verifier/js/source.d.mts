// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Trooth, LLC

import type { Answer, FactMark } from "./answer.mjs";

export const TROOTH_API: string;
export const MAX_REFRESH_SECONDS: 900;

export interface SourceEvent {
  at: string;
  event: "version_adopted" | "version_refused" | "site_unreachable" | "trooth_api_unreachable";
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
}
