param(
  [Parameter(Mandatory=$true)]
  [string]$InstallDir
)

$ErrorActionPreference = 'Stop'
$ProjectDir = Split-Path -Parent $PSScriptRoot
Push-Location $ProjectDir
try {
  node .\src\cli.js unpatch --install-dir $InstallDir
} finally {
  Pop-Location
}
