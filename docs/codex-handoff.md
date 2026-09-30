# Codex Handoff

This is a compact transfer note for a new Codex thread, not a changelog or a
record of commands and diffs. Keep only information that source code and formal
documentation do not make quick to recover. Prune replaced entries rather than
accumulating history.

## Current State

- Repository-wide Codex working rules are in [`../AGENTS.md`](../AGENTS.md).
  Start there before exploring.
- The workspace can contain user-owned, uncommitted work. Do not assume its
  intent or overwrite it; inspect `git status` and the relevant diff only when
  the current task needs it.
- [`../CONTEXT.md`](../CONTEXT.md) is the domain glossary. It is reference
  material, not a task ledger.

## Recent Meaningful Changes

- Per-device Kiosk settings now connect management API, device bootstrap/polling,
  Dashboard Devices, and the Kiosk settings page. Migration `0032` adds the
  Server-owned revision, admin overrides, delegated keys, and local overrides.
  Admin revocation deletes local values; local writes require both a registered
  device and a Site/system administrator account. Operational observation no
  longer reads localStorage. See `apps/stage-kiosk/README.md` for precedence and
  deployment requirements. Frontend build validation was blocked by the Live2D
  SDK download; do not automatically rerun builds/typechecks (user preference).

- Webnavior now has a structured Interactive Experience editor, operations
  dashboard, draft-only Kiosk preview, per-site model policy, and server-owned
  Kiosk character assets. The completed and remaining delivery steps are in
  [`plans/2026-09-10-webnavior-management-experience.md`](plans/2026-09-10-webnavior-management-experience.md).
- Kiosk provisioning now has a one-administrator operator boundary: an
  administrator can publish a default experience template, and a newly created
  Site copies its latest snapshot into its own draft and immutable release.
  Store releases track revisions, template origin, parent release, and whether
  they are a template seed or store override. New devices inherit the Site's
  latest release; template changes never overwrite existing Sites.
- A published Kiosk Profile now has `voiceConversationOnly`. It hides the text
  composer and, with provisioned microphone permission, starts VAD on load;
  the Kiosk displays green/red microphone status from its actual VAD startup
  state, and its avatar receives the shared Stage thinking state during Server
  replies.
- Kiosk ASR/TTS now use device-authenticated `/api/kiosk/audio/*` routes. The
  Server resolves Site policy and retains provider, model, voice, endpoint, and
  credentials; kiosk bootstrap and local settings no longer carry audio models.
- Kiosk Sites persist a performance profile (`constrained`, `balanced`, or
  `high`). The kiosk bootstrap applies it locally to camera resolution,
  MediaPipe cadence/face count, and evidence-clip duration; constrained devices
  cap continuous recording to triggered clips regardless of the Site policy.
- Kiosk Sites persist their voice VAD settings, including probability threshold
  and speech padding. Authorized operators can adjust them in Kiosk technical
  settings; the kiosk refreshes immediately after a local save and otherwise
  polls the synchronized snapshot every five minutes.
- Kiosk technical settings also provide an opt-in conversation-duration
  diagnostic. When enabled, the conversation pane shows the current/latest
  request duration through final LLM text and browser-tool work, excluding ASR
  and TTS playback.
- Kiosk camera evidence supports `snapshot` in addition to off, triggered
  video, and continuous video. Snapshot captures one event-linked JPEG without
  creating `MediaRecorder`; the per-device `faceDetectionConfidence` setting
  defaults to `0.60` and accepts `0.40`–`0.80` for MediaPipe detection,
  presence, and tracking thresholds.
- Kiosk uses a bounded queue of independent final ASR utterances alongside its
  cancellable Agent/presentation turn. New VAD speech can be transcribed while
  a model or browser tool runs; Jev classifies it before any interruption or
  escalation. The Router now enforces `fullChainTimeoutMs` across all LLM
  fallback attempts. Order-menu publishes the optional Webnavior Kiosk Activity
  Manifest at `/.well-known/webnavior-kiosk-activity.json`; its customer labels
  are display-only and always have a generic Kiosk fallback.
