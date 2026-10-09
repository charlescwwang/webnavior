"""Synthetic-only Turn Classifier evaluation; never imports production Kiosk code."""

import argparse
import collections
import hashlib
import json
import math
import statistics
import time
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CLASSES = (
    "DIRECT_ACTION", "QUERY", "REFERENCE", "MODIFICATION",
    "CANCEL_OR_REVERT", "CHAT", "NOISE", "UNCERTAIN",
)
CONTEXTUAL = {"REFERENCE", "MODIFICATION", "CANCEL_OR_REVERT"}
DIRECT = {"DIRECT_ACTION", "QUERY"}
THRESHOLDS = (0.70, 0.80, 0.90, 0.95)
INSTRUCTIONS = """你是餐飲語句型態分類器，只看本句，不猜商品、前文、target、參數或操作。
只選八類之一。這是語句形態，不是完整點餐意圖，也不授權任何動作。
類別重疊時依序：多個独立需求、尚未說完、改口未定、僅試探評價→UNCERTAIN；
明確取消／拒絕／回復→CANCEL_OR_REVERT；修改既有選擇→MODIFICATION；
依賴指示詞、前文或待答問題→REFERENCE；其餘資訊／菜單／推薦查詢→QUERY；
明確提出選餐、點餐、畫面操作需求→DIRECT_ACTION；完整非交易對話→CHAT；
沒有可恢復的有意義話語→NOISE。其他無法安全判別→UNCERTAIN。
REFERENCE 包含帶指示詞的查詢與只有數量、選項或肯定詞的短回答，不代表同意。
DIRECT_ACTION 不等於加入購物車；分類食物的用餐願望仍由後續 resolver 決定效果。
NOISE 不包含有意義但尚未說完的需求。只能選提供的類別。"""
CRITERIA = {
    "DIRECT_ACTION": "明確提出選餐／點餐／服務或畫面操作需求；沒有前文指示依賴。不是可執行計畫。",
    "QUERY": "查詢存在、品項、價格、內容、分類、飲食條件或要求推薦；無前文指示依賴。",
    "REFERENCE": "指示詞、序號、先前項目、裸數量／選項／肯定短回答，需要上下文才知道效果；不猜 target。",
    "MODIFICATION": "改既有選擇的數量、內容、客製條件或服務設定，需要 resolver；不要辣不是取消餐點。",
    "CANCEL_OR_REVERT": "取消、拒絕、撤回或恢復原本選擇；不猜被拒絕或取消的對象。",
    "CHAT": "有意義的非交易對話、招呼、生活感受或對同伴說話。單說餓或累屬此類。",
    "NOISE": "無有效話語、雜音標記或不可恢復的亂碼／詞串；不是有意義的未完成需求。",
    "UNCERTAIN": "未完成、改口未定、試探評價、複合獨立需求或無法由本句可靠判斷；不要補意圖。",
}


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def corpus():
    """Expand hand-authored families without generating or relabeling utterances."""
    source = read_json(ROOT / "corpus.json")
    rows = []
    for label in CLASSES:
        for split, families in source["classes"][label].items():
            for family_index, texts in enumerate(families):
                group = f"{label}:{split}:{family_index + 1}"
                for index, text in enumerate(texts):
                    rows.append({"id": f"{group}:{index + 1}", "group": group,
                                 "split": split, "class": label, "utterance": text})
    return rows


def audit(rows):
    """Fail on duplicate speech, broken groups, or a changed balanced split."""
    assert len(rows) == 400, "Expected 400 synthetic utterances"
    assert len({row["id"] for row in rows}) == 400
    assert len({row["utterance"] for row in rows}) == 400, "Duplicate utterance"
    counts = collections.Counter((row["class"], row["split"]) for row in rows)
    for label in CLASSES:
        assert counts[label, "train"] == 30
        assert counts[label, "validation"] == 10
        assert counts[label, "test"] == 10
    groups = collections.defaultdict(set)
    for row in rows:
        groups[row["group"]].add(row["split"])
    assert all(len(splits) == 1 for splits in groups.values())
    assert all(count == 5 for count in collections.Counter(row["group"] for row in rows).values())
    return {"samples": len(rows), "classes": len(CLASSES), "families": len(groups),
            "splits": dict(collections.Counter(row["split"] for row in rows)),
            "sha256": hashlib.sha256((ROOT / "corpus.json").read_bytes()).hexdigest()}


