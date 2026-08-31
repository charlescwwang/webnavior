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

When embedded by AIRI, the service exposes the same domain operations through:

1. Native WebMCP, when the browser provides `document.modelContext`.
2. A narrowly scoped `postMessage` bridge as the compatibility path.

Set `VITE_AIRI_ORIGIN` to the exact AIRI web origin when deploying separately.
It defaults to `http://localhost:5173` for local development. The embedding page
must set `allow="tools"` on its iframe for native WebMCP support.

## Extending for a real ordering system

The order state lives in `src/domain/order-machine.ts`; it owns menu selection,
options, cart updates, and order submission. A real POS or kiosk integration
implements the `PosOrderGateway` boundary passed to `createOrderMachine`.
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
