# Stage Shared

Shared runtime-neutral contracts and Stage helpers. Import the owning subpath
instead of a renderer or Electron entrypoint when consuming a neutral contract.

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
