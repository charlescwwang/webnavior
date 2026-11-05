# AIRI Domain Glossary

## Webnavior Control Center

The management surface used to operate Webnavior sites, devices, and customer
experiences. It is not the customer-facing Kiosk experience and does not expose
infrastructure configuration to ordinary site staff.

## Interactive Experience

A named, customer-facing Kiosk experience for one Site. It combines the
customer-visible assistant identity, conversation guidance, approved interactive
service, and optional feedback destination. In implementation it is stored as a
versioned Profile snapshot, but the management interface calls it an Interactive
Experience rather than a Profile.

## Experience Draft

The editable, unpublished working copy of an Interactive Experience. Saving a
draft has no effect on any live Kiosk.

## Published Experience

An immutable Interactive Experience version assigned to one or more Kiosk
devices. Publishing is the explicit transition that permits a device to use the
new experience.

## Content Manager

A Site-scoped role that manages customer-facing Interactive Experience content,
but cannot alter infrastructure, provider credentials, or device enrollment.

## Site Manager

A Site-scoped role responsible for the operational state of its Kiosk devices
and published customer experience. It may initiate an on-site verification but
does not manage system-wide integrations.

## System Manager

A system-wide role responsible for integrations, provider and model policy,
deployment configuration, account roles, and sandbox testing. It has access to
every Site but should not be required for routine store operations.

## Kiosk AI Capability

One independent Kiosk responsibility: conversation, vision, speech-to-text, or
text-to-speech. Each capability is configured and activated independently by a
System Manager.

## Kiosk System One Decision

`PriceEvidence` is browser-issued literal currency, price/comparison amounts or
unitless numeric ranges with finite semantic interpretations, not a verified
budget. The decision path or bounded Main resolver selects `priceChoiceId`; the browser
checks it against its one-use context. `PriceConditions` constrain a single
dish's POS base price (bounds/exclusivity/ascending order), never quantity or a
whole-order allocation. Read tools apply them before ranking and limiting.
An unresolved-price handoff must clarify instead of presenting unqualified
recommendations or performing a partial mutation.

A Server-owned, per-utterance bounded semantic choice among phase-legal intents,
or `IGNORE`, `INCOMPLETE`, `FOLLOW_UP_ACTIVE`, `MULTI_ACTION` (routed to Main Agent),
`NEEDS_ASSISTANT`, `NEEDS_CLARIFICATION`, or `UNAVAILABLE`. The application
provides the current phase, finite real domain references and bounded,
role-labelled current-session dialogue; System One never
owns menu, cart, checkout, payment, POS, or WebMCP tool selection.
Runtime first chooses service / greeting / background / uncertain, then demand
shape, legal operation group and issued leaf (at most six choices per question).
Jev uses genuine confidence; a strict label-only SLM has no confidence. Both
retain the same browser authorization. Rich queries and compound demands reach
Main intact; a leaf is not an execution receipt. A pending question is an
understanding cue, not a prerequisite for new requests. Only a selected effect
that depends on that question resolves its specific legal answer; being an
answer alone does not mean consent. An uncertain answer neither consumes the
question nor grants execution authority. Execution still needs
current domain authorization. Host invitations can be answered or superseded by
ID without deleting their session history.

`NEEDS_CLARIFICATION` asks an application-issued, short-lived meal question only
after service admission. It is separate from Main Agent escalation and grants
no cart or payment authority. Uncertain service recipients remain silent. The
browser owns the proposed real item, Yes/No answers, revisions and expiry;
confirmation resumes missing-slot collection while retaining suspended meals.

## Kiosk Conversation Skill

An application-owned, versioned Main procedure, currently the built-in
`ordering@1` in `apps/server/src/services/domain/kiosk-conversation-skills`.
It describes inquiry/purchase boundaries, menu browsing, missing-slot collection,
cart edits and completion from real receipts. JSON/SSE Main chat and admitted
operation recovery load the same procedure; repository `.agents/skills` are
contributor instructions and are not loaded into customer conversations.

