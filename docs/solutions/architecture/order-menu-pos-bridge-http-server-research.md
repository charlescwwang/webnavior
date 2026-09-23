---
title: HTTP Server Choice for the Local Order Menu POS Bridge
date: 2026-09-21
category: architecture
module: order menu POS Bridge
problem_type: research
component: HTTP server
tags:
  - order-menu
  - pos
  - http
  - hono
  - fastify
  - nodejs
---

# HTTP Server Choice for the Local Order Menu POS Bridge

## Question

Choose the HTTP server boundary for the proposed local `order-menu-server` POS
Bridge. The Bridge will serve a small, authenticated API for a menu/catalogue
snapshot and idempotent order submission; the first consumer is the local
`order-menu` application, and the first upstream is a controllable POS simulator.

This is a framework decision only. It does not select a POS vendor, add a package,
or change the public protocol.

## Repository evidence

`apps/server` is the project's production Node API and already uses `Hono` with
`@hono/node-server`. It composes route modules into a Hono app, starts it with
`serve({ fetch: app.fetch, port, hostname })`, and has Hono route-level tests.
The workspace catalog currently pins `hono` to `4.11.3` and
`@hono/node-server` to `^1.19.14`. `apps/order-menu` is currently a Vue/Vite
application with no HTTP-server dependency, so a new server app would need to
declare its selected runtime dependencies explicitly.

The current API server has observability, authentication, database, and WebSocket
requirements that the first POS Bridge deliberately does not inherit. Reuse its
HTTP style and test shape, not its broad process/dependency graph.

## Options

| Option | What it provides | Cost for this Bridge | Assessment |
| --- | --- | --- | --- |
| Reuse Hono + `@hono/node-server` | Fetch-style route composition over Node's HTTP server; a returned Node server can be closed during tests and shutdown. Hono also keeps raw Node request/response access available when a future POS integration genuinely needs it. [Hono Node guide](https://hono.dev/docs/getting-started/nodejs) | A new app must declare two existing workspace-catalog dependencies. Request/response validation remains an explicit Bridge policy; it should use the repository's established Valibot boundary rather than quietly accepting arbitrary JSON. | **Recommended.** It matches the existing production server's conventions without coupling the Bridge to `apps/server`. |
| Node built-in `node:http` | No third-party package. `http.createServer()` exposes the request listener directly; Node provides server lifecycle and request/header timeout controls. [Node HTTP API](https://nodejs.org/api/http.html#httpcreateserveroptions-requestlistener), [request timeout](https://nodejs.org/api/http.html#serverrequesttimeout), [server close](https://nodejs.org/api/http.html#serverclosecallback) | The Bridge must manually own URL routing, method handling, body-size limits, JSON decoding, content-type/error responses, CORS, and its test helper shape. Those concerns are essential for an order-submission boundary, not useful POS-domain complexity. | Suitable only for a deliberately tiny, test-only POS simulator. Do not use it as the Bridge's production-facing API shell. |
| Fastify | A Node server with plugin lifecycle, route schemas, schema-based validation, and response serialization. Its `close()` runs `onClose` hooks and rejects new requests while closing. [Fastify Server reference](https://fastify.dev/docs/latest/Reference/Server/), [validation and serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/) | Requires a new dependency family and introduces Fastify's JSON Schema/Ajv and serializer conventions. Fastify documents that schemas are compiled with `new Function()` and must be treated as application code; its validation approach would be a second validation style alongside the repository's Valibot practice. [Fastify validation security note](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/) | Technically capable, but its extra framework and validation model provide no first-phase benefit over the already-adopted Hono approach. Reconsider only if the Bridge later needs Fastify-specific plugin ecosystem features. |

## Recommendation

Create `apps/order-menu-server` as a small Node process using **Hono plus
`@hono/node-server`**. Keep it local by default: bind the development POS
simulator and Bridge to `127.0.0.1`, with a deliberate deployment configuration
decision before binding to a LAN address. The Fastify documentation distinguishes
the container-oriented `0.0.0.0` binding from localhost defaults, which reinforces
that network exposure must be explicit rather than accidental. [Fastify listen
reference](https://fastify.dev/docs/latest/Reference/Server/#listen)

The module boundary matters more than the framework:

1. `createPosBridgeApp({ catalog, orderGateway, receipts })` owns HTTP route
   wiring, request validation, and normalized API errors.
2. `catalog` and `orderGateway` are domain ports. The POS simulator and a future
   vendor adapter implement those ports; neither leaks vendor payloads through
   HTTP responses.
3. `runPosBridgeServer()` owns host, port, signal handling, and server closure.
   Hono's Node adapter returns the underlying Node server, so this lifecycle is
   available without adopting Node request/response APIs in route handlers.
   [Hono Node lifecycle example](https://hono.dev/docs/getting-started/nodejs)
4. Contract tests invoke `app.request()`/the Fetch-facing app where possible;
   one process smoke test verifies loopback binding, health, and graceful close.

## Consequences for the POS simulator

The simulator may use `node:http` because it is a development/test fixture with a
small, intentionally controlled protocol. It should support deterministic modes:
accepted, rejected, delayed response, dropped connection, and duplicate
idempotency key. Its observable result must still map to the Bridge receipt
contract (`environment: test | live`; `status: accepted | rejected | uncertain`),
not to a `simulated` status.

Do not expose the simulator through the kiosk browser or give it real POS
credentials. The Bridge alone calls it. That isolation allows the eventual vendor
adapter to replace the simulator without changing WebMCP tools or LLM-facing
language.

## Deferred decisions

Before implementing a real POS adapter, obtain the vendor's primary API
documentation and decide: authentication/credential storage, menu and
availability freshness, order idempotency semantics, timeout/reconciliation
workflow, LAN versus cloud connectivity, and whether payment, cancellation, or
refund operations are in scope. None of those is an HTTP framework choice.
