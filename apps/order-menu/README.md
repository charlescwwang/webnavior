# Order menu service

`@proj-airi/order-menu` is a standalone Vue web service for browsing a menu and
building an order. It deliberately does not import AIRI UI, avatar, Electron,
Pinia, speech, or model packages.

## Run locally

From the repository root:

```bash
pnpm --filter @proj-airi/order-menu dev
```

The service runs at `http://localhost:5174` by default. Opening that URL directly
provides a fully usable menu and cart without AIRI running.

## AIRI integration

When embedded by AIRI, the service exposes its domain operations through native
WebMCP. AIRI discovers the tools dynamically, so this service is one interactive
service among many rather than an AIRI built-in feature.

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

## Extending for a real ordering system

The order state lives in `src/domain/order-machine.ts`; it owns menu selection,
options, cart updates, the order-level dine-in/take-out choice, and order
submission. The WebMCP `order_set_fulfillment` tool and the visible menu buttons
use the same state, so an order cannot be confirmed before the customer chooses
how it will be served. A real POS or kiosk integration implements the
`PosOrderGateway` boundary passed to `createOrderMachine`.
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
