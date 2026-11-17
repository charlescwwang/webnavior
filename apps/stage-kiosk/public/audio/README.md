# Receipt and waiting audio

Place both original WAV files beside this document:

- `kiosk_acknowledged_chime.wav`: plays once when voice is received.
- `kiosk_hold_melodic_light_60s.wav`: follows the chime and loops while processing.

Only after both real files are installed, set `processing.json` to
`{ "enabled": true }`. Reload the Kiosk after the current order. The deployed
URLs are `/kiosk/audio/` followed by these exact filenames. Replacing public
files and the manifest needs no rebuild; keep the release source in sync.
Do not create placeholder or silent replacement files.

A new processing window starts with a chime; additional captures during existing
work keep the current music player. Resuming music does not repeat an old receipt. TTS playback,
reception reset, admin/pause, service faults and disposal stop playback. Normal
VAD events do not restart the music player. Both legacy ASR and Falcon use this
feedback after a complete admitted capture; no spoken waiting phrases are used.
Automatic greetings alone do not start a receipt. Missing either file leaves
feedback disabled and ordinary ordering/TTS usable, with no waiting-TTS fallback.
