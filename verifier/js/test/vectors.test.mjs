// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Trooth, LLC
//
// Runs every shared vector in verifier/test-vectors/v1 through the JavaScript verifier, positive and negative.
// The Python and Go verifiers run the same files in their own tests. Run: node --test verifier/js/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as V from "../verify.mjs";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test-vectors", "v1");
const readJson = (name) => JSON.parse(readFileSync(join(DIR, name), "utf8"));
const sharedKeys = readJson("keys.json");
const manifest = readJson("manifest.json");

async function run(v) {
  const semanto = readJson("semanto.json");
  const keys = v.keys ?? sharedKeys;
  switch (v.kind) {
    case "semanto-file":
      return V.verifySemanto(v.file, v.pages_by_url ?? readJson("pages.json").by_url, keys, { now: v.now });
    case "tree-head":
      return V.verifyTreeHead(v.tree_head, keys, { now: v.now });
    case "page-proof":
      return V.verifyPageProof(v.proof, v.page_markdown, keys, { now: v.now, header: v.header });
    case "response":
      return V.verifyResponse(v.response.status, v.response.headers, v.response.body, keys, { now: v.now_epoch });
    case "web-bot-auth-request":
      return V.verifyWebBotAuthRequest(v.request.method, v.request.url, v.request.headers, keys, { now: v.now_epoch });
    case "offer":
      return V.verifyOffer(v.jws, keys, { now: v.now });
    case "witness":
      return V.verifyJws(v.jws, V.keyResolver(keys), { expectTyp: V.JWS_TYPES.witness, payload: v.payload, at: new Date(v.now) });
    case "revocations": {
      const l = await V.verifyRevocationList(v.jws, keys, { now: v.now });
      return { ok: l.ok, reason: l.ok ? null : l.reason, state: V.stateOf(semanto.file, new Date(v.now), l.ok ? l.payload : null) };
    }
    case "log": {
      const incl = await V.verifyInclusionInLog(v.inclusion);
      const cons = await V.verifyConsistency(v.consistency);
      const th3 = await V.verifyTreeHead(v.tree_heads["3"], keys, { now: v.now });
      const th5 = await V.verifyTreeHead(v.tree_heads["5"], keys, { now: v.now });
      const cp = await V.verifyCheckpoint(v.checkpoint, keys, v.origin);
      const ok = incl && cons && th3.ok && th5.ok && cp.ok && cp.root_hash === v.inclusion.root_hash;
      return { ok, reason: ok ? null : "log_check_failed" };
    }
    case "pages":
      return { ok: true };
    case "page-bytes":
      return { ok: (await V.digest(V.utf8(v.markdown))) === v.hash };
    default:
      throw new Error(`unknown vector kind ${v.kind}`);
  }
}

for (const name of manifest.files.filter((f) => f !== "keys.json")) {
  test(`${name} concludes what the vector expects`, async () => {
    const v = readJson(name);
    const r = await run(v);
    assert.equal(r.ok, v.expect.ok, `${name}: ${JSON.stringify(r)}`);
    if (v.expect.reason) assert.equal(r.reason, v.expect.reason);
    if (v.expect.state) assert.equal(r.state, v.expect.state);
    if (v.expect.keyid) assert.equal(r.keyid, v.expect.keyid);
    if (v.expect.agent) assert.equal(r.agent, v.expect.agent);
    if (v.expect.version_id) assert.equal(r.version_id, v.expect.version_id);
    if (v.expect.note) assert.ok((r.notes ?? []).some((n) => n.includes(v.expect.note)));
  });
}

test("the manifest lists every vector on disk", () => {
  const onDisk = [...readdirSync(DIR).filter((f) => f.endsWith(".json")), ...readdirSync(join(DIR, "negative")).map((f) => `negative/${f}`)].filter((f) => f !== "manifest.json");
  assert.deepEqual(onDisk.sort(), [...manifest.files].sort());
});

test("negative or fractional tree sizes are refused at once (they once looped forever)", async () => {
  const proof = [new Uint8Array(32), new Uint8Array(32)];
  assert.equal(await V.verifyConsistencyProof(-32, -22, new Uint8Array([48]), new Uint8Array([48]), proof), false);
  assert.equal(await V.verifyConsistencyProof(-1, 5, new Uint8Array(32), new Uint8Array(32), proof), false);
  assert.equal(await V.verifyConsistencyProof(1.5, 4, new Uint8Array(32), new Uint8Array(32), proof), false);
});
