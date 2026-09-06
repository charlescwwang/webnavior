#!/usr/bin/env bash

# Installs an AIRI x86_64 Debian package on Ubuntu with the open-source
# AMDGPU/Mesa graphics stack required by Electron, WebGL and Vulkan.
# With no argument, it downloads the latest official package. Pass a local .deb
# path to test an artifact built from the current checkout.
#
# This is deliberately not a ROCm installer. AIRI's desktop UI uses Chromium's
# graphics APIs; install ROCm separately only when a local model service needs it.

set -Eeuo pipefail

readonly repository='moeru-ai/airi'
readonly githubApiUrl="https://api.github.com/repos/${repository}/releases/latest"

error() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

requireUbuntuAmd64() {
  [[ "$(id -u)" -ne 0 ]] || error 'Run this script as a regular user; it invokes sudo only when needed.'
  [[ -r /etc/os-release ]] || error 'Unable to identify the operating system.'

  # shellcheck disable=SC1091
  source /etc/os-release
  [[ "${ID:-}" == 'ubuntu' ]] || error 'This installer supports Ubuntu only.'
  [[ "${VERSION_ID:-}" == '24.04' ]] || error 'Use Ubuntu 24.04 LTS; its Mesa package names are required by this installer.'
  [[ "$(dpkg --print-architecture)" == 'amd64' ]] || error 'AIRI for this hardware requires Ubuntu amd64.'
}

installGraphicsAndRuntimeDependencies() {
  sudo apt-get update

  # Mesa supplies RADV, the Vulkan driver for the integrated Radeon graphics.
  # Do not replace Ubuntu's in-kernel amdgpu driver with AMDGPU-PRO or DKMS here.
  sudo apt-get install --yes \
    ca-certificates \
    curl \
    jq \
    libasound2t64 \
    libatk-bridge2.0-0 \
    libatspi2.0-0 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnss3 \
    libsecret-1-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxkbcommon0 \
    libxrandr2 \
    libxss1 \
    libxtst6 \
    mesa-utils \
    mesa-vulkan-drivers \
    pciutils \
    vulkan-tools
}

downloadDeb() {
  local input="${1:-}" releaseJsonUrl assetUrl
  if [[ -n "$input" && "$input" != http://* && "$input" != https://* ]]; then
    [[ -f "$input" ]] || error "Debian package not found: $input"
    packagePath="$(realpath "$input")"
    return
  fi

  releaseJsonUrl="$(mktemp)"
  trap 'rm -f "${releaseJsonUrl:-}" "${packagePath:-}"' EXIT

  if [[ -n "$input" ]]; then
    packagePath="$(mktemp --suffix=.deb)"
    curl --fail --location --retry 3 --retry-all-errors --output "$packagePath" "$input"
    return
  fi

  curl --fail --location --retry 3 --retry-all-errors \
    --header 'Accept: application/vnd.github+json' \
    --output "$releaseJsonUrl" \
    "$githubApiUrl"

  # A release's exact version is intentionally not hard-coded. electron-builder
  # names the x86_64 artifact with a Linux marker and the .deb extension.
  assetUrl="$(jq --raw-output '
    [.assets[]
      | select(.name | test("linux.*(x64|amd64).*\\.deb$"; "i"))
      | .browser_download_url]
    | first // empty
  ' "$releaseJsonUrl")"
  [[ -n "$assetUrl" ]] || error 'The latest AIRI release has no Linux x86_64 .deb asset.'

  packagePath="$(mktemp --suffix=.deb)"
  curl --fail --location --retry 3 --retry-all-errors --output "$packagePath" "$assetUrl"
}

printGraphicsStatus() {
  printf '\nInstalled AIRI package: %s\n' "$packageName"
  printf '\nAMD graphics controller and driver:\n'
  lspci -nnk | sed -n '/VGA compatible controller\|Display controller/,+3p' || true

  printf '\nVulkan summary (a RADV device is expected):\n'
  vulkaninfo --summary 2>/dev/null | sed -n '1,80p' || \
    printf 'Vulkan diagnostics could not run. Reboot after updating Ubuntu/Mesa, then run: vulkaninfo --summary\n'

  printf '\nLaunch AIRI from the desktop launcher. For a terminal launch, run: airi\n'
}

main() {
  [[ "$#" -le 1 ]] || error 'Usage: bash scripts/installUbuntuAmd.sh [local-deb-path-or-https-url]'
  requireUbuntuAmd64
  sudo -v
  installGraphicsAndRuntimeDependencies
  downloadDeb "${1:-}"

  packageName="$(dpkg-deb --field "$packagePath" Package)"
  sudo apt-get install --yes "$packagePath"
  dpkg-query --show "$packageName" >/dev/null
  printGraphicsStatus
}

main "$@"
