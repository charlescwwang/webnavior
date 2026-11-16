Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# These are the inspected pilot releases, independent of the workspace's older
# Electron development dependency. Never silently substitute a newer runtime.
$script:NodeVersion = '24.22.1'
$script:ElectronVersion = '46.0.0-alpha.2'
$script:Checksums = @{
    x64 = @{
        node = 'd2046d28c2c3dcd211ac5145c0bf30e2047ef9dfb306693c8c6e2eccd8b95fa5'
        electron = '223a9d14517224f8724992cab13b0660ba34d85a9f2836cd632d11fa2f06b9d8'
    }
    arm64 = @{
        node = 'a0c807319fede24c4a0d8f84564c82a619bd313b16b10c007c383c2609e99171'
        electron = 'c6c8d43c4543a639c361799c9cb79a01c0718368df71dfac789f358724302388'
    }
}

function Get-KioskSettings {
    param([Parameter(Mandatory)][string]$Path)
    $settings = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    $url = $null
    if (-not [Uri]::TryCreate([string]$settings.kioskUrl, [UriKind]::Absolute, [ref]$url)) {
        throw 'kioskUrl must be an absolute URL.'
    }
    $loopback = @('127.0.0.1', 'localhost', '[::1]') -contains $url.Host
    if ($url.UserInfo -or ($url.Scheme -ne 'https' -and -not ($url.Scheme -eq 'http' -and $loopback))) {
        throw 'Use HTTPS, or HTTP on loopback. Do not put credentials in kioskUrl.'
    }
    if (-not $url.AbsolutePath.EndsWith('/kiosk/') -or $url.Query -or $url.Fragment) {
        throw 'kioskUrl must end in /kiosk/ without a query or fragment.'
    }
    if ($settings.windowed -isnot [bool] -or $settings.ssh.forwardTestSite -isnot [bool]) {
        throw 'windowed and ssh.forwardTestSite must be true or false.'
    }
    $debugPort = $settings.diagnosticPort
    if ($debugPort -isnot [long] -and $debugPort -isnot [int]) { throw 'diagnosticPort must be an integer.' }
    if ($debugPort -ne 0 -and ($debugPort -lt 1024 -or $debugPort -gt 65535)) { throw 'diagnosticPort must be 0, or 1024..65535.' }
    return $settings
}

function Assert-KioskApiReady {
    param([int]$StatusCode, [string]$Content)
    # Static SPA fallback pages can return 200 while the API is unreachable.
    try { $body = $Content | ConvertFrom-Json } catch { throw 'Remote readiness endpoint did not return API JSON.' }
    if ($StatusCode -ne 200 -or $body.status -ne 'ready' -or $body.checks.db -ne 'ok' -or $body.checks.redis -ne 'ok') {
        throw 'Remote API, database or Redis is not ready.'
    }
}

