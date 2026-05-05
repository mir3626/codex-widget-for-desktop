param(
  [string]$DaemonUrl = "http://127.0.0.1:4128",
  [string]$Description = "",
  [int]$MaxWidth = 1600,
  [int]$JpegQuality = 72,
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

$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bitmap = [System.Drawing.Bitmap]::new($bounds.Width, $bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)

try {
  $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bounds.Size)
  $graphics.Dispose()
  $graphics = $null

  $bitmap = Resize-Bitmap -Bitmap $bitmap -TargetWidth $MaxWidth
  $bytes = Save-JpegBytes -Bitmap $bitmap -Quality $JpegQuality
  $imageDataUrl = "data:image/jpeg;base64,$([Convert]::ToBase64String($bytes))"
  $title = "Windows virtual screen $($bounds.Width)x$($bounds.Height)"

  $payload = @{
    source = "windows-screen-capture-helper"
    title = $title
    description = $Description
    ocrText = ""
    imageDataUrl = $imageDataUrl
  } | ConvertTo-Json -Depth 4 -Compress

  if ($DryRun) {
    Write-Output "screen snapshot dry run: $title ($($imageDataUrl.Length) image chars)"
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
    Write-Output "screen snapshot sent: $($result.snapshot.title) ($($result.snapshot.imageDataUrlLength) image chars)"
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
