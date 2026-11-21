<#
  Meeting Assistant on Windows: install, open, find and uninstall it without hunting for files.
  Normally run through the .cmd files next to this script. No administrator rights are needed:
  the app installs for your Windows user only.

    -Action Install    Installs from a Meeting-Assistant-Setup-*.exe in this folder if there is
                       one, otherwise downloads the newest published version from GitHub and
                       checks it against the checksum published with it before running it.
    -Action Open       Starts the installed app and says where it is.
    -Action Where      Says where the app, your notes and the log file are. Changes nothing.
    -Action Uninstall  Removes the app. Your meetings and notes are kept (see README.txt).
    -Installer <path>  Use this installer file.
    -Quiet             No installer windows (used by the automated test on a Windows runner).

  Exit codes: 0 done, 1 not installed, 2 no installer found, 3 something went wrong.
#>
param(
    [ValidateSet('Install', 'Open', 'Where', 'Uninstall')]
    [string]$Action = 'Where',
    [string]$Installer,
    [switch]$Quiet
)
$ErrorActionPreference = 'Stop'
# Windows PowerShell's progress bar makes large downloads many times slower.
$ProgressPreference = 'SilentlyContinue'

$Repo = 'aasimsyed-ai/meeting-bot'
$AppName = 'Meeting Assistant'
$DataDir = Join-Path $env:APPDATA $AppName

function Find-App {
    # The installer writes an uninstall entry that knows where the app went, even if a
    # different folder was chosen during install.
    $roots = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
             'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
             'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
    foreach ($root in $roots) {
        if (-not (Test-Path $root)) { continue }
        foreach ($key in Get-ChildItem $root -ErrorAction SilentlyContinue) {
            $p = Get-ItemProperty $key.PSPath -ErrorAction SilentlyContinue
            # DisplayName is "Meeting Assistant 0.1.0".
            if (-not $p.DisplayName -or $p.DisplayName -notmatch "^$AppName( |$)") { continue }
            $exe = $null
            if ($p.DisplayIcon) { $exe = ($p.DisplayIcon -replace ',\d+$', '').Trim('"') }
            if (-not ($exe -and $exe -like '*.exe' -and (Test-Path $exe))) {
                $uninstaller = ([regex]::Match([string]$p.UninstallString, '^"([^"]+)"')).Groups[1].Value
                if ($uninstaller) { $exe = Join-Path (Split-Path $uninstaller) "$AppName.exe" }
            }
            if ($exe -and (Test-Path $exe)) {
                return [pscustomobject]@{
                    Exe            = $exe
                    Version        = $p.DisplayVersion
                    Uninstall      = $p.UninstallString
                    QuietUninstall = $p.QuietUninstallString
                }
            }
        }
    }
    $default = Join-Path $env:LOCALAPPDATA "Programs\$AppName\$AppName.exe"
    if (Test-Path $default) {
        return [pscustomobject]@{ Exe = $default; Version = $null; Uninstall = $null; QuietUninstall = $null }
    }
    return $null
}

function Show-Where($app) {
    if ($app) {
        $version = ''
        if ($app.Version) { $version = " (version $($app.Version))" }
        Write-Host "App:            $($app.Exe)$version"
    } else {
        Write-Host 'App:            not installed'
    }
    Write-Host "Notes and data: $DataDir"
    Write-Host "Log file:       $(Join-Path $DataDir 'logs\main.log')"
}

# Waits for this process only. Start-Process -Wait would also wait for the app if the
# installer's last page starts it, and keep this window open until the app is closed.
function Invoke-AndWait([string]$File, [string[]]$Arguments) {
    if ($Arguments -and $Arguments.Count -gt 0) {
        $proc = Start-Process -FilePath $File -ArgumentList $Arguments -PassThru
    } else {
        $proc = Start-Process -FilePath $File -PassThru
    }
    $null = $proc.Handle   # keeps the exit code readable after the process ends
    $proc.WaitForExit()
    return $proc.ExitCode
}

function Get-ExpectedSha512([string]$YmlPath, [string]$FileName) {
    # latest.yml, published with every release, lists each installer with its SHA-512 (base64).
    $text = Get-Content -Raw -Path $YmlPath
    foreach ($m in [regex]::Matches($text, '(?m)^\s*-\s*url:\s*(\S+)\s*\r?\n\s*sha512:\s*(\S+)')) {
        if ($m.Groups[1].Value -eq $FileName) { return $m.Groups[2].Value }
    }
    return $null
}

function Get-Sha512Base64([string]$Path) {
    $sha = [Security.Cryptography.SHA512]::Create()
    $stream = [IO.File]::OpenRead($Path)
    try { return [Convert]::ToBase64String($sha.ComputeHash($stream)) }
    finally { $stream.Dispose(); $sha.Dispose() }
}

