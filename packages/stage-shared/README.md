# Stage Shared

Shared runtime-neutral contracts and Stage helpers. Import the owning subpath
instead of a renderer or Electron entrypoint when consuming a neutral contract.
Resolve these subpaths through the package's `exports`. A Vite prefix alias to
`src/` bypasses that map and breaks subpaths whose public and file names differ.

`ai-provider` exports the neutral `ChatResponseMode` contract and validation
schema for Provider settings and upstream policy. It does not own credentials,
network parsing, runtime selection or Kiosk presentation.

## External ordering conversation

`falcon-settings` owns the neutral connection-draft schema and public snapshot.
It carries no credential and grants no runtime activation. The Server stores
the encrypted key separately; the current editor permits legacy mode only.

`falcon-audio` encodes the documented single-second Falcon AP binary window:
25 as uint32 LE, 16000 finite Float32 LE audio samples, then 25 grayscale 96x96
mouth frames. `encodeFalconClip` uses the current deployed TypeScript server's
whole-clip format: a plain frame count, followed by 640 Float32 samples and
9216 grayscale bytes per frame (audio first, then all mouth frames). Engine
flags from the older ZIP are rejected; engine selection belongs to the service.
Synthetic 3-second and 15-second requests were accepted on port 8766. Neither
encoder invents tail padding or an ASR request protocol. These codecs are
preparatory; no active Kiosk
capture or provider routing is changed by importing it.

`pb-journey` owns the reviewed PB origin/store/flow policies shared by native
admission and the page adapter. Table/menu/cart pages share the canonical menu
owner key, preserving existing member-site ownership. `invoice-input` shares
the owned Menu's carrier/citizen format checks with PB; format acceptance does
not certify a government identifier or authorize order submission.

`interaction-media` matches audio only to one explicit transcript entry ID;
never use collection position, timestamps or the preceding activity as a join.
The caller must supply one visitor session's media. Ambiguous/missing links
return no match; retained originals remain independently inspectable.

`@proj-airi/stage-shared/browser-conversation` owns the external-ordering
conversation projection and model-facing PB tool guidance. It carries the current
catalog/configurations, owned cart, provided slots, unfinished dishes, pending
question and phase tool scope; it never grants write authority. Separate draft
lines preserve per-serving options and notes; nullable fields do not become
default quantities. Public business tools accept names and counts; Host resolves
native references and versions. Complete explicit purchases do not require a
second add confirmation. `answeredQuestion.answer` keeps the actual customer
reply; `selectedChoice` separately describes its resolved option. The current
utterance stays unchanged; prior verified questions/answers supply context, not
a fabricated combined user turn. The Host refreshes facts before every model round.
The model view states `currentActivity` in plain language and combines unfinished
items into `pendingItems`; it does not expose Host phase codes or question tickets.
It also carries the verified page role, current table name and offered table
names. Before table entry, no cart is supplied or assumed empty; only table
selection and conversation tools are admitted. Native navigation events carry
service/document ownership and monotonic revisions, never merchant URLs or input.
`customizationAvailability` distinguishes `none`, `available`, and `not_verified`;
an empty selected-options array is never evidence that the merchant has no options.
`ordering-tools` owns the 17 model-facing operation descriptions, JSON schemas,
native receipt-name mapping and page/task/cart filter. Public model projections
omit native product/row/option IDs and versions, retaining names, configuration
choices, quantities and website prices. `table-names` resolves A3/A03 to one
actual offered table and refuses ambiguous equivalent choices. Split tables such
as A3-1 and A3-2 retain every numeric segment; they never resolve to A3 or A31.
Native transport
validation remains in the owning adapter. Model-only receipts use `outcome` and
`cartEffect` with relevant repair facts; technical status envelopes and private
question tickets remain internal.
The shared `customerReplySchema` and `servicePolicyReplySchema` keep Main's
finite reply vocabulary aligned with Host validation. Service-policy topics
render localized limits without website effects or consuming a pending meal
question; food-safety guidance never claims staff were notified, and unsupported
transport, budget planning, discounts and price/payment overrides never become
operation receipts.
Durable receipts, Jev admission and Host ownership checks retain their contracts.
`pb-checkout` owns the neutral rendered invoice/contact snapshot and native
submission-dispatch acknowledgement. Public projections omit the confirmation
token; a dispatch is distinct from merchant acceptance and payment. The three
public checkout draft/guidance tools are limited to an editable cart/checkout
context, and native submission is never a Main capability. `pb-journey` permits
a correlated dispatch acknowledgement to retire into a same-store order-result
URL without granting tools on that result page.
`ordering-sites` also owns optional published `catalogLabels` and `labelCatalog`:
discovery aliases/categories join only to unique exact current product names.
They never change merchant identity, price, options or supply facts. Shared aliases
remain ambiguous; label changes follow the Host's merchant/customer lifecycle.
Server replaces bridge implementation prose with this contract and makes version
non-emptiness explicit; native argument and execution validation still apply. Use it for external
ordering adapters; the owned Menu retains `kiosk-conversation` and its own phases.

