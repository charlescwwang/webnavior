#requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateSet('Setup', 'Build', 'Tunnel', 'TestSite', 'Start', 'Doctor', 'Smoke')][string]$Action = 'Doctor',
    [string]$Config,
    [ValidateSet('auto', 'x64', 'arm64')][string]$Architecture = 'auto'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Run kiosk.ps1 on Windows 10/11.' }
if (-not [Environment]::Is64BitProcess) { throw 'Use 64-bit PowerShell.' }
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
if (-not $Config) { $Config = Join-Path $root 'kiosk.windows.local.json' }
elseif (-not [IO.Path]::IsPathRooted($Config)) { $Config = Join-Path $root $Config }
if (-not (Test-Path -LiteralPath $Config)) {
    if ($Action -ne 'Setup') { throw 'Run -Action Setup first to create kiosk.windows.local.json.' }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'kiosk.windows.example.json') -Destination $Config
    Write-Host 'Created kiosk.windows.local.json for the shared LAN backend. SSH settings are only needed for optional Tunnel mode.'
}
Import-Module (Join-Path $PSScriptRoot 'kioskTools.psm1') -Force
$settings = Get-KioskSettings -Path $Config
if ($Architecture -eq 'auto') {
    $Architecture = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }
}
$tools = Get-KioskTools -Root $root -Architecture $Architecture
$entry = Join-Path $root 'apps/stage-kiosk-desktop/out/main/index.js'
$kioskProfile = Join-Path $env:LOCALAPPDATA 'Webnavior/Kiosk-Pilot'
$previousEnvironment = @{}
foreach ($name in @('PATH', 'ELECTRON_SKIP_BINARY_DOWNLOAD', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ATTACH_CONSOLE', 'KIOSK_DESKTOP_URL', 'KIOSK_DESKTOP_USER_DATA', 'KIOSK_DESKTOP_WINDOWED', 'ESGPB_ELECTRON_PATH')) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
Push-Location $root
try {
    $env:PATH = "$($tools.nodeDirectory);$env:PATH"
    if ($Action -eq 'Setup') {
        Install-KioskTools -Root $root -Architecture $Architecture | Out-Host
        Assert-KioskRuntime -Tools $tools
        Write-Host 'Setup complete. Next: -Action Build.'
    }
    elseif ($Action -eq 'Tunnel') {
        $arguments = Get-TunnelArguments -Settings $settings
        if (-not (Get-Command ssh.exe -ErrorAction SilentlyContinue)) { throw 'Install the Windows optional feature OpenSSH Client first; see scripts/windows/README.md.' }
        Write-Host 'Keep this window open. Close it or press Ctrl+C to disconnect the tunnel.'
        & ssh.exe @arguments
        if ($LASTEXITCODE -ne 0) { throw 'SSH tunnel closed with an error. Check host, login and port conflicts.' }
    }
    else {
        if (-not (Test-Path -LiteralPath $tools.node) -or -not (Test-Path -LiteralPath $tools.pnpm) -or -not (Test-Path -LiteralPath $tools.electron)) { throw 'Run -Action Setup first.' }
        Assert-KioskRuntime -Tools $tools
        if ($Action -eq 'Build') {
            if (-not (Test-Path -LiteralPath (Join-Path $root 'apps/stage-kiosk-desktop/node_modules/electron-vite/bin/electron-vite.js'))) { throw 'Build dependency electron-vite is missing. Rerun Setup; do not delete node_modules.' }
            $active = Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($entry, [StringComparison]::OrdinalIgnoreCase) -ge 0 }
            if ($active) { throw 'Close this project Electron before rebuilding. Login and cart data will be retained.' }
            Invoke-KioskPnpm -Tools $tools -Arguments @('-F', '@proj-airi/stage-kiosk-desktop', 'build')
            Assert-KioskBuild -Root $root
            Write-Host 'Build complete. Next: -Action Smoke, then -Action Doctor and -Action Start.'
        }
        elseif ($Action -eq 'TestSite') {
            Write-Host 'Local test website: http://127.0.0.1:5188. Keep this window open; Ctrl+C stops it.'
            Invoke-KioskPnpm -Tools $tools -Arguments @('exec', 'vite', 'test-sites/pb-order-lab', '--host', '127.0.0.1', '--port', '5188', '--strictPort')
        }
        elseif ($Action -eq 'Smoke') {
            Assert-KioskBuild -Root $root
            $env:ESGPB_ELECTRON_PATH = $tools.electron
            & $tools.node scripts/verifyKioskDesktop.mjs
            if ($LASTEXITCODE -ne 0) { throw 'Local synthetic Electron smoke test failed; retain its error output.' }
        }
        else {
            $origin = ([Uri]$settings.kioskUrl).GetLeftPart([UriPartial]::Authority)
            $health = Invoke-KioskWebRequest -Uri "$origin/readyz"
            Assert-KioskApiReady -StatusCode $health.StatusCode -Content $health.Content
            $page = Invoke-KioskWebRequest -Uri $settings.kioskUrl
            if ($page.Content -notmatch '<script[^>]+type="module"') { throw 'kioskUrl did not return the built Kiosk.' }
            if ($Action -eq 'Doctor') {
                Write-Host "Runtime OK; architecture=$Architecture; remote API and Kiosk reachable."
                Write-Host "Kiosk: $($settings.kioskUrl)"
                Write-Host "Local profile: $kioskProfile"
                Write-Host 'LLM/ASR/TTS keys and provider URLs are configured on the remote admin, not in this file.'
            }
            else {
                Assert-KioskBuild -Root $root
                $env:KIOSK_DESKTOP_URL = $settings.kioskUrl
                $env:KIOSK_DESKTOP_USER_DATA = $kioskProfile
                $env:KIOSK_DESKTOP_WINDOWED = if ($settings.windowed) { '1' } else { '0' }
                # A parent shell's Node inspection flag must never leak into the GUI.
                Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
                Remove-Item Env:ELECTRON_NO_ATTACH_CONSOLE -ErrorAction SilentlyContinue
                $logs = Join-Path $kioskProfile 'launcher-logs'
                New-Item -ItemType Directory -Force -Path $logs | Out-Null
                $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
                $arguments = @(('"{0}"' -f $entry), '--enable-logging=file', ('--log-file="{0}"' -f (Join-Path $logs "$stamp-chromium.log")))
                if ($settings.diagnosticPort -ne 0) { $arguments += @('--remote-debugging-address=127.0.0.1', "--remote-debugging-port=$($settings.diagnosticPort)") }
                $process = Start-Process -FilePath $tools.electron -ArgumentList $arguments -WorkingDirectory $root -RedirectStandardOutput (Join-Path $logs "$stamp-stdout.log") -RedirectStandardError (Join-Path $logs "$stamp-stderr.log") -PassThru
                Start-Sleep -Seconds 2
                if ($process.HasExited -and $process.ExitCode -ne 0) { throw "Electron exited. Check $logs" }
                Write-Host "Electron launched. Logs: $logs"
            }
        }
    }
}
finally {
    foreach ($name in $previousEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process') }
    Pop-Location
}
