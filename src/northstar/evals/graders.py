from __future__ import annotations

from datetime import UTC, datetime
import json
import os
import re
import subprocess
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol

from pydantic import BaseModel, ValidationError

from .models import (
    BinaryJudgeOutput,
    CaseResult,
    CaseStatus,
    EvalCase,
    EvalResult,
    EvalRun,
    EvalTraceDag,
    EvalTraceEvent,
    EvalTraceSpan,
    GradeResult,
    GradeStatus,
    JudgeScoringConfig,
    numeric_judge_output_model,
)
from .normalization import normalize_messages, normalize_trace_payload


DEFAULT_RUBRIC_JUDGE_MODEL = "openrouter/deepseek/deepseek-v4-flash"
DEFAULT_CODE_JUDGE_TIMEOUT_MS = 1000
MAX_CODE_JUDGE_TIMEOUT_MS = 5000
MAX_CODE_JUDGE_OUTPUT_BYTES = 64_000


def _configure_litellm() -> None:
    try:
        import litellm
    except Exception:
        return
    litellm.drop_params = True
    litellm.json_logs = False
    litellm.telemetry = False
    try:
        litellm.set_verbose = False
    except Exception:
        pass
    try:
        litellm.suppress_debug_info = True
    except Exception:
        pass


_configure_litellm()


_API_KEY_ENV_BY_PROVIDER: dict[str, str] = {
    "openrouter": "OPENROUTER_API_KEY",
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "azure": "AZURE_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "google": "GOOGLE_API_KEY",
    "vertex_ai-language-models": "GOOGLE_APPLICATION_CREDENTIALS",
    "groq": "GROQ_API_KEY",
    "mistral": "MISTRAL_API_KEY",
    "cohere": "COHERE_API_KEY",
    "together": "TOGETHER_API_KEY",
    "replicate": "REPLICATE_API_KEY",
    "perplexity": "PERPLEXITY_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
    "fireworks": "FIREWORKS_API_KEY",
    "huggingface": "HUGGINGFACE_API_KEY",
    "openai_compatible": "OPENAI_API_KEY",
    "text-completion-openai": "OPENAI_API_KEY",
}


def _required_api_key_env(model: str) -> str | None:
    if "/" in model:
        provider = model.split("/", 1)[0].lower()
        if provider in _API_KEY_ENV_BY_PROVIDER:
            return _API_KEY_ENV_BY_PROVIDER[provider]
        return None

    lowered = model.lower()
    if lowered.startswith(("gpt-", "o1-", "o3-", "o4-", "text-embedding-", "dall-e", "whisper")):
        return "OPENAI_API_KEY"
    if lowered.startswith("claude"):
        return "ANTHROPIC_API_KEY"
    if lowered.startswith("gemini"):
        return "GEMINI_API_KEY"
    if lowered.startswith("command"):
        return "COHERE_API_KEY"
    if lowered.startswith("mixtral") or lowered.startswith("mistral"):
        return "MISTRAL_API_KEY"
    return None


class JudgeAuthenticationError(RuntimeError):
    """Raised when a judge model is missing the required API key."""


def _check_judge_prerequisites(model: str) -> None:
    env_var = _required_api_key_env(model)
    if env_var and not os.environ.get(env_var):
        provider = model.split("/", 1)[0] if "/" in model else model
        raise JudgeAuthenticationError(
            f"Cannot grade with model '{model}': environment variable "
            f"{env_var} is not set. Set {env_var} to authenticate with "
            f"{provider} before running this eval."
        )


def _judge_failure_message(exc: BaseException, model: str) -> tuple[str, str]:
    exc_name = exc.__class__.__name__
    raw = str(exc).lower()
    provider = model.split("/", 1)[0] if "/" in model else model

    if (
        exc_name == "AuthenticationError"
        or "missing authentication" in raw
        or "invalid api key" in raw
        or "incorrect api key" in raw
        or "401" in raw
    ):
        env_var = _required_api_key_env(model)
        if env_var:
            return (
                f"Judge model '{model}' is not authenticated.",
                (
                    f"The {provider} API rejected the request (401). "
                    f"Set the {env_var} environment variable with a valid "
                    f"API key and rerun the eval."
                ),
            )
        return (
            f"Judge model '{model}' is not authenticated.",
            (
                f"The {provider} API rejected the request (401). "
                "Set the appropriate API key environment variable and rerun the eval."
            ),
        )

    if (
        exc_name == "RateLimitError"
        or "rate limit" in raw
        or "429" in raw
    ):
        return (
            f"Judge model '{model}' is rate-limited.",
            (
                f"The {provider} API returned a rate limit (429). "
                "Wait and retry, or switch to a model with higher limits."
            ),
        )

    if (
        exc_name == "ContextWindowExceededError"
        or "context length" in raw
        or "context_length" in raw
        or "maximum context length" in raw
    ):
        return (
            f"Judge model '{model}' exceeded its context window.",
            (
                "The input is too large for the judge's context window. "
                "Shorten the rubric or final response, or pick a model with a larger window."
            ),
        )

    if exc_name in {"Timeout", "APITimeoutError"} or "timed out" in raw or "timeout" in raw:
        return (
            f"Judge model '{model}' timed out.",
            "The LLM call exceeded the timeout. Try a faster model or rerun the eval.",
        )

    if exc_name == "PermissionDeniedError" or "403" in raw or "forbidden" in raw:
        return (
            f"Judge model '{model}' denied the request.",
            (
                f"The {provider} API denied the request (403). "
                "Check that your account has access to this model."
            ),
        )

    if exc_name == "NotFoundError" or "404" in raw or "model not found" in raw or "unknown model" in raw:
        return (
            f"Judge model '{model}' was not found.",
            (
                f"The {provider} provider does not recognize '{model}'. "
                "Pick a model from the search dropdown or use a valid model id."
            ),
        )

    return (
        f"Judge model '{model}' raised {exc_name}.",
        "The LLM judge errored before producing feedback.",
    )


class Grader(Protocol):
    name: str
    requires_feedback: bool

    def grade(self, case: EvalCase, run: EvalRun) -> GradeResult:
        ...


def _passed(
    name: str,
    reason: str,
    *,
    feedback: str | None = None,
    score: float | None = 1.0,
    threshold: float | None = 1.0,
    label: str | None = "pass",
    confidence: float | None = None,
    evidence: list[str] | None = None,
    metadata: dict[str, Any] | None = None,
) -> GradeResult:
    return GradeResult(
        name=name,
        status=GradeStatus.PASSED,
        reason=reason,
        feedback=feedback,
        score=score,
        threshold=threshold,
        label=label,
        confidence=confidence,
        evidence=evidence or [],
        metadata=metadata or {},
    )


def _failed(
    name: str,
    reason: str,
    *,
    feedback: str | None = None,
    score: float | None = 0.0,
    threshold: float | None = 1.0,
    label: str | None = "fail",
    confidence: float | None = None,
    evidence: list[str] | None = None,
    metadata: dict[str, Any] | None = None,
) -> GradeResult:
    return GradeResult(
        name=name,
        status=GradeStatus.FAILED,
        reason=reason,
        feedback=feedback,
        score=score,
        threshold=threshold,
        label=label,
        confidence=confidence,
        evidence=evidence or [],
        metadata=metadata or {},
    )


def _skipped(name: str, reason: str) -> GradeResult:
    return GradeResult(name=name, status=GradeStatus.SKIPPED, reason=reason)


class MaxToolCalls:
    name = "max_tool_calls"
    requires_feedback = False

    def grade(self, case: EvalCase, run: EvalRun) -> GradeResult:
        max_calls = case.expected.max_tool_calls
        if max_calls is None:
            return _skipped(self.name, "expected.max_tool_calls was not provided.")

        actual = len(run.tool_calls)
        if actual <= max_calls:
            return _passed(
                self.name,
                f"Used {actual} tool calls, limit was {max_calls}.",
                metadata={"actual": actual, "limit": max_calls},
            )
        return _failed(
            self.name,
            f"Used {actual} tool calls, limit was {max_calls}.",
            metadata={"actual": actual, "limit": max_calls},
        )


