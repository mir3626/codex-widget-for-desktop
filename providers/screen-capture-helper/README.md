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
- `-DryRun`: capture and encode locally, but do not post to the daemon

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

The current daemon stores the image data with the latest snapshot and injects the title, description, and OCR text into the model request. Direct image-to-model delivery is a follow-up once the active Codex runtime exposes a stable image input path.
