$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$Cli = Join-Path $RepoRoot 'bin\feishu-codex-bridge.mjs'
$StateDir = Join-Path $env:USERPROFILE '.feishu-codex-bridge'
$LogDir = Join-Path $StateDir 'logs'
$StartupDir = [Environment]::GetFolderPath('Startup')
$StartupCmd = Join-Path $StartupDir 'FeishuCodexBridge.cmd'
$CodexHome = $env:CODEX_HOME
if ([string]::IsNullOrWhiteSpace($CodexHome)) {
  $CodexHome = 'C:\CodexData'
}
$CodexConfig = Join-Path $CodexHome 'config.toml'

function Get-TomlStringValue {
  param(
    [string]$Path,
    [string]$Key
  )

  if (!(Test-Path -LiteralPath $Path)) {
    return $null
  }

  $pattern = '^\s*' + [regex]::Escape($Key) + '\s*=\s*"([^"]*)"'
  $line = Select-String -LiteralPath $Path -Pattern $pattern | Select-Object -First 1
  if ($null -eq $line) {
    return $null
  }
  return [regex]::Match($line.Line, $pattern).Groups[1].Value
}

Write-Host "Bridge status:"
& node $Cli ps
Write-Host ""
Write-Host "Config:"
Write-Host "  $StateDir"
Write-Host ""
Write-Host "Logs:"
Write-Host "  $(Join-Path $LogDir 'manual-stdout.log')"
Write-Host "  $(Join-Path $LogDir 'manual-stderr.log')"
Write-Host "  $(Join-Path $LogDir "$(Get-Date -Format 'yyyy-MM-dd').log")"
Write-Host ""
Write-Host "Codex:"
Write-Host "  CODEX_HOME: $CodexHome"
Write-Host "  config: $CodexConfig"
if (![string]::IsNullOrWhiteSpace($env:FEISHU_CODEX_WORKSPACE_ROOT)) {
  Write-Host "  FEISHU_CODEX_WORKSPACE_ROOT: $env:FEISHU_CODEX_WORKSPACE_ROOT"
}
$CodexModel = Get-TomlStringValue -Path $CodexConfig -Key 'model'
$CodexReasoning = Get-TomlStringValue -Path $CodexConfig -Key 'model_reasoning_effort'
if ($null -ne $CodexModel) {
  Write-Host "  model: $CodexModel"
} else {
  Write-Host "  model: (not found)"
}
if ($null -ne $CodexReasoning) {
  Write-Host "  model_reasoning_effort: $CodexReasoning"
}
Write-Host ""
Write-Host "User login startup:"
if (Test-Path -LiteralPath $StartupCmd) {
  Write-Host "  enabled: $StartupCmd"
} else {
  Write-Host "  disabled"
}
