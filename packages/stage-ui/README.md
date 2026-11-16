# Stage UI

Shared core for stage

## Native PB ordering

`services/pbBrowserService.ts` uses the shared reviewed journey policy for the
member pickup site and the current/RD guest/table sites. Guest reads require PB's actual
cookie-buyer state; member reads still require login. Menu/cart controls derive
their paths from that journey. `browser_return_menu` preserves the cart, clears the website search and waits
for the complete current menu; it is distinct from setting a cart row's final serving count.

Menu pickup and cart snapshots use PB's existing versioned Inertia partial JSON
responses, with no HTTP cache or merging from old DOM props. Required fields
include buyer/auth, store and flow; component and response URL must also match.
An asset-version conflict requires reload. Full HTML/dev assets are not fetched
for these reads; category, price and option requests remain fresh vendor reads.

`pbTablePicker.ts` adds large, name-based buttons alongside PB's real selector.
Names come from the current SelectTable document's URL/component-bound metadata,
without re-fetching its HTML on every context read. Selection rechecks the real
dropdown and reads back its result. Voice selection uses the same illustrated
hand taps for the dropdown, counter pickup/table option and Start; table tokens remain in
PB. `browser_table_select` selects only; `browser_start_ordering` selects the
explicitly requested table and presses PB's Start button. A later voice turn may
reuse the current rendered `selectedTable`, including PB's default, only after a customer Start request. This is context, not purchase consent. Menu entry
does not establish cart ownership; the new page must read back table/cart.
Host-only recovery distinguishes `canRetry` from `canReset`. Explicit reset may discard a retired document’s UUID cart marker only through native clear and fresh empty-cart verification. It never repeats the old purchase, unlocks a current uncertain write, or adopts an `order:` submission or `reset:` uncertain-clear marker, including after reload. A failed clear before dispatch retains retry eligibility; an uncertain dispatched clear retains the write barrier. Empty table-entry resets do not require menu navigation.

Host-only `browser_cart_get forAdmission=true` also reads a versioned cart on
the table page for reception preparation. Ordinary table reads omit that cart.
A first-time PB guest may receive the exact missing-table Error/403 response
until Start; only on the table page this returns `cartAdmission: after-table-entry`
without a cart snapshot. It does not establish emptiness or ownership. The Host
allows table entry only and retries admission before exposing menu operations.
For an explicit reception reset with unfinished items, the Host may enter through
the existing selected-table Start control with `forReset=true`, skipping the hand
animation while customer controls remain covered; this grants no order submission.
Failed enhancement leaves the original dropdown available.
The common service client accepts a correlated `browser_start_ordering`
menu-entry acknowledgement across a rebind to this same configured PB service.
It can also settle a private typed submission result across a result
navigation bound to the exact same operation and reviewed store journey. Neither
exception restores old descriptors, replays a write or certifies payment.
Caller cancellation still cancels the entry wait.

`services/pbCheckout.ts` reads actual invoice radios, labeled contact fields,
order notes and website totals. It owns one expiring submission ticket bound to
the fresh cart, form and manual-interaction revision. Public invoice/phone steps
do not submit. Preparation can focus the invoice choices or the next unfinished
field through the existing native operation follower, without changing its value.
The Host owns segmented phone collection and read-back confirmation; the adapter
fills only a complete number. The private submission control follows the shared
journey's explicit submission capability for the authorized merchant dining flow
and owned fixture. Merchant native submission acceptance still needs live verification.
Result acceptance
binds the unique Inertia page's component, store, flow, URL, order hash and
accepted status. Merchant acceptance is distinct from total consistency: an
amount mismatch reports `accepted/conflict`, while an exact total with detail
comparison still unavailable reports `accepted/unavailable`. The displayed
number is separate from the order hash. Receipts contain no confirmation token.
Only the enabled fixture releases its matching marker after established-order
evidence; pending and unknown keep it. Result pages expose no payment controls.
The staged parser and RPC result do not yet provide an independent observer
when full navigation destroys the old execute promise; that requires the
host-owned pre-dispatch intent and durable evidence lifecycle.
Native navigation calls `beginNavigation()` to revoke tools while retaining the
entry acknowledgement's wait. "Entering" acknowledges the accepted click, not a
loaded menu. Loading UI and fresh discovery continue until native readiness.
`waitUntilReady(signal)` also waits across the gap between navigation and new
transport discovery, with a 15-second bound and caller cancellation. It cannot
reuse the retired document's resolved readiness promise.
`pbInvoiceInput.ts` focuses only the selected native carrier/citizen field,
validates scanner text and consumes Enter without submitting. Blur, navigation
and reception reset revoke input ownership; typing elsewhere retains manual
takeover protection. It adds no notification-phone or Email filling tool.

