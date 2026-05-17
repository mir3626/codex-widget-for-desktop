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
  const payload = command.payload ?? {};
  if (String(command.command ?? "").startsWith("bookmark.") && !chrome.bookmarks) {
    return { ok: false, error: "Browser bookmarks API is unavailable. Check extension permissions." };
  }
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
  if (command.command === "tab.list") {
    return await runTabList(tab, payload);
  }
  if (command.command === "tab.activate") {
    return await runTabActivate(tab, payload);
  }
  if (command.command === "tab_group.list") {
    return await runTabGroupList();
  }
  if (command.command === "tab_group.create") {
    return await runTabGroupCreate(tab, payload);
  }
  if (command.command === "tab_group.claim") {
    return await runTabGroupClaim(tab, payload);
  }
  if (command.command === "tab_group.update") {
    return await runTabGroupUpdate(payload);
  }
  if (command.command === "tab_group.release") {
    return await runTabGroupRelease(tab, payload);
  }
  if (command.command === "download.search") {
    return await runDownloadSearch(payload);
  }
  if (command.command === "download.observe") {
    return await runDownloadObserve(payload);
  }
  if (command.command === "download.verify") {
    return await runDownloadVerify(payload);
  }
  if (command.command === "download.start") {
    return await runDownloadStart(tab, payload);
  }
  if (command.command === "download.cancel") {
    return await runDownloadCancel(payload);
  }
  if (command.command === "download.erase") {
    return await runDownloadErase(payload);
  }
  if (command.command === "history.search") {
    return await runHistorySearch(payload);
  }
  if (command.command === "history.open") {
    return await runHistoryOpen(tab, payload);
  }
  if (command.command === "debugger.inspect") {
    return await runDebuggerInspect(tab, payload);
  }
  if (command.command === "debugger.screenshot") {
    return await runDebuggerScreenshot(tab, payload);
  }
  if (command.command === "debugger.print_to_pdf") {
    return await runDebuggerPrintToPdf(tab, payload);
  }
  if (command.command === "permission.get") {
    return await runPermissionGet(tab, payload);
  }
  if (command.command === "permission.set") {
    return await runPermissionSet(tab, payload);
  }
  if (command.command === "file_upload.inspect") {
    return await runFileUploadInspect(tab, payload);
  }
  if (command.command === "file_upload.set_files") {
    return await runFileUploadSetFiles(tab, payload, command.requestId);
  }
  if (command.command === "file_upload.clear") {
    return await runFileUploadClear(tab, payload, command.requestId);
  }
  if (command.command === "file_upload.blocked") {
    return {
      ok: true,
      output: {
        status: "blocked",
        blocker: "file_upload_requires_explicit_file_grant_and_native_picker",
        reason: "Browser Bridge can inspect file inputs, but selecting local files requires a future explicit file grant and bounded native picker helper."
      },
      metadata: { verification: "file_upload_blocked_by_policy", safetyBoundary: "local_file_disclosure" }
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

async function runTabList(tab, payload) {
  requireChromeApi(chrome.tabs, "tabs");
  const query = {};
  const windowId = readOptionalWindowId(tab, payload);
  if (windowId !== undefined) {
    query.windowId = windowId;
  }
  const tabs = await chrome.tabs.query(query);
  return {
    ok: true,
    output: {
      tabs: tabs.slice(0, 100).map(normalizeTab),
      activeTab: normalizeTab(tabs.find((candidate) => candidate?.active) ?? tab)
    },
    metadata: {
      verification: "tabs_read",
      browserChromeApi: true,
      nativeInput: false,
      hotkey: false,
      pointer: false
    }
  };
}

async function runTabActivate(tab, payload) {
  requireChromeApi(chrome.tabs, "tabs");
  const target = await readTabActivationTarget(tab, payload);
  const activated = await chrome.tabs.update(target.id, { active: true });
  if (payload.focusWindow !== false && chrome.windows && activated?.windowId !== undefined) {
    await chrome.windows.update(activated.windowId, { focused: true }).catch(() => undefined);
  }
  const activeTabs = activated?.windowId !== undefined
    ? await chrome.tabs.query({ active: true, windowId: activated.windowId })
    : [];
  const verified = (activeTabs[0]?.id ?? activated?.id) === target.id;
  const normalized = normalizeTab(activeTabs[0] ?? activated);
  return {
    ok: verified,
    output: {
      tab: normalized,
      requested: {
        tabId: target.id,
        index: target.index,
        ordinal: target.index + 1,
        windowId: target.windowId
      }
    },
    error: verified ? undefined : "Requested tab was not active after Browser Chrome tab activation.",
    metadata: {
      verification: verified ? "tab_activated" : "tab_activate_mismatch",
      tabId: target.id,
      tabIndex: target.index,
      windowId: target.windowId,
      browserChromeApi: true,
      backgroundControl: true,
      nativeInput: false,
      hotkey: false,
      pointer: false
    }
  };
}

async function runTabGroupList() {
  requireChromeApi(chrome.tabGroups, "tabGroups");
  const groups = await chrome.tabGroups.query({});
  const tabs = chrome.tabs ? await chrome.tabs.query({}) : [];
  return {
    ok: true,
    output: {
      groups: groups.slice(0, 100).map((group) => normalizeTabGroup(group, tabs))
    },
    metadata: { verification: "tab_groups_read" }
  };
}

async function runTabGroupCreate(tab, payload) {
  requireChromeApi(chrome.tabGroups, "tabGroups");
  requireChromeApi(chrome.tabs, "tabs");
  const tabIds = readTabIds(payload, tab);
  const groupId = await chrome.tabs.group({ tabIds });
  const changes = readTabGroupChanges(payload);
  const group = Object.keys(changes).length ? await chrome.tabGroups.update(groupId, changes) : await chrome.tabGroups.get(groupId);
  const tabs = await chrome.tabs.query({});
  return {
    ok: true,
    output: { group: normalizeTabGroup(group, tabs) },
    metadata: { verification: "tab_group_created", groupId }
  };
}

async function runTabGroupClaim(tab, payload) {
  requireChromeApi(chrome.tabGroups, "tabGroups");
  requireChromeApi(chrome.tabs, "tabs");
  const existingGroupId = readInteger(payload.groupId, NaN);
  const groupId = Number.isInteger(existingGroupId) && existingGroupId >= 0
    ? existingGroupId
    : await chrome.tabs.group({ tabIds: readTabIds(payload, tab) });
  const owner = readBoundedString(payload.owner, 80) || readBoundedString(payload.runId, 80) || "codex-widget-run";
  const changes = {
    ...readTabGroupChanges(payload),
    title: readBoundedString(payload.title, 120) || `Codex ${owner}`.slice(0, 120)
  };
  const group = await chrome.tabGroups.update(groupId, changes);
  const tabs = await chrome.tabs.query({});
  return {
    ok: true,
    output: {
      group: normalizeTabGroup(group, tabs),
      claim: {
        owner,
        runId: readBoundedString(payload.runId, 120) || undefined,
        threadId: readBoundedString(payload.threadId, 120) || undefined
      }
    },
    metadata: { verification: "tab_group_claimed", groupId, owner }
  };
}

async function runTabGroupUpdate(payload) {
  requireChromeApi(chrome.tabGroups, "tabGroups");
  requireChromeApi(chrome.tabs, "tabs");
  const groupId = readRequiredInteger(payload.groupId, "tab group id");
  const changes = readTabGroupChanges(payload);
  if (!Object.keys(changes).length) {
    return { ok: false, error: "Tab group update requires title, color, or collapsed." };
  }
  const group = await chrome.tabGroups.update(groupId, changes);
  const tabs = await chrome.tabs.query({});
  return {
    ok: true,
    output: { group: normalizeTabGroup(group, tabs) },
    metadata: { verification: "tab_group_updated", groupId }
  };
}

async function runTabGroupRelease(tab, payload) {
  requireChromeApi(chrome.tabs, "tabs");
  const tabIds = readTabIds(payload, tab);
  await chrome.tabs.ungroup(tabIds);
  return {
    ok: true,
    output: { releasedTabIds: tabIds },
    metadata: { verification: "tab_group_released", tabIds }
  };
}

async function runDownloadSearch(payload) {
  requireChromeApi(chrome.downloads, "downloads");
  const items = await chrome.downloads.search(readDownloadQuery(payload, false));
  return {
    ok: true,
    output: { downloads: items.slice(0, 50).map(normalizeDownloadItem) },
    metadata: { verification: "downloads_read" }
  };
}

async function runDownloadObserve(payload) {
  requireChromeApi(chrome.downloads, "downloads");
  const items = await chrome.downloads.search(readDownloadQuery(payload, false));
  return {
    ok: true,
    output: { downloads: items.slice(0, 50).map(normalizeDownloadItem) },
    metadata: { verification: "downloads_observed" }
  };
}

async function runDownloadVerify(payload) {
  requireChromeApi(chrome.downloads, "downloads");
  const items = await chrome.downloads.search(readDownloadQuery(payload, true));
  const expectedState = readDownloadState(payload.expectedState ?? payload.state);
  const normalized = items.slice(0, 50).map(normalizeDownloadItem);
  const matching = normalized.filter((item) => !expectedState || item.state === expectedState);
  const verified = matching.length > 0;
  return {
    ok: verified,
    output: { verified, downloads: normalized, expectedState },
    error: verified ? undefined : "No download matched the verification query.",
    metadata: { verification: verified ? "download_verified" : "download_verify_mismatch" }
  };
}

async function runDownloadStart(tab, payload) {
  requireChromeApi(chrome.downloads, "downloads");
  const url = readHttpUrl(payload.url ?? tab?.url, "download url");
  const filename = readDownloadFilename(payload.filename);
  const id = await chrome.downloads.download({
    url,
    ...(filename ? { filename } : {}),
    ...(payload.saveAs === true ? { saveAs: true } : {}),
    conflictAction: readConflictAction(payload.conflictAction)
  });
  const matches = await chrome.downloads.search({ id });
  return {
    ok: true,
    output: { download: normalizeDownloadItem(matches[0] ?? { id, url }) },
    metadata: { verification: "download_started", downloadId: id }
  };
}

async function runDownloadCancel(payload) {
  requireChromeApi(chrome.downloads, "downloads");
  const id = readRequiredInteger(payload.id, "download id");
  await chrome.downloads.cancel(id);
  const matches = await chrome.downloads.search({ id });
  return {
    ok: true,
    output: { download: matches[0] ? normalizeDownloadItem(matches[0]) : { id, state: "cancelled" } },
    metadata: { verification: "download_cancelled", downloadId: id }
  };
}

async function runDownloadErase(payload) {
  requireChromeApi(chrome.downloads, "downloads");
  const query = readDownloadQuery(payload, true);
  const erasedIds = await chrome.downloads.erase(query);
  return {
    ok: true,
    output: { erasedIds },
    metadata: { verification: "download_history_erased", erasedIds }
  };
}

async function runHistorySearch(payload) {
  requireChromeApi(chrome.history, "history");
  const query = {
    text: readBoundedString(payload.text, 240),
    maxResults: Math.min(Math.max(readInteger(payload.maxResults, 10), 1), 25),
    ...(typeof payload.startTime === "number" ? { startTime: payload.startTime } : {}),
    ...(typeof payload.endTime === "number" ? { endTime: payload.endTime } : {})
  };
  const items = await chrome.history.search(query);
  return {
    ok: true,
    output: {
      items: items.map(normalizeHistoryItem),
      redaction: "url_path_redacted"
    },
    metadata: { verification: "history_search_redacted", risk: "high", approval: "one_time" }
  };
}

async function runHistoryOpen(tab, payload) {
  requireChromeApi(chrome.tabs, "tabs");
  const url = readHttpUrl(payload.url, "history url");
  const opened = tab?.id ? await chrome.tabs.update(tab.id, { url }) : await chrome.tabs.create({ url });
  return {
    ok: true,
    output: { tab: normalizeTab(opened) },
    metadata: { verification: "history_url_opened", risk: "high", approval: "one_time" }
  };
}

async function runDebuggerInspect(tab, payload) {
  const target = readDebuggerTarget(tab, payload);
  const attached = await attachDebugger(target);
  try {
    await chrome.debugger.sendCommand(target, "Runtime.enable");
    const evaluation = await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
      expression: "(() => ({ title: document.title, url: location.href, readyState: document.readyState, activeElement: document.activeElement ? { tag: document.activeElement.tagName, id: document.activeElement.id, name: document.activeElement.getAttribute('name') } : null, bodyTextPreview: (document.body && document.body.innerText || '').slice(0, 2000), linkCount: document.links.length, formCount: document.forms.length, inputCount: document.querySelectorAll('input, textarea, select, button').length }))()",
      returnByValue: true,
      timeout: 1000
    });
    return {
      ok: true,
      output: { inspection: evaluation?.result?.value ?? null },
      metadata: { verification: "debugger_inspected", risk: "high", approval: "one_time", attached }
    };
  } finally {
    await detachDebugger(target);
  }
}

