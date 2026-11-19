"""Synthetic spatial contracts; these do not establish real-room speaker identity."""
from dataclasses import replace
import json
import os

import numpy as np
import pytest

from uma8_frontend.beamforming import NearFieldMvdr
from uma8_frontend.config import Config
from uma8_frontend.spectral import HOP, RATE
from uma8_frontend.segment import TargetSegmenter
from uma8_frontend.pipeline import Frontend


@pytest.fixture
def scene(tmp_path):
    anchor = np.ones((257, 7), np.complex64)
    path = tmp_path / "anchor.npz"
    np.savez(path, rtf=anchor, metadata=json.dumps(dict(
        sample_rate=RATE, nfft=512, hop=HOP, channels=list(range(7)),
        reference_channel=0, aec_enabled=False)))
    cfg = Config(calibration=str(path), aec_enabled=False)
    return cfg, anchor, np.random.default_rng(18)


def frame(rng, direction, power=.12, noise=.015):
    source = (rng.normal(size=257) + 1j*rng.normal(size=257))*power
    ambient = (rng.normal(size=(257, 7)) + 1j*rng.normal(size=(257, 7)))*noise
    return (source[:, None]*direction + ambient).astype(np.complex64)


def similarity(a, b):
    return float(np.mean(abs(np.sum(a.conj()*b, axis=1))**2 /
                         (np.sum(abs(a)**2, axis=1)*np.sum(abs(b)**2, axis=1))))


def shifted(anchor):
    # Matches the permitted service region, but fails the old 0.60 target gate.
    a = anchor*np.exp(1j*np.linspace(0, 2.8, 7))[None, :]
    return a.astype(np.complex64)


def test_tracks_a_moved_target_that_fails_the_old_spatial_gate(scene):
    cfg, anchor, rng = scene
    beam = NearFieldMvdr(cfg)
    target = shifted(anchor)
    assert beam.spatial_score(target) < cfg.spatial_threshold
    before = similarity(beam.a, target)
    for _ in range(400):
        _, info = beam.process(frame(rng, target), speech_present=True)
    assert similarity(beam.a, target) > .95
    assert similarity(beam.a, target) > before + .4
    assert info["target_present"]
    assert info["rtf_updates"] > 0
    np.testing.assert_allclose(beam.a[:, 0], 1, atol=1e-6)
    np.testing.assert_allclose(np.sum(beam.weights.conj()*beam.a, axis=1), 1, atol=1e-4)


def test_uncertain_customer_speech_does_not_enter_noise_covariance(scene):
    cfg, anchor, rng = scene
    beam = NearFieldMvdr(cfg)
    noise = beam.noise.copy()
    for _ in range(20):
        beam.process(frame(rng, shifted(anchor)), speech_present=True)
    np.testing.assert_array_equal(beam.noise, noise)


def test_playback_freezes_learning_without_stopping_audio(scene):
    cfg, anchor, rng = scene
    beam = NearFieldMvdr(cfg)
    for _ in range(240):
        output, info = beam.process(frame(rng, shifted(anchor)), speech_present=True, playback_active=True)
    np.testing.assert_array_equal(beam.a, anchor)
    assert info["rtf_state"] == "frozen"
    assert info["rtf_reason"] == "playback"
    assert np.max(abs(output)) > 0
    for _ in range(400):
        _, info = beam.process(frame(rng, shifted(anchor)), speech_present=True)
    assert info["rtf_updates"] > 0


def test_short_answers_are_processed_without_replacing_rtf(scene):
    cfg, anchor, rng = scene
    beam = NearFieldMvdr(cfg)
    for _ in range(8):
        output, info = beam.process(frame(rng, anchor), speech_present=True)
    assert info["target_present"]
    assert np.max(abs(output)) > 0
    assert info["rtf_updates"] == 0
    np.testing.assert_array_equal(beam.a, anchor)


def test_outside_service_region_never_takes_over(scene):
    cfg, anchor, rng = scene
    beam = NearFieldMvdr(cfg)
    other = anchor*np.exp(2j*np.pi*np.arange(7)/7)[None, :]
    for _ in range(400):
        _, info = beam.process(frame(rng, other, power=.5), speech_present=True)
    np.testing.assert_array_equal(beam.a, anchor)
    assert info["rtf_updates"] == 0


