"""Isolated MiniLM/SetFit experiment. Models and synthetic results stay local."""

import time

PROCESS_STARTED = time.perf_counter()

import argparse
import gc
import importlib.metadata
import json
import os
import platform
import resource
import subprocess
import sys
from pathlib import Path

import benchmark


ROOT = Path(__file__).resolve().parent
MODEL_ID = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
MODEL_REVISION = "e8f8c211226b894fcb81acc59f3b34ba3efd5f42"
MODES = ("frozen", "similarity", "setfit")
SEED = 42
TRAINING_STEPS = 60

# No implicit credentials, telemetry, tracking integrations, or external dataset loads.
os.environ["HF_HOME"] = str(ROOT / ".cache" / "huggingface")
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"
os.environ["DO_NOT_TRACK"] = "1"


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def versions():
    return {name: importlib.metadata.version(name) for name in
            ("torch", "sentence-transformers", "setfit", "scikit-learn", "numpy", "transformers")}


def peak_rss_bytes():
    """Process high-water RSS, not pure model memory; macOS reports bytes, Linux KiB."""
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return int(peak if sys.platform == "darwin" else peak * 1024)


def softmax(scores, temperature):
    import numpy as np

    scaled = np.asarray(scores, dtype=np.float64) / temperature
    shifted = scaled - scaled.max(axis=-1, keepdims=True)
    exponentials = np.exp(shifted)
    return exponentials / exponentials.sum(axis=-1, keepdims=True)


def fit_temperature(scores, labels):
    """Fit one positive scalar on validation NLL only; argmax labels cannot change."""
    import numpy as np

    temperatures = np.geomspace(.01, 10, 301)
    losses = []
    for temperature in temperatures:
        probabilities = softmax(scores, float(temperature))
        losses.append(float(-np.log(np.maximum(probabilities[np.arange(len(labels)), labels], 1e-12)).mean()))
    index = int(np.argmin(losses))
    return {"temperature": float(temperatures[index]), "validation_nll": losses[index],
            "grid_min": .01, "grid_max": 10, "grid_points": len(temperatures),
            "selected_at_boundary": index in (0, len(temperatures) - 1), "fit_split": "validation"}


def prepare():
    """Fetch a pinned public model once, before any cold-start timing."""
    from huggingface_hub import snapshot_download

    started = time.perf_counter()
    snapshot = snapshot_download(MODEL_ID, revision=MODEL_REVISION, token=False,
                                 allow_patterns=["*.json", "*.txt", "*.safetensors", "*.model"],
                                 ignore_patterns=["onnx/*", "openvino/*"])
    settings = {"model_id": MODEL_ID, "revision": MODEL_REVISION,
                "encoder_path": str(Path(snapshot).resolve()), "versions": versions(),
                "download_or_cache_resolution_ms": (time.perf_counter() - started) * 1000}
    save_json(ROOT / "models" / "base.json", settings)
    print(json.dumps(settings), flush=True)