async function runDebuggerScreenshot(tab, payload) {
  const target = readDebuggerTarget(tab, payload);
  const attached = await attachDebugger(target);
  try {
    await chrome.debugger.sendCommand(target, "Page.enable");
    const capture = await chrome.debugger.sendCommand(target, "Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: payload.captureBeyondViewport === true
    });
    const data = typeof capture?.data === "string" ? capture.data : "";
    const maxInlineBytes = Math.min(Math.max(readInteger(payload.maxInlineBytes, 300 * 1024), 0), 384 * 1024);
    const byteLength = Math.ceil(data.length * 0.75);
    const includeData = payload.includeData === true && byteLength <= maxInlineBytes;
    const sha256 = data ? await sha256HexFromBase64(data) : "";
    return {
      ok: true,
      output: {
        screenshot: {
          format: "png",
          byteLength,
          sha256,
          dataOmitted: !includeData,
          ...(payload.includeData === true && !includeData ? { omittedReason: "inline_screenshot_too_large_for_daemon_result" } : {}),
          ...(includeData ? { dataUrl: `data:image/png;base64,${data}` } : {})
        }
      },
      metadata: { verification: "debugger_screenshot_captured", risk: "high", approval: "one_time", attached }
    };
  } finally {
    await detachDebugger(target);
  }
}

