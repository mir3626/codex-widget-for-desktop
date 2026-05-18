export function requiresChangedNavigationObservation(action, before) {
  if (action?.type === "navigate") {
    return Boolean(action.url) && normalizeUrlForSource(action.url) !== normalizeUrlForSource(before?.url);
  }
  return ["back", "forward"].includes(action?.type);
}

export function shouldAcceptLightweightNavigateCompletion(action, before, latestTab) {
  if (action?.type !== "navigate" || !action.url || !latestTab?.url) {
    return false;
  }
  if (!navigationDestinationMatches(action.url, latestTab.url)) {
    return false;
  }
  return !before?.url || normalizeUrlForSource(before.url) !== normalizeUrlForSource(latestTab.url);
}

export function navigationDestinationMatches(requestedUrl, actualUrl) {
  if (!requestedUrl || !actualUrl) {
    return false;
  }
  try {
    const requested = new URL(requestedUrl);
    const actual = new URL(actualUrl);
    requested.hash = "";
    actual.hash = "";
    if (requested.href === actual.href) {
      return true;
    }
    if (requested.search) {
      return requested.origin === actual.origin &&
        normalizePathname(requested.pathname) === normalizePathname(actual.pathname) &&
        requested.search === actual.search;
    }
    return requested.origin === actual.origin &&
      normalizePathname(requested.pathname) === normalizePathname(actual.pathname);
  } catch {
    return normalizeUrlForSource(actualUrl).includes(normalizeUrlForSource(requestedUrl));
  }
}

export function hasChangedNavigationObservation(before, after) {
  if (!before || !after) {
    return false;
  }
  return normalizeUrlForSource(before.url) !== normalizeUrlForSource(after.url) ||
    Boolean(readRouteKey(before) && readRouteKey(after) && readRouteKey(before) !== readRouteKey(after)) ||
    Boolean(readViewRevision(before) && readViewRevision(after) && readViewRevision(before) !== readViewRevision(after));
}

export function normalizeUrlForSource(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  } catch {
    return String(value || "").replace(/#.*$/, "");
  }
}

function readRouteKey(snapshot) {
  return snapshot?.viewGraph?.identity?.routeKey || snapshot?.routeKey || "";
}

function readViewRevision(snapshot) {
  return snapshot?.viewGraph?.identity?.viewRevision || snapshot?.viewRevision || snapshot?.mutationRevision || "";
}

function normalizePathname(value) {
  return String(value || "").replace(/\/+$/, "") || "/";
}
