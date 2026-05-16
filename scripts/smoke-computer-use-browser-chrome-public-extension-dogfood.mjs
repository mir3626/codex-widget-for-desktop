#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const evidence = readLatestEvidence();
const samples = readSampleLedger(join("docs", "reports", "assets", "computer-use-browser-chrome-public-extension-runs.jsonl"));
const latestSamples = samples.filter((sample) => sample.runId === evidence.runId);

assert.equal(evidence.schemaVersion, "computer-use-browser-chrome-public-extension-dogfood.v1");
assert.equal(evidence.evidenceClass, "real_extension_public_site_repeated");
assert.equal(evidence.extension?.browserApiExecution, true);
assert.equal(evidence.metrics?.realExtension, true);
assert.equal(evidence.metrics?.localFixture, false);
assert.equal(evidence.metrics?.publicSite, true);
assert.equal(evidence.metrics?.repeatedSamples, true);
assert.equal(evidence.metrics?.requiredHostsPresent, true);
assert.equal(evidence.metrics?.downloadVerifyCovered, true);
assert.equal(evidence.metrics?.debuggerPrintPdfCovered, true);
assert.equal(evidence.metrics?.tabGroupCovered, true);
assert.equal(evidence.metrics?.historySearchCovered, true);
assert.equal(evidence.metrics?.permissionSettingCovered, true);
assert.equal(evidence.metrics?.multiTabGroupCovered, true);
assert.equal(evidence.metrics?.fileUploadCovered, true);
assert.equal(evidence.metrics?.profileApprovalCovered, true);
for (const expectedType of ["camera", "microphone", "location"]) {
  assert.equal(evidence.metrics?.permissionTypesCovered?.includes(expectedType), true);
}
assert.equal(evidence.metrics?.redactionProofPresent, true);
assert.equal(evidence.metrics?.cleanupReconciled, true);
assert.equal(Number(evidence.metrics?.successRate), 1);
assert.equal(Number(evidence.metrics?.p95LatencyMs) > 0, true);
assert.equal(latestSamples.length >= 18, true);

