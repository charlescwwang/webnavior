---
title: WebMCP LLM Tool-Calling Training Contract
date: 2026-09-30
category: research
module: WebMCP agent integration
problem_type: research
component: WebMCP
tags:
  - webmcp
  - llm
  - tool-calling
  - training-data
---

# WebMCP LLM Tool-Calling Training Contract

## Scope and status

This note describes the **current imperative WebMCP API**, checked on 2026-09-30.
WebMCP is a W3C Web Machine Learning Community Group draft, not a W3C Standard or
a standards-track specification. Its browser surface is `document.modelContext` in
a secure context; do not train against the obsolete `navigator.modelContext` name.
[WebMCP draft](https://webmachinelearning.github.io/webmcp/)

The draft standardizes page-to-browser tool registration and in-page execution. It
does **not** prescribe a provider-neutral LLM function-call wire format. In
particular, a browser agent obtains a browser-defined page observation instead of
running page JavaScript. Therefore the JSONL representation below is a recommended
training contract, not a claimed WebMCP protocol.
[Agent interaction model](https://webmachinelearning.github.io/webmcp/#interaction-with-agents)

## Browser-facing contract

### Registration / declaration

The page registers a tool with:

```ts
await document.modelContext.registerTool({
  name: 'get_order_status',
  title: 'Get order status', // optional, UI-facing and localizable
  description: 'Retrieve the status for a customer-visible order ID.',
  inputSchema: {
    type: 'object',
    properties: {
      orderId: {
        type: 'string',
        description: 'The customer-visible order identifier.',
      },
    },
    required: ['orderId'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  async execute(input, { signal }) {
    // Validate domain rules here; propagate signal to cancellable work.
    return { found: true, orderId: input.orderId, status: 'preparing' };
  },
});
```

`name`, `description`, and `execute` are required; `title`, `inputSchema`, and
`annotations` are optional. Names are unique per model context, 1–128 characters,
and limited to ASCII alphanumerics, `_`, `-`, and `.`. `inputSchema` is a JSON
Schema object; there is currently **no output-schema field** in the imperative
tool definition. The callback is `Promise<any>(object, { signal: AbortSignal })`.
[Normative API and tool dictionary](https://webmachinelearning.github.io/webmcp/#api)

The four annotation booleans default to `false`:

| Annotation | Meaning for an agent/client |
| --- | --- |
| `readOnlyHint` | The tool does not change state. |
| `untrustedContentHint` | Output contains content untrusted by the tool author. |
| `consequentialHint` | The action is significant, real-world, or non-reversible; a client can require confirmation. |
| `debugging` | Intended for developer tooling rather than end users. |

[Annotation definitions](https://webmachinelearning.github.io/webmcp/#modelcontexttool-dictionary)

### Discovery, invocation, and result

An in-page agent can call `getTools()` and pass a returned `RegisteredTool` plus a
JSON-serializable **object** to `executeTool(tool, inputObject, { signal })`.
`executeTool()` resolves to the callback's **JSON-stringified** fulfilled value;
when omitted, input is `{}`. The callback receives parsed input and an execution
`AbortSignal`.
[Execution API](https://webmachinelearning.github.io/webmcp/#modelcontext-executetool)

In contrast, the browser's own agent has a browser-defined observation of the
page's exposed tools; it does not run arbitrary page JavaScript. A model decides
which exposed capability to use; the browser mediates the call; the page owns the
actual state change and result. This is why a trainer should model tool metadata,
arguments, and returned JSON—not DOM clicks or a fictitious HTTP endpoint.
[Browser-agent distinction](https://webmachinelearning.github.io/webmcp/#page-observations)

### Failure and cancellation

Registration rejects for duplicate names, an empty name/description, invalid name,
or an unserializable schema. Invocation rejects for browser/API conditions such as
inactive documents, unavailable permission, a bad target, abort, or an execution
failure. A callback rejection or an unserializable fulfilled result currently makes
the in-page invocation fail as `UnknownError`; the callback's thrown message is not
a stable model-visible error contract. Cancellation is communicated to the callback
through its `AbortSignal`.
[Registration validation](https://webmachinelearning.github.io/webmcp/#dom-modelcontext-registertool),
[execution completion](https://webmachinelearning.github.io/webmcp/#supporting-concepts)

For expected, recoverable **domain** failures (bad business state, unavailable
record, rate limit), return a JSON value such as `{ ok: false, error: { code,
message, retryable } }` rather than throw. This is an application/training policy,
not a WebMCP-required envelope; it gives the model stable information to correct a
call. Chrome likewise recommends strict code validation and descriptive errors for
self-correction. [Chrome tool-design guidance](https://developer.chrome.com/docs/ai/webmcp/best-practices)

## Recommended JSONL training representation

Use the native names and object-shaped arguments, but make the training container
explicitly application-owned. Do not label OpenAI, MCP, or another provider's
`content` envelope as WebMCP itself.

```json
{
  "page": {
    "origin": "https://shop.example",
    "state": "order-status-ready",
    "tools": [
      {
        "name": "get_order_status",
        "description": "Retrieve the status for a customer-visible order ID.",
        "inputSchema": {
          "type": "object",
          "properties": { "orderId": { "type": "string" } },
          "required": ["orderId"],
          "additionalProperties": false
        },
        "annotations": { "readOnlyHint": true }
      }
    ]
  },
  "messages": [
    { "role": "user", "content": "查一下 A-1042 的訂單狀態" }
  ],
  "target": {
    "type": "webmcp_tool_call",
    "name": "get_order_status",
    "arguments": { "orderId": "A-1042" }
  }
}
```

Pair the call with an execution observation. Store `value` as JSON (the model's
semantic result); the runtime serializes it to the string returned by
`executeTool()`.

```json
{
  "type": "webmcp_tool_result",
  "name": "get_order_status",
  "value": { "found": true, "orderId": "A-1042", "status": "preparing" }
}
```

Include at least three target groups per tool: successful calls, schema/domain
validation failures with corrected retry calls, and user-aborted/no-further-action
cases. Keep browser transport errors separate from the tool result: the draft does
not define a portable structured error payload for callback exceptions.

## Data-quality and security rules

- Provide only the tools exposed in the current page state. Avoid overlapping
  capabilities; names and descriptions should state exactly what happens and when
  to use the tool. [Chrome best practices](https://developer.chrome.com/docs/ai/webmcp/best-practices)
- Treat schema constraints as guidance, not authorization. Production callbacks
  still validate every argument and enforce business permissions.
- Preserve `untrustedContentHint` in examples and label externally sourced text as
  untrusted. Tool metadata and returned text can carry indirect prompt injection;
  neither is authority to override the user or system policy.
  [WebMCP security considerations](https://webmachinelearning.github.io/webmcp/#security-and-privacy-considerations)
- For consequential actions, annotate `consequentialHint: true` and train an
  explicit confirmation step before the action. An annotation is a signal, not a
  replacement for application authorization. [Chrome security guidance](https://developer.chrome.com/docs/ai/webmcp/secure-tools)
- For cross-origin iframes, the parent must delegate `allow="tools"`; the owner
  must list trusted secure origins in `exposedTo`, and the consumer must request
  them with `getTools({ fromOrigins })`. [Cross-origin imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api)

## Declarative API caveat

Chrome also supports annotating HTML forms (`toolname`, `tooldescription`, optional
`toolautosubmit`), whose fields become inputs; `SubmitEvent.respondWith(Promise)`
returns the serialized result. The current Community Group draft labels its
declarative section TODO, so use it only when targeting Chrome's implementation and
keep the imperative contract as the portable training baseline.
[Chrome declarative API](https://developer.chrome.com/docs/ai/webmcp/declarative-api),
[draft caveat](https://webmachinelearning.github.io/webmcp/#declarative-webmcp)

## AIRI Order Menu corpus brief

The preceding material is protocol context. It is **not sufficient on its own**
to commission training data for AIRI: this section is the task-specific brief.
The corpus target is the customer-facing conversational Agent embedded in
`apps/order-menu`. It must never contain the five `kiosk_*` tools: they are
Kiosk-host/System-One implementation controls, deliberately withheld from the
conversational Agent in `invokeForAgent`.

### Tool surface to include

All tool inputs below are JSON objects and reject additional properties. This
is the standalone argument contract a corpus producer needs; the live source of
truth is `apps/order-menu/src/webmcp.ts` when a future release changes it.

| Tool | Exact arguments | Expected useful result fields |
| --- | --- | --- |
| `menu_get` | Optional `display: boolean`, `category: string`, `query: string`, or `queries: string[]` (1–4 unique non-empty strings) | `catalog`, `categories`, `fulfillmentModes`, `items[]`, optional `presentation` |
| `menu_recommend` | Optional `needs: ('rice'|'fried'|'pork-free')[]`; optional `limit: 1..3` | `items[]`, `needs`, `customerMessage`, optional `presentation` |
| `menu_show_recommendations` | Required `itemIds: string[]` (1–4 unique IDs from a prior menu result); optional `title` ≤36 chars, `reason` ≤90 chars | `items[]`, `presentation`, `customerMessage` |
| `menu_select_item` | Required `itemId: string` from `menu_get.items[]` | `item`, `selection`, `customerMessage` |
| `menu_set_item_option` | Required `groupId`, `valueId` from current selected item's `optionGroups` | `selection`, `customerMessage` |
| `menu_set_quantity` | Required integer `quantity: 1..20` | `selection`, `customerMessage` |
| `order_add_item` | Required `itemId`; optional `options: [{groupId,valueId}]` with no duplicate group; optional integer `quantity: 1..20` | `item`, `line`, `cart`, `pendingCustomerChoice`, `nextStep`, `customerMessage` |
| `cart_add_item` | `{}`; current selection must already exist | `line`, `cart`, `pendingCustomerChoice`, `nextStep`, `customerMessage` |
| `cart_get` | `{}` | `cart`, `pendingCustomerChoice`, `nextStep` |
| `cart_remove_item` | Required `lineId` from `cart_get.cart.lines[]` | `cart`, `customerMessage`, `nextStep` |
| `cart_set_line_quantity` | Required `lineId`, positive integer `quantity` | `cart`, `customerMessage`, `nextStep` |
| `cart_set_line_option` | Required `lineId`, `groupId`, `valueId` | `cart`, `line`, `customerMessage`, `nextStep` |
| `cart_clear` | Required `confirmedByUser: true` | empty `cart`, `customerMessage`, `nextStep` |
| `order_set_fulfillment` | Required `mode: 'dine-in'|'takeout'` | `cart`, `fulfillmentMode`, `nextStep`, `customerMessage` |
| `checkout_start` | Required `confirmedByUser: true` | `checkout: { stage: 'membership' }`, `nextStep`, `customerMessage` |
| `checkout_skip_membership` | Required `confirmedByUser: true` | `checkout: { stage: 'invoice' }`, `customerMessage` |
| `checkout_choose_invoice` | Required `method: 'carrier'|'donation'` | `checkout: { stage: 'payment', invoiceMethod }`, `customerMessage` |
| `checkout_request_tax_id` | `{}` | `checkout: { stage: 'tax-id', invoiceMethod: 'tax-id', taxId: '' }`, `customerMessage` |
| `checkout_set_tax_id` | Required `taxId: string` matching `^\d{8}$` | `checkout` (still `tax-id`), `customerMessage`, `nextStep` |
| `checkout_confirm_tax_id` | Required `confirmedByUser: true` | `checkout: { stage: 'payment', invoiceMethod: 'tax-id' }`, `customerMessage` |
| `checkout_select_payment` | Required `method: 'card'|'mobile'` | `payment: { method, status }`, `nextStep`, `customerMessage` |
| `checkout_cancel` | Required `confirmedByUser: true` | retained `cart`, `customerMessage` |

### Complete successful-output contract

WebMCP does not have an `outputSchema` field. The following is the AIRI
application-owned output contract and must be used as the target result shape
for every successful corpus tool turn. It is intentionally explicit so a corpus
producer does not have to infer output from a field-name table.

```ts
type MenuItemOutput = {
  available: boolean
  id: string
  name: string
  description: string
  category: string
  price: number
  recommendationTags: ('rice' | 'fried' | 'pork-free')[]
  optionGroups: Array<{
    id: string
    label: string
    required: boolean
    values: Array<{ id: string, label: string, priceDelta: number }>
  }>
}

type SelectionOutput = {
  itemId: string
  quantity: number
  options: Record<string, string> // groupId -> valueId
}

type CartOutput = {
  catalogRevision?: string
  fulfillmentMode?: 'dine-in' | 'takeout'
  lines: Array<SelectionOutput & {
    id: string // opaque cart line ID; use for later cart mutations
    name: string
    unitPrice: number
  }>
  total: number
  itemCount: number
  paymentId?: string
}

type CheckoutOutput = {
  stage: 'membership' | 'invoice' | 'tax-id' | 'payment'
  carrierCode?: string
  membershipNumber?: string
  invoiceMethod?: 'carrier' | 'donation' | 'tax-id'
  taxId?: string
}

type PendingCustomerChoice = {
  id: 'fulfillment-mode'
  question: '請問要內用還是外帶？'
  canBeDeferred: true
  options: [{ id: 'dine-in', label: '內用' }, { id: 'takeout', label: '外帶' }]
}

type Presentation =
  | {
    kind: 'query-results'
    itemIds: string[]
    subjects: Array<{ id: string, label: string, itemIds: string[] }>
    title: string
  }
  | {
    kind: 'recommendation'
    itemIds: string[]
    title?: string
    reason?: string
  }

type ToolSuccessOutput = {
  menu_get: {
    catalog: { isSimulated: boolean, sourceName: string, sourceUrl: string }
    categories: string[]
    fulfillmentModes: [{ id: 'dine-in', label: '內用' }, { id: 'takeout', label: '外帶' }]
    items: MenuItemOutput[]
    customerMessage?: string
    presentation?: Extract<Presentation, { kind: 'query-results' }>
  }
  menu_recommend: {
    customerMessage: string
    items: MenuItemOutput[]
    needs: ('rice' | 'fried' | 'pork-free')[]
    presentation?: Extract<Presentation, { kind: 'recommendation' }>
  }
  menu_show_recommendations: {
    customerMessage: string
    items: MenuItemOutput[]
    presentation: Extract<Presentation, { kind: 'recommendation' }>
  }
  menu_select_item: { item: MenuItemOutput, selection: SelectionOutput, customerMessage: string }
  menu_set_item_option: { customerMessage: string, selection: SelectionOutput }
  menu_set_quantity: { customerMessage: string, selection: SelectionOutput }
  order_add_item: {
    item: MenuItemOutput
    line: CartOutput['lines'][number]
    cart: CartOutput
    customerMessage: string
    pendingCustomerChoice?: PendingCustomerChoice
    nextStep: string
  }
  cart_add_item: {
    line: CartOutput['lines'][number]
    cart: CartOutput
    customerMessage: string
    pendingCustomerChoice?: PendingCustomerChoice
    nextStep: string
  }
  cart_get: { cart: CartOutput, pendingCustomerChoice?: PendingCustomerChoice, nextStep: string }
  cart_remove_item: { cart: CartOutput, customerMessage: string, pendingCustomerChoice?: PendingCustomerChoice, nextStep: string }
  cart_set_line_quantity: { cart: CartOutput, customerMessage: string, pendingCustomerChoice?: PendingCustomerChoice, nextStep: string }
  cart_set_line_option: {
    cart: CartOutput
    line: CartOutput['lines'][number]
    customerMessage: string
    pendingCustomerChoice?: PendingCustomerChoice
    nextStep: string
  }
  cart_clear: { cart: CartOutput, customerMessage: '已清空購物車。', nextStep: string }
  order_set_fulfillment: {
    cart: CartOutput
    fulfillmentMode: 'dine-in' | 'takeout'
    customerMessage: string
    nextStep: string
  }
  checkout_start: { checkout: CheckoutOutput, customerMessage: string, nextStep: string }
  checkout_skip_membership: { checkout: CheckoutOutput, customerMessage: string }
  checkout_choose_invoice: { checkout: CheckoutOutput, customerMessage: string }
  checkout_request_tax_id: { checkout: CheckoutOutput, customerMessage: string }
  checkout_set_tax_id: { checkout: CheckoutOutput, customerMessage: string, nextStep: string }
  checkout_confirm_tax_id: { checkout: CheckoutOutput, customerMessage: string }
  checkout_select_payment: {
    customerMessage: string
    payment: { method: 'card' | 'mobile', status: 'pending' | 'authorized' | 'rejected' | 'uncertain' }
    nextStep: string
  }
  checkout_cancel: { cart: CartOutput, customerMessage: '已返回訂單內容，購物車仍保留。' }
}
```

The exact value of each `customerMessage`, `nextStep`, menu item, price, ID,
and snapshot is runtime data. In production corpus generation, preserve the
value from the controlled tool execution; do not synthesize a shorter output or
replace an opaque ID. The aliases above describe **all structural fields**, not
a license to omit fields from a recorded successful result.

Every recoverable failed result uses this separate shape:

```ts
type ToolFailureOutput = {
  ok: false
  error: string
  recovery: string
}
```

| Group | Tools | Corpus constraint |
| --- | --- | --- |
| Menu read/presentation | `menu_get`, `menu_recommend`, `menu_show_recommendations` | Return and subsequently reuse only IDs from actual prior tool results. A named dish uses `menu_get`; do not fabricate a recommendation. |
| Selection | `menu_select_item`, `menu_set_item_option`, `menu_set_quantity`, `cart_add_item` | The selected item and option IDs must have been returned by `menu_get`; these describe the progressive UI route. |
| One-shot add | `order_add_item` | Prefer this when the customer has already given one item, its known options, and quantity. Required option groups must be supplied. |
| Cart | `cart_get`, `cart_remove_item`, `cart_set_line_quantity`, `cart_set_line_option`, `cart_clear` | Read `cart_get` before mutating an existing line. `lineId` comes only from `cart.lines[].id`, not `itemId`. `cart_clear` requires explicit customer consent. |
| Fulfillment | `order_set_fulfillment` | `mode` is exactly `dine-in` or `takeout`; it must precede `checkout_start`. |
| Checkout | `checkout_start`, `checkout_skip_membership`, `checkout_choose_invoice`, `checkout_request_tax_id`, `checkout_set_tax_id`, `checkout_confirm_tax_id`, `checkout_select_payment`, `checkout_cancel` | Follow the state machine below. The corpus must never invent barcode scans, terminal authorization, POS submission, or a payment-success claim. |

### Authoritative values and result shapes

Do not create examples with plausible-looking fixed IDs such as `shrimp-roll-1`
or `line-2`. The generator must seed each scenario with an actual `menu_get`
result from the target catalog, then thread these values through later turns:

```json
{
  "item": {
    "id": "<menu_get.items[].id>",
    "optionGroups": [{
      "id": "<group.id>",
      "values": [{ "id": "<value.id>" }]
    }]
  },
  "cart": {
    "lines": [{ "id": "<cart_get.cart.lines[].id>", "itemId": "<item.id>" }],
    "fulfillmentMode": "dine-in|takeout|undefined",
    "total": "<number>",
    "itemCount": "<number>"
  },
  "checkout": {
    "stage": "membership|invoice|tax-id|payment",
    "membershipNumber": "<optional customer-visible value>",
    "carrierCode": "<optional scanner-provided value>",
    "invoiceMethod": "carrier|donation|tax-id"
  }
}
```

Expected successful tool results are ordinary JSON values, not an invented MCP
envelope. Most mutations include `customerMessage` and the resulting `cart`,
`selection`, or `checkout` snapshot. `menu_get` returns `catalog`, `categories`,
`fulfillmentModes`, and `items`; `cart_get` returns `cart`,
`pendingCustomerChoice`, and `nextStep`; `checkout_select_payment` returns
`payment: { method, status }`. Preserve those field names when recording real
executions. Values can evolve with the catalog, so collect them from a fixture
or a controlled runtime rather than writing them by hand.

For a recoverable invalid call, use AIRI's native Agent result:

```json
{
  "ok": false,
  "error": "Choose dine-in or take-out before starting checkout.",
  "recovery": "Ask the customer whether this order is dine-in or take-out. Then call order_set_fulfillment before retrying checkout_start."
}
```

### Checkout state machine to encode

```text
cart reviewed + explicit consent
  -> order_set_fulfillment(dine-in|takeout)
  -> checkout_start({ confirmedByUser: true })
  -> membership scan by hardware OR checkout_skip_membership({ confirmedByUser: true })
  -> checkout_choose_invoice(carrier|donation)
     OR checkout_request_tax_id -> checkout_set_tax_id(8 digits)
        -> user says displayed value is correct
        -> checkout_confirm_tax_id({ confirmedByUser: true })
  -> checkout_select_payment(card|mobile)
  -> physical terminal, outside the Agent tool surface
```

`confirmedByUser: true` is valid only after an explicit user statement in the
preceding conversation. Silence, a prior unrelated confirmation, or a model's
own suggestion is not consent. When payment is `pending` or `uncertain`, train
the model to stop: it must not cancel checkout, clear the cart, select another
method, retry payment, or claim completion.

### Required JSONL episode shape

One line is one full scenario, with intermediate results included. This lets a
trainer derive provider-specific chat templates later without losing tool-state
ground truth.

```json
{
  "id": "airi-order-menu-add-then-checkout-001",
  "toolset": "airi-order-menu-agent-v0.2",
  "initialState": {
    "catalogFixture": "<fixture revision>",
    "cart": { "lines": [], "fulfillmentMode": null, "total": 0, "itemCount": 0 },
    "checkout": null
  },
  "turns": [
    { "role": "user", "content": "我要兩份蝦捲，內用。" },
    { "role": "assistant", "toolCall": { "name": "menu_get", "arguments": { "query": "蝦捲" } } },
    { "role": "tool", "name": "menu_get", "value": { "items": ["<record actual result>" ] } },
    { "role": "assistant", "toolCall": { "name": "order_add_item", "arguments": { "itemId": "<ID from immediately preceding result>", "quantity": 2 } } },
    { "role": "tool", "name": "order_add_item", "value": { "cart": "<record actual result>" } },
    { "role": "assistant", "toolCall": { "name": "order_set_fulfillment", "arguments": { "mode": "dine-in" } } },
    { "role": "tool", "name": "order_set_fulfillment", "value": { "cart": "<record actual result>" } },
    { "role": "assistant", "content": "已加入兩份並設為內用。您確認要依目前購物車結帳嗎？" }
  ],
  "labels": ["successful", "id-grounded", "no-checkout-consent-yet"]
}
```

The literal placeholders above are instructions to the data generator, not
model targets. Replace them with recorded runtime values before training.

### Minimum scenario matrix and acceptance rules

Generate balanced variants of these scenarios, in Traditional Chinese, with
natural paraphrases and disfluencies appropriate to voice Kiosk use:

1. Query a named dish; choose only an `item.id` returned by that query.
2. Ask for a default recommendation and ask for a preference-bound recommendation.
3. Add a fully specified item in one `order_add_item` call; add a partially
   specified item by asking the missing required customization first.
4. Inspect, edit quantity/option, and remove a cart line using an actual
   `cart.lines[].id`; include the same-item-two-lines clarification case.
5. Clear a cart only after explicit user wording; include refusal when consent
   is absent.
6. Complete each allowed checkout branch: skip membership + donation; scanned
   carrier; and tax ID entry plus a separate spoken confirmation.
7. Include blocked cases: checkout before fulfillment, malformed tax ID,
   choosing a carrier without a scan, cancellation while payment is pending or
   uncertain, and false claims that a terminal payment succeeded.

Reject any episode that exposes `kiosk_*` to the conversational Agent, uses an
ID not grounded in an earlier result/current initial state, sends a tool call
after an unresolved explicit confirmation question, or lets the Agent cross the
physical scan/payment boundary. These are behavioural correctness labels, not
mere formatting checks.
