# `@proj-airi/server`

HTTP and WebSocket backend for Webnavior. This app owns auth, kiosk management, gateway forwarding, and server-side observability export.

## What It Does

- Serves the Hono-based API and WebSocket endpoints.
- Uses Postgres as the source of truth for users, billing, and durable state.
- Uses Redis for cache, KV, Pub/Sub, and Streams.
- Forwards GenAI requests to the configured upstream gateway and records billing from usage.
- Exports traces, metrics, and logs through OpenTelemetry.

## How To Use It

Install dependencies from the repo root and run scoped commands:

```sh
pnpm -F @proj-airi/server typecheck
pnpm -F @proj-airi/server exec vitest run
pnpm -F @proj-airi/server build
```

For local observability infrastructure, use:

```sh
docker compose -f apps/server/docker-compose.otel.yml up -d
```

The opt-in cross-app provider replay uses the configured Jev and Main Agent
upstreams, the actual SSE route, and the owned Menu/Kiosk tool and reply runtime.
Run from `apps/server` with local provider configuration available:

```sh
KIOSK_PROVIDER_REPLAY=1 pnpm run apply:env -- vitest run tests/experiments/kioskProviderReplay.test.ts
```

It sends synthetic menu dialogue to the providers and consumes provider quota;
visitor records and Jev health writes stay in an isolated in-memory database.
It checks phone-stage browsing, alternate recommendations, disputed names and
current-draft correction/cancellation, and prints sanitized tool calls, replies
and elapsed time. Timing separates Jev service requests, the decision flow,
each Main Agent SSE request (including routing/network/persistence), and local
tool execution; these are wall-clock measurements, not internal inference time.
It does not test ASR/TTS or physical devices. Cross-app replay
files live under `tests/experiments`, outside the Node-only Server source project.

## Database migrations and deployment

The Kiosk Profile's store-specific agent instructions (`agentInstructions`) are
optional form content: an empty string can be saved and published, and contributes
no extra store instructions to the agent prompt. Non-empty content is limited to
8,000 characters. The snapshot still carries the string field.

In non-production mode, the Server console prints
`[kiosk-interaction-decisions -> Jev]` followed by the provider endpoint and exact
`state` / `questions` payload, including server-loaded dialogue and policy.
Each segmented question has its own entry; readiness probes are labelled by their
question key too. `[kiosk-interaction-decisions <- Jev]` prints the original
response (including model/usage fields), HTTP status and round-trip duration.
Request and response share a random `requestId`; failed requests also log that
ID and the error. Non-JSON HTTP error bodies remain visible. Authorization
headers and API keys are excluded. Production
does not attach this observer because the payload may contain visitor dialogue.

Kiosk interaction decisions receive typed, finite operational-question receipts
and role-labelled session context, never bottom-level WebMCP candidates. Each
utterance selects its route first. Pending questions are understanding context,
not prerequisites: independent legal requests do not ask invitation acceptance,
speech qualification or old-question relation first. Only a selected effect tied
to a current question asks for a concrete answer from that question's currently
legal choices, or NEW_REQUEST/BACKGROUND/UNCERTAIN. The `relation` question key
is retained in traces, but generic ANSWER is no longer an accepted result.
The question owner supplies newly parsed values such as party size and tax ID;
Server never infers answer choices from the purpose name. The initial route is
a hypothesis, not assumed consent, and the concrete answer may correct it.
A browser-owned `query_scope` question uses the configured Main chat model,
not Jev. Authenticated `/api/kiosk/interaction-decisions` returns a finite
`SCOPE_CHOICE`; only the browser owner can consume its question ID and execute
the bounded read. The checkpoint uses temperature0 and receives question text,
ordered labels and confirmed conditions, excluding opaque IDs/expiry numbers.
Elliptical and temporal references are interpreted against the two scope objects
in the active question, without requiring verbatim option labels. Uncertain or
invalid proposals keep the conversational question pending. There is no floating
scope option panel. This does not authorize cart
writes; independent requests return to ordinary intent/price qualification.

