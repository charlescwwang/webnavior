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
final ASR or simulated transcript → bounded utterance queue
  → Order Menu derives phase, real references, constraints, and a small intent set
  → Server sends phase and that bounded choice to the active System One profile
  → Order Menu resolves target and slots against its issued snapshot
  → ambiguity: one revision-bound clarification from real refs
  → resolved plan: deterministic WebMCP compilation and phase-aware authorization
  → executor invokes only the authorized operation
```

`IGNORE` is silent; `INCOMPLETE` retains diagnostics for at most three seconds
without concatenating ASR strings. Only a positive `NEEDS_ASSISTANT` decision
or a related follow-up to an active Agent request sends the original transcript
to Main Agent. `UNAVAILABLE` fails closed because ambient speech has not been
classified. A failed clarification asks the customer to use touch; it does
not silently invent a target or automatically escalate.
Initial `NEEDS_ASSISTANT`, `MULTI_ACTION`, and `FOLLOW_UP_ACTIVE` routes require
finite confidence in [0.6, 1]; missing or weaker scores return `UNAVAILABLE`
without replacing questions or entering Main Agent. This admission check does
not apply to review of an already-admitted read result. An application-owned
service-scope rule follows editable/store instructions and also applies to active
question routes: unrelated discussion, even questions or unfinished clauses,
is `IGNORE`, not an open-ended assistant request. No extra classifier call or
menu-word requirement is introduced; model accuracy still needs live evaluation.
`MULTI_ACTION` keeps two or more independent ordering-service requests together
for Main Agent instead of executing only the first. Active operational questions now use at
most three bounded calls: task/background and answer/new request are independent
questions batched in one exchange, followed by the semantic choice. Relation
observations do not remove state-valid new actions. New requests shed the old
question's authority; uncertain speech can
only postpone an ordinary question. Payment authorization is never inferred
from this postponement path. Provider latency is measured by guarded live replay,
not treated as a guaranteed response time.

## Context shaping and reference resolution

Food conditions now use actual POS composition, not absent-ingredient tags.
Application extracts only mentioned finite ingredient references; Jev selects
EXCLUDE/INCLUDE/NONE alongside route in one request. Search/recommendation share
deterministic intersection and disclose simulation/customization/unknown facts.
No ingredient condition is attached to cart removal or automatically applied
as customization. A read continuation keeps its original conditions; a fresh
utterance resolves conditions again. Four live ingredient replays passed using
the current seven-dish complete simplified simulation. Merchant-confirmed data
replaces these facts without changing this flow; this is not allergy assurance.

`deriveDecisionContext` produces at most one candidate per eligible intent,
plus finite checkout method or fulfillment choices. It does not expand the
catalog into item × intent candidates. The Server rejects an over-budget set
instead of sorting candidates by transcript similarity or silently truncating.
Checkout payment selection explicitly supplies `checkout_payment_select`,
payment state, and allowed card/mobile methods. Pending or uncertain payment
offers no payment mutation.

The Order Menu resolves full names, merchant-provided aliases, categories, selected items, cart
lines, quantities, known option labels, and supported dietary constraints.
Inferred name suffixes are possible discovery matches, not merchant aliases or
mutation authority. Bounded `catalogEvidence` supplies matched text and
name/alias/fragment provenance, plus category membership counts. Category-only
preferences browse even a singleton category; explicit serving quantity retains
the ordering candidate (including 「我想吃麵，一碗」).
The reference list sent to System One uses per-turn ordinal IDs such as
`ITEM_1` and `CART_LINE_1`; actual catalog and cart IDs stay in the issued
application context and never appear in the model request.
An exact item name or merchant alias takes precedence over a broader
category such as 「便當」. A known exclusion such as 「不要豬肉」 remains a
constraint; if the catalog has no authoritative `pork-free` recommendation
tag, the request goes to Main Agent instead of claiming a safe recommendation.
The POS simulator fixture supplies the alias 「招牌便當」, and catalog aliases
also pass through the POS Bridge contract.

`resolveIntent` validates the chosen intent against actual target refs,
required slots, and phase. A complete utterance with multiple eligible
targets keeps the original intent in a 15-second, one-round clarification
session bound to its candidate refs and relevant revisions. A uniquely spoken
bare ordinal such as 「第二筆」 is resolved by application code within those refs;
the same words embedded in a query cannot select a target. Otherwise System One
first establishes answer/new-request relation against the actual question, then
chooses a target. Clarification displays eligible menu targets without selecting
or ordering one and asks 「您指的是…？」. A relation-qualified new request
gets one host-only reroute correlated to the same utterance/question ticket.
Queries preserve the unadded meal; verified replacement meals inherit no old slots.
This remains within the existing question budget and adds no Agent-facing tool.
Stale or unresolved
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
the Server retains the raw model answer in the trace but returns `UNAVAILABLE`
instead of mutating the order or forwarding unclassified ambient speech. This is a
confidence policy, not a phrase-specific rule. Qwen3.5-4B's raw `ADD_ITEM` choice for
「我想要吃招牌便當」 was semantically correct, but its 0.392 confidence still
left that turn unexecuted. Low confidence is not evidence that the intent was wrong.

Successful Fast Path turns enter the same anonymous session as customer and
assistant text plus complete real tool calls/results. Main Agent receives the
latest bounded conversation and can page older text on demand with the
read-only, device-authenticated `kiosk_session_history` tool. System One receives
only up to 12 role-labelled completed turns / 4,000 characters from this active
session, not that history tool or permanent archives. Old dialogue never
overrides current cart state. Context-dependent mutations and incomplete answers
can use one additional bounded speech check; a confidently identified request
with an uncertain operation escalates to Main Agent without executing it.

Native browser WebMCP host-only context and state tools use the host invocation
path; Agent-facing tools use the Agent invocation path. Both real ASR and the
simulated-ASR input enter the same queue. New utterances can be captured while
ASR or Agent work continues. Jev first classifies each utterance; `IGNORE` does
not interrupt speech or Agent work. A related utterance can stop a still-thinking
Agent and start a new Agent turn with both customer utterances retained in the
same visitor session. A requested browser tool makes that Agent turn
non-interruptible until its full tool/result loop settles; subsequent speech
waits and is re-evaluated from current state, including checkout/payment state.
The queue reserves a place when each recording finishes, so slower ASR for an
earlier sentence cannot let a later sentence overtake it. It is bounded and
reports overload instead of silently dropping speech.

The simulated-ASR panel has an expandable per-turn trace with the browser
snapshot, phase, references, candidates, System One state and raw answer
(including confidence/probabilities if supplied), resolution, operation plan,
and authorization. An opt-in, larger decision inspector presents the last 20
utterances as structured phase, reference, candidate, decision, operation, and
authorization rows without showing raw checkout identifiers. The customer-facing
interface does not expose tool names to System One. The optional live replay test sends the eight agreed phrases to a
configured `/v1/systemone` endpoint only when
`KIOSK_SYSTEM_ONE_REPLAY_URL` is set. The bento case now has the correct
`ADD_ITEM` semantic gold label, with low-confidence escalation evaluated
separately. The corrected eight-case replay passed against the configured
Jev service on 2026-09-29; the earlier pass with the wrong label is not used
as acceptance evidence. Store-specific prompt overrides, real
multi-action routing latency, and full device/POS operation still need
operator-side integration testing before deployment.
