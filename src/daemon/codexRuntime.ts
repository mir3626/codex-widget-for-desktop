import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { BranchContextMessage, ModelId, ReasoningEffort, WidgetMode } from "../shared/protocol.js";
import { renderWidgetContextSection } from "./widgetContext.js";

export type CodexSandboxMode = "workspace-write" | "danger-full-access";
export type CodexApprovalPolicy = "on-request" | "on-failure" | "never";

export type CodexExecutionContext = {
  workdir: string;
  sandbox: CodexSandboxMode;
  approvalPolicy: CodexApprovalPolicy;
  addDirs: string[];
  protectedRoot: string;
};

export type AgentSelection = {
  model: ModelId;
  reasoningEffort: ReasoningEffort;
};

const DEFAULT_CODEX_SANDBOX_MODE: CodexSandboxMode = "danger-full-access";
const DEFAULT_CODEX_APPROVAL_POLICY: CodexApprovalPolicy = "on-request";

export function resolveCodexExecutionContext(): CodexExecutionContext {
  const fallbackWorkdir = homedir() || process.env.USERPROFILE || process.cwd();
  const workdir = resolve(process.env.CODEX_WIDGET_CODEX_WORKDIR?.trim() || fallbackWorkdir);

  return {
    workdir,
    sandbox: normalizeCodexSandboxMode(process.env.CODEX_WIDGET_CODEX_SANDBOX),
    approvalPolicy: normalizeCodexApprovalPolicy(process.env.CODEX_WIDGET_CODEX_APPROVAL_POLICY),
    addDirs: readAdditionalCodexDirs(workdir),
    protectedRoot: resolve(process.cwd())
  };
}

export function buildCodexExecArgs(
  selection: AgentSelection,
  context: CodexExecutionContext,
  threadId: string | undefined
): string[] {
  const configArgs = [
    "--json",
    "--skip-git-repo-check",
    "-m",
    selection.model,
    "-c",
    `model_reasoning_effort="${selection.reasoningEffort}"`
  ];
  const contextArgs = [
    "-C",
    context.workdir,
    "-s",
    context.sandbox,
    ...context.addDirs.flatMap((dir) => ["--add-dir", dir])
  ];

  if (threadId) {
    return ["exec", ...contextArgs, "resume", ...configArgs, threadId, "-"];
  }

  return ["exec", ...configArgs, ...contextArgs, "-"];
}

export function buildCodexWidgetPrompt(
  request: { mode: WidgetMode; text: string; branchContext?: BranchContextMessage[]; widgetContext?: string },
  context: CodexExecutionContext
): string {
  return [
    `[mode=${request.mode}]`,
    buildCodexWidgetDeveloperInstructions(context),
    renderWidgetContextSection(request.widgetContext),
    renderBranchContext(request.branchContext),
    "",
    "User request:",
    request.text
  ].filter((part) => part !== "").join("\n");
}

export function buildCodexWidgetDeveloperInstructions(context: CodexExecutionContext): string {
  return [
    "Desktop widget execution policy:",
    `- Working root: ${context.workdir}`,
    `- Sandbox mode: ${context.sandbox}`,
    `- Approval policy: ${context.approvalPolicy}`,
    `- Protected widget source root: ${context.protectedRoot}`,
    "- The widget is for normal desktop assistance. You may search, read, create, edit, move, or delete user files only when the user explicitly asks for that file operation and the target path is clear.",
    "- Each turn may include a Codex Widget desktop context section. Use that context to answer questions about widget controls, mode tabs, sessions, artifacts, Vision, DOM, PTY, model/reason settings, and current provider state.",
    "- Do not inspect or modify the protected widget source root from this widget session. If the user asks to change this widget, this repository, or source code in the protected root, answer that source changes should be handled from the CLI instead.",
    "- For destructive operations such as delete, overwrite, or bulk move, proceed only when the user's wording is explicit about the action and target."
  ].join("\n");
}

export function renderBranchContext(branchContext: BranchContextMessage[] | undefined): string {
  if (!branchContext?.length) {
    return "";
  }

  const lines = branchContext
    .flatMap((message) => {
      const text = message.text.trim();
      if (!text) {
        return [];
      }

      const label = message.role === "assistant" ? "Assistant" : "User";
      return [`${label}:`, text];
    })
    .slice(0, 8);

  if (lines.length === 0) {
    return "";
  }

  return [
    "Branch context:",
    "The user explicitly branched from this prior exchange. Use it only as the starting context for the new branch.",
    ...lines
  ].join("\n");
}

export function terminateProcessTree(pid: number | undefined): void {
  if (!pid) {
    return;
  }

  if (process.platform === "win32") {
    const taskkill = spawn("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true
    });
    taskkill.on("error", () => undefined);
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // The process may have exited between the abort signal and cleanup.
    }
  }
}

export async function terminateProcessTreeAndWait(pid: number | undefined, timeoutMs = 5_000): Promise<void> {
  if (!pid) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise<void>((resolveWait) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolveWait();
      };
      const timer = setTimeout(finish, timeoutMs);
      const taskkill = spawn("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true
      });
      taskkill.on("error", finish);
      taskkill.on("exit", finish);
    });
    return;
  }

  terminateProcessTree(pid);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessAlive(pid)) {
      return;
    }
    await delay(50);
  }
}

function normalizeCodexSandboxMode(value: unknown): CodexSandboxMode {
  return value === "workspace-write" ? "workspace-write" : DEFAULT_CODEX_SANDBOX_MODE;
}

function normalizeCodexApprovalPolicy(value: unknown): CodexApprovalPolicy {
  if (value === "never" || value === "on-failure") {
    return value;
  }
  return DEFAULT_CODEX_APPROVAL_POLICY;
}

function readAdditionalCodexDirs(workdir: string): string[] {
  const rawValue = process.env.CODEX_WIDGET_CODEX_ADD_DIRS?.trim();
  if (!rawValue) {
    return [];
  }

  const separator = process.platform === "win32" ? /[;,]/ : /[:,]/;
  const seen = new Set<string>([normalizeComparablePath(workdir)]);
  const dirs: string[] = [];

  for (const rawDir of rawValue.split(separator)) {
    const dir = rawDir.trim();
    if (!dir) {
      continue;
    }

    const resolvedDir = resolve(dir);
    const key = normalizeComparablePath(resolvedDir);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    dirs.push(resolvedDir);
  }

  return dirs;
}

function normalizeComparablePath(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
