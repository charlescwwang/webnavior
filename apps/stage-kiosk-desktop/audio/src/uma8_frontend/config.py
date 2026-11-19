from dataclasses import dataclass, field
from pathlib import Path
import json
import math


@dataclass
class Config:
    sample_rate: int = 16000
    channels: list[int] = field(default_factory=lambda: list(range(7)))
    reference_channel: int = 0
    calibration: str = "models/target_rtf.npz"
    model: str = str(Path(__file__).resolve().parents[2] / "hush")
    aec_enabled: bool = True
    aec_delay_ms: int = 0
    spatial_threshold: float = 0.60
    min_speech_dbfs: float = -55.0
    diagonal_loading: float = 0.03
    noise_time_constant_s: float = 1.5
    # Fixed-anchor comparison mode keeps a service-region boundary. Automatic
    # mode learns from live dominant speech without that spatial restriction.
    # Automatic mode learns dominant speech without a persisted installation anchor.
    automatic_rtf: bool = False
    online_rtf_enabled: bool = True
    rtf_time_constant_s: float = 0.5
    rtf_min_observation_ms: int = 768
    rtf_update_interval_ms: int = 256
    rtf_min_anchor_score: float = 0.25
    rtf_min_eigenvalue_ratio: float = 4.0
    rtf_min_bin_fraction: float = 0.35
    rtf_update_rate: float = 0.25
    rtf_playback_hold_ms: int = 300
    rtf_reacquire_buffer_ms: int = 2000
    max_weight_norm: float = 2.0
    vad_mode: int = 1
    pre_roll_ms: int = 256
    end_silence_ms: int = 600
    min_speech_ms: int = 80
    max_segment_s: float = 15.0
    gain_db: float = 0.0
    input_gain_db: float = 0.0
    hush_attenuation_db: float = 100.0
    hush_dry_mix_percent: float = 0.0
    agc_enabled: bool = True
    agc_target_dbfs: float = -23.0
    agc_max_gain_db: float = 18.0
    agc_attack_db_per_s: float = 6.0
    agc_release_db_per_s: float = 12.0
    asr_base_url: str = "https://mcjijz33kp.aikcitri.qzz.io"
    asr_path: str | None = None
    asr_file_field: str | None = None
    asr_form: dict = field(default_factory=dict)
    asr_timeout_s: float = 60.0
    asr_token_env: str = "UMA8_ASR_TOKEN"

    def validate(self):
        for name in ('hush_attenuation_db', 'hush_dry_mix_percent'):
            value = getattr(self, name)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 100:
                raise ValueError(f'{name} must be finite and in 0..100')
        if not math.isfinite(self.input_gain_db) or not 0 <= self.input_gain_db <= 40:
            raise ValueError("input_gain_db must be finite and in 0..40")
        if any(type(value) is not bool for value in (self.aec_enabled, self.agc_enabled, self.online_rtf_enabled, self.automatic_rtf)):
            raise ValueError("AEC and AGC switches must be JSON booleans")
        if self.sample_rate != 16000:
            raise ValueError("Prototype processing rate is fixed at 16000 Hz; capture is resampled first")
        if not math.isfinite(self.rtf_time_constant_s) or self.rtf_time_constant_s <= 0:
            raise ValueError("rtf_time_constant_s must be positive and finite")
        for name in ("rtf_min_anchor_score", "rtf_min_bin_fraction", "rtf_update_rate"):
            value = getattr(self, name)
            if not math.isfinite(value) or not 0 < value <= 1:
                raise ValueError(f"{name} must be finite and in (0, 1]")
        if self.rtf_min_anchor_score >= self.spatial_threshold:
            raise ValueError("rtf_min_anchor_score must be below spatial_threshold for position reacquisition")
        if not math.isfinite(self.rtf_min_eigenvalue_ratio) or self.rtf_min_eigenvalue_ratio <= 1:
            raise ValueError("rtf_min_eigenvalue_ratio must be finite and greater than one")
        for name in ("rtf_min_observation_ms", "rtf_update_interval_ms", "rtf_playback_hold_ms"):
            if type(getattr(self, name)) is not int or getattr(self, name) < 16:
                raise ValueError(f"{name} must be an integer of at least 16 ms")
        if (type(self.rtf_reacquire_buffer_ms) is not int or
                not max(self.pre_roll_ms, self.rtf_min_observation_ms + self.rtf_update_interval_ms) <= self.rtf_reacquire_buffer_ms <= 5000):
            raise ValueError("rtf_reacquire_buffer_ms must cover pre-roll/acquisition and be at most 5000 ms")
        if len(self.channels) != 7 or len(set(self.channels)) != 7 or any(type(x) is not int or x < 0 for x in self.channels):
            raise ValueError("UMA-8 RAW requires exactly seven distinct valid channel indices")
        if not 0 <= self.reference_channel < 7:
            raise ValueError("reference_channel is an index within the seven selected channels")
        if self.aec_delay_ms < 0 or self.aec_delay_ms > 500:
            raise ValueError("aec_delay_ms must be 0..500")
        if not 0 < self.spatial_threshold <= 1:
            raise ValueError("spatial_threshold must be in (0, 1]")
        for name in ("diagonal_loading", "noise_time_constant_s", "max_weight_norm", "max_segment_s", "asr_timeout_s"):
            if not math.isfinite(getattr(self, name)) or getattr(self, name) <= 0:
                raise ValueError(f"{name} must be positive and finite")
        if self.vad_mode not in (0, 1, 2, 3):
            raise ValueError("vad_mode must be 0..3")
        if min(self.pre_roll_ms, self.end_silence_ms, self.min_speech_ms) < 0 or self.end_silence_ms == 0:
            raise ValueError("segment timing must be nonnegative, with a positive end_silence_ms")
        if not -30 <= self.gain_db <= 24 or not -100 <= self.min_speech_dbfs <= -5:
            raise ValueError("gain_db or min_speech_dbfs out of range")
        if not -40 <= self.agc_target_dbfs <= -10 or not 0 <= self.agc_max_gain_db <= 24:
            raise ValueError("AGC target/maximum gain out of range")
        if not 0 < self.agc_attack_db_per_s <= 60 or not 0 < self.agc_release_db_per_s <= 60:
            raise ValueError("AGC gain slew rate out of range")
        return self

    @classmethod
    def load(cls, path):
        data = json.loads(Path(path).read_text(encoding="utf-8-sig"))
        return cls(**data).validate()


def select_channels(audio, channels):
    import numpy as np
    x = np.asarray(audio, dtype=np.float32)
    if x.ndim != 2 or x.shape[1] <= max(channels):
        raise ValueError("Input must expose UMA-8 RAW channels; DSP stereo is not a microphone array")
    x = x[:, channels]
    if not np.isfinite(x).all() or np.max(np.abs(x), initial=0) > 1.001:
        raise ValueError("Input must be finite float audio in [-1, 1]")
    return np.ascontiguousarray(x)
