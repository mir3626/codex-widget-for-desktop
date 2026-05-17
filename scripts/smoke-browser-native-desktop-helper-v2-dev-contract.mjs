#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const protocol = readFileSync("src/shared/protocol/computerUse.ts", "utf8");
const helperClient = readFileSync("src/daemon/browser-action/adapters/nativeDesktop/helperClient.ts", "utf8");
const adapter = readFileSync("src/daemon/browser-action/adapters/nativeDesktopAdapter.ts", "utf8");
const preconditions = readFileSync("src/daemon/computer-use/foregroundPreconditions.ts", "utf8");
const contract = readFileSync("scripts/lib/browser-native-desktop-helper-contract.mjs", "utf8");

for (const token of [
  "ForegroundWatchPreflightState",
  "activeWindowAsserted",
  "targetIdentityAsserted",
  "surfaceLockArmed",
  "abortOnUserInputArmed",
  "userInputDetected",
  "activeWindowDriftDetected",
  "preActionEvidenceReady",
  "postActionEvidenceReady",
  "actualInputSent: false"
]) {
  assert.equal(protocol.includes(token) || preconditions.includes(token), true, `missing ${token}`);
}

for (const command of [
  "foreground_watch_execute",
  "capture_screenshot",
  "file_picker_select",
  "browser_permission_popup_click",
  "clipboard_set_scoped",
  "menu_command"
]) {
  assert.equal(helperClient.includes(command), true, `helper client missing ${command}`);
  assert.equal(contract.includes(command), true, `contract missing ${command}`);
}

assert.equal(contract.includes("browser-native-desktop-helper-v2-disabled-command.v1"), true);
assert.equal(contract.includes("browser-native-desktop-helper-foreground-watch-executor.v1"), true);
assert.equal(contract.includes("signed_helper_v2_unavailable") || adapter.includes("signed_helper_v2_unavailable"), true);
assert.equal(contract.includes("actualInputSent") && contract.includes("false"), true);
assert.equal(contract.includes("dryRunOnly") && adapter.includes("signedHelperV2Available"), true);
assert.equal(adapter.includes("screenshotCaptured") && contract.includes("screenshotCaptured"), true);

console.log("browser native desktop helper v2 dev contract smoke ok");
