# Codex Widget Screen Capture Helper

This Windows PowerShell helper captures the current virtual desktop, downsizes it to a JPEG data URL, and posts it to the widget daemon's Screen/Vision snapshot endpoint.

## Use

Start the widget daemon, then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File providers\screen-capture-helper\capture-screen.ps1 -Description "What I want Codex to inspect"
```

Optional parameters:

- `-DaemonUrl`: defaults to `http://127.0.0.1:4128`
- `-Description`: short user-provided note to attach to the screen snapshot
- `-MaxWidth`: default `1600`, used to keep the payload small
- `-JpegQuality`: default `72`, clamped to `1..100`
- `-OcrCommand`: optional OCR command template. Use `{image}` where the captured JPEG path should be inserted.
- `-OcrMaxChars`: default `20000`, caps OCR text included in the snapshot.
- `-DisableOcr`: skip OCR even when a bundled or PATH Tesseract runtime is available.
- `-DryRun`: capture and encode locally, but do not post to the daemon

OCR lookup order:

1. Explicit `-OcrCommand`
2. `CODEX_WIDGET_SCREEN_OCR_COMMAND`
3. Bundled Tesseract runtime under `dist\ocr-runtime` or installed `_up_\dist\ocr-runtime`
4. `tesseract` on `PATH`

During release builds, `npm run build:ocr-runtime` prepares `dist\ocr-runtime\ocr-runtime.json`. Set `CODEX_WIDGET_OCR_RUNTIME_DIR` or `CODEX_WIDGET_TESSERACT_EXE` before building to copy a Tesseract runtime into that bundled resource directory. If neither is set, the build script searches `PATH`, `CODEX_WIDGET_TESSERACT_SEARCH_ROOTS`, and common Windows install locations such as `Program Files\Tesseract-OCR`, Chocolatey, Scoop, and per-user `LocalAppData\Programs` installs.

The helper posts:

```json
{
  "source": "windows-screen-capture-helper",
  "title": "Windows virtual screen 1920x1080",
  "description": "What I want Codex to inspect",
  "ocrText": "",
  "imageDataUrl": "data:image/jpeg;base64,..."
}
```

The current daemon stores the image data with the latest snapshot, injects the title, description, and OCR text into the model request, and attaches image data to Vision-mode app-server turns.
