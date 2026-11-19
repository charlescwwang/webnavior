from pathlib import Path
import json
import numpy as np
from .spectral import Analysis, NFFT, HOP, RATE
from .onlineRtf import OnlineRtf


def spherical_rtf(mics_m, target_m, reference_channel=0):
    """Measured coordinates only. Geometry convention is deliberately caller-defined."""
    mics = np.asarray(mics_m, dtype=float)
    target = np.asarray(target_m, dtype=float)
    if mics.shape != (7, 3) or target.shape != (3,) or not np.isfinite(mics).all() or not np.isfinite(target).all():
        raise ValueError("Expected finite seven xyz mic coordinates and one xyz target, metres")
    distances = np.linalg.norm(mics - target, axis=1)
    if distances.min() < 0.005:
        raise ValueError("Target is too close to a microphone")
    freqs = np.fft.rfftfreq(NFFT, 1 / RATE)
    relative_distance = distances - distances[reference_channel]
    return ((distances[reference_channel] / distances)[None, :] *
            np.exp(-2j * np.pi * freqs[:, None] * relative_distance[None, :] / 343)).astype(np.complex64)


def calibrate(audio, path, channels, reference_channel=0, aec_enabled=False, input_device=None):
    x = np.asarray(audio, dtype=np.float32)
    if x.ndim != 2 or x.shape[1] != 7 or len(x) < RATE * 2 or not np.isfinite(x).all():
        raise ValueError("Calibration requires at least 2 seconds of seven-channel clean target speech")
    if np.max(np.abs(x)) > 0.98:
        raise ValueError("Calibration is clipping; reduce hardware gain")
    levels = np.sqrt(np.mean(x * x, axis=0))
    if levels.min() < 1e-6 or np.max(levels) / levels.min() > 100:
        raise ValueError("Calibration has silent/invalid channels; verify channel mapping")
    highly_correlated_pairs = sum(np.corrcoef(x[:, i], x[:, j])[0, 1] > 0.99999 for i in range(7) for j in range(i))
    spectra = np.stack(Analysis(7).push(x))
    energy = np.mean(np.abs(spectra) ** 2, axis=(1, 2))
    if np.sqrt(np.mean(x * x)) < 1e-4:
        raise ValueError("Calibration speech is too quiet")
    strong = spectra[energy > max(np.percentile(energy, 35), 1e-10)]
    covariance = np.einsum("tfc,tfd->fcd", strong, strong.conj()) / max(len(strong), 1)
    values, vectors = np.linalg.eigh(covariance)
    principal = vectors[:, :, -1]
    ref = principal[:, reference_channel]
    # Bound RTF gain where the reference has a narrow spectral null.
    ref = np.where(np.abs(ref) < 0.05, 0.05 * np.exp(1j * np.angle(ref)), ref)
    rtf = principal / ref[:, None]
    rtf[:, reference_channel] = 1
    metadata = dict(sample_rate=RATE, nfft=NFFT, hop=HOP, channels=channels,
                    reference_channel=reference_channel, aec_enabled=aec_enabled, input_device=input_device,
                    highly_correlated_pairs=int(highly_correlated_pairs),
                    method="target-only measured near-field RTF; no guessed UMA-8 geometry")
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    np.savez(path, rtf=rtf.astype(np.complex64), metadata=json.dumps(metadata),
             coherence=values[:, -1] / np.maximum(values.sum(axis=-1), 1e-12))
    return metadata


