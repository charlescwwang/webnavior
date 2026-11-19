# Kiosk native GPU audio

Superseded implementation plan: retirement of the UL-UNAS GPU audio option and
its dedicated packaging requirements, with an independent Hush CPU replacement, is documented in
[`2026-11-19-kiosk-native-hush-audio.md`](2026-11-19-kiosk-native-hush-audio.md).
It is not implemented yet. GPU startup success in this document does not qualify
sustained real-time capture; the standalone reports include GPU backlog failures.

User-approved target: Windows x64 / Intel Iris Xe. One Kiosk EXE owns its bundled
Python process; no separately started service, listening HTTP port, system Python,
or package installation on the device. This chat coordinates the PB fixes and
release artifacts. Deployment and physical GPU acceptance are separate from a
successful build.

## Current correction (0.6.0 candidate)

The user explicitly requested removal of manual five-second calibration and
restoration of independent microphone/speaker settings. Bridge v3 starts without
an anchor file. The reference microphone is immediately usable; reliable speech
learns the RTF and tracking continues across dominant-position changes. Playback,
mixtures and weak evidence pause learning. Without an anchor this no longer enforces
a fixed service-area boundary or customer identity.

sounddevice/PortAudio opens input only. Browser TTS/cues use their normal selected
speaker and a silent Worklet mirrors application PCM into AEC. The microphone
needs no speaker, stereo output or matching host API. A bounded resampling queue
crosses clocks; 100 ms capture delay keeps IPC-delivered reference causal. This is
pre-DAC application audio, not native DAC feedback or system loopback. Physical
Windows/GPU/acoustic acceptance remains pending. The 0.5.0 duplex/manual-anchor
implementation described in historical release notes is superseded.

## Boundaries

- Desktop microphone settings explicitly select existing capture (the default)
  or the experimental native GPU path. Each retains its own tuning. Switching
  retires the old capture generation, aborts unfinished recognition and discards
  active speech through the next silence boundary. A failed native startup leaves
  the selector available. This is a manual backup, not automatic CPU model retry.
- In the 0.6.0 native candidate, PortAudio opens eight physical 48 kHz inputs;
  Chromium independently plays application audio and supplies the AEC reference.
  Native mode never calls browser getUserMedia. Existing capture keeps its path.
- A shared Eventa capability admits only the trusted Kiosk main frame. Requests
  identify a capture generation; old pages cannot stop or feed a newer stream.
- Electron supervises one Python process over bounded binary stdin/stdout
  frames. Reload/close ends its generation; failure rejects pending requests.
- `apps/stage-kiosk-desktop/audio` owns AEC3, streaming 48→16 kHz resampling,
  online RTF/MVDR, UL-UNAS/OpenVINO GPU.0, AGC and segmentation. Its output goes to the
  existing ASR utterance queue and commerce admission, without another Silero
  segmentation pass or the desktop UMA LCMV/Mask/Falcon branch.
- OpenVINO must load and execute GPU kernels. CPU mode is an explicit development
  test setting, never an automatic production fallback. Device diagnostics must
  distinguish requested backend, available/active providers and measured GPU use.
- No manual installation calibration or persisted RTF is required by the native
  worker. Each capture generation automatically learns from speech. Offline
  fixed-anchor DSP comparisons remain separate from the native application flow.

## Release work

1. Implement and test the binary worker, GPU initialization and supervisor.
2. Connect source-clocked capture, final segments and operator calibration.
3. Build Windows-local Python plus pinned OpenVINO/PortAudio dependencies into the portable
   app; include licenses and hashes. Do not label Linux tests as Windows GPU proof.
4. Merge existing tested PB source changes into the same desktop/frontend build.
5. Verify payload hashes, source snapshots, clean extraction and the available
   native/browser tests. Record physical Windows/GPU acceptance still outstanding.

Status: implementation and Windows GPU portable packaging complete as a physical
acceptance pilot, version 0.3.0 / `kiosk-gpu-20261118-r1`. Matching Kiosk and PB
frontend artifacts are prepared under `pb-test.local/kiosk-gpu-20261118-r1`;
the Kiosk frontend is now activated after the user confirmed the EXE replacement.
The prepared public PB simulator is not activated. The EXE alone does not replace
the served frontend.

Python 19 tests, a separate 120-second synthetic AEC3/ONNX stream, Desktop 32,
Chromium capture/settings 6, ordering 255 and archive boundary 3 passed. Scoped
Desktop/Kiosk/Shared types and changed-file lint passed; no root typecheck ran.
Real Electron CPU-mode IPC verified Float32 transport, calibration and clocks,
stale-generation isolation, reload and close cleanup. A regression first proved
that stale blocks could retire the new generation; retirement now applies only
to failed blocks owned by the active generation. Windows x64 headers, pinned
asset hashes, ZIP CRC and every packaged payload hash passed. Windows/Iris Xe
execution, latency and physical acoustic acceptance remain outstanding.

