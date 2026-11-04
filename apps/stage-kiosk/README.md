# AIRI Kiosk

`@proj-airi/stage-kiosk` is the full-screen AIRI surface for a restaurant kiosk with voice-led ordering and existing touch controls. It shares AIRI's local hardware UI, LLM tools, and independent `@proj-airi/order-menu` service; the Server owns all ASR/TTS provider, model, voice, endpoint, and credential policy.

Use it for customer-facing horizontal or vertical kiosk displays. Do not use it as a replacement for the normal settings-oriented `stage-web` application.

Chinese conversation text, recognized-speech display, status messages and diagnostic
transcript headings use the shared OpenCC Taiwan Traditional converter. Speech
synthesis receives the same converted text. Presentation uses copies: original
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

For a public deployment, build with `VITE_API_SERVER_URL` and
`VITE_SERVER_URL` set to the public API origin, and
`VITE_ORDERING_SCENARIO_URL` set to the public Menu URL. These values are
compiled into the browser bundle; changing Server environment variables after
building does not update them. An isolated worktree does not inherit ignored
`.env.production.local` files. Verify the compiled registration destination,
not only static asset hashes, before publishing. Build the embedded Menu with
its matching `VITE_AIRI_ORIGIN`, `VITE_ORDER_MENU_SERVER_URL`, and
`VITE_ORDER_MENU_PUBLIC_URL`, plus the deployment's `/menu/` base path.


The Server omits this endpoint unless the flag is exactly `true`, and always
omits it when `NODE_ENV=production`. A production kiosk will replace this
screen with the QR-code enrollment flow.

## Meal clarification

`pnpm -F @proj-airi/stage-kiosk test:history` replays sanitized historical
quantity and fulfillment claims plus the current ordering regressions described
under Main ordering skill handoff. It aliases `test:ordering-regressions`.
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

Service clarification is a bounded context cue, not automatic admission for the
next microphone segment. Silent background/uncertain segments neither renew nor
consume its original expiry; an accepted handoff settles it, and Menu revisions
or expiry invalidate it. Only admitted clarification turns add chat messages and
paired transcript metadata. Existing short answers still require their current
question and its issued operation authority. Background long-chain regressions
are retained in Order Menu's incident scripts alongside the frozen112 suite.
Silence describes presentation, not intent: background, uncertain recipient and a
valid read-only pause are assessed separately. Recovery timeout/invalid/provider
failures remain technical failures even if the outer decision still has an
uncertainty reason. Model replay records `serviceObservation` from actual scope,
recovery or finite decision evidence, and checks accepted dialogue/cue/tool effects
before accepting an unadopted turn. A completed sentence is not service evidence.

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

## Uncertain service recovery

An eligible, valid Jev service abstention can request one no-commerce Main
adjudication, followed on REQUEST or UNCERTAIN by one richer contextual review.
Admission and understanding are separate: unclear service speech asks for meaning
before Main receives a task; it does not revive an older ordering question.
This is separate from a real Main Agent task: it admits service meaning, never
an operation. A review can ignore, abstain, hand off the original request, or
create a read-only service question. Its answer cannot consume an older Menu
purchase/payment question. Independent new requests leave that clarification
without inheriting its authority. After the customer answers a service
question, an admitted review that still requests clarification hands the context
to read-only Main rather than renewing the recovery question indefinitely.

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
through the same conversation loop. With current Menu context, customer text is
rendered from validated reply selectors or actual tool receipts; draft success
claims are not displayed as completed operations.

An unknown tool name causes a preflight rejection of its entire proposed batch,
before any sibling tool executes. The Host returns correlated `UNKNOWN_TOOL` /
`BATCH_NOT_EXECUTED` results and allows one corrected proposal using refreshed
facts and the current tool list. It never maps an unknown name or invents missing
arguments. A second invalid proposal ends the task. Actual execution rejection,
timeout or uncertain writes retain their existing stop/result-unknown behavior.

An ordering task that ends without an operation may receive one completion
review, preserving its original utterance, related dialogue, current facts and
exact scoped tools. `main_completion_review` records this reservation by visitor
session and task ID. Existing read-only authority, customer entry, checkout and
payment boundaries are unchanged; a previous operation attempt suppresses review.
The review can propose the missing operation or return a validated information /
clarification selector. It shares the existing turn deadline and tool budgets;
it is not an additional Jev classifier or permission grant. After the single
review, malformed prose falls back to clarification without another provider
repair. Once effects occur, displayed results still require actual receipts.

Offline regressions for this flow run with:

