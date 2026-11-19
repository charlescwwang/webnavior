# UMA-8 capture

AEC3, LCMV and resampling derive from the user-supplied Falcon v2.1.6 reference (`source/src` and its MIT Webnavior vendor); retain LICENSE. No models or fixture recordings ship with capture.

The 48 kHz eight-channel Worklet and stereo playback reference share one AudioContext. A bounded Worker applies AEC3, pairs the delayed LCMV output with original mapped channel 6, and decimates both to 16 kHz. ASR records the gained LCMV output used for VAD. The aligned reference PCM remains available at the DSP boundary. All clocks identify source samples, not inference arrival.


Legacy ASR can select `spatial-mask` with `aec3Enabled` through the capture-owned
`ArrayProcessing` discriminated contract. LCMV carries its tuning and always uses
AEC3; Mask carries its AEC flag and uses shared hardware mapping/radius. Mask
owns its own FIR and source-aligned lookahead: do not reuse LCMV's 1024-frame
compensation or the separate decimator. Every emitted runtime block is 512
samples at 16 kHz; `offsetFrames` identifies source samples, not arrival time.

The Mask numerical implementation and frozen test oracle were recovered from
repository commit `f616ca4`. The supplied integration source/provenance and SHA
remain in `fixtures/spatialMask/`; those are synthetic test assets, not captured
customer recordings, and are not bundled into the application. The default
44 mm geometry and channel mapping still need physical device verification.

AEC off skips both the module/WASM instance and playback-reference ownership.
AEC on uses the existing seven-channel AEC before Mask. Settings changes terminate
the old Worker rather than mixing algorithm/AEC state within an utterance.
Historical oracle tests verify arithmetic/chunking, real Chromium tests verify
Eventa/Worker/Worklet operation and render ownership, and optional
`MASK_STRESS_SECONDS=120` runs a bounded-memory synthetic stream. None establishes
Windows USB channel layout or real-room TTS suppression.

Hush is a separate microphone-only path (EXE0.7.5 / bridgev9). It does not use
AEC, AudioContext, AudioWorklet, playback reference or speaker/input pairing.
`nativeCapture.worker.ts` owns one native read at a time through the existing
ArrayInput MessagePort. Native PortAudio callbacks own the sample clock; each
read drains captured PCM and the next read is scheduled 16 ms after completion.
The renderer receives levels, timestamps and completed VAD segments. True native
read/queue stalls retain 250 ms bounds; there is no playback delivery timeout in
this branch. RTF/MVDR → Hush → AGC → VAD and the existing Server ASR remain.
Existing LCMV/Spatial Mask retain their AEC and playback-reference transport.
