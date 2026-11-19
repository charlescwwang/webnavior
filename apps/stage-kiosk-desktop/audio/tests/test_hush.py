"""Real native Hush model contracts; no substitute inference backend."""
from pathlib import Path

import numpy as np
import pytest

from uma8_frontend.hush import Model

ASSETS = Path(__file__).resolve().parents[1] / 'hush'


def test_real_hush_cpu_rejects_missing_model_and_invalid_frames(tmp_path):
    with pytest.raises(FileNotFoundError):
        Model(tmp_path)
    with Model(ASSETS) as model, model.session() as session:
        assert model.diagnostics['runtime'] == 'Hush / Tract'
        assert session.delay_samples == 160
        with pytest.raises(ValueError):
            session.process(np.zeros(256, np.float32))
        with pytest.raises(ValueError):
            session.process(np.full(160, np.nan, np.float32))


def test_hush_session_restart_is_deterministic_and_silence_advances_tail():
    t = np.arange(16000)/16000
    phase = 2*np.pi*(150*t+3*np.sin(2*np.pi*1.1*t))
    voice = (.1*(1+.7*np.sin(2*np.pi*3.7*t))*sum(np.sin(phase*k)/k for k in range(1, 25))).astype(np.float32)
    with Model(ASSETS) as model:
        outputs = []
        for _ in range(2):
            with model.session() as session:
                frames = [session.process(voice[i:i+160]) for i in range(0, len(voice), 160)]
                tail = session.process(np.zeros(160, np.float32))
                assert np.isfinite(tail).all()
                assert np.max(abs(tail)) > 0
                outputs.append(np.concatenate(frames+[tail]))
        np.testing.assert_array_equal(outputs[0], outputs[1])
        with pytest.raises(RuntimeError, match='closed'):
            session.process(np.zeros(160, np.float32))


def test_pinned_hush_delay_is_measured_on_real_speech_like_audio():
    from scipy.signal import correlate
    t = np.arange(32000)/16000
    phase = 2*np.pi*(150*t+3*np.sin(2*np.pi*1.1*t))
    voice = (.1*(1+.7*np.sin(2*np.pi*3.7*t))*sum(np.sin(phase*k)/k for k in range(1, 25))).astype(np.float32)
    with Model(ASSETS) as model, model.session() as session:
        audio = np.concatenate([session.process(voice[i:i+160]) for i in range(0, len(voice), 160)])
    assert np.argmax(correlate(audio, voice))-len(voice)+1 == 160


@pytest.mark.parametrize('frames', [1, 2, 3, 5, 8, 17, 37])
def test_frontend_matches_source_pcm_and_evidence_across_model_hop_boundaries(frames):
    from uma8_frontend.config import Config
    from uma8_frontend.pipeline import Frontend

    # External model boundary only: a deterministic one-hop delay lets this test
    # assert source alignment exactly, independently of neural enhancement quality.
    class DelayedSession:
        delay_samples = 160
        def __init__(self):
            self.previous = np.zeros(160, np.float32)
        def process(self, frame):
            previous, self.previous = self.previous, frame.copy()
            return previous
        def close(self):
            pass

    stages = {}
    def record(name, pcm):
        stages.setdefault(name, []).append(pcm.copy())
    cfg = Config(automatic_rtf=True, aec_enabled=False, agc_enabled=False)
    frontend = Frontend(cfg, stage_callback=record, denoiser=DelayedSession())
    rng = np.random.default_rng(frames)
    outputs = []
    for _ in range(frames):
        audio, _, info = frontend.push(rng.normal(0, .01, (160, 7)).astype(np.float32))
        assert sum(item['length'] for item in info) == len(audio)
        outputs.append(audio)
    audio, _, info = frontend.flush()
    assert sum(item['length'] for item in info) == len(audio)
    outputs.append(audio)
    output = np.concatenate(outputs)
    assert len(output) == frames*160
    np.testing.assert_array_equal(output, np.concatenate(stages['mvdr'])[:len(output)])
    np.testing.assert_array_equal(output, np.concatenate(stages['denoise']))
    assert len(frontend.hush_pending) < 160
    frontend.close()


def test_hush_silence_never_opens_a_phrase_and_state_is_bounded():
    from uma8_frontend.config import Config
    from uma8_frontend.pipeline import Frontend
    frontend = Frontend(Config(automatic_rtf=True))
    for _ in range(250):
        audio, events, _ = frontend.push(np.zeros((160, 7), np.float32), np.zeros(160, np.float32))
        assert not events
        assert len(frontend.hush_pending) < 160
        assert sum(n for n, _ in frontend.hush_evidence) <= 416
        if len(audio):
            assert np.max(abs(audio)) < 1e-5
    frontend.close()


@pytest.mark.parametrize('dry_percent', [10, 30, 100])
def test_recommended_mix_uses_the_same_source_samples_as_delayed_hush(dry_percent):
    rng = np.random.default_rng(31)
    frames = rng.normal(0, .08, (30, 160)).astype(np.float32)
    previous = np.zeros(160, np.float32)
    with Model(ASSETS) as model, model.session(20, 0) as wet, model.session(20, dry_percent) as mixed:
        assert mixed.delay_samples == 160
        for frame in frames:
            enhanced = wet.process(frame)
            expected = enhanced*(1-dry_percent/100)+previous*(dry_percent/100)
            np.testing.assert_allclose(mixed.process(frame), expected, rtol=1e-6, atol=1e-8)
            previous = frame.copy()
        tail = mixed.process(np.zeros(160, np.float32))
        assert np.isfinite(tail).all()


def test_zero_attenuation_passes_through_without_delay_or_silence_floor():
    with Model(ASSETS) as model, model.session(0, 30) as session:
        assert session.delay_samples == 0
        for scale in [0, 1e-5, .1]:
            frame = np.linspace(-scale, scale, 160, dtype=np.float32)
            np.testing.assert_array_equal(session.process(frame), frame)


@pytest.mark.parametrize('attenuation,dry_mix', [(-1, 0), (101, 0), (20, -1), (20, 101), (float('nan'), 30), (20, float('inf')), (True, 0)])
def test_rejects_invalid_hush_parameters_before_creating_a_session(attenuation, dry_mix):
    with Model(ASSETS) as model:
        with pytest.raises(ValueError):
            model.session(attenuation, dry_mix)


def test_attenuation_limit_changes_real_native_model_output():
    rng = np.random.default_rng(63)
    noise = rng.normal(0, .05, (50, 160)).astype(np.float32)
    with Model(ASSETS) as model, model.session(20, 0) as limited, model.session(100, 0) as full:
        limited_output = np.concatenate([limited.process(frame) for frame in noise])
        full_output = np.concatenate([full.process(frame) for frame in noise])
    assert not np.allclose(limited_output, full_output)
    assert np.mean(limited_output**2) > np.mean(full_output**2)