```sh
pnpm -F @proj-airi/stage-kiosk exec vitest run src/services/fieldQuantityRecovery.test.ts src/composables/useKioskInteractionRecording.test.ts src/services/questionPresentation.test.ts
```

`mainQuantityReplay.test.ts` is disabled by default. Its
`KIOSK_MAIN_QUANTITY_REPLAY=1` opt-in uses the selected provider metadata in the
existing local `/tmp/webnavior-main-scope-profile.json` fixture and a locally
provided `LLM_ROUTER_MASTER_KEY`. It sends two synthetic scenarios, application
instructions and a scratch menu/cart to that provider, consuming model quota.
Provider credential use and external egress require explicit authorization.
The Host, HTTP API and database are isolated; it never calls production Kiosk,
POS or payment endpoints. Never commit the private profile or decryption key.

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

Each customer starts an anonymous Kiosk session when they touch the screen, type a message, speak, or operate the menu. The session owns only that customer's conversation and cart:

- After three minutes without activity, it asks whether to continue and starts a 15-second countdown. Showing the dialog does not clear anything. **繼續點餐** cancels that countdown and keeps the same session, conversation, cart and unfinished ordering requirement (including the selected meal, known quantity/options and pending question); it does not reload the menu or repeat the question. Only unanswered countdown expiry, confirmed order completion or explicitly starting a new order/reception clears that context and ends its durable visitor session. Pending AI/tool work and high-confidence engaged presence retain their existing idle-timer protection. Lookups and deferral do not reset context. Internal answer tickets remain short-lived and are renewed on the next decision turn; financial/destructive confirmation authority is not extended by continuing.
- After an order is confirmed accepted, the completion screen (with an optional survey QR Code) remains until dismissed or its countdown ends; then the customer conversation and menu/order state are reset to clean standby. Failed, rejected, uncertain or still-pending submissions do not trigger completion/reset.
- The owned menu reports completion immediately after payment and accepted submission. Its transient order-continuation URL is displayed as a separate QR and desktop link alongside the configured reward/survey; the customer need not acknowledge the order QR before the reward appears. Only the non-personal order result enters the archive; the capability is cleared from host memory when the customer session ends.
- In administrator mode, use **結束目前接待** to immediately clear the current customer's data.

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
Semantic uncertainty, ignored/incomplete speech and clarification keep their
existing policies. Browser execution failures are separate: unknown mutation
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
mutation retries. Main Agent tools run serially. A task starts with four tool
batches; each additional verified target in its initial Menu handoff reserves one
evidence read and one effect batch, up to eight batches. The total16-call limit
and60-second model deadline remain; exhaustion/rejection retains actual receipts and reports
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

## Local diagnostic overlays

In text mode, the simulated-ASR input, timing and full decision trace share a
floating console. Drag its title bar with a mouse or touch, collapse it to keep
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

An idle Kiosk shows localized neutral progress after service relevance and the
recipient are confirmed. A weak route followed only by a confident recipient
does not display progress. This display does not take ownership of an interaction
turn. It gives way to the existing tool-progress bubble during Main Agent work; a continuation preserves
the latest tool status rather than resetting it to understanding after each SSE
round. Background/unfinished/uncertain utterances never trigger waiting speech.

An admitted Agent handoff starts one fixed, localized acknowledgement through
the existing live TTS route in parallel with model work. It plays only if the
request is still pending after one second and audio is ready. Quick final
results cancel pending audio; final replies, cancellations, manual handover,
new turns and scene disposal stop any waiting audio through its own abort
signal. They never abort an order merely to stop this optional output. Disabled
Fast Path/provider-fault fallbacks do not establish a recipient and therefore
have text progress only. Failed/disabled TTS also leaves text progress and order
execution intact, with no within-turn retry. Waiting audio is not dialogue or a
customer choice, does not change the order's interaction phase, and shares the
normal output player. No new settings, provider or prerecorded bank is required
for this trial. It uses the site's existing TTS model, voice and locale.
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
(`/admin/kiosk/devices`) to configure each registered Kiosk and delegate
individual fields with **Allow local changes**. The Kiosk's **現場設定** page
edits the same Server-owned policy; saving requires the device cookie and a
signed-in system administrator or an administrator of that device's Site.
The PIN alone cannot authorize a settings write.

Precedence is Site defaults, then administrator device overrides, then explicitly
delegated local overrides. Site defaults cover camera capture (off, JPEG snapshot,
event clip, or continuous video), VLM, performance, and VAD; observation,
greetings, reminders, timing, detection zones, and the MediaPipe face-confidence
threshold (`0.40`–`0.80`, default `0.60`) have shared defaults and can be overridden
per device. Newly enrolled devices override observation, greetings, reminders
and voice diagnostics to enabled, with greeting trigger `mixed` (any signal).
Those five settings permit local adjustment from enrollment. Other fields remain
locked unless delegated; existing saved device settings are unchanged. Old browser-local observation
preferences are no longer authoritative and are not migrated automatically.

