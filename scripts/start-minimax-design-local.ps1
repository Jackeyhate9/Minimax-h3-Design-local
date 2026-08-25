$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $repo "runtime\logs"
$logFile = Join-Path $logDir "desktop-launch.log"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Set-Location -LiteralPath $repo

try {
  $node = (Get-Command node -ErrorAction Stop).Source
  & $node "src\cli.js" "start" "--config" "config\local.json" "--install-dir" "D:\AI\gongzuoliu\H3 design\MiniMax Design" *>> $logFile
  if ($LASTEXITCODE -ne 0) { throw "Local launcher exited with code $LASTEXITCODE" }
} catch {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show("MiniMax Design Local failed to start.`n`n$($_.Exception.Message)`n`nLog: $logFile", "MiniMax Design Local") | Out-Null
}
