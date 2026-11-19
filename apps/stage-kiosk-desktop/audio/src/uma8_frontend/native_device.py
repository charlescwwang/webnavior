"""PortAudio owns eight physical input channels; Chromium owns normal speaker output.

The callback only copies bounded microphone PCM. Pairing, DSP and pipe IO stay
on the worker thread; short reference delivery pauses retain unpaired input.
Application render PCM is buffered/resampled onto the independent microphone clock.
This reference is application audio before the browser DAC, not system loopback.
"""
from collections import deque
import json
import os
import threading

import numpy as np


def portaudio():
    # sounddevice selects its bundled ASIO DLL at import time, as in the original
    # UMA-8 package. ASIO remains an explicit device choice, never a silent retry.
    os.environ['SD_ENABLE_ASIO'] = '1'
    import sounddevice
    return sounddevice


def devices(api=None):
    """Stable host/name identities; indices are rediscovered before every open."""
    api = api or portaudio()
    hosts = api.query_hostapis()
    return [dict(id=json.dumps([hosts[d['hostapi']]['name'], d['name']], separators=(',', ':')),
                 name=d['name'], host=hosts[d['hostapi']]['name'],
                 inputChannels=int(d['max_input_channels']), outputChannels=int(d['max_output_channels']))
            for d in api.query_devices()]


class Capture:
    """One generation owns one input stream; close discards all queued audio."""
    def __init__(self, input_device, api=None):
        self.api = api or portaudio()
        listing = devices(self.api)
        inputs = [i for i, d in enumerate(listing) if d['id'] == input_device] if input_device else [
            i for i, d in enumerate(listing) if d['inputChannels'] >= 8 and
            ('uma' in d['name'].lower() or 'micarray' in d['name'].lower())]
        if not input_device:
            # Windows exposes the same physical device through several hosts.
            # WASAPI is the original package's validated shared-mode path.
            wasapi = [i for i in inputs if listing[i]['host'] == 'Windows WASAPI']
            if wasapi:
                inputs = wasapi
        if len(inputs) != 1:
            raise ValueError('Native UMA-8 input is not available or ambiguous; select a native eight-channel device')
        source = inputs[0]
        if listing[source]['inputChannels'] < 8:
            raise ValueError('Native input requires eight physical channels; mono/stereo cannot be used')
        self.api.check_input_settings(device=source, channels=8, dtype='float32', samplerate=48000)
        self.input_id = listing[source]['id']
        self.lock = threading.Lock()
        self.captured = deque()
        self.captured_frames = 0
        self.playback = np.zeros((0, 2), np.float32)
        # A bounded 100 ms capture delay keeps IPC-delivered render ahead of
        # its echo. The render reservoir is 40–50 ms; AEC estimates the remaining
        # physical/browser delay. Separate USB/browser clocks are resampled below.
        self.microphone_delay = np.zeros((4800, 8), np.float32)
        self.position = 0.
        self.primed = False
        self.failure = None
        self.closed = False
        self.stream = self.api.InputStream(device=source, channels=8, samplerate=48000,
                                      dtype='float32', blocksize=480, callback=self._callback)
        try:
            self.stream.start()
        except BaseException:
            self.stream.close()
            raise

    def _callback(self, microphone, frames, clock, status):
        with self.lock:
            if self.closed or self.failure:
                return
            if status:
                self.failure = 'PortAudio input discontinuity: ' + str(status)
                return
            if self.captured_frames+frames > 12000:
                self.failure = 'Native capture exceeded 250 ms backlog waiting for processing/reference'
                return
            # PortAudio owns/reuses the callback buffer. Copy it before returning;
            # never wait here for browser IPC or consume reference by arrival time.
            self.captured.append(microphone.copy())
            self.captured_frames += frames

    def render(self, audio):
        """Enqueue the actual application stereo mix; excess backlog terminates this owner."""
        with self.lock:
            if len(self.playback)+len(audio) > 12000:
                self.failure = 'Native speaker queue exceeded 250 ms backlog'
            else:
                self.playback = np.concatenate((self.playback, audio))

    def read(self):
        if not self.stream.active:
            raise RuntimeError('Native PortAudio stream stopped unexpectedly')
        with self.lock:
            if self.failure:
                raise RuntimeError(self.failure)
            # NOTICE: WASAPI/PortAudio and browser IPC can deliver in bursts.
            # Consuming render in the native callback treated a short delivery
            # pause as lost PCM even with the model bypassed. Pair only complete
            # blocks here, retaining both clocks' samples until they are ready.
            # The 250 ms bounds still stop a genuinely stalled/overloaded owner.
            # https://python-sounddevice.readthedocs.io/en/0.5.6/api/streams.html
            if not self.primed:
                if len(self.playback) < 1920:
                    return np.zeros((0, 10), np.float32)
                self.primed = True
            # Subtract waiting microphone frames so a callback burst does not
            # masquerade as clock drift. Keep 40–50 ms of render headroom; the
            # bounded ±0.5% correction changes clock rate, never drops samples.
            rate = 1 + np.clip((len(self.playback)-self.captured_frames-2400)/480000, -.005, .005)
            blocks = []
            while self.captured:
                microphone = self.captured[0]
                frames = len(microphone)
                positions = self.position + np.arange(frames)*rate
                if positions[-1] >= len(self.playback)-1:
                    break
                index = positions.astype(np.int32)
                fraction = (positions-index)[:, None]
                reference = self.playback[index]*(1-fraction) + self.playback[index+1]*fraction
                consumed = int(self.position+frames*rate)
                self.position = self.position+frames*rate-consumed
                self.playback = self.playback[consumed:]
                np.clip(reference, -1, 1, out=reference)
                self.captured.popleft()
                self.captured_frames -= frames
                delayed = np.concatenate((self.microphone_delay, microphone))
                self.microphone_delay = delayed[frames:]
                blocks.append(np.column_stack((delayed[:frames], reference)))
        return np.concatenate(blocks) if blocks else np.zeros((0, 10), np.float32)

    def close(self):
        with self.lock:
            self.closed = True
            self.captured.clear()
            self.captured_frames = 0
            self.playback = np.zeros((0, 2), np.float32)
        try:
            self.stream.abort()
        finally:
            self.stream.close()
