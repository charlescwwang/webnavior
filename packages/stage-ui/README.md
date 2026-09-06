# Stage UI

Shared core for stage

## Shared interaction feedback

`components/scenarios/feedback-invitation` provides the host-owned completion survey overlay used by customer-facing Stage surfaces. It generates a QR Code locally from a validated static HTTP(S) URL and emits one `finish` event when the visitor skips or the countdown expires.

Use it in an AIRI Interaction Host after an embedded interactive service emits `completed`. Do not use it inside a domain service, as a WebMCP tool, or to encode customer data into the survey URL.

## Native WebMCP adapter

`services/webmcp-adapter` is the shared host-side adapter for an approved iframe. A host activates it after iframe load; it discovers tools only from that iframe origin, converts the tool metadata into Vue-safe descriptors, and executes them through native WebMCP. It intentionally has no `postMessage` tool bridge fallback.

## Anonymous customer lifecycle

`composables/use-kiosk-customer-session` owns the disposable customer session
used by both Stage Web and Stage Kiosk: session start, pending AI work, idle
expiry, completion, chat replacement, and cleanup. A host supplies only its
own `resetInteractiveSurface` action, such as reloading an embedded WebMCP
service. Use this composable for customer-facing interactive hosts; do not put
the lifecycle into a domain service such as a restaurant menu.

## Histoire (UI storyboard)

https://histoire.dev/

```shell
pnpm -F @proj-airi/stage-ui run story:dev
```

### Project structure

1. If a story is bound to a specific component, it can be placed beside the component in the `src` folder. e.g., `MyComponent.story.vue`
2. If a story is not bound to a specific component, then it should be placed in the `stories` folder. e.g., `MyStory.story.vue`