def test_competing_sources_do_not_supply_a_trusted_candidate(scene):
    cfg, anchor, rng = scene
    beam = NearFieldMvdr(cfg)
    left = anchor*np.exp(1j*np.linspace(0, 2.8, 7))[None, :]
    right = anchor*np.exp(-1j*np.linspace(0, 2.8, 7))[None, :]
    for _ in range(400):
        _, info = beam.process(frame(rng, left) + frame(rng, right), speech_present=True)
    assert info["rtf_updates"] == 0


def test_silence_updates_noise_and_does_not_change_rtf(scene):
    cfg, anchor, rng = scene
    beam = NearFieldMvdr(cfg)
    before = beam.noise.copy()
    for _ in range(200):
        beam.process(frame(rng, anchor, power=0), speech_present=False)
    np.testing.assert_array_equal(beam.a, anchor)
    assert not np.array_equal(beam.noise, before)


def test_fixed_comparison_mode_preserves_the_original_rtf(scene):
    cfg, anchor, rng = scene
    beam = NearFieldMvdr(replace(cfg, online_rtf_enabled=False))
    for _ in range(400):
        _, info = beam.process(frame(rng, shifted(anchor)), speech_present=True)
    np.testing.assert_array_equal(beam.a, anchor)
    assert info["rtf_state"] == "disabled"


def test_reacquisition_keeps_the_beginning_before_rtf_is_confirmed(scene):
    cfg, _, _ = scene
    segmenter = TargetSegmenter(replace(cfg, end_silence_ms=100, min_speech_ms=20))
    class Voice:
        # NOTICE: deterministic external VAD isolates the buffering contract;
        # the unmodified WebRTC VAD is exercised by the full Frontend tests.
        def is_speech(self, pcm, rate):
            return np.max(abs(np.frombuffer(pcm, dtype="<i2"))) > 0
    segmenter.vad = Voice()
    segmenter.push(np.zeros(3200, np.float32), False)
    unconfirmed = np.linspace(.01, .02, 16000, dtype=np.float32)
    segmenter.push(unconfirmed, False, candidate_present=True)
    segmenter.push(np.full(3200, .02, np.float32), True, candidate_present=True)
    result = segmenter.push(np.zeros(1600, np.float32), False)
    assert len(result) == 1
    assert result[0].start_sample == 0
    np.testing.assert_array_equal(result[0].audio[3200:19200], unconfirmed)


def test_an_unconfirmed_candidate_is_not_submitted(scene):
    cfg, _, _ = scene
    segmenter = TargetSegmenter(cfg)
    for _ in range(150):
        segmenter.push(np.full(256, .02, np.float32), False, candidate_present=True)
    assert segmenter.flush() == []
    assert len(segmenter.history) <= cfg.rtf_reacquire_buffer_ms // 10


def test_frontend_learns_through_real_prebeam_vad_and_preserves_sample_clock(scene):
    cfg, _, _ = scene
    frontend = Frontend(cfg)
    t = np.arange(RATE*5)/RATE
    phase = 2*np.pi*(150*t+3*np.sin(2*np.pi*1.1*t))
    voice = (.03*(1+.7*np.sin(2*np.pi*3.7*t))*
             sum(np.sin(phase*k)/k for k in range(1, 25))).astype(np.float32)
    gains = np.array([1, .7, 1.3, .5, 1.5, .8, 1.2], np.float32)
    samples = 0
    segments = []
    for i in range(0, len(voice), 160):
        output, events, _ = frontend.push(voice[i:i+160, None]*gains)
        samples += len(output)
        segments.extend(events)
    output, events, _ = frontend.flush()
    segments.extend(events)
    assert samples+len(output) == len(voice)
    assert frontend.beam.tracker.updates >= 10
    assert len(segments) > 0
    np.testing.assert_allclose(frontend.beam.a[20].real, gains, atol=.02)


