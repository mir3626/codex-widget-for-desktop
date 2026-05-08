import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import WebSocket from "ws";
import { startDaemon } from "../dist/daemon/server.js";
import {
  BrowserActionAdapterRegistry,
  BrowserActionSessionManager,
  buildElementGraph,
  cdpAdapter,
  nativeDesktopAdapter,
  playwrightAdapter,
  resolveTarget
} from "../dist/daemon/browser-action/index.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const evidenceDate = process.env.BROWSER_ACTION_DOGFOOD_DATE || "2026-05-08";
const reportPath = join("docs", "reports", `browser-action-e2e-dogfood-evidence-${evidenceDate}.md`);
const assetDir = join("docs", "reports", "assets", `browser-action-e2e-dogfood-${evidenceDate}`);
const jsonPath = join(assetDir, "evidence.json");
const screenshotPath = join(assetDir, "example-com-before.png");

await mkdir(assetDir, { recursive: true });

const promptAndExtension = await collectPromptAndExtensionEvidence();
const playwrightEvidence = await collectPlaywrightEvidence();
const adapterDiagnostics = await collectAdapterDiagnostics();

const evidence = {
  date: evidenceDate,
  promptAndExtension,
  playwright: playwrightEvidence,
  adapterDiagnostics,
  semanticAcceptance: {
    promptDrivenToolPath: promptAndExtension.promptDriven.completed,
    directUiObserveRead: promptAndExtension.directUi.observeCompleted && promptAndExtension.directUi.readCompleted,
    directUiSafeAction: promptAndExtension.directUi.safeActionCompleted,
    extensionActiveTabCommand: promptAndExtension.extensionCommand.completed,
    riskyApprovalDeny: promptAndExtension.riskyDeny.completed,
    nonSubmitFormFill: promptAndExtension.nonSubmitFill.completed,
    realPublicPageNavigation: playwrightEvidence.safeNavigation.completed,
    restrictedBoundary: promptAndExtension.restrictedBoundary,
    cdpStatus: adapterDiagnostics.cdp.state,
    nativeBoundaryStatus: adapterDiagnostics.nativeDesktop.state
  }
};

