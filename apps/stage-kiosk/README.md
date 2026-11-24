# AIRI Kiosk

`@proj-airi/stage-kiosk` is the full-screen AIRI surface for a restaurant kiosk with voice-led ordering and existing touch controls. It shares AIRI's local hardware UI and LLM tools; production PB uses the Electron browser adapter and does not depend on the demo `@proj-airi/order-menu` application. Demo simulation controls load only in development; the Server owns all ASR/TTS provider, model, voice, endpoint, and credential policy.

Use it for customer-facing horizontal or vertical kiosk displays. Do not use it as a replacement for the normal settings-oriented `stage-web` application.

Chinese conversation text, recognized-speech display, status messages and diagnostic
transcript headings use the shared OpenCC Taiwan Traditional converter. Speech
synthesis receives the same converted text. Ordering copy keeps 菜單 and 虱目魚
instead of OpenCC's generic word substitutions. Presentation uses copies: original
ASR, model history, tool arguments/results and raw diagnostic traces remain
unchanged for decisions and troubleshooting. Text typed into the simulation
input is also submitted unchanged. This normalizes Chinese writing; it does
not translate other languages or verify the truth of a model reply.

## Loading and model timing

The desktop 0.6.7 flight recorder keeps local PB/Host loading and performance
records automatically; see `apps/stage-kiosk-desktop/README.md`. This frontend
emits numeric timing envelopes for avatar, VAD and camera initialization. It adds
no customer prompt, loading overlay, retry or forced refresh.

PB Start does not directly initialize a local AI model. The avatar mounts with
the Kiosk, VAD initializes with the audio pipeline, and camera tasks start after
microphone permission settles (conditional Face may initialize later).
ASR and Kiosk TTS use server APIs. Audio acquisition uses Chromium in both
the Electron host and browser. No Hush/Python capture model is loaded.
Existing VAD/avatar assets retain their own loading lifecycle.

## Run

Start the menu service, then the kiosk:

```sh
pnpm --filter @proj-airi/order-menu dev
pnpm --filter @proj-airi/stage-kiosk dev
```

The layout follows the display orientation by default. Set `VITE_KIOSK_ORIENTATION=landscape` or `portrait` to lock a deployment to one orientation.

## Visual admission before legacy customer VAD

The shared device setting **Mouth-assisted voice detection**
(`mouthDetectionEnabled`) is off by default and is editable in both management
and the local Kiosk settings. When off, ordinary speech does not require a face,
mouth movement or current visual presence at capture, ASR or decision admission;
target changes cannot cancel its ASR. VAD segmentation, background-speech policy,
reception resets and browser-operation guards remain active. Camera observation
for greetings/reminders remains independently configurable. Saving a change
restarts unsubmitted audio capture and discards through the next silence rather
than interpreting a partial phrase.

When this setting is on, legacy ASR requires the configured camera target's mouth to move before a new VAD
phrase can start. MediaPipe reuses the existing Face/Pose lane and reads normalized
lip geometry only; no mouth images or second model are allocated. A held-open mouth
or small landmark jitter does not open the gate. This is visual onset admission,
not active-speaker identification; chewing, simultaneous speakers, camera angle
and lighting still require on-device acceptance.

The initial policy requires a lip-gap/width change of at least 0.02 across fresh
observations, with a current opening above 0.04. Closing the lips immediately blocks new
phrases; closure itself never renews the 600 ms onset window. Evidence expires
after 250 ms without a fresh valid target. An admitted phrase is permanently
revoked after no meaningful open-lip movement for the greater of 1 second or the
configured VAD silence duration plus 350 ms; reopening cannot revive that phrase. Large target position/scale
changes, missing or ambiguous faces, frozen video, camera restart and reception
reset invalidate pending legacy phrases. These thresholds require field tuning.

While closed, legacy VAD performs no model inference and retains bounded PCM
pre-roll, with a 400 ms minimum to preserve audio onset before visual confirmation.
Once admitted, VAD keeps processing through brief closed lips and its configured
silence boundary. Before legacy ASR, the same uninterrupted visual target must
remain valid and show recent meaningful mouth movement; sustained visual
inactivity, lost targets and truncated phrases are discarded with a retry
message. Discarded tails only run VAD to find silence and never create another
customer turn. The microphone and UMA-8 DSP stay running for pre-roll. Legacy
customer voice with mouth assistance therefore requires camera availability. Text input and the local
administrator's microphone test remain independent of this mouth admission.

Legacy customer tracking selects from the existing bounded multi-face results
before mouth admission; it does not let the single Pose result choose the speaker.
Candidates must be inside the observation zone. The interaction ROI, position near
its centre, frontal attention and apparent face scale determine preference. A
clearly better challenger must persist for 400 ms before takeover. Frame array
order is never an identity; ambiguous matches and evidence gaps over 250 ms revoke
continuity. Target replacement cancels unsubmitted legacy capture/ASR without
resetting the visitor or cart. This remains anonymous geometric tracking, not
biometric or acoustic speaker verification.

For legacy customer speech, the existing **background speech judgement** mode also
controls TTS interruption. **off** and **observe** stop playback after 250 ms of
consecutive VAD scores above the configured threshold while the same capture has
valid visual admission when mouth assistance is enabled. With assistance off,
the same continuous VAD rule does not require visual evidence. Inference gaps over 100 ms break that run; the configured
VAD silence tail is not counted as speech. No ASR result or semantic model decision
is required to stop playback in these modes. **enforce** keeps post-ASR semantic
admission before interruption. Observe retains its non-blocking diagnostic role.
Stopping playback does not cancel the active Agent or a dispatched browser tool;
new ordering demands still use the normal utterance queue and operation guards.
Cancelled playback does not automatically resume. The administrator's
microphone test keeps its existing interruption path.

## Speech recognition

Completed mono utterances use the configured Server ASR Provider and the existing
bounded utterance queue. Capture does not poll a recognition-mode endpoint or
collect synchronized mouth images. Optional mouth-assisted admission and camera
observation for greetings remain separate device settings.

## Live LLM replies

General service answers explicitly admitted as read-only, with no pending
question, menu lookup or operation handoff, run without tools and display actual
SSE text deltas before completion, including on a PB browser page. Draft text
never starts TTS or enters durable customer history. Ordering rounds still show
live operation progress and present their verified final receipt; partial model
arguments or unverified success claims are not customer-facing text.

## Kiosk appearance

The Kiosk uses fixed dark surfaces. Its HTML declares the dark theme before
rendering, and the root color scheme is dark so shared form controls and native
controls use light text even on a light OS theme. Body-level dropdown portals use
the same theme. Kiosk also declares its own paired dropdown background/text and
selected/highlight colors under `data-kiosk-theme="dark"`; this palette remains
dark with light text even if an inherited `.dark` class changes. This is local to
Kiosk and does not change Stage Web preferences.

## UMA-8 microphone processing

### November master audio restored (0.7.8)

Reference: master `b1a7f5b` (2026-11-10), microphone correction `326ff95`.
The original Worklet/Worker Spatial Mask, actual-channel detection and automatic
standard-microphone recovery are restored. Eight actual channels select Mask;
other inputs use browser speech processing. Dynamic spatial processing follows
TTS playback. Hush/native capture and algorithm/backend selection are removed.
The current Scene connects that browser boundary to current VAD/ASR and
optional visual admission. Install the paired full Electron package; current
ordering and tax-ID behavior remain. Physical Windows acceptance is required.

### Browser processing

In the administrator audio panel, select the physical microphone and use Auto
capture. Actual discrete Worklet channels select eight-channel Spatial Mask or
ordinary browser echo/noise/gain processing. Device labels never establish
channel geometry. Standard mode explicitly requests ordinary browser capture.

The November master Spatial Mask defaults to playback-aware dynamic processing:
directional Gate while listening, Binary Mask during TTS and its tail. Disabling
that option restores its Soft Mask. Existing mapping and radius keys are kept;
stop capture before changing them. Dynamic gain is +15 dB and Soft gain is
+65 dB, followed by the original shared PCM limiter. Physical echo quality and
channel mapping still need on-device verification.

Source reference: master `b1a7f5b` and the Nov9 correction `326ff95`. The
standalone LCMV/Mask comparison code is not the current production selector.
Hush, Python acquisition and its 250 ms host transport are absent. This change
does not roll back ordering, invoice, payment or tax-ID behavior.

## Development kiosk enrollment

Before a Profile is available, the kiosk opens an enrollment screen. In a local
POC, it creates a six-digit number and asks the Server to create a `DEV-`
device. The Server returns an HttpOnly device cookie; the kiosk never stores or
reads the credential itself.

```sh
KIOSK_DEVELOPMENT_REGISTRATION_ENABLED=true pnpm --filter @proj-airi/server dev
VITE_API_SERVER_URL=http://localhost:5168 pnpm --filter @proj-airi/stage-kiosk dev
```

The Server omits this endpoint unless the flag is exactly `true`, and always
omits it when `NODE_ENV=production`. A production kiosk will replace this
screen with the QR-code enrollment flow.

## Meal clarification

`pnpm -F @proj-airi/stage-kiosk test:history` replays sanitized historical
quantity and fulfillment claims through the current reply-grounding boundary.
Shared evidence is checked in under Order Menu's test-only `src/evaluation`;
reply tests stay in Kiosk so Menu does not import the Kiosk recording lifecycle.
These offline tests do not call Jev/Main, and partial historical evidence is not
reported as complete incident acceptance.

The default `test:run` suite also replays recent native PB incidents. It
follows cart navigation from a recognized checkout request through the
visible review question and a queued short confirmation into the invoice
step. It also covers an unsettled submission followed by a payment page
without editor tools, and a seven-digit tax ID fragment completed by a
separate utterance. These cases use reconstructed PB receipts and synthetic
customer values. They cover handling after transcription, not microphone
capture, ASR accuracy or live payments.

The owned menu supports a small yes/no meal-clarification flow. The host requests
it only after service admission and speaks/shows the exact browser-issued question
in the conversation. No additional floating Yes/No card is mounted on the menu.
Spoken repeats remain bounded while the voice question stays answerable until
its existing expiry; there is no instruction to click removed controls. Other service queries can
interrupt confirmation while retaining unadded meals. Background or uncertain
recipient speech stays silent; model/transport failures remain separate. Deploy
Server, Kiosk and Order Menu together for the new clarification tool and phase.

Availability follow-ups such as **我想問還有沒有** can read the dish in the
current confirmation without buying it, guessing quantity or asking the same
purchase question again. This read has an additional recipient check; ordinary
Yes/No answers still take one Jev call. Companion speech and uncertain recipients
remain silent. Named alternatives, categories and filters use normal routing.

## Fresh Main rounds

Each Main round sends the remaining Host task budget as `budgetMs`. Server keeps
one request deadline across reply repair and reserves time for a configured Main
backup. Provider timeout settings remain upper bounds; a tool continuation does
not renew the overall sixty-second task deadline. System One/Jev routing is
unchanged. Reload an already open Host after deploying this protocol update.

After phone entry, Main receives the complete compact catalog and current Menu
state through the host-only `kiosk_conversation_context` tool. The host refreshes
it before each model request, verifies task ownership, replaces old questions and
intersects tools with current phase capabilities. It preserves the immutable
read-only request boundary and never restores stale write permission. Pure store
FAQs and phone entry omit catalog details. Jev's context/order/thresholds are
unchanged; Stage Web is outside this integration.

Known operation handoffs retain effect and resolved targets. A successful lookup
of another dish cannot complete a known removal or fulfillment-change request.
Unclassified no-tool prose cannot report an operation as completed. Classified
service FAQs and bare greetings retain natural replies; uncertain operation turns
need an application question, a matching receipt, or a structured information
selection rendered from a fresh Menu context. Information selections cover
payment methods, fulfillment modes, literal menu-name facts and clarification;
they cannot contain operation-success prose. Offered payment methods are separate
from phase-specific payment execution permissions. The Server stores generated
prose as draft service events, and the host records only its validated final reply
as assistant history. Catalog inclusion and legal tool exposure are independent:
omitting menu details does not silently remove valid state/question tools. Owned confirmation
questions end the model loop without another completion call. Rejected tool
batches persist their receipts and stop without a speculative continuation.
The host records `main_task_metrics` service events with orchestration duration,
model rounds and tool count; these include context/tool waiting but exclude TTS.
Server separately records provider round sizes/latency/usage. Neither metric
stores the prompt or implies successful POS submission.
Timing/runtime diagnostics use a separate ordered upload lane so public-network
round trips cannot queue customer evidence behind diagnostic traffic. Main task
and presentation metrics do not delay a completed reply. Customer input, action
claims, tool receipts and pending questions retain their durable ordering;
diagnostics never authorize browser writes. Diagnostic metadata includes
`observedAt` because Server sequence reflects arrival order across the two lanes.
Both lanes retain the captured visitor session when a reception ends; late
acknowledgements cannot block or set the next reception's recording error.

PB planning currently assumes customers do not operate the website concurrently
with the agent. One utterance owns one validated editor snapshot, shared by model
rounds and tool planning; overlapping identical reads share the pending request.
The snapshot ends with the task or a replaced document/tool connection. A smaller
read can reuse a full catalog snapshot, never the reverse. Reads and receipts are
copied so consumers cannot mutate the retained facts.

Operations invalidate that snapshot before dispatch. Complete verified cart
receipts replace the whole cart without computing local deltas; same-store
navigation/checkout receipts update page and form state while retaining the
unchanged catalog. Missing/uncertain receipts force a new read. Cart edits with
existing checkout data refresh the form rather than retaining old totals or
confirmation tokens. Native write/version/specification checks, result readback,
customer final consent and one-use submission remain in place. Table discovery,
external payment settlement and explicit recovery remain live reads. This is not
a cross-utterance or browser-global cache and does not add screenshot inference.

External PB does not expose the owned Menu's `kiosk_conversation_context`.
The Server now selects one fixed workflow skill from the verified page and
pending task. Explicit Restart records a retired prior-operation warning as a
`browser_previous_operation_retired` event in the ending visitor's backend
interaction history. After the editable cart is verified empty, that historical
event neither blocks the next visitor nor appears in their conversation. Healthy
PB replies blocked by an unresolved operation are distinct from transport failure.
Selecting a table never fabricates an empty cart: meal tools stay
hidden until the native menu/cart can be checked. On the RD table page, customers
can use large buttons or name an offered table. A valid, unambiguous spoken table
now selects that table and presses Start once, without another Start utterance.
Approximate or ambiguous codes still require clarification; a confirmed table
then enters the menu. Menu readiness and matching table are read back before food
operations. Customers can say「重選桌號」「桌號錯了」to return to the same-store
table selector; this preserves the cart and never submits an order. No table is
invented from a missing or ambiguous code. Native Start never adds food or pays.
If a single explicit table code is absent from the current choices, Host replies
that the table does not exist and refuses a substitute selection or Start.
Jev/Decisions receives `selecting_table`, all actual table choices and the latest
visible selection as facts, without inventing a question the assistant never
asked. Ordinary actions use one direct choice request, with an optional recipient
check controlled by the Server-resolved device setting. A uniquely compiled
table action can be selected directly; absent or ambiguous codes still require
explanation or Main clarification. Unique dish-content reads and opening an
item window are separate candidates; neither authorizes buying that dish.
Full-document navigation revokes the previous transport and rediscovers tools;
it is not recorded as customer input or permission to replay a write.
An already-issued Start request may settle through that navigation with its
correlated, table-matched menu-entry acknowledgement. Disposed transports admit
no further calls; cancellation by the customer still ends the wait. A standalone
「開始點餐」waits for the replacement menu and then gives ordering guidance,
without making another Main round using retired table tools. Requests also naming food are not marked fully covered.
Native navigation emits `navigating` separately from `unavailable`: the Host
revokes tools until the real menu is ready. A small neutral loading indicator
appears after 700ms; short navigations show no interstitial. No merchant branding
or full-screen illustration is added. A slow
PB page load does not turn a previously acknowledged Start into a rejected call.

