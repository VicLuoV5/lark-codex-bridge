$ErrorActionPreference = 'Stop'

$StartupDir = [Environment]::GetFolderPath('Startup')
$StartupCmd = Join-Path $StartupDir 'FeishuCodexBridge.cmd'

if (Test-Path -LiteralPath $StartupCmd) {
  Remove-Item -LiteralPath $StartupCmd -Force
  Write-Host "User login startup removed:"
  Write-Host "  $StartupCmd"
} else {
  Write-Host "User login startup is already disabled."
}
