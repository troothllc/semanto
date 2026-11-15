# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 Trooth, LLC
"""A sample agent on the OpenAI Agents SDK (pip install "trooth[openai-agents]"). The output guardrail's tripwire fires
when the final answer carries a value the company did not sign; the checked reply is sent instead.

    ask = build(SemantoSource("acme.com"))
    print(ask("How much is the Starter plan?"))
"""
from agents import Agent, OutputGuardrailTripwireTriggered, Runner

from trooth.integrations.openai_agents import semanto_output_guardrail


def build(source, agent=None):
    agent = agent or Agent(name="Acme support", instructions="Answer questions about Acme.")
    agent.output_guardrails = [*agent.output_guardrails, semanto_output_guardrail(source)]

    def ask(question):
        if source.answer_mode()["mode"] == "checked":
            return source.reply(question=question)["text"]
        try:
            return str(Runner.run_sync(agent, question, context={"question": question}).final_output)
        except OutputGuardrailTripwireTriggered as e:
            return e.guardrail_result.output.output_info["reply"]["text"]

    return ask
