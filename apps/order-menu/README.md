# Order menu service

`@proj-airi/order-menu` is a standalone Vue web service for browsing a menu and
building an order. It deliberately does not import AIRI UI, avatar, Electron,
Pinia, speech, or model packages.

On a portrait kiosk, menu browsing stays focused on the available dishes. A
compact order summary remains fixed at the bottom, aligned with the dish-card
column so the category column leaves room for the kiosk’s lower-left new-session
action. On narrow screens with horizontal categories, the summary sits above a
reserved bottom row for that action. Selecting the summary opens a dedicated
order-review screen where customers can inspect customizations, edit
quantities, remove items, choose dine-in or take-out, and explicitly advance to
checkout. Checkout asks the customer to scan or skip membership, confirm the
cloud-invoice choice, and then use the physical payment terminal. An authorized
payment is bound to the exact cart total and automatically submitted to the POS;
a rejected payment can be retried, while an uncertain result locks the order to
avoid a duplicate charge. Temporary product comparison is kept in the content
area so it never replaces the committed-order summary.

## Run locally

Semantic target resolution tracks reference provenance (current utterance,
qualified continuation, category, presentation, selection and cart). Named items
and categories qualify mutation targets before historical focus can be used.
A category purchase resolves only to real available dishes in that category;
multiple dishes produce a revision-bound clarification, not an arbitrary choice.
Category-only preferences such as 「我想吃麵」 or 「我突然想吃便當」 browse
the category, even when it has one available dish. A stated serving quantity
such as 「我要吃麵，一碗」 or 「我想吃麵，一碗」 retains an ADD_ITEM candidate;
Jev still decides whether the sentence is ordering or querying. Named dishes and
merchant aliases can start an order without quantity and ask for missing slots.
Clarifications display their eligible dishes via the existing query presentation,
without selecting a first dish or changing the cart; wording is 「您指的是…？」.
Verified composition filters also qualify purchases; unknown or conflicting
composition never becomes a confirmed match. Option edits retain their existing
POS slot flow rather than treating customization as a dish exclusion.
Execution traces include `resolveIntent.targetResolution` with constraints,
candidate/eligible refs, provenance and rejection reasons. Read searches continue
to use the requested category rather than enumerating purchase targets.

Model target choices are capped at five, independently of catalog size. Overflow
keeps the legal intent but hands off instead of truncating or issuing an oversized
clarification. Literal catalog fragments can propose a `productResolution` with
`possible` evidence; they never grant purchase authority. A bounded read decision
distinguishes product queries from food filters using the existing condition
question, without introducing an unconditional extra request. Ambiguous combined
requirements hand off intact. Product interpretation searches issued real names;
filter interpretation does not inherit a speculative name. Runtime validates the
issued interpretation and still applies revision/phase/confirmation checks.
`catalogEvidence` separately reports matched text and its source (`name`, `alias`,
or discovery-only `fragment`), plus category text and available member count.
Uniqueness of an inferred name suffix does not make it a merchant alias or grant
purchase/edit/removal authority. Exact names/aliases outrank broader categories;
possible fragments require bounded interpretation before a product lookup.

From the repository root:

```bash
pnpm --filter @proj-airi/order-menu dev
```

### Single-dish price queries and recommendations

`menu_get` and `menu_recommend` share `minPrice`, `maxPrice`, optional
`minPriceExclusive` / `maxPriceExclusive`, and `priceOrder: 'ASC'`. Bounds use
integer POS base-price currency units, not customized totals or whole-order
budgets. Category/name/composition filters intersect before ranking and limiting;
explicit price ordering takes precedence over merchant ranking within the
qualified result. Same-price items retain catalog order. Price-qualified customer
reads show at most three items, real prices remain on the cards, and the header
shows the applied conditions. Empty results clear the old presentation. No spoken
price list is required. `display:false` is an internal filtered data read.

Price-qualified reads share the existing recommendation batch. `more:true`
retains scope, price bounds/order, food conditions and seen IDs; changed scope or
prices must start a fresh batch. Exhaustion never recycles items or relaxes the
budget. A new explicit price search starts a new batch rather than inheriting an
old one.

