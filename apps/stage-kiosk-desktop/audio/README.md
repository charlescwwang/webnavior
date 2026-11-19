# Kiosk native audio

This directory owns the Windows UMA-8 frontend using native device capture in Electron 0.6.2.
Electron starts a private child process on the first audio request and terminates
it on host reload or application close. No local HTTP service, system Python,
pip installation, device credentials or ASR client are required here.

sounddevice 0.5.6 / PortAudio directly opens eight discrete 48 kHz physical
capture channels. Chromium never acquires the microphone in this mode. Its normal
speaker output supplies mirrored application PCM as the AEC reference. Seven selected physical microphones pass
through paired 48→16 kHz resampling, AEC3, common gain, online RTF/MVDR,
UL-UNAS, AGC and spatial/WebRTC segmentation. Final mono segments enter the
existing Kiosk ASR queue. AEC, RTF/MVDR and VAD run on CPU; **UL-UNAS runs on
OpenVINO, explicitly targeting Intel GPU.0**. This does not move remote ASR, TTS or the language model to Iris Xe.

This is an explicit experimental choice for Windows UMA-8 RAW eight-channel mode;
the Kiosk frontend defaults to existing LCMV/Spatial Mask processing. Ordinary mono
microphones and browser-only clients retain their own processing path. The
matching Kiosk frontend must be released with the new EXE. An older EXE cannot
provide this capability and must be updated before enabling native array mode.

## Operator setup

In the Kiosk microphone settings, select UMA-8 multichannel, choose the experimental
online RTF/MVDR + GPU pipeline and apply the capture method. The existing pipeline
remains selectable even if GPU startup fails, with its prior tuning preserved.
Switch only while silent; switching retires unfinished capture. GPU inference
does not automatically fall back to CPU. Then check the seven physical
channel indices and common gain. Select the native input, then apply. Native
choices are separate from browser microphone IDs. Automatic input selection
requires a unique UMA-8/micArray with at least eight channels and prefers WASAPI.
Missing/ambiguous inputs or unsupported input formats fail explicitly. The default
map is 0–6; verify it against the installed USB firmware. PortAudio opens an
input-only stream, never a speaker or duplex stream. Speakers use the normal
Kiosk browser selector, including system default, independently of input host.

The 0.6.0 native worker starts without `target_rtf.npz` and does not record or
persist a manual installation anchor. It initially uses the reference channel,
then learns a spatial RTF from independently detected speech with dominance and
candidate-consistency checks. Tracking continues across dominant position changes;
playback/tails and mixed or weak evidence freeze updates. There is no fixed
service-area boundary or speaker identity guarantee without an installation anchor.
Each generation learns anew; no customer PCM or learned direction is persisted.
The offline fixed-anchor comparison mode remains available to DSP tests.

Browser application audio remains audible through its normal selected output.
A mirror of its limited stereo mix is delivered over IPC and resampled onto the
input clock with a bounded 40–50 ms reservoir and ±0.5% drift correction. Capture
is delayed 100 ms so the render reference precedes the corresponding microphone
echo despite IPC jitter. This adds latency; AEC estimates remaining output/acoustic
delay. This is application PCM before the browser DAC, not actual DAC feedback,
system audio or external website loopback. Since 0.6.2, native callbacks copy
microphone samples into a bounded queue; the worker pairs a complete input block
only when its real browser reference is available. Short callback/IPC bursts no
longer terminate capture merely because the 40–50 ms render reservoir empties.
Unpaired input is retained in order, not replaced with silence or dropped. The
reference queue and capture backlog remain bounded at 250 ms; xrun/backlog failure
stops the generation. The drift controller subtracts waiting input from render
occupancy so delivery bursts are not treated as independent-clock drift. Real driver
latency, long-duration drift, double talk and acoustic quality need Windows tests.

## Capture and playback ownership

The shared Eventa v3 bridge requires the matching 0.6.0 EXE and frontend; old
executables display an update requirement. `start` prepares DSP, `open`
resolves native devices, and ordered `poll` requests carry stereo playback and
return processed speech. Device enumeration does not initialize the GPU model.
The browser never requests microphone permission for this path; its enabled
preference still controls native listening. Switching to existing capture restores
browser ownership. Model startup has a 180-second supervisor budget (182 seconds
in preload); a failed owner still requires a document reload.