- Normal Kiosk conversation replies now remain Server-owned but stream a stable,
  customer-safe SSE event contract to the browser. Assistant deltas are
  presentation-only until completion, browser-owned tool calls retain their
  existing execution loop, and only completed assistant text is persisted.
- Kiosk conversation progress now projects verified `turn-started`, tool, and
  first-answer events into a transient cross-column thought bubble beside the
  avatar. It deliberately never appears for unverified speech candidates, and
  each state carries its turn id so an interrupted request cannot clear a newer
  customer's progress.
- After five seconds without an answer, the Kiosk changes that progress copy to
  a truthful "still checking" state. A timed-out turn can be manually retried
  only if it attempted no cart, order, checkout, or payment mutation; menu and
  cart reads remain retryable, while the original customer message is not shown
  twice in the conversation.
- Kiosk history classifies retained sessions as interactive, greeting-only, or
  empty without deleting associated evidence. Administrators can select reviewed
  sessions and export LLM JSONL or ASR metadata plus paired audio ZIP. The
  Ubuntu updater applies the PostgreSQL schema, rebuilds server schema, and
  restarts `webnavior-api` before publishing browser assets.
- Webnavior's OpenAI-compatible TTS connection now stores its own voice instead
  of consulting AIRI's general voice catalog. The default is
  `zh-TW-HsiaoChenNeural`; `/audio/speech` receives that voice, MP3 format, and
  speed `1.0` unless a System Manager changes the connection setting.
- Removed the stale `azure-speech` SSML allow-list entry and the unused MiniMax
  Speech provider registration, metadata, translations, and dedicated docs.
- Webnavior Kiosk AI uses a Server-owned, capability-scoped control plane:
  every chat, vision, ASR, and TTS capability owns multiple isolated
  Provider Profiles and one active verified selection. Profiles do not cross
  capability boundaries, even with the same upstream URL. The runtime compiler
  projects only active verified profiles into existing AIRI gateways. The Stage
  Web 「Kiosk AI 能力」 page validates a selected model with its real capability
  endpoint before allowing activation; switching only reaches Kiosk after an
  explicit apply. `face_only` and other presence settings remain independent.
- Order Menu now loads sellable items exclusively through
  `apps/order-menu-server`'s POS Bridge. Its loopback simulator normalizes the
  repository-root `周氏蝦捲菜單_v2.json` fixture, while the browser carries the
  returned catalog revision with every cart. The Bridge rejects stale revisions
  or changed prices before forwarding to the POS. The checkout now creates a
  card/mobile terminal payment, binds an authorized payment ID and exact amount
  to the cart, and automatically submits to POS. Rejected payments return to
  method selection; uncertain payment or order receipts lock the flow pending
  reconciliation. The simulator exposes independently controllable payment and
  order outcomes. See
  `plans/2026-09-21-order-menu-pos-bridge.md`.
- Order Menu WebMCP now follows RMAP v0.2: explicit cart confirmation starts
  checkout instead of submitting directly. Agent tools can skip membership,
  choose invoice handling, display and separately confirm an eight-digit tax ID,
  select a payment method, or cancel checkout. Physical barcode scans and
  payment authorization remain outside WebMCP; pending/uncertain payments block
  cancellation and new-round cart clearing. See
  `standards/restaurant-menu-agent-protocol-v0.2.md`.

- Kiosk visitor sessions now persist compact Agent interaction context beside
  their transcript: rendered and dismissed menu subject IDs plus
  `active`/`decision_guidance`/`touch_preferred` mode. A request for other
  recommendations dismisses the preceding batch; only repeated rendering of
  unchanged items escalates guidance. The same context now retains recent menu
  item names/IDs and the latest successful compact cart snapshot for natural
  references. Full tool calls/results remain in the durable transcript for
  review, but only the current tool exchange is sent back to the model; older
  tool payloads are represented by the compact context. Recent conversational
  text is additionally bounded by total characters, and an oversized current
  tool result is reduced only in the model request while its complete durable
  result and interaction snapshot are committed before the model continuation.
  This never owns or clears the order-menu cart. See
  `apps/server/src/services/domain/kiosk-agent-interaction/`.