The browser extracts currency literals (including explicit Chinese amounts and
shared-unit ranges) into finite `priceEvidence` interpretations. Jev selects a
`priceChoiceId` alongside existing read-condition questions; it never supplies
numbers or calculates item prices. The browser verifies that ID against the
current one-use ticket before compiling tool arguments. Quantities/person counts
are not currency evidence. Approximate/relative prices, total allocations,
ambiguous shorthand, fractional/negative literals and unsupported interpretations
clarify instead of ignoring a condition. This is not a total-budget optimizer.
Agent handoffs carry verified bounds or an unresolved-price guard; tools cannot
widen the former, guess out-of-range recommendations, or mutate through the latter.
The shared wire types live in the server's side-effect-free `priceContracts.ts`;
Menu owns parsing/filtering/batch policy in `domain/pricing.ts` and `webmcp.ts`.

Focused tests: `domain/pricing.test.ts`, `priceFlow.test.ts`, server
`kiosk-interaction-decision/pricing.test.ts`, the authenticated route regression,
and Kiosk fast-path tests. `priceReplay.test.ts` contains six synthetic provider
cases, disabled unless `KIOSK_SYSTEM_ONE_REPLAY_URL` is explicitly set after
permission to transmit artificial fixtures. Passing mock/contract tests does not
establish the 4B model's semantic accuracy.

### Opt-in semantic prompt comparison

`src/semanticReplay.test.ts` compares a frozen reported instruction, candidate-only
changes, instruction-only changes, and their combination through `decideInteraction`
and an isolated Menu runtime. Its 26 scenarios use artificial dialogue and a
synthetic five-item catalog; no customer history, production settings, POS
submission or real payment is accessed. Eight sentence forms are reserved for
holdout verification, not iterative prompt tuning. Ordinary test runs validate the
fixtures locally and skip all provider calls.

After explicitly authorizing synthetic data transmission, run one variant:

```bash
KIOSK_SYSTEM_ONE_REPLAY_URL=https://openjev.aikcitri.qzz.io KIOSK_PROMPT_VARIANT=baseline pnpm -F @proj-airi/order-menu exec vitest run src/semanticReplay.test.ts -t 'synthetic semantic prompt comparison'
```

Variants are `baseline`, `candidate`, `instruction`, and `proposal`. Complete
per-case summaries include model identity, actual decision, failure stage,
question/call counts, latency, and simulated cart/phase effects. A live assertion
failure records an unresolved semantic expectation; it is not a reason to lower
safety thresholds or deploy the experimental strings. These strings never update
the stored System One policy or production candidate descriptions. See the
[decision review](../../docs/research/2026-10-02-jev-decision-review.md) for results.

### Browser development

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
the Agent calls `menu_recommend` without `needs`. The default is up to three
distinct available dishes in POS catalog order; this is not a popularity claim.
Fewer matches are never padded. `limit: 1` or `2` can narrow an explicit request.
`maxPrice` is a non-negative integer in POS price units and limits each dish's
base price, not the total order or option surcharges. `strategy` is offered only
when current POS/merchant evidence supports `POPULAR`, `NEW_ARRIVAL`, or
`CHEF_SPECIAL`. Evidence has a positive rank and a validity window; missing or
expired evidence is rejected rather than replaced by catalog-order popularity.
`more:true` returns the next batch, preserving verified ingredient/need filters
and excluding all dishes already delivered in that recommendation session.
Budget and strategy are retained too; changing either requires a fresh request
without `more`.
The session binds menu and recommendation revisions, has no idle TTL,
and resets with a new order. Jev gets one bounded `intent:recommend-more` choice
while the session is valid, not a new tool workflow or a full-menu search.
Broad catalog exploration (including “what do you sell?” and “show everything”)
uses this same bounded policy: show up to three recommendations, then replace
them with the next unseen batch while the session remains valid. The response
calls these recommendations, not the entire menu. Exhaustion does not recycle
items. Named products, categories and explicit food-condition queries remain
precise searches. No additional tools, intent choices or UI controls are needed.
Fresh recommendations do not inherit old dietary conditions. The Agent should
recommend first and only ask about
rice, noodles, spice, or similar preferences after the customer rejects or
narrows that first suggestion. For an explicit preference, `menu_recommend`
accepts verified `needs` tags. The menu renders the returned items as a
non-blocking recommendation view with the catalog's own data; it never trusts
model-generated product details. `menu_show_recommendations` remains available
when the Agent needs to display a previously verified custom set.