class RequiredTools:
    name = "required_tools"
    requires_feedback = False

    def grade(self, case: EvalCase, run: EvalRun) -> GradeResult:
        required_tools = case.expected.required_tools
        if required_tools is None:
            return _skipped(self.name, "expected.required_tools was not provided.")

        called_tools = {tool.name for tool in run.tool_calls}
        missing = [tool for tool in required_tools if tool not in called_tools]
        if not missing:
            return _passed(
                self.name,
                "All required tools were called.",
                metadata={"required_tools": required_tools},
            )
        return _failed(
            self.name,
            "Required tools were not called.",
            metadata={"missing_tools": missing, "required_tools": required_tools},
        )


class ForbiddenTools:
    name = "forbidden_tools"
    requires_feedback = False

    def grade(self, case: EvalCase, run: EvalRun) -> GradeResult:
        forbidden_tools = case.expected.forbidden_tools
        if forbidden_tools is None:
            return _skipped(self.name, "expected.forbidden_tools was not provided.")

        called_tools = {tool.name for tool in run.tool_calls}
        used_forbidden = [tool for tool in forbidden_tools if tool in called_tools]
        if not used_forbidden:
            return _passed(
                self.name,
                "No forbidden tools were called.",
                metadata={"forbidden_tools": forbidden_tools},
            )
        return _failed(
            self.name,
            "Forbidden tools were called.",
            metadata={
                "forbidden_tools": forbidden_tools,
                "used_forbidden_tools": used_forbidden,
            },
        )


class ToolArgumentsMatch:
    name = "tool_arguments_match"
    requires_feedback = False

    def grade(self, case: EvalCase, run: EvalRun) -> GradeResult:
        expected_tool_arguments = case.expected.tool_arguments
        if expected_tool_arguments is None:
            return _skipped(self.name, "expected.tool_arguments was not provided.")

        mismatches: list[dict[str, Any]] = []
        for expected in expected_tool_arguments:
            matching_calls = [
                tool_call
                for tool_call in run.tool_calls
                if tool_call.name == expected.name
            ]
            if not matching_calls:
                mismatches.append(
                    {
                        "name": expected.name,
                        "expected_arguments": expected.arguments,
                        "reason": "Tool was not called.",
                    }
                )
                continue

            if not any(
                _tool_arguments_match(tool_call.arguments, expected.arguments)
                for tool_call in matching_calls
            ):
                mismatches.append(
                    {
                        "name": expected.name,
                        "expected_arguments": expected.arguments,
                        "actual_arguments": [
                            _parse_tool_arguments(tool_call.arguments)
                            for tool_call in matching_calls
                        ],
                        "reason": "Tool arguments did not match.",
                    }
                )

        if not mismatches:
            return _passed(
                self.name,
                "All expected tool arguments matched.",
                metadata={
                    "tool_arguments": [
                        expected.model_dump(mode="json")
                        for expected in expected_tool_arguments
                    ]
                },
            )
        return _failed(
            self.name,
            "Tool arguments did not match expected values.",
            metadata={"mismatches": mismatches},
        )


class ToolSequence:
    name = "tool_sequence"
    requires_feedback = False

    def grade(self, case: EvalCase, run: EvalRun) -> GradeResult:
        expected_sequence = case.expected.tool_sequence
        if expected_sequence is None:
            return _skipped(self.name, "expected.tool_sequence was not provided.")

        actual_sequence = [tool_call.name for tool_call in run.tool_calls]
        if actual_sequence == expected_sequence:
            return _passed(
                self.name,
                "Tool calls matched the expected sequence.",
                metadata={
                    "expected_sequence": expected_sequence,
                    "actual_sequence": actual_sequence,
                },
            )
        return _failed(
            self.name,
            "Tool calls did not match the expected sequence.",
            metadata={
                "expected_sequence": expected_sequence,
                "actual_sequence": actual_sequence,
            },
        )


class ToolOutputReferenced:
    name = "tool_output_referenced"
    requires_feedback = False
    threshold = 0.35

    def grade(self, case: EvalCase, run: EvalRun) -> GradeResult:
        required = case.expected.require_tool_output_reference
        if required is None:
            return _skipped(
                self.name,
                "expected.require_tool_output_reference was not provided.",
            )
        if required is False:
            return _skipped(self.name, "Tool output reference was not required.")
        if run.final_response is None:
            return _failed(self.name, "Final response was not found.")

        output_texts = [
            _content_to_text(tool_output.content)
            for tool_output in run.tool_outputs
            if tool_output.content is not None
        ]
        output_texts = [text for text in output_texts if text]
        if not output_texts:
            return _failed(
                self.name,
                "No tool outputs were available to reference.",
            )

        response_terms = _meaningful_terms(run.final_response)
        best_overlap = 0.0
        best_output = ""
        for output_text in output_texts:
            output_terms = _meaningful_terms(output_text)
            if not output_terms:
                continue
            overlap = len(response_terms & output_terms) / len(output_terms)
            if overlap > best_overlap:
                best_overlap = overlap
                best_output = output_text

        metadata = {
            "overlap": round(best_overlap, 4),
            "threshold": self.threshold,
            "best_output": best_output,
        }
        if best_overlap >= self.threshold:
            return _passed(
                self.name,
                "Final response referenced tool output.",
                score=best_overlap,
                threshold=self.threshold,
                evidence=[best_output],
                metadata=metadata,
            )
        return _failed(
            self.name,
            "Final response was not sufficiently grounded in tool output.",
            score=best_overlap,
            threshold=self.threshold,
            evidence=[best_output] if best_output else [],
            metadata=metadata,
        )


class Contains:
    name = "contains"
    requires_feedback = False

    def grade(self, case: EvalCase, run: EvalRun) -> GradeResult:
        phrases = case.expected.contains
        if phrases is None:
            return _skipped(self.name, "expected.contains was not provided.")
        if run.final_response is None:
            return _failed(self.name, "Final response was not found.")

        response = run.final_response.lower()
        missing = [phrase for phrase in phrases if phrase.lower() not in response]
        if not missing:
            return _passed(
                self.name,
                "Final response contained all required phrases.",
                metadata={"phrases": phrases},
            )
        return _failed(
            self.name,
            "Final response did not contain required phrases.",
            metadata={"missing_phrases": missing, "phrases": phrases},
        )


class NotContains:
    name = "not_contains"
    requires_feedback = False

    def grade(self, case: EvalCase, run: EvalRun) -> GradeResult:
        phrases = case.expected.not_contains
        if phrases is None:
            return _skipped(self.name, "expected.not_contains was not provided.")
        if run.final_response is None:
            return _failed(self.name, "Final response was not found.")

        response = run.final_response.lower()
        found = [phrase for phrase in phrases if phrase.lower() in response]
        if not found:
            return _passed(
                self.name,
                "Final response did not contain forbidden phrases.",
                metadata={"phrases": phrases},
            )
        return _failed(
            self.name,
            "Final response contained forbidden phrases.",
            metadata={"found_phrases": found, "phrases": phrases},
        )


class GroundTruthMatch:
    name = "ground_truth_match"
    requires_feedback = False

    def grade(self, case: EvalCase, run: EvalRun) -> GradeResult:
        ground_truth = case.expected.ground_truth
        if ground_truth is None:
            return _skipped(self.name, "expected.ground_truth was not provided.")
        if run.final_response is None:
            return _failed(self.name, "Final response was not found.")

        normalized_ground_truth = _normalize_text(ground_truth)
        normalized_response = _normalize_text(run.final_response)
        if normalized_ground_truth in normalized_response:
            return _passed(
                self.name,
                "Final response contained the ground truth.",
                metadata={"ground_truth": ground_truth},
            )
        return _failed(
            self.name,
            "Final response did not contain the ground truth.",
            metadata={"ground_truth": ground_truth},
        )


