"""UL-UNAS on OpenVINO with request-owned recurrent state and an explicit device."""
from pathlib import Path
import numpy as np


def _fold_sliced_matmuls(graph):
    """Express a tail-sliced linear projection using zero-padded weights."""
    from openvino import opset13 as ops
    from openvino.passes import ConstantFolding, Manager

    # ONNX stores the trained weights behind constant Transpose operations.
    # Resolve constant-only expressions before inspecting their coefficient rows.
    constants = Manager()
    constants.register_pass(ConstantFolding())
    constants.run_passes(graph)
    for node in graph.get_ordered_ops():
        if node.get_type_name() != "MatMul":
            continue
        attributes = node.get_attributes()
        if attributes["transpose_a"] or attributes["transpose_b"]:
            continue
        sliced = node.input_value(0).get_node()
        weights = node.input_value(1).get_node()
        if sliced.get_type_name() != "Slice" or weights.get_type_name() != "Constant":
            continue
        data = sliced.input_value(0)
        if data.partial_shape.is_dynamic or len(weights.output(0).shape) != 2 or sliced.get_input_size() != 5:
            continue
        parameters = [sliced.input_value(i).get_node() for i in range(1, 5)]
        if any(value.get_type_name() != "Constant" or value.get_data().size != 1 for value in parameters):
            continue
        start, stop, step, axis = (int(value.get_data().item()) for value in parameters)
        shape = list(data.shape)
        if step != 1 or not -len(shape) <= axis < len(shape) or axis % len(shape) != len(shape)-1:
            continue
        stop = min(stop, shape[-1])
        coefficients = weights.get_data()
        if not 0 <= start < stop or stop-start != coefficients.shape[0]:
            continue

        # NOTICE: OpenVINO 2026.4.1 ReduceFCDimensions loses a VariadicSplit
        # output index (upstream reduce_fc_dimensions.cpp:27,39):
        # https://github.com/openvinotoolkit/openvino/blob/releases/2026/4/src/plugins/intel_gpu/src/plugin/transformations/reduce_fc_dimensions.cpp
        #
        # GPU MoveFCReshapeToWeights undoes the former rank-only workaround,
        # as confirmed by the Windows 0.4.3 report. Remove the slice dependency
        # itself instead: x[..., start:stop] @ W == x @ pad_rows(W).
        # Zero rows exclude the same finite spectral bins without moving or
        # reordering trained coefficients. The GPU FC input is now a single
        # output operation, so it no longer needs a default output of Split.
        # Remove this rewrite once the pinned GPU pass preserves output ports.
        expanded = np.pad(coefficients, ((start, shape[-1]-stop), (0, 0)))
        projection = ops.matmul(data, ops.constant(expanded), False, False)
        projection.friendly_name = node.friendly_name
        projection.output(0).get_tensor().set_names(node.output(0).get_names())
        node.output(0).replace(projection.output(0))
    graph.validate_nodes_and_infer_types()


