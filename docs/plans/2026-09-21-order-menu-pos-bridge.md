# Order Menu POS Bridge plan

## Objective

Prepare the ordering flow for a real POS before vendor credentials are available. The same customer flow must work against a controlled local simulator during development and a vendor adapter later, without making the AI claim that a test, failed, or ambiguous submission reached the POS.

## Decisions recorded

- `apps/order-menu` remains the customer-facing menu and native WebMCP implementation. `menu_get` stays the source of menu data for the AI, but its source will become the POS Bridge rather than the current in-memory menu.
- Add a separate `apps/order-menu-server` service for the POS Bridge. It owns POS-facing network calls, credentials, idempotency, request timeouts, audit-safe order receipts, and vendor-specific adapters. `apps/server` remains the Webnavior/Kiosk identity and AI-management server; it does not gain a restaurant-vendor adapter.
- Start with a controlled POS simulator and a stable bridge contract. The simulator is a development/test adapter or fixture, not a second production dependency.
- The customer UI and WebMCP consume normalized menu data and submission receipts only. They do not receive POS credentials or vendor response shapes.
- Do not represent a completed submission as `simulated`. A result is expressed by independent environment and outcome fields so test execution cannot be mistaken for a production failure, or vice versa.

## Target boundary

```text
Kiosk / LLM
    │ native WebMCP
    ▼
apps/order-menu (customer UI, cart, confirmation)
    │ authenticated local service contract
    ▼
apps/order-menu-server (POS Bridge)
    ├── normalized menu catalog query
    ├── normalized order submission + idempotency
    └── vendor adapter selected by deployment configuration
            ├── POS simulator (development / automated tests)
            └── real POS adapter (after vendor API is available)
```

The menu and prices displayed to a customer are snapshots returned by the Bridge. At confirmation, the Bridge validates the order against the current POS state again. A stale price, unavailable item, or changed option is rejected with a customer-safe reason and requires review rather than silently submitting a changed order.

## Normalized contracts

The first implementation should make these two operations the only public POS-facing boundary.

### Catalog query

The Bridge returns normalized categories, items, prices, option groups, and `availability`. Inventory counts are optional: a POS adapter must omit them if they cannot be kept accurate. `apps/order-menu` maps that response into its existing menu domain model before exposing it through `menu_get` and `menu_recommend`.

### Order submission

The UI submits a finalized immutable order snapshot plus an idempotency key generated before the first attempt. The Bridge returns a receipt shaped around the customer-facing truth:

```ts
interface SubmissionReceipt {
  environment: 'test' | 'live'
  status: 'accepted' | 'rejected' | 'uncertain'
  posOrderId?: string
  customerMessage: string
  retryable: boolean
}
```

- `accepted` + `live`: the POS has acknowledged the order. The deterministic customer confirmation may state that it was sent to the store/POS.
- `accepted` + `test`: the simulator accepted it. The deterministic customer confirmation explicitly calls it a test order and never says it reached a real POS.
- `rejected`: the POS or pre-submit validation declined it. Keep the cart recoverable and ask the customer to review the displayed problem.
- `uncertain`: a timeout or network failure occurred after submission may have started. Do not retry with a new idempotency key and do not say the order failed or succeeded. Re-query or reconcile using the same key before resolving the customer flow.

The server, not the LLM, owns `customerMessage` and final completion state. The LLM may introduce or paraphrase a successful result only after receiving the structured receipt; it must not invent a POS outcome. This removes the current prompt-driven “模擬訂單” wording instead of merely suppressing it.

## Delivery phases

### 1. Make the current order domain truthful

1. Replace `SubmittedOrder.status: 'simulated'` with the receipt model above.
2. Make `order_confirm` return that receipt and derive its visible confirmation from it.
3. Update RMAP as a versioned extension or v0.2: `order_confirm` returns a submission receipt, and a completed test submission is not described as POS submission.
4. Add regression tests covering the wording and terminal state for every receipt combination.

Acceptance: no production code path can label an accepted live order as simulated, or claim a rejected/uncertain one was sent.

### 2. Define and exercise the POS Bridge contract