class LatencyUnder:
    name = "latency_under"
    requires_feedback = False

    def grade(self, case: EvalCase, run: EvalRun) -> GradeResult:
        del run
        max_ms = case.expected.max_latency_ms
        if max_ms is None:
            return _skipped(self.name, "expected.max_latency_ms was not provided.")

        latency_ms = case.metrics.latency_ms
        if latency_ms is None:
            return _failed(
                self.name,
                "metrics.latency_ms was not provided.",
                metadata={"limit_ms": max_ms},
            )
        if latency_ms <= max_ms:
            return _passed(
                self.name,
                f"Latency was {latency_ms}ms, limit was {max_ms}ms.",
                metadata={"actual_ms": latency_ms, "limit_ms": max_ms},
            )
        return _failed(
            self.name,
            f"Latency was {latency_ms}ms, limit was {max_ms}ms.",
            metadata={"actual_ms": latency_ms, "limit_ms": max_ms},
        )


class CostUnder:
    name = "cost_under"
    requires_feedback = False

    def grade(self, case: EvalCase, run: EvalRun) -> GradeResult:
        del run
        max_usd = case.expected.max_cost_usd
        if max_usd is None:
            return _skipped(self.name, "expected.max_cost_usd was not provided.")

        cost_usd = case.metrics.cost_usd
        if cost_usd is None:
            return _failed(
                self.name,
                "metrics.cost_usd was not provided.",
                metadata={"limit_usd": max_usd},
            )
        if cost_usd <= max_usd:
            return _passed(
                self.name,
                f"Cost was ${cost_usd}, limit was ${max_usd}.",
                metadata={"actual_usd": cost_usd, "limit_usd": max_usd},
            )
        return _failed(
            self.name,
            f"Cost was ${cost_usd}, limit was ${max_usd}.",
            metadata={"actual_usd": cost_usd, "limit_usd": max_usd},
        )


class RegexGrader:
    requires_feedback = False

    def __init__(
        self,
        name: str,
        pattern: str,
        *,
        target: str = "final_response",
        flags: list[str] | None = None,
    ) -> None:
        self.name = name
        self.pattern = pattern
        self.target = target
        self.flags = flags or []
        self._regex = re.compile(pattern, _regex_flags(self.flags))

    def grade(self, case: EvalCase, run: EvalRun) -> GradeResult:
        value = _judge_target_value(case, run, self.target)
        if value is None:
            return _failed(
                self.name,
                f"Regex target `{self.target}` was not found.",
                metadata={"target": self.target, "pattern": self.pattern},
            )

        text = value if isinstance(value, str) else _content_to_text(value)
        match = self._regex.search(text)
        return _normalize_custom_judge_result(
            self.name,
            match is not None,
            default_pass_reason="Regex matched the target.",
            default_fail_reason="Regex did not match the target.",
            metadata={
                "kind": "regex",
                "target": self.target,
                "pattern": self.pattern,
                "flags": self.flags,
                "match": match.group(0) if match else None,
            },
        )


class PythonCodeGrader:
    requires_feedback = False

    def __init__(
        self,
        name: str,
        code: str,
        *,
        timeout_ms: int = DEFAULT_CODE_JUDGE_TIMEOUT_MS,
    ) -> None:
        self.name = name
        self.code = code
        self.timeout_ms = _validated_timeout_ms(timeout_ms)

    def grade(self, case: EvalCase, run: EvalRun) -> GradeResult:
        return _run_code_judge(
            self.name,
            language="python",
            code=self.code,
            case=case,
            run=run,
            timeout_ms=self.timeout_ms,
        )


class TypeScriptCodeGrader:
    requires_feedback = False

    def __init__(
        self,
        name: str,
        code: str,
        *,
        timeout_ms: int = DEFAULT_CODE_JUDGE_TIMEOUT_MS,
    ) -> None:
        self.name = name
        self.code = code
        self.timeout_ms = _validated_timeout_ms(timeout_ms)

    def grade(self, case: EvalCase, run: EvalRun) -> GradeResult:
        return _run_code_judge(
            self.name,
            language="typescript",
            code=self.code,
            case=case,
            run=run,
            timeout_ms=self.timeout_ms,
        )


def _run_code_judge(
    name: str,
    *,
    language: str,
    code: str,
    case: EvalCase,
    run: EvalRun,
    timeout_ms: int,
) -> GradeResult:
    payload = {
        "output": run.final_response,
        "case": case.model_dump(mode="json"),
        "run": run.model_dump(mode="json"),
    }
    try:
        if language == "python":
            value = _run_python_validate(code, payload, timeout_ms)
        elif language == "typescript":
            value = _run_typescript_validate(code, payload, timeout_ms)
        else:
            raise ValueError(f"Unsupported code grader language: {language}")
    except subprocess.TimeoutExpired:
        return _failed(
            name,
            f"{language.title()} grader timed out after {timeout_ms}ms.",
            metadata={"kind": language, "timeout_ms": timeout_ms},
        )
    except Exception as exc:
        return _failed(
            name,
            f"{language.title()} grader raised {exc.__class__.__name__}: {exc}",
            metadata={
                "kind": language,
                "error_type": exc.__class__.__name__,
                "error_message": str(exc),
            },
        )

    return _normalize_custom_judge_result(
        name,
        value,
        default_pass_reason=f"{language.title()} grader returned pass.",
        default_fail_reason=f"{language.title()} grader returned fail.",
        metadata={"kind": language},
    )


def _run_python_validate(
    code: str,
    payload: dict[str, Any],
    timeout_ms: int,
) -> Any:
    runner = """
import importlib.util
import json
import sys

module_path = sys.argv[1]
spec = importlib.util.spec_from_file_location("northstar_user_grader", module_path)
module = importlib.util.module_from_spec(spec)
assert spec is not None and spec.loader is not None
spec.loader.exec_module(module)

validate = getattr(module, "validate", None)
if not callable(validate):
    raise TypeError("Python code must define callable validate(output, case, run).")

payload = json.load(sys.stdin)
result = validate(payload.get("output"), payload.get("case"), payload.get("run"))
sys.stdout.write(json.dumps(result, ensure_ascii=True, default=str))
"""
    with tempfile.TemporaryDirectory(prefix="northstar-python-grader-") as temp_dir:
        temp_path = Path(temp_dir)
        user_path = temp_path / "grader.py"
        runner_path = temp_path / "runner.py"
        user_path.write_text(code, encoding="utf-8")
        runner_path.write_text(runner, encoding="utf-8")
        command = ["uv", "run", "python", str(runner_path), str(user_path)]
        completed = subprocess.run(
            command,
            input=json.dumps(payload, ensure_ascii=True),
            capture_output=True,
            text=True,
            timeout=timeout_ms / 1000,
            check=False,
        )
    return _parse_worker_output(completed, "Python")