async function runDebuggerPrintToPdf(tab, payload) {
  const target = readDebuggerTarget(tab, payload);
  const attached = await attachDebugger(target);
  try {
    await chrome.debugger.sendCommand(target, "Page.enable");
    const print = await chrome.debugger.sendCommand(target, "Page.printToPDF", {
      landscape: payload.landscape === true,
      printBackground: payload.printBackground !== false,
      scale: clampNumber(payload.scale, 0.1, 2, 1),
      paperWidth: clampNumber(payload.paperWidth, 1, 24, 8.5),
      paperHeight: clampNumber(payload.paperHeight, 1, 36, 11),
      marginTop: clampNumber(payload.marginTop, 0, 2, 0.4),
      marginBottom: clampNumber(payload.marginBottom, 0, 2, 0.4),
      marginLeft: clampNumber(payload.marginLeft, 0, 2, 0.4),
      marginRight: clampNumber(payload.marginRight, 0, 2, 0.4),
      preferCSSPageSize: payload.preferCSSPageSize === true
    });
    const data = typeof print?.data === "string" ? print.data : "";
    const byteLength = Math.ceil(data.length * 0.75);
    const maxInlineBytes = Math.min(Math.max(readInteger(payload.maxInlineBytes, 0), 0), 512 * 1024);
    const includeData = payload.includeData === true && byteLength <= maxInlineBytes;
    const sha256 = data ? await sha256HexFromBase64(data) : "";
    return {
      ok: Boolean(data),
      output: {
        pdf: {
          format: "pdf",
          byteLength,
          sha256,
          dataOmitted: !includeData,
          ...(payload.includeData === true && !includeData ? { omittedReason: "inline_pdf_too_large_for_daemon_result" } : {}),
          ...(includeData ? { dataBase64: data } : {})
        }
      },
      error: data ? undefined : "Chrome debugger did not return PDF bytes.",
      metadata: { verification: data ? "debugger_pdf_printed" : "debugger_pdf_empty", risk: "high", approval: "one_time", attached }
    };
  } finally {
    await detachDebugger(target);
  }
}

