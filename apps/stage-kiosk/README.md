# AIRI Kiosk

`@proj-airi/stage-kiosk` is the full-screen, touch-first AIRI surface for a restaurant kiosk. It shares the existing AIRI stores, voice pipeline, LLM tools, and independent `@proj-airi/order-menu` service; it only owns the kiosk-specific screen composition.

Use it for customer-facing horizontal or vertical kiosk displays. Do not use it as a replacement for the normal settings-oriented `stage-web` application.

## Run

Start the menu service, then the kiosk:

```sh
pnpm --filter @proj-airi/order-menu dev
pnpm --filter @proj-airi/stage-kiosk dev
```

The layout follows the display orientation by default. Set `VITE_KIOSK_ORIENTATION=landscape` or `portrait` to lock a deployment to one orientation.

## Registered interactive pages

The Kiosk can host multiple customer interaction pages while keeping ordering as
its primary flow. In administrator mode, open **互動服務** to add or edit the
local allow-list. Each entry must have an enabled switch, stable ID,
customer-facing name, iframe URL, and a description that tells AIRI when it may
open that page. Disabled or incomplete entries are not embedded and are never
made available to the Agent, so a customer message cannot open an arbitrary URL.

`restaurant-ordering` is the initial page. Use `VITE_ORDERING_SCENARIO_URL` to
configure its deployed URL; it defaults to `http://localhost:5174` locally.

## Anonymous customer sessions

Each customer starts an anonymous Kiosk session when they touch the screen, type a message, speak, or operate the menu. The session owns only that customer's conversation and cart:

- After 45 seconds without customer activity, the kiosk asks whether help is still needed.
- After 60 seconds without activity, it clears the conversation and menu, then returns to standby.
- After a simulated order is confirmed, it displays completion for 10 seconds before starting a clean standby session.
- In administrator mode, use **結束目前接待** to immediately clear the current customer's data.

This is intentionally separate from AIRI's general chat history. The current version has no membership identity; a later member lookup can attach an identity to the same Kiosk session lifecycle without retaining anonymous conversations.

## Administrator mode

The visitor experience does not display settings. Long-press the `AIRI 餐飲服務員` label for 1.2 seconds, then enter the PIN configured before starting the kiosk:

```bash
VITE_KIOSK_ADMIN_PIN='choose-a-private-pin' pnpm --filter @proj-airi/stage-kiosk run dev
```

Administrator mode can switch an already configured chat provider and model, choose the microphone, enable or disable voice input, and pause the avatar for calibration. Provider credentials and API keys remain outside the public kiosk configuration surface.

`VITE_KIOSK_ADMIN_PIN` is an on-device guard against accidental customer access, not a replacement for server-side administrator authentication: Vite exposes `VITE_` values to the browser bundle. Production deployment should place provider credentials in a protected management service rather than relying on this PIN alone.