def _run_typescript_validate(
    code: str,
    payload: dict[str, Any],
    timeout_ms: int,
) -> Any:
    runner = r"""
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function loadTypescript() {
  const candidates = [
    process.env.NORTHSTAR_TYPESCRIPT_MODULE,
    path.join(process.cwd(), 'dashboard', 'node_modules', 'typescript'),
    'typescript',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {}
  }
  throw new Error('TypeScript package was not found.');
}

async function main() {
  const source = fs.readFileSync(process.argv[2], 'utf8');
  const ts = loadTypescript();
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;

  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    console: { log() {}, error() {}, warn() {} },
  };
  vm.runInNewContext(transpiled, context, { timeout: 1000 });

  const validate = module.exports.validate;
  if (typeof validate !== 'function') {
    throw new TypeError('TypeScript code must export validate(output, evalCase, run).');
  }

  const payload = JSON.parse(await readStdin());
  const result = await Promise.resolve(
    validate(payload.output, payload.case, payload.run)
  );
  process.stdout.write(JSON.stringify(result));
}

main().catch(error => {
  process.stderr.write(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
"""
    with tempfile.TemporaryDirectory(prefix="northstar-typescript-grader-") as temp_dir:
        temp_path = Path(temp_dir)
        user_path = temp_path / "grader.ts"
        runner_path = temp_path / "runner.cjs"
        user_path.write_text(code, encoding="utf-8")
        runner_path.write_text(runner, encoding="utf-8")
        completed = subprocess.run(
            ["node", str(runner_path), str(user_path)],
            input=json.dumps(payload, ensure_ascii=True),
            capture_output=True,
            text=True,
            timeout=timeout_ms / 1000,
            check=False,
        )
    return _parse_worker_output(completed, "TypeScript")


class RubricJudge:
    requires_feedback = True

    def __init__(
        self,
        name: str,
        model: str = DEFAULT_RUBRIC_JUDGE_MODEL,
        *,
        rubric: str | None = None,
        completion_fn: Callable[..., Any] | None = None,
        threshold: float = 0.5,
        temperature: float = 0.0,
        scoring: JudgeScoringConfig | None = None,
    ) -> None:
        self.name = name
        self.model = model
        self.rubric = rubric
        self.completion_fn = completion_fn
        self.scoring = scoring or JudgeScoringConfig(
            mode="numeric",
            min_score=0.0,
            max_score=1.0,
            passing_score=threshold,
        )
        self.threshold = _normalized_score(
            _required_passing_score(self.scoring),
            self.scoring,
        )
        self.temperature = temperature

    def grade(self, case: EvalCase, run: EvalRun) -> GradeResult:
        if (
            case.expected.goal is None
            and case.expected.rubric is None
            and self.rubric is None
        ):
            return _skipped(
                self.name,
                "expected.goal or expected.rubric was not provided.",
            )

        if self.completion_fn is None:
            _check_judge_prerequisites(self.model)

        response = self._completion(
            model=self.model,
            messages=self._messages(case, run),
            temperature=self.temperature,
            response_format=_judge_response_model(self.scoring),
        )
        content = _response_content(response)
        parsed = _validate_judge_response(content, self.scoring)
        return _judge_result_from_response(
            self.name,
            content,
            parsed,
            self.scoring,
            judge_model=self.model,
        )

    def _completion(self, **kwargs: Any) -> Any:
        if self.completion_fn is not None:
            return self.completion_fn(**kwargs)

        try:
            import litellm
        except ImportError as exc:
            raise ImportError(
                "LiteLLM is required to use RubricJudge. "
                'Install it with `uv add "northstar[evals]"`.'
            ) from exc

        return litellm.completion(**kwargs)

    def _messages(self, case: EvalCase, run: EvalRun) -> list[dict[str, str]]:
        context = {
            "goal": case.expected.goal,
            "rubric": self.rubric
            or case.expected.rubric
            or "Pass only if the final response satisfies the stated goal.",
            "ground_truth": case.expected.ground_truth,
            "final_response": run.final_response,
            "tool_calls": [
                tool_call.model_dump(mode="json") for tool_call in run.tool_calls
            ],
            "tool_outputs": [
                tool_output.model_dump(mode="json") for tool_output in run.tool_outputs
            ],
            "context": case.expected.context,
        }
        return [
            {
                "role": "system",
                "content": (
                    "You are a strict evaluator of AI agent responses. "
                    "Judge only the supplied final_response, rubric, goal, "
                    "ground_truth, context, tool_calls, and tool_outputs. "
                    "Do not reward unsupported claims or infer missing facts. "
                    "Return only a JSON object. "
                    f"{_scoring_prompt(self.scoring)} "
                    f"{_judge_output_prompt()}"
                ),
            },
            {
                "role": "user",
                "content": json.dumps(context, ensure_ascii=True, default=str),
            },
        ]


class FaithfulnessJudge(RubricJudge):
    def __init__(
        self,
        name: str = "faithfulness_judge",
        model: str = DEFAULT_RUBRIC_JUDGE_MODEL,
        *,
        completion_fn: Callable[..., Any] | None = None,
        threshold: float = 0.7,
        temperature: float = 0.0,
        scoring: JudgeScoringConfig | None = None,
    ) -> None:
        super().__init__(
            name,
            model,
            completion_fn=completion_fn,
            threshold=threshold,
            temperature=temperature,
            scoring=scoring,
        )

    def grade(self, case: EvalCase, run: EvalRun) -> GradeResult:
        if not case.expected.context and not run.tool_outputs:
            return _skipped(
                self.name,
                "expected.context or tool outputs were not provided.",
            )
        if self.completion_fn is None:
            _check_judge_prerequisites(self.model)
        response = self._completion(
            model=self.model,
            messages=self._messages(case, run),
            temperature=self.temperature,
            response_format=_judge_response_model(self.scoring),
        )
        content = _response_content(response)
        parsed = _validate_judge_response(content, self.scoring)
        return _judge_result_from_response(
            self.name,
            content,
            parsed,
            self.scoring,
            judge_model=self.model,
        )

    def _messages(self, case: EvalCase, run: EvalRun) -> list[dict[str, str]]:
        context = {
            "task": "Grade whether the final response is faithful to the provided context and tool outputs. Penalize unsupported claims.",
            "goal": case.expected.goal,
            "ground_truth": case.expected.ground_truth,
            "final_response": run.final_response,
            "context": case.expected.context,
            "tool_outputs": [
                tool_output.model_dump(mode="json") for tool_output in run.tool_outputs
            ],
        }
        return [
            {
                "role": "system",
                "content": (
                    "You are a strict faithfulness evaluator of AI agent responses. "
                    "Judge only whether final_response is supported by the "
                    "supplied context, ground_truth, and tool_outputs. Treat "
                    "claims that are not supported by those sources as failures, "
                    "even when they sound plausible. Return only a JSON object. "
                    f"{_scoring_prompt(self.scoring)} "
                    f"{_judge_output_prompt()}"
                ),
            },
            {
                "role": "user",
                "content": json.dumps(context, ensure_ascii=True, default=str),
            },
        ]


class BadToolFailureRecovery:
    name = "bad_tool_failure_recovery"
    requires_feedback = False

    def grade(self, case: EvalCase, run: EvalRun) -> GradeResult:
        del case
        if run.trace is None:
            return _skipped(self.name, "Trace DAG was not provided.")

        failed_tools = [
            span for span in run.trace.spans if _is_tool_span(span) and _has_error(span)
        ]
        if not failed_tools:
            return _skipped(self.name, "Trace did not contain failed tool spans.")

        bad_recoveries: list[dict[str, Any]] = []
        for span in failed_tools:
            later_events = _events_after_span(run.trace, span)
            has_recovery = any(
                event.type in {"assistant_message", "reasoning", "final_response"}
                for event in later_events
            )
            if not has_recovery:
                bad_recoveries.append(
                    {
                        "span_id": span.id,
                        "tool": span.name,
                        "error": span.error,
                    }
                )

        if not bad_recoveries:
            return _passed(
                self.name,
                "Every failed tool span had subsequent recovery evidence.",
                metadata={"failed_tool_count": len(failed_tools)},
            )
        return _failed(
            self.name,
            "A failed tool span was not followed by recovery evidence.",
            metadata={"failed_tools": bad_recoveries},
        )


