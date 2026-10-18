# Restaurant Menu Agent Protocol (RMAP) v0.2 — Checkout Draft

## Status and compatibility

RMAP v0.2 is the current AIRI internal contract for customer-visible restaurant
ordering. It supersedes v0.1's direct `order_confirm` operation: confirming the
cart now starts checkout, while only a verified payment result may submit the
order to POS. This is still an internal draft, not an external industry standard.

The menu and cart tools from v0.1 remain unchanged except that
`order_set_fulfillment` must precede `checkout_start` and `order_confirm` is no
longer exposed.

## Meal clarification

The owned menu also exposes the host-only `kiosk_fast_path_clarify(questionId)`.
A browser-issued proposal can establish one `confirm-meal` question in the
`meal_confirmation` phase. It is not available to the conversational Agent.
YES/NO decisions map to its exact legal answer IDs; an affirmative only resolves
the proposed item and resumes slot collection. All answers are single-use,
revision-bound and expire after 30 seconds. Read queries and other verified
requests revoke this confirmation without discarding suspended meal drafts.
This authority is separate from checkout/payment confirmation.

The same phase may offer `inquire-meal:<questionId>` for an availability query
whose omitted subject is this exact dish. Jev sees the short semantic `READ`
choice; the server maps it back to the browser-issued ID and verifies the
recipient separately. The browser checks the live question ID and revisions,
consumes the proposal and returns `menu_get.itemStatuses` with `available`,
`sold-out` or `unknown`. This is page operability evidence, without inventory
counts or purchase authority. A different dish/category or requested condition
cannot inherit this shortcut's subject. Ordinary YES/NO retains one model call.

During item configuration, `configure:<questionId>:inquiry` means the customer
corrects a mistaken purchase into an availability question. It consumes the
current ticket, drops only that unadded draft and reads its real item. Existing
cart lines remain untouched; the disowned quantity question cannot resume.
Plain cancellation is the separate `:cancel` answer. Jev sees the utterance
separately from clerk wording and uses short, mutually exclusive outcomes.

A `MENU_QUERY` Agent handoff, or another ordering handoff with current-utterance
product/category evidence, carries `requireMenuRead` to the conversational
boundary. Cart history alone cannot activate this guard; phone entry retains its
explicit factual-query prerequisite. Its initial tool choice requires a fresh menu read, and no-tool prose
cannot become a customer food claim. `menu_get.verifyClaim:true` checks specific
`query`/`queries` and returns an explicit correction for nonexistent names, or
the actual availability for existing ones. It never substitutes another dish.

Ordinary ADD/REMOVE/quantity/option proposals verify purchase/change authority
and whole-request coverage, including before the first meal draft. Literal
inquiry/operation classification is separate from single-effect coverage, so
the proposed effect does not imply purchase consent. Uncertain purpose grants
no authority; the original route and whole-effect checks must independently pass
to execute. A weak route may only hand off after coverage/recipient verification. A verified pure inquiry rejoins the existing search/filter path, retaining price and dietary
requirements. Matching a dish or having only one result never authorizes buying
it. This finite check neither plans arbitrary actions nor consumes an unrelated
fulfillment question; uncertain recipient/meaning leaves the order intact.
Reads separately qualify the recipient against the literal utterance; filter and
price questions retain their typed evidence and contextual state. An already validated
question answer or recovered query does not repeat recipient qualification.
A weak broad route can independently qualify a pure menu inquiry after its
recipient is verified. Unmatched named subjects must reach a literal lookup,
not category/general recommendations. These inquiries and unresolved filter or
price handoffs use `decisionState.readOnly`, retained on each inquiry-task
continuation. The host binds it to `kiosk_agent_task`; browser execution forbids
order/fulfillment/question changes even after a successful menu read. A fresh
customer task owns new authority. This does not promote a weak purchase route.
Failed named Agent lookups latch unresolved-target state for that host task:
reads/clarification remain legal, but order edits cannot execute a partial request
until a new customer task begins. Only the task that owned the read may latch it.

