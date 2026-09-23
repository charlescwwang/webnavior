# Restaurant Menu Agent Protocol (RMAP) v0.2 — Checkout Draft

## Status and compatibility

RMAP v0.2 is the current AIRI internal contract for customer-visible restaurant
ordering. It supersedes v0.1's direct `order_confirm` operation: confirming the
cart now starts checkout, while only a verified payment result may submit the
order to POS. This is still an internal draft, not an external industry standard.

The menu and cart tools from v0.1 remain unchanged except that
`order_set_fulfillment` must precede `checkout_start` and `order_confirm` is no
longer exposed.

## Checkout tools

| Tool | Input | Effect |
| --- | --- | --- |
| `checkout_start` | `confirmedByUser: true` | Opens membership scanning after explicit semantic agreement to the reviewed cart. |
| `checkout_skip_membership` | `confirmedByUser: true` | Skips membership only when the customer asks to do so. |
| `checkout_choose_invoice` | `method: 'carrier' \| 'donation'` | Uses an already scanned carrier or selects donation. |
| `checkout_request_tax_id` | None | Opens tax-ID entry. |
| `checkout_set_tax_id` | Exact eight-digit `taxId` | Displays the spoken tax ID without confirming it. |
| `checkout_confirm_tax_id` | `confirmedByUser: true` | Confirms the displayed tax ID after the customer says it is correct. |
| `checkout_select_payment` | `method: 'card' \| 'mobile'` | Starts the selected physical payment-terminal flow. |
| `checkout_cancel` | `confirmedByUser: true` | Leaves checkout and keeps the cart when no payment is pending or uncertain. |

`confirmedByUser` records semantic consent. The customer's words do not need to
match a fixed phrase, but the Agent must not infer consent from silence.

## Physical-action boundary

RMAP v0.2 deliberately has no tools for:

- claiming that a membership or invoice barcode was scanned;
- fabricating or changing a terminal payment result;
- marking a card or mobile payment as authorized;
- directly submitting an unpaid cart to POS.

The customer presents physical barcodes and completes payment. Device adapters
report those results outside the Agent tool surface. After an authorized payment,
the menu binds the transaction to the exact cart total and automatically submits
the order through its POS Bridge.

## Timeouts and safety

- Membership timeout skips membership.
- Invoice timeout uses an already confirmed carrier; otherwise it selects donation.
- Tax-ID timeout abandons the draft and selects donation.
- Payment-method timeout returns to order review with the cart intact.
- Terminal timeout returns to payment-method selection.
- An uncertain payment or order result locks the flow for staff reconciliation.
  The Agent must not retry payment, clear the cart, or start a new order.

`cart_clear` remains the operation for semantic requests such as “重新開始”,
“不要這筆”, or “換一輪”. Before clearing, the implementation must reject the
operation if a payment is pending or uncertain. `checkout_cancel` is narrower:
it exits checkout but preserves the order draft.

## Visible-operation requirement

All Agent mutations must update the same state rendered by customer controls.
In particular, a tax ID set by the Agent must appear in full on screen before it
can be confirmed. Tool-only shadow checkout state is not conformant.
