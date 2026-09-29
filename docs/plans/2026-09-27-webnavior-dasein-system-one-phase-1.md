# Webnavior Kiosk System One — Current Delivery Record

## Status and boundary

The Kiosk implementation is integrated but is not a production acceptance
record. The active Dasein or lookski/openjev profile answers a bounded semantic
choice; it never sees or chooses `menu_*`, `cart_*`, or `checkout_*` WebMCP tools.
There is no old direct-tool candidate path, Speech Guard, or automatic switch
between System One implementations.

The application owns the menu/POS catalog, selected item, cart and checkout
snapshots, payment status, domain references, revisions, clarification and
confirmation records, operation compilation, authorization, and execution.
System One only selects a currently offered semantic intent, or a finite
target choice when application-side reference resolution cannot decide.

```text
final ASR or simulated transcript
  → Order Menu derives phase, real references, constraints, and a small intent set
  → Server sends phase and that bounded choice to the active System One profile
  → Order Menu resolves target and slots against its issued snapshot
  → ambiguity: one revision-bound clarification from real refs
  → resolved plan: deterministic WebMCP compilation and phase-aware authorization
  → executor invokes only the authorized operation
```

`IGNORE` is silent; `INCOMPLETE` retains diagnostics for at most three seconds
without concatenating ASR strings. `NEEDS_ASSISTANT`, unavailable decisions,
and safely unresolved operations automatically send the original transcript
to Main Agent. A failed clarification asks the customer to use touch; it does
not silently invent a target or automatically escalate.
`MULTI_ACTION` keeps two or more independent requests together for Main Agent
instead of executing only the first. A two-question Jev probe worked but took
about 130 seconds at the configured endpoint, so it is not a per-turn dependency.

## Context shaping and reference resolution

`deriveDecisionContext` produces at most one candidate per eligible intent,
plus finite checkout method or fulfillment choices. It does not expand the
catalog into item × intent candidates. The Server rejects an over-budget set
instead of sorting candidates by transcript similarity or silently truncating.
Checkout payment selection explicitly supplies `checkout_payment_select`,
payment state, and allowed card/mobile methods. Pending or uncertain payment
offers no payment mutation.

The Order Menu resolves full names, merchant-provided aliases, unique catalog
name suffixes of at least three characters, categories, selected items, cart
lines, quantities, known option labels, and supported dietary constraints.
The reference list sent to System One uses per-turn ordinal IDs such as
`ITEM_1` and `CART_LINE_1`; actual catalog and cart IDs stay in the issued
application context and never appear in the model request.
An exact item or distinctive item suffix takes precedence over a broader
category such as 「便當」. A known exclusion such as 「不要豬肉」 remains a
constraint; if the catalog has no authoritative `pork-free` recommendation
tag, the request goes to Main Agent instead of claiming a safe recommendation.
The POS simulator fixture supplies the alias 「招牌便當」, and catalog aliases
also pass through the POS Bridge contract.

`resolveIntent` validates the chosen intent against actual target refs,
required slots, and phase. A complete utterance with multiple eligible
targets keeps the original intent in a 15-second, one-round clarification
session bound to its candidate refs and relevant revisions. A uniquely spoken
ordinal such as 「第二筆」 is resolved by application code within those refs;
otherwise System One gets one target-only finite choice. Stale or unresolved
clarification cannot execute and falls back to touch.

The compiler alone maps a domain plan to WebMCP. `authorize` checks relevant
cart, selected-item, menu, and checkout revisions, target existence, slots,
phase, pending payment, and confirmation requirements. Catalog changes
invalidate item plans; unrelated selected-item changes do not invalidate a
cart-only plan. The order machine increments its domain revisions on every
successful write; the checkout owner synchronously increments its revision on
checkout or payment changes. Thus an edit followed by an undo still invalidates
an older plan. No stale plan is silently recompiled.
After an add, Order Menu retains the latest real cart line as a session referent
for 「再一份」. A different selected draft triggers clarification; an explicitly
spoken quantity overrides the draft quantity instead of copying it.

## Sensitive actions and trace

Cart clear, tax-ID confirmation, and payment selection use a one-use record
containing the concrete action and slots, an ID, timestamps, expiry, and
relevant revisions. Checkout cancellation requires confirmation only after
carrier/tax/payment details exist; it is blocked during pending or uncertain
payment. The confirmation is consumed before the executor starts. Physical
payment outcome and POS submission remain authoritative outside System One.
Main Agent WebMCP mutations also pass through application-owned phase, target,
revision, payment, and confirmation checks. Model-supplied
`confirmedByUser: true` cannot directly perform high-risk actions. Multiple
cart lines for one item require a revision-bound clarification before Main
Agent deletion, quantity edit, or option edit. Idle payment selection also
offers checkout cancellation, subject to confirmation.

For state-changing choices with a reported System One confidence below 0.5,
the Server retains the raw model answer in the trace but routes to Main Agent
instead of mutating the order. This is a common conservative guard, not a
phrase-specific rule. Qwen3.5-4B's raw `ADD_ITEM` choice for
「我想要吃招牌便當」 was semantically correct, but its 0.392 confidence still
escalated that turn. Low confidence is not evidence that the intent was wrong.

Successful Fast Path turns enter the same anonymous session as customer and
assistant text plus compact real menu/cart results. Main Agent receives the
latest bounded conversation and can page older text on demand with the
read-only, device-authenticated `kiosk_session_history` tool. System One never
receives that history or tool; an old cart mention is not current cart state.

The simulated-ASR panel has an expandable per-turn trace with the browser
snapshot, phase, references, candidates, System One state and raw answer
(including confidence/probabilities if supplied), resolution, operation plan,
and authorization. The customer-facing interface does not expose tool names to
System One. The optional live replay test sends the eight agreed phrases to a
configured `/v1/systemone` endpoint only when
`KIOSK_SYSTEM_ONE_REPLAY_URL` is set. The bento case now has the correct
`ADD_ITEM` semantic gold label, with low-confidence escalation evaluated
separately. The corrected eight-case replay passed against the configured
Jev service on 2026-09-29; the earlier pass with the wrong label is not used
as acceptance evidence. Store-specific prompt overrides, real
multi-action routing latency, and full device/POS operation still need
operator-side integration testing before deployment.