Kiosk sends `segmented:true`: every Jev question gets a separate provider request
and returns a `DECISION_PROGRESS`
checkpoint before the next question. Authenticated
`POST /api/kiosk/interaction-decisions/:id` consumes a device/session-scoped
checkpoint once, within 15 seconds. Client answers/plans are never accepted.
New decisions replace old checkpoints; process restart expires in-memory work.
Non-segmented requests remain available for diagnostic replay, not direct-tool
routing. Conditions are asked only after a read route is selected. The complete
utterance, including continuation/review, has a 24-question ceiling; this is a
safety limit, not a normal request count. Pending questions cannot remove
state-valid explicit new actions; implicit meal mutations still need real target
or slot evidence, so a bare acknowledgment cannot repeat an order. A concrete
answer requires numeric confidence >= 0.6; a weak initial question-related route
may reach this check rather than being rejected first. Before browser execution,
one final policy separates valid semantic uncertainty from malformed answers.
An uncertain finite choice may become `NEEDS_ASSISTANT / UNCERTAIN_OPERATION`
only after an independently reliable recipient decision. An existing recipient
decision is reused; an unknown recipient is not repeatedly reclassified. If no
recipient check has run, one bounded check may use the remaining question budget.
Confirmed background and genuinely unfinished speech retain their normal paths.
Uncertain recipient, invalid confidence/choice and exhausted budget grant no
new authority. Handoff never consumes a question, supersedes an invitation, or
executes the guessed operation. Weak action proposals also relinquish Fast Path.
Main receives the original utterance; merely matching a meal name does not force
a menu lookup. Confirmation/configuration/checkout uncertainty is read-only;
ordinary ordering still validates each Main tool against fresh browser state.
Already-executed reads and lost mutation receipts retain their separate recovery
protocols. Confidence is not a separate proof of task relevance.
These scores are not calibrated correctness rates. The browser owns live revisions,
phase checks and one-use high-risk confirmation.

Device-authenticated `GET /api/kiosk/interaction-decisions/status` reports live
System One activation with `Cache-Control: no-store`, without invoking the model.
Activation and provider health are distinct: an unhealthy active profile remains
enabled and keeps the existing next-turn readiness/recovery behavior. With no
active profile, decision requests return `NEEDS_ASSISTANT / SYSTEM_ONE_DISABLED`
after device/session validation. The Kiosk host also checks activation before
application-resolved Fast Path actions. `PROVIDER_FAILURE` responses or failed
decision transport trigger a guarded Main Agent handoff; semantic refusals do
not. The original utterance, session and completed read receipts are retained,
and browser authorization still governs every operation. A lost browser mutation
receipt is not a provider fallback and must not be replayed automatically.

The application appends a fixed service-scope instruction after both the editable
System One prompt and store note, without overwriting either saved field. Active
configuration/clarification/confirmation routes receive the same scope rule, not
the full ordinary intent prompt. Background discussion remains `IGNORE` even if
it contains questions, complaints, explanations or unfinished clauses.
`NEEDS_ASSISTANT` means a request addressed to this kiosk for ordering service
that finite choices cannot handle; `MULTI_ACTION` requires multiple independent
service operations, not merely multiple clauses. Menu-name evidence is not
required for legitimate food comparisons, dietary queries or contextual replies.
These prompt boundaries do not guarantee the model cannot misclassify speech;
live semantic accuracy is distinct from deterministic admission tests.

For ordinary ordering ADD/REMOVE/quantity/option proposals, `requestPurpose`
first distinguishes an inquiry from an operation using the literal utterance.
Balanced examples use the current browser-matched subject without authorizing
that example as an order. A separate `cartRequest` check verifies that the
proposed single effect covers the whole utterance, including the first item.
Real `CART_LINE_` references supply existing-order context, not purchase consent.
Replacing one dish with another must
reach Main Agent intact; a confident ADD or REMOVE must not execute half the
request. The original route remains in `rawAnswer`; `semanticCheck` and staged
exchanges record the coverage check. A recovered pure query re-enters normal
SEARCH_MENU filter/price validation; it cannot open a quantity draft. A recovered
query or replacement/weak-route handoff additionally
verifies recipient using the isolated utterance, so companion speech cannot be
promoted merely because it describes a valid change. When the original route and
operation purpose are reliable but `SINGLE` coverage is uncertain, an independent
recipient check may hand the complete utterance to Main as `UNCERTAIN_OPERATION`.
This handoff grants no Fast Path mutation; Main must resolve and validate each
effect, including quantity changes combined with additions. Uncertain coverage or
recipient preserves the cart and pending fulfillment question. Thresholds are
unchanged. A weak purpose answer grants no authority and does not override
independently reliable original-route and whole-effect checks. A weak route
still cannot execute; coverage plus recipient verification may hand it to Main.
Mutation proposals add two small model questions; recovered
inquiries use the purpose result directly, then verify the recipient. Reads
verify KIOSK/OTHER/UNCERTAIN using only the current utterance,
before the existing filter/price questions retain their original evidence. Already
verified question answers/recovered queries do not repeat scope. A weak Agent
handoff first verifies the recipient. In ordering, a second narrow check may
independently establish a pure menu inquiry, even for an unfamiliar dish. This
also covers weak search/recommendation routes when no recommendation question
is pending: a budget follow-up can compete with the next-batch intent without
authorizing that batch change. The recovery admits factual lookup only and
qualifies the current utterance's price before handoff, never the weak operation. A
question-relation NEW_REQUEST likewise verifies recipient before Agent admission.
The handoff's price checkpoint receives only the original current utterance and
its literal amounts. Previous budgets and scope answers remain with query-scope
handling; they cannot compete with a fresh explicitly stated price boundary.
Price instructions distinguish inclusive bounds from explicitly excluded endpoints;
literal amount evidence does not create an additional budget requirement.
This is bounded coverage, not a generic action planner or arbitrary multi-action
execution guarantee.

