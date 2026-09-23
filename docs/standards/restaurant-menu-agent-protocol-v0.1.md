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
| `menu_get` | Optional exact `category` or free-text `query` | Available categories, items, prices, and options. |
| `menu_recommend` | Required `needs`, optional `limit` | At most three matching menu items. |
| `menu_select_item` | `itemId` | Current selection. |
| `menu_set_item_option` | `groupId`, `valueId` | Updated current selection. |
| `menu_set_quantity` | `quantity` | Updated current selection. |
| `order_add_item` | `itemId`, optional known `options` and `quantity` | Adds one fully specified item and returns the updated cart. |
| `cart_add_item` | None | Added cart line and updated cart. |
| `cart_remove_item` | `lineId` | Updated cart. |
| `cart_set_line_quantity` | `lineId`, `quantity` | Directly updates a cart line's quantity. |
| `cart_set_line_option` | `lineId`, `groupId`, `valueId` | Directly updates one cart line option; matching lines may merge. |
| `cart_clear` | `confirmedByUser: true` | Clears an unsubmitted cart and its fulfillment choice. |
| `cart_get` | None | Current cart and total. |
| `order_set_fulfillment` | `mode: 'dine-in' \| 'takeout'` | The order-level service mode. |
| `order_confirm` | `confirmedByUser: true` | Order result. |

`menu_get`, `menu_recommend`, and `cart_get` are read-only. The other tools
modify the menu's order draft. `order_confirm` requires a prior
`order_set_fulfillment` call and returns a submission receipt. The receipt
states the environment (`test` or `live`) and outcome (`accepted`, `rejected`,
or `uncertain`). Only an accepted live receipt implies POS submission.

## Shared concepts

- **Menu item**: A purchasable item with a stable `itemId`, name, price, and
  zero or more option groups.
- **Selection**: One item being configured before it is added to the cart.
- **Cart line**: One completed selection in the cart, identified by `lineId`.
- **Cart**: The current order draft, including lines, item count, and total.

IDs are opaque values supplied by the menu service. An agent must use IDs it
receives and must not invent them.

## Agent rules

1. Call `menu_get` before selecting or adding an item.
2. When the item, required options, and quantity are already known, prefer the single `order_add_item` call. The menu service still visibly presents its selection, customization, quantity, and cart updates.
3. Use the lower-level `menu_select_item` through `cart_add_item` sequence only when the customer needs to decide a required option in a separate turn.
4. Call `cart_get` and state the order summary before asking to confirm it.
5. Call `order_confirm` only after the customer explicitly agrees.
6. Set the customer-confirmed dine-in or take-out mode before confirming. A missing service mode is a deferrable pending choice: it must not prevent adding further requested items.
7. Never invent unavailable menu items, option values, prices, or totals.
8. After `order_confirm`, state only the outcome in its submission receipt. A
   rejected or uncertain result is not an order completion, and an accepted
   test result must not be described as reaching a real POS.
9. Before changing or removing a cart line, call `cart_get` and use its opaque
   `lineId`. Use `cart_set_line_quantity` and `cart_set_line_option` directly;
   do not remove and re-add a line merely to edit it.
10. Call `cart_clear` only after the customer clearly asks to cancel the entire
    in-progress order. It cannot resolve an uncertain POS submission.

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

The current AIRI menu MVP registers these tools through native WebMCP. The
deprecated iframe bridge is not a supported RMAP transport.
