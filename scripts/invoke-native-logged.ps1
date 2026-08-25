function Invoke-NativeLogged {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$ArgumentList = @(),
    [Parameter(Mandatory = $true)][string]$LogFile
  )

  if (Test-Path -LiteralPath $LogFile) {
    $stream = [System.IO.File]::OpenRead($LogFile)
    try {
      $first = $stream.ReadByte()
      $second = $stream.ReadByte()
    } finally {
      $stream.Dispose()
    }
    if ($first -eq 0xFF -and $second -eq 0xFE) {
      $directory = [System.IO.Path]::GetDirectoryName($LogFile)
      $name = [System.IO.Path]::GetFileNameWithoutExtension($LogFile)
      $extension = [System.IO.Path]::GetExtension($LogFile)
      $legacyLog = [System.IO.Path]::Combine($directory, "$name.legacy-utf16$extension")
      if (Test-Path -LiteralPath $legacyLog) {
        $legacyLog = [System.IO.Path]::Combine($directory, "$name.legacy-utf16-$(Get-Date -Format 'yyyyMMdd-HHmmss')$extension")
      }
      Move-Item -LiteralPath $LogFile -Destination $legacyLog
    }
  }

  # Merge native streams inside cmd.exe. Windows PowerShell 5.1 otherwise wraps
  # every stderr line as NativeCommandError, and redirecting both streams to the
  # same file separately races on the file handle.
  $parts = @($FilePath) + $ArgumentList | ForEach-Object {
    '"' + ([string]$_).Replace('"', '""') + '"'
  }
  $quotedLog = '"' + $LogFile.Replace('"', '""') + '"'
  $commandLine = ($parts -join ' ') + " >> $quotedLog 2>&1"
  & $env:ComSpec /d /s /c $commandLine
  $exitCode = $LASTEXITCODE
  return $exitCode
}
