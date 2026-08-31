# Ordering domain glossary

- **Menu item**: A sellable menu definition. It has a stable id, base price, category, image, and option groups.
- **Selection**: The in-progress configuration of one menu item before it enters a cart.
- **Cart line**: An immutable snapshot of a selection plus its quantity. It is the unit that can be removed from a cart.
- **Order draft**: The mutable cart the customer reviews before confirmation.
- **Order submission adapter**: The seam that submits a confirmed draft. The MVP uses an in-memory adapter; POS or kiosk adapters can replace it later.
