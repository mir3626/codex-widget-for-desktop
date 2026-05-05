param(
  [string]$DaemonUrl = "http://127.0.0.1:4128",
  [string]$Description = "",
  [int]$MaxWidth = 1600,
  [int]$JpegQuality = 72,
  [string]$OcrCommand = "",
  [string]$OcrLanguage = "",
  [int]$OcrScale = 2,
  [int]$OcrMaxWidth = 2400,
  [int]$OcrMaxChars = 20000,
  [switch]$DisableOcr,
  [switch]$DisableOcrPreprocess,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Net.Http

function Save-JpegBytes {
  param(
    [Parameter(Mandatory = $true)]
    [System.Drawing.Bitmap]$Bitmap,
    [int]$Quality
  )

  $memory = [System.IO.MemoryStream]::new()
  $encoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
    Where-Object { $_.MimeType -eq "image/jpeg" } |
    Select-Object -First 1
  $encoderParams = [System.Drawing.Imaging.EncoderParameters]::new(1)
  $clampedQuality = [Math]::Min(100, [Math]::Max(1, $Quality))
  $encoderParams.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new(
    [System.Drawing.Imaging.Encoder]::Quality,
    [int64]$clampedQuality
  )

  $Bitmap.Save($memory, $encoder, $encoderParams)
  return $memory.ToArray()
}

function Resize-Bitmap {
  param(
    [Parameter(Mandatory = $true)]
    [System.Drawing.Bitmap]$Bitmap,
    [int]$TargetWidth
  )

  if ($TargetWidth -le 0 -or $Bitmap.Width -le $TargetWidth) {
    return $Bitmap
  }

  $targetHeight = [Math]::Max(1, [int][Math]::Round($Bitmap.Height * ($TargetWidth / $Bitmap.Width)))
  $resized = [System.Drawing.Bitmap]::new($TargetWidth, $targetHeight)
  $graphics = [System.Drawing.Graphics]::FromImage($resized)
  try {
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.DrawImage($Bitmap, 0, 0, $TargetWidth, $targetHeight)
  } finally {
    $graphics.Dispose()
  }

  $Bitmap.Dispose()
  return $resized
}

function New-OcrBitmap {
  param(
    [Parameter(Mandatory = $true)]
    [System.Drawing.Bitmap]$Bitmap,
    [int]$Scale,
    [int]$MaxWidth
  )

  $safeScale = [Math]::Max(1, $Scale)
  $targetWidth = [int][Math]::Round($Bitmap.Width * $safeScale)
  if ($MaxWidth -gt 0) {
    $targetWidth = [Math]::Min($MaxWidth, $targetWidth)
  }
  $targetWidth = [Math]::Max(1, $targetWidth)
  $targetHeight = [Math]::Max(1, [int][Math]::Round($Bitmap.Height * ($targetWidth / $Bitmap.Width)))

  $ocrBitmap = [System.Drawing.Bitmap]::new($targetWidth, $targetHeight)
  $graphics = [System.Drawing.Graphics]::FromImage($ocrBitmap)
  try {
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.DrawImage($Bitmap, 0, 0, $targetWidth, $targetHeight)
  } finally {
    $graphics.Dispose()
  }

  return $ocrBitmap
}

function Save-PngFile {
  param(
    [Parameter(Mandatory = $true)]
    [System.Drawing.Bitmap]$Bitmap,
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $Bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
}

function Quote-CmdArgument {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Value
  )

  return '"' + ($Value -replace '"', '\"') + '"'
}

function Resolve-OcrCommand {
  if ($DisableOcr) {
    return ""
  }

  if (-not [string]::IsNullOrWhiteSpace($OcrCommand)) {
    return $OcrCommand.Trim()
  }

  if (-not [string]::IsNullOrWhiteSpace($env:CODEX_WIDGET_SCREEN_OCR_COMMAND)) {
    return $env:CODEX_WIDGET_SCREEN_OCR_COMMAND.Trim()
  }

  $bundledOcrCommand = Resolve-BundledOcrCommand
  if (-not [string]::IsNullOrWhiteSpace($bundledOcrCommand)) {
    return $bundledOcrCommand
  }

  $tesseract = Get-Command tesseract -ErrorAction SilentlyContinue
  if ($tesseract) {
    $command = "tesseract {image} stdout"
    $language = Resolve-OcrLanguage
    if (-not [string]::IsNullOrWhiteSpace($language)) {
      $command = "$command -l $(Quote-CmdArgument -Value $language)"
    }
    return $command
  }

  return ""
}

function Resolve-OcrLanguage {
  param(
    [string]$TessdataPath = ""
  )

  if (-not [string]::IsNullOrWhiteSpace($OcrLanguage)) {
    return $OcrLanguage.Trim()
  }

  if (-not [string]::IsNullOrWhiteSpace($env:CODEX_WIDGET_SCREEN_OCR_LANGUAGE)) {
    return $env:CODEX_WIDGET_SCREEN_OCR_LANGUAGE.Trim()
  }

  if ([string]::IsNullOrWhiteSpace($TessdataPath) -or -not (Test-Path -LiteralPath $TessdataPath -PathType Container)) {
    return ""
  }

  $languages = @{}
  Get-ChildItem -LiteralPath $TessdataPath -Filter "*.traineddata" -File -ErrorAction SilentlyContinue | ForEach-Object {
    $name = [System.IO.Path]::GetFileNameWithoutExtension($_.Name)
    if (-not [string]::IsNullOrWhiteSpace($name)) {
      $languages[$name] = $true
    }
  }

  if ($languages.ContainsKey("eng") -and $languages.ContainsKey("kor")) {
    return "eng+kor"
  }
  if ($languages.ContainsKey("eng")) {
    return "eng"
  }
  if ($languages.ContainsKey("kor")) {
    return "kor"
  }

  return ""
}

function Resolve-BundledOcrCommand {
  $runtimeDir = Resolve-OcrRuntimeDirectory
  if ([string]::IsNullOrWhiteSpace($runtimeDir)) {
    return ""
  }

  $tesseractCandidates = @(
    (Join-Path $runtimeDir "tesseract.exe"),
    (Join-Path $runtimeDir "bin\tesseract.exe")
  )
  $tesseractPath = $tesseractCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
  if ([string]::IsNullOrWhiteSpace($tesseractPath)) {
    return ""
  }

  $command = "$(Quote-CmdArgument -Value $tesseractPath) {image} stdout"
  $tessdataCandidates = @(
    (Join-Path $runtimeDir "tessdata"),
    (Join-Path $runtimeDir "share\tessdata"),
    (Join-Path $runtimeDir "share\tesseract-ocr\tessdata")
  )
  $tessdataPath = $tessdataCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Container } | Select-Object -First 1
  if (-not [string]::IsNullOrWhiteSpace($tessdataPath)) {
    $command = "$command --tessdata-dir $(Quote-CmdArgument -Value $tessdataPath)"
  }
  $language = Resolve-OcrLanguage -TessdataPath $tessdataPath
  if (-not [string]::IsNullOrWhiteSpace($language)) {
    $command = "$command -l $(Quote-CmdArgument -Value $language)"
  }

  return $command
}

