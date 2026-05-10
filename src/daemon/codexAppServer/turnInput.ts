import type { AgentRequest } from "../agent.js";
import { renderBranchContext } from "../codexRuntime.js";
import { renderWidgetContextSection } from "../widgetContext.js";
import type { CodexUserInput } from "../../shared/protocol.js";

export function buildTurnInput(request: AgentRequest): CodexUserInput[] {
  if (request.appServerInput?.length) {
    return mergeContextIntoOverride(request, request.appServerInput);
  }

  const input: CodexUserInput[] = [
    {
      type: "text",
      text: [
        `[mode=${request.mode}]`,
        renderWidgetContextSection(request.widgetContext),
        renderBranchContext(request.branchContext),
        "User request:",
        request.text
      ].filter((part) => part !== "").join("\n"),
      text_elements: []
    }
  ];

  for (const url of request.imageDataUrls ?? []) {
    if (isSupportedImageUrl(url)) {
      input.push({ type: "image", url });
    }
  }

  return input;
}

function mergeContextIntoOverride(request: AgentRequest, override: CodexUserInput[]): CodexUserInput[] {
  const contextPrefix = [
    `[mode=${request.mode}]`,
    renderWidgetContextSection(request.widgetContext),
    renderBranchContext(request.branchContext)
  ].filter((part) => part !== "").join("\n");
  const normalized = override.flatMap(normalizeUserInput);
  if (!contextPrefix) {
    return normalized;
  }
  const firstTextIndex = normalized.findIndex((item) => item.type === "text");
  if (firstTextIndex < 0) {
    return [
      { type: "text", text: contextPrefix, text_elements: [] },
      ...normalized
    ];
  }
  return normalized.map((item, index) => {
    if (index !== firstTextIndex || item.type !== "text") {
      return item;
    }
    return {
      ...item,
      text: [contextPrefix, item.text].filter(Boolean).join("\n\n")
    };
  });
}

function normalizeUserInput(input: CodexUserInput): CodexUserInput[] {
  if (input.type === "text") {
    return [{
      type: "text",
      text: input.text,
      text_elements: []
    }];
  }
  if (input.type === "image" && isSupportedImageUrl(input.url)) {
    return [input];
  }
  if (input.type === "localImage" && input.path.trim()) {
    return [{ type: "localImage", path: input.path.trim() }];
  }
  return [];
}

function isSupportedImageUrl(value: string): boolean {
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(value) || /^https?:\/\//i.test(value);
}
