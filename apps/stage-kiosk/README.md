# AIRI Kiosk

`@proj-airi/stage-kiosk` is the full-screen, touch-first AIRI surface for a restaurant kiosk. It shares AIRI's local hardware UI, LLM tools, and independent `@proj-airi/order-menu` service; the Server owns all ASR/TTS provider, model, voice, endpoint, and credential policy.

Use it for customer-facing horizontal or vertical kiosk displays. Do not use it as a replacement for the normal settings-oriented `stage-web` application.

## Run

Start the menu service, then the kiosk:

```sh
pnpm --filter @proj-airi/order-menu dev
pnpm --filter @proj-airi/stage-kiosk dev
```

The layout follows the display orientation by default. Set `VITE_KIOSK_ORIENTATION=landscape` or `portrait` to lock a deployment to one orientation.

## Development kiosk enrollment

Before a Profile is available, the kiosk opens an enrollment screen. In a local
POC, it creates a six-digit number and asks the Server to create a `DEV-`
device. The Server returns an HttpOnly device cookie; the kiosk never stores or
reads the credential itself.

```sh
KIOSK_DEVELOPMENT_REGISTRATION_ENABLED=true pnpm --filter @proj-airi/server dev
VITE_API_SERVER_URL=http://localhost:5168 pnpm --filter @proj-airi/stage-kiosk dev
```

The Server omits this endpoint unless the flag is exactly `true`, and always
omits it when `NODE_ENV=production`. A production kiosk will replace this
screen with the QR-code enrollment flow.

## Registered interactive pages

The Kiosk can host multiple customer interaction pages while keeping ordering as
its primary flow. In administrator mode, open **互動服務** to add or edit the
local allow-list. Each entry must have an enabled switch, stable ID,
customer-facing name, iframe URL, and a description that tells AIRI when it may
open that page. Disabled or incomplete entries are not embedded and are never
made available to the Agent, so a customer message cannot open an arbitrary URL.

`restaurant-ordering` is the initial page. Use `VITE_ORDERING_SCENARIO_URL` to
configure its deployed URL only for a fresh browser Profile; it defaults to
`http://localhost:5166` locally. Once an administrator saves a URL in **互動服務**,
that `serviceUrl` is the exact iframe URL and takes precedence over this variable.
`VITE_AIRI_ORIGIN` belongs to the embedded service's WebMCP allowlist; it never
changes the iframe URL.

## Anonymous customer sessions

Each customer starts an anonymous Kiosk session when they touch the screen, type a message, speak, or operate the menu. The session owns only that customer's conversation and cart:

- After 45 seconds without activity, it asks whether to continue. The customer can retain the current conversation and cart, or start a clean reception for the next customer. If there is no choice after a further 15 seconds, it clears the conversation and menu, then returns to standby.
- After a simulated order is confirmed, an enabled completion survey displays a QR Code until the visitor skips it or the configured countdown ends; then the kiosk starts a clean standby session.
- In administrator mode, use **結束目前接待** to immediately clear the current customer's data.

This is intentionally separate from AIRI's general chat history. The current version has no membership identity; a later member lookup can attach an identity to the same Kiosk session lifecycle without retaining anonymous conversations.
Successful Fast Path voice turns and compact real menu/cart results are saved in
that same visitor session. Main Agent receives a bounded recent conversation
and can use the read-only `kiosk_session_history` tool to page older text from
this visitor only; System One receives only the current phase and finite
decision context, not the conversation history.
When an ASR turn escalates, the Main Agent receives a sanitized snapshot of the
current menu or checkout phase and available payment methods. Typed turns read
the same state through a host-only, read-only WebMCP tool. Tax IDs, carrier
codes, and raw checkout objects are never included in that conversation hint;
tool execution still checks the browser's live state.

## Customer-facing assistance state

