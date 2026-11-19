import io
import json
import struct
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

from uma8_frontend.worker import Worker, read_frame, write_frame

ROOT = Path(__file__).resolve().parents[1]


def test_binary_envelope_retains_float_precision_and_correlation():
    stream = io.BytesIO()
    samples = np.array([1e-8, -.5, .1234567], np.float32)
    write_frame(stream, {"id": 37, "kind": "block"}, samples)
    stream.seek(0)
    meta, pcm = read_frame(stream)
    assert meta["id"] == 37
    np.testing.assert_array_equal(np.frombuffer(pcm, dtype="<f4"), samples)
    assert read_frame(stream) is None


def test_binary_envelope_rejects_truncation_and_unbounded_payloads():
    with pytest.raises(EOFError):
        read_frame(io.BytesIO(struct.pack("<II", 10, 0)+b"{}"))
    with pytest.raises(ValueError, match="size"):
        read_frame(io.BytesIO(struct.pack("<II", 1, 3*1024*1024)))


def test_real_worker_starts_without_anchor_and_processes_without_an_external_service(tmp_path):
    worker = Worker(tmp_path, ROOT / "hush")
    status, _ = worker.handle({"kind": "status"}, b"")
    assert status["state"] == "automatic"
    assert status["requested_provider"] == "CPU"
    model = worker.denoiser.handle
    assert not (tmp_path / "target_rtf.npz").exists()
    worker.handle(dict(kind="start", generation="capture", channels=list(range(7)), gainDb=0, hush=dict(attenuationDb=100, dryMixPercent=0)), b"")
    assert worker.denoiser.handle is model
    emitted = 0
    for offset in range(0, 48000, 384):
        planes = np.zeros((10, 384), np.float32)
        reply, pcm = worker.handle(dict(kind="block", generation="capture", offsetFrames=offset), planes.tobytes())
        for frame in reply["frames"]:
            assert frame["offsetSamples"] == emitted
            emitted += frame["length"]
        assert np.isfinite(pcm).all()
    assert emitted > 14000
    assert len(worker.pending) < 160
    worker.handle(dict(kind="stop", generation="install"), b"")
    assert worker.generation == "capture"
    worker.handle(dict(kind="stop", generation="capture"), b"")
    assert worker.generation is None




def test_entry_keeps_python_and_native_import_diagnostics_out_of_binary_pipe(tmp_path):
    # Inject real stdout writes at the external library import boundary, rather
    # than substituting the worker or Hush session. Native startup can print here.
    launcher = tmp_path / "diagnostic_startup.py"
    launcher.write_text(f'''
import atexit
import ctypes
import os
import runpy
import sys
sys.path.insert(0, {str(ROOT / "src")!r})
emitted = False
def diagnostic(event, args):
    global emitted
    if event == "ctypes.dlopen" and str(args[0]).endswith(("libweya_nc.so", "weya_nc.dll")) and not emitted:
        emitted = True
        print("EP initialization diagnostic", flush=True)
        os.write(1, b"native descriptor diagnostic\\n")
        if sys.platform == "win32":
            from ctypes import wintypes
            kernel = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel.GetStdHandle.argtypes = [wintypes.DWORD]
            kernel.GetStdHandle.restype = wintypes.HANDLE
            kernel.WriteFile.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p]
            kernel.WriteFile.restype = wintypes.BOOL
            message = b"Win32 handle diagnostic\\n"
            count = wintypes.DWORD()
            if not kernel.WriteFile(kernel.GetStdHandle(-11), message, len(message), ctypes.byref(count), None):
                raise ctypes.WinError(ctypes.get_last_error())
atexit.register(lambda: print("shutdown diagnostic", flush=True))
sys.addaudithook(diagnostic)
runpy.run_path({str(ROOT / "src/entry.py")!r}, run_name="__main__")
''', encoding="utf-8")
    request = io.BytesIO()
    for request_id in (1, 2):
        write_frame(request, {"id": request_id, "kind": "status"}, [])
    result = subprocess.run(
        [sys.executable, "-B", "-u", str(launcher), "--state-dir", str(tmp_path / "state"),
         "--model", str(ROOT / "hush")],
        input=request.getvalue(), capture_output=True, timeout=30, check=True,
    )
    replies = io.BytesIO(result.stdout)
    first, pcm = read_frame(replies)
    assert first["id"] == 1
    assert first["ok"]
    assert first["result"]["requested_provider"] == "CPU"
    assert pcm == b""
    second, _ = read_frame(replies)
    assert second["id"] == 2
    assert read_frame(replies) is None
    assert b"EP initialization diagnostic" in result.stderr
    assert b"native descriptor diagnostic" in result.stderr
    assert b"shutdown diagnostic" in result.stderr
    if sys.platform == "win32":
        assert b"Win32 handle diagnostic" in result.stderr






