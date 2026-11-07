# Stage Shared

Shared runtime-neutral contracts and Stage helpers. Import the owning subpath
instead of a renderer or Electron entrypoint when consuming a neutral contract.
Resolve these subpaths through the package's `exports`. A Vite prefix alias to
`src/` bypasses that map and breaks subpaths whose public and file names differ.

## Product discovery

`@proj-airi/stage-shared/product-discovery` owns literal catalog-fragment
discovery shared by the menu and external-service confirmation flows. It uses
observed names, merchant aliases and optional category labels; a discovered
fragment narrows candidate questions and never grants item identity or write
authority.

## Visible service operations

`@proj-airi/stage-shared/service-operation` owns document/operation/step evidence
for visible control actions, including finite target refs, ready/dispatch/finish
times, cancellation reasons and validated recovery diagnostics. Timings share an operation
clock; parallel durations must not be added. These execution records are not
model plans or purchase authorization.

## Ordering presentation

`@proj-airi/stage-shared/product-presentation` owns the validated ephemeral
product cue contract and the original Menu cursor timing policy; PB uses shorter control-following steps.
References, names and observed prices are browser facts, never purchase consent.
`@proj-airi/stage-shared/ordering-slots` owns the existing local serving-number
parser used by both finite candidate compilers; it does not classify intent.

## Interactive-service lifecycle

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

The same subpath exports service-recovery result/progress contracts, read-only
service-clarification schema, domain-version/question correlation and shared time
ceilings. `SERVICE_RECOVERY_PROGRESS` start is only provider work notification;
service admission must be established independently, and neither grants a Menu
operation ticket. It carries no fabricated Jev confidence.