async function runPermissionGet(tab, payload) {
  const permission = readPermissionDescriptor(tab, payload);
  const api = readContentSettingApi(permission.type);
  const current = await api.get({
    primaryUrl: permission.primaryUrl,
    ...(permission.incognito ? { incognito: true } : {})
  });
  return {
    ok: true,
    output: {
      permission: {
        type: permission.type,
        origin: permission.origin,
        primaryPattern: permission.primaryPattern,
        setting: readBoundedString(current?.setting, 64),
        pathRedacted: true
      }
    },
    metadata: {
      verification: "browser_permission_read",
      risk: "read_only",
      popupWorkflow: "content_settings_api",
      nativePopupClick: false
    }
  };
}

async function runPermissionSet(tab, payload) {
  const permission = readPermissionDescriptor(tab, payload);
  const api = readContentSettingApi(permission.type);
  const setting = readPermissionSetting(payload.setting);
  const scope = readContentSettingScope(payload.scope);
  await api.set({
    primaryPattern: permission.primaryPattern,
    setting,
    scope
  });
  const verified = await api.get({
    primaryUrl: permission.primaryUrl,
    ...(scope === "incognito_session_only" ? { incognito: true } : {})
  });
  const verifiedSetting = readBoundedString(verified?.setting, 64);
  return {
    ok: verifiedSetting === setting,
    output: {
      permission: {
        type: permission.type,
        origin: permission.origin,
        primaryPattern: permission.primaryPattern,
        requestedSetting: setting,
        verifiedSetting,
        pathRedacted: true
      }
    },
    error: verifiedSetting === setting ? undefined : "Browser permission setting did not verify after update.",
    metadata: {
      verification: verifiedSetting === setting ? "browser_permission_setting_applied" : "browser_permission_setting_mismatch",
      risk: "high",
      approval: "one_time",
      popupWorkflow: "content_settings_api",
      nativePopupClick: false
    }
  };
}

