import type { CapabilityJobSummary } from "../../../shared/protocol.js";
import {
  readActionType,
  readRecord,
  readString,
  shortId
} from "./debugBundleSummary";

export function ApprovalRow({
  job,
  onApprove,
  onCancel
}: {
  job: CapabilityJobSummary;
  onApprove: (jobId: string) => void;
  onCancel: (jobId: string) => void;
}) {
  const approval = summarizeCapabilityApproval(job);
  const preview = buildApprovalPreview(job, approval);
  return (
    <div className="computer-use-approval-item">
      <div className="computer-use-approval-row">
        <span className="capability-status active">approval</span>
        <div className="computer-use-approval-copy">
          <strong>{approval.grant}</strong>
          <small>{approval.reason}</small>
        </div>
        <span className={`capability-status ${approval.tone}`}>{approval.riskClass}</span>
        <small>{approval.command}</small>
        <button type="button" onClick={() => onApprove(job.id)}>Approve</button>
        <button type="button" onClick={() => onCancel(job.id)}>Cancel</button>
      </div>
      {preview ? (
        <details className="computer-use-approval-preview">
          <summary>Preview</summary>
          <pre>{preview}</pre>
        </details>
      ) : null}
    </div>
  );
}

function summarizeCapabilityApproval(job: CapabilityJobSummary): {
  grant: string;
  riskClass: string;
  reason: string;
  command: string;
  tone: string;
} {
  const input = readRecord(job.inputJson);
  if (job.kind === "terminal") {
    const command = readString(input.command) ?? "terminal command";
    return {
      grant: "terminal.command_allowlist",
      riskClass: classifyCommandRisk(command),
      reason: "Run an approved local command in the PTY workspace.",
      command: summarizeCommand(command),
      tone: commandRiskTone(command)
    };
  }
  if (job.kind === "browser_chrome") {
    const command = readString(input.command) ?? readString(input.kind) ?? "browser_chrome";
    return {
      grant: browserChromeGrant(command),
      riskClass: browserChromeRisk(command),
      reason: browserChromeReason(command),
      command,
      tone: browserChromeTone(command)
    };
  }
  if (job.kind === "browser_action") {
    const action = readActionType(input);
    return {
      grant: action === "read" || action === "screenshot" ? "browser.action.read" : "browser.action.side_effect",
      riskClass: action === "read" || action === "screenshot" ? "read_only" : "browser_state_mutation",
      reason: action === "read" || action === "screenshot" ? "Observe browser state." : "Execute a browser action that may change page state.",
      command: action,
      tone: action === "read" || action === "screenshot" ? "ok" : "warn"
    };
  }
  if (job.kind === "desktop_action") {
    const command = readString(input.command) ?? readActionType(input) ?? "desktop_action";
    return {
      grant: command === "observe" || command === "status" ? "desktop.observe" : "desktop.foreground_watch.one_time",
      riskClass: command === "observe" || command === "status" ? "read_only" : "security_boundary",
      reason: command === "observe" || command === "status" ? "Read bounded desktop/browser-window state." : "Foreground input requires watch-mode approval and abort guards.",
      command,
      tone: command === "observe" || command === "status" ? "ok" : "error"
    };
  }
  if (job.kind === "agent_tool") {
    return {
      grant: "generated_tool.execution",
      riskClass: "local_artifact_create",
      reason: "Run a bounded generated or reviewed tool in a runtime workspace.",
      command: readString(input.capability) ?? "agent_tool",
      tone: "warn"
    };
  }
  return {
    grant: `${job.kind}.approval`,
    riskClass: "side_effect",
    reason: "Capability execution requires explicit approval.",
    command: shortId(job.id),
    tone: "warn"
  };
}

function buildApprovalPreview(
  job: CapabilityJobSummary,
  approval: ReturnType<typeof summarizeCapabilityApproval>
): string {
  const highRisk = approval.tone === "warn" || approval.tone === "error";
  if (!highRisk) {
    return "";
  }
  const payload = {
    jobId: job.id,
    kind: job.kind,
    grant: approval.grant,
    riskClass: approval.riskClass,
    command: approval.command,
    reason: approval.reason,
    input: sanitizeApprovalPreview(job.inputJson),
    evidence: {
      requestedBy: job.requestedBy,
      priority: job.priority,
      approvalId: job.approvalId,
      timeoutMs: job.timeoutMs,
      retryCount: job.retryCount
    }
  };
  return JSON.stringify(payload, null, 2).slice(0, 1800);
}

function sanitizeApprovalPreview(value: unknown): unknown {
  if (typeof value === "string") {
    return /password|passwd|token|cookie|credential|secret|api[_-]?key/i.test(value) ? "[redacted]" : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 24).map((item) => sanitizeApprovalPreview(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
    output[key] = /password|passwd|token|cookie|credential|secret|api[_-]?key/i.test(key)
      ? "[redacted]"
      : sanitizeApprovalPreview(child);
  }
  return output;
}

function browserChromeGrant(command: string): string {
  if (command.startsWith("history.")) return "browser.history.one_time";
  if (command.startsWith("debugger.")) return "browser.debugger.one_time";
  if (command.startsWith("file_upload.")) return "file.upload.local_path";
  if (command.startsWith("download.")) return "browser.downloads";
  if (command.startsWith("tab_group.")) return "browser.tab_groups";
  if (command.startsWith("bookmark.")) return "browser.bookmarks";
  return "browser.chrome";
}

function browserChromeRisk(command: string): string {
  if (command.startsWith("history.") || command.startsWith("debugger.")) return "profile_private_data";
  if (command.startsWith("file_upload.")) return "local_file_disclosure";
  if (command.includes("create") || command.includes("update") || command.includes("cancel") || command.includes("clear")) return "browser_state_mutation";
  return "read_only";
}

function browserChromeReason(command: string): string {
  if (command.startsWith("history.")) return "History access is one-time and redacted by default.";
  if (command.startsWith("debugger.")) return "Debugger access can inspect private page state and needs one-time approval.";
  if (command.startsWith("file_upload.")) return "File upload requires an explicit approved local path.";
  if (command.startsWith("download.")) return "Download actions must be observed and verified.";
  if (command.startsWith("tab_group.")) return "Tab group mutation or inspection uses browser chrome permissions.";
  if (command.startsWith("bookmark.")) return "Bookmark state access or mutation uses browser chrome permissions.";
  return "Browser chrome command requires approval.";
}

function browserChromeTone(command: string): string {
  const risk = browserChromeRisk(command);
  if (risk === "read_only") return "ok";
  if (risk === "profile_private_data" || risk === "local_file_disclosure") return "error";
  return "warn";
}

function classifyCommandRisk(command: string): string {
  return /rm\s|del\s|remove|delete|format|shutdown|reg\s+add|set-item|credential|token|password/i.test(command)
    ? "destructive_local_change"
    : "local_artifact_create";
}

function commandRiskTone(command: string): string {
  return classifyCommandRisk(command) === "destructive_local_change" ? "error" : "warn";
}

function summarizeCommand(command: string): string {
  return command.length > 40 ? `${command.slice(0, 37)}...` : command;
}