const downloads = evidence.scenarios.filter((scenario) => scenario.command === "download.start+download.verify");
const prints = evidence.scenarios.filter((scenario) => scenario.command === "debugger.print_to_pdf");
const tabGroups = evidence.scenarios.filter((scenario) => scenario.command === "tab_group.claim+update+release");
const histories = evidence.scenarios.filter((scenario) => scenario.command === "history.search");
const permissions = evidence.scenarios.filter((scenario) => scenario.command === "permission.get+set+rollback");
const multiTabGroups = evidence.scenarios.filter((scenario) => scenario.command === "tab_group.multi_tab_claim+update+release");
const fileUploads = evidence.scenarios.filter((scenario) => scenario.command === "file_upload.inspect+set_files+clear");
assert.equal(downloads.length >= 2, true);
assert.equal(prints.length >= 2, true);
assert.equal(tabGroups.length >= 2, true);
assert.equal(histories.length >= 2, true);
assert.equal(permissions.length >= 6, true);
assert.equal(multiTabGroups.length >= 2, true);
assert.equal(fileUploads.length >= 2, true);
assert.equal(evidence.profileApproval?.success, true);
assert.equal(evidence.profileApproval?.profileScope, "one_time");
assert.equal(evidence.profileApproval?.missingGrantTypes?.includes("browser_automation"), true);
assert.equal(evidence.profileApproval?.missingGrantTypes?.includes("risk_class"), true);
assert.equal(evidence.profileApproval?.attachedDecisionPresent, true);
assert.equal(evidence.profileApproval?.attachedEvalStepPresent, true);
assert.equal(evidence.profileApproval?.cleanupReconciled, true);
assert.match(JSON.stringify(evidence.profileApproval?.redaction ?? {}), /types_only/);
assert.match(JSON.stringify(evidence.profileApproval?.redaction ?? {}), /public_url_hash_only/);
for (const download of downloads) {
  assert.equal(download.success, true);
  assert.equal(download.result.fileExists, true);
  assert.equal(download.result.sourceHost, "www.w3.org");
  assert.equal(typeof download.result.sourceUrlHash, "string");
  assert.equal(download.result.sourceUrlHash.length >= 32, true);
  assert.equal(download.result.resourceRoles?.includes("download_verified_file"), true);
  assert.match(JSON.stringify(download.result.redaction ?? {}), /basename_only/);
  assert.match(JSON.stringify(download.result.redaction ?? {}), /public_url_hash_only/);
  assert.equal(typeof download.result.fileSha256, "string");
  assert.equal(download.result.fileSha256.length >= 32, true);
}
for (const print of prints) {
  assert.equal(print.success, true);
  assert.equal(print.result.sourceHost, "example.com");
  assert.equal(typeof print.result.sourceUrlHash, "string");
  assert.equal(print.result.sourceUrlHash.length >= 32, true);
  assert.equal(Number(print.result.byteLength) > 0, true);
  assert.equal(typeof print.result.pdfSha256, "string");
  assert.equal(print.result.pdfSha256.length >= 32, true);
  assert.equal(print.result.dataOmitted, true);
  assert.match(JSON.stringify(print.result.redaction ?? {}), /public_url_hash_only/);
  assert.match(JSON.stringify(print.result.redaction ?? {}), /arbitraryCdpEvalAllowed":false/);
}
for (const tabGroup of tabGroups) {
  assert.equal(tabGroup.success, true);
  assert.equal(tabGroup.result.sourceHost, "example.com");
  assert.equal(typeof tabGroup.result.sourceUrlHash, "string");
  assert.equal(tabGroup.result.sourceUrlHash.length >= 32, true);
  assert.equal(Number.isInteger(tabGroup.result.groupId), true);
  assert.equal(Number(tabGroup.result.releaseCount) >= 1, true);
  assert.equal(Number(tabGroup.result.verifierNodeCount) >= 1, true);
  assert.equal(Number(tabGroup.result.evalLedgerNodeCount) >= 1, true);
  assert.match(JSON.stringify(tabGroup.result.redaction ?? {}), /dogfood_owned_tab/);
  assert.match(JSON.stringify(tabGroup.result.redaction ?? {}), /public_url_hash_only/);
}
for (const history of histories) {
  assert.equal(history.success, true);
  assert.equal(history.result.sourceHost, "example.com");
  assert.equal(typeof history.result.sourceUrlHash, "string");
  assert.equal(history.result.sourceUrlHash.length >= 32, true);
  assert.equal(Number(history.result.historyItemCount) >= 1, true);
  assert.equal(Number(history.result.matchingHostCount) >= 1, true);
  assert.equal(Number(history.result.pathRedactedCount), Number(history.result.historyItemCount));
  assert.equal(history.result.approval, "one_time");
  assert.equal(history.result.risk, "high");
  assert.equal(Number(history.result.verifierNodeCount) >= 1, true);
  assert.equal(Number(history.result.evalLedgerNodeCount) >= 1, true);
  assert.match(JSON.stringify(history.result.redaction ?? {}), /one_time_fresh_profile_path_redacted/);
  assert.match(JSON.stringify(history.result.redaction ?? {}), /dogfood_fresh_profile_only/);
  assert.match(JSON.stringify(history.result.redaction ?? {}), /public_url_hash_only/);
}
const permissionTypes = new Set(permissions.map((permission) => permission.result.permissionType));
for (const expectedType of ["camera", "microphone", "location"]) {
  assert.equal(permissionTypes.has(expectedType), true);
}
for (const permission of permissions) {
  assert.equal(permission.success, true);
  assert.equal(permission.result.sourceHost, "example.com");
  assert.equal(permission.result.permissionHost, "example.com");
  assert.equal(["camera", "microphone", "location"].includes(permission.result.permissionType), true);
  assert.equal(permission.result.permissionPattern, "host_scoped_wildcard");
  assert.equal(typeof permission.result.sourceUrlHash, "string");
  assert.equal(permission.result.sourceUrlHash.length >= 32, true);
  assert.equal(permission.result.appliedSetting, "block");
  assert.equal(permission.result.verifiedAfterSet, "block");
  assert.equal(permission.result.rollbackSetting, permission.result.initialSetting);
  assert.equal(permission.result.verifiedAfterRollback, permission.result.initialSetting);
  assert.equal(permission.result.approval, "one_time");
  assert.equal(permission.result.risk, "high");
  assert.equal(permission.result.nativePopupClick, false);
  assert.equal(permission.result.popupWorkflow, "content_settings_api");
  assert.equal(Number(permission.result.verifierNodeCount) >= 1, true);
  assert.equal(Number(permission.result.evalLedgerNodeCount) >= 1, true);
  assert.match(JSON.stringify(permission.result.redaction ?? {}), /host_only_no_path/);
  assert.match(JSON.stringify(permission.result.redaction ?? {}), /restored_to_initial_setting/);
  assert.match(JSON.stringify(permission.result.redaction ?? {}), /public_url_hash_only/);
}
for (const multiTabGroup of multiTabGroups) {
  assert.equal(multiTabGroup.success, true);
  assert.equal(multiTabGroup.result.sourceHost, "example.com");
  assert.equal(typeof multiTabGroup.result.sourceUrlHash, "string");
  assert.equal(multiTabGroup.result.sourceUrlHash.length >= 32, true);
  assert.equal(Number.isInteger(multiTabGroup.result.groupId), true);
  assert.equal(Number(multiTabGroup.result.tabCount), 2);
  assert.equal(Number(multiTabGroup.result.releaseCount) >= 2, true);
  assert.equal(Number(multiTabGroup.result.verifierNodeCount) >= 1, true);
  assert.equal(Number(multiTabGroup.result.evalLedgerNodeCount) >= 1, true);
  assert.match(JSON.stringify(multiTabGroup.result.redaction ?? {}), /dogfood_owned_multi_tab/);
  assert.match(JSON.stringify(multiTabGroup.result.redaction ?? {}), /public_url_hash_only/);
}
for (const fileUpload of fileUploads) {
  assert.equal(fileUpload.success, true);
  assert.equal(fileUpload.result.sourceHost, "the-internet.herokuapp.com");
  assert.equal(typeof fileUpload.result.sourceUrlHash, "string");
  assert.equal(fileUpload.result.sourceUrlHash.length >= 32, true);
  assert.equal(Number(fileUpload.result.inputCount) >= 1, true);
  assert.equal(fileUpload.result.targetInputFound, true);
  assert.equal(Number(fileUpload.result.selectedFileCount), 1);
  assert.equal(Array.isArray(fileUpload.result.selectedBasenames), true);
  assert.equal(fileUpload.result.selectedBasenames.some((name) => /^codex-public-upload-\d+\.txt$/.test(name)), true);
  assert.equal(fileUpload.result.clearStatus, "files_cleared");
  assert.equal(fileUpload.result.approval, "one_time");
  assert.equal(fileUpload.result.risk, "high");
  assert.equal(fileUpload.result.pathRedacted, true);
  assert.equal(fileUpload.result.submitClicked, false);
  assert.equal(Number(fileUpload.result.verifierNodeCount) >= 1, true);
  assert.equal(Number(fileUpload.result.evalLedgerNodeCount) >= 1, true);
  assert.match(JSON.stringify(fileUpload.result.redaction ?? {}), /basename_only/);
  assert.match(JSON.stringify(fileUpload.result.redaction ?? {}), /not_submitted/);
  assert.match(JSON.stringify(fileUpload.result.redaction ?? {}), /public_url_hash_only/);
}
assert.equal(hasSensitiveLiteral(evidence), false);

console.log(`computer use browser chrome public extension dogfood smoke ok: ${evidence.path} samples=${latestSamples.length}`);

function readLatestEvidence() {
  const root = join("docs", "reports", "assets");
  if (!existsSync(root)) {
    throw new Error("Missing docs/reports/assets.");
  }
  const entries = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const match = /^computer-use-browser-chrome-public-extension-(\d{4}-\d{2}-\d{2})$/.exec(entry.name);
      if (!match) {
        return null;
      }
      const path = join(root, entry.name, "evidence.json");
      if (!existsSync(path)) {
        return null;
      }
      return {
        date: match[1],
        path: path.replace(/\\/g, "/"),
        data: JSON.parse(readFileSync(path, "utf8"))
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
  const latest = entries.at(-1);
  if (!latest) {
    throw new Error("Missing Computer Use Browser Chrome public extension evidence. Run npm run dogfood:computer-use-browser-chrome-public-extension first.");
  }
  return {
    ...latest.data,
    path: latest.path
  };
}

function readSampleLedger(path) {
  if (!existsSync(path)) {
    throw new Error(`Missing sample ledger: ${path}`);
  }
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function hasSensitiveLiteral(value) {
  return /\b(password|token|cookie|secret|credential|api[_-]?key|authorization)\b/i.test(JSON.stringify(value));
}
