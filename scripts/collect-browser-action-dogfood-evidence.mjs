import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BrowserActionAdapterRegistry,
  BrowserActionSessionManager,
  buildElementGraph,
  playwrightAdapter,
  resolveTarget,
} from "../dist/daemon/browser-action/index.js";

const evidenceDate = process.env.BROWSER_ACTION_DOGFOOD_DATE || "2026-05-10";
const reportPath = join("docs", "reports", `browser-action-dogfood-evidence-${evidenceDate}.md`);
const assetDir = join("docs", "reports", "assets", `browser-action-dogfood-${evidenceDate}`);
const jsonPath = join(assetDir, "evidence.json");
const screenshotPath = join(assetDir, "example-com-before.png");
const startUrl = "https://example.com/";

await mkdir(assetDir, { recursive: true });

const session = {
  id: `browser-action-dogfood-${evidenceDate}`,
  startedAt: new Date().toISOString(),
  source: { kind: "controlled_browser", browser: "chromium", url: startUrl },
  mode: "auto_safe_actions",
  status: "active",
  timeline: [],
  approvals: []
};
const manager = new BrowserActionSessionManager(new BrowserActionAdapterRegistry([playwrightAdapter]));
manager.start({ id: session.id, mode: session.mode, source: session.source });
const transaction = manager.beginInteraction({
  requestId: `browser-action-dogfood-${evidenceDate}`,
  actionSessionId: session.id,
  sessionId: session.id,
  utterance: "Example Domain을 읽고 Learn more 링크를 눌러 이동을 확인해줘",
  source: "prompt",
  mode: "auto_safe_actions",
  browserSource: session.source
});

const transcript = [];
const observed = await manager.observeViaAdapter({ actionSessionId: session.id, adapterId: "playwright", providerState: { url: startUrl } });
const before = observed.observation;
transcript.push({
  step: "observe",
  adapter: "playwright",
  url: before.url,
  title: before.title,
  textLength: before.text?.length ?? 0,
  elements: before.elements.map((element) => ({ id: element.id, role: element.role, label: element.label, text: element.text, selector: element.selector })).slice(0, 20)
});

const screenshot = await manager.execute({
  actionSessionId: session.id,
  adapterId: "playwright",
  snapshot: {},
  transaction,
  action: { type: "screenshot", fullPage: false }
});
const dataUrl = String(screenshot.result.after?.screenshot?.dataUrl ?? "");
if (!dataUrl.startsWith("data:image/png;base64,")) {
  throw new Error("Dogfood screenshot action did not return PNG image evidence.");
}
await writeFile(screenshotPath, Buffer.from(dataUrl.split(",", 2)[1], "base64"));
transcript.push({
  step: "screenshot",
  adapter: "playwright",
  ok: screenshot.result.status === "succeeded",
  safety: screenshot.result.safety.decision,
  verification: screenshot.result.verification,
  asset: screenshotPath
});

const graph = buildElementGraph({ observationId: before.id, elements: before.elements });
const linkResolution = resolveTarget({ graph, target: { kind: "text", text: "Learn more", role: "link" } });
if (!linkResolution.primary) {
  throw new Error(`Dogfood target resolver did not find the Example Domain information link: ${JSON.stringify(linkResolution)}`);
}
const clicked = await manager.execute({
  actionSessionId: session.id,
  adapterId: "playwright",
  snapshot: {},
  transaction,
  expected: [{ type: "custom", description: "Target activation produces the expected visible page, route, selection, or content change." }],
  action: { type: "click", target: { kind: "element_id", id: linkResolution.primary.id } }
});
transcript.push({
  step: "click",
  adapter: "playwright",
  target: {
    id: linkResolution.primary.id,
    selector: linkResolution.primary.selector,
    label: linkResolution.primary.label,
    text: linkResolution.primary.text,
    confidence: linkResolution.confidence
  },
  ok: clicked.result.status === "succeeded",
  safety: clicked.result.safety.decision,
  beforeUrl: before.url,
  afterUrl: clicked.result.after?.url,
  afterTitle: clicked.result.after?.title,
  verification: clicked.result.verification
});

if (clicked.result.status !== "succeeded" || !String(clicked.result.after?.url ?? "").includes("iana.org")) {
  throw new Error(`Dogfood navigation did not reach IANA evidence page: ${JSON.stringify(transcript.at(-1))}`);
}

const evidence = {
  date: evidenceDate,
  adapter: "playwright",
  startUrl,
  transcript,
  semanticAcceptance: {
    observedRealSite: true,
    executedSafeAction: true,
    capturedBeforeAfter: true,
    screenshotAsset: screenshotPath,
    notes: "Safe read/screenshot/link navigation against public Example Domain; no credentials or form submission."
  },
  transactionEvidence: {
    transactionId: transaction.transactionId,
    clickResultTransaction: clicked.result.transaction,
    verificationStatus: clicked.result.verification.status,
    verificationReason: clicked.result.verification.reason,
    expectedEffectChecked: true
  }
};

await writeFile(jsonPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
await writeFile(reportPath, renderReport(evidence), "utf8");
console.log(`browser action dogfood evidence written: ${reportPath}`);

function renderReport(evidence) {
  const click = evidence.transcript.find((entry) => entry.step === "click");
  const observe = evidence.transcript.find((entry) => entry.step === "observe");
  return `# Browser Action Dogfood Evidence - ${evidence.date}

## Scope

- Feature: Browser Action Interface semantic acceptance
- Adapter: ${evidence.adapter}
- Site: ${evidence.startUrl}
- Task: observe a real public page, capture a screenshot, resolve the information link, click it, and verify navigation.
- Safety: safe read/screenshot/link navigation only; no credentials, no submit, no file transfer, no destructive action.

## Before Observation

- URL: ${observe.url}
- Title: ${observe.title}
- Text length: ${observe.textLength}
- Interactive elements captured: ${observe.elements.length}

## Action Transcript

1. observe via Playwright adapter: captured structured elements from Example Domain.
2. screenshot via typed Browser Action: saved \`${screenshotPath.replace(/\\/g, "/")}\`.
3. target resolve: selected \`${click.target.text || click.target.label}\` with confidence ${click.target.confidence}.
4. click via typed Browser Action: before \`${click.beforeUrl}\`, after \`${click.afterUrl}\`.

## Verification

- Click result: ${click.ok ? "passed" : "failed"}
- Verification status: ${click.verification.status}
- Verification reason: ${click.verification.reason}
- Transaction id: \`${evidence.transactionEvidence.transactionId}\`
- Result transaction metadata: \`${JSON.stringify(evidence.transactionEvidence.clickResultTransaction)}\`
- Supporting JSON: \`${jsonPath.replace(/\\/g, "/")}\`

## Notes

This is semantic dogfood evidence, not product-code unit coverage. It proves the production Browser Action adapter path can observe a real browser page, resolve a target, perform a harmless typed action, and produce before/after verification evidence without using arbitrary JavaScript as the default action abstraction.
`;
}