`@proj-airi/stage-shared/product-configuration` owns the neutral configuration
schema and selection types used by PB's adapter and conversation projection.
`stage-ui/services/pbProduct` retains configuration discovery, price calculation
and native preparation, rather than owning types needed by the neutral layer.

## Product discovery

`@proj-airi/stage-shared/product-discovery` owns literal catalog-fragment
discovery shared by the menu and external-service confirmation flows. It uses
observed names, merchant aliases and optional category labels; a discovered
fragment narrows candidate questions and never grants item identity or write
authority.

`productMentions` resolves full literal names and configured aliases. A shorter
label contained in a more specific mention does not introduce another dish
(A套餐 does not also select a dish with alias 套餐). Independent mentions and
identical shared aliases retain all targets; intent and purchase consent remain
the decision/execution flow's responsibility.

## Visible service operations

`@proj-airi/stage-shared/service-operation` owns document/operation/step evidence
for visible control actions, including finite target refs, ready/dispatch/finish
times, cancellation reasons and validated recovery diagnostics. Timings share an operation
clock; parallel durations must not be added. These execution records are not
model plans or purchase authorization.

## Ordering presentation

`@proj-airi/stage-shared/pb-menu-presentation` formats customer confirmations,
quotes and cart readback for the approved PB store. Empty customization is omitted;
actual options and notes remain. The observed 周氏水餃 item uses a spoken short
name and per-serving piece count only when its 64-dollar/eight-piece base and
8-dollar extra dumplings match the verified price. Changed/unknown configurations
retain serving units without inventing pieces. Original names/refs/selections remain
unchanged for discovery, native controls and write authorization. This store-specific
policy is not a general parser for minimum notices on other ordering sites.
The same module converts explicit dumpling `piecesPerServing` into extras from
the confirmed eight-piece base; live option limits/prices remain executor-owned.
Its closed literal parser is shared by Jev compilation and Server plan admission,
so incomplete/mixed speech does not gain write coverage from a numeric match.
A complete total-piece request for this established product denotes one serving
unless a serving count is given. The collection parser preserves separately spoken
configurations and their original evidence spans; "normal" uses the basic eight.
Only a live product quantity question may parse a name-free piece answer. The
Host recognizes the spoken name only when it identifies one current product;
collisions, relative extras and unrelated products stay with semantic planning.
Required options, live option limits/prices and purchase authority remain separate.

`@proj-airi/stage-shared/product-presentation` owns the validated ephemeral
product cue contract and the original Menu cursor timing policy; PB uses shorter control-following steps.
It also owns PB's default three-product recommendation limit and the shared
presentation input parser used by native queue admission, execution and Host
deduplication. The existing tool uses `recommendation` for selected dishes and
ordinary recommendations, `other-recommendations` only for requesting a different
batch, and `information` for passive facts. Only `other-recommendations` excludes
the last introduced batch; matching named dishes remain eligible for a new search.
Explicit information comparisons retain a separate ten-product
presentation budget; requested identities must be validated before limiting.
References, names and observed prices are browser facts, never purchase consent.
`@proj-airi/stage-shared/ordering-slots` owns the existing local serving-number
parser used by both finite candidate compilers; it does not classify intent.

## Interactive-service lifecycle

`@proj-airi/stage-shared/pb-journey` also admits the explicit offline simulator
at `http://127.0.0.1:5188/order/store/1kgJeql/internal_use/menu/select-table`.
Only that origin/store/flow and its menu/cart/table pages are approved; this does
not allow other loopback ports or switching a merchant binding to the simulator.
See [`PB test site`](../../test-sites/pb-order-lab/README.md) for its captured
catalog, simulated API boundary, and production-executor compatibility check.

`@proj-airi/stage-shared/interaction-lifecycle` owns the iframe completion envelope
and `readInteractionLifecycle` validation shared by the owned menu, Stage Web and
Stage Kiosk. Hosts must check the active iframe window and approved origin before
parsing it. `orderResult` contains archivable non-personal metadata; the optional
HTTP(S) `orderContinuationUrl` is a bearer capability for the completion UI only.
Do not put that URL in chat, recording metadata, or the configured survey URL.

## WebMCP compatibility contract

This native contract remains for Stage Web. Kiosk/Menu use the separate
interactive-service protocol below; the updated Menu does not register the native probe.

