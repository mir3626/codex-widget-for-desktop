import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type BrowserBridgeExpectedBuildInfo = {
  extensionVersion?: string;
  extensionBuildId?: string;
  extensionSourceHash?: string;
};

export const BROWSER_BRIDGE_HASHED_SOURCE_FILES = [
  "manifest.json",
  "service-worker.js",
  "bridge/action-channel.js",
  "bridge/badge.js",
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
] as const;

export function readExpectedBrowserBridgeBuildInfo(root = process.cwd()): BrowserBridgeExpectedBuildInfo {
  try {
    const extensionRoot = resolve(root, "providers/browser-dom-extension");
    const manifest = JSON.parse(readFileSync(resolve(extensionRoot, "manifest.json"), "utf8")) as { version?: unknown };
    const hash = createHash("sha256");
    for (const relativePath of BROWSER_BRIDGE_HASHED_SOURCE_FILES) {
      hash.update(relativePath);
      hash.update("\0");
      hash.update(readFileSync(resolve(extensionRoot, relativePath)));
      hash.update("\0");
    }
    const extensionSourceHash = hash.digest("hex");
    const extensionVersion = typeof manifest.version === "string" ? manifest.version : undefined;
    return {
      extensionVersion,
      extensionSourceHash,
      extensionBuildId: extensionVersion ? `${extensionVersion}:${extensionSourceHash.slice(0, 12)}` : extensionSourceHash.slice(0, 12)
    };
  } catch {
    return {};
  }
}