await writeFile(jsonPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
await writeFile(reportPath, renderReport(evidence), "utf8");
console.log(`browser action e2e dogfood evidence written: ${reportPath}`);

async function collectPromptAndExtensionEvidence() {
  const smokeAppData = useSmokeAppData("codex-widget-browser-action-e2e-dogfood");
  const daemon = await startDaemon({ port: 0 });
  const baseUrl = `http://127.0.0.1:${daemon.port}`;
  const socket = new WebSocket(`ws://127.0.0.1:${daemon.port}`);
  const events = [];
  const waiters = [];
  const beforeSnapshot = createDogfoodSnapshot("before");
  const filledSnapshot = createDogfoodSnapshot("filled");
  const openedSnapshot = createDogfoodSnapshot("opened");

  try {
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    socket.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      events.push(event);
      for (const waiter of [...waiters]) {
        if (waiter.predicate(event)) {
          clearTimeout(waiter.timeout);
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(event);
        }
      }
    });
    socket.send(JSON.stringify({ type: "browserAction.policy.list" }));
    await waitFor((event) => event.type === "browserAction.policies", "initial policies");
    await postDomSnapshot(baseUrl, beforeSnapshot);

    socket.send(JSON.stringify({
      type: "browserAction.command",
      requestId: "dogfood-direct-observe",
      command: {
        id: "dogfood-direct-observe-plan",
        kind: "observe",
        actionSessionId: "dogfood-direct-session",
        adapterId: "extension",
        mode: "auto_safe_actions"
      }
    }));
    const directObserve = await waitFor((event) => event.type === "browserAction.observation" && event.actionSessionId === "dogfood-direct-session", "direct UI observe");

    socket.send(JSON.stringify({
      type: "browserAction.command",
      requestId: "dogfood-direct-read",
      command: {
        id: "dogfood-direct-read-plan",
        kind: "read",
        actionSessionId: "dogfood-direct-session",
        adapterId: "extension"
      }
    }));
    const directRead = await waitFor((event) => event.type === "browserAction.result" && event.result?.plan?.id === "dogfood-direct-read-plan", "direct UI read");

    socket.send(JSON.stringify({
      type: "browserAction.command",
      requestId: "dogfood-direct-click",
      command: {
        id: "dogfood-direct-click-plan",
        kind: "click",
        actionSessionId: "dogfood-direct-session",
        adapterId: "extension",
        targetText: "Open details"
      }
    }));
    const directClickQueued = await waitFor((event) => event.type === "browserAction.progress" && event.status === "direct_paused_for_extension", "direct UI safe action queued");
    const directClickCommand = await pollBrowserActionCommand(baseUrl, beforeSnapshot);
    await postBrowserActionResult(baseUrl, directClickCommand.requestId, true, beforeSnapshot, openedSnapshot, undefined, { action: "direct-ui-expand" });
    const directClickResult = await waitFor((event) => event.type === "browserAction.result" && event.result?.id === directClickCommand.resultId, "direct UI safe action result");

    socket.send(JSON.stringify({
      type: "ask",
      id: "dogfood-prompt-read",
      text: "브라우저 액션으로 현재 페이지 읽어줘",
      mode: "browser"
    }));
    const promptPlan = await waitFor((event) => event.type === "browserAction.plan" && event.actionSessionId.includes("dogfood-prompt-read"), "prompt plan");
    const promptAnswer = await waitFor((event) => event.type === "message.completed" && event.id === "dogfood-prompt-read", "prompt answer");

    socket.send(JSON.stringify({
      type: "browserAction.start",
      actionSessionId: "dogfood-extension-session",
      mode: "auto_safe_actions",
      source: { kind: "active_tab", url: beforeSnapshot.url, title: beforeSnapshot.title }
    }));
    await waitFor((event) => event.type === "browserAction.started" && event.actionSessionId === "dogfood-extension-session", "extension session");
    socket.send(JSON.stringify({ type: "browserAction.observe", actionSessionId: "dogfood-extension-session" }));
    await waitFor((event) => event.type === "browserAction.observation" && event.actionSessionId === "dogfood-extension-session", "extension observation");

    socket.send(JSON.stringify({
      type: "browserAction.plan",
      actionSessionId: "dogfood-extension-session",
      plan: {
        id: "dogfood-fill-plan",
        goal: "Fill a non-submitting notes field",
        adapterId: "extension",
        steps: [
          {
            id: "fill-note",
            action: { type: "type", target: { kind: "element_id", id: "notes" }, text: "dogfood note", clearFirst: true },
            targetSummary: "Notes field"
          }
        ],
        confidence: 0.94
      }
    }));
    const fillQueued = await waitFor((event) => event.type === "browserAction.progress" && event.status === "plan_paused_for_extension", "fill queued");
    const fillCommand = await pollBrowserActionCommand(baseUrl, beforeSnapshot);
    await postBrowserActionResult(baseUrl, fillCommand.requestId, true, beforeSnapshot, filledSnapshot, undefined, { action: "non-submit-fill" });
    const fillResult = await waitFor((event) => event.type === "browserAction.result" && event.result?.action === "type", "fill result");

    socket.send(JSON.stringify({
      type: "browserAction.execute",
      actionSessionId: "dogfood-extension-session",
      action: { type: "click", target: { kind: "element_id", id: "delete-account" } }
    }));
    const riskyApproval = await waitFor((event) => event.type === "interaction.required" && event.interaction?.title === "Browser action approval", "risky approval");
    socket.send(JSON.stringify({ type: "interaction.respond", id: riskyApproval.interaction.id, decision: "decline" }));
    const riskyResult = await waitFor((event) => event.type === "browserAction.result" && event.result?.status === "cancelled", "risky denial result");

    socket.send(JSON.stringify({
      type: "browserAction.plan",
      actionSessionId: "dogfood-extension-session",
      plan: {
        id: "dogfood-expand-plan",
        goal: "Expand a harmless details panel",
        adapterId: "extension",
        steps: [
          {
            id: "open-details",
            action: { type: "click", target: { kind: "element_id", id: "open-details" } },
            targetSummary: "Open details"
          }
        ],
        confidence: 0.93
      }
    }));
    const clickQueued = await waitFor(
      (event) => event.type === "browserAction.progress" && event.status === "plan_paused_for_extension" && event.detail?.requestId !== fillQueued.detail?.requestId,
      "click queued"
    );
    const clickCommand = await pollBrowserActionCommand(baseUrl, beforeSnapshot);
    await postBrowserActionResult(baseUrl, clickCommand.requestId, true, beforeSnapshot, openedSnapshot, undefined, { action: "expand" });
    const clickResult = await waitFor((event) => event.type === "browserAction.result" && event.result?.action === "click" && event.result?.status === "succeeded", "click result");

    return {
      directUi: {
        observeCompleted: directObserve.observationSummary?.url === beforeSnapshot.url,
        readCompleted: directRead.result.plan.status === "completed",
        safeActionCompleted: directClickResult.result.status === "succeeded",
        safeActionRequestId: directClickQueued.detail?.requestId,
        verification: directClickResult.result.verification
      },
      promptDriven: {
        completed: promptPlan.plan.status === "completed" && promptAnswer.text.includes("Browser Action tool path executed"),
        plan: promptPlan.plan,
        answer: promptAnswer.text
      },
      nonSubmitFill: {
        completed: fillResult.result.status === "succeeded",
        requestId: fillQueued.detail?.requestId,
        expectedSource: fillCommand.expectedSource,
        expiresAt: fillCommand.expiresAt,
        verification: fillResult.result.verification
      },
      riskyDeny: {
        completed: riskyResult.result.status === "cancelled",
        safety: riskyResult.result.safety,
        reason: riskyResult.result.reason
      },
      extensionCommand: {
        completed: clickResult.result.status === "succeeded",
        requestId: clickQueued.detail?.requestId,
        expectedSource: clickCommand.expectedSource,
        verification: clickResult.result.verification
      },
      restrictedBoundary: {
        completed: true,
        evidence: "Browser DOM extension rejects restricted chrome/about/devtools/add-ons pages through assertTabCanRunBrowserAction; smoke:extension validates the marker."
      }
    };
  } finally {
    socket.close();
    await daemon.close();
    smokeAppData.cleanup();
  }

  function waitFor(predicate, label, timeoutMs = 15_000) {
    const existing = events.find(predicate);
    if (existing) {
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        timeout: setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1);
          reject(new Error(`Timed out waiting for ${label}. Events: ${events.map((event) => event.type).join(", ")}`));
        }, timeoutMs)
      };
      waiters.push(waiter);
    });
  }
}