The **Presence vision mode** setting is per-device and supports `face_only`
(the legacy baseline), `pose_only`, and `pose_plus_conditional_face` (the
default). Pose modes use local Pose Lite for anonymous relative body-scale and
movement evidence; conditional face checks run only for attention-capable
greeting modes and never in the same inference callback as Pose.

Removing delegation discards that local value permanently. Administrators may
also clear an existing local override while keeping the field delegated. Every
accepted write increments the device revision and records the operator and
before/after values in the audit log. A stale form receives HTTP 409 and must be
reloaded instead of silently overwriting another operator's changes.

The active Kiosk refreshes effective settings every 15 seconds after the previous
request finishes. Offline it retains the last snapshot; reconnection applies the
current policy. Camera work is stopped and restarted when policy changes, and
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

The visitor experience does not display settings. Long-press the `AIRI 餐飲服務員` label for 1.2 seconds, then enter the PIN configured before starting the kiosk:

```bash
VITE_KIOSK_ADMIN_PIN='choose-a-private-pin' pnpm --filter @proj-airi/stage-kiosk run dev
```

Administrator mode can choose the microphone, adjust the locally stored customer conversation text size, enable or disable voice input, and pause the avatar for calibration. Published Site policy resolves the chat and audio models on the Server; provider credentials and API keys never enter the kiosk bundle or settings surface.

In Webnavior's published Kiosk Profile, **僅允許語音對話** hides the customer text composer and starts pre-authorized microphone capture on load. The kiosk visibly indicates whether its microphone is actively listening; it sends audio and reply text only to device-authenticated Server audio endpoints.

The Profile can also include an optional PNG, JPEG, or WebP **服務場景** image. It is served as an immutable versioned kiosk asset and appears behind the virtual service character after the Profile is published. When no image is configured, the kiosk deliberately uses its built-in counter scene, so a readable service setting does not require a background upload.

The kiosk captures complete ASR utterances independently while model or browser work continues. Real speech and the simulated-ASR input enter the same bounded decision queue. Jev first filters background speech; an ignored utterance neither interrupts the spoken reply nor reaches Main Agent. A related follow-up may restart an Agent that has not yet requested a browser tool, preserving both user turns in the visitor session. Once a tool is requested, new speech waits for the definitive result and is re-evaluated against the latest menu/checkout state. The queue reserves speech order before ASR returns, and overload is shown rather than silently dropping a phrase. Ordering workflows remain responsible for explicit customer confirmation before submission. The local decision-flow diagnostic switch exposes a larger per-utterance decision inspector.

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

Invoice regressions cover both the actual `App.vue` parent wiring
(`InvoiceApp.browser.test.ts`) and the real iframe-to-Host connection
(`InvoiceHostBridge.browser.test.ts`). The latter reads the existing loopback POS
simulator catalog and stops at payment-method selection. Start the same Bridge
below with `ORDER_MENU_ALLOWED_ORIGIN='*'` on loopback only, then run:

```sh
VITEST_BROWSER_CHANNEL=chrome VITE_ORDER_MENU_INVOICE_BRIDGE_TEST=true VITE_ORDER_MENU_SERVER_URL=http://localhost:5182 pnpm -F @proj-airi/stage-kiosk exec vitest run --config vitest.browser.config.ts src/components/InvoiceHostBridge.browser.test.ts
```

Incident scripts with `channel: 'main-direct'` bypass finite Jev selection to test
the typed-input Main route. Passing Jev/Main candidate recovery is not evidence
that this separate route passed; guarded provider runs keep their own ledger.

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

`VITE_KIOSK_ADMIN_PIN` is an on-device guard against accidental customer access, not a replacement for server-side administrator authentication: Vite exposes `VITE_` values to the browser bundle. Production deployment should place provider credentials in a protected management service rather than relying on this PIN alone.

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


### Main ordering skill handoff

An admitted weak JEV operation may be independently selected by Main's built-in
`ordering@2` skill. The decision marks `resolvedBy:main-skill`; Host traces use
`decisionSource:main-skill` rather than attributing the selection to JEV. The Host
still executes only a currently issued Menu candidate. Menu owns the resulting
quantity/configuration question and later answer; skill loading never sets a
blanket mutable flag or changes payment/confirmation authority. Menu now issues
`intentRecovery` with current effect IDs and question/request correlation; Server
intersects those IDs rather than reclassifying phase/purpose eligibility.

