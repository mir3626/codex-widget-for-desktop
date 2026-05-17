#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon } from "../dist/daemon/server.js";
import { createStorageService } from "../dist/daemon/storage/storage.js";
import {
  evaluateAutonomyPermission,
  summarizeBrowserProfilePolicy
} from "../dist/daemon/scoped-autonomy/index.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";

const tempRoot = mkdtempSync(join(tmpdir(), "codex-widget-browser-profile-permission-"));
let storage;

try {
  storage = createStorageService({ appDataDir: tempRoot });
  const requirements = [
    {
      type: "browser_profile_access",
      value: "https://example.com/account",
      reason: "Authenticated browser profile access requires explicit lease."
    },
    {
      type: "browser_session_access",
      value: "https://example.com/account",
      reason: "Session cookies are profile-private data."
    },
    {
      type: "browser_account_access",
      value: "tony@example.com",
      reason: "Account-scoped browser state must be consented."
    },
    {
      type: "cookie_jar_access",
      value: "https://example.com",
      reason: "Cookie jar access must never be default-allowed."
    },
    {
      type: "risk_class",
      value: "credential",
      reason: "Authenticated browser state is credential-bearing."
    }
  ];

  const noLeaseProfile = storage.createAutonomyPermissionProfile({
    name: "Browser profile default deny",
    mode: "scoped_yolo",
    scope: "one_time",
    grants: {
      browserAutomation: true,
      browserDomains: ["example.com"],
      credentialAccess: "ask",
      riskClasses: ["credential"],
      credentialLeases: []
    }
  });
  const denied = evaluateAutonomyPermission({ profile: noLeaseProfile, requirements });
  assert.equal(denied.allowed, false);
  assert.equal(denied.browserProfilePolicy.status, "blocked");
  assert.equal(denied.browserProfilePolicy.defaultDeny, true);
  assert.equal(denied.browserProfilePolicy.redactionPolicy.cookies, "never_store");

  const leaseProfile = storage.createAutonomyPermissionProfile({
    name: "Browser profile explicit leases",
    mode: "scoped_yolo",
    scope: "one_time",
    grants: {
      browserAutomation: true,
      browserDomains: ["example.com"],
      credentialAccess: "ask",
      riskClasses: ["credential"],
      credentialLeases: [
        {
          id: "lease-profile",
          status: "active",
          scope: "browser_profile",
          domains: ["example.com"],
          accountHints: ["tony@example.com"],
          purposes: ["profile access"],
          vaultRefs: [],
          expiresAt: "2999-01-01T00:00:00.000Z"
        },
        {
          id: "lease-session",
          status: "active",
          scope: "site_session",
          domains: ["example.com"],
          accountHints: ["tony@example.com"],
          purposes: ["session access"],
          vaultRefs: [],
          expiresAt: "2999-01-01T00:00:00.000Z"
        },
        {
          id: "lease-cookie",
          status: "active",
          scope: "cookie_jar",
          domains: ["example.com"],
          purposes: ["cookie jar access"],
          vaultRefs: [],
          expiresAt: "2999-01-01T00:00:00.000Z"
        }
      ]
    }
  });
  const allowed = evaluateAutonomyPermission({ profile: leaseProfile, requirements });
  assert.equal(allowed.allowed, true, JSON.stringify(allowed, null, 2));
  assert.equal(allowed.browserProfilePolicy.status, "allowed");
  assert.deepEqual(allowed.browserProfilePolicy.matchedLeaseIds.sort(), ["lease-cookie", "lease-profile", "lease-session"]);
  assert.equal(allowed.browserProfilePolicy.cookieAccess, "metadata_only_or_user_approved_helper");

  const summary = summarizeBrowserProfilePolicy({
    grants: leaseProfile.grants,
    requirements
  });
  assert.equal(summary.status, "allowed");
  assert.equal(summary.auditTrail, "decision_summary_only");

  const revoked = storage.revokeAutonomyCredentialLease({
    profileId: leaseProfile.id,
    leaseId: "lease-cookie",
    reason: "smoke_cookie_revoke"
  });
  const deniedAfterRevoke = evaluateAutonomyPermission({ profile: revoked, requirements });
  assert.equal(deniedAfterRevoke.allowed, false);
  assert.equal(deniedAfterRevoke.browserProfilePolicy.status, "blocked");
  assert.equal(deniedAfterRevoke.missingRequirements.some((requirement) => requirement.type === "cookie_jar_access"), true);

  const smokeAppData = useSmokeAppData("codex-widget-browser-profile-permission-route");
  const daemon = await startDaemon({ port: 0 });
  try {
    const baseUrl = `http://127.0.0.1:${daemon.port}`;
    const routeProfile = await postJson(baseUrl, "/computer-use/autonomy/profiles", {
      name: "Route browser profile lease",
      mode: "scoped_yolo",
      scope: "one_time",
      grants: {
        browserAutomation: true,
        browserDomains: ["example.com"],
        credentialAccess: "ask",
        riskClasses: ["credential"],
        credentialLeases: [
          {
            id: "route-browser-profile-lease",
            status: "active",
            scope: "browser_profile",
            domains: ["example.com"],
            accountHints: ["tony@example.com"],
            purposes: ["route revoke"],
            vaultRefs: [],
            expiresAt: "2999-01-01T00:00:00.000Z"
          }
        ]
      }
    });
    assert.equal(routeProfile.ok, true);
    const revokedByRoute = await postJson(
      baseUrl,
      `/computer-use/autonomy/profiles/${encodeURIComponent(routeProfile.profile.id)}/browser-profile-leases/route-browser-profile-lease/revoke`,
      { reason: "route_browser_profile_revoke" }
    );
    assert.equal(revokedByRoute.ok, true);
    assert.equal(revokedByRoute.audit.redaction.cookies, "never_store");
    assert.equal(revokedByRoute.profile.grants.credentialLeases[0].status, "revoked");
  } finally {
    await daemon.close();
    smokeAppData.cleanup();
  }

  console.log("computer use browser profile permission smoke ok");
} finally {
  storage?.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

async function postJson(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }
  return await response.json();
}
