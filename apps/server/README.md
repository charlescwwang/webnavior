# `@proj-airi/server`

HTTP and WebSocket backend for Webnavior. This app owns auth, kiosk management, gateway forwarding, and server-side observability export.

## What It Does

- Serves the Hono-based API and WebSocket endpoints.
- Uses Postgres as the source of truth for users, billing, and durable state.
- Uses Redis for cache, KV, Pub/Sub, and Streams.
- Forwards GenAI requests to the configured upstream gateway and records billing from usage.
- Exports traces, metrics, and logs through OpenTelemetry.

## How To Use It

Install dependencies from the repo root and run scoped commands:

```sh
pnpm -F @proj-airi/server typecheck
pnpm -F @proj-airi/server exec vitest run
pnpm -F @proj-airi/server build
```

For local observability infrastructure, use:

```sh
docker compose -f apps/server/docker-compose.otel.yml up -d
```

## Database migrations and deployment

The Server owns the PostgreSQL schema. Every schema change must include a
numbered SQL file under `apps/server/drizzle/` and a matching entry in
`apps/server/drizzle/meta/_journal.json`. The `@proj-airi/server-schema` build
embeds those migrations in the Server; on startup, the Server applies any that
the target database has not recorded yet.

For local development, prefer starting the Server after rebuilding
`@proj-airi/server-schema`; this applies migrations and records them in the
same `drizzle.__drizzle_migrations` history that deployed Servers use.
`db:push` is a schema reconciliation command, not a migration runner: it does
not write that history. Do not use it to apply a pending numbered migration
before starting the Server, or the Server will try to apply that migration too.
If reconciliation is genuinely required, use:

```sh
pnpm -F @proj-airi/server db:push
```

For a deployed environment, take a PostgreSQL backup first, deploy the code
and its rebuilt `@proj-airi/server-schema` package together, then restart the
Server and confirm its logs report the applied schema before deploying a
frontend that depends on the new field. If the API reports PostgreSQL error
`42703` (missing column) after an application update, the database migration
has not been applied to that environment; do not treat it as an authentication
or frontend failure.

```sh
pnpm -F @proj-airi/server-schema build
```

## Browser entrypoints

Webnavior browser sign-in and the management dashboard live in `apps/stage-web`.
Set `WEB_APP_URL` to that browser-visible origin (for example
`https://webnavior.example`). Server `/auth/*` and legacy `/admin/*` paths
stay within that Webnavior origin; they do not redirect to an external AIRI
deployment.

## `ADDITIONAL_TRUSTED_ORIGINS` (LAN / Capacitor dev)

When the mobile dev server uses a non-localhost origin (for example `https://10.x.x.x:5273` from `cap copy ios` / `capacitor.config.json`), set **`ADDITIONAL_TRUSTED_ORIGINS`** in `apps/server/.env.local` to a comma-separated list of exact origins (parsed and normalized at startup). Example:

`ADDITIONAL_TRUSTED_ORIGINS=https://10.0.0.129:5273,https://198.18.0.1:5273`

Restart the API server after changing this variable.
