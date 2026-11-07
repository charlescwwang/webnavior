# Webnavior Kiosk Desktop

Windows-oriented Electron host for the existing `apps/stage-kiosk` web UI and
its configured interactive website. This is a local pilot, not a signed Windows
release. It does not include the pet desktop's windows, widgets or game engine.

## What works

- Loads the existing Kiosk URL with a narrow Eventa preload capability.
- Relays validated discovery/execution/inspection envelopes for the approved PB
  menu to the same PB service implementation used by the browser pilot. The
  shared Kiosk client retains document, descriptor and lost-receipt checks.
- Loads its bundled PB adapter only in an isolated world of the native page.
  Vendor main-world code receives no preload, raw IPC, Node or arbitrary evaluator.
  Wrong service/document ownership and navigation outside the PB menu reject calls.
  Resize/visibility updates do not renew a tool binding or replay an operation.
- `ScenarioSurface` uses a native `WebContentsView` when that capability exists;
  ordinary browser Kiosk keeps its iframe path.
- Uses the current service URL from the existing interaction profile. A Server
  Profile still arrives through the existing bootstrap/apply path; this pilot
  does not add live publication polling. Publish in Admin, then reload the idle
  device to fetch the new release. Do not reload an unresolved transaction.
- Tracks the real DOM region's bounds, hides the native View for host settings
  and modal overlays, and forwards document-scoped input activity to Kiosk.
- Keeps host/device cookies separate from vendor service login partitions.
  Service identity plus origin select the vendor store inside this installation.
  Vendor account-based carts may still be shared upstream; test that separately.

External pages have no preload, Node or raw IPC. HTTPS is required except for
loopback development. Cross-origin main-frame navigation, popups, downloads and
vendor camera/microphone permissions are not enabled as part of this pilot. Only
the configured Kiosk main frame may request audio/video for existing speech and
presence features; OS consent and device/profile capture controls still apply.
Both Electron permission callbacks enforce this boundary. In-page
login at the service's origin is supported; LINE OAuth is not accepted yet.

PB product frames and the illustrative moving hand now render inside this
native surface. The existing remote Kiosk owns Jev/Main routing and the summary
above it. No additional controller, browser extension or OS mouse privilege is
required. After updating the PB bundle, rebuild and restart this pilot so the
native service loads the new implementation; ordinary Vite HMR updates only the
remote Host UI. Login remains in the same dedicated partition. The cart adapter
can normalize an identical single-row, same-price replacement to its equivalent
quantity change; it does not add then delete duplicate meals. Ambiguous groups
and changed prices remain blocked.

## Run locally

Use the repository's Node 24.22.1 and install with the workspace lockfile. Start
the existing Kiosk and API normally. Build this host (this also bundles the shared PB service into `out/service/pb.js`):

```bash
pnpm -F @proj-airi/stage-kiosk-desktop build
```

Launch with an inspected Electron executable. On this development Mac:

```bash
KIOSK_DESKTOP_WINDOWED=1 \
  KIOSK_DESKTOP_USER_DATA="$HOME/.webnavior/kiosk-desktop" \
  /tmp/airi-esgpb-electron-alpha2-verified/Electron.app/Contents/MacOS/Electron \
  apps/stage-kiosk-desktop/out/main/index.js
```

The separate runtime was verified against official SHA256 metadata. Its alpha
version is for local feasibility only; the app currently pins embedded Node to
24.22.1 to reject the workspace's older Electron binary before loading content.
Reassess that pin against current upstream security releases before production.
Do not use `pnpm start` with the old catalog runtime and assume it is patched.

| Setting | Meaning |
| --- | --- |
| `KIOSK_DESKTOP_URL` | Trusted Kiosk base directory, default `http://localhost:5169/kiosk/`; must end in `/` before query/hash |
| `KIOSK_DESKTOP_WINDOWED=1` | Ordinary resizable pilot window; otherwise Electron Kiosk display mode |
| `KIOSK_DESKTOP_USER_DATA` | Explicit isolated pilot profile directory; normal use has its own app profile |

