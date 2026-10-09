"""Summarize recorded real resolver effects; fallback latency remains a projection."""

import collections
import argparse
import hashlib
import json
import statistics

import benchmark
import runLocal


def latency(values):
    return {"mean": statistics.mean(values), "p50": benchmark.percentile(values, .5),
            "p95": benchmark.percentile(values, .95)}


def outcome(row, scenario):
    assessment = row["assessment"]
    receipt = row["execution"].get("receipt", {})
    trace = receipt.get("decisionTrace", {})
    plan = trace.get("operationPlan") or {}
    # Cart/phase differences do not expose seating writes. Keep this additional
    # known side-effect channel visible instead of claiming all mutations are covered.
    seat_write = ((trace.get("authorize") or {}).get("kind") == "EXECUTE"
                  and plan.get("intent") == "SET_PARTY_SIZE")
    wrong_seat = seat_write and (scenario["expected"] != "intent:set-party-size"
                                or plan.get("slots", {}).get("partySize") != scenario.get("partySize"))
    matched = assessment["correct"] and not receipt.get("needsAssistant", False)
    return {"contract_match": matched,
            "unsafe_cart_phase_or_party_write": assessment["unsafe"] or wrong_seat,
            "wrong_preparation": assessment["wrongPreparation"],
            "abstained": assessment["abstained"],
            "assistant_decision": row.get("decision", {}).get("kind") == "NEEDS_ASSISTANT"}


def totals(rows):
    return {key: sum(row[key] for row in rows) for key in rows[0]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audit", action="store_true", help="Retain raw summary and separately audit fixture validity")
    args = parser.parse_args()
    source = runLocal.ROOT / "resolverScenarios.json"
    scenarios = benchmark.read_json(source)["scenarios"]
    by_id = {row["id"]: row for row in scenarios}
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    replay = benchmark.read_json(runLocal.ROOT / "results" / "resolverReplay.json")
    predictions = benchmark.read_json(runLocal.ROOT / "results" / "resolverPredictions.json")
    assert digest == replay["scenario_sha256"] == predictions["scenario_sha256"]
    groups = collections.defaultdict(list)
    for row in replay["observations"]:
        groups[row["stage"]].append(row)
    assert len(groups["fixture"]) == len(groups["jev"]) == len(scenarios) == 40
    baseline = {row["id"]: row for row in groups["jev"]}
    assert set(baseline) == set(by_id)
    excluded = []
    if args.audit:
        # Frozen labels and raw runs are never rewritten. A multi-line removal
        # expectation is invalid when the runtime actually merged identical items.
        for scenario in scenarios:
            if scenario["setup"] == "duplicates" and scenario.get("resolution") == "CLARIFICATION":
                lines = baseline[scenario["id"]]["execution"]["before"]["lines"]
                if len(lines) < 2:
                    excluded.append({"id": scenario["id"], "reason": "Identical items merged into one cart line; intended multi-line fixture was not established"})
        valid_ids = set(by_id) - {row["id"] for row in excluded}
        baseline = {key: row for key, row in baseline.items() if key in valid_ids}
        scenarios = [row for row in scenarios if row["id"] in valid_ids]
    base_outcomes = {key: outcome(row, by_id[key]) for key, row in baseline.items()}
    summary = {"scenario_sha256": digest, "samples": len(scenarios),
               "excluded_fixture_cases": excluded,
               "labels": "single-author expectations frozen before inference; challenge set, not production traffic",
               "missing_expected_candidates": [row["id"] for row in groups["fixture"]
                                               if row["expectedCandidateAvailable"] is False],
               "baseline": {**totals(list(base_outcomes.values())),
                            "kinds": dict(collections.Counter(row["decision"]["kind"] for row in baseline.values())),
                            "provider_failures": sum(row["decision"].get("reason") == "PROVIDER_FAILURE"
                                                     for row in baseline.values()),
                            "model_calls": sum(row["decision"].get("modelCalls", 0) for row in baseline.values()),
                            "semantic_latency_ms": latency([row["semanticMs"] for row in baseline.values()]),
                            "full_replay_latency_ms": latency([row["semanticMs"] + row["execution"]["executionMs"]
                                                              for row in baseline.values()])},
               "classifiers": {}, "hybrid_projections": [], "cases": []}
    for mode in ("frozen", "setfit"):
        summary["classifiers"][mode] = benchmark.evaluate(scenarios, predictions["modes"][mode]["records"])
        for threshold in benchmark.THRESHOLDS:
            all_rows = [row for row in groups["local"] if row["mode"] == mode and row["threshold"] == threshold]
            assert len(all_rows) == 40 and {row["id"] for row in all_rows} == set(by_id)
            rows = [row for row in all_rows if row["id"] in baseline]
            outcomes, costs = [], []
            for row in rows:
                if row["accepted"]:
                    outcomes.append(outcome(row, by_id[row["id"]]))
                    cost = row["execution"]["executionMs"]
                else:
                    base = baseline[row["id"]]
                    outcomes.append(base_outcomes[row["id"]])
                    cost = base["semanticMs"] + base["execution"]["executionMs"]
                costs.append(row["prediction"]["latency_ms"] + cost)
            accepted = [row for row in rows if row["accepted"]]
            summary["hybrid_projections"].append({"mode": mode, "threshold": threshold,
                "read_only_accepted": len(accepted), "accepted_ids": [row["id"] for row in accepted],
                "accepted_contract_matches": sum(outcome(row, by_id[row["id"]])["contract_match"] for row in accepted),
                "accepted_unsafe_writes": sum(outcome(row, by_id[row["id"]])["unsafe_cart_phase_or_party_write"] for row in accepted),
                "contextual_semantics": sum(row.get("referral") == "contextual_semantics" for row in rows),
                "other_jev": sum(row.get("referral") == "jev" for row in rows),
                "total_jev_fallback": len(rows) - len(accepted), "mutation_bypass": 0,
                "projected_outcomes": totals(outcomes), "projected_latency_ms": latency(costs),
                "semantics": "real local read-only probes; all other outcomes reuse the matched new finite-Jev baseline, not an oracle or a second hybrid live call"})
    for row in baseline.values():
        scenario = by_id[row["id"]]
        summary["cases"].append({"id": row["id"], "transcript": scenario["transcript"],
                                 "setup": scenario["setup"], "expected": scenario["expected"],
                                 "actual": row["assessment"]["actual"], **base_outcomes[row["id"]],
                                 "reason": row["decision"].get("reason"),
                                 "resolution": (row["execution"].get("receipt", {}).get("decisionTrace", {}).get("resolveIntent") or {}).get("kind")})
    target = runLocal.ROOT / "results" / ("resolverAudit.json" if args.audit else "resolverSummary.json")
    if target.exists():
        raise ValueError("Summary exists; do not overwrite the recorded experiment")
    runLocal.save_json(target, summary)
    print(json.dumps({key: value for key, value in summary.items() if key not in ("cases", "classifiers")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
