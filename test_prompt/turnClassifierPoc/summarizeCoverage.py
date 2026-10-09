"""Measure semantic-review sensitivity on injected hypotheses, not upstream routing accuracy."""

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
    source = runLocal.ROOT / "effectCoverageScenarios.json"
    fixture = benchmark.read_json(source)
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    replay = benchmark.read_json(runLocal.ROOT / "results" / "effectCoverageReplay.json")
    assert digest == replay["scenario_sha256"]
    expected = {row["id"]: row for row in fixture["scenarios"]}
    rows = replay["observations"]
    assert len(rows) == len(expected) == len({row["id"] for row in rows}) == 32
    assert set(expected) == {row["id"] for row in rows}
    assert replay["threshold"] == fixture["threshold"] == .6
    for row in rows:
        assert row["candidateId"] == expected[row["id"]]["candidateId"]
        assert row["expected"] == expected[row["id"]]["expected"]
        assert not row["changedCart"], "An advisory experiment must have zero writes"
    good = [row for row in rows if row["expected"] == "COVERED"]
    bad = [row for row in rows if row["expected"] != "COVERED"]
    checked = [row for row in rows if row["result"]["kind"] == "CHECKED_HYPOTHESIS"]
    false_admit = [row["id"] for row in checked if row["expected"] != "COVERED"]
    false_veto = [row["id"] for row in good if row["result"]["kind"] != "CHECKED_HYPOTHESIS"]
    domain_eligible = [row for row in rows if row["result"].get("resolution", {}).get("kind")
                       in ("PLAN", "CONFIGURATION", "CLARIFICATION")
                       and row["result"].get("authorization", {}).get("kind") != "BLOCKED"]
    semantic_rows = [row for row in rows if row["calls"]]
    matrix = collections.defaultdict(collections.Counter)
    for row in semantic_rows:
        matrix[row["expected"]][row["result"].get("rawAnswer", {}).get("choice", "FAILURE")] += 1
    summary = {"scenario_sha256": digest, "threshold": fixture["threshold"], "total": len(rows),
               "design": "deliberately paired good/bad application-effect hypotheses; no classifier or upstream decision is measured",
               "supported_hypotheses": len(good), "unsupported_hypotheses": len(bad),
               "domain_eligible": len(domain_eligible),
               "domain_eligible_bad_ids": [row["id"] for row in domain_eligible if row["expected"] != "COVERED"],
               "checked": len(checked), "correctly_checked": len(checked) - len(false_admit),
               "false_admit_ids": false_admit, "false_veto_ids": false_veto,
               "supported_retention_rate": (len(good) - len(false_veto)) / len(good),
               "bad_rejection_rate": (len(bad) - len(false_admit)) / len(bad),
               "provider_failures": sum(row["result"]["reason"] == "PROVIDER_FAILURE" for row in rows),
               "preflight_without_model": len(rows) - len(semantic_rows),
               "semantic_exact_choice_matches": sum(row["result"].get("rawAnswer", {}).get("choice") == row["expected"] for row in semantic_rows),
               "semantic_cases": len(semantic_rows), "confusion_matrix": dict(matrix),
               "reasons": dict(collections.Counter(row["result"]["reason"] for row in rows)),
               "additional_http_latency_ms": distribution([call["durationMs"] for row in rows for call in row["calls"]]),
               "advisory_pipeline_latency_ms": distribution([row["durationMs"] for row in rows]),
               "models": sorted({call["model"] for row in rows for call in row["calls"]}),
               "writes": 0, "cases": []}
    for row in rows:
        summary["cases"].append({"id": row["id"], "transcript": expected[row["id"]]["transcript"],
                                 "hypothesis": row["candidateId"], "expected": row["expected"],
                                 "reason": row["result"]["reason"], "kind": row["result"]["kind"],
                                 "confidence": row["result"].get("confidence"),
                                 "raw_choice": row["result"].get("rawAnswer", {}).get("choice")})
    target = runLocal.ROOT / "results" / "effectCoverageSummary.json"
    if target.exists():
        raise ValueError("Summary exists; preserve the original experiment")
    runLocal.save_json(target, summary)
    print(json.dumps({key: value for key, value in summary.items() if key != "cases"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
