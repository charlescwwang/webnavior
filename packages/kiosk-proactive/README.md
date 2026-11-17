# Kiosk proactive interaction

`@proj-airi/kiosk-proactive` is the optional, browser-safe decision core for
AIRI kiosk proactive interaction. It turns anonymous local attention
observations into at most one greeting decision per interaction window.

Use it when a kiosk needs to decide whether a visitor or group has attended to
the screen for long enough to invite an interaction. Do not use it for camera
access, MediaPipe inference, greeting generation, chat delivery, or diagnostic
media retention; those are adapters around this small policy boundary.

`DeviceSettingsValues.mouthDetectionEnabled` is the shared opt-in switch for
legacy ASR visual admission, defaulting to false. It is independent from
`observationEnabled` and `backgroundSpeechMode`; the Kiosk adapter owns applying
it to microphone capture, ASR cancellation and decision admission. Falcon's
audiovisual requirements remain independent of this switch.

The package is deliberately independent from the AIRI vision and chat stores.
It can therefore be lazy-loaded by the kiosk module host today and kept intact
when the host is later replaced with a signed remote module registry.

## Interaction policy

`KioskInteractionSettings` is the shared configuration contract for every
host that presents an anonymous interactive service. It separates five
independent decisions:

- `observation`: whether a local camera may derive anonymous presence signals;
- `proactiveGreeting`: when an unattended visitor may receive one greeting;
- `assistanceReminder`: when an active customer session may receive help;
- `visualAssistance`: whether an eligible event may request one transient
  Vision analysis; and
- `mediaRetention`: the future deployment-controlled retention mode.

The base interaction policy defaults are off. Server enrollment explicitly uses
`newDeviceSettings`: observation, greeting, reminder and voice diagnostics are
overridden on, trigger mode is `mixed`, and these five fields allow local changes.
Existing device records retain their saved policy; `defaultDeviceSettings` remains
the empty persisted baseline. In particular, enabling a future Vision
feature does not open the camera by itself, and no frame or clip is stored by
this package. A host must explicitly connect a camera, event gate, provider,
and deployment storage policy before visual assistance can occur.

Pose presence uses the same configured greeting dwell, empty reset, trigger mode
and minimum-person policy as attention observations. Geometry classification,
minimum sample quality and greeting cooldown remain separate gates. The current
pose adapter supplies one anonymous candidate, so a minimum above one cannot
qualify a greeting; it does not infer a group count from a single pose.

The shared initial greeting dwell is 300 ms, measured from the first qualifying
observation. Device defaults derive it from the same interaction policy. Existing
saved device dwell overrides retain precedence. This does
not change observation cadence or enable greetings, and it is not a guarantee
that audio begins 300 ms after a person enters the camera view.