## Checkout tools

Before ordering, the owned kiosk offers an optional phone-entry screen.
`customer_skip_phone` (`confirmedByUser: true`) handles explicit touch/voice
skips and changes `customer_entry` to `ordering` without inventing identity.
Jev receives that visible phase and its single skip candidate; the gate permits
its application-owned explanation question while meal writes remain unavailable.
Main Agent may read/present the menu and recommendations during entry. These
reads preserve the entry phase and cannot imply phone-skip consent.
Both filling and skipping the phone permit the normal checkout below.
Kiosk owns its dialog and mask outside the iframe, scoped to the ordering
region so upper host controls remain interactive. A light mask keeps the
catalog visible but inert. The old full-page entry is removed; standalone Menu
opens the catalog directly. Host-only `kiosk_customer_entry_start()` offers entry
once before a fresh order, never after a phone choice or cart activity. Host-only `kiosk_customer_phone(phone)` accepts only touch-entered
10-digit numbers while entry is pending, never echoes identity and is excluded
from Agent tools. Both touch and voice skip use `customer_skip_phone`.

| Tool | Input | Effect |
| --- | --- | --- |
| `checkout_start` | `confirmedByUser: true` | Starts the configured checkout stage after agreement to the reviewed cart; the current kiosk collects phone at entry and starts with invoice. |
| `checkout_skip_membership` | `confirmedByUser: true` | Skips membership only when the customer asks to do so. |
| `checkout_choose_invoice` | `method: 'carrier' \| 'citizen' \| 'donation'` | Carrier methods require their identifiers. Donation explicitly skips personal invoice input and advances to payment selection without a donation code; it does not pay or issue an invoice. |
| `checkout_request_tax_id` | None | Opens tax-ID entry. |
| `checkout_set_tax_id` | Exact eight-digit `taxId` | Displays the spoken tax ID without confirming it. |
| `checkout_confirm_tax_id` | `confirmedByUser: true` | Confirms the displayed tax ID after the customer says it is correct. |
| `checkout_select_payment` | `method` from the deployed enum | Selects a method; `status: selected` does not start payment. Current test choices are `linepay` and `jkopay`. |
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

An accepted paid order immediately emits the host lifecycle completion event;
carrying away its QR is not an additional completion gate. The host applies its
existing reward/survey settings and can show a separate order-continuation QR and
desktop link. That HTTP(S) bearer URL is transient completion UI state, outside
the archivable non-personal order result and the static survey URL.

After a membership scan, the adapter provides a customer-facing membership
number rather than the raw barcode payload. The invoice-confirmation screen keeps
that number visible so the customer can verify which membership was recognized.
An inherited invoice carrier remains a separate value and is displayed in full
for confirmation.

## Timeouts and safety

- The current kiosk collects phone before ordering and has no checkout membership timeout.
- Invoice and tax-ID inactivity preserve the draft; they never choose donation.
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

## Checkout dialogue and post-order tables

Checkout model context contains the current utterance, structured browser state,
compact cart evidence and the tool call/results needed for that turn. Earlier
ordering dialogue stays in the durable history, not the checkout prompt.

Questions addressed to the assistant about its identity, name or capabilities
are common service interactions, not merchant-specific settings. Background
conversation remains ignored. In a pending confirmation they route as a new
request, revoking the exact former confirmation while retaining checkout.

The host may mark a plain Main Agent reply with `interruptsQuestion: true` on
`kiosk_dialogue_presented`. Without a new valid question receipt, the menu clears
old answer/execution tickets. A following acknowledgement cannot reuse them.
This field is host-only; deploy the host and owned menu together.

The current test selects no physical table before checkout. After an accepted
dine-in order, the customer carries an expiring continuation capability to the
phone and confirms a scanned table code. The QR and desktop link share one URL;
phone and kiosk offer no table picker. This is a test continuation protocol,
not a third-party POS adapter or a real robot dispatch contract.