Main receives explicit browser query actions (`continue`, `update`, `reset`,
`clarify`) instead of reconstructing whether omitted arguments reset conditions.
The Menu runtime owns their state transitions and dietary/history preservation;
see the Menu README for the tool contract. Relative requests are not meal names.
Read-only tool selection uses temperature zero. A single non-presenting
`menu_recommend` receipt with `queryAction:clarify` settles JSON and SSE replies
with its application-owned question, without another provider call or tools.
Mixed receipts, named lookups and malformed payloads cannot take this shortcut.
The customer answers by voice; no new floating choice panel is created.

Unmatched named dishes cannot be widened into a category or general
recommendations. `filterPresence: UNRESOLVED_SUBJECT` retains the original
utterance for an Agent lookup. Factual inquiries and unresolved filter/price
handoffs carry `decisionState.readOnly`; the host resends it on each read-task
continuation. Server tool selection stays read-only, and the owned menu task
blocks order changes independently of model behavior. Successful lookup does
not grant purchase or fulfillment authority. A new customer request starts a
fresh task; ordinary mutation tasks retain their first-request-only snapshot.

The route decision is not followed by a generic second speech classifier using
the same evidence. Concrete current-question answers, greeting-recipient and
finite filter checks remain distinct bounded decisions. Missing item options or
serving quantity use application-owned `configuration` state: only its issued
answers, cancel, IGNORE and NEW_REQUEST are available. Configuration/clarification
route a topic change before parsing its concrete answer.
While asking quantity/options, a bare different catalog dish or category can
route as NEW_REQUEST without an explicit ordering verb. Naming another dish
does not authorize cancellation; explicit cancellation still uses its concrete
answer and relation check. An uncertain relation preserves the pending meal.
NEW_REQUEST requests one bounded host reroute, not automatic draft cancellation:
lookups retain the meal; a new foreground meal suspends it without inheriting
its slots, then resumes it after completion.
Uncertain concrete answers fail closed. Unfinished speech continuation is also
an optional route, not a pre-route gate for complete new requests. High-risk
confirmations still revoke their exact authorization before handing a new
request to Agent.

Category names with conversational endings such as `呢`, `的有嗎` or `之類的`
are complete browsing requests when addressed to the kiosk. In ordinary
ordering, an `INCOMPLETE` with low/missing confidence or current category
matches is rechecked using small recipient and speech questions. A reliable
category query rejoins the normal search/filter/price validation; it does not
answer an older fulfillment question or authorize ordering. Background or
unknown recipients grant no action, admitted unresolved needs reach the Agent,
and reliable unfinished speech still waits. This recovery uses the existing
question budget; ordinary successful read routes add no recovery calls. Traces
keep the first `rawAnswer` and record the recovery in `semanticCheck`/`exchanges`.

