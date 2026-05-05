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
  "/providers/screen/snapshot",
  "System.Net.Http.HttpClient"
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
