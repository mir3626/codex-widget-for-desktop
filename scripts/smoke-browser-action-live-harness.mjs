import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tempDir = mkdtempSync(path.join(tmpdir(), "codex-widget-browser-action-live-harness-"));
const outputDir = path.join(tempDir, "artifacts");
const reportPath = path.join(tempDir, "report.md");

try {
  const run = spawnSync(process.execPath, [
    "scripts/browser-action-live-runner.mjs",
    "--dry-run",
    "--scenario",
    "local-concept-random-post",
    "--scenario",
    "local-back-single-step",
    "--output-dir",
    outputDir,
    "--report",
    reportPath
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: "pipe"
  });

  if (run.status !== 0) {
    throw new Error(`live harness dry-run failed\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`);
  }
  const dryRunPath = path.join(outputDir, "dry-run.json");
  if (!existsSync(dryRunPath) || !existsSync(reportPath)) {
    throw new Error("live harness dry-run did not write expected dry-run/report artifacts");
  }
  const dryRun = JSON.parse(readFileSync(dryRunPath, "utf8"));
  if (dryRun.scenarioCount !== 2 || !dryRun.scenarios.some((scenario) => scenario.id === "local-back-single-step")) {
    throw new Error(`live harness dry-run selected unexpected scenarios: ${JSON.stringify(dryRun)}`);
  }
  const report = readFileSync(reportPath, "utf8");
  if (!report.includes("Dry-run scenarios: local-concept-random-post, local-back-single-step")) {
    throw new Error(`live harness dry-run report did not list selected scenarios: ${report}`);
  }
  console.log("browser action live harness smoke ok");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
