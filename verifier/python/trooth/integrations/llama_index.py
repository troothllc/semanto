# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 Trooth, LLC
"""LlamaIndex reader (pip install "trooth[llama-index]")."""
from __future__ import annotations

from typing import Any, List, Optional

from llama_index.core.query_engine import CustomQueryEngine
from llama_index.core.readers.base import BaseReader
from llama_index.core.schema import Document
from trooth_semanto_verify.client import SemantoClient

from . import metadata_of
from .answer_path import answer_turn, text_of


class SemantoReader(BaseReader):
    """Read pages as markdown from a company's domain, each checked against its signature."""

    def __init__(self, client: Optional[Any] = None, only_signed: bool = False):
        self.client = client or SemantoClient()
        self.only_signed = only_signed
        self.skipped: List[dict] = []

    def load_data(self, urls: List[str]) -> List[Document]:  # type: ignore[override]
        out: List[Document] = []
        for url in urls:
            r = self.client.read(url)
            if self.only_signed and not r["ok"]:
                self.skipped.append({"url": url, "reason": r.get("reason")})
                continue
            out.append(Document(text=r["text"], metadata=metadata_of(url, r)))
        return out


class SemantoQueryEngine(CustomQueryEngine):
    """A query engine that answers in the company's answer mode: Checked builds the reply by code from the signed record
    (the inner engine is not called); Source only and Audit return the inner engine's answer after the output step."""

    inner: Any
    source: Any
    mode: Optional[str] = None
    output_step: bool = True

    def custom_query(self, query_str: str) -> str:
        m = self.mode or self.source.answer_mode()["mode"]
        draft = "" if m == "checked" else text_of(self.inner.query(query_str))
        return answer_turn(self.source, question=query_str, draft=draft, mode=m, output_step=self.output_step)["text"]


__all__ = ["SemantoReader", "SemantoQueryEngine"]