The window starts at 1080×1920 before the OS applies display/work-area limits;
Kiosk mode fills the connected display. Login is local to this installation's
service partition: manually sign into PB once in the displayed native surface.
Firefox/Chrome cookies are not imported. Persistence does not prevent PB from
expiring or revoking its own session.

Windows can launch the same built main entry with a suitable Electron runtime.
A Windows installer, signing/update channel and OS lockdown configuration are
later milestones. Installing Electron does not automatically migrate an Edge
Assigned Access policy or copy Chrome's device registration and login cookies.
Operators enroll/login locally for this pilot. Do not put account passwords in
these settings or in a Profile.

## Checks

```bash
pnpm -F @proj-airi/stage-kiosk-desktop test:run
pnpm -F @proj-airi/stage-kiosk-desktop typecheck
VITEST_BROWSER_CHANNEL=chrome pnpm -F @proj-airi/stage-kiosk exec vitest run \
  --config vitest.browser.config.ts src/components/NativeServiceSurface.browser.test.ts \
  src/components/ScenarioSurface.browser.test.ts
ESGPB_ELECTRON_PATH=/path/to/inspected/electron node scripts/verifyKioskDesktop.mjs
```

Set `KIOSK_TEST_VIDEO_DIR` to retain the smoke test's synthetic page recordings.
`KIOSK_TEST_PORTRAIT=1` requests a taller window, but macOS may constrain it to
the available screen: use the printed native viewport dimensions as evidence,
not the requested window size. These test options do not configure deployment.

The Electron check uses only disposable loopback fixtures. It checks real IPC,
View visibility, storage isolation, reload sequencing and remote privilege
isolation. Browser tests exercise actual Vue geometry and overlay lifecycle.
The Eventa beta.8 type patch narrows its renderer transport to the methods used
by its runtime; it does not add removed Electron APIs to an application mock.

## Scope

Use this host for the existing Kiosk plus a native website and the PB-only finite
control pilot. Owned Menu native protocol, generic sites, order submission/payment,
formal Companion authorization and native microphone-array capture are outside
this implementation. Native display or retained login alone is not proof of an
accepted Agent order.

The Mac Electron test intercepts the approved PB URL with a synthetic document;
it performs visible search using the real isolated-world service, checks receipt
identity/deduplication/inspection, rejects stale ownership/arbitrary code and rejects
calls after leaving the approved menu. It makes no merchant requests or account
login. A separate actual Mac pilot has completed manual PB login, device/login
retention across app restarts, natural Agent menu/price queries, paid-rice additions
(one meal and two meals each with one rice option), quantity changes preserving
options, and an explicit meal removal. Latest add, quantity and cleanup receipts
verified `displayUpdated=true`. Customer reset cleared prior dialogue, preserved
login/cart, and prevented a new visitor from editing an unfinished old cart.
Authorized test cleanup left an empty cart. Filtered actual evidence is saved at
`output/playwright/pb-electron/acceptance.json`.
No order was submitted or paid. Physical ASR, microphone arrays and Windows release
acceptance remain separate. Chrome/Firefox private login profiles are not copied.

The native smoke test also uses synthetic audio/video devices without bypassing
permission UI policy. It verifies trusted-host capture and vendor denial, an old
pagehide cleanup racing with host reload, and complete PB catalog/cart reads from
declared route data when no vendor `route()` global exists. It verifies visible
cart refresh after delayed Vue rendering, including PB's absent empty-cart footer.
Verified effects retain their receipt if display refresh fails and must not be
replayed. It never contacts PB.
It also withholds a passive cue's catalog response and verifies that a required
cart read completes within 1.5 seconds before that response is released. The cue
settles as cancelled, with no vendor writes; existing movement/reset and accepted
cart-effect checks then run on a restored fixture state.

Browser+Companion and Electron are retained as separate hosts sharing ordering
logic; this native relay does not ship a production browser Companion. Windows
installer/signing/update, upstream shared-cart isolation and persistent crash
reconciliation remain separate gates. Audio source selection remains independent;
no native audio SDK or microphone assumption is introduced here.

The plan, remaining confirmation/account policies and Windows acceptance are in
[`docs/plans/2026-10-28-windows-kiosk-electron.md`](../../docs/plans/2026-10-28-windows-kiosk-electron.md).
