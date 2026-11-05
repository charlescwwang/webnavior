# Order Menu POS Bridge

`@proj-airi/order-menu-server` is the local server boundary between the
customer-facing Order Menu and a POS provider. It owns normalized catalog and
order-submission HTTP contracts; the customer UI and WebMCP never receive POS
credentials or vendor response shapes.

## Pickup numbers

After acceptance, the Bridge assigns a random three-digit pickup number (100–999)
to the order receipt. It is separate from the POS order identifier. The existing
idempotency cache returns the same number on concurrent requests and receipt
replays; rejected or uncertain orders receive none. This follows the current
simulator's process-local receipt lifetime, not durable POS storage. A live vendor
integration must persist receipts and pickup numbers with its order records.

## Development

```bash
pnpm --filter @proj-airi/order-menu-server dev
```

The command starts two loopback-only servers:

| Service | Default URL | Purpose |
| --- | --- | --- |
| POS Bridge | `http://127.0.0.1:5170` | Browser-facing catalog and order API. |
| POS simulator | `http://127.0.0.1:5171` | Development/test substitute for a real POS. |

Set configuration in `apps/order-menu-server/.env.local`, using
[`.env.example`](.env.example) as the template. CORS allows the configured Order Menu origin, which defaults to
`http://localhost:5166`. CORS does not authorize payments or orders. The Bridge
verifies the existing HttpOnly device cookie through
`ORDER_MENU_KIOSK_API_URL` (default `http://127.0.0.1:5168`) through the
read-only `/api/kiosk/identity` endpoint; verification does not enroll or
replace devices. A failed or
unavailable verification never permits a write.

Configure the browser's `VITE_ORDER_MENU_SERVER_URL` to the same-origin API
`/api/kiosk/pos` endpoint. This proxy accepts the existing `/api/kiosk` device
cookie and forwards only documented POS paths to `KIOSK_POS_BRIDGE_URL`
(default `http://127.0.0.1:5170/`). No provider or service secret is placed in
browser configuration. Use a trailing slash for a configured upstream base URL.
Catalog, seating snapshots and unexpired continuation capabilities remain
available without a registered device. New devices require a controlled
administrator enrollment flow; the old six-digit development registration is
available with its explicit flag outside production. The public-origin
restriction on that test flow was withdrawn at the operator's request.

## Simulator catalog

The development simulator normalizes the project-managed
[`周氏蝦捲菜單_v2.json`](../../周氏蝦捲菜單_v2.json) fixture. It exposes only items marked
available, keeps the source price and category, and uses each item's `symbol`
when no image URL is supplied. To keep the local menu visually usable while
the fixture has empty image fields, it adds clearly non-authoritative Unsplash
presentation images by food type; a future POS-provided `image` always wins.
It does not invent POS option groups, stock counts, or dietary claims that are
absent from the source data.

Declared `optionGroups` are preserved through the catalog boundary, but the
current seven-dish source deliberately declares no customization options.
紅燒牛肉麵 (alias 牛肉麵) costs NT$150 with no spice choices. 水餃 is a fixed
10-piece serving at NT$80; customers choose the number of servings, not pieces.
The option contract and configuration decision paths remain supported for later
POS declarations. Catalog source hashing includes prices and options; after
editing the fixture, restart the simulator/POS Bridge if its dev watcher has
not reloaded the JSON, then reload the menu/Kiosk for a fresh catalog/session.

The v2 fixture temporarily includes two manually maintained套餐 items so the
customer flow can be exercised before the POS publishes its own bundle data.
Replace those temporary records with the POS source once its menu API is ready.

## Contract

- `GET /v1/catalog` returns the normalized catalog snapshot.
- `POST /v1/payments` creates a supplier-neutral payment attempt for an exact
  amount and method (`card`, `mobile`, `linepay` or `jkopay`). `GET /v1/payments/:paymentId` returns
  its stable terminal result.