function Get-TunnelArguments {
    param([Parameter(Mandatory)]$Settings)
    $remote = $Settings.ssh
    if ($remote.host -eq 'REPLACE_WITH_UBUNTU_IP_OR_HOST' -or $remote.host -notmatch '^[a-zA-Z0-9][a-zA-Z0-9.:-]*$' -or $remote.user -notmatch '^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$') {
        throw 'Fill ssh.host and ssh.user in kiosk.windows.local.json first.'
    }
    if (($remote.port -isnot [int] -and $remote.port -isnot [long]) -or $remote.port -lt 1 -or $remote.port -gt 65535) { throw 'ssh.port must be 1..65535.' }
    # Fixed loopback bindings preserve the existing Server origin/cookie policy
    # and make the local test-site URL refer to the same Ubuntu fixture.
    $arguments = @('-N', '-T', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-p', [string]$remote.port, '-L', '127.0.0.1:15169:127.0.0.1:15169')
    if ($remote.forwardTestSite) {
        $arguments += @('-L', '127.0.0.1:5188:127.0.0.1:5188', '-L', '127.0.0.1:15170:127.0.0.1:15170')
    }
    if ($remote.identityFile) {
        if (-not (Test-Path -LiteralPath $remote.identityFile -PathType Leaf)) { throw 'ssh.identityFile does not exist.' }
        $arguments += @('-i', [string]$remote.identityFile)
    }
    $arguments += @('-l', [string]$remote.user, [string]$remote.host)
    return $arguments
}

function Assert-ArchiveHash {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Expected)
    if ($Expected -notmatch '^[a-f0-9]{64}$' -or (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Expected) {
        throw "SHA256 mismatch: $Path. The archive will not be extracted."
    }
}

function Install-VerifiedArchive {
    param([string]$Url, [string]$Path, [string]$Expected, [string]$Destination)
    if (-not (Test-Path -LiteralPath $Path)) {
        $pending = "$Path.download"
        try {
            Invoke-KioskWebRequest -Uri $Url -OutFile $pending
            Assert-ArchiveHash -Path $pending -Expected $Expected
            Move-Item -LiteralPath $pending -Destination $Path
        }
        finally {
            if (Test-Path -LiteralPath $pending) { Remove-Item -LiteralPath $pending }
        }
    }
    Assert-ArchiveHash -Path $Path -Expected $Expected
    # Only verified official archives enter the extraction directory.
    Unblock-File -LiteralPath $Path
    Expand-Archive -LiteralPath $Path -DestinationPath $Destination -Force
}

function Invoke-KioskWebRequest {
    param([Parameter(Mandatory)][string]$Uri, [string]$OutFile)
    $arguments = @{ UseBasicParsing = $true; Uri = $Uri; TimeoutSec = 180 }
    if ($OutFile) { $arguments.OutFile = $OutFile }
    $target = [Uri]$Uri
    $proxy = if ($target.Scheme -eq 'https') { $env:HTTPS_PROXY } else { $env:HTTP_PROXY }
    $bypass = $target.IsLoopback
    foreach ($entry in ([string]$env:NO_PROXY).Split(',')) {
        $hostName = $entry.Trim().TrimStart('.')
        if ($hostName -and ($hostName -eq '*' -or $target.Host -eq $hostName -or $target.Host.EndsWith('.' + $hostName))) { $bypass = $true }
    }
    # PowerShell 5.1 does not automatically apply npm's proxy environment.
    # Without an explicit proxy, Windows' own proxy configuration remains in use.
    if ($proxy -and -not $bypass) {
        $proxyUrl = [Uri]$proxy
        if (-not $proxyUrl.IsAbsoluteUri -or $proxyUrl.Scheme -notin @('http', 'https')) { throw 'HTTP_PROXY/HTTPS_PROXY must be an absolute HTTP(S) proxy URL.' }
        $builder = New-Object UriBuilder($proxyUrl)
        $builder.UserName = ''; $builder.Password = ''
        $arguments.Proxy = $builder.Uri
        if ($proxyUrl.UserInfo) {
            $credentials = $proxyUrl.UserInfo.Split(':', 2)
            if ($credentials.Length -ne 2) { throw 'Proxy credentials must include a username and password.' }
            $password = ConvertTo-SecureString ([Uri]::UnescapeDataString($credentials[1])) -AsPlainText -Force
            $arguments.ProxyCredential = New-Object Management.Automation.PSCredential([Uri]::UnescapeDataString($credentials[0]), $password)
        }
    }
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try { return Invoke-WebRequest @arguments }
        catch {
            if ($attempt -eq 3) { throw }
            Write-Warning "Network request failed ($attempt/3); retrying. Check company proxy settings if this persists."
            Start-Sleep -Seconds ($attempt * 2)
        }
    }
}

function Assert-KioskBuild {
    param([Parameter(Mandatory)][string]$Root)
    foreach ($relative in @('out/main/index.js', 'out/preload/index.cjs', 'out/service/pb.js')) {
        $file = Join-Path (Join-Path $Root 'apps/stage-kiosk-desktop') $relative
        if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or (Get-Item -LiteralPath $file).Length -eq 0) { throw "Build output missing or empty: $file. Run -Action Build and retain its error output." }
    }
}

function Get-KioskTools {
    param([string]$Root, [ValidateSet('x64', 'arm64')][string]$Architecture)
    $state = Join-Path $Root '.windows-kiosk.local'
    $nodeDirectory = Join-Path $state "tools/node-v$script:NodeVersion-win-$Architecture"
    $electronDirectory = Join-Path $state "runtime/electron-v$script:ElectronVersion-win32-$Architecture"
    return @{
        state = $state
        nodeDirectory = $nodeDirectory
        node = Join-Path $nodeDirectory 'node.exe'
        npm = Join-Path $nodeDirectory 'npm.cmd'
        pnpm = Join-Path $state 'tools/pnpm/node_modules/pnpm/bin/pnpm.cjs'
        electronDirectory = $electronDirectory
        electron = Join-Path $electronDirectory 'electron.exe'
    }
}

function Invoke-KioskPnpm {
    param($Tools, [string[]]$Arguments)
    & $Tools.node $Tools.pnpm @Arguments
    if ($LASTEXITCODE -ne 0) { throw "pnpm failed (exit $LASTEXITCODE)." }
}

