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
    Assert-Equal $settings.kioskUrl 'http://127.0.0.1:15169/kiosk/'
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
    $tools = Get-KioskTools -Root $directory -Architecture arm64
    Assert-Equal $tools.node.EndsWith('node.exe') $true
    Assert-Equal $tools.electron.Contains('win32-arm64') $true
    $passed++
    Write-Host "PASS: $passed Windows launcher syntax/configuration/hash groups."
}
finally { Remove-Item -LiteralPath $directory -Recurse -Force }