async function runFileUploadInspect(tab, payload) {
  requireChromeApi(chrome.scripting, "scripting");
  const tabId = readTargetTabId(tab, payload);
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: inspectFileInputs,
    args: [Math.min(Math.max(readInteger(payload.limit, 25), 1), 50)]
  });
  return {
    ok: true,
    output: {
      tabId,
      inputs: Array.isArray(result?.result) ? result.result : [],
      uploadStatus: "inspect_only"
    },
    metadata: { verification: "file_upload_inputs_inspected", risk: "high", approval: "one_time" }
  };
}

async function runFileUploadSetFiles(tab, payload, requestId) {
  const files = readApprovedFilePaths(payload, false);
  const target = readDebuggerTarget(tab, payload);
  const attached = await attachDebugger(target);
  try {
    const nodeId = await resolveFileInputNodeId(target, payload, requestId);
    await chrome.debugger.sendCommand(target, "DOM.setFileInputFiles", { nodeId, files });
    return {
      ok: true,
      output: {
        status: "files_selected",
        selector: readUploadSelector(payload),
        inputIndex: readInteger(payload.inputIndex, 0),
        files: files.map(normalizeLocalFileEvidence)
      },
      metadata: {
        verification: "file_upload_files_selected",
        risk: "high",
        approval: "one_time",
        attached,
        fileCount: files.length
      }
    };
  } finally {
    await cleanupFileInputMarker(target, requestId);
    await detachDebugger(target);
  }
}

