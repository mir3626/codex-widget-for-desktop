import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type {
  CapabilityJobSummary,
  ComputerSessionRollbackActionSummary
} from "../../shared/protocol.js";
import { readTerminalArtifactRollbackTargets } from "./terminalArtifactDelta.js";
import { readUnknownRecord } from "./sessionRecordUtils.js";

export function sanitizeCapabilityJobForDebugBundle(job: CapabilityJobSummary): CapabilityJobSummary {
  if (job.kind !== "terminal") {
    return job;
  }
  return {
    ...job,
    outputJson: sanitizeTerminalCapabilityOutput(job.outputJson)
  };
}

const TERMINAL_STDOUT_BYTE_LIMIT = 512 * 1024;
const TERMINAL_STDERR_BYTE_LIMIT = 128 * 1024;

export function sanitizeRollbackActionForDebugBundle(action: ComputerSessionRollbackActionSummary): ComputerSessionRollbackActionSummary {
  const metadata = readUnknownRecord(action.metadata);
  const terminalArtifactTargets = readTerminalArtifactRollbackTargets(metadata.terminalArtifactTargets);
  if (!terminalArtifactTargets.length) {
    return action;
  }
  return {
    ...action,
    target: action.target ? createHash("sha256").update(action.target, "utf8").digest("hex") : undefined,
    metadata: {
      ...metadata,
      terminalArtifactTargets: terminalArtifactTargets.map((target) => ({
        basename: target.basename,
        size: target.size,
        sha256: target.sha256,
        change: target.change,
        blobId: target.blobId,
        evalResourceId: target.evalResourceId,
        pathHash: createHash("sha256").update(resolve(target.path), "utf8").digest("hex")
      })),
      terminalArtifactTargetPaths: undefined,
      localPaths: "redacted"
    }
  };
}

export function sanitizeTerminalCapabilityOutput(output: unknown): unknown {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return output;
  }
  const record = output as Record<string, unknown>;
  const stdout = typeof record.stdout === "string" ? record.stdout : undefined;
  const stderr = typeof record.stderr === "string" ? record.stderr : undefined;
  const truncated = readUnknownRecord(record.truncated);
  return {
    ...record,
    ...(stdout !== undefined ? { stdout: undefined } : {}),
    ...(stderr !== undefined ? { stderr: undefined } : {}),
    truncated: undefined,
    terminalOutput: {
      stdoutLength: stdout?.length ?? 0,
      stderrLength: stderr?.length ?? 0,
      stdoutTruncated: truncated.stdout === true,
      stderrTruncated: truncated.stderr === true,
      stdoutByteLimit: TERMINAL_STDOUT_BYTE_LIMIT,
      stderrByteLimit: TERMINAL_STDERR_BYTE_LIMIT,
      stdoutSha256: stdout !== undefined ? createHash("sha256").update(stdout, "utf8").digest("hex") : undefined,
      stderrSha256: stderr !== undefined ? createHash("sha256").update(stderr, "utf8").digest("hex") : undefined,
      stdoutPreview: stdout !== undefined ? redactTerminalOutputPreview(stdout) : undefined,
      stderrPreview: stderr !== undefined ? redactTerminalOutputPreview(stderr) : undefined,
      previewChars: 240,
      redaction: "terminal_stdout_stderr_preview_only",
      resourceLimits: "terminal_helper_bounded_output"
    }
  };
}

function redactTerminalOutputPreview(value: string): string {
  return value
    .slice(0, 240)
    .replace(/(password|passwd|token|cookie|credential|secret|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=[redacted]");
}
