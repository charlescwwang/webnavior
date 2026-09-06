#!/usr/bin/env bash

# Builds an Ubuntu x86_64 AIRI Debian package from the checked-out repository.

set -Eeuo pipefail

error() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

requireCommand() {
  command -v "$1" >/dev/null || error "Missing required command: $1"
}

main() {
  [[ -r /etc/os-release ]] || error 'Run this script on Ubuntu 24.04.'
  # shellcheck disable=SC1091
  source /etc/os-release
  [[ "${ID:-}" == 'ubuntu' && "${VERSION_ID:-}" == '24.04' ]] || error 'Run this script on Ubuntu 24.04.'
  [[ "$(dpkg --print-architecture)" == 'amd64' ]] || error 'Run this script on an amd64 machine.'

  requireCommand git
  requireCommand node
  requireCommand corepack
  requireCommand dotnet
  requireCommand godot
  [[ "$(node --version)" == v24.* ]] || error 'Node.js 24 is required.'

  cd "$(git rev-parse --show-toplevel)"
  corepack pnpm install --frozen-lockfile
  corepack pnpm run build:packages

  mkdir -p engines/stage-tamagotchi-godot/build/linux
  (
    cd engines/stage-tamagotchi-godot
    godot --headless --export-release 'Linux x64' build/linux/godot-stage
  )

  corepack pnpm -F @proj-airi/stage-tamagotchi run build
  corepack pnpm -F @proj-airi/stage-tamagotchi exec electron-builder build --linux --x64 --publish=never

  local packagePath
  packagePath="$(find apps/stage-tamagotchi/dist -maxdepth 1 -type f -name '*.deb' -print -quit)"
  [[ -n "$packagePath" ]] || error 'The Linux .deb package was not created.'
  printf '\nPackage created: %s\n' "$packagePath"
}

main "$@"
