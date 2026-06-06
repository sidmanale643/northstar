from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

_JINJA_VARIABLE_RE = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}")
_PYTHON_VARIABLE_RE = re.compile(r"(?<!\{)\{([a-zA-Z_][a-zA-Z0-9_]*)\}(?!\})")


def extract_variables(template: str) -> list[str]:
    names = {
        match.group(1)
        for pattern in (_JINJA_VARIABLE_RE, _PYTHON_VARIABLE_RE)
        for match in pattern.finditer(template)
    }
    return sorted(names)


def variables_schema(template: str) -> list[dict[str, Any]]:
    return [
        {"name": name, "type": "string", "required": True, "default": None}
        for name in extract_variables(template)
    ]


def render_template(template: str, variables: Mapping[str, Any]) -> str:
    missing = [name for name in extract_variables(template) if name not in variables]
    if missing:
        names = ", ".join(missing)
        raise ValueError(f"Missing prompt variables: {names}")

    def replace_jinja(match: re.Match[str]) -> str:
        return str(variables[match.group(1)])

    def replace_python(match: re.Match[str]) -> str:
        return str(variables[match.group(1)])

    rendered = _JINJA_VARIABLE_RE.sub(replace_jinja, template)
    return _PYTHON_VARIABLE_RE.sub(replace_python, rendered)
