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

The experimental SLM decision transport is not registered as a production
provider and never fabricates Jev confidence. Its offline contract checks run with:

```sh
pnpm -F @proj-airi/server exec vitest run tests/experiments/slmDecision.test.ts
```

For the complete compatible source inventory, see
`test_prompt/slmDecisionInspection/README.md`. `slmFullCoverage.test.ts` is opt-in
with `KIOSK_SLM_FULL=1` and a frozen `KIOSK_SLM_FULL_MANIFEST`. Exact private
history is permitted only against local DMR. It retains missing/unscored/not-run
records and reports each task group separately; no sample cap is used to stand
in for full regression coverage. Its question-first/cache-enabled transport is
a separate experimental version from the small routing control below.

`KIOSK_ROUTING_EXPERIMENT=1 pnpm -F @proj-airi/server exec vitest run
tests/experiments/slmRoutingExperiment.test.ts --maxWorkers 1` runs a bounded
comparison with the configured Jev and local DMR. Load the Server environment
first. Ten synthetic historical-family/control cases use frozen expectations;
original and concise variants keep state, candidate IDs/count/order identical.
A separate four-label service gate changes the task and is scored separately.
The cap is 60 requests/eight minutes, 35 seconds each, stopping after three
consecutive errors. It reads the live profile into an isolated database without
changing configuration or invoking Main/orders. Preserve private stdout and the
source manifest; the repository summary contains no credentials. Passing the
runner means complete valid responses, not model-quality or field acceptance.

The opt-in local DMR capability replay uses synthetic input and no database or
order actions. It records first long questions, short controls, actual backend
cache counters and raw responses in a new private `/tmp/webnavior-slm-replay-*`
directory. Semantic mismatches fail the tests; a valid schema is not accuracy.

```sh
KIOSK_SLM_PROBE=1 KIOSK_SLM_CACHE_REPEATS=19 pnpm -F @proj-airi/server exec vitest run tests/experiments/slmCapabilityReplay.test.ts --maxWorkers 1
```

`KIOSK_SLM_URL` defaults to `http://127.0.0.1:12434/engines/v1` and
`KIOSK_SLM_MODEL` to `huggingface.co/unsloth/qwen3.5-4b-gguf:latest`.
The default cache repetition count is 3; explicit values must be 2–19. It has
an outbound cap of 120 requests/10 minutes and stops after three consecutive
errors. The first-plus-followups controls intentionally vary instruction length;
they do not claim that production runs eighteen identical questions.

For a configured-model replay, `KIOSK_SLM_SHADOW=1` captures up to 24 real Jev
checkpoint inputs, then evaluates them serially against DMR after the scenarios.
This avoids changing Jev deadlines and never returns SLM decisions to Menu. Its
raw agreement with Jev is not gold accuracy or full independent SLM-path coverage.
The common provider budget includes these shadow calls. Preserve private output
and source identity, including failures; do not send original customer data.
See `docs/plans/2026-10-28-kiosk-slm-evaluation.md` for acceptance limits.

For a bounded task-level comparison, load the configured Server environment and
run `KIOSK_SLM_QUICK=1 pnpm -F @proj-airi/server exec vitest run
tests/experiments/slmQuickComparison.test.ts --maxWorkers 1`. It reads the active
Jev profile, copies it to an isolated database, and sends only synthetic text to
Jev and local DMR. Sixteen cases have expectations specified before inference;
both candidate orders are tested without retuning. The run caps inference at
66 HTTP calls/seven minutes, with per-call timeouts and three-error termination.
Save stdout privately: it contains full requests/responses but no credential
headers. This compares raw task categories, not actual order execution or
production confidence; it is skipped by default and is not field acceptance.

