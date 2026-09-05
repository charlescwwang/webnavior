# AIRI Domain Glossary

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
interacts, and ends after order completion, explicit staff action, or inactivity.
The first version always has an anonymous identity; a future membership identity
may be attached to the same session without changing its lifecycle.

## Anonymous Kiosk Customer

The identity mode used by the first Kiosk Customer Session version. It stores no
membership identifier or personally identifying customer data, and its
conversation and cart are discarded when the session ends.

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

The transition that ends a Kiosk Customer Session, clears its menu draft and
cart, discards its customer conversation, and returns the Kiosk Runtime to an
idle anonymous state. It preserves kiosk configuration, administrator settings,
and the separate Anonymous Visitor Session observation.

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
WebMCP-enabled Interactive Service. AIH owns the shared interaction experience
without owning an Interactive Service's domain model.
_Avoid_: Ordering platform, scenario-specific AIRI

### Interactive Service

An independently owned web application embedded by AIH for one customer task.
It owns its UI, domain rules, external integrations, and WebMCP tools.
_Avoid_: AIRI module, built-in workflow

### WebMCP Adapter

The AIH-wide integration that discovers a trusted Interactive Service's native
WebMCP tools and exposes them to the active LLM runtime. It is shared host
infrastructure, not an Interactive Service-specific tool protocol.
