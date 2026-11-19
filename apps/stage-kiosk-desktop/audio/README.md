# Kiosk native audio

The Hush CPU option is owned by the Kiosk Electron application (0.7.5, native
bridge v9). Electron starts one bundled Python worker on demand; navigation and
close retire it. Operators install no system Python, pip package or local HTTP
service. Use the matching Kiosk frontend and EXE together.

## Processing and ownership

PortAudio captures eight physical UMA-8 RAW channels at 48 kHz. Seven mapped
microphones are resampled on their own source timeline to 16 kHz. There is no
AEC or playback-reference pairing in Hush. Processing is common input gain → online
RTF/MVDR → overlap-add mono PCM → Hush CPU → AGC → spatial/WebRTC VAD. Completed
utterances enter the existing Server ASR queue; there is no second Silero pass,
local Whisper, UL-UNAS, OpenVINO or GPU audio inference.

The `hush/` directory contains immutable native libraries, model bundle, licenses,
model card and asset hashes. Hush uses native Tract CPU inference; Python calls
its C ABI. A process owns shared model weights, and each capture generation owns
a separate Hush session, RTF and VAD state. Sessions run continuously across
utterances. Stop/replacement discards incomplete speech and releases native state;
EOF releases shared weights. Errors never select a substitute model.

The pinned 16 kHz model has FFT 320, hop 160 and no neural lookahead. Its measured
waveform delay is 160 samples (10 ms), independent of the STFT delay.
The former AEC and 100 ms capture-reference delays are absent from Hush. `pipeline.py` compensates that delay and carries
source evidence by sample intervals across 256-sample OLA and 160-sample model
frames. Frame descriptors have explicit lengths; inference arrival is not the
source clock. Finalization drains valid tails without counting padding as input.
Cancellation never turns a flushed partial utterance into a new order.

NOTICE: The pinned upstream native runtime skips recurrent/OLA advancement when
mean-square input energy is below 1e-7. `hush.py` applies a documented -68 dBFS
Nyquist floor only to those frames, ensuring source-clock progression through
silence and draining. Native inference errors (-100) are rejected rather than
accepted as the library's passthrough fallback. Real native regressions cover
silence, restart determinism and measured delay; physical acoustic acceptance is
still required.

## Operator use

In microphone settings choose UMA-8, then **Online RTF/MVDR + Hush CPU** and apply.
Choose the native input, confirm seven physical channel indices, and apply gain.
Hush tuning is stored independently from LCMV/Spatial Mask. The preset selector offers:

| Preset | Maximum attenuation | MVDR dry mix | Comparison focus |
| --- | --- | --- | --- |
| A | 20 dB | 30% | Quiet speech and word boundaries |
| B | 20 dB | 10% | Background leakage in noise |
| Original baseline | 100 dB | 0% | Previous full-model suppression |

The default remains the original baseline until explicitly applied. Selection is
only a draft; **Apply audio settings** saves it and starts the next generation.
This retires unfinished speech; switch while silent. Hush keeps one continuous
session across VAD utterances. Compare both recommendations with the same recorded
input, then with actual store speech; different recordings do not establish a
preset's quality. The recommendation source is
`/home/aimax/Downloads/UMA8-Windows-Integration-README.txt` (2026-11-20); it is a
reference document, not a runtime dependency.

Dry mixing uses unmodified, pre-Hush MVDR PCM delayed by 160 samples, with matching
source samples mixed before AGC/VAD. Native clipping and the silence-clock floor
never enter that dry buffer. At 0 dB the supported native bypass has zero model
delay; the wrapper preserves raw PCM without adding the floor. Changing preset
never resets a session between words or changes microphone gain/channel mapping.

LCMV and Spatial Mask remain selectable and are still the default. Retired GPU selections require
explicit re-selection; they are not aliases for Hush. Adjust only while silent.

Input is independent from the browser speaker selector. TTS, cues and music use
normal speakers. Hush never creates an AudioContext/AudioWorklet, subscribes to
playback reference, or waits for TTS PCM. It has no AEC switch: AEC is removed
from this option. Speaker audio can therefore be captured and recognized again.
Native mode never asks Chromium for a microphone. Unique automatic UMA-8
selection prefers WASAPI and may use the unique miniDSP WDM-KS RAW fallback;
explicit device selections fail as selected.

Native callbacks only copy bounded microphone PCM. A dedicated browser Worker
opens the input through a generation-owned MessagePort, then issues one read at
a time, waiting 16 ms after completion. Each read drains actual microphone frames;
timer jitter changes batch sizes, not sample offsets. Resampling and DSP stay out
of callbacks. There is no 8 ms reference RPC or playback acknowledgment clock.
The native microphone queue and an in-flight read retain a 250 ms processing
bound. Overload or discontinuity stops capture rather than silently dropping PCM.
Switching pipelines releases the old owner before a new one opens the device.

Automatic RTF starts without a calibration file, initially using its reference
channel, then learns dominant speech. Mixtures and weak evidence freeze learning. There is no playback-reference
hold because this Hush option no longer observes speaker PCM. This does not identify a customer or enforce a fixed service
region. No learned direction or customer PCM is persisted by the DSP worker.

## Build and validation

`windowsRuntime.json` pins CPython, CPU/audio wheels, Microsoft CRT and Hush assets.
Use verified local downloads with `scripts/windows/prepareAudio.py`, then build
the desktop and use `scripts/windows/packagePortable.py`. The Windows bundle
contains only its Windows Hush library, model and notices; the Linux library is
for development tests. Target machines perform no installation or download.

Create an isolated Python environment using `requirements-dev.txt`, then run:

```sh
PYTHONPATH=src python -m pytest tests -q
UMA8_STRESS_SECONDS=120 PYTHONPATH=src python -m pytest tests/test_online_rtf.py -k long_stream -q
```

Set `KIOSK_AUDIO_PYTHON` to that Python for Linux desktop development. Use
`KIOSK_AUDIO_TEST_PYTHON` for actual child-process Vitest integration. There is no
provider override or model-bypass launcher. `Test Hush Audio.cmd` is an optional
standalone microphone-only diagnostic; it does not test Chromium or ASR. `Test Native Eight Channel.cmd` only checks physical input.

Windows USB channel mapping, microphone gain, TTS suppression, double talk,
background speakers, full ASR/ordering and at least 30 minutes of actual kiosk
operation require on-device acceptance. Linux synthetic tests, PE checks and ZIP
hash verification do not establish those results.

The original LCMV capture-only owner remains separate: it supplies raw paired
48 kHz PCM to the browser AEC3/LCMV Worker and does not load Hush or native RTF.
Generation-bound MessagePorts keep that PCM off the renderer UI loop; enumeration
uses a separate short-lived process. Spatial Mask and standard microphones keep
their browser acquisition paths.