async function runFileUploadClear(tab, payload, requestId) {
  const target = readDebuggerTarget(tab, payload);
  const attached = await attachDebugger(target);
  try {
    const nodeId = await resolveFileInputNodeId(target, payload, requestId);
    await chrome.debugger.sendCommand(target, "DOM.setFileInputFiles", { nodeId, files: [] });
    return {
      ok: true,
      output: {
        status: "files_cleared",
        selector: readUploadSelector(payload),
        inputIndex: readInteger(payload.inputIndex, 0)
      },
      metadata: { verification: "file_upload_files_cleared", risk: "high", approval: "one_time", attached }
    };
  } finally {
    await cleanupFileInputMarker(target, requestId);
    await detachDebugger(target);
  }
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

function normalizeTabGroup(group, tabs) {
  const groupedTabs = Array.isArray(tabs)
    ? tabs.filter((candidate) => candidate?.groupId === group?.id).map((candidate) => Number(candidate.id)).filter(Number.isFinite)
    : [];
  return {
    id: Number(group?.id),
    title: readBoundedString(group?.title, 120),
    color: readBoundedString(group?.color, 32),
    collapsed: Boolean(group?.collapsed),
    windowId: Number(group?.windowId),
    tabIds: groupedTabs
  };
}

function normalizeTab(tab) {
  return {
    id: tab?.id,
    windowId: tab?.windowId,
    index: Number.isInteger(tab?.index) ? tab.index : undefined,
    title: readBoundedString(tab?.title, 240),
    url: typeof tab?.url === "string" ? tab.url : undefined,
    active: Boolean(tab?.active)
  };
}

async function readTabActivationTarget(tab, payload) {
  const tabId = readInteger(payload.tabId, NaN);
  if (Number.isInteger(tabId) && tabId > 0) {
    const matches = await chrome.tabs.get(tabId).then((value) => [value]).catch(() => []);
    if (!matches[0]?.id) {
      throw new Error("Requested tab id was not found.");
    }
    return {
      id: matches[0].id,
      index: Number.isInteger(matches[0].index) ? matches[0].index : 0,
      windowId: matches[0].windowId
    };
  }
  const index = readTabIndex(payload);
  const windowId = readOptionalWindowId(tab, payload);
  const tabs = await chrome.tabs.query(windowId === undefined ? {} : { windowId });
  const ordered = tabs
    .filter((candidate) => Number.isInteger(candidate?.id))
    .sort((left, right) => Number(left.index ?? 0) - Number(right.index ?? 0));
  const target = ordered[index];
  if (!target?.id) {
    throw new Error(`No tab exists at requested index ${index}.`);
  }
  return {
    id: target.id,
    index: Number.isInteger(target.index) ? target.index : index,
    windowId: target.windowId
  };
}

function readTabIndex(payload) {
  const index = readInteger(payload.index, NaN);
  if (Number.isInteger(index) && index >= 0 && index < 100) {
    return index;
  }
  const ordinal = readInteger(payload.ordinal, NaN);
  if (Number.isInteger(ordinal) && ordinal >= 1 && ordinal <= 100) {
    return ordinal - 1;
  }
  throw new Error("Tab activation requires a zero-based index or one-based ordinal.");
}

function readOptionalWindowId(tab, payload) {
  const windowId = readInteger(payload.windowId, NaN);
  if (Number.isInteger(windowId) && windowId > 0) {
    return windowId;
  }
  const activeWindowId = readInteger(tab?.windowId, NaN);
  return Number.isInteger(activeWindowId) && activeWindowId > 0 ? activeWindowId : undefined;
}

function normalizeDownloadItem(item) {
  return {
    id: Number(item?.id),
    url: typeof item?.url === "string" ? item.url : undefined,
    finalUrl: typeof item?.finalUrl === "string" ? item.finalUrl : undefined,
    filename: readFilenamePreview(item?.filename),
    filenameRedacted: typeof item?.filename === "string",
    state: readBoundedString(item?.state, 32),
    danger: readBoundedString(item?.danger, 64),
    mime: readBoundedString(item?.mime, 120),
    startTime: item?.startTime,
    endTime: item?.endTime,
    bytesReceived: Number(item?.bytesReceived ?? 0),
    totalBytes: Number(item?.totalBytes ?? 0),
    exists: typeof item?.exists === "boolean" ? item.exists : undefined,
    paused: typeof item?.paused === "boolean" ? item.paused : undefined,
    canResume: typeof item?.canResume === "boolean" ? item.canResume : undefined
  };
}

function normalizeHistoryItem(item) {
  const redactedUrl = redactHistoryUrl(item?.url);
  return {
    id: String(item?.id ?? ""),
    title: readBoundedString(item?.title, 240),
    origin: redactedUrl.origin,
    url: redactedUrl.url,
    pathRedacted: redactedUrl.pathRedacted,
    lastVisitTime: item?.lastVisitTime,
    visitCount: Number(item?.visitCount ?? 0),
    typedCount: Number(item?.typedCount ?? 0)
  };
}

function readTabGroupChanges(payload) {
  const changes = {};
  const title = readBoundedString(payload.title, 120);
  const color = readTabGroupColor(payload.color);
  if (title) {
    changes.title = title;
  }
  if (color) {
    changes.color = color;
  }
  if (typeof payload.collapsed === "boolean") {
    changes.collapsed = payload.collapsed;
  }
  return changes;
}

function readTabGroupColor(value) {
  const color = readBoundedString(value, 32);
  return [
    "grey",
    "blue",
    "red",
    "yellow",
    "green",
    "pink",
    "purple",
    "cyan",
    "orange"
  ].includes(color) ? color : undefined;
}

function readTabIds(payload, tab) {
  if (Array.isArray(payload.tabIds)) {
    const tabIds = payload.tabIds.map((value) => readInteger(value, NaN)).filter((value) => Number.isInteger(value) && value > 0).slice(0, 50);
    if (tabIds.length) {
      return tabIds;
    }
  }
  const tabId = readInteger(payload.tabId, readInteger(tab?.id, NaN));
  if (!Number.isInteger(tabId) || tabId <= 0) {
    throw new Error("Tab group command requires a target tab id.");
  }
  return [tabId];
}

function readDownloadQuery(payload, requireNarrowQuery) {
  const query = {};
  const id = readInteger(payload.id, NaN);
  const url = typeof payload.url === "string" && payload.url.trim() ? readHttpUrl(payload.url, "download url") : "";
  const state = readDownloadState(payload.state);
  if (Number.isInteger(id) && id > 0) {
    query.id = id;
  }
  if (url) {
    query.url = url;
  }
  if (state) {
    query.state = state;
  }
  if (typeof payload.query === "string" && payload.query.trim()) {
    query.query = [payload.query.trim().slice(0, 240)];
  }
  query.limit = Math.min(Math.max(readInteger(payload.limit, 20), 1), 50);
  if (requireNarrowQuery && query.id === undefined && query.url === undefined) {
    throw new Error("Download erase requires id or url to avoid broad history removal.");
  }
  return query;
}

function readDownloadState(value) {
  const state = readBoundedString(value, 32);
  return state === "in_progress" || state === "interrupted" || state === "complete" ? state : undefined;
}

function readConflictAction(value) {
  const action = readBoundedString(value, 32);
  return action === "uniquify" || action === "overwrite" || action === "prompt" ? action : "uniquify";
}

function readDownloadFilename(value) {
  const filename = readBoundedString(value, 240);
  if (!filename) {
    return undefined;
  }
  if (/^[a-zA-Z]:/.test(filename) || filename.startsWith("/") || filename.startsWith("\\") || filename.includes("..")) {
    throw new Error("Download filename must be a relative path without parent traversal.");
  }
  return filename.replace(/\\/g, "/");
}

function readFilenamePreview(value) {
  if (typeof value !== "string" || !value) {
    return undefined;
  }
  const parts = value.split(/[\\/]/).filter(Boolean);
  return readBoundedString(parts[parts.length - 1], 160);
}

function redactHistoryUrl(value) {
  if (typeof value !== "string" || !value) {
    return { origin: undefined, url: undefined, pathRedacted: true };
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { origin: `${url.protocol}//`, url: `${url.protocol}//[redacted]`, pathRedacted: true };
    }
    return {
      origin: url.origin,
      url: `${url.origin}/[redacted]`,
      pathRedacted: true
    };
  } catch {
    return { origin: undefined, url: "[redacted]", pathRedacted: true };
  }
}

