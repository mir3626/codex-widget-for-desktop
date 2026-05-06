import { Ban, Check } from "lucide-react";
import type { RuntimeInteraction } from "../../shared/protocol.js";

type InteractionCardProps = {
  interaction: RuntimeInteraction;
  values: Record<string, string>;
  onChange: (interactionId: string, fieldId: string, value: string) => void;
  onRespond: (interaction: RuntimeInteraction, decision: "approve" | "decline" | "submit") => void;
};

export function InteractionCard({ interaction, values, onChange, onRespond }: InteractionCardProps) {
  const fields = interaction.fields ?? [];

  return (
    <article className="interaction-card">
      <div className="interaction-copy">
        <strong>{interaction.title}</strong>
        <p>{interaction.body}</p>
      </div>
      {interaction.kind === "input" ? (
        <div className="interaction-fields">
          {fields.map((field) => (
            <label key={field.id}>
              <span>{field.label}</span>
              {field.multiline ? (
                <textarea
                  value={values[field.id] ?? ""}
                  placeholder={field.placeholder}
                  onChange={(event) => onChange(interaction.id, field.id, event.target.value)}
                />
              ) : (
                <input
                  value={values[field.id] ?? ""}
                  placeholder={field.placeholder}
                  onChange={(event) => onChange(interaction.id, field.id, event.target.value)}
                />
              )}
            </label>
          ))}
        </div>
      ) : null}
      <div className="interaction-actions">
        <button type="button" className="ghost" onClick={() => onRespond(interaction, "decline")}>
          <Ban size={13} />
          <span>Deny</span>
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => onRespond(interaction, interaction.kind === "input" ? "submit" : "approve")}
        >
          <Check size={13} />
          <span>{interaction.kind === "input" ? "Send" : "Allow"}</span>
        </button>
      </div>
    </article>
  );
}
