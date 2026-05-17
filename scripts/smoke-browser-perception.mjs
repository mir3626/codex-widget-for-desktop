import { BrowserPerceptionService } from "../dist/daemon/browser-perception/index.js";
import { ProviderRegistry } from "../dist/daemon/providers/providerRegistry.js";

const mode = process.argv[2] ?? "core";

if (mode === "core") {
  await verifyCorePerception();
  console.log("browser perception smoke ok");
} else if (mode === "stabilization") {
  await verifyStabilization();
  console.log("browser perception stabilization smoke ok");
} else {
  throw new Error(`Unknown browser perception smoke mode: ${mode}`);
}

async function verifyCorePerception() {
  const service = new BrowserPerceptionService();
  const providers = new ProviderRegistry();
  providers.setDomSnapshot(createSnapshot({ url: "https://example.test/perception", mutationQuietMs: 900 }));
  const ready = await service.ensureFreshContext({
    providers,
    bridgeStatus: createBridgeStatus("https://example.test/perception"),
    request: {
      requestId: "core-ready",
      reason: "prompt",
      requiredFreshness: "stable",
      timeoutMs: 200
    }
  });
  assertEqual(ready.status, "ready", "prepared context status");
  assert(ready.context?.viewGraph?.schemaVersion === "browser-view-graph.v2", "context should include View Graph v2");
  assert(ready.context?.routeKey, "context should include route key");
  assert(ready.context?.mutationRevision, "context should include mutation revision");

  const switched = await service.ensureFreshContext({
    providers,
    bridgeStatus: createBridgeStatus("https://example.test/perception", { tabId: 99 }),
    request: {
      requestId: "core-tab-switched",
      reason: "prompt",
      requiredFreshness: "stable",
      timeoutMs: 200
    }
  });
  assertEqual(switched.status, "timeout", "same-url different tab must not reuse stale provider snapshot");

  const queuedService = new BrowserPerceptionService();
  const emptyProviders = new ProviderRegistry();
  const waiting = queuedService.ensureFreshContext({
    providers: emptyProviders,
    bridgeStatus: createBridgeStatus("https://example.test/perception/fresh"),
    request: {
      requestId: "core-observe",
      reason: "prompt",
      requiredFreshness: "stable",
      timeoutMs: 2_000
    }
  });
  const command = queuedService.pollExtensionCommand();
  assertEqual(command?.kind, "observe_now", "observe command kind");
  queuedService.acknowledgeObserveCommand({
    commandId: command.commandId,
    status: "accepted",
    activeTab: { tabId: 7, windowId: 3, url: "https://example.test/perception/fresh", title: "Fresh", permission: "allowed" },
    receivedAt: new Date().toISOString(),
    estimatedResultMs: 25
  });
  queuedService.completeObserveResult({
    providers: emptyProviders,
    bridgeStatus: createBridgeStatus("https://example.test/perception/fresh"),
    payload: {
      commandId: command.commandId,
      status: "succeeded",
      snapshot: createSnapshot({ url: "https://example.test/perception/fresh", mutationQuietMs: 1200 }),
      mutationRevision: "13",
      mutationQuietMs: 1200,
      readyState: "complete"
    }
  });
  const observed = await waiting;
  assertEqual(observed.status, "ready", "queued observe result status");
  assertEqual(observed.ack?.status, "accepted", "observe ack status");
  assertEqual(observed.context?.snapshot.url, "https://example.test/perception/fresh", "observe result snapshot URL");

  const permissionService = new BrowserPerceptionService();
  const permissionWait = permissionService.ensureFreshContext({
    providers: new ProviderRegistry(),
    bridgeStatus: createBridgeStatus("https://example.test/private"),
    request: { requestId: "permission", reason: "prompt", timeoutMs: 2_000 }
  });
  const permissionCommand = permissionService.pollExtensionCommand();
  permissionService.acknowledgeObserveCommand({
    commandId: permissionCommand.commandId,
    status: "missing_permission",
    activeTab: { tabId: 1, windowId: 1, url: "https://example.test/private", title: "Private", permission: "needs_site_permission" },
    receivedAt: new Date().toISOString(),
    error: "Site permission required."
  });
  const permission = await permissionWait;
  assertEqual(permission.status, "permission_required", "permission ack maps to recovery status");
  await verifyBackgroundScheduler();
}

