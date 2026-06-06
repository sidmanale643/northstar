from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, create_model, field_validator, model_validator


class EvalModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _string_list(value: Any) -> list[str] | None:
    if value is None:
        return None
    if isinstance(value, str):
        return [value]
    return value


class ExpectedToolArguments(EvalModel):
    name: str
    arguments: dict[str, Any]


class ExpectedStateTransition(EvalModel):
    from_state: str
    to_state: str


class TraceExpected(EvalModel):
    max_repeated_tool_calls: int | None = None
    allowed_state_transitions: list[ExpectedStateTransition] | None = None
    relevant_retrieval_ids: list[str] | None = None
    min_retrieval_precision: float | None = None
    min_retrieval_recall: float | None = None
    max_step_cost_usd: float | None = None

    @field_validator("max_repeated_tool_calls")
    @classmethod
    def max_repeated_tool_calls_must_be_positive(cls, value: int | None) -> int | None:
        if value is not None and value <= 0:
            raise ValueError("max_repeated_tool_calls must be positive")
        return value

    @field_validator(
        "min_retrieval_precision",
        "min_retrieval_recall",
    )
    @classmethod
    def retrieval_threshold_must_be_ratio(cls, value: float | None) -> float | None:
        if value is not None and not 0 <= value <= 1:
            raise ValueError("retrieval threshold must be between 0 and 1")
        return value

    @field_validator("max_step_cost_usd")
    @classmethod
    def max_step_cost_must_be_non_negative(cls, value: float | None) -> float | None:
        if value is not None and value < 0:
            raise ValueError("max_step_cost_usd must be non-negative")
        return value


class EvalExpected(EvalModel):
    goal: str | None = None
    ground_truth: str | None = None
    context: list[str] | None = None
    rubric: str | None = None
    required_tools: list[str] | None = None
    forbidden_tools: list[str] | None = None
    tool_sequence: list[str] | None = None
    contains: list[str] | None = None
    not_contains: list[str] | None = None
    tool_arguments: list[ExpectedToolArguments] | None = None
    require_tool_output_reference: bool | None = None
    max_tool_calls: int | None = None
    max_latency_ms: float | None = None
    max_cost_usd: float | None = None
    trace: TraceExpected | None = None

    @field_validator(
        "required_tools",
        "forbidden_tools",
        "tool_sequence",
        "context",
        "contains",
        "not_contains",
        mode="before",
    )
    @classmethod
    def allow_single_string(cls, value: Any) -> list[str] | None:
        return _string_list(value)

    @field_validator("max_tool_calls")
    @classmethod
    def max_tool_calls_must_be_non_negative(cls, value: int | None) -> int | None:
        if value is not None and value < 0:
            raise ValueError("max_tool_calls must be non-negative")
        return value

    @field_validator("max_latency_ms", "max_cost_usd")
    @classmethod
    def limit_must_be_non_negative(cls, value: float | None) -> float | None:
        if value is not None and value < 0:
            raise ValueError("limit must be non-negative")
        return value


class EvalMetrics(EvalModel):
    latency_ms: float | None = None
    cost_usd: float | None = None


class JudgeScoringConfig(EvalModel):
    mode: Literal["binary", "numeric"]
    min_score: float = 0.0
    max_score: float = 1.0
    passing_score: float | None = None
    labels: dict[float, str] | None = None

    @model_validator(mode="after")
    def validate_scoring(self) -> "JudgeScoringConfig":
        if self.max_score <= self.min_score:
            raise ValueError("max_score must be greater than min_score")

        if self.mode == "binary":
            if self.passing_score is None:
                self.passing_score = self.max_score
            return self

        if self.passing_score is None:
            raise ValueError("passing_score is required for numeric judge scoring")
        if not self.min_score <= self.passing_score <= self.max_score:
            raise ValueError("passing_score must be within min_score and max_score")
        return self


class EvalCase(EvalModel):
    id: str
    input: Any = None
    trace: dict[str, Any] | None = None
    messages: list[dict[str, Any]]
    expected: EvalExpected = Field(default_factory=EvalExpected)
    metrics: EvalMetrics = Field(default_factory=EvalMetrics)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ToolCall(EvalModel):
    id: str | None = None
    name: str
    arguments: Any = None


