# Order menu service

`@proj-airi/order-menu` is a standalone Vue web service for browsing a menu and
building an order. It deliberately does not import AIRI UI, avatar, Electron,
Pinia, speech, or model packages.

On a portrait kiosk, menu browsing stays focused on the available dishes. A
compact order summary remains at the bottom of that view; selecting it opens a
dedicated order-review screen where customers can inspect customizations, edit
quantities, remove items, choose dine-in or take-out, and explicitly advance to
checkout. Checkout asks the customer to scan or skip membership, confirm the
cloud-invoice choice, and then use the physical payment terminal. An authorized
payment is bound to the exact cart total and automatically submitted to the POS;
a rejected payment can be retried, while an uncertain result locks the order to
avoid a duplicate charge. Temporary product comparison is kept in the content
area so it never replaces the committed-order summary.

## Run locally

From the repository root:

```bash
pnpm --filter @proj-airi/order-menu dev
```

The service runs at `http://localhost:5166` by default. Opening that URL directly
provides a fully usable menu and cart without AIRI running. It requires
`VITE_ORDER_MENU_SERVER_URL`; copy [`.env.example`](.env.example) to `.env.local`
and use the local Bridge URL (`http://127.0.0.1:5170`) during development.

## Local service ports

The restaurant installation runs four independent processes by default:

| Service | Workspace | Default URL | Responsibility |
| --- | --- | --- | --- |
| Server API | `@proj-airi/server` | `http://localhost:5168` | API, authentication, device and experience data. |
| Management console | `@proj-airi/stage-web` | `http://localhost:5167` | Staff and administrator configuration. |
| Customer Kiosk | `@proj-airi/stage-kiosk` | `http://localhost:5169` | VRM character and customer conversation. |
| Menu service | `@proj-airi/order-menu` | `http://localhost:5166` | Menu, cart, and ordering only. |
| POS Bridge | `@proj-airi/order-menu-server` | `http://127.0.0.1:5170` | Catalog and idempotent order submission. |
| POS simulator | `@proj-airi/order-menu-server` | `http://127.0.0.1:5171` | Development-only controllable POS upstream. |

The menu service intentionally has no VRM character, chat window, microphone,
or AIRI provider configuration. It can be opened directly, or embedded by the
Kiosk as an interactive page.

Its sellable menu is loaded only from the configured POS Bridge. A Bridge
failure displays a retryable customer-facing error; the browser never replaces
it with the historical hard-coded menu. The Bridge snapshot includes its source
revision, which travels with the cart and is validated again before submission.

## AIRI integration

When embedded by AIRI, the service exposes its domain operations through native
WebMCP. AIRI discovers the tools dynamically, so this service is one interactive
service among many rather than an AIRI built-in feature.

When the customer asks what the store recommends without stating a preference,
the Agent calls `menu_recommend` without `needs`; the catalog's default order is
treated as the store's signature/popular order. Without an explicit `limit`, the
menu shows one 首選 so the spoken recommendation and visible recommendation stay
in sync. If the customer asks for several options or a comparison, the Agent
passes `limit: 2` or `3`. The Agent should recommend first and only ask about
rice, noodles, spice, or similar preferences after the customer rejects or
narrows that first suggestion. For an explicit preference, `menu_recommend`
accepts verified `needs` tags. The menu renders the returned items as a
non-blocking recommendation view with the catalog's own data; it never trusts
model-generated product details. `menu_show_recommendations` remains available
when the Agent needs to display a previously verified custom set.

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
For cart edits, the Agent first calls `cart_get` for the opaque line ID, then
uses `cart_set_line_quantity`, `cart_set_line_option`, or `cart_remove_item`
directly instead of removing and re-adding a meal. `cart_clear` also requires
an explicit customer confirmation and is unavailable after POS acceptance.
In Kiosk voice mode, Fast Path chooses bounded semantic intents; this menu
resolves real targets and authorizes the resulting WebMCP operation. Native
Main Agent mutations also pass through its current phase, target, revision,
payment, and one-use confirmation checks. If two cart lines share a product,
removal or editing asks which real line the customer means before changing it.
Until then, the cart reports the choice as deferrable and customers may continue
adding items. A real POS or kiosk integration implements the `PosOrderGateway`
boundary passed to `createOrderMachine`. Every submission returns a receipt with
an explicit `environment` (`test` or `live`) and `status` (`accepted`,
`rejected`, or `uncertain`). Only an accepted live receipt may be presented as
an order sent to the POS. The current default gateway exists only for isolated
domain tests. The browser app always uses its configured POS Bridge; when that
URL is absent or catalog loading fails it displays an error instead of falling
back to a test gateway. An `uncertain` response locks the confirmation control
until staff reconcile the existing idempotent submission, preventing a blind
second order.

The host-only `kiosk_interaction_state` tool exposes a non-sensitive phase
summary for Kiosk conversation turns without issuing or consuming System One
candidates; it is not available to the Main Agent as a callable tool.

## Extracting from AIRI

The service can move to its own repository or container without code changes to
the AIRI application. It has no runtime dependency on `@proj-airi/*` packages.
Before publishing it outside this workspace, replace the workspace `catalog:`
dependency versions in `package.json` with normal version ranges, then configure
the allowed embedding origin with `VITE_AIRI_ORIGIN`.

This service should not own AIRI chat, identity, avatar rendering, model keys, or
speech settings; those remain integration concerns of the embedding application.

The current checkout contract is documented in
[`docs/standards/restaurant-menu-agent-protocol-v0.2.md`](../../docs/standards/restaurant-menu-agent-protocol-v0.2.md).
The earlier v0.1 document remains the historical cart-only draft.