- Order Menu distinguishes a filtered `menu_get` lookup from a recommendation:
  lookups replace the menu grid without a recommendation rail, while
  `menu_recommend` and `menu_show_recommendations` use the rail and the Kiosk
  recommendation motion. In non-production, `kiosk-tools` traces only tool
  names/session IDs on the Server. The Kiosk forwards SSE `tool-requested`
  events before browser execution and shows selected, running, and completed
  steps in a fixed panel above the message composer.
- `menu_get` accepts `queries` for a single multi-dish lookup, so a customer
  mentioning several dishes can render their combined matched results rather
  than whichever scalar query the model chose last. Query-result presentations
  preserve each matched subject and use a fair first-card allocation, then let
  the customer switch to every subject's complete result list; broad matches
  cannot consume all preview slots. Browser-owned Agent actions now visibly
  press their resolved target control without issuing an extra DOM click. The
  System Manager's Chat Provider default and allowed maximum are 60,000 ms; an
  existing Chat profile must still be edited, verified, saved, and applied
  before its persisted 30,000 ms timeout changes.
- Order Menu now displays a transient skeleton only while a tool that will
  replace the visible menu is truly executing: filtered `menu_get`,
  `menu_recommend`, or `menu_show_recommendations`. The runtime owns start/end
  notifications, so the skeleton clears on success and failure alike; a full
  catalog read does not unnecessarily replace the current menu with a loader.

## In Progress / Known Issues

This section is the required unfinished-work index. Future Agents must read it
before proposing the next implementation; the linked plans provide detail, but
their existence alone does not mean an item has been implemented.

### Order Menu / POS

- Replace the loopback POS and payment simulator with vendor adapters after the
  POS and operations vendors provide catalog, order, terminal, timeout, and
  reconciliation contracts. Do not guess vendor fields or payment brands.
- Connect physical membership and invoice-carrier scan events. A scan result
  must come from the device adapter, never an Agent tool; an inherited carrier
  must still be shown in full for customer confirmation.
- Connect real cloud-invoice issuance for carrier, eight-digit tax ID, and
  donation. The default donation recipient remains an operations-owned setting
  and is intentionally not hard-coded.
- Add a staff reconciliation workflow for `uncertain` payment or POS results.
  Until reconciliation exists, these states intentionally lock payment, cart
  clearing, and new-round actions to prevent duplicate charges or orders.
- Run vendor-hardware acceptance tests for barcode scanners, card terminals,
  mobile-payment QR presentation, receipt results, and the configured 30-second
  timeouts once hardware contracts are available.

### Webnavior management / Kiosk

