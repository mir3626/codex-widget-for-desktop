import { Ban, Check, CheckCheck } from "lucide-react";
import type { RuntimeInteraction, RuntimeInteractionDecision } from "../../shared/protocol.js";

type InteractionCardProps = {
  interaction: RuntimeInteraction;
  values: Record<string, string>;
  onChange: (interactionId: string, fieldId: string, value: string) => void;
  onRespond: (interaction: RuntimeInteraction, decision: RuntimeInteractionDecision, answerOverride?: Record<string, string>) => void;
};

export function InteractionCard({ interaction, values, onChange, onRespond }: InteractionCardProps) {
  const fields = interaction.fields ?? [];
  const choices = interaction.choices ?? [];
  const primaryFieldId = fields[0]?.id;

  return (
    <article className="interaction-card">
      <div className="interaction-copy">
        <strong>{interaction.title}</strong>
        <p>{interaction.body}</p>
      </div>
      {interaction.kind === "input" && choices.length > 0 ? (
        <div className="interaction-choice-list" aria-label="Suggested choices">
          {choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              className={primaryFieldId && values[primaryFieldId] === choice.value ? "selected" : undefined}
              onClick={() => {
                if (primaryFieldId) {
                  onRespond(interaction, "submit", { ...values, [primaryFieldId]: choice.value });
                }
              }}
            >
              <strong>{choice.label}</strong>
              {choice.description ? <span>{choice.description}</span> : null}
              {choice.detail ? <small>{choice.detail}</small> : null}
            </button>
          ))}
        </div>
      ) : null}
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
        <button
          type="button"
          className="primary"
          onClick={() => onRespond(interaction, interaction.kind === "input" ? "submit" : "approve")}
        >
          <Check size={13} />
          <span>{interaction.kind === "input" ? "Send" : "Allow"}</span>
        </button>
        {interaction.kind === "approval" ? (
          <button type="button" className="remember" onClick={() => onRespond(interaction, "always_allow")}>
            <CheckCheck size={13} />
            <span>Always allow</span>
          </button>
        ) : null}
        <button type="button" className="ghost" onClick={() => onRespond(interaction, "decline")}>
          <Ban size={13} />
          <span>Deny</span>
        </button>
      </div>
    </article>
  );
}