Menu supplies one draft projection to all three context readers. Host validates
and forwards its `retainedRequests` to both Jev and Main, then replaces it with
the fresh Menu projection on continuation rather than keeping stale task data.
It preserves original requests, known quantity/options and explicit missing
slots; `confirming` and `suspended` describe unfinished work, never cart effects.
Read-only task restrictions still apply even when their draft progress survives. Recovery revalidation reads `kiosk_interaction_state`, never the decision producer; checking freshness must not replace the current utterance's answer ticket. Revision/question changes still reject the recovered result.

The Main tool loop distinguishes `waiting` from completed/failed. A Menu-owned
scope/identity/configuration or new membership/invoice/tax/payment question
pauses the batch before later sibling calls execute, records those siblings as unexecuted, and returns the question
without another model continuation. Deferred calls are not automatically replayed.
Final Host/Menu validation still decides which question may be shown. Operation
presentation retains every accepted receipt in this turn, with only the current
validated question; a later failure reports partial progress rather than losing
earlier successes or claiming the entire request completed.

Run the retained offline field regressions after changing Jev routing, Main
instructions/skills, Host authority/receipts, or Menu ordering state:

```sh
pnpm -F @proj-airi/stage-kiosk test:ordering-regressions
```

`test:history` aliases this command. Root `vitest.config.ts` registers the
`kiosk-field-regressions` project, so the existing CI `pnpm run test:run` also runs
these Kiosk/Menu cases; the Server skill tests already belong to its Server
project. The focused command runs those suites plus the shared draft-schema tests without the full repository suite.
It uses test model responses and isolated databases, makes no provider requests,
and never writes a production order. These assertions inspect domain state and
tool effects rather than accepting plausible assistant prose.

| Retained failure | Stable test coverage | Required result |
| --- | --- | --- |
| Shown meal → omitted-name purchase | `orderingSkill.test.ts`, `agentTargetRecovery.test.ts` | Correct item/quantity in cart; later reads cannot change the target |
| Meal identity confirmation → 對，一份 | `orderingSkill.test.ts`, Menu `mealClarification.test.ts` | Current proposal accepted once; answer quantity retained; refusal/replay cannot add |
| Same answer through Jev / Main / Main abstention | `orderingSkill.test.ts` | Both successful paths have the same cart effect; abstention keeps the same draft and empty cart |
| Missing slots followed by another proposed tool | `useKioskInteractionRecording.test.ts`, `questionPresentation.test.ts` | Wait for customer; no later checkout effect or extra model round; partial receipts survive failure |
| Catalog identity/price/options changes | Menu `conversationMenus.test.ts` | Four catalogs complete lookup → omitted-name order → required options; old answers reject after catalog changes; new order uses current price |
| Shared draft progress and options | Menu `conversationProgress.test.ts`, shared `kioskConversation.test.ts` | All readers agree; unknown quantity stays absent; confirmation keeps original request and selected options; reads do not mutate drafts/cart |
| Missing quantity → quantity answer | `orderingSkill.test.ts` | No early cart write; exact requested quantity after answer |
| Dine-in/pickup answer became recommendation | `orderingSkill.test.ts`, Server `kiosk-conversation-skills/index.test.ts` | Actual fulfillment change; no added dish |
| Checkout invitation → 好 did nothing | Same integration/Server suites | Checkout opens once; no payment call; 先不要 keeps ordering |
| Question expires during inference | Menu `questions.test.ts`, `seatingRuntime.test.ts` | New answer gets its lease; stale/revision-invalid executions remain rejected |
| Price/query changes lose their scope | `priceHandoff.test.ts`, Menu `queryActions.test.ts` | Browser price/query contract and empty cart for inquiries |
| Text claims completion without tool effect | `historicalReplies.test.ts`, `fieldRegression.test.ts`, `questionPresentation.test.ts` | Unverified completion is rejected |

`apps/order-menu/src/evaluation/orderingIncidents.ts` retains sanitized reported
utterances and observed wrong replies, separately from expected cart/phase. The
integration tests consume these records; they are not only prose in a task log.

Real-provider behavior is separately opt-in in `budgetOrderReplay.test.ts`; offline
passing does not establish model/prompt accuracy. It requires the existing server
`DATABASE_URL` and `LLM_ROUTER_MASTER_KEY` in the process environment, explicit
`KIOSK_BUDGET_ORDER_REPLAY=1`, a new private `KIOSK_BUDGET_REPLAY_OUTPUT` path, and
explicit aggregate call/time limits across all runs. It only reads live profiles,
policy and persona; sessions/cart/profile copies are isolated. Do not commit raw
provider artifacts or credentials. The default suite skips this test.