- Webnavior Kiosk now has a System One Fast Path. Each encrypted profile selects
  either Dasein open-jev or lookski/openjev, with its URL, model identifier,
  timeout, readiness and active status; both use a real `/v1/systemone`
  readiness call. The Kiosk sends its final ASR transcript, explicit phase,
  finite domain references, and a small set of phase-legal semantic intents to
  the one active profile. The model cannot see or invent WebMCP tools, cart
  line IDs, prices, payment outcomes, or POS commands. The internal candidate
  tool is excluded from Main Agent tools. `IGNORE` retains nothing;
  `NEEDS_ASSISTANT` sends the current ASR transcript to Main Agent, while
  `UNAVAILABLE`, `IGNORE`, `INCOMPLETE`, and `CLARIFICATION` remain
  on the constrained voice path. A failed decision marks the profile unready,
  and the next utterance automatically performs real readiness before
  re-enabling Fast Path. Details and present scope are in
  [`plans/2026-09-27-webnavior-dasein-system-one-phase-1.md`](plans/2026-09-27-webnavior-dasein-system-one-phase-1.md).
  System Managers can inspect the selected local deployment's actual loaded
  model through `/health`: Dasein returns `model`; lookski returns `model_id`.
  These implementation-specific single-model runtimes cannot switch model per
  System One request. System One
  profiles support edit and deletion: modifying implementation or
  connection settings revokes readiness and deactivates Fast Path, duplicate
  names return a conflict instead of a 500, and only an inactive profile may be
  removed. System Managers can explicitly deactivate Fast Path without deleting
  its profile. System One
  now compiles its Traditional Chinese semantic policy from a System Manager
  editable prompt. A blank override means the current Server default, while
  the UI exposes that default for experimentation and can restore it. The
  optional 2,000-character store instruction remains separate. Neither can
  replace candidate-set, RMAP, confirmation, or executor safety boundaries.
  Migration `0042_kiosk_system_one_policies` adds this singleton setting;
  migration `0043_kiosk_system_one_implementations` adds the required
  implementation field, marking existing profiles as Dasein; migration
  `0044_kiosk_system_one_decision_instruction` adds the editable prompt
  override. The default contrastive boundary treats a uniquely identified
  「想吃／想要水餃」and「我要／幫我加水餃」as `ADD_ITEM`; only explicit
  viewing or selecting without ordering uses `SELECT_ITEM`. In text-mode Kiosk, the main conversation panel provides a
  simulated-ASR text input, expandable raw decision trace, and a larger
  structured per-utterance inspector. It bypasses
  microphone/ASR only; it uses the real System One, current browser state,
  and WebMCP runtime, marks activity `asr_simulation`, and does not retain a
  fake audio recording.

- The obsolete Kiosk embedding Speech Guard and `/turn-decisions` control plane
  have been removed. Migration `0041_remove_kiosk_speech_guard` permanently
  removes embedding Capability Provider selections/profiles and both Speech
  Guard tables. The former Redis entry is no longer read by Server code.

- **Bounded semantic-pipeline refactor:**
  `apps/order-menu/src/kiosk-intents.ts` owns domain reference resolution,
  `deriveDecisionContext`, `resolveIntent`, `compileOperationPlan`, and
  phase-aware `authorize`. Candidates are one per legal intent, not menu ×
  intent, and the Server no longer lexically sorts or truncates them. Menu
  full names, aliases, unique suffixes, categories, selected/cart references,
  quantity, options, and supported dietary constraints are resolved in the
  application. Jev sees only per-turn ordinal domain refs, not actual item or
  cart IDs. `webmcp.ts` binds issued plans and one-round clarification to
  relevant cart/menu/selected/checkout revisions. The order machine increments
  domain revisions on each successful write, and checkout/payment refs advance
  checkout revision synchronously, including edit-then-undo cases.
  Clarification questions use
  only real refs; unique ordinal replies are resolved deterministically, while
  an unresolved reply returns to touch. Confirmation records bind action,
  slots, ID, timestamps, expiry, and revisions, and are consumed before
  execution. Payment selection now explicitly sends its phase and methods;
  payment pending/uncertain remains locked.

  The simulated-ASR panel exposes a full trace: browser and checkout snapshot,
  phase, refs, intent candidates, Jev raw answer/probabilities, resolution,
  operation plan, and authorization. A state-changing choice below 0.5 reported
  confidence returns `UNAVAILABLE` rather than executing or forwarding
  unclassified speech. On 2026-09-29 the
  configured Qwen3.5-4B openjev service passed the eight live request replay
  expectations using the default prompt, but that replay used an incorrect
  bento gold label. After correcting it to `ADD_ITEM`, the same eight cases
  passed a fresh live replay against the configured service on 2026-09-29;
  「我想要吃招牌便當」 chose `ADD_ITEM` with 0.916 confidence and 「信用卡」
  chose card payment in `checkout_payment_select`. This is not proof for
  store-specific overrides or
  physical checkout; operator-side integration testing remains necessary.
  Do not restore the removed raw direct-tool candidate path.