def train():
    """Fit exactly the frozen training split; validation and test are not encoded here."""
    import numpy as np
    import torch
    from sentence_transformers import SentenceTransformer
    from sklearn.linear_model import LogisticRegression

    rows = benchmark.corpus()
    provenance = benchmark.audit(rows)
    rows = [row for row in rows if row["split"] == "train"]
    texts = [row["utterance"] for row in rows]
    labels = np.array([benchmark.CLASSES.index(row["class"]) for row in rows])
    base = benchmark.read_json(ROOT / "models" / "base.json")
    for mode in MODES:
        if (ROOT / "models" / mode / "settings.json").exists():
            raise ValueError("Training artifact exists; do not silently overwrite an experiment")
    torch.set_num_threads(4)
    torch.manual_seed(SEED)
    start = time.perf_counter()
    encoder = SentenceTransformer(base["encoder_path"], device="cpu", local_files_only=True,
                                  trust_remote_code=False, model_kwargs={"use_safetensors": True})
    embeddings = encoder.encode(texts, batch_size=16, normalize_embeddings=True, show_progress_bar=False)
    head = LogisticRegression(C=1.0, max_iter=1000, random_state=SEED).fit(embeddings, labels)
    assert list(head.classes_) == list(range(len(benchmark.CLASSES)))
    exported = softmax(embeddings @ head.coef_.T + head.intercept_, 1)
    assert np.allclose(exported, head.predict_proba(embeddings), atol=1e-7)
    common = {"dataset": provenance, "base": base, "seed": SEED, "train_samples": len(rows),
              "training_device": "cpu", "training_threads": 4,
              "normalize_embeddings": True, "head_C": 1.0, "head_max_iter": 1000}
    for mode in ("frozen", "similarity"):
        directory = ROOT / "models" / mode
        directory.mkdir(parents=True, exist_ok=True)
        if mode == "frozen":
            np.savez(directory / "head.npz", weights=head.coef_, intercept=head.intercept_)
        else:
            np.savez(directory / "head.npz", embeddings=embeddings, labels=labels)
        save_json(directory / "settings.json", {**common, "mode": mode,
                  "encoder_path": base["encoder_path"],
                  "training_ms": (time.perf_counter() - start) * 1000,
                  "score_semantics": "multinomial logits" if mode == "frozen" else "max cosine per class"})
    print("Frozen classification head and similarity index saved; no held-out data used.", flush=True)
    del encoder, head, embeddings
    gc.collect()

    from datasets import Dataset
    from setfit import SetFitModel, Trainer, TrainingArguments

    torch.manual_seed(SEED)
    start = time.perf_counter()
    model = SetFitModel.from_pretrained(base["encoder_path"], device="cpu", local_files_only=True,
                                       trust_remote_code=False, normalize_embeddings=True,
                                       head_params={"C": 1.0, "max_iter": 1000, "random_state": SEED},
                                       labels=list(benchmark.CLASSES))
    directory = ROOT / "models" / "setfit"
    args = TrainingArguments(output_dir=str(directory / "checkpoints"), batch_size=16,
                             num_epochs=1, max_steps=TRAINING_STEPS, num_iterations=2,
                             body_learning_rate=2e-5, warmup_proportion=.1, seed=SEED,
                             eval_strategy="no", save_strategy="no", report_to="none",
                             show_progress_bar=False, logging_steps=10)
    trainer = Trainer(model=model, args=args,
                      train_dataset=Dataset.from_dict({"text": texts, "label": labels.tolist()}))
    print("Starting one fixed SetFit run: 60 steps, CPU/4 threads, training data only.", flush=True)
    trainer.train()
    directory.mkdir(parents=True, exist_ok=True)
    model.model_body.save(str(directory / "encoder"), safe_serialization=True)
    assert list(model.model_head.classes_) == list(range(len(benchmark.CLASSES)))
    np.savez(directory / "head.npz", weights=model.model_head.coef_, intercept=model.model_head.intercept_)
    save_json(directory / "settings.json", {**common, "mode": "setfit",
              "encoder_path": str(directory / "encoder"), "body_learning_rate": 2e-5,
              "training_steps": trainer.st_trainer.state.global_step,
              "requested_steps": TRAINING_STEPS, "num_iterations": 2,
              "training_ms": (time.perf_counter() - start) * 1000,
              "training_process_peak_rss_bytes": peak_rss_bytes(),
              "score_semantics": "multinomial logits"})
    print("SetFit encoder and numeric classification head saved locally.", flush=True)