`@proj-airi/stage-shared/webmcp` exports `webMcpHealthTool` and
`webMcpHealthResultSchema`. An interactive service registers the tool with its
native WebMCP domain tools, using the same `exposedTo` allowlist and abort signal.
The host sends `{ challenge: string }` and validates `{ version: 1, challenge }`
against both the schema and the exact challenge it sent. The tool has no domain
dependencies or side effects. It is an infrastructure probe, not an Agent tool.

Use it to gate native input/result transport before business execution. Do not
use it to authorize actions or assert that payment, login, business tools, or
physical pointer routing work. Do not probe with a domain tool as a substitute.

## Kiosk interactive-service contract

`@proj-airi/stage-shared/kiosk-desktop` owns the neutral native-surface placement
and activity contract. A trusted preload exposes only that capability; remote
service pages receive none. Requests carry service/document identity and a
monotonic sequence; the native host validates the exact main-frame sender and
clips bounds. Activity contains no typed keys or personal field values. This
contract provides display and activity only, not ordering tools or authorization.

`@proj-airi/stage-shared/interactive-service` owns the Eventa definitions, Valibot
envelope schemas and tool descriptor/execution types for the approved Kiosk
iframe. Discovery echoes a versioned challenge and returns the document ID,
tool revision and current descriptors. Execution binds the connection/document,
operation ID, tool revision and object input; results retain the opaque domain
receipt. Both endpoints must also validate exact origin and source Window.
Inspection binds the same connection/document to a bounded list of operation
IDs and reports pending/settled/failed/missing states without invoking tools.
Recovery requires every lost operation to be settled and the binding to have no
pending calls. Discovery of a new document cannot validate an old operation.
This contract provides no ordering authorization or arbitrary browser control;
the service runtime validates its tools and domain rules.
`browserSignInRequiredSchema` validates only a browser-confirmed rejection with
no effect before dispatch. It lets the host display a login prompt without
matching free-form error text or reclassifying an unknown cart write.

## Portable Kiosk characters

`@proj-airi/stage-shared/kiosk-character-package` owns the portable character
manifest v1, character-field whitelist, motion slots and transfer byte budgets.
It is neutral to Server/browser runtimes and contains no file IO or ZIP engine.
Use it for character backup/import, not for whole-Site replication or credentials.
The manifest carries relative binary paths and hashes; API import results carry
new destination-owned asset IDs. Merchant URLs and device/provider policy are
outside this contract.

## Kiosk conversation facts

`@proj-airi/stage-shared/kiosk-conversation` owns the neutral Main context,
application handoff and outcome contracts. Valibot validates explicit bounded
fields, complete product coverage and the 256 KiB abnormal-payload cap. It excludes
browser/Node runtime dependencies, images and vendor payloads. Menu produces the
snapshot; Kiosk binds it to a current task; Server projects it once per model
request. This is not the Jev candidate contract or an authorization token.
`contextReplySchema` and `replyFromContext` let Main select information or
clarification while the application renders facts from a fresh snapshot. They
never render model-supplied success prose or turn snapshot data into a write receipt.
`replyToConversation` renders only generic greeting, acknowledgement, hearing
check and meaning clarification without requiring a Menu snapshot; external-browser
hosts reuse these replies without inventing Menu facts or operation authority.
Offered payment labels are independent of phase-specific allowed operations.

`@proj-airi/stage-shared/kiosk-audio` owns the PCM sample rate/width, WAV header,
maximum upload chunk duration and request-byte ceiling. It describes transport,
not Site VAD segmentation or authorization to execute an utterance.

Browser recovery separates `canRetry` (replay eligibility) from `canReset` (explicit unfinished-cart discard). Pending submissions and uncertain clear markers remain isolated across document reloads; neither flag grants a model permission to reset.

The same subpath exports service-recovery result/progress contracts, read-only
service-clarification schema, domain-version/question correlation and shared time
ceilings. `SERVICE_RECOVERY_PROGRESS` start is only provider work notification;
service admission must be established independently, and neither grants a Menu
operation ticket. It carries no fabricated Jev confidence.

## Kiosk native audio

`kiosk-native-audio` owns the Eventa request/result contract, bounded Float32 PCM
and capture-generation identifiers for the Electron-owned GPU frontend. Bridge
version 2 covers native device enumeration, DSP preparation, duplex device open,
stereo-render polling and stop. The matching 0.5.0 EXE is required; no browser
microphone stream crosses this native hardware interface. It
exposes no filesystem path, arbitrary model URL or credentials. The Desktop
main process enforces trusted-main-frame admission; native processing and model
lifetime belong to `apps/stage-kiosk-desktop/audio`, not this neutral package.

`kiosk-array-input` owns the v1 native-input control/MessagePort contract for the
original desktop LCMV path. Control RPC is trusted-main-frame only; each audio port
belongs to one capture generation. It is separate from the native GPU DSP bridge.
