$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$StartScript = Join-Path $RepoRoot 'tools\windows\start-local.ps1'
$StartupDir = [Environment]::GetFolderPath('Startup')
$StartupCmd = Join-Path $StartupDir 'FeishuCodexBridge.cmd'
$LogDir = Join-Path $env:USERPROFILE '.feishu-codex-bridge\logs'

New-Item -ItemType Directory -Force -Path $StartupDir | Out-Null
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$content = @"
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$StartScript" >> "%USERPROFILE%\.feishu-codex-bridge\logs\startup-launcher.log" 2>&1
"@

Set-Content -LiteralPath $StartupCmd -Value $content -Encoding ASCII

Write-Host "User login startup installed:"
Write-Host "  $StartupCmd"
Write-Host ""
Write-Host "It will start the bridge next time you log in to Windows."
Write-Host "To start it now, run:"
Write-Host "  powershell -NoProfile -ExecutionPolicy Bypass -File `"$StartScript`""
