# AIRI Kiosk

`@proj-airi/stage-kiosk` is the full-screen AIRI surface for a restaurant kiosk with voice-led ordering and existing touch controls. It shares AIRI's local hardware UI, LLM tools, and independent `@proj-airi/order-menu` service; the Server owns all ASR/TTS provider, model, voice, endpoint, and credential policy.

Use it for customer-facing horizontal or vertical kiosk displays. Do not use it as a replacement for the normal settings-oriented `stage-web` application.

Chinese conversation text, recognized-speech display, status messages and diagnostic
transcript headings use the shared OpenCC Taiwan Traditional converter. Speech
synthesis receives the same converted text. Ordering copy keeps 菜單 and 虱目魚
instead of OpenCC's generic word substitutions. Presentation uses copies: original
ASR, model history, tool arguments/results and raw diagnostic traces remain
unchanged for decisions and troubleshooting. Text typed into the simulation
input is also submitted unchanged. This normalizes Chinese writing; it does
not translate other languages or verify the truth of a model reply.

## Run

Start the menu service, then the kiosk:

```sh
pnpm --filter @proj-airi/order-menu dev
pnpm --filter @proj-airi/stage-kiosk dev
```

The layout follows the display orientation by default. Set `VITE_KIOSK_ORIENTATION=landscape` or `portrait` to lock a deployment to one orientation.

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

External PB does not expose the owned Menu's `kiosk_conversation_context`.
The Server now selects one fixed workflow skill from the verified page and
pending task. Selecting a table never fabricates an empty cart: meal tools stay
hidden until the native menu/cart can be checked. On the RD table page, customers
can use large buttons or name an offered table. They can say「A1 桌，開始點餐」
in one turn, or name the table first and then say「開始點餐」. After a valid
selection, the reply explicitly asks the customer to say「開始點餐」or press
the Start button; the table selection alone does not enter the menu. It does not
repeat the initial instruction to find a seat and supply a table number. Host admits entry
only for an explicitly named or native-verified selection; an unchosen default
cannot authorize entry. Native Start opens the menu, never submits an order.
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

The selected Chat profile's SSE mode streams transport events, but the Kiosk
currently uses assistant deltas only for progress. Customer text and TTS wait
for the completed tool loop and receipt validation; this is not word-by-word
reply display. Internal service-admission decisions keep JSON responses.
A current admitted request receives a non-operational clarification if its
independent review fails; cancelled or unknown/background speech does not gain
tool authority. Jev receives the actual visible product dialog separately from
cart contents, so closing a viewed dish cannot imply deleting a purchased meal.

Final detail replies retain the website's meal contents as well as verified
prices. An `open_menu_item_details` receipt may include the whole rendered
catalog; only products matching that receipt's current `productDialog` are
used to answer. A successful detail window must not become a no-query fallback,
and failed or unrelated dialog data does not establish meal facts.

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
configurations, owned cart, provided fields, unfinished dish, pending question
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


For the approved eight-piece dumpling product, `piecesPerServing` supplies the
total pieces in each serving; Host derives the extra option count and current
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
cart tools; menu location does not prevent cart edits. Startup cart preparation
runs on the table page through a Host-only fresh cart read, before exposing
Start. An unowned cart or failed preparation shows an explicit preparation
panel and Restart action instead of a blank native region. Same-reception
ownership survives normal menu/cart navigation. Browser recovery reports purchase-retry admission separately from explicit cart-reset admission (`canRetry` / `canReset`). A prior document’s cart marker can be retired only by a customer-requested clear with a fresh empty-cart readback; current uncertain writes and order-submission and uncertain-clear (`reset:`) markers stay blocked across reloads. Reset failures display localized customer guidance, with internal details in diagnostics. Explicit Restart from table
entry verifies settled work; an empty cart needs only an entry reload, while
an occupied cart enters through PB's actual selected-table Start control under
the maintenance cover and then clears/verifies its real cart before reloading.
Ordinary table context never exposes prior cart contents to the models.
A3/A03 resolve to the one actual current table.
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

The yellow voice panel reports microphone/VAD/ASR, blocking reasons and TTS overlap.
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
its assent advances to invoice choices, never submission. Codes/email may be
entered on the website; phone drafts must match the current customer text.
The final submission question includes meals/options/notes, website total,
table, invoice and notification details. Its native token is private, expiring,
one-use and invalidated by any cart/form/manual-interaction change.

