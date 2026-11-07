# Stage UI

Shared core for stage

## Shared interaction feedback

`components/scenarios/feedback-invitation` provides the host-owned completion survey overlay used by customer-facing Stage surfaces. It generates a QR Code locally from a validated static HTTP(S) URL and emits one `finish` event when the visitor skips or the countdown expires.

Use it in an AIRI Interaction Host after an embedded interactive service emits `completed`. Do not use it inside a domain service, as a WebMCP tool, or to encode customer data into the survey URL.

`components/scenarios/customer-session/CustomerSessionCompletion.vue` combines
the thank-you screen with that configured invitation. An optional
`orderContinuationUrl` prop adds a separate order QR and desktop link, so carrying
away an order does not delay the reward. Pass only a host-validated capability
and clear it when the session ends; never append it to the static survey URL.

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

`services/pbControls` resolves the actual PB menu, product dialog, options,
meal quantity, note, add button and unique cart row. `pbOperation` owns the same
step's cursor, dispatch and readback. Cart writes now use those native controls;
catalog/configuration/cart APIs remain read-only evidence. The menu-to-cart
journey is limited to this store's `menu` and `orders/create`, with no order-submit
or payment operation. Full-document navigation revokes the old binding and never
replays a pending effect.

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

Each control is rechecked for identity, visibility, enabled state and occlusion.
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
executor's actual target and dispatches at its press. It remeasures scrolling and
cancels on trusted input/navigation/hidden documents. Read-only product cues never
silently search or click to create presentation. Missing or ambiguous cards report
unavailable targeting. `browser_present` remains Host-only, including empty-ref
visual cleanup. It cannot dispatch commerce work.

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