For one exact product in ordinary ordering, an admitted uncertain JEV operation
can be independently selected by Main from the current browser-issued meal
effects. `resolvedBy:main-skill` identifies its source without JEV confidence.
A live item-configuration answer may likewise be selected only from the current
question/candidate intersection and retains its browser `answeredQuestionId`.
The browser still resolves targets/slots, validates revisions and owns questions
and execution; loading a skill alone grants no write authority. Explicit read-only
or recovered restrictions, phone/checkout and unresolved prices are retained.

## Fast Path Action

A domain-level plan produced after the application validates a System One
intent, target uniqueness, and slots. The application compiles and authorizes
the corresponding WebMCP operation against current revisions before the
Interactive Service executes it; System One supplies no tool name or arguments.

## Kiosk Action Candidate Set

The small set of phase-legal semantic intents that an Interactive Service
offers for the current Kiosk Customer Session. Menu items and cart lines are
separate bounded domain references, not a menu-by-intent Cartesian product.
Target ambiguity is resolved from those real references after the intent is
chosen, without granting execution until clarification and authorization pass.

## Kiosk Assistant Escalation

The Kiosk transition that sends one current voice transcript to the Kiosk
Agent when System One returns `NEEDS_ASSISTANT`, a related active-request
follow-up, or the application identifies disabled Fast Path or a provider/
decision-transport failure. Activation is checked uncached before any Fast Path
candidate/direct action. Infrastructure handoff preserves the current session,
question and completed read receipts; it is not intent or execution authority.
Valid low-confidence semantic choices relinquish Fast Path before execution.
After independent recipient admission, the decision becomes `NEEDS_ASSISTANT /
UNCERTAIN_OPERATION`; Main receives the original utterance without inheriting
the guessed operation or a question answer. Uncertain recipients and malformed
answers are not semantic admission. Confirmed `IGNORE`, `INCOMPLETE`, and
`CLARIFICATION` retain their non-escalating policy. A lost browser mutation receipt never permits automatic
replay. A related follow-up interrupts only a still-thinking
Agent; once a browser tool is requested, it waits for the result and is
reclassified against the latest state.
The Main Agent receives the latest bounded conversation plus a read-only,
session-scoped history tool for older text; System One receives neither the
unbounded transcript nor that tool.

## Kiosk Service Recovery

A bounded Main admission decision after a valid Jev service abstention. One
fixed adjudication can lead to one richer contextual review; this is separate
from Main Agent task execution. A service verdict does not choose a product,
answer a Menu consent question or authorize payment. Current terminal service
abstentions typically hand off the original request after admission because
there is no remaining Jev operation route to resume.

The host receives distinct recovery progress before provider work, maintains
explicit text receipt/terminal states, and keeps unadmitted voice silent. A
read-only service clarification is an understanding cue with its own lifetime,
not a replacement for browser-issued Menu operation tickets. Shared contracts,
correlation and time ceilings live in stage-shared/kiosk-conversation.

## Kiosk Capability Provider Profile

One saved, encrypted Provider configuration belonging to exactly one Kiosk AI
Capability. A profile includes its protocol family, endpoint, selected model,
and capability-specific settings such as a TTS voice. Profiles are never shared
across capabilities, even when their upstream endpoint happens to be the same.

## Kiosk Active Provider Selection

The one verified Capability Provider Profile selected for a Kiosk AI Capability.
Changing this selection has no effect on Kiosk runtime until the System Manager
explicitly applies the pending AI configuration.

## Experience Preview

A non-device, non-publishing representation of an Interactive Experience used
to check customer-visible content and embedded service presentation. It does not
prove a physical Kiosk is healthy.

## Sandbox Test

A controlled, non-production test of an Interactive Experience and its service
integration. It is intended for a System Manager and must not change a live
device assignment or create customer records.

## On-site Verification

A guided check performed on a designated Kiosk device after publication. It
confirms that the assigned Published Experience works in its real browser and
network environment without exposing system configuration to Site staff.

## Proactive Interaction

A character capability that decides whether and when AIRI should initiate an
interaction with its user.

## Proactive Interaction Implementation

A concrete, replaceable implementation of the Proactive Interaction capability.
The built-in implementation is the default; users or teams may later install a
compatible alternative.

## Proactive Interaction Provider

An optional future Proactive Interaction Implementation reached through AIRI's
common provider interface. AIRI configures the shared connection and safety
settings; provider-specific strategy and advanced preferences are configured in
the provider's own system.

