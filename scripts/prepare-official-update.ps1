param(
  [string]$InstallDir = 'D:\AI\gongzuoliu\MiniMax Design'
)

$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source

Write-Host '正在恢复官方文件签名状态（不会删除项目数据）…'
& $node (Join-Path $project 'src\cli.js') unpatch --install-dir $InstallDir
if ($LASTEXITCODE -ne 0) { throw "恢复官方文件失败，退出码 $LASTEXITCODE" }

Write-Host '官方文件已恢复。现在启动 MiniMax Design，让其执行官网更新。'
$exe = Join-Path $InstallDir 'current\MiniMax Design.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw "找不到 MiniMax Design: $exe" }
Start-Process -FilePath $exe -WorkingDirectory $InstallDir
Write-Host '更新完成并关闭官方程序后，请使用 H3 Design Local.exe 启动；本地补丁会自动重新应用。'