class UnnecessaryToolLoop:
    name = "unnecessary_tool_loop"
    requires_feedback = False

    def grade(self, case: EvalCase, run: EvalRun) -> GradeResult:
        if run.trace is None:
            return _skipped(self.name, "Trace DAG was not provided.")
        max_repeats = (
            case.expected.trace.max_repeated_tool_calls
            if case.expected.trace is not None
            else 3
        ) or 3
        tool_events = [
            event
            for event in run.trace.events
            if event.type == "tool_arguments" and event.span_id is not None
        ]
        if len(tool_events) < 2:
            return _skipped(self.name, "Trace did not contain repeated tool calls.")

        spans_by_id = {span.id: span for span in run.trace.spans}
        signatures: dict[str, list[str]] = {}
        for event in tool_events:
            span = spans_by_id.get(event.span_id or "")
            if span is None:
                continue
            signature = _tool_signature(span.name, event.content)
            signatures.setdefault(signature, []).append(event.id)

        loops = [
            {"signature": signature, "event_ids": ids, "count": len(ids)}
            for signature, ids in signatures.items()
            if len(ids) > max_repeats
        ]
        if not loops:
            return _passed(
                self.name,
                "No repeated tool signature exceeded the loop threshold.",
                metadata={"max_repeated_tool_calls": max_repeats},
            )
        return _failed(
            self.name,
            "A tool call signature repeated beyond the loop threshold.",
            metadata={"max_repeated_tool_calls": max_repeats, "loop_signatures": loops},
        )


class StaleContextUsage:
    name = "stale_context_usage"
    requires_feedback = False

    def grade(self, case: EvalCase, run: EvalRun) -> GradeResult:
        del case
        if run.trace is None:
            return _skipped(self.name, "Trace DAG was not provided.")

        stale_events = [
            event
            for event in run.trace.events
            if _truthy_attr(event.attributes, "stale")
            or _truthy_attr(event.attributes, "stale_context")
            or _truthy_attr(event.attributes, "used_stale_context")
        ]
        if not stale_events:
            has_context_events = any(
                event.type in {"reasoning", "assistant_message", "final_response"}
                for event in run.trace.events
            )
            if not has_context_events:
                return _skipped(self.name, "Trace did not contain context-use events.")
            return _passed(self.name, "No stale context markers were found.")
        return _failed(
            self.name,
            "Trace contained stale context usage markers.",
            metadata={
                "event_ids": [event.id for event in stale_events],
                "span_ids": [event.span_id for event in stale_events if event.span_id],
            },
        )


class InvalidStateTransition:
    name = "invalid_state_transition"
    requires_feedback = False

    def grade(self, case: EvalCase, run: EvalRun) -> GradeResult:
        if run.trace is None:
            return _skipped(self.name, "Trace DAG was not provided.")
        expected = case.expected.trace
        if expected is None or expected.allowed_state_transitions is None:
            return _skipped(
                self.name,
                "expected.trace.allowed_state_transitions was not provided.",
            )

        allowed = {
            (transition.from_state, transition.to_state)
            for transition in expected.allowed_state_transitions
        }
        states = [
            str(state)
            for event in run.trace.events
            for state in [_event_state(event)]
            if state is not None
        ]
        if len(states) < 2:
            return _skipped(self.name, "Trace did not contain state transition events.")

        invalid = [
            {"from_state": before, "to_state": after}
            for before, after in zip(states, states[1:], strict=False)
            if (before, after) not in allowed
        ]
        if not invalid:
            return _passed(
                self.name,
                "All observed state transitions were allowed.",
                metadata={"states": states},
            )
        return _failed(
            self.name,
            "Trace contained invalid state transitions.",
            metadata={"states": states, "invalid_transitions": invalid},
        )


class RetrievalPrecisionRecall:
    name = "retrieval_precision_recall"
    requires_feedback = False

    def grade(self, case: EvalCase, run: EvalRun) -> GradeResult:
        if run.trace is None:
            return _skipped(self.name, "Trace DAG was not provided.")
        expected = case.expected.trace
        if (
            expected is None
            or expected.relevant_retrieval_ids is None
            or (
                expected.min_retrieval_precision is None
                and expected.min_retrieval_recall is None
            )
        ):
            return _skipped(
                self.name,
                "expected.trace retrieval ids and thresholds were not provided.",
            )

        retrieved = _retrieved_ids(run.trace.events)
        if not retrieved:
            return _skipped(self.name, "Trace did not contain retrieval result ids.")

        relevant = set(expected.relevant_retrieval_ids)
        retrieved_set = set(retrieved)
        true_positives = retrieved_set & relevant
        precision = len(true_positives) / len(retrieved_set)
        recall = len(true_positives) / len(relevant) if relevant else 1.0
        precision_threshold = expected.min_retrieval_precision
        recall_threshold = expected.min_retrieval_recall
        passed = (
            (precision_threshold is None or precision >= precision_threshold)
            and (recall_threshold is None or recall >= recall_threshold)
        )
        metadata = {
            "retrieved_ids": sorted(retrieved_set),
            "relevant_ids": sorted(relevant),
            "true_positive_ids": sorted(true_positives),
            "retrieved_count": len(retrieved_set),
            "relevant_count": len(relevant),
            "true_positive_count": len(true_positives),
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "min_precision": precision_threshold,
            "min_recall": recall_threshold,
        }
        if passed:
            return _passed(
                self.name,
                "Retrieval precision/recall met configured thresholds.",
                score=min(precision, recall),
                threshold=max(precision_threshold or 0, recall_threshold or 0),
                metadata=metadata,
            )
        return _failed(
            self.name,
            "Retrieval precision/recall missed configured thresholds.",
            score=min(precision, recall),
            threshold=max(precision_threshold or 0, recall_threshold or 0),
            metadata=metadata,
        )


class StepCostAttribution:
    name = "step_cost_attribution"
    requires_feedback = False

    def grade(self, case: EvalCase, run: EvalRun) -> GradeResult:
        if run.trace is None:
            return _skipped(self.name, "Trace DAG was not provided.")
        costs = [
            {
                "span_id": span.id,
                "span_name": span.name,
                "kind": span.kind,
                "cost_usd": float(span.attributes["cost_usd"]),
                "input_tokens": span.attributes.get("input_tokens"),
                "output_tokens": span.attributes.get("output_tokens"),
                "total_tokens": span.attributes.get("total_tokens"),
            }
            for span in run.trace.spans
            if _number_attr(span.attributes, "cost_usd") is not None
        ]
        if not costs:
            return _skipped(self.name, "Trace did not contain span cost attributes.")

        total_cost = sum(step["cost_usd"] for step in costs)
        limit = (
            case.expected.trace.max_step_cost_usd
            if case.expected.trace is not None
            else None
        )
        over_limit = [
            step for step in costs if limit is not None and step["cost_usd"] > limit
        ]
        metadata = {
            "step_costs": costs,
            "total_cost_usd": round(total_cost, 8),
            "max_step_cost_usd": limit,
        }
        if over_limit:
            return _failed(
                self.name,
                "One or more trace steps exceeded the configured cost limit.",
                metadata={**metadata, "over_limit": over_limit},
            )
        return _passed(
            self.name,
            "Trace included per-step cost attribution.",
            metadata=metadata,
        )


class FailureOrigin:
    name = "failure_origin"
    requires_feedback = False

    def grade(self, case: EvalCase, run: EvalRun) -> GradeResult:
        del case
        if run.trace is None:
            return _skipped(self.name, "Trace DAG was not provided.")

        failed_spans = [span for span in run.trace.spans if _has_error(span)]
        failed_events = [
            event
            for event in run.trace.events
            if _truthy_attr(event.attributes, "error") or _truthy_attr(event.attributes, "failed")
        ]
        if not failed_spans and not failed_events and not run.trace.run.error:
            return _skipped(self.name, "Trace did not contain failure evidence.")

        origin_span = min(
            failed_spans,
            key=lambda span: span.started_at or "",
            default=None,
        )
        metadata: dict[str, Any] = {
            "failure_origin_span": origin_span.model_dump(mode="json")
            if origin_span is not None
            else None,
            "failing_span_ids": [span.id for span in failed_spans],
            "failing_event_ids": [event.id for event in failed_events],
            "run_error": run.trace.run.error,
        }
        return _failed(
            self.name,
            "Failure evidence begins at the reported span/event.",
            metadata=metadata,
            evidence=[
                f"{origin_span.name} ({origin_span.id})"
                if origin_span is not None
                else "run_error"
            ],
        )


