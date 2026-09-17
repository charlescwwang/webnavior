# Order menu service

`@proj-airi/order-menu` is a standalone Vue web service for browsing a menu and
building an order. It deliberately does not import AIRI UI, avatar, Electron,
Pinia, speech, or model packages.

## Run locally

From the repository root:

```bash
pnpm --filter @proj-airi/order-menu dev
```

The service runs at `http://localhost:5166` by default. Opening that URL directly
provides a fully usable menu and cart without AIRI running.

## Local service ports

The restaurant installation runs four independent processes by default:

| Service | Workspace | Default URL | Responsibility |
| --- | --- | --- | --- |
| Server API | `@proj-airi/server` | `http://localhost:5168` | API, authentication, device and experience data. |
| Management console | `@proj-airi/stage-web` | `http://localhost:5167` | Staff and administrator configuration. |
| Customer Kiosk | `@proj-airi/stage-kiosk` | `http://localhost:5169` | VRM character and customer conversation. |
| Menu service | `@proj-airi/order-menu` | `http://localhost:5166` | Menu, cart, and ordering only. |

The menu service intentionally has no VRM character, chat window, microphone,
or AIRI provider configuration. It can be opened directly, or embedded by the
Kiosk as an interactive page.

## AIRI integration

When embedded by AIRI, the service exposes its domain operations through native
WebMCP. AIRI discovers the tools dynamically, so this service is one interactive
service among many rather than an AIRI built-in feature.

When the customer explicitly agrees to see recommendations, an Agent may call
`menu_show_recommendations` with one to four verified menu item IDs. The menu
renders those items as a non-blocking recommendation rail with the catalog's
own image, name, price, and availability data; it never trusts model-generated
product details. Returning to the regular menu automatically compacts the rail
to a small recommendation label, so the customer does not need to close a modal
or leave their current browsing position.

Set `VITE_AIRI_ORIGIN` to the exact AIRI browser-visible origin when deploying
separately. The embedded menu otherwise uses its referrer origin, including a
port when that port is genuinely part of the page URL. The Ubuntu deployment
script supplies `VITE_AIRI_ORIGIN` from its `--origin` value, so a public domain
such as `https://airi.example.com` remains port-free even when Nginx proxies
internally to another port. The embedding page must set `allow="tools"` on its
iframe for native WebMCP support.

For an AIRI Kiosk customer session, the service may additionally send the small
host lifecycle events in
[`interactive-service-lifecycle-v1.md`](../../docs/standards/interactive-service-lifecycle-v1.md):
`activity` refreshes the anonymous-session idle timer and `completed` starts the
next-customer flow. These events do not expose or execute tools.

### Webnavior Kiosk Activity Manifest

The menu publishes [`public/.well-known/webnavior-kiosk-activity.json`](public/.well-known/webnavior-kiosk-activity.json) for the Kiosk's optional customer-facing tool progress labels. It is not a WebMCP extension and is never passed to the LLM. Missing or invalid labels only make the Kiosk use its generic progress text; they never block menu or ordering operations.

The Vite development server allows the configured `VITE_AIRI_ORIGIN` to read the manifest; production deployment must return the same CORS header for `/.well-known/webnavior-kiosk-activity.json`.

## Extending for a real ordering system

The order state lives in `src/domain/order-machine.ts`; it owns menu selection,
options, cart updates, the order-level dine-in/take-out choice, and order
submission. When a customer has already specified an item, its options, and its
quantity, the WebMCP `order_add_item` tool performs that whole operation in one
Agent call while the menu still visibly steps through each change. The
`order_set_fulfillment` tool and the visible menu buttons use the same state, so
an order cannot be confirmed before the customer chooses how it will be served.
Until then, the cart reports the choice as deferrable and customers may continue
adding items. A real POS or kiosk integration implements the `PosOrderGateway`
boundary passed to `createOrderMachine`.
The current default gateway returns a simulated submitted order and does not send
anything to an external system.

## Extracting from AIRI

The service can move to its own repository or container without code changes to
the AIRI application. It has no runtime dependency on `@proj-airi/*` packages.
Before publishing it outside this workspace, replace the workspace `catalog:`
dependency versions in `package.json` with normal version ranges, then configure
the allowed embedding origin with `VITE_AIRI_ORIGIN`.

This service should not own AIRI chat, identity, avatar rendering, model keys, or
speech settings; those remain integration concerns of the embedding application.

The draft cross-vendor ordering contract is documented in
[`docs/standards/restaurant-menu-agent-protocol-v0.1.md`](../../docs/standards/restaurant-menu-agent-protocol-v0.1.md).
