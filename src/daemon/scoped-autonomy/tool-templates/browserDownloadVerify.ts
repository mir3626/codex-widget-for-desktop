export const BROWSER_DOWNLOAD_VERIFY_TOOL = String.raw`
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdin += chunk;
});
process.stdin.on("end", () => {
  try {
    const request = JSON.parse(stdin || "{}");
    const command = typeof request.command === "string" ? request.command : "execute";
    const input = request.input && typeof request.input === "object" ? request.input : {};
    const outputDir = typeof input.outputDir === "string" && input.outputDir ? input.outputDir : process.cwd();
    mkdirSync(outputDir, { recursive: true });
    if (command === "smoke" && typeof input.filePath !== "string") {
      const fixture = join(outputDir, "fixture-download.txt");
      writeFileSync(fixture, "fixture download\n", "utf8");
      input.filePath = fixture;
      input.minBytes = 4;
    }
    if (command !== "smoke" && command !== "execute" && command !== "verify_artifact") {
      throw new Error("unknown_command:" + command);
    }
    const filePath = typeof input.filePath === "string" ? input.filePath : "";
    const exists = filePath ? existsSync(filePath) : false;
    const bytes = exists ? readFileSync(filePath) : Buffer.alloc(0);
    const size = exists ? statSync(filePath).size : 0;
    const sha256 = exists ? createHash("sha256").update(bytes).digest("hex") : "";
    const minBytes = Number.isFinite(Number(input.minBytes)) ? Number(input.minBytes) : 1;
    const expectedSha256 = typeof input.sha256 === "string" ? input.sha256.toLowerCase() : "";
    const verified = exists && size >= minBytes && (!expectedSha256 || expectedSha256 === sha256);
    const resultPath = join(outputDir, "download-verification.json");
    const result = { ok: verified, stage: "download_verify", exists, size, sha256, expectedSha256, fileName: filePath.split(/[\\/]/).pop() || "" };
    writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");
    process.stdout.write(JSON.stringify({
      ...result,
      artifacts: [{ role: "download_verification", path: resultPath, mime: "application/json" }]
    }));
    if (!verified) {
      process.exitCode = 1;
    }
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: error && error.message ? error.message : String(error) }));
    process.exitCode = 1;
  }
});
`;
