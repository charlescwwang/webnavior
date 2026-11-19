"""Bounded, causal 512/256 periodic-Hann STFT with explicit 512-sample delay."""
import numpy as np

NFFT = 512
HOP = 256
RATE = 16000
WINDOW = (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(NFFT) / NFFT)).astype(np.float32)


class Analysis:
    def __init__(self, channels):
        self.buffer = np.zeros((HOP, channels), np.float32)
        self.channels = channels

    def push(self, audio):
        x = np.asarray(audio, dtype=np.float32)
        if x.ndim == 1:
            x = x[:, None]
        if x.ndim != 2 or x.shape[1] != self.channels:
            raise ValueError("Incorrect analysis channel count")
        self.buffer = np.concatenate((self.buffer, x))
        result = []
        while len(self.buffer) >= NFFT:
            result.append(np.fft.rfft(self.buffer[:NFFT] * WINDOW[:, None], axis=0).astype(np.complex64))
            self.buffer = self.buffer[HOP:]
        return result


class Synthesis:
    def __init__(self):
        self.ola = np.zeros(NFFT, np.float64)
        self.norm = np.zeros(NFFT, np.float64)
        self.first = True

    def push(self, spectrum):
        self.ola += np.fft.irfft(spectrum, n=NFFT) * WINDOW
        self.norm += WINDOW.astype(np.float64) ** 2
        out = np.divide(self.ola[:HOP], self.norm[:HOP], out=np.zeros(HOP), where=self.norm[:HOP] > 1e-8)
        self.ola[:-HOP] = self.ola[HOP:]
        self.ola[-HOP:] = 0
        self.norm[:-HOP] = self.norm[HOP:]
        self.norm[-HOP:] = 0
        if self.first:
            self.first = False
            return np.zeros(0, np.float32)  # leading analysis padding is not source audio
        return out.astype(np.float32)
