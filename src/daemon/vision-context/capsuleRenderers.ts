import type {
  CapsuleEvidence,
  ContextEntity,
  TaskCapsule
} from "./types.js";

export function renderTaskCapsuleMarkdown(capsule: TaskCapsule): string {
  return [
    "# Vision Context Task",
    "",
    "## User Utterance",
    capsule.userUtterance,
    "",
    "## Resolved Intent",
    `- Kind: ${capsule.resolvedIntent.kind}`,
    `- Summary: ${capsule.resolvedIntent.summary}`,
    `- Confidence: ${capsule.resolvedIntent.confidence.toFixed(2)}`,
    "",
    "## Reference Resolution",
    ...renderEntityList("Primary referent", capsule.referents),
    ...renderEntityList("Alternatives", capsule.alternatives),
    "",
    "## Environment",
    capsule.source?.appName ? `- App: ${capsule.source.appName}` : "",
    capsule.source?.windowTitle ? `- Window title: ${capsule.source.windowTitle}` : "",
    capsule.source?.url ? `- URL: ${capsule.source.url}` : "",
    capsule.source?.viewport ? `- Viewport: ${capsule.source.viewport.width}x${capsule.source.viewport.height}` : "",
    "",
    "## Evidence",
    ...capsule.evidence.map(renderEvidenceLine),
    "",
    "## Uncertainties",
    ...(capsule.uncertainties.length > 0
      ? capsule.uncertainties.map((item) => `- ${item.reason}`)
      : ["- None recorded."]),
    "",
    "## Agent Instructions",
    ...capsule.instructions.map((instruction) => `- ${instruction}`)
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function renderVisibleUserMessage(capsule: TaskCapsule): string {
  return [
    "Vision Context:",
    capsule.userUtterance,
    "",
    `Intent: ${capsule.resolvedIntent.kind} (${capsule.resolvedIntent.confidence.toFixed(2)})`,
    capsule.evidence.length > 0 ? `Evidence: ${capsule.evidence.length} item(s), ${capsule.evidence.filter((item) => item.path).length} image file(s).` : "Evidence: none.",
    capsule.uncertainties.length > 0 ? `Uncertainty: ${capsule.uncertainties[0]?.reason}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function renderEntityList(label: string, entities: ContextEntity[]): string[] {
  if (entities.length === 0) {
    return [`- ${label}: none`];
  }
  return entities.map((entity, index) => {
    const name = entity.name ? ` ${entity.name}` : "";
    const prefix = label === "Alternatives" ? `- Alternative ${index + 1}:` : `- ${label}:`;
    return `${prefix}${name} (confidence ${entity.confidence.toFixed(2)}, salience ${entity.salience.toFixed(2)})`;
  });
}

function renderEvidenceLine(item: CapsuleEvidence): string {
  const where = item.path ?? item.title;
  const detail = item.text ? `: ${item.text.slice(0, 240).replace(/\s+/g, " ")}` : "";
  const bbox = item.bbox ? ` bbox=${item.bbox.x},${item.bbox.y},${item.bbox.w},${item.bbox.h}` : "";
  const time = item.t !== undefined ? ` at T+${item.t}ms` : "";
  return `- ${where} (${item.kind}${time}${bbox})${detail}`;
}