Checkout cart edits keep the current cart page; a quantity/removal operation
must not detour through the menu and recreate invoice/contact fields. Passive
reply/TTS product cues set `preservePage: true`: they may frame cards already
available on the menu, but cannot navigate or clear a search. An explicit
customer-requested product presentation retains its existing reveal behavior.

## Shared interaction feedback

`components/scenarios/feedback-invitation` provides the host-owned completion survey overlay used by customer-facing Stage surfaces. It generates a QR Code locally from a validated static HTTP(S) URL and emits one `finish` event when the visitor skips or the countdown expires.

Use it in an AIRI Interaction Host after an embedded interactive service emits `completed`. Do not use it inside a domain service, as a WebMCP tool, or to encode customer data into the survey URL.

`components/scenarios/customer-session/CustomerSessionCompletion.vue` combines
the thank-you screen with that configured invitation. An optional
`orderContinuationUrl` prop adds a separate order QR and desktop link, so carrying
away an order does not delay the reward. Pass only a host-validated capability
and clear it when the session ends; never append it to the static survey URL.

## External speech presentation

The shared Stage's `externalAudioSource` supports host-owned TTS for both VRM
and Live2D. `composables/audio/useExternalSpeechSource` owns only the optional
Live2D analysis branch: replacing speech, disabling it or unmounting detaches
that branch without stopping or disconnecting the caller's speaker output.
Late asynchronous analyser setup cannot reconnect a retired source. The shared
Stage invalidates worklet setup when its renderer changes or it unmounts.

## Same-origin Interaction Profile

`composables/use-interaction-profile` owns the first non-secret configuration profile for AIRI Interaction Hosts. It keeps approved embedded services, Agent instructions, and completion-survey settings in one `localStorage` record shared by Stage Web and Stage Kiosk when they are served from the same browser origin. It deliberately starts from a new profile and does not migrate legacy host-specific storage keys. It is not cross-device configuration or secret storage.

## Native WebMCP adapter

`services/webmcp-adapter` remains the native adapter used by Stage Web. Kiosk has
migrated to the separate client below. This adapter and its health export remain
unchanged; the updated owned Menu no longer exposes native tools to it.

A native host activates the adapter after iframe load; it discovers tools only
from that iframe origin, converts metadata into Vue-safe descriptors, and executes
through native WebMCP. It intentionally has no `postMessage` tool bridge fallback.

The adapter targets Chrome 155's object-input execution contract:
`document.modelContext.executeTool(registeredTool, inputObject)`. Arguments are
passed as objects; the browser serializes them before invoking the service.
Older JSON-string execution APIs are unsupported. Results remain JSON text at
the native boundary and are parsed by the adapter.

Discovery alone does not enable assistant control. The approved service must
register `webMcpHealthTool` from `@proj-airi/stage-shared/webmcp` with the same
origin allowlist and lifetime as its domain tools. The adapter calls this
side-effect-free probe with a per-discovery challenge and validates its versioned
echo before exposing any domain tools. The probe is never exposed to the Agent
or recorded as a customer operation. Every refresh revokes admission until a new
check passes; iframe replacement cancels pending checks and invalidates old replies.
Discovery and probing have a five-second deadline, including implementations
that ignore cancellation. Missing APIs, missing probes, rejected input, malformed
replies and timeouts leave the adapter unavailable, with a diagnostic `error`
and a stable `unavailableReason`. Hosts must retain manual interaction. This
checks native argument/result transport, not individual business tools, payment
providers, authentication, or physical iframe input delivery.

