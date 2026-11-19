"""Probe the bundled model without microphone capture or existing profile changes."""
import argparse
import hashlib
import importlib.util
import json
import locale
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
import time
import traceback


def describe_error(error, ansi_encoding=None):
    """Preserve native error bytes when a Python binding cannot decode them.

    The optional Windows ANSI interpretation is diagnostic text only. It never
    changes model inputs, profile JSON parsing or GPU verification decisions.
    """
    chain = []
    seen = set()
    while error is not None and id(error) not in seen:
        seen.add(id(error))
        details = {"type": type(error).__name__, "message": str(error)}
        if isinstance(error, UnicodeDecodeError):
            details["decodeFailure"] = {
                "encoding": error.encoding,
                "start": error.start,
                "end": error.end,
                "reason": error.reason,
                "rawHex": error.object.hex(),
            }
            if ansi_encoding:
                # Windows native errors can contain localized ANSI text even
                # when the binding expects UTF-8. Retain other bytes as escapes.
                details["decodeFailure"]["windowsAnsiEncoding"] = ansi_encoding
                details["decodeFailure"]["windowsAnsiText"] = error.object.decode(
                    ansi_encoding, errors="backslashreplace")
        chain.append(details)
        if error.__cause__ is not None:
            error = error.__cause__
        elif not error.__suppress_context__:
            error = error.__context__
        else:
            error = None
    details = chain[0]
    if len(chain) > 1:
        details["chainedErrors"] = chain[1:]
    return details


