# November browser audio restored

Version 0.7.8 removes the Python/PortAudio acquisition owner, Hush/native model
processing and the 0.7.7 utility-process experiment. No Python runtime, Hush
weights or native inference library is shipped in the portable package.

The reference is local `master` at `b1a7f5b` (2026-11-10), including the
2026-11-09 microphone correction `326ff95`. Electron is retained: Chromium
getUserMedia owns tracks, actual Worklet channel counts select Spatial Mask
for eight-channel input and ordinary browser speech processing for other inputs.
Dynamic Spatial Mask follows audible TTS state; its mapping/radius preferences
and original +15 dB dynamic / +65 dB soft gain are retained. LCMV was a comparison
path in that baseline, not its production microphone default.

The original browser Worklet/Worker DSP and lifecycle source are restored from
master; the current Scene adapts that boundary to current VAD/ASR and optional
visual admission. The Electron merchant view, native checkout operations and
spoken tax-ID entry remain current. No host-native 250 ms audio bridge exists
in this package. This does not establish Windows hardware/room acceptance.

Replace the complete portable folder and load the paired frontend. Select the
actual microphone under administrator audio settings. Never treat requested
eight channels as proof of the physical channel layout. Preserve the existing
Windows diagnostics after a failure.
