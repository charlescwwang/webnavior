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
  // Present only for an accepted completed order and limited to non-personal data.
  orderResult: {
    id,
    fulfillmentMode,
    itemCount,
    total,
    environment,
    status: 'accepted',
    ...(posOrderId ? { posOrderId } : {}),
    ...(pickupNumber ? { pickupNumber } : {}), // paid Kiosk only
    // Table service omits pickupNumber and includes its server-issued table.
    ...(serviceMode === 'table-service' ? { serviceMode, table, lines } : {}),
  },
}, { targetOrigin: hostOrigin })
```

The Order Menu implementation uses `targetOrigin: '*'` because it can be
embedded at a configured public origin or a local development origin. That is
safe for this bounded non-personal result channel only because the host rejects
messages unless both `event.source` and `event.origin` match the active,
approved iframe. New services should use the known host origin when one is
available.

- `activity` means a customer manually interacted with the service UI. The host
  refreshes its anonymous-session idle timer.
- `completed` means the service completed its customer flow. The host enters
  its completion lifecycle; it does not itself request a session reset. Stage
  Kiosk clears the completed order, dialogue and visitor identity when its
  completion screen finishes after confirmed success. A menu service may
  attach the listed non-personal `orderResult`; the host validates its shape
  only after validating the current iframe source and approved origin. A
  rejected or uncertain submission must not emit `completed`.

The host accepts a message only when both the event's service origin and
`event.source` match the currently embedded, allow-listed service iframe.

## Session reset

For the Order Menu, the host first renews the authenticated Bridge ordering
context using its previous round ID, then closes the visitor session and reloads
the iframe. A pending/uncertain refusal preserves the current customer state.
This allows central mode changes to apply only on a deliberate fresh round.
Standalone table completion uses the same explicit context reset before clearing
its local cart. Other approved interactive services retain their normal reload.


When reset is authorized, the host reloads the active iframe. Stage Kiosk resets
after unanswered idle-confirmation expiry (three minutes inactive, then a 15-second
countdown), confirmed completion followed by completion-screen dismissal/expiry,
or an explicit new-order/staff action. Showing the idle dialog or continuing
never resets the iframe, conversation or pending questions. Presence departure
does not itself authorize reset. Stage Web's shared lifecycle retains its default
45-second interval and automatic-expiry policy. A service
does not need to expose a host-only reset Tool or any Tool
bridge endpoint. Services must therefore initialize a fresh anonymous customer
state on page load.

## Boundaries

This protocol deliberately excludes tool schemas, tool execution, prompts,
URLs, customer identifiers, full cart lines, and arbitrary payloads. It is not
a fallback for WebMCP.