`KIOSK_SLM_HISTORY=1 pnpm -F @proj-airi/server exec vitest run
tests/experiments/slmHistoricalFailures.test.ts --maxWorkers 1` tests only local
SLM against the existing archived failures from the frozen 44-case experiment.
It preserves historical state/candidate descriptions, uses a concise SLM policy,
and keeps the original expected effects out of the prompt. Missing candidate
effects are reported separately; multi-action handoff accepts either explicit
MULTI_ACTION or NEEDS_ASSISTANT. No Jev, database, Main Agent or order calls occur.
The single run is capped at seven minutes, 30 seconds per request and three
consecutive transport errors. Save stdout privately. Semantic mismatches fail
the test; root-choice success does not establish complete-flow recovery.

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
The `-t 'configured multi-demand acceptance'` subset checks eight synthetic
cart/presentation scenarios with the configured models. It prints raw Jev
choices separately from application protections; passing state checks do not
prove semantic understanding. Presentation callbacks do not verify browser DOM.
It does not test ASR/TTS or physical devices. Cross-app replay
files live under `tests/experiments`, outside the Node-only Server source project.
The `-t 'configured conversation repair'` subset contains 20 synthetic chains
(12 development, 8 reserved). `KIOSK_REPAIR_PILOT=1` selects six development
chains; `KIOSK_REPAIR_REPEATS=3` runs each selected chain three times. It uses the
normal decision/recovery route and conditional Main, with production retry
ownership checks. A 600 outbound-request/30-minute cap counts actual Jev HTTP
(including readiness) and router upstream attempts; three consecutive Jev failures
stop further inference. Failed/partial runs are not acceptance, and injected
pre-decision failures do not test transport or a browser click. Keep source/config
identity with private logs and do not revise reserved expectations to fit results.
The `-t 'configured explanation recovery'` subset checks two synthetic information
questions against current Main instructions and the fresh-context reply renderer;
it does not certify ASR, physical checkout or every possible model response.

The separate opt-in audio replay reads the configured ASR connection and consumes
provider quota without creating visitors, carts or payments. Supply a synthetic
canonical 16kHz mono PCM16 WAV longer than40 seconds: initial two dumplings,
correction to three, one bento, and an instruction not to check out. Credentials
stay in the loaded environment; never use a customer recording for this fixture.

```sh
KIOSK_AUDIO_REPLAY=1 KIOSK_AUDIO_REPLAY_FIXTURE=/absolute/path/synthetic.wav pnpm run apply:env -- vitest run tests/experiments/kioskAudioReplay.test.ts
```

It exercises the production chunker, ASR gateway and whole-utterance queue,
checking bounded uploads, correction order and one final delivery. It does not
verify microphone capture, the HTTP device route, model interpretation or POS.

Kiosk ASR uploads have a dedicated 1MiB body limit shared with the client audio
contract. Oversized uploads return413 with `KIOSK_AUDIO_TOO_LARGE`; generic Hono
HTTPException statuses are retained instead of being converted to500. Other
JSON/media/asset limits remain separate. Clients split long final utterances into
bounded WAV uploads and must not execute partial transcription results.

## Database migrations and deployment

The Kiosk Profile's store-specific agent instructions (`agentInstructions`) are
optional form content: an empty string can be saved and published, and contributes
no extra store instructions to the agent prompt. Non-empty content is limited to
8,000 characters. The snapshot still carries the string field.

In non-production mode, the Server console prints
`[kiosk-interaction-decisions -> System One]` followed by the provider endpoint and exact
provider payload, including server-loaded dialogue and policy (SLM logs the
actual Chat Completions body).
Each segmented question has its own entry; readiness probes are labelled by their
question key too. `[kiosk-interaction-decisions <- System One]` prints the original
response (including model/usage fields), HTTP status and round-trip duration.
Request and response share a random `requestId`; failed requests also log that
ID and the error. Non-JSON HTTP error bodies remain visible. Authorization
headers and API keys are excluded. Production
does not attach this observer because the payload may contain visitor dialogue.

Kiosk Fast Path supports three isolated System One implementations: Dasein
open-jev, lookski/openjev, and a label-only OpenAI-compatible SLM. The admin
profile lifecycle remains save → real readiness → activate. Connection/model/key
changes revoke readiness and deactivate that profile; discovery alone cannot
activate it. Only one profile is active. SLM does not replace Main, Menu or POS.
The implementation column is PostgreSQL text, so adding the `slm` value does not
require a new database migration.

