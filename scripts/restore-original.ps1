param(
  [string]$InstallDir = 'D:\AI\gongzuoliu\H3 design\MiniMax Design'
)

$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path -Parent $PSScriptRoot
Push-Location $ProjectDir
try {
  node .\src\cli.js unpatch --install-dir $InstallDir
} finally {
  Pop-Location
}