def percentile(values, fraction):
    """Linear interpolation between ordered samples; no inferred tail distribution."""
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    low, high = math.floor(position), math.ceil(position)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def prediction_ok(record):
    prediction = record.get("prediction", {})
    return (prediction.get("class") in CLASSES
            and isinstance(prediction.get("confidence"), (int, float))
            and math.isfinite(prediction["confidence"])
            and 0 <= prediction["confidence"] <= 1
            and isinstance(prediction.get("latency_ms"), (int, float))
            and math.isfinite(prediction["latency_ms"])
            and prediction["latency_ms"] >= 0)


def evaluate(rows, records):
    """Measure held-out classification; provider failures count against total accuracy."""
    by_id = {record["id"]: record for record in records}
    matrix = {label: {pred: 0 for pred in (*CLASSES, "FAILURE")} for label in CLASSES}
    bins = [{"count": 0, "confidence_sum": 0.0, "correct": 0} for _ in range(10)]
    latencies, briers, probability_sums = [], [], []
    failures = []
    for row in rows:
        record = by_id.get(row["id"], {})
        if not prediction_ok(record):
            matrix[row["class"]]["FAILURE"] += 1
            failures.append(row["id"])
            continue
        prediction = record["prediction"]
        correct = prediction["class"] == row["class"]
        matrix[row["class"]][prediction["class"]] += 1
        latencies.append(prediction["latency_ms"])
        bucket = bins[min(9, int(prediction["confidence"] * 10))]
        bucket["count"] += 1
        bucket["confidence_sum"] += prediction["confidence"]
        bucket["correct"] += int(correct)
        probabilities = record.get("probabilities", {})
        # Never silently renormalize upstream numbers into invented posteriors.
        valid = (set(probabilities) == set(CLASSES)
                 and all(isinstance(value, (int, float)) and math.isfinite(value)
                         and 0 <= value <= 1 for value in probabilities.values()))
        if valid:
            total = sum(probabilities.values())
            probability_sums.append(total)
            if abs(total - 1) <= 0.001:
                briers.append(sum((probabilities[label] - int(label == row["class"])) ** 2
                                  for label in CLASSES))
    per_class = {}
    for label in CLASSES:
        true_positive = matrix[label][label]
        predicted = sum(matrix[gold][label] for gold in CLASSES)
        support = sum(matrix[label].values())
        precision = true_positive / predicted if predicted else 0
        recall = true_positive / support if support else 0
        per_class[label] = {"precision": precision, "recall": recall,
                            "f1": 2 * precision * recall / (precision + recall)
                            if precision + recall else 0, "support": support}
    reliability = []
    for index, bucket in enumerate(bins):
        count = bucket["count"]
        reliability.append({"range": [index / 10, (index + 1) / 10], "count": count,
                            "mean_confidence": bucket["confidence_sum"] / count if count else None,
                            "accuracy": bucket["correct"] / count if count else None})
    correct_total = sum(matrix[label][label] for label in CLASSES)
    valid_count = len(rows) - len(failures)
    ece = sum(bucket["count"] / valid_count
              * abs(bucket["mean_confidence"] - bucket["accuracy"])
              for bucket in reliability if bucket["count"]) if valid_count else None
    return {"total": len(rows), "valid": valid_count, "failure_ids": failures,
            "accuracy_valid_outputs": correct_total / valid_count if valid_count else None,
            "accuracy_including_failures": correct_total / len(rows) if rows else None,
            "macro_f1": statistics.mean(item["f1"] for item in per_class.values()),
            "per_class": per_class, "confusion_matrix": matrix,
            "latency_ms_valid_outputs": {"mean": statistics.mean(latencies) if latencies else None,
                                         "p50": percentile(latencies, .50),
                                         "p95": percentile(latencies, .95)},
            "confidence_ece": ece, "reliability_bins": reliability,
            "multiclass_brier": statistics.mean(briers) if briers else None,
            "brier_valid_count": len(briers),
            "posterior_sum_range": [min(probability_sums), max(probability_sums)]
            if probability_sums else None}


