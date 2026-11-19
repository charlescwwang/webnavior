"""Stateful seven-channel capture plus mono render resampling on one clock."""
import numpy as np
from scipy.signal import firwin, lfilter


class Decimator:
    """48 kHz to 16 kHz FIR with bounded history and no independent channel clocks."""
    def __init__(self):
        self.b = firwin(97, .95/3)
        self.state = np.zeros((96, 8))
        self.offset = 0

    def push(self, samples):
        filtered, self.state = lfilter(self.b, [1.], samples, axis=0, zi=self.state)
        start = (-self.offset) % 3
        self.offset = (self.offset+len(samples)) % 3
        return filtered[start::3].astype(np.float32)
