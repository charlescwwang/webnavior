# Runs with built-in PowerShell only: no Pester dependency or service mutations.
# Windows CI/manual users can execute this before Setup; Linux validates the
# same pure settings/hash boundaries without pretending to run electron.exe.
#requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'kioskTools.psm1') -Force
$directory = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $directory | Out-Null
$passed = 0
function Assert-Equal($Actual, $Expected) {
    if ($Actual -cne $Expected) { throw "Expected [$Expected], received [$Actual]." }
}
function Assert-Rejected([scriptblock]$Action) {
    $rejected = $false
    try { & $Action | Out-Null } catch { $rejected = $true }
    if (-not $rejected) { throw 'Expected rejection.' }
}
function Save-Settings($Settings) {
    $path = Join-Path $directory 'settings.json'
    $Settings | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $path -Encoding UTF8
    return $path
}
try {
    foreach ($file in Get-ChildItem -LiteralPath $PSScriptRoot -File | Where-Object { $_.Extension -in @('.ps1', '.psm1') }) {
        $tokens = $null
        $errors = $null
        [Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$errors) | Out-Null
        if ($errors.Count) { throw ($errors | Out-String) }
    }
    $passed++
    $example = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'kiosk.windows.example.json') -Raw | ConvertFrom-Json
    $settings = Get-KioskSettings -Path (Save-Settings $example)
    Assert-Equal $settings.kioskUrl 'https://webnavior.aikcitri.qzz.io/kiosk/'
    Assert-Rejected { Get-TunnelArguments -Settings $settings }
    $passed++
    foreach ($url in @('http://192.168.8.1:15169/kiosk/', 'https://user:secret@example.test/kiosk/', 'https://example.test/admin/', 'https://example.test/kiosk/?key=secret', '/kiosk/')) {
        $example.kioskUrl = $url
        Assert-Rejected { Get-KioskSettings -Path (Save-Settings $example) }
        $passed++
    }
    foreach ($url in @('http://127.0.0.1:15169/kiosk/', 'http://[::1]:15169/kiosk/', 'https://example.test/kiosk/')) {
        $example.kioskUrl = $url
        Assert-Equal (Get-KioskSettings -Path (Save-Settings $example)).kioskUrl $url
        $passed++
    }
    $example.diagnosticPort = 9222
    Get-KioskSettings -Path (Save-Settings $example) | Out-Null
    $example.diagnosticPort = 80
    Assert-Rejected { Get-KioskSettings -Path (Save-Settings $example) }
    $example.diagnosticPort = '9222'
    Assert-Rejected { Get-KioskSettings -Path (Save-Settings $example) }
    $example.diagnosticPort = 0
    $passed++
    $example.ssh.host = 'ubuntu.example.test'
    $example.ssh.user = 'aimax'
    $argsList = @(Get-TunnelArguments -Settings $example)
    Assert-Equal ($argsList -contains '127.0.0.1:15169:127.0.0.1:15169') $true
    Assert-Equal ($argsList -contains '127.0.0.1:5188:127.0.0.1:5188') $true
    Assert-Equal ($argsList -contains '127.0.0.1:15170:127.0.0.1:15170') $true
    Assert-Equal ($argsList -contains 'ExitOnForwardFailure=yes') $true
    Assert-Equal ($argsList -contains 'StrictHostKeyChecking=no') $false
    $passed++
    $example.ssh.forwardTestSite = $false
    Assert-Equal (@(Get-TunnelArguments -Settings $example) -contains '127.0.0.1:5188:127.0.0.1:5188') $false
    $example.ssh.host = '-oProxyCommand=whoami'
    Assert-Rejected { Get-TunnelArguments -Settings $example }
    $example.ssh.host = 'ubuntu.example.test'
    $example.ssh.user = 'name;whoami'
    Assert-Rejected { Get-TunnelArguments -Settings $example }
    $passed++
    $file = Join-Path $directory 'archive.zip'
    [IO.File]::WriteAllText($file, 'verified bytes')
    $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-ArchiveHash -Path $file -Expected $hash
    Assert-Rejected { Assert-ArchiveHash -Path $file -Expected ('0' * 64) }
    Assert-Rejected { Assert-ArchiveHash -Path $file -Expected 'not-a-hash' }
    $passed++
    Assert-KioskApiReady -StatusCode 200 -Content '{"status":"ready","checks":{"db":"ok","redis":"ok"}}'
    Assert-Rejected { Assert-KioskApiReady -StatusCode 200 -Content '<html>SPA fallback</html>' }
    Assert-Rejected { Assert-KioskApiReady -StatusCode 200 -Content '{"status":"ready","checks":{"db":"ok","redis":"failed"}}' }
    Assert-Rejected { Assert-KioskApiReady -StatusCode 503 -Content '{"status":"not_ready"}' }
    $passed++
    $tools = Get-KioskTools -Root $directory -Architecture arm64
    Assert-Equal $tools.node.EndsWith('node.exe') $true
    Assert-Equal $tools.electron.Contains('win32-arm64') $true
    $passed++
    # Report: this chat, 2026-11-16 — Windows Electron stdout can be empty.
    # Replace only the external process boundary; exercise the real JSON,
    # environment restoration and temporary-file cleanup in Assert-KioskRuntime.
    $module = Get-Module kioskTools
    $priorNode = $env:ELECTRON_RUN_AS_NODE
    $priorConsole = $env:ELECTRON_NO_ATTACH_CONSOLE
    try {
        & $module {
            function script:Start-Process {
                param($FilePath, $ArgumentList, [switch]$Wait, [switch]$PassThru)
                if (-not $Wait -or -not $PassThru) { throw 'Inspection must wait and inspect the exit code.' }
                if ($env:ELECTRON_RUN_AS_NODE -ne '1' -or $env:ELECTRON_NO_ATTACH_CONSOLE -ne '1') { throw 'Inspection flags missing.' }
                $script:inspectionPath = $ArgumentList[1].Trim('"')
                if ($script:inspectionCase -eq 'exit') { return [pscustomobject]@{ ExitCode = 7 } }
                if ($script:inspectionCase -eq 'missing') { return [pscustomobject]@{ ExitCode = 0 } }
                $json = switch ($script:inspectionCase) {
                    'invalid' { 'not JSON' }
                    'fields' { '{"node":"24.22.1"}' }
                    'wrong' { '{"node":"24.22.1","electron":"1.0.0"}' }
                    default { '{"node":"24.22.1","electron":"46.0.0-alpha.2"}' }
                }
                [IO.File]::WriteAllText($script:inspectionPath, $json)
                return [pscustomobject]@{ ExitCode = 0 }
            }
        }
        foreach ($case in @('valid', 'exit', 'missing', 'invalid', 'fields', 'wrong')) {
            $env:ELECTRON_RUN_AS_NODE = 'parent-node-value'
            $env:ELECTRON_NO_ATTACH_CONSOLE = 'parent-console-value'
            & $module { param($Value) $script:inspectionCase = $Value } $case
            if ($case -eq 'valid') { Assert-KioskRuntime -Tools $tools }
            else { Assert-Rejected { Assert-KioskRuntime -Tools $tools } }
            Assert-Equal $env:ELECTRON_RUN_AS_NODE 'parent-node-value'
            Assert-Equal $env:ELECTRON_NO_ATTACH_CONSOLE 'parent-console-value'
            $resultPath = & $module { $script:inspectionPath }
            Assert-Equal (Test-Path -LiteralPath (Split-Path $resultPath)) $false
            $passed++
        }
        Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
        Remove-Item Env:ELECTRON_NO_ATTACH_CONSOLE -ErrorAction SilentlyContinue
        & $module { $script:inspectionCase = 'valid' }
        Assert-KioskRuntime -Tools $tools
        Assert-Equal (Test-Path Env:ELECTRON_RUN_AS_NODE) $false
        Assert-Equal (Test-Path Env:ELECTRON_NO_ATTACH_CONSOLE) $false
        $passed++
    }
    finally {
        & $module { Remove-Item Function:Start-Process }
        $env:ELECTRON_RUN_AS_NODE = $priorNode
        $env:ELECTRON_NO_ATTACH_CONSOLE = $priorConsole
    }
    # Report: Windows deployment log in this chat, Nov17: network timeouts and incomplete builds.
    $priorProxy = $env:HTTPS_PROXY
    $priorNoProxy = $env:NO_PROXY
    try {
        & $module {
            function script:Start-Sleep { param($Seconds) }
            function script:Invoke-WebRequest {
                param([switch]$UseBasicParsing, $Uri, $TimeoutSec, $OutFile, $Proxy, $ProxyCredential)
                $script:requestCount++
                $script:lastProxy = $Proxy
                $script:lastProxyCredential = $ProxyCredential
                if ($TimeoutSec -ne 180) { throw 'Expected bounded network timeout.' }
                if ($script:requestCount -le $script:requestFailures) { throw 'Synthetic network timeout.' }
                return [pscustomobject]@{ StatusCode = 200; Content = 'ok' }
            }
            $script:requestFailures = 2; $script:requestCount = 0
        }
        $env:HTTPS_PROXY = ''; $env:NO_PROXY = ''
        $response = Invoke-KioskWebRequest -Uri 'https://example.com/runtime.zip'
        Assert-Equal $response.StatusCode 200
        Assert-Equal (& $module { $script:requestCount }) 3
        $passed++
        & $module { $script:requestFailures = 9; $script:requestCount = 0 }
        Assert-Rejected { Invoke-KioskWebRequest -Uri 'https://example.com/runtime.zip' }
        Assert-Equal (& $module { $script:requestCount }) 3
        $passed++
        & $module { $script:requestFailures = 0; $script:requestCount = 0 }
        $env:HTTPS_PROXY = 'http://proxy.example:8080'; $env:NO_PROXY = 'example.com'
        Invoke-KioskWebRequest -Uri 'https://api.example.com/readyz' | Out-Null
        Assert-Equal ([string](& $module { $script:lastProxy })) ''
        $passed++
        $env:NO_PROXY = ''
        Invoke-KioskWebRequest -Uri 'https://api.example.com/readyz' | Out-Null
        Assert-Equal ([string](& $module { $script:lastProxy })) 'http://proxy.example:8080/'
        $passed++
        Invoke-KioskWebRequest -Uri 'http://127.0.0.1:15169/readyz' | Out-Null
        Assert-Equal ([string](& $module { $script:lastProxy })) ''
        $passed++
        $env:HTTPS_PROXY = 'http://test-user:test-password@proxy.example:8080'
        Invoke-KioskWebRequest -Uri 'https://api.example.com/readyz' | Out-Null
        Assert-Equal (& $module { $script:lastProxy.UserInfo }) ''
        Assert-Equal (& $module { $script:lastProxyCredential.UserName }) 'test-user'
        $passed++
    }
    finally {
        & $module { Remove-Item Function:Invoke-WebRequest; Remove-Item Function:Start-Sleep }
        $env:HTTPS_PROXY = $priorProxy; $env:NO_PROXY = $priorNoProxy
    }
    $outputRoot = Join-Path $directory 'build with spaces'
    foreach ($relative in @('out/main/index.js', 'out/preload/index.cjs', 'out/service/pb.js')) {
        $file = Join-Path (Join-Path $outputRoot 'apps/stage-kiosk-desktop') $relative
        New-Item -ItemType Directory -Force -Path (Split-Path $file) | Out-Null
        [IO.File]::WriteAllText($file, 'compiled')
    }
    Assert-KioskBuild -Root $outputRoot
    $passed++
    [IO.File]::WriteAllText($file, '')
    Assert-Rejected { Assert-KioskBuild -Root $outputRoot }
    Remove-Item -LiteralPath $file
    Assert-Rejected { Assert-KioskBuild -Root $outputRoot }
    $passed++
    Write-Host "PASS: $passed Windows launcher syntax/configuration/hash groups."
}
finally { Remove-Item -LiteralPath $directory -Recurse -Force }
