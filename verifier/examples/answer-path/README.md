<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright (c) 2026 Trooth, LLC -->

# Sample chatbots: the answer path in each framework

Each sample wraps the company's own model once. In Checked mode the reply is built by code from the signed record and the
model's text is never shown; in Source only and Audit the model's text is shown after the output step, which replaces an
answer that carries a value the company did not sign with the checked reply.

| Framework | JavaScript | Python |
| --- | --- | --- |
| Vercel AI SDK | `vercel-ai.mjs` (language model middleware) | |
| LangChain | `langchain.mjs` | `langchain_bot.py` |
| LlamaIndex | `langchain.mjs` (`withSemanto` takes a query engine too) | `llama_index_bot.py` |
| OpenAI Agents SDK | `openai-agents.mjs` (output guardrail) | `openai_agents_bot.py` |
| Plain HTTPS | `https.mjs` (fetch handler) | `https_bot.py` (WSGI) |

The tests in `verifier/js/test/turn.test.mjs` and `verifier/python/test_turn.py` run every sample over the 200 fixed
conversations in `test-vectors/answer-v1/conversations.json` in Checked mode, and seed an altered value that the output
step must catch.
