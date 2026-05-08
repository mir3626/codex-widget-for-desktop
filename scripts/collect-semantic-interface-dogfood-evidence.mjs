import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createBrowserSemanticFixture,
  resolveBrowserActionTargetSemantically,
  runSemanticGoldenTraceSuite
} from "../dist/daemon/semantic-interface/index.js";
import { BrowserActionSessionManager } from "../dist/daemon/browser-action/index.js";

const now = new Date("2026-05-08T00:00:05.000Z");
const date = new Date().toISOString().slice(0, 10);
const reportPath = join("docs", "reports", `semantic-interface-dogfood-evidence-${date}.md`);

const golden = runSemanticGoldenTraceSuite({ now });
const fixture = createBrowserSemanticFixture();
const semantic = resolveBrowserActionTargetSemantically({
  observation: fixture.observation,
  action: { type: "click", target: { kind: "text", text: "개념글" } },
  target: { kind: "text", text: "개념글" },
  hint: "개념글",
  now
});

const manager = new BrowserActionSessionManager();
const session = manager.start({ id: "semantic-dogfood-live-gate", mode: "auto_safe_actions" });
manager.observe({ actionSessionId: session.id, snapshot: fixture.observation, now });
const execution = await manager.execute({
  actionSessionId: session.id,
  action: { type: "click", target: { kind: "text", text: "개념글" } },
  snapshot: fixture.observation
});

const failures = golden.filter((item) => !item.passed);
const lines = [
  "# Semantic Interface Dogfood Evidence",
  "",
  `Date: ${date}`,
  "",
  "## Summary",
  "",
  `- Golden trace cases: ${golden.length}`,
  `- Golden trace failures: ${failures.length}`,
  `- Browser live gate target: ${semantic.primary?.id ?? "(none)"}`,
  `- Browser live gate confidence: ${semantic.confidence.toFixed(4)}`,
  `- Browser live gate result status: ${execution.result.status}`,
  `- Browser live gate command queued: ${Boolean(execution.command)}`,
  `- Redacted trace attached: ${Boolean(execution.result.safety.metadata?.semanticInterface)}`,
  "",
  "## Golden Trace Results",
  "",
  "| Case | Mode | Adversarial class | Outcome | Pass | Reason |",
  "| --- | --- | --- | --- | --- | --- |",
  ...golden.map((item) => `| ${item.id} | ${item.mode} | ${item.adversarialClass ?? ""} | ${item.outcome} | ${item.passed ? "yes" : "no"} | ${escapeTable(item.reason)} |`),
  "",
  "## Browser Live Gate",
  "",
  "The Browser Action executor remained feature-owned. Semantic Interface only supplied a target-resolution decision and redacted trace metadata.",
  "",
  "```json",
  JSON.stringify({
    semantic: {
      primary: semantic.primary?.id,
      confidence: semantic.confidence,
      reason: semantic.reason,
      outcome: semantic.semantic?.outcome
    },
    execution: {
      resultStatus: execution.result.status,
      safetyDecision: execution.result.safety.decision,
      verification: execution.result.verification,
      commandQueued: Boolean(execution.command)
    }
  }, null, 2),
  "```",
  "",
  "## Notes",
  "",
  "- This evidence is deterministic and redacted.",
  "- No raw browser profile state, password, token, cookie, payment, or credential values are persisted.",
  "- This report proves semantic target resolution and live low-risk Browser Action gating on a fixture; real-site Browser Bridge dogfood remains covered by Browser Action/Bridge evidence reports."
];

mkdirSync(join("docs", "reports"), { recursive: true });
writeFileSync(reportPath, `${lines.join("\n")}\n`, "utf8");
console.log(`semantic interface dogfood evidence written: ${reportPath}`);

function escapeTable(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}