The selected Chat source's `auto` / `sse` / `json` response mode controls the
upstream transport. Eligible ordinary service replies paint incoming SSE text
before completion; JSON sources paint their complete reply at once. There is no
second display-mode switch. The browser still uses SSE for progress in both modes.

Incremental prose is allowed only without browser/finite reply context, pending
commerce validation, or tools other than read-only session history. PB ordering,
menu lookups, cart changes and checkout show live operation progress, then the
Host's verified reply. Model drafts and tool arguments never stand in for receipts.
The main conversation and detached text console share the visible reply; a new
request clears the console's previous reply while waiting. A cancelled/failed
round clears its draft, and stale cleanup cannot erase a newer turn. Only the
completed verified reply enters history or TTS. Internal service-admission
decisions keep JSON responses.
A current admitted request receives a non-operational clarification if its
independent review fails; cancelled or unknown/background speech does not gain
tool authority. Jev receives the actual visible product dialog separately from
cart contents, so closing a viewed dish cannot imply deleting a purchased meal.

Checkout cart confirmation lists all currently available invoice methods; a
plain "correct" never selects the website's default method. Invoice details and
notification contact entry remain separate steps. Native preparation scrolls and
focuses the current field after fresh validation, including the phone field once
the selected carrier is valid.

Inside the bound notification step, Taiwan mobile digits can arrive in separate
utterances or one spaced utterance. The Host accumulates the literal digits,
reads back a complete ten-digit `09` number, and fills it only after confirmation.
"重來"/a rejected read-back clears the draft; overflow is rejected without
truncation. The pending question's visitor, document, cart and 120-second expiry
own the draft, so reset/navigation/cart changes cannot reuse it. No phone fragment
or phone confirmation authorizes order submission; the final order summary keeps
its own separate consent. This validates recognized text, not microphone/ASR accuracy.

PB's verified dumpling extra is named `水餃1顆` (cart editor checked on
2026-11-16): an eight-piece base serving plus two extras is one ten-piece serving.
The compiler, finite purchase path, Server plan binding and read-back share that
option identity. Incomplete dumpling drafts ask for total pieces per serving
instead of exposing the merchant's “加量” group name. Piece-only answers retain
previously stated serving counts; explicit serving counts and split configurations
are kept separately. “正常” means the verified eight-piece base only inside this
bound question. Unrecognized answers re-ask only the current missing field; repeated failures
automatically retire the unfinished question and keep the cart. Main's new-request decision also releases the old question.
The native pointer and frames remain visible without floating action labels;
operation descriptions remain available in diagnostic receipts. Reapplying an unchanged serving count produces no write or
success receipt; Main must repair a customization request with the proper tool.

Final detail replies retain the website's meal contents as well as verified
prices. An `open_menu_item_details` receipt may include the whole rendered
catalog; only products matching that receipt's current `productDialog` are
used to answer. A successful detail window must not become a no-query fallback,
and failed or unrelated dialog data does not establish meal facts.

Promotion inquiries use `reply_to_customer` with `replyType=promotion-policy`,
not `ask_customer_question`. A malformed question is rejected before any PB read
or write and returned for bounded model correction. Customer messages do not
include raw Valibot errors; diagnostic details remain in internal receipts.
A validation error from website data does not authorize replaying a cart operation.
Unexpected runtime and transport exceptions also stay in diagnostic receipts;
explicit domain input errors retain their actionable customer wording. Batch
failures keep already verified cart changes, without exposing the underlying exception.
Natural category inquiries such as “有什麼湯” do not invent a configured category:
a mismatch leaves recommendation criteria intact and returns the current full
catalog for bounded correction. Main selects actual soup dishes from known facts
before presentation; keyword matching supplies candidates, not category proof.
Read-only query recovery preserves its lookup guidance instead of asking which
order to change. Unconfirmed writes retain their independent recovery rules.
For pending meal/checkout questions, two consecutive unresolved distinct utterances
retire the Host question and unfinished drafts without touching the merchant cart,
form, submitted order or payment. A valid answer clears the counter. The signature
binds visitor, document, cart and actual question content; a reissued UUID cannot
restart the counter, and an old in-flight answer cannot retire a newer question.
Natural refusals and topic changes release their old question too. No special
cancellation phrase is suggested or required. Release receipts end the current
model loop so it cannot immediately re-ask. This is dialogue recovery, not an
Electron process watchdog or automatic application restart.


The public tool registry owns names and JSON parameter schemas. The compiler
exhaustively handles every registry key; new keys require an execution branch.
Host receipts, Server repair routing and model hints translate native operations
through that registry. Public recommendation arguments are `names` / `purpose`,
whereas private presentation uses `productRefs` / `mode`. Readable cart targeting
uses the complete option summary (up to 2000 characters), never its fingerprint.
Unique published aliases are resolved consistently; shared aliases stay ambiguous.

A single recommended dish includes a bound one-serving offer. Assent to that
explicit offer (or an explicit serving-count answer) adds the complete meal once;
multiple recommendations ask which dish to order, with choices limited to the
actual presentation receipt and its order. The selected dish then asks for its
serving count; a simple complete answer adds once without an extra confirmation
or Main round. Original recommendation speech is retained separately from this
bound selection intent; required customization still goes through clarification.
Optional add-on groups do not block an accepted base serving: fresh configuration
validation keeps their selection empty and executes the sealed serving once.
Required groups become durable draft slots without re-asking product/count.
When unparsed notes or options need Main, the consumed selection survives only
within the same utterance ID, question deadline and unchanged visitor/document/
cart/configuration binding. Main receives the actual original request and bound
count, retains the unresolved conditions, and still needs independent admission.
The current customer transcript remains immutable; prior request/answers travel
as separate evidence rather than being pasted into a new customer utterance.
Recommendation receipts with questions stay on the normal validated reply path
so text/playback-driven highlighting is preserved. A recommendation alone is
never purchase consent. Pending questions remain visible to Jev even while a
keyword search is active; unsupported wording is resolved semantically or sent
to Main. Public tool receipts retain the same question IDs as native receipts.

Complete customer-evidenced order drafts execute immediately after the last
required field is answered; they do not issue a second add confirmation.
Successful cart receipts omit routine "尚未送出訂單" disclaimers. At final reply
presentation, `checkoutInvitation.ts` reads back the same verified nonempty cart
and asks "要結帳嗎？" once. This does not interrupt a multi-tool turn. Yes opens
the native cart for review, no keeps ordering; neither submits or pays. Unknown,
partial, stale or still-incomplete operations never produce this invitation.
The presenter records its structured question as `browser_question_presented`,
so later semantic answers use its exact ID rather than guessing from prose.

Cart 加點 uses `browser_return_menu`, preserving the order and retiring pending
draft questions and website search. Existing-row 增加份數 remains a final-total quantity change.
The Host now uses the same concept: before every Main round it reads fresh PB
facts internally and replaces `browserContext` with the current catalog and
configurations, visible cart, provided fields, unfinished dish, pending question
and phase-legal tools. The Server presents this as a plain-language
`currentActivity`, one `pendingItems` list and the actual `currentQuestion`;
Host phase codes and private question tickets stay internal. Model-only tool
results use `outcome`/`cartEffect` with relevant facts and repair reasons instead
of technical status envelopes or execution traces. This does
not consume an answer or claim that a dish is displayed. Closed pending answers are consumed by the Host only after canonical user recording.
Public `list_cart_items` stays a pure read. An answered count with unresolved
options continues in the same Main task, with the original request and resolved
fields, without duplicating the customer record. Otherwise the model can act
on the fresh projection without an extra preparation call. Visitor dialogue
uses the same bounded history as the owned Menu;
past raw tool payloads are retained for audit rather than replayed as fresh facts.
Closed literal answers to current draft count fields, complete confirmation and
cancellation can run as Host operations after durable user recording, without
another Main selection round. Preparation never consumes the question; execution
rechecks native bindings and saves the receipt as `browser_question_answer`.
These turns report zero Main model rounds, not a fabricated model tool call.
Other answers, corrections and new requests retain the normal planner path.
Jev is an optional admission/intent path, not the owner of PB cart or dialogue state.
Quantity questions are offered only for a known target with a missing count;
literal serving extraction masks product names such as 三杯雞 and excludes
party-size/add-on units. These fields never establish purchase consent.

PB Main receives 17 business operations from `stage-shared/ordering-tools`,
executed by `services/browserOrderingTools.ts`. Models supply meal names,
configuration names, option names and serving counts. Host resolves current
native IDs, versions and website prices; these are omitted from public model
projections. `add_items_to_cart` takes additional servings;
`set_cart_item_quantity` takes the final total; removal and replacement are
separate actions. Batch inputs are validated before the first mutation, and
later failures retain prior verified receipts. Model tools do not submit orders,
payments, arbitrary browser commands or multi-item price calculations.

The public vocabulary and parameter schemas are owned by `ordering-tools`;
`browserOrderingTools` compiles them to the existing private `browser_*` site
executor. Native names are not additional model choices. Tool recognition,
result projection and continuation policy must use that same mapping. An
unavailable model call is never dispatched as a native alias: only a proven
no-effect correction may return to Main, with current allowed names.

PB completion follows current-turn evidence: a validated question waits for the
customer; missing options continue the same task; missing/failed native write
receipts remain unknown and stop a batch. Definite pre-effect decision failures
handoff to Main. A final provider/site failure gives normal customer guidance
for continuing on screen or reviewing the cart, retaining the failure internally.
This guidance never marks an order successful or retries an uncertain write.


For the approved eight-piece dumpling product, a piece-only order such as
"10顆" means one ten-piece serving after the product has been established.
"10顆2份" keeps two ten-piece servings; "一份十顆、一份正常" keeps separate
ten-piece and basic eight-piece configurations. A live quantity question can
accept the complete piece reply locally, with fresh product/cart validation.
Names alone, relative extra requests and price questions do not gain purchase
consent from this convention. `piecesPerServing` supplies the total pieces in
each serving; Host derives the extra option count and current
website price. `quantity` always counts meals. An explicit `copyFrom` preserves
a uniquely identified cart meal's options and note. Same-product replacements
patch only specified options (`quantity: 0` removes one), note or pieces; other
customization stays intact. Different-product replacements start from that new
product's configuration. Equivalent split rows can be adjusted/replaced together;
different options, notes or prices require a specific target. Complete literal
piece-and-serving requests have a compiled Jev candidate; mixed/uncertain
customization remains with Main.

`list_menu_items`, `get_menu_item_details` and `list_cart_items` only read facts;
they do not consume pending answers or present cards. `ask_customer_question`
uses a bounded purpose and Host-generated question; `reply_to_customer` takes a
reply type, not arbitrary text. Simple explicit purchases and no-option quantity
answers add directly. Bare assent to a recommendation still asks purchase/count.
Declining cancel-and-search restores the previous question. Complex draft state
remains Host-owned and is not public native `browser_order_draft` permission.

Page/task/cart filtering is `availableOrderingTools`. Table selection exposes no
cart tools; menu location does not prevent cart edits. The current visible cart
is used without inferring its operator from a local reception ID. Unreadable
cart data still prevents assisted writes and never hides PB's manual controls.
Explicit Restart uses read-only preflight; only the table route requests private
cart admission. Menu reads cannot dismiss announcements as a preflight side effect.
If table cart reads require Start, Restart uses the actual selected table, then
verifies/clears the editable cart and reloads entry. All steps remain visible,
without Host loading or PB maintenance overlays. Current uncertain commerce still
settles through its operation coordinator; historical warnings are retired only
after the existing empty-cart verification. Normal phone, invoice, payment and
administrator dialogs retain their existing UI.
Ordinary table context never exposes prior cart contents to the models.
A3/A03 resolve to the one actual current table. A compressed code such as A31
may suggest A3-1 only when no actual A31 spelling exists. Host asks a bound
`browser-table-confirmation` question first; assent selects the actual website
table once, without pressing Start. Multiple split matches require a specific
choice. Refusal selects nothing. Visitor/document changes, manual table changes,
list changes, explicit Restart and expiry revoke the question. This is a hosted
frontend flow using the existing 0.6.5 native exact-table tools; no EXE update is
required. Exact `A3之一`/`A3之二` forms keep their normal selection behavior.
Native dropdown clicks synchronize the large selector; a website default alone
is not customer consent.

Jev finite candidates cover simple unique additions/aliases, missing quantities,
current finite answers, table selection/start, cart review/return, simple unique
row edits/removal and random recommendations of up to three real items.
Uncompiled/uncertain requests go to Main. The real wording endpoint timed out;
no measured new Jev accuracy is claimed. The opt-in comparison harness is
`apps/server/src/services/domain/kiosk-interaction-decision/pbToolWording.test.ts`
with `JEV_TOOL_WORDING_URL`. No new live accuracy/performance result is claimed.

`recommendationSession.ts` owns reception/category price scope and additive
name exclusions. `list_menu_items.criteria` patches the state; `allowedTerms`
relaxes only specified exclusions. A price-range question clears only price on
an accepted yes; no retains it. Names are not allergy/ingredient guarantees.
Jev recommendations use this same pool. Separate semantic candidates distinguish
ordinary recommendations from other recommendations that exclude the last shown
batch; replay uses the actual batch. Observed name fragments constrain display
references and are sent as possible catalog evidence; they never become aliases
or authorize a cart write. Candidates list the actual proposed dishes. More than
three explicitly matched dishes require Main rather than silent truncation. Simple complete additions of up to three no-option meals
can form one finite candidate; incomplete batches go intact to Main.

Customer messages appear on final recognition, with per-request visual status.
`conversationMessages.ts` groups late replies under their originating utterance;
it does not reorder durable/model history. Original speech links to the exact
once-only transcript entry and captured visitor session. Closing a reception
detaches its append chain as well as model work, so late acknowledgements cannot
block new records or set the new session's error state. No timestamp/order joins
are used for audio; unlinked retained files remain available in Admin.

The yellow voice panel reports microphone/VAD/ASR, blocking reasons and TTS overlap. Voice and presence diagnostic panels retain their existing
switches and authorized operator visibility. Their headers now drag within their
host region, with position reset and resizing bounds so Electron's native menu
cannot cover them. They include the anonymous target revision/switch reason and
the local interruption state/background mode; no new always-visible panel is
created.
Kiosk Admin has a separate microphone/TTS/interruption test switch, also usable in
text mode. Its cancellable audio lifecycle never enqueues ordering work or adds
customer dialogue. Closing Admin stops this test. Physical microphone/echo and
full Kiosk/merchant acceptance remain separate validation requirements.

Server plan admission binds public tool arguments to the compiled native effect,
including one-use slots for each batch item. Finite cart edits record their own
authority and native operation names. Published aliases are scoped to the session's
immutable service binding. A batch stays in one Host task so later steps retain
earlier receipts. Read-only public facts can finish with a website-derived summary;
a subsequent actual presentation replaces preparation prose. Cart configuration
parameters use the readable option description, while native fingerprints remain
private. Searching another dish while waiting for quantity asks to cancel first.

Tool `nextActions` describe available navigation only. A single final renderer
adds one next-step offer if no live question/guidance already exists. Partial or
unknown receipts do not suggest checkout; no extra Main polishing round is added.

Service questions also offer semantic information choices for the actual cart,
plus a new-request handoff for other demands. Jev can answer a serving-content
question through a fresh detail read without accepting checkout or changing the
cart; the obsolete service offer is retired. Known PB dumpling facts are included in
detail reads, recommendations and quantity questions even when the merchant's
description field is empty; one serving keeps the verified eight-piece default.

