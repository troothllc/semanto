# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026 Trooth, LLC
"""A sample chatbot over plain HTTPS: a WSGI app for any WSGI server.

    app = build(SemantoSource("acme.com"), lambda question, history: my_model(question))
    # gunicorn https_bot:app
"""
from trooth.integrations.answer_path import wsgi_app


def build(source, model):
    return wsgi_app(source, model)
