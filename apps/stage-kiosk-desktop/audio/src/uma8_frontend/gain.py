"""Bounded output gain; only target-matching speech can increase adaptive gain."""
import numpy as np
import webrtcvad


class TargetGain:
    def __init__(self, config):
        self.cfg = config
        self.gain_db = 0.0
        self.vad = webrtcvad.Vad(config.vad_mode)
        self.pending = np.zeros(0, np.float32)
        self.evidence = np.zeros(0, bool)

    def process(self, audio, target_present):
        x = np.asarray(audio, np.float32)
        self.pending = np.concatenate((self.pending, x))
        self.evidence = np.concatenate((self.evidence, np.full(len(x), target_present, bool)))
        target_speech = False
        while len(self.pending) >= 160:
            block = self.pending[:160]
            evidence = bool(np.mean(self.evidence[:160]) >= 0.5)
            pcm = np.rint(np.clip(block, -1, 1)*32767).astype("<i2").tobytes()
            speech = self.vad.is_speech(pcm, 16000)
            target_speech |= evidence and speech
            self.pending = self.pending[160:]
            self.evidence = self.evidence[160:]
        previous = self.gain_db
        if self.cfg.agc_enabled:
            level = 20*np.log10(max(float(np.sqrt(np.mean(x*x))), 1e-10))
            if target_speech:
                desired = float(np.clip(self.cfg.agc_target_dbfs-level-self.cfg.gain_db, 0, self.cfg.agc_max_gain_db))
            else:
                desired = 0.0  # never chase background level upward in target silence
            delta = desired - self.gain_db
            slew = self.cfg.agc_attack_db_per_s if delta > 0 else self.cfg.agc_release_db_per_s
            self.gain_db += float(np.clip(delta, -slew*len(x)/16000, slew*len(x)/16000))
        else:
            self.gain_db = 0.0
        ramp = np.linspace(previous, self.gain_db, len(x), dtype=np.float32)
        y = x * np.power(10, (ramp+self.cfg.gain_db)/20)
        peak = float(np.max(np.abs(y), initial=0))
        if peak > 0.98:
            y *= 0.98/peak
        return y.astype(np.float32), dict(adaptive_gain_db=self.gain_db, gain_target_speech=target_speech,
                                         limiter_active=peak > 0.98)
