import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const helperPath = path.resolve("providers/screen-capture-helper/capture-screen.ps1");
const helper = await readFile(helperPath, "utf8");

for (const marker of [
  "System.Windows.Forms.SystemInformation",
  "CopyFromScreen",
  "image/jpeg",
  "data:image/jpeg;base64",
  "CropWidth",
  "Select-CropRectangle",
  "CODEX_WIDGET_SCREEN_OCR_COMMAND",
  "CODEX_WIDGET_SCREEN_OCR_LANGUAGE",
  "DisableOcrPreprocess",
  "CODEX_WIDGET_SCREEN_OCR_RUNTIME_DIR",
  "Resolve-OcrLanguage",
  "New-OcrBitmap",
  "Save-PngFile",
  "Resolve-BundledOcrCommand",
  "dist\\ocr-runtime",
  "Invoke-OcrCommand",
  "ocrText = $ocrText",
  "/providers/screen/snapshot",
  "System.Net.Http.HttpClient",
  "screen snapshot sent"
]) {
  if (!helper.includes(marker)) {
    throw new Error(`Screen helper is missing marker: ${marker}`);
  }
}

const parse = spawnSync(
  "powershell",
  [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `$null = [scriptblock]::Create((Get-Content -Raw -LiteralPath '${escapePowerShellLiteral(helperPath)}')); 'screen helper parse ok'`
  ],
  { encoding: "utf8" }
);

if (parse.status !== 0) {
  throw new Error([parse.stdout, parse.stderr].filter(Boolean).join("\n"));
}

console.log(parse.stdout.trim());

function escapePowerShellLiteral(value) {
  return value.replaceAll("'", "''");
}