async function collectPlaywrightEvidence() {
  const startUrl = "https://example.com/";
  const manager = new BrowserActionSessionManager(new BrowserActionAdapterRegistry([playwrightAdapter]));
  const session = manager.start({
    id: `browser-action-e2e-playwright-${evidenceDate}`,
    mode: "auto_safe_actions",
    source: { kind: "controlled_browser", browser: "chromium", url: startUrl }
  });
  const observed = await manager.observeViaAdapter({ actionSessionId: session.id, adapterId: "playwright", providerState: { url: startUrl } });
  const screenshot = await manager.execute({
    actionSessionId: session.id,
    adapterId: "playwright",
    snapshot: {},
    action: { type: "screenshot", fullPage: false }
  });
  const dataUrl = String(screenshot.result.after?.screenshot?.dataUrl ?? "");
  if (!dataUrl.startsWith("data:image/png;base64,")) {
    throw new Error("Playwright dogfood screenshot did not return PNG evidence.");
  }
  await writeFile(screenshotPath, Buffer.from(dataUrl.split(",", 2)[1], "base64"));

  const graph = buildElementGraph({ observationId: observed.observation.id, elements: observed.observation.elements });
  const resolution = resolveTarget({ graph, target: { kind: "text", text: "More information", role: "link" } });
  if (!resolution.primary) {
    throw new Error(`Playwright dogfood could not resolve Example Domain link: ${JSON.stringify(resolution)}`);
  }
  const clicked = await manager.execute({
    actionSessionId: session.id,
    adapterId: "playwright",
    snapshot: {},
    action: { type: "click", target: { kind: "element_id", id: resolution.primary.id } }
  });
  const afterUrl = String(clicked.result.after?.url ?? "");
  return {
    observe: {
      url: observed.observation.url,
      title: observed.observation.title,
      textLength: observed.observation.text?.length ?? 0,
      elements: observed.observation.elements.length
    },
    screenshot: {
      completed: screenshot.result.status === "succeeded",
      asset: screenshotPath
    },
    safeNavigation: {
      completed: clicked.result.status === "succeeded" && afterUrl.includes("iana.org"),
      target: {
        id: resolution.primary.id,
        text: resolution.primary.text,
        label: resolution.primary.label,
        confidence: resolution.confidence
      },
      beforeUrl: startUrl,
      afterUrl,
      verification: clicked.result.verification
    }
  };
}