`menu_scroll({direction: 'UP' | 'DOWN'})` moves one visible page on the
native scroll owner without changing selection, cart or recommendation batch.
It reports measured `MOVED`, `BOUNDARY` or `UNAVAILABLE`; modal/review screens do
not scroll underneath their controls, and checkout disallows navigation. Hosts
without a viewport controller do not advertise it. No scrolling dependency is
required. `cart_get` shows the order review by default (`display:false` is a data-only
read). Both semantic and Agent fulfillment changes reveal the review and await
control registration before animating the POS choice, then update the selected
state. Reading the cart never replaces an active checkout/payment screen.
The bottom cart summary is one full-width native button: summary text, item
previews, padding and the orange action all open the same review once. Enter
and Space work without separate handlers. Empty carts remain disabled; the
summary is only rendered on the menu, not during checkout/payment.

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
`activity` refreshes the anonymous-session idle reminder and `completed` shows
completion feedback. Stage Kiosk retains the completed order/session afterward;
only an explicit new-order action starts the next customer. These events do not
expose or execute tools.

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
The current venue offers **內用 / 自取**. Immediate self-pickup uses the existing
`takeout` order code in WebMCP and POS submissions; it has no reservation or
pickup-time requirement. Menu buttons, returned choices and semantic candidates
use the same customer-facing terminology. POS-driven capability discovery is
not implemented by this venue wording change.
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

The browser supplies a fresh `interactionState.screen` (`menu`, `cart_review`,
`item_configuration`, or `checkout`) from the actual view owner on every state
read. This is independent from business phase: opening cart review does not
start checkout. Jev gates and Main Agent handoffs retain this screen fact;
headless hosts without a view owner report no inferred screen. Screen identity
does not authorize an operation or replace phase/revision checks.

An ADD_ITEM without a serving quantity or required option starts an application-
owned configuration question, not an order with guessed defaults. The pending
domain plan retains the known item, options and quantity in the same customer
session, bound to its relevant revisions. Idle and **繼續點餐** do not discard
it. Jev sees only finite POS choices, the quantity parsed
from the current answer, cancel and new-request outcomes. Finishing the slots
still compiles and authorizes the operation. Each customer utterance issues a
fresh internal answer ID valid for 30 seconds; expired or earlier-turn answers
are rejected without discarding a still-valid plan. This does not change the
customer-visible choices or repeat the question. Cancellation, a replacement meal,
relevant state edits or a new-order/session reset revoke the unadded plan.
Configuration/clarification turns first establish whether speech answers the
actual question or introduces another request. A new request gets one host-only
reroute correlated to that question ID and the identical utterance, within the
existing question budget. Lookups retain the unadded meal; a verified new order
replaces it without inheriting quantity/options. A query's own clarification is
answered before resuming the retained meal. Expired/replayed topic-change tickets
reject without cancelling a valid draft. Bare exact choices/ordinals may resolve
directly; their appearance inside a query or other demand cannot select a target.
When the POS declares required options, they remain unselected in the touch
dialog and prevent adding until chosen. Configuration logic is retained, but
the current seven-dish source declares no customization options: noodles have
no spice selection, and dumplings are fixed at 10 pieces/NT$80 per serving.
Serving quantity remains adjustable; a missing quantity still asks how many
servings, without inventing an option question. Refresh the POS Bridge catalog
and reload the menu/Kiosk after changing the source fixture.

The host-only `kiosk_interaction_state` tool exposes a non-sensitive phase
summary for Kiosk conversation turns without issuing or consuming System One
candidates; it is not available to the Main Agent as a callable tool.
The host-only `kiosk_agent_task` binds a Main Agent turn to finite ingredient
conditions and the current menu revision. Search, recommendation and result
presentation cannot silently drop those conditions. The record expires after
five minutes or is ended by its matching task ID; an older turn cannot end a
newer task. Catalog changes reject the old task instead of reinterpreting it.
This is a turn-scoped read constraint, not a permanent dietary profile or an
allergy guarantee.
The semantic snapshot also supplies mentioned unavailable-condition references
for nutrition, allergy guarantees and stricter dietary certification. Literal
vocabulary matching only identifies the topic; Jev distinguishes a requirement
from a mention in a dish name. Requested or uncertain unavailable conditions
handoff the entire utterance rather than silently dropping part of a filter.
This is not an exhaustive natural-language safety classifier; generic coverage
checks and Agent handling remain necessary for conditions outside the vocabulary.

