import type { AutonomyPermissionRequirement } from "../../shared/protocol.js";
import { requiredGrantsForCommand } from "./capabilityInventory.js";
import { asRecord } from "./toolsmithShared.js";

export function requirementsFromRequest(input: unknown): AutonomyPermissionRequirement[] {
  const record = asRecord(input);
  const requirements: AutonomyPermissionRequirement[] = [];
  const urls = Array.isArray(record.urls) ? record.urls.filter((value): value is string => typeof value === "string") : [];
  for (const url of urls) {
    try {
      const parsed = new URL(url);
      requirements.push({ type: "network_domain", value: parsed.hostname, reason: "Generated tool execution fetches this URL." });
    } catch {
      // Malformed URLs are ignored here; the generated tool reports source-level failures.
    }
  }
  if (typeof record.command === "string") {
    requirements.push(...requiredGrantsForCommand(record.command));
  }
  if (record.pdfRenderer === "pandoc") {
    requirements.push(...requiredGrantsForCommand("pandoc"));
  }
  if (typeof record.outputDir === "string") {
    requirements.push(
      { type: "filesystem_write", value: record.outputDir, reason: "Generated tool writes artifacts to this output directory." },
      { type: "filesystem_read", value: record.outputDir, reason: "Generated tool verifies artifacts in this output directory." }
    );
  }
  if (typeof record.filePath === "string") {
    requirements.push({ type: "filesystem_read", value: record.filePath, reason: "Generated verifier reads this local artifact." });
  }
  for (const key of ["markdownPath", "sourcePath"]) {
    if (typeof record[key] === "string") {
      requirements.push({ type: "filesystem_read", value: record[key], reason: "Generated converter reads this local source document." });
    }
  }
  return requirements;
}

export function uniqueRequirements(requirements: AutonomyPermissionRequirement[]): AutonomyPermissionRequirement[] {
  const seen = new Set<string>();
  const result: AutonomyPermissionRequirement[] = [];
  for (const requirement of requirements) {
    const key = `${requirement.type}:${requirement.value}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(requirement);
  }
  return result;
}
