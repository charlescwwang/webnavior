"""Matched hypothesis review versus candidate-blind extraction, never upstream accuracy."""

import collections
import hashlib
import json
import statistics

import benchmark
import runLocal


def distribution(values):
    return {"count": len(values), "mean": statistics.mean(values) if values else None,
            "p50": benchmark.percentile(values, .5), "p95": benchmark.percentile(values, .95)}


def main():
    source = runLocal.ROOT / "requirementScenarios.json"
    fixture = benchmark.read_json(source)
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    replay = benchmark.read_json(runLocal.ROOT / "results" / "requirementReplay.json")
    assert digest == replay["scenario_sha256"]
    assert replay["threshold"] == fixture["threshold"] == .6
    expected = {turn["id"]: turn for turn in fixture["turns"]}
    rows = replay["observations"]
    assert len(rows) == len(expected) == len({row["id"] for row in rows}) == 26
    assert set(expected) == {row["id"] for row in rows}
    columns = ["first", "second", "count", "information", "reference"]
    matrix = {key: collections.defaultdict(collections.Counter) for key in columns}
    dimensions = collections.Counter()
    cases = []
    records = []
    for row in rows:
        gold = expected[row["id"]]
        assert not row["changedCart"]
        assert len(row["hypotheses"]) == len(gold["hypotheses"])
        blind = row["finding"]
        raw = blind.get("rawAnswers", {})
        for key in columns:
            choice = raw.get(key, {}).get("choice", "FAILURE")
            matrix[key][gold["expected"][key]][choice] += 1
            dimensions[key] += choice == gold["expected"][key]
        profile_match = blind.get("profile") == gold["expected"]
        for result, hypothesis in zip(row["hypotheses"], gold["hypotheses"]):
            for key in ["candidateId", "supported", "review"]:
                assert result[key] == hypothesis[key]
            records.append({"id": f'{row["id"]}:{hypothesis["candidateId"]}',
                            "turn": row["id"], "supported": hypothesis["supported"],
                            "contextual": gold["expected"]["reference"] == "CONTEXTUAL",
                            "blind": result["comparison"]["kind"] == "CHECKED_HYPOTHESIS",
                            "baseline": result["baseline"]["kind"] == "CHECKED_HYPOTHESIS",
                            "comparison_reason": result["comparison"]["reason"],
                            "baseline_reason": result["baseline"]["reason"]})
        cases.append({"id": row["id"], "transcript": gold["transcript"],
                      "known_regression": gold.get("knownRegression", False),
                      "expected": gold["expected"], "profile": blind.get("profile"),
                      "profile_match": profile_match, "finding": blind["reason"],
                      "confidence": blind.get("confidence"),
                      "hypotheses": [record for record in records if record["turn"] == row["id"]]})
    calls = [call for row in rows for call in row["calls"]]
    assert sum(call["phase"] == "blind" for call in calls) == 26
    assert len(records) == 32
    comparison = {}
    for mode in ["baseline", "blind"]:
        supported = [row for row in records if row["supported"]]
        direct_supported = [row for row in supported if not row["contextual"]]
        unsupported = [row for row in records if not row["supported"]]
        comparison[mode] = {"checked": sum(row[mode] for row in records),
                            "supported_retained": sum(row[mode] for row in supported),
                            "supported_total": len(supported),
                            "explicit_supported_retained": sum(row[mode] for row in direct_supported),
                            "explicit_supported_total": len(direct_supported),
                            "false_admit_ids": [row["id"] for row in unsupported if row[mode]],
                            "explicit_false_veto_ids": [row["id"] for row in direct_supported if not row[mode]],
                            "unsupported_total": len(unsupported),
                            "unsupported_rejection_rate": sum(not row[mode] for row in unsupported) / len(unsupported),
                            "contextual_checked_ids": [row["id"] for row in records if row["contextual"] and row[mode]]}
    fresh = [case for case in cases if not case["known_regression"]]
    summary = {"scenario_sha256": digest, "threshold": fixture["threshold"],
               "design": "26 blind profiles reused for 32 deliberately injected hypotheses; unchanged same-input candidate-review baseline; no classifier or upstream decision measured",
               "turns": len(rows), "hypotheses": len(records),
               "known_regression_ids": [case["id"] for case in cases if case["known_regression"]],
               "exact_profile_matches": sum(case["profile_match"] for case in cases),
               "fresh_exact_profile_matches": sum(case["profile_match"] for case in fresh),
               "fresh_turns": len(fresh), "dimension_matches": dict(dimensions),
               "dimension_confusion": {key: dict(value) for key, value in matrix.items()},
               "finding_reasons": dict(collections.Counter(row["finding"]["reason"] for row in rows)),
               "comparison": comparison, "provider_calls": len(calls),
               "failed_calls": sum(call["status"] != "ok" for call in calls),
               "models": sorted({call["model"] for call in calls if call.get("model")}),
               "blind_http_latency_ms": distribution([call["durationMs"] for call in calls if call["phase"] == "blind"]),
               "baseline_http_latency_ms": distribution([call["durationMs"] for call in calls if call["phase"].startswith("baseline:")]),
               "blind_advisory_latency_ms": distribution([row["blindDurationMs"] for row in rows]),
               "writes": 0, "cases": cases}
    target = runLocal.ROOT / "results" / "requirementSummary.json"
    if target.exists():
        raise ValueError("Preserve the original summary")
    runLocal.save_json(target, summary)
    print(json.dumps({key: value for key, value in summary.items() if key not in ["cases", "dimension_confusion"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
