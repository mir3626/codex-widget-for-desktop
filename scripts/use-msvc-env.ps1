$ErrorActionPreference = "Stop"

$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $vswhere)) {
  throw "vswhere.exe was not found. Install Visual Studio Build Tools first."
}

$installPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $installPath) {
  throw "MSVC C++ tools are not installed. Open Visual Studio Installer and add 'Desktop development with C++'."
}

$vsDevCmd = Join-Path $installPath "Common7\Tools\VsDevCmd.bat"
if (-not (Test-Path $vsDevCmd)) {
  throw "VsDevCmd.bat was not found under $installPath."
}

$envDump = & cmd /s /c "`"$vsDevCmd`" -arch=x64 -host_arch=x64 >nul && set"
foreach ($line in $envDump) {
  if ($line -match "^(.*?)=(.*)$") {
    [Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
  }
}

$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if (Test-Path $cargoBin) {
  $env:Path = "$cargoBin;$env:Path"
}

Write-Host "MSVC environment loaded from $installPath"
Write-Host "link.exe: $(Get-Command link.exe -ErrorAction Stop | Select-Object -ExpandProperty Source)"
Write-Host "cargo: $(Get-Command cargo.exe -ErrorAction Stop | Select-Object -ExpandProperty Source)"
