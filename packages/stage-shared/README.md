# Stage Shared

Shared runtime-neutral contracts and Stage helpers. Import the owning subpath
instead of a renderer or Electron entrypoint when consuming a neutral contract.
Resolve these subpaths through the package's `exports`. A Vite prefix alias to
`src/` bypasses that map and breaks subpaths whose public and file names differ.

## Interactive-service lifecycle

`@proj-airi/stage-shared/interaction-lifecycle` owns the iframe completion envelope
and `readInteractionLifecycle` validation shared by the owned menu, Stage Web and
Stage Kiosk. Hosts must check the active iframe window and approved origin before
parsing it. `orderResult` contains archivable non-personal metadata; the optional
HTTP(S) `orderContinuationUrl` is a bearer capability for the completion UI only.
Do not put that URL in chat, recording metadata, or the configured survey URL.

## WebMCP compatibility contract

`@proj-airi/stage-shared/webmcp` exports `webMcpHealthTool` and
`webMcpHealthResultSchema`. An interactive service registers the tool with its
native WebMCP domain tools, using the same `exposedTo` allowlist and abort signal.
The host sends `{ challenge: string }` and validates `{ version: 1, challenge }`
against both the schema and the exact challenge it sent. The tool has no domain
dependencies or side effects. It is an infrastructure probe, not an Agent tool.

Use it to gate native input/result transport before business execution. Do not
use it to authorize actions or assert that payment, login, business tools, or
physical pointer routing work. Do not probe with a domain tool as a substitute.