## Current dine-in seating

The simulated venue has five four-person tables. Choose 內用, provide the
current party size (1–20 people), then choose available tables before checkout.
Parties up to four use one table; larger parties must explicitly agree to
split before selecting a minimal-capacity group. This is an immediate table
hold, not a date/time reservation. 自取 requires no seating.

Background inventory synchronization runs every 30 seconds only during an
active dine-in round, and stops for pickup or completed/occupied orders. Opening
the menu and resetting a round without a hold do not query seating. Semantic
decision/execution and Agent mutation checks refresh seating only for dine-in;
explicit seating queries and the dine-in payment preflight remain immediate.
The POS still atomically checks inventory revision when reserving, so the
background interval is not permission to accept an outdated table choice.

`order_set_party_size`, `seating_get`, and `seating_reserve` share the visible
controls' POS-backed seating controller. A selection carries its issued
`expectedRevision`; stale Jev or Agent ordinals are rejected rather than rebound
to different seats. Jev sees party facts, the current question, finite semantic
choices, and session-local table references, never private hold tokens.

Unpaid holds expire after ten minutes; cancellation, a new round, or switching
to 自取 releases them. Payment locks seats beyond that deadline, including
pending/unknown outcomes. An accepted order makes them occupied; a rejected POS
order after payment authorization stays locked for staff reconciliation.
Closing the browser does not release an unknown payment. The simulator is
memory-only. Staff can release occupied tables individually at the simulator's
`/__simulator/seating` screen; this never releases pending-payment locks.
Real POS persistence and reconciliation remain future integrations.

## Bounded dialogue continuation

### Ingredient filtering

POS items now supply `composition`: actual ingredient IDs, `complete`, source
(`simulation` or `merchant`), revision, and verified option removals. There are
no absent-ingredient tags. The current seven-dish fixture declares a simplified,
complete simulation of primary ingredients, egg and vegetable sides; it excludes
sauce/broth detail and is not a verified recipe or allergy-safety claim.

`menu_get` and `menu_recommend` share `includeIngredients` / `excludeIngredients`
filters. All requirements intersect; empty results never relax them. Verified
matches, dishes requiring customization, and incomplete facts are returned
separately. Searches do not apply customizations or add food. The result displays
the filters without test-source wording in customer dialogue; source metadata
remains in composition records. An empty result clears old presentation.

`dietary: 'vegetarian'` is a finite supported condition, not an unfiltered
recommendation. A match requires complete composition and the positive POS
`dietaryLabels: ['vegetarian']` declaration; known meat disqualifies it.
Missing declarations are not inferred from an apparently meat-free recipe.
Results expose `availability`: `MATCHES`, `NONE`, `UNKNOWN`, or
`CUSTOMIZATION_REQUIRED`. `NONE` means no verified match; `UNKNOWN` means
insufficient facts to verify absence. Neither outcome starts an unfiltered
continuation. Alternative batches retain the dietary condition too.

The application supplies finite ingredient references mentioned in the utterance.
After selecting a read intent, Jev chooses EXCLUDE / INCLUDE / NONE in separate
bounded questions;
it does not invent IDs, interpret recipes or generate tool arguments. Only search
and recommendation consume these slots. Uncertain slots reach Main Agent intact.
Runtime validation rejects unoffered ingredients and stale catalog plans. A
one-use read continuation retains the exact filters. Filters belong to this
query/continuation, not a permanent visitor dietary profile; subsequent requests
must explicitly resolve their conditions again. Main Agent uses the same tools.

Example: `menu_get({ category: '便當', excludeIngredients: ['pork'] })`.
Changing to real recipes requires updating POS facts and source/revision, not
replacing the filtering flow. Deploy the expanded POS catalog contract with
Order Menu; missing composition cannot be assumed to mean ingredient absence.

