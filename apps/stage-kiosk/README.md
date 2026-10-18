# AIRI Kiosk

`@proj-airi/stage-kiosk` is the full-screen, touch-first AIRI surface for a restaurant kiosk. It shares AIRI's local hardware UI, LLM tools, and independent `@proj-airi/order-menu` service; the Server owns all ASR/TTS provider, model, voice, endpoint, and credential policy.

Use it for customer-facing horizontal or vertical kiosk displays. Do not use it as a replacement for the normal settings-oriented `stage-web` application.

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

The owned menu supports a small yes/no meal-clarification flow. The host requests
it only after service admission, renders/speaks the exact browser-issued question,
and leaves the same Yes/No controls available on the menu. A second unclear reply
uses the controls without a repeated spoken question. Other service queries can
interrupt confirmation while retaining unadded meals. Background or uncertain
recipient speech stays silent; model/transport failures remain separate. Deploy
Server, Kiosk and Order Menu together for the new clarification tool and phase.

Availability follow-ups such as **我想問還有沒有** can read the dish in the
current confirmation without buying it, guessing quantity or asking the same
purchase question again. This read has an additional recipient check; ordinary
Yes/No answers still take one Jev call. Companion speech and uncertain recipients
remain silent. Named alternatives, categories and filters use normal routing.

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
Touch submit uses host-only `kiosk_customer_phone`; voice and touch skip share
`customer_skip_phone`. The modal closes only after reading the ordering phase;
errors retain its controls. Discovery replacement/unmount drops the local draft
and ignores old reads. Phone input is not an Agent tool or model context. The
old full-page Menu entry is removed. Standalone Menu opens the catalog directly;
`kiosk_customer_entry_start` offers phone entry once for a fresh Kiosk order,
without reopening after a choice or cart activity. The menu remains inert while
entry is pending. Deploy Menu and Kiosk together.

The phone choice allows factual menu queries, but recommendation and ordering
requests such as **推薦一下** or **我想吃飯** return a fixed localized prompt
to fill or skip first (`CUSTOMER_ENTRY_REQUIRED`). That reply starts neither
Main Agent generation nor a meal/skip operation. Filling or explicitly skipping
is required before recommending, selecting a dish or changing the order.
After the first successful menu reply while entry is still pending, the host
adds one fixed reminder to fill or skip the phone. It rereads the current phase
before presentation, so a choice made during the lookup suppresses the reminder;
new-customer reset clears its once-only state. Identity replies and operation
questions do not consume it. The acceptance-test UI and reminder currently offer
`0912345678` as an example number; the input remains empty until the customer types.
After an Agent fallback, the host rereads the phase before presenting any
recommendation or order-tool result. Pending entry uses the same fixed prompt,
including for empty recommendations or rejected operations; completed entry
keeps its real result. Identity dialogue and factual lookups remain available.
An admitted factual `MENU_QUERY` may use read-only recommendation/display tools
to render price matches. With fresh menu receipts, those internal tool names do
not trigger the phone prerequisite; actual selection/order edits still do.

Food requests admitted as `MENU_QUERY`, and other ordering handoffs with current
product/category matches, carry a host-owned `requireMenuRead` guard. Old cart
references alone do not force identity dialogue through menu tools. Phone entry
still admits only its explicit factual-query route through this guard.
Pure factual inquiries and unresolved filter/price handoffs also carry
`readOnly:true`. Kiosk binds that capability to the owned menu task and keeps
the read-task snapshot on every model continuation; receiving a menu result
does not authorize an order edit or answer the pending fulfillment question.
Ordinary mutation tasks keep their initial snapshot only, since their own tools
may advance checkout. A new customer turn receives fresh task authority.
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
`VITE_AIRI_ORIGIN` belongs to the embedded service's WebMCP allowlist; it never
changes the iframe URL.

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
business state. The current native WebMCP path requires that site's tools; this
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
repaired by ordinary parent-page JavaScript. Native WebMCP also requires tools
registered by the embedded document; menu visibility does not establish Agent
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
through the same conversation loop. A completed turn without commerce tools can
present natural model dialogue (for example, a greeting). Offering menu tools
alone does not require a menu receipt or discard the answer. History-only reads
also retain conversational replies. Once commerce tools are attempted, the host
presents accepted current-turn menu/cart/operation/question receipts rather than
model success prose. Rejected tools are not automatically replayed. No-tool
prose relies on the model instructions to avoid unsupported commerce claims;
this path does not perform a second semantic classification or guarantee that
all model-written factual claims are grounded.

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
Speech qualification alone does not create a dialogue bubble. A confident route
shows the accepted customer utterance while required conditions are still checked;
it grants no execution authority. Uncertain concrete answers retain the question
without executing a guessed deferral or handing the guess to Main Agent. Payment
and destructive confirmations remain distinct one-use authorization records.
Complete-menu lookup may ask one bounded follow-up decision: finish with the
grounded answer, perform one offered recommendation read, or hand off to Main
Agent. It never loops or retries a cart/payment mutation. The decision inspector
shows these stages and the role-labelled context actually sent to System One.
Price inquiries/filters use the existing search/recommend routes with finite,
browser-issued price interpretation IDs, not model-authored amounts. The host
forwards the selected ID for browser verification, and hands off verified
single-dish bounds or an unresolved-price guard. Unsupported approximate/relative
or total budgets clarify without cart mutation. Card prices and condition headers
are visual; replies need not read prices aloud. The application appends this
capability boundary even to older saved System One prompts, without rewriting
merchant configuration.
It also shows actual bounded-call counts, questions, answers, durations and
refusal reasons. An optional read continuation is allowed only with a known
remaining budget under 24 questions across the entire utterance. Verified read
receipts are visible before optional review, which may perform at most one extra
read and then choose only completion or Agent handoff. Rejected WebMCP envelopes
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
clarification answer. One valid unresolved answer ends that bound session and asks
for touch selection. Stale/expired clarification and confirmation remain rejected.
When an ASR turn escalates, the Main Agent receives a sanitized snapshot of the
current menu or checkout phase and available payment methods. Typed turns read
the same state through a host-only, read-only WebMCP tool. Tax IDs, carrier
codes, and raw checkout objects are never included in that conversation hint;
tool execution still checks the browser's live state.

## Local diagnostic overlays

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

An idle Kiosk shows localized neutral progress as soon as an ASR/test utterance
starts classification, even when the first Jev route is weak. This display does
not admit speech or take ownership of an interaction turn. It gives way to the
existing tool-progress bubble during Main Agent work; a continuation preserves
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
It starts with “直接告訴我想吃什麼” and always leaves the menu touchable. The old
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
per device. New devices have local controls locked
and observation/greetings/reminders disabled. Old browser-local observation
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
No extra WebMCP tool or payment authority is introduced.

Text mode exposes only the simulated-ASR input, with no separate ordinary chat
composer. Typed turns use the same decision queue, validation and WebMCP path as
speech; Main Agent remains available through escalation and retry.
The text ASR input submits only on a deliberate Enter or button activation,
not on IME composition commits or held Enter repeats. Each submitted draft is
consumed before notifying the parent. This does not deduplicate matching text or
block later utterances while an earlier request is processing.
Browser component regressions run separately from the Node unit suite:

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

An approved interactive service can optionally serve `/.well-known/webnavior-kiosk-activity.json` from its own origin. It provides customer-facing status labels for its WebMCP tools; it does not change tool execution and is never sent to the LLM. The kiosk ignores missing, unavailable, or invalid manifests and uses its generic status labels instead.

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
