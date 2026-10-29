<h1 align="center">アイリ VTuber</h1>

<p align="center">
  [<a href="https://airi.ayaka.io">Try it</a>]
</p>

> Heavily inspired by [Neuro-sama](https://www.youtube.com/@Neurosama)

## Interactive service completion survey

Stage Web can mirror the customer-facing Kiosk completion flow while testing an embedded interactive service. Configure **設定 → 系統 → 完成後問卷** with a fixed HTTP(S) survey URL, then an embedded service's validated `completed` lifecycle event opens a locally generated QR Code invitation. Skipping it or reaching the countdown resets the current interaction chat session and reloads the iframe.

The owned menu emits completion immediately after a paid order is accepted.
When it supplies an order-continuation URL, the completion screen shows a separate
order QR and desktop link alongside the configured survey. The static survey URL
is unchanged; order capabilities are transient UI state and clear on session end.

This is host behavior, not a menu-service feature or WebMCP tool. Stage Web and
Stage Kiosk share the same Interaction Profile when they use the same browser
origin.

## Native WebMCP interactive services

Stage Web discovers tools from the active, administrator-approved iframe with the same native WebMCP adapter as Stage Kiosk. The embedded page must register native WebMCP tools and the browser must expose `document.modelContext`; there is no legacy `postMessage` tool bridge. When WebMCP is unavailable, tools are withheld rather than invoking an unsupported service.

The iframe URL comes from the enabled service's saved **互動服務** `serviceUrl`.
`VITE_ORDER_MENU_URL` supplies only the first-run default; it does not replace an
already saved URL. `VITE_AIRI_ORIGIN` is an embedded service's WebMCP allowlist
setting and does not alter the iframe `src`.

The interactive iframe delegates geolocation to its source origin so embedded
services can request location with the user's permission. Production pages must
use HTTPS. If the deployment sets a `Permissions-Policy` header, its geolocation
allowlist must also include the embedded service's origin; the iframe cannot
override a restrictive response header.

## Webnavior Kiosk management

The Webnavior admin Kiosk pages separate retained customer records from device
configuration:

The **Kiosk AI 能力 → System One 快速決策** panel supports Dasein, lookski and
SLM (OpenAI-compatible, including Docker Model Runner). SLM discovers `/models`,
lets the operator choose a model, then requires a real readiness decision before
activation. The URL is the API root reachable from Server, for example
`http://127.0.0.1:12434/engines/v1` on the same host. Saved profile edits invalidate
readiness. Only one Fast Path profile is active; adding SLM does not switch it
on automatically or change Main's model. The concise default prompt affects
post-admission demand interpretation; existing custom prompts remain saved.

- **Kiosk 使用歷程** groups retained records into customer interactions,
  greeting-only observations, and empty records. Greeting-only evidence remains
  retained but is excluded by the default filter. An administrator can select
  reviewed interaction records and download LLM JSONL or an ASR ZIP containing
  `metadata.jsonl` and its paired recordings. Opening one record also exposes
  a per-conversation delete action; it requires confirmation and permanently
  removes that session's transcript, events, and retained media.
- **Kiosk 設備** is where an administrator opens one registered device's
  **裝置設定**. Camera evidence mode is configured per device there. The
  **保存天數** control appears with that device configuration, but applies to
  every device in the selected site because session retention is a site policy.
- **互動體驗 → 服務場景** can attach one PNG, JPEG, or WebP store background
  to the published Profile. Kiosk uses its built-in counter scene whenever the
  Profile has no uploaded image.
- **互動體驗 → 開場招呼 → 固定歡迎詞** edits 1–50 spoken openings, one per line.
  Include the store name in these phrases. The optional-phone explanation is
  appended by the Kiosk only on its entry screen. Publish and reload registered
  kiosks to prepare reusable speech; reload after changing the TTS model/voice
  too. **開場招呼 → 開場招呼方式** selects fixed phrases or VLM
  generation through the existing VLM policy, subject to device overrides.
  Both phrase banks and **VLM 開場指引** are retained. Fixed welcomes bypass
  LLM/VLM generation; VLM welcomes use the current frame and configured vision
  model before synthesis. The same policy determines whether generated
  assistance reminders include images. Reload Kiosk for immediate application.
  Mode and its content now share one section; switching modes retains unsaved
  text. Owner templates can edit both banks before a Site owns a mode setting.
  A live count and shared Server/editor limits prevent submitting more than 50
  phrases or a phrase longer than 500 characters, with an inline explanation.

The admin application does not embed a Kiosk preview. Open the separately
deployed `/kiosk/` application when an end-to-end customer-flow check is needed.

## Entry and login recovery

The public `/` entry opens the separately deployed `/kiosk/` application;
management starts at `/admin`. An expired API session that cannot be refreshed starts OIDC sign-in through
the local Webnavior `/auth/login` page. After successful OIDC login, the
web callback restores the original local route, including query and hash;
missing or unsafe return routes go to `/admin`. API failures must not navigate
to an external AIRI application.

Deployment findings and the pending third-party browser-control options are in
[`docs/plans/2026-10-18-webnavior-routing-and-browser-control.md`](../../docs/plans/2026-10-18-webnavior-routing-and-browser-control.md).