## Interaction Candidate

A bounded record created by AIRI when a system-supported sensor trigger occurs.
It contains the trigger context and may include evidence such as a screenshot
or a short video clip for a Proactive Interaction Provider to evaluate.

## Sensor Trigger

A system-supported, continuously observed condition that can create an
Interaction Candidate, such as a person looking at a display. The Proactive
Interaction module owns sensor observation and trigger evaluation under its
common configuration; providers do not choose triggers or continuously receive
the sensor stream.

## Trigger Scenario

A named, AIRI-defined situation that the Proactive Interaction module can
evaluate from observed system and sensor events. Trigger Scenarios belong to
the common module configuration rather than to a Proactive Interaction
Provider.

## Kiosk Runtime

The first runtime for Proactive Interaction. It evaluates local, in-person
attention around a display and does not include cross-device follow-up,
personal mobile notifications, or conversation continuation. The kiosk camera
is installed in a fixed position, allowing configuration against a stable
interaction area. Validation begins in a controlled setting where participants
know about local camera processing before any public kiosk deployment.

## Network-dependent Kiosk Runtime

A Kiosk Runtime is a full-screen terminal for a remotely hosted AIRI service.
Network connectivity is required for the kiosk experience, configuration, and
conversation capabilities. The kiosk still performs camera access and local
Vision inference on its own CPU.

## Attention Detection Degradation

When the camera, local Vision runtime, or attention detection is unhealthy, the
kiosk stops proactive greetings while preserving visitor-initiated touch and
voice interaction. The degraded state is visible to authorized administrators.

## Network Failure Presentation

When the network-dependent kiosk loses connectivity, it stops interaction and
displays a clear temporary-unavailable message rather than silently returning
to an idle experience.

## Kiosk Control Connection

Each active kiosk maintains a WebSocket connection to the remote AIRI service
for anonymous interaction events, health state, configuration updates, and
management commands. Continuous camera media never uses this connection;
Diagnostic Evidence Windows use ordinary HTTP upload instead.

## Kiosk Device Credential

Each kiosk has an independent, revocable device credential for its remote
control connection and diagnostic uploads. Credentials are never shared across
kiosks or tied to a visitor identity.

## Kiosk Provisioning

An administrator creates a kiosk in remote management and issues a one-time
pairing code or QR code. The physical kiosk redeems it once to obtain its own
Kiosk Device Credential.

## Kiosk Configuration Activation

Remote configuration changes are received and validated while the kiosk is
running, but become active only after the current interaction window ends and
the kiosk returns to idle.

## Kiosk Greeting Delivery

The POC uses a local, neutral greeting template to validate timing and
interaction quality. After validation, a connected kiosk may ask the active
conversation provider to generate the greeting. Each greeting is displayed and
spoken by default, while the administrator may disable either output channel
for a kiosk.

## Kiosk Greeting Templates

Administrator-authored, validated greeting text for each enabled kiosk
language. Templates include neutral single-visitor and group variants and are
synchronized to the kiosk runtime.

## Kiosk Conversation Entry Mode

The administrator-selected way a visitor starts a conversation after a greeting:
touch input, voice input, or both. The mode is configured per kiosk.

## Voice Capture Start Mode

The per-kiosk policy for voice input: either a visitor explicitly starts
recording with a control, or the kiosk opens a short listening window after a
greeting for demonstration use. Wake-word activation is outside the first
version.

## Kiosk Conversation End

A conversation ends through an explicit visitor action or after a configurable
period with no touch, voice, or attention activity. Ending the conversation
does not allow another greeting while the same Anonymous Visitor Session
remains observed.

## Kiosk Customer Session

A short-lived, customer-facing interaction owned by the Kiosk Runtime. It
contains the current conversation and order state, starts when a customer
interacts, and ends after unanswered idle-confirmation expiry, confirmed order
completion or an explicit new-order/staff action. Stage Kiosk prompts after
three minutes of inactivity, then expires after a 15-second countdown; continuing
keeps the same session and all order/dialogue state. Stage Web prompts after
45 seconds with the same countdown.
The first version always has an anonymous identity; a future membership identity
may be attached to the same session without changing its lifecycle.

## Kiosk Agent Interaction

