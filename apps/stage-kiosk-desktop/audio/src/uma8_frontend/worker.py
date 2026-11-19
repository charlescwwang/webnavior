"""Electron-owned binary worker. Owns native audio devices; no HTTP server, ASR or credentials.

    Electron Eventa -> length-prefixed stdin -> Worker -> Frontend -> stdout

One process loads one model. A generation owns capture/AEC/RTF/VAD state; replacing
or stopping it discards incomplete speech. stdin EOF releases the process. Each
response echoes its request id; no unsolicited audio can enter a newer document.
"""
import argparse
from dataclasses import replace
import json
import os
from pathlib import Path
import struct
import sys
import time
import traceback

import numpy as np

from .config import Config
from .denoise import UlUnas
from .pipeline import Frontend
from .resampling import Decimator
from .native_device import Capture, devices

MAX_JSON = 64*1024
MAX_PCM = 2*1024*1024


def read_exact(stream, size):
    """Pipe reads may split anywhere, including the fixed eight-byte envelope."""
    chunks = bytearray()
    while len(chunks) < size:
        chunk = stream.read(size-len(chunks))
        if not chunk:
            if not chunks:
                return None
            raise EOFError("Truncated native audio frame")
        chunks.extend(chunk)
    return bytes(chunks)


def read_frame(stream):
    header = read_exact(stream, 8)
    if header is None:
        return None
    json_size, pcm_size = struct.unpack("<II", header)
    if not 0 < json_size <= MAX_JSON or pcm_size > MAX_PCM or pcm_size % 4:
        raise ValueError("Invalid native audio envelope size")
    meta = read_exact(stream, json_size)
    pcm = read_exact(stream, pcm_size) if pcm_size else b""
    if meta is None or pcm is None:
        raise EOFError("Truncated native audio payload")
    request = json.loads(meta)
    if not isinstance(request, dict) or type(request.get("id")) is not int:
        raise ValueError("Native audio request needs an integer id")
    return request, pcm


def write_frame(stream, meta, samples):
    """JSON descriptors precede contiguous little-endian float32 PCM."""
    data = json.dumps(meta, separators=(",", ":"), allow_nan=False).encode()
    pcm = np.asarray(samples, dtype="<f4").tobytes()
    if len(data) > MAX_JSON or len(pcm) > MAX_PCM:
        raise ValueError("Native audio response exceeded its storage bound")
    stream.write(struct.pack("<II", len(data), len(pcm))+data+pcm)
    stream.flush()


def playback(request, payload, offset):
    """Validate one contiguous, normalized stereo reference packet for either owner."""
    if request.get('offsetFrames') != offset or len(payload) != 2*384*4:
        raise ValueError('Native playback clock is discontinuous')
    render = np.frombuffer(payload, dtype='<f4').reshape(2, 384).T
    if not np.isfinite(render).all() or np.max(abs(render)) > 1.001:
        raise ValueError('Invalid normalized speaker PCM')
    return render


class InputWorker:
    """Only paired 48 kHz physical PCM; existing browser AEC/LCMV owns all DSP."""
    def __init__(self):
        self.capture = None
        self.generation = None
        self.offset = self.render_offset = 0

    def close_capture(self):
        capture, self.capture = self.capture, None
        if capture is not None:
            capture.close()

    def handle(self, request, payload):
        kind, generation = request.get('kind'), request.get('generation')
        if not isinstance(generation, str) or not 1 <= len(generation) <= 128:
            raise ValueError('Missing capture generation')
        if kind == 'open':
            self.close_capture()
            self.capture = Capture(request.get('inputDevice', ''))
            self.generation = generation
            self.offset = self.render_offset = 0
            return dict(inputDevice=self.capture.input_id, captureDelayFrames=len(self.capture.microphone_delay)), np.zeros(0, np.float32)
        if kind == 'stop':
            if generation == self.generation:
                self.close_capture()
                self.generation = None
            return dict(state='stopped'), np.zeros(0, np.float32)
        if kind != 'poll' or generation != self.generation or self.capture is None:
            raise ValueError('Stale or unopened native array input')
        render = playback(request, payload, self.render_offset)
        self.render_offset += 384
        self.capture.render(render)
        raw = self.capture.read()
        offset = self.offset
        self.offset += len(raw)
        return dict(rawOffsetFrames=offset, processedFrames=self.offset, renderFrames=self.render_offset), raw.T.astype('<f4').reshape(-1)


