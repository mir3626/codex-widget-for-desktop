#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const today = new Date().toISOString().slice(0, 10);
const evidenceDir = join(repoRoot, "docs", "reports", "assets", `computer-use-implementation-ready-parity-${today}`);
const evidencePath = join(evidenceDir, "evidence.json");
const reportPath = join(repoRoot, "docs", "reports", `computer-use-implementation-ready-parity-${today}.md`);

const checks = [
  containsCheck({
    id: "credential:consent-lease-protocol",
    file: "src/shared/protocol/scopedAutonomy.ts",
    markers: ["AutonomyCredentialLeaseGrant", "AutonomyCredentialVaultRef", "AutonomyCredentialRedactionPolicy"],
    requirement: "Shared protocol defines expiring credential consent leases, redacted vault references, and redaction policy."
  }),
  containsCheck({
    id: "credential:evaluator-fail-closed",
    file: "src/daemon/scoped-autonomy/credentialPolicy.ts",
    markers: ["evaluateCredentialRequirement", "Credential access is disabled", "A live credential consent lease covers this requirement"],
    requirement: "Credential access is denied unless an active lease and credential risk consent cover the requirement."
  }),
  containsCheck({
    id: "credential:revoke-route",
    file: "src/daemon/server/http/routes/computerUseEvalRoutes.ts",
    markers: ["credential-leases", "revokeAutonomyCredentialLease"],
    requirement: "Daemon exposes a focused credential lease revoke endpoint."
  }),
  containsCheck({
    id: "credential:redaction-smoke",
    file: "scripts/smoke-computer-use-credential-consent.mjs",
    markers: ["sanitizeAutonomyInput", "revokeAutonomyCredentialLease", "vaultAccess"],
    requirement: "Focused smoke proves lease gating, reference-only vault access, revoke, and credential redaction."
  }),
  containsCheck({
    id: "ui:credential-lease-evidence",
    file: "src/renderer/components/computer-use/permissionEvidenceHelpers.ts",
    markers: ["credential lease", "Credential consent requires an active expiring lease"],
    requirement: "Renderer profile tooling surfaces credential lease evidence and blocks unsafe drafts."
  }),
  containsCheck({
    id: "local-contract:official-contract-deferred",
    file: "docs/architecture/open-blockers.md",
    markers: ["app-server", "external contract", "redaction"],
    requirement: "Official app-server client tool remains explicitly deferred while local contract stays bounded."
  }),
  containsCheck({
    id: "vm:cloud-sandbox-deferred",
    file: "docs/plans/computer-use-implementation-ready-parity.md",
    markers: ["cloud VM", "Windows Sandbox", "future_vm_session"],
    requirement: "VM/RDP/Windows Sandbox work is documented as deferred and environment-dependent."
  }),
  containsCheck({
    id: "asr:user-corpus-deferred",
    file: "docs/plans/computer-use-implementation-ready-parity.md",
    markers: ["human microphone corpus", "user test", "GPU ASR"],
    requirement: "ASR validation is documented as user-test deferred rather than silently complete."
  }),
  containsCheck({
    id: "parity:audit-boundary",
    file: "docs/reports/windows-codex-computer-use-parity-audit-2026-05-17.md",
    markers: ["implemented_with_guarded_boundaries", "Open External Blockers"],
    requirement: "Windows parity audit still separates local implementation from external blockers."
  })
];

const passed = checks.filter((check) => check.status === "passed").length;
const missing = checks.length - passed;
const status = missing === 0 ? "implementation_ready_with_external_deferred" : "missing_implementation_ready_evidence";
const evidence = {
  schemaVersion: "computer-use-implementation-ready-parity-audit.v1",
  generatedAt: new Date().toISOString(),
  status,
  summary: {
    total: checks.length,
    passed,
    missing,
    productionExternalDeferred: [
      "production_authenticode_certificate_or_ci_signing_service",
      "official_app_server_custom_client_tool_contract",
      "real_vm_rdp_windows_sandbox_or_cloud_vm_backend",
      "gpu_asr_validation",
      "human_microphone_asr_corpus_benchmark"
    ]
  },
  checks
};

mkdirSync(evidenceDir, { recursive: true });
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
writeFileSync(reportPath, renderReport(evidence), "utf8");

console.log(`computer use implementation-ready parity audit: ${status}`);
console.log(`passed: ${passed}`);
console.log(`missing: ${missing}`);
console.log(`evidence: ${relative(evidencePath)}`);
console.log(`report: ${relative(reportPath)}`);

if (missing > 0) {
  process.exitCode = 1;
}

function containsCheck(input) {
  const path = join(repoRoot, input.file);
  let content = "";
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return {
      id: input.id,
      status: "missing",
      requirement: input.requirement,
      evidence: input.file,
      missingMarkers: input.markers
    };
  }
  const missingMarkers = input.markers.filter((marker) => !content.includes(marker));
  return {
    id: input.id,
    status: missingMarkers.length ? "missing" : "passed",
    requirement: input.requirement,
    evidence: input.file,
    missingMarkers
  };
}

function renderReport(evidence) {
  const lines = [
    "# Computer Use Implementation-Ready Parity Audit",
    "",
    `Generated: ${evidence.generatedAt}`,
    "",
    `Status: ${evidence.status}`,
    "",
    "## Summary",
    "",
    `- total: ${evidence.summary.total}`,
    `- passed: ${evidence.summary.passed}`,
    `- missing: ${evidence.summary.missing}`,
    "",
    "## Checklist",
    "",
    "| Status | ID | Requirement | Evidence | Missing markers |",
    "|---|---|---|---|---|",
    ...evidence.checks.map((check) =>
      `| ${check.status} | \`${check.id}\` | ${check.requirement} | ${check.evidence} | ${(check.missingMarkers ?? []).join("<br>") || "-"} |`
    ),
    "",
    "## Deferred Production Inputs",
    "",
    ...evidence.summary.productionExternalDeferred.map((item) => `- \`${item}\``),
    "",
    "This audit treats external production inputs as deferred by design. Local code must remain fail-closed until those inputs exist."
  ];
  return `${lines.join("\n")}\n`;
}

function relative(path) {
  return path.startsWith(repoRoot) ? path.slice(repoRoot.length + 1).replace(/\\/g, "/") : path;
}
