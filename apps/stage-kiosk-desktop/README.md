# Webnavior Kiosk Desktop

## Ordering guidance

This portable test release requires the matching Kiosk frontend and Server policy
release. It includes table return, menu placement, recommendation tours without
floating action labels, invoice focus and the LINE Pay-only kiosk policy. The
frontend provides plain-language dumpling piece questions and a spoken
“取消這題” escape for unfinished selections. Existing ordering defaults,
connection settings and user profiles are preserved. Physical Windows acceptance
and same-page off-hours submission rejection detection remain unverified.

## Pre-image release candidate

Git tag `kiosk-v0.7.8-rc.1` preserves the source before webpage screenshot
recognition. `kiosk-v0.7.8-rc.2` adds shared PB read validation across native,
Fast Path and Main: missing cart rows or required catalog data cannot become
empty-cart/menu facts or reach ordering actions. Catalog-free navigation remains
supported. See the [RC2 record](../../docs/releases/kiosk-v0.7.8-rc.2.json) for
checks and pending acceptance; the [RC1 record](../../docs/releases/kiosk-v0.7.8-rc.1.json)
remains unchanged.

Both are candidate checkpoints. The retained portable archive reports `0.7.8`
and does not contain RC2. RC2 has a successful Electron compilation but no new
Windows package or deployment. Physical acceptance is still pending. Future fixes
receive a new RC tag; existing tags are never moved. Image features remain separate.

## November master audio restored (0.7.8)

Electron remains the kiosk host. Audio returns to the November master's
Chromium microphone acquisition and actual-channel routing: eight-channel
Spatial Mask or ordinary browser speech processing. Hush, Python capture,
native audio IPC and the utility-process experiment are removed. LCMV was
only a comparison path in this baseline. Current PB native operations and
spoken tax-ID fill remain available. Replace the complete executable package
and load the matching frontend. See [audio/README.md](audio/README.md).

## Connection settings

Every portable launch offers the entries from the operator-owned
`kiosk.settings.json` beside the EXE. The shipped default is on-site LAN
`http://172.17.69.17:5169/kiosk/`, alongside Tailscale
`http://100.92.1.80:5169/kiosk/` and the existing public HTTPS domain.
`kioskUrl` must match one entry and selects the highlighted choice; cancel exits.
There is no automatic failover during a customer order. Each origin retains its
own device enrollment; the existing Windows user-data directory is preserved.

Change `connections[].label` / `connections[].url` and the default `kioskUrl`,
then fully restart the EXE. No rebuild is required for a changed address. Use the
new sample configuration instead of copying a pre-0.4.1 settings file. Startup
rejects missing/duplicate entries, credentials, non-Kiosk paths and invalid URLs.
The source of package defaults is [kiosk.settings.example.json](kiosk.settings.example.json).

HTTP exceptions are exact origins from that local launch list, installed
synchronously before Electron's ready event so media and AudioWorklet APIs are
available. They do not grant native capabilities or media to merchant pages.
The server independently reads `KIOSK_TRUSTED_ORIGINS` for Kiosk CORS, PIN, POS
and HTTP device/PIN cookies. It defaults to the two shipped HTTP origins.
Changing the EXE file cannot change the server allowlist; update the server
configuration and restart its API when changing deployment addresses.

Port 5169 serves Kiosk and proxies `/api/` to loopback 5168; the built Kiosk
uses its selected entry origin for API calls and character assets. The public
HTTPS management shortcut is retained. An ordinary browser does not inherit
the EXE's HTTP secure-context grant; browser audio/video backup uses HTTPS.
Both PB entries still use the Site's public HTTPS simulator; merchant PB uses
the EXE's native adapter. This release does not make PB or model services offline.

## What works

- Loads the existing Kiosk URL with a narrow Eventa preload capability.
- Relays validated discovery/execution/inspection envelopes for the approved PB
  menu to the same PB service implementation used by the browser pilot. The
  shared Kiosk client retains document, descriptor and lost-receipt checks.
- Loads its bundled PB adapter only in an isolated world of the native page.
  Vendor main-world code receives no preload, raw IPC, Node or arbitrary evaluator.
  Wrong service/document ownership rejects calls. Menu/cart controls stay restricted
  to editor pages; reviewed same-store order result pages allow discovery/inspection
  and the Host-only `browser_state_get` reader, with no automatic payment or editor writes.
  The native PB enhancement leaves only same-order LINE Pay links selectable on
  payment selection. Credit cards are disabled with an inline kiosk-support notice;
  native cancellation remains available. It never selects or initiates payment.
  Resize/visibility updates do not renew a tool binding or replay an operation.
- `ScenarioSurface` uses a native `WebContentsView` when that capability exists;
  ordinary browser Kiosk keeps its iframe path.