A short-lived ordering-assistant context inside one Kiosk Customer Session. It
stores compact working state such as recently displayed menu items, the latest
successful cart snapshot, rejected item IDs, and a decision-guidance mode. The
snapshot supports natural references such as “the previous one”; it is not the
authoritative cart and never replaces the Interactive Service's domain state.
The durable transcript retains complete tool calls and results for review, while
the model-facing working context has independent character ceilings for recent
conversation text and oversized current tool results. Model-only compaction
preserves ordering identifiers and state; it never rewrites the durable record.
The interaction may become touch-preferred without ending the Customer Session
or clearing the cart, and it never crosses into another visitor's session.

## Anonymous Kiosk Customer

The default customer-facing identity mode. Ending reception clears the visible
conversation and cart for the next customer; it does not erase the restricted
system archive. No permanent conversation link is exposed through membership.

## Kiosk System Archive

The restricted system record of a Visitor Session: completed dialogue,
execution evidence, and original audio/images/video captured under the enabled
recording policy. Operational links expire; archive data has no automatic TTL.
Verified internal member/order associations retain their provenance after their
operational links expire. They are never inferred from speech or model output.

## Kiosk Pending Question

A known operational question actually presented to the customer. Its unmet need
survives idle, read-only queries and deferral within one order; execution tickets
remain bounded by expiry and relevant state revisions. A recent discussed or recommended item
is conversational focus, not an unanswered question or authorization to order.
The question has an explicit ID, purpose, phase and finite choices describing
what each answer will do. Only presentation of a valid receipt activates it;
Agent prose alone cannot. Question records remain until new-order reset;
completed/superseded questions cannot authorize an answer. High-risk confirmation
is a separate, one-use record, not an ordinary question answer.

## Dish Composition

The actual ingredients of a dish within its declared recipe scope, together with
source, completeness and revision. A simulation is not a merchant-confirmed recipe.

## Ingredient Condition

A requirement that a menu result contains or excludes an ingredient. Multiple
conditions intersect; a customization-dependent result is not an unchanged match.

## Unavailable Condition Reference

A mentioned dietary, nutrition or safety topic that current store data cannot
verify. Mentioning it is not necessarily requesting it; a dish name may contain
the same word. A requested unavailable condition cannot be silently omitted.

## Dine-in Party

The people dining together in the current order. Party size determines the
required table capacity; it is not a meal quantity.

## Table Hold

A temporary claim on specific tables for a current dine-in party, not a future
reservation. It expires unless protected by an unresolved payment; an accepted
order converts it into table occupancy.

## Kiosk Session Activity

A customer-originated touch, typed message, voice transcription, or menu action
that keeps a Kiosk Customer Session active. It is distinct from passive camera
observation, which belongs to the Anonymous Visitor Session.

## Kiosk Session Pending Work

System work performed for a Kiosk Customer Session after a customer request,
such as waiting for a conversation provider, Agent, or approved tool. Pending
Work pauses automatic session expiry and assistance-reminder timing; it is not
Kiosk Session Activity and does not represent a visitor action.

## Kiosk Assistance Reminder

A bounded, customer-facing offer of help emitted during an active Kiosk
Customer Session when anonymous observation still indicates presence but no
Kiosk Session Activity has occurred for the configured delay. It is distinct
from a Kiosk Session Reset: a reminder keeps the current session alive.

## Kiosk Assistance Reminder Candidate

An anonymous, rate-limited record produced by the built-in reminder policy.
It includes presence count, inactive duration, and reminder sequence number.
A future Agent may choose whether and how to realize the candidate, but cannot
override the policy's presence, delay, or per-session maximum-reminder limits.

## Kiosk Session Reset

The unanswered idle-confirmation expiry, confirmed-completion or explicit new-order transition that ends a Kiosk Customer Session, clears its menu draft and
cart, discards its customer conversation, and returns the Kiosk Runtime to an
idle anonymous state. It preserves kiosk configuration, administrator settings,
and the separate Anonymous Visitor Session observation.
Showing an idle reminder, continuing the same session and presence departure do
not themselves reset Stage Kiosk sessions. Unanswered countdown expiry does. Dismissing
the completion screen after a confirmed successful order does reset them. Failed or
uncertain submission is not completion. Stage Web's shared lifecycle uses automatic
expiry; Stage Kiosk's confirmed-completion policy also guards completion authority.

