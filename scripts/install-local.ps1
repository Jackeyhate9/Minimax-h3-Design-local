param(
  [string]$InstallDir = 'D:\AI\gongzuoliu\H3 design\MiniMax Design',
  [string]$Model = 'qwen3.8:latest'
)

$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path -Parent $PSScriptRoot
Push-Location $ProjectDir
try {
  node .\src\cli.js doctor --install-dir $InstallDir --model $Model
  node .\src\cli.js patch --install-dir $InstallDir --model $Model
  Write-Host 'Patch installed. Start with: npm start'
} finally {
  Pop-Location
}