class Worker:
    """Owns model lifetime independently of the current capture generation."""
    def __init__(self, directory, model, provider, *, denoise_enabled=True):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.config = Config(calibration=str(self.directory / "target_rtf.npz"), model=str(model),
                             provider=provider, automatic_rtf=True, denoise_enabled=denoise_enabled)
        self.denoiser = UlUnas(model, provider=provider, enabled=denoise_enabled)
        self.generation = None
        self.frontend = None
        self.offset = 0
        self.output_offset = 0
        self.capture = None

    def close_capture(self):
        """Stop callbacks before retiring their generation or model state."""
        capture, self.capture = self.capture, None
        if capture is not None:
            capture.close()

    def handle(self, request, payload):
        kind = request.get("kind")
        if kind == "status":
            return dict(state="automatic",
                        **self.denoiser.diagnostics), np.zeros(0, np.float32)
        generation = request.get("generation")
        if not isinstance(generation, str) or not 1 <= len(generation) <= 128:
            raise ValueError("Missing capture generation")
        if kind == "start":
            channels = request.get("channels")
            if not isinstance(channels, list) or any(type(x) is not int or not 0 <= x < 8 for x in channels):
                raise ValueError("Invalid physical channel map")
            cfg = replace(self.config, channels=channels,
                          input_gain_db=request.get("gainDb", 30),
                          end_silence_ms=request.get("silenceMs", 600),
                          min_speech_ms=request.get("minSpeechMs", 80)).validate()
            self.close_capture()
            self.generation = None
            self.frontend = None
            self.offset = self.output_offset = 0
            self.decimator = Decimator()
            self.resample_discard = 16  # 97-tap FIR group delay: 48/3 output samples.
            self.pending = np.zeros((0, 8), np.float32)
            self.active_config = cfg
            self.denoiser.reset()
            self.frontend = Frontend(cfg, denoiser=self.denoiser)
            self.generation = generation
            return dict(state=kind, **self.denoiser.diagnostics), np.zeros(0, np.float32)
        if kind == "open":
            if generation != self.generation or self.capture is not None:
                raise ValueError("Stale or already open native capture")
            self.capture = Capture(request.get("inputDevice", ""))
            self.native_pending = np.zeros((0, 10), np.float32)
            self.render_offset = 0
            return dict(inputDevice=self.capture.input_id), np.zeros(0, np.float32)
        if kind == "poll":
            if generation != self.generation or self.capture is None:
                raise ValueError("Stale or unopened native capture")
            render = playback(request, payload, self.render_offset)
            self.render_offset += 384
            self.capture.render(render)
            raw = self.capture.read()
            self.native_pending = np.concatenate((self.native_pending, raw))
            frames, segments, pcm = [], [], []
            cursor = 0
            processing_ms = 0.
            while len(self.native_pending) >= 384:
                block, self.native_pending = self.native_pending[:384], self.native_pending[384:]
                result, audio = self.handle(dict(kind="block", generation=generation, offsetFrames=self.offset),
                                            block.T.astype('<f4').tobytes())
                for key, target in (("frames", frames), ("segments", segments)):
                    for descriptor in result[key]:
                        target.append(dict(descriptor, pcmStart=descriptor["pcmStart"]+cursor))
                pcm.append(audio)
                cursor += len(audio)
                processing_ms += result['processingMs']
            power = float(np.mean(raw[:, self.active_config.channels]**2)) if len(raw) else 0.
            reference_frames = int(np.count_nonzero(np.any(abs(raw[:, 8:]) > 1e-6, axis=1)))
            return dict(processedFrames=self.offset, renderFrames=self.render_offset, frames=frames, segments=segments,
                        inputPower=power, referenceFrames=reference_frames,
                        phraseActive=bool(self.frontend and self.frontend.segmenter.active), processingMs=processing_ms), np.concatenate(pcm) if pcm else np.zeros(0, np.float32)
        if kind == "stop":
            # A late retiring page cannot stop the next page's generation.
            if generation == self.generation or (self.generation is None and self.capture is not None):
                self.close_capture()
                self.generation = None
                self.frontend = None
            return dict(state="stopped"), np.zeros(0, np.float32)
        if kind != "block" or generation != self.generation:
            raise ValueError("Stale or unknown native audio generation")
        if request.get("offsetFrames") != self.offset or len(payload) != 10*384*4:
            raise ValueError("Native capture sample clock is discontinuous")
        planar = np.frombuffer(payload, dtype="<f4").reshape(10, 384)
        if not np.isfinite(planar).all() or np.max(abs(planar)) > 1.001:
            raise ValueError("Invalid normalized multichannel PCM")
        self.offset += 384
        # The AEC bank owns mono reference. Both actual rendered channels are
        # downmixed together, then resampled with capture on exactly one clock.
        paired = np.column_stack((planar[self.active_config.channels].T, np.mean(planar[8:10], axis=0)))
        paired = self.decimator.push(paired)
        discard = min(self.resample_discard, len(paired))
        self.resample_discard -= discard
        self.pending = np.concatenate((self.pending, paired[discard:]))
        frames, segments, pcm = [], [], []
        cursor = 0
        tic = time.perf_counter()
        while len(self.pending) >= 160:
            block, self.pending = self.pending[:160], self.pending[160:]
            audio, events, telemetry = self.frontend.push(block[:, :7], block[:, 7])
            for start in range(0, len(audio), 256):
                chunk = audio[start:start+256]
                info = telemetry[start//256]
                frames.append(dict(offsetSamples=self.output_offset, length=len(chunk),
                                   speech=bool(info["gain_target_speech"]),
                                   rtfState=info["rtf_state"], rtfUpdates=info["rtf_updates"],
                                   pcmStart=cursor))
                self.output_offset += len(chunk)
                cursor += len(chunk)
                pcm.append(chunk)
            for event in events:
                segments.append(dict(startSample=event.start_sample, length=len(event.audio),
                                     endReason=event.end_reason, pcmStart=cursor))
                pcm.append(event.audio)
                cursor += len(event.audio)
        return dict(processedFrames=self.offset, frames=frames, segments=segments,
                    phraseActive=bool(self.frontend and self.frontend.segmenter.active),
                    processingMs=(time.perf_counter()-tic)*1000), np.concatenate(pcm) if pcm else np.zeros(0, np.float32)


def main(output):
    """Use entry.py's reserved binary pipe; stdin EOF ends this Electron owner."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--state-dir", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--capture-only", action="store_true")
    parser.add_argument("--provider", choices=("openvino", "cpu"), default="openvino")
    # The dedicated launcher scopes this flag to one EXE lifetime. No profile
    # preference is saved; ordinary startup retains model-enabled behavior.
    parser.add_argument('--bypass-denoiser', action='store_true',
                        default=os.environ.get('WEBNAVIOR_TEST_BYPASS_ULUNAS') == '1')
    args = parser.parse_args()
    worker = None
    while True:
        frame = read_frame(sys.stdin.buffer)
        if frame is None:
            break
        request, payload = frame
        try:
            # Delay model loading until its first request can receive the real
            # initialization error, rather than an unexplained pipe closure.
            if request.get("kind") == "devices":
                result, pcm = dict(devices=devices()), np.zeros(0, np.float32)
            else:
                if worker is None:
                    worker = InputWorker() if args.capture_only else Worker(args.state_dir, args.model, args.provider, denoise_enabled=not args.bypass_denoiser)
                result, pcm = worker.handle(request, payload)
            response = dict(id=request["id"], ok=True, result=result)
        except Exception as error:
            # Failed audio is never resumed after a partial/discontinuous frame.
            # A stale block belongs to the retiring capture, not the current
            # one. Only a failed block from the active owner retires its state.
            if worker is None:
                traceback.print_exc(file=sys.stderr)
            elif request.get("kind") in ("block", "poll", "open") and request.get("generation") == worker.generation:
                try:
                    worker.close_capture()
                except Exception:
                    traceback.print_exc(file=sys.stderr)
                worker.generation = None
                if isinstance(worker, Worker):
                    worker.frontend = None
            response, pcm = dict(id=request["id"], ok=False, error=str(error)[:500]), np.zeros(0, np.float32)
        write_frame(output, response, pcm)
        if worker is None and not response["ok"]:
            # Initialization failure is terminal, with no CPU retry. The
            # supervisor retires the process and any remaining requests.
            return

    if worker is not None:
        worker.close_capture()
