#!/usr/bin/env python3
"""Validate the synthetic zh-TW kiosk speech-guard JSONL dataset.

Uses only the Python standard library. No model inference is performed.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import sys
import unicodedata
from typing import Any

LABELS = (
    "ORDER_INTENT",
    "AGENT_RESPONSE",
    "KIOSK_COMMAND",
    "BACKGROUND_CONVERSATION",
    "AMBIGUOUS",
)
REQUIRED = {"label", "text", "difficulty", "requires_context"}
DIFFICULTIES = {"easy", "medium", "hard"}


def ensure(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def normalize(text: str) -> str:
    return "".join(
        ch
        for ch in unicodedata.normalize("NFKC", text).casefold()
        if unicodedata.category(ch)[0] not in {"P", "Z", "S", "C"}
    )


def read_rows(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            ensure(bool(line.strip()), f"{path.name}:{line_number}: blank line")
            try:
                row = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(
                    f"{path.name}:{line_number}: invalid JSON: {exc}"
                ) from exc
            ensure(isinstance(row, dict), f"{path.name}:{line_number}: expected object")
            ensure(REQUIRED <= row.keys(), f"{path.name}:{line_number}: missing fields")
            ensure(row["label"] in LABELS, f"{path.name}:{line_number}: unknown label")
            ensure(
                isinstance(row["text"], str) and bool(row["text"].strip()),
                f"{path.name}:{line_number}: empty or non-string text",
            )
            ensure(
                "\n" not in row["text"] and "\r" not in row["text"],
                f"{path.name}:{line_number}: multiline transcript",
            )
            ensure(row["difficulty"] in DIFFICULTIES, f"{path.name}:{line_number}: difficulty")
            ensure(type(row["requires_context"]) is bool, f"{path.name}:{line_number}: expected bool")
            ensure(isinstance(row.get("id"), str), f"{path.name}:{line_number}: missing id")
            ctx = row.get("context")
            ensure(ctx is None or isinstance(ctx, dict), f"{row['id']}: invalid context")
            if ctx is not None:
                ensure("previous_agent_turn" in ctx and "kiosk_state" in ctx,
                       f"{row['id']}: incomplete context object")
                ensure(ctx["previous_agent_turn"] is None
                       or isinstance(ctx["previous_agent_turn"], str),
                       f"{row['id']}: invalid previous turn")
                ensure(isinstance(ctx["kiosk_state"], str),
                       f"{row['id']}: invalid kiosk state")
            if row["label"] == "AGENT_RESPONSE":
                ensure(row["requires_context"], f"{row['id']}: answer must be context-dependent")
                ensure(bool(ctx and ctx.get("previous_agent_turn")),
                       f"{row['id']}: answer lacks preceding agent turn")
                ensure(bool(ctx and ctx.get("expected_response")),
                       f"{row['id']}: answer lacks expected slot")
            if row["label"] == "AMBIGUOUS":
                ensure(row["requires_context"], f"{row['id']}: ambiguity must require context")
            if row["label"] == "BACKGROUND_CONVERSATION" and row["requires_context"]:
                ensure(bool(row.get("annotation_note")),
                       f"{row['id']}: source-dependent negative needs an annotation note")
            rows.append(row)
    return rows


def duplicate_groups(rows: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        groups[normalize(row["text"])].append(row)
    return [group for group in groups.values() if len(group) > 1]


def check_allowed_duplicates(rows: list[dict[str, Any]], is_test: bool) -> list[dict[str, Any]]:
    report: list[dict[str, Any]] = []
    for group in duplicate_groups(rows):
        ensure(len(group) == 2, "Unexpected duplicate group with more than two rows")
        ensure({r["label"] for r in group} == {"AGENT_RESPONSE", "AMBIGUOUS"},
               f"Unexpected label collision: {[r['id'] for r in group]}")
        ensure(all(r["requires_context"] for r in group),
               "Duplicate short answers must be context-dependent")
        answer = next(r for r in group if r["label"] == "AGENT_RESPONSE")
        ambiguous = next(r for r in group if r["label"] == "AMBIGUOUS")
        ensure(bool(answer["context"] and answer["context"]["previous_agent_turn"]),
               "Context twin is missing its preceding question")
        ensure(ambiguous["context"] is None,
               "This dataset's intentional duplicate must be the no-context twin")
        if is_test:
            ensure(len({r["pair_id"] for r in group}) == 1,
                   "Duplicate test text crosses pair groups")
        report.append({
            "text": group[0]["text"],
            "ids": [r["id"] for r in group],
            "reason": "intentional_answer_vs_ungrounded_same_text",
        })
    return report


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    responses = [r for r in rows if r["label"] == "AGENT_RESPONSE"]
    return {
        "rows": len(rows),
        "unique_exact_texts": len({r["text"] for r in rows}),
        "unique_normalized_texts": len({normalize(r["text"]) for r in rows}),
        "labels": {label: sum(r["label"] == label for r in rows) for label in LABELS},
        "difficulty": dict(Counter(r["difficulty"] for r in rows)),
        "requires_context": {
            "true": sum(r["requires_context"] for r in rows),
            "false": sum(not r["requires_context"] for r in rows),
        },
        "agent_responses_at_most_4_normalized_characters": sum(
            len(normalize(r["text"])) <= 4 for r in responses
        ),
        "source_dependent_background_rows": sum(
            r["label"] == "BACKGROUND_CONVERSATION" and r["requires_context"]
            for r in rows
        ),
    }


def validate(data_dir: Path) -> dict[str, Any]:
    proto_path = data_dir / "prototype_examples.jsonl"
    test_path = data_dir / "hard_test.jsonl"
    proto = read_rows(proto_path)
    test = read_rows(test_path)
    ensure(all(sum(r["label"] == label for r in proto) >= 100 for label in LABELS),
           "Each prototype label must have at least 100 rows")
    ensure(len(test) >= 100, "Hard test needs at least 100 rows")
    ensure(len({normalize(r["text"]) for r in test}) >= 100,
           "Hard test needs at least 100 distinct normalized transcripts")
    ids = [r["id"] for r in proto + test]
    ensure(len(ids) == len(set(ids)), "Duplicate record ids")

    exact_overlap = {r["text"] for r in proto} & {r["text"] for r in test}
    normalized_overlap = {normalize(r["text"]) for r in proto} & {
        normalize(r["text"]) for r in test
    }
    ensure(not exact_overlap, f"Exact split leakage: {sorted(exact_overlap)}")
    ensure(not normalized_overlap, f"Normalized split leakage: {sorted(normalized_overlap)}")

    proto_duplicates = check_allowed_duplicates(proto, is_test=False)
    test_duplicates = check_allowed_duplicates(test, is_test=True)
    pairs: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in test:
        ensure(row["difficulty"] == "hard", f"{row['id']}: non-hard test example")
        ensure(isinstance(row.get("pair_id"), str), f"{row['id']}: missing pair id")
        ensure(isinstance(row.get("pair_focus"), str), f"{row['id']}: missing pair focus")
        pairs[row["pair_id"]].append(row)
    for pair_id, group in pairs.items():
        ensure(len(group) == 2, f"{pair_id}: expected exactly two members")
        ensure(len({r["label"] for r in group}) == 2,
               f"{pair_id}: expected different labels")
        ensure(len({r["pair_focus"] for r in group}) == 1,
               f"{pair_id}: inconsistent focus")

    definitions = json.loads((data_dir / "label_definitions.json").read_text(encoding="utf-8"))
    ensure(set(definitions["labels"]) == set(LABELS), "Label definitions disagree with examples")
    report = {
        "status": "PASS",
        "scope": "schema, counts, split isolation, intentional duplicates, pair integrity; no model accuracy claim",
        "normalization": "NFKC + casefold; remove Unicode punctuation, separators, symbols and controls",
        "prototype": summarize(proto),
        "hard_test": {
            **summarize(test),
            "pairs": len(pairs),
            "pair_focus_counts": dict(Counter(group[0]["pair_focus"] for group in pairs.values())),
            "background_rows_with_preceding_agent_turn": sum(
                r["label"] == "BACKGROUND_CONVERSATION"
                and bool(r["context"] and r["context"].get("previous_agent_turn"))
                for r in test
            ),
            "ambiguous_rows_with_insufficient_supplied_context": sum(
                r["label"] == "AMBIGUOUS" and r["context"] is not None for r in test
            ),
        },
        "split_overlap": {"exact": len(exact_overlap), "normalized": len(normalized_overlap)},
        "intentional_prototype_duplicate_groups": proto_duplicates,
        "intentional_test_same_text_pairs": test_duplicates,
        "sha256": {
            proto_path.name: sha256_file(proto_path),
            test_path.name: sha256_file(test_path),
            "label_definitions.json": sha256_file(data_dir / "label_definitions.json"),
        },
        "limitations": [
            "Synthetic corpus; not representative field sampling.",
            "No acoustic speaker-target evidence is supplied.",
            "Annotation notes and pair metadata must not be model inputs.",
            "No semantic-family isolation or real-world false-reject-rate claim.",
            "Hard test must not be used to tune thresholds and then reported as untouched.",
        ],
    }
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--report", type=Path, default=None)
    args = parser.parse_args()
    try:
        report = validate(args.data_dir)
        report_path = args.report or args.data_dir / "validation_report.json"
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f"VALIDATION FAILED: {exc}", file=sys.stderr)
        return 1
    print(f"PASS: {report['prototype']['rows']} prototypes; "
          f"{report['hard_test']['rows']} hard-test rows; "
          f"{report['hard_test']['pairs']} pairs; "
          f"0 exact/normalized split overlaps.")
    print(f"Report: {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
