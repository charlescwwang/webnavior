# Order Menu POS Bridge

`@proj-airi/order-menu-server` is the local server boundary between the
customer-facing Order Menu and a POS provider. It owns normalized catalog and
order-submission HTTP contracts; the customer UI and WebMCP never receive POS
credentials or vendor response shapes.

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
[`.env.example`](.env.example) as the template. The Bridge allows only the
configured Order Menu origin, which defaults to `http://localhost:5166`.

## Simulator catalog

The development simulator normalizes the project-managed
[`周氏蝦捲菜單_v2.json`](../../周氏蝦捲菜單_v2.json) fixture. It exposes only items marked
available, keeps the source price and category, and uses each item's `symbol`
when no image URL is supplied. To keep the local menu visually usable while
the fixture has empty image fields, it adds clearly non-authoritative Unsplash
presentation images by food type; a future POS-provided `image` always wins.
It does not invent POS option groups, stock counts, or dietary claims that are
absent from the source data.

The v2 fixture temporarily includes two manually maintained套餐 items so the
customer flow can be exercised before the POS publishes its own bundle data.
Replace those temporary records with the POS source once its menu API is ready.

## Contract

- `GET /v1/catalog` returns the normalized catalog snapshot.
- `POST /v1/payments` creates a supplier-neutral payment attempt for an exact
  amount and method (`card` or `mobile`). `GET /v1/payments/:paymentId` returns
  its stable terminal result.
- `POST /v1/orders` accepts `{ idempotencyKey, cart }` and returns a submitted
  order with a receipt. The cart must include an authorized `paymentId` for the
  same total; reusing a key returns the original result.
- `POST /__simulator/mode` changes the simulator's next unseen order to
  `accepted`, `rejected`, or `uncertain`. It is development-only and is bound
  to loopback with the simulator.
- `POST /__simulator/payment-mode` changes the next simulated payment to
  `authorized`, `pending`, `rejected`, or `uncertain` without rewriting earlier
  payment results.

An `uncertain` receipt is intentionally retained under its idempotency key: a
real POS might already have received the order when a network timeout happens.
Do not retry it with a new key.

An `uncertain` payment is also locked instead of restarted. This prevents a
second charge while staff reconcile the original terminal transaction.

The cart includes the catalog `revision` that priced it. Before forwarding an
order, the Bridge compares that revision and each order-line price against the
latest catalog. A stale or changed item returns a reviewable rejection instead
of silently changing the customer's order.

## Production boundary

The simulator is not a production POS dependency. A future vendor adapter
implements the `PosGateway` port and is selected by deployment configuration;
it must preserve the catalog and submission receipt contracts documented here.