Registered Kiosk speech/cue sources retain their browser destination. A silent
Worklet mirrors the stereo application mix without creating duplicate playback.
The speaker selector and test chime remain available during native capture.
Playback lifecycle follows browser media; physical DAC latency still needs
validation on the chosen output device.

Callbacks only copy microphone PCM; reference pairing/resampling, model inference
and pipe IO stay outside the callback. A persistent slow model or renderer/IPC
stall can still exhaust the unchanged 250 ms bounds; this queue correction does
not certify model throughput or remove the Worklet delivery guard. Capture or render backlog beyond 250 ms and PortAudio
status errors retire the generation; no capture frames are silently dropped to
meet model timing. Stop, replacement, stdin EOF and host
close release the stream and queued audio. Only the active generation may stop it.

## Explicit UL-UNAS bypass trial (0.6.1)

Close all Kiosk windows, then run **Start Without UL-UNAS.cmd** from the portable
folder. That launcher sets `WEBNAVIOR_TEST_BYPASS_ULUNAS=1` only in its child EXE
and worker. It skips model loading and inference while preserving native capture,
AEC3, automatic RTF/MVDR, gain, AGC, segmentation and the normal ASR queue.
The administrator audio status explicitly says UL-UNAS is skipped; GPU verification
is false and is not presented as pending. This is not CPU model inference.

Fully close the trial EXE and launch **Webnavior Kiosk.exe** normally to restore
model-enabled FP32 behavior. No browser preference or profile switch is persisted.
The worker also accepts explicit `--bypass-denoiser` for developer trials.
Ordinary model initialization failures still propagate; there is no automatic
bypass or CPU retry. The model, precision, other controls and timing bounds are
unchanged. This isolates the model stage; it does not certify Windows capture,
echo quality, recognition, long-duration scheduling or complete reception.

## Build and validation

`windowsRuntime.json` pins the official CPython embeddable archive and Windows
wheels, including their official download URLs and SHA256. Obtain those exact
assets on the build host, then run:

```sh
python3 scripts/windows/prepareAudio.py --python-zip /path/python.zip \
  --wheel-dir /path/wheels --vc-redist /path/vc_redist.x64.exe \
  --output-dir /path/new-audio-runtime
python3 scripts/windows/packagePortable.py --runtime-zip /path/electron.zip \
  --audio-runtime-dir /path/new-audio-runtime --output-dir /path/release
```

Preparation uses libarchive `bsdtar` to read the pinned Microsoft redistributable
cabinets without installing them. It verifies hashes, retains licenses, isolates Python's module search
path, checks Windows x64 PE headers, and writes a per-file manifest. Packaging
rechecks the manifest and current Python source. Both steps use local assets;
the target downloads no model or dependencies. Python source and model licenses
are included in the portable distribution. The UL-UNAS model provenance is in
`models/manifest.json`.

For explicit Linux development only, set `KIOSK_AUDIO_PYTHON` and
`KIOSK_AUDIO_PROVIDER=cpu`. Packaged builds always request OpenVINO GPU. Run Python
tests in an isolated development environment from this directory:

```sh
python -m pip install -r requirements-dev.txt
PYTHONPATH=src python -m pytest tests -q
```

Windows/Iris Xe execution, driver compatibility, USB channel layout, sustained
real-time performance, acoustic double talk and live ordering require physical
acceptance. Linux tests and PE/hash verification do not establish those results.

## Original LCMV input-only owner (0.6.3)

`--capture-only` selects `InputWorker`, which opens the same real eight-channel
PortAudio capture and returns planar eight-channel microphone plus stereo reference
PCM at 48 kHz. It never constructs the native Frontend or loads OpenVINO/UL-UNAS.
The original browser DSP Worker remains responsible for seven-channel AEC3 WASM,
LCMV, resampling and downstream recognition. Raw PCM offsets, render offsets and
capture generations are checked independently; stale stop requests cannot close a
replacement. The existing microphone delay is reported for source timestamps.

The renderer transfers an Electron input port and a Worklet reference port into
the original DSP Worker. PCM delivery thereafter bypasses the UI event loop and
the model-bearing native worker. Hardware enumeration owns a separate process.
All capture/render/pending limits remain unchanged; no reference is invented and
no microphone frames are dropped to recover from overload. Device loss and invalid
PCM stop the owner. The GPU RTF candidate remains a separate, unchanged selection.