For Docker Model Runner, use the API root
`http://127.0.0.1:12434/engines/v1` **as reachable by the API Server**. Container
installations must use their reachable host/service address. `/models` discovers
available IDs; it does not prove a model is loaded. The saved model ID is sent to
`/chat/completions` during readiness and each decision. Bearer keys are encrypted
at rest and never returned to the browser. See the
[DMR API reference](https://docs.docker.com/ai/model-runner/api-reference/).
Jev still inspects `/health.model` or `/health.model_id` and calls `/v1/systemone`.

All authenticated runtime decisions use the same staged policy:

1. `admission` has exactly SERVICE / GREET / BACKGROUND / UNCERTAIN. It checks
   service relevance and recipient together, without exposing operations.
2. `purpose` distinguishes a single operation, a live-question answer, a rich
   query, an intact Main handoff, unfinished speech, or unclear meaning.
3. A single operation selects MENU / ITEM / CART / SERVICE / CHECKOUT from the
   currently legal groups, then selects one browser-issued leaf. Large MENU
   groups have an additional lookup/recommendation/navigation distinction.

Each question has at most six choices. Empty, unfamiliar or oversized leaf
sets hand off the intact utterance instead of dropping candidates. Descriptions
name one distinction; executor details stay in the browser. Multiple dishes,
replacement and multiple independent effects hand off before any single action.
Before an independent order write, separate small questions verify that the
customer is requesting an operation and that the proposed effect covers the
whole utterance. Neither a family nor a leaf selection supplies that proof.
Question-bound answers keep their exact separate ticket contract.
Rich food/price conditions go to Main as a guarded read task; this staged policy
does not run the older flat classifier's ingredient extraction forwards. Literal
price choices still use the existing bounded Main resolver before read binding.
Missing or unsupported prices keep the unresolved-price guard. No unfiltered
recommendation or guessed amount is authorized by this handoff.

Phone entry uses the same admission gate followed by one small phone question.
Only the issued skip candidate can skip entry. Negated skips and permission
questions are not consent; menu/order demands retain CUSTOMER_ENTRY_REQUIRED.
An uncertain phone effect may reach the bounded Main phone resolver **after**
service admission. An uncertain recipient cannot reach that effect resolver.
Main's ordinary browser-tool list still excludes `customer_skip_phone`.

Live question answers select only currently issued effects and carry the exact
`answeredQuestionId`. Expired/unresolved answers cannot authorize an operation.
An independent request supersedes an invitation by ID; uncertain meaning does
not consume it. Configuration/confirmation topic changes retain the existing
browser reroute/revocation protocol. Active-request and unfinished-fragment
relations are separate finite questions, not implicit duplicate operations.
Browser phase, target, revisions, quantities/options and one-use high-risk
confirmation remain mandatory. A route is never an operation receipt.

Jev answers retain their real confidence and must meet the existing 0.6 routing
threshold. SLM sends `temperature:0`, `max_tokens:1`, no tools and
`chat_template_kwargs.enable_thinking:false`. It must return one exact allowed
letter with no reasoning, explanation or tool call. Only the adapter maps this
letter to the issued choice ID and stamps `selectionMode:unscored`; an upstream
Jev response cannot claim this stamp. SLM supplies no confidence, synthetic
probability or reused Jev threshold. This contract does not certify model accuracy.

`segmented:true` emits one device/session-scoped, one-use DECISION_PROGRESS
checkpoint per question before evaluating the next. The SLM stamp survives those
checkpoints so labels are not rejected as malformed Jev scores. It permits
progress feedback, never execution. Clients cannot supply continuation answers.
Each utterance, including review, retains the 24-question ceiling. New decisions
replace prior checkpoints; restart expires in-memory work. Non-segmented calls
use the same staged policy.

An uncertain service recipient stays unavailable; a valid UNCERTAIN or weak
scored admission can use the existing bounded Main service recovery. After reliable service
admission, an unclear operation or later provider failure becomes a read-only
UNCERTAIN_OPERATION handoff so the character can clarify. No guessed effect is
executed. A failed provider answer clears that profile's readiness; a later turn
performs a real readiness probe before using it again. Failed mutations and lost
receipts remain distinct and are never automatically replayed.

The editable prompt and store note apply after admission to demand interpretation;
program-owned candidates and safety instructions retain precedence. Blank means
the current concise default. Existing custom text is preserved until the operator
chooses to restore the default. Frozen flat-policy replays deliberately omit
`routing:staged` in `decideInteraction`; they remain historical diagnostics and
are not the authenticated runtime policy or evidence for this new tree.

Read-result review compares the original request with actual receipts using
SATISFIED / DEVIATED / UNCERTAIN. It cannot issue a second operation. A review
failure hands off the preserved receipts once rather than restarting a read or
replaying a mutation. Host presentation continues to require verified results;
model prose cannot claim that a cart action succeeded.

A browser-owned `query_scope` question continues to use Main's bounded
SCOPE_CHOICE path with its exact ticket. Menu owns query actions (`continue`,
`update`, `reset`, `clarify`) and their condition/history transitions. A named
lookup cannot silently widen to unrelated recommendations. Read tasks remain
read-only across continuations; a later independent customer request starts a
fresh task. Unresolved service meaning never grants Main order-write authority.

Raw diagnostic traces retain actual questions, answers, durations and model-call
counts. Short replies and original ASR text are retained; only whitespace/control
artifacts are normalized. For staged SLM validation, the complete 1,114-record
inventory is a first-gate protocol replay, not four-way semantic gold or ordering
acceptance. All 44 archived route scenarios and the 26 synthetic real-Menu
scenarios are separate guarded live suites. See
[`test_prompt/slmDecisionInspection/README.md`](../../test_prompt/slmDecisionInspection/README.md).

`MENU_QUERY` handoffs require current-turn menu evidence after phone entry has
been completed or explicitly skipped. Other ordering handoffs with current-utterance product/category
matches require it too, so a replacement cannot invent unverified dish examples
in a clarification. Ordinary unclassified handoffs require evidence even when
no product/category matched. Explicit `GENERAL_QUESTION` routing keeps identity
and service explanations natural, including store name, opening hours, payment
methods, invoices, ordering channels and pickup/delivery information. Store facts
come from the published site Profile’s `agentInstructions`, not global restaurant
defaults. Generic Main handoffs without current product/category matches use
a bounded `resolve_service_scope` check: only pure `SERVICE_INFO` rejoins
`GENERAL_QUESTION`; food/order/mixed/uncertain or failed checks retain the original
menu guard. This probe supplies no answers or operations; `trace.serviceResolution`
is separate from the original Jev counters. Missing facts must not be invented; live payment/order/delivery options
still require current tool evidence. Informational questions grant no operation
authority. A food refusal does not authorize a guessed
substitute; ambiguous preferences require clarification. Old cart references
alone do not imply a food claim. The host
carries `decisionState.requireMenuRead` after entry. All menu inquiries and
ordering require a valid phone or explicit skip first; phone-stage MENU and ORDER
return `CUSTOMER_ENTRY_REQUIRED` without Main. Main can still explain store facts
and phone/identity questions, but receives no menu/order tools at phone entry. A read-only internal `menu_get(display:false)` does not satisfy
presentation: the continuation still requires a menu tool until a customer-facing
receipt exists. Initial
JSON/SSE completions require a fresh `menu_get`/`menu_recommend` receipt for
menu presentation. Before that receipt, the internal `respond_to_customer` tool
may only select clarification. Non-operation replies carry a validated typed
selection, rendered from fresh facts by Kiosk. Prose or a malformed selection
gets one no-commerce selection repair using the original request and fresh
context, never the unverified draft; a second malformed selection clarifies.
Provider failure remains technical failure. Questions that authorize operations
remain owned by the browser runtime; Main cannot invent `order_ask_question`
authority. Identity/phone information remains available.
Menu verification targets the disputed names using `menu_get.verifyClaim`, not
an unrelated recommendation batch. Current-meal cancellation and corrective
availability inquiries use finite choices tied to the browser's live question.

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

Proactive ordering invitations remain browser-owned. Their finite acceptance can
recommend, never add or pay. Decline and independent-request supersession retain
the original question's session history without reviving stale authorization.
Only a resolved answer carries `answeredQuestionId`; uncertain meaning retains
the current invitation.

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

## Main conversation context and measurements

Kiosk Main messages accept the neutral `stage-shared/kiosk-conversation`
contract. A current compact catalog supports identity/price/option understanding
without a compulsory second literal lookup; requested menu presentation still
needs its tool receipt. The current snapshot replaces historical state, and tool
scope intersects its allowed tools with offered tools. Phone skip stays host-owned.
Decision and conversation transports accept bounded payment-method IDs from the
current service, including LINE Pay and JKoPay; execution still validates the Menu's
actual offered methods. Model prose is recorded as draft service events in both
JSON and SSE flows. Only the host's validated final response becomes assistant
history, so an unexecuted success claim cannot become an order fact.
Initial and continuation requests use the same schema; inconsistent phase,
read-only state or menu revision is rejected before provider execution.

Each model round records a `main_round_metrics` service event: actual UTF-8
request/message/tool bytes, projected context bytes, wall duration and task ID
when present. SSE records time to first nonempty text or tool delta. JSON-only
responses omit first-output time. `inputTokens` is included only when the provider
supplies valid `usage.prompt_tokens`; bytes are not converted into token estimates.
These events contain no prompt or tool arguments and never become model dialogue.
They measure gateway/stream duration, not isolated GPU inference. Model latency
percentiles and production capacity require real-provider measurements; local
mock tests do not establish those values.

## Service admission recovery

`kiosk-interaction-decision/serviceRecovery.ts` owns recovery eligibility,
adjudication/review payloads, strict fixed-tool response validation and time caps.
It runs only for a marked valid semantic service abstention; invalid answers,
provider failures and confirmed background do not become eligibility. Existing
phone skip validation runs first and is not repeated by generic recovery.

Segmented responses include separate `SERVICE_RECOVERY_PROGRESS` checkpoints
before Main invocation and after a valid result. The device/session generation
owns provider cancellation and one-use continuations. The 24 Jev-question cap
and four additional recovery progress events have separate accounting. A
recovery result never supplies Jev confidence, operation arguments or action IDs.
Only the existing phone choice validator can rejoin its legal skip candidate.

`service_recovery_metrics` service events store recovery/utterance correlation,
status, admission/disposition, per-stage duration and actual request bytes;
provider input tokens are present only if reported. No provider errors, prompts
or hidden reasoning are persisted in those events. A read-only service question
has a 30s lifetime; its next utterance uses one contextual review directly, which
separates clarification answers from independent new requests. A clarification
answer remains read-only when formally handed to Main.

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

### Public kiosk security configuration

Test sign-in and six-digit development enrollment follow the original explicit
`WEBNAVIOR_TEST_AUTH_ENABLED` / `KIOSK_DEVELOPMENT_REGISTRATION_ENABLED` flags
and remain disabled when `NODE_ENV=production`. A public `API_SERVER_URL` does
not override those flags. The test bearer identity follows `TEST_AUTH_TOKEN`.
The extra public-origin restrictions were withdrawn at the operator's request;
existing device credentials remain usable. Disable development identity flows
when moving this test deployment to production.

`/api/kiosk/pos/*` forwards only documented POS routes to the server-owned
`KIOSK_POS_BRIDGE_URL` (default `http://127.0.0.1:5170/`). Payment, order and
private table-hold requests require an enrolled device. Configure the Menu with
this same-origin endpoint so the HttpOnly device cookie keeps its existing
`/api/kiosk` scope. Catalog queries and continuation capabilities retain their
own public access policy. The proxy never retries a write after a lost response.
