"""Real OpenVINO inference; CPU is an explicit development target only."""
from pathlib import Path
import os

import numpy as np
import pytest

from uma8_frontend.denoise import UlUnas

MODEL = Path(__file__).resolve().parents[1] / "models/ulunas_stream.onnx"


# Report: this chat's Windows screenshot, 2026-11-18; ReduceFCDimensions
# loses VariadicSplit output 1 while compiling MatMul_22 on the Intel GPU.
# The returned 0.4.3 GPU report proves rank reduction is undone by GPU passes.
def test_compilation_folds_tail_slices_into_linear_weights_without_changing_public_shapes(monkeypatch):
    import openvino as ov

    compile_model = ov.Core.compile_model
    compiled = []

    def inspect_compile(self, graph, device_name, config):
        # Inspect the actual model at the compiler boundary, then perform real
        # CPU compilation. This host cannot execute the Intel GPU plugin.
        projections = {"MatMul_22": 257, "MatMul_5331": 129}
        found = set()
        for node in graph.get_ordered_ops():
            if node.get_type_name() == "MatMul":
                for name, features in projections.items():
                    if node.friendly_name.startswith(name):
                        assert node.input_value(0).shape[-1] == features, node.friendly_name
                        assert node.input_value(1).shape[0] == features, node.friendly_name
                        assert node.input_value(0).get_node().get_type_name() not in ("Slice", "StridedSlice", "VariadicSplit", "Reshape")
                        found.add(name)
        assert found == set(projections)
        compiled.append(graph)
        return compile_model(self, graph, device_name, config)

    monkeypatch.setattr(ov.Core, "compile_model", inspect_compile)
    model = UlUnas(MODEL, provider="cpu")
    assert len(compiled) == 1
    assert list(model.session.input("mix").shape) == [1, 257, 1, 2]
    assert list(model.session.output("enh").shape) == [1, 257, 1, 2]
    assert len(model.request.query_state()) == 3


def test_openvino_stream_matches_original_onnx_recurrence_and_reset():
    import onnxruntime as ort

    # Keep an independent reference runtime in tests, never in the EXE. Harmonic
    # spectra exercise masks above the attenuation floor, unlike pure noise.
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = opts.inter_op_num_threads = 1
    reference = ort.InferenceSession(str(MODEL), sess_options=opts, providers=["CPUExecutionProvider"])
    model = UlUnas(MODEL, provider="cpu")
    assert model.diagnostics["runtime"] == "OpenVINO"
    assert model.diagnostics["active_providers"] == ["CPU"]
    assert model.diagnostics["gpu_verified"] is False
    assert len(model.session.create_infer_request().query_state()) == 3
    t = np.arange(512) / 16000
    spectra = [np.fft.rfft(sum(.2 / k * np.sin(2*np.pi*(173+i)*k*t) for k in range(1, 12))).astype(np.complex64)
               for i in range(64)]
    for sequence in (spectra, spectra[:8]):
        model.reset()
        caches = {name: np.zeros(shape, np.float32) for name, shape in
                  [("conv_cache", (1, 5358)), ("tfa_cache", (1, 402)), ("inter_cache", (1, 1056))]}
        for spectrum in sequence:
            spec = np.stack((spectrum.real, spectrum.imag), axis=-1)[None, :, None, :].astype(np.float32)
            enh, *state = reference.run(["enh", "conv_cache_out", "tfa_cache_out", "inter_cache_out"], {"mix": spec, **caches})
            caches = dict(zip(caches, state))
            # Compare the raw enhancement too: mask clipping must not hide an
            # incorrect state mapping or a runtime precision discrepancy.
            result = model.process(spectrum)
            np.testing.assert_allclose(model.request.get_tensor("enh").data, enh, rtol=2e-3, atol=1e-4)
            y = enh[0, :, 0, 0] + 1j*enh[0, :, 0, 1]
            expected = spectrum * np.clip(abs(y)/np.maximum(abs(spectrum), 1e-12), model.floor, 1)
            np.testing.assert_allclose(result, expected, rtol=2e-3, atol=1e-4)


def test_openvino_gpu_failure_never_retries_with_auto_or_cpu(monkeypatch):
    import openvino as ov

    attempts = []
    def fail_compile(self, graph, device_name, config):
        attempts.append((device_name, config))
        raise RuntimeError("test GPU compilation failure")
    monkeypatch.setattr(ov.Core, "compile_model", fail_compile)
    with pytest.raises(RuntimeError, match="test GPU compilation failure"):
        UlUnas(MODEL)
    assert len(attempts) == 1
    assert attempts[0][0] == "GPU.0"
    assert attempts[0][1]["PERFORMANCE_HINT"] == "LATENCY"
    assert attempts[0][1]["INFERENCE_PRECISION_HINT"] == ov.Type.f32


def test_openvino_rejects_obsolete_or_unknown_backends():
    for provider in ("directml", "auto", "typo"):
        with pytest.raises(ValueError, match="provider"):
            UlUnas(MODEL, provider=provider)


def test_openvino_does_not_report_a_cpu_compilation_as_gpu(monkeypatch):
    import openvino as ov

    compile_model = ov.Core.compile_model
    def compile_on_cpu(self, graph, device_name, config):
        return compile_model(self, graph, "CPU", {**config, "INFERENCE_NUM_THREADS": 1})
    monkeypatch.setattr(ov.Core, "compile_model", compile_on_cpu)
    with pytest.raises(RuntimeError, match="GPU execution was not verified"):
        UlUnas(MODEL)


@pytest.mark.skipif(os.environ.get("KIOSK_AUDIO_TEST_GPU") != "1", reason="Explicit physical Intel GPU qualification only")
def test_physical_openvino_gpu_matches_cpu_stream_and_reset():
    gpu = UlUnas(MODEL)
    cpu = UlUnas(MODEL, provider="cpu")
    assert gpu.diagnostics["gpu_verified"]
    assert gpu.diagnostics["active_providers"] == ["GPU.0"]
    assert gpu.diagnostics["gpu_nodes"] > 0
    rng = np.random.default_rng(781)
    spectra = (rng.normal(size=(64, 257)) + 1j*rng.normal(size=(64, 257))).astype(np.complex64)
    for sequence in (spectra, spectra[:8]):
        gpu.reset()
        cpu.reset()
        for spectrum in sequence:
            np.testing.assert_allclose(gpu.process(spectrum), cpu.process(spectrum), rtol=2e-3, atol=1e-4)