class UlUnas:
    """One sequential audio stream; reset between captures, never between hops."""
    def __init__(self, model, floor_db=-12.0, enabled=True, *, provider="openvino", device_id=0,
                 precision="f32"):
        self.enabled = enabled
        self.floor = 10 ** (floor_db / 20)
        self.session = None
        if not enabled:
            # Explicit diagnostic bypass must neither load OpenVINO nor claim
            # GPU execution. reset()/process() retain the normal stream contract.
            self.diagnostics = dict(runtime='Bypass', requested_provider='disabled',
                                    active_providers=[], available_providers=[], gpu_verified=False,
                                    gpu_nodes=0, cpu_nodes=0, precision='none', device_name='UL-UNAS bypass test')
            return
        if provider not in ("openvino", "cpu"):
            raise ValueError("Unknown OpenVINO inference provider")
        if type(device_id) is not int or device_id < 0 or precision not in ("f32", "f16"):
            raise ValueError("Invalid OpenVINO device or precision")
        if not Path(model).is_file():
            raise FileNotFoundError(f"UL-UNAS ONNX missing: {model}")
        import openvino as ov
        from openvino.passes import MakeStateful, Manager

        self.core = ov.Core()
        self.provider = f"GPU.{device_id}" if provider == "openvino" else "CPU"
        graph = self.core.read_model(str(model))
        expected = {"mix": [1, 257, 1, 2], "conv_cache": [1, 5358], "tfa_cache": [1, 402], "inter_cache": [1, 1056]}
        inputs = {port.get_any_name(): port for port in graph.inputs}
        outputs = {port.get_any_name(): port for port in graph.outputs}
        shapes = {"enh": expected["mix"], **{name+"_out": shape for name, shape in expected.items() if name != "mix"}}
        for ports, contract in ((inputs, expected), (outputs, shapes)):
            if set(ports) != set(contract):
                raise ValueError("Model is not the official frame-wise UL-UNAS graph")
            for name, shape in contract.items():
                port = ports[name]
                if port.element_type != ov.Type.f32 or port.partial_shape.is_dynamic or list(port.shape) != shape:
                    raise ValueError(f"UL-UNAS tensor mismatch: {name} {port.partial_shape}")

        _fold_sliced_matmuls(graph)

        # The ONNX carries three caches as input/output pairs. Keep them in the
        # InferRequest on its chosen device rather than copying to Python every
        # 16 ms. This preserves the recurrence, not the model weights.
        # https://docs.openvino.ai/2026/openvino-workflow/running-inference/inference-request/stateful-models/obtaining-stateful-openvino-model.html
        manager = Manager()
        manager.register_pass(MakeStateful({name: name+"_out" for name in expected if name != "mix"}))
        manager.run_passes(graph)
        config = {"PERFORMANCE_HINT": "LATENCY", "NUM_STREAMS": "1", "PERF_COUNT": True,
                  "INFERENCE_PRECISION_HINT": ov.Type.f32 if precision == "f32" else ov.Type.f16}
        if provider == "cpu":
            config["INFERENCE_NUM_THREADS"] = 1
        # Compile the exact GPU, never AUTO/HETERO. A native error propagates;
        # there is no DirectML or CPU retry in the packaged execution path.
        self.session = self.core.compile_model(graph, self.provider, config)
        self.request = self.session.create_infer_request()
        if len(self.request.query_state()) != 3:
            raise RuntimeError("OpenVINO recurrent state contract mismatch")
        self.reset()
        self.process(np.zeros(257, np.complex64))
        active = list(self.session.get_property("EXECUTION_DEVICES"))
        executed = [event for event in self.request.get_profiling_info()
                    if event.status == ov.ProfilingInfo.Status.EXECUTED]
        verified = provider == "openvino" and active == [self.provider] and bool(executed)
        if provider == "openvino" and not verified:
            raise RuntimeError(f"OpenVINO GPU execution was not verified: {active}")
        self.diagnostics = dict(runtime="OpenVINO", runtime_version=ov.__version__,
                                requested_provider=self.provider, available_providers=list(self.core.available_devices),
                                active_providers=active, gpu_verified=verified,
                                gpu_nodes=len(executed) if verified else 0,
                                cpu_nodes=len(executed) if provider == "cpu" else 0,
                                device_id=device_id, precision=precision,
                                device_name=self.core.get_property(self.provider, "FULL_DEVICE_NAME"))
        self.reset()

    def reset(self):
        """Clear all recurrent states while retaining the compiled device model."""
        if self.session is not None:
            for state in self.request.query_state():
                state.reset()

    def process(self, spectrum):
        if not self.enabled:
            return spectrum.copy()
        spec = np.stack((spectrum.real, spectrum.imag), axis=-1)[None, :, None, :].astype(np.float32)
        # Synchronous completion serializes state updates and makes GPU readback
        # part of measured hop time. Input stays alive until infer returns.
        self.request.infer({"mix": spec}, share_inputs=True, share_outputs=True)
        enh = self.request.get_tensor("enh").data
        if not np.isfinite(enh).all():
            raise RuntimeError("Non-finite model output")
        y = enh[0, :, 0, 0] + 1j * enh[0, :, 0, 1]
        # Bound attenuation in the same STFT frame to preserve input phase and
        # avoid a time-misaligned wet/dry blend. This is unchanged from ORT.
        mask = np.clip(np.divide(np.abs(y), np.maximum(np.abs(spectrum), 1e-12)), self.floor, 1.0)
        out = spectrum * mask
        if not np.isfinite(out).all():
            raise RuntimeError("Non-finite enhanced spectrum")
        return out.astype(np.complex64)
