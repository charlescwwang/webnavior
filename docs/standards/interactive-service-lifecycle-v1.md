# Interactive Service Lifecycle v1

Interactive Service Lifecycle v1 is the small event channel between an AIRI
Interaction Host and an embedded Interactive Service. It does not discover,
describe, or execute tools; those responsibilities belong exclusively to
native WebMCP.

## Events

An embedded service may send either event to its parent:

```ts
window.parent.postMessage({
  source: 'airi-interaction-lifecycle',
  type: 'activity' | 'completed',
  // Present only for a completed order and limited to non-personal POC data.
  orderResult: { id, fulfillmentMode, itemCount, total, simulated },
}, { targetOrigin: hostOrigin })
```

The Order Menu implementation uses `targetOrigin: '*'` because it can be
embedded at a configured public origin or a local development origin. That is
safe for this deliberately payload-free channel only because the host rejects
messages unless both `event.source` and `event.origin` match the active,
approved iframe. New services should use the known host origin when one is
available.

- `activity` means a customer manually interacted with the service UI. The host
  refreshes its anonymous-session idle timer.
- `completed` means the service completed its customer flow. The host enters
  its existing completion and next-customer lifecycle. A menu service may
  attach the listed non-personal `orderResult`; the host validates its shape
  only after validating the current iframe source and approved origin.

The host accepts a message only when both the event's service origin and
`event.source` match the currently embedded, allow-listed service iframe.

## Session reset

The host resets a completed or ended customer session by reloading the active
iframe. A service does not need to expose a host-only reset Tool or any Tool
bridge endpoint. Services must therefore initialize a fresh anonymous customer
state on page load.

## Boundaries

This protocol deliberately excludes tool schemas, tool execution, prompts,
URLs, customer identifiers, full cart lines, and arbitrary payloads. It is not
a fallback for WebMCP.
