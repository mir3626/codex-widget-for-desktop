import type { CodexUserInput } from "../../shared/protocol.js";
import { renderTaskCapsuleMarkdown, renderVisibleUserMessage } from "./capsuleBuilder.js";
import type { CapsuleEvidence, TaskCapsule } from "./types.js";

export { renderVisibleUserMessage };

export function buildAppServerUserInput(capsule: TaskCapsule): CodexUserInput[] {
  const inputs: CodexUserInput[] = [
    {
      type: "text",
      text: renderTaskCapsuleMarkdown(capsule),
      text_elements: []
    }
  ];

  for (const item of selectImageEvidence(capsule)) {
    if (item.path) {
      inputs.push({ type: "localImage", path: item.path });
    } else if (item.dataUrl && isSupportedImageUrl(item.dataUrl)) {
      inputs.push({ type: "image", url: item.dataUrl });
    }
  }

  return inputs;
}

function selectImageEvidence(capsule: TaskCapsule): CapsuleEvidence[] {
  const imageEvidence = capsule.evidence.filter((item) => item.kind === "image" || item.kind === "crop");
  if (capsule.retention.fullFrames === "crop_only") {
    return imageEvidence.filter((item) => item.kind === "crop");
  }
  return imageEvidence;
}

function isSupportedImageUrl(value: string): boolean {
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(value) || /^https?:\/\//i.test(value);
}