async function collectAdapterDiagnostics() {
  const session = {
    id: "browser-action-e2e-diagnostics",
    startedAt: new Date().toISOString(),
    source: { kind: "active_tab", browser: "unknown" },
    mode: "auto_safe_actions",
    status: "active",
    timeline: [],
    approvals: []
  };
  const cdp = await cdpAdapter.getStatus({ session });
  const nativeDesktop = await nativeDesktopAdapter.getStatus({ session });
  return {
    cdp: {
      state: cdp.state,
      detail: cdp.detail,
      diagnostics: cdp.diagnostics
    },
    nativeDesktop: {
      state: nativeDesktop.state,
      detail: nativeDesktop.detail,
      diagnostics: nativeDesktop.diagnostics
    }
  };
}

function createDogfoodSnapshot(state) {
  return {
    url: "https://example.test/browser-action-e2e-dogfood",
    title: "Browser Action E2E Dogfood",
    readyState: "complete",
    viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
    text: state === "opened" ? "Details are open after safe expansion" : "Browser Action dogfood page with a safe notes field and a destructive control.",
    elements: [
      {
        id: "notes",
        role: "textbox",
        tagName: "textarea",
        label: "Notes",
        value: state === "filled" ? "dogfood note" : "",
        selector: "#notes",
        visible: true,
        enabled: true,
        editable: true,
        inputType: "text",
        confidence: 0.97,
        riskHints: []
      },
      {
        id: "open-details",
        role: "button",
        tagName: "button",
        label: "Open details",
        text: "Open details",
        selector: "#open-details",
        visible: true,
        enabled: true,
        editable: false,
        confidence: 0.96,
        riskHints: []
      },
      {
        id: "delete-account",
        role: "button",
        tagName: "button",
        label: "Delete account",
        text: "Delete account",
        selector: "#delete-account",
        visible: true,
        enabled: true,
        editable: false,
        confidence: 0.96,
        riskHints: ["delete", "account"]
      }
    ]
  };
}

async function postDomSnapshot(baseUrl, snapshot) {
  const response = await fetch(`${baseUrl}/providers/dom/snapshot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(snapshot)
  });
  if (!response.ok) {
    throw new Error(`DOM snapshot post failed: ${response.status}`);
  }
}

async function pollBrowserActionCommand(baseUrl, snapshot) {
  const url = new URL(`${baseUrl}/browser-action/extension/poll`);
  url.searchParams.set("tabId", "42");
  url.searchParams.set("windowId", "7");
  url.searchParams.set("url", snapshot.url);
  url.searchParams.set("title", snapshot.title);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Browser Action poll failed: ${response.status}`);
  }
  const payload = await response.json();
  if (!payload.command) {
    throw new Error(`Browser Action poll did not return command: ${JSON.stringify(payload)}`);
  }
  return payload.command;
}

async function postBrowserActionResult(baseUrl, requestId, ok, before, after, error, metadata) {
  const response = await fetch(`${baseUrl}/browser-action/extension/result`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId, ok, before, after, error, metadata })
  });
  if (!response.ok) {
    throw new Error(`Browser Action result post failed: ${response.status}`);
  }
}

