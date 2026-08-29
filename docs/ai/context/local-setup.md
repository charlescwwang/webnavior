# AIRI Local Setup Contract

Read this first for local installation. Do not re-discover the repository unless a command fails.

## Baseline

- Upstream: `https://github.com/moeru-ai/airi.git`
- Verified tag: `v0.11.3` / `dbf812488829a61cc2e95909e021b215704d066c`
- Node: `24.13.0`; pnpm: `10.33.0`
- Do not copy `node_modules` between operating systems.

## Customization handoff

- At this baseline, `HEAD` equals `v0.11.3`; there are no committed AIRI code customizations.
- The only intentional working-tree additions are `docs/local-development.md` and this file.
- On this Windows checkout, `integrations/vscode/vscode-airi/package.json` can appear modified because of CRLF/index metadata even when `git diff` is empty. Do not stage it unless it has a real diff.
- Before changing code, inspect only this concise comparison: `git diff --name-status v0.11.3...HEAD` and `git status --short`. Record any real future deviation in this section with its purpose, owner, and validation command.

## Install

```sh
corepack enable
corepack prepare pnpm@10.33.0 --activate
pnpm install --frozen-lockfile
```

The first Web or Desktop build downloads official Cubism SDK and sample Live2D/VRM assets. Network access is required for that one-time step.

## Run and verify

```sh
pnpm typecheck
pnpm build:web
pnpm -F @proj-airi/stage-tamagotchi build
pnpm dev:web
pnpm dev:tamagotchi
```

- Web default URL: `http://localhost:5173/`.
- Confirm the default Live2D Avatar renders and Provider onboarding opens.
- Desktop: confirm the Live2D Avatar renders. For local CDP only: set `APP_REMOTE_DEBUG=true` and `APP_REMOTE_DEBUG_PORT=9250` before `pnpm dev:tamagotchi`.

## Platform notes

- macOS: install Node/Git, then use Corepack. Reinstall dependencies locally; Apple Silicon and Intel each need their own native modules.
- `pnpm dev:*` and source builds do not require Apple signing credentials. Creating a distributable macOS package can require Apple signing/notarization credentials.
- Windows test failures may include POSIX path assertions and symlink `EPERM`; do not change source merely to hide them.

## Provider boundary

No API key, AIRI sign-in, Ollama, or OpenAI-compatible server is preconfigured. Do not invent a response, create a mock, or commit secrets. A real chat smoke test requires one of those external conditions.

## Scope guard

This baseline is AIRI only. Do not implement restaurant workflows, Python agents, WebMCP operations, TTS, or ASR unless the user explicitly starts that phase. For the detailed verification and portability report, read `docs/local-development.md` only when needed.
