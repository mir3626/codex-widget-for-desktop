export const DEFAULT_DAEMON_BASE_URL = "http://127.0.0.1:4128";
export const DEFAULT_DAEMON_DOM_SNAPSHOT_URL = `${DEFAULT_DAEMON_BASE_URL}/providers/dom/snapshot`;
export const DEFAULT_BROWSER_ACTION_POLL_PATH = "/browser-action/extension/poll";
export const DEFAULT_BROWSER_ACTION_ACK_PATH = "/browser-action/extension/ack";
export const DEFAULT_BROWSER_ACTION_COMMAND_ACK_PATH = "/browser-action/extension/action-ack";
export const DEFAULT_BROWSER_ACTION_RESULT_PATH = "/browser-action/extension/result";
export const DEFAULT_BROWSER_CHROME_RESULT_PATH = "/browser-action/extension/browser-chrome-result";
export const DEFAULT_BROWSER_ACTION_OBSERVE_RESULT_PATH = "/browser-action/extension/observe-result";
export const DEFAULT_BROWSER_ACTION_HEARTBEAT_PATH = "/browser-action/extension/heartbeat";
export const DEFAULT_BROWSER_ACTION_STATUS_PATH = "/browser-action/extension/status";
export const NATIVE_HOST_NAME = "com.mir3626.codex_widget_dom";
export const BRIDGE_ALARM_NAME = "codex-widget-browser-bridge";
export const ALL_SITE_ORIGINS = ["http://*/*", "https://*/*"];
export const BRIDGE_SOURCE_HASH_FILES = [
  "manifest.json",
  "service-worker.js",
  "bridge/action-channel.js",
  "bridge/badge.js",
  "bridge/browser-chrome.js",
  "bridge/config.js",
  "bridge/injected-actions.js",
  "bridge/injected-dom.js",
  "bridge/settings.js",
  "bridge/tab-state.js",
  "popup.html",
  "popup.js",
  "popup-utils.js",
  "options.html",
  "options.js"
];