Status: partially implemented on 2026-09-21. `apps/order-menu-server` now
provides the loopback Bridge, an idempotent submission contract, and the
controllable simulator. Moving the customer menu catalog itself to the Bridge
is phase 3 work.

1. Create `apps/order-menu-server` with a narrow HTTP contract for catalog retrieval and order submission.
2. Move the existing in-memory menu into a test fixture behind the Bridge, rather than retaining it as a silent fallback inside the order machine.
3. Add a development-only POS simulator adapter with controllable scenarios: accepted, item unavailable, price changed, validation rejected, timeout before submission, timeout after possible submission, and duplicate idempotency key.
4. Ensure order-menu has an explicit configured Bridge URL in local development. Missing configuration displays a clear integration error; it must not silently submit a demo order.

Acceptance: a local developer can run the simulator and reproduce every POS outcome without external hardware or network access.

### 3. Integrate the customer flow

Status: implemented on 2026-09-21 for the local simulator path. The Order Menu
loads its catalog from the Bridge, exposes only that loaded snapshot to UI and
WebMCP, carries its revision with the cart, and receives deterministic receipt
states. The Bridge rejects stale revisions or changed line prices before it
forwards the order. The local simulator normalizes the repository's
`周氏蝦捲菜單_v2.json` fixture; it is an input fixture, not a POS vendor adapter.

1. Fetch and refresh the catalog through the Bridge; do not hard-code sellable items, prices, or availability in WebMCP.
2. Preserve each cart's catalog revision or pricing snapshot and perform a final server validation at confirmation.
3. Render deterministic submission results in the menu UI and send the same structured result to the host/LLM.
4. Give uncertain orders a reconciliation screen/state rather than reopening the cart or allowing a blind second submission.

Acceptance: WebMCP still exposes the same ordering operations, while the underlying catalog can be exchanged from the simulator to a real POS adapter.

### 4. Add the real POS adapter

After the POS vendor supplies API documentation and a sandbox, implement one adapter below the existing Bridge contract. It must map vendor menu identifiers, option constraints, service modes, tax/price semantics, submission acknowledgement, lookup-by-idempotency, and error codes. No vendor types cross into `apps/order-menu` or the WebMCP protocol.

Acceptance: the same contract suite used by the simulator passes against the vendor sandbox, with vendor-specific integration tests guarded by explicit environment configuration.

## Test strategy

- Unit-test the order machine against receipt outcomes; tests assert the customer-visible state and phrase, not only internal flags.
- Contract-test every Bridge adapter with the same catalog and submission cases.
- Test idempotency end-to-end: repeated calls with the same key resolve to the original receipt and never create a second order.
- Add integration tests for timeout boundaries. In particular, distinguish “request never sent” from “result unknown after sending”.
- Add browser/WebMCP tests ensuring `menu_get` returns Bridge data and `order_confirm` cannot complete an order when the receipt is rejected or uncertain.

## Deployment and operational policy

- POS endpoint, credentials, environment, timeouts, and adapter selection exist only in `order-menu-server` configuration. Use development-specific local configuration for the simulator and deployment-managed secrets for live POS.
- Treat POS connectivity as an operational dependency: expose health/readiness for catalog access and submission, but do not reveal credentials or vendor internals to the customer UI.
- Log correlation identifiers, receipt environment/status, and adapter error category. Do not log payment data or raw credentials.
- Start with ordering only. Payment, cancellation, refund, loyalty, and exact inventory reservation remain outside this plan unless the selected POS makes one of them mandatory for submission.

## Decisions required before phase 4

1. POS vendor, API documentation, sandbox access, authentication method, and its supported idempotency/lookup mechanism.
2. Whether orders are sent at customer confirmation or after payment, and which system owns payment.
3. Whether the POS can provide availability only or reliable stock counts, and how frequently the catalog must refresh.
4. Store network topology: cloud API, local LAN device, VPN/proxy, and offline behaviour.
5. Vendor rules for order modification, cancellation, tax, service fees, and dine-in/takeout mapping.

Until these choices are known, phases 1–3 provide the complete integration harness without guessing a vendor protocol.