async function verifyStabilization() {
  const service = new BrowserPerceptionService();
  const providers = new ProviderRegistry();
  providers.setDomSnapshot(createSnapshot({ url: "https://example.test/spa?view=1", mutationQuietMs: 80 }));
  const read = await service.ensureFreshContext({
    providers,
    bridgeStatus: createBridgeStatus("https://example.test/spa?view=1"),
    request: {
      requestId: "settling-read",
      reason: "prompt",
      requiredFreshness: "stable",
      actionRisk: "read",
      allowSettlingForRead: true,
      timeoutMs: 200
    }
  });
  assertEqual(read.status, "settling_ready", "read may use settling context");

  const sideEffect = service.ensureFreshContext({
    providers,
    bridgeStatus: createBridgeStatus("https://example.test/spa?view=1"),
    request: {
      requestId: "settling-side-effect",
      reason: "before_step",
      requiredFreshness: "stable",
      actionRisk: "side_effect",
      timeoutMs: 300
    }
  });
  const command = service.pollExtensionCommand();
  assertEqual(command?.kind, "observe_now", "side-effect queues fresh observe while mutating");
  service.completeObserveResult({
    providers,
    bridgeStatus: createBridgeStatus("https://example.test/spa?view=2"),
    payload: {
      commandId: command.commandId,
      status: "succeeded",
      snapshot: createSnapshot({ url: "https://example.test/spa?view=2", mutationQuietMs: 800, mutationRevision: "view-2" }),
      mutationRevision: "view-2",
      mutationQuietMs: 800,
      readyState: "complete"
    }
  });
  const result = await sideEffect;
  assertEqual(result.status, "ready", "side-effect waits for stable observe");
  assert(result.context?.routeKey, "SPA transition should retain route identity");
  assertEqual(result.context?.mutationRevision, "view-2", "mutation revision updates after SPA transition");

  const retryService = new BrowserPerceptionService();
  const retryProviders = new ProviderRegistry();
  retryProviders.setDomSnapshot(createSnapshot({ url: "https://example.test/spa?view=retry", mutationQuietMs: 70, mutationRevision: "retry-mutating-1" }));
  const retryWait = retryService.ensureFreshContext({
    providers: retryProviders,
    bridgeStatus: createBridgeStatus("https://example.test/spa?view=retry"),
    request: {
      requestId: "settling-side-effect-retry",
      reason: "before_step",
      requiredFreshness: "stable",
      actionRisk: "side_effect",
      timeoutMs: 2_000
    }
  });
  const firstRetryCommand = retryService.pollExtensionCommand();
  assertEqual(firstRetryCommand?.kind, "observe_now", "side-effect retry starts with observe command");
  retryService.completeObserveResult({
    providers: retryProviders,
    bridgeStatus: createBridgeStatus("https://example.test/spa?view=retry"),
    payload: {
      commandId: firstRetryCommand.commandId,
      status: "succeeded",
      snapshot: createSnapshot({ url: "https://example.test/spa?view=retry", mutationQuietMs: 90, mutationRevision: "retry-mutating-2" }),
      mutationRevision: "retry-mutating-2",
      mutationQuietMs: 90,
      readyState: "complete"
    }
  });
  const secondRetryCommand = retryService.pollExtensionCommand();
  assertEqual(secondRetryCommand?.kind, "observe_now", "side-effect retries observe when result is still mutating");
  assertEqual(secondRetryCommand?.requestId, "settling-side-effect-retry", "retry keeps the original request id");
  retryService.completeObserveResult({
    providers: retryProviders,
    bridgeStatus: createBridgeStatus("https://example.test/spa?view=retry"),
    payload: {
      commandId: secondRetryCommand.commandId,
      status: "succeeded",
      snapshot: createSnapshot({ url: "https://example.test/spa?view=retry", mutationQuietMs: 900, mutationRevision: "retry-stable" }),
      mutationRevision: "retry-stable",
      mutationQuietMs: 900,
      readyState: "complete"
    }
  });
  const retryResult = await retryWait;
  assertEqual(retryResult.status, "ready", "side-effect retry eventually resolves stable context");
  assertEqual(retryResult.context?.stability, "stable", "side-effect retry result should be stable");
  assertEqual(retryResult.context?.mutationRevision, "retry-stable", "side-effect retry returns latest stable mutation revision");
}

