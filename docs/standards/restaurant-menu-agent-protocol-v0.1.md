# Restaurant Menu Agent Protocol (RMAP) v0.1 — Minimal Draft

## Status

RMAP is an AIRI internal contract for menu websites and ordering agents. It is
not an industry standard or a promise of long-term external compatibility yet.
The purpose of this draft is to make the current ordering MVP understandable
and replaceable without deciding future POS, payment, delivery, or identity
requirements too early.

## Scope

RMAP v0.1 standardizes only the actions needed to build and review a restaurant
order. It does not standardize:

- Payment or refund flows.
- POS or inventory integrations.
- Customer identity, addresses, delivery, discounts, or loyalty programs.
- A required animation, framework, transport, or deployment model.

The menu UI remains responsible for making actions visible. How it highlights,
scrolls, or animates is an implementation choice.

## Core tool names

Tool names use lowercase ASCII and underscores for broad function-calling
compatibility.

| Tool | Input | Result |
| --- | --- | --- |
| `menu_get` | Optional `categoryId` | Available items, prices, and options. |
| `menu_select_item` | `itemId` | Current selection. |
| `menu_set_item_option` | `groupId`, `valueId` | Updated current selection. |
| `menu_set_quantity` | `quantity` | Updated current selection. |
| `cart_add_item` | None | Added cart line and updated cart. |
| `cart_remove_item` | `cartLineId` | Updated cart. |
| `cart_get` | None | Current cart and total. |
| `order_confirm` | `confirmedByUser: true` | Order result. |

`menu_get` and `cart_get` are read-only. The other tools modify the menu's
order draft. `order_confirm` in the current MVP creates a simulated order; it
does not imply POS submission.

## Shared concepts

- **Menu item**: A purchasable item with a stable `itemId`, name, price, and
  zero or more option groups.
- **Selection**: One item being configured before it is added to the cart.
- **Cart line**: One completed selection in the cart, identified by
  `cartLineId`.
- **Cart**: The current order draft, including lines, item count, and total.

IDs are opaque values supplied by the menu service. An agent must use IDs it
receives and must not invent them.

## Agent rules

1. Call `menu_get` before selecting an item.
2. Finish one selection with `cart_add_item` before beginning the next item.
3. Call `cart_get` and state the order summary before asking to confirm it.
4. Call `order_confirm` only after the customer explicitly agrees.
5. Never invent unavailable menu items, option values, prices, or totals.

## Visible-operation requirement

When an Agent calls a mutating tool, the menu UI must visibly reflect the
action. At minimum it updates the relevant item, selection, or cart; it should
also highlight the target and bring it into the customer-visible viewport.
No particular cursor effect or event payload is required by RMAP v0.1.

## Safe evolution

RMAP remains easy to change by following these rules:

- Add optional fields or new optional tools without changing existing tool
  meanings.
- Do not rename a published core tool or change a required input field in
  place; publish a new version instead.
- Keep restaurant-specific additions prefixed with `x_`, for example
  `x_delivery_slot_get`.
- Promote an extension to core only after at least two independent menu
  implementations need the same behaviour.

## Future extensions

When a real POS or payment integration is required, define it as a separate
extension. A future `confirmation_token` extension may replace the MVP
`confirmedByUser` boolean with host-issued approval evidence. Neither is part
of RMAP v0.1.

## AIRI mapping

The current AIRI menu MVP uses the RMAP names directly. Native WebMCP and the
iframe bridge are transports; both carry this same contract.
