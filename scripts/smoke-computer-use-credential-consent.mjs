#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDaemon } from "../dist/daemon/server.js";
import { createStorageService } from "../dist/daemon/storage/storage.js";
import {
  evaluateAutonomyPermission,
  sanitizeAutonomyInput,
  summarizeCredentialPolicy
} from "../dist/daemon/scoped-autonomy/index.js";
import { useSmokeAppData } from "./smoke-isolation.mjs";

process.env.CODEX_WIDGET_AUTH_MODE = "mock";
const tempRoot = mkdtempSync(join(tmpdir(), "codex-widget-credential-consent-"));
let storage;

try {
  storage = createStorageService({ appDataDir: tempRoot });
  const requirement = {
    type: "credential_access",
    value: "https://example.com/account",
    reason: "Authenticated account page requires a user-approved session lease."
  };
  const credentialRisk = {
    type: "risk_class",
    value: "credential",
    reason: "Credential-bearing profile data requires credential risk consent."
  };

  const noLeaseProfile = storage.createAutonomyPermissionProfile({
    name: "Credential consent without lease",
    mode: "scoped_yolo",
    scope: "one_time",
    grants: {
      credentialAccess: "ask",
      riskClasses: ["credential"],
      credentialLeases: [],
      redactionPolicy: {
        credentials: "redact",
        cookies: "never_store",
        localPaths: "basename_or_hash",
        browserHistory: "domain_only",
        screenshots: "metadata_only",
        debugBundles: "redacted_summary",
        semanticMemory: "no_secret_values"
      }
    }
  });
  const denied = evaluateAutonomyPermission({
    profile: noLeaseProfile,
    requirements: [requirement, credentialRisk]
  });
  assert.equal(denied.allowed, false);
  assert.equal(denied.credentialPolicy.status, "blocked");
  assert.equal(denied.credentialPolicy.vaultAccess, "reference_only");

  const leaseProfile = storage.createAutonomyPermissionProfile({
    name: "Credential consent with lease",
    mode: "scoped_yolo",
    scope: "one_time",
    maxUses: 1,
    grants: {
      credentialAccess: "ask",
      riskClasses: ["credential"],
      credentialLeases: [
        {
          id: "lease-example-account",
          status: "active",
          scope: "site_session",
          domains: ["example.com"],
          purposes: ["account verification"],
          vaultRefs: [
            {
              id: "vault-ref-example",
              provider: "windows_credential_manager",
              label: "Example account",
              secretKind: "session",
              redacted: true
            }
          ],
          maxUses: 1,
          usedCount: 0,
          expiresAt: "2999-01-01T00:00:00.000Z",
          createdAt: "2026-05-17T00:00:00.000Z"
        }
      ],
      redactionPolicy: {
        credentials: "redact",
        cookies: "never_store",
        localPaths: "basename_or_hash",
        browserHistory: "domain_only",
        screenshots: "not_stored",
        debugBundles: "redacted_summary",
        semanticMemory: "no_secret_values"
      }
    }
  });
  const allowed = evaluateAutonomyPermission({
    profile: leaseProfile,
    requirements: [requirement, credentialRisk]
  });
  assert.equal(allowed.allowed, true, JSON.stringify(allowed));
  assert.equal(allowed.credentialPolicy.status, "allowed");
  assert.deepEqual(allowed.credentialPolicy.matchedLeaseIds, ["lease-example-account"]);
  assert.equal(allowed.credentialPolicy.redactionPolicy.cookies, "never_store");

  const summary = summarizeCredentialPolicy({
    grants: leaseProfile.grants,
    requirements: [requirement]
  });
  assert.equal(summary.status, "allowed");
  assert.equal(summary.vaultAccess, "reference_only");

  const redacted = sanitizeAutonomyInput({
    login: {
      password: "hunter2",
      token: "token=abc123",
      nested: [{ cookie: "cookie=session-value" }]
    },
    safe: "public label"
  });
  assert.equal(redacted.login.password, "[redacted]");
  assert.equal(redacted.login.token, "[redacted]");
  assert.equal(redacted.login.nested[0].cookie, "[redacted]");
  assert.equal(redacted.safe, "public label");

  const revoked = storage.revokeAutonomyCredentialLease({
    profileId: leaseProfile.id,
    leaseId: "lease-example-account",
    reason: "smoke_user_revoked"
  });
  assert.equal(revoked.grants.credentialLeases[0].status, "revoked");
  assert.equal(revoked.grants.credentialLeases[0].revokeReason, "smoke_user_revoked");
  const deniedAfterRevoke = evaluateAutonomyPermission({
    profile: revoked,
    requirements: [requirement, credentialRisk]
  });
  assert.equal(deniedAfterRevoke.allowed, false);
  assert.equal(deniedAfterRevoke.credentialPolicy.status, "blocked");

  const smokeAppData = useSmokeAppData("codex-widget-credential-consent-route");
  const daemon = await startDaemon({ port: 0 });
  try {
    const baseUrl = `http://127.0.0.1:${daemon.port}`;
    const routeProfile = await postJson(baseUrl, "/computer-use/autonomy/profiles", {
      name: "Route credential lease",
      mode: "scoped_yolo",
      scope: "one_time",
      maxUses: 1,
      grants: {
        credentialAccess: "ask",
        riskClasses: ["credential"],
        credentialLeases: [
          {
            id: "lease-route",
            status: "active",
            scope: "site_session",
            domains: ["example.com"],
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
      `/computer-use/autonomy/profiles/${encodeURIComponent(routeProfile.profile.id)}/credential-leases/lease-route/revoke`,
      { reason: "route_smoke_revoke" }
    );
    assert.equal(revokedByRoute.ok, true);
    assert.equal(revokedByRoute.profile.grants.credentialLeases[0].status, "revoked");
    assert.equal(revokedByRoute.profile.grants.credentialLeases[0].revokeReason, "route_smoke_revoke");
  } finally {
    await daemon.close();
    smokeAppData.cleanup();
  }

  console.log("computer use credential consent smoke ok");
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
