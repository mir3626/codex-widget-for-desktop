import type { RuntimeInteraction, SessionSummary } from "../../../shared/protocol.js";

export function createInteractionDraft(interaction: RuntimeInteraction): Record<string, string> {
  const fields = interaction.fields ?? [];
  if (fields.length === 0) {
    return {};
  }

  return Object.fromEntries(fields.map((field) => [field.id, ""]));
}

export function isDisposableNewChatSession(session: SessionSummary | undefined): boolean {
  return Boolean(
    session &&
      session.title.trim().toLowerCase() === "new chat" &&
      (session.messageCount ?? 0) === 0 &&
      (session.artifactCount ?? 0) === 0
  );
}