async function verifyBackgroundScheduler() {
  const service = new BrowserPerceptionService();
  const providers = new ProviderRegistry();
  const bridgeStatus = createBridgeStatus("https://example.test/background");
  const scheduled = service.scheduleBackgroundObserve({
    providers,
    bridgeStatus,
    reason: "smoke_background_dirty",
    timeoutMs: 2_000
  });
  assertEqual(scheduled.scheduled, true, "background scheduler should queue observe when no prepared context exists");
  const duplicate = service.scheduleBackgroundObserve({
    providers,
    bridgeStatus,
    reason: "smoke_background_duplicate",
    timeoutMs: 2_000
  });
  assertEqual(duplicate.scheduled, false, "background scheduler should dedupe pending observe for the same active tab");
  const command = service.pollExtensionCommand();
  assertEqual(command?.kind, "observe_now", "background scheduler command kind");
  assertEqual(command?.reason, "background", "background scheduler command reason");
  const inFlightDuplicate = service.scheduleBackgroundObserve({
    providers,
    bridgeStatus,
    reason: "smoke_background_in_flight_duplicate",
    timeoutMs: 2_000,
    cooldownMs: 0
  });
  assertEqual(inFlightDuplicate.scheduled, false, "background scheduler should dedupe in-flight observe after extension poll");
  const result = service.completeObserveResult({
    providers,
    bridgeStatus,
    payload: {
      commandId: command.commandId,
      status: "succeeded",
      snapshot: createSnapshot({ url: "https://example.test/background", mutationQuietMs: 950 }),
      mutationRevision: "background-1",
      mutationQuietMs: 950,
      readyState: "complete",
      metadata: { reason: "background" }
    }
  });
  assertEqual(result.status, "ready", "background observe result should ingest even without a waiter");
  assertEqual(service.getActiveContext()?.snapshot.url, "https://example.test/background", "background observe should refresh active context");
  const freshSkip = service.scheduleBackgroundObserve({
    providers,
    bridgeStatus,
    reason: "smoke_background_fresh",
    timeoutMs: 2_000
  });
  assertEqual(freshSkip.scheduled, false, "background scheduler should skip fresh prepared context");

  const priorityService = new BrowserPerceptionService();
  const priorityProviders = new ProviderRegistry();
  priorityService.scheduleBackgroundObserve({
    providers: priorityProviders,
    bridgeStatus,
    reason: "smoke_background_priority",
    timeoutMs: 2_000
  });
  const foregroundWait = priorityService.ensureFreshContext({
    providers: priorityProviders,
    bridgeStatus,
    request: {
      requestId: "foreground-prompt",
      reason: "prompt",
      requiredFreshness: "stable",
      timeoutMs: 2_000
    }
  });
  const foregroundCommand = priorityService.pollExtensionCommand();
  assertEqual(foregroundCommand?.requestId, "foreground-prompt", "foreground prompt observe should outrank queued background observe");
  priorityService.cancelCommand(foregroundCommand.commandId, "smoke_cancel");
  const foregroundResult = await foregroundWait;
  assertEqual(foregroundResult.status, "cancelled", "foreground priority wait should receive cancellation");
}

function createBridgeStatus(url, options = {}) {
  return {
    connected: true,
    mode: "idle",
    reason: "smoke",
    updatedAt: new Date().toISOString(),
    activeTab: {
      tabId: options.tabId ?? 7,
      windowId: options.windowId ?? 3,
      url,
      title: "Browser Perception Smoke",
      origin: "https://example.test/*",
      permission: "allowed"
    }
  };
}

function createSnapshot(options = {}) {
  return {
    url: options.url ?? "https://example.test/perception",
    title: "Browser Perception Smoke",
    readyState: "complete",
    mutationRevision: options.mutationRevision ?? "12",
    lastMutationAt: new Date(Date.now() - (options.mutationQuietMs ?? 900)).toISOString(),
    mutationQuietMs: options.mutationQuietMs ?? 900,
    bridge: {
      tabId: options.tabId ?? 7,
      windowId: options.windowId ?? 3,
      url: options.url ?? "https://example.test/perception",
      title: "Browser Perception Smoke",
      permission: "allowed",
      reason: "smoke"
    },
    text: "개념글\n흥미로운 글 제목\n검색",
    elements: [
      {
        id: "concept-filter",
        role: "button",
        tagName: "button",
        label: "개념글",
        text: "개념글",
        selector: "button[data-filter='concept']",
        bbox: { x: 120, y: 80, w: 80, h: 32 },
        visible: true,
        enabled: true,
        confidence: 0.96,
        sourceOrder: 1,
        domPathHash: "path-concept",
        nearestLandmark: "toolbar",
        mutationRevision: options.mutationRevision ?? "12",
        lastMutationAt: new Date(Date.now() - (options.mutationQuietMs ?? 900)).toISOString()
      },
      {
        id: "post-1",
        role: "link",
        tagName: "a",
        label: "흥미로운 글 제목",
        text: "흥미로운 글 제목",
        href: "https://example.test/post/1",
        selector: "main a.post",
        bbox: { x: 120, y: 140, w: 360, h: 28 },
        visible: true,
        enabled: true,
        confidence: 0.94,
        sourceOrder: 2,
        domPathHash: "path-post-1",
        nearestLandmark: "main",
        listOwner: "posts",
        mutationRevision: options.mutationRevision ?? "12",
        lastMutationAt: new Date(Date.now() - (options.mutationQuietMs ?? 900)).toISOString()
      }
    ]
  };
}

function assert(value, message) {
  if (!value) {
    throw new Error(message);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