- Uses the current service URL from the existing interaction profile. A Server
  Profile still arrives through the existing bootstrap/apply path; this pilot
  does not add live publication polling. Publish in Admin, then reload the idle
  device to fetch the new release. Do not reload an unresolved transaction.
- Tracks the real DOM region's bounds, hides the native View for host settings
  and modal overlays, and forwards document-scoped input activity to Kiosk.
- Keeps the native website visible during table Start, refresh, initial loading
  and resize. There is no Host loading indicator or renderability visibility
  gate. Navigation readiness still revokes tools until `did-finish-load`; it
  does not hide the website or replay actions. Explicit settings/modal ownership
  and actual load/crash failures retain their existing handling.
- Emits owned navigation revisions for later full-page loads as well, including
  table Start and reload. Kiosk revokes old tool handles during loading and
  rediscovers the new document without replaying operations. Update native
  preload and Kiosk UI together for this contract.
- Reloading the trusted Host invalidates its previous native placement key, so
  its next placement loads the configured entry even when the new Host reuses
  the same service/revision. An old SPA menu/checkout URL is never adopted as
  the new entry; vendor cookies and unfinished cart data remain intact.
- Private reception cleanup keeps the hidden website rendering during its Start
  and reset calls, so PB's outgoing loading mask can finish before target checks.
  It restores the prior background-throttling setting on success or failure,
  including overlapping maintenance calls. Reception cleanup normally remains
  visible without a maintenance overlay; explicit settings can still hide it.
  Ordinary customer calls do not change rendering policy or bypass hit tests.
- Version 0.6.8 handles PB's stacked coupon/announcement prompts through their
  real controls: defer the observed coupon before acknowledging the covered
  announcement. This was reproduced against production PB in actual Electron;
  coupon claiming and persistent promotion preferences are untouched.
- Keeps host/device cookies separate from vendor service login partitions.
  Service identity plus origin select the vendor store inside this installation.
  Vendor account-based carts may still be shared upstream; test that separately.
- Allows one named, blank text-console child window from the trusted Kiosk.
  Vue moves its existing console into that window, above the native website;
  no second app, router or ordering session starts. Its title bar uses native
  dragging, and its collapse/reset controls retain the draft and trace. Closing
  it returns the console to the host row, with an explicit reopen action.
  This works on both the public HTTPS entry and loopback development; an absent
  blank-page referrer does not block the trusted host's named console.
  Host and this owned popup can write plain text to the system clipboard;
  clipboard reads and vendor/iframe clipboard permissions remain denied. Copy
  handlers in teleported controls use their actual owner document.
  Other popups, child navigation and child desktop RPC are denied. Host reload
  or shutdown closes the owned popup. Vendor popup policy remains unchanged.

External pages have no preload, Node or raw IPC. HTTPS is required except for
loopback development and the selected LAN Kiosk entry. Cross-origin main-frame navigation, vendor popups, downloads and
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

Successful invoice selection and checkout field guidance also transfer native
keyboard focus to the visible merchant input. DOM focus alone cannot receive
a scanner while the Host WebContents owns the keyboard. Passive reads, hidden
views and an unfocused Kiosk window do not take native focus.

Manual **重新開始** in 0.6.9 initializes the Host even when the previous
PB order or payment result is unknown. It retires our local warning, dialogue,
confirmation and visitor state, then renews the configured entry. It neither
checks nor clears/cancels/submits the merchant cart/order/payment; staff handle
PB's remaining state in its native UI. The ending visitor's operation history
retains the unresolved result and the local retirement event. Automatic idle
and confirmed-completion cleanup retain their existing verified behavior.

## Windows remote build and launch

For a clean Windows 10/11 machine, use [the Windows bootstrap and remote connection guide](../../scripts/windows/README.md).
`scripts/windows/kiosk.cmd` provides Setup, Build, Tunnel, Doctor, Start and Smoke.
It installs verified private Node/Electron runtimes and pinned pnpm, builds the
native PB bundle plus main/preload, and keeps all model credentials on the remote
Ubuntu server. Connection settings are in ignored `kiosk.windows.local.json`;
Windows device enrollment and vendor login belong to its new local profile.
The SSH default preserves the current loopback origin and forwards the owned test
site too. Linux clean-dependency build and PowerShell boundary tests are verified;
Windows installation, hardware and full customer acceptance remain to be run there.

## Automatic load diagnostics

Version 0.6.7 records Host and PB loading in
`%LOCALAPPDATA%\Webnavior\Kiosk-Pilot\diagnostics` automatically. Preserve
`current.jsonl`, `previous.jsonl` and `older.jsonl` after a slow incident, together
with its local time. Each file is limited to 4 MiB. This recorder is independent
of visitor reset, Host reload and the server connection; it adds no loading UI,
refresh or merchant action. It does not upload these files automatically.

