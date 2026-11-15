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
- Shows a host loading indicator while a new native document loads, keeping the
  native View hidden through resize/visibility updates until the current document
  finishes loading. Website-initiated navigation returns `loading` from placement
  updates even when an earlier `loadURL` promise has already settled.
  Navigation/load-failure events own that state; a late aborted `loadURL`
  promise cannot mark a newer successful page failed or hide it again.
  Failed loads show the existing staff-facing error. This initial-document state
  does not claim that PB's later asynchronous menu requests have finished.
- Emits owned navigation revisions for later full-page loads as well, including
  table Start and reload. Kiosk revokes old tool handles during loading and
  rediscovers the new document without replaying operations. Update native
  preload and Kiosk UI together for this contract.
- Reloading the trusted Host invalidates its previous native placement key, so
  its next placement loads the configured entry even when the new Host reuses
  the same service/revision. An old SPA menu/checkout URL is never adopted as
  the new entry; vendor cookies and unfinished cart data remain intact.
- Keeps host/device cookies separate from vendor service login partitions.
  Service identity plus origin select the vendor store inside this installation.
  Vendor account-based carts may still be shared upstream; test that separately.
- Allows one named, blank text-console child window from the trusted Kiosk.
  Vue moves its existing console into that window, above the native website;
  no second app, router or ordering session starts. Its title bar uses native
  dragging, and its collapse/reset controls retain the draft and trace. Closing
  it returns the console to the host row, with an explicit reopen action.
  Host and this owned popup can write plain text to the system clipboard;
  clipboard reads and vendor/iframe clipboard permissions remain denied. Copy
  handlers in teleported controls use their actual owner document.
  Other popups, child navigation and child desktop RPC are denied. Host reload
  or shutdown closes the owned popup. Vendor popup policy remains unchanged.

External pages have no preload, Node or raw IPC. HTTPS is required except for
loopback development. Cross-origin main-frame navigation, vendor popups, downloads and
vendor camera/microphone permissions are not enabled as part of this pilot. Only
the configured Kiosk main frame may request audio/video for existing speech and
presence features; OS consent and device/profile capture controls still apply.
Both Electron permission callbacks enforce this boundary. In-page
login at the service's origin is supported; LINE OAuth is not accepted yet.
Tool discovery confirms transport only. The reviewed member pickup site requires
a current vendor login inside this app's service partition; the reviewed current
and RD internal-use sites accept its verified cookie-buyer mode. Both use the shared
`pb-journey` scope and never grant automation to another store or origin merely
because it is PB. On the member site, a page-confirmed signed-out
state returns `sign-in-required` before dispatch, and Kiosk asks the operator to
sign in on this machine and submit a new request. It neither imports browser
cookies nor retries an operation automatically; unknown cart effects stay unknown.

PB product frames and the illustrative moving hand now render inside this
native surface. Operation frames, hand and label hide on finger release (about
150 ms after dispatch), independently of merchant verification; discovery frames
retain their display time. Hiding a cue does not cancel or replay an operation.
The existing remote Kiosk owns Jev/Main routing and the summary
above it. No additional controller, browser extension or OS mouse privilege is
required. After updating the PB bundle, rebuild and restart this pilot so the
native service loads the new implementation; ordinary Vite HMR updates only the
remote Host UI. Login remains in the same dedicated partition. The cart adapter
can normalize an identical single-row, same-price replacement to its equivalent
quantity change; it does not add then delete duplicate meals. Ambiguous groups
and changed prices remain blocked.

## Run locally

On this Ubuntu host, use **PB 測試管理** from the desktop/application menu; see
[the isolated PB test system](../../scripts/pbTest/README.md). It owns separate
API/data/static UI resources and an explicit Electron profile. Do not start the
ordinary Server `.env.local` as a test API: it points at the existing production
database. The manual Mac commands below describe the earlier pilot, not the
Ubuntu management workflow.

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
`KIOSK_TEST_PORTRAIT=1` now requires and asserts an actual 1080×1920 Host content
viewport. A laptop screen can clamp native bounds; use a sufficiently large test
display. On Ubuntu with Xvfb installed, run the same disposable fixture on its
own display so it cannot take the operator's keystrokes:

```bash
xvfb-run -a -s '-screen 0 1280x2200x24 -nolisten tcp' \
  env ESGPB_ELECTRON_PATH=/path/to/inspected/electron KIOSK_TEST_PORTRAIT=1 \
  node scripts/verifyKioskDesktop.mjs
```