- `POST /v1/orders` accepts `{ idempotencyKey, cart }` and returns a submitted
  order with a receipt. The optional `customerPhone` is format-checked and
  exposed only as a masked label on the test continuation. The cart must include an authorized `paymentId` for the
  same server-verified total. The Bridge checks catalog options, quantities,
  item counts and prices, isolates payments/holds by verified Site and device,
  and prevents using one payment with multiple submission keys. Reusing a key
  with the same cart returns its original result; changing its cart is rejected.
- `POST /__simulator/mode` changes the simulator's next unseen order to
  `accepted`, `rejected`, or `uncertain`. It is development-only and is bound
  to loopback with the simulator.
- `POST /__simulator/payment-mode` changes the next simulated payment to
  `authorized`, `pending`, `rejected`, or `uncertain` without rewriting earlier
  payment results.

An `uncertain` receipt is intentionally retained under its idempotency key: a
real POS might already have received the order when a network timeout happens.
Do not retry it with a new key.

Concurrent submissions with the same key share one in-flight gateway operation
and receipt within this Bridge process. These caches are in-memory, not durable
across restarts or multiple instances; a production gateway must also enforce
the key at its persistent boundary.

Catalog items may supply `recommendationSignals` with a finite strategy
(`POPULAR`, `NEW_ARRIVAL`, `CHEF_SPECIAL`), positive integer `rank`, `source`
(`pos` or `merchant`), and `asOf`/`expiresAt` timestamps. Only currently valid
signals enable strategy choices. The development catalog does not invent them.

An `uncertain` payment is also locked instead of restarted. This prevents a
second charge while staff reconcile the original terminal transaction.

The cart includes the catalog `revision` that priced it. Before forwarding an
order, the Bridge compares that revision and each order-line price against the
latest catalog. A stale or changed item returns a reviewable rejection instead
of silently changing the customer's order.

## Portable order receipt

Accepted orders, for both dine-in and takeout, also receive `receiptAccess`.
This separate bearer capability opens the same read endpoint with `readOnly: true`,
the pickup number, meals, quantities, fulfillment choice and total. It omits the
phone label. Table binding and takeout mutation return 409 for these tokens.
Kiosk uses this capability for its completion QR even when the survey is disabled.
It expires after 30 minutes or Bridge restart; replay does not renew expired links.
Customers may screenshot the phone view. These tokens never enter chat/history
or the durable order-result archive; only the non-personal receipt does.

## Test order continuation

The development runner uses `tableAssignment: 'after-order'` in both Bridge and
simulator. A paid dine-in order may be accepted before a physical table is known.
Only accepted **test** dine-in receipts receive `{ continuation: { token,
expiresAt } }` alongside `order`; uncertain/rejected/live receipts receive none.
The same accepted receipt reuses its capability without extending the expiry.

- `GET /v1/continuations/:token` reads the customer-facing order snapshot.
  Its required `fulfillmentMode` is the current test fulfillment choice.
- `POST /v1/continuations/:token/table` accepts a scanned `tableCode`. The current
  fixture recognizes only `demo-a08`, binds A08 to `demo-destination-a08`, and
  rejects arbitrary labels. Repeating the same binding is idempotent.
- `POST /v1/continuations/:token/takeout` requires `{ confirmed: true }` and
  atomically sets the test continuation to pickup and removes its table. It
  works before or after binding, preserves the order ID/items/total/phone/expiry,
  and is idempotent. Further table-binding requests return 409. Missing consent
  returns 400; expired or unknown capabilities return 404.

Capabilities expire after 30 minutes, are stored in memory only, and return 404
on expiry or process restart. Expired receipt replays do not issue a new token.
These routes simulate order-to-table association; they do not authenticate a
member, issue invoices or dispatch robots. The browser confirmation precedes
the binding write; merely reading a table URL never binds an order. Pickup
changes update this test record only. The accepted POS receipt and payment are
immutable, and these routes never resubmit an order, charge again, or modify an
external POS. Receipt replay cannot revert pickup or restore its cleared table.

## Reservation-policy simulator

The simulator owns five tables (`T1`–`T5`), each with four seats. It atomically
claims free tables for the current party only; no future bookings are supported.