function readPermissionDescriptor(tab, payload) {
  const type = readPermissionType(payload.type ?? payload.permission);
  const primaryUrl = readHttpUrl(payload.primaryUrl ?? payload.url ?? tab?.url, "permission primaryUrl");
  const origin = readOrigin(primaryUrl);
  const primaryPattern = readPermissionPattern(payload.primaryPattern, origin);
  return {
    type,
    primaryUrl,
    origin,
    primaryPattern,
    incognito: payload.incognito === true
  };
}

function readContentSettingApi(type) {
  requireChromeApi(chrome.contentSettings, "contentSettings");
  const api = chrome.contentSettings[type];
  requireChromeApi(api, `contentSettings.${type}`);
  return api;
}

function readPermissionType(value) {
  const normalized = readRequiredString(value, "permission type").toLowerCase().replace(/[-\s]/g, "_");
  const aliases = {
    geo: "location",
    geolocation: "location",
    location: "location",
    notification: "notifications",
    notifications: "notifications",
    camera: "camera",
    microphone: "microphone",
    mic: "microphone",
    clipboard: "clipboard",
    popups: "popups",
    popup: "popups",
    automatic_downloads: "automaticDownloads",
    automaticdownloads: "automaticDownloads"
  };
  const type = aliases[normalized];
  if (!type) {
    throw new Error("Permission type must be one of camera, microphone, location, notifications, clipboard, popups, or automatic_downloads.");
  }
  return type;
}

function readPermissionSetting(value) {
  const setting = readRequiredString(value, "permission setting").toLowerCase();
  if (setting === "allow" || setting === "block" || setting === "ask") {
    return setting;
  }
  throw new Error("Permission setting must be allow, block, or ask.");
}