Optional-phone entry uses small recipient and phone-choice decisions. Short
skips are complete answers, not unfinished food orders. Negated skips and
permission questions do not authorize skipping; background speech stays quiet.
Direct greetings return `GREET` from the first small decision and use
the host's fixed greeting without an Agent call or completing the phone question.
Greetings addressed to a named companion stay background; a greeting combined
with a request follows that request instead of hiding it behind `GREET`.
Only the current browser-issued skip candidate may advance entry, and phone
values never enter this decision context. Recommendations and ordering requests
return `CUSTOMER_ENTRY_REQUIRED` for a fixed host reminder to fill or skip first;
they do not start the Agent or authorize a browser operation. Factual menu
questions remain `MENU_QUERY` handoffs, while identity/phone FAQs stay ordinary
dialogue. An entry prerequisite must never be described as an empty menu.
After a reliable `REQUEST` recipient decision, an uncertain finite phone choice
is independently resolved by Main using only `SKIP_PHONE`, `KEEP_PHONE` or
`UNCERTAIN`, without exposing browser tools or the weak Jev proposal. Only
`SKIP_PHONE` rejoins the current browser-issued skip candidate and its normal
authorization/execution path. Other or malformed proposals preserve the
`UNCERTAIN_OPERATION` handoff with read-only conversation authority and no
required menu lookup. Same-utterance order retractions follow the final intent
and may be acknowledged without a tool. The optional trace's `phoneResolution`
records the separate Main choice and duration; `modelCalls`/`modelQuestions`
continue to count the Jev checkpoints, without inventing a Main confidence score.
Uncertain recipients and malformed provider answers still fail closed.
Factual price queries at phone entry resolve the same browser-issued price
interpretations as ordering reads before their `MENU_QUERY` handoff. Uncertain or
unsupported bounds remain guarded clarification, never an unfiltered menu reply.
Price questions receive literal amounts in customer state and finite alternatives
only in their own criteria. Do not repeat all alternative descriptions in the
state or food-filter capability list: the small classifier otherwise treats an
inclusive proposal as the customer's words. Ingredient presence excludes pure
price conditions; the validated price and ingredient filters intersect in Menu.

Owned-menu clarification uses a browser-issued `clarificationOffer` and
`NEEDS_CLARIFICATION`, not a blanket fallback for UNAVAILABLE. During a meal
subject change or an unconfirmed name fragment, Jev first checks the service
recipient, then the request purpose with small finite questions. Unclear recipient
returns `UNCERTAIN_RECIPIENT` and remains silent. An admitted but unclear purpose
can ask the one real proposal question. `meal_confirmation` then uses short
YES/NO choices in one call, mapped to that exact browser question; it cannot pay
or add an item without the remaining slots. Price evidence keeps its existing
bounded interpretation path. These checks are specific to clarification, not a
generic extra speech classifier on normal routes.

For a pending cart-target clarification, `CLARIFICATION` means the directed
customer reply still needs disambiguation, not permission to cancel or switch
to touch. Its route must reach the existing0.6 confidence threshold, followed by
an independent literal-recipient check. Companion speech is ignored; weak or
unknown recipients remain unavailable. Qualified replies retain the same owned
question and expiry for another voice answer. Target selection compares complete
attributes and negation rather than only shared dish-name fragments.

Product evidence distinguishes exact names, unconfirmed literal catalog matches,
absence and overflow. Model target choices remain finite (five), not an entire
category. `catalogEvidence` carries bounded matched text with name/merchant-alias/
fragment provenance and category member counts, not actual item IDs. Category-only
preferences browse; a singleton category never implies a named order. Explicit
serving quantities retain the category-order route. Inferred suffix uniqueness
is discovery-only evidence, not mutation authority.
Missing quantity/options are order slots, not evidence of unfinished speech.
The application-owned route instructions keep this distinction even with saved
custom prompts. An expressed purchase with only possible/fragment evidence and
no legal add candidate uses the browser's simple confirmation when eligible,
otherwise routes to Main Agent for clarification, rather than INCOMPLETE, a
substituted search, or an unverified purchase. An actually cut-off request can
still wait for continuation.
The existing condition question contrasts product lookup, ingredient
filtering, combined requirements and uncertainty; product lookup does not spend
ingredient-polarity forwards. Combined/uncertain requirements hand off intact.
Read-result review compares the original utterance and role context with the
explicitly tentative understanding and actual receipts. `SATISFIED` with sufficient
confidence maps to application `COMPLETE`; `DEVIATED` / `UNCERTAIN` hand off once,
never restart the route. Kiosk retains accepted receipts but removes a rejected
understanding's mandatory filter authority before Main Agent handoff. At most one
extra read and one final review remain; no mutation/payment replay is introduced.

Pure greetings to the clerk/kiosk return GREET, separately from companion or
background greetings (IGNORE). A greeting combined with an order still selects
the ordering intent. Ordinary ordering GREET choices receive one finite recipient/purpose check;
uncertain answers fail closed. No greeting is offered as a clarification answer,
confirmation, read-continuation result or ordering command.