System One receives phase-legal intents and real domain references, not the
menu multiplied by every operation. Broad exploration retains `SEARCH_MENU` in
the trace, but compiles to `menu_recommend` rather than an entire-catalog display
and optional recommendation continuation. A valid batch binds its recommendation
revision and supplies `more:true`; otherwise it starts a fresh batch. A recent
presented dish can resolve an acceptance/repeat, but does not narrow broad browsing.
Agent `menu_get` defaults to presentation and applies the same bounded policy
for unscoped, unfiltered requests. For those requests, explicit `display:false`
remains an internal catalog read, not authority to present or narrate the entire
menu; raw runtime reads with omitted display also remain data-only. Broad customer-facing reads
cannot replace an active checkout/payment screen. Scoped searches retain their
existing behavior.
`RETURN_MENU` compiles to `menu_open` only with a registered menu controller in
ordering phase. It closes review/configuration while retaining cart lines; it
does not cancel checkout or escape a payment lock. Related unfinished speech
reaches the resolver as `previousTranscript` separate from the current utterance,
only after Jev's relation choice and a same-state revision check.

Operational questions carry a purpose, question ID, finite choices with explicit
effects (including refusal/deferral), and relevant revisions. Current-turn
receipts include validated values such as party size and tax ID even when those
values were not known at presentation. Server resolves a specific legal answer,
not a generic ANSWER that conflates consent and refusal; independent new requests
do not have to answer the old question. `order_ask_question` accepts only the current
purpose; the application owns wording and POS choice labels. Main Agent does not
write a second operational question. The host validates its receipt
before rendering, then activates it through `kiosk_dialogue_presented` using the
exact ID, never prose matching. Merely offering a question creates no authority.
Actually presented unanswered questions survive lookups, plain acknowledgements,
deferral and idle within the same order. Question records remain until new-order
reset; completed/superseded records are not active answer authority. Host-only
`questionHistory` exposes those statuses without adding an Agent tool. Relevant
revisions invalidate old execution tickets, but the next decision rebases the
question when the same unmet need still exists. Unresolved meal configuration and
target clarification likewise survive idle; explicit cancellation/replacement
retires that need. A new decision turn renews an expired ordinary question's
internal answer ID (30 seconds) or issues a new clarification answer ID (15
seconds); old tickets never execute. Read-only host snapshots do not issue tickets.
Unpresented question offers still expire after 30 seconds.
Presented item focus and recommendation conditions/seen dishes have no idle TTL;
new-order reset clears them, a new presentation/recommendation replaces their
active focus, and catalog changes require revalidation.
Deferring a question preserves the order; payment and tax-ID confirmations remain
separate, one-use authorization records. Fulfillment choices come from the POS
catalog (the mock venue currently offers 內用 and 自取).
Spoken person-count updates first reveal/register the actual person-count select,
then await the existing cursor animation before one authoritative seating update.
The cursor is visual feedback, not an additional DOM click or mutation. Manual
selection continues to use the normal non-animated input path.
`kiosk_fast_path_continue` permits at most one revision-bound, one-use
recommendation read after an explicit food-condition lookup. Broad exploration
already returns recommendations and does not offer that extra read.
A new utterance invalidates the old offer. These host tools are not Main Agent tools; cart/payment mutations
never participate in this read-only continuation.

## Extracting from AIRI

An independent, synthetic-only classifier/resolver experiment is documented in
[`test_prompt/turnClassifierPoc/README.md`](../../test_prompt/turnClassifierPoc/README.md).
Its `src/resolverPoc.test.ts` reuses this app's public runtime in memory; the app
does not import the classifier. The separate `src/experiments/effectCoveragePoc.ts`
and its test probe effect/whole-request review without executing tools; successful
review is not an authorization ticket. Neither experiment is imported by the app.
`src/experiments/requirementPoc.ts` separately tests candidate-blind semantic
profiles and comparison against real domain effects. It supplies no model target
or slot fields, and its measured zero usable coverage rejects production adoption.
Offline tests need no model inference or network;
live Jev replay and report writing require explicit environment flags. This is
not a new production route or a replacement for semantic authorization.

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
