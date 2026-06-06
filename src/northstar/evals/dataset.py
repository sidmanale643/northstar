from __future__ import annotations

import json
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from .models import EvalCase, EvalModel


class Dataset(EvalModel):
    cases: list[EvalCase]

    @classmethod
    def from_path(cls, path: str | Path) -> Dataset:
        dataset_path = Path(path)
        suffix = dataset_path.suffix.lower()
        if suffix == ".jsonl":
            return cls.from_jsonl(dataset_path)
        if suffix == ".json":
            return cls.from_json(dataset_path)
        raise ValueError(
            "Unsupported eval dataset format. Use JSON or JSONL.",
        )

    @classmethod
    def from_json(cls, path: str | Path) -> Dataset:
        dataset_path = Path(path)

        try:
            with dataset_path.open(encoding="utf-8") as file:
                payload = json.load(file)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid JSON dataset: {exc.msg}") from exc

        if isinstance(payload, list):
            records = payload
        elif isinstance(payload, dict) and "cases" in payload:
            records = payload["cases"]
            if not isinstance(records, list):
                raise ValueError("Invalid JSON dataset: cases must be a list.")
        elif isinstance(payload, dict):
            records = [payload]
        else:
            raise ValueError(
                "Invalid JSON dataset: expected a case, a list of cases, or an object with cases.",
            )

        return cls(cases=[_validate_case(record) for record in records])

    @classmethod
    def from_jsonl(cls, path: str | Path) -> Dataset:
        cases: list[EvalCase] = []
        dataset_path = Path(path)

        with dataset_path.open(encoding="utf-8") as file:
            for line_number, line in enumerate(file, start=1):
                stripped = line.strip()
                if not stripped:
                    continue
                try:
                    record = json.loads(stripped)
                    cases.append(_validate_case(record, f" on line {line_number}"))
                except json.JSONDecodeError as exc:
                    raise ValueError(
                        f"Invalid JSONL record on line {line_number}: {exc.msg}"
                    ) from exc

        return cls(cases=cases)

    @classmethod
    def from_records(cls, records: Iterable[dict[str, Any]]) -> Dataset:
        return cls(cases=[EvalCase.model_validate(record) for record in records])

    def __iter__(self) -> Iterator[EvalCase]:
        return iter(self.cases)

    def __len__(self) -> int:
        return len(self.cases)


def _validate_case(record: Any, location: str = "") -> EvalCase:
    try:
        return EvalCase.model_validate(record)
    except ValidationError as exc:
        raise ValueError(f"Invalid eval case{location}: {exc}") from exc