## Kiosk Language Policy

Each kiosk has a default greeting language and a visible language selector. The
conversation agent may help switch language from a visitor's text or spoken
input, but Vision data is never used to infer language.

## Agent-assisted Language Switch

When the conversation agent detects another language from visitor input, it
asks for confirmation before changing the kiosk interface and reply language.

## Kiosk Attention Scenarios

The initial built-in Trigger Scenarios for a Kiosk Runtime: a person enters
the observation range, looks at the kiosk, or looks at the kiosk for a minimum
dwell time. Each can be enabled independently; the dwell-time scenario is the
default enabled scenario.

## Kiosk Main Conversation Context

A host-only Menu snapshot for one active Main task, separate from Jev's finite
candidate context. It carries all compact catalog products after phone entry,
current cart/checkout/questions/revisions and phase capabilities. Kiosk refreshes
it before each model round; Server includes one current projection. Complete
facts support understanding but never grant purchase/payment authorization.
The neutral contract lives in `packages/stage-shared/src/kioskConversation.ts`.
Unconfirmed names use an explicit addition/replacement proposal; customer consent
and current runtime validation remain necessary before any cart change.

## Kiosk Greeting POC

A controlled validation of the dwell-time attention scenario. It measures both
trigger correctness and whether the resulting greeting feels natural enough to
encourage a visitor to continue interacting.

## Kiosk Greeting POC Feedback

Evidence for the Kiosk Greeting POC combines anonymous event records,
observer annotations, and voluntary tester feedback. When the kiosk completes
an order flow, it offers a non-blocking, dismissible floating feedback prompt
that correlates with the same anonymous interaction window.

## Kiosk Greeting POC Rating

The first tester feedback question asks whether the kiosk's greeting timing
felt natural, on a five-point scale.

## Kiosk Order Completion Source

The source that reports an order-flow completion to the kiosk. The POC may use
a simulated completion screen, while a future production order system may
provide the same completion event.

## Kiosk Diagnostics Panel

A management-only POC view of live visitor count, attention and dwell signals,
interaction-window state, cooldown state, and suppression reasons. It can also
manually test a greeting and is never visible in the visitor experience.

## Kiosk Management Access

Authorized administrators may access kiosk settings and diagnostics either
locally for on-site calibration or through a remote management surface for
cross-kiosk configuration and review.

## Diagnostic Capture Mode

The AIRI-owned policy for retaining evidence around a trigger. Controlled POC
mode retains diagnostic media; standard deployments retain only anonymous
events; designated early field trials may automatically retain triggered
diagnostic media under separately configured retention, access, and on-site
notice controls. Retained media is deleted automatically after a per-kiosk
retention period, which defaults to fourteen days.

## Diagnostic Evidence Window

A short video window retained around a trigger, including footage from before
and after the trigger. It provides context for reviewing why a trigger occurred
and what happened after the kiosk greeted.

## Diagnostic Upload Policy

A per-kiosk choice to keep Diagnostic Evidence Windows local or automatically
upload every retained window after connectivity resumes. It never uploads a
continuous camera stream; anonymous trigger events are synchronized by default.

## Diagnostic Evidence Storage

The stable storage module that manages Diagnostic Evidence Windows and their
retention lifecycle. The initial adapter stores evidence locally; a future
remote adapter may add upload without changing sensing, trigger evaluation, or
greeting behavior.

## Diagnostic Evidence Access

The first version has only two roles: the kiosk's venue administrator and
technical support. Venue administrators have access by default; technical
support requires explicit per-kiosk enablement and each view is audit logged.
Custom roles, groups, and approval workflows are outside the first version.

## Pilot Data Operator

The single named operator accountable for a controlled kiosk pilot's visitor
data handling, including notice, consent, retention, access, deletion, and
incident response. Production partnerships may replace this assumption with a
documented organizational role split.

## Anonymous Visitor Session

A short-lived, local observation used to suppress repeat interactions while a
person remains in the kiosk's current view. It does not persist identity,
facial features, or recognition data across sessions, days, or devices.

