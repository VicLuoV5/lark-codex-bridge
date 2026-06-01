param(
  [switch]$Restart
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$WorkspaceRoot = Resolve-Path (Join-Path $RepoRoot '..')
$Cli = Join-Path $RepoRoot 'bin\feishu-codex-bridge.mjs'
$StateDir = Join-Path $env:USERPROFILE '.feishu-codex-bridge'
$LogDir = Join-Path $StateDir 'logs'
$ProcessFile = Join-Path $StateDir 'processes.json'
$StdoutLog = Join-Path $LogDir 'manual-stdout.log'
$StderrLog = Join-Path $LogDir 'manual-stderr.log'
$LauncherCmd = Join-Path $StateDir 'run-bridge.cmd'
$CodexHome = $env:CODEX_HOME
if ([string]::IsNullOrWhiteSpace($CodexHome)) {
  $CodexHome = 'C:\CodexData'
}
$ProxyUrl = $env:FEISHU_CODEX_BRIDGE_PROXY
if ([string]::IsNullOrWhiteSpace($ProxyUrl)) {
  $ProxyUrl = $env:HTTPS_PROXY
}
if ([string]::IsNullOrWhiteSpace($ProxyUrl)) {
  $ProxyUrl = $env:HTTP_PROXY
}

function Get-LiveBridgeEntries {
  if (!(Test-Path -LiteralPath $ProcessFile)) {
    return @()
  }

  try {
    $json = [System.IO.File]::ReadAllText($ProcessFile, [System.Text.Encoding]::UTF8)
    $state = $json | ConvertFrom-Json
  } catch {
    return @()
  }

  $entries = @($state.entries)
  $live = @()
  foreach ($entry in $entries) {
    if ($null -eq $entry.pid) {
      continue
    }
    $proc = Get-Process -Id ([int]$entry.pid) -ErrorAction SilentlyContinue
    if ($null -ne $proc) {
      $live += $entry
    }
  }
  return $live
}

function Invoke-BridgeCli {
  param([string[]]$Arguments)
  & node $Cli @Arguments
}

function Stop-BridgeLauncherProcesses {
  $launchers = @()
  try {
    $launchers = @(
      Get-CimInstance Win32_Process -Filter "Name = 'cmd.exe'" |
        Where-Object {
          $_.CommandLine -like '*run-bridge.cmd*' -and
          $_.CommandLine -like '*feishu-codex-bridge*'
        }
    )
  } catch {
    Write-Warning "Could not inspect existing bridge launcher processes: $($_.Exception.Message)"
    return
  }

  foreach ($launcher in $launchers) {
    if ([int]$launcher.ProcessId -eq $PID) {
      continue
    }
    Write-Host "Stopping existing bridge launcher process $($launcher.ProcessId)..."
    Stop-Process -Id ([int]$launcher.ProcessId) -Force -ErrorAction SilentlyContinue
  }

  if ($launchers.Count -gt 0) {
    Start-Sleep -Seconds 1
  }
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$live = @(Get-LiveBridgeEntries)
if ($live.Count -gt 0) {
  if (!$Restart) {
    Write-Host "Bridge is already running:"
    Invoke-BridgeCli @('ps')
    exit 0
  }

  foreach ($entry in $live) {
    Write-Host "Stopping existing bridge $($entry.id)..."
    Invoke-BridgeCli @('kill', [string]$entry.id)
  }
}

Stop-BridgeLauncherProcesses

$node = (Get-Command node -ErrorAction Stop).Source
$launcherContent = @"
@echo off
set "BRIDGE_LOG_DIR=%USERPROFILE%\.feishu-codex-bridge\logs"
set "CODEX_HOME=$CodexHome"
set "FEISHU_CODEX_WORKSPACE_ROOT=$WorkspaceRoot"
if exist "%APPDATA%\npm" (
  set "PATH=%APPDATA%\npm;%PATH%"
)
if not "$ProxyUrl"=="" (
  set "HTTP_PROXY=$ProxyUrl"
  set "HTTPS_PROXY=$ProxyUrl"
)
set "BRIDGE_WATCHDOG_SECONDS=60"
>>"%BRIDGE_LOG_DIR%\manual-stdout.log" echo [bridge-start] CODEX_HOME=%CODEX_HOME%
>>"%BRIDGE_LOG_DIR%\manual-stdout.log" echo [bridge-start] FEISHU_CODEX_WORKSPACE_ROOT=%FEISHU_CODEX_WORKSPACE_ROOT%
if not "$ProxyUrl"=="" (
  >>"%BRIDGE_LOG_DIR%\manual-stdout.log" echo [bridge-start] proxy=$ProxyUrl
)
if exist "%CODEX_HOME%\config.toml" (
  findstr /R /C:"^model[ ]*=" /C:"^model_reasoning_effort[ ]*=" "%CODEX_HOME%\config.toml" >>"%BRIDGE_LOG_DIR%\manual-stdout.log"
)
cd /d "$RepoRoot"
:watchdog
>>"%BRIDGE_LOG_DIR%\manual-stdout.log" echo [bridge-watchdog] starting bridge %DATE% %TIME%
"$node" "$Cli" run 1>>"%BRIDGE_LOG_DIR%\manual-stdout.log" 2>>"%BRIDGE_LOG_DIR%\manual-stderr.log"
set "BRIDGE_EXIT_CODE=%ERRORLEVEL%"
if "%BRIDGE_EXIT_CODE%"=="0" exit /b 0
>>"%BRIDGE_LOG_DIR%\manual-stdout.log" echo [bridge-watchdog] bridge exited with code %BRIDGE_EXIT_CODE%, restart in %BRIDGE_WATCHDOG_SECONDS% seconds
timeout /t 60 /nobreak >nul
goto watchdog
"@
Set-Content -LiteralPath $LauncherCmd -Value $launcherContent -Encoding ASCII
Set-Content -LiteralPath $StdoutLog -Value '' -Encoding ASCII
Set-Content -LiteralPath $StderrLog -Value '' -Encoding ASCII

$command = 'cmd.exe /d /c call "%USERPROFILE%\.feishu-codex-bridge\run-bridge.cmd"'
$launcher = New-Object -ComObject WScript.Shell
$launchResult = $launcher.Run($command, 0, $false)
if ($launchResult -ne 0) {
  throw "Failed to launch bridge command. Exit code: $launchResult"
}

Start-Sleep -Seconds 3

Write-Host "Started bridge launcher."
Invoke-BridgeCli @('ps')
Write-Host "Logs:"
Write-Host "  $StdoutLog"
Write-Host "  $StderrLog"