On the cart page, `continue_checkout`, `choose_invoice_method` and
`set_invoice_notification_phone` expose the next actual checkout steps. Cart
review reads the dishes/servings/website amount before asking for confirmation;
its assent advances to invoice choices, never submission. The spoken review asks
only whether the meals, quantities and amount are correct. A live answer is
resolved before a repeated open-cart tool, so assent does not restart review.
The website's preselected invoice radio is not a customer choice: entering
checkout from an already open cart also asks the invoice method before contact
details. After choosing no carrier, the next step asks for notification contact;
other methods first collect their required invoice fields. Carrier/citizen codes may be scanned directly after method selection with a
keyboard-emulating scanner, without clicking the merchant input first. Prompts
explicitly mention barcodes/QR Codes; supported payloads remain the merchant
carrier/citizen formats, not arbitrary QR URLs or a camera decoder. Donation
codes accept a complete spoken 3–7 digit number, preserving leading zeroes. Host
reads the digits back and binds confirmation to the current visitor/document/cart
and checkout form before invoking `browser_invoice_donation`. This native
capability is not a model-facing tool and requires Desktop 0.6.11 or later. It
fills only the selected donation field, then rechecks checkout; no submission
consent is granted. Email may be entered on the website; phone drafts must match
the current customer text.
Tax IDs support segmented spoken eight-digit input, including Chinese digits and
leading zeroes. Short replies append; a complete eight-digit reply replaces the
buffer. “重來” clears it; “更正／改成” starts a replacement. Host reads the complete
number back before the one-use `browser_invoice_tax` draft action. Partial input
and confirmation both expire after 120 seconds and are revoked by form, cart,
visitor or document changes. Attached ordering requests are not parsed as digits;
overflow clears the buffer without truncating or padding. Manual input remains
available. This requires a rebuilt Desktop native bundle and matching Kiosk
frontend; older installed executables do not acquire the tool by refreshing.
Checkout recovery compares visitor/document/cart-bound form observations across
utterances, excluding refreshed confirmation tokens. Two completed answers after
an unchanged entry prompt rebuild invoice choices, or request a spoken contact
number; repeated unexplained readiness failures pause the stale completion prompt.
Two explicit no-effect operation failures rebuild invoice choices from a fresh
read. Unknown/pending effects never enter this recovery path. `CHECKOUT_RECOVERY`
receipts record reason, step and count without field values and end the current
model turn, so Main cannot immediately recreate the old loop. Native fields and
cart contents are preserved. This is bounded checkout recovery, not a process
watchdog or a guarantee that missing merchant data can be repaired automatically.
The final submission question includes meals/options/notes, website total,
table, invoice and notification details. Its native token is private, expiring,
one-use and invalidated by any cart/form/manual-interaction change.

Automated submission is enabled for the authorized `app.esgpb.com` store
`1kgJeql` internal-use journey and the approved owned fixture at `127.0.0.1:5188`.
After the final-summary assent, Host presses both native confirmation buttons;
other deployments retain manual guidance. An unknown result is never retried.
Merchant acceptance still requires an actual result readback; isolated tests
do not prove a merchant order was created. A dispatch acknowledgement is not proof
of payment. The owned fixture returns a typed pending/accepted/unknown/rejected result.
Accepted merchant creation is separate from amount/detail consistency: a known
created order with a conflicting total remains accepted and requires review,
while unknown effects retain the pending marker. Line equivalence and a lost
full-navigation promise observer are not yet implemented.
The correlated typed result retires the editor tools even after SPA navigation;
a reception restart reloads the configured table entry instead of invoking old
cart controls on the result page. Late replies cannot retire replacement tools.
Result pages gain no automation privileges. This does not certify merchant
submission/payment, post-payment completion or voice operation.

Each published ordering site may carry `catalogLabels` configured in Admin's
interactive-service editor: exact current product name, aliases and category.
Only a unique exact name in the fresh catalog receives those discovery labels.
Absent, renamed or duplicate-name products receive none. Main and Jev see the
labels; shared aliases still require formal-name clarification, never an arbitrary
purchase. Label/category searches present verified native refs and clear stale
native text filters instead of searching PB for an alias it does not know.
Labels cannot override price/options/availability or establish ingredient/allergen
facts. Changing published labels uses the same customer-reset barrier as changing
the merchant. Existing profiles need no migration; publish after saving edits.
Recommendation rotation also uses Host state: only a successfully shown native
recommendation batch is remembered for the current visitor/document. Only
`purpose=other-recommendations` excludes that batch; ordinary `recommendation`
preserves the supplied refs, including previously introduced named matches.
`information` remains passive. These are purposes of the existing
`point_to_menu_items` tool, not additional tools. Host never invents replacement
products. Informational speech cues do not rotate that history.

Full production, speech/hardware and arbitrary compound-correction acceptance
requires separate validation; the live menu may lack multiple required groups.

## Verified conversation replies and retries

Non-operation answers use the Server's finite `respond_to_customer` tool and a
shared typed reply. The host renders current payment/menu facts or neutral
clarification, greeting, acknowledgement and hearing-check text. Unverified model
prose is not streamed into these customer replies. A malformed/no-tool draft gets
one selection repair with only the original utterance and fresh context, without
commerce tools; invalid selection clarifies, while provider failure remains an error.
Operation success still requires its browser receipt.

A manual conversation retry retains the original text and request lineage, reads
fresh session/document/domain versions, then enters the normal utterance queue
and decision flow. Changed ownership, cart, checkout or active question expires
it; double clicks cannot submit twice. Recommendations, displayed menus and writes
are not transparently replayed after an uncertain result. Ordinary semantic
uncertainty is not a technical-failure retry prompt.

## PB operation plans, progress and speech

Normal PB writes use `browser-plan` one-use admission. Main-authored additions
also independently check counts, per-serving configuration and requested notes,
including when Main omitted a note. Contextual existing-cart changes receive
independent interpretation; simple finite-compiled additions keep their fast path. Jev selects a bounded intent and the
Host compiles current literal slots; requests beyond its complete compiler
coverage first pass independent recipient and service/background admission,
then go intact to Main. Pending PB questions use the same admission path without
reading or consuming their one-use answer during candidate discovery. After
admission and canonical recording, closed count/confirm/cancel answers can be
resolved directly by the Host; semantic answers retain the Main/Jev resolver. Main
supplies its recorded structured tool call. The Server matches the current canonical `user_text`, rejects read-only or
changed proposals, and consumes the issued plan once under a database row lock.
The Host still checks active task/document scope, ambiguity and fresh vendor versions;
only a verified browser receipt can claim an effect. Necessary follow-up answer
resolution remains a separate semantic task. Uncertain ordering meaning may
create a complete sealed confirmation question, without writing; factual
read-only inquiries cannot create purchase confirmation. Background speech does
not cancel accepted compound operations.

Customer order checks use `browser_cart_review`: the Host opens the native
review directly, then checks the current cart version before asking for confirmation.
It does not infer the cart's customer or consume a pending product question.
Review has no model-controlled parameters: Host invokes the fixed native
capability with `{}`, so extraneous model fields cannot change the operation or
trigger a schema-repair loop. This policy applies only to the argument-free
read-only review; cart writes retain their full argument validation.
Pure review/preservation requests use the read-only cart review. If Main instead
proposes setting an observed line to its existing count, an independent semantic
check may recognize whole-order preservation and dispatch only a fresh
review. Actual count changes and other write kinds keep their original policy;
partial preservation alongside a requested change does not settle that change.

Catalog observation is internal evidence. Main explicitly presents selected live
products or reports that the requested information is unavailable. Cart receipts
include vendor-confirmed options and notes. An unfamiliar product name requires
confirmation of the official product and configuration before addition, even
when only one candidate exists. Failed literal name queries first use the shared
current-catalog fragment discovery to narrow related confirmation choices; no
fragment is stored as an alias or accepted as purchase consent. Pending-answer understanding receives bounded
cart labels and quantities, without executable row IDs; existing freshness and
active task/document checks still apply before any effect. Browser context failures use
the website recovery message rather than a Jev uncertainty message.

For equivalent split rows, `browser_cart_quantity` and `browser_cart_remove`
accept `lineRefs` including the explicit `lineRef`. Quantity then means the final
group total. Groups must have the same product, configuration (including note)
and unit price. The native coordinator verifies each intermediate full cart and
stops on manual activity or uncertain effects. `browser_cart_replace` accepts
`retainQuantity` for the servings that keep the original configuration; the new
configuration is verified before the original row is reduced. Omitting it replaces
the entire original row. Initial orders with mixed options are split into their
requested configurations, rather than adding the base total and extra meals.

The current native PB row binding requires a unique observed and rendered
name/quantity/unit-price combination. Equal signatures remain blocked even if
configuration labels differ; PB's actual rendered option/note binding still needs
verification when the merchant site is available. Do not choose a row by position.

External Main tasks capture retry evidence once at their original demand. A
manual retry compares fresh state with that anchor; later rounds cannot silently
rebase it, and an effect attempt revokes it. Cart-only edits do not fetch product
configurations. If the initial retry-evidence read fails, replay stays disabled
for that demand; the new demand may still use tools with their normal fresh
document/cart checks. Explicit recovery still requires a verified
settled receipt. After Main selects and the browser verifies an exact, fully
covered single removal/quantity utterance, Host may finish from that receipt
without a prose-only model round. Compound/trailing requests, unknown results,
questions and uncovered wording continue through the normal flow.

The PB hand follows the native controls for search/open/options/quantity/note/add,
cart navigation/edit/remove and draft reset. The runtime no longer pairs a hand
animation with a hidden cart API write. Unsupported or ambiguous vendor shapes
stop for customer clarification, without choosing a mandatory option or first row.

`utterance_timing`, `browser_tool_metrics`, existing Main round metrics and Jev
traces correlate by utterance/operation. They distinguish admission/feedback,
model rounds, control steps, verified text, TTS requests, first playable sentence
and first playback; overlapping durations must not be added. Read-only recovery
receipts accept validated execution diagnostics too.

Timing snapshots carry monotonic revisions, task/speech boundaries and outcomes.
Progress and final-reply speech have distinct channels. A cancelled speech turn
does not undo a separately verified cart receipt. Consumers must reconcile
snapshots per utterance rather than add their cumulative durations together.

`kioskSpeech` plays verified reply sentences with at most one sentence prefetched.
Cancellation aborts synthesis and playback; prepared audio plays once. This is
sentence segmentation over the configured MP3 gateway, not a claim of streaming
provider support or word timestamps. Complete verified text stays visible.

## Uncertain service recovery

An eligible, valid Jev service abstention can request one no-commerce Main
adjudication, followed on REQUEST or UNCERTAIN by one richer contextual review.
Admission and understanding are separate: unclear service speech asks for meaning
before Main receives a task; it does not revive an older ordering question.
This is separate from a real Main Agent task: it admits service meaning, never
an operation. A review can ignore, abstain, hand off the original request, or
create a read-only service question. Its answer cannot consume an older Menu
purchase/payment question. Independent new requests leave that clarification
without inheriting its authority.

`SERVICE_RECOVERY_PROGRESS` reaches the host before the provider starts. Explicit
text shows receipt immediately, elapsed time, and a longer-wait message after
five seconds. Background/uncertain text ends with a status; failed pre-operation
recovery offers a manual retry through the decision flow. Unadmitted ambient
voice stays silent, without a customer bubble or waiting speech. Inspector
stages distinguish Main recovery from Jev; Main progress does not inflate Jev
counts. A new explicit text correction can cancel pre-operation recovery;
accepted browser writes retain their existing receipt/settlement rules.

Shared `serviceRecoveryLimits` sets 8s adjudication, 12s review, a 60s turn budget
and 15s unconsumed checkpoints. Formal Main receives only the remaining budget.
The 60s limit stops further model planning; accepted tools still settle through
their authoritative receipt, rather than being declared unexecuted on timeout.
Phone entry, camera gating, current target/revision checks and ordinary strong
routes retain their normal behavior. Current recovery primarily begins after
finite operation interpretation has abstained, so service REQUEST usually hands
off to Main instead of rerunning Jev from the beginning.

## Menu acceptance trials

In development mode, open Kiosk administrator mode and **點餐體驗情境測試**.
Choose a dish and set **可點**, **售完**, **狀態不明**, or **選取時失敗**.
The embedded owned menu must also run in development mode. These controls call
its host-only `kiosk_test_menu` tool and never become Agent tools. They are
absent in production builds and do not save/publish device settings.

Touch cards and voice reads use the same page state. Sold-out/unknown controls
are disabled; a selectable-looking failure refuses the selection, preserves
the cart and becomes unknown until the operator changes it again. Refresh the
panel to read the latest state after an interaction. Reloading the menu restores
its catalog states. These trials test audience acceptance without remaining
inventory counts; they do not implement control of a third-party ordering page.

## Owned-menu checkout test

When the owned menu exposes its phone-entry capability, the Kiosk renders the
optional phone form as a local overlay in the host ordering region, above the
iframe. A 25% dark mask leaves the menu visible; its scrollable dialog stays
inside that region. Upper avatar and conversation controls remain interactive. It does not use document-wide modal
blocking.
The entry screen leads with saying “略過” to start voice ordering; the phone
form and touch skip are secondary. Its listening label follows the host VAD
readiness, and an inactive microphone points to the touch fallback.
Touch submit uses host-only `kiosk_customer_phone`; voice and touch skip share
`customer_skip_phone`. The modal closes only after reading the ordering phase;
errors retain its controls. Discovery replacement/unmount drops the local draft
and ignores old reads. Phone input is not an Agent tool or model context. The
old full-page Menu entry is removed. Standalone Menu opens the catalog directly;
`kiosk_customer_entry_start` offers phone entry once for a fresh Kiosk order,
without reopening after a choice or cart activity. The menu remains inert while
entry is pending. Deploy Menu and Kiosk together.

The customer must enter a valid phone or explicitly skip before any menu query,
recommendation, selection, cart edit or checkout. Menu questions return the fixed
localized `CUSTOMER_ENTRY_REQUIRED` prompt without Main generation or menu reads.
Phone entry remains voluntary: choosing skip is sufficient. Store facts and
identity/phone-use explanations remain available without commerce tools.
The host rechecks entry before presenting a tool result: if a new session has
restored the phone screen, an older receipt cannot bypass it. The menu runtime
also rejects both Agent and manual menu reads/writes until entry is complete.

Food requests admitted as `MENU_QUERY`, and other ordering handoffs with current
product/category matches, carry a host-owned `requireMenuRead` guard. An ordinary
handoff without a classified reason also requires evidence even with no catalog
match; `GENERAL_QUESTION` admits identity/service explanations directly. The
guard survives repeated state projection. Old cart
references alone do not force identity dialogue through menu tools. Phone entry
still admits only its explicit factual-query route through this guard.
Pure factual inquiries and unresolved filter/price handoffs also carry
`readOnly:true`. Kiosk binds that capability to the owned menu task and keeps
the read-task snapshot on every model continuation; receiving a menu result
does not authorize an order edit or answer the pending fulfillment question.
Ordinary mutation tasks keep their initial snapshot only, since their own tools
may advance checkout. A new customer turn receives fresh task authority.
Repeated unchanged recommendations pause unsolicited prompts instead of requiring
touch input. The persisted/wire mode `touch_preferred` now waits for the next
directed customer request while retaining normal voice service. Background and
uncertain-recipient speech still follow the existing admission rules.
Main query requests use Menu's explicit `continue`/`update`/`reset`/`clarify`
actions. The browser owns current conditions and shown history. Clarification
receipts are spoken through the existing verified menu-reply path without
presenting dishes or a floating choice panel; the API settles that question
without an additional model continuation. Updating query scope does not write
the cart or start checkout.

Each customer turn can display only one recommendation batch. After a successful
recommendation read, Kiosk removes recommendation/display tools from subsequent
model continuations and acknowledges repeated recommendation calls without
executing them, including calls in the same batch and broad visible `menu_get`
reads. Named comparisons, internal `display:false` evidence reads and other
permitted operations remain available. A new customer turn resets this budget,
so an explicit request for more can display the next batch.
The Server requires a fresh menu tool call before an Agent final answer;
Kiosk rejects no-receipt prose even if a provider ignores the tool requirement.
Ordinary identity/phone conversation remains natural. A disputed recommendation
uses named `menu_get` verification and presents its concrete correction/result.
During quantity collection, correcting “不是要點，只是問有沒有” abandons that
unadded draft and reads its dish, without another quantity prompt. Plain
“不要水餃” cancels only that draft, preserving the cart.

