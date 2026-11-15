#requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateSet('Setup', 'Build', 'Tunnel', 'Start', 'Doctor', 'Smoke')][string]$Action = 'Doctor',
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
if (-not (Test-Path -LiteralPath $Config)) {
    if ($Action -ne 'Setup') { throw 'Run -Action Setup first to create kiosk.windows.local.json.' }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'kiosk.windows.example.json') -Destination $Config
    Write-Host 'Created kiosk.windows.local.json. Edit ssh.host/user before opening the tunnel.'
}
Import-Module (Join-Path $PSScriptRoot 'kioskTools.psm1') -Force
$settings = Get-KioskSettings -Path $Config
if ($Architecture -eq 'auto') {
    $Architecture = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }
}
$tools = Get-KioskTools -Root $root -Architecture $Architecture
$entry = Join-Path $root 'apps/stage-kiosk-desktop/out/main/index.js'
$kioskProfile = Join-Path $env:LOCALAPPDATA 'Webnavior/Kiosk-Pilot'
$env:PATH = "$($tools.nodeDirectory);$env:PATH"
Push-Location $root
try {
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
            $active = Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($entry, [StringComparison]::OrdinalIgnoreCase) -ge 0 }
            if ($active) { throw 'Close this project Electron before rebuilding. Login and cart data will be retained.' }
            Invoke-KioskPnpm -Tools $tools -Arguments @('-F', '@proj-airi/stage-kiosk-desktop', 'build')
        }
        elseif ($Action -eq 'Smoke') {
            if (-not (Test-Path -LiteralPath $entry)) { throw 'Run -Action Build first.' }
            $env:ESGPB_ELECTRON_PATH = $tools.electron
            & $tools.node scripts/verifyKioskDesktop.mjs
            if ($LASTEXITCODE -ne 0) { throw 'Local synthetic Electron smoke test failed; retain its error output.' }
        }
        else {
            $origin = ([Uri]$settings.kioskUrl).GetLeftPart([UriPartial]::Authority)
            $health = Invoke-WebRequest -UseBasicParsing -Uri "$origin/readyz" -TimeoutSec 15
            if ($health.StatusCode -ne 200) { throw 'Remote API is not ready.' }
            $page = Invoke-WebRequest -UseBasicParsing -Uri $settings.kioskUrl -TimeoutSec 15
            if ($page.Content -notmatch '<script[^>]+type="module"') { throw 'kioskUrl did not return the built Kiosk.' }
            if ($Action -eq 'Doctor') {
                Write-Host "Runtime OK; architecture=$Architecture; remote API and Kiosk reachable."
                Write-Host "Kiosk: $($settings.kioskUrl)"
                Write-Host "Local profile: $kioskProfile"
                Write-Host 'LLM/ASR/TTS keys and provider URLs are configured on the remote admin, not in this file.'
            }
            else {
                if (-not (Test-Path -LiteralPath $entry)) { throw 'Run -Action Build first.' }
                $env:KIOSK_DESKTOP_URL = $settings.kioskUrl
                $env:KIOSK_DESKTOP_USER_DATA = $kioskProfile
                $env:KIOSK_DESKTOP_WINDOWED = if ($settings.windowed) { '1' } else { '0' }
                # A parent shell's Node inspection flag must never leak into the GUI.
                Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
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
finally { Pop-Location }
