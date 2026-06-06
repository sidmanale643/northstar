from __future__ import annotations

import importlib
from typing import Any

_litellm: Any | None = None
_litellm_import_error: BaseException | None = None


def _get_litellm() -> Any:
    global _litellm, _litellm_import_error
    if _litellm is not None:
        return _litellm
    if _litellm_import_error is not None:
        raise _litellm_import_error
    try:
        _litellm = importlib.import_module("litellm")
    except Exception as exc:  # pragma: no cover - depends on env
        _litellm_import_error = exc
        raise
    return _litellm


def is_available() -> bool:
    try:
        _get_litellm()
    except Exception:
        return False
    return True


def count_tokens(model: str, text: str | list) -> int:
    try:
        litellm = _get_litellm()
    except Exception:
        return 0

    try:
        if isinstance(text, list):
            return int(litellm.token_counter(model=model, messages=text))
        return int(litellm.token_counter(model=model, text=text))
    except Exception:
        return 0


def cost_for(model: str, prompt_tokens: int, completion_tokens: int) -> float | None:
    try:
        litellm = _get_litellm()
    except Exception:
        return None

    try:
        from litellm.cost_calculator import cost_per_token
    except Exception:
        cost_per_token = None  # type: ignore[assignment]

    if cost_per_token is not None:
        try:
            prompt_cost, completion_cost = cost_per_token(
                model=model,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
            )
            total = float(prompt_cost) + float(completion_cost)
            if total > 0:
                return total
        except Exception:
            pass

    try:
        model_cost = getattr(litellm, "model_cost", None)
        if isinstance(model_cost, dict) and model in model_cost:
            entry = model_cost[model]
            input_cost = entry.get("input_cost_per_token")
            output_cost = entry.get("output_cost_per_token")
            if input_cost is not None and output_cost is not None:
                return float(input_cost) * prompt_tokens + float(output_cost) * completion_tokens
    except Exception:
        return None

    return None


def format_cost(usd: float) -> str:
    if usd == 0:
        return "$0.00"
    if abs(usd) < 0.01:
        return f"${usd:.4f}"
    if abs(usd) < 1:
        return f"${usd:.4f}"
    return f"${usd:.2f}"
