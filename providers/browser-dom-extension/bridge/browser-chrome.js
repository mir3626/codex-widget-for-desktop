import { DEFAULT_BROWSER_CHROME_RESULT_PATH } from "./config.js";
import { setBridgeBadge } from "./badge.js";
import { readError, resolveDaemonUrl } from "./settings.js";

export async function executeBrowserChromeCommand(tab, settings, command) {
  if (!command?.requestId || command.kind !== "browser_chrome") {
    return false;
  }
  await setBridgeBadge("RUN", tab?.id);
  const resultUrl = resolveDaemonUrl(settings.daemonBaseUrl, DEFAULT_BROWSER_CHROME_RESULT_PATH);
  try {
    const result = await runBrowserChromeCommand(tab, command);
    await postJsonWithRetry(resultUrl, {
      requestId: command.requestId,
      ok: result.ok,
      output: result.output,
      error: result.error,
      metadata: {
        ...result.metadata,
        command: command.command,
        bridgeMode: "browser_chrome",
        completedAt: new Date().toISOString()
      }
    });
    await setBridgeBadge(result.ok ? "IDLE" : "ERR", tab?.id);
    return true;
  } catch (error) {
    await postJsonWithRetry(resultUrl, {
      requestId: command.requestId,
      ok: false,
      error: readError(error),
      metadata: {
        command: command.command,
        bridgeMode: "browser_chrome",
        completedAt: new Date().toISOString()
      }
    }).catch(() => undefined);
    await setBridgeBadge("ERR", tab?.id);
    return true;
  }
}

async function runBrowserChromeCommand(tab, command) {
  if (!chrome.bookmarks) {
    return { ok: false, error: "Browser bookmarks API is unavailable. Check extension permissions." };
  }
  const payload = command.payload ?? {};
  if (command.command === "bookmark.list") {
    const tree = await chrome.bookmarks.getTree();
    return {
      ok: true,
      output: { tree: normalizeBookmarkNodes(tree) },
      metadata: { verification: "bookmark_tree_read" }
    };
  }
  if (command.command === "bookmark.create") {
    const title = readBoundedString(payload.title, 240) || readTitleFromTab(tab);
    const url = readBookmarkUrl(payload.url ?? tab?.url);
    const parentId = readBoundedString(payload.parentId, 128);
    const created = await chrome.bookmarks.create({
      ...(parentId ? { parentId } : {}),
      title,
      url
    });
    const verified = await chrome.bookmarks.get(created.id);
    return {
      ok: true,
      output: { bookmark: normalizeBookmarkNode(verified[0] ?? created) },
      metadata: { verification: "bookmark_created", bookmarkId: created.id }
    };
  }
  if (command.command === "bookmark.update") {
    const id = readRequiredString(payload.id, "bookmark id");
    const changes = {};
    const title = readBoundedString(payload.title, 240);
    const url = payload.url === undefined ? undefined : readBookmarkUrl(payload.url);
    if (title) {
      changes.title = title;
    }
    if (url) {
      changes.url = url;
    }
    if (!changes.title && !changes.url) {
      return { ok: false, error: "Bookmark update requires title or url." };
    }
    const updated = await chrome.bookmarks.update(id, changes);
    const verified = await chrome.bookmarks.get(updated.id);
    return {
      ok: true,
      output: { bookmark: normalizeBookmarkNode(verified[0] ?? updated) },
      metadata: { verification: "bookmark_updated", bookmarkId: updated.id }
    };
  }
  if (command.command === "bookmark.remove") {
    const id = readRequiredString(payload.id, "bookmark id");
    if (payload.recursive) {
      await chrome.bookmarks.removeTree(id);
    } else {
      await chrome.bookmarks.remove(id);
    }
    let remaining = [];
    try {
      remaining = await chrome.bookmarks.get(id);
    } catch {
      remaining = [];
    }
    return {
      ok: remaining.length === 0,
      output: { removed: remaining.length === 0, id },
      error: remaining.length === 0 ? undefined : "Bookmark still exists after remove.",
      metadata: { verification: remaining.length === 0 ? "bookmark_removed" : "bookmark_remove_mismatch", bookmarkId: id }
    };
  }
  if (command.command === "bookmark.open") {
    const bookmark = await readBookmarkForOpen(payload);
    if (!bookmark?.url) {
      return { ok: false, error: "Bookmark open requires a bookmark with a URL." };
    }
    const activeTab = tab?.id ? await chrome.tabs.update(tab.id, { url: bookmark.url }) : await chrome.tabs.create({ url: bookmark.url });
    return {
      ok: true,
      output: { bookmark: normalizeBookmarkNode(bookmark), tab: { id: activeTab.id, windowId: activeTab.windowId, url: activeTab.url } },
      metadata: { verification: "bookmark_opened", bookmarkId: bookmark.id }
    };
  }
  return { ok: false, error: `Unsupported Browser Chrome command: ${command.command}` };
}

async function readBookmarkForOpen(payload) {
  const id = readBoundedString(payload.id, 128);
  if (id) {
    const matches = await chrome.bookmarks.get(id);
    return matches[0];
  }
  const url = readBookmarkUrl(payload.url);
  const matches = await chrome.bookmarks.search({ url });
  return matches[0];
}

function normalizeBookmarkNodes(nodes, limit = 200) {
  const output = [];
  const queue = [...(Array.isArray(nodes) ? nodes : [])];
  while (queue.length && output.length < limit) {
    const node = queue.shift();
    output.push(normalizeBookmarkNode(node, false));
    if (Array.isArray(node?.children)) {
      queue.push(...node.children);
    }
  }
  return output;
}

function normalizeBookmarkNode(node, includeChildren = true) {
  return {
    id: String(node?.id ?? ""),
    parentId: node?.parentId ? String(node.parentId) : undefined,
    title: readBoundedString(node?.title, 240),
    url: typeof node?.url === "string" ? node.url : undefined,
    dateAdded: node?.dateAdded,
    children: includeChildren && Array.isArray(node?.children) ? normalizeBookmarkNodes(node.children, 50) : undefined
  };
}

function readBookmarkUrl(value) {
  const text = readRequiredString(value, "bookmark url");
  const url = new URL(text);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Bookmark URL must use http or https.");
  }
  return url.toString();
}

function readRequiredString(value, label) {
  const text = readBoundedString(value, 2048);
  if (!text) {
    throw new Error(`Missing ${label}.`);
  }
  return text;
}

function readBoundedString(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function readTitleFromTab(tab) {
  return readBoundedString(tab?.title, 240) || readBoundedString(tab?.url, 240) || "Saved page";
}

async function postJsonWithRetry(url, payload) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const post = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, metadata: { ...(payload.metadata ?? {}), postAttempt: attempt } })
      });
      if (post.ok) {
        return;
      }
      lastError = new Error(`Browser Bridge result post failed (${post.status}).`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
  }
  throw lastError instanceof Error ? lastError : new Error("Browser Bridge result post failed.");
}