class ToolOutput(EvalModel):
    tool_call_id: str | None = None
    name: str | None = None
    content: Any = None


class ToolInteraction(EvalModel):
    call: ToolCall
    output: ToolOutput | None = None


class EvalTrace(EvalModel):
    run_id: str
    name: str | None = None
    status: str | None = None
    started_at: str | None = None
    ended_at: str | None = None
    error: dict[str, Any] | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class EvalTraceSpan(EvalModel):
    id: str
    run_id: str
    parent_span_id: str | None = None
    kind: str
    name: str
    started_at: str | None = None
    ended_at: str | None = None
    status: str | None = None
    error: dict[str, Any] | None = None
    iteration: int | None = None
    attributes: dict[str, Any] = Field(default_factory=dict)


class EvalTraceEvent(EvalModel):
    id: str
    run_id: str
    span_id: str | None = None
    type: str
    created_at: str | None = None
    content: Any = None
    attributes: dict[str, Any] = Field(default_factory=dict)
    order: int


class EvalTraceEdge(EvalModel):
    source_id: str
    target_id: str
    kind: Literal["parent_child", "span_event", "next_event"]


class EvalTraceDag(EvalModel):
    run: EvalTrace
    spans: list[EvalTraceSpan] = Field(default_factory=list)
    events: list[EvalTraceEvent] = Field(default_factory=list)
    edges: list[EvalTraceEdge] = Field(default_factory=list)


class EvalRun(EvalModel):
    messages: list[dict[str, Any]]
    system_prompts: list[str] = Field(default_factory=list)
    user_messages: list[str] = Field(default_factory=list)
    assistant_messages: list[str] = Field(default_factory=list)
    final_response: str | None = None
    tool_calls: list[ToolCall] = Field(default_factory=list)
    tool_outputs: list[ToolOutput] = Field(default_factory=list)
    tool_interactions: list[ToolInteraction] = Field(default_factory=list)
    trace: EvalTraceDag | None = None
    metrics: EvalMetrics = Field(default_factory=EvalMetrics)
    metadata: dict[str, Any] = Field(default_factory=dict)


class GradeStatus(StrEnum):
    PASSED = "passed"
    FAILED = "failed"
    SKIPPED = "skipped"


class CaseStatus(StrEnum):
    PASSED = "passed"
    FAILED = "failed"
    NOT_EVALUATED = "not_evaluated"


class GradeResult(EvalModel):
    name: str
    status: GradeStatus
    reason: str
    feedback: str | None = None
    score: float | None = None
    threshold: float | None = None
    label: str | None = None
    confidence: float | None = None
    evidence: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class CaseResult(EvalModel):
    case_id: str
    status: CaseStatus
    grades: list[GradeResult]


class EvalResult(EvalModel):
    metadata: dict[str, Any] = Field(default_factory=dict)
    total_cases: int
    evaluated_cases: int
    not_evaluated_cases: int
    passed_cases: int
    failed_cases: int
    pass_rate: float
    skipped_grades: int
    case_results: list[CaseResult]


class BinaryJudgeOutput(EvalModel):
    passed: bool
    reason: str
    feedback: str
    label: str | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    evidence: list[str] = Field(default_factory=list)

    @field_validator("reason", "feedback")
    @classmethod
    def require_non_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("must not be blank")
        return stripped


def numeric_judge_output_model(
    min_score: float, max_score: float
) -> type[BaseModel]:
    return create_model(
        "NumericJudgeOutput",
        score=(float, Field(ge=min_score, le=max_score)),
        reason=(str, ...),
        feedback=(str, ...),
        label=(str | None, None),
        confidence=(
            float | None,
            Field(default=None, ge=0, le=1),
        ),
        evidence=(list[str], Field(default_factory=list)),
        __base__=EvalModel,
        __validators__={
            "require_non_blank_reason": field_validator("reason")(
                _require_non_blank_str
            ),
            "require_non_blank_feedback": field_validator("feedback")(
                _require_non_blank_str
            ),
        },
    )


def _require_non_blank_str(value: str) -> str:
    stripped = value.strip()
    if not stripped:
        raise ValueError("must not be blank")
    return stripped