function readPermissionPattern(value, origin) {
  const pattern = readBoundedString(value, 512);
  if (pattern) {
    if (!/^https?:\/\/(\*|\*\.[^/*]+|[^/*]+)\/\*$/.test(pattern)) {
      throw new Error("Permission primaryPattern must be an http(s) origin pattern ending in /*.");
    }
    return pattern;
  }
  return `${origin}/*`;
}

function readContentSettingScope(value) {
  const scope = readBoundedString(value, 80);
  if (scope === "regular" || scope === "incognito_session_only") {
    return scope;
  }
  return "regular";
}

function readOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Permission origin must use http or https.");
  }
  return url.origin;
}

function readDebuggerTarget(tab, payload) {
  requireChromeApi(chrome.debugger, "debugger");
  const tabId = readTargetTabId(tab, payload);
  return { tabId };
}

function readTargetTabId(tab, payload) {
  const tabId = readInteger(payload.tabId, readInteger(tab?.id, NaN));
  if (!Number.isInteger(tabId) || tabId <= 0) {
    throw new Error("Browser Chrome command requires a target tab id.");
  }
  return tabId;
}

async function attachDebugger(target) {
  try {
    await chrome.debugger.attach(target, "1.3");
    return true;
  } catch (error) {
    throw new Error(`Chrome debugger attach failed: ${readError(error)}`);
  }
}

async function detachDebugger(target) {
  try {
    await chrome.debugger.detach(target);
  } catch {
    // Already detached or never attached.
  }
}

async function resolveFileInputNodeId(target, payload, requestId) {
  await chrome.debugger.sendCommand(target, "DOM.enable");
  await chrome.debugger.sendCommand(target, "Runtime.enable");
  const selector = readUploadSelector(payload);
  const marker = uploadMarker(requestId);
  const inputIndex = Math.min(Math.max(readInteger(payload.inputIndex, 0), 0), 100);
  const marked = await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
    expression: `(() => { const nodes = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).filter((node) => node instanceof HTMLInputElement && node.type === "file"); const target = nodes[${inputIndex}]; if (!target) return { ok: false, count: nodes.length }; target.setAttribute("data-codex-upload-target", ${JSON.stringify(marker)}); return { ok: true, count: nodes.length }; })()`,
    returnByValue: true,
    timeout: 1000
  });
  const markedValue = marked?.result?.value;
  if (!markedValue?.ok) {
    throw new Error(`No file input matched selector ${selector}. Matches: ${Number(markedValue?.count ?? 0)}.`);
  }
  const documentRoot = await chrome.debugger.sendCommand(target, "DOM.getDocument", { depth: -1, pierce: true });
  const found = await chrome.debugger.sendCommand(target, "DOM.querySelector", {
    nodeId: documentRoot?.root?.nodeId,
    selector: `[data-codex-upload-target="${marker}"]`
  });
  if (!found?.nodeId) {
    throw new Error("File input marker was not found after selection.");
  }
  return found.nodeId;
}

async function cleanupFileInputMarker(target, requestId) {
  try {
    const marker = uploadMarker(requestId);
    await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
      expression: `(() => { const node = document.querySelector(${JSON.stringify(`[data-codex-upload-target="${marker}"]`)}); if (node) node.removeAttribute("data-codex-upload-target"); })()`,
      returnByValue: false,
      timeout: 1000
    });
  } catch {
    // Cleanup is best-effort; the marker is non-secret and request-scoped.
  }
}

function uploadMarker(requestId) {
  return `codex-upload-${String(requestId ?? "request").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80)}`;
}

function readUploadSelector(payload) {
  return readBoundedString(payload.selector, 500) || "input[type='file']";
}

function readApprovedFilePaths(payload, allowEmpty) {
  const values = Array.isArray(payload.approvedFilePaths)
    ? payload.approvedFilePaths
    : Array.isArray(payload.files)
      ? payload.files
      : [];
  const files = values
    .map((value) => typeof value === "string" ? value.trim().slice(0, 1024) : "")
    .filter(Boolean);
  if (!allowEmpty && files.length === 0) {
    throw new Error("File upload requires approvedFilePaths.");
  }
  for (const filePath of files) {
    if (/[\0\r\n]/.test(filePath) || /^file:/i.test(filePath)) {
      throw new Error("File upload paths must be plain local filesystem paths, not file URLs or control-character strings.");
    }
    if (!isAbsoluteLocalPath(filePath)) {
      throw new Error("File upload paths must be absolute local filesystem paths.");
    }
  }
  return files.slice(0, 20);
}

function isAbsoluteLocalPath(value) {
  return /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value) || value.startsWith("/");
}

function normalizeLocalFileEvidence(value) {
  return {
    basename: readFilenamePreview(value),
    pathRedacted: true
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

function readHttpUrl(value, label) {
  const text = readRequiredString(value, label);
  const url = new URL(text);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must use http or https.`);
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

function readRequiredInteger(value, label) {
  const number = readInteger(value, NaN);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`Missing ${label}.`);
  }
  return number;
}

function readInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

async function sha256HexFromBase64(value) {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return "";
  }
}

function requireChromeApi(api, label) {
  if (!api) {
    throw new Error(`Browser ${label} API is unavailable. Check extension permissions.`);
  }
}

function readBoundedString(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function inspectFileInputs(limit) {
  const labels = Array.from(document.querySelectorAll("label"));
  return Array.from(document.querySelectorAll("input[type='file']")).slice(0, limit).map((input, index) => {
    const rect = input.getBoundingClientRect();
    const id = input.id || "";
    const label = labels.find((candidate) => (id && candidate.htmlFor === id) || candidate.contains(input));
    return {
      index,
      id,
      name: input.getAttribute("name") || "",
      accept: input.getAttribute("accept") || "",
      multiple: Boolean(input.multiple),
      disabled: Boolean(input.disabled),
      label: (label?.innerText || input.getAttribute("aria-label") || "").trim().slice(0, 240),
      bbox: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      },
      visible: rect.width > 0 && rect.height > 0
    };
  });
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
