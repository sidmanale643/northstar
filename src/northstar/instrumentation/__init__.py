from __future__ import annotations

from collections.abc import Iterable


def auto_instrument(providers: Iterable[str] = ("openai", "anthropic")) -> None:
    for provider in providers:
        normalized = provider.lower()
        if normalized == "openai":
            from . import openai

            openai.instrument()
        elif normalized == "anthropic":
            from . import anthropic

            anthropic.instrument()
        else:
            raise ValueError(f"unsupported instrumentation provider: {provider}")


__all__ = ["auto_instrument"]