- `GET /v1/seating` returns table status and the inventory revision.
- `POST /v1/seating/holds` accepts `{ expectedRevision, partySize, tableIds,
  splitApproved }`. Party size is 1–20, the exact required number of tables must
  be chosen, and multi-table claims require explicit split consent. A stale
  revision or competing claim is rejected.
- `GET /v1/seating/holds/:id` checks one private bearer capability. Only a
  verified missing/expired hold returns 404; upstream unavailability returns 503
  and must not be interpreted as permission to release a payment lock.
- `DELETE /v1/seating/holds/:id` releases an unpaid hold idempotently; a
  payment-protected or occupied hold cannot be released by customer tools.

Unpaid holds expire after 600,000 ms. `POST /v1/payments` accepts a
`tableHoldId` for dine-in, atomically locks it, and binds it to the resulting
payment. Rejected terminal payments unlock to the original deadline, never
extend it. Pending, uncertain, or authorized payments retain their locks.
The dine-in order must carry that same hold and payment; an accepted receipt
marks the tables occupied. A pickup order cannot claim a dine-in hold.

Inventory is deliberately in-memory for this mock venue; restarting resets it,
including occupied seats. The loopback-only `GET /__simulator/seating` staff
screen submits `POST /__simulator/seating/depart` with `tableId` and
`expectedRevision`. Only an occupied table at that revision can depart;
unpaid holds and payment locks cannot be released this way. Split-party tables
can depart individually without rewriting the accepted order.
Real POS persistence and payment reconciliation are not implemented. Do not use it for live
customers or restart it to resolve a real unknown payment.

The catalog's required `store.fulfillmentModes` supplies supported mode IDs and
display labels. Order Menu renders these choices and the bridge rejects orders
using unsupported modes; there is no client-side capability fallback.

## Composition contract

Every catalog item includes a `composition` record:

```json
{
  "ingredients": ["chicken", "rice", "egg", "vegetables"],
  "complete": true,
  "source": "simulation",
  "revision": "simplified-demo-1",
  "removals": []
}
```

Store actual ingredients, not lists of absent ones. Ingredient IDs use the finite
vocabulary in `src/domain/composition.ts`. Specific `shrimp` / `fish` facts both
satisfy the broader `seafood` filter.
The seven-dish catalog records shrimp for shrimp rolls and fish for the fish
entrée. Broad seafood facts alone cannot establish absence of shrimp or fish;
subtype filters return unknown rather than claiming a safe match. Group exclusions
require removing every matching actual ingredient before offering customization.
Removal records contain ingredient IDs and an existing `groupId` / `valueId`;
they are suggestions, not automatically
applied changes. Composition changes must advance catalog revision too. The mock
source fixture includes composition in its content hash.

All seven current mock meals have complete **simplified-scenario** compositions
(primary ingredients, egg and vegetable sides; no sauces/broth decomposition).
They are labelled simulation, not restaurant-certified recipes. Real deployment
must provide merchant-confirmed facts; changing scope or recipes uses these same
fields. Ingredient exclusion is not an allergy-safety guarantee.

An optional positive `dietaryLabels: ['vegetarian']` declaration represents a
merchant-confirmed dietary classification, not a list of absent ingredients.
The parser rejects unsupported labels and vegetarian declarations contradicted
by listed meat. None of the current seven meat/seafood meals carries this label.
Missing labels cannot be treated as confirmed dietary suitability.

## Production boundary

Customer receipt messages describe the accepted/rejected/uncertain outcome
without deployment labels. The original `environment` field and staff-only
diagnostic screens retain environment information; no live status is fabricated.

The simulator is not a production POS dependency. A future vendor adapter
implements the `PosGateway` port and is selected by deployment configuration;
it must preserve the catalog and submission receipt contracts documented here.

## Deployment boundary

The current executable still starts a test simulator. Its resource ownership,
receipts and replay protection are process-local. Restarting it discards those
records, so restart only with no active checkout. An unresolved browser order
must remain blocked for reconciliation after a restart. Persistent transaction
ownership, provider-confirmed payment results, currency validation and durable
idempotency are required before connecting live payments. This simulator's
`authorized` response does not confirm a real charge.
