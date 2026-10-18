# Stage UI

Shared core for stage

## Shared interaction feedback

`components/scenarios/feedback-invitation` provides the host-owned completion survey overlay used by customer-facing Stage surfaces. It generates a QR Code locally from a validated static HTTP(S) URL and emits one `finish` event when the visitor skips or the countdown expires.

Use it in an AIRI Interaction Host after an embedded interactive service emits `completed`. Do not use it inside a domain service, as a WebMCP tool, or to encode customer data into the survey URL.

`components/scenarios/customer-session/CustomerSessionCompletion.vue` combines
the thank-you screen with that configured invitation. An optional
`orderContinuationUrl` prop adds a separate order QR and desktop link, so carrying
away an order does not delay the reward. Pass only a host-validated capability
and clear it when the session ends; never append it to the static survey URL.

## Same-origin Interaction Profile

`composables/use-interaction-profile` owns the first non-secret configuration profile for AIRI Interaction Hosts. It keeps approved embedded services, Agent instructions, and completion-survey settings in one `localStorage` record shared by Stage Web and Stage Kiosk when they are served from the same browser origin. It deliberately starts from a new profile and does not migrate legacy host-specific storage keys. It is not cross-device configuration or secret storage.

## Native WebMCP adapter

`services/webmcp-adapter` is the shared host-side adapter for an approved iframe. A host activates it after iframe load; it discovers tools only from that iframe origin, converts the tool metadata into Vue-safe descriptors, and executes them through native WebMCP. It intentionally has no `postMessage` tool bridge fallback.

The adapter targets Chrome 155's object-input execution contract:
`document.modelContext.executeTool(registeredTool, inputObject)`. Arguments are
passed as objects; the browser serializes them before invoking the service.
Older JSON-string execution APIs are unsupported. Results remain JSON text at
the native boundary and are parsed by the adapter.

Discovery alone does not enable assistant control. The approved service must
register `webMcpHealthTool` from `@proj-airi/stage-shared/webmcp` with the same
origin allowlist and lifetime as its domain tools. The adapter calls this
side-effect-free probe with a per-discovery challenge and validates its versioned
echo before exposing any domain tools. The probe is never exposed to the Agent
or recorded as a customer operation. Every refresh revokes admission until a new
check passes; iframe replacement cancels pending checks and invalidates old replies.
Discovery and probing have a five-second deadline, including implementations
that ignore cancellation. Missing APIs, missing probes, rejected input, malformed
replies and timeouts leave the adapter unavailable, with a diagnostic `error`
and a stable `unavailableReason`. Hosts must retain manual interaction. This
checks native argument/result transport, not individual business tools, payment
providers, authentication, or physical iframe input delivery.

## Anonymous customer lifecycle

`composables/use-kiosk-customer-session` owns the disposable customer session
used by both Stage Web and Stage Kiosk: session start, pending AI work, an idle
confirmation before anonymous data is reset, expiry, completion, chat
replacement, and cleanup. A host supplies its reset policy and
own `resetInteractiveSurface` action, such as reloading an embedded WebMCP
service. Use this composable for customer-facing interactive hosts; do not put
the lifecycle into a domain service such as a restaurant menu.

Idle confirmation retains customer state and starts a 15-second reset countdown.
Continuing cancels that countdown without resetting any host content. Unanswered
expiry resets the customer/chat and embedded service to clean standby.
`resetPolicy: 'confirmed-completion'` also requires a host-confirmed successful
order before completion can reset state. `completeOrder()` marks that success;
`end('completed')` then resets customer/chat and the embedded service after its
completion screen finishes. A dismissal without this completion state is ignored.
Explicit `end('staff')` (including the new-customer action) also resets context.
Stage Kiosk uses this policy with `idleTimeoutMs: 30_000`. Stage Web retains
its default 45-second inactivity interval and automatic policy.

## Histoire (UI storyboard)

https://histoire.dev/

```shell
pnpm -F @proj-airi/stage-ui run story:dev
```

### Project structure

1. If a story is bound to a specific component, it can be placed beside the component in the `src` folder. e.g., `MyComponent.story.vue`
2. If a story is not bound to a specific component, then it should be placed in the `stories` folder. e.g., `MyStory.story.vue`