Records include navigation/DOM/full-load phases, request start/first response/
completion/failure, outstanding requests, cache status, declared tool timing,
renderer long tasks, app process CPU/working set, system free memory and Main
timer lag. Domain and resource kind replace URL paths and query strings. Headers,
bodies, console text, customer fields and camera/audio content are excluded.
Model records accept only a fixed numeric envelope: avatar, VAD, camera initialization
and slow camera inference. The current browser audio does not launch native model/capture processes.

The first-response interval includes connection, network and server wait; it
does not separately measure DNS/TLS. Worker requests without a frame identity
are explicitly attributed to the private session. A pending renderer probe can
mean an unfinished page load or a busy renderer, and alone proves neither a
network failure nor a freeze. Electron process statistics exclude external
Python/provider processes; GPU-process CPU is not GPU utilization. Bounded
queues drop diagnostic records on overload or disk failure without stopping
ordering. The latest unflushed second may be lost on a crash.

`scripts/verifyKioskDiagnostics.mjs` tests held local responses, network failure,
real renderer long tasks, model events, privacy and retained native visibility.
It never contacts PB. `diagnostics.test.ts` checks rotation, queue bounds,
shutdown and disk-error containment.

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
formal Companion authorization are outside this implementation. Native
microphone-array capture is covered by the bundled audio frontend above. Native display or retained login alone is not proof of an
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
also holds a synthetic clear response and checks that the native clear button
remains exposed to pointer input, without a maintenance cover or hand animation.
The single clear is verified empty before return navigation; replay remains
deduplicated.

Browser+Companion and Electron are retained as separate hosts sharing ordering
logic; this native relay does not ship a production browser Companion. Windows
installer/signing/update, upstream shared-cart isolation and persistent crash
reconciliation remain separate gates. Audio source selection remains independent;
Windows UMA-8 RAW offers the existing path and the experimental bundled frontend
described above.

The plan, remaining confirmation/account policies and Windows acceptance are in
[`docs/plans/2026-10-28-windows-kiosk-electron.md`](../../docs/plans/2026-10-28-windows-kiosk-electron.md).


### Order evidence queue implementation status

`src/main/orderEvidenceSpool.ts` is a tested private filesystem component for
already registered, sanitized order evidence. It commits file and directory
flushes before enqueue returns, recovers pending records after restart, isolates
corrupt records during upload, and removes a record only after an exact durable
Server ACK. It never submits a merchant order or adopts a newer visitor.

This module is not yet instantiated in the Desktop capture lifecycle. The full
capture/operation registration/upload pipeline, offline unassociated evidence,
full-document navigation observation, capacity policy, backups and Windows
power-loss behavior remain outside the completed runtime scope. See the leading
implementation status in `docs/plans/2026-10-28-windows-kiosk-electron.md`; unit
filesystem tests are not whole-system archival acceptance.

## Windows portable distribution

The compiled main process bundles its JavaScript dependencies. The portable Windows x64
ZIP places these outputs in the official pinned Electron runtime; no Node/pnpm setup is
needed on the target. A packaged app reads `kiosk.settings.json` next to its executable
and validates the approved Kiosk URL, window mode and diagnostic port before opening a page.
Windows retains `%LOCALAPPDATA%\Webnavior\Kiosk-Pilot` across app-folder updates.
Development launches continue using the existing environment settings. See
[scripts/windows/README.md](../../scripts/windows/README.md) and the plain-language
[quick start](../../scripts/windows/portableQuickStart.txt). The package has no signing or
auto-update service; physical Windows validation remains necessary.

Desktop 0.6.11 adds the Host-only `browser_invoice_donation` draft capability for
confirmed 3–7 digit spoken donation codes. Carrier/citizen selection retains the
existing native keyboard handoff for keyboard-emulating scanners; no camera QR
decoder is installed. Use the complete new portable folder when testing this
capability; updating only the web frontend does not add a native tool.

Desktop 0.7.6 adds spoken tax ID entry and requires the native PB bundle with
`browser_invoice_tax` and deploying its matching Kiosk frontend. The Host owns
segmented collection and read-back consent; the native action fills only a
selected tax invoice's eight-digit draft. Updating only a web page cannot add
this capability to an older portable executable.

### Audio validation scope

The rollback is based on master `b1a7f5b` / microphone correction `326ff95`.
Real Chromium tests cover observed channel routing and microphone restarts.
A real Electron Main/preload test verifies a browser microphone, synthetic
eight-channel Spatial Mask, native PB child view and a 350 ms renderer task.
These checks are not physical Windows microphone or room-echo qualification.
No Python, Hush or native-array audio bridge remains in the portable payload.
