# Embedded Scenario Bridge v1

> **Deprecated.** AIH now uses native WebMCP for tool discovery and execution.
> This document remains only as historical context for the MVP; do not use it
> for new Interactive Services. See `docs/plans/2026-09-05-airi-interaction-host-baseline.md`.

This protocol lets AIRI Kiosk host independently developed interactive web
applications without adding a domain-specific integration to AIRI. A restaurant
menu, patient registration flow, or exhibition guide can use the same contract.

## Kiosk configuration

In Kiosk administrator mode, register each scenario under **互動服務**. Every
entry needs a stable ID, customer-facing title, URL, description, and enabled
state. The Kiosk exposes only enabled, complete IDs to the Agent; it never
accepts a URL as a model tool argument. `restaurant-ordering` is the default
registration. In current hosts, `VITE_ORDERING_SCENARIO_URL` supplies that URL
only when the same browser origin has not yet created its Interaction Profile;
a saved service URL takes precedence.

The scenario application must allow the Kiosk origin through its own deployment
configuration. AIRI accepts bridge messages only from the URL's origin.

## Ready manifest

After it is ready, the scenario posts this message to its parent:

```text
{
  source: 'airi-scenario-bridge',
  type: 'scenario:ready',
  manifest: {
    id: 'patient-registration',
    title: '門診掛號',
    agentPrompt: '這是由場景擁有者提供的顧客互動規則。',
    tools: [
      {
        name: 'registration.select_doctor',
        description: '選擇已查詢到的醫師。',
        inputSchema: {
          type: 'object',
          properties: { doctorId: { type: 'string' } },
          required: ['doctorId'],
          additionalProperties: false,
        },
      },
    ],
    session: {
      reset: { name: 'registration.reset' },
    },
  },
}
```

`agentPrompt` and tool definitions are trusted configuration from the configured
scenario origin. Do not point a production kiosk at an untrusted site.

## Tool calls

For each manifest tool, AIRI sends:

```text
{
  source: 'airi-scenario-bridge',
  type: 'scenario:call',
  requestId: crypto.randomUUID(),
  name: 'registration.select_doctor',
  args: { doctorId: 'dr-chen' },
}
```

The scenario must reply to the message source with:

```text
{
  source: 'airi-scenario-bridge',
  type: 'scenario:result',
  requestId: 'same-request-id',
  result: { selected: true },
}
```

Use `error: 'human-readable error'` instead of `result` when the action cannot
be completed.

The scenario owns visual feedback. During a tool call it should highlight the
affected UI, animate its own virtual pointer if desired, and update the visible
state. AIRI never controls operating-system pointer coordinates.

## Lifecycle events

Scenarios may notify the host:

```text
{ source: 'airi-scenario-bridge', type: 'scenario:event', event: 'activity' }
{ source: 'airi-scenario-bridge', type: 'scenario:event', event: 'completed' }
```

`activity` keeps the anonymous Kiosk session alive. `completed` starts the
configured next-customer transition. The optional manifest reset command is
called by AIRI when a customer session ends; it is never exposed to the LLM.
