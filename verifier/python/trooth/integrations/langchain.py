# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 Trooth, LLC
"""LangChain document loader (pip install "trooth[langchain]")."""
from __future__ import annotations

from typing import Any, Iterator, List, Optional, Sequence

from langchain_core.document_loaders import BaseLoader
from langchain_core.documents import Document
from langchain_core.runnables import Runnable, RunnableLambda
from trooth_semanto_verify.client import SemantoClient

from . import metadata_of
from .answer_path import answer_turn, text_of, user_turns


class SemantoLoader(BaseLoader):
    """Load pages as markdown from a company's domain, each checked against its signature."""

    def __init__(self, urls: Sequence[str], client: Optional[Any] = None, only_signed: bool = False):
        self.urls = list(urls)
        self.client = client or SemantoClient()
        self.only_signed = only_signed
        self.skipped: List[dict] = []

    def lazy_load(self) -> Iterator[Document]:
        for url in self.urls:
            r = self.client.read(url)
            if self.only_signed and not r["ok"]:
                self.skipped.append({"url": url, "reason": r.get("reason")})
                continue
            yield Document(page_content=r["text"], metadata=metadata_of(url, r))


def semanto_runnable(chain: Any, source: Any, mode: Optional[str] = None, output_step: bool = True) -> Runnable:
    """Wrap any LangChain runnable (a chat model, a chain, an agent) so its output is the reply in the company's answer
    mode: built by code in Checked mode (the chain is not called), the chain's text with the output step otherwise."""

    def run(inp: Any) -> str:
        users = user_turns(inp)
        m = mode or source.answer_mode()["mode"]
        draft = "" if m == "checked" else text_of(chain.invoke(inp))
        return answer_turn(source, question=users[-1] if users else "", history=users[:-1], draft=draft, mode=m, output_step=output_step)["text"]

    return RunnableLambda(run, name="semanto_answer")


__all__ = ["SemantoLoader", "semanto_runnable"]
