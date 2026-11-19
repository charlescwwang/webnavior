"""Noise-whitened, bounded RTF tracking with optional fixed service-region anchor."""
import numpy as np

from .spectral import HOP, RATE


class OnlineRtf:
    """Own candidate statistics separately from the RTF currently used for audio.

    The caller supplies independent speech activity and playback state. An
    optional immutable installation anchor restricts the service region; native
    automatic mode has no such restriction. VAD is not speaker identity: this tracker
    only follows a dominant source within that anchor's acoustic neighbourhood.
    Same-position interfering speakers cannot be distinguished acoustically here.
    """

    def __init__(self, config, anchor, band):
        self.cfg = config
        self.anchor = anchor.copy() if anchor is not None else None
        self.band = band
        self.covariance = np.zeros((257, 7, 7), np.complex64)
        self.alpha = np.exp(-(HOP / RATE) / config.rtf_time_constant_s)
        self.minimum = int(np.ceil(config.rtf_min_observation_ms / 16))
        self.interval = int(np.ceil(config.rtf_update_interval_ms / 16))
        self.samples = 0
        self.idle_frames = 0
        self.previous = None
        self.previous_valid = None
        self.updates = 0
        self.confidence = 0.0
        self.state = "acquiring" if config.online_rtf_enabled else "disabled"
        self.reason = "warming_up" if config.online_rtf_enabled else "fixed_comparison"

    def reset_candidate(self):
        """Discard uncertain observations without changing the active audio RTF."""
        self.covariance.fill(0)
        self.samples = 0
        self.previous = None
        self.previous_valid = None
        self.confidence = 0.0

    def observe(self, spectrum, noise, current, *, speech, eligible, playback):
        """Return an accepted, reference-normalized RTF, or keep audio unchanged.

        Covariance whitening follows Markovich-Golan et al., EUSIPCO 2018:
        https://new.eurasip.org/Proceedings/Eusipco/Eusipco2018/papers/1570437654.pdf
        The eigenvalue gap checks dominance, not customer identity.
        """
        if not self.cfg.online_rtf_enabled:
            return None
        if playback:
            # Echo suppression can change inter-channel relationships. Do not
            # combine a pre-playback candidate with residual echo observations.
            self.reset_candidate()
            self.state, self.reason = "frozen", "playback"
            return None
        if not speech or not eligible:
            self.idle_frames += 1
            if self.idle_frames >= self.minimum:
                self.reset_candidate()
            self.state = "holding"
            self.reason = "no_speech" if not speech else "outside_service_region"
            return None
        self.idle_frames = 0
        self.covariance *= self.alpha
        self.covariance += (1-self.alpha) * spectrum[:, :, None] * spectrum[:, None, :].conj()
        self.samples += 1
        self.state = "acquiring" if not self.updates else "tracking"
        self.reason = "warming_up"
        if self.samples < self.minimum or self.samples % self.interval:
            return None

        # Use a noise-only estimate; doing EVD directly on live mixtures can
        # select a loud interference instead of the service-area source.
        eye = np.eye(7, dtype=np.complex64)
        loading = self.cfg.diagonal_loading * np.trace(noise, axis1=1, axis2=2).real / 7 + 1e-7
        try:
            root = np.linalg.cholesky(noise + loading[:, None, None]*eye)
            inverse = np.linalg.solve(root, np.broadcast_to(eye, root.shape))
            # Correct the warm-up bias of the zero-initialized running mean.
            mixture = self.covariance / (1-self.alpha**self.samples)
            white = inverse @ mixture @ inverse.conj().transpose(0, 2, 1)
            white = (white + white.conj().transpose(0, 2, 1)) * .5
            values, vectors = np.linalg.eigh(white)
        except np.linalg.LinAlgError:
            self.reason = "ill_conditioned"
            return None
        principal = (root @ vectors[:, :, -1, None])[..., 0]
        ref = principal[:, self.cfg.reference_channel]
        ratio = values[:, -1] / np.maximum(values[:, -2], 1e-9)
        valid = ((ratio >= self.cfg.rtf_min_eigenvalue_ratio) &
                 (values[:, -1] >= 2) &
                 (abs(ref) >= .05*np.linalg.norm(principal, axis=1)))
        usable = valid & self.band
        self.confidence = float(np.mean(valid[self.band]))
        if self.confidence < self.cfg.rtf_min_bin_fraction:
            self.previous = self.previous_valid = None
            self.state, self.reason = "holding", "mixed_or_weak_source"
            return None
        candidate = current.copy()
        candidate[valid] = principal[valid] / ref[valid, None]
        candidate[:, self.cfg.reference_channel] = 1
        if not np.isfinite(candidate).all():
            self.reason = "invalid_candidate"
            return None
        if self.anchor is not None and self.match(candidate[usable], self.anchor[usable]) < self.cfg.rtf_min_anchor_score:
            self.previous = self.previous_valid = None
            self.state, self.reason = "holding", "outside_service_region"
            return None

        common = usable & self.previous_valid if self.previous_valid is not None else np.zeros(257, bool)
        stable = (np.count_nonzero(common) >= np.count_nonzero(self.band)*self.cfg.rtf_min_bin_fraction and
                  self.match(candidate[common], self.previous[common]) >= .9)
        self.previous, self.previous_valid = candidate.copy(), usable.copy()
        if not stable:
            self.reason = "confirming_candidate"
            return None
        # Reference normalization fixes the arbitrary eigenvector phase before
        # smoothing. Only reliable bins move; weak consonant bins retain state.
        result = current.copy()
        if self.anchor is None and not self.updates:
            # The first reliable observation replaces the temporary reference-channel
            # pass-through; it is not smoothed against an invented array direction.
            result[valid] = candidate[valid]
        result[valid] += self.cfg.rtf_update_rate * (candidate[valid]-result[valid])
        result[:, self.cfg.reference_channel] = 1
        self.updates += 1
        self.state, self.reason = "tracking", "accepted"
        return result

    @staticmethod
    def match(a, b):
        """Mean scale/phase-invariant spatial similarity over reliable bins."""
        numerator = abs(np.sum(a.conj()*b, axis=1))**2
        denominator = np.sum(abs(a)**2, axis=1)*np.sum(abs(b)**2, axis=1)
        return float(np.mean(numerator / np.maximum(denominator, 1e-12)))

    @property
    def statistics(self):
        """Current state only: no spectrum or per-frame history is retained."""
        return dict(rtf_state=self.state, rtf_reason=self.reason,
                    rtf_updates=self.updates, rtf_confidence=self.confidence)
