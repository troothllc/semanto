# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 Trooth, LLC
"""A sample chatbot on LlamaIndex (pip install "trooth[llama-index]").

    engine = VectorStoreIndex.from_documents(docs).as_query_engine()
    bot = build(SemantoSource("acme.com"), engine)
    print(bot.query("How much is the Starter plan?"))
"""
from trooth.integrations.llama_index import SemantoQueryEngine


def build(source, query_engine):
    return SemantoQueryEngine(inner=query_engine, source=source)