def main():
    """Write a UTF-8 report even when native initialization or its codec fails."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audio-root", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--candidate-denoiser", type=Path,
                        help="Probe an explicitly supplied replacement module without installing it.")
    parser.add_argument("--reference", type=Path, help="Pinned synthetic spectral-output parity fixture.")
    parser.add_argument("--sweep", action="store_true", help="Compare isolated GPU execution configurations.")
    parser.add_argument("--precision", choices=("f32", "f16"), default="f32")
    parser.add_argument("--provider", choices=("openvino", "cpu"), default="openvino",
                        help="CPU is explicit development validation only; no automatic retry.")
    args = parser.parse_args()
    if args.sweep:
        if args.candidate_denoiser is None or args.reference is None:
            parser.error("The sweep requires an explicit candidate and reference fixture")
        return run_sweep(args)
    audio = args.audio_root.resolve()
    report = {
        "success": False,
        "requestedProvider": args.provider,
        "stage": "imports",
        "python": sys.version,
        "platform": platform.platform(),
        "preferredEncoding": locale.getpreferredencoding(False),
        "audioRoot": str(audio),
        "microphoneRequested": False,
        "existingProfileModified": False,
    }
    execution = {"precision": args.precision}
    report["executionOptions"] = execution
    model = None
    try:
        sys.path.insert(0, str(audio / "src"))
        import openvino as ov
        from uma8_frontend.denoise import UlUnas

        if args.candidate_denoiser is not None:
            # Qualification uses the supplied release module in this process
            # only. Leave the installed EXE, Python source and manifests intact.
            candidate = args.candidate_denoiser.resolve()
            spec = importlib.util.spec_from_file_location("gpu_candidate_denoise", candidate)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            UlUnas = module.UlUnas
            report["candidateSha256"] = hashlib.sha256(candidate.read_bytes()).hexdigest()

        report["openvino"] = ov.__version__
        report["availableProviders"] = list(ov.Core().available_devices)
        report["modelSha256"] = hashlib.sha256((audio / "models/ulunas_stream.onnx").read_bytes()).hexdigest()
        report["stage"] = "model-initialization-and-gpu-verification"
        # No capture, persistent model cache or installation calibration is opened.
        model = UlUnas(audio / "models/ulunas_stream.onnx", provider=args.provider,
                       **execution)
        report["diagnostics"] = model.diagnostics
        if args.provider == "openvino" and not model.diagnostics["gpu_verified"]:
            raise RuntimeError("The probe did not verify GPU kernel execution")
        import numpy as np
        if args.reference is not None:
            report["stage"] = "synthetic-output-parity"
            with np.load(args.reference, allow_pickle=False) as reference:
                if str(reference["model_sha256"]) != report["modelSha256"]:
                    raise ValueError("Reference fixture is for another model")
                spectra = reference["spectra"]
                expected = reference["outputs"]
                model.reset()
                observed = []
                raw = []
                for spectrum in spectra:
                    observed.append(model.process(spectrum))
                    raw.append(model.request.get_tensor("enh").data.copy())
                observed = np.stack(observed)
                raw = np.stack(raw)
                raw_equivalent = bool(np.allclose(raw, reference["raw_enh"], rtol=2e-3, atol=1e-4))
                equivalent = raw_equivalent and bool(np.allclose(observed, expected, rtol=2e-3, atol=1e-4))
                report["equivalence"] = {
                    "passed": equivalent, "rawEnhancementPassed": raw_equivalent, "frames": len(spectra),
                    "scope": "Raw enhancement and mask-limited synthetic spectral output; not speech quality",
                    "maxAbsoluteError": float(np.max(abs(observed-expected))),
                    "relativeTolerance": 2e-3, "absoluteTolerance": 1e-4,
                }
                if not equivalent:
                    raise RuntimeError("GPU candidate disagrees with the pinned CPU spectral reference")
            model.reset()
        report["stage"] = "steady-state-model-timing"
        # Nonzero, changing audio exercises recurrent inference and readback;
        # timed samples are not just a silent startup warm-up.
        t = np.arange(512) / 16000
        benchmark = [np.fft.rfft(sum(.2/k*np.sin(2*np.pi*(173+i)*k*t) for k in range(1, 12))).astype(np.complex64)
                     for i in range(64)]
        spectrum = benchmark[0]
        for _ in range(8):
            model.process(spectrum)
        timings = []
        for index in range(1024):
            before = time.perf_counter()
            result = model.process(benchmark[index % len(benchmark)])
            timings.append((time.perf_counter() - before) * 1000)
            if not np.isfinite(result).all():
                raise RuntimeError("Non-finite qualification output")
        report["timing"] = {
            "scope": "UL-UNAS only; excludes capture/AEC/RTF/ASR",
            "frames": len(timings),
            "frameBudgetMs": 16,
            "meanMs": float(np.mean(timings)),
            "p95Ms": float(np.percentile(timings, 95)),
            "maxMs": max(timings),
            "meanWithinFrameBudget": bool(np.mean(timings) < 16),
            "p95WithinFrameBudget": bool(np.percentile(timings, 95) < 16),
        }
        report["modelBudgetPassed"] = report["timing"]["meanWithinFrameBudget"] and report["timing"]["p95WithinFrameBudget"]
        report["fullPipelineValidated"] = False
        report["success"] = True
        report["stage"] = "complete"
    except Exception as error:
        report["error"] = describe_error(error, "mbcs" if sys.platform == "win32" else None)
        report["traceback"] = traceback.format_exc()
    finally:
        model = None
    # This file uses UTF-8 explicitly; native stdout/stderr can use another code
    # page and are captured separately by the CMD launcher.
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"success": report["success"], "report": str(args.report)}, ensure_ascii=True))
    return 0 if report["success"] else 1


def run_sweep(args):
    """Isolate each native session in a child; a failure never changes backend.

    One unique details directory correlates this run's reports and stderr. A
    timeout kills its child, retains the log and proceeds to the next setting.
    The summary proposes a capture trial only after parity and model timing
    pass; it never installs a winner or certifies the whole audio pipeline.
    """
    details = Path(tempfile.mkdtemp(prefix="openvino-test-", dir=args.report.resolve().parent))
    results = []
    for precision in ("f32", "f16"):
        print("Testing OpenVINO GPU " + precision, flush=True)
        child_report = details / (precision + ".json")
        log_path = details / (precision + ".log")
        command = [sys.executable, "-B", "-u", str(Path(__file__).resolve()),
                   "--audio-root", str(args.audio_root.resolve()),
                   "--candidate-denoiser", str(args.candidate_denoiser.resolve()),
                   "--reference", str(args.reference.resolve()),
                   "--report", str(child_report), "--provider", args.provider, "--precision", precision]
        try:
            with log_path.open("wb") as log:
                child = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, timeout=180)
            if not child_report.is_file():
                raise RuntimeError(f"Probe exited {child.returncode} without a report; see {log_path.name}")
            result = json.loads(child_report.read_text(encoding="utf-8"))
            if child.returncode != 0:
                result["success"] = False
        except Exception as error:
            result = {"success": False, "error": describe_error(error)}
        result["case"] = precision
        results.append(result)
    verified = [result for result in results if result["success"]
                and result["diagnostics"]["gpu_verified"] and result["equivalence"]["passed"]]
    eligible = [result for result in verified if result["timing"]["meanWithinFrameBudget"]
                and result["timing"]["p95WithinFrameBudget"]]
    summary = {"requestedProvider": args.provider, "cases": results,
               "detailsDirectory": str(details), "verifiedGpuCases": len(verified),
               "modelBudgetPassedCases": len(eligible),
               "recommendedForCaptureTrial": min(eligible, key=lambda result: result["timing"]["p95Ms"])["case"] if eligible else None,
               "fullPipelineValidated": False, "installedFilesModified": False}
    args.report.write_text(json.dumps(summary, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    print(json.dumps({"report": str(args.report), "modelBudgetPassedCases": len(eligible)}))
    return 0 if eligible else 1


if __name__ == "__main__":
    raise SystemExit(main())
