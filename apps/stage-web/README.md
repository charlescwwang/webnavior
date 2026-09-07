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