def measure_worker(mode):
    """One model in a fresh CPU process; no downloads or training contaminate RSS/timing."""
    import numpy as np
    import torch
    from sentence_transformers import SentenceTransformer

    torch.set_num_threads(1)
    directory = ROOT / "models" / mode
    settings = benchmark.read_json(directory / "settings.json")
    if settings["dataset"] != benchmark.audit(benchmark.corpus()):
        raise ValueError("Model was trained on a different corpus")
    head = np.load(directory / "head.npz", allow_pickle=False)
    encoder = SentenceTransformer(settings["encoder_path"], device="cpu", local_files_only=True,
                                  trust_remote_code=False, model_kwargs={"use_safetensors": True})
    loaded_ms = (time.perf_counter() - PROCESS_STARTED) * 1000
    loaded_rss = peak_rss_bytes()

    def score(text):
        # Timing includes actual tokenization, encoder, normalization and numeric head/search.
        vector = encoder.encode([text], batch_size=1, normalize_embeddings=True, show_progress_bar=False)[0]
        if mode == "similarity":
            similarities = head["embeddings"] @ vector
            return np.array([similarities[head["labels"] == label].max()
                             for label in range(len(benchmark.CLASSES))], dtype=np.float64)
        return vector @ head["weights"].T + head["intercept"]

    started = time.perf_counter()
    score("人工暖機，不是測試答案")
    first_ms = (time.perf_counter() - started) * 1000
    for _ in range(5):
        score("人工暖機，不是測試答案")
    rows = benchmark.corpus()
    validation = [row for row in rows if row["split"] == "validation"]
    validation_scores = np.array([score(row["utterance"]) for row in validation])
    validation_labels = np.array([benchmark.CLASSES.index(row["class"]) for row in validation])
    calibration = fit_temperature(validation_scores, validation_labels)
    records = []
    for row in [row for row in rows if row["split"] == "test"]:
        trials, measured_score = [], None
        for _ in range(3):
            started = time.perf_counter()
            measured_score = score(row["utterance"])
            # Include final softmax/calibration in the measured turn cost.
            probabilities = softmax(measured_score, calibration["temperature"])
            label = int(np.argmax(probabilities))
            trials.append((time.perf_counter() - started) * 1000)
        raw_probabilities = None if mode == "similarity" else softmax(measured_score, 1)
        raw_confidence = float(np.clip(measured_score[label], 0, 1)) if mode == "similarity" else float(raw_probabilities[label])
        records.append({"id": row["id"], "scores": measured_score.tolist(),
                        "prediction": {"class": benchmark.CLASSES[label],
                                       "confidence": float(probabilities[label]),
                                       "latency_ms": float(np.median(trials))},
                        "probabilities": dict(zip(benchmark.CLASSES, probabilities.tolist())),
                        "raw_prediction": {"class": benchmark.CLASSES[label], "confidence": raw_confidence,
                                           "latency_ms": float(np.median(trials))},
                        "raw_probabilities": dict(zip(benchmark.CLASSES, raw_probabilities.tolist()))
                        if raw_probabilities is not None else {}, "latency_trials_ms": trials})
    weights_bytes = sum(parameter.numel() * parameter.element_size() for parameter in encoder.parameters())
    bundle = {"model_kind": f"minilm_{mode}_calibrated", "dataset": settings["dataset"], "split": "test",
              "calibration": calibration, "training": settings, "versions": versions(),
              "inference_device": "cpu", "inference_threads": 1, "latency_repeats_per_turn": 3,
              "latency_statistic": "median of three actual single-turn calls; no embedding cache",
              "cached_model_process_load_ms": loaded_ms, "first_inference_ms": first_ms,
              "process_peak_rss_after_load_bytes": loaded_rss,
              "process_peak_rss_after_inference_bytes": peak_rss_bytes(),
              "model_parameter_bytes": weights_bytes,
              "parameters": sum(parameter.numel() for parameter in encoder.parameters()),
              "hardware": {"platform": platform.platform(), "machine": platform.machine(),
                           "logical_cpus": os.cpu_count()}, "records": records}
    save_json(ROOT / "results" / f"{mode}Test.json", bundle)
    print(json.dumps({"mode": mode, "load_ms": loaded_ms, "first_inference_ms": first_ms,
                      "peak_rss_bytes": bundle["process_peak_rss_after_inference_bytes"]}), flush=True)


