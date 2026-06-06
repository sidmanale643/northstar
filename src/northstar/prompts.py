from __future__ import annotations

from collections.abc import Mapping
from types import TracebackType
from typing import TYPE_CHECKING, Any, Protocol
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, model_validator

from ._prompt_template import render_template, variables_schema

if TYPE_CHECKING:
    from .client import Northstar
    from .models import Span


class Prompt(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    project_id: UUID
    name: str
    slug: str
    current_version_id: UUID | None = None
    labels: dict[str, UUID] = Field(default_factory=dict)
    description: str | None = None


class PromptVersion(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: UUID
    prompt_id: UUID
    version_number: int
    content: str
    model: str | None = None
    temperature: float | None = None
    max_tokens: int | None = None
    variables: list[dict[str, Any]] = Field(default_factory=list)
    parent_version_id: UUID | None = None
    change_note: str | None = None
    content_hash: str

    @model_validator(mode="after")
    def populate_variables(self) -> PromptVersion:
        if not self.variables:
            self.variables = variables_schema(self.content)
        return self


class CompiledPrompt(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt_id: UUID
    prompt_version_id: UUID
    content: str
    raw_content: str
    variables: dict[str, Any] = Field(default_factory=dict)
    model: str | None = None
    temperature: float | None = None
    max_tokens: int | None = None
    content_hash: str
    _client: Northstar | None = PrivateAttr(default=None)
    _prompt_version: PromptVersion | None = PrivateAttr(default=None)

    def bind(
        self,
        *,
        variables: Mapping[str, Any] | None = None,
        span: Span | None = None,
    ) -> _PromptBinding:
        return _PromptBinding(self, variables or {}, span)


class PromptRegistry(Protocol):
    def resolve(self, slug: str, label: str) -> PromptVersion: ...

    def put(self, version: PromptVersion) -> None: ...


def compile(
    prompt_version: PromptVersion,
    variables: Mapping[str, Any],
) -> CompiledPrompt:
    variable_values = dict(variables)
    return CompiledPrompt(
        prompt_id=prompt_version.prompt_id,
        prompt_version_id=prompt_version.id,
        content=render_template(prompt_version.content, variable_values),
        raw_content=prompt_version.content,
        variables=variable_values,
        model=prompt_version.model,
        temperature=prompt_version.temperature,
        max_tokens=prompt_version.max_tokens,
        content_hash=prompt_version.content_hash,
    )


def from_version(
    prompt_version: PromptVersion,
    *,
    client: Northstar | None = None,
) -> CompiledPrompt:
    compiled = CompiledPrompt(
        prompt_id=prompt_version.prompt_id,
        prompt_version_id=prompt_version.id,
        content=prompt_version.content,
        raw_content=prompt_version.content,
        variables={},
        model=prompt_version.model,
        temperature=prompt_version.temperature,
        max_tokens=prompt_version.max_tokens,
        content_hash=prompt_version.content_hash,
    )
    compiled._client = client
    compiled._prompt_version = prompt_version
    return compiled


class _PromptBinding:
    def __init__(
        self,
        prompt: CompiledPrompt,
        variables: Mapping[str, Any],
        span: Span | None,
    ) -> None:
        self._prompt = prompt
        self._variables = dict(variables)
        self._span = span
        self._compiled: CompiledPrompt | None = None

    def __enter__(self) -> CompiledPrompt:
        if self._span is None:
            from .api import _active_prompt_span

            self._span = _active_prompt_span()

        prompt_version = self._prompt._prompt_version
        if prompt_version is None:
            prompt_version = PromptVersion(
                id=self._prompt.prompt_version_id,
                prompt_id=self._prompt.prompt_id,
                version_number=0,
                content=self._prompt.raw_content,
                model=self._prompt.model,
                temperature=self._prompt.temperature,
                max_tokens=self._prompt.max_tokens,
                content_hash=self._prompt.content_hash,
            )

        self._compiled = compile(prompt_version, self._variables)
        self._compiled._client = self._prompt._client
        self._compiled._prompt_version = prompt_version

        if self._span is not None:
            self._span.attributes["prompt.compile.requested"] = {
                "prompt_version_id": str(self._compiled.prompt_version_id),
                "content_hash": self._compiled.content_hash,
            }
            self._span._require_client()._enqueue_span(self._span)
        return self._compiled

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> bool:
        del exc_type, exc, traceback
        if self._compiled is not None and self._span is not None:
            client = self._compiled._client
            if client is not None:
                client._enqueue_prompt_link(
                    trace_id=self._span.run_id,
                    span_id=self._span.id,
                    prompt_version_id=self._compiled.prompt_version_id,
                    variable_values=self._compiled.variables,
                )
        return False

    async def __aenter__(self) -> CompiledPrompt:
        return self.__enter__()

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> bool:
        return self.__exit__(exc_type, exc, traceback)