Every bounded question receives the explicit phase and the same role-labelled
interaction context. Diagnostic requests return actual model-call counts and
ordered question/answer exchanges, durations and rejection reasons, including
exchanges completed before a provider failure. Raw speech is retained separately
from conservative whitespace/control-character normalization; short replies,
pronouns and numerals in dish names are not removed. Agent handoffs carry finite
conditions and completed read receipts, not previous model plans as facts.

Menu decisions carry finite ingredient/dietary references. Read actions require
bounded filter-coverage and polarity validation; unsupported or uncertain
conditions go to the Assistant instead of silently becoming unfiltered reads.
The application owns recipe matching and the vegetarian policy; the Server
returns finite slots, not recipe deductions or invented dietary claims.

POS fulfillment choices and labels accompany both decision and Agent requests.
Operation questions are application-owned. Agent operation drafts are retained
as service events, not customer dialogue; the host records the validated reply
actually presented. Model-only tool results omit deployment/provenance labels,
without changing durable receipts or payment/order status.

`MENU_QUERY` handoffs require current-turn menu evidence, including while phone
entry is pending. Other ordering handoffs with current-utterance product/category
matches require it too, so a replacement cannot invent unverified dish examples
in a clarification. Ordinary unclassified handoffs require evidence even when
no product/category matched. Explicit `GENERAL_QUESTION` routing keeps identity
and service explanations natural. A food refusal does not authorize a guessed
substitute; ambiguous preferences require clarification. Old cart references
alone do not imply a food claim. The host
carries `decisionState.requireMenuRead`; initial
JSON/SSE completions restrict tools to `menu_get`/`menu_recommend` and require a
tool call. A no-tool provider answer stays diagnostic prose, and Kiosk refuses
to publish it as a food claim. Normal identity/phone dialogue is unaffected.
Menu verification targets the disputed names using `menu_get.verifyClaim`, not
an unrelated recommendation batch. Current-meal cancellation and corrective
availability inquiries use finite choices tied to the browser's live question.

Weak cart-change coverage and weak compound routes may recover a complete
replacement through separate recipient and replacement-semantic checks when
real cart lines exist, before inquiry-only recovery. The
original utterance goes to Main Agent without a partial mutation or a fulfillment
answer. Target resolution and replacement legality remain owned by Menu tools;
the speech classifier does not decide whether a dish exists or can be replaced.

Main Agent continuations retain the completed tool exchanges of the current
customer request, paired by `toolCallId` within that latest user turn. Each result
uses the existing compact payload policy; at most four batches / sixteen calls
are retained, matching the Kiosk host budget. A new customer message drops these
payloads from model input and retains compact interaction summaries. This keeps
cart/menu lookups available throughout a replacement without replaying older
tasks or increasing the tool-round limit. For an unambiguous complete swap, the
Agent uses `order_add_item.replaceLineId`; the owned Menu commits the replacement
once after validating the real original line, new item and required options.

Device interaction metadata accepts `fast_path`, `execution_failed`, and
`unavailable`, plus the correlated `questionId`. Failed ASR decisions remain
diagnostics, not completed customer requests. When ordering tools are offered,
Agent prose remains an internal draft even if the model skipped a lookup; only
the host's receipt-grounded answer enters customer dialogue.

Proactive actions may return a structured `recommendation-invitation` when the
host confirms an idle ordering phase without a service question. Its acceptance
can select only the existing recommendation candidate, never ordering/payment.
Invitation choices use intent:recommend for explicit acceptance and
DECLINE_INVITATION for refusal, consistently in state and route criteria.
They use the same concrete-answer check as service questions, not an additional
invitation-specific route-confidence gate. Low-confidence concrete answers retain
the invitation; a verified independent request
follows normal routing and returns `supersededQuestionId`. The host retains the
invitation record as superseded, without letting a later acknowledgment revive
it. Actual acceptance/refusal returns `answeredQuestionId`; failed recommendation
validation does not consume an acceptance. Both IDs match the current invitation
and current utterance ticket before affecting its foreground state. Unanswered
service questions survive intervening queries; service-owned questions keep
priority. No additional WebMCP tool or customer-facing choice is introduced.