The owned Order Menu offers invoice inputs without a paper option, and uses
LINE Pay/街口支付 method selection followed by an explicit simulation button.
Dine-in does not ask customers to select a table. Accepted
dine-in receipts retain the continuation QR and clickable desktop link until
the customer acknowledges carrying away the order; table binding is then
confirmed on that independent page. See the Order Menu README for expiry,
public-URL setup and the fixed A08 desktop scan simulation.

Jev admits questions directly addressed to the assistant about identity/name/
capabilities through the shared service policy. A plain Main Agent reply without
a new question receipt tells the owned menu to revoke older answer tickets;
financial confirmation remains one-use and must be asked again after a side
conversation. The Server scopes checkout dialogue independently from earlier
ordering chat without deleting its durable transcript. Deploy host and menu
together for the `interruptsQuestion` presentation field.

## Registered interactive pages

For an admitted service request whose operation remains unresolved, the Host
keeps Main read-only in every phase unless a resolved effect handoff supplies
the existing narrower tool authorization. Service admission alone cannot modify
a cart or fulfillment mode. After a completed Main turn with no business tool
attempt, the Host reads fresh Menu context and can replace unverified prose with
an application-owned spoken clarification. This follows the assistant message
path without a retry button or an invented operation result, and owns the next
answer instead of reviving an older purchase question. Provider failures and
attempted operations retain their failure/receipt rules; unknown write results
are never silently retried.

The Kiosk can host multiple customer interaction pages while keeping ordering as
its primary flow. In administrator mode, open **互動服務** to add or edit the
local allow-list. Each entry must have an enabled switch, stable ID,
customer-facing name, iframe URL, and a description that tells AIRI when it may
open that page. Disabled or incomplete entries are not embedded and are never
made available to the Agent, so a customer message cannot open an arbitrary URL.

`restaurant-ordering` is the initial page. Use `VITE_ORDERING_SCENARIO_URL` to
configure its deployed URL only for a fresh browser Profile; it defaults to
`http://localhost:5166` locally. Once an administrator saves a URL in **互動服務**,
that `serviceUrl` is the exact iframe URL and takes precedence over this variable.
`VITE_AIRI_ORIGIN` belongs to the embedded service's parent-origin allowlist; it never
changes the iframe URL.

The owned Order Menu uses Eventa `window-message` for tool discovery/execution.
`ScenarioSurface` binds `interactiveServiceClient` to the exact iframe Window
and approved URL after load. A five-second handshake admits tools; replacing
the frame revokes old descriptors and pending calls. Discovery alone can retry.
Tool execution has a sixty-second receipt deadline and never automatically retries
an operation; a lost receipt revokes tools because the write may already exist.
Disconnected speech does not repeatedly enter Main Agent. Automatic recovery
rebinds the same document and inspects the original operation IDs without
replaying them. Recovery waits until all accepted calls have settled, reads fresh
Menu state and ends only a host-owned settled task. Pending/missing results,
another task owner, and a replacement document remain blocked; recovery does not
reload the iframe, clear a cart, advance recommendations or retry a payment.
The Menu preserves its task locks, tool authorization, recommendation state and
cart/checkout rules. Matching Kiosk/Menu versions are required. Native WebMCP,
Origin-Trial and iframe `allow="tools"` are not required for this path.
The current integration targets `http://localhost:5166`; administrator-saved
service URLs retain precedence. Stage Web migration and DaMai integration are
outside this change.

The interactive iframe delegates geolocation to its source origin so embedded
services can request location with the user's permission. Production pages must
use HTTPS. If the deployment sets a `Permissions-Policy` header, its geolocation
allowlist must also include the embedded service's origin; the iframe cannot
override a restrictive response header.

Assistant control and iframe rendering are separate capabilities. When tools
are unavailable, Kiosk leaves the service screen mounted and tells customers to
use it directly; it does not treat missing tools as proof of a failed menu load.
Reloading, changing the configured URL, or unmounting the surface revokes old
assistant handles immediately. Pending discovery waiters reject on document
replacement, and removal of the last discovered tool revokes readiness.

Embedding a third-party site does not give the Agent access to its DOM or
business state. Assistant control requires the site to implement the approved
interactive-service protocol and expose its tools; this
host does not implement a general browser-control bridge. A third-party checkout
screen also cannot automatically report completion to the host unless an
integration supplies a validated result. Manual iframe checkout alone therefore
does not certify Agent operation or Kiosk session completion.

### Third-party iframe compatibility checks

Run the real-browser loading check before adopting an interactive service:

```bash
agent-browser skills get core
python3 scripts/checkInteractiveServices.py \
  --expect-text '大腸臭臭鍋' \
  --output /tmp/airi-compatibility-report
```

Run from the repository root with Python 3 and the installed `agent-browser` CLI.
Set `AGENT_BROWSER_BIN` when the CLI is not on `PATH`; `--chrome` can select an
installed Chrome executable. The defaults check the two Damai demonstration
URLs; repeat `--url` to check other explicitly approved services and choose menu
content for `--expect-text`. Use a new output directory for each run.

The check owns a temporary loopback fixture and an isolated browser per service.
It uses headed Chrome by default: on 2026-10-16, Damai's API preflight returned
CloudFront 403 for a HeadlessChrome User-Agent and 204 for a regular Chrome
User-Agent. Do not infer a customer-browser failure from a headless-only result.
`--headless` is a diagnostic control, not the acceptance baseline.

The report separates visible menu content, HTTP failures and incomplete network
observations. A loaded iframe alone does not prove its internal requests work.
Reports omit request credentials, response bodies and URL queries; raw HAR files
are deleted unless `--retain-raw-har` is explicitly supplied. Review screenshots
before sharing them. Verify the report analyzer with
`python3 scripts/checkInteractiveServices.test.py`.

This is a loading check, not checkout or Agent acceptance. The script never
clicks service controls, signs in, grants location consent or submits orders.
Test the actual production HTTPS origin separately, including third-party
storage, authentication redirects, payment windows and completion behavior.
Cross-origin iframe content and failed API responses cannot be inspected or
repaired by ordinary parent-page JavaScript. Tool control requires an explicit
connection implemented by the embedded document; menu visibility does not establish Agent
control. No automatic order retry is safe after an uncertain submission.

### Actual Webnavior / PB Agent integration prototype

The following controller-assisted experiments do **not** deliver zero-install
PB control in an ordinary Kiosk browser. The current requirement keeps the
original PB iframe URL and excludes per-client extensions/controllers; its
feasibility gate and current evidence are in the
[integration plan](../../docs/plans/2026-10-28-windows-kiosk-browser-companion.md).

To audit that gap against the actual running local Kiosk, use
`node scripts/inspectPbClientCapabilities.mjs`. This is a read-only diagnostic,
not a new runtime service. It opens an empty disposable installed Firefox,
enrolls a development device through the real UI, and checks the existing
discovery protocol plus PB's native `search_product` message without injecting
the PB bridge. It records only capability markers and request method/path
metadata under `output/playwright/pb-client-capabilities/report.json`. The local
API and Kiosk must already be running with PB assigned. Device audit records
remain; no retained account or personal browser profile is used. A completed
audit may report no available tools; that is not a successful ordering test.
Login-only capabilities are outside this anonymous audit's coverage.

`--retained-profile` additionally checks first-party authentication in the
previously authorized dedicated Firefox profile and, only if authenticated,
applies the existing approved Cookie preparation before the same native-message
audit. This mode uses the controlled profile's scoped storage policy; it does
not prove zero-configuration client compatibility. Close other controllers for
that profile first. Results go to `output/playwright/pb-retained-capabilities/`.
If first-party login has expired, authenticated interfaces remain untested.

For the approved PB Shalun store, the local-only experiment now uses this actual
Kiosk and its Server Main Agent, rather than a separate iframe fixture. Publish
`https://app.esgpb.com/order/store/1kgJeql/pick_up/menu` through the existing local
Admin, start the API and Kiosk normally, then run from the repository root:

```bash
node scripts/tryWebnaviorPbPrototype.mjs --natural-cases
```

For installed Firefox on the current Mac, use the same controller and real Kiosk:

```bash
node scripts/tryWebnaviorPbPrototype.mjs --firefox
```

Firefox uses its own `~/.webnavior/pb-prototype-firefox` persistent profile and
1080 × 1920 viewport. Sign in manually once in that window; Chrome cookies and
credentials are never copied. The controller checks authentication in both the
first-party PB menu and the actual embedded document before admitting tools.
Firefox artifacts are saved separately under `output/playwright/pb-firefox/`.
Do not run two controllers against the same profile. This mode requires installed
Firefox with Playwright's `moz-firefox` BiDi channel; the bundled test browser is
used separately by the browser unit suite.

Firefox retains normal SameSite and third-party partitioning defaults. The
dedicated profile grants a partition exception only to the existing local
`http://localhost:5169` / `https://app.esgpb.com` pair. The approved PB login/routing
cookies are prepared as Secure / SameSite=None in that same profile; unrelated,
Strict and partitioned cookies are not rewritten. This is a local integration
workaround, not a change to PB or a deployment configuration. It does not establish
microphone-array channel support. Synthetic startup/cookie isolation and the real
PB bridge can be checked without merchant writes:

```bash
node scripts/verifyFirefoxCookiePolicy.mjs
node scripts/verifyFirefoxPbBridge.mjs
VITEST_BROWSER_NAME=firefox pnpm -F @proj-airi/stage-ui exec vitest run --config vitest.interactiveService.config.ts src/services/interactiveServiceClient.browser.test.ts
```

The dedicated Chrome viewport is 1080 × 1920. Its private persistent profile is
`~/.webnavior/pb-prototype`, outside the repository. On first use, sign into PB
manually in the opened dedicated window; select Remember me if offered. Startup
checks PB's server-rendered authentication state before entering Kiosk. Later runs
reuse browser storage and the local device registration; PB expiry or revocation
still requires another manual sign-in. Closing the browser removes build scratch
files but retains this profile. No raw credentials or storageState export enter
Agent tools, diagnostics or the repository. Login pages are not captured.

An authorized development controller
injects the bounded `stage-ui/services/pbBrowserBridgePrototype.ts` Eventa peer into
the visible PB document. It exposes observation, search, quantity price quotes,
product clarification, opening a product and an unsubmitted note. Bounded basic
cart add/quantity/remove/replace tools are now available in this local prototype;
there is no login automation, order submission or payment capability. The real
simulated-ASR UI submits the request to the existing Main Agent; the controller
verifies the PB result and retains the window for inspection. Close that window
to stop the experiment. This creates a development device/session using normal
Server enrollment; those audit records remain after the temporary browser closes.

`--natural-cases` runs PB adaptations of D11/D12/D04 through the real simulated-ASR
input: availability of two meals, a two-meal price inquiry, then an ambiguous bento
request. It checks visible replies against browser receipts and compares fresh PB
cart reads before/after. Results are saved to
`output/playwright/iframe-probe-20261029/natural-cases.json`. This verifies Main
Agent queries and clarification; finite purpose checks use the configured Jev/SLM service. No-argument startup
opens Kiosk without sending any utterance, but manually submitted ordering requests
can now change the real approved PB cart.
`--bridge-smoke` remains an opt-in technical search/open/draft-note check, not a
natural ordering acceptance test.

`--recovery-cases --natural-cases` additionally injects a lost read receipt and
one model-response failure in the actual Kiosk. It exercises the existing recovery
and retry buttons, verifies a new utterance ID for the original demand, and compares
the real cart before/after. The host-only `browser_recovery_context` reads live PB
menu/category responses, cart, pickup context and visible draft state; its document
ID and digest invalidate stale retries. It is excluded from LLM tool registration.
Unknown/pending operations still block recovery and new cart writes.
Results are saved to `output/playwright/iframe-probe-20261029/recovery-cases.json`.

`--cart-cases --natural-cases` runs the real Main Agent through multi-item add,
quantity correction, replacement and removal, then the three read-only regressions.
Product names, references and prices come from current PB data. Case cleanup only
restores observed test deltas, never clears the shared cart. Results are saved to
`output/playwright/iframe-probe-20261029/cart-cases.json`.
`--cart-smoke` is a separate direct-tool transport check, not natural ordering acceptance.
`--option-cases` orders an observed paid add-on through Main, checks option ID,
quantity, configured unit price and the visible reply, then removes only its test row.
`--semantic-cases` is a zero-vendor-write provider contract probe. It tests inquiries,
quantity-only corrections, negated replacements, multi-item steps and wrong quantities against
the current product names; it is separate from successful ordering acceptance.
`--catalog-cases` verifies batch configuration lookup against the fresh complete index.
`--scope-cases` verifies same-document navigation outside the approved menu rejects
old tools before accessing PB; it never performs a vendor write.
`--answer-cases` runs twelve zero-PB-write short-answer provider cases, keeping
whole-answer and selection providers separate. `--question-cases` exercises eight
real multi-turn selection/correction/cancel/confirm/replay turns and removes only
its verified test row. `--conversation-cases` verifies greeting, hearing check and
thanks use the bounded Host reply rather than Main product tools.
`--cart-guard-cases` injects faulty model targets and proves an unmentioned product or
an arbitrary same-named line cannot produce a vendor write; it is not a model accuracy test.

`--addon-cases` uses the current paid option to verify one meal with one add-on,
an explicit refusal of that add-on, and two meals each with one add-on. Every case
checks the configured price, per-serving attributes, quantity and whole cart,
then removes only its verified isolated row. `--draft-reset-cases` requires an
initially empty cart and verifies that an open unsubmitted product note/search
is cleared with an empty-cart receipt. `--handoff-cases` also refuses an initially
nonempty cart. It creates one isolated first-customer row, uses the real
customer-restart UI with a pending confirmation and open product draft, then
verifies one native clear-all effect, empty cart, retained login and revoked
old consent. The next customer can query and order normally; only its verified
test row is removed afterward. Its local staff-session fixture is **not** a test
of PIN authentication. These are real-merchant opt-in tests; the automatic reset
policy itself is covered by the network-intercepted native fixture. Artifacts are
`addon-cases.json`, `draft-reset-cases.json` and `handoff-cases.json` under the
same output directory.

PB now supplies a dedicated `FastPathSource` for Jev instead of advertising
owned Menu tools or fabricated Menu revisions. Activation is checked per turn;
missing candidate capability has its own diagnostic reason and does not imply
Admin disabled Jev. Fresh catalog references and explicit simple serving slots
can compile a single add through the existing `browserCartTask` gate. Explicit
additions require servings from the current request. Missing servings
use a separate `intent:ask-quantity` candidate that asks the actual product's
quantity without purchasing. A locally resolvable pending answer includes the
actual issued question in its description, whether it concerns product choice or
servings. `browserFastPathCandidates.test.ts` exercises the production generator
against current catalog/cart facts and a real dialogue question; hand-written
candidate probes do not establish application accuracy. Before
its effect check, the admitted original utterance must be persisted as the
current `user_text`, just as Main does; ASR diagnostics are not authorization
evidence. Persistence failure prevents the effect check and write. Requests
without a complete supported candidate continue through Main with the original
utterance and existing validation; uncovered options or compound demands are not
silently reduced to a basic purchase.

Both decision providers receive the observed menu/cart screen and matching cart
row count. Cart edits prefer observed product references over display names;
catalog labels are removed before numeric slot normalization, so names such as
三杯雞 are not rewritten as quantities. Multi-item compilation uses the same
catalog mention resolution as single-item lookup. Explicit unknown/partial
native receipts remain uncertain execution results and never authorize replay.
Cross-app wiring coverage lives in
`apps/server/tests/integration/browserDecisionWiring.test.ts`: forced provider
answers test production candidates through HTTP/continuations and back to Host
dispatch. Those results measure wiring, not semantic model accuracy or native UI.

Configured-price inquiries use read-only `browser_quote_selection` with fresh
product/choice/configuration refs. `browser_quote` is base-only; if the utterance
mentions a current option, the Host returns data-only repair guidance instead
of treating that partial amount as the answer. A generic choose-product call
also cannot replace one uniquely named current product with another menu choice.
These checks do not choose an add-on or grant permission to add it.

