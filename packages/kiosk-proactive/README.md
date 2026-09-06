# Kiosk proactive interaction

`@proj-airi/kiosk-proactive` is the optional, browser-safe decision core for
AIRI kiosk proactive interaction. It turns anonymous local attention
observations into at most one greeting decision per interaction window.

Use it when a kiosk needs to decide whether a visitor or group has attended to
the screen for long enough to invite an interaction. Do not use it for camera
access, MediaPipe inference, greeting generation, chat delivery, or diagnostic
media retention; those are adapters around this small policy boundary.

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

All defaults are deliberately off. In particular, enabling a future Vision
feature does not open the camera by itself, and no frame or clip is stored by
this package. A host must explicitly connect a camera, event gate, provider,
and deployment storage policy before visual assistance can occur.