The conversation surface presents a large, plain-language state tied visually to
the avatar: listening, understanding speech, arranging a request, or speaking.
Normal customer replies stream through the device-authenticated Server route, so
the conversation displays customer-safe assistant text as it is generated and
switches to the interactive service's tool status when browser-owned work begins.
Only the completed assistant reply is retained in the visitor transcript; an
interrupted partial reply remains presentation-only.
It starts with “直接告訴我想吃什麼” and always leaves the menu touchable. The old
draggable technical audio-status card is available only in development
diagnostics; camera, microphone, and model failures are not customer-facing
copy. When an embedded menu displays accepted recommendations, it does so in
its own non-blocking rail rather than navigating the Kiosk away from the menu.

For VRM characters, a system manager may upload compatible `.vrma` clips in a
published Profile's **角色動作包** under **互動體驗 → 角色卡與虛擬角色**. The clips
are stored independently from the model, hash-versioned, and applied only after
that Profile is published. **待機動作** loops while the Kiosk waits; **招呼客人**
plays once when a proactive greeting is spoken. Other configured clips map to
listening, thinking, recommendation presentation, and order acknowledgement.

## Completion survey invitation

In administrator mode, open **完成後問卷邀請** to enable the optional survey, set a fixed HTTP(S) survey URL, and adjust its customer-facing copy and duration. AIRI generates the QR Code in the browser; it does not send the URL to a QR Code provider or append order, conversation, member, or customer data to the link.

The invitation, approved interactive services, and their AIRI instructions are stored in the same-origin Interaction Profile shared with Stage Web. Other browser origins and devices remain independent until a future device-management service provides central settings.

## Administrator mode

### Per-device operational settings

System administrators open **Devices → Device settings** in the Dashboard
(`/admin/kiosk/devices`) to configure each registered Kiosk and delegate
individual fields with **Allow local changes**. The Kiosk's **現場設定** page
edits the same Server-owned policy; saving requires the device cookie and a
signed-in system administrator or an administrator of that device's Site.
The PIN alone cannot authorize a settings write.

Precedence is Site defaults, then administrator device overrides, then explicitly
delegated local overrides. Site defaults cover camera capture (off, JPEG snapshot,
event clip, or continuous video), VLM, performance, and VAD; observation,
greetings, reminders, timing, detection zones, and the MediaPipe face-confidence
threshold (`0.40`–`0.80`, default `0.60`) have shared defaults and can be overridden
per device. New devices have local controls locked
and observation/greetings/reminders disabled. Old browser-local observation
preferences are no longer authoritative and are not migrated automatically.

The **Presence vision mode** setting is per-device and supports `face_only`
(the legacy baseline), `pose_only`, and `pose_plus_conditional_face` (the
default). Pose modes use local Pose Lite for anonymous relative body-scale and
movement evidence; conditional face checks run only for attention-capable
greeting modes and never in the same inference callback as Pose.

Removing delegation discards that local value permanently. Administrators may
also clear an existing local override while keeping the field delegated. Every
accepted write increments the device revision and records the operator and
before/after values in the audit log. A stale form receives HTTP 409 and must be
reloaded instead of silently overwriting another operator's changes.

The active Kiosk refreshes effective settings every 15 seconds after the previous
request finishes. Offline it retains the last snapshot; reconnection applies the
current policy. Camera work is stopped and restarted when policy changes, and
the Server independently enforces recording and proactive-action permissions.
Recording without observation does not start MediaPipe. These controls do not
change browser camera/microphone permission or the existing local preview toggle.

For voice-only acceptance testing, an administrator can enable **語音診斷模式（測試用）**
on an individual device. The Kiosk then shows its latest eight VAD segments as
recognizing, unrecognized, recognized, failed, or decided, together with the
Speech Guard label/score when available and the final turn-decision reason.
The Server returns these diagnostics only while that device setting is enabled;
turn it off after testing because recognized visitor speech is visible on screen.

