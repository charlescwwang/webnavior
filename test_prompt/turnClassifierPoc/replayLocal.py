"""Inference-only new challenge set; reuses frozen models and validation temperatures."""

import hashlib
import json
import time

import benchmark
import runLocal


def main():
    import numpy as np
    import torch
    from sentence_transformers import SentenceTransformer

    source = runLocal.ROOT / "resolverScenarios.json"
    target = runLocal.ROOT / "results" / "resolverPredictions.json"
    if target.exists():
        raise ValueError("Results exist; preserve the original challenge run")
    rows = benchmark.read_json(source)["scenarios"]
    assert len(rows) == 40 and len({row["id"] for row in rows}) == 40
    # Paired utterances intentionally differ only by context. The encoder receives
    # no setup or expected action; its predictions cannot secretly resolve context.
    bundle = {"scenario_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
              "training_dataset": benchmark.audit(benchmark.corpus()), "modes": {}}
    torch.set_num_threads(1)
    for mode in ("frozen", "setfit"):
        settings = benchmark.read_json(runLocal.ROOT / "models" / mode / "settings.json")
        measured = benchmark.read_json(runLocal.ROOT / "results" / f"{mode}Test.json")
        assert settings["dataset"] == bundle["training_dataset"]
        calibration = measured["calibration"]
        assert calibration["fit_split"] == "validation"
        head = np.load(runLocal.ROOT / "models" / mode / "head.npz", allow_pickle=False)
        encoder = SentenceTransformer(settings["encoder_path"], device="cpu", local_files_only=True,
                                      trust_remote_code=False, model_kwargs={"use_safetensors": True})
        encoder.encode(["人工暖機，非測試內容"], normalize_embeddings=True, show_progress_bar=False)
        records = []
        for row in rows:
            trials = []
            for _ in range(3):
                started = time.perf_counter()
                vector = encoder.encode([row["transcript"]], batch_size=1, normalize_embeddings=True,
                                        show_progress_bar=False)[0]
                probabilities = runLocal.softmax(vector @ head["weights"].T + head["intercept"],
                                                  calibration["temperature"])
                label = int(probabilities.argmax())
                trials.append((time.perf_counter() - started) * 1000)
            records.append({"id": row["id"], "prediction": {"class": benchmark.CLASSES[label],
                            "confidence": float(probabilities[label]), "latency_ms": float(np.median(trials))}})
        bundle["modes"][mode] = {"calibration": calibration, "records": records}
        del encoder
    runLocal.save_json(target, bundle)
    print(json.dumps({"scenarios": len(rows), "sha256": bundle["scenario_sha256"],
                      "output": str(target)}))


if __name__ == "__main__":
    main()
