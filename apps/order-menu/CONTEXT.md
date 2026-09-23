# Ordering domain glossary

- **Menu item**: A sellable menu definition. It has a stable id, base price, category, image, and option groups.
- **Selection**: The in-progress configuration of one menu item before it enters a cart.
- **Cart line**: An immutable snapshot of a selection plus its quantity. It is the unit that can be removed from a cart.
- **Order draft**: The mutable cart the customer reviews before confirmation.
- **Submission receipt**: The authoritative result of submitting a confirmed order. It carries the environment (`test` or `live`) and outcome (`accepted`, `rejected`, or `uncertain`); only an accepted live receipt permits a customer-facing claim that the order reached the POS.
- **POS Bridge**: The server-owned boundary that exposes a supplier-neutral menu query and order-submission contract to Order Menu. It owns POS credentials, idempotency, timeout policy, and conversion of vendor responses into menu data or a submission receipt.
- **POS adapter**: A vendor-specific implementation behind the POS Bridge. It may obtain menu, price, and availability from a POS, but it must not expose vendor response shapes to the customer UI or WebMCP.
- **Availability**: Whether an item can be ordered at this moment. It is distinct from inventory: exact stock is only exposed when the POS can provide it reliably.