Activation verified all 590 static files and six LAN/public HTTP checks (version,
entry, module, native settings chunk and capture Worklet). API PID was retained;
no API restart or forced device reload occurred. Windows/Iris Xe acceptance
remains pending on the target device.

## 0.3.1 binary-pipe correction

The operator reported `Invalid native audio envelope size` on Windows. A real
child-process regression reproduces that decoder failure when an external
library writes startup diagnostics to stdout. ORT 1.24.4 also prints there and
retries CPU provider construction before a later `disable_fallback()` can run.
The observed Windows provider error itself is still unknown.

The entrypoint now reserves a dedicated binary response pipe before importing
model/native dependencies and redirects Python/CRT/Win32 standard output to
stderr. ORT fallback is disabled in its constructor. Model loading starts after
the first request so startup failures return their original correlated error
before termination. No recovery skips malformed bytes or silently uses CPU.

Three regressions failed before correction. Python 22 tests (one opt-in stress
skip), Desktop 32 tests with the actual Python worker, and three archive-boundary
tests pass. The diagnostic-injection test runs the real CPU ONNX session; its
Win32-handle branch still requires Windows execution. No full-project typecheck
or physical Iris Xe validation was performed.

The 0.3.1 EXE patch reuses the exact verified 0.3.0 main/preload/PB bundles and
the already activated `kiosk-gpu-20261118-r1` interface. Only the embedded Python
entrypoint/worker/provider initialization and package version change. It needs
an EXE replacement, with no new frontend activation or API restart.

## 0.3.2 non-fused DirectML candidate

The Windows diagnostic now captures the underlying localized native error:
`DmlGraphFusionHelper.cpp(588)` / `0x80070057` during `initialize_session`.
ORT's Python exception conversion could not decode its CP950 message as UTF-8.
This precedes profile JSON parsing and microphone capture. Provider availability
does not establish successful GPU execution. The first diagnostic also let a
Windows profile-file cleanup error replace the original initialization error;
the revised diagnostic records those failures separately and preserves chained
exception bytes.

The targeted candidate sets `ep.dml.disable_graph_fusion=1` before DirectML
session construction, using the pinned runtime's supported setting. The model,
provider, CPU retry prohibition and real warm-up placement check are retained.
This avoids the failing fused path; Windows/Iris Xe still needs to establish
that individual kernels initialize and run fast enough. This is not proof of a
specific unsupported model operator or a driver fault.

The small qualification ZIP loads the exact candidate denoiser in a separate
process alongside 0.3.1, leaving installed source/manifests and userData intact.
It reports model/candidate hashes, actual GPU kernel placement and 64-frame
model-only timing against the 16ms hop. Pipeline overhead, real capture, acoustic
quality and ASR are outside that timing probe. No automatic CPU retry occurs.

A focused regression failed before the session setting was added. Python 23
passed (one opt-in stress skip), Desktop 32 with the actual CPU worker passed,
and eight diagnostic/archive tests passed. Packaged qualification ran with the
real CPU model and rejected absent DirectML on Linux; this does not simulate or
validate Iris Xe execution. The Windows candidate remains unqualified until the
operator returns its report. No frontend publication/API restart is needed.

The operator's actual Iris Xe report subsequently verifies 709 DirectML node
events / zero CPU node events, but mean 30.47099ms, p95 31.0971ms, max 31.3187ms
against the 16ms hop. Startup is solved for the non-fused candidate; real-time
throughput is not. The 0.3.2 full EXE remains held, with no device/frontend update.

The next qualification compares six explicit GPU configurations in isolated
children: the known non-fused path, device-local recurrent buffers, fused graphs
with metacommands disabled, and basic-optimization fusion combinations. Two
disjoint device buffer sets preserve recurrent input/output ordering, and a fixed
device input is updated every hop because ORT may copy CPU inputs at bind time.
Defaults are unchanged. Actual CPU I/O-binding equivalence/reset regressions
pass; Windows DML buffer behavior is still unverified.

A pinned 24-frame synthetic CPU spectral reference checks each candidate's
public output before timing. It is not a speech-quality metric. A fresh child
per case isolates native failures and profile locks; timeout terminates the
child. No CPU retry or automatic installation occurs. Only a verified GPU case
with matching reference and both model mean/p95 below 16ms is proposed for a
capture trial, which still needs headroom and full pipeline validation.
