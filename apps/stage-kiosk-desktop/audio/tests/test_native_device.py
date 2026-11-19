"""Exercise the real PortAudio boundary without requiring a physical UMA-8."""
import json
import numpy as np
import pytest
from uma8_frontend.native_device import Capture, devices

class PortAudio:
    def __init__(self):
        self.closed = False
        self.active = True
        self.options = None
    def query_hostapis(self):
        return [dict(name='Windows WASAPI', default_output_device=1)]
    def query_devices(self):
        return [dict(name='UMA-8 RAW', hostapi=0, max_input_channels=8, max_output_channels=0),
                dict(name='Speakers', hostapi=0, max_input_channels=0, max_output_channels=2)]
    def check_input_settings(self, **options):
        assert options['channels'] == 8
        assert options['samplerate'] == 48000
    def check_output_settings(self, **options):
        assert options['channels'] == 2
    def InputStream(self, **options):
        self.options = options
        return self
    def start(self):
        return self
    def abort(self):
        pass
    def close(self):
        self.closed = True

def test_native_eight_channels_and_browser_reference_are_paired_without_output():
    api = PortAudio()
    capture = Capture('', api=api)
    assert api.options['channels'] == 8
    assert api.options['device'] == 0
    for _ in range(10):
        capture.render(np.full((384, 2), .25, np.float32))
    microphone = np.tile(np.arange(8, dtype=np.float32)/10, (480, 1))
    for _ in range(11):
        capture.render(np.full((384, 2), .25, np.float32))
        api.options['callback'](microphone, 480, None, False)
        paired = capture.read()
    np.testing.assert_array_equal(paired[:, :8], microphone)
    assert np.max(paired[:, 8:]) == .25
    capture.close()
    assert api.closed

def test_native_device_identity_survives_indices_and_rejects_wrong_device():
    api = PortAudio()
    listing = devices(api)
    assert listing[0]['id'] == json.dumps(['Windows WASAPI', 'UMA-8 RAW'], separators=(',', ':'))
    with pytest.raises(ValueError, match='not available'):
        Capture('old-chromium-device-id', api=api)
    with pytest.raises(ValueError, match='eight'):
        Capture(listing[1]['id'], api=api)

def test_native_callback_overflow_is_terminal_and_never_drops_capture_silently():
    api = PortAudio()
    capture = Capture('', api=api)
    api.options['callback'](np.zeros((480, 8), np.float32), 480, None, True)
    with pytest.raises(RuntimeError, match='PortAudio'):
        capture.read()
    capture.close()

def test_real_worker_native_input_starts_without_calibration_or_speaker(tmp_path, monkeypatch):
    from pathlib import Path
    from uma8_frontend import native_device
    from uma8_frontend.worker import Worker
    api = PortAudio()
    monkeypatch.setattr(native_device, 'portaudio', lambda: api)
    model = Path(__file__).resolve().parents[1] / 'models/ulunas_stream.onnx'
    worker = Worker(tmp_path, model, 'cpu')
    worker.handle(dict(kind='start', generation='listen', channels=list(range(7)), gainDb=0), b'')
    worker.handle(dict(kind='open', generation='listen', inputDevice=''), b'')
    emitted = 0
    for tick in range(40):
        if (tick+1)*384//480 > tick*384//480:
            api.options['callback'](np.zeros((480, 8), np.float32), 480, None, False)
        reply, pcm = worker.handle(dict(kind='poll', generation='listen', offsetFrames=tick*384), np.zeros(768, np.float32).tobytes())
        emitted += sum(frame['length'] for frame in reply['frames'])
        assert np.isfinite(pcm).all()
    assert emitted > 2000
    assert not (tmp_path/'target_rtf.npz').exists()
    worker.handle(dict(kind='stop', generation='old'), b'')
    assert worker.capture is not None
    worker.handle(dict(kind='stop', generation='listen'), b'')
    assert worker.capture is None
    assert api.closed

@pytest.mark.parametrize('drift', [-.0004, .0004])
def test_independent_browser_clock_drift_stays_bounded_with_input_only_capture(drift):
    api = PortAudio()
    capture = Capture('', api=api)
    browser_time = 0.
    maximum = 0
    audible = 0
    for tick in range(3000):
        while browser_time <= (tick+1)*.01:
            capture.render(np.full((384, 2), .2, np.float32))
            browser_time += .008*(1+drift)
        api.options['callback'](np.zeros((480, 8), np.float32), 480, None, False)
        raw = capture.read()
        maximum = max(maximum, len(capture.playback))
        if tick > 100:
            audible += np.count_nonzero(raw[:, 8] > .19)
    assert audible == 2899*480
    assert maximum < 6000
    capture.close()

# Report: this chat, 2026-11-18 — the UMA-8 has no speaker and must open independently.
def test_input_only_hardware_never_queries_or_opens_an_output():
    class MicrophoneOnly(PortAudio):
        def query_hostapis(self):
            return [dict(name='Windows WASAPI', default_output_device=-1)]
        def query_devices(self):
            return [dict(name='UMA-8 RAW', hostapi=0, max_input_channels=8, max_output_channels=0)]
        def InputStream(self, **options):
            self.options = options
            return self
        def Stream(self, **options):
            raise AssertionError('A microphone must not require a duplex output')
    api = MicrophoneOnly()
    capture = Capture('', api=api)
    assert api.options['channels'] == 8
    assert api.options['device'] == 0
    for _ in range(15):
        capture.render(np.zeros((480, 2), np.float32))
        api.options['callback'](np.ones((480, 8), np.float32)*.1, 480, None, False)
        raw = capture.read()
    assert np.max(raw[:, :8]) == np.float32(.1)
    assert np.max(abs(raw[:, 8:])) == 0
    capture.close()
    assert api.closed