function Resolve-OcrRuntimeDirectory {
  $candidates = @()
  if (-not [string]::IsNullOrWhiteSpace($env:CODEX_WIDGET_SCREEN_OCR_RUNTIME_DIR)) {
    $candidates += $env:CODEX_WIDGET_SCREEN_OCR_RUNTIME_DIR.Trim()
  }
  $candidates += (Join-Path $PSScriptRoot "..\..\dist\ocr-runtime")

  foreach ($candidate in $candidates) {
    $resolved = [System.IO.Path]::GetFullPath($candidate)
    if (Test-Path -LiteralPath $resolved -PathType Container) {
      return $resolved
    }
  }

  return ""
}

function Invoke-OcrCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$CommandTemplate,
    [Parameter(Mandatory = $true)]
    [string]$ImagePath,
    [int]$MaxChars
  )

  $quotedImage = Quote-CmdArgument -Value $ImagePath
  if ($CommandTemplate.Contains("{image}")) {
    $commandLine = $CommandTemplate.Replace("{image}", $quotedImage)
  } else {
    $commandLine = "$CommandTemplate $quotedImage"
  }

  $output = & cmd.exe /d /s /c $commandLine 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "OCR command failed with exit code $LASTEXITCODE`: $($output -join "`n")"
  }

  $text = (($output | ForEach-Object { "$_" }) -join "`n").Trim()
  if ($MaxChars -gt 0 -and $text.Length -gt $MaxChars) {
    return $text.Substring(0, $MaxChars)
  }
  return $text
}

