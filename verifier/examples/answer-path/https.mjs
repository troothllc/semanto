// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Trooth, LLC
//
// A sample chatbot over plain HTTPS: a fetch handler for Cloudflare Workers, Deno, Bun or Node 18+.
//
//   export default { fetch: build(new SemantoSource("acme.com"), async ({ question }) => myModel(question)) };

import { semantoHandler } from "../../js/frameworks.mjs";

export function build(source, model) {
  return semantoHandler(source, model);
}
