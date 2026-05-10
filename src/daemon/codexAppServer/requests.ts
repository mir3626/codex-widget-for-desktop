import {
  isExternalUrlApprovalRequest,
  pickFileChangeDetail,
  readApprovalAction,
  readExternalUrlApprovalTarget,
  readFileChangeId,
  readFileChangeOperation,
  readFileChangePaths,
  readFileChangeTitle,
  readInputFields,
  readInputTitle,
  readInteractionReason,
  readRecord,
  readSavedApprovalDecision
} from "./messageReaders.js";
import type {
  ActiveTurn,
  JsonRpcMessage
} from "./types.js";

export function handleAppServerRequest(input: {
  active: ActiveTurn | undefined;
  message: JsonRpcMessage;
  respond: (id: string | number, result: unknown) => void;
  respondError: (id: string | number, code: number, message: string) => void;
  storePendingInteraction: (rpcId: string | number, kind: "approval" | "input", action?: string) => string;
  emitFileChangeArtifact: (phase: "before" | "after", message: Pick<JsonRpcMessage, "method" | "params">) => void;
}): void {
  const id = input.message.id;
  if (id === undefined || id === null) {
    return;
  }

  switch (input.message.method) {
    case "item/commandExecution/requestApproval":
      queueApprovalInteraction({ ...input, id, fallbackTitle: "Command approval" });
      return;
    case "item/fileChange/requestApproval":
      input.emitFileChangeArtifact("before", input.message);
      queueApprovalInteraction({ ...input, id, fallbackTitle: "File change approval" });
      return;
    case "item/tool/requestUserInput":
      queueUserInputInteraction({ ...input, id });
      return;
    default:
      if (isExternalUrlApprovalRequest(input.message)) {
        queueApprovalInteraction({ ...input, id, fallbackTitle: "Open browser" });
        return;
      }
      input.respondError(id, -32601, `Unsupported app-server request: ${input.message.method ?? "unknown"}`);
  }
}

export function emitFileChangeArtifact(input: {
  active: ActiveTurn | undefined;
  phase: "before" | "after";
  message: Pick<JsonRpcMessage, "method" | "params">;
}): void {
  const { active, phase, message } = input;
  if (!active) {
    return;
  }

  const params = readRecord(message.params);
  const item = readRecord(params?.item) ?? params;
  const paths = readFileChangePaths(item);
  if (paths.length === 0) {
    return;
  }

  active.emit({
    type: "artifact.fileChange",
    id: active.widgetRequestId,
    changeId: readFileChangeId(item, active.turnId),
    phase,
    title: readFileChangeTitle(item, phase),
    operation: readFileChangeOperation(item),
    paths,
    detail: pickFileChangeDetail(item)
  });
}

function queueApprovalInteraction(input: {
  active: ActiveTurn | undefined;
  id: string | number;
  message: JsonRpcMessage;
  fallbackTitle: string;
  respond: (id: string | number, result: unknown) => void;
  storePendingInteraction: (rpcId: string | number, kind: "approval", action?: string) => string;
}): void {
  const active = input.active;
  if (!active) {
    input.respond(input.id, { decision: "decline" });
    return;
  }

  const params = readRecord(input.message.params);
  const item = readRecord(params?.item) ?? params;
  const externalUrl = readExternalUrlApprovalTarget(input.message.method, params, item);
  const action = readApprovalAction(item, input.fallbackTitle, externalUrl);
  const reason =
    externalUrl
      ? `Codex wants to open ${externalUrl} in your browser.`
      : readInteractionReason(item, params, "Codex needs permission before continuing.");
  const savedDecision = readSavedApprovalDecision(active.executionPermissions, action, item, input.fallbackTitle);
  if (savedDecision === "allow" || savedDecision === "deny") {
    input.respond(input.id, { decision: savedDecision === "allow" ? "accept" : "decline" });
    active.emit({
      type: "execution.permission.applied",
      id: active.widgetRequestId,
      action,
      decision: savedDecision
    });
    return;
  }

  const interactionId = input.storePendingInteraction(input.id, "approval", action);

  active.emit({
    type: "approval.required",
    id: active.widgetRequestId,
    action,
    reason
  });
  active.emit({
    type: "interaction.required",
    interaction: {
      id: interactionId,
      requestId: active.widgetRequestId,
      kind: "approval",
      title: action,
      body: reason,
      action
    }
  });
}

function queueUserInputInteraction(input: {
  active: ActiveTurn | undefined;
  id: string | number;
  message: JsonRpcMessage;
  respond: (id: string | number, result: unknown) => void;
  storePendingInteraction: (rpcId: string | number, kind: "input") => string;
}): void {
  const active = input.active;
  if (!active) {
    input.respond(input.id, { answers: {} });
    return;
  }

  const params = readRecord(input.message.params);
  const interactionId = input.storePendingInteraction(input.id, "input");
  active.emit({
    type: "interaction.required",
    interaction: {
      id: interactionId,
      requestId: active.widgetRequestId,
      kind: "input",
      title: readInputTitle(params),
      body: readInteractionReason(params, undefined, "Codex needs more information to continue."),
      fields: readInputFields(params)
    }
  });
}
