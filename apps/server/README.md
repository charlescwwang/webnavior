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
may reach this check rather than being rejected first. Uncertain answers return
UNAVAILABLE without consuming the question, executing even a guessed deferral,
or escalating the guess to Agent. Initial `NEEDS_ASSISTANT`, `MULTI_ACTION`, and
`FOLLOW_UP_ACTIVE` routes also require finite numeric confidence in [0.6, 1].
An unreliable handoff returns `UNAVAILABLE` / `UNCERTAIN_OPERATION` before
superseding an invitation; dialogue, waiting questions and session state remain
intact. Existing action thresholds and already-admitted read-result review stay
unchanged. Confidence is not a separate proof of task relevance.
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

The route decision is not followed by a generic second speech classifier using
the same evidence. Concrete current-question answers, greeting-recipient and
finite filter checks remain distinct bounded decisions. Missing item options or
serving quantity use application-owned `configuration` state: only its issued
answers, cancel, IGNORE and NEW_REQUEST are available. Configuration/clarification
route a topic change before parsing its concrete answer.
NEW_REQUEST requests one bounded host reroute, not automatic draft cancellation:
lookups retain the meal; a verified new meal replaces it without inherited slots.
Uncertain concrete answers fail closed. Unfinished speech continuation is also
an optional route, not a pre-route gate for complete new requests. High-risk
confirmations still revoke their exact authorization before handing a new
request to Agent.

Product evidence distinguishes exact names, unconfirmed literal catalog matches,
absence and overflow. Model target choices remain finite (five), not an entire
category. `catalogEvidence` carries bounded matched text with name/merchant-alias/
fragment provenance and category member counts, not actual item IDs. Category-only
preferences browse; a singleton category never implies a named order. Explicit
serving quantities retain the category-order route. Inferred suffix uniqueness
is discovery-only evidence, not mutation authority.
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
the ordering intent. GREET choices receive one finite recipient/purpose check;
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
attempt for both ordinary chat and proactive greeting; other provider profiles
and fallback attempts do not inherit it. After updating Server code, apply the
AI bindings again to regenerate the already-persisted runtime configuration.
This disables idle model unloading, not HTTP connection cleanup or first-use
loading. It still consumes RAM/VRAM and cannot prevent restart/memory eviction.
Use an Ollama release supporting this OpenAI-compatible extension; older
versions may ignore it. Alternatively configure `OLLAMA_KEEP_ALIVE=-1` on the
Ollama server itself, not in AIRI's Server environment.

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