## Kiosk interactive-service client

`services/interactiveServiceClient` owns the Kiosk's shared connection lifecycle,
with an Eventa window-message transport for iframes. Call `activate(serviceUrl, iframe.contentWindow)` after iframe load
and `activate()` when the frame is replaced/unmounted. It exposes readonly tools,
availability, execution notifications, completion revision and `waitUntilReady`.
The approved service must implement `@proj-airi/stage-shared/interactive-service`.
Exact origin/source, a fresh connection ID and the service document identity
isolate replies. Retained descriptors are invalid after activation changes.
Only discovery retries; lost execution receipts revoke admission and must not
be treated as proof that a commerce operation did not happen. It does not grant
access to unmodified third-party pages or fall back to native WebMCP.

Trusted native hosts can call `activateTransport(serviceUrl, connect)` with a
factory returning `ServiceConnection` from the shared contract. Refresh/recovery
uses a new transport lifetime, preserving the same document/operation admission
checks. Only discovery retries; cancellation of a native wait does not cancel or
replay a vendor effect. `interactiveServiceWindowConnection` retains the exact
origin/source checks for the browser path.

`services/pbBrowserService` owns the PB-specific bounded operations and document
journal once per approved PB document. The authorized browser controller installs
`pbBrowserBridgePrototype` as its window-message peer; Kiosk Desktop installs
`pbBrowserNativeEntry` in an isolated world through its trusted main process.
Neither adapter grants arbitrary code, login, submission or payment tools to Main.
This is a limited PB pilot, not a generic website automation SDK or a production
Companion pairing/revocation implementation.

Configuration and selection contracts are owned by
`@proj-airi/stage-shared/product-configuration`; import their types/schema there.
`services/pbProduct` owns PB discovery, validation calculations and preparation.

`services/pbControls` resolves the actual PB menu, product dialog, options,
meal quantity, note, add button and unique cart row. `pbOperation` owns the same
step's cursor, dispatch and readback. Cart writes now use those native controls;
catalog/configuration/cart APIs remain read-only evidence. The menu-to-cart
journey is limited to this store's `menu` and `orders/create`, with no order-submit
or payment operation. Full-document navigation revokes the old binding and never
replays a pending effect.

Equivalent PB cart rows may be replaced as an admitted `lineRefs` group. The
executor verifies the incoming configuration before reducing original servings,
then verifies each intermediate full-cart snapshot. Indistinguishable rendered
rows are interchangeable only within that exact group; `verifyCartRowEdit`
checks the actual affected identity and every unchanged field. It never uses DOM
order as a vendor row ID, groups different customization, or retries unknown IO.
For Chromium tests, `VITEST_BROWSER_CHANNEL=chrome` selects an installed Chrome;
without it the existing Playwright browser default is unchanged.

`browser_cart_review` opens the approved cart route and returns a fresh
vendor-backed receipt with quantities, options, notes and subtotal. It never
submits an order. `browser_cart_get` with catalog data stays a planning read;
menu presentation is not a cart review. The Host must admit cart ownership
before dispatching the visible review and before exposing its final receipt.

`pbCart` supports partial configuration replacement through `retainQuantity` and
equivalent-row totals/removal through `lineRefs`. An identical-configuration
replacement on a unique same-price row compiles to one quantity edit of retained
plus incoming servings, without adding/deleting meals. Other rows with the same
configuration or a changed price prevent this conversion. Groups require the same product,
canonical configuration and unit price. Redundant rows are removed before setting
the surviving total to avoid creating an ambiguous native row. Each intermediate
snapshot, including pickup context and manual-interaction generation, is verified;
unknown results block further writes rather than retrying or claiming rollback.
Repeated additions merge into one existing exact configuration/price row only
when the native adapter proves that row is distinguishable and the resulting
row stays within 99 servings. The receipt still counts only incoming servings.
Otherwise ordinary addition remains available, preserving distinct notes/options,
older prices and totals spanning multiple rows.
The PB adapter verifies uniqueness in both the complete source cart and rendered
controls. When name/count/price coincide, exact observed option labels and notes
can distinguish rows; unknown detail markup or entirely identical rows still stop
without guessing DOM position.