Deployment requires migrations `0032_kiosk_device_settings.sql` and
`0033_kiosk_voice_vad_settings.sql` before using the
new Server routes. Include it in the Server schema package used by the normal
startup migration process, then deploy the matching Dashboard and Kiosk assets.

### Voice activity detection

Kiosk voice input uses the Silero VAD model. System administrators can set the
Site-wide threshold, minimum speech and silence durations, maximum utterance
duration, and leading/trailing speech padding in **Kiosk 模型設定 → Silero VAD**.
The initial policy is `0.5`, `250 ms`, `9999 s`, `250 ms`, and `2000 ms`
respectively. The Kiosk receives this policy through its normal 15-second
settings sync. Its audio buffer expands only while a visitor speaks, so a
`9999 s` maximum does not allocate a large buffer at startup.

### Local access

The visitor experience does not display settings. Long-press the `AIRI 餐飲服務員` label for 1.2 seconds, then enter the PIN configured before starting the kiosk:

```bash
VITE_KIOSK_ADMIN_PIN='choose-a-private-pin' pnpm --filter @proj-airi/stage-kiosk run dev
```

Administrator mode can choose the microphone, adjust the locally stored customer conversation text size, enable or disable voice input, and pause the avatar for calibration. Published Site policy resolves the chat and audio models on the Server; provider credentials and API keys never enter the kiosk bundle or settings surface.

In Webnavior's published Kiosk Profile, **僅允許語音對話** hides the customer text composer and starts pre-authorized microphone capture on load. The kiosk visibly indicates whether its microphone is actively listening; it sends audio and reply text only to device-authenticated Server audio endpoints.

The Profile can also include an optional PNG, JPEG, or WebP **服務場景** image. It is served as an immutable versioned kiosk asset and appears behind the virtual service character after the Profile is published. When no image is configured, the kiosk deliberately uses its built-in counter scene, so a readable service setting does not require a background upload.

The kiosk captures complete ASR utterances independently while model or browser work continues. Real speech and the simulated-ASR input enter the same bounded decision queue. Jev first filters background speech; an ignored utterance neither interrupts the spoken reply nor reaches Main Agent. A related follow-up may restart an Agent that has not yet requested a browser tool, preserving both user turns in the visitor session. Once a tool is requested, new speech waits for the definitive result and is re-evaluated against the latest menu/checkout state. The queue reserves speech order before ASR returns, and overload is shown rather than silently dropping a phrase. Ordering workflows remain responsible for explicit customer confirmation before submission. Development mode or the conversation diagnostic setting exposes a larger per-utterance decision inspector.

Before a conversation starts, an engaged person's intelligible but semantically
uncertain utterance becomes a short-lived browser-only candidate instead of
being retained as a visitor turn. The Kiosk asks once whether help is wanted;
a short affirmative answer promotes the already transcribed original utterance
without requiring the customer to repeat it. Candidates expire without saving
their audio or transcript when they are not confirmed.

### Webnavior Kiosk Activity Manifest

An approved interactive service can optionally serve `/.well-known/webnavior-kiosk-activity.json` from its own origin. It provides customer-facing status labels for its WebMCP tools; it does not change tool execution and is never sent to the LLM. The kiosk ignores missing, unavailable, or invalid manifests and uses its generic status labels instead.

```json
{
  "version": 1,
  "tools": {
    "cart_add_item": {
      "running": "正在將餐點加入清單…",
      "success": "餐點已加入清單。",
      "error": "無法加入餐點，正在重新確認…"
    }
  }
}
```

The manifest must be served with CORS allowing the kiosk origin to fetch it. Labels are display-only: each non-empty label is capped at 160 characters and malformed entries are ignored individually. New tools without an entry continue to work and display the generic progress message.

`VITE_KIOSK_ADMIN_PIN` is an on-device guard against accidental customer access, not a replacement for server-side administrator authentication: Vite exposes `VITE_` values to the browser bundle. Production deployment should place provider credentials in a protected management service rather than relying on this PIN alone.