class NearFieldMvdr:
    def __init__(self, config):
        self.initialized = not config.automatic_rtf
        if config.automatic_rtf:
            # A reference-channel pass-through is usable immediately, including
            # short first answers. It is not a fabricated steering vector.
            self.a = np.zeros((257, 7), np.complex64)
            self.a[:, config.reference_channel] = 1
        else:
            with np.load(config.calibration, allow_pickle=False) as data:
                self.a = data["rtf"].astype(np.complex64)
                meta = json.loads(str(data["metadata"]))
            for key, expected in (("sample_rate", RATE), ("nfft", NFFT), ("hop", HOP),
                                  ("channels", config.channels), ("reference_channel", config.reference_channel),
                                  ("aec_enabled", config.aec_enabled)):
                if meta.get(key) != expected:
                    raise ValueError(f"Calibration {key} mismatch: recalibrate with current configuration")
            if self.a.shape != (257, 7) or not np.isfinite(self.a).all():
                raise ValueError("Invalid target RTF")
        self.config = config
        self.eye = np.eye(7, dtype=np.complex64)
        self.noise = np.tile(self.eye[None] * 1e-4, (257, 1, 1))
        self.weights = self.a / np.sum(np.abs(self.a) ** 2, axis=1, keepdims=True)
        f = np.fft.rfftfreq(NFFT, 1 / RATE)
        self.band = (f >= 300) & (f <= 4000)
        self.tracker = OnlineRtf(config, None if config.automatic_rtf else self.a, self.band)
        self.alpha = np.exp(-(HOP / RATE) / config.noise_time_constant_s)
        self.frames = 0

    def spatial_score(self, spectrum, rtf=None):
        x = spectrum[self.band]
        a = (self.a if rtf is None else rtf)[self.band]
        num = np.abs(np.sum(a.conj() * x, axis=1)) ** 2
        den = np.sum(np.abs(a) ** 2, axis=1) * np.sum(np.abs(x) ** 2, axis=1)
        return float(np.clip(num.sum() / max(float(den.sum()), 1e-12), 0, 1))

    def process(self, spectrum, *, speech_present, playback_active=False):
        """Process one hop, with independent pre-beam VAD when called by Frontend.

        Unknown service-region speech is held out of noise learning even while
        it fails the current target gate. Otherwise a moved customer could be
        learned as interference before the new RTF has converged.
        """
        score = self.spatial_score(spectrum)
        # Estimate target energy in the undistorted, reference-normalized delay-and-sum beam.
        das = np.sum(self.a.conj() * spectrum, axis=1) / np.sum(np.abs(self.a) ** 2, axis=1)
        time_rms = np.sqrt((abs(das[0]) ** 2 + abs(das[-1]) ** 2 + 2 * np.sum(abs(das[1:-1]) ** 2)) / NFFT**2)
        dbfs = float(20 * np.log10(max(time_rms, 1e-10)))
        target_present = score >= self.config.spatial_threshold and dbfs >= self.config.min_speech_dbfs
        anchor_score = 1.0 if self.config.automatic_rtf else self.spatial_score(spectrum, self.tracker.anchor)
        speech = bool(speech_present)
        reference = spectrum[:, self.config.reference_channel]
        reference_rms = np.sqrt((abs(reference[0])**2 + abs(reference[-1])**2 +
                                2*np.sum(abs(reference[1:-1])**2)) / NFFT**2)
        reference_dbfs = 20*np.log10(max(float(reference_rms), 1e-10))
        eligible = (anchor_score >= self.config.rtf_min_anchor_score and
                    reference_dbfs >= self.config.min_speech_dbfs)
        updated = self.tracker.observe(spectrum, self.noise, self.a, speech=speech,
                                       eligible=eligible, playback=playback_active)
        if updated is not None:
            self.a = updated
            self.initialized = True
            score = self.spatial_score(spectrum)
            # Keep this hop's target decision consistent with the accepted RTF.
            das = np.sum(self.a.conj()*spectrum, axis=1)/np.sum(abs(self.a)**2, axis=1)
            time_rms = np.sqrt((abs(das[0])**2 + abs(das[-1])**2 + 2*np.sum(abs(das[1:-1])**2))/NFFT**2)
            dbfs = float(20*np.log10(max(time_rms, 1e-10)))
            target_present = score >= self.config.spatial_threshold and dbfs >= self.config.min_speech_dbfs
        if not self.initialized:
            # Do not make first-time speech wait for the spatial estimator. Once
            # initialized, the normal spatial gate and reacquisition take over.
            target_present = speech and reference_dbfs >= self.config.min_speech_dbfs
        uncertain_speech = (self.config.online_rtf_enabled and speech and
                            anchor_score >= self.config.rtf_min_anchor_score)
        freeze_noise = self.config.online_rtf_enabled and playback_active
        if not target_present and not uncertain_speech and not freeze_noise:
            instantaneous = spectrum[:, :, None] * spectrum[:, None, :].conj()
            self.noise = self.alpha * self.noise + (1 - self.alpha) * instantaneous
        if self.frames % 4 == 0 or updated is not None:
            loading = self.config.diagonal_loading * np.trace(self.noise, axis1=1, axis2=2).real / 7 + 1e-7
            loaded = self.noise + loading[:, None, None] * self.eye
            u = np.linalg.solve(loaded, self.a[..., None])[..., 0]
            denom = np.sum(self.a.conj() * u, axis=1).real
            w = u / np.maximum(denom[:, None], 1e-12)
            bad = (~np.isfinite(w).all(axis=1)) | (np.linalg.norm(w, axis=1) > self.config.max_weight_norm)
            w[bad] = self.a[bad] / np.sum(np.abs(self.a[bad]) ** 2, axis=1, keepdims=True)
            self.weights = w
        self.frames += 1
        y = np.sum(self.weights.conj() * spectrum, axis=1)
        return y.astype(np.complex64), dict(spatial_score=score, target_present=target_present,
                                           target_dbfs=dbfs, anchor_score=anchor_score,
                                           target_candidate=uncertain_speech and not playback_active,
                                           **self.tracker.statistics)