class _TraceJudge(RubricJudge):
    task = ""

    def grade(self, case: EvalCase, run: EvalRun) -> GradeResult:
        if run.trace is None:
            return _skipped(self.name, "Trace DAG was not provided.")
        if self.completion_fn is None:
            _check_judge_prerequisites(self.model)
        response = self._completion(
            model=self.model,
            messages=self._messages(case, run),
            temperature=self.temperature,
            response_format=_judge_response_model(self.scoring),
        )
        content = _response_content(response)
        parsed = _validate_judge_response(content, self.scoring)
        result = _judge_result_from_response(
            self.name,
            content,
            parsed,
            self.scoring,
            judge_model=self.model,
        )
        result.metadata["trace_context_span_count"] = len(run.trace.spans)
        result.metadata["trace_context_event_count"] = min(len(run.trace.events), 40)
        return result

    def _messages(self, case: EvalCase, run: EvalRun) -> list[dict[str, str]]:
        assert run.trace is not None
        context = {
            "task": self.task,
            "goal": case.expected.goal,
            "final_response": run.final_response,
            "trace": _bounded_trace_context(run.trace),
        }
        return [
            {
                "role": "system",
                "content": (
                    "You are a strict evaluator of AI agent trace evidence. "
                    "Judge only the supplied trace spans, ordered events, tool "
                    "inputs/outputs, and final_response. Do not infer unavailable "
                    "facts. Return only a JSON object. "
                    f"{_scoring_prompt(self.scoring)} "
                    f"{_judge_output_prompt()}"
                ),
            },
            {
                "role": "user",
                "content": json.dumps(context, ensure_ascii=True, default=str),
            },
        ]


class HallucinatedToolResultJudge(_TraceJudge):
    task = "Pass only if final_response claims are supported by observed tool_result events."

    def __init__(
        self,
        name: str = "hallucinated_tool_result_judge",
        model: str = DEFAULT_RUBRIC_JUDGE_MODEL,
        *,
        completion_fn: Callable[..., Any] | None = None,
        threshold: float = 0.7,
        temperature: float = 0.0,
        scoring: JudgeScoringConfig | None = None,
    ) -> None:
        super().__init__(
            name,
            model,
            completion_fn=completion_fn,
            threshold=threshold,
            temperature=temperature,
            scoring=scoring,
        )


class PlanningActionMismatchJudge(_TraceJudge):
    task = "Pass only if later tool/action events are consistent with stated planning or reasoning events."

    def __init__(
        self,
        name: str = "planning_action_mismatch_judge",
        model: str = DEFAULT_RUBRIC_JUDGE_MODEL,
        *,
        completion_fn: Callable[..., Any] | None = None,
        threshold: float = 0.7,
        temperature: float = 0.0,
        scoring: JudgeScoringConfig | None = None,
    ) -> None:
        super().__init__(
            name,
            model,
            completion_fn=completion_fn,
            threshold=threshold,
            temperature=temperature,
            scoring=scoring,
        )


def trace_graders(
    *,
    completion_fn: Callable[..., Any] | None = None,
    judge_model: str = DEFAULT_RUBRIC_JUDGE_MODEL,
) -> list[Grader]:
    return [
        BadToolFailureRecovery(),
        UnnecessaryToolLoop(),
        StaleContextUsage(),
        InvalidStateTransition(),
        RetrievalPrecisionRecall(),
        StepCostAttribution(),
        FailureOrigin(),
        HallucinatedToolResultJudge(model=judge_model, completion_fn=completion_fn),
        PlanningActionMismatchJudge(model=judge_model, completion_fn=completion_fn),
    ]


def default_graders() -> list[Grader]:
    return [
        MaxToolCalls(),
        RequiredTools(),
        ForbiddenTools(),
        ToolArgumentsMatch(),
        ToolSequence(),
        ToolOutputReferenced(),
        Contains(),
        NotContains(),
        GroundTruthMatch(),
        LatencyUnder(),
        CostUnder(),
    ]


def grader_plan(
    name: str,
    *,
    completion_fn: Callable[..., Any] | None = None,
    judge_model: str = DEFAULT_RUBRIC_JUDGE_MODEL,
) -> list[Grader]:
    if name == "deterministic":
        return default_graders()
    if name == "quality":
        return [
            *default_graders(),
            RubricJudge(
                "rubric_judge",
                model=judge_model,
                completion_fn=completion_fn,
            ),
        ]
    if name == "agentic":
        return [
            *default_graders(),
            FaithfulnessJudge(
                model=judge_model,
                completion_fn=completion_fn,
            ),
        ]
    if name == "trace":
        return trace_graders(completion_fn=completion_fn, judge_model=judge_model)
    raise ValueError(
        "Unknown grader plan. Use 'deterministic', 'quality', 'agentic', or 'trace'."
    )


class EvalSuite:
    def __init__(
        self,
        graders: list[Grader] | None = None,
        *,
        plan: str = "deterministic",
        metadata: dict[str, Any] | None = None,
    ) -> None:
        self.plan = plan
        self.graders = grader_plan(plan) if graders is None else list(graders)
        self.metadata = metadata or {}

    def run(self, dataset: Any) -> EvalResult:
        case_results: list[CaseResult] = []

        for case in dataset:
            trace = _normalize_case_trace(case)
            run = normalize_messages(
                case.messages,
                trace=trace,
                metrics=case.metrics,
                metadata=case.metadata,
            )
            grades = [self._grade(grader, case, run) for grader in self.graders]
            case_results.append(
                CaseResult(
                    case_id=case.id,
                    status=_case_status(grades),
                    grades=grades,
                )
            )

        evaluated_cases = [
            result
            for result in case_results
            if result.status != CaseStatus.NOT_EVALUATED
        ]
        passed_cases = [
            result for result in case_results if result.status == CaseStatus.PASSED
        ]
        failed_cases = [
            result for result in case_results if result.status == CaseStatus.FAILED
        ]
        skipped_grades = sum(
            1
            for result in case_results
            for grade in result.grades
            if grade.status == GradeStatus.SKIPPED
        )

        return EvalResult(
            metadata={
                "plan": self.plan,
                "grader_names": [grader.name for grader in self.graders],
                "created_at": datetime.now(UTC).isoformat(),
                **self.metadata,
            },
            total_cases=len(case_results),
            evaluated_cases=len(evaluated_cases),
            not_evaluated_cases=len(case_results) - len(evaluated_cases),
            passed_cases=len(passed_cases),
            failed_cases=len(failed_cases),
            pass_rate=(
                len(passed_cases) / len(evaluated_cases) if evaluated_cases else 0.0
            ),
            skipped_grades=skipped_grades,
            case_results=case_results,
        )

    def _grade(self, grader: Grader, case: EvalCase, run: EvalRun) -> GradeResult:
        try:
            return grader.grade(case, run)
        except Exception as exc:
            name = getattr(grader, "name", grader.__class__.__name__)
            model = getattr(grader, "model", None)
            requires_feedback = getattr(grader, "requires_feedback", False)
            if model and requires_feedback:
                reason, feedback = _judge_failure_message(exc, model)
            else:
                reason = f"Grader raised {exc.__class__.__name__}: {exc}"
                feedback = (
                    "The LLM judge errored before producing feedback."
                    if requires_feedback
                    else None
                )
            metadata: dict[str, Any] = {
                "error_type": exc.__class__.__name__,
                "error_message": str(exc),
            }
            if model:
                metadata["judge_model"] = model
            return _failed(name, reason, feedback=feedback, metadata=metadata)


