#!/usr/bin/env bash

# Builds an Ubuntu x86_64 AIRI Debian package from the checked-out repository.
# Missing build tools are installed automatically. Pass --setup to re-check them.

set -Eeuo pipefail

error() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

requireCommand() {
  command -v "$1" >/dev/null || error "Missing required command: $1"
}

resolveGodotBinary() {
  local userHome bundledGodot systemGodot
  userHome="$(getent passwd "$(id --user --name)" | cut -d: -f6)"
  bundledGodot="$userHome/.local/opt/airi-tools/Godot_v4.6.2-stable_mono_linux_x86_64/Godot_v4.6.2-stable_mono_linux.x86_64"
  if [[ -x "$bundledGodot" ]]; then
    printf '%s\n' "$bundledGodot"
    return
  fi

  systemGodot="$(command -v godot || true)"
  [[ -n "$systemGodot" ]] || return 1
  printf '%s\n' "$systemGodot"
}

installBuildToolchain() {
  local temporaryDirectory userHome toolDirectory godotArchive godotBinary templateArchive templateDirectory nodeArchive nodeChecksums nodeDirectory

  sudo apt-get update
  sudo apt-get install --yes \
    build-essential \
    ca-certificates \
    curl \
    git \
    libssl-dev \
    libudev-dev \
    pkg-config \
    python3 \
    unzip

  userHome="$(getent passwd "$(id --user --name)" | cut -d: -f6)"
  toolDirectory="$userHome/.local/opt/airi-tools"
  nodeDirectory="$toolDirectory/node-v24.13.0-linux-x64"
  if [[ -x "$nodeDirectory/bin/node" ]]; then
    export PATH="$nodeDirectory/bin:$PATH"
  elif ! command -v node >/dev/null || [[ "$(node --version)" != v24.* ]] || ! command -v corepack >/dev/null; then
    mkdir -p "$toolDirectory"
    nodeArchive="$toolDirectory/node-v24.13.0-linux-x64.tar.xz"
    nodeChecksums="$toolDirectory/SHASUMS256.txt"
    curl --fail --location --output "$nodeArchive" https://nodejs.org/dist/v24.13.0/node-v24.13.0-linux-x64.tar.xz
    curl --fail --location --output "$nodeChecksums" https://nodejs.org/dist/v24.13.0/SHASUMS256.txt
    (
      cd "$toolDirectory"
      grep ' node-v24.13.0-linux-x64.tar.xz$' "$nodeChecksums" | sha256sum --check
    )
    tar --extract --xz --file "$nodeArchive" --directory "$toolDirectory"
    rm -f "$nodeArchive" "$nodeChecksums"
    export PATH="$nodeDirectory/bin:$PATH"
  fi
  corepack prepare pnpm@10.33.0 --activate

  if ! dotnet --list-sdks 2>/dev/null | grep --quiet '^8\.0\.'; then
    temporaryDirectory="$(mktemp -d)"
    trap 'rm -rf "$temporaryDirectory"' RETURN
    curl --fail --location --output "$temporaryDirectory/packages-microsoft-prod.deb" \
      https://packages.microsoft.com/config/ubuntu/24.04/packages-microsoft-prod.deb
    sudo dpkg --install "$temporaryDirectory/packages-microsoft-prod.deb"
    sudo apt-get update
    sudo apt-get install --yes dotnet-sdk-8.0
  fi

  godotBinary="$toolDirectory/Godot_v4.6.2-stable_mono_linux_x86_64/Godot_v4.6.2-stable_mono_linux.x86_64"
  if [[ ! -x "$godotBinary" ]] || ! "$godotBinary" --version | grep --quiet '^4\.6\.2'; then
    godotArchive="$toolDirectory/godot.zip"
    mkdir -p "$toolDirectory" "$userHome/.local/bin"
    curl --fail --location --output "$godotArchive" \
      https://github.com/godotengine/godot/releases/download/4.6.2-stable/Godot_v4.6.2-stable_mono_linux_x86_64.zip
    unzip -o "$godotArchive" -d "$toolDirectory"
    rm -f "$godotArchive"
  fi

  templateDirectory="$userHome/.local/share/godot/export_templates/4.6.2.stable.mono"
  if [[ ! -f "$templateDirectory/linux_debug.x86_64" || ! -f "$templateDirectory/linux_release.x86_64" ]]; then
    temporaryDirectory="$(mktemp -d)"
    trap 'rm -rf "$temporaryDirectory"' RETURN
    templateArchive="$temporaryDirectory/export-templates.tpz"
    curl --fail --location --output "$templateArchive" \
      https://github.com/godotengine/godot/releases/download/4.6.2-stable/Godot_v4.6.2-stable_mono_export_templates.tpz
    unzip -o "$templateArchive" -d "$temporaryDirectory"
    mkdir -p "$templateDirectory"
    cp -a "$temporaryDirectory/templates/." "$templateDirectory"
  fi
}