def routing(prediction, threshold):
    """Referral only; neither a model score nor this function authorizes an operation."""
    label = prediction["class"]
    if prediction["confidence"] < threshold or label == "UNCERTAIN":
        return "jev_fallback"
    if label in CONTEXTUAL:
        return "contextual_resolver"
    if label in DIRECT:
        return "domain_resolver"
    return "non_execution"


def simulate(rows, local_records, jev_records):
    """No oracle resolver: measure class error and referrals, not order success."""
    local = {record["id"]: record for record in local_records}
    jev = {record["id"]: record for record in jev_records}
    results = []
    for threshold in THRESHOLDS:
        counts = collections.Counter()
        wrong_direct, selected_errors, mixed_errors, failures = 0, 0, 0, 0
        non_direct_wrongly_direct, service_wrongly_non_execution = 0, 0
        projected_ms = []
        for row in rows:
            candidate = local.get(row["id"], {})
            if not prediction_ok(candidate):
                failures += 1
                counts["classifier_failure"] += 1
                continue
            prediction = candidate["prediction"]
            destination = routing(prediction, threshold)
            counts[destination] += 1
            if destination == "domain_resolver" and row["class"] in CONTEXTUAL | {"UNCERTAIN"}:
                wrong_direct += 1
            if destination == "domain_resolver" and row["class"] not in DIRECT:
                non_direct_wrongly_direct += 1
            if destination == "non_execution" and row["class"] not in {"CHAT", "NOISE"}:
                service_wrongly_non_execution += 1
            if destination == "jev_fallback":
                remote = jev.get(row["id"], {})
                if not prediction_ok(remote):
                    failures += 1
                    continue
                final_prediction = remote["prediction"]
                projected_ms.append(prediction["latency_ms"] + final_prediction["latency_ms"])
            else:
                final_prediction = prediction
                selected_errors += int(prediction["class"] != row["class"])
                projected_ms.append(prediction["latency_ms"])
            mixed_errors += int(final_prediction["class"] != row["class"])
        selected = len(rows) - counts["jev_fallback"] - counts["classifier_failure"]
        results.append({"threshold": threshold, "counts": dict(counts),
                        "shares": {key: value / len(rows) for key, value in counts.items()},
                        "accepted_class_error": selected_errors / selected if selected else None,
                        "contextual_or_uncertain_wrongly_direct": wrong_direct,
                        "non_direct_wrongly_direct": non_direct_wrongly_direct,
                        "service_turn_wrongly_non_execution": service_wrongly_non_execution,
                        "mixed_class_error_including_failures": (mixed_errors + failures) / len(rows),
                        "failure_count": failures,
                        "projected_classification_mean_ms": statistics.mean(projected_ms)
                        if projected_ms else None,
                        "projection_valid_count": len(projected_ms),
                        "resolver_latency_and_domain_correctness": "not measured"})
    return results