def _case_status(grades: list[GradeResult]) -> CaseStatus:
    evaluated_grades = [grade for grade in grades if grade.status != GradeStatus.SKIPPED]
    if not evaluated_grades:
        return CaseStatus.NOT_EVALUATED
    if any(grade.status == GradeStatus.FAILED for grade in evaluated_grades):
        return CaseStatus.FAILED
    return CaseStatus.PASSED


def _normalize_case_trace(case: EvalCase) -> EvalTraceDag | None:
    trace_payload = case.trace
    if trace_payload is None and isinstance(case.input, dict):
        raw_trace = case.input.get("trace")
        if isinstance(raw_trace, dict):
            trace_payload = raw_trace
    if trace_payload is None:
        return None

    run_id = _trace_run_id(trace_payload)
    if run_id is None:
        return None
    return normalize_trace_payload(trace_payload, run_id)


def _trace_run_id(payload: dict[str, Any]) -> str | None:
    run_id = payload.get("run_id")
    if run_id is not None:
        return str(run_id)

    runs = payload.get("runs")
    if isinstance(runs, list) and runs:
        first = runs[0]
        if isinstance(first, dict) and first.get("id") is not None:
            return str(first["id"])
    return None


def _is_tool_span(span: EvalTraceSpan) -> bool:
    return span.kind == "tool"


def _has_error(span: EvalTraceSpan) -> bool:
    return span.status == "error" or span.error is not None


def _events_after_span(trace: EvalTraceDag, span: EvalTraceSpan) -> list[EvalTraceEvent]:
    span_events = [event for event in trace.events if event.span_id == span.id]
    if span_events:
        last_order = max(event.order for event in span_events)
        return [event for event in trace.events if event.order > last_order]
    if span.started_at is None:
        return []
    return [
        event
        for event in trace.events
        if event.created_at is not None and event.created_at > span.started_at
    ]


def _tool_signature(name: str, content: Any) -> str:
    return json.dumps(
        {"name": name, "arguments": _canonical_tool_arguments(content)},
        ensure_ascii=True,
        sort_keys=True,
        default=str,
    )


def _canonical_tool_arguments(content: Any) -> Any:
    if isinstance(content, dict):
        if "arguments" in content:
            return _parse_tool_arguments(content["arguments"])
        if "kwargs" in content:
            return content["kwargs"]
    return content


def _truthy_attr(attributes: dict[str, Any], key: str) -> bool:
    value = attributes.get(key)
    if isinstance(value, str):
        return value.lower() in {"1", "true", "yes", "error", "failed"}
    return bool(value)


def _event_state(event: EvalTraceEvent) -> str | None:
    for source in (event.attributes, event.content if isinstance(event.content, dict) else {}):
        state = source.get("state") or source.get("to_state")
        if state is not None:
            return str(state)
    return None


def _retrieved_ids(events: list[EvalTraceEvent]) -> list[str]:
    ids: list[str] = []
    for event in events:
        if event.type != "tool_result":
            continue
        ids.extend(_ids_from_retrieval_content(event.content))
    return ids


def _ids_from_retrieval_content(content: Any) -> list[str]:
    if isinstance(content, list):
        return [
            str(item["id"])
            for item in content
            if isinstance(item, dict) and item.get("id") is not None
        ]
    if not isinstance(content, dict):
        return []

    for key in ("retrieved_ids", "document_ids", "ids"):
        value = content.get(key)
        if isinstance(value, list):
            return [str(item) for item in value]

    for key in ("hits", "documents", "results"):
        value = content.get(key)
        if isinstance(value, list):
            return [
                str(item["id"])
                for item in value
                if isinstance(item, dict) and item.get("id") is not None
            ]
    return []


def _number_attr(attributes: dict[str, Any], key: str) -> float | None:
    value = attributes.get(key)
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int | float):
        return float(value)
    return None


def _bounded_trace_context(trace: EvalTraceDag) -> dict[str, Any]:
    spans = [
        {
            "id": span.id,
            "parent_span_id": span.parent_span_id,
            "kind": span.kind,
            "name": span.name,
            "status": span.status,
            "error": span.error,
            "attributes": _bounded_json(span.attributes, max_chars=1000),
        }
        for span in trace.spans[:80]
    ]
    events = [
        {
            "id": event.id,
            "span_id": event.span_id,
            "type": event.type,
            "order": event.order,
            "content": _bounded_json(event.content, max_chars=1500),
            "attributes": _bounded_json(event.attributes, max_chars=800),
        }
        for event in trace.events[:40]
    ]
    return {"run": trace.run.model_dump(mode="json"), "spans": spans, "events": events}


def _bounded_json(value: Any, *, max_chars: int) -> Any:
    text = _content_to_text(value)
    if len(text) <= max_chars:
        return value
    return text[:max_chars] + "...[truncated]"


def _response_content(response: Any) -> str:
    if isinstance(response, dict):
        return str(response["choices"][0]["message"]["content"])

    choice = response.choices[0]
    message = choice.message
    content = message["content"] if isinstance(message, dict) else message.content
    return str(content)


def _parse_json_object(content: str) -> dict[str, Any] | None:
    stripped = _strip_markdown_fence(content)
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


_ANSI_ESCAPE_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")


def _strip_markdown_fence(content: str) -> str:
    stripped = _ANSI_ESCAPE_RE.sub("", content).strip()
    if not stripped.startswith("```"):
        return stripped
    lines = stripped.splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].startswith("```"):
        lines = lines[:-1]
    return "\n".join(lines).strip()


def _judge_response_model(scoring: JudgeScoringConfig) -> type[BaseModel]:
    if scoring.mode == "binary":
        return BinaryJudgeOutput
    return numeric_judge_output_model(scoring.min_score, scoring.max_score)


def _validate_judge_response(
    content: str, scoring: JudgeScoringConfig
) -> BaseModel | None:
    model = _judge_response_model(scoring)
    candidates = _extract_json_candidates(content)
    for candidate in candidates:
        try:
            return model.model_validate_json(candidate)
        except ValidationError:
            continue
    return None