PB meal operations and returning to the menu leave the active carrier/scanner
field before acting. Entered text is retained; unrelated cart rendering does not
refocus the field. Customers can explicitly focus it again to resume input. An
unfinished carrier field therefore does not require completion before changing
meals. This does not bypass merchant validation when submitting an order.

`pbCart.clear()` implements the Host-authorized reception-end policy: observe the
fresh whole cart, dispatch the native cart-header **清空** once only if rows remain,
and prove zero rows/subtotal before returning success. The adapter rechecks that
snapshot immediately before dispatch. Already empty carts need no click; accepted
but unverified clearing retains the same unknown-write barrier as ordinary edits.
This is a lifecycle action, not a model-advertised cart tool. `browser_customer_reset`
then resets product/search drafts in the same document and returns `cartCleared:true`;
login remains independent from unfinished order rows. Reception reset uses
immediate scrolling/dispatch without guided-hand timing. Only this private reset
may run while the Host hides the native view; document ownership, cancellation,
target actionability and cart verification still apply. Customer operations
continue to require a visible document. `pbPresentation.cover()` owns the opaque loading scope and trusted-input
blocking; it survives ordinary cue/navigation cancellation and always cleans up
when work settles. The hit tests remain pointer-transparent to this cover, so
other merchant overlays still block dispatch. The Host supplies the localized
loading announcement; normal customer-facing controls retain their guided pace.

Each control is rechecked for identity, visibility, enabled state and occlusion.
Menu/cart navigation and clearing wait for their unique rendered controls;
fresh HTTP data alone does not prove those buttons have appeared. These waits
do not repeat a click or loosen the final cart preflight.
Accepted merchant work still settles after cancellation; pre-dispatch takeover
cannot click. Step receipts carry observation refs, relative ready/dispatch/finish
times (including first target arrival) and failure reasons. A verified cart result is retained when only return
navigation/display refresh fails. Unknown effects retain the persistent marker.
Required document operations run through one FIFO journal. Passive speech cues
are droppable and cannot reject or interrupt a required read/action. Queue entries
retain connection and control revision ownership; takeover/hidden state revokes
queued UI work, while already accepted writes still verify. Explicit visual
cancellation cannot resurrect an older queued cue.

`services/pbPresentation` renders pointer-transparent cues in the same isolated
PB document. The hand retains its position across short movements, follows the
executor's actual target and dispatches at its press. Its pointer-transparent
manual popover occupies the top layer above product dialogs. Quantity changes
click the native input's scoped plus/minus buttons one step at a time (including
per-serving extras and cart rows), awaiting each displayed value before the next
click. Plain numeric controls without a stepper retain native input/change events;
missing or disabled stepper buttons never fall back to writing their input.
Cart preflight runs before the first click; accepted effects still settle after
takeover, and subsequent clicks stop. Live row ownership prevents an intermediate
count from selecting another identical meal; ambiguous replacements stop.
It remeasures scrolling and
cancels on trusted input/navigation/hidden documents. Before a product batch is
spoken, `pbBrowserService` verifies every selected card. If an old search hides
any subject it clears the real search, waits for all selected cards and then
highlights the batch; no product card is clicked. Missing/ambiguous cards reject
the presentation instead of claiming off-screen catalog facts were displayed.
The Host may reserve validated recommendation refs with `deferVisual=true`;
that receipt says `prepared`, never `shown`, and does not move a hand or frame.
Reply/playback cues then present one uniquely named dish at a time.
An empty-ref `browser_present` only clears cues; `browser_search` with an empty
query returns the full current menu after verifying its rendered cards. A named
search first restores and verifies the full current catalog when a previous filter exists,
then observes PB's native loading cycle and settled result count. An empty result
uses `status:not-found`, with the checked query named in its receipt; it is information,
not a pending customer question, so other requested dishes can still be checked. None of
these actions dispatches commerce work.

A required operation supersedes an active `browser_present` cue and aborts its
catalog fetches as well as its movement. Its cancellation receipt contains no
product facts or write evidence. This releases the FIFO before a stalled visual
read reaches its timeout; accepted cart actions and their readback are not
superseded through this path.