function Get-LatestInstaller {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $page = "https://github.com/$Repo/releases"
    Write-Host 'Looking for the newest version on GitHub...'
    try {
        $release = Invoke-RestMethod -UseBasicParsing -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ 'User-Agent' = 'MeetingAssistant-Install' }
    } catch {
        Write-Host ''
        Write-Host 'No published version was found on GitHub yet.'
        Write-Host "Download Meeting-Assistant-Setup-<version>.exe from $page,"
        Write-Host 'put it in this folder, and double-click Install.cmd again.'
        exit 2
    }
    $asset = $release.assets | Where-Object { $_.name -match '^Meeting-Assistant-Setup-.*\.exe$' } | Select-Object -First 1
    if (-not $asset) {
        Write-Host "Version $($release.tag_name) has no Windows installer. See $page"
        exit 2
    }
    $dest = Join-Path $env:TEMP $asset.name
    Write-Host "Downloading $($asset.name) ($([math]::Round($asset.size / 1MB)) MB). This can take a few minutes..."
    Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -OutFile $dest
    if ((Get-Item $dest).Length -ne $asset.size) {
        Remove-Item $dest -Force
        throw 'The download was incomplete. Please try again.'
    }
    $yml = $release.assets | Where-Object { $_.name -eq 'latest.yml' } | Select-Object -First 1
    if (-not $yml) {
        Remove-Item $dest -Force
        throw 'This version has no checksum file (latest.yml), so the download cannot be checked. Nothing was installed.'
    }
    $ymlPath = Join-Path $env:TEMP 'meeting-assistant-latest.yml'
    Invoke-WebRequest -UseBasicParsing -Uri $yml.browser_download_url -OutFile $ymlPath
    $expected = Get-ExpectedSha512 $ymlPath $asset.name
    Remove-Item $ymlPath -Force
    if (-not $expected -or (Get-Sha512Base64 $dest) -ne $expected) {
        Remove-Item $dest -Force
        throw 'The downloaded file does not match its published checksum, so it was deleted. Nothing was installed.'
    }
    Write-Host 'Download checked: it matches the checksum published with it.'
    return $dest
}

function Install-App {
    if ($Installer) {
        if (-not (Test-Path $Installer)) { throw "Installer not found: $Installer" }
        $setup = (Resolve-Path $Installer).Path
    } else {
        $local = Get-ChildItem -Path $PSScriptRoot -Filter 'Meeting-Assistant-Setup-*.exe' -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($local) {
            Write-Host "Using $($local.Name) from this folder."
            $setup = $local.FullName
        } else {
            $setup = Get-LatestInstaller
        }
    }
    Write-Host 'Running the installer. Follow its steps; it installs for your Windows user only.'
    $installArgs = @()
    if ($Quiet) { $installArgs = @('/S', '/currentuser') }
    $code = Invoke-AndWait $setup $installArgs
    if ($code -ne 0) { throw "The installer stopped without finishing (code $code). Nothing else was changed." }
    $app = Find-App
    if (-not $app) { throw 'The installer finished, but the app could not be found. Was it cancelled?' }
    Write-Host ''
    Write-Host 'Installed. Open it from the Start menu or the desktop icon "Meeting Assistant", or with Open.cmd.'
    Show-Where $app
}

function Open-App {
    $app = Find-App
    if (-not $app) {
        Write-Host 'Meeting Assistant is not installed yet. Double-click Install.cmd first.'
        exit 1
    }
    Start-Process -FilePath $app.Exe
    Write-Host 'Opening Meeting Assistant.'
    Show-Where $app
}

function Uninstall-App {
    $app = Find-App
    if (-not $app) {
        Write-Host 'Meeting Assistant is not installed, so there is nothing to remove.'
        exit 1
    }
    $command = $app.Uninstall
    if ($Quiet) { $command = $app.QuietUninstall }
    $m = [regex]::Match([string]$command, '^"([^"]+)"\s*(.*)$')
    if ($m.Success) {
        $file = $m.Groups[1].Value
        $uninstallArgs = @($m.Groups[2].Value -split '\s+' | Where-Object { $_ })
    } else {
        $file = Join-Path (Split-Path $app.Exe) "Uninstall $AppName.exe"
        $uninstallArgs = @('/currentuser')
        if ($Quiet) { $uninstallArgs += '/S' }
    }
    if (-not (Test-Path $file)) { throw "The uninstaller was not found: $file" }
    Write-Host 'Running the uninstaller...'
    $null = Invoke-AndWait $file $uninstallArgs
    # The uninstaller copies itself to a temporary folder and finishes from there, so wait
    # until the app is really gone.
    $deadline = (Get-Date).AddMinutes(5)
    while ((Test-Path $app.Exe) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 1 }
    if (Test-Path $app.Exe) {
        Write-Host 'The app is still installed. If you cancelled the uninstaller, nothing was removed.'
        exit 3
    }
    Write-Host 'Meeting Assistant was removed.'
    if (Test-Path $DataDir) {
        Write-Host "Your meetings, notes and settings are still in $DataDir"
        Write-Host 'Delete that folder too if you want them gone.'
    }
}

try {
    switch ($Action) {
        'Install' { Install-App }
        'Open' { Open-App }
        'Uninstall' { Uninstall-App }
        'Where' {
            $app = Find-App
            Show-Where $app
            if (-not $app) { exit 1 }
        }
    }
    exit 0
} catch {
    Write-Host ''
    Write-Host "Something went wrong: $($_.Exception.Message)"
    exit 3
}