def _extract_json_candidates(content: str) -> list[str]:
    stripped = _strip_markdown_fence(content)
    if not stripped:
        return []
    candidates: list[str] = [stripped]
    decoder = json.JSONDecoder()
    for index, char in enumerate(stripped):
        if char != "{":
            continue
        try:
            obj, end = decoder.raw_decode(stripped[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            candidates.append(stripped[index : index + end])
    return candidates


def _content_to_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    return json.dumps(content, ensure_ascii=True, sort_keys=True, default=str)


def _parse_worker_output(
    completed: subprocess.CompletedProcess[str],
    language: str,
) -> Any:
    if len(completed.stdout.encode("utf-8")) > MAX_CODE_JUDGE_OUTPUT_BYTES:
        raise ValueError(
            f"{language} grader output exceeded {MAX_CODE_JUDGE_OUTPUT_BYTES} bytes."
        )

    if completed.returncode != 0:
        stderr = completed.stderr.strip()
        raise RuntimeError(stderr or f"{language} grader exited with code {completed.returncode}.")

    output = completed.stdout.strip()
    if not output:
        return None

    try:
        return json.loads(output)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{language} grader returned invalid JSON.") from exc


def _normalize_custom_judge_result(
    name: str,
    value: Any,
    *,
    default_pass_reason: str,
    default_fail_reason: str,
    metadata: dict[str, Any],
) -> GradeResult:
    if isinstance(value, bool):
        if value:
            return _passed(name, default_pass_reason, metadata=metadata)
        return _failed(name, default_fail_reason, metadata=metadata)

    if not isinstance(value, dict) or not isinstance(value.get("passed"), bool):
        return _failed(
            name,
            "Custom grader returned an invalid result.",
            metadata={**metadata, "result": value},
        )

    passed = value["passed"]
    reason = _optional_non_empty_string(value.get("reason")) or (
        default_pass_reason if passed else default_fail_reason
    )
    feedback = value.get("feedback")
    if feedback is not None and not isinstance(feedback, str):
        return _failed(
            name,
            "Custom grader returned an invalid feedback value.",
            metadata={**metadata, "result": value},
        )

    score = _optional_float(value.get("score"))
    result_metadata = value.get("metadata")
    if result_metadata is not None and not isinstance(result_metadata, dict):
        return _failed(
            name,
            "Custom grader returned invalid metadata.",
            metadata={**metadata, "result": value},
        )

    result_kwargs = {
        "feedback": feedback,
        "score": score if score is not None else (1.0 if passed else 0.0),
        "threshold": 1.0,
        "label": "pass" if passed else "fail",
        "metadata": {
            **metadata,
            **(result_metadata or {}),
        },
    }
    if passed:
        return _passed(name, reason, **result_kwargs)
    return _failed(name, reason, **result_kwargs)


def _optional_non_empty_string(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _validated_timeout_ms(timeout_ms: int) -> int:
    if isinstance(timeout_ms, bool) or not isinstance(timeout_ms, int):
        raise TypeError("timeout_ms must be an integer.")
    if timeout_ms <= 0 or timeout_ms > MAX_CODE_JUDGE_TIMEOUT_MS:
        raise ValueError(
            f"timeout_ms must be between 1 and {MAX_CODE_JUDGE_TIMEOUT_MS}."
        )
    return timeout_ms


def _regex_flags(flags: list[str]) -> int:
    flag_map = {
        "ignorecase": re.IGNORECASE,
        "multiline": re.MULTILINE,
        "dotall": re.DOTALL,
    }
    compiled = 0
    for flag in flags:
        normalized = flag.lower()
        if normalized not in flag_map:
            raise ValueError(
                "Unsupported regex flag. Use ignorecase, multiline, or dotall."
            )
        compiled |= flag_map[normalized]
    return compiled


def _judge_target_value(case: EvalCase, run: EvalRun, target: str) -> Any:
    if target in ("output", "final_response"):
        return run.final_response
    if target.startswith("case."):
        return _dotted_value(case.model_dump(mode="json"), target.removeprefix("case."))
    if target.startswith("run."):
        return _dotted_value(run.model_dump(mode="json"), target.removeprefix("run."))
    return None


def _dotted_value(value: Any, path: str) -> Any:
    current = value
    for part in path.split("."):
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current


def _normalize_text(value: str) -> str:
    return " ".join(value.lower().split())


def _meaningful_terms(value: str) -> set[str]:
    stop_words = {
        "a",
        "an",
        "and",
        "are",
        "as",
        "at",
        "be",
        "for",
        "from",
        "in",
        "is",
        "it",
        "of",
        "on",
        "or",
        "so",
        "the",
        "to",
        "with",
    }
    terms = {
        token.strip(".,:;!?()[]{}\"'").lower()
        for token in value.split()
    }
    return {term for term in terms if len(term) > 2 and term not in stop_words}


def _tool_arguments_match(
    actual_arguments: Any,
    expected_arguments: dict[str, Any],
) -> bool:
    actual = _parse_tool_arguments(actual_arguments)
    return isinstance(actual, dict) and _dict_contains_subset(
        actual,
        expected_arguments,
    )


def _parse_tool_arguments(arguments: Any) -> Any:
    if isinstance(arguments, str):
        try:
            return json.loads(arguments)
        except json.JSONDecodeError:
            return arguments
    return arguments


def _dict_contains_subset(actual: dict[str, Any], expected: dict[str, Any]) -> bool:
    for key, expected_value in expected.items():
        if key not in actual:
            return False
        actual_value = actual[key]
        if isinstance(expected_value, dict):
            if not isinstance(actual_value, dict):
                return False
            if not _dict_contains_subset(actual_value, expected_value):
                return False
        elif actual_value != expected_value:
            return False
    return True


def _scoring_prompt(scoring: JudgeScoringConfig) -> str:
    if scoring.mode == "binary":
        return (
            "Return `passed` as a boolean, optional `label` as pass/fail, "
            "and do not include a numeric score. Set `passed` to true only "
            "when the response satisfies every required criterion."
        )
    passing_score = _required_passing_score(scoring)
    return (
        f"Return `score` as a number from {scoring.min_score:g} to "
        f"{scoring.max_score:g}. NorthStar will pass the grade only when "
        f"`score` is at least {passing_score:g}; do not decide pass/fail. "
        "Use the full scale: low scores for missing, unsupported, or harmful "
        "answers; high scores only for complete, well-supported answers."
    )


def _judge_output_prompt() -> str:
    return (
        "`reason` must briefly justify the score or pass/fail decision. "
        "`feedback` must be non-empty, actionable, and tell the answer author "
        "what to fix; use a concise positive note only when nothing needs fixing. "
        "Optional `confidence` must be from 0 to 1. Optional `evidence` must be "
        "a list of short strings copied or summarized from the supplied inputs."
    )


def _judge_result_from_response(
    name: str,
    content: str,
    parsed: BaseModel | None,
    scoring: JudgeScoringConfig,
    *,
    judge_model: str,
) -> GradeResult:
    if parsed is None:
        return _invalid_judge_result(name, content)

    confidence = _optional_float(getattr(parsed, "confidence", None))
    evidence = _string_items(getattr(parsed, "evidence", []))

    if scoring.mode == "binary":
        passed = bool(parsed.passed)
        raw_score = scoring.max_score if passed else scoring.min_score
        score = 1.0 if passed else 0.0
        label = str(getattr(parsed, "label", None) or ("pass" if passed else "fail"))
    else:
        passing_score = _required_passing_score(scoring)
        raw_score = float(parsed.score)
        score = _normalized_score(raw_score, scoring)
        passed = raw_score >= passing_score
        label = (
            _score_label(raw_score, scoring)
            or getattr(parsed, "label", None)
            or ("pass" if passed else "fail")
        )

    passing_score = _required_passing_score(scoring)
    return GradeResult(
        name=name,
        status=GradeStatus.PASSED if passed else GradeStatus.FAILED,
        reason=parsed.reason.strip(),
        feedback=parsed.feedback.strip(),
        score=score,
        threshold=_normalized_score(passing_score, scoring),
        label=label,
        confidence=confidence,
        evidence=evidence,
        metadata={
            "judge_model": judge_model,
            "scoring_mode": scoring.mode,
            "raw_score": raw_score,
            "passing_score": passing_score,
            "scale": [scoring.min_score, scoring.max_score],
        },
    )


def _normalized_score(value: float | None, scoring: JudgeScoringConfig) -> float:
    if value is None:
        return 0.0
    return (value - scoring.min_score) / (scoring.max_score - scoring.min_score)


def _required_passing_score(scoring: JudgeScoringConfig) -> float:
    if scoring.passing_score is None:
        raise ValueError("passing_score is required for judge scoring")
    return scoring.passing_score


def _score_label(score: float, scoring: JudgeScoringConfig) -> str | None:
    if scoring.labels is None:
        return None
    return scoring.labels.get(score)


def _optional_float(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int | float):
        return float(value)
    return None


def _string_items(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str)]


def _invalid_judge_result(name: str, content: str) -> GradeResult:
    return _failed(
        name,
        "LLM judge returned invalid JSON.",
        feedback="The judge response did not include valid pass/fail feedback.",
        metadata={"raw_response": content},
    )
