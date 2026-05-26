param(
  [string]$Id
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$Cli = Join-Path $RepoRoot 'bin\feishu-codex-bridge.mjs'
$StateDir = Join-Path $env:USERPROFILE '.feishu-codex-bridge'
$ProcessFile = Join-Path $StateDir 'processes.json'

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

if ($Id) {
  Invoke-BridgeCli @('kill', $Id)
  exit $LASTEXITCODE
}

$live = @(Get-LiveBridgeEntries)
if ($live.Count -eq 0) {
  Write-Host "No running bridge process found."
  exit 0
}

foreach ($entry in $live) {
  Invoke-BridgeCli @('kill', [string]$entry.id)
}