def measure():
    """Launch fresh workers sequentially; parent wall time records full process cold start."""
    for mode in MODES:
        output = ROOT / "results" / f"{mode}Test.json"
        if output.exists():
            raise ValueError("Measurement exists; use a fresh experiment rather than overwrite it")
        started = time.perf_counter()
        subprocess.run([sys.executable, str(Path(__file__).resolve()), "worker", "--mode", mode], check=True)
        wall_ms = (time.perf_counter() - started) * 1000
        bundle = benchmark.read_json(output)
        bundle["cold_process_full_benchmark_wall_ms"] = wall_ms
        # The worker's process_load_ms stops at model load, before warm-up/validation/test.
        bundle["cold_start_semantics"] = "fresh interpreter, cached model, imports+load; OS disk cache not flushed"
        save_json(output, bundle)
        raw = {**bundle, "model_kind": f"minilm_{mode}_raw",
               "records": [{**record, "prediction": record["raw_prediction"],
                            "probabilities": record["raw_probabilities"]} for record in bundle["records"]]}
        save_json(ROOT / "results" / f"{mode}RawTest.json", raw)


def calibrate_jev():
    """Fit validation-only temperature on valid Jev vectors; never change chosen labels."""
    import numpy as np

    validation = benchmark.read_json(ROOT / "results" / "jevValidation.json")
    test = benchmark.read_json(ROOT / "results" / "jevTest.json")
    rows = benchmark.corpus()
    for bundle, split in ((validation, "validation"), (test, "test")):
        expected = {row["id"] for row in rows if row["split"] == split}
        if (bundle["dataset"] != benchmark.audit(rows) or bundle["split"] != split
                or {record["id"] for record in bundle["records"]} != expected
                or len(bundle["records"]) != len(expected)):
            raise ValueError("Jev calibration needs complete, matching validation and test sets")
    if validation["prompt_sha256"] != test["prompt_sha256"]:
        raise ValueError("Jev calibration prompt mismatch")
    gold = {row["id"]: benchmark.CLASSES.index(row["class"]) for row in rows}

    def logits(record):
        if not benchmark.prediction_ok(record) or set(record.get("probabilities", {})) != set(benchmark.CLASSES):
            raise ValueError("Jev calibration needs valid complete probability vectors")
        vector = np.array([record["probabilities"][label] for label in benchmark.CLASSES])
        if not np.isfinite(vector).all() or (vector < 0).any() or (vector > 1).any() or abs(vector.sum() - 1) > .001:
            raise ValueError("Jev vector is not a rounding-valid posterior")
        if benchmark.CLASSES[int(vector.argmax())] != record["prediction"]["class"]:
            raise ValueError("Jev reported choice and vector argmax differ")
        # Positive T preserves argmax; tiny epsilon only permits logarithm of rounded zeros.
        return np.log(np.maximum(vector, 1e-12))

    calibration = fit_temperature(np.array([logits(record) for record in validation["records"]]),
                                  np.array([gold[record["id"]] for record in validation["records"]]))
    result = {**test, "model_kind": "jev_eight_class_calibrated", "calibration": calibration,
              "raw_confidence_semantics": "provider confidence; not directly fitted by posterior temperature",
              "records": []}
    for record in test["records"]:
        probabilities = softmax(logits(record), calibration["temperature"])
        label = benchmark.CLASSES.index(record["prediction"]["class"])
        result["records"].append({**record, "prediction": {**record["prediction"],
                                      "confidence": float(probabilities[label])},
                                  "probabilities": dict(zip(benchmark.CLASSES, probabilities.tolist()))})
    target = ROOT / "results" / "jevCalibratedTest.json"
    if target.exists():
        raise ValueError("Calibration output already exists")
    save_json(target, result)
    print(json.dumps({"jev_calibration": calibration}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("experiment", "prepare", "train", "measure", "worker", "calibrate-jev"))
    parser.add_argument("--mode", choices=MODES)
    args = parser.parse_args()
    if args.command == "experiment":
        prepare()
        train()
        measure()
    elif args.command == "prepare":
        prepare()
    elif args.command == "train":
        train()
    elif args.command == "measure":
        measure()
    elif args.command == "worker":
        if args.mode is None:
            parser.error("worker requires --mode")
        measure_worker(args.mode)
    else:
        calibrate_jev()


if __name__ == "__main__":
    main()
