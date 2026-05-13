param(
  [string]$OutDir = ".runtime\asr\samples",
  [string]$VoiceMatch = "Korean|Heami"
)

$ErrorActionPreference = "Stop"

$resolvedOutDir = if ([System.IO.Path]::IsPathRooted($OutDir)) {
  $OutDir
} else {
  Join-Path (Get-Location) $OutDir
}
New-Item -ItemType Directory -Force -Path $resolvedOutDir | Out-Null

$voice = New-Object -ComObject SAPI.SpVoice
$selectedVoice = $voice.GetVoices() |
  Where-Object { $_.GetDescription() -match $VoiceMatch } |
  Select-Object -First 1
if (-not $selectedVoice) {
  throw "No SAPI voice matched '$VoiceMatch'."
}
$voice.Voice = $selectedVoice

$format = New-Object -ComObject SAPI.SpAudioFormat
$format.Type = 22 # 16kHz 16-bit mono PCM

$samples = @(
  @{ Id = "browser-search"; Text = "검색창에 브라우저 액션 테스트 입력하고 검색해줘" },
  @{ Id = "browser-back"; Text = "뒤로 가서 방금 보던 글로 돌아가" },
  @{ Id = "windows-settings"; Text = "윈도우 설정에서 배터리 절약 모드가 켜져 있는지 확인해줘" },
  @{ Id = "safe-download"; Text = "저 버튼을 눌러서 다운로드를 시작하지 말고 상태만 확인해줘" },
  @{ Id = "mixed-package"; Text = "리액트 라우터 돔 설정 파일을 찾아서 열어줘" }
)

$manifest = @()
foreach ($sample in $samples) {
  $path = Join-Path $resolvedOutDir ($sample.Id + ".wav")
  $stream = New-Object -ComObject SAPI.SpFileStream
  $stream.Format = $format
  $stream.Open($path, 3, $false)
  $voice.AudioOutputStream = $stream
  [void]$voice.Speak($sample.Text, 0)
  $stream.Close()
  $manifest += [pscustomobject]@{
    id = $sample.Id
    text = $sample.Text
    path = $path
    language = "ko"
    source = "windows-sapi"
    voice = $selectedVoice.GetDescription()
  }
}

$manifestPath = Join-Path $resolvedOutDir "manifest.json"
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
[pscustomobject]@{
  manifest = $manifestPath
  samples = $manifest.Count
  voice = $selectedVoice.GetDescription()
} | ConvertTo-Json