| `KIOSK_BUDGET_REPLAY_FLOW` | Real-provider scenario |
| --- | --- |
| unset | Six fresh turns: 100元 → 其他 → 200元 → 其他 → 水餃 → 兩份 |
| `core` | Four live budget/order turns |
| `meal-skill` | One live meal request after a reconstructed query prefix |
| `checkout-entry` | 好 after a seeded checkout invitation; invoice once, no payment |
| `configuration-order` | 水餃兩份 → synthetic required sauce → pickup → invoice; no early cart effect or payment |
| `query-continuation` | Seed 100元 browsing; live 其他 → 明確看全部; preserve budget until explicit catalog request |
| `confirmation-order` | 一份排骨飯 → 排骨便當 → 對，一份 → 內用 → 好; fresh five-turn incident replay |
| `context-order` | 想吃排骨便當 → 那我要一份 → 內用 → 好 |

For `context-order`, also run with `KIOSK_CONTEXT_ORDER_LOOKUP_PREFIX=1` to retain
the observed read-first branch: seed the verified one-dish lookup, then run the
remaining three turns live. A natural run that instead asks quantity first does
not cover this branch. `KIOSK_CHECKOUT_MAIN_PROBE=1` in `checkout-entry` explicitly
injects the observed Jev admission abstention to exercise real Main recovery; it
must be reported separately from natural Jev routing. Record seeded prefixes,
actual cart/phase, model-call totals, and failures; a single probe is not full-flow
or production acceptance. No payment is executed in these entry probes.


### Frozen conversation matrix

`apps/order-menu/src/evaluation/conversationMatrix.ts` owns112 script positions:
20 original conversation chains, eight expanded existing provider probes, four
reconstructed previously planned sessions, and80 new flows across16 families.
The earlier plan called the baseline32 complete flows; that was inaccurate.
D07/H05 retain insufficient-entry-state diagnostic labels and cannot pass as
completed historical replays. `conversationMatrix.test.ts` verifies provenance
links and tests that the oracle rejects wrong items/quantities, recommendation
without purchase, and over-budget results. It is part of the fixed regression gate.

To replay one reconstructable script using the same real Host/Hono/Menu harness,
provide the existing environment and explicit limits described above, plus
`KIOSK_CONVERSATION_SCRIPT=C14-F2`, then run:

```sh
pnpm -F @proj-airi/stage-kiosk exec vitest run src/services/budgetOrderReplay.test.ts
```

The harness applies the explicitly versioned outcome policy from
`conversationAcceptance.ts` without modifying the frozen matrix. Artifacts include
both `historicalScript` and the current script plus `acceptancePolicy`; optional
replies never waive state preservation or hide failed model recovery. Keep
superseded/deferred positions separate from current functional results.

Use a new0600 output path each time. The JSONL includes frozen script metadata,
turn snapshots, raw provider wire without credentials, receipts, assessments and
actual call totals. Keep a single aggregate budget across processes and failed
runs. Preselected smoke12 and high-risk24 IDs are exported with the manifest;
high-risk acceptance requires three complete passing replays on the accepted
implementation. Gold never enters provider input. Do not silently edit gold after
observing a failure or count a seeded/synthetic control as an original incident.

For D07/H05 only, `KIOSK_CONVERSATION_DIAGNOSTIC=seeded-entry` explicitly supplies
the missing entry-ready precondition. Their output records the evidence gap,
`seededEntry` and `historicalReplay:false`; report them separately from the110
reconstructable scripts, even when every diagnostic assertion passes.

`orderingIncidents.ts` also retains screenshot wording (including100員), review
invalid, repeated questions and100-portions reports, with explicit missing-state
notes and links to synthetic scripts. Raw historical audio/session gaps remain
unresolved; synthetic success cannot upgrade those incidents to full historical
replay. Future provider changes must rerun the linked scripts, preserve previous
failures, and report the actual final customer text as well as cart effects.


電話登記關閉回歸以 `KIOSK_CONVERSATION_SCRIPT=P01-F1` 使用既有隔離 replay；
`P01-A1`／`P01-A2` 分別驗證否定關閉與同伴／其他視窗，與原112固定gold分開。
互動內容／工具回執維持順序儲存；`service_event` 的 `*_metrics` 使用獨立背景佇列，
其網路往返不阻塞回覆。兩條佇列各自維持順序並捕捉原visitor ID；跨佇列的sequence
代表伺服器儲存順序，不代表嚴格的事件發生順序。
