---
title: Stage Web Local Setup and Provider Rate Limits
date: 2026-08-28
category: developer-experience
module: Stage Web local development
problem_type: developer_experience
component: tooling
severity: medium
applies_when:
  - "Starting the AIRI Stage Web application from a fresh checkout"
  - "The terminal cannot find the pnpm command"
  - "The full workspace installation times out on desktop-only dependencies"
  - "A chat request through OpenRouter returns HTTP 429"
tags:
  - stage-web
  - pnpm
  - openrouter
  - vite
  - local-development
---

# Stage Web Local Setup and Provider Rate Limits

## Context

AIRI is a pnpm monorepo containing Stage Web, the Stage Tamagotchi Electron app,
mobile targets, services, and shared packages. The default development entrypoint is
the Stage Web application in `apps/stage-web`.

The root manifest pins the repository to pnpm `10.33.0`. A machine may have Node and
npm available through nvm while the `pnpm` command itself is absent from `PATH`. In
that case, invoking a temporary pnpm version through `npx` keeps the project toolchain
consistent without changing the user's global installation.

## Start Stage Web

From the repository root, run:

```sh
cd ~/Desktop/workspace/AIRI
npx --yes pnpm@10.33.0 --filter @proj-airi/stage-web run dev
```

Open <http://localhost:5173/> once Vite reports that it is ready.

The equivalent project script is `pnpm dev`, defined in the root `package.json`, but
use the command above whenever a normal `pnpm` command is unavailable or its version
does not match the repository's pinned version.

## First-Time Installation

For a Web-only setup, install the Stage Web workspace and its workspace dependencies:

```sh
npx --yes pnpm@10.33.0 install --filter @proj-airi/stage-web... --ignore-scripts
npx --yes pnpm@10.33.0 -r --filter @proj-airi/stage-web... run build
```

The build step matters: several Stage Web dependencies export files from `dist/`.
Skipping lifecycle scripts during a scoped install leaves those artifacts absent, and
Vite then reports unresolved `@proj-airi/*` imports during dependency scanning.

Use the full `pnpm install` only when desktop, mobile, services, or all workspaces are
needed. It downloads substantially more packages, including native desktop dependencies,
and may take longer or hit transient registry timeouts.

## OpenRouter HTTP 429

An error such as the following is an upstream provider rate limit, not a Stage Web or
Vite startup failure:

```text
qwen/qwen3.8-flash is temporarily rate-limited upstream
limit_source: upstream_provider_shared_pool
```

Resolve it in the application UI:

1. Open **Settings → Providers → Chat** and configure a provider plus its API key.
2. Use **Ping API** to verify the credentials and connection.
3. Open **Settings → Consciousness** and select the active provider and model.
4. Retry later, select another model/provider, or configure a personal OpenRouter key
   to use the account's own rate limits.

Provider credentials and the active chat selection are separate settings. Saving a
provider does not automatically make it the model used by chat.

## Account and AIRI Cloud Feature Switch

Stage Web is local-first by default: account controls, sign-in onboarding, account
routes, automatic official-provider setup, and AIRI-managed providers are hidden.
This keeps the default product focused on providers and API keys controlled by the
user. Change it in **Settings → System → General → Enable account and AIRI Cloud
features**. The preference is stored locally and the app refreshes immediately.

For deployments where new users should receive the optional features by default, set
the environment variable before starting Vite:

```sh
VITE_ENABLE_ACCOUNT_FEATURES=true npx --yes pnpm@10.33.0 --filter @proj-airi/stage-web run dev
```

Existing users can still override the deployment default from the settings page.

## Verification

The expected local server response is:

```text
VITE ... ready
Local: http://localhost:5173/
```

Confirm it with:

```sh
curl --fail --silent --show-error --head http://localhost:5173/
```

The request should return `HTTP/1.1 200 OK`.

## Related

- `README.md`
- `docs/content/zh-Hans/docs/manual/config/llm.md`
- `apps/stage-web/package.json`