Applying Webnavior AI bindings now compiles Ollama chat/vision profiles with
`ollamaKeepAlive: -1`. The gateway sends `keep_alive: -1` per Ollama upstream
attempt for both ordinary chat and generated assistance reminders; other provider profiles
and fallback attempts do not inherit it. After updating Server code, apply the
AI bindings again to regenerate the already-persisted runtime configuration.
This disables idle model unloading, not HTTP connection cleanup or first-use
loading. It still consumes RAM/VRAM and cannot prevent restart/memory eviction.
Use an Ollama release supporting this OpenAI-compatible extension; older
versions may ignore it. Alternatively configure `OLLAMA_KEEP_ALIVE=-1` on the
Ollama server itself, not in AIRI's Server environment.

Published Kiosk Profiles may provide `greetingPhrases`: 1–50 fixed spoken
openings, up to 500 characters each. Both full and content-only draft editing
retain this field. With effective `proactiveVlmEnabled=false`, Kiosk prepares
and reuses welcome audio through the authenticated speech route. When true,
it sends a frame to the generated assistant-action endpoint, which selects the
configured vision model. The optional `phase` is limited to `customer_entry` or
`ordering` and supplies speech context only; it grants no tool authority.
Welcome requests do not append recommendation invitations. The same policy
still determines whether assistance reminders use images. Publish the Profile
and reload its devices to apply changed openings/guidance; mode changes use the
existing device policy. Neither change requires a database migration.

The Server owns the PostgreSQL schema. Every schema change must include a
numbered SQL file under `apps/server/drizzle/` and a matching entry in
`apps/server/drizzle/meta/_journal.json`. The `@proj-airi/server-schema` build
embeds those migrations in the Server; on startup, the Server applies any that
the target database has not recorded yet.

For local development, prefer starting the Server after rebuilding
`@proj-airi/server-schema`; this applies migrations and records them in the
same `drizzle.__drizzle_migrations` history that deployed Servers use.
`db:push` is a schema reconciliation command, not a migration runner: it does
not write that history. Do not use it to apply a pending numbered migration
before starting the Server, or the Server will try to apply that migration too.
If reconciliation is genuinely required, use:

```sh
pnpm -F @proj-airi/server db:push
```

For a deployed environment, take a PostgreSQL backup first, deploy the code
and its rebuilt `@proj-airi/server-schema` package together, then restart the
Server and confirm its logs report the applied schema before deploying a
frontend that depends on the new field. If the API reports PostgreSQL error
`42703` (missing column) after an application update, the database migration
has not been applied to that environment; do not treat it as an authentication
or frontend failure.

```sh
pnpm -F @proj-airi/server-schema build
```

## Kiosk system archives

Migration `0045_kiosk_session_archives` separates operational-link expiry from
archive retention. Rebuild `@proj-airi/server-schema`, then restart the Server
using the migration workflow above before testing the updated Kiosk.
The Site retention setting now expires device/session access and operational
association links; it does not automatically delete transcripts, tool evidence,
media or verified internal associations. Explicit authorized archive deletion
remains available. Archive reads are access-controlled and audited.

Original captured audio, images and video stay in the private visitor-media
directory under `WEBNAVIOR_KIOSK_ASSET_DIR`. New uploads store SHA-256 and byte
length for integrity checks; missing/corrupt files do not erase their manifests.
Provision a persistent volume and back up both that volume and PostgreSQL;
database retention alone cannot preserve files in an ephemeral container.
This change does not enable recording or change capture consent/settings.

`recordVerifiedAssociation` accepts internal verifier provenance for member or
order associations. A future membership/POS adapter must supply real verification
evidence; neither client speech nor model output establishes identity. There is
no new member-facing permanent history link or automatic membership integration.
Device-authenticated decisions read only bounded current-session dialogue,
never permanent archives or conversations from other visitors/devices.

## Browser entrypoints

Webnavior browser sign-in and the management dashboard live in `apps/stage-web`.
Set `WEB_APP_URL` to that browser-visible origin (for example
`https://webnavior.example`). Server `/auth/*` and legacy `/admin/*` paths
stay within that Webnavior origin; they do not redirect to an external AIRI
deployment.

## `ADDITIONAL_TRUSTED_ORIGINS` (LAN / Capacitor dev)

When the mobile dev server uses a non-localhost origin (for example `https://10.x.x.x:5273` from `cap copy ios` / `capacitor.config.json`), set **`ADDITIONAL_TRUSTED_ORIGINS`** in `apps/server/.env.local` to a comma-separated list of exact origins (parsed and normalized at startup). Example:

`ADDITIONAL_TRUSTED_ORIGINS=https://10.0.0.129:5273,https://198.18.0.1:5273`

Restart the API server after changing this variable.