The native vendor region is smaller than the Host because the Host reserves its
own controls; the fixture prints that actual viewport too. These test options do
not configure deployment or prove the physical kiosk's layout/input acceptance.

For the complete built Host with the local PB test API and its configured real
Jev/Main providers, start `scripts/pbTest/manage.py` and the existing
`test-sites/pb-order-lab/start.sh` fixture, then run:

```bash
xvfb-run -a -s '-screen 0 1280x2200x24 -nolisten tcp' \
  env ESGPB_ELECTRON_PATH=/path/to/inspected/electron \
  node scripts/verifyKioskOrdering.mjs
```

The Electron launcher is a synthetic test host: Playwright implicitly supplies
`--no-sandbox`, and Xvfb uses software WebGL. It is not normal sandbox acceptance.
For the normal systemd/user-service launch, use a separately enrolled disposable
profile with a loopback CDP port, then set `PB_AUDIT_CDP=http://127.0.0.1:PORT`
instead of `ESGPB_ELECTRON_PATH`. Attach before enrollment: the runner installs
loopback-only request interception and blocks WebSockets before any merchant
surface opens. Never attach this runner to an operator's existing device/profile.
Stop that temporary service and close its CDP port afterward.

This runner enrolls a disposable device/profile against the local API and retains
its synthetic conversation records. It uses the currently published prompts and
real configured models, so provider requests may incur charges. Merchant-origin
requests are intercepted by the loopback fixture; unknown external sessions fail
closed. No operator browser storage is reused. It checks table equivalence,
questions, delta/final quantities, dumpling configuration, three-dish cues,
search cancellation, carrier-preserving cart edits and idle return to table entry.
The runner uses real time, including the three-minute idle wait and fifteen-second
countdown. `PB_AUDIT_ACCELERATE_IDLE=1` installs a Playwright clock for the Electron
browser context and advances the final idle wait. This affects all its renderer
pages and may distort native movement and request timing; do not use that mode
for latency claims or final native-scroll acceptance. The API/models stay real.
The report is written to
`/tmp/pb-ordering-audit.json`; physical audio, merchant submission and payment are
outside this runner's coverage. `PB_AUDIT_SCENARIO=recommendation`, `search` or
`cart` selects focused journeys; each also checks idle return and the next
visitor's fresh table selection.
`PB_AUDIT_SCENARIO=reset` replaces the idle wait with the actual customer restart
button; its result proves manual restart, not the idle countdown.
`PB_AUDIT_SCENARIO=idle` separately checks a meal request is discarded during
the idle question without extending its countdown, a semantic continue keeps
the current menu, and semantic end yields an actual `session:end` decision
before returning to table entry. It starts a fresh reception between the first
two cases rather than spending one fifteen-second deadline on two model calls.
This longer journey requires real time and rejects `PB_AUDIT_ACCELERATE_IDLE=1`:
browser-only acceleration makes Server continuation expiry disagree with the
Host clock. Realigning Date during network calls also invalidates the original
idle deadline, so it cannot provide acceptance evidence for this journey.

A native renderer exit publishes a failed navigation and revokes tool admission.
It cannot stay in loading indefinitely or resume merchant actions on its own;
pending/unknown effects still require their existing reconciliation policy.

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
verified `displayUpdated=true`. That earlier pilot used the previous preserved-cart
reset policy: prior dialogue was cleared, login/cart retained and new visitors
blocked from editing an unfinished old cart. The current reception-end policy
instead clears unfinished rows with PB's native **清空** button and verifies empty
before the next visitor; it retains the document/login. The network-intercepted
portrait fixture covers this new policy, including exactly one click and replay
deduplication. Live acceptance of this changed policy is still an operator check.
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
cart-effect checks then run on a restored fixture state. Reception-end coverage
also holds a synthetic clear response while a real pointer click targets the
covered native button: it must be blocked, no hand may appear, the loading cover
must remain through return navigation and disappear only after settlement.

Browser+Companion and Electron are retained as separate hosts sharing ordering
logic; this native relay does not ship a production browser Companion. Windows
installer/signing/update, upstream shared-cart isolation and persistent crash
reconciliation remain separate gates. Audio source selection remains independent;
no native audio SDK or microphone assumption is introduced here.

The plan, remaining confirmation/account policies and Windows acceptance are in
[`docs/plans/2026-10-28-windows-kiosk-electron.md`](../../docs/plans/2026-10-28-windows-kiosk-electron.md).
