# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 Trooth, LLC
"""A sample chatbot on LangChain (pip install "trooth[langchain]").

    from langchain_openai import ChatOpenAI
    bot = build(SemantoSource("acme.com"), ChatOpenAI(model="gpt-5"))
    print(bot.invoke([("human", "How much is the Starter plan?")]))
"""
from trooth.integrations.langchain import semanto_runnable


def build(source, chat_model):
    return semanto_runnable(chat_model, source)