$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bitmap = [System.Drawing.Bitmap]::new($bounds.Width, $bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)

try {
  $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bounds.Size)
  $graphics.Dispose()
  $graphics = $null

  $bitmap = Resize-Bitmap -Bitmap $bitmap -TargetWidth $MaxWidth
  $bytes = Save-JpegBytes -Bitmap $bitmap -Quality $JpegQuality
  $ocrText = ""
  $ocrCommandLine = Resolve-OcrCommand
  if (-not [string]::IsNullOrWhiteSpace($ocrCommandLine)) {
    $tempImagePath = [System.IO.Path]::ChangeExtension(
      [System.IO.Path]::GetTempFileName(),
      $(if ($DisableOcrPreprocess) { ".jpg" } else { ".png" })
    )
    $ocrBitmap = $null
    try {
      if ($DisableOcrPreprocess) {
        [System.IO.File]::WriteAllBytes($tempImagePath, $bytes)
      } else {
        $ocrBitmap = New-OcrBitmap -Bitmap $bitmap -Scale $OcrScale -MaxWidth $OcrMaxWidth
        Save-PngFile -Bitmap $ocrBitmap -Path $tempImagePath
      }
      $ocrText = Invoke-OcrCommand -CommandTemplate $ocrCommandLine -ImagePath $tempImagePath -MaxChars $OcrMaxChars
    } catch {
      Write-Warning "screen OCR skipped: $($_.Exception.Message)"
      $ocrText = ""
    } finally {
      if ($ocrBitmap) {
        $ocrBitmap.Dispose()
      }
      if ($tempImagePath -and (Test-Path -LiteralPath $tempImagePath)) {
        Remove-Item -LiteralPath $tempImagePath -Force -ErrorAction SilentlyContinue
      }
    }
  }

  $imageDataUrl = "data:image/jpeg;base64,$([Convert]::ToBase64String($bytes))"
  $title = "Windows virtual screen $($bounds.Width)x$($bounds.Height)"

  $payload = @{
    source = "windows-screen-capture-helper"
    title = $title
    description = $Description
    ocrText = $ocrText
    imageDataUrl = $imageDataUrl
  } | ConvertTo-Json -Depth 4 -Compress

  if ($DryRun) {
    Write-Output "screen snapshot dry run: $title ($($ocrText.Length) ocr chars, $($imageDataUrl.Length) image chars)"
    return
  }

  $uri = "$($DaemonUrl.TrimEnd('/'))/providers/screen/snapshot"
  [System.Net.ServicePointManager]::Expect100Continue = $false
  $handler = [System.Net.Http.HttpClientHandler]::new()
  $handler.UseProxy = $false
  $client = [System.Net.Http.HttpClient]::new($handler)
  try {
    $client.Timeout = [TimeSpan]::FromSeconds(20)
    $client.DefaultRequestHeaders.ExpectContinue = $false
    $content = [System.Net.Http.StringContent]::new(
      $payload,
      [System.Text.Encoding]::UTF8,
      "application/json"
    )
    $response = $client.PostAsync($uri, $content).GetAwaiter().GetResult()
    $responseBody = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()

    if (-not $response.IsSuccessStatusCode) {
      throw "Screen snapshot POST failed ($([int]$response.StatusCode)): $responseBody"
    }

    $result = $responseBody | ConvertFrom-Json
    Write-Output "screen snapshot sent: $($result.snapshot.title) ($($ocrText.Length) ocr chars, $($result.snapshot.imageDataUrlLength) image chars)"
  } finally {
    if ($content) {
      $content.Dispose()
    }
    if ($response) {
      $response.Dispose()
    }
    $client.Dispose()
    $handler.Dispose()
  }
} finally {
  if ($graphics) {
    $graphics.Dispose()
  }
  if ($bitmap) {
    $bitmap.Dispose()
  }
}