## Kiosk Trigger Settings

The common administrator controls for built-in Kiosk Attention Scenarios:
scenario enablement, minimum dwell time, and interaction cooldown. They tune
defined scenarios but do not create arbitrary custom trigger rules.

## Conversation Adaptation

The adjustment of an ongoing kiosk conversation in response to non-verbal
signals such as possible confusion. It shares Vision signals with Proactive
Interaction but does not treat inferred expressions as certain facts.

## Conversation Adaptation Ladder

The ordered response policy for possible confusion: first adapt the next reply
silently, then offer a low-interruption prompt if cues persist, and only make
an immediate spoken intervention when explicitly enabled and sufficiently
confident.

## Addressing Policy

The AIRI-owned policy that selects how a kiosk addresses a visitor. Neutral
addressing is the default. Appearance-derived titles are an explicit,
administrator-enabled option and must fall back to neutral wording when the
inference is uncertain. A configured courtesy style may use gendered phrases
such as "handsome" or "beautiful" without treating them as an assessment of
appearance. Race is never an addressing input.

## Addressing Style

The administrator-selected kiosk wording style: neutral, formal gendered, or
casual gendered courtesy. The selected style is applied only when permitted by
the Addressing Policy.

## Visitor Attribute Inference

An optional, local Vision capability that estimates a visitor's age band and
perceived gender presentation. Each attribute has its own administrator-set
confidence threshold and response templates. It is used to select a permitted
addressing style or adapt kiosk guidance, and must fall back when uncertain.

## Age-adapted Guidance

Kiosk guidance that uses an inferred age band to offer relevant options, such
as child-friendly meals. It should offer options without asserting an inferred
age as a fact.

## Co-present Visitor Group

A temporary, anonymous set of visitors observed near an attention-engaged
visitor during one interaction window. Other members need not look at the
kiosk themselves; proximity and co-presence establish the group. It is an
observation for group-level guidance, not a claim that the people have a social
relationship or a persisted group identity.

## Group Association Settings

Administrator-adjustable proximity and co-presence duration thresholds used to
form a Co-present Visitor Group. The settings operate on normalized distance
and observation signals so the underlying Vision model may change.

## Evidence Disclosure Policy

AIRI-owned common policy that limits the evidence attached to an Interaction
Candidate, including whether to disclose media and the permitted duration. A
provider may only receive evidence within this policy and cannot expand the
scope itself.

## Interaction Directive

A standardized, declarative response from a Proactive Interaction Provider
describing how AIRI should interact. AIRI validates the directive against its
capabilities and user policies, then performs the resulting output; providers
do not directly control AIRI's output surfaces. A directive may describe an
interaction intent for AIRI to realize, or include complete presentation
content such as a greeting script.

## Active Proactive Interaction Provider

The one Proactive Interaction Provider selected for an AIRI runtime when the
optional provider mode is enabled. AIRI sends every Interaction Candidate only
to this provider; candidates are never fanned out to multiple providers.

## Built-in Proactive Policy

The default Proactive Interaction Implementation. It evaluates local Vision
signals and AIRI-owned rules, then asks the existing conversation and output
capabilities to realize an interaction. It does not require a Proactive
Interaction Provider.

## AIRI Interaction Host

### AIRI Interaction Host (AIH)

The AIRI architecture that composes AIRI Core, a Kiosk Host, and one trusted
tool-enabled Interactive Service. AIH owns the shared interaction experience
without owning an Interactive Service's domain model.
_Avoid_: Ordering platform, scenario-specific AIRI

### Interactive Service

An independently owned web application embedded by AIH for one customer task.
It owns its UI, domain rules, external integrations, and tools. The owned Kiosk
Menu exposes them through Eventa window-message.
_Avoid_: AIRI module, built-in workflow

### WebMCP Adapter

The native integration still used by Stage Web. It discovers a trusted service's
native WebMCP tools and exposes them to the active LLM runtime. Stage Web has not
migrated to the Kiosk connection and cannot control the updated owned Menu.

### Interactive Service Client

The Kiosk connection to its approved Menu iframe through Eventa window-message.
It owns discovery, document binding, execution receipts and connection lifetime;
the Menu runtime retains ordering rules and state. Stage Web migration is separate.
