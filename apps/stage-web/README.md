<h1 align="center">アイリ VTuber</h1>

<p align="center">
  [<a href="https://airi.ayaka.io">Try it</a>]
</p>

> Heavily inspired by [Neuro-sama](https://www.youtube.com/@Neurosama)

## Interactive service completion survey

Stage Web can mirror the customer-facing Kiosk completion flow while testing an embedded interactive service. Configure **設定 → 系統 → 完成後問卷** with a fixed HTTP(S) survey URL, then an embedded service's validated `completed` lifecycle event opens a locally generated QR Code invitation. Skipping it or reaching the countdown resets the current interaction chat session and reloads the iframe.

This is host behavior, not a menu-service feature or WebMCP tool. Stage Web and
Stage Kiosk share the same Interaction Profile when they use the same browser
origin.

## Native WebMCP interactive services

Stage Web discovers tools from the active, administrator-approved iframe with the same native WebMCP adapter as Stage Kiosk. The embedded page must register native WebMCP tools and the browser must expose `document.modelContext`; there is no legacy `postMessage` tool bridge. When WebMCP is unavailable, tools are withheld rather than invoking an unsupported service.

The iframe URL comes from the enabled service's saved **互動服務** `serviceUrl`.
`VITE_ORDER_MENU_URL` supplies only the first-run default; it does not replace an
already saved URL. `VITE_AIRI_ORIGIN` is an embedded service's WebMCP allowlist
setting and does not alter the iframe `src`.

## Webnavior Kiosk management

The Webnavior admin Kiosk pages separate retained customer records from device
configuration:

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

The admin application does not embed a Kiosk preview. Open the separately
deployed `/kiosk/` application when an end-to-end customer-flow check is needed.