def run_jev(args, rows):
    """Explicit opt-in synthetic HTTP benchmark, resumable only with matching provenance."""
    output = Path(args.output)
    payload_definition = {"instructions": INSTRUCTIONS, "criteria": CRITERIA}
    fingerprint = hashlib.sha256(json.dumps(payload_definition, ensure_ascii=False,
                                           sort_keys=True).encode()).hexdigest()
    dataset = audit(corpus())
    result = {"model_kind": "jev_eight_class_turn_only", "endpoint": args.endpoint,
              "prompt_sha256": fingerprint, "dataset": dataset, "split": args.split,
              "remote_cold_start_ms": None, "remote_model_memory_bytes": None,
              "records": []}
    if output.exists():
        if not args.resume:
            raise ValueError("Output exists; use --resume or a new output path")
        result = read_json(output)
        if (result["prompt_sha256"] != fingerprint or result["dataset"] != dataset
                or result["split"] != args.split or result["endpoint"] != args.endpoint):
            raise ValueError("Resume provenance differs; use a new output path")
    completed = {record["id"] for record in result["records"]}
    output.parent.mkdir(parents=True, exist_ok=True)
    consecutive_failures = 0
    for row in rows:
        if row["id"] in completed:
            continue
        payload = {"state": "本句人工測試語音：" + json.dumps(row["utterance"], ensure_ascii=False),
                   "questions": {"turn": {"type": "choice", **payload_definition}}}
        request = urllib.request.Request(args.endpoint,
                                         data=json.dumps(payload, ensure_ascii=False).encode(),
                                         headers={"Content-Type": "application/json",
                                                  "User-Agent": "airi-turn-classifier-poc/1"}, method="POST")
        started = time.perf_counter()
        record = {"id": row["id"]}
        stop = False
        try:
            with urllib.request.urlopen(request, timeout=args.timeout) as response:
                body = json.load(response)
            elapsed = (time.perf_counter() - started) * 1000
            answer = body["answers"]["turn"]
            record.update({"prediction": {"class": answer["choice"],
                                          "confidence": answer["confidence"], "latency_ms": elapsed},
                           "probabilities": answer.get("probabilities", {}),
                           "model": body.get("model"), "raw_response": body})
            if not prediction_ok(record):
                record["error"] = "invalid prediction schema"
                record.pop("prediction", None)
        except (urllib.error.URLError, TimeoutError, KeyError, ValueError) as error:
            record.update({"error": str(error), "failed_latency_ms": (time.perf_counter() - started) * 1000})
            if isinstance(error, urllib.error.HTTPError):
                record["http_status"] = error.code
                # Authorization/rate-limit failures require a changed external state, not 80 retries.
                stop = error.code in {401, 403, 429}
        consecutive_failures = 0 if prediction_ok(record) else consecutive_failures + 1
        result["records"].append(record)
        # Each completed request is checkpointed; resuming never repeats acknowledged calls.
        output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"progress": len(result["records"]), "id": row["id"],
                          "prediction": record.get("prediction"), "error": record.get("error")},
                         ensure_ascii=False), flush=True)
        if stop or consecutive_failures >= 3:
            print("Benchmark stopped after provider failure; partial output is not a complete benchmark.", flush=True)
            break
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("audit")
    jev = commands.add_parser("jev")
    jev.add_argument("--endpoint", required=True)
    jev.add_argument("--output", required=True)
    jev.add_argument("--split", choices=("test", "validation"), default="test")
    jev.add_argument("--timeout", type=float, default=30)
    jev.add_argument("--resume", action="store_true")
    report = commands.add_parser("report")
    report.add_argument("--input", nargs="+", required=True)
    report.add_argument("--output", required=True)
    args = parser.parse_args()
    rows = corpus()
    provenance = audit(rows)
    if args.command == "audit":
        print(json.dumps(provenance, indent=2))
    elif args.command == "jev":
        run_jev(args, [row for row in rows if row["split"] == args.split])
    else:
        bundles = [read_json(path) for path in args.input]
        heldout = [row for row in rows if row["split"] == "test"]
        for bundle in bundles:
            if bundle["dataset"] != provenance or bundle["split"] != "test":
                raise ValueError("Reports require the same frozen held-out corpus")
            ids = [record["id"] for record in bundle["records"]]
            if len(ids) != len(set(ids)) or set(ids) != {row["id"] for row in heldout}:
                raise ValueError("Reports require exactly one record for every held-out ID")
        remote = next((bundle for bundle in bundles
                       if bundle["model_kind"] == "jev_eight_class_turn_only"), None)
        summary = {"dataset": provenance, "scope": "turn-only synthetic classification, no resolver execution",
                   "models": []}
        for bundle in bundles:
            item = {"kind": bundle["model_kind"], "metrics": evaluate(heldout, bundle["records"]),
                    "metadata": {key: value for key, value in bundle.items() if key != "records"}}
            if remote and not bundle["model_kind"].startswith("jev_"):
                item["routing_simulation"] = simulate(heldout, bundle["records"], remote["records"])
            summary["models"].append(item)
        target = Path(args.output)
        if target.exists():
            raise ValueError("Report output exists; choose a new output path")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"report": str(target), "models": len(bundles)}))


if __name__ == "__main__":
    main()
