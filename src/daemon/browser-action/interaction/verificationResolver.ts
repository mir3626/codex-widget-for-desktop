import type {
  BrowserAction,
  BrowserExpectedState,
  BrowserObservation,
  BrowserVerificationResult
} from "../types.js";

export function verifyExpectedBrowserEffects(input: {
  action: BrowserAction;
  expected?: BrowserExpectedState[];
  before?: BrowserObservation;
  after?: BrowserObservation;
  ok?: boolean;
  error?: string;
}): BrowserVerificationResult {
  if (input.error) {
    return { status: "failed", reason: input.error };
  }
  if (input.ok === false) {
    return { status: "failed", reason: "Browser adapter reported failure." };
  }
  if (!input.after) {
    return { status: input.action.type === "read" ? "passed" : "unknown", reason: "No after observation was available." };
  }
  const expected = input.expected ?? [];
  const checked = expected.map((item) => checkExpectedState({ ...input, expected: item }));
  const failed = checked.filter((item) => item.status === "failed");
  const passed = checked.filter((item) => item.status === "passed");
  if (failed.length > 0 && passed.length === 0) {
    return { status: "failed", reason: failed.map((item) => item.reason).join(" ") };
  }
  if (passed.length > 0 && failed.length === 0) {
    return { status: "passed", reason: passed.map((item) => item.reason).join(" ") };
  }
  if (passed.length > 0) {
    return { status: "passed", reason: passed.map((item) => item.reason).join(" ") };
  }
  return verifyDefaultEffect(input);
}

function checkExpectedState(input: {
  action: BrowserAction;
  expected: BrowserExpectedState;
  before?: BrowserObservation;
  after?: BrowserObservation;
}): BrowserVerificationResult {
  const after = input.after;
  if (!after) {
    return { status: "unknown", reason: "No after observation was available." };
  }
  if (input.expected.type === "url_contains") {
    return after.url.includes(input.expected.value)
      ? { status: "passed", reason: "After observation URL matches the requested navigation." }
      : { status: "failed", reason: "Navigation command completed but URL did not match the requested destination." };
  }
  if (input.expected.type === "text_visible") {
    return (after.text ?? "").includes(input.expected.value)
      ? { status: "passed", reason: "Expected text is visible after the action." }
      : { status: "failed", reason: "Expected text was not visible after the action." };
  }
  if (input.expected.type === "element_state") {
    const targetId = input.expected.target.kind === "element_id" ? input.expected.target.id : undefined;
    const element = targetId ? after.elements.find((item) => item.id === targetId) : undefined;
    if (!element) {
      return { status: "unknown", reason: "The expected element state could not be checked after the action." };
    }
    if (input.expected.state.value !== undefined && element.value !== input.expected.state.value) {
      return { status: "failed", reason: "The expected field value was not present after the action." };
    }
    if (input.expected.state.checked !== undefined && element.checked !== input.expected.state.checked) {
      return { status: "failed", reason: "The expected checked state was not present after the action." };
    }
    if (input.expected.state.selected !== undefined && element.selected !== input.expected.state.selected) {
      return { status: "failed", reason: "The expected selected state was not present after the action." };
    }
    return { status: "passed", reason: "Expected element state was verified after the action." };
  }
  if (input.expected.type === "navigation_complete" || input.expected.type === "network_idle" || input.expected.type === "no_error_toast") {
    return verifyDefaultEffect(input);
  }
  if (input.expected.type === "custom") {
    return verifyCustomEffect(input, input.expected.description);
  }
  return { status: "unknown", reason: "Expected state type is not supported by the verifier." };
}

function verifyCustomEffect(input: {
  action: BrowserAction;
  before?: BrowserObservation;
  after?: BrowserObservation;
}, description: string): BrowserVerificationResult {
  if (input.action.type === "type" && /without implicit submit|no submit|no navigation/i.test(description)) {
    const sameRoute = readRouteKey(input.before) && readRouteKey(input.before) === readRouteKey(input.after);
    const sameUrl = input.before?.url && input.before.url === input.after?.url;
    return sameRoute || sameUrl
      ? { status: "passed", reason: "Field action completed without implicit navigation." }
      : { status: "failed", reason: "Field action appears to have navigated or submitted unexpectedly." };
  }
  if (input.action.type === "click") {
    const defaultResult = verifyDefaultEffect(input);
    return defaultResult.status === "passed"
      ? defaultResult
      : { status: "failed", reason: "Click completed but the expected visible page effect was not proven." };
  }
  return verifyDefaultEffect(input);
}

function verifyDefaultEffect(input: {
  action: BrowserAction;
  before?: BrowserObservation;
  after?: BrowserObservation;
}): BrowserVerificationResult {
  if (input.action.type === "read") {
    return { status: "passed", reason: "Read action returned the current browser observation." };
  }
  if (!input.after) {
    return { status: "unknown", reason: "No after observation was available." };
  }
  if (!input.before) {
    return { status: "passed", reason: "Browser adapter completed the action and returned an observation." };
  }
  if (input.before.url !== input.after.url) {
    return { status: "passed", reason: "Action changed the browser route or URL." };
  }
  if (readRouteKey(input.before) && readRouteKey(input.before) !== readRouteKey(input.after)) {
    return { status: "passed", reason: "Action changed the browser route key." };
  }
  if (readViewRevision(input.before) && readViewRevision(input.before) !== readViewRevision(input.after)) {
    return { status: "passed", reason: "Action changed the browser view revision." };
  }
  if (readInteractiveDigest(input.before) && readInteractiveDigest(input.before) !== readInteractiveDigest(input.after)) {
    return { status: "passed", reason: "Action changed the interactive page digest." };
  }
  if (input.action.type === "scroll") {
    const beforeY = input.before.viewport?.scrollY;
    const afterY = input.after.viewport?.scrollY;
    if (beforeY !== undefined && afterY !== undefined && beforeY !== afterY) {
      return { status: "passed", reason: "Scroll position changed after the action." };
    }
  }
  if (input.action.type === "screenshot") {
    return input.after.screenshot
      ? { status: "passed", reason: "Screenshot evidence is available after the action." }
      : { status: "unknown", reason: "Screenshot action completed but no screenshot evidence was attached." };
  }
  return { status: "unknown", reason: "Browser adapter completed, but the expected page effect was not proven." };
}

function readRouteKey(observation: BrowserObservation | undefined): string | undefined {
  return observation?.viewGraph?.identity.routeKey ?? observation?.source.routeKey;
}

function readViewRevision(observation: BrowserObservation | undefined): string | undefined {
  return observation?.viewGraph?.identity.viewRevision ?? observation?.source.viewRevision;
}

function readInteractiveDigest(observation: BrowserObservation | undefined): string | undefined {
  return observation?.viewGraph?.identity.interactiveDigest;
}
