<h1 align="center">アイリ VTuber</h1>

<p align="center">
  [<a href="https://airi.ayaka.io">Try it</a>]
</p>

> Heavily inspired by [Neuro-sama](https://www.youtube.com/@Neurosama)

## Kiosk device management

`/admin/system/models` groups the existing ASR Provider and the
**語音辨識模式與 Falcon 服務** connection draft editor inside **語音辨識**.
Administrators can save the service origin, API path, engine,
precision, timeout, reserved utterance limit and expected JSON text format.
API keys are stored encrypted on the Server; blank preserves the current key,
and removal is explicit. Saving this draft leaves the existing ASR active.
The new AV mode remains unavailable until capture and provider integration are
verified. Reserved duration settings do not change the current VAD pipeline.

`/admin/kiosk/devices` provides Site filtering, sorting, permission-scoped batch
actions with confirmation, and per-device settings dialogs. Settings share the
same revisioned policy as the on-device editor, including **純文字模式**. Unsaved
edits survive background refreshes; saved changes synchronize to running devices.
Local kiosk access uses a Server-verified PIN; Dashboard access retains account
and Site permissions. PB dine-in/table selection is not implemented by these
management controls.

In `/admin/kiosk/profiles`, expand **互動服務** to edit each merchant's product
aliases and discovery categories. Enter the exact current PB product name; aliases
accept comma or `、` separators. Save the draft and publish it to apply. Labels
help Main/Jev find candidates without changing merchant prices, options or supply.
Shared aliases require clarification; absent, renamed or duplicate-name products
do not inherit old labels. Additional merchant bindings have separate label rows.

Visitor-session transcripts attach audio through an explicit unique transcript
entry link. Repeated phrases remain separate when their utterance IDs differ.
Missing/ambiguous links are marked instead of guessed by timestamp or list
position. Original recordings remain available in a separate authenticated media
list, including retained recordings whose transcript association is unknown.

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

The **系統模型 → 設定對話 LLM → 編輯** form retains separate
**一次回傳（JSON）** and **串流回傳（SSE）** choices for OpenAI-compatible
providers, plus **沿用目前方式** (`auto`, follows the caller). The capability
card and provider list show the selected response policy; the editor places it
immediately after provider type. Verify/save, select the provider if needed, then
**套用到 Kiosk** to activate it. Editing/displaying a policy does not switch the
running provider automatically. Internal structured JSON decisions remain JSON;
streaming conversation/tool continuations preserve their validated arguments.

The **Main 自動備援來源** selector chooses another verified chat provider as
an optional fallback. The primary source remains selected; connection failures,
timeouts and eligible service errors can trigger the backup. Source-specific
response modes remain independent. Each configured timeout is an upper bound;
the system reserves fallback time within the remaining request budget and may
shorten an attempt. These limits do not extend a Kiosk turn's overall deadline.
Select **停用自動備援** to clear it, and use **套用到 Kiosk** after saving. A selected backup must be cleared or
replaced before it can become primary or be removed. This setting does not
change System One/Jev routing.

The **Kiosk AI 能力 → System One 快速決策** panel supports Dasein, lookski,
OpenAI Decisions, and the existing SLM (OpenAI-compatible, including Docker Model
Runner). OpenAI uses `https://api.openai.com/v1` and defaults to `gpt-6-luna`;
enter a key with Decisions Write permission. `/models` discovery is optional;
the manually entered model still requires real `/decisions` verification before
activation. Keys stay encrypted on Server and are never returned to this UI.
Jev and Decisions select ordinary actions directly; the per-device background
speech setting separately controls recipient checks. SLM discovers `/models`,
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
- **互動體驗 → 角色卡與虛擬角色** supports site-owned VRM/Live2D uploads,
  AIRI character-card ZIP packages containing a model, and six VRMA motion slots
  for VRM characters. Uploads preserve unsaved form fields and do not publish
  automatically; a response cannot attach to another selected draft or Site.
  Save/publish explicitly, then reopen an idle Kiosk to apply the release.
  The system template and read-only editors expose no asset-upload controls
  because files are owned by Sites. Test/production assets remain separate.
  **下載角色套件 / 上傳角色套件 ZIP** transfers the current character text,
  both greeting text banks, avatar, six motion assignments, idle fallback and
  background together. Downloads include unsaved character edits. Import replaces
  only those fields in the current editor and clears missing optional character
  assets; review, save and publish explicitly. Merchant URLs, store instructions,
  voice/text policy, devices, accounts and provider keys remain local. Imported
  files become assets of the destination Site, so the package works across
  independent servers without source asset IDs. ZIP limit is 120 MB, each asset
  128 MB, extracted total 256 MB. This Webnavior package has its own versioned
  manifest; the separate AIRI-card upload remains available for AIRI card ZIPs.
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
management starts at `/admin`. The former Stage character/chat homepage and its
exclusive embedded ordering panel, diagnostics overlay and camera gaze helper
have been removed. Shared `packages/stage-ui` components and Kiosk functionality
remain in use; removing the old page does not remove that package.

An expired API session that cannot be refreshed starts OIDC sign-in through
the local Webnavior `/auth/login` page. After successful OIDC login, the
web callback restores the original local route, including query and hash;
missing or unsafe return routes go to `/admin`. API failures must not navigate
to an external AIRI application.

Deployment findings and the pending third-party browser-control options are in
[`docs/plans/2026-10-18-webnavior-routing-and-browser-control.md`](../../docs/plans/2026-10-18-webnavior-routing-and-browser-control.md).
