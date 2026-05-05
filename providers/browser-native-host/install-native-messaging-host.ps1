param(
  [Parameter(Mandatory = $true)]
  [string]$ExtensionId,

  [ValidateSet("Chrome", "Edge", "Both")]
  [string]$Browser = "Both",

  [switch]$Uninstall,

  [string]$HostName = "com.mir3626.codex_widget_dom",

  [string]$HostPath
)

$ErrorActionPreference = "Stop"

if ($ExtensionId -notmatch "^[a-p]{32}$") {
  throw "ExtensionId must be the 32-character Chrome/Edge extension id."
}

$providerRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $HostPath) {
  $HostPath = Join-Path $providerRoot "codex-widget-dom-native-host.cmd"
}

$browserKeys = @()
if ($Browser -eq "Chrome" -or $Browser -eq "Both") {
  $browserKeys += "HKCU\Software\Google\Chrome\NativeMessagingHosts\$HostName"
}
if ($Browser -eq "Edge" -or $Browser -eq "Both") {
  $browserKeys += "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\$HostName"
}

if ($Uninstall) {
  foreach ($key in $browserKeys) {
    & reg.exe delete $key /f 2>$null | Out-Null
  }
  Write-Host "Codex Widget native messaging host registration removed."
  exit 0
}

if (-not (Test-Path -LiteralPath $HostPath)) {
  throw "Native host wrapper was not found: $HostPath"
}

$manifestDir = Join-Path $env:LOCALAPPDATA "Codex Widget\NativeMessaging"
New-Item -ItemType Directory -Force -Path $manifestDir | Out-Null
$manifestPath = Join-Path $manifestDir "$HostName.json"

$manifest = [ordered]@{
  name = $HostName
  description = "Codex Widget DOM Snapshot Native Host"
  path = (Resolve-Path -LiteralPath $HostPath).Path
  type = "stdio"
  allowed_origins = @("chrome-extension://$ExtensionId/")
}

$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

foreach ($key in $browserKeys) {
  & reg.exe add $key /ve /t REG_SZ /d $manifestPath /f | Out-Null
}

Write-Host "Codex Widget native messaging host registered: $manifestPath"