function Install-KioskTools {
    param([string]$Root, [ValidateSet('x64', 'arm64')][string]$Architecture)
    $tools = Get-KioskTools -Root $Root -Architecture $Architecture
    $downloads = Join-Path $tools.state 'downloads'
    New-Item -ItemType Directory -Force -Path $downloads | Out-Null
    $nodeArchive = "node-v$script:NodeVersion-win-$Architecture.zip"
    if (-not (Test-Path -LiteralPath $tools.node)) {
        Install-VerifiedArchive -Url "https://nodejs.org/dist/v$script:NodeVersion/$nodeArchive" -Path (Join-Path $downloads $nodeArchive) -Expected $script:Checksums[$Architecture].node -Destination (Join-Path $tools.state 'tools')
    }
    $env:PATH = "$($tools.nodeDirectory);$env:PATH"
    if ((& $tools.node --version) -ne "v$script:NodeVersion") { throw 'Unexpected build Node version.' }
    $package = Get-Content -LiteralPath (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json
    if ($package.packageManager -notmatch '^pnpm@([0-9]+\.[0-9]+\.[0-9]+)$') { throw 'Unexpected packageManager; inspect the new version before installing.' }
    $pnpmVersion = $Matches[1]
    $installedPnpm = if (Test-Path -LiteralPath $tools.pnpm) { & $tools.node $tools.pnpm --version } else { '' }
    if ($installedPnpm -ne $pnpmVersion) {
        & $tools.npm install --prefix (Join-Path $tools.state 'tools/pnpm') --ignore-scripts --no-audit --no-fund --fetch-retries=3 --fetch-timeout=120000 "pnpm@$pnpmVersion"
        if ($LASTEXITCODE -ne 0) { throw 'Pinned pnpm download failed. Check network/proxy and rerun Setup; existing downloads and packages are retained.' }
    }
    if ((& $tools.node $tools.pnpm --version) -ne $pnpmVersion) { throw 'Installed pnpm does not match packageManager.' }
    # Do not run the whole monorepo's postinstall/native SDK builds on a clean
    # remote desktop. Include stage-ui: the native service bundles its sources
    # from that package, outside Desktop's direct dependency closure.
    # esbuild is the one build-time install hook needed here.
    $env:ELECTRON_SKIP_BINARY_DOWNLOAD = '1'
    Invoke-KioskPnpm -Tools $tools -Arguments @('--filter', '@proj-airi/root', '--filter', '@proj-airi/stage-kiosk-desktop...', '--filter', '@proj-airi/stage-ui...', 'install', '--frozen-lockfile', '--ignore-scripts', '--prod=false', '--fetch-retries=3', '--fetch-timeout=120000')
    Invoke-KioskPnpm -Tools $tools -Arguments @('rebuild', 'esbuild')
    $electronArchive = "electron-v$script:ElectronVersion-win32-$Architecture.zip"
    if (-not (Test-Path -LiteralPath $tools.electron)) {
        Install-VerifiedArchive -Url "https://github.com/electron/electron/releases/download/v$script:ElectronVersion/$electronArchive" -Path (Join-Path $downloads $electronArchive) -Expected $script:Checksums[$Architecture].electron -Destination $tools.electronDirectory
    }
    return $tools
}

function Assert-KioskRuntime {
    param($Tools)
    $previousNode = $env:ELECTRON_RUN_AS_NODE
    $previousConsole = $env:ELECTRON_NO_ATTACH_CONSOLE
    $directory = Join-Path ([IO.Path]::GetTempPath()) ('webnavior-runtime-' + [Guid]::NewGuid().ToString())
    try {
        New-Item -ItemType Directory -Path $directory | Out-Null
        $probe = Join-Path $directory 'inspect.cjs'
        $output = Join-Path $directory 'versions.json'
        # Electron is a Windows GUI executable: stdout capture is unreliable.
        # Pass paths as quoted arguments, not interpolated JavaScript code.
        [IO.File]::WriteAllText($probe, 'require("node:fs").writeFileSync(process.argv[2], JSON.stringify({electron:process.versions.electron,node:process.versions.node}));')
        $env:ELECTRON_RUN_AS_NODE = '1'
        $env:ELECTRON_NO_ATTACH_CONSOLE = '1'
        $inspection = Start-Process -FilePath $Tools.electron -ArgumentList @(('"{0}"' -f $probe), ('"{0}"' -f $output)) -Wait -PassThru
        if ($inspection.ExitCode -ne 0) { throw "Electron runtime inspection failed (exit $($inspection.ExitCode))." }
        if (-not (Test-Path -LiteralPath $output -PathType Leaf)) { throw 'Electron runtime inspection did not produce versions.json.' }
        try { $versions = Get-Content -LiteralPath $output -Raw | ConvertFrom-Json }
        catch { throw 'Electron runtime inspection returned invalid JSON.' }
        if ($null -eq $versions -or $versions -is [array] -or
            -not $versions.PSObject.Properties['electron'] -or -not $versions.PSObject.Properties['node'] -or
            $versions.electron -isnot [string] -or [string]::IsNullOrWhiteSpace($versions.electron) -or
            $versions.node -isnot [string] -or [string]::IsNullOrWhiteSpace($versions.node)) {
            throw 'Electron runtime inspection requires nonempty electron and node version strings.'
        }
        if ($versions.electron -ne $script:ElectronVersion -or $versions.node -ne $script:NodeVersion) { throw 'Electron does not match the inspected pilot runtime.' }
    }
    finally {
        # Restore inspection flags before any cleanup that could fail, so a
        # subsequent Electron GUI does not inherit Node inspection mode.
        $env:ELECTRON_RUN_AS_NODE = $previousNode
        $env:ELECTRON_NO_ATTACH_CONSOLE = $previousConsole
        if (Test-Path -LiteralPath $directory) { Remove-Item -LiteralPath $directory -Recurse -Force }
    }
}

Export-ModuleMember -Function Get-KioskSettings, Assert-KioskApiReady, Get-TunnelArguments, Assert-ArchiveHash, Get-KioskTools, Invoke-KioskPnpm, Install-KioskTools, Assert-KioskRuntime, Invoke-KioskWebRequest, Assert-KioskBuild