Both routes use the shared PB visual runtime. Verified product refs drive a
bounded summary above the native View plus product frames and an illustrative
hand inside PB. Audio `playing` triggers an utterance-level cue; there are no
invented word timestamps. The Host-only `browser_present` tool is excluded from
Main. Cues never click/write and cannot establish purchase consent. During an
introduction batch, trusted customer touch, wheel and keyboard input is blocked
through movement between dishes; the Host also ignores native takeover notices
for that active batch. Finishing or failing the batch releases input. New turns,
navigation and customer reset cancel old presentation; accepted writes
still settle. A missing/ambiguous card shows a location limitation rather than
invented coordinates. Reduced-motion users retain frames with no movement delay.
This is the text/cue batch boundary, not verified full-TTS playback locking.

The idle confirmation uses a separate finite Jev decision: continue, end, other,
or uncertain. Only a current confident continue/end answer changes reception
state. Other demands are neither sent to ordinary ordering nor retained for
later execution. Input received during this question carries its original idle
deadline and reception generation, so a subsequent touch cannot convert waiting
speech into a meal operation. Disabled/unavailable Jev leaves the touch choices
and countdown available; it does not guess an answer or hand speech to Main.

PB has two independent lifecycles: shared account login and the active vendor
order. An explicit `order:null` with zero subtotal and no details is an empty cart;
missing or contradictory evidence is an error. The first add may establish a new
order identity, but pickup/manual generation and the entire effect must still match.
Automatic idle/completion cleanup uses Host-only `browser_customer_reset`: read the current
cart, click PB's native cart-header **清空** once when rows remain, and verify
both empty rows and zero subtotal. It then closes the product draft, clears
search, returns to the menu and renews the Host connection in the same PB
document to verify the result. The Host then reloads the configured entry URL
(PB's select-table page), replacing the previous customer's document and tool
handles while retaining the dedicated browser profile's login. A successful
native reset alone does not prepare the next customer's entry screen.
Manual **重新開始** instead initializes Host reception state without requiring
PB order/payment readback or cart clearing. Desktop 0.6.9 exposes Host-only
`browser_reception_reset` even after submission: it retires our local marker,
invalidates queued controls and confirmation, and preserves PB state for staff.
It bypasses the commerce FIFO; it never replays or cancels already-dispatched
merchant work. The ending visitor retains audit evidence. Neither lifecycle
command is a Main tool.
The customer restart button sits at the lower left of the avatar column, clear
of conversation text and the native website on desktop and browser hosts.
Checkout asks for invoice details before notification contact details. Each
entry step retains a visitor/document/cart-bound question: “OK” re-reads the
form and advances only when that step is valid. Completing contact details
leads to a separate full-order submission question; entry acknowledgements
never authorize submission or payment.
Service-boundary replies use finite, localized topics instead of generic
acknowledgements. Off-topic tasks, delivery, taxis, total-budget meal planning,
coupons and price/payment overrides do not dispatch website operations. Food
safety guidance asks the customer to contact staff directly and never claims
staff were called. A pending meal question remains available after this reply.
It waits for active website operations or a disconnected
binding, rather than model thinking alone. Restart enters the reset state
immediately and cancels the old reception's ASR/Jev/Main/TTS work; its audit entry
captures the old visitor but does not delay reset on a network acknowledgement.
Presentation cleanup belongs to the reset lifecycle, so a late audit or reset
continuation cannot clear the next customer's conversation.
Reception reset skips the illustrative hand's travel, dwell and press timing.
An opaque loading cover masks native intermediate navigation while the Host
announces that it is preparing a new order. Trusted input is blocked during this
maintenance scope, but native target/occlusion, task/document scope and fresh-cart checks
still run. The cover survives SPA navigation and is removed on success or failure.
The store's **我知道了，開始點餐** announcement is optional: its exact visible
control is handled only when present; it is not a mandatory step or a generic
confirmation handler.
The old visitor/chat closes only after reset succeeds. Pending/unknown effects
block reset; an uncertain clear is never automatically replayed. A failed return
to the menu can be retried against the already empty cart without another clear.
The visible cart remains available across local reception changes. Local visitor
IDs do not identify its real operator and cannot require a staff handoff. Restart
still cancels old tasks and expires old question/submission tickets; this lifecycle
binding does not infer ownership of PB's cart.

Each write requires the latest cart version, current product/line reference and
whole-cart readback. Replacement verifies the new item before removing the original.
If a single cart edit loses its receipt, the on-screen hand opens the merchant cart and checks the displayed servings
against the cart page data. It returns to the menu if the customer started there. An exact match confirms the edit. If the same order still
shows different quantities, its observed contents can be reported while further
writes stay blocked. This check does not repeat the click.
Unknown writes persist a store-scoped pause marker in the dedicated profile and
remain paused across reloads; this prototype has no automatic or model-controlled
unlock. Fresh reads do not prove an unknown operation never happened.
The Host grounds targets and paid choices in the current utterance. Each add or
replacement includes a product configuration version, variant reference and explicit
option quantities. Configuration/pickup changes invalidate old selections; fixed-price
attribute groups enforce mandatory and maximum counts, and configured prices include
paid choices. The current real PB paid-add-on case has passed; mandatory variants and
product groups still require their own acceptance.

Before a write, a device/session-bound check classifies the whole demand with the
configured Jev/SLM and bounded Main fallback. Main then extracts requested quantities
for exact observed targets without seeing proposed quantities or effect prose. Code
compares these requirements and the note check against the actual proposal; missing,
duplicate or unknown targets cannot authorize a write. Repeated identical verified calls reuse a receipt only while its
cart version remains current. Confirmed pre-dispatch schema errors can return to Main
within the existing tool-round budget; unknown writes never use this repair path.
Ambiguous product requests now issue Host questions bound to visitor, document,
cart/configuration version, price and a 120-second expiry. Ordinals retain the
original presented order. Product selection only opens a complete addition
confirmation; only a later validated answer can authorize that exact saved plan.
Corrections revoke the old plan and ask again; cancellation and repeated consent
cannot add another item. Whole-answer relation is checked before candidate IDs,
so an ordinal with a new quantity cannot silently lose its attached demand.
The read tool itself never writes. `browser_respond` is a Host-owned bounded
conversational reply; it provides no vendor facts and cannot bypass a live question.
Host recovery preparation still reads live PB state for retry safety.

Fixed-product adds use PB's observed native form with a fresh pickup/configuration,
base price and explicit per-serving attributes, followed by whole-cart verification.
They do not depend on a stale Vue category/card cache. Variants and groups remain
closed until their own contracts are verified. Full daily rollover, real voice and Companion/Windows remain unaccepted.
Current validation uses the available three bentos/paid rice on Mac with simulated
correct ASR text; unavailable product types and physical Kiosk checks are deferred. Passing a provider contract probe is not passing natural ordering.

PB does not implement this peer itself. This is not the production Companion,
remote deployment, Windows/voice acceptance or proof of authenticated checkout.
Owned Menu tools retain their per-round context contract; an admitted external
`browser_observe` toolset uses browser facts without inventing Menu/POS state.
See [the integration and observed API evidence](../../docs/research/2026-10-29-webnavior-pb-integration.md).

The Electron native surface now uses the same client coordinator through
`desktopServiceConnection`, and the same extracted PB operation implementation.
Only finite discovery/execution/inspection envelopes cross the trusted preload;
Main receives the same bounded tools and Host checks. Visibility/size updates do
not recreate authority; old document descriptors remain invalid. Browser iframe
operation remains available. See the Desktop README for synthetic Electron test
scope, separate manual login and production deployment limits.

### ESGPB iframe/CDP compatibility experiment

The implementation roadmap is the
[Windows browser companion plan](../../docs/plans/2026-10-28-windows-kiosk-browser-companion.md).
It keeps this web Kiosk, adds a local Edge/CDP companion and an authenticated
Server-mediated tool channel, and retains Electron as an alternative. These
integration and deployment steps are planned, not delivered by the fixture below.

The current feasibility route preserves the browser/iframe UI. Run the dedicated
CDP check from the repository root with Node 24.22.1, installed Playwright and
`ESGPB_EMAIL`/`ESGPB_PASSWORD` supplied through the environment:

```bash
node scripts/verifyIframeCookieCompatibility.mjs --cart
```

Set `KIOSK_BROWSER_PATH` to an installed executable to override browser selection.
Windows defaults to Edge; this development Mac used Chrome 156.0.8078.48 because
Edge was not installed. It launches a disposable profile and loopback CDP endpoint,
hosts a local iframe fixture and connects Playwright to that visible browser.
This is not yet the actual Kiosk Vue page or a deployed Agent companion.

The negative control reproduces rejected cookies. The compatibility module reads
`Network.responseReceivedExtraInfo` on the iframe's own CDP session, admits only
the target origin/order paths and `order_session`, `XSRF-TOKEN`, plus necessary
`srvkey` routing cookies. Only observed Lax/default-Lax blocking is changed to
None/Secure; HttpOnly, scope and lifetime remain. Strict cookies, unrelated
domains and separate third-party cookie policies are not overridden. Pending
cookie writes gate subsequent requests to avoid a rotated login being followed
by an anonymous redirect. Disabling stops interception and restores attributes
only on the latest owned value, never an older or deleted Session.

On 2026-10-28 public GET controls showed two different ESGPB backend asset builds:
without `srvkey`, HTML/module requests could hit different nodes and return404.
The fixture therefore recovers routing as well as authentication, waits for old
traffic, clears only its disposable cache and reloads. It does not patch the
website's DOM, disable web security or change the personal browser profile.

Live Chrome checks passed login, authenticated reload, M oolong/light-sugar/ice
cart add/readback/remove and attribute restoration. The original $35 cart was
retained; no order or payment submitted. Six targeted Vitest cases cover rotation,
restore ownership, deletion, cookie scope, schemeful blocking/routing and request
gating. Screenshots are `/tmp/airi-iframe-cdp-{menu,cart}.png`; review before sharing.
The scratch profile is removed on shutdown. Live logout, Windows Edge/Assigned
Access, second-site compatibility and voice/LLM operation remain unverified.
Neither Electron nor a browser extension is required for this experiment, but
the local CDP controller is required. The existing Admin/Kiosk bridge is not
automatically implemented by successful scripted browser control.

### ESGPB Electron hosting prototype

`scripts/esgpbElectronPrototype.cjs` is an isolated experiment, not a Kiosk desktop
release or an Agent integration. It hosts the approved ESGPB menu in a native
`WebContentsView`, separate from the local shell. Remote content has Node disabled,
context isolation and sandboxing enabled, denied permission requests and blocked
popups. It does not change cookies, bypass TLS or disable web security.

The launcher requires both host Node and Electron's embedded Node to be exactly
24.22.1, the security release inspected for this experiment. The workspace's
Electron 41.2.1 does not meet this requirement. On 2026-10-28 the inspected official
Electron 46.0.0-alpha.2 includes that Node version; it is a prerelease for this
experiment only, not an approved production dependency. Verify official download
checksums before setting `ESGPB_ELECTRON_PATH` to a separately extracted runtime.

Run from the repository root with Node 24.22.1:

```bash
ESGPB_ELECTRON_PATH=/path/to/Electron.app/Contents/MacOS/Electron \
  node apps/stage-kiosk/scripts/runEsgpbElectronPrototype.mjs
```

Without flags, sign in manually. With `--verify`, provide `ESGPB_EMAIL` and
`ESGPB_PASSWORD` through the environment; the driver checks this test account's
member label, reload, original cookie attributes and loaded product options.
Adding `--cart` selects one M oolong with light sugar/ice, attaches a UUID note,
verifies the actual cart line and total, and removes only that tagged line. It
never submits an order. An uncertain write is not retried: if verification stops
after adding, inspect the cart before rerunning. Screenshots go to
`/tmp/airi-esgpb-electron-{menu,cart}.png`; review account details before
sharing them. The scratch browser profile is deleted on normal shutdown; this
does not revoke upstream account sessions. Cross-process login persistence,
LINE OAuth, payment, microphone and LLM-driven operation are not acceptance-tested.
Use `--keep-open` with `--verify` to leave the authenticated menu open for manual
review, then close the window to clean the profile. The existing web Kiosk and its
Eventa tool connection remain unchanged.

### Native desktop host pilot

`apps/stage-kiosk-desktop` now hosts this same web UI with a narrow preload
capability. `ScenarioSurface` selects `NativeServiceSurface` when the capability
is present and otherwise retains its iframe behavior. The native region follows
DOM bounds, hides for settings/modal overlays and forwards document-bound input
activity. The native PB adapter exposes the shared bounded ordering tools to the
existing Agent, including fresh catalog/cart reads, additions and paid options.
It reads PB's declared route data without relying on main-world JavaScript globals.
The owned Menu's Eventa protocol is not connected through the native View.

Portable EXE 0.2.0 selects Tailscale or the public Webnavior origin before
opening this UI; the built API URLs follow that chosen origin. Browser backup
is limited to the owned PB simulator inside the public HTTPS Kiosk. Its
`pbSimulatorBridge` binds the existing Eventa methods to the exact parent window
and approved origin. Merchant PB has no browser bridge: `ScenarioSurface` shows
an EXE requirement instead of attempting discovery. The Tailscale HTTP browser
also directs this backup to public HTTPS, preserving secure media APIs and the
simulator's same-site cookies. This does not grant arbitrary website automation.

Admin's existing service URL and publication remain the source of configuration;
reload an idle desktop after publication to fetch the assigned Profile. The
pilot adds no hot publication polling. Desktop/device and vendor login stores are
separate; a new desktop installation needs its own enrollment/login rather than
copying another browser's cookies. See the [desktop README](../stage-kiosk-desktop/README.md)
for launch/security limits and the [Windows plan](../../docs/plans/2026-10-28-windows-kiosk-electron.md)
for generic browser control and Agent integration milestones.

Connected tool transport does not establish vendor authentication. If PB's fresh
page data confirms no signed-in user, Kiosk displays a specific sign-in prompt
instead of the generic operation rejection. Sign in inside Electron, then ask
again; every new read checks current page state. A typed pre-dispatch receipt is
required for this prompt, so arbitrary errors and uncertain cart writes retain
their existing failure handling.

PB recommendations and spoken product choices use batches of at most three,
including Main-only operation and follow-up requests for other dishes. These
are spoken choices, not previous/next pages on the PB website. Generic meal-name
suffixes cannot replace an absent named dish with the whole catalog: report a
current-pickup lookup miss first and stop; related literal-name candidates still
require confirmation. Missing configuration is reported separately from absence.
`browser_present` defaults to `mode=recommendation`; explicit customer-requested
comparisons use `mode=information` (up to ten per call, with oversize requests
rejected for splitting). One customer turn cannot emit successive recommendation
batches. Recommendation tools first validate/reserve the exact cards without
running the dish cues. Text mode starts single-dish cues after the reply is
visible; voice mode starts them from playback segments, in mention order.
Interrupted/old-visitor cues cannot resume, and only actually shown dishes enter
recommendation history. Search recovery is offered from the native search field
for Jev to interpret semantically, including an abandoned search with an old
question. Low-confidence or different requests go to Main. Fixed no-argument
tools always use Host-owned `{}`; model wrappers cannot change their action.

New search criteria replace the prior browse filter. For rejection of the current
recommendations (「這些都不要」), Main clears the search to show the full menu,
without reading the entire menu aloud or dropping explicit dietary/budget needs.
Search changes retire the previous product question; no cart lines are removed.
Spoken product-choice questions, including aliases after an exact-name miss,
require a successful native presentation with the same product refs/names/prices.
Cancelled, missing or changed cards retire that question instead of leaving an
invisible choice that a later ordinal could consume.

A normal reception end clears unfinished merchant rows before the next visitor.
An abrupt reload/crash may still leave a cart. The assistant uses that visible
cart without an ownership handoff. Generic replies do not reread the cart merely
to authorize a response. A failed read is not an empty cart; typed sign-in failures
retain their login prompt. `browser_respond kind=checkout-guidance` reviews the
actual cart; adapters with verified checkout controls advance through the staged
invoice flow above. This reply does not authorize submission or payment, and its
receipt ends the turn without another Main continuation.

Development device enrollment now sets a 30-day HttpOnly cookie so closing the
desktop app does not discard enrollment. Server-side revocation still applies;
this does not change visitor/admin session expiry or PB's own login policy.

### Debugging iframe input with DevTools

When manual clicks stop reaching a third-party iframe, keep DevTools open and
turn off **Toggle device toolbar** (the phone/tablet button, or **Cmd+Shift+M**
with DevTools focused on macOS). This disables device emulation while retaining
the Console, Network and Elements panels. See
[Chrome's device mode documentation](https://developer.chrome.com/docs/devtools/device-mode/).

On 2026-10-16, native macOS mouse clicks reproduced this failure in the user's
original Chrome Kiosk tab: device toolbar enabled, Responsive/Desktop, Sensors
Touch set to Device-based. Turning off only the device toolbar allowed guest
entry and announcement dismissal with DevTools still open. Re-enabling it
reproduced failed category clicks; 100% preview zoom and Desktop (touch) did not
resolve them. After restoring the page, native clicks also passed Go, guest
entry, announcement dismissal and category selection with device mode disabled.
The user also confirmed that a physical click switched to the vegetables category
in that final state, with DevTools still open and device mode disabled.

This is a debugging workaround, not a production iframe fix or proof of vendor
anti-debugging. Direct automation aimed at the child frame can work while manual
input fails, so it is not sufficient acceptance evidence. Test the actual Kiosk
browser and touch input separately; device emulation does not establish behavior
on the deployed hardware. Do not broaden iframe security permissions to repair
this input symptom.

Compare the same child content through a same-site and a cross-site host before
attributing the failure to a service provider. Different localhost ports are
cross-origin but can remain same-site. A minimal HTML reproduction also showed
device-mode input failing with an iframe wrapper's `overflow: hidden` and
recovering with `overflow: visible`; that change alone did not fix the complete
Kiosk. Preserve the full-page manual-input check when evaluating any CSS fix.

## Anonymous customer sessions

Main Agent accepts both direct requests with Fast Path disabled and Jev handoffs
through the same conversation loop. A completed turn without commerce tools can
present natural model dialogue (for example, a greeting). Offering menu tools
alone does not require a menu receipt or discard the answer. History-only reads
also retain conversational replies. Once commerce tools are attempted, the host
presents accepted current-turn menu/cart/operation/question receipts rather than
model success prose. Rejected tools are not automatically replayed. No-tool
prose relies on the model instructions to avoid unsupported commerce claims;
this path does not perform a second semantic classification or guarantee that
all model-written factual claims are grounded.

Internal `menu_get(display:false)` results carry `dataOnly:true`. They provide
catalog evidence to Main Agent and are excluded from customer reply receipts,
so a later filtered recommendation does not announce rejected dishes from the
initial full-catalog lookup.

Model/provider failure before tools, task timeout, tool rejection, duplicate
calls, and processing limits have distinct presentation reasons. If a later model
call fails after accepted work, the host retains that work's receipt alongside
the failure explanation. A greeting is stored once as dialogue, while model
operation drafts stay out of customer history until the host presents receipts.

System administrators can configure **Main Agent Thinking** in **Kiosk AI 能力 →
對話 LLM → OpenAI-compatible Provider**. It is saved per provider and defaults to
Off. Verify and save the provider, then choose **套用到 Kiosk**. Every subsequent
chat request, including tool continuations, sends
`chat_template_kwargs.enable_thinking` as the selected boolean. The model's chat
template must support this option; this controls generation rather than merely
hiding reasoning output. Ollama, llama.cpp, and other capabilities do not receive
this option. Migration `0046_webnavior_chat_thinking` adds the persisted choice;
existing profiles receive Off when settings are next applied.

Each customer starts an anonymous Kiosk session when they touch the screen, type a message, speak, or operate the menu. The owned Menu session controls that customer's conversation and cart. External PB retains its vendor cart separately:

- After three minutes without activity, it asks whether to continue and starts a 15-second countdown. Showing the dialog does not clear anything. **繼續點餐** cancels that countdown and keeps the same session, conversation, cart and unfinished ordering requirement (including the selected meal, known quantity/options and pending question); it does not reload the menu or repeat the question. Only unanswered countdown expiry, confirmed order completion or explicitly starting a new order/reception clears that context and ends its durable visitor session. Pending AI/tool work and high-confidence engaged presence retain their existing idle-timer protection. Lookups and deferral do not reset context. Internal answer tickets remain short-lived and are renewed on the next decision turn; financial/destructive confirmation authority is not extended by continuing.
- After an order is confirmed accepted, the completion screen (with an optional survey QR Code) remains until dismissed or its countdown ends; then the customer conversation and owned Menu/order state are reset to clean standby. External PB uses the verified native clear/reset described above. Failed, rejected, uncertain or still-pending submissions do not trigger completion/reset.
- The owned menu reports completion immediately after payment and accepted submission. Its transient order-continuation URL is displayed as a separate QR and desktop link alongside the configured reward/survey; the customer need not acknowledge the order QR before the reward appears. Only the non-personal order result enters the archive; the capability is cleared from host memory when the customer session ends.
- In administrator mode, **結束目前接待** ends the current reception. For PB it clears unfinished cart rows with the native **清空** button, verifies empty, resets product/search drafts and renews the Host connection while retaining the vendor document/shared login. Pending or unknown effects block this reset, and failures retain the current reception.

This is intentionally separate from AIRI's general chat history. Reception reset
clears customer-visible state, while the restricted system archive retains the
session. Future verified identity associations remain internal, not permanent
member-facing conversation links.
Successful Fast Path voice turns and complete real tool calls/results are saved in
that same visitor session. Main Agent receives a bounded recent conversation
and can use the read-only `kiosk_session_history` tool to page older text from
this visitor only. System One also receives up to 12 completed, role-labelled
current-session dialogue entries, bounded to 4,000 characters, with explicit
phase, finite references and any actual unanswered operational question. It
does not receive archive history, another visitor's dialogue or previous model
decisions as facts. A discussed item is not automatically a pending question.
Before each voice/simulation turn, Kiosk reads uncached Fast Path activation.
An inactive System One profile bypasses all Fast Path candidates and direct
application-resolved actions, handing the original utterance to Main Agent.
Jev/decision-transport failures also hand off, with available pending-question
context and completed read receipts. Neither route resets the customer session,
conversation, cart or unfinished speech. Main Agent must still establish intent
and pass ordinary tool validation; fallback itself grants no operation authority.
The device's background filter controls whether IGNORE is available; off and
observe cannot silently drop a request. In PB mode, incomplete speech produces
a visible clarification asking the customer to state the full request, without
retaining or joining speech fragments. A product-choice question keeps its
original target query separate from the full customer request across a later
quantity question. Answering the count completes a simple purchase once; any
unparsed customization remains for further handling rather than being discarded. Browser execution failures are separate: unknown mutation
results require checking the screen, never automatic replay. Activation changes
take effect on the next turn without reload; existing in-flight work is not
retroactively canceled. If Main Agent also fails, screen ordering remains the
fallback, not an automatic retry loop.
Directed pure greetings return a local “您好！” reply with the configured greeting
motion and ordinary TTS, without invoking an ordering tool or Main Agent. The
decision inspector identifies this as a greeting rather than a webpage operation.
It does not consume or repeat a pending operation question, and waits behind an
existing Agent task instead of interrupting it. Background greetings stay silent;
greeting plus ordering uses the normal ordering path.
The ASR test panel identifies its measured utterance and reports cumulative client
decision-request wait, actual Jev call count and cumulative Server/Jev exchange
duration. Client wait excludes queueing, recording flush, browser actions and TTS;
exchange duration includes network transit, not isolated GPU inference. Retries
and optional read review accumulate within the same utterance. Missing accounting
is shown as unknown, never zero, and does not change semantic or execution policy.
Expand **檢視本次 System One 決策 trace** and select **複製完整 trace**
to copy the full displayed JSON, including scroll-hidden content. Copy success
is acknowledged; clipboard failures leave the trace selectable for manual copy.
Fast Path and Main compose an outcome with its validated question once. If the
tool’s customer message already contains that question, it is not appended again;
raw pending-question text does not create answer authority.
Operational questions use explicit receipts: ID, purpose, finite choices and
effects, expiry and state revisions. Both Fast Path and Main Agent validate the
receipt before presentation; the displayed question is retained in role history.
For operation results, the host uses the tool's customer outcome and the single
application-owned question, not competing Agent prose. POS fulfillment IDs and
labels reach both Jev and Main Agent. Customer dialogue omits environment/source
labels while preserving accepted/rejected/pending/uncertain status.
Main Agent text is presented only after the final receipt validation, preventing
an earlier streaming draft from showing a competing operational question.
Every utterance chooses its route first; an old question never gates an
independent new request. A selected question effect then resolves a concrete
answer among the question owner's current choices, or NEW_REQUEST/BACKGROUND/
UNCERTAIN. This replaces the generic ANSWER relation without adding a separate
speech classifier. Initial choices can be corrected, including consent to refusal.
Every finite question
uses its own Jev request and yields an authenticated one-use checkpoint to Kiosk.
Speech qualification alone does not create a dialogue bubble or grant execution
authority. Uncertain concrete answers retain the question
without executing a guessed deferral or handing the guess to Main Agent. Payment
and destructive confirmations remain distinct one-use authorization records.
Complete-menu lookup may ask one bounded follow-up decision: finish with the
grounded answer, perform one offered recommendation read, or hand off to Main
Agent. It never loops or retries a cart/payment mutation. The decision inspector
shows these stages and the role-labelled context actually sent to System One.
In voice mode the avatar's thought bubble shows speech recognition and current
work. The conversation keeps transcripts, replies and actionable notices;
both input modes omit inline processing prompts. Simulation details are available in the decision trace.
Fast Path processing feedback requires both a confident service intent and a
confirmed recipient, or an explicit `serviceRequest: REQUEST` recovery check.
Neither recipient confidence nor route confidence alone admits feedback. Customer
text enters the conversation only on an accepted final path or a real read receipt,
so a later silent outcome leaves no unanswered customer bubble. Ordinary ordering
checks intent first, then verifies the recipient where that intent requires it; there is no standalone recipient-first
pass. Background or uncertain recipients produce no customer processing prompt. Existing microphone
capture indicators and operator diagnostics remain separate from this feedback.
Once service scope is confirmed, progress remains visible during the remaining checks;
no intermediate checkpoint authorizes an order operation.
General service-information handoffs are read-only and need no menu receipt when
there is no current food evidence. Generic Main routing can first use the bounded
service-scope resolver; unresolved food requests retain menu verification.
An uncertain social greeting (`UNCERTAIN_GREETING`) stays silent even if its
recipient was already admitted. Ignored acknowledgements and unfinished speech
also produce no retry prompt; actual failed service decisions retain that prompt.
Weak-route recovery additionally verifies service relevance (`serviceRequest`):
only `REQUEST` can hand the original utterance to Main. Everyday chatter remains
ignored even when addressed with 「你」; uncertain relevance stays silent as
`UNCERTAIN_SERVICE_REQUEST`. Weak unfinished-speech recovery uses this same
check; it cannot substitute recipient confidence for uncertain service meaning.
Recipient confidence alone is not service consent.
Price inquiries/filters use the existing search/recommend routes with finite,
browser-issued price interpretation IDs, not model-authored amounts. The host
forwards the selected ID for browser verification, and hands off verified
single-dish bounds or an unresolved-price guard. Price interpretations first
use a bounded Main check when Jev abstains without
a resolved choice. Main selects an issued price interpretation only; an
information-only result permits factual menu reads while the handoff stays
read-only. Failed or invalid checks retain the unresolved guard. Confirmed
unsupported approximate/relative or total budgets clarify without cart mutation.
Card prices and condition headers
are visual; replies need not read prices aloud. The application appends this
capability boundary even to older saved System One prompts, without rewriting
merchant configuration.
It also shows actual bounded-call counts, questions, answers, durations and
refusal reasons. An optional read continuation is allowed only with a known
remaining budget under 24 questions across the entire utterance. Verified read
receipts are visible before optional review, which may perform at most one extra
read and then choose only completion or Agent handoff. Rejected tool envelopes
are not success; a lost execution result is shown as unknown, without automatic
mutation retries. Main Agent tools run serially, with four rounds, 16 calls and a
60-second model deadline; exhaustion/rejection retains actual receipts and reports
unfinished work. Accepted external payment effects are not cancelled by that
deadline. A complete new request during a pending
confirmation revokes that exact confirmation before handing off; it never
executes the old action. Configuration/clarification topic changes instead request
one finite reroute through the existing host context tool, using the same utterance
and issued question ID. Queries preserve the old unadded meal; a verified new meal
replaces it. No old quantity/options or answer authority crosses into the new route,
and both decisions share the per-utterance question budget. Main Agent turns bind known ingredient conditions to a
host-owned task before sending messages, and release only their matching task.
Completed reads and their conditions accompany the handoff so the Agent does
not restart an unfiltered search.
Unfinished speech is retained for three seconds in the same phase/revisions. Jev
classifies the next utterance's relation before the application resolves separate
fragments; transcripts are never blindly joined. Background does not consume a
clarification answer. A confidently directed unresolved answer keeps the current
target question available for another voice reply, without cancelling the pending
operation or extending its deadline. Weak intent, an uncertain recipient and
companion speech do not authorize a spoken retry. Stale/expired clarification
and confirmation remain rejected.
When an ASR turn escalates, the Main Agent receives a sanitized snapshot of the
current menu or checkout phase and available payment methods. Typed turns read
the same state through a host-only, read-only service tool. Tax IDs, carrier
codes, and raw checkout objects are never included in that conversation hint;
tool execution still checks the browser's live state.

## Published character behavior

Published character-card identity/personality and ongoing instructions apply to
PB conversations as well as the owned Menu. VRM uses the existing external-TTS
audio node; Live2D now attaches that same speech to the shared wLipSync engine.
Stopping or replacing speech detaches only the mouth-analysis branch, preserving
audible playback. Thinking expressions remain driven by actual pending work.
PB cart acknowledgements require a correlated verified write receipt; product
gestures require a validated nonempty `shown` presentation. Internal catalog
reads, failed/unknown writes, repeated receipts and retired documents do not
trigger those gestures. Model-specific expressions and physical output still
require acceptance with the selected VRM/Live2D file and speech provider.

## Local diagnostic overlays

In Electron text mode, the same simulated-ASR input, timing and decision trace
float in a frameless child window above the native PB website. Drag its title
bar, collapse it, or choose **重設位置**. It retains the existing Vue subtree and
submission handlers; it does not start another Kiosk or conversation session.
Closing the popup returns the draft and trace to a compact reserved row; choose
**浮動視窗** to reopen it. If opening is denied, that row remains usable and shows
an error. The reserved row is released while floating. Host reload/shutdown
closes its owned popup. Browser tests cover draft retention, submission and trace
updates; the real Electron fixture covers ownership, native placement, input and
permission boundaries. Physical Windows dragging/scaling still need acceptance.

In browser text mode, these controls share a floating console. Drag its title
bar with a mouse or touch, collapse it to keep
the service visible, or choose **重設位置** to return it to the lower-right corner.
Collapsing preserves the draft and trace; viewport changes keep the console
within reach. Voice-only mode does not show this console.

In **Kiosk 現場設定 → 開發診斷**, operators can independently toggle the
idle-reset and presence diagnostics in the lower-right corner and the decision
flow inspector in the upper-right corner. All three default to
hidden in development and production. Changes apply immediately and persist in
this Kiosk browser, like the camera-preview preference; no Server delegation is
required. These switches only control the overlays, not the camera observation
or customer-session reset policy. Presence diagnostics appear only while actual
presence observations are available.

## Customer-facing assistance state

Food constraints are finite ingredient references supplied by the ordering page.
Jev selects inclusion, exclusion or no condition alongside the intent. Fast Path
forwards those bounded slots to the page, which validates them against its issued
snapshot and performs the same search as Main Agent. Trace shows the ingredient
answers, compiled filters and operation result; cart removal never inherits food
search filters. No ingredient-polarity regex or absent-food tags are used.

The conversation surface presents a large, plain-language state tied visually to
the avatar: listening, understanding speech, arranging a request, or speaking.
Customer replies stream through the device-authenticated Server route. Draft
text does not clear the customer progress display or claim an operation result;
the host publishes the final reply after validating the actual tool receipts.
Only that completed customer reply is retained in the visitor transcript.

An idle Kiosk shows localized neutral progress after the existing Jev checkpoints
admit service relevance and recipient. That receipt owns a provisional interaction
turn, adopted by the eventual action and Main handoff so the acknowledgement is
not repeated. It never interrupts accepted Agent/order work. Unpromoted turns are
released when input processing ends. Tool progress then replaces the receipt;
continuations preserve the latest tool status across SSE rounds.

Receipt and waiting feedback use the original master audio assets in
`public/audio/`: `kiosk_acknowledged_chime.wav` for each admitted capture, followed
by looping `kiosk_hold_melodic_light_60s.wav`. `processing.json` enables feedback
after the receipt WAV loads; unavailable waiting music does not silence receipts.
A new capture interrupts waiting music for its receipt, while a capture during
TTS defers its receipt until that speech ends. Legacy ASR remains silent during
capture, transcription and pending service classification. Its first confirmed
service admission (or accepted final decision) opens feedback once per utterance;
empty ASR, background IGNORE, incomplete or unavailable decisions never open it.
Repeated admission progress for the same legacy utterance does not replay its
receipt. Accepted non-empty simulated text also starts feedback.
Permission and admission failures do not.

Once admitted, waiting music continues through remaining decision, tool execution
and TTS preparation.
Actual TTS playback stops it synchronously; an earlier reply ending does not
discard a newer pending utterance. Internal work and proactive greetings alone
never start a receipt. Reset, cancellation, admin/pause, service faults and scene
disposal stop feedback without cancelling order work. Volume is 0.4 for the chime
and 0.3 for music. No synthesized waiting phrases or fallback waiting TTS are
requested. Missing/disabled assets leave waiting silent while normal replies and
greetings retain TTS. Text progress remains visible independently of sound.

`utterance_timing` distinguishes input receipt, service admission, first response
DOM readiness and first audio playback. The first response remains the earliest
event across Jev/Main. DOM readiness is not a hardware paint measurement, and
post-transcript timing excludes physical speech capture and ASR latency.
The idle hint reads “現在可以直接開口點餐”, with spoken recommendation and
one-dish examples, and always leaves the menu touchable. The old
draggable technical audio-status card is available only in development
diagnostics; camera, microphone, and model failures are not customer-facing
copy. When an embedded menu displays accepted recommendations, it does so in
its own non-blocking rail rather than navigating the Kiosk away from the menu.

For VRM characters, a system manager may upload compatible `.vrma` clips in a
published Profile's **角色動作包** under **互動體驗 → 角色卡與虛擬角色**. The clips
are stored independently from the model, hash-versioned, and applied only after
that Profile is published. **待機動作** loops while the Kiosk waits; **招呼客人**
plays once when a proactive greeting is spoken. Other configured clips map to
listening, thinking, recommendation presentation, and order acknowledgement.

## Completion survey invitation

In administrator mode, open **完成後問卷邀請** to enable the optional survey, set a fixed HTTP(S) survey URL, and adjust its customer-facing copy and duration. AIRI generates the QR Code in the browser; it does not send the URL to a QR Code provider or append order, conversation, member, or customer data to the link.

The invitation, approved interactive services, and their AIRI instructions are stored in the same-origin Interaction Profile shared with Stage Web. Other browser origins and devices remain independent until a future device-management service provides central settings.

## Administrator mode

During live operation, use the authenticated management website's **Kiosk 使用歷程**
page on another computer, select the device and reception, and enable **即時監看**.
It refreshes retained records every three seconds without sending kiosk commands.
Recognition-start and recognition-duration events are separate from the existing
decision/tool clock; duration includes the ASR HTTP request and is not a direct
measurement of model compute alone. Completed transcripts are saved as soon as
ASR returns, even while an earlier utterance is executing.

Customers see only the audio-received indicator and recognized text. Voice,
decision, idle and presence diagnostics and numeric execution times require the
local authenticated administrator view. Opening that local view pauses reception;
use the separate management website to observe a live customer unobtrusively.
Multiple ASR requests may overlap;
decisions and browser operations remain serialized in capture order.

The device settings ordering-site selector identifies reviewed PB production,
merchant test, and local simulator destinations from their URLs, alongside the
configured title and origin. The selected URL and environment explanation remain
visible beneath it; the published default also names its resolved destination.
These labels do not change the saved site IDs or the next-reception apply barrier.
Native select controls and their options use explicit light background and dark
text so the dark local administrator panel does not hide unhovered choices.

### Welcome mode and prepared speech

Choose **固定歡迎詞** or **VLM 情境生成** under **互動體驗 → 開場招呼 →
開場招呼方式**. This uses the existing Server-owned `proactiveVlmEnabled` policy:
false selects fixed openings; true selects vision generation. Device overrides
retain their existing precedence over the Site default. Reload the Kiosk to
fetch the current effective setting immediately.
With greetings enabled and local observation disabled, a listening kiosk welcomes
once when the idle entry is verified ready. This does not enable camera observation
and cannot bypass an unresolved previous cart, recovery block or administrator view.

Proactive welcomes rotate through the published Profile's `greetingPhrases`
(1–50 openings, up to 500 characters each). Configure them under **互動體驗 →
開場招呼 → 固定歡迎詞**. Unset phrases deliberately select three shared localized
openings. On the optional-phone screen, Kiosk appends the localized explanation
that the customer may enter a phone number or skip directly to ordering. Do not
include that explanation in each configured opening.
PB table entry uses the configured opening without the optional-phone hint.
Its table-picker heading and instruction remain fixed localized native copy in
`packages/i18n/src/orderingMessages.ts`; there is no separate profile editor for
that instruction. Publishing greeting phrases does not rename merchant tables.

In fixed mode, registered kiosks with greetings enabled prepare these audio variants through
the existing device-authenticated TTS route, sequentially, when the scene loads.
Playback reuses in-memory audio across visitors without an LLM/VLM request or
a fresh synthesis request. If preparation has not finished, playback shares
that pending request; failed synthesis is retried on demand. This is not an
offline or persistent audio cache. Reload after publishing phrases or changing
the Server-side TTS model/voice. Changing locale, phrases or device identity
invalidates the bank; disabling greetings, choosing VLM, or leaving the scene
aborts warmup.

In VLM mode the current camera frame, role and published `greetingPrompt`
(**VLM 開場指引**) go to the configured vision model, then its reply is synthesized
for playback. Phone-entry context is included in the generated request.
Missing camera frames/models and provider failures do not silently select fixed
welcomes. Fixed phrases and VLM guidance are both retained when switching modes.
The editor displays the selected mode's content in the same section and retains
unsaved edits across switches. Owner templates without a Site show both banks.

Welcomes are permitted on `customer_entry` and `ordering`, with no unresolved
question or active customer turn. The host rechecks the browser phase after
cold synthesis; actual touch activity cancels a pending or spoken welcome.
Only completed audio playback marks a welcome as delivered; blocked, failed and
cancelled playback remain distinct. Before any customer activity, an interrupted
welcome may retry twice within the same reception's 20-second window, with at
least 1.5 seconds between attempts. Each attempt rechecks presence and the current
browser phase. Active speech/recognition, pending questions and customer work take
priority. Completion, customer activity or reception reset closes the budget;
retries never clear a cart or create a replacement reception. Fixed-audio waits
are cancellable without discarding reusable synthesis, and a cold attempt waits
at most ten seconds for fixed audio.

Camera startup waits for microphone preparation even when triggered by a reactive
mode change. Unrelated device-setting changes do not restart vision or reset
presence. With voice diagnostics enabled, `greeting_delivery` records the attempt,
reception, result and cancellation reason; an old result cannot enter the next
visitor's history.
For an admitted welcome, fresh in-zone geometry with low confidence is treated as
uncertain rather than confirmed departure. It does not renew new-welcome or ASR
admission. Missing/out-of-zone evidence retains the existing 1.5-second grace;
stopped cameras and stale uncertain frames still cancel. Pose/Face mode matches
their nose landmarks, requiring one unique face and a current Pose. A reliable
matched face can confirm presence when close framing hides the hips and lowers
the five-anchor Pose score. Body position/scale stay owned by Pose; unrelated,
ambiguous or stale matches cannot promote confidence.
The spoken text is retained in the current visitor transcript. Neither welcome
mode appends a recommendation invitation. The same VLM policy also controls
whether contextual assistance reminders use images; reminders retain their
generated-text path and use the chat model when the policy is off.

### Per-device operational settings

System administrators open **Devices → Device settings** in the Dashboard
(`/admin/kiosk/devices`). The on-device settings and Dashboard edit the same
revisioned override map; there is no per-field delegation or separate local map.
Local writes require the enrolled device cookie and a Server-verified PIN grant.
Dashboard writes retain account and Site role checks.

Site defaults are overridden by saved device values. Both editors expose
**純文字模式**: save to show the text composer and stop microphone capture on a
device; turn it off to enable voice capture and allow configured proactive
greetings. The saved device mode is authoritative; the Profile's older
`voiceConversationOnly` display flag does not override it. Camera observation
can remain enabled in text mode, but it does not start spoken greetings there.
Changing this setting does not
reset the PB document, its login, or its cart. Devices refresh effective policy
every 10 seconds and on focus, retaining the last acknowledged snapshot offline.
A successful local save takes effect immediately; stale responses cannot undo it.

Proactive welcomes read the active service's own state: PB uses
`browser_cart_get` on its table-selection or ready menu page; the owned Menu
uses `kiosk_interaction_state`. PB cart/checkout pages, open product selectors,
and pending Host questions suppress welcomes. Table selection uses the configured
opening without the owned Menu's phone-entry hint; reminders wait for the menu.

PB service-mode and background-speech policy controls remain hidden until the
native PB/Jev implementation supports them. They do not select PB dine-in,
pickup or a table number. Those capabilities require separate vendor verification.

The **Presence vision mode** setting is per-device and supports `face_only`
(the legacy baseline), `pose_only`, and `pose_plus_conditional_face` (the
default). Pose modes use local Pose Lite for anonymous relative body-scale and
movement evidence; conditional face checks run only for attention-capable
greeting modes and never in the same inference callback as Pose.

Every accepted write increments the device revision and records its principal
and before/after values. HTTP 409 requires a reload; unsaved drafts are protected
from background refreshes. The device retains its last snapshot while offline;
reconnection applies the current policy. Camera work is stopped and restarted when policy changes, and
the Server independently enforces recording and proactive-action permissions.
Recording without observation does not start MediaPipe. These controls do not
change browser camera/microphone permission or the existing local preview toggle.

When **local camera observation** is enabled, microphone utterances and
unsolicited greetings/reminders require a recent, locally detected person of
sufficient quality inside the configured detection zone. Observation continues
in standby even if greetings and reminders are disabled. A first valid detection
admits voice immediately; the greeting's separate sample/dwell rules still apply.
The existing 1.5-second lost-person grace tolerates brief occlusion, after which
old evidence expires even if inference stops. Starting, failed or restarted
cameras do not qualify as presence. This uses local Pose/Face, not VLM.

The host checks before ASR, after transcription, at queue admission and before
executing a delayed decision or handing it to Main. Unsolicited audio is checked
again before playback; loss of presence cancels only the proactive turn. Existing
commerce requests still settle their receipts normally. Touch and simulated text
input remain available, and devices with observation disabled retain ordinary
voice service. Presence only admits speech processing; Jev must still distinguish
directed speech from a nearby person's conversation.

For voice-only acceptance testing, an administrator can enable **語音診斷模式（測試用）**
on an individual device. The authenticated local admin view shows its latest eight VAD segments as
recognizing, unrecognized, recognized, failed, or decided, together with the
Speech Guard label/score when available and the final turn-decision reason.
The panel stays inside the upper host area so Electron's native menu cannot
cover it. It shows microphone/VAD state even with zero captured segments, and
surfaces startup/permission/connection errors. While this setting is enabled,
existing visitor sessions also record `service_event` snapshots with source
`audio_runtime`: capture mode, policy/model readiness, microphone track lifecycle,
listening state and errors. Snapshots contain no audio, image, device name or
continuous probability samples and occur only when lifecycle state changes.
The Server returns these diagnostics only while that device setting is enabled;
turn it off after testing to stop collecting these extra lifecycle diagnostics.

Deployment requires migrations `0032_kiosk_device_settings.sql` and
`0033_kiosk_voice_vad_settings.sql` before using the
new Server routes. Include it in the Server schema package used by the normal
startup migration process, then deploy the matching Dashboard and Kiosk assets.

### Voice activity detection

The local Kiosk administrator panel includes **本機麥克風與喇叭**. Select an input
microphone and output speaker there; preferences persist in that browser's
profile, independently of Server model/provider configuration. **重新偵測並連接裝置**
requests microphone permission again and reconnects a voice kiosk's input.
Text mode does not start continuous microphone capture from this action.
**播放喇叭測試音** uses the original receipt chime without requiring TTS.
Adjust between customer conversations. Camera selection is unchanged.

The selected output applies to reply/greeting TTS, the administrator's speech
test, receipt chimes and waiting music. Both native media and Web Audio graph
output are validated before saving. An unsupported or unavailable explicit
speaker selection reports an error; the system-default option remains available.
Restarted voice kiosks explicitly acquire their input stream after permission,
even when a persisted enabled toggle was already true: the saved preference is
not evidence that a microphone stream exists.

For synthetic-device integration tests, run
`VITEST_FAKE_MEDIA=1 pnpm -F @proj-airi/stage-kiosk exec vitest run --config vitest.browser.config.ts src/components/KioskMediaDeviceSettings.browser.test.ts`.
This enables Chromium's synthetic devices and permission UI only for that test
process. Native permission regression uses `PB_AUDIT_AUDIO_DEVICES_CHECK=1` with
the existing isolated ordering runner, leaving merchant documents unprivileged.

Kiosk voice input uses the Silero VAD model. System administrators can set the
Site-wide threshold, minimum speech and silence durations, maximum utterance
duration, and leading/trailing speech padding in **Kiosk 模型設定 → Silero VAD**.
The initial policy is `0.5`, `250 ms`, `9999 s`, `250 ms`, and `2000 ms`
respectively. The Kiosk receives this policy through its normal 15-second
settings sync. Its audio buffer expands only while a visitor speaks, so a
`9999 s` maximum does not allocate a large buffer at startup.

Completed VAD utterances use 16kHz mono PCM16 WAV. ASR uploads contain at most
20 seconds each, preferring a quiet boundary within the final second; all samples
are included once. Each upload fits the dedicated 1MiB request limit, including
multipart headroom. Transcripts are reassembled in sample order and enter the
decision queue once, after every chunk succeeds. A failed/empty chunk, cancellation,
explicit provider deadline or visitor reset rejects the whole utterance; partial
speech never becomes a separate order. The queue sets no ASR timer and keeps complete transcripts waiting behind earlier ASR or Agent work.
Accepted utterances retain capture order until processed or the reception resets;
actual request failures still cancel their own reservation. Capacity remains
bounded, with explicit overload feedback for a new utterance that cannot be accepted.
Every dequeued sentence is
processed against fresh cart/question state; waiting does not extend order consent.
The archival recording retains the complete original utterance. ASR413 is shown
as an upload-size refusal, separately from incomplete recognition/provider failure.

### Local access

Tap the settings label five times within two seconds, then enter the PIN on
the on-screen keypad. Configure `KIOSK_ADMIN_PIN` or `KIOSK_ADMIN_PIN_FILE` on the
Server; no PIN is embedded through a frontend `VITE_` variable. Closing the panel
revokes the local grant. PB's native View hides while a host dialog owns input.

Administrator mode can choose the microphone, adjust the locally stored customer conversation text size, enable or disable voice input, and pause the avatar for calibration. The initial conversation font size is 28px; existing operator-selected values remain unchanged. Both orientations reserve 75% of the available grid height for the ordering page and 25% for the assistant. Within the assistant row the avatar uses 24% and the conversation 76%, with a smaller avatar minimum width. The conversation shows a three-line expandable previous reply above the current turn and unfinished requests; the previous reply uses 80% of the configured text size while current messages retain the configured size. Its viewport remains scrollable after asynchronous Markdown layout; **查看先前對話** expands retained history without changing model context or audit records.

After the catalog renders, PB initially activates its first native category tab (currently **便當**) to scroll directly to the product area. This retains every category and uses PB’s own sticky-header positioning. This happens once per document; trusted customer interaction or an existing scroll position prevents repositioning. On a 1080×1920 portrait screen the current 13-item merchant menu fits in the enlarged region; smaller screens retain ordinary scrolling. Visible recommendation batches are framed together without per-item dwell or an input lock; optional speech cues never scroll offscreen dishes into view. Requesting a different table uses **return_to_table** to navigate to the approved same-store table page before reading tableChoices. Navigation does not clear a cart, choose a table or start/submit an order. Native menu placement and table navigation require a rebuilt desktop host as well as the frontend.

Activity guidance uses non-interactive CSS gradient frames: actual TTS playback lights the avatar, detected speech while the microphone is listening lights the entire assistant panel, and in-flight page controls/presentations light the ordering panel. Text mode uses the same actual media-playing signal; a stronger 4px speaking edge and inset glow remain visible on the dark avatar background. State polls stay quiet. Native PB content has a permanent 6px frame inset so Electron's native view cannot hide the Host border; activation never resizes, hides or covers the site. Reduced-motion preferences use a static frame and no additional model is loaded.

Speech/text visual cues use longest catalog mention spans: a soup name inside a
complete combo name does not also point to its standalone card, while a separately
mentioned soup still does. Positive-only requests cannot append excludedTerms;
this is a necessary refusal-evidence check, not a complete semantic classifier.
An existing dish excluded from recommendations returns a repairable purpose
conflict, allowing explicit information lookup without erasing dietary/budget
preferences or authorizing an order. General catalog introductions use at most
three dishes. A failed targeted presentation does not fall back to reading an
unrelated full catalog or repeating the same failure; verified specific details,
cart reviews and final submission summaries retain their complete facts.

Ordinary **search_menu_items** inquiries consult the full current catalog. A unique exact product name/alias or an exact configured category can be highlighted directly. Partial keyword matches return candidate evidence only; Main chooses semantically matching dishes and calls **point_to_menu_items** before describing them as presented. Soup inquiries must not turn dumplings or meal sets containing soup into standalone soup matches. Even an explicit “only show this category” request keeps the full menu and highlights the verified selection without filling the native search field; automatic filtering is not exposed. An empty query can still clear a prior manual filter. A missing item leaves the menu usable and supplies concise verified alternative metadata for the assistant, without choosing or ordering a substitute. Main instructions distinguish the newest question from earlier completed topics. Final replies omit unrelated old-topic missing-search receipts while preserving misses explicitly asked in a multi-item question; raw tool diagnostics are retained. Text replies can reveal observed items on an already verified menu before framing them, including after an old filter hid them. They never navigate away from checkout to produce a cue; voice cues still follow playback and preserve the page.

A visible PB recommendation batch keeps all selected cards framed while one hand visits each card in order. Passive cues omit duplicate product-name labels; native cards retain their own names and prices, and operation cues retain their action labels. The optional tour runs after the visible receipt, so it does not delay speech, block customer input or scroll the page. New input or a replaced card retires the old cue. While a recommendation choice is pending, Jev can choose another batch for “還有什麼”; this preserves price/dietary restrictions and does not turn the previous batch into excluded foods.

Spoken guidance prioritizes voice requests and assisted operations. Ordinary table selection, menu recovery, cart confirmation and notification-phone prompts do not advertise manual alternatives. Necessary scanning, phone payment authorization, verified tool failures and genuinely missing capabilities retain brief, explicit manual instructions. The PB LINE Pay entry currently still needs one manual selection because no voice-opening tool is available; this is a known capability gap, not a claim of fully touch-free checkout. Native controls remain usable.

After cart confirmation, the assistant announces the actually selected invoice method as a preselection and asks which method the customer wants. A form default never supplies customer consent. Native invoice focus targets the visible radio label before focusing its input, so Element Plus’s decorative indicator does not count as an obstruction; genuine overlays still block automated steps. A product dialog that naturally finishes closing after an add does not cause the following cart review to fail by trying to close its vanished button.

On PB payment selection, this kiosk supports **LINE Pay only**. Other provider links, including credit cards, are disabled and an inline explanation is shown. The native cancellation control remains available; the assistant never initiates payment. If PB does not offer LINE Pay, it directs the customer to staff. This native enhancement requires rebuilding the Desktop PB bundle; a frontend-only update is insufficient.

Legacy ASR requests include the capture-time ordering service ID and bounded, previously observed menu names. The Server validates that site against the device's assigned published Profile, adds its catalog names/aliases, and forwards up to 100 unique vocabulary terms in the upstream `prompt` (under 2,000 characters). Browser-supplied names are pronunciation context only, never ordering authority. No additional model or post-transcription replacement is used; the original ASR response remains the transcript. These hints need real microphone acceptance testing with the configured ASR provider.
 Published Site policy resolves the chat and audio models on the Server; provider credentials and API keys never enter the kiosk bundle or settings surface.

In Webnavior's published Kiosk Profile, **僅允許語音對話** hides the customer text composer and starts pre-authorized microphone capture on load. The kiosk visibly indicates whether its microphone is actively listening; it sends audio and reply text only to device-authenticated Server audio endpoints.

The Profile can also include an optional PNG, JPEG, or WebP **服務場景** image. It is served as an immutable versioned kiosk asset and appears behind the virtual service character after the Profile is published. When no image is configured, the kiosk deliberately uses its built-in counter scene, so a readable service setting does not require a background upload.

The kiosk captures complete ASR utterances independently while model or browser work continues. Real speech and the simulated-ASR input enter the same bounded decision queue. Jev first filters background speech; an ignored utterance neither interrupts the spoken reply nor reaches Main Agent. A related follow-up may restart an Agent that has not yet requested a browser tool, preserving both user turns in the visitor session. Once a tool is requested, new speech waits for the definitive result and is re-evaluated against the latest menu/checkout state. The queue reserves speech order before ASR returns, and overload is shown rather than silently dropping a phrase. Ordering workflows remain responsible for explicit customer confirmation before submission. The local decision-flow diagnostic switch exposes a larger per-utterance decision inspector.

Completion countdown and reception reset retire customer ASR reservations,
Jev/Main decisions, streamed replies and TTS immediately. Text simulation is also
closed during those phases. A canceled provider that ignores abort cannot hold
up the next reception or clear its progress when it eventually returns. Visitor
session start/end callbacks are bound to their lifecycle, so late responses cannot
adopt or clear the replacement session. Dispatched browser writes still settle
through the document's serialized operation queue; this is not permission to
replay an uncertain write. Administrator microphone tests remain independent.

PB cart availability follows the current readable page, not a persisted reception
ID. A first-visit missing-table response still requires table selection and Start,
because PB needs that table context before it can return cart facts. Reset keeps
its cancellable read lifecycle and never replays uncertain writes; this is
operation/readiness handling, not customer ownership inference.

Proactive recommendation invitations have their own structured question receipts.
They survive idle within the same order, renew a per-decision answer ticket, and
clear only when the customer session resets (unanswered idle expiry, confirmed
completion or explicit new order). A service-owned pending question always
takes priority; configuration, checkout and active Agent work cannot create or
accept a host invitation. Acceptance asks for up to three recommendations only.

Ordering Agent replies use same-turn menu/operation receipts rather than free
model product claims. Empty vegetarian results cannot be padded with invented
dishes; a missing lookup produces a safe explanation instead. Multiple lookups
remain available and their base prices can be compared, but unsupported free-form
explanations are not presented as facts. Cart-only summaries use the actual cart.
No extra tool or payment authority is introduced.

Text mode exposes only the simulated-ASR input, with no separate ordinary chat
composer. Typed turns use the same decision queue, validation and interactive-service tool path as
speech; Main Agent remains available through escalation and retry.
The text ASR input submits only on a deliberate Enter or button activation,
not on IME composition commits or held Enter repeats. Each submitted draft is
consumed before notifying the parent. This does not deduplicate matching text or
block later utterances while an earlier request is processing.
Browser component regressions run separately from the Node unit suite:

Use the package-scoped commands below. The root and Kiosk may resolve distinct
Vitest/browser peer instances even at the same version; starting the root runner
with the Kiosk config can stall before test collection.

```sh
pnpm -F @proj-airi/stage-kiosk exec vitest run --config vitest.browser.config.ts
# To use an installed Chrome instead of Playwright's downloaded Chromium:
VITEST_BROWSER_CHANNEL=chrome pnpm -F @proj-airi/stage-kiosk exec vitest run --config vitest.browser.config.ts
```

The paid-order reward regression is opt-in and uses an isolated loopback Bridge.
Start it with `ORDER_MENU_SERVER_PORT=5182 ORDER_MENU_POS_SIMULATOR_PORT=5183
ORDER_MENU_ALLOWED_ORIGIN=http://localhost:63315 pnpm -F @proj-airi/order-menu-server
exec tsx src/bin/run.ts`, then run:

```sh
VITEST_BROWSER_CHANNEL=chrome VITE_ORDER_MENU_COMPLETION_TEST=true VITE_ORDER_MENU_SERVER_URL=http://localhost:5182 VITE_ORDER_MENU_PUBLIC_URL=http://localhost:5166 pnpm -F @proj-airi/stage-kiosk exec vitest run --config vitest.browser.config.ts src/components/OrderCompletionFlow.browser.test.ts
```

This exercises the actual menu in an iframe through test payment and acceptance,
then checks the configured completion reward and separate order-continuation link.

Before a conversation starts, an engaged person's intelligible but semantically
uncertain utterance becomes a short-lived browser-only candidate instead of
being retained as a visitor turn. The Kiosk asks once whether help is wanted;
a short affirmative answer promotes the already transcribed original utterance
without requiring the customer to repeat it. Candidates expire without saving
their audio or transcript when they are not confirmed.

### Webnavior Kiosk Activity Manifest

An approved interactive service can optionally serve `/.well-known/webnavior-kiosk-activity.json` from its own origin. It provides customer-facing status labels for its service tools; it does not change tool execution and is never sent to the LLM. The kiosk ignores missing, unavailable, or invalid manifests and uses its generic status labels instead.

```json
{
  "version": 1,
  "tools": {
    "cart_add_item": {
      "running": "正在將餐點加入清單…",
      "success": "餐點已加入清單。",
      "error": "無法加入餐點，正在重新確認…"
    }
  }
}
```

The manifest must be served with CORS allowing the kiosk origin to fetch it. Labels are display-only: each non-empty label is capped at 160 characters and malformed entries are ignored individually. New tools without an entry continue to work and display the generic progress message.

Local administrator PIN verification is Server-owned, device-bound and rate
limited. Provider credentials remain on the Server.

During a bound Main Agent task, the ordering page temporarily locks customer
controls and shows **Use manual controls**. Switching aborts model transport,
stops later tools, waits for the already-dispatched tool receipt, and then ends
the matching browser task. Accepted changes and receipts are retained; the demand
is never replayed. Pending captured utterances are dropped on this explicit
switch. The same cart stays in use. Normal completion returns control before
question presentation or speech playback. A disconnected browser cannot prove
release; restart the session to replace that document rather than unlocking on
a timer. This control currently applies to Main Agent tasks; Fast Path retains
its existing execution flow.

PB notification-phone entry uses a closable floating numeric keypad in the native
ordering page. It opens from phone focus or its keypad trigger and leaves the
merchant form layout intact. Customers can type or tap digits when speech recognition fails;
clear/delete edit only the phone draft. The guidance lists cart review, invoice,
contact details and final submission in order. Scrolling and editing contact
fields preserve the current checkout question; actual form changes still require
fresh final-summary validation. A cart-review answer such as **這樣就好** advances
to invoice selection and grants no submission consent. Cart review speaks both the
verified PB receipt and the explicit confirmation question, even while invoice
controls are still loading; it rechecks the active task and cart version before speaking. Standalone cart/menu navigation
reads only current page/cart facts before intent selection, so fetching the full
menu does not hold up the visible action. Cart review also reads back without
fetching the menu; compound requests and pending questions retain full interpretation.

Customers are not asked to press a reconnect button. After a connection failure
or unknown cart effect, the host waits for active work to settle, then makes a
bounded series of automatic reconnect/readback checks. It never replays the
failed customer request. Exact verified single-cart effects can resume ordering;
unverifiable or multi-step effects retain the cart and ask staff for help. The
manual recheck control is available only inside the administrator panel.
Reception/document changes and component disposal invalidate late recovery
results. Repeated speech while paused does not repeat generic fallback bubbles.

Checkout invitation, cart review, invoice choice and final submission questions
remain bound to reception, document, observed cart and expiry. Unrelated menu
configuration updates do not invalidate these cart questions. Product/purchase
questions still validate their original product evidence; final submission also
rechecks the native form and one-use confirmation token.

Invoice/contact entry progress is kept separately from expiring questions within
one reception and PB document. A fresh read can rebuild an entry prompt after a
cart revision or timeout; it never restores a phone buffer, old submission token
or consent. Saying **好了** follows the actual unfinished field. Final consent
also binds the observed invoice/contact form, so edits require a new summary.
Jev receives only the bounded step and field readiness, without field values.

Recovery distinguishes verified no-effect rejection, applied changes, partial
changes and unknown effects. A native submission refusal proven to precede
dispatch can rebuild the summary and request new consent; it never resubmits.
Missing or uncertain write receipts retain verification barriers. Active checkout
cannot use the ordinary service-answer path to claim an invoice was selected
without a Host receipt.

On a PB payment/result page, Restart first reads fresh order and reception state
through `browser_state_get`. Verified paid or cancelled orders with no pending
operation barrier retire the visitor and reload the configured table-entry URL;
the old order is preserved and editor tools are never refreshed on its result
page. Unpaid orders ask the customer to complete payment or explicitly abandon
it on screen. Unknown payment or an unresolved journal marker retains the same
reception. A failed state read cannot fall back to an unchecked reload. These
specific lifecycle refusals are displayed to the customer; transport details
remain behind the generic failure message.

## Desktop LCMV input (0.6.3)

With UMA-8 and the existing LCMV algorithm selected, the EXE uses native physical
eight-channel input through `airiKioskArrayInput` v1. Browser-only capture and
Spatial Mask retain their original sources. Operators select the native microphone
in array settings and speakers in the normal output selector; saved LCMV parameters
and recognition policy are unchanged. Old EXEs require an update rather than a mono
substitution. Auto mode needs a previously identifiable UMA-8 label; explicit UMA-8
mode works without browser device enumeration.

`capture.ts` initializes the same AEC3 WASM/LCMV worker, transfers the native port
and the reference Worklet port into that worker, and leaves final PCM delivery in
the original VAD/ASR path. These ports bypass renderer scheduling. The raw native
owner performs only capture/reference clock pairing, with the existing 100 ms input
delay and bounded drift correction; it loads no denoising/RTF model. Source timestamps
subtract the reported native input delay after the connection is ready. Physical
Windows clocks, AEC quality, recognition and device switching remain acceptance tests.

### PB flow ownership audit

Native `browser_state_get` identifies the PB protocol across editor and read-only
payment documents. Missing editor/visual tools do not switch it to the owned
Order Menu protocol. Explicit named-meal quantity requests suspend a prior local
checkout question through the existing dialogue policy, preserving merchant
fields and cart. Ordinary captured/completed speech has no age-based queue
expiry; cancelled/reset/disposed capture ownership is diagnosed as retired,
not as an expired recording. Historical architecture audit:
[conversation repair](../../docs/plans/2026-10-28-kiosk-conversation-repair.md).
