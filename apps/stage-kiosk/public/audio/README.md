# Receipt and waiting audio

Place both original WAV files beside this document:

- `kiosk_acknowledged_chime.wav`: plays once when voice is received.
- `kiosk_hold_melodic_light_60s.wav`: follows the chime and loops while processing.

Only after both real files are installed, set `processing.json` to
`{ "enabled": true }`. Reload the Kiosk after the current order. The deployed
URLs are `/kiosk/audio/` followed by these exact filenames. Replacing public
files and the manifest needs no rebuild; keep the release source in sync.
Do not create placeholder or silent replacement files.

A new captured utterance receives a new chime even if earlier work is ongoing.
Pausing and resuming waiting music does not repeat an old receipt. Customer
speech, assistant output, cancellation, faults and disposal stop playback.
The opening explains both sounds, plays the chime, then previews up to three
seconds of the waiting music. Automatic greetings alone do not start a receipt.
Missing either file leaves feedback disabled and ordinary ordering/TTS usable.
