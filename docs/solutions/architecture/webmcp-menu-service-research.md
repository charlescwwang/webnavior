---
title: WebMCP Research for an Independent Menu Service
date: 2026-08-29
category: architecture
module: menu ordering and agent integration
problem_type: research
component: WebMCP
tags:
  - webmcp
  - menu
  - ordering
  - iframe
  - agent-tools
---

# WebMCP Research for an Independent Menu Service

## Scope and current status

WebMCP is a W3C Web Machine Learning Community Group draft, not a W3C Standard or
standards-track specification. It exposes page-owned JavaScript tools to agents; it
does not define a remote AIRI-to-site transport by itself. This means it is a good
semantic surface for the menu web app, but AIRI still needs a browser-side bridge to
discover and invoke those tools when AIRI is the agent. [WebMCP draft](https://webmachinelearning.github.io/webmcp/)

As of 2026-08-29, Chrome documents WebMCP as an origin trial beginning in Chrome 149;
local development uses `chrome://flags/#enable-webmcp-testing`. It should therefore be
implemented as a progressive enhancement, not as the only ordering integration. [Chrome WebMCP overview](https://developer.chrome.com/docs/ai/webmcp)

## Browser API and tool contract

The current draft surface is `document.modelContext` in a secure context. The core
imperative API is `await document.modelContext.registerTool({ name, description,
inputSchema, execute, annotations })`. Names are unique within a document's context,
must be 1–128 characters, and can use ASCII alphanumerics, `_`, `-`, and `.`. The
input schema is a JSON Schema object; the callback receives parsed input and an
`AbortSignal`, and its fulfilled value is JSON-serialized as the tool result. [WebMCP API](https://webmachinelearning.github.io/webmcp/#api)

For an AIRI integration, feature-detect the current API rather than assuming a legacy
`navigator.modelContext` surface:

```ts
const canRegisterWebMcpTools = typeof document.modelContext?.registerTool === 'function'
```

The hosting document can use `getTools()` to discover authorized tools, then
`executeTool(registeredTool, inputObject)` to invoke one. Tool results and schema are
structured, so the menu tool callback should update the same application state that
the human controls, then return a compact order/cart snapshot. [Chrome Imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api)

## Recommended menu tool surface

Keep each tool to one clearly named domain operation. This matches Chrome's guidance
to avoid overlapping tools and register only tools useful in the current page state.
[WebMCP best practices](https://developer.chrome.com/docs/ai/webmcp/best-practices)

| Tool | Input | Side effect / result |
| --- | --- | --- |
| `menu_get` | optional `category` | Read-only menu/catalog snapshot. |
| `cart_add_item` | `menuItemId`, `quantity`, selected option values | Adds a configured item and returns the cart. |
| `cart_update_item` | `cartItemId`, optional quantity/options | Updates one existing cart line and returns the cart. |
| `cart_remove_item` | `cartItemId` | Removes one cart line and returns the cart. |
| `cart_get` | none | Read-only cart and total. |
| `order_request_confirmation` | none | Produces a reviewable summary; it must not submit. |
| `order_confirm` | explicit user-confirmation token | Creates the simulated order; later this is the POS/Kiosk adapter boundary. |

Prefer opaque menu and cart IDs over names in write operations, while returning
localized display names to the agent. Limit enum values (for example `spiceLevel`) in
the JSON Schema. Mark `menu_get` and `cart_get` with `readOnlyHint: true`; leave write
tools false. Mark externally supplied/POS-originated text with
`untrustedContentHint: true` when applicable. [WebMCP annotations](https://webmachinelearning.github.io/webmcp/#dom-toolannotations-readonlyhint), [Chrome security guidance](https://developer.chrome.com/docs/ai/webmcp/secure-tools)

## Iframe and independent-service integration

The preferred topology is a separate menu application/domain package or deployable
service, embedded in an AIRI ordering panel as an iframe. It preserves menu/POS
ownership while leaving AIRI's avatar, chat, TTS, and speech controls in the parent
shell.

For a same-origin iframe, tools are discoverable within the frame tree by default. For
a cross-origin menu service, all three conditions are required:

1. Parent iframe markup delegates the `tools` Permissions Policy:
   `<iframe src="https://menu.example" allow="tools">`.
2. The menu page registers each intended tool with
   `exposedTo: ['https://airi.example']`.
3. AIRI explicitly requests that origin with
   `document.modelContext.getTools({ fromOrigins: ['https://menu.example'] })`.

The draft also requires secure origins for cross-origin exposure/discovery. Execution
is limited to documents in the same top-level traversable, which an embedded iframe
satisfies; a separately opened tab/window is not an equivalent integration.
[Chrome iframe guidance](https://developer.chrome.com/docs/ai/webmcp/imperative-api), [WebMCP execution model](https://webmachinelearning.github.io/webmcp/#dom-modelcontext-executetool)

Use an iframe `postMessage` protocol only as AIRI's non-WebMCP fallback/visualization
adapter, with strict `targetOrigin`, inbound `event.origin` validation, request IDs,
and no secrets. Both WebMCP and that fallback should call one menu-domain action
service, so UI behavior, cart validation, visual cursor events, and future POS calls
cannot diverge.

## Visibility, consent, and security decisions

Each mutating menu action should first publish a visible execution event containing a
stable target ID and a short localized label (for example, "設定雞排：不辣"). The UI
uses that event to highlight the card/control, animate the virtual AIRI cursor, and
then commits the same domain action. This is an application behavior: WebMCP gives the
agent the structured callback but does not render a cursor for it.

`order_confirm` must require an explicit, recent user confirmation in the AIRI UI. A
tool description is not a security boundary: the WebMCP draft warns that authenticated
tools can make purchases and that declared tool intent can differ from implementation.
Only expose tools to trusted origins, preserve normal server-side authorization and
validation, and avoid putting payment or PII into broad tool schemas. [WebMCP security considerations](https://webmachinelearning.github.io/webmcp/#security-and-privacy-considerations), [Chrome tool security](https://developer.chrome.com/docs/ai/webmcp/secure-tools)

Keep descriptions and results compact. Chrome currently recommends no more than 500
characters per description and 1.5K per individual tool output, which supports
returning concise snapshots instead of entire product catalogs on every mutation.
[Chrome tool security character budgets](https://developer.chrome.com/docs/ai/webmcp/secure-tools)

## Implication for the MVP

Build the menu action/domain layer first, with an in-memory fake catalog and a
`PosOrderGateway` interface whose initial implementation records a simulated order.
The embedded UI and WebMCP registrations are thin adapters over this layer. AIRI's
ordering panel should use a same-origin development iframe initially, then exercise
the cross-origin configuration above before a separately deployed service is released.
When native WebMCP is unavailable, AIRI can invoke the identical actions through the
validated iframe message bridge; that fallback remains semantic and does not use OS
mouse coordinates or screen scraping.