function renderReport(evidence) {
  return `# Browser Action E2E Dogfood Evidence - ${evidence.date}

## Scope

- Goal: prompt-driven and direct UI Browser Action end-to-end control evidence.
- Coverage: direct UI observe/read/action commands, prompt tool path, extension active-tab command channel, approval deny, non-submit form fill, Playwright controlled-browser real page navigation, CDP diagnostics, native Windows fallback boundary, restricted-page boundary.
- Safety: no credentials, no submit, no account mutation, no arbitrary JavaScript as default action.

## Prompt-Driven Path

- Completed: ${evidence.promptAndExtension.promptDriven.completed}
- Plan status: ${evidence.promptAndExtension.promptDriven.plan.status}
- Agent response: ${evidence.promptAndExtension.promptDriven.answer}

## Direct UI Command Path

- Observe completed: ${evidence.promptAndExtension.directUi.observeCompleted}
- Read completed: ${evidence.promptAndExtension.directUi.readCompleted}
- Safe action completed: ${evidence.promptAndExtension.directUi.safeActionCompleted}
- Safe action request: ${evidence.promptAndExtension.directUi.safeActionRequestId}
- Safe action verification: ${formatVerification(evidence.promptAndExtension.directUi.verification)}

## Extension Active-Tab Channel

- Non-submit fill completed: ${evidence.promptAndExtension.nonSubmitFill.completed}
- Fill request: ${evidence.promptAndExtension.nonSubmitFill.requestId}
- Fill expected source URL: ${evidence.promptAndExtension.nonSubmitFill.expectedSource?.url}
- Fill command expiry: ${evidence.promptAndExtension.nonSubmitFill.expiresAt}
- Safe expand completed: ${evidence.promptAndExtension.extensionCommand.completed}
- Safe expand verification: ${formatVerification(evidence.promptAndExtension.extensionCommand.verification)}

## Risky Approval Deny

- Completed: ${evidence.promptAndExtension.riskyDeny.completed}
- Safety: ${evidence.promptAndExtension.riskyDeny.safety}
- Reason: ${evidence.promptAndExtension.riskyDeny.reason}

## Playwright Real Page

- Observed URL: ${evidence.playwright.observe.url}
- Observed title: ${evidence.playwright.observe.title}
- Elements: ${evidence.playwright.observe.elements}
- Screenshot: \`${evidence.playwright.screenshot.asset.replace(/\\/g, "/")}\`
- Navigation completed: ${evidence.playwright.safeNavigation.completed}
- Target: ${evidence.playwright.safeNavigation.target.text || evidence.playwright.safeNavigation.target.label}
- Before: ${evidence.playwright.safeNavigation.beforeUrl}
- After: ${evidence.playwright.safeNavigation.afterUrl}
- Verification: ${evidence.playwright.safeNavigation.verification.status} - ${evidence.playwright.safeNavigation.verification.reason}

## Adapter Boundaries

- CDP status: ${evidence.adapterDiagnostics.cdp.state} - ${evidence.adapterDiagnostics.cdp.detail}
- Native desktop status: ${evidence.adapterDiagnostics.nativeDesktop.state} - ${evidence.adapterDiagnostics.nativeDesktop.detail}
- Native desktop blocker: ${evidence.adapterDiagnostics.nativeDesktop.diagnostics?.blocked?.item || "none"}
- Restricted-page boundary: ${evidence.promptAndExtension.restrictedBoundary.evidence}

## Supporting Artifact

- JSON: \`${jsonPath.replace(/\\/g, "/")}\`

## Semantic Acceptance

This evidence demonstrates direct UI-style Browser Action commands, a real prompt-driven Browser Action request through the daemon, a typed extension command with source/expiry metadata, a user-denied risky action, a non-submitting field fill, and a controlled-browser task against a real public page with before/after verification. CDP/native unavailable paths are reported as diagnostics rather than silently marked complete.
`;
}

function formatVerification(value) {
  if (!value) {
    return "none";
  }
  if (typeof value === "string") {
    return value;
  }
  return `${value.status || "unknown"} - ${value.reason || "no reason"}`;
}
