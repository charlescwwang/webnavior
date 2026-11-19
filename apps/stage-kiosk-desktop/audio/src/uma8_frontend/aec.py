"""Seven phase-aligned mono AEC3 instances sharing one render reference.

No NS or AGC before MVDR. AEC3 still includes nonlinear echo suppression:
spatial matching and speech preservation need validation in double talk.
"""
import numpy as np

# Verified for the pinned pywebrtc-audio 0.2.0 AEC3 backend at 16 kHz.
# This is capture filter delay, separate from the acoustic/render delay hint.
AEC3_CAPTURE_DELAY = 128


class Aec3Bank:
    def __init__(self, channels=7, sample_rate=16000, delay_ms=0, enabled=True):
        if sample_rate != 16000 or not 0 <= delay_ms <= 500:
            raise ValueError("AEC3 bank requires 16 kHz and a 0..500 ms delay hint")
        self.channels = channels
        self.enabled = enabled
        self.frames = 160
        self.processors = []
        if enabled:
            from pywebrtc_audio import EchoCanceller
            self.processors = [EchoCanceller(sample_rate=sample_rate, num_channels=1,
                                             stream_delay_ms=delay_ms) for _ in range(channels)]

    def process(self, capture, render):
        x = np.asarray(capture, dtype=np.float32)
        if x.shape != (self.frames, self.channels):
            raise ValueError("AEC3 capture must be exactly 10 ms, frames x selected channels")
        if not self.enabled:
            return x.copy()
        if render is None:
            raise ValueError("AEC3 requires the actual speaker PCM; use explicit --no-aec for no playback")
        ref = np.asarray(render, dtype=np.float32)
        if ref.shape != (self.frames,) or not np.isfinite(ref).all() or np.max(np.abs(ref), initial=0) > 1.001:
            raise ValueError("AEC3 render must be finite 10 ms mono float32 in [-1, 1]")
        if not np.isfinite(x).all() or np.max(np.abs(x), initial=0) > 1.001:
            raise ValueError("Invalid capture PCM")
        # Native float32 is normalized [-1, 1], verified against PCM16. Keep RAW
        # microphone precision through AEC; quantize only the final ASR WAV.
        ref = np.ascontiguousarray(ref)
        out = np.empty_like(x)
        for channel, apm in enumerate(self.processors):
            out[:, channel] = apm.process(np.ascontiguousarray(x[:, channel]), ref)
        return out