@pytest.mark.skipif(not os.environ.get("UMA8_STRESS_SECONDS"), reason="explicit synthetic stress opt-in")
@pytest.mark.parametrize('hush', [(100, 0), (20, 30), (20, 10)])
def test_long_stream_with_real_aec3_and_model_keeps_bounded_state(scene, hush):
    cfg, anchor, _ = scene
    seconds = int(os.environ["UMA8_STRESS_SECONDS"])
    assert seconds >= 110
    np.savez(cfg.calibration, rtf=anchor, metadata=json.dumps(dict(
        sample_rate=RATE, nfft=512, hop=HOP, channels=list(range(7)),
        reference_channel=0, aec_enabled=True)))
    frontend = Frontend(replace(cfg, aec_enabled=True, hush_attenuation_db=hush[0], hush_dry_mix_percent=hush[1]))
    t = np.arange(RATE*2)/RATE
    phase = 2*np.pi*(150*t+3*np.sin(2*np.pi*1.1*t))
    voice = (.03*(1+.7*np.sin(2*np.pi*3.7*t))*
             sum(np.sin(phase*k)/k for k in range(1, 25))).astype(np.float32)
    samples = 0
    for block in range(seconds*100):
        i = block*160 % len(voice)
        capture = np.broadcast_to(voice[i:i+160, None], (160, 7)).copy()
        output, _, _ = frontend.push(capture, np.zeros(160, np.float32))
        assert np.isfinite(output).all()
        samples += len(output)
    output, _, _ = frontend.flush()
    assert samples+len(output) == seconds*RATE
    assert frontend.beam.tracker.updates > 10
    assert len(frontend.timings_ms) == 10000
    assert frontend.beam.tracker.covariance.shape == (257, 7, 7)
    assert len(frontend.segmenter.history) <= cfg.rtf_reacquire_buffer_ms // 10


@pytest.mark.parametrize("value", [0, -1, float("nan"), float("inf")])
def test_rejects_invalid_tracking_time_constant(value):
    with pytest.raises(ValueError, match="rtf_time_constant_s"):
        replace(Config(), rtf_time_constant_s=value).validate()

# Report: this chat, 2026-11-18 — no manual five-second recording should gate capture.
def test_automatic_tracking_starts_without_anchor_and_relearns_another_position(scene):
    cfg, anchor, rng = scene
    cfg = replace(cfg, automatic_rtf=True, calibration='/missing/target_rtf.npz')
    beam = NearFieldMvdr(cfg)
    target = shifted(anchor)
    output, info = beam.process(frame(rng, target), speech_present=True)
    assert np.max(abs(output)) > 0
    assert info['target_present']
    for _ in range(200):
        _, info = beam.process(frame(rng, target), speech_present=True)
    assert info['rtf_updates'] > 0
    assert similarity(beam.a, target) > .95
    other = anchor*np.exp(-1j*np.linspace(0, 3.6, 7))[None, :]
    for _ in range(400):
        _, info = beam.process(frame(rng, other), speech_present=True)
    assert similarity(beam.a, other) > .95
    assert info['target_present']


# Report: this chat, 2026-11-18 — automatic mode must not learn playback or mixtures.
def test_automatic_tracking_freezes_during_playback_and_rejects_mixed_candidates(scene):
    cfg, anchor, rng = scene
    beam = NearFieldMvdr(replace(cfg, automatic_rtf=True))
    left = shifted(anchor)
    right = anchor*np.exp(-1j*np.linspace(0, 2.8, 7))[None, :]
    for _ in range(150):
        _, info = beam.process(frame(rng, left), speech_present=True, playback_active=True)
    assert info['rtf_state'] == 'frozen'
    assert info['rtf_updates'] == 0
    assert not beam.initialized
    for _ in range(300):
        _, info = beam.process(frame(rng, left)+frame(rng, right), speech_present=True)
    assert info['rtf_updates'] == 0
    for _ in range(200):
        _, info = beam.process(frame(rng, left), speech_present=True)
    assert info['rtf_updates'] > 0


def test_automatic_frontend_real_vad_emits_speech_without_creating_a_calibration_file(scene):
    cfg, _, _ = scene
    cfg = replace(cfg, automatic_rtf=True, calibration=cfg.calibration+'.missing')
    frontend = Frontend(cfg)
    t = np.arange(RATE*3)/RATE
    phase = 2*np.pi*(150*t+3*np.sin(2*np.pi*1.1*t))
    voice = (.03*(1+.7*np.sin(2*np.pi*3.7*t))*
             sum(np.sin(phase*k)/k for k in range(1, 25))).astype(np.float32)
    segments = []
    samples = 0
    for i in range(0, len(voice), 160):
        output, events, _ = frontend.push(np.tile(voice[i:i+160, None], (1, 7)))
        samples += len(output)
        segments.extend(events)
    output, events, _ = frontend.flush()
    segments.extend(events)
    assert samples+len(output) == len(voice)
    assert len(segments) > 0
    assert frontend.beam.tracker.updates > 0
    from pathlib import Path
    assert not Path(cfg.calibration).exists()