needsBuildToolchain() {
  local godotBinary userHome templateDirectory
  if ! command -v node >/dev/null || [[ "$(node --version)" != v24.* ]]; then
    return 0
  fi
  if ! command -v corepack >/dev/null || ! command -v dotnet >/dev/null; then
    return 0
  fi
  godotBinary="$(resolveGodotBinary || true)"
  if [[ -z "$godotBinary" ]] || ! dotnet --list-sdks 2>/dev/null | grep --quiet '^8\.0\.' || ! "$godotBinary" --version | grep --quiet '^4\.6\.2'; then
    return 0
  fi

  userHome="$(getent passwd "$(id --user --name)" | cut -d: -f6)"
  templateDirectory="$userHome/.local/share/godot/export_templates/4.6.2.stable.mono"
  [[ ! -f "$templateDirectory/linux_debug.x86_64" || ! -f "$templateDirectory/linux_release.x86_64" ]]
}

main() {
  local setupRequested=false godotBinary
  if [[ "${1:-}" == '--setup' ]]; then
    setupRequested=true
    shift
  fi
  [[ "$#" -eq 0 ]] || error 'Usage: bash scripts/buildUbuntuDeb.sh [--setup]'

  [[ -r /etc/os-release ]] || error 'Run this script on Ubuntu 24.04.'
  # shellcheck disable=SC1091
  source /etc/os-release
  [[ "${ID:-}" == 'ubuntu' && "${VERSION_ID:-}" == '24.04' ]] || error 'Run this script on Ubuntu 24.04.'
  [[ "$(dpkg --print-architecture)" == 'amd64' ]] || error 'Run this script on an amd64 machine.'

  if [[ "$setupRequested" == true ]] || needsBuildToolchain; then
    installBuildToolchain
  fi

  requireCommand git
  requireCommand node
  requireCommand corepack
  requireCommand dotnet
  [[ "$(node --version)" == v24.* ]] || error 'Node.js 24 is required.'
  godotBinary="$(resolveGodotBinary)" || error 'Godot 4.6.2 is required.'
  "$godotBinary" --version | grep --quiet '^4\.6\.2' || error 'Godot 4.6.2 is required.'

  cd "$(git rev-parse --show-toplevel)"
  corepack pnpm install --frozen-lockfile
  corepack pnpm run build:packages

  mkdir -p engines/stage-tamagotchi-godot/build/linux
  (
    cd engines/stage-tamagotchi-godot
    "$godotBinary" --headless --export-release 'Linux x64' build/linux/godot-stage
  )

  corepack pnpm -F @proj-airi/stage-tamagotchi run build
  corepack pnpm -F @proj-airi/stage-tamagotchi exec electron-builder --linux deb --x64 --publish=never

  local packagePath
  packagePath="$(find apps/stage-tamagotchi/dist -maxdepth 1 -type f -name '*.deb' -print -quit)"
  [[ -n "$packagePath" ]] || error 'The Linux .deb package was not created.'
  printf '\nPackage created: %s\n' "$packagePath"
}

main "$@"