def test_entry_returns_original_startup_failure_as_a_correlated_response(tmp_path):
    request = io.BytesIO()
    write_frame(request, {"id": 71, "kind": "status"}, [])
    result = subprocess.run(
        [sys.executable, "-B", "-u", str(ROOT / "src/entry.py"),
         "--state-dir", str(tmp_path), "--model", str(tmp_path / "missing")],
        input=request.getvalue(), capture_output=True, timeout=30, check=True,
    )
    replies = io.BytesIO(result.stdout)
    response, pcm = read_frame(replies)
    assert response["id"] == 71
    assert not response["ok"]
    assert "Hush native library or model bundle is missing" in response["error"]
    assert pcm == b""
    assert read_frame(replies) is None
    assert b"Hush native library or model bundle is missing" in result.stderr





# Report: this chat, 2026-11-19 — LCMV needs native input without loading Hush/RTF.
def test_capture_only_worker_preserves_all_eight_channels_and_reference_without_model(tmp_path, monkeypatch):
    from uma8_frontend import native_device
    from uma8_frontend.worker import InputWorker
    from test_native_device import PortAudio
    api = PortAudio()
    monkeypatch.setattr(native_device, 'portaudio', lambda: api)
    worker = InputWorker()
    worker.handle(dict(kind='open', generation='lcmv', inputDevice=''), b'')
    microphone = np.tile(np.arange(8, dtype=np.float32)/10, (480, 1))
    outputs = []
    for tick in range(40):
        if (tick+1)*384//480 > tick*384//480:
            api.options['callback'](microphone, 480, None, False)
        reply, pcm = worker.handle(dict(kind='poll', generation='lcmv', offsetFrames=tick*384),
                                   np.full(768, .2, np.float32).tobytes())
        assert reply['rawOffsetFrames'] == sum(len(block) for block in outputs)
        outputs.append(pcm.reshape(10, -1).T)
    raw = np.concatenate(outputs)
    np.testing.assert_array_equal(raw[4800:, :8], np.broadcast_to(microphone[0], (len(raw)-4800, 8)))
    np.testing.assert_allclose(raw[:, 8:], .2)
    assert not hasattr(worker, 'denoiser')
    worker.handle(dict(kind='stop', generation='stale'), b'')
    assert not api.closed
    worker.handle(dict(kind='stop', generation='lcmv'), b'')
    assert api.closed


def test_entry_capture_only_mode_never_initializes_a_missing_hush_model(tmp_path):
    request = io.BytesIO()
    write_frame(request, dict(id=1, kind='stop', generation='lcmv'), [])
    child = subprocess.run([sys.executable, '-B', '-u', str(ROOT/'src/entry.py'),
                            '--state-dir', str(tmp_path), '--model', str(tmp_path/'missing.onnx'),
                            '--capture-only'],
                           input=request.getvalue(), capture_output=True, timeout=15, check=True)
    reply, pcm = read_frame(io.BytesIO(child.stdout))
    assert reply['id'] == 1
    assert reply['ok']
    assert pcm == b''
    assert b'Hush' not in child.stderr


def test_hush_presets_are_owned_by_the_capture_generation_and_reported_by_status(tmp_path):
    worker = Worker(tmp_path, ROOT / 'hush')
    model = worker.denoiser.handle
    previous = None
    try:
        for index, (attenuation, dry) in enumerate([(20, 30), (20, 10), (0, 30)]):
            settings = dict(attenuationDb=attenuation, dryMixPercent=dry)
            reply, _ = worker.handle(dict(kind='start', generation=str(index), channels=list(range(7)), gainDb=0, hush=settings), b'')
            assert reply['hush'] == settings
            assert reply['modelDelaySamples'] == (160 if attenuation else 0)
            status, _ = worker.handle(dict(kind='status'), b'')
            assert status['hush'] == settings
            assert status['modelDelaySamples'] == (160 if attenuation else 0)
            assert worker.frontend.denoise.attenuation_db == attenuation
            assert worker.frontend.denoise.dry_mix == dry/100
            assert worker.denoiser.handle is model
            if previous is not None:
                assert previous.handle is None
            previous = worker.frontend.denoise
    finally:
        worker.close_capture()
        worker.denoiser.close()


# Report: this chat, 2026-11-20 — Hush needs an independent AEC switch.
def test_hush_worker_never_enables_aec(tmp_path):
    worker = Worker(tmp_path, ROOT / 'hush')
    try:
        reply, _ = worker.handle(dict(kind='start', generation='aec-test', channels=list(range(7)),
                                     gainDb=0,
                                     hush=dict(attenuationDb=20, dryMixPercent=30)), b'')
        assert worker.frontend.aec is None
        assert worker.frontend.aec_discard == 0
        assert reply['aecEnabled'] is False
        status, _ = worker.handle(dict(kind='status'), b'')
        assert status['aecEnabled'] is False
        offset = 0
        for offset in range(0, 48000, 384):
            reply, pcm = worker.handle(dict(kind='block', generation='aec-test', offsetFrames=offset),
                                       np.zeros((10, 384), np.float32).tobytes())
            assert np.isfinite(pcm).all()
        assert reply['processedFrames'] == offset + 384
        assert worker.output_offset > 14000
    finally:
        worker.close_capture()
        worker.denoiser.close()