PB movement is distance-sensitive (280–1200ms), with a short arrival pause and
150ms press/release. Actionability can overlap the pause; the executor triggers
the press only at its actual acceptance boundary. Release does not wait for the
website's response. A superseding cue continues from the rendered hand position.
These PB timings do not change the owned Menu's shared cursor policy. Cart and
configuration reads that are independent may overlap; final freshness checks and
accepted-effect verification remain mandatory. Completion labels use verified
cart evidence instead of rereading the whole menu just for presentation.

Read-only `browser_quote_selection` reuses the exact same fresh selection
validation for configured unit/total prices and never sends a merchant write.
Base-only `browser_quote` is insufficient for an add-on price inquiry. Its
configured receipt lists the observed base price and selected option unit prices
and per-serving quantities, alongside the configured unit and requested total.

PB cart tool configuration choices and `unitPrice` describe one serving;
top-level `quantity` is the number of meals. For two meals each with one paid
option, pass meal quantity 2 and option quantity 1. The shared runtime retains the
same rule for the browser and Electron adapters. A unit-price mismatch detected
before dispatch returns a data-only proposal correction with the observed unit
price; it does not commit, substitute options or replay uncertain writes.

After a lost execution receipt, `recover()` reuses the original connection ID
and document, inspects the accepted operation IDs and admits tools only when all
operations have settled. It never replays their inputs. Pending/failed/missing
operations or a replacement document keep admission revoked. Hosts must read
current domain state and release only their own settled task before resuming;
successful transport recovery does not establish payment success. Execution
notifications include connection/document/operation IDs for bounded diagnostics.

Run the focused real cross-origin Chrome tests from the workspace root:
`VITEST_BROWSER_CHANNEL=chrome pnpm exec vitest run --config packages/stage-ui/vitest.interactiveService.config.ts`.

## Anonymous customer lifecycle

`composables/use-kiosk-customer-session` owns the disposable customer session
used by both Stage Web and Stage Kiosk: session start, pending AI work, an idle
confirmation before anonymous data is reset, expiry, completion, chat
replacement, and cleanup. A host supplies its reset policy and
own `resetInteractiveSurface` action, such as reloading an embedded WebMCP
service. Use this composable for customer-facing interactive hosts; do not put
the lifecycle into a domain service such as a restaurant menu.

Idle confirmation retains customer state and starts a 15-second reset countdown.
Continuing cancels that countdown without resetting any host content. Unanswered
expiry resets the customer/chat and embedded service to clean standby.
`resetPolicy: 'confirmed-completion'` also requires a host-confirmed successful
order before completion can reset state. `completeOrder()` marks that success;
`end('completed')` then resets customer/chat and the embedded service after its
completion screen finishes. A dismissal without this completion state is ignored.
Explicit `end('staff')` (including the new-customer action) also resets context.
Stage Kiosk uses this policy with `idleTimeoutMs: 30_000`. Stage Web retains
its default 45-second inactivity interval and automatic policy.

## Histoire (UI storyboard)

https://histoire.dev/

```shell
pnpm -F @proj-airi/stage-ui run story:dev
```

### Project structure

1. If a story is bound to a specific component, it can be placed beside the component in the `src` folder. e.g., `MyComponent.story.vue`
2. If a story is not bound to a specific component, then it should be placed in the `stories` folder. e.g., `MyStory.story.vue`

## Chat history host status

Shared `ChatHistory` offers an optional `after-message` slot with `message` and
`index`. Kiosk uses it for the originating customer request's visual state;
ordering/correlation remains the host's responsibility. Other chat hosts retain
their existing message and scroll behavior.

PB order submission has two native buttons: opening `確認訂單` is a draft action;
only its `確定` button starts the external dispatch barrier. Cart, form and manual
revision are rechecked between them. Submission is enabled for the authorized
`app.esgpb.com` store `1kgJeql` internal-use journey and owned loopback fixture,
as declared in the shared journey policy. Other deployments remain manual.
The final-summary assent grants order creation only; payment is separate.
