from collections import deque
from dataclasses import dataclass
import numpy as np
import webrtcvad
from .spectral import RATE, HOP


class SpeechActivity:
    """Independent 10 ms pre-beam VAD with 80 ms evidence hold for STFT hops.

    This is activity only, not target identity. Each Frontend owns one instance;
    it is never reset at utterance boundaries and retains less than 10 ms PCM.
    """
    def __init__(self, mode):
        self.vad = webrtcvad.Vad(mode)
        self.pending = np.zeros(0, np.float32)
        self.hold_samples = 0

    def push(self, audio):
        self.hold_samples = max(0, self.hold_samples-len(audio))
        self.pending = np.concatenate((self.pending, audio))
        while len(self.pending) >= 160:
            frame, self.pending = self.pending[:160], self.pending[160:]
            pcm = np.rint(np.clip(frame, -1, 1)*32767).astype("<i2").tobytes()
            if self.vad.is_speech(pcm, RATE):
                self.hold_samples = int(.08*RATE)
        return self.hold_samples > 0


@dataclass
class Segment:
    start_sample: int
    audio: np.ndarray
    end_reason: str

    @property
    def start_s(self):
        return self.start_sample / RATE

    @property
    def end_s(self):
        return (self.start_sample + len(self.audio)) / RATE


class TargetSegmenter:
    """10 ms WebRTC VAD plus spatial evidence, pre-roll and hangover.

    Spatial evidence is supplied per 16 ms STFT output chunk. False frames
    inside a confirmed turn remain in the audio to avoid clipping phonemes.
    """
    def __init__(self, config):
        self.cfg = config
        self.vad = webrtcvad.Vad(config.vad_mode)
        self.pre_roll_frames = max(1, int(np.ceil(config.pre_roll_ms / 10)))
        capacity = config.rtf_reacquire_buffer_ms if config.online_rtf_enabled else config.pre_roll_ms
        self.history = deque(maxlen=max(1, int(np.ceil(capacity / 10))))
        self.pending = np.zeros(0, np.float32)
        self.evidence = np.zeros(0, bool)
        self.candidates = np.zeros(0, bool)
        self.candidate_start = None
        self.last_candidate = 0
        self.active = []
        self.start = 0
        self.cursor = 0
        self.speech_frames = 0
        self.silence = 0

    def push(self, audio, target_present, *, candidate_present=False):
        audio = np.asarray(audio, dtype=np.float32)
        self.pending = np.concatenate((self.pending, audio))
        self.evidence = np.concatenate((self.evidence, np.full(len(audio), target_present, bool)))
        self.candidates = np.concatenate((self.candidates, np.full(len(audio), candidate_present, bool)))
        completed = []
        while len(self.pending) >= 160:
            frame = self.pending[:160].copy()
            spatial = bool(np.mean(self.evidence[:160]) >= 0.5)
            candidate = bool(np.mean(self.candidates[:160]) >= 0.5)
            self.pending = self.pending[160:]
            self.evidence = self.evidence[160:]
            self.candidates = self.candidates[160:]
            pcm = np.rint(np.clip(frame, -1, 1) * 32767).astype("<i2").tobytes()
            speech = spatial and self.vad.is_speech(pcm, RATE)
            if not self.active:
                if candidate:
                    if self.candidate_start is None:
                        self.candidate_start = self.cursor
                    self.last_candidate = self.cursor
                elif self.cursor-self.last_candidate >= self.cfg.end_silence_ms*16:
                    self.candidate_start = None
                if speech:
                    # Retain candidate audio until the spatial estimator confirms
                    # it, so reacquiring a position does not clip the first word.
                    # Unconfirmed candidates are never submitted to ASR.
                    keep = self.pre_roll_frames
                    if self.candidate_start is not None:
                        keep += (self.cursor-self.candidate_start)//160
                    history = list(self.history)[-keep:]
                    self.start = self.cursor - len(history) * 160
                    self.active = history + [frame]
                    self.history.clear()
                    self.speech_frames = 1
                    self.silence = 0
                else:
                    self.history.append(frame)
            else:
                self.active.append(frame)
                self.speech_frames += int(speech)
                self.silence = 0 if speech else self.silence + 1
                reason = None
                if self.silence * 10 >= self.cfg.end_silence_ms:
                    reason = "silence"
                elif len(self.active) * 0.01 >= self.cfg.max_segment_s:
                    reason = "max_duration"
                if reason:
                    item = self._finish(reason)
                    if item is not None:
                        completed.append(item)
            self.cursor += 160
        return completed

    def _finish(self, reason):
        item = None
        if self.active and self.speech_frames * 10 >= self.cfg.min_speech_ms:
            item = Segment(self.start, np.concatenate(self.active), reason)
        self.active = []
        self.speech_frames = self.silence = 0
        self.history.clear()
        self.candidate_start = None
        return item

    def flush(self):
        if self.active and len(self.pending):
            self.active.append(self.pending.copy())
        self.pending = np.zeros(0, np.float32)
        self.evidence = np.zeros(0, bool)
        self.candidates = np.zeros(0, bool)
        item = self._finish("end_of_stream")
        return [] if item is None else [item]
