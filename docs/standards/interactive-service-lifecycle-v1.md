# Interactive Service Lifecycle v1

Interactive Service Lifecycle v1 is the small event channel between an AIRI
Interaction Host and an embedded Interactive Service. It does not discover,
describe, or execute tools; those responsibilities belong exclusively to
native WebMCP.

## Events

An embedded service may send either event to its trusted parent origin:

```ts
window.parent.postMessage({
  source: 'airi-interaction-lifecycle',
  type: 'activity' | 'completed',
}, { targetOrigin: hostOrigin })
```

- `activity` means a customer manually interacted with the service UI. The host
  refreshes its anonymous-session idle timer.
- `completed` means the service completed its customer flow. The host enters
  its existing completion and next-customer lifecycle.

The host accepts a message only when both its origin and `event.source` match
the currently embedded, allow-listed service iframe.

## Session reset

The host resets a completed or ended customer session by reloading the active
iframe. A service does not need to expose a host-only reset Tool or any Tool
bridge endpoint. Services must therefore initialize a fresh anonymous customer
state on page load.

## Boundaries

This protocol deliberately excludes tool schemas, tool execution, prompts,
URLs, customer identifiers, cart data, and arbitrary payloads. It is not a
fallback for WebMCP.
