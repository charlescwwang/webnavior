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
    worker = Worker(tmp_path, ROOT / "models/ulunas_stream.onnx", "cpu")
    status, _ = worker.handle({"kind": "status"}, b"")
    assert status["state"] == "automatic"
    assert not status["gpu_verified"]
    model = worker.denoiser.session
    assert not (tmp_path / "target_rtf.npz").exists()
    worker.handle(dict(kind="start", generation="capture", channels=list(range(7)), gainDb=0), b"")
    assert worker.denoiser.session is model
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
    # than substituting the worker or OpenVINO session. GPU startup can print here.
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
    if event == "import" and args[0] == "openvino" and not emitted:
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
         "--model", str(ROOT / "models/ulunas_stream.onnx"), "--provider", "cpu"],
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
         "--state-dir", str(tmp_path), "--model", str(tmp_path / "missing.onnx"), "--provider", "cpu"],
        input=request.getvalue(), capture_output=True, timeout=30, check=True,
    )
    replies = io.BytesIO(result.stdout)
    response, pcm = read_frame(replies)
    assert response["id"] == 71
    assert not response["ok"]
    assert "UL-UNAS ONNX missing" in response["error"]
    assert pcm == b""
    assert read_frame(replies) is None
    assert b"UL-UNAS ONNX missing" in result.stderr





# Report: this chat, 2026-11-18 — isolate UL-UNAS without changing the other DSP stages.
def test_explicit_model_bypass_starts_without_a_model_and_keeps_aec_rtf_and_segments(tmp_path):
    worker = Worker(tmp_path, tmp_path/'missing.onnx', 'openvino', denoise_enabled=False)
    status, _ = worker.handle(dict(kind='status'), b'')
    assert status['runtime'] == 'Bypass'
    assert not status['gpu_verified']
    assert status['requested_provider'] == 'disabled'
    worker.handle(dict(kind='start', generation='bypass', channels=list(range(7)), gainDb=0), b'')
    assert worker.frontend.cfg.aec_enabled
    assert worker.frontend.cfg.automatic_rtf
    assert worker.frontend.cfg.agc_enabled
    assert not worker.frontend.cfg.denoise_enabled
    count = 0
    for offset in range(0, 48000, 384):
        reply, pcm = worker.handle(dict(kind='block', generation='bypass', offsetFrames=offset),
                                   np.zeros((10, 384), np.float32).tobytes())
        count += sum(frame['length'] for frame in reply['frames'])
        assert np.isfinite(pcm).all()
    assert count > 14000
    worker.handle(dict(kind='stop', generation='bypass'), b'')


def test_enabled_model_still_fails_instead_of_automatically_bypassing(tmp_path):
    with pytest.raises(FileNotFoundError, match='UL-UNAS ONNX missing'):
        Worker(tmp_path, tmp_path/'missing.onnx', 'openvino')


def test_entry_bypass_is_scoped_to_the_child_environment_and_normal_start_is_restored(tmp_path):
    import os
    request = io.BytesIO()
    write_frame(request, dict(id=1, kind='status'), [])
    for switch, expected in (('1', True), (None, False)):
        env = dict(os.environ)
        env.pop('WEBNAVIOR_TEST_BYPASS_ULUNAS', None)
        if switch is not None:
            env['WEBNAVIOR_TEST_BYPASS_ULUNAS'] = switch
        child = subprocess.run([sys.executable, '-B', '-u', str(ROOT/'src/entry.py'),
                                '--state-dir', str(tmp_path), '--model', str(tmp_path/'missing.onnx'),
                                '--provider', 'openvino'], input=request.getvalue(),
                               capture_output=True, env=env, timeout=15, check=True)
        response, pcm = read_frame(io.BytesIO(child.stdout))
        assert response['id'] == 1
        assert response['ok'] is expected
        assert pcm == b''
        if expected:
            assert response['result']['runtime'] == 'Bypass'
            assert not response['result']['gpu_verified']
        else:
            assert 'UL-UNAS ONNX missing' in response['error']


# Report: this chat, 2026-11-19 — opening admin settings while native capture runs
# can queue enumeration in front of render delivery, independent of UL-UNAS.
def test_slow_device_query_blocks_live_poll_on_the_actual_worker_pipe_without_a_model(tmp_path):
    launcher = tmp_path/'slow_devices.py'
    launcher.write_text(f'''
import runpy
import sys
import time
sys.path.insert(0, {str(ROOT/'src')!r})
from uma8_frontend import worker, native_device
class API:
    def query_hostapis(self):
        return [dict(name='Windows WASAPI')]
    def query_devices(self):
        return [dict(name='UMA-8 RAW', hostapi=0, max_input_channels=8, max_output_channels=0)]
    def check_input_settings(self, **options):
        pass
    def InputStream(self, **options):
        self.active = True
        return self
    def start(self):
        pass
    def abort(self):
        self.active = False
    def close(self):
        pass
api = API()
native_device.portaudio = lambda: api
original = worker.devices
def slow_devices():
    time.sleep(.35)
    return original()
worker.devices = slow_devices
runpy.run_path({str(ROOT/'src/entry.py')!r}, run_name='__main__')
''', encoding='utf-8')
    # Only the external device API is simulated. Framing, dispatch, capture and
    # the model-bypassed DSP owner are the real installed-source implementation.
    request = io.BytesIO()
    write_frame(request, dict(id=1, kind='start', generation='live', channels=list(range(7)), gainDb=0), [])
    write_frame(request, dict(id=2, kind='open', generation='live'), [])
    write_frame(request, dict(id=3, kind='devices'), [])
    write_frame(request, dict(id=4, kind='poll', generation='live', offsetFrames=0), np.zeros(768, np.float32))
    child = subprocess.Popen([sys.executable, '-B', '-u', str(launcher), '--state-dir', str(tmp_path/'state'),
                              '--model', str(tmp_path/'missing.onnx'), '--bypass-denoiser'],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    import time
    import threading
    replies = []
    def collect():
        while (frame := read_frame(child.stdout)) is not None:
            replies.append((time.perf_counter(), frame[0]))
    reader = threading.Thread(target=collect, daemon=True)
    reader.start()
    try:
        child.stdin.write(request.getvalue())
        child.stdin.close()
        child.wait(timeout=15)
        reader.join(timeout=2)
        assert child.returncode == 0
        assert [reply['id'] for _, reply in replies] == [1, 2, 3, 4]
        assert replies[0][1]['result']['runtime'] == 'Bypass'
        assert all(reply['ok'] for _, reply in replies)
        # No callbacks or DSP work are needed: the synchronous control query
        # alone delays the next reference acknowledgment beyond its 250 ms guard.
        assert replies[3][0]-replies[1][0] >= .3
    finally:
        if child.poll() is None:
            child.kill()
        child.wait(timeout=5)


# Report: this chat, 2026-11-19 — LCMV needs native input without loading UL-UNAS/RTF.
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


def test_entry_capture_only_mode_never_initializes_a_missing_gpu_model(tmp_path):
    request = io.BytesIO()
    write_frame(request, dict(id=1, kind='stop', generation='lcmv'), [])
    child = subprocess.run([sys.executable, '-B', '-u', str(ROOT/'src/entry.py'),
                            '--state-dir', str(tmp_path), '--model', str(tmp_path/'missing.onnx'),
                            '--provider', 'openvino', '--capture-only'],
                           input=request.getvalue(), capture_output=True, timeout=15, check=True)
    reply, pcm = read_frame(io.BytesIO(child.stdout))
    assert reply['id'] == 1
    assert reply['ok']
    assert pcm == b''
    assert b'UL-UNAS' not in child.stderr
