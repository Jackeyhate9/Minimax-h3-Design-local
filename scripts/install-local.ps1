param(
  [Parameter(Mandatory=$true)]
  [string]$InstallDir
)

$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path -Parent $PSScriptRoot
Push-Location $ProjectDir
try {
  node .\src\cli.js doctor --install-dir $InstallDir
  node .\src\cli.js patch --install-dir $InstallDir
  Write-Host 'Patch installed. Run npm run configure, select your own local models, then start with npm start.'
} finally {
  Pop-Location
}