- **2026-09-29 continuation:** Jev's one bounded choice now has `MULTI_ACTION`
  for compound utterances that must reach Main Agent intact; a separate live
  two-question probe took about 130 seconds, so do not add a mandatory second
  Jev call without latency evidence. Fast Path retains a recent real cart line
  for 「再一份」, clarifies a conflicting selected draft, and honors the spoken
  quantity. Successful Fast Path voice turns and compact menu/cart results are
  persisted in the same visitor session that Main Agent reads. Agent has a
  read-only, device-authenticated `kiosk_session_history` tool for paged older
  text, not an unbounded prompt. Native Main Agent WebMCP mutations use the
  same `authorize` policy; high-risk calls create one-use Fast Path confirmation
  state, and ambiguous same-item cart edits use bound clarification. Checkout
  payment-stage cancellation is available only before payment begins and
  requires confirmation. ASR escalation carries a sanitized browser phase and
  payment-method snapshot into the Main Agent's first request; typed turns read
  the same snapshot through host-only `kiosk_interaction_state`, which does not
  create or consume Jev candidates. Raw checkout IDs remain browser-owned.
  Relevant targeted tests/typechecks and the corrected eight-case live replay
  pass; on-device checkout/POS integration remains to be validated.

- **Kiosk continuous-ASR continuation:** Native WebMCP host-only context/state
  calls now use the host path, and native JSON-string input schemas are parsed
  before Main Agent tool exposure. Live and simulated ASR use one bounded
  utterance queue that reserves capture order before asynchronous ASR returns
  and releases a hung ASR reservation after 15 seconds. Jev filters background speech before interrupting TTS or
  Agent work; an active Agent request can be restarted only before it requests
  a browser tool. Later speech waits for a definitive tool/result loop and is
  re-decided against current state. `UNAVAILABLE` fails closed, while explicit
  `NEEDS_ASSISTANT` and related follow-ups route to Agent. The decision inspector
  shows phase, candidates, real-reference labels, decision, operation, and
  authorization per utterance. Targeted tests and package typechecks are the
  implementation gate; local Server services were not running for live replay.

- Build the System Manager sandbox test and Store Manager on-device validation
  workflow, including device health, execution records, and audit data. This is
  phase 5 in
  [`plans/2026-09-10-webnavior-management-experience.md`](plans/2026-09-10-webnavior-management-experience.md).
- Add production account assignment for Content Managers plus submission,
  approval/publish permissions, and audit history. Current development accounts
  and role checks are not the final operator workflow; this is phase 6 in the
  management plan.
- Design a finite, validated VRMA action mapping for greeting, recommendation,
  and order-completion one-shots. Character cards and LLM output must never
  choose arbitrary filenames or URLs.

### Validation note

- Relevant package tests and typechecks have been used during development. A
  repository-wide typecheck/build was intentionally not run; follow the scoped
  validation policy in `AGENTS.md` and run integration gates only when preparing
  a release, PR, or merge that requires them.

## Key Technical Decisions

- Formal, reusable decisions belong in `docs/standards/`; reusable
  investigation outcomes belong in `docs/solutions/`. Do not duplicate either
  in this handoff.
- Follow targeted validation first. Root-level lint/typecheck remain suitable
  integration or before-commit checks, not a default after every edit.

## Relevant Files

- [`../AGENTS.md`](../AGENTS.md) — repository development rules and validation policy.
- [`../CONTEXT.md`](../CONTEXT.md) — shared domain terminology.
- [`plans/`](plans/) — current feature plans.
- [`standards/`](standards/) — stable product and protocol contracts.
- [`solutions/`](solutions/) — reusable verified implementation learnings.

## Next Likely Work

- For Order Menu, real membership, invoice, donation-recipient and payment-brand
  adapters remain deferred until POS/operations contracts arrive. The next
  implementation unit should begin only after those external contracts or a new
  product requirement is available.