def test_missing_browser_reference_stops_at_existing_250ms_bound_without_inventing_silence():
    api = PortAudio()
    capture = Capture('', api=api)
    capture.render(np.ones((2400, 2), np.float32)*.2)
    for _ in range(26):
        api.options['callback'](np.zeros((480, 8), np.float32), 480, None, False)
    with pytest.raises(RuntimeError, match='250 ms backlog'):
        capture.read()
    capture.close()


def test_reference_precedes_delayed_capture_echo_on_independent_input_clock():
    api = PortAudio()
    capture = Capture('', api=api)
    browser_time = 0.
    raw = []
    for tick in range(40):
        while browser_time <= (tick+1)*.01:
            audio = np.zeros((384, 2), np.float32)
            start = int(round(browser_time*48000))
            if start <= 4800 < start+384:
                audio[4800-start] = .3
            capture.render(audio)
            browser_time += .008
        microphone = np.zeros((480, 8), np.float32)
        if tick == 12:  # 20 ms speaker/acoustic delay after the 100 ms render pulse.
            microphone[0] = .3
        api.options['callback'](microphone, 480, None, False)
        raw.append(capture.read())
    paired = np.concatenate(raw)
    reference_peak = int(np.argmax(paired[:, 8]))
    capture_peak = int(np.argmax(paired[:, 0]))
    assert 0 < capture_peak-reference_peak < 4800*2
    capture.close()


# Report: this chat, 2026-11-18 — reference underrun persists with UL-UNAS bypassed.
def test_short_reference_delivery_pause_retains_every_microphone_block_until_reference_arrives():
    api = PortAudio()
    capture = Capture('', api=api)
    source = np.arange(20*480*8, dtype=np.float32).reshape(-1, 8)/1000000
    render = np.full((20*480+2400, 2), .2, np.float32)
    capture.render(render[:2400])
    result = []
    # Native callbacks can arrive in a burst while browser/IPC delivery pauses.
    # 100 ms is below the existing 250 ms bound and is not lost reference PCM.
    for tick in range(10):
        api.options['callback'](source[tick*480:(tick+1)*480], 480, None, False)
        result.append(capture.read())
    capture.render(render[2400:7200])
    result.append(capture.read())
    for tick in range(10, 20):
        capture.render(render[7200+(tick-10)*480:7680+(tick-10)*480])
        api.options['callback'](source[tick*480:(tick+1)*480], 480, None, False)
        result.append(capture.read())
    paired = np.concatenate(result)
    assert len(paired) == len(source)
    np.testing.assert_array_equal(paired[:4800, :8], np.zeros((4800, 8)))
    np.testing.assert_array_equal(paired[4800:, :8], source[:4800])
    np.testing.assert_allclose(paired[:, 8:], .2)
    capture.close()


# Report: this chat, 2026-11-18 — batch delivery must work through the actual Worker, not only Capture.
def test_bypassed_worker_keeps_processing_during_repeated_input_and_reference_bursts(tmp_path, monkeypatch):
    from uma8_frontend import native_device
    from uma8_frontend.worker import Worker
    api = PortAudio()
    monkeypatch.setattr(native_device, 'portaudio', lambda: api)
    worker = Worker(tmp_path, tmp_path/'missing.onnx', 'openvino', denoise_enabled=False)
    worker.handle(dict(kind='start', generation='burst', channels=list(range(7)), gainDb=0), b'')
    worker.handle(dict(kind='open', generation='burst'), b'')
    callback = api.options['callback']
    signal = np.random.default_rng(7).normal(0, .01, (192000, 8)).astype(np.float32)
    emitted = 0
    reference = np.zeros(768, np.float32).tobytes()
    try:
        # Every 100 ms the driver delivers ten callbacks back-to-back. Browser
        # reference then arrives as its ordinary 8 ms blocks. Repeating this
        # exercises startup and ongoing skew without changing DSP or its clocks.
        for tick in range(500):
            if tick % 25 in (0, 12):
                start = tick//25*9600 + (4800 if tick % 25 == 12 else 0)
                for offset in range(start, start+4800, 480):
                    callback(signal[offset:offset+480], 480, None, False)
            reply, pcm = worker.handle(dict(kind='poll', generation='burst', offsetFrames=tick*384), reference)
            assert reply['renderFrames'] == (tick+1)*384
            assert np.isfinite(pcm).all()
            for frame in reply['frames']:
                assert frame['offsetSamples'] == emitted
                emitted += frame['length']
        assert worker.offset >= 187000
        assert emitted > 61000
        assert worker.capture.failure is None
    finally:
        worker.handle(dict(kind='stop', generation='burst'), b'')
    assert api.closed


def test_callback_copies_driver_memory_and_waiting_capture_keeps_the_250ms_bound():
    api = PortAudio()
    capture = Capture('', api=api)
    microphone = np.full((480, 8), .1, np.float32)
    api.options['callback'](microphone, 480, None, False)
    microphone.fill(0)  # The driver may reuse this buffer immediately.
    assert capture.read().shape == (0, 10)
    np.testing.assert_allclose(capture.captured[0], .1)
    for _ in range(24):
        api.options['callback'](microphone, 480, None, False)
    assert capture.failure is None
    api.options['callback'](microphone, 480, None, False)
    with pytest.raises(RuntimeError, match='250 ms backlog'):
        capture.read()
    capture.close()