Automated submission is currently enabled only for the approved owned fixture
at `127.0.0.1:5188`. The merchant result/navigation flow remains unverified and
uses manual submission guidance. A native dispatch acknowledgement is not proof
of payment. The owned fixture now returns a typed pending/accepted/unknown/rejected result.
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
The Host still checks visitor ownership, ambiguity and fresh vendor versions;
only a verified browser receipt can claim an effect. Necessary follow-up answer
resolution remains a separate semantic task. Uncertain ordering meaning may
create a complete sealed confirmation question, without writing; factual
read-only inquiries cannot create purchase confirmation. Background speech does
not cancel accepted compound operations.

Customer order checks use `browser_cart_review`: the Host checks a fresh
cart snapshot before opening the native review and checks the resulting receipt
again afterward. It does not resolve or consume a pending product question.
An unowned cart is refused before its contents are opened or spoken.
Review has no model-controlled parameters: Host invokes the fixed native
capability with `{}`, so extraneous model fields cannot change the operation or
trigger a schema-repair loop. This policy applies only to the argument-free
read-only review; cart writes retain their full argument validation.
Pure review/preservation requests use the read-only cart review. If Main instead
proposes setting an observed line to its existing count, an independent semantic
check may recognize whole-order preservation and dispatch only a fresh owned
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
ownership checks still apply before any effect. Browser context failures use
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
document/cart and ownership checks. Explicit recovery still requires a verified
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
Disconnected speech does not repeatedly enter Main Agent. **恢復菜單連線**
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
Ending a reception uses Host-only `browser_customer_reset`: read the current
cart, click PB's native cart-header **清空** once when rows remain, and verify
both empty rows and zero subtotal. It then closes the product draft, clears
search, returns to the menu and renews the Host connection in the same PB
document to verify the result. The Host then reloads the configured entry URL
(PB's select-table page), replacing the previous customer's document and tool
handles while retaining the dedicated browser profile's login. A successful
native reset alone does not prepare the next customer's entry screen.
This applies to explicit new-order/reception actions and actual
idle/completion end, not the continue-ordering dialog. Main cannot call this tool.
The customer restart button waits for active website operations or a disconnected
binding, rather than model thinking alone. Restart enters the reset state
immediately and cancels the old reception's ASR/Jev/Main/TTS work; its audit entry
captures the old visitor but does not delay reset on a network acknowledgement.
Presentation cleanup belongs to the reset lifecycle, so a late audit or reset
continuation cannot clear the next customer's conversation.
Reception reset skips the illustrative hand's travel, dwell and press timing.
An opaque loading cover masks native intermediate navigation while the Host
announces that it is preparing a new order. Trusted input is blocked during this
maintenance scope, but native target/occlusion, ownership and fresh-cart checks
still run. The cover survives SPA navigation and is removed on success or failure.
The store's **我知道了，開始點餐** announcement is optional: its exact visible
control is handled only when present; it is not a mandatory step or a generic
confirmation handler.
The old visitor/chat closes only after reset succeeds. Pending/unknown effects
block reset; an uncertain clear is never automatically replayed. A failed return
to the menu can be retried against the already empty cart without another clear.
Local ownership stores only an opaque visitor ID scoped to service origin/path.
A fresh empty cart can transfer automatically; a previous/unowned nonempty cart
blocks assisted changes and hides old lines from Agent. The PIN-protected admin
panel can review the fresh snapshot and explicitly resume that same cart, only
if visitor/document/version remain unchanged and no effect is uncertain.
This local gate does not isolate an account's cart across different devices.

Each write requires the latest cart version, current product/line reference and
whole-cart readback. Replacement verifies the new item before removing the original.
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
An abrupt reload/crash may still leave a cart and its persisted visitor ownership.
Direct acknowledgement/clarification/information-fallback replies
read the cart before responding, so Main cannot skip the handoff gate by choosing
`browser_respond` immediately. Unowned unfinished items yield a short staff-review
message without exposing their contents, clearing them or adopting them. A failed
read is not an empty cart; typed sign-in failures retain their login prompt.
`browser_respond kind=checkout-guidance` checks ownership and reviews the actual
cart. Adapters with verified checkout controls advance through the staged invoice
flow above; other adapters give manual guidance (or report an empty cart). This
reply does not itself authorize submission or payment. Guidance receipts end the turn without another Main
continuation. Staff may use **Settings → External cart handoff** to review and
resume the same in-progress cart; a new visitor does not authorize that transfer.

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

While deciding an idle input, the existing live TTS route prepares only the fixed,
localized receipt text, never that input's transcript. Playback requires service
admission and a current turn; receipt audio plays as soon as ready, without the
ordinary waiting mode's one-second grace period. Each preparation belongs to one
input, with no cross-customer audio cache. Inputs classified as background or
unfinished discard unclaimed audio without playing it. This relies on Jev's
classification, not an independent guarantee that all background speech is caught.
Final results, cancellations, manual handover, new turns and scene disposal stop
optional audio without cancelling an order. Failed/disabled TTS leaves text and
execution intact. Receipt speech is progress, not a completed operation or a
customer choice, and uses the site's existing TTS model, voice and locale.

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

### Welcome mode and prepared speech

Choose **固定歡迎詞** or **VLM 情境生成** under **互動體驗 → 開場招呼 →
開場招呼方式**. This uses the existing Server-owned `proactiveVlmEnabled` policy:
false selects fixed openings; true selects vision generation. Device overrides
retain their existing precedence over the Site default. Reload the Kiosk to
fetch the current effective setting immediately.

Proactive welcomes rotate through the published Profile's `greetingPhrases`
(1–50 openings, up to 500 characters each). Configure them under **互動體驗 →
開場招呼 → 固定歡迎詞**. Unset phrases deliberately select three shared localized
openings. On the optional-phone screen, Kiosk appends the localized explanation
that the customer may enter a phone number or skip directly to ordering. Do not
include that explanation in each configured opening.

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
voice-only Profile; turn it off to return to the Profile's voice mode. A Profile
that already allows text keeps its text entry. Changing this setting does not
reset the PB document, its login, or its cart. Devices refresh effective policy
every 10 seconds and on focus, retaining the last acknowledged snapshot offline.
A successful local save takes effect immediately; stale responses cannot undo it.

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
on an individual device. The Kiosk then shows its latest eight VAD segments as
recognizing, unrecognized, recognized, failed, or decided, together with the
Speech Guard label/score when available and the final turn-decision reason.
The Server returns these diagnostics only while that device setting is enabled;
turn it off after testing because recognized visitor speech is visible on screen.

Deployment requires migrations `0032_kiosk_device_settings.sql` and
`0033_kiosk_voice_vad_settings.sql` before using the
new Server routes. Include it in the Server schema package used by the normal
startup migration process, then deploy the matching Dashboard and Kiosk assets.

### Voice activity detection

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
expired capture reservation or visitor reset rejects the whole utterance; partial
speech never becomes a separate order. Each successfully transcribed chunk
renews a 15-second inactivity deadline; a stalled chunk aborts remaining uploads.
The separate 15-second queue freshness window starts only after the complete
transcript is ready, so successful long recognition does not expire merely from
its total duration. Capture order and visitor-reset cancellation remain intact.
The archival recording retains the complete original utterance. ASR413 is shown
as an upload-size refusal, separately from incomplete recognition/provider failure.

### Local access

Tap the settings label five times within two seconds, then enter the PIN on
the on-screen keypad. Configure `KIOSK_ADMIN_PIN` or `KIOSK_ADMIN_PIN_FILE` on the
Server; no PIN is embedded through a frontend `VITE_` variable. Closing the panel
revokes the local grant. PB's native View hides while a host dialog owns input.

Administrator mode can choose the microphone, adjust the locally stored customer conversation text size, enable or disable voice input, and pause the avatar for calibration. Published Site policy resolves the chat and audio models on the Server; provider credentials and API keys never enter the kiosk bundle or settings surface.

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

An admitted PB cart retains its current visitor in memory for the reception;
storage eviction alone does not interrupt active ordering. After reload or at a
new reception, an unknown nonempty cart still requires review. Initial preparation
checks before exposing ordering controls, including on the table page when PB
allows it. For PB’s exact first-visit missing-table response, only table selection
and Start remain available; no cart ownership is granted, and the menu must pass
a fresh check before ordering. The host does not infer that the physical customer
changed from page or speech changes.

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

Checkout invitation, cart review, invoice choice and final submission questions
remain bound to reception, document, observed cart and expiry. Unrelated menu
configuration updates do not invalidate these cart questions. Product/purchase
questions still validate their original product evidence; final submission also
rechecks the native form and one-use confirmation token.
