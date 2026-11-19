"""Pinned native Hush/Tract CPU model and generation-owned 16 kHz sessions."""
import configparser
import ctypes as c
import math
from pathlib import Path
import sys
import tarfile

import numpy as np


BUNDLE = 'advanced_dfnet16k_model_best_onnx.tar.gz'
FRAME = 160


class Model:
    """Load immutable weights once; sessions must close before their model owner."""
    def __init__(self, directory):
        directory = Path(directory)
        library = directory / ('weya_nc.dll' if sys.platform == 'win32' else 'libweya_nc.so')
        bundle = directory / BUNDLE
        if not library.is_file() or not bundle.is_file():
            raise FileNotFoundError('Hush native library or model bundle is missing')
        # This ABI exposes no latency query. Validate the pinned model's geometry
        # before applying fft_size-hop_size latency compensation (zero lookahead).
        with tarfile.open(bundle, 'r:gz') as archive:
            config = archive.extractfile('config.ini')
            if config is None or archive.getmember('config.ini').size > 65536:
                raise ValueError('Invalid Hush model configuration')
            settings = configparser.ConfigParser()
            settings.read_string(config.read().decode('utf-8'))
        if (settings.getint('df', 'sr'), settings.getint('df', 'hop_size'), settings.getint('df', 'fft_size'),
                settings.getint('deepfilternet', 'conv_lookahead'), settings.getint('deepfilternet', 'df_lookahead')) != (16000, 160, 320, 0, 0):
            raise ValueError('Unsupported Hush sample rate, frame geometry or lookahead')
        self.lib = c.CDLL(str(library.resolve()))
        for name, arguments, result in (
            ('model_load_from_path', [c.c_char_p], c.c_void_p),
            ('model_free', [c.c_void_p], None),
            ('session_create', [c.c_void_p, c.c_size_t, c.c_float], c.c_void_p),
            ('session_free', [c.c_void_p], None),
            ('get_frame_length', [c.c_void_p], c.c_size_t),
            ('get_sample_rate', [c.c_void_p], c.c_size_t),
            ('process_frame', [c.c_void_p, c.POINTER(c.c_float), c.POINTER(c.c_float)], c.c_float),
        ):
            fn = getattr(self.lib, 'weya_nc_'+name)
            fn.argtypes, fn.restype = arguments, result
        self.handle = self.lib.weya_nc_model_load_from_path(str(bundle.resolve()).encode('utf-8'))
        if not self.handle:
            raise RuntimeError('Hush model initialization failed')
        self.diagnostics = dict(runtime='Hush / Tract', requested_provider='CPU', active_providers=['CPU'],
                                device_name='CPU', sampleRate=16000, frameLength=FRAME, modelDelaySamples=FRAME)

    def session(self, attenuation_db=100., dry_mix_percent=0.):
        if not self.handle:
            raise RuntimeError('Hush model is closed')
        return Session(self, attenuation_db, dry_mix_percent)

    def close(self):
        if self.handle:
            self.lib.weya_nc_model_free(self.handle)
            self.handle = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


class Session:
    """Continuous recurrent/OLA state, never reset at individual utterance boundaries."""
    def __init__(self, model, attenuation_db, dry_mix_percent):
        for value in (attenuation_db, dry_mix_percent):
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 100:
                raise ValueError('Hush attenuation and dry mix must be finite numbers in 0..100')
        self.model = model
        self.attenuation_db = attenuation_db
        self.dry_mix = dry_mix_percent/100
        # The pinned native 0 dB branch directly returns its input. Positive
        # attenuation uses the 160-sample OLA delay measured for this model.
        self.delay_samples = FRAME if attenuation_db > 0 else 0
        self.dry_previous = np.zeros(self.delay_samples, np.float32)
        self.handle = model.lib.weya_nc_session_create(model.handle, 16000, float(attenuation_db))
        if not self.handle:
            raise RuntimeError('Hush session initialization failed')
        if (model.lib.weya_nc_get_frame_length(self.handle), model.lib.weya_nc_get_sample_rate(self.handle)) != (FRAME, 16000):
            self.close()
            raise RuntimeError('Unexpected Hush native frame format')

    def process(self, audio):
        if not self.handle:
            raise RuntimeError('Hush session is closed')
        samples = np.asarray(audio, dtype=np.float32)
        if samples.shape != (FRAME,) or not np.isfinite(samples).all():
            raise ValueError('Hush requires 160 finite mono samples')
        # Keep dry MVDR PCM before native clipping and silence-floor injection.
        # Both paths must address the same source samples before AGC and VAD.
        if self.attenuation_db == 0:
            return samples.copy()
        dry, self.dry_previous = self.dry_previous, samples.copy()
        samples = np.ascontiguousarray(np.clip(samples, -1, 1))
        # NOTICE: The pinned upstream Tract runtime returns early for mean-square energy <1e-7,
        # freezing OLA/recurrent clocks even when valid tail audio is pending.
        # Advance every source frame, including flush padding, with a -68 dBFS Nyquist
        # floor only in that branch. Remove if the native silence shortcut changes.
        # https://github.com/pulp-vision/Hush/blob/main/native/weya_nc_build/vendor/deep_filter/src/tract.rs
        if np.mean(samples.astype(np.float64)**2) < 1e-7:
            samples = samples.copy()
            samples[::2] += 4e-4
            samples[1::2] -= 4e-4
        output = np.empty(FRAME, np.float32)
        score = self.model.lib.weya_nc_process_frame(self.handle, samples.ctypes.data_as(c.POINTER(c.c_float)),
                                                    output.ctypes.data_as(c.POINTER(c.c_float)))
        # The native ABI reports processing failures as -100 and copies its input.
        # Treat that sentinel as failure rather than silently accepting passthrough.
        if not np.isfinite(score) or score == -100 or not np.isfinite(output).all():
            raise RuntimeError('Hush inference failed or returned nonfinite audio')
        return output*(1-self.dry_mix)+dry*self.dry_mix

    def close(self):
        if self.handle:
            self.model.lib.weya_nc_session_free(self.handle)
            self.handle = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
