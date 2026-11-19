import time
from collections import deque
import numpy as np
from .aec import Aec3Bank, AEC3_CAPTURE_DELAY
from .beamforming import NearFieldMvdr
from .hush import Model, FRAME
from .spectral import Analysis, Synthesis, HOP, NFFT
from .segment import TargetSegmenter, SpeechActivity
from .gain import TargetGain


class Frontend:
    """Synchronous stream API: push exactly 160 samples, get source-aligned PCM and length-tagged telemetry.

    Call only from an audio worker, never a hardware callback. Each stream owns
    independent AEC/model/MVDR/VAD state. Output length is variable while buffering.
    """
    def __init__(self, config, stage_callback=None, *, denoiser=None):
        config.validate()
        self.cfg = config
        self.aec = Aec3Bank(7, delay_ms=config.aec_delay_ms) if config.aec_enabled else None
        self.beam = NearFieldMvdr(config)
        self.model = Model(config.model) if denoiser is None else None
        self.denoise = denoiser if denoiser is not None else self.model.session(config.hush_attenuation_db, config.hush_dry_mix_percent)
        self.hush_pending = np.zeros(0, np.float32)
        self.hush_evidence = deque()
        self.hush_discard = self.denoise.delay_samples
        self.analysis = Analysis(7)
        self.synthesis = Synthesis()
        self.stage_callback = stage_callback
        self.cleaned_samples = 0
        self.segmenter = TargetSegmenter(config)
        self.activity = SpeechActivity(config.vad_mode)
        self.speech_present = False
        self.playback_hold_samples = 0
        self.gain = TargetGain(config)
        self.evidence = deque()
        self.input_samples = 0
        self.output_samples = 0
        self.finished = False
        self.aec_discard = AEC3_CAPTURE_DELAY if config.aec_enabled else 0
        self.timings_ms = deque(maxlen=10000)

    def _emit(self, name, audio):
        if self.stage_callback and len(audio):
            self.stage_callback(name, audio.copy())

    def _prepare(self, cleaned):
        self.cleaned_samples += len(cleaned)
        self._emit("aec", cleaned)
        amplified = cleaned * (10 ** (self.cfg.input_gain_db / 20))
        self.speech_present = self.activity.push(amplified[:, self.cfg.reference_channel])
        self._emit("level", amplified)
        return amplified

    def close(self):
        """Retire generation-owned native state before releasing shared weights."""
        self.denoise.close()
        if self.model is not None:
            self.model.close()

    def _spectra(self, frames, max_samples=None):
        audio, events, telemetry = [], [], []
        for spectrum in frames:
            y, info = self.beam.process(spectrum, speech_present=self.speech_present,
                                        playback_active=self.playback_hold_samples > 0)
            self.evidence.append(info)
            out = self.synthesis.push(y)
            if not len(out):
                continue
            # OLA combines two adjacent windows. Their evidence describes this
            # source hop, before Hush adds its own independent buffering/delay.
            infos = list(self.evidence)
            aligned = dict(infos[0])
            aligned["target_present"] = any(i["target_present"] for i in infos)
            aligned["spatial_score"] = max(i["spatial_score"] for i in infos)
            aligned["target_candidate"] = any(i["target_candidate"] for i in infos)
            self.evidence.popleft()
            self._emit("mvdr", out)
            self.hush_pending = np.concatenate((self.hush_pending, out))
            self.hush_evidence.append((len(out), aligned))
            while len(self.hush_pending) >= FRAME:
                frame, self.hush_pending = self.hush_pending[:FRAME], self.hush_pending[FRAME:]
                enhanced = self.denoise.process(frame)
                discard = min(self.hush_discard, len(enhanced))
                self.hush_discard -= discard
                enhanced = enhanced[discard:]
                # Evidence is consumed with output SOURCE samples, not when an
                # input frame enters Hush. Splitting at evidence boundaries keeps
                # AGC/VAD exact across 256-sample OLA and 160-sample model frames.
                while len(enhanced):
                    count, evidence = self.hush_evidence.popleft()
                    take = min(count, len(enhanced))
                    if max_samples is not None:
                        take = min(take, max(0, max_samples-sum(len(x) for x in audio)))
                    if not take:
                        self.hush_evidence.appendleft((count, evidence))
                        return (np.concatenate(audio) if audio else np.zeros(0, np.float32)), events, telemetry
                    chunk, enhanced = enhanced[:take], enhanced[take:]
                    if count > take:
                        self.hush_evidence.appendleft((count-take, evidence))
                    self._emit("denoise", chunk)
                    chunk, gain_info = self.gain.process(chunk, evidence["target_present"])
                    self._emit("agc", chunk)
                    self.output_samples += len(chunk)
                    audio.append(chunk)
                    telemetry.append(dict(evidence, **gain_info, length=len(chunk)))
                    events.extend(self.segmenter.push(chunk, evidence["target_present"],
                                                       candidate_present=evidence["target_candidate"]))
        return (np.concatenate(audio) if audio else np.zeros(0, np.float32)), events, telemetry

    def push(self, capture, render=None):
        if self.finished:
            raise RuntimeError("Stream has already been flushed")
        tic = time.perf_counter()
        cleaned = self.aec.process(capture, render) if self.aec is not None else capture.copy()
        self.playback_hold_samples = max(0, self.playback_hold_samples-len(capture))
        if render is not None and np.max(np.abs(render), initial=0) > 1e-6:
            # Freeze through the immediate acoustic tail as well as playback.
            # Keep capture, echo cancellation and utterance processing running.
            self.playback_hold_samples = int(self.cfg.rtf_playback_hold_ms*16)
        discard = min(self.aec_discard, len(cleaned))
        cleaned = cleaned[discard:]
        self.aec_discard -= discard
        self.input_samples += len(capture)
        result = self._spectra(self.analysis.push(self._prepare(cleaned)))
        self.timings_ms.append((time.perf_counter() - tic) * 1000)
        return result

    def flush(self):
        if self.finished:
            return np.zeros(0, np.float32), [], []
        self.finished = True
        # Drain the native AEC capture delay before padding STFT/OLA. The first
        # 128 native samples were discarded in push(), so source timestamps and
        # the final phoneme are retained rather than shifted/truncated by 8 ms.
        remaining = self.input_samples - self.output_samples
        drain = np.zeros((0, 7), np.float32)
        if self.cfg.aec_enabled:
            drain = self.aec.process(np.zeros((160, 7), np.float32), np.zeros(160, np.float32))
            drain = drain[self.aec_discard:]
            self.aec_discard = 0
        drain = drain[:max(0, self.input_samples - self.cleaned_samples)]
        frames = self.analysis.push(np.concatenate((self._prepare(drain), np.zeros((NFFT * 2, 7), np.float32))))
        out, events, telemetry = self._spectra(frames, max_samples=remaining)
        events.extend(self.segmenter.flush())
        valid = []
        for item in events:
            keep = max(0, self.input_samples - item.start_sample)
            item.audio = item.audio[:keep]
            if len(item.audio):
                valid.append(item)
        # Finalize is terminal: padded samples/evidence have no future owner.
        self.hush_pending = np.zeros(0, np.float32)
        self.hush_evidence.clear()
        self.evidence.clear()
        return out, valid, telemetry
